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
    const sourceGroup = field => clean(field.group) || clean(field.name);
    const sourceCell = field => clean(field.sourceCell).replace(/\$/g, '').toUpperCase();
    function matchingForm(field, target) {
        return target?.kind === 'form' && field.kind === 'form' && (field.id === target.id
            || clean(target.form) && field.form === target.form && sourceGroup(field) === sourceGroup(target));
    }
    function contextFields(unit, saved, target) {
        const fields = textFields(unit), groups = new Map(), retained = new Set();
        for (const field of fields) {
            const name = sourceGroup(field), cell = sourceCell(field);
            // Without a source name or coordinate there is no evidence that
            // different form identities inherit one source cell.
            if (!name && !cell) { retained.add(field); continue; }
            const key = JSON.stringify([name, field.source]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(field);
        }
        for (const peers of groups.values()) {
            const cells = new Set(peers.map(sourceCell).filter(Boolean)), clusters = new Map();
            for (const field of peers) {
                const cell = sourceCell(field);
                // Separate known cells are explicit distinct sources, even when
                // their text happens to match. Missing coordinates cannot join
                // those ambiguous cells to manufacture an inheritance relation.
                if (cells.size > 1 && !cell) { retained.add(field); continue; }
                const key = cells.size > 1 ? cell : '';
                if (!clusters.has(key)) clusters.set(key, []);
                clusters.get(key).push(field);
            }
            for (const cluster of clusters.values()) {
                const trusted = new Set(cluster.filter(field => translationFor(unit, field, saved))),
                    representative = cluster.find(field => field.kind !== 'form') || cluster.find(field => trusted.has(field))
                        || cluster.find(field => matchingForm(field, target)) || cluster[0];
                for (const field of cluster) if (field.kind !== 'form' || trusted.has(field) || field === representative) retained.add(field);
            }
        }
        return fields.filter(field => retained.has(field));
    }
    function limitedFields(fields, target) {
        const selected = new Set(fields.slice(0, LIMITS.fields)), matching = fields.find(field => matchingForm(field, target));
        if (matching && !selected.has(matching)) { selected.delete(fields[LIMITS.fields - 1]); selected.add(matching); }
        return fields.filter(field => selected.has(field));
    }
    function surroundingPlan(unit, units, options) {
        const conversation = options.convoIndex?.memberships?.get(unit.id), targetRow = worksheetRow(unit);
        const familyKey = clean(conversation?.familyKey), provenance = { mode: 'none', reason: 'target-not-loaded',
            maxEntries: LIMITS.surrounding, availableEntries: 0, selectedEntries: 0,
            omitted: { entryLimit: 0, contextBudget: 0, untranslated: 0, fieldLimit: 0, worksheetCoordinates: 0, existingReference: 0 },
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
            const fields = contextFields(value, options.saved, options.field).filter(item => ['text', 'form'].includes(item.kind) && !State.audioOnly(item.source));
            const applicable = provenance.mode === 'same-sheet-translated' ? fields.filter(item => translationFor(value, item, options.saved)) : fields;
            if (!applicable.length) { if (fields.length) provenance.omitted.untranslated++; continue; }
            const npc = provenance.mode === 'same-explicit-npc' ? explicitNpc(value) : null;
            rows.push({ index, omittedFields: Math.max(0, applicable.length - LIMITS.fields),
                record: { unitId: value.id, sheet: value.sheet, recordId: value.recordId, role: value.role,
                    worksheetRow: index, position: index < targetRow ? 'before' : 'after', ...(npc ? { npc } : {}),
                    fields: limitedFields(applicable, options.field).map(item => ({ fieldId: item.id, name: item.name,
                        ...(item.form ? { form: item.form } : {}), source: item.source, ...translationFor(value, item, options.saved) })) } });
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
        function sourceRecord(value, reason) {
            return { unitId: value.id, sheet: value.sheet, recordId: value.recordId, role: value.role, reason,
                fields: limitedFields(contextFields(value, options.saved, field), field).map(item => ({ fieldId: item.id, name: item.name,
                    ...(item.form ? { form: item.form } : {}), source: item.source })) };
        }
        const notes = clean(unit.developerNotes).trim() ? [{ type: 'developer-notes', text: unit.developerNotes }] : [],
            metadata = [], unavailable = [], references = new Map();
        for (const [name, value] of Object.entries(unit.metadata || {}).slice(0, 32)) {
            if (typeof value !== 'string' || !value.trim()) continue;
            metadata.push({ name, value, evidence: metadataKind(name) });
            for (const id of [value, ...value.split(/[,\r\n]+/u)].map(value => value.trim()).filter(Boolean)) {
                const matches = units.filter(candidate => candidate.recordId === id && candidate.role === unit.role);
                if (matches.length === 1) references.set(matches[0].id, sourceRecord(matches[0], 'exact-metadata-reference'));
                else if (matches.length > 1) unavailable.push({ reference: id, reason: 'ambiguous-workbook-reference' });
                else if (/\//.test(id)) unavailable.push({ reference: id, reason: 'reference-not-loaded' });
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
        if (conversation) metadata.push({ name: 'Conversation family', value: conversation.familyKey,
            evidence: 'grouping-only', speakerEstablished: false, ambiguous: !!conversation.ambiguous });
        const skillResolver = options.skillResolver;
        if (skillResolver) for (const cardId of skillResolver.candidates?.(unit) || [])
            for (const related of skillResolver.referencedUnits?.(cardId) || []) if (units.includes(related))
                references.set(related.id, sourceRecord(related, 'verified-related-skill-field'));
        references.delete(unit.id);
        const keywordNames = new Set(State.tokenize(field.source).filter(token => token.kind === 'keyword').map(token => token.identity)),
            keywordMatches = new Map(), keywordLookup = { requested: keywordNames.size, matched: 0, missing: 0, ambiguous: 0, selfReferences: 0 };
        // Keyword identities are resolved only against exact loaded record IDs. No remote catalog is consulted.
        for (const name of keywordNames) {
            const bare = String(name).replace(/^keyword:/, ''), matches = units.filter(candidate => candidate.role === unit.role
                && /keyword/i.test(candidate.sheet) && [name, bare].includes(candidate.recordId));
            if (matches.length === 1) {
                keywordMatches.set(matches[0].id, matches[0]);
            }
            else {
                keywordLookup[matches.length ? 'ambiguous' : 'missing']++;
                unavailable.push({ reference: bare, reason: matches.length ? 'ambiguous-keyword' : 'keyword-not-loaded' });
            }
        }
        keywordLookup.matched = keywordMatches.size;
        keywordLookup.selfReferences = keywordMatches.has(unit.id) ? 1 : 0;
        keywordMatches.delete(unit.id);
        const keywordSources = [...keywordMatches.values()].map(original => ({ original, record: sourceRecord(original, 'exact-keyword-identity') })),
            glossary = [], matchText = [field.source, ...[...references.values()].flatMap(reference => reference.fields.map(item => item.source))].join('\n').toLocaleLowerCase();
        // The caller supplies only a committed shared Dictionary snapshot, never the editable Dictionary or TM.
        const entries = DictionaryScope?.activeEntries(options.dictionary || [], options.scope?.game) || [];
        for (const entry of entries) {
            const find = clean(entry?.find), target = clean(entry?.replace);
            if (entry?.disabled || !find.trim() || !target.trim() || !matchText.includes(find.toLocaleLowerCase())) continue;
            glossary.push({ id: String(entry._id || entry.id || ''), source: find, translation: target,
                ...(clean(entry.tlnote) ? { note: entry.tlnote } : {}), gameScope: DictionaryScope.normalize(entry) });
        }
        for (const [sheet, label] of [['NPCs', 'NPC context'], ['Characters', 'character context']])
            if (!sheets.has(sheet)) unavailable.push({ type: label, reason: 'optional-sheet-not-loaded' });
        const translationCount = keywordSources.reduce((sum, { original, record }) => sum + record.fields.filter(projected => {
            const item = original.fields.find(value => value?.id === projected.fieldId);
            return ['text', 'form'].includes(item?.kind) && !State.audioOnly(item.source) && translationFor(original, item, options.saved);
        }).length, 0), result = { version: 'clienttext-mtl-context-v1', identity: { unitId: unit.id, sheet: unit.sheet, recordId: unit.recordId,
            role: unit.role, fieldId: field.id, fieldName: field.name, kind: field.kind, ...(field.form ? { form: field.form } : {}) },
            notes: [], metadata: [], surrounding: plan.provenance, references: [], keywords: [], glossary: [], unavailable: [],
            keywordLookup, omitted: { notes: notes.length, metadata: metadata.length, references: references.size,
                keywords: keywordSources.length, keywordTranslations: translationCount, glossary: glossary.length, unavailable: unavailable.length },
            evidenceRules: ['Character Filter constrains the listener; it does not identify the speaker.',
                'NPC and conversation groups are related context and do not identify a speaker without explicit workbook metadata.'] };
        function updateSelection() {
            const direct = new Set([...result.references, ...result.keywords].map(value => value.unitId));
            result.surrounding.selectedEntries = result.surrounding.entries.length;
            result.surrounding.omitted.existingReference = plan.candidates.filter(value => direct.has(value.record.unitId)).length;
            result.surrounding.omitted.contextBudget = plan.candidates.length - result.surrounding.selectedEntries - result.surrounding.omitted.existingReference;
            result.surrounding.truncated = Object.entries(result.surrounding.omitted).some(([key, count]) => !['untranslated', 'existingReference'].includes(key) && count > 0);
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
        // Omission counters are reserved before packing and only decrease, so
        // diagnostics cannot disappear or grow past a completely filled budget.
        for (const name of ['notes', 'metadata']) for (const item of name === 'notes' ? notes : metadata)
            if (add(result[name], item)) result.omitted[name]--;
        const included = new Set([unit.id]), keywordRecords = new Map();
        for (const related of references.values()) {
            if (result.references.length >= 12) break;
            if (add(result.references, related)) { included.add(related.unitId); result.omitted.references--; }
        }
        for (const { original, record: source } of keywordSources) {
            if (!included.has(original.id) && add(result.keywords, source)) included.add(original.id);
            const record = [...result.keywords, ...result.references].find(value => value.unitId === original.id);
            if (record) { keywordRecords.set(original.id, { original, record }); result.omitted.keywords--; }
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
                else result.omitted.keywordTranslations--;
            }
        }
        for (const item of glossary) {
            if (result.glossary.length >= LIMITS.glossary) break;
            if (add(result.glossary, item)) result.omitted.glossary--;
        }
        for (const item of unavailable) if (add(result.unavailable, item)) result.omitted.unavailable--;
        const selected = [];
        // Optional nearby rows receive only the budget left by direct workbook
        // evidence, translated keywords, glossary and explicit lookup diagnostics.
        for (const candidate of plan.candidates) {
            if (included.has(candidate.record.unitId)) continue;
            result.surrounding.omitted.fieldLimit += candidate.omittedFields;
            if (add(result.surrounding.entries, candidate.record)) { included.add(candidate.record.unitId); selected.push(candidate); }
            else result.surrounding.omitted.fieldLimit -= candidate.omittedFields;
        }
        result.surrounding.entries = selected.sort((a, b) => a.index - b.index).map(value => copy(value.record));
        updateSelection();
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
