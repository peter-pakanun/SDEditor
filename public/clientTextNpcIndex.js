/* Derived NPC browsing context. Original workbook units and identities stay unchanged. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextNpcIndex = api;
})(typeof globalThis === 'object' ? globalThis : self, function () {
    'use strict';
    const KINDS = Object.freeze({ NPCs: 'names', NPCTalk: 'topics', NPCTextAudio: 'dialogue', NPCTalkDialogueTextAudio: 'conversations' });
    const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
    const normalized = value => clean(value).toLowerCase();
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    const alphabetical = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }) || compare(a, b);

    function kindFor(unit) {
        const sheet = typeof unit?.sheet === 'string' ? unit.sheet.replace(/_Gender$/, '') : '';
        return Object.prototype.hasOwnProperty.call(KINDS, sheet) ? KINDS[sheet] : null;
    }
    function tokens(value) {
        // Boundaries retain facts from the ID: Una matches UnaRenly, not Unarmed or Tribunal.
        const text = String(value ?? '').normalize('NFKC')
            .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
            .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
        return (text.match(/\p{L}+|\p{N}+/gu) || []).map(part => part.toLowerCase());
    }
    function sourceField(unit, name) {
        return clean(unit.fields?.find(field => field.name === name)?.source);
    }
    function terminal(path) { return String(path ?? '').split('/').filter(Boolean).pop() || ''; }
    const overlaps = (a, b) => a.start < b.end && b.start < a.end;

    async function buildNpcIndex(input, options = {}) {
        if (!Array.isArray(input)) throw new TypeError('ClientText NPC indexing requires workbook units.');
        const pause = options.yield || (() => new Promise(resolve => setTimeout(resolve, 0)));
        const now = options.now || (() => typeof performance === 'object' ? performance.now() : Date.now());
        let processed = 0, lastYield = now();
        function check() {
            if (options.signal?.aborted || options.guard && !options.guard()) {
                throw Object.assign(new Error('ClientText NPC preparation context changed.'), { name: 'AbortError', stale: true });
            }
        }
        async function checkpoint() { check(); await pause(); check(); lastYield = now(); }
        function shouldYield() {
            if (++processed % 128) return false;
            check();
            return now() - lastYield >= 8;
        }
        // Small inputs also yield once, while large inputs yield for elapsed
        // CPU time instead of paying a timer delay at every fixed row batch.
        await checkpoint();
        const units = [], seen = new Set(), memberships = new Map(), referenceEvidence = new Map(), groupByKey = new Map(), pathGroups = new Map();
        const aliasRoot = { next: new Map(), record: null };
        for (const unit of input) {
            if (kindFor(unit) && typeof unit.id === 'string' && unit.id && !seen.has(unit.id)) {
                seen.add(unit.id); units.push(unit); memberships.set(unit.id, new Map());
            }
            if (shouldYield()) await checkpoint();
        }
        function member(unit, key, kind, aliases = [], references) {
            const rows = memberships.get(unit.id), existing = rows.get(key);
            if (existing) {
                existing.aliases = [...new Set([...existing.aliases, ...aliases])].sort(alphabetical);
                if (references) existing.references = [...new Set([...(existing.references || []), ...references])].sort(alphabetical);
            } else rows.set(key, { kind, aliases: [...new Set(aliases)].sort(alphabetical),
                ...(references ? { references: [...new Set(references)].sort(alphabetical) } : {}) });
        }
        function addAlias(key, value, allowArticle = false) {
            const label = clean(value), parts = tokens(label);
            if (!parts.length) return;
            let node = aliasRoot;
            for (const part of parts) {
                if (!node.next.has(part)) node.next.set(part, { next: new Map(), record: null });
                node = node.next.get(part);
            }
            if (!node.record) node.record = { owners: new Map() };
            if (!node.record.owners.has(key)) node.record.owners.set(key, new Set());
            node.record.owners.get(key).add(label);
            if (allowArticle && parts[0] === 'the' && parts.length > 1) addAlias(key, label.replace(/^the\s+/iu, ''));
        }
        for (const unit of units) {
            if (kindFor(unit) === 'names') {
                const name = sourceField(unit, 'Name'), shortName = sourceField(unit, 'Short Name');
                const information = unit.recordId.startsWith('Metadata/NPC/Info/'), byPath = !name || information;
                const key = JSON.stringify([byPath ? 'path' : 'name', byPath ? unit.recordId : normalized(name)]);
                const label = name || shortName || terminal(unit.recordId) || unit.recordId;
                let group = groupByKey.get(key);
                if (!group) {
                    group = { key, label, paths: [], npcUnits: [], units: [] };
                    groupByKey.set(key, group);
                } else if (alphabetical(label, group.label) < 0) group.label = label;
                if (!group.paths.includes(unit.recordId)) group.paths.push(unit.recordId);
                group.npcUnits.push(unit); member(unit, key, 'names');
                if (!pathGroups.has(unit.recordId)) pathGroups.set(unit.recordId, new Set());
                pathGroups.get(unit.recordId).add(key);
                addAlias(key, terminal(unit.recordId));
                // Generic Info labels do not identify a shared NPC. An unnamed
                // row can still have a useful Short Name without merging paths.
                if (!information) { addAlias(key, name, true); addAlias(key, shortName, true); }
            }
            if (shouldYield()) await checkpoint();
        }
        for (const unit of units) {
            const kind = kindFor(unit);
            if (kind !== 'names' && own(unit.metadata, 'NPC')) {
                // The column is authoritative even when blank (for example a
                // player turn). Missing NPC records never become ID guesses.
                const references = [...new Set((typeof unit.metadata.NPC === 'string' ? unit.metadata.NPC : '')
                    .split(/[,\r\n]+/u).map(value => value.trim()).filter(Boolean))].sort(alphabetical);
                const evidence = { references, unresolved: [], ambiguous: [] };
                referenceEvidence.set(unit.id, evidence);
                for (const reference of references) {
                    const owners = pathGroups.get(reference);
                    if (!owners?.size) evidence.unresolved.push(reference);
                    else if (owners.size !== 1) evidence.ambiguous.push(reference);
                    else member(unit, owners.values().next().value, kind, [], [reference]);
                    if (shouldYield()) await checkpoint();
                }
            } else if (kind === 'topics') {
                const parent = /^(.+)::\d+$/.exec(unit.recordId)?.[1];
                for (const key of pathGroups.get(parent) || []) member(unit, key, kind);
            } else if (kind === 'dialogue' || kind === 'conversations') {
                const parts = tokens(unit.recordId), matches = [];
                for (let start = 0; start < parts.length; start++) {
                    let node = aliasRoot;
                    for (let end = start; end < parts.length; end++) {
                        node = node.next.get(parts[end]);
                        if (!node) break;
                        if (node.record) matches.push({ start, end: end + 1, record: node.record });
                    }
                }
                // Resolve specificity before ownership. An ambiguous longer alias must
                // never fall back to a shorter name that happens to be unique.
                const longest = matches.filter(match => !matches.some(other => overlaps(match, other)
                    && other.end - other.start > match.end - match.start));
                for (const match of longest) {
                    if (match.record.owners.size !== 1) continue;
                    const [key, aliases] = match.record.owners.entries().next().value;
                    const competing = longest.some(other => other !== match && overlaps(match, other)
                        && [...other.record.owners.keys()].some(owner => owner !== key));
                    if (!competing) member(unit, key, kind, [...aliases]);
                }
            }
            if (shouldYield()) await checkpoint();
        }
        const unassigned = [];
        for (const unit of units) {
            const rows = memberships.get(unit.id), kind = kindFor(unit);
            for (const key of rows.keys()) groupByKey.get(key).units.push(unit);
            if ((kind === 'dialogue' || kind === 'conversations') && !rows.size) unassigned.push(unit);
            if (shouldYield()) await checkpoint();
        }
        const groups = [...groupByKey.values()], labels = new Map();
        for (const group of groups) group.paths.sort(alphabetical);
        for (const group of groups) {
            const label = normalized(group.label);
            if (!labels.has(label)) labels.set(label, []);
            labels.get(label).push(group);
        }
        // Name labels are shared by generic objects and unnamed records. Give
        // every such group the shortest path suffix that distinguishes it.
        for (const peers of labels.values()) if (peers.length > 1) {
            for (const group of peers) {
                const parts = group.paths[0].split('/');
                let suffix = parts[parts.length - 1];
                for (let length = 1; length <= parts.length; length++) {
                    suffix = parts.slice(-length).join('/');
                    if (!peers.some(other => other !== group && other.paths.some(path =>
                        normalized(path.split('/').slice(-length).join('/')) === normalized(suffix)))) break;
                }
                group.label += ' — ' + suffix;
            }
        }
        groups.sort((a, b) => alphabetical(a.label, b.label) || compare(a.key, b.key));
        check();
        return { groups, groupByKey: new Map(groups.map(group => [group.key, group])), units, unassigned, memberships, referenceEvidence };
    }
    return { kindFor, buildNpcIndex };
});
