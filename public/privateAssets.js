/* Disposable private media. Credentials stay inside the injected authenticated request. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PrivateAssets = api;
})(typeof globalThis === 'object' ? globalThis : self, function (root) {
    'use strict';
    const LIMITS = Object.freeze({ image: 1024 * 1024, audio: 16 * 1024 * 1024, font: 1024 * 1024 });
    const TYPES = Object.freeze({ image: ['image/webp', 'image/png', 'image/jpeg', 'image/gif'], audio: ['audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave'], font: ['font/ttf', 'font/woff2'] });
    const failure = (message, code) => Object.assign(new Error(message), { code });
    const cancelled = () => Object.assign(failure('Private media request cancelled.', 'PRIVATE_ASSET_CANCELLED'), { name: 'AbortError' });
    function validPath(path, kind) {
        if (typeof path !== 'string' || path.length > 4096) return false;
        if (kind === 'font') return /^\/fonts\/(?:Fontin-(?:Regular|Bold|Italic|SmallCaps)\.woff2|FrizQuadrata(?:ITC|Std)\.woff2|Koruri-Regular\.woff2|Fontin-SmallCaps-tr-TR\.ttf|OptimusPrincepsSemiBold-tr-TR\.ttf)$/.test(path);
        if (kind === 'image') return /^\/portraits\/poe[12]\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp(?:\?v=\d+)?$/.test(path)
            || /^\/skill-assets\/poe[12]\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:icon|gem|background)$/.test(path);
        if (kind !== 'audio' || !path.startsWith('/audio/poe2db?path=')) return false;
        try {
            const encoded = path.slice('/audio/poe2db?path='.length), value = decodeURIComponent(encoded);
            return encoded === encodeURIComponent(value) && value.length <= 1024
                && /^[a-z0-9_.=/-]+\.(ogg|wav)$/i.test(value) && !value.startsWith('/')
                && value.split('/').every(part => part && part !== '.' && part !== '..');
        } catch (_) { return false; }
    }
    function signature(bytes, type) {
        const ascii = (start, text) => [...text].every((char, index) => bytes[start + index] === char.charCodeAt(0));
        if (type === 'font/woff2') return bytes.length >= 44 && ascii(0, 'wOF2');
        if (type === 'font/ttf') return bytes.length >= 12 && [0,1,0,0].every((byte,index) => bytes[index] === byte);
        if (type === 'image/webp') return bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP');
        if (type === 'image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((byte,index) => bytes[index] === byte);
        if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (type === 'image/gif') return bytes.length >= 6 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'));
        if (type === 'audio/ogg') return bytes.length >= 27 && ascii(0, 'OggS') && bytes[4] === 0;
        return bytes.length >= 44 && ascii(0, 'RIFF') && ascii(8, 'WAVE');
    }
    function create({ request, current, createObjectURL = blob => root.URL.createObjectURL(blob), revokeObjectURL = url => root.URL.revokeObjectURL(url) } = {}) {
        if (typeof request !== 'function' || typeof current !== 'function') throw new TypeError('Authenticated request and current-context guard are required.');
        let disposed = false, generation = 0;
        const pending = new Set(), leases = new Set();
        function clear() {
            generation++;
            for (const controller of pending) controller.abort();
            pending.clear();
            for (const lease of [...leases]) lease.release();
        }
        function dispose() { disposed = true; clear(); }
        async function load(path, { context, kind = 'image', mime, maxBytes = LIMITS[kind], signal, timeoutMs = 30000 } = {}) {
            if (!validPath(path, kind)) throw failure('Invalid private media path.', 'PRIVATE_ASSET_PATH');
            if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > LIMITS[kind]
                || mime && !TYPES[kind].includes(mime) || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000)
                throw failure('Invalid private media limits.', 'PRIVATE_ASSET_OPTIONS');
            const controller = new root.AbortController(), epoch = generation;
            const abort = () => controller.abort();
            const check = () => {
                if (disposed || controller.signal.aborted || generation !== epoch) throw cancelled();
                if (!current(context)) throw Object.assign(failure('Private media access or workspace changed.', 'PRIVATE_ASSET_STALE'), { stale: true });
            };
            let cancelWait, timer, reader;
            const aborted = new Promise((_, reject) => { cancelWait = () => reject(cancelled()); });
            aborted.catch(() => {});
            controller.signal.addEventListener('abort', cancelWait, { once: true });
            const wait = async promise => { const value = await Promise.race([promise, aborted]); check(); return value; };
            try {
                check();
                signal?.addEventListener('abort', abort, { once: true });
                if (signal?.aborted) controller.abort();
                check();
                pending.add(controller);
                timer = root.setTimeout(abort, timeoutMs);
                const result = await wait(request(path, { method: 'GET', responseType: 'blob', cache: 'no-store', credentials: 'omit', signal: controller.signal }, context));
                let blob;
                if (typeof result?.arrayBuffer === 'function' && typeof result?.size === 'number') blob = result;
                else {
                    if (!result?.ok || result.status !== 200) throw failure('Private media unavailable.', 'PRIVATE_ASSET_RESPONSE');
                    const type = String(result.headers?.get('content-type') || '').split(';')[0].trim().toLowerCase();
                    if (!TYPES[kind].includes(type) || mime && mime !== type) throw failure('Unexpected private media type.', 'PRIVATE_ASSET_TYPE');
                    const declared = result.headers?.get('content-length');
                    if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw failure('Private media exceeds its size limit.', 'PRIVATE_ASSET_SIZE');
                    if (result.body?.getReader) {
                        reader = result.body.getReader();
                        const chunks = []; let size = 0;
                        while (true) {
                            const chunk = await wait(reader.read());
                            if (chunk.done) break;
                            size += chunk.value.byteLength;
                            if (size > maxBytes) throw failure('Private media exceeds its size limit.', 'PRIVATE_ASSET_SIZE');
                            chunks.push(chunk.value);
                        }
                        if (declared != null && size !== Number(declared)) throw failure('Private media is incomplete.', 'PRIVATE_ASSET_SIZE');
                        blob = new root.Blob(chunks, { type });
                    } else blob = await wait(result.blob());
                }
                const type = String(blob.type || '').toLowerCase();
                if (!TYPES[kind].includes(type) || mime && mime !== type) throw failure('Unexpected private media type.', 'PRIVATE_ASSET_TYPE');
                if (!blob.size || blob.size > maxBytes) throw failure('Private media exceeds its size limit.', 'PRIVATE_ASSET_SIZE');
                const prefix = new Uint8Array(await wait(blob.slice(0, 44).arrayBuffer()));
                if (!signature(prefix, type)) throw failure('Invalid private media bytes.', 'PRIVATE_ASSET_BYTES');
                check();
                const url = createObjectURL(blob);
                let released = false;
                const lease = { url, release() {
                    if (released) return;
                    released = true; leases.delete(lease); revokeObjectURL(url);
                } };
                leases.add(lease);
                // A custom URL allocator may synchronously trigger a context change.
                try { check(); } catch (error) { lease.release(); throw error; }
                return lease;
            } finally {
                if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) {} }
                root.clearTimeout(timer);
                pending.delete(controller);
                signal?.removeEventListener('abort', abort);
                controller.signal.removeEventListener('abort', cancelWait);
            }
        }
        return { load, clear, dispose };
    }
    return { create, LIMITS };
});
