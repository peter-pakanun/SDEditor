/* One history entry can restore every cell addressed by an explicit paste. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextUndo = api;
})(typeof globalThis === 'object' ? globalThis : self, function () {
    'use strict';

    function canonical(value) {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
        }
        return value;
    }

    function create(options = {}) {
        const key = options.key || (value => JSON.stringify(canonical(value)));
        const limit = options.limit || 100;
        const maxBytes = options.maxBytes || 8 * 1024 * 1024;
        let entries = [], position = 0, bytes = 0;
        const detach = value => JSON.parse(JSON.stringify(value));
        function reset() { entries = []; position = 0; bytes = 0; }
        /** @param {string|null} [group] */
        function record(before, after, group = null) {
            const beforeKey = key(before), afterKey = key(after);
            if (beforeKey === afterKey) return false;
            const discarded = entries.splice(position);
            for (const entry of discarded) bytes -= entry.bytes;
            const last = entries.at(-1);
            if (last && last.afterKey !== beforeKey) reset();
            const previous = entries.at(-1);
            const first = group && previous?.group === group ? previous.before : before;
            if (group && previous?.group === group) { entries.pop(); bytes -= previous.bytes; }
            const entry = { before: detach(first), after: detach(after), beforeKey: key(first), afterKey, group };
            if (entry.beforeKey === entry.afterKey) { position = entries.length; return true; }
            entry.bytes = 2 * (JSON.stringify(entry.before).length + JSON.stringify(entry.after).length);
            entries.push(entry); bytes += entry.bytes;
            while (entries.length > 1 && (entries.length > limit || bytes > maxBytes)) bytes -= entries.shift().bytes;
            position = entries.length;
            return true;
        }
        function canUndo(current) { return position > 0 && entries[position - 1].afterKey === key(current); }
        function canRedo(current) { return position < entries.length && entries[position].beforeKey === key(current); }
        function undo(current) {
            if (!canUndo(current)) return null;
            return detach(entries[--position].before);
        }
        function redo(current) {
            if (!canRedo(current)) return null;
            return detach(entries[position++].after);
        }
        // Once a subgroup has a durable receipt, undo may only touch the uncommitted cells.
        function project(transform) {
            const kept = [];
            let cursor = 0;
            bytes = 0;
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i], before = transform(detach(entry.before)), after = transform(detach(entry.after));
                const beforeKey = key(before), afterKey = key(after);
                if (beforeKey === afterKey) continue;
                const size = 2 * (JSON.stringify(before).length + JSON.stringify(after).length);
                kept.push({ before, after, beforeKey, afterKey, group: entry.group, bytes: size });
                if (i < position) cursor++;
                bytes += size;
            }
            entries = kept;
            position = cursor;
        }
        return { record, undo, redo, canUndo, canRedo, reset, project };
    }

    return { create };
});
