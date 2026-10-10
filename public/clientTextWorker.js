/* Workbook decompression, parsing and export stay off the editor thread. */
'use strict';
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'vendor/fast-xml-parser-5.11.2.min.js', 'clientTextState.js', 'clientTextCodec.js', 'clientTextTransport.js');
let queue = Promise.resolve();
const cancelled = new Set(), incoming = new Map();
self.onmessage = event => {
    let message = event.data;
    if (message?.type === 'cancel' && typeof message.id === 'string') { cancelled.add(message.id); incoming.delete(message.id); return; }
    if (message?.type === 'request-start') {
        if (!['buildManifest', 'exportWorkbook'].includes(message.operation) || typeof message.id !== 'string' || incoming.has(message.id)) return;
        incoming.set(message.id, { message, collector: self.ClientTextTransport.collector(message) }); return;
    }
    if (message?.type?.startsWith('stream-')) {
        const request = incoming.get(message.id); if (!request || cancelled.has(message.id)) return;
        try { request.collector.apply(message); }
        catch (error) { incoming.delete(message.id); self.postMessage({ type: 'error', id: message.id, error: { name: error.name, message: error.message, code: 'CLIENTTEXT_WORKER_STREAM_ERROR' } }); }
        return;
    }
    if (message?.type === 'request-end') {
        const request = incoming.get(message.id); incoming.delete(message.id);
        if (message.cancelled || cancelled.has(message.id)) { cancelled.delete(message.id); return; }
        if (!request) return;
        try { message = request.collector.finish(); }
        catch (error) { self.postMessage({ type: 'error', id: message.id, error: { name: error.name, message: error.message, code: 'CLIENTTEXT_WORKER_STREAM_ERROR' } }); return; }
        message.type = message.operation;
        if (message.type === 'exportWorkbook') { message.saved = Object.fromEntries(message.savedEntries); delete message.savedEntries; }
    }
    if (!['parseWorkbook', 'exportWorkbook', 'buildManifest'].includes(message?.type) || typeof message.id !== 'string') return;
    const operation = queue.then(async () => {
        const onProgress = value => { if (!cancelled.has(message.id)) self.postMessage({ type: 'progress', id: message.id, value }); };
        if (cancelled.has(message.id)) throw Object.assign(new Error('ClientText work was cancelled.'), { name: 'AbortError' });
        const options = { ...(message.options || {}), onProgress };
        const result = message.type === 'parseWorkbook'
            ? await self.ClientTextCodec.parseWorkbook(message.bytes, options)
            : message.type === 'buildManifest'
                ? await self.ClientTextState.buildManifest(message.units, message.assets, { onProgress, guard: () => !cancelled.has(message.id) })
                : await self.ClientTextCodec.exportWorkbook(message.bytes, message.parsed, message.saved, options);
        if (cancelled.has(message.id)) return;
        if (result.units && self.ClientTextTransport.shouldStream(result.units)) {
            const T = self.ClientTextTransport, manifest = message.type === 'buildManifest';
            self.postMessage({ type: 'result-start', id: message.id, result: manifest ? T.manifestHeader(result) : T.workbookHeader(result) });
            const post = (value, transfer) => self.postMessage(value, transfer), streamOptions = { guard: () => !cancelled.has(message.id) };
            await T.sendCollection(post, message.id, ['units'], result.units, { ...streamOptions, onChunk: (processed, unit) => onProgress({ phase: 'Preparing workbook data', processed, total: result.units.length, sheet: unit.sheet }) });
            if (manifest) for (const [role, tree] of Object.entries(result.trees)) {
                await T.sendCollection(post, message.id, ['trees', role, 'ids'], tree.ids, streamOptions);
                for (let index = 0; index < tree.levels.length; index++) await T.sendCollection(post, message.id, ['trees', role, 'levels', index], tree.levels[index], streamOptions);
            }
            if (!cancelled.has(message.id)) self.postMessage({ type: 'result', id: message.id });
        } else self.postMessage({ type: 'result', id: message.id, result }, result instanceof Uint8Array ? [result.buffer] : []);
    });
    queue = operation.catch(error => {
        if (!cancelled.has(message.id)) self.postMessage({ type: 'error', id: message.id,
            error: { name: error?.name || 'Error', message: error?.message || String(error), code: error?.code || 'CLIENTTEXT_WORKER_ERROR' } });
    }).finally(() => cancelled.delete(message.id));
};
self.postMessage({ type: 'ready', version: 1 });
