'use strict';
// Native IndexedDB acceptance for trusted originals. Uses an isolated origin/profile,
// synthetic immutable bytes, and no application API or production workbooks.
const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync} = require('node:fs');
const {resolve, join, sep} = require('node:path');
const {tmpdir} = require('node:os');
const {createHash} = require('node:crypto');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', {paths:[runtimeModules]}));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);
if (!executablePath) throw new Error('No installed Edge/Chrome found; set FIXTURE_BROWSER_PATH.');

async function main() {
    const work = mkdtempSync(join(tmpdir(), 'sdeditor-trusted-cache-'));
    const publicRoot = resolve(__dirname, '../public');
    const pageErrors = [];
    const productionDirectory='C:/Users/lpeac/Downloads/2026-10-05_POE2';
    const production=process.argv.includes('--production-french') ? ['French_PoE2.xlsm','French_Gender_PoE2.xlsm'].map((name,index)=>{
        const path=join(productionDirectory,name),bytes=readFileSync(path);
        return {name,path,role:index?'gender':'normal',bytes,hash:createHash('sha256').update(bytes).digest('hex')};
    }) : [];
    const jszipPath=production.length ? require.resolve('jszip/dist/jszip.min.js',{paths:[resolve(__dirname,'../../SDEditor-API'),runtimeModules]}) : null;
    const server = createServer((request, response) => {
        const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
        if (pathname === '/') {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end('<!doctype html><title>Trusted ClientText storage fixture</title><script src="/workspaceState.js"></script><script src="/clientTextState.js"></script><script src="/clientTextStore.js"></script><script src="/clientTextTransport.js"></script><script src="/clientTextWorkerClient.js"></script>');
            return;
        }
        if(production.length && pathname==='/fixture/jszip.min.js'){response.setHeader('Content-Type','text/javascript');response.end(readFileSync(jszipPath));return;}
        const original=production.find(file=>pathname==='/fixture/'+file.name);
        if(original){response.setHeader('Content-Type','application/octet-stream');response.end(original.bytes);return;}
        const file = resolve(publicRoot, '.' + pathname);
        if (!file.startsWith(publicRoot + sep) || !existsSync(file) || !pathname.endsWith('.js')) {
            response.writeHead(404); response.end(); return;
        }
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        const bytes=readFileSync(file);
        response.end(production.length && pathname==='/clientTextWorker.js' ? bytes.toString().replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js','/fixture/jszip.min.js') : bytes);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let context;
    try {
        context = await chromium.launchPersistentContext(join(work, 'profile'), {executablePath, headless:true, viewport:{width:1440,height:1000}});
        const page = context.pages()[0];
        page.on('pageerror', error => pageErrors.push(String(error)));
        await page.goto('http://127.0.0.1:' + server.address().port);
        const seeded = await page.evaluate(async () => {
            const S = ClientTextState, CT = ClientTextStore;
            const req = request => new Promise((resolve,reject) => {request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
            const done = tx => new Promise((resolve,reject) => {tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error || Error('Aborted'));});
            const scope = {accountId:'alice',game:'poe2',branchId:'default',versionId:'legacy-version',groupId:'legacy-group',language:'German'};
            const fieldId = JSON.stringify(['Text',null]);
            const units = Array.from({length:140}, (_,index) => ({id:JSON.stringify(['normal','Dialogue','ID'+index]),role:'normal',sheet:'Dialogue',recordId:'ID'+index,
                developerNotes:'Exact notes\r\n' + index,metadata:{StrFour:'Retained legacy metadata'},fields:[{id:fieldId,name:'Text',kind:'text',source:' English\n'+index+' ',target:' German\r\n'+index+' ',required:true,originalMissing:false,outdated:index===0,sourceCell:'B'+(index+2),targetCell:'C'+(index+2),originalStyleId:3,originalFill:'FF9966'}]}));
            const asset = {role:'normal',name:'German.xlsm',hash:'a'.repeat(64),parserVersion:'clienttext-v1',blob:new Blob([new Uint8Array([0,255,13,10,42])]),parsed:{parserVersion:'clienttext-v1',filename:'German.xlsm',sheets:[{name:'Dialogue',path:'xl/worksheets/sheet1.xml'}],nativeMarker:'Keep macro/style context'}};
            const manifest = await S.buildManifest(units,[asset]);
            const oldOpen = indexedDB.open('sdeditor',13);
            oldOpen.onupgradeneeded = () => {
                for (const name of CT.names.filter(name=>!name.startsWith('clienttext_original_'))) {
                    const store=oldOpen.result.createObjectStore(name,{keyPath:'key'});store.createIndex('by_scope','scope');
                    if(name===CT.stores.meta)store.createIndex('by_account','accountId');
                    if([CT.stores.history,CT.stores.drafts,CT.stores.outbox,CT.stores.memoryHistory].includes(name))store.createIndex('by_unit','unitKey');
                }
            };
            const oldDb = await req(oldOpen), scopeId = CT.scopeKey(scope);
            const tx=oldDb.transaction(CT.names.filter(name=>!name.startsWith('clienttext_original_')),'readwrite'), committed=done(tx);
            const put=(name,id,value,extras={})=>tx.objectStore(name).put({key:JSON.stringify([scopeId,id]),scope:scopeId,value,...extras});
            put(CT.stores.meta,'meta',{...scope,state:'ready',signature:S.hash({descriptors:manifest.descriptors,unitCount:units.length}),unitCount:units.length,descriptors:manifest.descriptors,sequence:9},{accountId:scope.accountId});
            put(CT.stores.assets,'normal',{...asset,descriptor:manifest.descriptors[0],tree:manifest.trees.normal});
            units.forEach((unit,index)=>put(CT.stores.originals,unit.id,{unit:S.normalizeUnit(unit),compact:S.compactUnit(unit),proofIndex:index}));
            const unit=units[0],saved={unitId:unit.id,values:{[fieldId]:'Accepted legacy text'},reviewed:{},revision:9,serverRevision:4};
            put(CT.stores.saved,unit.id,saved);
            put(CT.stores.drafts,unit.id,{unitId:unit.id,values:{[fieldId]:'Unsaved\nraw draft'},reviewed:{},revision:8},{unitKey:JSON.stringify([scopeId,unit.id])});
            put(CT.stores.history,'legacy-history',{unitId:unit.id,origin:'local',before:{values:{[fieldId]:'Before'}},after:saved,createdAt:1},{unitKey:JSON.stringify([scopeId,unit.id])});
            put(CT.stores.receipts,'legacy-job',{jobId:'legacy-job',signature:'old command signature',saved});
            const pending={unitId:unit.id,mutationId:'queued-latest',baseRevision:4,values:{[fieldId]:'Queued latest'},reviewed:{},state:'queued',
                predecessor:{unitId:unit.id,mutationId:'uncertain-oldest',baseRevision:3,values:{[fieldId]:'Uncertain oldest'},reviewed:{},state:'uncertain'}};
            put(CT.stores.outbox,unit.id,pending,{unitKey:JSON.stringify([scopeId,unit.id])});
            const requestOwner=JSON.stringify([scope.accountId,scope.game,scope.branchId]);
            tx.objectStore(CT.stores.requests).put({key:JSON.stringify([requestOwner,'old-publication']),scope:requestOwner,value:{requestId:'old-publication',payload:{kind:'publication',requestId:'exact-original-request',blob:asset.blob},createdAt:1}});
            await committed;
            window.fixtureData={scope,fieldId,units,asset,manifest};
            window.oldWriterClosed=false;oldDb.onversionchange=()=>{window.oldWriterClosed=true;oldDb.close();};
            const body=entry=>({mutationId:entry.mutationId,baseRevision:entry.baseRevision||0,values:entry.values,reviewed:entry.reviewed||{},baseline:S.normalizeUnit(unit),proof:S.proofFor(manifest,unit.id)});
            return {baselineId:manifest.descriptors[0].baselineId,latestHash:S.hash(body(pending)),oldestHash:S.hash(body(pending.predecessor)),unitCount:units.length};
        });
        await page.addScriptTag({url:'/offlineStore.js'});
        const migrated = await page.evaluate(async () => {
            const S=ClientTextState,CT=ClientTextStore,{scope,fieldId,units,asset}=fixtureData;
            const db=await OfflineStore.openClientTextDb();
            const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
            const row=async(name,id)=>req(db.transaction(name).objectStore(name).get(id));
            const count=async name=>req(db.transaction(name).objectStore(name).count());
            const store=CT.create();
            const originalPut=IDBObjectStore.prototype.put;let writes=0,interrupted=false;
            IDBObjectStore.prototype.put=function(value,...args){if(this.name===CT.stores.cacheUnits&&++writes===129){interrupted=true;throw Error('Injected native cache interruption');}return originalPut.call(this,value,...args);};
            let failure;
            // Fresh parser order differs from the ID-sorted legacy store. A
            // retry must write every ID rather than trust an imported offset.
            try{await store.import({...scope,groupId:'interrupted-fresh-parse'},{units,assets:[asset]});}catch(error){failure=error.message;}finally{IDBObjectStore.prototype.put=originalPut;}
            const oldMeta=(await row(CT.stores.meta,JSON.stringify([CT.scopeKey(scope),'meta']))).value;
            const afterFailure={failure,interrupted,oldUnits:await count(CT.stores.originals),oldAssets:await count(CT.stores.assets),linked:!!oldMeta.originalCaches};
            const progress=[];
            const metadata=await store.migrateWorkspace(scope,{onProgress:event=>progress.push(event)});
            const operations=await store.getOutbox(scope),loaded=await store.getUnits(scope),retained=await store.getAsset(scope,'normal');
            const legacyResult={baselineId:metadata.descriptors[0].baselineId,parserVersion:metadata.descriptors[0].parserVersion,cacheMigration:metadata.cacheMigration,
                protocol:metadata.storageProtocol,units:loaded.length,oldUnits:await count(CT.stores.originals),oldAssets:await count(CT.stores.assets),cacheUnits:await count(CT.stores.cacheUnits),
                latestHash:S.hash(operations[0].requestBody),oldestHash:S.hash(operations[0].predecessor.requestBody),draft:(await store.getDraft(scope,units[0].id)).values[fieldId],
                saved:(await store.getSaved(scope))[units[0].id].values[fieldId],history:(await store.listHistory(scope,units[0].id)).length,
                receipt:(await row(CT.stores.receipts,JSON.stringify([CT.scopeKey(scope),'legacy-job']))).value,
                request:(await store.getRequest(scope,'old-publication')).payload.requestId,bytes:[...new Uint8Array(await retained.blob.arrayBuffer())],native:retained.parsed.nativeMarker,
                hasTree:!!retained.tree,oldWriterClosed:window.oldWriterClosed,version:db.version,progress:progress.length};
            const other={...scope,accountId:'bob',versionId:'new-version',groupId:'new-group'};
            await store.import(other,{units,assets:[{...asset,name:'Renamed.xlsm'}],metadata:{name:'New assignment'}});
            const isolated={saved:await store.getSaved(other),draft:await store.getDraft(other,units[0].id),name:(await store.getAsset(other)).name,oldName:(await store.getAsset(scope)).name,
                caches:await count(CT.stores.cacheMeta),units:await count(CT.stores.cacheUnits),aliceCatalog:(await store.listWorkspaces({accountId:'alice'})).length,bobCatalog:(await store.listWorkspaces({accountId:'bob'})).length};
            const first=await store.save(other,units[0].id,{jobId:'trusted-job',values:{[fieldId]:'Exact new\r\nGerman '},reviewed:{[fieldId]:S.sourceHash(units[0].fields[0].source)}});
            const replay=await store.save(other,units[0].id,{jobId:'trusted-job',values:{[fieldId]:'Exact new\r\nGerman '},reviewed:{[fieldId]:S.sourceHash(units[0].fields[0].source)}});
            const fresh=(await store.getOutbox(other))[0];
            const v2={...other,groupId:'parser-v2'};await store.import(v2,{units,assets:[{...asset,parserVersion:'clienttext-v2'}]});
            window.fixtureScopes={scope,other,v2,fieldId,unitId:units[0].id};
            localStorage.setItem('fixtureScopes',JSON.stringify(fixtureScopes));
            return {afterFailure,legacyResult,isolated,trusted:{protocol:fresh.storageProtocol,facts:fresh.clientFacts,originalValues:fresh.originalValues,hasProof:!!fresh.proof,hasBaseline:!!fresh.baseline,
                receiptSame:S.hash(first.receipt)===S.hash(replay.receipt)&&S.hash(first.saved)===S.hash(replay.saved)&&replay.replayed===true,savedValue:first.saved.values[fieldId],caches:await count(CT.stores.cacheMeta)},scope:fixtureScopes};
        });
        assert.equal(migrated.afterFailure.interrupted,true);
        assert.match(migrated.afterFailure.failure,/Injected native cache interruption/);
        assert.equal(migrated.afterFailure.linked,false);
        assert.equal(migrated.afterFailure.oldUnits,140);assert.equal(migrated.afterFailure.oldAssets,1);
        const legacy=migrated.legacyResult;
        assert.equal(legacy.version,14);assert.equal(legacy.oldWriterClosed,true);
        assert.equal(legacy.baselineId,seeded.baselineId);assert.equal(legacy.parserVersion,'clienttext-v1');
        assert.equal(legacy.latestHash,seeded.latestHash);assert.equal(legacy.oldestHash,seeded.oldestHash);
        assert.equal(legacy.units,140);assert.equal(legacy.cacheUnits,140);assert.equal(legacy.oldUnits,0);assert.equal(legacy.oldAssets,0);
        assert.equal(legacy.cacheMigration,'complete');assert.equal(legacy.protocol,'clienttext-trusted-v1');
        assert.equal(legacy.draft,'Unsaved\nraw draft');assert.equal(legacy.saved,'Accepted legacy text');assert.equal(legacy.history,1);
        assert.equal(legacy.receipt.signature,'old command signature');assert.equal(legacy.request,'exact-original-request');
        assert.deepEqual(legacy.bytes,[0,255,13,10,42]);assert.equal(legacy.native,'Keep macro/style context');assert.equal(legacy.hasTree,false);
        assert.deepEqual(migrated.isolated.saved,{});assert.equal(migrated.isolated.draft,undefined);
        assert.equal(migrated.isolated.name,'Renamed.xlsm');assert.equal(migrated.isolated.oldName,'German.xlsm');
        assert.equal(migrated.isolated.caches,1);assert.equal(migrated.isolated.units,140);
        assert.equal(migrated.isolated.aliceCatalog,1);assert.equal(migrated.isolated.bobCatalog,1);
        assert.equal(migrated.trusted.protocol,'clienttext-trusted-v1');assert.equal(migrated.trusted.hasProof,false);assert.equal(migrated.trusted.hasBaseline,false);
        assert.equal(migrated.trusted.receiptSame,true);assert.equal(migrated.trusted.savedValue,'Exact new\r\nGerman ');assert.equal(migrated.trusted.caches,2);
        assert.equal(migrated.trusted.facts.fields[0].source,undefined);assert.equal(migrated.trusted.facts.hash,undefined);
        assert.equal(migrated.trusted.originalValues[migrated.scope.fieldId],' German\r\n0 ');
        await page.reload();await page.addScriptTag({url:'/offlineStore.js'});
        const reopened=await page.evaluate(async()=>{
            const CT=ClientTextStore,S=ClientTextState,{scope,other,fieldId,unitId}=JSON.parse(localStorage.getItem('fixtureScopes'));
            S.buildManifest=()=>{throw Error('Unexpected corpus manifest');};S.buildDescriptors=()=>{throw Error('Unexpected original rehash');};
            const store=CT.create(),progress=[];
            const cached=await store.getCachedOriginal('a'.repeat(64),'clienttext-v1','normal',{onProgress:event=>progress.push(event)});
            const loaded=await store.getUnits(other),warm=await store.getUnits(other);
            const oldWriter=await new Promise(resolve=>{const request=indexedDB.open('sdeditor',13);request.onsuccess=()=>{request.result.close();resolve('opened');};request.onerror=()=>resolve(request.error.name);});
            return {count:cached.units.length,sameWarm:loaded[0]===warm[0],saved:(await store.getSaved(other))[unitId].values[fieldId],
                oldSaved:(await store.getSaved(scope))[unitId].values[fieldId],draft:(await store.getDraft(scope,unitId)).values[fieldId],
                pending:(await store.getOutbox(scope))[0].predecessor.requestBody.mutationId,oldWriter,progress:progress.map(event=>({phase:event.phase,processed:event.processed,total:event.total,sheet:event.sheet}))};
        });
        assert.equal(reopened.count,140);assert.equal(reopened.sameWarm,true);assert.equal(reopened.saved,'Exact new\r\nGerman ');
        assert.equal(reopened.oldSaved,'Accepted legacy text');assert.equal(reopened.draft,'Unsaved\nraw draft');assert.equal(reopened.pending,'uncertain-oldest');
        assert.equal(reopened.oldWriter,'VersionError');assert.ok(reopened.progress.some(event=>event.processed===140&&event.sheet==='Dialogue'));
        assert.deepEqual(pageErrors,[]);
        let productionResult;
        if(production.length){
            console.log('French production cache validation started');
            await page.reload();await page.addScriptTag({url:'/offlineStore.js'});
            productionResult=await page.evaluate(async files=>{
                const S=ClientTextState,CT=ClientTextStore,store=CT.create(),started=performance.now();
                const scope={accountId:'production-fixture',game:'poe2',branchId:'default',versionId:'french-originals',groupId:'french-group',language:'French'};
                const workerOps=[],NativeWorker=window.Worker;
                const worker=ClientTextWorkerClient.create({Worker:class extends NativeWorker{postMessage(message,transfer){if(['parseWorkbook','request-start','buildManifest','buildDescriptors'].includes(message.type))workerOps.push(message.type==='request-start'?message.operation:message.type);super.postMessage(message,transfer);}}});
                const assets=[],parses=[],progress={parse:0,descriptors:0,storage:0,load:0};let units=[];
                S.buildManifest=()=>{throw Error('Unexpected production Merkle generation');};
                for(const file of files){
                    const start=performance.now(),bytes=new Uint8Array(await(await fetch('/fixture/'+file.name)).arrayBuffer());
                    const parsed=await worker.parseWorkbook(bytes,{filename:file.name,role:file.role,language:'French',onProgress:()=>progress.parse++});
                    parses.push({role:file.role,milliseconds:performance.now()-start,units:parsed.units.length,sheets:parsed.sheets.length,warnings:parsed.warnings.length,hash:parsed.artifactHash});
                    for(const unit of parsed.units)units.push(unit);
                    assets.push({name:file.name,role:file.role,hash:parsed.artifactHash,parserVersion:parsed.parserVersion,blob:new Blob([bytes]),parsed:{...parsed,units:undefined}});
                }
                const descriptorsStarted=performance.now(),built=await worker.buildDescriptors(units,assets,{onProgress:()=>progress.descriptors++}),descriptorsMs=performance.now()-descriptorsStarted;
                const nativePut=IDBObjectStore.prototype.put,nativeGetAll=IDBObjectStore.prototype.getAll;
                let cacheWrites=0,maximumFields=0,maximumPage=0,boundedReads=0;
                IDBObjectStore.prototype.put=function(value,...args){if(this.name===CT.stores.cacheUnits){cacheWrites++;if(!value.value?.unit || value.value.compact || value.value.proofIndex!==undefined)throw Error('Unexpected aggregate/proof cache row');maximumFields=Math.max(maximumFields,value.value.unit.fields.length);}return nativePut.call(this,value,...args);};
                IDBObjectStore.prototype.getAll=function(range,count){if(this.name===CT.stores.cacheUnits){if(!count || count>128)throw Error('Unbounded original read');maximumPage=Math.max(maximumPage,count);boundedReads++;}return nativeGetAll.call(this,range,count);};
                try{
                    const writeStarted=performance.now();await store.import(scope,{units,assets,descriptors:built.descriptors,summaries:built.summaries},{onProgress:()=>progress.storage++});const writeMs=performance.now()-writeStarted;
                    units=null;
                    const loadStarted=performance.now(),loaded=await store.getUnits(scope,{onProgress:()=>progress.load++}),coldViewMs=performance.now()-loadStarted;
                    const warmStarted=performance.now(),warm=await store.getUnits(scope),warmViewMs=performance.now()-warmStarted;
                    const writesBefore=cacheWrites,second={...scope,accountId:'second-fixture',versionId:'next-release',groupId:'next-group'},cacheAssets=[];
                    for(const asset of assets){const hit=await store.getCachedOriginal(asset.hash,asset.parserVersion,asset.role);if(!hit)throw Error('Missing reusable original cache');cacheAssets.push({...hit.asset,name:asset.name});}
                    const reimportStarted=performance.now();await store.import(second,{units:loaded,assets:cacheAssets,descriptors:built.descriptors,summaries:built.summaries});const reimportMs=performance.now()-reimportStarted;
                    const result={parses,totalUnits:loaded.length,descriptorsMs,wireMetadataBytes:new TextEncoder().encode(JSON.stringify(built)).length,writeMs,coldViewMs,warmViewMs,reimportMs,cacheWrites,reimportWrites:cacheWrites-writesBefore,maximumFields,maximumPage,boundedReads,
                        sameWarmUnits:loaded[0]===warm[0],privateSavedEmpty:Object.keys(await store.getSaved(second)).length===0,workerOps,progress,totalMs:performance.now()-started};
                    localStorage.setItem('productionFixtureScope',JSON.stringify({scope,files:assets.map(asset=>({hash:asset.hash,role:asset.role,parserVersion:asset.parserVersion}))}));
                    return result;
                }finally{IDBObjectStore.prototype.put=nativePut;IDBObjectStore.prototype.getAll=nativeGetAll;worker.dispose();}
            },production.map(({name,role})=>({name,role})));
            assert.equal(productionResult.totalUnits,157909);assert.equal(productionResult.cacheWrites,157909);assert.equal(productionResult.reimportWrites,0);
            assert.equal(productionResult.sameWarmUnits,true);assert.equal(productionResult.privateSavedEmpty,true);assert.equal(productionResult.maximumPage,128);
            assert.deepEqual(productionResult.workerOps,['parseWorkbook','parseWorkbook','buildDescriptors']);
            productionResult.parses.forEach(parsed=>assert.equal(parsed.hash,production.find(file=>file.role===parsed.role).hash));
            await page.reload();await page.addScriptTag({url:'/offlineStore.js'});
            productionResult.reload=await page.evaluate(async()=>{
                const S=ClientTextState,store=ClientTextStore.create(),{scope,files}=JSON.parse(localStorage.getItem('productionFixtureScope'));
                S.buildManifest=()=>{throw Error('Unexpected reload Merkle generation');};S.buildDescriptors=()=>{throw Error('Unexpected reload descriptor generation');};
                const start=performance.now();let records=0;
                for(const file of files){const original=await store.getCachedOriginal(file.hash,file.parserVersion,file.role);if(!original)throw Error('Missing reload original');records+=original.units.length;}
                const cachedMs=performance.now()-start,warm=performance.now(),units=await store.getUnits(scope);
                return {records,cachedMs,warmViewMs:performance.now()-warm,units:units.length};
            });
            assert.equal(productionResult.reload.records,157909);assert.equal(productionResult.reload.units,157909);
            productionResult.originalsUnchanged=production.every(file=>createHash('sha256').update(readFileSync(file.path)).digest('hex')===file.hash);
            assert.equal(productionResult.originalsUnchanged,true);assert.deepEqual(pageErrors,[]);
            console.log(JSON.stringify({production:productionResult}));
        }
        const result={pass:true,checks:['native v13→v14 fence','interrupted worksheet-order cache → ID-sorted legacy retry','legacy exact HTTP bodies','receipt/draft/history preservation','native bytes/context preservation','reusable originals and scoped work','trusted sparse save receipt replay','parser cache separation','reload without manifest generation'],legacy,isolated:migrated.isolated,reopened,production:productionResult};
        writeFileSync(join(work,'result.json'),JSON.stringify(result,null,2));
        console.log(JSON.stringify({pass:true,checks:result.checks,artifact:join(work,'result.json')}));
    } finally {
        await context?.close();await new Promise(resolve=>server.close(resolve));
        if (!process.argv.includes('--keep')) {
            const target=resolve(work),parent=resolve(tmpdir());
            assert.ok(target.startsWith(parent+sep)&&target!==parent,'cleanup stays inside fixture temp directory');
            rmSync(target,{recursive:true,force:true});
        }
    }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
