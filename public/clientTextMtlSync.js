/* Silent captured-scope MTL replay and exact-body dismissal retries. */
(function (root, factory) {
    const storage = root.ClientTextMtlStore || (typeof require === 'function' ? require('./clientTextMtlStore.js') : null);
    const api = factory(root, storage);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextMtlSync = api;
})(typeof globalThis === 'object' ? globalThis : self, function (root, Storage) {
    'use strict';
    function create(options) {
        if (typeof options?.request !== 'function') throw new TypeError('MTL sync requires a request function.');
        const scope = Object.freeze(Storage.normalizeScope(options.scope)), store = options.store || Storage.create();
        const base = '/v1/content-groups/' + encodeURIComponent(scope.groupId) + '/mtl', language = 'language=' + encodeURIComponent(scope.language);
        let stopped = false, queue = Promise.resolve(), timer = null;
        const errors = { pull: null, flush: null }, current = () => !stopped && (!options.isCurrent || options.isCurrent(scope));
        const guard = () => { if (!current()) throw Object.assign(new Error('MTL sync context changed.'), { stale: true }); };
        const notify = (name, value) => { try { options[name]?.(value); } catch (_) {} };
        function snapshot() { return { scope, stopped, error: errors.flush?.message || errors.pull?.message || '',
            pullError: errors.pull?.message || '', flushError: errors.flush?.message || '',flushCode:errors.flush?.code||'' }; }
        async function request(path, init) {
            guard(); const response = await options.request(path, init); guard();
            if (response && typeof response.json === 'function') {
                const body = await response.json(); guard();
                if (response.ok === false) throw Object.assign(new Error(body.error?.message || body.message || 'MTL request failed.'),
                    { status: response.status, code: body.error?.code || body.code, current: body.current || body.error?.current });
                return body;
            }
            return response?.data && !response.candidate && !response.events ? response.data : response;
        }
        function serialized(kind, action) {
            const result = queue.catch(() => {}).then(async () => {
                guard();
                try { const value = await action(); if (!value?.conflicts&&!value?.pending) errors[kind] = null; notify('onError', snapshot()); return value; }
                catch (error) { if (!error.stale) { errors[kind] = error; notify('onError', snapshot()); } throw error; }
            });
            queue = result; return result;
        }
        function pull() {
            return serialized('pull', async () => {
                if(options.local)return{changed:[],sequence:0};
                if(options.offline?.())return{changed:[],offline:true,pending:true};
                const metadata = await store.getMetadata(scope, { guard: current }); guard();
                let cursor = metadata?.sequence || 0, changed = [];
                for (let page = 0; page < 10000; page++) {
                    const data = await request(base + '/events?after=' + cursor + '&limit=100&' + language, { method: 'GET' });
                    if (!data || !Array.isArray(data.events)) throw new Error('MTL events response is invalid.');
                    let last = cursor;
                    for (const event of data.events) {
                        if (!Number.isSafeInteger(event.sequence) || event.sequence <= last || !event.candidate) throw new Error('MTL event order is invalid.');
                        last = event.sequence;
                    }
                    const next = data.hasMore ? last : Math.max(last, Number(data.sequence ?? last));
                    if (!Number.isSafeInteger(next) || next < cursor || data.hasMore && next === cursor) throw new Error('MTL event cursor is invalid.');
                    const applied = await store.applyRemote(scope, { candidates: data.events.map(event => event.candidate), sequence: next }, { guard: current }); guard();
                    changed.push(...applied.changed); cursor = next;
                    if (!data.hasMore) {
                        changed = [...new Set(changed)]; if (changed.length) notify('onChange', { changed, scope });
                        return { changed, sequence: cursor };
                    }
                }
                throw new Error('MTL replay exceeded the page limit.');
            });
        }
        function flush() {
            return serialized('flush', async () => {
                let uploaded = 0;
                for (let round = 0; round < 10000; round++) {
                    const operations = await store.getOutbox(scope, { guard: current }); guard();
                    if(options.offline?.())return{uploaded,pending:operations.length,offline:true};
                    const operation = operations.find(value => value.state !== 'conflict');
                    if (!operation) return { uploaded, conflicts: operations.filter(value => value.state === 'conflict').length };
                    const claimed = await store.markSending(scope, operation.mutationId, 'sending', { guard: current }); guard();
                    if (!claimed) continue;
                    try {
                        const path=options.local?'/v1/mtl/local/requests/'+encodeURIComponent(claimed.requestId)+'/dismissals':base + '/' + encodeURIComponent(claimed.candidateId) + '/dismissals?' + language;
                        const data = await request(path,
                            { method: 'POST', body: claimed.requestBody });
                        await store.acknowledge(scope, claimed, data, { guard: current }); guard(); uploaded++;
                        notify('onChange', { changed: [claimed.unitId], scope });
                    } catch (error) {
                        if (error.stale) throw error;
                        const conflict = error.status === 409 || error.statusCode === 409 || String(error.code || '').includes('CONFLICT');
                        await store.markSending(scope, claimed.mutationId,error.code==='MTL_REVIEW_ARCHIVE_PENDING'?'archive-pending':conflict?'conflict':'uncertain', { guard: current });
                        throw error;
                    }
                }
                throw new Error('MTL upload exceeded the operation limit.');
            });
        }
        async function tick() { if (!current() || root.document?.hidden) return; try { await pull(); await flush(); } catch (_) {} }
        function start(interval = 20000) {
            if (timer || stopped) return;
            timer = setInterval(tick, Math.max(1000, interval)); timer?.unref?.();
            root.addEventListener?.('online', tick); root.document?.addEventListener?.('visibilitychange', tick); if(options.immediate!==false)tick();
        }
        function stop() {
            stopped = true; if (timer) clearInterval(timer); timer = null;
            root.removeEventListener?.('online', tick); root.document?.removeEventListener?.('visibilitychange', tick);
        }
        return { scope, pull, flush, start, stop, snapshot };
    }
    return { create };
});
