/* Bounded MTL context from the already loaded immutable ClientText workbooks. */
(function (root, factory) {
    const node = typeof module === 'object' && module.exports;
    const api = factory(node ? require('./clientTextState.js') : root.ClientTextState,
        node ? require('./dictionaryScope.js') : root.DictionaryScope);
    if (node) module.exports = api; else root.ClientTextMtlContext = api;
})(typeof globalThis === 'object' ? globalThis : self, function (State, DictionaryScope) {
    'use strict';
    const LIMITS = Object.freeze({ source: 12000, context: 16000, contextBytes: 48 * 1024, contextEntries: 1500,
        bytes: 65536, surrounding: 50, fields: 8, lookups: 2, results: 4, glossary: 32 });
    const copy = value => JSON.parse(JSON.stringify(value));
    const clean = value => typeof value === 'string' ? value : '';
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const metadataKind = name => /^character filter$/i.test(name) ? 'listener-constraint'
        : /^(?:speaker|speaking character)$/i.test(name) ? 'explicit-speaker'
        : /^(?:related ?character|character|npc)$/i.test(name) ? 'explicit-reference' : 'workbook-metadata';
    const textFields = unit => (unit?.fields || []).filter(field => field && field.kind !== 'gender' && clean(field.source).trim());
    const dialogue = unit => /^(?:NPCTextAudio|NPCTalkDialogueTextAudio)(?:_Gender)?$/.test(unit?.sheet);
    function npcResolver(units, index) {
        const loaded = new Map(units.map(value => [value.id, value])), paths = new Map(), names = new Map(), cache = new Map();
        const normalized = value => clean(value).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
        function add(map, reference, key) {
            if (!reference) return;
            if (!map.has(reference)) map.set(reference, new Set());
            map.get(reference).add(key);
        }
        for (const [key, group] of index?.groupByKey || []) for (const candidate of group?.npcUnits || []) {
            const original = loaded.get(candidate?.id);
            if (!original || !/^NPCs(?:_Gender)?$/.test(original.sheet)) continue;
            add(paths, original.recordId, key);
            if (!original.recordId.startsWith('Metadata/NPC/Info/')) for (const field of original.fields)
                if (['Name', 'Short Name'].includes(field.name)) add(names, normalized(field.source), key);
        }
        function resolve(reference, speaker = false) {
            const owners = paths.get(reference) || (speaker ? names.get(normalized(reference)) : null);
            return owners?.size === 1 ? owners.values().next().value : null;
        }
        return unit => {
            if (cache.has(unit.id)) return cache.get(unit.id);
            const metadata = Object.entries(unit.metadata || {}), speakers = metadata.filter(([name]) => /^(?:speaker|speaking character)$/i.test(name)),
                related = metadata.filter(([name]) => /^npc$/i.test(name));
            let result = null;
            const speakerRefs = speakers.map(([, value]) => clean(value).trim()),
                references = related.flatMap(([, value]) => clean(value).split(/[,\r\n]+/u).map(value => value.trim()).filter(Boolean)),
                unique = [...new Set(references)], relatedKey = unique.length === 1 ? resolve(unique[0]) : null,
                speakerKeys = speakerRefs.map(reference => resolve(reference, true));
            // Blank identity columns and conflicting verified speakers cannot
            // fall through to ID aliases. A generic player label is not an NPC.
            if (!speakerRefs.some(reference => !reference) && (!related.length || relatedKey)) {
                const verified = [...new Set(speakerKeys.filter(key => key !== null))];
                if (relatedKey && verified.every(key => key === relatedKey)) result = {
                    groupKey: relatedKey, reference: unique[0], evidence: 'explicit-npc-reference',
                    speakerEstablished: speakerRefs.length > 0 && speakerKeys.every(key => key === relatedKey) };
                else if (!related.length && speakerKeys.length && speakerKeys.every(key => key !== null) && verified.length === 1)
                    result = { groupKey: verified[0], reference: speakerRefs[0], evidence: 'explicit-speaker', speakerEstablished: true };
            }
            cache.set(unit.id, result); return result;
        };
    }
    function worksheetRow(unit) {
        const rows = new Set();
        for (const field of unit.fields) for (const cell of [field?.sourceCell, field?.targetCell]) {
            if (!clean(cell)) continue;
            const match = /^\$?[A-Z]{1,3}\$?([1-9]\d*)$/i.exec(cell);
            if (!match || Number(match[1]) > 1048576) return null;
            rows.add(Number(match[1]));
        }
        return rows.size === 1 ? rows.values().next().value : null;
    }
    function translationFor(unit, field, saved) {
        // Only the caller's scoped Saved snapshot is accepted. Drafts, candidates
        // and MTL review overlays are deliberately not context inputs.
        const record = saved instanceof Map ? saved.get(unit.id) : own(saved, unit.id) ? saved[unit.id] : null;
        const authored = record && record.saved !== false && own(record.values, field.id);
        const outdated = !!field.outdated || Array.isArray(record?.outdated) && record.outdated.includes(field.id);
        if (outdated && (!authored || record.reviewed?.[field.id] !== State.sourceHash(field.source))) return null;
        if (Array.isArray(record?.conflicts) && record.conflicts.some(value => value?.fieldId === field.id)) return null;
        const translation = authored ? record.values[field.id] : field.target;
        if (!clean(translation).trim() || translation.trim() === 'NONEXISTENT' || !authored && field.originalMissing) return null;
        return { translation, translationOrigin: authored ? 'saved' : 'original-workbook' };
    }
    function surroundingPlan(unit, units, options) {
        const conversation = options.convoIndex?.memberships?.get(unit.id), targetRow = worksheetRow(unit);
        const familyKey = clean(conversation?.familyKey), provenance = { mode: 'none', reason: 'target-not-loaded',
            maxEntries: LIMITS.surrounding, availableEntries: 0, selectedEntries: 0,
            omitted: { entryLimit: 0, contextBudget: 0, untranslated: 0, fieldLimit: 0, worksheetCoordinates: 0 },
            selectionOrder: 'nearest-first-preceding-on-ties', outputOrder: 'worksheet-row',
            orderEvidence: 'immutable-worksheet-coordinates', truncated: false, entries: [] };
        if (!units.some(value => value.id === unit.id)) return { provenance, candidates: [] };
        if (!targetRow) { provenance.reason = 'worksheet-order-unavailable'; return { provenance, candidates: [] }; }
        let candidates, explicitNpc;
        if (familyKey) {
            provenance.familyKey = familyKey;
            candidates = units.filter(value => value.role === unit.role && value.sheet === unit.sheet && value.id !== unit.id
                && options.convoIndex.memberships.get(value.id)?.familyKey === familyKey);
            if (candidates.length) { provenance.mode = 'conversation-family'; provenance.reason = 'known-conversation'; }
            else {
                explicitNpc = npcResolver(units, options.npcIndex);
                const npc = explicitNpc(unit);
                provenance.mode = 'same-explicit-npc';
                provenance.reason = npc ? 'singleton-conversation' : 'singleton-without-verified-npc';
                if (npc) {
                    provenance.npc = npc;
                    // Different sheets have no shared row coordinate system.
                    candidates = units.filter(value => value.role === unit.role && value.sheet === unit.sheet && value.id !== unit.id && dialogue(value)
                        && explicitNpc(value)?.groupKey === npc.groupKey);
                }
            }
        } else {
            provenance.mode = 'same-sheet-translated'; provenance.reason = 'no-known-conversation';
            candidates = units.filter(value => value.role === unit.role && value.sheet === unit.sheet && value.id !== unit.id);
        }
        const rows = [];
        for (const value of candidates || []) {
            const index = worksheetRow(value);
            if (!index || index === targetRow) { provenance.omitted.worksheetCoordinates++; continue; }
            const fields = textFields(value).filter(item => ['text', 'form'].includes(item.kind) && !State.audioOnly(item.source))
                .map(item => ({ fieldId: item.id, name: item.name, ...(item.form ? { form: item.form } : {}), source: item.source,
                    ...translationFor(value, item, options.saved) }));
            const applicable = provenance.mode === 'same-sheet-translated' ? fields.filter(item => own(item, 'translation')) : fields;
            if (!applicable.length) { if (fields.length) provenance.omitted.untranslated++; continue; }
            const npc = provenance.mode === 'same-explicit-npc' ? explicitNpc(value) : null;
            rows.push({ index, omittedFields: Math.max(0, applicable.length - LIMITS.fields),
                record: { unitId: value.id, sheet: value.sheet, recordId: value.recordId, role: value.role,
                    worksheetRow: index, position: index < targetRow ? 'before' : 'after', ...(npc ? { npc } : {}), fields: applicable.slice(0, LIMITS.fields) } });
        }
        rows.sort((a, b) => Math.abs(a.index - targetRow) - Math.abs(b.index - targetRow) || a.index - b.index
            || a.record.unitId.localeCompare(b.record.unitId, 'en'));
        provenance.availableEntries = rows.length;
        provenance.omitted.entryLimit = Math.max(0, rows.length - LIMITS.surrounding);
        return { provenance, candidates: rows.slice(0, LIMITS.surrounding) };
    }
    function sizeOf(value) {
        const json = JSON.stringify(value);
        function count(item) {
            return 1 + (Array.isArray(item) ? item.reduce((sum, child) => sum + count(child), 0)
                : item && typeof item === 'object' ? Object.values(item).reduce((sum, child) => sum + count(child), 0) : 0);
        }
        return { characters: json.length, bytes: new TextEncoder().encode(json).length, entries: count(value) };
    }
    function create(options = {}) {
        const { unit, field } = options;
        if (!unit?.fields?.includes(field) || !['text', 'form'].includes(field?.kind) || !clean(field.source).trim()
            || State.audioOnly(field.source)) throw new TypeError('MTL requires an eligible field from the loaded workbook.');
        if (field.source.length > LIMITS.source) throw new RangeError('This source exceeds the MTL field limit.');
        const seen = new Set(), units = (Array.isArray(options.units) ? options.units : []).filter(value => {
            if (!value || !clean(value.id) || !Array.isArray(value.fields) || seen.has(value.id)) return false;
            seen.add(value.id); return true;
        }), sheets = new Set(units.map(value => value.sheet)), loaded = new Map(units.map(value => [value.id, value]));
        const budget = Math.min(LIMITS.context, Number.isSafeInteger(options.contextLimit) ? Math.max(0, options.contextLimit) : LIMITS.context);
        let lookupCount = 0;
        const plan = surroundingPlan(unit, units, options);
        const result = { version: 'clienttext-mtl-context-v1', identity: { unitId: unit.id, sheet: unit.sheet, recordId: unit.recordId,
            role: unit.role, fieldId: field.id, fieldName: field.name, kind: field.kind, ...(field.form ? { form: field.form } : {}) },
            notes: [], metadata: [], surrounding: plan.provenance, references: [], keywords: [], glossary: [], unavailable: [],
            evidenceRules: ['Character Filter constrains the listener; it does not identify the speaker.',
                'NPC and conversation groups are related context and do not identify a speaker without explicit workbook metadata.'] };
        function updateSelection() {
            result.surrounding.selectedEntries = result.surrounding.entries.length;
            result.surrounding.omitted.contextBudget = plan.candidates.length - result.surrounding.selectedEntries;
            result.surrounding.truncated = Object.entries(result.surrounding.omitted).some(([key, count]) => key !== 'untranslated' && count > 0);
        }
        updateSelection();
        function fitsContext() {
            const size = sizeOf(result);
            return size.characters <= budget && size.bytes <= LIMITS.contextBytes && size.entries <= LIMITS.contextEntries;
        }
        function add(array, item) {
            array.push(copy(item)); updateSelection();
            if (fitsContext()) return true;
            array.pop(); updateSelection(); return false;
        }
        function sourceRecord(value, reason) {
            return { unitId: value.id, sheet: value.sheet, recordId: value.recordId, role: value.role, reason,
                fields: textFields(value).slice(0, LIMITS.fields).map(item => ({ fieldId: item.id, name: item.name, source: item.source })) };
        }
        if (clean(unit.developerNotes).trim()) add(result.notes, { type: 'developer-notes', text: unit.developerNotes });
        const references = new Map();
        for (const [name, value] of Object.entries(unit.metadata || {}).slice(0, 32)) {
            if (typeof value !== 'string' || !value.trim()) continue;
            add(result.metadata, { name, value, evidence: metadataKind(name) });
            for (const id of [value, ...value.split(/[,\r\n]+/u)].map(value => value.trim()).filter(Boolean)) {
                const matches = units.filter(candidate => candidate.recordId === id && candidate.role === unit.role);
                if (matches.length === 1) references.set(matches[0].id, sourceRecord(matches[0], 'exact-metadata-reference'));
                else if (matches.length > 1) add(result.unavailable, { reference: id, reason: 'ambiguous-workbook-reference' });
                else if (/\//.test(id)) add(result.unavailable, { reference: id, reason: 'reference-not-loaded' });
            }
        }
        const membership = options.npcIndex?.memberships?.get(unit.id);
        for (const [key, evidence] of membership || []) {
            const group = options.npcIndex.groupByKey?.get(key);
            for (const candidate of group?.npcUnits || []) {
                const related = loaded.get(candidate?.id);
                if (related && related.role === unit.role) references.set(related.id, { ...sourceRecord(related, 'npc-group-related-context'),
                    relationship: copy(evidence), speakerEstablished: false });
            }
        }
        const conversation = options.convoIndex?.memberships?.get(unit.id);
        if (conversation) add(result.metadata, { name: 'Conversation family', value: conversation.familyKey,
            evidence: 'grouping-only', speakerEstablished: false, ambiguous: !!conversation.ambiguous });
        const skillResolver = options.skillResolver;
        if (skillResolver) for (const cardId of skillResolver.candidates?.(unit) || [])
            for (const related of skillResolver.referencedUnits?.(cardId) || []) if (units.includes(related))
                references.set(related.id, sourceRecord(related, 'verified-related-skill-field'));
        const included = new Set([unit.id]), selected = [];
        for (const candidate of plan.candidates) {
            result.surrounding.omitted.fieldLimit += candidate.omittedFields;
            if (add(result.surrounding.entries, candidate.record)) { included.add(candidate.record.unitId); selected.push(candidate); }
            else result.surrounding.omitted.fieldLimit -= candidate.omittedFields;
        }
        // Choose by proximity, then present exact workbook order to retain the
        // preceding/following relationship without suggesting playback order.
        result.surrounding.entries = selected.sort((a, b) => a.index - b.index).map(value => copy(value.record));
        updateSelection();
        for (const related of references.values()) {
            if (result.references.length >= 12) break;
            if (!included.has(related.unitId) && add(result.references, related)) included.add(related.unitId);
        }
        const keywordNames = new Set(State.tokenize(field.source).filter(token => token.kind === 'keyword').map(token => token.identity)),
            keywordRecords = new Map();
        // Keyword identities are resolved only against exact loaded record IDs. No remote catalog is consulted.
        for (const name of keywordNames) {
            const bare = String(name).replace(/^keyword:/, ''), matches = units.filter(candidate => candidate.role === unit.role
                && /keyword/i.test(candidate.sheet) && [name, bare].includes(candidate.recordId));
            if (matches.length === 1) {
                if (!included.has(matches[0].id) && add(result.keywords, sourceRecord(matches[0], 'exact-keyword-identity'))) included.add(matches[0].id);
                const record = [...result.keywords, ...result.references].find(value => value.unitId === matches[0].id);
                if (record) keywordRecords.set(matches[0].id, { original: matches[0], record });
            }
            else add(result.unavailable, { reference: bare, reason: matches.length ? 'ambiguous-keyword' : 'keyword-not-loaded' });
        }
        // Keep every retained English keyword record before spending the shared
        // budget on whole trusted translations. A deduplicated metadata reference
        // receives the same translation context without repeating the unit.
        for (const { original, record } of keywordRecords.values()) {
            const fields = new Map(original.fields.filter(Boolean).map(value => [value.id, value]));
            for (let index = 0; index < record.fields.length; index++) {
                const before = record.fields[index], field = fields.get(before.fieldId);
                if (!field || !['text', 'form'].includes(field.kind) || State.audioOnly(field.source)) continue;
                const translation = translationFor(original, field, options.saved);
                if (!translation) continue;
                record.fields[index] = { ...before, ...translation };
                if (!fitsContext()) record.fields[index] = before;
            }
        }
        const matchText = [field.source, ...result.references.flatMap(reference => reference.fields.map(item => item.source))].join('\n').toLocaleLowerCase();
        // The caller supplies only a committed shared Dictionary snapshot, never the editable Dictionary or TM.
        const entries = DictionaryScope?.activeEntries(options.dictionary || [], options.scope?.game) || [];
        for (const entry of entries) {
            if (result.glossary.length >= LIMITS.glossary) break;
            const find = clean(entry?.find), target = clean(entry?.replace);
            if (entry?.disabled || !find.trim() || !target.trim() || !matchText.includes(find.toLocaleLowerCase())) continue;
            add(result.glossary, { id: String(entry._id || entry.id || ''), source: find, translation: target,
                ...(clean(entry.tlnote) ? { note: entry.tlnote } : {}), gameScope: DictionaryScope.normalize(entry) });
        }
        for (const [sheet, label] of [['NPCs', 'NPC context'], ['Characters', 'character context']])
            if (!sheets.has(sheet)) add(result.unavailable, { type: label, reason: 'optional-sheet-not-loaded' });
        const size = sizeOf(result);
        if (size.characters > LIMITS.context || size.bytes > LIMITS.contextBytes || size.entries > LIMITS.contextEntries)
            throw new RangeError('The prepared MTL context exceeds the request limit.');
        const initial = copy(result), contextHash = State.hash(initial);
        let remaining = Math.max(0, budget - size.characters), remainingBytes = LIMITS.contextBytes - size.bytes,
            remainingEntries = LIMITS.contextEntries - size.entries;
        return { initial, contextHash, glossaryHash: State.hash(initial.glossary),
            lookup(input) {
                if (lookupCount >= LIMITS.lookups) throw new RangeError('MTL context lookup limit reached.');
                lookupCount++;
                if (!input || typeof input.recordId !== 'string' || !input.recordId || input.recordId.length > 1024
                    || input.sheet !== undefined && typeof input.sheet !== 'string'
                    || Object.keys(input).some(key => !['recordId', 'sheet'].includes(key))) throw new TypeError('Invalid workbook context lookup.');
                const matches = units.filter(candidate => candidate.id !== unit.id && candidate.role === unit.role && candidate.recordId === input.recordId
                    && (input.sheet === undefined || candidate.sheet === input.sheet));
                const output = [];
                for (const match of matches.slice(0, LIMITS.results)) {
                    const record = sourceRecord(match, 'requested-exact-workbook-reference'), size = sizeOf(record);
                    if (size.characters + 1 > remaining || size.bytes + 1 > remainingBytes || size.entries > remainingEntries) continue;
                    output.push(copy(record)); remaining -= size.characters + 1; remainingBytes -= size.bytes + 1; remainingEntries -= size.entries;
                }
                return { results: output, unavailable: !matches.length, ambiguous: matches.length > 1,
                    limited: output.length < matches.length, lookupsRemaining: LIMITS.lookups - lookupCount };
            }, get lookupsUsed() { return lookupCount; }, get remainingCharacters() { return remaining; } };
    }
    return { LIMITS, create, build: options => create(options).initial };
});
