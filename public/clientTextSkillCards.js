/* Pure contextual preview composition. Game content is supplied by the private API. */
(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./clientTextState.js') : root.ClientTextState);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextSkillCards = api;
})(typeof globalThis === 'object' ? globalThis : self, function (State) {
    'use strict';
    const SCHEMA_VERSION = 1;
    const SHEETS = new Set(['ActiveSkills', 'BaseItemTypes', 'GemTags', 'GrantedEffectLabels', 'ClientStrings']);
    const SCOPE_KEYS = ['accountId', 'game', 'branchId', 'groupId', 'language', 'versionId', 'sourceHash', 'baselineId', 'accessKey'];
    // Explicit user-requested preview examples. These are never character or workbook values.
    const EXAMPLE_VARIABLES = Object.freeze([
        Object.freeze({ name: 'level', key: 'skill-card:level', defaultValue: '1', min: 1, max: 100, integer: true }),
        Object.freeze({ name: 'quality', key: 'skill-card:quality', defaultValue: '10', min: -100, max: 1000 }),
        Object.freeze({ name: 'cost', key: 'skill-card:cost', defaultValue: '5', min: 0, max: 1000000000 }),
        Object.freeze({ name: 'criticalChance', key: 'skill-card:critical-chance', defaultValue: '7.00', min: 0, max: 100, decimals: 2 }),
        Object.freeze({ name: 'time', key: 'skill-card:time', defaultValue: '1.00', min: 0, max: 3600, decimals: 2 })
    ]);
    const EXAMPLE_KEYS = Object.freeze(EXAMPLE_VARIABLES.map(variable => variable.key));
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const copy = value => JSON.parse(JSON.stringify(value));
    const identity = value => JSON.stringify([value.sheet, value.recordId]);
    const invalid = message => { throw Object.assign(new Error('Invalid skill-card catalog: ' + message), { code: 'SKILL_CARD_CATALOG_INVALID' }); };
    const text = (value, max = 32768) => typeof value === 'string' && value.length > 0 && value.length <= max;
    const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const slug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 128;
    // Canonical ClientStrings bindings, checked against immutable workbook English
    // before use. These optional labels need no new private catalog/API contract.
    function timeReference(recordId, source) {
        return Object.freeze({ sheet: 'ClientStrings', recordId, field: 'Text', source, sourceHash: State.sourceHash(source) });
    }
    const TIME_REFERENCES = Object.freeze({
        cast: Object.freeze({ label: timeReference('ItemDisplaySkillGemCastTime', 'Cast Time'), shortLabel: timeReference('SkillPopupCastTime', 'Cast Time') }),
        attack: Object.freeze({ label: timeReference('ItemDisplaySkillGemAttackTimeOverride', 'Attack Time'), shortLabel: timeReference('SkillPopupAttackTime', 'Attack Time') }),
        use: Object.freeze({ label: timeReference('ItemDisplaySkillGemUseTime', 'Use Time'), shortLabel: timeReference('SkillPopupUseTime', 'Use Time') })
    });
    const TIME_FORMAT = timeReference('ItemDisplaySkillGemCastTimeValue', '{0}s');
    const SHORT_TIME_FORMAT = timeReference('SkillPopupCastTimeValue', '{0} s');
    function timingReferences(card) {
        const first = card.tags[0]?.ref.recordId;
        return { ...TIME_REFERENCES[first === 'spell' ? 'cast' : first === 'attack' ? 'attack' : 'use'], format: TIME_FORMAT, shortFormat: SHORT_TIME_FORMAT };
    }
    function list(value, limit, label) {
        if (!Array.isArray(value) || value.length > limit) invalid(label);
        return value;
    }
    function refs(card) {
        return [card.title, card.itemTitle, card.description, card.shortDescription,
            ...card.tags.map(tag => tag.ref), ...card.tabs.map(tab => tab.label), card.qualityLabel, card.footer,
            ...Object.values(card.examples || {}), ...Object.values(timingReferences(card))].filter(Boolean);
    }
    function exampleDefaults() { return Object.fromEntries(EXAMPLE_VARIABLES.map(variable => [variable.key, variable.defaultValue])); }
    function defaultExampleValue(key) { return EXAMPLE_VARIABLES.find(variable => variable.key === key)?.defaultValue; }
    function resetExamples(values = {}) { return { ...values, ...exampleDefaults() }; }
    function normalizeExamples(input = {}) {
        const values = {}, invalidKeys = [];
        for (const variable of EXAMPLE_VARIABLES) {
            const raw = String(input[variable.key] ?? variable.defaultValue).trim(), number = Number(raw);
            const valid = raw.length <= 24 && /^[+-]?(?:\d+(?:\.\d{0,4})?|\.\d{1,4})$/.test(raw)
                && Number.isFinite(number) && number >= variable.min && number <= variable.max && (!variable.integer || Number.isInteger(number));
            if (!valid) invalidKeys.push(variable.key);
            values[variable.key] = valid ? variable.decimals !== undefined ? number.toFixed(variable.decimals) : String(number) : variable.defaultValue;
        }
        return { values, invalidKeys };
    }
    function scopeKey(scope) {
        if (!scope || !['accountId', 'game', 'groupId', 'language'].every(key => text(scope[key], 512))) return '';
        return JSON.stringify(SCOPE_KEYS.map(key => scope[key] ?? ''));
    }
    function validateCatalog(catalog) {
        if (!catalog || catalog.schemaVersion !== SCHEMA_VERSION || catalog.game !== 'poe2'
            || !text(catalog.revision, 128) || !/^\d{1,20}$/.test(catalog.clientBuild || '')
            || catalog.sdArchiveHash !== undefined && !hash(catalog.sdArchiveHash)) invalid('version or source identity');
        const ids = new Set();
        function reference(ref) {
            if (!ref || !SHEETS.has(ref.sheet) || !text(ref.recordId, 1024) || !text(ref.field, 128)
                || !hash(ref.sourceHash) || !text(ref.source) || State.sourceHash(ref.source) !== ref.sourceHash) invalid('field reference');
        }
        function lines(rows) {
            const ids = new Set();
            for (const line of list(rows, 64, 'stat lines')) {
                if (!line || !slug(line.id) || ids.has(line.id) || !text(line.filepath, 1024) || /[\\\x00-\x1f]/.test(line.filepath)
                    || line.filepath.startsWith('/') || line.filepath.split('/').some(part => !part || part === '.' || part === '..')
                    || !Number.isSafeInteger(line.entryIndex) || line.entryIndex < 0 || line.entryIndex > 10000
                    || !hash(line.sourceHash) || !list(line.stats, 32, 'stat identities').length || line.stats.some(stat => !text(stat, 256))) invalid('stat reference');
                ids.add(line.id);
            }
        }
        for (const card of list(catalog.cards, 1024, 'cards')) {
            if (!card || !slug(card.id) || ids.has(card.id) || !text(card.activeSkillId, 1024) || !text(card.baseItemId, 1024)) invalid('card identity');
            ids.add(card.id);
            reference(card.title); reference(card.itemTitle); reference(card.description);
            if (card.title.sheet !== 'ActiveSkills' || card.title.recordId !== card.activeSkillId
                || card.description.sheet !== 'ActiveSkills' || card.description.recordId !== card.activeSkillId
                || card.itemTitle.sheet !== 'BaseItemTypes' || card.itemTitle.recordId !== card.baseItemId) invalid('primary relationship');
            for (const tag of list(card.tags, 32, 'tags')) {
                if (!['type', 'tag'].includes(tag?.position)) invalid('tag position');
                reference(tag.ref);
            }
            const tabIds = new Set();
            for (const tab of list(card.tabs, 16, 'tabs')) {
                if (!slug(tab?.id) || tabIds.has(tab.id)) invalid('tab identity');
                tabIds.add(tab.id); reference(tab.label); lines(tab.lines);
            }
            lines(card.qualityLines || []);
            for (const ref of [card.shortDescription, card.qualityLabel, card.footer].filter(Boolean)) reference(ref);
            if (card.examples) for (const name of ['level', 'quality', 'cost', 'criticalChance', 'costFormat']) reference(card.examples[name]);
            if (card.assets && (!slug(card.assets.id) || ['icon', 'gem', 'background'].some(key => own(card.assets, key) && typeof card.assets[key] !== 'boolean'))) invalid('assets');
        }
        return catalog;
    }
    function createResolver(catalogInput, units, scope) {
        const catalog = copy(validateCatalog(catalogInput));
        const context = Object.fromEntries(SCOPE_KEYS.map(key => [key, scope?.[key] ?? '']));
        const capturedScope = scopeKey(context), game = context.game;
        const unitIndex = new Map(), related = new Map(), cards = new Map(), referenceIndex = new Map();
        for (const unit of units || []) {
            if (unit?.role !== 'normal' || !SHEETS.has(unit.sheet)) continue;
            const key = identity(unit);
            unitIndex.set(key, unitIndex.has(key) ? null : unit);
        }
        for (const card of catalog.cards) {
            cards.set(card.id, card);
            for (const ref of refs(card)) {
                const key = JSON.stringify([ref.sheet, ref.recordId, ref.field]), previous = referenceIndex.get(key);
                referenceIndex.set(key, referenceIndex.has(key) && previous?.sourceHash !== ref.sourceHash ? null : ref);
            }
            for (const key of new Set(refs(card).map(identity))) {
                if (!related.has(key)) related.set(key, []);
                related.get(key).push(card.id);
            }
        }
        function candidates(unit) {
            if (!capturedScope || catalog.game !== game || unit?.role !== 'normal') return [];
            return [...(related.get(identity(unit)) || [])].sort();
        }
        function lookup(ref) {
            const key = identity(ref), unit = unitIndex.get(key);
            if (unitIndex.has(key) && !unit) return { status: 'ambiguous', unit: null };
            if (!unit) return { status: 'unavailable', unit: null };
            const fields = unit.fields.filter(field => field.name === ref.field && field.kind === 'text');
            if (fields.length > 1) return { status: 'ambiguous', unit };
            if (!fields.length) return { status: 'unavailable', unit };
            const field = fields[0];
            return { status: State.sourceHash(field.source) === ref.sourceHash ? 'matched' : 'mismatch', unit, field };
        }
        function compose(options = {}) {
            const unavailable = (reason, extra = {}) => ({ state: 'unavailable', reason, ...extra });
            if (!capturedScope || scopeKey(options.scope) !== capturedScope) return unavailable('scope-changed');
            if (catalog.game !== game) return unavailable('game-mismatch');
            const unit = options.unit, choices = candidates(unit);
            if (!choices.length) return unavailable('unmapped');
            if (!options.cardId && choices.length > 1) return unavailable('choose-related-skill', { candidates: choices });
            const card = cards.get(options.cardId || choices[0]);
            if (!card || !choices.includes(card.id)) return unavailable('unmapped');
            const primary = [card.title, card.itemTitle, card.description].map(lookup);
            if (primary.some(result => result.status === 'mismatch')) return unavailable('source-mismatch');
            if (primary.some(result => result.status === 'ambiguous')) return unavailable('ambiguous-source');
            const selected = refs(card).filter(ref => identity(ref) === identity(unit)).map(lookup);
            if (!selected.some(result => result.status === 'matched')) return unavailable(selected.some(result => result.status === 'mismatch') ? 'source-mismatch' : 'unverified-source');
            const warnings = new Set(), cache = new Map();
            const draft = options.draft && scopeKey(options.draft.scope) === capturedScope ? options.draft : null;
            function field(ref) {
                if (!ref) return null;
                const key = JSON.stringify([ref.sheet, ref.recordId, ref.field]);
                if (cache.has(key)) return cache.get(key);
                const match = lookup(ref), valid = match.status === 'matched', missing = match.status === 'unavailable';
                if (!valid) warnings.add(missing ? 'partial-workbook' : 'reference-source-mismatch');
                let target = '';
                if (valid) {
                    const values = State.valuesFor(match.unit, options.saved?.[match.unit.id]);
                    target = String(values[match.field.id] ?? '');
                    const storedDraft = options.drafts?.[match.unit.id];
                    if (storedDraft?.unitId === match.unit.id && scopeKey(storedDraft.scope) === capturedScope && own(storedDraft.values, match.field.id))
                        target = String(storedDraft.values[match.field.id] ?? '');
                    if (draft?.unitId === match.unit.id && own(draft.values, match.field.id)) target = String(draft.values[match.field.id] ?? '');
                }
                const value = { source: valid ? match.field.source : missing ? ref.source : '', target,
                    status: match.status, translated: valid && !!target.trim(), origin: valid ? 'workbook' : missing ? 'client-catalog' : 'unavailable',
                    reference: { sheet: ref.sheet, recordId: ref.recordId, field: ref.field },
                    focused: valid && match.unit.id === unit.id && match.field.id === options.fieldId };
                cache.set(key, value); return value;
            }
            const sd = options.sd;
            const sdAllowed = sd && catalog.sdArchiveHash && sd.archiveHash === catalog.sdArchiveHash
                && sd.accountId === context.accountId && sd.game === game && sd.language === context.language;
            const sdIndex = new Map();
            if (sdAllowed) for (const file of sd.files || []) sdIndex.set(file.filepath, sdIndex.has(file.filepath) ? null : file);
            function stat(line) {
                if (!sdAllowed) { warnings.add('stat-source-unavailable'); return null; }
                const file = sdIndex.get(line.filepath), source = file?.translations?.English?.[line.entryIndex];
                if (!file || JSON.stringify(file.stats) !== JSON.stringify(line.stats) || typeof source !== 'string' || State.sourceHash(source) !== line.sourceHash) {
                    warnings.add('stat-source-mismatch'); return null;
                }
                // Keep raw placeholders. This module never invents combat values or evaluates game rules.
                const target = file.translations[context.language]?.[line.entryIndex];
                return { id: line.id, source, target: typeof target === 'string' ? target : '', translated: typeof target === 'string' && !!target.trim(),
                    filepath: line.filepath, entryIndex: line.entryIndex };
            }
            const skillTitle = field(card.title), title = unit.sheet === 'BaseItemTypes' ? field(card.itemTitle) : skillTitle;
            const description = field(card.description), shortDescription = field(card.shortDescription), footer = field(card.footer);
            const tags = card.tags.map(tag => ({ position: tag.position, value: field(tag.ref) }));
            const tabs = card.tabs.map(tab => ({ id: tab.id, label: field(tab.label), lines: tab.lines.map(stat).filter(Boolean) }));
            const qualityLines = (card.qualityLines || []).map(stat).filter(Boolean);
            const qualityLabel = qualityLines.length ? field(card.qualityLabel) : null;
            const examples = normalizeExamples(options.variables), exampleLabels = card.examples
                ? Object.fromEntries(Object.entries(card.examples).map(([name, ref]) => [name, field(ref)])) : null;
            const timing = Object.fromEntries(Object.entries(timingReferences(card)).map(([name, ref]) => [name, lookup(ref).status === 'matched' ? field(ref) : null]));
            const timeEnabled = !!(timing.label && timing.format || shortDescription && timing.shortLabel && timing.shortFormat);
            const variableKeys = EXAMPLE_VARIABLES.filter(variable => variable.name === 'time' ? timeEnabled : !!exampleLabels).map(variable => variable.key);
            function side(translated) {
                const value = entry => entry && ({ text: translated ? entry.target : entry.source,
                    available: translated ? entry.translated : !!entry.source, focused: entry.focused || false,
                    ...(entry.reference ? { reference: entry.reference, origin: entry.origin } : {}) });
                const properties = exampleLabels ? EXAMPLE_VARIABLES.filter(variable => variable.name !== 'time').map(variable => {
                    const raw = examples.values[variable.key], format = translated ? exampleLabels.costFormat.target : exampleLabels.costFormat.source;
                    const formatted = variable.name === 'quality' ? (Number(raw) >= 0 ? '+' : '') + raw + '%'
                        : variable.name === 'criticalChance' ? raw + '%' : variable.name === 'cost' ? format.replace(/\{0\}/g, raw) : raw;
                    return { key: variable.key, label: value(exampleLabels[variable.name]), text: formatted,
                        available: !!formatted && (!translated || exampleLabels[variable.name].translated), example: true };
                }) : [];
                function timeProperty(label, format) {
                    if (!label || !format || translated && (!label.translated || !format.translated)) return null;
                    return { key: 'skill-card:time', label: value(label),
                        text: (translated ? format.target : format.source).replace(/\{0\}/g, examples.values['skill-card:time']),
                        available: true, example: true };
                }
                const fullTime = timeProperty(timing.label, timing.format), shortTime = shortDescription && timeProperty(timing.shortLabel, timing.shortFormat);
                if (fullTime) properties.push(fullTime);
                const shortProperties = [...properties.filter(property => property.key === 'skill-card:cost'), ...(shortTime ? [shortTime] : [])];
                return { title: value(title), skillTitle: value(skillTitle), description: value(description), shortDescription: value(shortDescription), footer: value(footer), properties, shortProperties,
                    tags: tags.map(tag => ({ position: tag.position, ...value(tag.value) })),
                    tabs: tabs.map(tab => ({ id: tab.id, label: value(tab.label), lines: tab.lines.map(line => ({ id: line.id, ...value(line) })) })),
                    qualityLabel: value(qualityLabel), qualityLines: qualityLines.map(line => ({ id: line.id, ...value(line) })) };
            }
            return { state: warnings.size ? 'partial' : 'ready', skillId: card.id, revision: catalog.revision, clientBuild: catalog.clientBuild,
                source: side(false), target: side(true), warnings: [...warnings],
                variableKeys, exampleValues: examples.values, invalidExampleKeys: examples.invalidKeys.filter(key => variableKeys.includes(key)),
                assets: card.assets ? { ...card.assets, game: catalog.game } : null,
                compatibility: { matched: primary.filter(result => result.status === 'matched').length, total: primary.length } };
        }
        function resolveReference(reference, currentScope) {
            if (!reference || scopeKey(currentScope) !== capturedScope || !capturedScope) return null;
            const ref = referenceIndex.get(JSON.stringify([reference.sheet, reference.recordId, reference.field]));
            if (!ref) return null;
            const match = lookup(ref);
            return match.status === 'matched' ? { unit: match.unit, field: match.field } : null;
        }
        function referencedUnits(cardId) {
            const card = cards.get(cardId);
            return card ? [...new Set(refs(card).map(lookup).filter(match => match.status === 'matched').map(match => match.unit))] : [];
        }
        return { candidates, compose, resolveReference, referencedUnits };
    }
    return { SCHEMA_VERSION, EXAMPLE_VARIABLES, EXAMPLE_KEYS, exampleDefaults, defaultExampleValue, resetExamples, normalizeExamples, scopeKey, validateCatalog, createResolver };
});
