/* Captured-scope ClientText event replay and idempotent saved-unit uploads. */
(function (root, factory) {
    const storage = root.ClientTextStore || (typeof require === 'function' ? require('./clientTextStore.js') : null);
    const api = factory(root, storage);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextSync = api;
})(typeof globalThis === 'object' ? globalThis : self, function (root, Storage) {
    'use strict';
    function create(options) {
        if (!options?.request) throw new TypeError('ClientText sync requires a request function.');
        const scope = Object.freeze(Storage.normalizeScope(options.scope)), store = options.store || Storage.create();
        const base = '/v1/content-groups/' + encodeURIComponent(scope.groupId);
        const language = 'language=' + encodeURIComponent(scope.language);
        let stopped = false, queue = Promise.resolve(), timer = null;
        const errors = { pull:null, flush:null };
        const current = () => !stopped && (!options.isCurrent || options.isCurrent(scope));
        const guard = () => { if (!current()) throw Object.assign(new Error('ClientText sync context changed.'), { stale:true }); };
        const notify = (name,value) => { try { options[name]?.(value); } catch (_) {} };
        async function request(path, init = {}) {
            guard(); const response = await options.request(path, init); guard();
            if (response && typeof response.json === 'function') {
                const body = await response.json(); guard();
                if (response.ok === false) throw Object.assign(new Error(body.error?.message || body.message || 'ClientText request failed.'),
                    { status:response.status,code:body.error?.code||body.code,current:body.current||body.error?.current });
                return body;
            }
            return response?.data && response.unit === undefined && response.events === undefined ? response.data : response;
        }
        function serialized(kind, action) {
            const result = queue.catch(() => {}).then(async () => {
                guard();
                try { const value = await action(); if(!value?.conflicts)errors[kind] = null; notify('onError',snapshot()); return value; }
                catch(error) { if(!error.stale){errors[kind]=error;notify('onError',snapshot());} throw error; }
            });
            queue = result; return result;
        }
        function snapshot() {
            return { scope, stopped, error: errors.flush?.message || errors.pull?.message || '',
                pullError:errors.pull?.message||'',flushError:errors.flush?.message||'' };
        }
        function pull() {
            return serialized('pull', async () => {
                const metadata = await store.getMetadata(scope,{guard:current});guard();
                let cursor=metadata?.sequence||0,changed=[];
                for(let page=0;page<10000;page++) {
                    const data=await request(base+'/events?after='+cursor+'&limit=100&'+language,{method:'GET'});
                    if(!data||!Array.isArray(data.events))throw new Error('ClientText events response is invalid.');
                    let last=cursor;
                    for(const event of data.events){if(!Number.isSafeInteger(event.sequence)||event.sequence<=last)throw new Error('ClientText event order is invalid.');last=event.sequence;}
                    const next=data.hasMore?last:Math.max(last,Number(data.sequence||last));
                    if(!Number.isSafeInteger(next)||next<cursor||(data.hasMore&&next===cursor))throw new Error('ClientText events cursor is invalid.');
                    const applied=await store.applyRemote(scope,{events:data.events,sequence:next},{guard:current});guard();
                    changed.push(...applied.changed);cursor=next;
                    if(!data.hasMore){if(changed.length)notify('onChange',{changed:[...new Set(changed)],scope});return {changed:[...new Set(changed)],sequence:cursor};}
                }
                throw new Error('ClientText event replay exceeded the page limit.');
            });
        }
        function oldest(operation){let value=operation;while(value.predecessor)value=value.predecessor;return value;}
        function flush() {
            return serialized('flush', async () => {
                let uploaded=0;
                for(let round=0;round<10000;round++){
                    const operations=await store.getOutbox(scope,{guard:current});guard();
                    const pending=operations.find(operation=>oldest(operation).state!=='conflict');
                    if(!pending)return {uploaded,conflicts:operations.filter(operation=>oldest(operation).state==='conflict').length};
                    const operation=oldest(pending);
                    const claimed=await store.markSending(scope,operation.unitId,operation.mutationId,'sending',{guard:current});guard();
                    if(!claimed)continue;
                    const baseline=await store.getUnit(scope,claimed.unitId,{guard:current});
                    const witness=await store.getProof(scope,claimed.unitId,{guard:current});guard();
                    if(!baseline)throw new Error('ClientText upload original is unavailable.');
                    const body={mutationId:claimed.mutationId,baseRevision:claimed.baseRevision||0,values:claimed.values,
                        reviewed:claimed.reviewed||{},baseline,proof:witness.proof};
                    try{
                        const data=await request(base+'/units/'+encodeURIComponent(claimed.unitId)+'?'+language,{method:'PATCH',body});
                        const accepted=data?.unit||data;
                        if(!accepted||accepted.unitId&&accepted.unitId!==claimed.unitId||accepted.id&&accepted.id!==claimed.unitId)throw new Error('ClientText save acknowledgement identifies another unit.');
                        await store.acknowledge(scope,claimed,accepted,{guard:current});guard();uploaded++;
                        notify('onChange',{changed:[claimed.unitId],scope});
                    }catch(error){
                        if(error.stale)throw error;
                        const accepted=error.current||error.details?.current||error.response?.current;
                        if(error.status===409||error.statusCode===409||String(error.code||'').includes('CONFLICT')){
                            if(accepted?.values&&accepted.revision)await store.applyRemote(scope,{events:[{unitId:claimed.unitId,unit:accepted}]},{guard:current});
                            await store.markSending(scope,claimed.unitId,claimed.mutationId,'conflict',{guard:current});
                            notify('onChange',{changed:[claimed.unitId],scope});
                        }else await store.markSending(scope,claimed.unitId,claimed.mutationId,'uncertain',{guard:current});
                        throw error;
                    }
                }
                throw new Error('ClientText upload exceeded the operation limit.');
            });
        }
        async function tick(){
            if(!current()||root.document?.hidden)return;
            try{await pull();await flush();}catch(_){}
        }
        function start(interval=20000){
            if(timer)return;
            timer=setInterval(tick,Math.max(1000,interval));timer?.unref?.();
            root.addEventListener?.('online',tick);root.document?.addEventListener('visibilitychange',tick);tick();
        }
        function stop(){stopped=true;if(timer)clearInterval(timer);timer=null;
            root.removeEventListener?.('online',tick);root.document?.removeEventListener('visibilitychange',tick);}
        return {scope,pull,flush,start,stop,snapshot};
    }
    return {create};
});
