/* Private local workbooks. No transport, publication or shared outbox. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextLocalStore = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
    'use strict';
    const protocol = 'clienttext-local-v2';
    const state = () => root.ClientTextState;
    const core = () => root.ClientTextStore;
    const clone = value => state().copy(value);
    const fail = message => Object.assign(new Error(message), { code: 'LOCAL_WORKBOOK_UNAVAILABLE' });
    function create() {
        const base = core().create(), held = new Map(), leases = new Map();
        const normalizeScope = input => {
            const scope = core().normalizeScope(input);
            if (!scope.groupId.startsWith('local:test:') || !scope.versionId.startsWith('local:test:')) throw fail('This operation requires a private local workbook.');
            return scope;
        };
        const identity = scope => core().scopeKey(normalizeScope(scope));
        async function acquire(input) {
            const id = identity(input);
            const lease={id};
            if (held.has(id)) {leases.set(id,lease);return lease;}
            if (!root.navigator?.locks?.request) throw fail('Safe local editing requires Web Locks. Open this site in a supported desktop browser over HTTPS or localhost.');
            return new Promise((resolve, reject) => {
                root.navigator.locks.request('sdeditor:local-workbook:' + id, { mode: 'exclusive', ifAvailable: true }, async lock => {
                    if (!lock) { reject(fail('This workbook is open in another tab. Close it there, then open it here.')); return; }
                    await new Promise(release => { held.set(id, release);leases.set(id,lease);resolve(lease); });
                }).catch(reject);
            });
        }
        function releaseExcept(input) {
            const keep = input ? identity(input) : null;
            for (const [id, release] of held) if (id !== keep) { held.delete(id);leases.delete(id);release(); }
        }
        function releaseLease(lease) {
            if(lease && leases.get(lease.id)===lease){const release=held.get(lease.id);held.delete(lease.id);leases.delete(lease.id);release?.();}
        }
        function releaseCapturedExcept(input) {
            const keep=input?identity(input):null, captures=[...leases.values()].filter(lease=>lease.id!==keep);
            return () => {for(const lease of captures)releaseLease(lease);};
        }
        const owned = scope => {
            if (!held.has(identity(scope))) throw fail('This tab no longer owns the workbook. Reopen it from Offline before editing.');
        };
        const optionsFor = (scope, options = {}) => {
            const lease=options.localLease || leases.get(identity(scope));
            return { ...options, sync: false, guard: () => {
                owned(scope);
                if(leases.get(identity(scope))!==lease)throw fail('This workbook activation changed. Its previous draft remains available for recovery.');
                return !options.guard || options.guard();
            } };
        };
        const result = { normalizeScope, scopeKey: identity, acquire, releaseExcept, releaseLease, releaseCapturedExcept,
            captureLease:scope=>leases.get(identity(scope)),
            mtl: root.ClientTextMtlStore.create(),
            async import(scope, input, options) {
                normalizeScope(scope); await acquire(scope);
                return base.import(scope, input, optionsFor(scope, options));
            },
            listWorkspaces: (filter, options) => base.listWorkspaces(filter, options),
        };
        for (const method of ['getMetadata','getUnits','getUnitsByIds','getUnit','getSaved','getAsset','putDraft','getDraft','getDraftSummaries','discardDraft','save','listHistory','seedMemory','getMemory']) {
            result[method] = (scope, ...args) => {
                normalizeScope(scope);
                const writing=['putDraft','discardDraft','save','seedMemory'].includes(method);
                if(writing)owned(scope);
                const count = { getUnit:1,getUnitsByIds:1,getAsset:1,putDraft:2,getDraft:1,discardDraft:1,save:2,listHistory:1,seedMemory:1 }[method] || 0;
                if(writing)args[count] = optionsFor(scope, args[count]);
                return base[method](scope, ...args);
            };
        }
        // Snapshot all authored stores in one readonly transaction while this
        // tab owns the workspace. Originals are immutable and read separately.
        async function snapshot(scope) {
            normalizeScope(scope);
            const db = await root.OfflineStore.openClientTextDb(), id = identity(scope);
            const labels = ['saved','drafts','history','receipts','memory','memoryHistory'];
            const tx = db.transaction(labels.map(label => core().stores[label]), 'readonly');
            const done = new Promise((resolve,reject) => {tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error || fail('Backup read failed.'));});
            const reads = labels.map(label => new Promise((resolve,reject) => {
                const request = tx.objectStore(core().stores[label]).index('by_scope').getAll(id);
                request.onsuccess=()=>resolve([label,request.result.map(row=>row.value)]);request.onerror=()=>reject(request.error);
            }));
            const rows=Object.fromEntries(await Promise.all(reads));await done;return rows;
        }
        result.backup = async scope => {
            owned(scope);
            const zip = new root.JSZip(), workspaces = [], seen = new Set();
            async function add(input) {
                const id = identity(input);if(seen.has(id))return;seen.add(id);
                // Each authored snapshot is one readonly transaction. Previous
                // comparison reads never acquire/release an editor's ownership.
                const metadata=await base.getMetadata(input), assets=[];
                if(!metadata || !['clienttext-local-v1',protocol].includes(metadata.localProtocol))throw fail('Unsupported local workbook version. Its browser data is retained.');
                for(const descriptor of metadata.descriptors) {
                    const asset=await base.getAsset(input,descriptor.role), path='originals/'+workspaces.length+'/'+descriptor.role+'.bin';
                    if(!(asset?.blob instanceof Blob))throw fail('The retained original workbook is unavailable. Browser data is retained.');
                    const bytes=await asset.blob.arrayBuffer();
                    if(await state().sha256(bytes)!==descriptor.assetHash)throw fail('The retained original hash differs. Browser data is retained.');
                    zip.file(path,bytes);assets.push({path,name:asset.name,role:descriptor.role,parserVersion:descriptor.parserVersion,hash:descriptor.assetHash});
                }
                const record={scope:clone(input),metadata,assets,rows:await snapshot(input)};workspaces.push(record);
                if(metadata.previousScope)await add(metadata.previousScope);
            }
            await add(scope);zip.file('local-workbook.json',JSON.stringify({protocol,createdAt:Date.now(),workspaces}));
            return await zip.generateAsync({type:'blob',compression:'DEFLATE'});
        };
        result.restore = async (blob, owner, worker, options = {}) => {
            if(blob.size>512*1024*1024)throw fail('This backup exceeds the 512 MiB import limit.');
            const zip=await root.JSZip.loadAsync(blob), file=zip.file('local-workbook.json');
            if(!file || file._data?.uncompressedSize>128*1024*1024)throw fail('This is not a supported local workbook backup.');
            const manifestText=await file.async('string');if(manifestText.length>64*1024*1024)throw fail('Backup metadata exceeds the import limit.');
            const manifest=JSON.parse(manifestText);
            if(!['clienttext-local-v1',protocol].includes(manifest.protocol) || !Array.isArray(manifest.workspaces) || !manifest.workspaces.length || manifest.workspaces.length>20)throw fail('Unsupported local backup format.');
            const mapped=new Map(), prepared=[];
            for(const record of manifest.workspaces) {
                const old=normalizeScope(record.scope), scope={...old,...owner,versionId:'local:test:'+root.crypto.randomUUID(),groupId:'local:test:'+root.crypto.randomUUID()};
                if(old.game!==owner.game)throw fail('Select the backup’s game before restoring.');
                const oldId=identity(old);if(mapped.has(oldId))throw fail('Duplicate workbook identity in backup.');mapped.set(oldId,scope);
                core().validateLocalMetadata(old,record.metadata);
                if(!['clienttext-local-v1',protocol].includes(record.metadata?.localProtocol) || !Array.isArray(record.assets) || !record.assets.length || record.assets.length>2)throw fail('Malformed backup metadata.');
                const assets=[],units=[],roles=new Set();
                for(const item of record.assets) {
                    if(!['normal','gender'].includes(item.role) || roles.has(item.role))throw fail('Duplicate or unsupported backup workbook role.');roles.add(item.role);
                    const entry=zip.file(item.path);if(!entry || entry._data?.uncompressedSize>256*1024*1024)throw fail('Missing or oversized backup original.');
                    const bytes=await entry.async('arraybuffer');if(bytes.byteLength>256*1024*1024)throw fail('Backup original exceeds the import limit.');
                    if(await state().sha256(bytes)!==item.hash)throw fail('Backup original hash mismatch.');
                    const parsed=await worker.parseWorkbook(bytes,{filename:item.name,role:item.role,language:scope.language,game:scope.game,parserVersion:item.parserVersion,...options});
                    for(const unit of parsed.units)units.push(unit);assets.push({role:item.role,name:item.name,hash:parsed.artifactHash,parserVersion:parsed.parserVersion,blob:new Blob([bytes]),parsed:{...parsed,units:undefined}});
                }
                const built=await state().buildDescriptors(units,assets,options);
                if(state().hash({descriptors:built.descriptors,unitCount:units.length})!==record.metadata.signature)throw fail('Backup parser identity differs from its original workbook.');
                validateRows(record.rows,units);
                prepared.push({record,scope,assets,units,built});
            }
            // Every package and authored row is checked before any workspace is
            // published. Restoration always creates new IDs, never replaces work.
            for(const item of prepared.slice().reverse()) {
                const {record,scope,assets,units,built}=item;
                const metadata={...clone(record.metadata),...scope,localProtocol:protocol,syncResources:false,
                    restoredFrom:record.scope,memorySeeded:false,version:{...record.metadata.version,id:scope.versionId,game:scope.game,branchId:scope.branchId,name:(record.metadata.version?.name || 'Local workbook')+' (restored)'},
                    group:{...record.metadata.group,id:scope.groupId,versionId:scope.versionId,language:scope.language},
                    ...(record.metadata.previousScope?{previousScope:mapped.get(identity(record.metadata.previousScope))}:{}),localRestorePending:true};
                if(record.metadata.previousScope && !metadata.previousScope)throw fail('Backup comparison workbook is missing.');
                await result.import(scope,{units,assets,descriptors:built.descriptors,metadata},options);
                await restoreRows(scope,record.rows,mapped,options);
            }
            return prepared[0].scope;
        };
        function validateRows(rows,units) {
            if(!rows || ['saved','drafts','history','receipts','memory','memoryHistory'].some(key=>!Array.isArray(rows[key])))throw fail('Malformed backup work records.');
            const byId=new Map(units.map(unit=>[unit.id,unit]));
            const valid = (value, options = {}) => {
                const unit=byId.get(value?.unitId);if(!unit || !Number.isSafeInteger(value.revision) || value.revision<0)throw fail('Invalid backup translation identity.');
                core().validateLocalRecord(unit,value,options);
                const values=state().normalizeValues(unit,value.values), reviewed=state().normalizeReviewed(unit,value.reviewed || {});
                if(state().stableStringify(values)!==state().stableStringify(value.values) || state().stableStringify(reviewed)!==state().stableStringify(value.reviewed || {}))throw fail('Invalid backup field values.');
            };
            for(const label of ['saved','drafts','history','receipts']) {
                if(rows[label].length>1000000)throw fail('Too many backup work records.');const seen=new Set();
                for(const row of rows[label]){const id=label==='history'?row?.id:label==='receipts'?row?.jobId:row?.unitId;
                    if(typeof id!=='string' || !id || seen.has(id))throw fail('Duplicate or invalid backup work identity.');seen.add(id);}
            }
            for(const row of rows.saved)valid(row);
            for(const row of rows.drafts)valid(row,{draft:true});
            for(const row of rows.history){if(typeof row.origin!=='string' || !row.after || !byId.has(row.unitId) || row.before && row.before.unitId!==row.unitId || row.after.unitId!==row.unitId)throw fail('Invalid backup history.');if(row.before)valid(row.before,{historical:true});valid(row.after,{historical:true});}
            for(const row of rows.receipts){if(row.unitId!==row.saved?.unitId)throw fail('Invalid backup receipt.');valid(row.saved);}
        }
        async function restoreRows(scope,rows,mapped,options) {
            owned(scope);const db=await root.OfflineStore.openClientTextDb(),names=core().stores;
            const labels=['saved','drafts','history','receipts'];
            const tx=db.transaction([names.meta,...labels.map(key=>names[key])],'readwrite',{durability:'strict'});
            const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error || fail('Restore transaction failed.'));});
            try {
                const id=identity(scope);
                const metadataRow=await new Promise((resolve,reject)=>{const req=tx.objectStore(names.meta).get(JSON.stringify([id,'meta']));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
                if(!metadataRow)throw fail('Restore workspace metadata is missing. Stored data has been retained.');
                core().validateLocalMetadata(scope,metadataRow.value);
                for(const label of labels)for(const raw of rows[label]){
                    const value=clone(raw),unitId=label==='history'?value.id:label==='receipts'?value.jobId:value.unitId;
                    if(label==='drafts' && value.mtlAcceptances){value.restoredMtlAcceptances=value.mtlAcceptances;delete value.mtlAcceptances;}
                    // Rebind only local comparison references. Historical receipt
                    // bodies/signatures remain unchanged as recovery evidence.
                    const rebind=value=>{if(value?.provenance?.groupId){for(const [old,next]of mapped)if(JSON.parse(old)[4]===value.provenance.groupId)value.provenance.groupId=next.groupId;}};
                    if(label!=='receipts'){rebind(value);rebind(value.before);rebind(value.after);}
                    tx.objectStore(names[label]).put({key:JSON.stringify([id,unitId]),scope:id,value,...(['drafts','history'].includes(label)?{unitKey:JSON.stringify([id,value.unitId])}:{})});
                }
                metadataRow.value.localRestorePending=false;tx.objectStore(names.meta).put(metadataRow);
                if(options.guard && !options.guard())tx.abort();
                await done;
            }catch(error){try{tx.abort();}catch(_){}await done.catch(()=>{});throw error;}
        }
        return result;
    }
    return { create, protocol };
});
