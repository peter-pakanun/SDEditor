/* Additive IndexedDB v12 storage for scoped ClientText originals and authored work. */
(function (root, factory) {
    const state = root.ClientTextState || (typeof require === 'function' ? require('./clientTextState.js') : null);
    const api = factory(root, state);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextStore = api;
})(typeof globalThis === 'object' ? globalThis : self, function (root, S) {
    'use strict';
    const stores = { meta: 'clienttext_workspaces', assets: 'clienttext_assets', originals: 'clienttext_units',
        saved: 'clienttext_saved', drafts: 'clienttext_drafts', history: 'clienttext_history',
        outbox: 'clienttext_outbox', receipts: 'clienttext_receipts', requests: 'clienttext_requests',
        memory: 'clienttext_memory', memoryHistory: 'clienttext_memory_history' };
    const names = Object.values(stores), own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const copy = S.copy, key = (...values) => JSON.stringify(values);
    const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const completed = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error('ClientText transaction aborted.')); });
    function normalizeScope(input) {
        const scope = { accountId: String(input?.accountId || input?.profile || 'guest'), game: String(input?.game || 'poe2'),
            branchId: String(input?.branchId || 'default'), versionId: String(input?.versionId || ''),
            groupId: String(input?.groupId || ''), language: String(input?.language || '') };
        if (!['poe1','poe2'].includes(scope.game) || !scope.versionId || !scope.groupId || !scope.language) throw new TypeError('ClientText requires version, group, game and selected language.');
        return scope;
    }
    const scopeKey = input => { const scope = normalizeScope(input); return key(scope.accountId, scope.game, scope.branchId, scope.versionId, scope.groupId, scope.language); };
    function upgrade(db, tx) {
        for (const name of names) {
            const store = db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath: 'key' });
            if (!store.indexNames.contains('by_scope')) store.createIndex('by_scope', 'scope');
            if (name === stores.meta && !store.indexNames.contains('by_account')) store.createIndex('by_account', 'accountId');
            if ([stores.history,stores.drafts,stores.outbox,stores.memoryHistory].includes(name) && !store.indexNames.contains('by_unit')) store.createIndex('by_unit', 'unitKey');
        }
    }
    function create(dependencies = {}) {
        const getDb = dependencies.openDb || (() => {
            const offline = root.OfflineStore || root.window?.OfflineStore || root.self?.OfflineStore;
            if (!offline?.openClientTextDb) throw new Error('ClientText storage is unavailable. Reload the editor.');
            return offline.openClientTextDb();
        });
        const pause = dependencies.yield || (() => new Promise(resolve => setTimeout(resolve, 0)));
        const capture = input => { const scope = normalizeScope(input); return { scope, id: scopeKey(scope) }; };
        const requestScope = input => {
            const scope={accountId:String(input?.accountId||input?.profile||'guest'),game:String(input?.game||'poe2'),branchId:String(input?.branchId||'default')};
            if(!['poe1','poe2'].includes(scope.game))throw new TypeError('Invalid ClientText request game.');
            return {scope,id:key(scope.accountId,scope.game,scope.branchId)};
        };
        const memoryScope=input=>{
            const scope={accountId:String(input?.accountId||input?.profile||'guest'),game:String(input?.game||'poe2'),language:String(input?.language||'')};
            if(!['poe1','poe2'].includes(scope.game)||!scope.language)throw new TypeError('ClientText memory requires account, game and language.');
            return {scope,id:key(scope.accountId,scope.game,scope.language)};
        };
        const guard = options => { if (options?.guard && !options.guard()) throw Object.assign(new Error('ClientText context changed.'), { stale: true }); };
        const get = async (tx, name, id) => (await request(tx.objectStore(name).get(id)))?.value;
        const put = (tx, name, scope, id, value, extras = {}) => tx.objectStore(name).put({ key: key(scope,id), scope, value, ...extras });
        const del = (tx, name, scope, id) => tx.objectStore(name).delete(key(scope,id));
        async function transaction(selected, mode, action, options) {
            guard(options);
            const db = await getDb(); guard(options);
            if (!db.objectStoreNames.contains(stores.meta)) throw new Error('ClientText storage upgrade is incomplete. Reload the editor.');
            const tx = db.transaction([...new Set(selected)], mode), done = completed(tx);
            // Abort can arrive while an awaited request has not delivered its
            // callback. Observe completion immediately and reject that action.
            try { const result = await Promise.race([action(tx), done.then(() => new Promise(() => {}))]); guard(options); await done; return result; }
            catch (error) { try { tx.abort(); } catch (_) {} await done.catch(() => {}); throw error; }
        }
        const one = (scope, name, id, options) => transaction([name], 'readonly', tx => get(tx, name, key(scope,id)), options);
        async function readRows(scope,name,project,options){
            const range=dependencies.keyRange || root.IDBKeyRange;
            if(!range)throw new Error('ClientText IndexedDB key ranges are unavailable.');
            // JSON scoped primary keys share this exact prefix. Page on the
            // primary key so duplicate by_scope index keys cannot skip rows.
            const prefix=JSON.stringify([scope]).slice(0,-1)+',',upper=prefix+'\uffff';
            return transaction([name],'readonly',async tx=>{
                const output=[];let last;
                while(true){
                    guard(options);
                    const query=range.bound(last||prefix,upper,!!last,false);
                    const page=await request(tx.objectStore(name).getAll(query,128));
                    for(const row of page)output.push(project(row));
                    if(page.length<128)return output;
                    // Each IDB response yields to the browser. Keep the reads
                    // in one transaction so Saved materialization remains a
                    // coherent snapshot while each response stays bounded.
                    last=page.at(-1).key;
                }
            },options);
        }
        const rows = (scope,name,options)=>readRows(scope,name,row=>row.value,options);
        // Chromium caps a single serialized IDB value. Publication carry proofs
        // can exceed that cap even though every individual witness is small.
        // Keep one visible journal header and stage bounded immutable fragments.
        const chunkBytes = Math.max(1024, dependencies.requestChunkBytes || 4 * 1024 * 1024);
        const chunkRows = Math.max(1, dependencies.requestChunkRows || 128);
        const requestSnapshots = new Map();
        const fragmentScope = (scope, id) => key(scope, 'request-fragments', id);
        const intentId = id => ['request-intent', id];
        const generationId = () => root.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        function serializedWeight(value) {
            if (value === null || value === undefined) return 16;
            if (typeof value === 'string') return value.length * 2 + 32;
            if (typeof value !== 'object') return 24;
            // Blob bytes are external IDB data, not an inline structured value.
            if (typeof Blob !== 'undefined' && value instanceof Blob) return 256;
            if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value.byteLength + 256;
            let size = 128;
            if (Array.isArray(value)) for (const item of value) size += serializedWeight(item) + 16;
            else for (const [name,item] of Object.entries(value)) size += name.length * 2 + 48 + serializedWeight(item);
            return size;
        }
        const fragmentIds = row => new Set((row?.storage?.parts || []).flatMap(part => part.chunkIds));
        async function removeRequestFragments(tx, scope, id, retained = new Set()) {
            const bucket = fragmentScope(scope,id), store = tx.objectStore(stores.requests);
            const ids = await request(store.index('by_scope').getAllKeys(bucket));
            for (const id of ids) if (!retained.has(id)) store.delete(id);
        }
        const adapter=()=>root.ContentAdapters || (typeof require==='function'?require('./contentAdapters.js'):null);
        async function learnMemory(tx,rawScope,unit,saved,jobId,origin){
            const core=adapter();if(!core)return;
            const captured=memoryScope(rawScope),units=core.clienttext.memoryUnits(unit,saved.values,captured.scope.language,
                {game:captured.scope.game,branchId:rawScope.branchId,jobId,origin,saved});
            for(const entry of units){
                const before=await get(tx,stores.memory,key(captured.id,entry.id));
                if(before&&before.source===entry.source&&before.target===entry.target&&S.stableStringify(before.context)===S.stableStringify(entry.context))continue;
                const after={...entry,updatedAt:saved.savedAt||Date.now(),localRevision:(before?.localRevision||0)+1};
                put(tx,stores.memory,captured.id,entry.id,after);
                put(tx,stores.memoryHistory,captured.id,key(entry.id,jobId),{id:entry.id,jobId,before:before||null,after,origin,createdAt:after.updatedAt},{unitKey:key(captured.id,entry.id)});
            }
        }
        async function getMemory(rawScope,options){
            const units=(await rows(memoryScope(rawScope).id,stores.memory,options)).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
            return {units,counts:{total:units.length,text:units.filter(unit=>unit.context.fieldKind==='text').length,form:units.filter(unit=>unit.context.fieldKind==='form').length}};
        }
        async function getMemoryHistory(rawScope,memoryId,options={}){
            const captured=memoryScope(rawScope);
            const records=await transaction([stores.memoryHistory],'readonly',async tx=>(await request(tx.objectStore(stores.memoryHistory).index('by_unit').getAll(key(captured.id,memoryId)))).map(row=>row.value),options);
            return records.sort((a,b)=>b.createdAt-a.createdAt).slice(0,options.limit||100);
        }
        async function getMetadata(rawScope, options) { return one(capture(rawScope).id, stores.meta, 'meta', options); }
        async function putRequest(rawScope,requestId,payload,options={}){
            if(typeof requestId!=='string'||!requestId||requestId.length>256)throw new TypeError('ClientText request requires a stable ID.');
            const captured=requestScope(rawScope),generation=generationId(),bucket=fragmentScope(captured.id,requestId);
            const before=await transaction([stores.requests],'readwrite',async tx=>{
                const previous=await get(tx,stores.requests,key(captured.id,requestId));
                put(tx,stores.requests,bucket,intentId(requestId),{generation,idempotencyKey:payload?.idempotencyKey});return previous;
            },options);
            const active=fragmentIds(before),parts=[],owner=key(captured.id,requestId);
            const snapshots=requestSnapshots.get(owner)||new WeakMap();requestSnapshots.set(owner,snapshots);
            let fragment=0;
            async function stage(values){
                const id=key(bucket,['fragment',generation,fragment++]);
                await transaction([stores.requests],'readwrite',async tx=>{
                    const intent=await get(tx,stores.requests,key(bucket,intentId(requestId)));
                    if(intent?.generation!==generation)throw Object.assign(new Error('A newer ClientText request checkpoint replaced this operation.'),{code:'REQUEST_SUPERSEDED'});
                    tx.objectStore(stores.requests).put({key:id,scope:bucket,value:{generation,values}});
                },options);
                active.add(id);await pause();guard(options);return id;
            }
            async function detach(value,path){
                guard(options);
                if(typeof value==='string' && value.length*2>chunkBytes){
                    const part={path,kind:'string',length:value.length,chunkIds:[]};parts.push(part);
                    const length=Math.max(1,Math.floor((chunkBytes-256)/2));
                    for(let start=0;start<value.length;start+=length)part.chunkIds.push(await stage(value.slice(start,start+length)));
                    return '';
                }
                if(value===null || typeof value!=='object')return value;
                if(Array.isArray(value)){
                    // Publication metadata remains mutable between checkpoints.
                    // Only the prepared carry witness array is declared immutable.
                    const reusable=options.immutablePublicationData && path.at(-1)==='carry';
                    const cached=reusable && snapshots.get(value);
                    if(cached && cached.parts.every(part=>part.chunkIds.every(id=>active.has(id)))){
                        parts.push(...cached.parts.map(part=>({...part,path:[...path,...part.path]})));return [];
                    }
                    const partStart=parts.length;
                    // Small arrays stay inline unless their detached values would
                    // make the journal header large. Large arrays never receive
                    // one aggregate structuredClone or one aggregate IDB put.
                    const output=[],chunkIds=[];let batch=[],bytes=128,split=value.length>chunkRows;
                    for(let index=0;index<value.length;index++){
                        const item=await detach(value[index],[...path,index]),weight=serializedWeight(item)+16;
                        if(!split && bytes+weight<=chunkBytes){output.push(item);bytes+=weight;continue;}
                        if(!split){split=true;batch=output.splice(0);}
                        if(batch.length && (batch.length>=chunkRows || bytes+weight>chunkBytes)){
                            chunkIds.push(await stage(batch));batch=[];bytes=128;
                        }
                        batch.push(item);bytes+=weight;
                    }
                    if(!split)return output;
                    if(batch.length)chunkIds.push(await stage(batch));
                    parts.push({path,kind:'array',length:value.length,chunkIds});
                    if(reusable)snapshots.set(value,{parts:parts.slice(partStart).map(part=>({...part,path:part.path.slice(path.length)}))});
                    return [];
                }
                const prototype=Object.getPrototypeOf(value);
                if(prototype!==Object.prototype && prototype!==null)return structuredClone(value);
                const output={};let bytes=128;
                for(const [name,item]of Object.entries(value)){
                    const detached=await detach(item,[...path,name]);bytes+=name.length*2+48+serializedWeight(detached);
                    Object.defineProperty(output,name,{value:detached,enumerable:true,writable:true,configurable:true});
                }
                if(bytes>chunkBytes){
                    const entries=Object.entries(output),part={path,kind:'object',length:entries.length,chunkIds:[]};parts.push(part);
                    let batch=[],size=128;
                    for(const entry of entries){
                        const weight=serializedWeight(entry)+16;
                        if(batch.length && (batch.length>=chunkRows || size+weight>chunkBytes)){part.chunkIds.push(await stage(batch));batch=[];size=128;}
                        batch.push(entry);size+=weight;
                    }
                    if(batch.length)part.chunkIds.push(await stage(batch));return {};
                }
                return output;
            }
            const detached=await detach(payload,[]);
            const value=await transaction([stores.requests],'readwrite',async tx=>{
                const intent=await get(tx,stores.requests,key(bucket,intentId(requestId)));
                if(intent?.generation!==generation)throw Object.assign(new Error('A newer ClientText request checkpoint replaced this operation.'),{code:'REQUEST_SUPERSEDED'});
                const current=await get(tx,stores.requests,key(captured.id,requestId));
                const value={requestId,scope:captured.scope,payload:detached,createdAt:current?.createdAt||before?.createdAt||Date.now(),updatedAt:Date.now()};
                if(parts.length)value.storage={format:1,generation,parts};
                put(tx,stores.requests,captured.id,requestId,value);
                // The new header is the commit point. Until this transaction
                // succeeds the old complete checkpoint and its fragments remain.
                await removeRequestFragments(tx,captured.id,requestId,fragmentIds(value));return value;
            },options);
            return value;
        }
        async function getRequest(rawScope,requestId,options){
            const captured=requestScope(rawScope),header=await one(captured.id,stores.requests,requestId,options);
            if(!header?.storage)return header;
            // Read one atomic generation. A concurrent checkpoint may remove
            // old fragments; retry its new header instead of exposing a mixture.
            return transaction([stores.requests],'readonly',async tx=>{
                const current=await get(tx,stores.requests,key(captured.id,requestId));
                if(!current?.storage)return current;
                for(const part of [...current.storage.parts].sort((a,b)=>a.path.length-b.path.length)){
                    guard(options);
                    let value=part.kind==='string'?'':[];
                    for(const id of part.chunkIds){
                        guard(options);
                        const row=await get(tx,stores.requests,id);
                        if(!row || (part.kind!=='string'&&!Array.isArray(row.values)) || (part.kind==='string'&&typeof row.values!=='string'))throw new Error('ClientText request checkpoint is incomplete.');
                        if(part.kind==='string')value+=row.values;else for(const item of row.values)value.push(item);
                    }
                    if(value.length!==part.length)throw new Error('ClientText request checkpoint length differs.');
                    if(part.kind==='object')value=Object.fromEntries(value);
                    if(!part.path.length)current.payload=value;
                    else {let target=current.payload;for(const name of part.path.slice(0,-1))target=target[name];target[part.path.at(-1)]=value;}
                }
                return current;
            },options);
        }
        async function listRequests(rawScope,options){return (await rows(requestScope(rawScope).id,stores.requests,options)).sort((a,b)=>b.updatedAt-a.updatedAt);}
        async function deleteRequest(rawScope,requestId,options={}){
            const captured=requestScope(rawScope);
            return transaction([stores.requests],'readwrite',async tx=>{
                if(Object.hasOwn(options,'expectedIdempotencyKey')){
                    const current=await get(tx,stores.requests,key(captured.id,requestId));
                    if(!current || current.payload?.idempotencyKey!==options.expectedIdempotencyKey)return false;
                    const intent=await get(tx,stores.requests,key(fragmentScope(captured.id,requestId),intentId(requestId)));
                    // A newer composer checkpoint can be staging behind the
                    // old visible header. Its old ACK must leave that writer
                    // and the prior durable checkpoint intact.
                    if(intent && intent.idempotencyKey!==options.expectedIdempotencyKey)return false;
                }
                del(tx,stores.requests,captured.id,requestId);
                await removeRequestFragments(tx,captured.id,requestId);return true;
            },options);
        }
        async function requireReady(scope, options) {
            const metadata = await one(scope, stores.meta, 'meta', options);
            if (!metadata || metadata.state !== 'ready') throw Object.assign(new Error('ClientText originals are still being prepared.'), { code: 'CLIENTTEXT_NOT_READY' });
            return metadata;
        }
        async function prepareAsset(scope, asset, descriptor, tree, signature, options){
            if(!descriptor || (asset.hash || asset.assetHash)!==descriptor.assetHash)throw new Error('ClientText original asset differs from its descriptor.');
            if(!tree || tree.ids?.length!==descriptor.unitCount || tree.levels?.at(-1)?.[0]!==descriptor.root)throw new Error('ClientText original proof tree differs from its descriptor.');
            const storage={format:1,ids:{length:tree.ids.length,parts:[]},levels:[]},pending=[];
            async function flush(){
                if(!pending.length)return;
                await transaction([stores.meta,stores.assets],'readwrite',async tx=>{
                    const current=await get(tx,stores.meta,key(scope,'meta'));
                    if(current && current.signature!==signature)throw new Error('ClientText import changed in another tab.');
                    for(const entry of pending)put(tx,stores.assets,scope,entry.id,entry.values);
                },options);
                pending.length=0;await pause();guard(options);
            }
            async function stage(values,label){
                const part={length:values.length,parts:[]};let batch=[],bytes=128,start=0;
                async function commit(){
                    if(!batch.length)return;
                    const id=['asset-tree',asset.role,descriptor.baselineId,label,start];
                    part.parts.push({start,length:batch.length,id});pending.push({id,values:batch});start+=batch.length;batch=[];bytes=128;
                    if(pending.length>=4)await flush();
                }
                for(const value of values){
                    const weight=serializedWeight(value)+16;
                    if(batch.length && (batch.length>=1024 || bytes+weight>chunkBytes))await commit();
                    batch.push(value);bytes+=weight;
                }
                await commit();return part;
            }
            storage.ids=await stage(tree.ids,'ids');
            for(let level=0;level<tree.levels.length;level++)storage.levels.push(await stage(tree.levels[level],level));
            await flush();
            // Parsed units already have their own immutable per-unit records.
            // Keep only workbook/schema context beside the retained original.
            return {...asset,parsed:asset.parsed?{...asset.parsed,units:undefined}:asset.parsed,descriptor,tree:undefined,treeStorage:storage};
        }
        async function importContent(rawScope, input, options = {}) {
            const captured = capture(rawScope), scope = captured.id;
            guard(options);
            if (!Array.isArray(input?.units) || !input.units.length) throw new TypeError('ClientText import contains no units.');
            const assets = Array.isArray(input.assets) ? input.assets : Object.entries(input.assets || {}).map(([role,asset]) => ({ role,...asset }));
            const manifest = input.manifest || await S.buildManifest(input.units, assets, options);
            const signature = S.hash({ descriptors: manifest.descriptors, unitCount: input.units.length });
            const existing = await one(scope, stores.meta, 'meta', options);
            if (existing && existing.signature !== signature) throw new Error('ClientText originals are immutable. Import a changed workbook as a new source group.');
            if (existing?.state === 'ready') return existing;
            const compactById = new Map(manifest.units.map(unit => [unit.id, unit]));
            if (compactById.size !== input.units.length) throw new TypeError('ClientText manifest unit count differs.');
            const proofIndices=new Map(),preparedAssets=[];
            for(const asset of assets){
                const descriptor=manifest.descriptors.find(value=>value.role===asset.role),tree=manifest.trees?.[asset.role];
                preparedAssets.push(await prepareAsset(scope,asset,descriptor,tree,signature,options));
                tree.ids.forEach((id,index)=>proofIndices.set(id,index));
            }
            const priorScope = options.previousScope && capture(options.previousScope).id;
            const previousUnits = priorScope ? new Map((await rows(priorScope, stores.originals, options)).map(row => [row.unit.id,row.unit])) : null;
            const previousSaved = priorScope ? new Map((await rows(priorScope, stores.saved, options)).map(row => [row.unitId,row])) : null;
            let imported = existing?.imported || 0;
            await transaction([stores.meta,stores.assets], 'readwrite', async tx => {
                const current = await get(tx, stores.meta, key(scope,'meta'));
                if (current && current.signature !== signature) throw new Error('ClientText import changed in another tab.');
                for (const asset of preparedAssets) put(tx, stores.assets, scope, asset.role, asset);
                put(tx, stores.meta, scope, 'meta', { ...copy(input.metadata || {}), ...captured.scope, state: 'importing', signature,
                    imported: current?.imported || 0, unitCount: input.units.length, descriptors: copy(manifest.descriptors), createdAt: current?.createdAt || Date.now(), sequence: current?.sequence || 0 }, { accountId: captured.scope.accountId });
            }, options);
            while (imported < input.units.length) {
                guard(options);
                const end = Math.min(imported + 128, input.units.length);
                const batch = input.units.slice(imported,end).map(unit => {
                    const original = S.normalizeUnit(unit), compact = compactById.get(original.id);
                    if (!compact || !proofIndices.has(original.id) || S.stableStringify(S.compactUnit(original)) !== S.stableStringify(compact)) throw new Error('ClientText original differs from its manifest.');
                    const prior = previousUnits?.get(original.id), saved = previousSaved?.get(original.id);
                    return { unit: original, compact, carry: prior && saved ? S.carryForward(prior, original, saved) : null };
                });
                await transaction([stores.meta,stores.originals,stores.saved,stores.history], 'readwrite', async tx => {
                    const metadata = await get(tx, stores.meta, key(scope,'meta'));
                    if (!metadata || metadata.signature !== signature) throw new Error('ClientText import ownership changed.');
                    for (const entry of batch) {
                        // The immutable import signature and checked compact
                        // witness authorize this whole batch. Avoid one awaited
                        // IDB read callback per freshly imported baseline unit.
                        put(tx, stores.originals, scope, entry.unit.id, { unit: entry.unit, compact: entry.compact, proofIndex:proofIndices.get(entry.unit.id) });
                        if (entry.carry && !await get(tx, stores.saved, key(scope,entry.unit.id))) {
                            const carried = { unitId: entry.unit.id, values: entry.carry.values, reviewed: entry.carry.reviewed,
                                saved: entry.carry.saved,
                                outdated: entry.carry.outdated, conflicts: entry.carry.conflicts, revision: 1, serverRevision: 0,
                                baseRevision: 0, origin: 'carry-forward', savedAt: Date.now() };
                            put(tx, stores.saved, scope, entry.unit.id, carried);
                            put(tx, stores.history, scope, 'carry:' + entry.unit.id, { unitId: entry.unit.id, before: null, after: carried,
                                origin: 'carry-forward', removed: entry.carry.removed, createdAt: Date.now() }, { unitKey: key(scope,entry.unit.id) });
                        }
                    }
                    metadata.imported = Math.max(metadata.imported || 0, end);
                    put(tx, stores.meta, scope, 'meta', metadata, { accountId: captured.scope.accountId });
                }, options);
                imported = end;
                options.onProgress?.({ phase:'storage',processed:imported,total:input.units.length,sheet:batch.at(-1)?.unit.sheet });
                await pause();
            }
            return transaction([stores.meta], 'readwrite', async tx => {
                const metadata = await get(tx, stores.meta, key(scope,'meta'));
                if (metadata.signature !== signature || metadata.imported !== metadata.unitCount) throw new Error('ClientText import is incomplete.');
                metadata.state = 'ready';
                put(tx, stores.meta, scope, 'meta', metadata, { accountId: captured.scope.accountId }); return metadata;
            }, options);
        }
        async function getUnits(rawScope, options = {}) {
            const scope = capture(rawScope).id; await requireReady(scope, options);
            // Do not retain the duplicate compact manifest while materializing
            // immutable units; each bounded page releases it immediately.
            return readRows(scope,stores.originals,row=>row.value.unit,options);
        }
        async function getCompactUnits(rawScope,options={}){
            const scope=capture(rawScope).id,metadata=await requireReady(scope,options);
            const units=await readRows(scope,stores.originals,row=>{
                if(!row.value.compact)throw Object.assign(new Error('ClientText immutable manifest is unavailable.'),{code:'CLIENTTEXT_COMPACT_MISSING'});
                return row.value.compact;
            },options);
            if(units.length!==metadata.unitCount)throw new Error('ClientText immutable manifest is incomplete.');
            return units;
        }
        async function getUnit(rawScope, unitId, options) { return (await one(capture(rawScope).id, stores.originals, unitId, options))?.unit; }
        async function getSaved(rawScope, options) { return Object.fromEntries((await rows(capture(rawScope).id,stores.saved,options)).map(row => [row.unitId,row])); }
        async function getAsset(rawScope, role = 'normal', options) {
            const scope=capture(rawScope).id;
            return transaction([stores.assets],'readonly',async tx=>{
                const asset=await get(tx,stores.assets,key(scope,role));
                if(!asset?.treeStorage)return asset;
                async function read(part){
                    const values=[];
                    for(const entry of part.parts){
                        guard(options);
                        const chunk=await get(tx,stores.assets,key(scope,entry.id));
                        if(!Array.isArray(chunk)||chunk.length!==entry.length||entry.start!==values.length)throw new Error('ClientText original proof tree is incomplete.');
                        for(const value of chunk)values.push(value);
                    }
                    if(values.length!==part.length)throw new Error('ClientText original proof tree length differs.');return values;
                }
                const ids=await read(asset.treeStorage.ids),levels=[];
                for(const part of asset.treeStorage.levels)levels.push(await read(part));
                asset.tree={ids,levels};return asset;
            },options);
        }
        async function getProof(rawScope, unitId, options) {
            const scope=capture(rawScope).id,role=JSON.parse(unitId)[0];
            return transaction([stores.assets,stores.originals],'readonly',async tx=>{
                const asset=await get(tx,stores.assets,key(scope,role));
                if(!asset)throw new Error('ClientText original proof is unavailable.');
                if(!asset.treeStorage){
                    if(!asset.tree)throw new Error('ClientText original proof is unavailable.');
                    return {descriptor:asset.descriptor,proof:S.proofFor({trees:{[role]:asset.tree}},unitId)};
                }
                const tree=asset.treeStorage,cache=new Map();
                async function at(part,index){
                    guard(options);
                    if(!Number.isSafeInteger(index)||index<0||index>=part.length)throw new Error('ClientText proof index differs.');
                    let low=0,high=part.parts.length;
                    while(low<high){const middle=(low+high)>>>1;if(part.parts[middle].start<=index)low=middle+1;else high=middle;}
                    const entry=part.parts[low-1];
                    if(!entry || index>=entry.start+entry.length)throw new Error('ClientText proof fragment is absent.');
                    const id=key(scope,entry.id);
                    if(!cache.has(id))cache.set(id,await get(tx,stores.assets,id));
                    const values=cache.get(id);
                    if(!Array.isArray(values)||values.length!==entry.length)throw new Error('ClientText proof fragment is incomplete.');
                    return values[index-entry.start];
                }
                const original=await get(tx,stores.originals,key(scope,unitId));let index=original?.proofIndex;
                // Resume compatibility: a pre-upgrade partial import can have
                // unit rows without the proof index. Search only ID fragments.
                if(!Number.isSafeInteger(index)){
                    let low=0,high=tree.ids.length;
                    while(low<high){const middle=(low+high)>>>1;if(await at(tree.ids,middle)<unitId)low=middle+1;else high=middle;}
                    index=low;
                }
                if(await at(tree.ids,index)!==unitId)throw new Error('ClientText unit is absent from the original.');
                const siblings=[];let position=index;
                for(let level=0;level<tree.levels.length-1;level++){
                    const values=tree.levels[level],sibling=position%2?position-1:Math.min(position+1,values.length-1);
                    siblings.push({side:position%2?'left':'right',hash:await at(values,sibling)});position=Math.floor(position/2);
                }
                return {descriptor:asset.descriptor,proof:{index,siblings}};
            },options);
        }
        async function putDraft(rawScope, unitId, input, options = {}) {
            const scope = capture(rawScope).id, unit = await getUnit(rawScope,unitId,options);
            if(!unit)throw new Error('ClientText draft source is unavailable.');
            const values=S.normalizeValues(unit,input.values),reviewed=S.normalizeReviewed(unit,input.reviewed||{});
            return transaction([stores.drafts],'readwrite',async tx=>{
                const previous=await get(tx,stores.drafts,key(scope,unitId));
                if(own(options,'expectedRevision')&&(previous?.revision||null)!==options.expectedRevision)throw Object.assign(new Error('Another tab changed this ClientText draft.'),{code:'DRAFT_CHANGED'});
                const draft={unitId,values,reviewed,revision:(previous?.revision||0)+1,updatedAt:Date.now()};
                put(tx,stores.drafts,scope,unitId,draft,{unitKey:key(scope,unitId)});return draft;
            },options);
        }
        const getDraft=(rawScope,unitId,options)=>one(capture(rawScope).id,stores.drafts,unitId,options);
        async function discardDraft(rawScope,unitId,options={}){
            const scope=capture(rawScope).id;
            return transaction([stores.drafts],'readwrite',async tx=>{
                const draft=await get(tx,stores.drafts,key(scope,unitId));
                if(own(options,'expectedRevision')&&(draft?.revision||null)!==options.expectedRevision)throw Object.assign(new Error('Another tab changed this ClientText draft.'),{code:'DRAFT_CHANGED'});
                del(tx,stores.drafts,scope,unitId);return true;
            },options);
        }
        async function save(rawScope,unitId,input,options={}){
            const captured=capture(rawScope),scope=captured.id;
            if(!input?.jobId||typeof input.jobId!=='string')throw new TypeError('ClientText save requires a stable job ID.');
            await requireReady(scope,options);
            const unit=await getUnit(rawScope,unitId,options);if(!unit)throw new Error('ClientText save source is unavailable.');
            const values=S.normalizeValues(unit,input.values), reviewed=S.normalizeReviewed(unit,input.reviewed||{});
            const command={scope:captured.scope,unitId,values,reviewed,
                ...(own(input,'baseRevision')?{baseRevision:input.baseRevision}:{}),
                ...(own(input,'expectedRevision')?{expectedRevision:input.expectedRevision}:{}),
                ...(own(input,'expectedDraftRevision')?{expectedDraftRevision:input.expectedDraftRevision}:{})};
            const signature=S.hash(command);
            return transaction([stores.originals,stores.saved,stores.drafts,stores.history,stores.outbox,stores.receipts,stores.memory,stores.memoryHistory],'readwrite',async tx=>{
                const receipt=await get(tx,stores.receipts,key(scope,input.jobId));
                if(receipt){if(receipt.signature!==signature)throw Object.assign(new Error('ClientText job ID was reused for different content.'),{code:'SAVE_RECEIPT_MISMATCH'});return {saved:receipt.saved,receipt,replayed:true};}
                const original=await get(tx,stores.originals,key(scope,unitId));
                if(!original||original.compact.hash!==S.compactUnit(unit).hash)throw new Error('ClientText original changed while saving.');
                const before=await get(tx,stores.saved,key(scope,unitId)),draft=await get(tx,stores.drafts,key(scope,unitId));
                if(own(input,'expectedRevision')&&(before?.revision||0)!==input.expectedRevision)throw Object.assign(new Error('Another tab changed the ClientText saved translation.'),{code:'UNIT_CHANGED'});
                if(own(input,'expectedDraftRevision')&&(draft?.revision||null)!==input.expectedDraftRevision)throw Object.assign(new Error('Another tab changed this ClientText draft.'),{code:'DRAFT_CHANGED'});
                const after={unitId,values,reviewed:{...before?.reviewed,...reviewed},saved:true,revision:(before?.revision||0)+1,
                    serverRevision:before?.serverRevision||input.baseRevision||0,baseRevision:before?.serverRevision||input.baseRevision||0,
                    savedAt:Date.now(),jobId:input.jobId,origin:options.origin||'save',outdated:before?.outdated||[]};
                put(tx,stores.saved,scope,unitId,after);
                await learnMemory(tx,captured.scope,unit,after,input.jobId,after.origin);
                put(tx,stores.history,scope,input.jobId,{id:input.jobId,unitId,before:before||null,after,origin:after.origin,createdAt:after.savedAt},{unitKey:key(scope,unitId)});
                if(own(input,'expectedDraftRevision'))del(tx,stores.drafts,scope,unitId);
                if(options.sync!==false){
                    const pending=await get(tx,stores.outbox,key(scope,unitId));
                    const operation={unitId,mutationId:input.jobId,values:copy(values),reviewed:copy(after.reviewed),baseRevision:after.serverRevision,
                        base:pending?.base||{values:before?.values||S.valuesFor(unit),reviewed:before?.reviewed||{},revision:after.serverRevision},state:'queued',createdAt:Date.now()};
                    // An uncertain submission remains byte-identical until its
                    // receipt arrives. The newer local save waits behind it.
                    if(pending&&['sending','uncertain'].includes(pending.state))operation.predecessor=copy(pending);
                    put(tx,stores.outbox,scope,unitId,operation,{unitKey:key(scope,unitId)});
                }
                const committed={jobId:input.jobId,signature,unitId,saved:after,committedAt:Date.now()};
                put(tx,stores.receipts,scope,input.jobId,committed);return {saved:after,receipt:committed,replayed:false};
            },options);
        }
        async function listHistory(rawScope,unitId,options={}){
            const scope=capture(rawScope).id;
            const result=await transaction([stores.history],'readonly',async tx=>(await request(tx.objectStore(stores.history).index('by_unit').getAll(key(scope,unitId)))).map(row=>row.value),options);
            return result.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,options.limit||100);
        }
        async function listWorkspaces(input={},options={}){
            const accountId=String(input.accountId||input.profile||'guest');
            return transaction([stores.meta],'readonly',async tx=>(await request(tx.objectStore(stores.meta).index('by_account').getAll(accountId))).map(row=>row.value)
                .filter(row=>Object.entries(input).every(([field,value])=>!['profile','accountId'].includes(field)?row[field]===value:true)),options);
        }
        const getOutbox=(rawScope,options)=>rows(capture(rawScope).id,stores.outbox,options);
        async function markSending(rawScope,unitId,mutationId,state='sending',options={}){
            const scope=capture(rawScope).id;
            return transaction([stores.outbox],'readwrite',async tx=>{
                const operation=await get(tx,stores.outbox,key(scope,unitId));
                if(!operation)return null;
                let target=operation;while(target.predecessor)target=target.predecessor;
                if(target.mutationId!==mutationId)return null;
                target.state=state;put(tx,stores.outbox,scope,unitId,operation,{unitKey:key(scope,unitId)});return copy(target);
            },options);
        }
        function mergeRemote(unit,local,base,remote){
            const values=S.valuesFor(unit,local),remoteValues=S.valuesFor(unit,remote),baseValues=S.valuesFor(unit,base),conflicts=[];
            for(const field of unit.fields){const id=field.id,l=values[id],b=baseValues[id],r=remoteValues[id];
                if(l===b)values[id]=r;else if(r!==b&&l!==r)conflicts.push({fieldId:id,base:b,local:l,remote:r});}
            return {values,conflicts};
        }
        async function applyRemote(rawScope,input,options={}){
            const captured=capture(rawScope),scope=captured.id,events=Array.isArray(input)?input:input.events||[];
            return transaction([stores.meta,stores.originals,stores.saved,stores.outbox,stores.history,stores.memory,stores.memoryHistory],'readwrite',async tx=>{
                const metadata=await get(tx,stores.meta,key(scope,'meta'));if(!metadata||metadata.state!=='ready')throw new Error('ClientText source is not ready.');
                const changed=[];
                for(const event of events){
                    const remote=event.unit||event.file||event.state||event,unitId=event.unitId||remote.unitId||remote.id;
                    if(!unitId||!remote.values)continue;
                    const original=await get(tx,stores.originals,key(scope,unitId));if(!original)throw new Error('Server supplied a unit absent from this ClientText source.');
                    const unit=original.unit,values=S.normalizeValues(unit,remote.values),reviewed=S.normalizeReviewed(unit,remote.reviewed||{});
                    const before=await get(tx,stores.saved,key(scope,unitId)),pending=await get(tx,stores.outbox,key(scope,unitId));
                    const revision=Number(remote.revision||event.revision||0);
                    if(!Number.isSafeInteger(revision)||revision<1)throw new Error('Invalid ClientText shared revision.');
                    if(before?.serverRevision>revision)continue;
                    if(before?.serverRevision===revision&&S.stableStringify(before.remoteBase?.values||before.values)===S.stableStringify(values))continue;
                    const accepted={unitId,values,reviewed,revision},merged=pending?mergeRemote(unit,before,pending.base,accepted):{values,conflicts:[]};
                    const inherited=remote.conflicts||remote.provenance?.conflicts||[];
                    const conflicts=[...new Map([...inherited,...merged.conflicts].map(conflict=>[S.stableStringify(conflict),copy(conflict)])).values()];
                    const after={...before,unitId,values:merged.values,reviewed:pending?{...reviewed,...before?.reviewed}:reviewed,saved:pending?true:remote.saved!==false,
                        outdated:remote.outdated||Object.keys(remote.provenance?.requiredReview||{}),provenance:copy(remote.provenance||before?.provenance||{}),
                        revision:(before?.revision||0)+1,serverRevision:revision,baseRevision:revision,remoteBase:accepted,conflicts,savedAt:remote.updatedAt||Date.now(),origin:'shared'};
                    put(tx,stores.saved,scope,unitId,after);
                    await learnMemory(tx,captured.scope,unit,{...after,values,reviewed,saved:remote.saved!==false,conflicts:inherited},'remote:'+revision+':'+unitId,'shared');
                    if(pending&&!pending.predecessor&&!['sending','uncertain'].includes(pending.state)){
                        pending.values=copy(after.values);pending.reviewed=copy(after.reviewed);pending.baseRevision=revision;pending.base=accepted;
                        pending.state=merged.conflicts.length?'conflict':'queued';put(tx,stores.outbox,scope,unitId,pending,{unitKey:key(scope,unitId)});
                    }
                    put(tx,stores.history,scope,'remote:'+revision+':'+unitId,{unitId,before:before||null,after,origin:'shared',createdAt:Date.now()},{unitKey:key(scope,unitId)});changed.push(unitId);
                }
                if(!Array.isArray(input)&&own(input,'sequence')){if(!Number.isSafeInteger(input.sequence)||input.sequence<(metadata.sequence||0))throw new Error('ClientText event cursor moved backwards.');metadata.sequence=input.sequence;}
                put(tx,stores.meta,scope,'meta',metadata,{accountId:captured.scope.accountId});return {changed,sequence:metadata.sequence||0};
            },options);
        }
        async function acknowledge(rawScope,operation,remote,options={}){
            const scope=capture(rawScope).id,unitId=operation.unitId;
            return transaction([stores.originals,stores.saved,stores.outbox],'readwrite',async tx=>{
                const row=await get(tx,stores.saved,key(scope,unitId)),pending=await get(tx,stores.outbox,key(scope,unitId));
                if(!row)return null;
                const revision=Number(remote?.revision||remote?.unit?.revision||0);
                if(!Number.isSafeInteger(revision)||revision<1)throw new Error('ClientText save acknowledgement has no durable revision.');
                const accepted={unitId,values:copy(remote?.values||remote?.unit?.values||operation.values),reviewed:copy(remote?.reviewed||remote?.unit?.reviewed||operation.reviewed),revision};
                if((row.serverRevision||0)<=revision){row.serverRevision=revision;row.baseRevision=revision;row.remoteBase=accepted;
                    if(remote?.outdated||remote?.provenance?.requiredReview)row.outdated=remote.outdated||Object.keys(remote.provenance.requiredReview);
                    if(remote?.provenance)row.provenance=copy(remote.provenance);put(tx,stores.saved,scope,unitId,row);}
                if(!pending)return row;
                if(pending.mutationId===operation.mutationId&&!pending.predecessor)del(tx,stores.outbox,scope,unitId);
                else{
                    let cursor=pending;while(cursor.predecessor&&cursor.predecessor.mutationId!==operation.mutationId)cursor=cursor.predecessor;
                    if(cursor.predecessor?.mutationId===operation.mutationId)delete cursor.predecessor;
                    pending.baseRevision=revision;pending.base=accepted;
                    if(!pending.predecessor)pending.state='queued';
                    put(tx,stores.outbox,scope,unitId,pending,{unitKey:key(scope,unitId)});
                }
                return row;
            },options);
        }
        return { import:importContent,importContent,save,getMetadata,getUnits,getCompactUnits,getUnit,getSaved,getAsset,getProof,putDraft,getDraft,discardDraft,
            listHistory,listWorkspaces,getOutbox,markSending,applyRemote,acknowledge,putRequest,getRequest,listRequests,deleteRequest,getMemory,getMemoryHistory,normalizeScope,scopeKey };
    }
    return { stores,names,upgrade,normalizeScope,scopeKey,create };
});
