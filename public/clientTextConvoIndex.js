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
        const units = [], seen = new Set(), memberships = new Map(), familyByKey = new Map(), sourceParents = new Map();
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
        for (const unit of units) {
            const parsed = familyForId(unit.recordId), match = anchorFor(parsed.anchor), parent = parentFor(match.parentKey);
            let family = familyByKey.get(parsed.stem);
            if (!family) {
                const separator = parsed.stem.indexOf('_');
                family = { key: parsed.stem, stem: parsed.stem, anchor: parsed.anchor,
                    label: parent.key === 'unassigned' || separator < 0 ? parsed.stem : parsed.stem.slice(separator + 1),
                    parentKey: parent.key, units: [] };
                familyByKey.set(family.key, family); parent.families.push(family);
            }
            family.units.push(unit); parent.units.push(unit);
            memberships.set(unit.id, { parentKey: parent.key, familyKey: family.key, anchor: parsed.anchor,
                turn: parsed.turn, aliases: match.aliases.slice(), aliasType: match.aliasType, ambiguous: match.ambiguous });
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
