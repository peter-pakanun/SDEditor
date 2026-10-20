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
    const mtlStorage = () => root.ClientTextMtlStore || (typeof require === 'function' ? require('./clientTextMtlStore.js') : null);
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
    const isLocal = scope => String(scope?.groupId || '').startsWith('local:test:');
    const scopeFromKey = id => Object.fromEntries(['accountId','game','branchId','versionId','groupId','language'].map((name,index)=>[name,JSON.parse(id)[index]]));
    const corrupt = message => Object.assign(new Error('Local workbook recovery data is invalid: ' + message + '. The stored data has been retained.'), {code:'CLIENTTEXT_LOCAL_INVALID'});
    function validateLocalMetadata(scope, value) {
        if (!value || !isLocal(scope)) return value;
        if (scopeKey(value) !== scopeKey(scope) || value.state !== 'ready' || !Number.isSafeInteger(value.unitCount) || value.unitCount < 1
            || !Array.isArray(value.descriptors) || !value.descriptors.length || value.descriptors.length > 2) throw corrupt('workspace identity or readiness');
        const roles=new Set();let count=0;
        for(const descriptor of value.descriptors){
            if(roles.has(descriptor.role) || !Number.isSafeInteger(descriptor.unitCount) || descriptor.unitCount<1)throw corrupt('original descriptors');
            let cache;try{cache=S.originalCacheKey(descriptor.assetHash,descriptor.parserVersion,descriptor.role,descriptor);}catch(_){throw corrupt('original identity');}
            if(value.originalCaches?.[descriptor.role]!==cache)throw corrupt('original cache binding');
            roles.add(descriptor.role);count+=descriptor.unitCount;
        }
        if(count!==value.unitCount || value.signature!==S.hash({descriptors:value.descriptors,unitCount:value.unitCount}))throw corrupt('workspace signature');
        if(value.version && value.version.id!==scope.versionId || value.group && (value.group.id!==scope.groupId || value.group.versionId!==scope.versionId))throw corrupt('version binding');
        return value;
    }
    function validateLocalUnit(unit, expectedId) {
        if(!unit || typeof unit.id!=='string' || unit.id!==expectedId || unit.id!==JSON.stringify([unit.role,unit.sheet,unit.recordId])
            || !['normal','gender'].includes(unit.role) || typeof unit.sheet!=='string' || typeof unit.recordId!=='string'
            || !Array.isArray(unit.fields) || unit.fields.some(field=>!field || typeof field.source!=='string' || typeof field.target!=='string'
                || typeof field.sourceCell!=='string' || typeof field.targetCell!=='string'))throw corrupt('original unit');
        try{S.normalizeUnit(unit);}catch(_){throw corrupt('original fields');}
        return unit;
    }
    function validateLocalRecord(unit, value, {draft=false, historical=false}={}) {
        if(!value)return value;
        if(!unit || value.unitId!==unit.id || !Number.isSafeInteger(value.revision) || value.revision<(historical?0:1)
            || !draft && !historical && typeof value.saved!=='boolean')throw corrupt(draft?'draft identity':'saved record identity');
        try{S.normalizeValues(unit,value.values);S.normalizeReviewed(unit,value.reviewed || {});}catch(_){throw corrupt(draft?'draft fields':'saved fields');}
        if(value.outdated && (!Array.isArray(value.outdated) || value.outdated.some(id=>!unit.fields.some(field=>field.id===id))))throw corrupt('source review fields');
        if(value.provenance?.requiredReview)try{S.normalizeReviewed(unit,value.provenance.requiredReview);}catch(_){throw corrupt('required source reviews');}
        return value;
    }
    function upgrade(db, tx) {
        for (const name of names) {
            const store = db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath: 'key' });
            if (!store.indexNames.contains('by_scope')) store.createIndex('by_scope', 'scope');
            if (name === stores.meta && !store.indexNames.contains('by_account')) store.createIndex('by_account', 'accountId');
            if ([stores.history,stores.drafts,stores.outbox,stores.memoryHistory].includes(name) && !store.indexNames.contains('by_unit')) store.createIndex('by_unit', 'unitKey');
        }
        mtlStorage()?.upgrade(db, tx);
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
            // Local workbook learning is private to this exact workspace. It
            // must not become account TM merely because Dictionary/TM sync is on.
            return {scope,id:isLocal(input)?scopeKey(input):key(scope.accountId,scope.game,scope.language)};
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
            const selectedNames=[...new Set(selected)];let tx;
            // Request a disk-flushed commit where supported; completion, rather
            // than the last successful request, remains the acknowledgement.
            try{tx=db.transaction(selectedNames,mode,mode==='readwrite'?{durability:'strict'}:{});}
            catch(error){if(!(error instanceof TypeError))throw error;tx=db.transaction(selectedNames,mode);}
            const done = completed(tx);
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
        async function getMetadata(rawScope, options) {
            const captured=capture(rawScope),value=await one(captured.id,stores.meta,'meta',options);
            return validateLocalMetadata(captured.scope,value);
        }
        async function seedMemory(rawScope, entries, options={}) {
            const captured=capture(rawScope);
            if(!isLocal(captured.scope))throw new TypeError('Only local workbooks accept a private TM seed.');
            await requireReady(captured.id,options);
            const accepted=(entries || []).filter(entry=>entry.context?.contentMode==='clienttext'
                && (!entry.language || entry.language===captured.scope.language) && [captured.scope.game,'all'].includes(entry.gameScope));
            return transaction([stores.meta,stores.memory],'readwrite',async tx=>{
                const metadata=await get(tx,stores.meta,key(captured.id,'meta'));validateLocalMetadata(captured.scope,metadata);
                if(metadata.memorySeeded)return;
                for(const entry of accepted){
                    if(typeof entry.id!=='string' || typeof entry.source!=='string' || typeof entry.target!=='string')throw corrupt('private TM seed');
                    if(!await get(tx,stores.memory,key(captured.id,entry.id)))put(tx,stores.memory,captured.id,entry.id,copy(entry));
                }
                metadata.memorySeeded=true;put(tx,stores.meta,captured.id,'meta',metadata,{accountId:captured.scope.accountId});
            },options);
        }
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
            validateLocalMetadata(scopeFromKey(scope),metadata);
            if (!metadata.originalCaches || metadata.cacheMigration!=='complete') metadata = await migrateWorkspace(metadata, options);
            validateLocalMetadata(scopeFromKey(scope),metadata);
            if(isLocal(metadata) && metadata.localRestorePending)throw Object.assign(new Error('Local workbook restoration is incomplete. Its recovery data is retained; restore the backup again as a new workspace.'),{code:'CLIENTTEXT_NOT_READY'});
            return metadata;
        }
        const cacheOptions = asset => ({schemaHash:asset.schemaHash || asset.descriptor?.schemaHash,importOptionsHash:asset.importOptionsHash || asset.descriptor?.importOptionsHash});
        async function verifyLocalAsset(asset,descriptor) {
            if(!asset || cacheIdentity(asset,descriptor).hash!==descriptor.assetHash)throw corrupt('original asset binding');
            const binary=asset.blob || asset.bytes || asset.buffer;
            if(!binary || !(binary instanceof Blob || binary instanceof ArrayBuffer || ArrayBuffer.isView(binary)))throw corrupt('original workbook bytes');
            const bytes=binary instanceof Blob ? await binary.arrayBuffer() : ArrayBuffer.isView(binary)
                ? binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength) : binary;
            const hash=root.crypto?.subtle ? [...new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('') : S.sha256(bytes);
            if(hash!==descriptor.assetHash)throw corrupt('original workbook byte hash');
            return new Blob([bytes],{type:binary.type || ''});
        }
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
        async function preparePreviousVersion(rawScope,units,rawPreviousScope,options={}) {
            const captured=capture(rawScope),previous=capture(rawPreviousScope);
            if(!isLocal(captured.scope) || !isLocal(previous.scope) || captured.id===previous.id
                || ['accountId','game','branchId','language'].some(name=>captured.scope[name]!==previous.scope[name]))throw new TypeError('Previous local workbooks must match the account, game, branch and language.');
            const previousUnits=new Map((await getUnits(previous.scope,options)).map(unit=>[unit.id,unit])),records=[];
            for(let index=0;index<units.length;index++){
                guard(options);const unit=units[index],old=previousUnits.get(unit.id);
                if(old){
                    const state=S.carryForward(old,unit,null),markerReview=S.reviewAudioMarkerChanges(old,unit,state);
                    if(state.outdated.length || markerReview){
                        const before=new Map(old.fields.map(field=>[field.id,field])),requiredReview={};
                        for(const field of unit.fields)if(before.has(field.id) && S.sourceHash(before.get(field.id).source)!==S.sourceHash(field.source)
                            && !S.audioOnly(field.source) && S.needsSourceReview(field,state.values[field.id]))requiredReview[field.id]=S.sourceHash(field.source);
                        const provenance={groupId:previous.scope.groupId,unitId:unit.id,revision:0,sourceOnly:true,requiredReview,conflicts:state.conflicts,origin:'version_import'};
                        const after={unitId:unit.id,values:state.values,reviewed:state.reviewed,saved:false,revision:1,serverRevision:0,provenance,conflicts:state.conflicts,
                            outdated:Object.keys(requiredReview).filter(id=>state.reviewed[id]!==requiredReview[id])};
                        records.push({id:'test-version-import:'+unit.id,unitId:unit.id,origin:'version_import',actor:{name:'Previous workbook sample'},createdAt:Date.now(),
                            before:{unitId:unit.id,values:S.valuesFor(unit),reviewed:{},revision:0},after});
                    }
                }
                if(index%256===255){options.onProgress?.({phase:'Comparing previous workbook',processed:index+1,total:units.length,sheet:unit.sheet});await pause();}
            }
            guard(options);return {previous,records};
        }
        async function writePreviousVersion(tx,captured,metadata,prepared){
            if(metadata.previousScope){
                if(scopeKey(metadata.previousScope)!==prepared.previous.id)throw new Error('The previous local workbook version is already selected.');
                return metadata;
            }
            for(const name of [stores.saved,stores.history,stores.drafts])if(await request(tx.objectStore(name).index('by_scope').count(captured.id)))throw new Error('Prepare the previous local workbook version before editing.');
            for(const entry of prepared.records){
                put(tx,stores.saved,captured.id,entry.unitId,entry.after);
                put(tx,stores.history,captured.id,entry.id,entry,{unitKey:key(captured.id,entry.unitId)});
            }
            metadata.previousScope=copy(prepared.previous.scope);return metadata;
        }
        async function seedPreviousVersion(rawScope,rawPreviousScope,options={}) {
            const captured=capture(rawScope),metadata=await requireReady(captured.id,options),units=await getUnits(rawScope,options),
                prepared=await preparePreviousVersion(rawScope,units,rawPreviousScope,options);
            return transaction([stores.meta,stores.saved,stores.history,stores.drafts],'readwrite',async tx=>{
                const current=await get(tx,stores.meta,key(captured.id,'meta'));
                if(current?.signature!==metadata.signature)throw new Error('Local workbook changed while comparing previous sources.');
                await writePreviousVersion(tx,captured,current,prepared);
                put(tx,stores.meta,captured.id,'meta',current,{accountId:captured.scope.accountId});return current;
            },options);
        }
        async function importContent(rawScope,input,options={}) {
            const captured=capture(rawScope),scope=captured.id;guard(options);
            if(!Array.isArray(input?.units)||!input.units.length)throw new TypeError('ClientText import contains no units.');
            const assets=(Array.isArray(input.assets)?input.assets:Object.entries(input.assets||{}).map(([role,asset])=>({role,...asset}))).map(asset=>({...asset}));
            if(isLocal(captured.scope))for(const unit of input.units)validateLocalUnit(unit,unit.id);
            const built=input.descriptors?{descriptors:input.descriptors,summaries:input.summaries}:input.manifest?{descriptors:input.manifest.descriptors}:await S.buildDescriptors(input.units,assets,options);
            const descriptors=built.descriptors,signature=S.hash({descriptors,unitCount:input.units.length});
            const existing=await one(scope,stores.meta,'meta',options);
            if(existing && existing.signature!==signature)throw new Error('ClientText originals are immutable. Import a changed workbook as a new source group.');
            if(existing?.state==='ready'){
                if(isLocal(captured.scope) && input.previousScope && (!existing.previousScope || scopeKey(existing.previousScope)!==scopeKey(input.previousScope)))throw new Error('Existing local workbook work is retained. Open a new version to choose another previous workbook.');
                return isLocal(captured.scope)?requireReady(scope,options):migrateWorkspace(rawScope,options);
            }
            const bindings={},summaries={};
            for(const asset of assets){
                const descriptor=descriptors.find(value=>value.role===asset.role);if(!descriptor)throw new Error('ClientText original descriptor is unavailable.');
                if(isLocal(captured.scope)){asset.blob=await verifyLocalAsset(asset,descriptor);guard(options);}
                const cached=await cacheOriginal(input.units.filter(unit=>unit.role===asset.role),asset,descriptor,options);bindings[asset.role]=cached.cacheKey;summaries[asset.role]=cached.summary;
            }
            if(Object.values(summaries).reduce((total,value)=>total+value.loaded,0)!==input.units.length)throw new Error('ClientText original bundle has unassigned units.');
            await freezeLegacyOutbox(rawScope,input.units,options);
            const previous=input.previousScope ? await preparePreviousVersion(rawScope,input.units,input.previousScope,options) : null;
            await transaction([stores.meta,...(previous?[stores.saved,stores.history,stores.drafts]:[])],'readwrite',async tx=>{
                const current=await get(tx,stores.meta,key(scope,'meta'));if(current && current.signature!==signature)throw new Error('ClientText import changed in another tab.');
                // Another importer may have published and started editing while
                // this one prepared immutable caches. Its metadata and work win.
                if(current?.state==='ready'){
                    if(isLocal(captured.scope) && previous && (!current.previousScope || scopeKey(current.previousScope)!==previous.previous.id))throw new Error('Existing local workbook work is retained. Open a new version to choose another previous workbook.');
                    return;
                }
                const metadata={...copy(input.metadata||{}),...captured.scope,state:'ready',storageProtocol:S.STORAGE_PROTOCOL,signature,
                    originalCaches:bindings,summaries,descriptors:copy(descriptors),assetNames:Object.fromEntries(assets.map(asset=>[asset.role,asset.name || asset.parsed?.filename])),imported:input.units.length,unitCount:input.units.length,createdAt:current?.createdAt||Date.now(),sequence:current?.sequence||0};
                if(previous)await writePreviousVersion(tx,captured,metadata,previous);
                validateLocalMetadata(captured.scope,metadata);
                put(tx,stores.meta,scope,'meta',metadata,{accountId:captured.scope.accountId});
            },options);
            await cleanupLegacy(scope,options);
            return transaction([stores.meta],'readwrite',async tx=>{const current=await get(tx,stores.meta,key(scope,'meta'));current.cacheMigration='complete';put(tx,stores.meta,scope,'meta',current,{accountId:captured.scope.accountId});return current;},options);
        }
        async function getUnits(rawScope, options = {}) {
            const metadata=await requireReady(capture(rawScope).id,options),units=[];
            const used=isLocal(rawScope)?new Set():null;
            for(const descriptor of metadata.descriptors){
                const cached=await readOriginalCache(metadata.originalCaches[descriptor.role],options);
                if(!cached || cached.units.length!==descriptor.unitCount)throw new Error('ClientText workspace original cache is incomplete.');
                for(const unit of cached.units){
                    if(used){validateLocalUnit(unit,unit?.id);if(unit.role!==descriptor.role || used.has(unit.id))throw corrupt('duplicate or misplaced original unit');used.add(unit.id);}
                    units.push(unit);
                }
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
            const unit=cache ? (await one(cache,stores.cacheUnits,unitId,options))?.unit : undefined;
            return unit && isLocal(rawScope)?validateLocalUnit(unit,unitId):unit;
        }
        async function getUnitsByIds(rawScope, unitIds, options) {
            const metadata=await requireReady(capture(rawScope).id,options),ids=[...new Set(unitIds)];
            return transaction([stores.cacheUnits],'readonly',async tx=>{
                const units=[];
                for(let start=0;start<ids.length;start+=128){
                    guard(options);
                    const batch=await Promise.all(ids.slice(start,start+128).map(async unitId=>{
                        const cache=cacheForUnit(metadata,unitId),row=cache ? await get(tx,stores.cacheUnits,key(cache,unitId)) : null;
                        if(!row?.unit || row.unit.id!==unitId || row.unit.role!==JSON.parse(unitId)[0]) throw Object.assign(new Error('Saved ClientText unit is absent from its immutable original: '+unitId+'.'), {code:'CLIENTTEXT_ORIGINAL_UNIT_MISSING'});
                        if(isLocal(rawScope))validateLocalUnit(row.unit,unitId);
                        return row.unit;
                    }));
                    units.push(...batch);
                }
                return units;
            },options);
        }
        async function getSaved(rawScope, options) {
            const saved=await rows(capture(rawScope).id,stores.saved,options);
            if(isLocal(rawScope) && saved.length){
                const originals=new Map((await getUnitsByIds(rawScope,saved.map(value=>value?.unitId),options)).map(unit=>[unit.id,unit]));
                for(const value of saved)validateLocalRecord(originals.get(value.unitId),value);
            }
            return Object.fromEntries(saved.map(row=>[row.unitId,row]));
        }
        async function getAsset(rawScope, role = 'normal', options) {
            const metadata=await requireReady(capture(rawScope).id,options),descriptor=metadata.descriptors.find(item=>item.role===role);
            const id=metadata.originalCaches?.[role];if(!id)return undefined;
            const asset=await one(id,stores.cacheAssets,'asset',options);if(!asset)throw Object.assign(new Error('ClientText retained original is unavailable.'), {code:'CLIENTTEXT_ORIGINAL_ASSET_MISSING'});
            if(isLocal(rawScope)){await verifyLocalAsset(asset,descriptor);guard(options);}
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
                if(isLocal(rawScope) && previous)validateLocalRecord(unit,previous,{draft:true});
                if(own(options,'expectedRevision')&&(previous?.revision||null)!==options.expectedRevision)throw Object.assign(new Error('Another tab changed this ClientText draft.'),{code:'DRAFT_CHANGED'});
                const draft={unitId,values,reviewed,revision:(previous?.revision||0)+1,updatedAt:Date.now(),
                    ...(input.mtlAcceptances?.length ? {mtlAcceptances:copy(input.mtlAcceptances)} : {})};
                put(tx,stores.drafts,scope,unitId,draft,{unitKey:key(scope,unitId)});return draft;
            },options);
        }
        async function getDraft(rawScope,unitId,options){
            const draft=await one(capture(rawScope).id,stores.drafts,unitId,options);
            if(isLocal(rawScope) && draft)validateLocalRecord(await getUnit(rawScope,unitId,options),draft,{draft:true});
            return draft;
        }
        const getDraftSummaries=(rawScope,options)=>readRows(capture(rawScope).id,stores.drafts,row=>{
            if(isLocal(rawScope) && (!row.value || typeof row.value.unitId!=='string' || !Number.isSafeInteger(row.value.revision) || row.value.revision<1))throw corrupt('draft summary');
            return {unitId:row.value.unitId,revision:row.value.revision,updatedAt:row.value.updatedAt};
        },options);
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
                ...(input.mtlAcceptances?.length ? {mtlAcceptances:copy(input.mtlAcceptances)} : {}),
                ...(own(input,'origin')?{origin:input.origin}:{}),
                ...(own(input,'baseRevision')?{baseRevision:input.baseRevision}:{}),
                ...(own(input,'expectedRevision')?{expectedRevision:input.expectedRevision}:{}),
                ...(own(input,'expectedDraftRevision')?{expectedDraftRevision:input.expectedDraftRevision}:{})};
            const signature=S.hash(command);
            const mtl=input.mtlAcceptances?.length ? mtlStorage() : null;
            return transaction([stores.meta,stores.cacheUnits,stores.saved,stores.drafts,stores.history,stores.outbox,stores.receipts,stores.memory,stores.memoryHistory,...(mtl?.names || [])],'readwrite',async tx=>{
                const receipt=await get(tx,stores.receipts,key(scope,input.jobId));
                if(receipt){if(receipt.signature!==signature)throw Object.assign(new Error('ClientText job ID was reused for different content.'),{code:'SAVE_RECEIPT_MISMATCH'});if(isLocal(rawScope))validateLocalRecord(unit,receipt.saved);return {saved:receipt.saved,receipt,replayed:true};}
                const currentMetadata=await get(tx,stores.meta,key(scope,'meta'));
                const original=await get(tx,stores.cacheUnits,key(cacheForUnit(currentMetadata,unitId),unitId));
                if(!original || currentMetadata.signature!==metadata.signature)throw new Error('ClientText original changed while saving.');
                const before=await get(tx,stores.saved,key(scope,unitId)),draft=await get(tx,stores.drafts,key(scope,unitId));
                if(isLocal(rawScope)){validateLocalRecord(unit,before);validateLocalRecord(unit,draft,{draft:true});}
                if(own(input,'expectedRevision')&&(before?.revision||0)!==input.expectedRevision)throw Object.assign(new Error('Another tab changed the ClientText saved translation.'),{code:'UNIT_CHANGED'});
                if(own(input,'expectedDraftRevision')&&(draft?.revision||null)!==input.expectedDraftRevision)throw Object.assign(new Error('Another tab changed this ClientText draft.'),{code:'DRAFT_CHANGED'});
                const descriptor=metadata.descriptors.find(value=>value.role===unit.role);
                const acceptedMtl=mtl ? await mtl.validateAcceptancesTx(tx,captured.scope,unit,input.mtlAcceptances,values,descriptor) : [];
                if(acceptedMtl.length && ((input.origin||options.origin)==='restore' || acceptedMtl.some(claim=>({...before?.reviewed,...reviewed})[claim.fieldId]!==claim.candidate.sourceHash)))
                    throw Object.assign(new Error('MTL acceptance requires a normal Save reviewed against the current source.'),{code:'MTL_REVIEW_MISMATCH'});
                const after={unitId,values,reviewed:{...before?.reviewed,...reviewed},saved:true,revision:(before?.revision||0)+1,
                    serverRevision:before?.serverRevision||input.baseRevision||0,baseRevision:before?.serverRevision||input.baseRevision||0,
                    savedAt:Date.now(),jobId:input.jobId,origin:input.origin||options.origin||'save',outdated:before?.outdated||[],
                    ...(acceptedMtl.length ? {mtlAcceptances:copy(input.mtlAcceptances)} : {})};
                if(mtl)await mtl.resolveAcceptancesTx(tx,captured.scope,acceptedMtl,{jobId:input.jobId,now:after.savedAt});
                put(tx,stores.saved,scope,unitId,after);
                await learnMemory(tx,captured.scope,unit,after,input.jobId,after.origin);
                put(tx,stores.history,scope,input.jobId,{id:input.jobId,unitId,before:before||null,after,origin:after.origin,createdAt:after.savedAt},{unitKey:key(scope,unitId)});
                if(own(input,'expectedDraftRevision'))del(tx,stores.drafts,scope,unitId);
                if(!isLocal(captured.scope) && options.sync!==false){
                    const pending=await get(tx,stores.outbox,key(scope,unitId));
                    const operation={unitId,mutationId:input.jobId,storageProtocol:S.STORAGE_PROTOCOL,role:unit.role,assetHash:descriptor.assetHash,parserVersion:descriptor.parserVersion,
                        ...(acceptedMtl.length ? {mtlAcceptances:copy(input.mtlAcceptances)} : {}),
                        ...(own(input,'origin')?{origin:input.origin}:{}),
                        clientFacts:S.clientFacts(unit),originalValues:S.originalValues(unit),values:copy(values),reviewed:copy(after.reviewed),baseRevision:after.serverRevision,
                        base:pending?.base||{values:before?.values||S.valuesFor(unit),reviewed:before?.reviewed||{},revision:after.serverRevision},state:'queued',createdAt:Date.now()};
                    // Accepted MTL must reach the server as its own atomic Save.
                    // Keep that queued claim and every uncertain request intact
                    // while newer human saves wait for the original receipt.
                    if(pending&&(['sending','uncertain'].includes(pending.state)||pending.state==='queued'&&pending.mtlAcceptances?.length))operation.predecessor=copy(pending);
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
            if(isLocal(rawScope) && result.length){
                const unit=await getUnit(rawScope,unitId,options);
                for(const entry of result){
                    if(entry?.unitId!==unitId || typeof entry.origin!=='string')throw corrupt('history identity');
                    validateLocalRecord(unit,entry.after,{historical:true});validateLocalRecord(unit,entry.before,{historical:true});
                }
            }
            return result.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,options.limit||100);
        }
        async function listWorkspaces(input={},options={}){
            const accountId=String(input.accountId||input.profile||'guest');
            return transaction([stores.meta],'readonly',async tx=>(await request(tx.objectStore(stores.meta).index('by_account').getAll(accountId))).map(row=>row.value)
                .filter(row=>Object.entries(input).every(([field,value])=>!['profile','accountId'].includes(field)?row[field]===value:true)),options);
        }
        const getOutbox=(rawScope,options)=>isLocal(rawScope)?Promise.resolve([]):rows(capture(rawScope).id,stores.outbox,options);
        async function markSending(rawScope,unitId,mutationId,state='sending',options={}){
            if(isLocal(rawScope))throw new TypeError('Local workbook state cannot enter shared synchronization.');
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
            if(isLocal(rawScope))throw new TypeError('Local workbook state cannot receive shared synchronization.');
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
            if(isLocal(rawScope))throw new TypeError('Local workbook state cannot receive shared acknowledgements.');
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
        return { import:importContent,importContent,save,getMetadata,getUnits,getUnitsByIds,getCompactUnits,getUnit,getSaved,getAsset,getProof,getCachedOriginal,migrateWorkspace,putDraft,getDraft,getDraftSummaries,discardDraft,
            listHistory,listWorkspaces,getOutbox,markSending,applyRemote,acknowledge,putRequest,getRequest,listRequests,deleteRequest,seedMemory,seedPreviousVersion,getMemory,getMemoryHistory,normalizeScope,scopeKey };
    }
    return { stores,names,upgrade,normalizeScope,scopeKey,validateLocalRecord,create };
});
