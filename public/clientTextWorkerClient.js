/* Request-scoped worker progress; disposal/abort cannot publish into a later workspace. */
(function (root, factory) {
    const api = factory(root, typeof module === 'object' && module.exports ? require('./clientTextTransport.js') : root.ClientTextTransport);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextWorkerClient = api;
})(typeof globalThis === 'object' ? globalThis : self, function (root, Transport) {
    'use strict';
    const abortError = () => Object.assign(new Error('ClientText work was cancelled.'), { name: 'AbortError', stale: true });
    // postMessage snapshots plain originals itself. Unwrap Vue proxies without
    // allocating another full workbook JSON string and object graph first.
    function plain(value) {
        if (!value || typeof value !== 'object') return value;
        const raw = root.Vue?.toRaw ? root.Vue.toRaw(value) : value;
        let output = raw;
        for (const key of Object.keys(raw)) {
            const before = raw[key], after = plain(before);
            if (before !== after) {
                if (output === raw) output = Array.isArray(raw) ? raw.slice() : { ...raw };
                output[key] = after;
            }
        }
        return output;
    }
    class Client {
        constructor({ Worker = root.Worker, url = 'clientTextWorker.js', readyTimeout = 10000 } = {}) {
            this.pending = new Map(); this.counter = 0; this.disposed = false; this.worker = null;
            this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
            // Fail explicitly when the worker is unavailable: large workbooks must not freeze the editor through a main-thread fallback.
            this.ready.catch(() => {});
            try {
                if (typeof Worker !== 'function') throw new Error('ClientText requires browser Web Worker support.');
                this.worker = new Worker(url);
                this.worker.onmessage = event => this.receive(event.data);
                this.worker.onerror = () => this.failed(new Error('The ClientText workbook worker stopped. Retry the operation.'));
                this.worker.onmessageerror = () => this.failed(new Error('The ClientText worker response could not be read.'));
                this.readyTimer = setTimeout(() => this.failed(new Error('The ClientText workbook worker could not start.')), readyTimeout);
            } catch (error) { this.failed(error); }
        }
        receive(message) {
            if (message?.type === 'ready' && message.version === 1) { clearTimeout(this.readyTimer); this.resolveReady(true); return; }
            const request = this.pending.get(message?.id);
            if (!request) return;
            if (message.type === 'progress') { request.onProgress?.(message.value); return; }
            if (message.type === 'result-start' || message.type?.startsWith('stream-')) {
                try {
                    if (message.type === 'result-start') { if (request.collector) throw new Error('ClientText worker result restarted.'); request.collector = Transport.collector(message.result); }
                    else { if (!request.collector) throw new Error('ClientText worker result has not started.'); request.collector.apply(message); }
                } catch (error) { this.pending.delete(message.id); request.cleanup(); this.worker?.postMessage({ type: 'cancel', id: message.id }); request.reject(error); }
                return;
            }
            if (!['result', 'error'].includes(message.type)) return;
            this.pending.delete(message.id); request.cleanup();
            if (message.type === 'result') {
                try { request.resolve(request.collector ? request.collector.finish() : message.result); }
                catch (error) { request.reject(error); }
            }
            else request.reject(Object.assign(new Error(message.error?.message || 'ClientText workbook operation failed.'), message.error || {}));
        }
        failed(error) {
            clearTimeout(this.readyTimer); this.rejectReady(error);
            for (const request of this.pending.values()) { request.cleanup(); request.reject(error); }
            this.pending.clear(); this.worker?.terminate(); this.worker = null;
        }
        async request(type, bytes, options = {}, extra = {}, collections) {
            if (this.disposed || options.signal?.aborted) throw abortError();
            await this.ready;
            if (this.disposed || options.signal?.aborted) throw abortError();
            if (!this.worker) throw new Error('The ClientText workbook worker is unavailable.');
            const id = 'clienttext-' + (++this.counter), signal = options.signal;
            const plainOptions = { filename: options.filename, role: options.role, language: options.language };
            return new Promise((resolve, reject) => {
                const abort = () => {
                    const request = this.pending.get(id);
                    if (!request) return;
                    this.pending.delete(id); request.cleanup(); this.worker?.postMessage({ type: 'cancel', id }); reject(abortError());
                };
                const cleanup = () => signal?.removeEventListener('abort', abort);
                this.pending.set(id, { resolve, reject, cleanup, onProgress: options.onProgress });
                signal?.addEventListener('abort', abort, { once: true });
                try {
                    // Transfer a private byte copy; retained originals must stay
                    // readable after parsing/export, including caller subviews.
                    const borrowed = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : ArrayBuffer.isView(bytes)
                        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
                    const inputBytes = borrowed ? borrowed.slice() : bytes, transfer = borrowed ? [inputBytes.buffer] : [];
                    if (!collections) this.worker.postMessage({ type, id, bytes: inputBytes, options: plainOptions, ...extra }, transfer);
                    else {
                        this.worker.postMessage({ type: 'request-start', operation: type, id, bytes: inputBytes, options: plainOptions, ...extra }, transfer);
                        (async () => {
                            try {
                                for (const collection of collections) await Transport.sendCollection((value, transfer) => this.worker.postMessage(value, transfer), id, collection.path, collection.values,
                                    { guard: () => !this.disposed && this.pending.has(id) && !signal?.aborted });
                                if (this.pending.has(id)) this.worker.postMessage({ type: 'request-end', id });
                            } catch (error) {
                                if (this.pending.has(id)) { this.pending.delete(id); cleanup(); this.worker?.postMessage({ type: 'cancel', id }); reject(error); }
                                this.worker?.postMessage({ type: 'request-end', id, cancelled: true });
                            }
                        })();
                    }
                }
                catch (error) { this.pending.delete(id); cleanup(); reject(error); }
            });
        }
        parseWorkbook(bytes, options) { return this.request('parseWorkbook', bytes, options); }
        buildManifest(units, assets = [], options) {
            const originals = Array.isArray(assets) ? assets : Object.entries(assets).map(([role, asset]) => ({ role, ...asset }));
            const detached = { units: [], assets: originals.map(asset => ({ role: asset.role, hash: asset.hash || asset.assetHash, ...(asset.schemaHash ? { schemaHash: asset.schemaHash } : {}) })) };
            if (!Transport.shouldStream(units)) { detached.units = plain(units); return this.request('buildManifest', undefined, options, detached); }
            return this.request('buildManifest', undefined, options, detached, [{ path: ['units'], values: units }]);
        }
        exportWorkbook(bytes, parsed, saved, options) {
            if (Transport.shouldStream(parsed.units || [])) {
                const entries = function* () { if (saved instanceof Map) yield* saved.entries(); else for (const key of Object.keys(saved || {})) yield [key, saved[key]]; };
                return this.request('exportWorkbook', bytes, options, { parsed: plain(Transport.workbookHeader(parsed)), savedEntries: [] },
                    [{ path: ['parsed', 'units'], values: parsed.units }, { path: ['savedEntries'], values: entries() }]);
            }
            const detached = { parsed: plain(parsed), saved: plain(saved instanceof Map ? Object.fromEntries(saved) : saved) };
            return this.request('exportWorkbook', bytes, options, detached);
        }
        dispose() { this.disposed = true; this.failed(abortError()); }
    }
    return { Client, create: options => new Client(options) };
});
