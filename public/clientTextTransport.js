/* Bounded ClientText worker messages. Public workbook/manifest shapes stay unchanged. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextTransport = api;
})(typeof globalThis === 'object' ? globalThis : self, function (root) {
    'use strict';
    const MAX_BYTES = 2 * 1024 * 1024, MAX_RECORDS = 512, MAX_SCALARS = 8192;
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    const abort = () => Object.assign(new Error('ClientText work was cancelled.'), { name: 'AbortError', stale: true });
    function check(guard) { if (guard && !guard()) throw abort(); }
    // Estimate an upper bound for ordinary clone data while unwrapping only the
    // current batch. Plain originals retain their references until postMessage.
    function snapshot(value) {
        if (value === null || value === undefined) return { value, bytes: 8 };
        if (typeof value === 'string') return { value, bytes: value.length * 2 + 16 };
        if (typeof value !== 'object') return { value, bytes: 16 };
        const raw = root.Vue?.toRaw ? root.Vue.toRaw(value) : value;
        let output = raw, bytes = 24;
        for (const key of Object.keys(raw)) {
            const before = raw[key], after = snapshot(before);
            bytes += key.length * 2 + 16 + after.bytes;
            if (before !== after.value) {
                if (output === raw) output = Array.isArray(raw) ? raw.slice() : { ...raw };
                output[key] = after.value;
            }
        }
        return { value: output, bytes };
    }
    function* batches(values) {
        let chunk = [], bytes = 0, start = 0;
        for (const value of values) {
            const current = snapshot(value), limit = typeof current.value === 'object' ? MAX_RECORDS : MAX_SCALARS;
            if (chunk.length && (bytes + current.bytes > MAX_BYTES || chunk.length >= limit)) {
                yield { start, values: chunk, bytes }; start += chunk.length; chunk = []; bytes = 0;
            }
            chunk.push(current.value); bytes += current.bytes;
            if (current.bytes > MAX_BYTES) { yield { start, values: chunk, bytes }; start += chunk.length; chunk = []; bytes = 0; }
        }
        if (chunk.length) yield { start, values: chunk, bytes };
    }
    function shouldStream(values) {
        if (values.length > MAX_RECORDS) return true;
        let bytes = 0;
        for (const value of values) { bytes += snapshot(value).bytes; if (bytes > MAX_BYTES) return true; }
        return false;
    }
    async function sendCollection(post, id, path, values, options = {}) {
        for (const batch of batches(values)) {
            check(options.guard);
            if (batch.bytes > MAX_BYTES) {
                // A single unusually large row is fragmented separately; never
                // stringify a workbook or complete manifest to split its data.
                const bytes = new TextEncoder().encode(JSON.stringify(batch.values[0]));
                post({ type: 'stream-fragment-start', id, path, start: batch.start, byteLength: bytes.byteLength });
                for (let offset = 0; offset < bytes.length; offset += MAX_BYTES) {
                    check(options.guard);
                    const fragment = bytes.slice(offset, Math.min(bytes.length, offset + MAX_BYTES));
                    post({ type: 'stream-fragment', id, bytes: fragment }, [fragment.buffer]);
                    await (options.pause || pause)();
                }
                post({ type: 'stream-fragment-end', id });
            } else post({ type: 'stream-chunk', id, path, start: batch.start, values: batch.values });
            options.onChunk?.(batch.start + batch.values.length, batch.values.at(-1));
            await (options.pause || pause)();
        }
        check(options.guard);
    }
    function append(result, path, start, values) {
        if (!Array.isArray(path) || !path.length || path.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Invalid ClientText worker collection path.');
        let target = result;
        for (const key of path) {
            if (!target || !Object.prototype.hasOwnProperty.call(target, key)) throw new Error('Unknown ClientText worker collection path.');
            target = target[key];
        }
        if (!Array.isArray(target) || start !== target.length || !Array.isArray(values)) throw new Error('ClientText worker chunks are out of order.');
        for (const value of values) target.push(value);
    }
    function collector(result) {
        let fragment = null;
        return { result, apply(message) {
            if (message.type === 'stream-chunk') {
                if (fragment) throw new Error('An unfinished ClientText worker row was interrupted.');
                append(result, message.path, message.start, message.values); return;
            }
            if (message.type === 'stream-fragment-start') {
                if (fragment || !Number.isSafeInteger(message.byteLength) || message.byteLength < 0) throw new Error('Invalid ClientText worker row fragment.');
                fragment = { path: message.path, start: message.start, bytes: new Uint8Array(message.byteLength), received: 0 }; return;
            }
            if (message.type === 'stream-fragment') {
                if (!fragment || !(message.bytes instanceof Uint8Array) || fragment.received + message.bytes.length > fragment.bytes.length) throw new Error('Invalid ClientText worker row fragment.');
                fragment.bytes.set(message.bytes, fragment.received); fragment.received += message.bytes.length; return;
            }
            if (message.type === 'stream-fragment-end') {
                if (!fragment || fragment.received !== fragment.bytes.length) throw new Error('ClientText worker row fragment is incomplete.');
                append(result, fragment.path, fragment.start, [JSON.parse(new TextDecoder().decode(fragment.bytes))]); fragment = null; return;
            }
            throw new Error('Unknown ClientText worker chunk.');
        }, finish() { if (fragment) throw new Error('ClientText worker row fragment is incomplete.'); return result; } };
    }
    function workbookHeader(parsed) { return { ...parsed, units: [] }; }
    function manifestHeader(manifest) {
        return { ...manifest, units: [], trees: Object.fromEntries(Object.entries(manifest.trees || {}).map(([role, tree]) => [role,
            { ...tree, ids: [], levels: tree.levels.map(() => []) }])) };
    }
    return { MAX_BYTES, MAX_RECORDS, MAX_SCALARS, snapshot, batches, shouldStream, sendCollection, collector, workbookHeader, manifestHeader, check, abort };
});
