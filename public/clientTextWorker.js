/* Workbook decompression, parsing and export stay off the editor thread. */
'use strict';
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'vendor/fast-xml-parser-5.11.2.min.js', 'clientTextState.js', 'clientTextCodec.js');
let queue = Promise.resolve();
const cancelled = new Set();
self.onmessage = event => {
    const message = event.data;
    if (message?.type === 'cancel' && typeof message.id === 'string') { cancelled.add(message.id); return; }
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
        self.postMessage({ type: 'result', id: message.id, result }, result instanceof Uint8Array ? [result.buffer] : []);
    });
    queue = operation.catch(error => {
        if (!cancelled.has(message.id)) self.postMessage({ type: 'error', id: message.id,
            error: { name: error?.name || 'Error', message: error?.message || String(error), code: error?.code || 'CLIENTTEXT_WORKER_ERROR' } });
    }).finally(() => cancelled.delete(message.id));
};
self.postMessage({ type: 'ready', version: 1 });
