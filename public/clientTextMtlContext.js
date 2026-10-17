/* Bounded MTL context from the already loaded immutable ClientText workbooks. */
(function (root, factory) {
    const node = typeof module === 'object' && module.exports;
    const api = factory(node ? require('./clientTextState.js') : root.ClientTextState,
        node ? require('./dictionaryScope.js') : root.DictionaryScope);
    if (node) module.exports = api; else root.ClientTextMtlContext = api;
})(typeof globalThis === 'object' ? globalThis : self, function (State, DictionaryScope) {
    'use strict';
    const LIMITS = Object.freeze({ source: 12000, context: 16000, bytes: 65536, lookups: 2, results: 4, glossary: 32 });
    const copy = value => JSON.parse(JSON.stringify(value));
    const clean = value => typeof value === 'string' ? value : '';
    const metadataKind = name => /^character filter$/i.test(name) ? 'listener-constraint'
        : /^(?:speaker|speaking character)$/i.test(name) ? 'explicit-speaker'
        : /^(?:related ?character|character|npc)$/i.test(name) ? 'explicit-reference' : 'workbook-metadata';
    const textFields = unit => (unit?.fields || []).filter(field => field.kind !== 'gender' && clean(field.source).trim());
    function create(options = {}) {
        const { unit, field } = options;
        if (!unit?.fields?.includes(field) || !['text', 'form'].includes(field?.kind) || !clean(field.source).trim()
            || State.audioOnly(field.source)) throw new TypeError('MTL requires an eligible field from the loaded workbook.');
        if (field.source.length > LIMITS.source) throw new RangeError('This source exceeds the MTL field limit.');
        const units = Array.isArray(options.units) ? options.units : [], sheets = new Set(units.map(value => value.sheet));
        const budget = Math.min(LIMITS.context, Number.isSafeInteger(options.contextLimit) ? Math.max(0, options.contextLimit) : LIMITS.context);
        let remaining = budget, lookupCount = 0;
        const result = { version: 'clienttext-mtl-context-v1', identity: { unitId: unit.id, sheet: unit.sheet, recordId: unit.recordId,
            role: unit.role, fieldId: field.id, fieldName: field.name, kind: field.kind, ...(field.form ? { form: field.form } : {}) },
            notes: [], metadata: [], references: [], keywords: [], glossary: [], unavailable: [],
            evidenceRules: ['Character Filter constrains the listener; it does not identify the speaker.',
                'NPC and conversation groups are related context and do not identify a speaker without explicit workbook metadata.'] };
        remaining = Math.max(0, remaining - JSON.stringify(result).length);
        function add(array, item) {
            const size = JSON.stringify(item).length;
            if (size > remaining) return false;
            array.push(copy(item)); remaining -= size; return true;
        }
        function sourceRecord(value, reason) {
            return { unitId: value.id, sheet: value.sheet, recordId: value.recordId, role: value.role, reason,
                fields: textFields(value).slice(0, 8).map(item => ({ fieldId: item.id, name: item.name, source: item.source })) };
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
            for (const related of group?.npcUnits || []) references.set(related.id, { ...sourceRecord(related, 'npc-group-related-context'),
                relationship: copy(evidence), speakerEstablished: false });
        }
        const conversation = options.convoIndex?.memberships?.get(unit.id);
        if (conversation) add(result.metadata, { name: 'Conversation family', value: conversation.familyKey,
            evidence: 'grouping-only', speakerEstablished: false, ambiguous: !!conversation.ambiguous });
        const skillResolver = options.skillResolver;
        if (skillResolver) for (const cardId of skillResolver.candidates?.(unit) || [])
            for (const related of skillResolver.referencedUnits?.(cardId) || []) if (units.includes(related))
                references.set(related.id, sourceRecord(related, 'verified-related-skill-field'));
        for (const related of references.values()) {
            if (result.references.length >= 12) break;
            add(result.references, related);
        }
        const keywordNames = new Set(State.tokenize(field.source).filter(token => token.kind === 'keyword').map(token => token.identity));
        // Keyword identities are resolved only against exact loaded record IDs. No remote catalog is consulted.
        for (const name of keywordNames) {
            const bare = String(name).replace(/^keyword:/, ''), matches = units.filter(candidate => candidate.role === unit.role
                && /keyword/i.test(candidate.sheet) && [name, bare].includes(candidate.recordId));
            if (matches.length === 1) add(result.keywords, sourceRecord(matches[0], 'exact-keyword-identity'));
            else add(result.unavailable, { reference: bare, reason: matches.length ? 'ambiguous-keyword' : 'keyword-not-loaded' });
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
        const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
        if (bytes > 48 * 1024) throw new RangeError('The prepared MTL context exceeds the request limit.');
        const initial = copy(result), contextHash = State.hash(initial);
        return { initial, contextHash, glossaryHash: State.hash(initial.glossary),
            lookup(input) {
                if (lookupCount >= LIMITS.lookups) throw new RangeError('MTL context lookup limit reached.');
                lookupCount++;
                if (!input || typeof input.recordId !== 'string' || !input.recordId || input.recordId.length > 1024
                    || input.sheet !== undefined && typeof input.sheet !== 'string'
                    || Object.keys(input).some(key => !['recordId', 'sheet'].includes(key))) throw new TypeError('Invalid workbook context lookup.');
                const matches = units.filter(candidate => candidate.role === unit.role && candidate.recordId === input.recordId
                    && (input.sheet === undefined || candidate.sheet === input.sheet));
                const output = [];
                for (const match of matches.slice(0, LIMITS.results)) add(output, sourceRecord(match, 'requested-exact-workbook-reference'));
                return { results: output, unavailable: !matches.length, ambiguous: matches.length > 1,
                    limited: output.length < matches.length, lookupsRemaining: LIMITS.lookups - lookupCount };
            }, get lookupsUsed() { return lookupCount; }, get remainingCharacters() { return remaining; } };
    }
    return { LIMITS, create, build: options => create(options).initial };
});
