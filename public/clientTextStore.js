/* Trusted ClientText originals are reusable; authored work remains fully scoped. */
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
        memory: 'clienttext_memory', memoryHistory: 'clienttext_memory_history',
        cacheMeta: 'clienttext_original_caches', cacheAssets: 'clienttext_original_assets', cacheUnits: 'clienttext_original_units' };
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
        const originalViews = new Map(), migrations = new Map();
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
        const guard = options => {
            if(options?.signal?.aborted)throw Object.assign(new Error('ClientText work was cancelled.'),{name:'AbortError',stale:true});
            if(options?.guard && !options.guard())throw Object.assign(new Error('ClientText context changed.'),{stale:true});
        };
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
                    options?.onProgress?.({phase:'loading-cached-originals',processed:output.length,total:options.total,
                        sheet:page.at(-1)?.value?.unit?.sheet || ''});
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
            let metadata = await one(scope, stores.meta, 'meta', options);
            if (!metadata || metadata.state !== 'ready') throw Object.assign(new Error('ClientText originals are still being prepared.'), { code: 'CLIENTTEXT_NOT_READY' });
            if (!metadata.originalCaches || metadata.cacheMigration!=='complete') metadata = await migrateWorkspace(metadata, options);
            return metadata;
        }
        const cacheOptions = asset => ({schemaHash:asset.schemaHash || asset.descriptor?.schemaHash,importOptionsHash:asset.importOptionsHash || asset.descriptor?.importOptionsHash});
        function cacheIdentity(asset, descriptor) {
            const hash=asset.hash || asset.assetHash || asset.artifactHash || descriptor?.assetHash;
            const parserVersion=asset.parserVersion || asset.parsed?.parserVersion || descriptor?.parserVersion || S.PARSER_VERSION;
            if(descriptor && (descriptor.assetHash!==hash || descriptor.role!==asset.role || descriptor.parserVersion!==parserVersion))throw new Error('ClientText original differs from its descriptor.');
            return {hash,parserVersion,id:S.originalCacheKey(hash,parserVersion,asset.role,cacheOptions({...asset,descriptor}))};
        }
        async function cacheOriginal(units,asset,descriptor,options={}) {
            const identity=cacheIdentity(asset,descriptor),id=identity.id;
            if(!Array.isArray(units) || !units.length || units.length!==descriptor.unitCount)throw new Error('ClientText original record count differs from its descriptor.');
            let metadata=await one(id,stores.cacheMeta,'meta',options);
            if(metadata && metadata.unitCount!==units.length)throw new Error('The immutable ClientText cache has a different record count.');
            if(metadata?.state==='ready')return {cacheKey:id,summary:metadata.summary};
            const summary=S.emptySummary(),sheets=new Map(),used=new Set();
            const parsed={...asset.parsed,parserVersion:identity.parserVersion,units:undefined};
            const originalAsset={...asset,hash:identity.hash,assetHash:identity.hash,parserVersion:identity.parserVersion,parsed};
            delete originalAsset.tree;delete originalAsset.treeStorage;delete originalAsset.descriptor;delete originalAsset.cacheKey;
            await transaction([stores.cacheMeta,stores.cacheAssets],'readwrite',async tx=>{
                const current=await get(tx,stores.cacheMeta,key(id,'meta'));
                if(current && current.unitCount!==units.length)throw new Error('ClientText cache changed during preparation.');
                put(tx,stores.cacheAssets,id,'asset',originalAsset);
                put(tx,stores.cacheMeta,id,'meta',{cacheKey:id,hash:identity.hash,parserVersion:identity.parserVersion,role:asset.role,state:current?.state||'importing',imported:current?.imported||0,unitCount:units.length});
            },options);
            let imported=metadata?.imported||0;
            for(let start=0;start<units.length;start+=128){
                guard(options);const batch=units.slice(start,start+128).map(input=>{
                    const unit=S.normalizeUnit(input);
                    if(unit.role!==asset.role || used.has(unit.id))throw new Error('Duplicate or misplaced ClientText original unit.');
                    used.add(unit.id);S.addOriginalSummary(summary,unit);
                    const sheet=sheets.get(unit.sheet)||{role:unit.role,name:unit.sheet,unitCount:0,visibleCount:0,workloadCount:0};
                    sheet.unitCount++;sheet.visibleCount+=Number(unit.fields.some(field=>field.kind!=='gender' && field.source.trim()));
                    sheet.workloadCount+=Number(unit.fields.some(field=>field.originalMissing || field.outdated));sheets.set(unit.sheet,sheet);
                    return unit;
                });
                // Cache inputs can arrive in worksheet order on a fresh parse,
                // or ID order when migrating a legacy workspace. An incomplete
                // cache's numeric progress cannot identify which IDs exist.
                // Rewriting bounded immutable batches makes either retry safe.
                await transaction([stores.cacheMeta,stores.cacheUnits],'readwrite',async tx=>{
                    const current=await get(tx,stores.cacheMeta,key(id,'meta'));
                    if(!current || current.unitCount!==units.length)throw new Error('ClientText cache preparation lost ownership.');
                    for(const unit of batch)put(tx,stores.cacheUnits,id,unit.id,{unit});
                    current.imported=Math.max(current.imported||0,start+batch.length);put(tx,stores.cacheMeta,id,'meta',current);
                },options);
                imported=Math.max(imported,start+batch.length);
                options.onProgress?.({phase:'storage',processed:imported,total:units.length,sheet:batch.at(-1)?.sheet});await pause();
            }
            await transaction([stores.cacheMeta,stores.cacheUnits],'readwrite',async tx=>{
                const current=await get(tx,stores.cacheMeta,key(id,'meta'));
                if(current?.imported!==units.length)throw new Error('ClientText original cache is incomplete.');
                const stored=await request(tx.objectStore(stores.cacheUnits).index('by_scope').count(id));
                if(stored!==units.length)throw new Error('ClientText original cache durable record count differs.');
                put(tx,stores.cacheMeta,id,'meta',{...current,state:'ready',summary,sheets:[...sheets.values()]});
            },options);
            originalViews.delete(id);return {cacheKey:id,summary};
        }
        async function getCachedOriginal(assetHash,parserVersion,role,options={}) {
            return readOriginalCache(S.originalCacheKey(assetHash,parserVersion,role,options),options);
        }
        async function readOriginalCache(id,options={}) {
            const metadata=await one(id,stores.cacheMeta,'meta',options);
            if(metadata?.state!=='ready')return null;
            if(originalViews.has(id)){guard(options);const value=originalViews.get(id);originalViews.delete(id);originalViews.set(id,value);options.onProgress?.({phase:'loading-cached-originals',processed:value.units.length,total:value.units.length,sheet:value.units.at(-1)?.sheet});return value;}
            const units=await readRows(id,stores.cacheUnits,row=>row.value.unit,{...options,total:metadata.unitCount}),asset=await one(id,stores.cacheAssets,'asset',options);
            if(!asset || units.length!==metadata.unitCount)throw new Error('ClientText original cache is incomplete.');
            const result={units,asset,summary:metadata.summary,sheets:metadata.sheets,cacheKey:id};
            // These arrays are immutable baselines. Editors modify separate
            // values/drafts; two retained workbook views bound warm-cache memory.
            originalViews.set(id,result);while(originalViews.size>(dependencies.originalCacheEntries||2))originalViews.delete(originalViews.keys().next().value);
            return result;
        }
        async function cleanupLegacy(scope,options={}) {
            // Delete only redundant originals/proofs after complete caches and
            // exact pending legacy request bodies have committed durably.
            const range=dependencies.keyRange || root.IDBKeyRange,prefix=JSON.stringify([scope]).slice(0,-1)+',',upper=prefix+'\uffff';
            for(const name of [stores.originals,stores.assets])await transaction([name],'readwrite',async tx=>{
                const store=tx.objectStore(name);let last;
                while(true){const page=await request(store.getAll(range.bound(last||prefix,upper,!!last,false),128));
                    for(const row of page)store.delete(row.key);if(page.length<128)break;last=page.at(-1).key;}
            },options);
        }
        async function freezeLegacyOutbox(rawScope,units,options={}) {
            const scope=capture(rawScope).id,byId=new Map(units.map(unit=>[unit.id,unit]));
            const pending=await rows(scope,stores.outbox,options);
            for(const operation of pending){
                let changed=false;for(let item=operation;item;item=item.predecessor){
                    if(item.storageProtocol===S.STORAGE_PROTOCOL || item.requestBody)continue;
                    const baseline=byId.get(item.unitId);if(!baseline)throw new Error('A pending ClientText save has no retained original.');
                    const witness=await getLegacyProof(rawScope,item.unitId,options);
                    item.requestBody={mutationId:item.mutationId,baseRevision:item.baseRevision||0,values:copy(item.values),reviewed:copy(item.reviewed||{}),baseline:copy(baseline),proof:witness.proof};changed=true;
                }
                if(changed)await transaction([stores.outbox],'readwrite',async tx=>{
                    const current=await get(tx,stores.outbox,key(scope,operation.unitId));
                    if(S.stableStringify({...operation,requestBody:undefined})!==S.stableStringify({...current,requestBody:undefined})){
                        // A concurrent save can replace the queue; retry migration
                        // instead of overwriting newer authored work.
                        const withoutBodies=value=>{const next=copy(value);for(let item=next;item;item=item.predecessor)delete item.requestBody;return next;};
                        if(S.stableStringify(withoutBodies(operation))!==S.stableStringify(withoutBodies(current)))throw Object.assign(new Error('ClientText pending saves changed during cache migration.'),{code:'CLIENTTEXT_MIGRATION_RETRY'});
                    }
                    put(tx,stores.outbox,scope,operation.unitId,operation,{unitKey:key(scope,operation.unitId)});
                },options);
            }
        }
        async function migrateWorkspace(rawScope,options={}) {
            const captured=capture(rawScope),scope=captured.id;
            let metadata=await one(scope,stores.meta,'meta',options);
            if(!metadata || metadata.state!=='ready')return metadata;
            if(metadata.originalCaches){
                if(metadata.cacheMigration!=='complete'){
                    await cleanupLegacy(scope,options);
                    metadata=await transaction([stores.meta],'readwrite',async tx=>{const current=await get(tx,stores.meta,key(scope,'meta'));current.cacheMigration='complete';put(tx,stores.meta,scope,'meta',current,{accountId:captured.scope.accountId});return current;},options);
                }
                return metadata;
            }
            if(migrations.has(scope))return migrations.get(scope);
            const migration=(async()=>{
                const units=await readRows(scope,stores.originals,row=>row.value.unit,options);
                if(units.length!==metadata.unitCount)throw new Error('Legacy ClientText originals are incomplete; recovery data is retained.');
                const bindings={},summaries={},assetNames={},descriptors=metadata.descriptors||[];
                for(const role of [...new Set(units.map(unit=>unit.role))]){
                    const asset=await one(scope,stores.assets,role,options),descriptor=descriptors.find(value=>value.role===role)||asset?.descriptor;
                    if(!asset || !descriptor)throw new Error('Legacy ClientText original metadata is unavailable; recovery data is retained.');
                    const cached=await cacheOriginal(units.filter(unit=>unit.role===role),asset,descriptor,options);bindings[role]=cached.cacheKey;summaries[role]=cached.summary;assetNames[role]=asset.name || asset.parsed?.filename;
                }
                await freezeLegacyOutbox(rawScope,units,options);
                metadata=await transaction([stores.meta],'readwrite',async tx=>{
                    const current=await get(tx,stores.meta,key(scope,'meta'));
                    if(current.signature!==metadata.signature || current.state!=='ready')throw new Error('ClientText workspace changed during cache migration.');
                    const next={...current,storageProtocol:S.STORAGE_PROTOCOL,originalCaches:bindings,summaries,descriptors:copy(descriptors),assetNames,cacheMigration:'ready'};
                    put(tx,stores.meta,scope,'meta',next,{accountId:captured.scope.accountId});return next;
                },options);
                await cleanupLegacy(scope,options);
                metadata=await transaction([stores.meta],'readwrite',async tx=>{const current=await get(tx,stores.meta,key(scope,'meta'));current.cacheMigration='complete';put(tx,stores.meta,scope,'meta',current,{accountId:captured.scope.accountId});return current;},options);return metadata;
            })();migrations.set(scope,migration);
            try{return await migration;}finally{migrations.delete(scope);}
        }
        async function importContent(rawScope,input,options={}) {
            const captured=capture(rawScope),scope=captured.id;guard(options);
            if(!Array.isArray(input?.units)||!input.units.length)throw new TypeError('ClientText import contains no units.');
            const assets=Array.isArray(input.assets)?input.assets:Object.entries(input.assets||{}).map(([role,asset])=>({role,...asset}));
            const built=input.descriptors?{descriptors:input.descriptors,summaries:input.summaries}:input.manifest?{descriptors:input.manifest.descriptors}:await S.buildDescriptors(input.units,assets,options);
            const descriptors=built.descriptors,signature=S.hash({descriptors,unitCount:input.units.length});
            const existing=await one(scope,stores.meta,'meta',options);
            if(existing && existing.signature!==signature)throw new Error('ClientText originals are immutable. Import a changed workbook as a new source group.');
            if(existing?.state==='ready')return migrateWorkspace(rawScope,options);
            const bindings={},summaries={};
            for(const asset of assets){
                const descriptor=descriptors.find(value=>value.role===asset.role);if(!descriptor)throw new Error('ClientText original descriptor is unavailable.');
                const cached=await cacheOriginal(input.units.filter(unit=>unit.role===asset.role),asset,descriptor,options);bindings[asset.role]=cached.cacheKey;summaries[asset.role]=cached.summary;
            }
            if(Object.values(summaries).reduce((total,value)=>total+value.loaded,0)!==input.units.length)throw new Error('ClientText original bundle has unassigned units.');
            await freezeLegacyOutbox(rawScope,input.units,options);
            await transaction([stores.meta],'readwrite',async tx=>{
                const current=await get(tx,stores.meta,key(scope,'meta'));if(current && current.signature!==signature)throw new Error('ClientText import changed in another tab.');
                put(tx,stores.meta,scope,'meta',{...copy(input.metadata||{}),...captured.scope,state:'ready',storageProtocol:S.STORAGE_PROTOCOL,signature,
                    originalCaches:bindings,summaries,descriptors:copy(descriptors),assetNames:Object.fromEntries(assets.map(asset=>[asset.role,asset.name || asset.parsed?.filename])),imported:input.units.length,unitCount:input.units.length,createdAt:current?.createdAt||Date.now(),sequence:current?.sequence||0},{accountId:captured.scope.accountId});
            },options);
            await cleanupLegacy(scope,options);
            return transaction([stores.meta],'readwrite',async tx=>{const current=await get(tx,stores.meta,key(scope,'meta'));current.cacheMigration='complete';put(tx,stores.meta,scope,'meta',current,{accountId:captured.scope.accountId});return current;},options);
        }
        async function getUnits(rawScope, options = {}) {
            const metadata=await requireReady(capture(rawScope).id,options),units=[];
            for(const descriptor of metadata.descriptors){
                const cached=await readOriginalCache(metadata.originalCaches[descriptor.role],options);
                if(!cached || cached.units.length!==descriptor.unitCount)throw new Error('ClientText workspace original cache is incomplete.');
                for(const unit of cached.units)units.push(unit);
            }
            if(units.length!==metadata.unitCount)throw new Error('ClientText workspace original count differs.');return units;
        }
        async function getCompactUnits(rawScope,options={}){
            const scope=capture(rawScope).id,metadata=await requireReady(scope,options);
            const units=(await getUnits(rawScope,options)).map(S.clientFacts);
            if(units.length!==metadata.unitCount)throw new Error('ClientText immutable manifest is incomplete.');
            return units;
        }
        const cacheForUnit=(metadata,unitId)=>metadata.originalCaches?.[JSON.parse(unitId)[0]];
        async function getUnit(rawScope, unitId, options) {
            const metadata=await requireReady(capture(rawScope).id,options),cache=cacheForUnit(metadata,unitId);
            return cache ? (await one(cache,stores.cacheUnits,unitId,options))?.unit : undefined;
        }
        async function getSaved(rawScope, options) { return Object.fromEntries((await rows(capture(rawScope).id,stores.saved,options)).map(row => [row.unitId,row])); }
        async function getAsset(rawScope, role = 'normal', options) {
            const metadata=await requireReady(capture(rawScope).id,options),descriptor=metadata.descriptors.find(item=>item.role===role);
            const id=metadata.originalCaches?.[role];if(!id)return undefined;
            const asset=await one(id,stores.cacheAssets,'asset',options);if(!asset)throw new Error('ClientText retained original is unavailable.');
            const name=metadata.assetNames?.[role] || metadata.group?.assets?.find(item=>item.role===role)?.filename || asset.name;
            return {...asset,name,parsed:{...asset.parsed,filename:name},descriptor,cacheKey:id};
        }
        async function getLegacyAsset(rawScope, role = 'normal', options) {
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
        async function getLegacyProof(rawScope, unitId, options) {
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
        async function getProof(rawScope,unitId,options){
            const metadata=await requireReady(capture(rawScope).id,options),pending=await one(capture(rawScope).id,stores.outbox,unitId,options);
            for(let item=pending;item;item=item.predecessor)if(item.requestBody?.proof)return {descriptor:metadata.descriptors.find(value=>value.role===JSON.parse(unitId)[0]),proof:copy(item.requestBody.proof)};
            throw new Error('Trusted ClientText saves do not use baseline membership proofs.');
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
        const getDraftSummaries=(rawScope,options)=>readRows(capture(rawScope).id,stores.drafts,row=>({
            unitId:row.value.unitId,revision:row.value.revision,updatedAt:row.value.updatedAt
        }),options);
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
            if(own(input,'origin') && !['save','restore'].includes(input.origin))throw new TypeError('ClientText save origin must be save or restore.');
            const metadata=await requireReady(scope,options);
            const unit=await getUnit(rawScope,unitId,options);if(!unit)throw new Error('ClientText save source is unavailable.');
            const values=S.normalizeValues(unit,input.values), reviewed=S.normalizeReviewed(unit,input.reviewed||{});
            const command={scope:captured.scope,unitId,values,reviewed,
                ...(own(input,'origin')?{origin:input.origin}:{}),
                ...(own(input,'baseRevision')?{baseRevision:input.baseRevision}:{}),
                ...(own(input,'expectedRevision')?{expectedRevision:input.expectedRevision}:{}),
                ...(own(input,'expectedDraftRevision')?{expectedDraftRevision:input.expectedDraftRevision}:{})};
            const signature=S.hash(command);
            return transaction([stores.meta,stores.cacheUnits,stores.saved,stores.drafts,stores.history,stores.outbox,stores.receipts,stores.memory,stores.memoryHistory],'readwrite',async tx=>{
                const receipt=await get(tx,stores.receipts,key(scope,input.jobId));
                if(receipt){if(receipt.signature!==signature)throw Object.assign(new Error('ClientText job ID was reused for different content.'),{code:'SAVE_RECEIPT_MISMATCH'});return {saved:receipt.saved,receipt,replayed:true};}
                const currentMetadata=await get(tx,stores.meta,key(scope,'meta'));
                const original=await get(tx,stores.cacheUnits,key(cacheForUnit(currentMetadata,unitId),unitId));
                if(!original || currentMetadata.signature!==metadata.signature)throw new Error('ClientText original changed while saving.');
                const before=await get(tx,stores.saved,key(scope,unitId)),draft=await get(tx,stores.drafts,key(scope,unitId));
                if(own(input,'expectedRevision')&&(before?.revision||0)!==input.expectedRevision)throw Object.assign(new Error('Another tab changed the ClientText saved translation.'),{code:'UNIT_CHANGED'});
                if(own(input,'expectedDraftRevision')&&(draft?.revision||null)!==input.expectedDraftRevision)throw Object.assign(new Error('Another tab changed this ClientText draft.'),{code:'DRAFT_CHANGED'});
                const after={unitId,values,reviewed:{...before?.reviewed,...reviewed},saved:true,revision:(before?.revision||0)+1,
                    serverRevision:before?.serverRevision||input.baseRevision||0,baseRevision:before?.serverRevision||input.baseRevision||0,
                    savedAt:Date.now(),jobId:input.jobId,origin:input.origin||options.origin||'save',outdated:before?.outdated||[]};
                put(tx,stores.saved,scope,unitId,after);
                await learnMemory(tx,captured.scope,unit,after,input.jobId,after.origin);
                put(tx,stores.history,scope,input.jobId,{id:input.jobId,unitId,before:before||null,after,origin:after.origin,createdAt:after.savedAt},{unitKey:key(scope,unitId)});
                if(own(input,'expectedDraftRevision'))del(tx,stores.drafts,scope,unitId);
                if(options.sync!==false){
                    const pending=await get(tx,stores.outbox,key(scope,unitId));
                    const descriptor=metadata.descriptors.find(value=>value.role===unit.role);
                    const operation={unitId,mutationId:input.jobId,storageProtocol:S.STORAGE_PROTOCOL,role:unit.role,assetHash:descriptor.assetHash,parserVersion:descriptor.parserVersion,
                        ...(own(input,'origin')?{origin:input.origin}:{}),
                        clientFacts:S.clientFacts(unit),originalValues:S.originalValues(unit),values:copy(values),reviewed:copy(after.reviewed),baseRevision:after.serverRevision,
                        base:pending?.base||{values:before?.values||S.valuesFor(unit),reviewed:before?.reviewed||{},revision:after.serverRevision},state:'queued',createdAt:Date.now()};
                    // An uncertain submission remains byte-identical until its
                    // receipt arrives. The newer local save waits behind it.
                    if(pending&&['sending','uncertain'].includes(pending.state))operation.predecessor=copy(pending);
                    else if(pending?.predecessor)operation.predecessor=copy(pending.predecessor);
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
            await requireReady(scope,options);
            return transaction([stores.meta,stores.cacheUnits,stores.saved,stores.outbox,stores.history,stores.memory,stores.memoryHistory],'readwrite',async tx=>{
                const metadata=await get(tx,stores.meta,key(scope,'meta'));if(!metadata||metadata.state!=='ready')throw new Error('ClientText source is not ready.');
                const changed=[];
                for(const event of events){
                    const remote=event.unit||event.file||event.state||event,unitId=event.unitId||remote.unitId||remote.id;
                    if(!unitId||!remote.values)continue;
                    const original=await get(tx,stores.cacheUnits,key(cacheForUnit(metadata,unitId),unitId));if(!original)throw new Error('Server supplied a unit absent from this ClientText source.');
                    const unit=original.unit,values=S.normalizeValues(unit,remote.values),reviewed=S.normalizeReviewed(unit,remote.reviewed||{});
                    const before=await get(tx,stores.saved,key(scope,unitId)),pending=await get(tx,stores.outbox,key(scope,unitId));
                    const revision=Number(remote.revision||event.revision||0);
                    if(!Number.isSafeInteger(revision)||revision<1)throw new Error('Invalid ClientText shared revision.');
                    if(before?.serverRevision>revision)continue;
                    if(before?.serverRevision===revision&&S.stableStringify(before.remoteBase?.values||before.values)===S.stableStringify(values))continue;
                    const sharedOrigin=remote.origin==='restore'?'restore':'shared';
                    const accepted={unitId,values,reviewed,revision,...(own(remote,'origin')?{origin:remote.origin}:{})},merged=pending?mergeRemote(unit,before,pending.base,accepted):{values,conflicts:[]};
                    const inherited=remote.conflicts||remote.provenance?.conflicts||[];
                    const conflicts=[...new Map([...inherited,...merged.conflicts].map(conflict=>[S.stableStringify(conflict),copy(conflict)])).values()];
                    const after={...before,unitId,values:merged.values,reviewed:pending?{...reviewed,...before?.reviewed}:reviewed,saved:pending?true:remote.saved!==false,
                        outdated:remote.outdated||Object.keys(remote.provenance?.requiredReview||{}),provenance:copy(remote.provenance||before?.provenance||{}),
                        revision:(before?.revision||0)+1,serverRevision:revision,baseRevision:revision,remoteBase:accepted,conflicts,savedAt:remote.updatedAt||Date.now(),origin:sharedOrigin};
                    put(tx,stores.saved,scope,unitId,after);
                    await learnMemory(tx,captured.scope,unit,{...after,values,reviewed,saved:remote.saved!==false,conflicts:inherited},'remote:'+revision+':'+unitId,'shared');
                    if(pending&&!pending.predecessor&&!['sending','uncertain'].includes(pending.state)){
                        pending.values=copy(after.values);pending.reviewed=copy(after.reviewed);pending.baseRevision=revision;pending.base=accepted;
                        pending.state=merged.conflicts.length?'conflict':'queued';put(tx,stores.outbox,scope,unitId,pending,{unitKey:key(scope,unitId)});
                    }
                    put(tx,stores.history,scope,'remote:'+revision+':'+unitId,{unitId,before:before||null,after,origin:sharedOrigin,createdAt:Date.now()},{unitKey:key(scope,unitId)});changed.push(unitId);
                }
                if(!Array.isArray(input)&&own(input,'sequence')){if(!Number.isSafeInteger(input.sequence)||input.sequence<(metadata.sequence||0))throw new Error('ClientText event cursor moved backwards.');metadata.sequence=input.sequence;}
                put(tx,stores.meta,scope,'meta',metadata,{accountId:captured.scope.accountId});return {changed,sequence:metadata.sequence||0};
            },options);
        }
        async function acknowledge(rawScope,operation,remote,options={}){
            const scope=capture(rawScope).id,unitId=operation.unitId;
            return transaction([stores.saved,stores.outbox],'readwrite',async tx=>{
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
        return { import:importContent,importContent,save,getMetadata,getUnits,getCompactUnits,getUnit,getSaved,getAsset,getProof,getCachedOriginal,migrateWorkspace,putDraft,getDraft,getDraftSummaries,discardDraft,
            listHistory,listWorkspaces,getOutbox,markSending,applyRemote,acknowledge,putRequest,getRequest,listRequests,deleteRequest,getMemory,getMemoryHistory,normalizeScope,scopeKey };
    }
    return { stores,names,upgrade,normalizeScope,scopeKey,create };
});
