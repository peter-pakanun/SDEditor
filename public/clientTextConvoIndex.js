/* Conversation families derived from immutable workbook IDs, without speaker or playback claims. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextConvoIndex = api;
})(typeof globalThis === 'object' ? globalThis : self, function () {
    'use strict';
    // Lowercase turns must be numbered; bare lowercase letters remain branch qualifiers.
    const TURN = /^(?:[A-Z](?:\d+[a-z]?)?|[a-z]\d+[a-z]?)(?:=.+)?$/;
    const CLASS = /^(?:Str|Int|Dex|StrDex|DexInt|StrInt)4b?$/;
    const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    const alphabetical = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }) || compare(a, b);
    function tokens(value) {
        const text = String(value ?? '').normalize('NFKC')
            .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
            .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
        return (text.match(/\p{L}+|\p{N}+/gu) || []).map(part => part.toLowerCase());
    }
    function sourceField(unit, name) { return clean(unit.fields?.find(field => field.name === name)?.source); }
    function terminal(path) { return String(path ?? '').split('/').filter(Boolean).pop() || ''; }
    function conversation(unit) {
        return typeof unit?.sheet === 'string' && unit.sheet.replace(/_Gender$/, '') === 'NPCTalkDialogueTextAudio';
    }
    function familyForId(id) {
        const parts = String(id ?? '').split('_'), marker = parts.findIndex((part, index) => index >= 2 && TURN.test(part));
        let end = marker;
        if (marker >= 0) while (end > 1 && CLASS.test(parts[end - 1])) end--;
        return { stem: marker < 0 ? String(id ?? '') : parts.slice(0, end).join('_'),
            anchor: parts[0], turn: marker < 0 ? '' : parts[marker] };
    }

    async function buildConvoIndex(input, npcIndex, options = {}) {
        if (!Array.isArray(input) || !Array.isArray(npcIndex?.groups)) throw new TypeError('ClientText conversations require workbook units and an NPC index.');
        const pause = options.yield || (() => new Promise(resolve => setTimeout(resolve, 0)));
        const now = options.now || (() => typeof performance === 'object' ? performance.now() : Date.now());
        let processed = 0, lastYield = now();
        function check() {
            if (options.signal?.aborted || options.guard && !options.guard()) {
                throw Object.assign(new Error('ClientText conversation preparation context changed.'), { name: 'AbortError', stale: true });
            }
        }
        async function checkpoint() { check(); await pause(); check(); lastYield = now(); }
        function shouldYield() {
            if (++processed % 128) return false;
            check(); return now() - lastYield >= 8;
        }
        await checkpoint();
        const units = [], seen = new Set(), memberships = new Map(), familyByKey = new Map(), sourceParents = new Map(),
            pathGroups = new Map(), familyHints = new Map(), familyMatches = new Map();
        const parentByKey = new Map([['unassigned', { key: 'unassigned', label: 'Unassigned NPC', paths: [], npcUnits: [], families: [], units: [] }]]);
        const aliasRoot = { next: new Map(), record: null }, anchorCache = new Map();
        for (const unit of input) {
            if (conversation(unit) && typeof unit.id === 'string' && unit.id && !seen.has(unit.id)) {
                seen.add(unit.id); units.push(unit);
            }
            if (shouldYield()) await checkpoint();
        }
        function addAlias(key, type, value, article = false) {
            const label = clean(value), parts = tokens(label);
            if (!parts.length) return;
            let node = aliasRoot;
            for (const part of parts) {
                if (!node.next.has(part)) node.next.set(part, { next: new Map(), record: null });
                node = node.next.get(part);
            }
            if (!node.record) node.record = { name: new Map(), short: new Map(), path: new Map() };
            const owners = node.record[type];
            if (!owners.has(key)) owners.set(key, new Set());
            owners.get(key).add(label);
            if (article && /^the\s+/iu.test(label)) addAlias(key, type, label.replace(/^the\s+/iu, ''));
        }
        for (const group of npcIndex.groups) {
            sourceParents.set(group.key, group);
            for (const unit of group.npcUnits) {
                if (!pathGroups.has(unit.recordId)) pathGroups.set(unit.recordId, new Set());
                pathGroups.get(unit.recordId).add(group.key);
                addAlias(group.key, 'path', terminal(unit.recordId));
                if (!unit.recordId.startsWith('Metadata/NPC/Info/')) {
                    addAlias(group.key, 'name', sourceField(unit, 'Name'), true);
                    addAlias(group.key, 'short', sourceField(unit, 'Short Name'), true);
                }
                if (shouldYield()) await checkpoint();
            }
        }
        function anchorFor(anchor) {
            if (anchorCache.has(anchor)) return anchorCache.get(anchor);
            let node = aliasRoot, longest = null;
            for (const part of tokens(anchor)) {
                node = node.next.get(part);
                if (!node) break;
                if (node.record) longest = node.record;
            }
            const result = { parentKey: 'unassigned', aliases: [], aliasType: '', ambiguous: false };
            if (longest) for (const type of ['name', 'short', 'path']) {
                const owners = longest[type];
                if (!owners.size) continue;
                result.aliasType = type;
                result.aliases = [...new Set([...owners.values()].flatMap(labels => [...labels]))].sort(alphabetical);
                result.ambiguous = owners.size > 1;
                if (!result.ambiguous) result.parentKey = owners.keys().next().value;
                break;
            }
            anchorCache.set(anchor, result); return result;
        }
        function parentFor(key) {
            if (!parentByKey.has(key)) {
                const source = sourceParents.get(key);
                parentByKey.set(key, { key, label: source.label, paths: source.paths.slice(), npcUnits: source.npcUnits.slice(), families: [], units: [] });
            }
            return parentByKey.get(key);
        }
        // Collect the complete family before choosing its parent. Row order,
        // player turns and repeated grammatical variants cannot vote for an NPC.
        for (const unit of units) {
            const parsed = familyForId(unit.recordId);
            let family = familyByKey.get(parsed.stem);
            if (!family) {
                family = { key: parsed.stem, stem: parsed.stem, anchor: parsed.anchor,
                    label: parsed.stem, parentKey: 'unassigned', units: [] };
                familyByKey.set(family.key, family);
            }
            family.units.push(unit);
            memberships.set(unit.id, { familyKey: family.key, anchor: parsed.anchor, turn: parsed.turn });
            if (own(unit.metadata, 'NPC')) {
                if (!familyHints.has(family.key)) familyHints.set(family.key, { references: new Set(), groups: new Map(), unresolved: new Set(), ambiguous: new Set() });
                const hints = familyHints.get(family.key), references = npcIndex.referenceEvidence?.get(unit.id)?.references
                    || (typeof unit.metadata.NPC === 'string' ? unit.metadata.NPC : '').split(/[,\r\n]+/u).map(value => value.trim()).filter(Boolean);
                for (const reference of references) {
                    hints.references.add(reference);
                    const owners = pathGroups.get(reference);
                    if (!owners?.size) hints.unresolved.add(reference);
                    else if (owners.size !== 1) hints.ambiguous.add(reference);
                    else {
                        const key = owners.values().next().value;
                        if (!hints.groups.has(key)) hints.groups.set(key, new Set());
                        hints.groups.get(key).add(reference);
                    }
                    if (shouldYield()) await checkpoint();
                }
            }
            if (shouldYield()) await checkpoint();
        }
        for (const family of familyByKey.values()) {
            const idMatch = anchorFor(family.anchor), hints = familyHints.get(family.key);
            let match = idMatch;
            if (hints) {
                const participants = [...hints.groups].map(([key, references]) => ({ key, label: sourceParents.get(key).label, references: [...references].sort(alphabetical) }))
                    .sort((a, b) => alphabetical(a.label, b.label) || compare(a.key, b.key));
                const evidence = { reason: 'no-npc', references: [...hints.references].sort(alphabetical), participants,
                    unresolved: [...hints.unresolved].sort(alphabetical), ambiguous: [...hints.ambiguous].sort(alphabetical) };
                match = { parentKey: 'unassigned', aliases: [], aliasType: '', ambiguous: hints.ambiguous.size > 0 };
                if (hints.unresolved.size || hints.ambiguous.size) evidence.reason = 'unresolved-references';
                else if (participants.length === 1) {
                    evidence.reason = 'npc'; match.parentKey = participants[0].key;
                } else if (participants.length > 1) {
                    evidence.reason = 'multiple-npcs'; match.ambiguous = true;
                    // ID evidence breaks a tie only among explicitly referenced
                    // participants, never by narrowing an ambiguous ID alias.
                    if (!idMatch.ambiguous && hints.groups.has(idMatch.parentKey)) {
                        evidence.reason = 'npc-anchor'; match = idMatch;
                    }
                }
                family.npcEvidence = evidence;
            }
            familyMatches.set(family.key, match);
            const parent = parentFor(match.parentKey), separator = family.stem.indexOf('_');
            family.parentKey = parent.key;
            family.label = parent.key === 'unassigned' || separator < 0 ? family.stem : family.stem.slice(separator + 1);
            parent.families.push(family);
            if (shouldYield()) await checkpoint();
        }
        // Retain workbook order even when families are interleaved in a sheet.
        for (const unit of units) {
            const row = memberships.get(unit.id), family = familyByKey.get(row.familyKey), match = familyMatches.get(family.key);
            parentByKey.get(family.parentKey).units.push(unit);
            memberships.set(unit.id, { parentKey: family.parentKey, ...row, aliases: match.aliases.slice(), aliasType: match.aliasType,
                ambiguous: match.ambiguous, ...(family.npcEvidence ? { npcEvidence: family.npcEvidence } : {}) });
            if (shouldYield()) await checkpoint();
        }
        const unassigned = parentByKey.get('unassigned'), parents = [unassigned, ...[...parentByKey.values()]
            .filter(parent => parent !== unassigned).sort((a, b) => alphabetical(a.label, b.label) || compare(a.key, b.key))];
        for (const parent of parents) parent.families.sort((a, b) => alphabetical(a.label, b.label)
            || alphabetical(a.anchor, b.anchor) || compare(a.key, b.key));
        const families = parents.flatMap(parent => parent.families);
        check();
        return { parents, parentByKey: new Map(parents.map(parent => [parent.key, parent])), families,
            familyByKey: new Map(families.map(family => [family.key, family])), memberships, units };
    }
    return { familyForId, buildConvoIndex };
});
