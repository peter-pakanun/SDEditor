'use strict';
// Native IndexedDB + complete normal-mode SPA. Disposable local profile only.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createServer}=require('node:http');
const root=path.resolve(__dirname,'..'),temp=path.join(root,'temp');
const runtime='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright',{paths:[runtime]}));
const vuePath=process.env.FIXTURE_VUE_PATH || path.join(temp,'clienttext-fixture-vue.min.js');
const zipPath=process.env.FIXTURE_JSZIP_PATH || (fs.existsSync(path.join(temp,'clienttext-fixture-jszip.min.js'))?path.join(temp,'clienttext-fixture-jszip.min.js'):require.resolve('jszip/dist/jszip.min.js',{paths:[path.resolve(root,'../SDEditor-API/node_modules'),runtime]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const sources={poe1:process.env.CLIENTTEXT_LOCAL_POE1 || 'C:/Users/lpeac/Downloads/2026-10-19_POE1/Thai_PoE1.xlsm',poe2:process.env.CLIENTTEXT_LOCAL_POE2 || 'C:/Users/lpeac/Downloads/2026-10-13_POE2/Thai.xlsx'};
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originals=Object.fromEntries(Object.entries(sources).map(([key,file])=>[key,{file,hash:hash(file),bytes:fs.statSync(file).size}]));
const inputRun=process.pid+'-'+Date.now();
const inputCopies=Object.fromEntries(Object.keys(sources).map(game=>[game,path.join(temp,'local-browser-input-'+game+'-'+inputRun,path.basename(sources[game]))]));
const profile=path.join(temp,'local-workbook-profile-'+Date.now());fs.mkdirSync(profile,{recursive:true});
const reports=[],errors=[],networkWrites=[];
reports.push=function(...items){for(const item of items)console.log('PASS '+JSON.stringify(item));return Array.prototype.push.apply(this,items);};
const server=createServer((req,res)=>{
    try{
        const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
        if(url.pathname==='/fixture/blank'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Disposable IDB fixture</title>');return;}
        if(url.pathname.startsWith('/fixture/source/')){const game=url.pathname.split('/').pop();res.setHeader('Content-Type','application/octet-stream');res.end(fs.readFileSync(inputCopies[game]));return;}
        if(url.pathname==='/fixture/vue.js' || url.pathname==='/fixture/jszip.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(url.pathname.endsWith('/vue.js')?vuePath:zipPath));return;}
        const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp'};
        let filename=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
        const target=path.resolve(root,'public',filename);
        if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
        let bytes=fs.readFileSync(target);res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');
        if(filename==='index.html')bytes=Buffer.from(bytes.toString().replace('https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js','/fixture/vue.js').replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js','/fixture/jszip.js'));
        if(filename==='clientTextWorker.js')bytes=Buffer.from(bytes.toString().replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js','/fixture/jszip.js'));
        if(filename==='index.js')bytes=Buffer.from(bytes.toString().replace("app.mount('#app');","window.__localApp = app.mount('#app');"));
        res.end(bytes);
    }catch(error){res.writeHead(404).end();}
});
let context,page,origin;
async function launch(){
    context=await chromium.launchPersistentContext(profile,{executablePath,headless:true,viewport:{width:1440,height:1000},acceptDownloads:true,args:['--disable-gpu']});
    context.on('request',req=>{if(!['GET','HEAD','OPTIONS'].includes(req.method()))networkWrites.push({method:req.method(),url:req.url()});});
    // Do not reach real authorization or authoring endpoints from this fixture.
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin || !/\/auth\/|\/v1\//.test(url.pathname))return route.continue();return route.abort();});
    page=context.pages()[0]||await context.newPage();page.on('pageerror',e=>errors.push(e.message));
}
async function bootstrap(target=page,game='poe2'){
    await target.goto(origin);await target.waitForFunction(()=>window.__localApp?.offlineStoreReady && window.__localApp?._cloud?.state && !window.__localApp.workspaceInitializationActive,{timeout:90000});
    await target.evaluate(async game=>{
        const vm=window.__localApp;vm._cloud.destroy();vm._cloud.destroyed=false;vm._cloud.schedule=()=>{};vm._cloud.refreshSession=async()=>{};vm._cloud.sync=async()=>{};
        clearInterval(vm._cloudPoll);clearInterval(vm._managedTimer);clearInterval(vm._commentsPollTimer);clearTimeout(vm._commentsReadTimer);
        vm._cloud.request=async(path,options={})=>{if((options.method||'GET')!=='GET')throw new Error('Unexpected API write: '+path);if(path.startsWith('/v1/versions?'))return{versions:[],branch:{id:'default'}};if(path.startsWith('/v1/comments/unread?'))return{total:0,files:[]};if(path==='/v1/skill-card-catalogs/poe2/v1')return{schemaVersion:1,game:'poe2',revision:'fixture-empty',clientBuild:'0',cards:[]};throw new Error('Unneeded fixture API read: '+path);};
        vm._cloud.state=await OfflineStore.updateHybridState(state=>{state.activeProfile='guest';state.auth=null;state.profiles.guest.settings.lang='Thai';return state;});
        await vm.cloudApply(vm._cloud.snapshot());vm.needsInitialSettings=false;vm.showSetting=false;vm.inlineEditor=false;
        await vm.saveSettings();await OfflineStore.setMigratedFromSingleVersion(true);await vm.activateGameVersion(game,{checkMigration:false});await vm.ctRefreshLocal();await vm.$nextTick();
    },game);
}
async function importReal(game){
    fs.mkdirSync(path.dirname(inputCopies[game]),{recursive:true});
    fs.copyFileSync(sources[game],inputCopies[game]);
    await page.evaluate(()=>window.__localApp.ctOpenOfflineTest());
    await page.locator('.ctTestWorkbookGroup').first().locator('input[type=file]').first().setInputFiles(inputCopies[game]);
    const result=await page.evaluate(async game=>{
        const vm=window.__localApp;vm.ctUploadName='Durability '+game;const opened=await vm.ctOpenTestSheet();
        return{opened,error:vm.ctUploadError||vm.ctError,scope:JSON.parse(JSON.stringify(vm.ctWorkspace?.scope)),count:vm.ctUnits.length,metadata:JSON.parse(JSON.stringify(vm.ctWorkspace?.metadata))};
    },game);
    assert.equal(result.opened,true,result.error);assert.equal(result.error,'');assert.ok(result.count>1000);fs.unlinkSync(inputCopies[game]);return result;
}
async function lookupSaveCheck(){
    const imported=await importReal('poe2');
    reports.push({case:'PoE2 native workbook import for Lookup save check',units:imported.count});
    const chosen=await page.evaluate(async()=>{
        const vm=window.__localApp,unit=vm.ctUnits.find(unit=>vm.ctFieldsFor(unit).length===1 && vm.ctFieldsFor(unit)[0].kind==='text' && vm.ctFieldsFor(unit)[0].source);
        if(!unit)throw new Error('No ordinary visible text record');
        await vm.ctSelect(unit,true);vm.ctEditor=true;
        const field=vm.ctFieldsFor(unit)[0],activeSource=EditorReferenceCatalog.activeSource,load=vm.lookupLoadCatalog;
        window.__lookupSaveMetrics={builds:0,loads:0};
        EditorReferenceCatalog.activeSource=(...args)=>{window.__lookupSaveMetrics.builds++;return activeSource(...args);};
        vm.lookupLoadCatalog=(...args)=>{window.__lookupSaveMetrics.loads++;return load(...args);};
        vm.ctTool='lookup';return{unitId:unit.id,fieldId:field.id,query:unit.recordId};
    });
    await page.waitForFunction(()=>{const vm=window.__localApp;return vm.lookupCatalogKey===vm.lookupSessionKey;});
    const search=page.getByRole('searchbox',{name:'Search reference files'}),input=page.locator('[data-ct-target]').first();
    await search.fill(chosen.query);await page.waitForFunction(query=>window.__localApp.lookupAppliedQuery===query,chosen.query);
    await page.evaluate(fieldId=>{const vm=window.__localApp;vm.lookupSelect(vm.lookupResults.find(entry=>entry.field.id===fieldId).key);},chosen.fieldId);
    for(const theme of ['light','grey','dark','modern-dark']){
        await page.evaluate(theme=>{document.documentElement.setAttribute('data-theme',theme);const vm=window.__localApp;
            window.__lookupBefore={results:vm.lookupResults,reference:vm.lookupSelectedReference,selected:vm.lookupSelectedFilepath,page:vm.lookupPage,...window.__lookupSaveMetrics};},theme);
        const value='Lookup committed '+theme;await input.fill(value);await input.focus();
        const saved=await page.evaluate(async()=>{const vm=window.__localApp,start=performance.now();if(!await vm.ctSave(false))throw new Error(vm.ctError);await vm.$nextTick();
            const b=window.__lookupBefore;return{ms:performance.now()-start,sameResults:vm.lookupResults===b.results,sameReference:vm.lookupSelectedReference===b.reference,
                sameSelection:vm.lookupSelectedFilepath===b.selected,samePage:vm.lookupPage===b.page,builds:window.__lookupSaveMetrics.builds-b.builds,loads:window.__lookupSaveMetrics.loads-b.loads};});
        assert.deepEqual({...saved,ms:0},{ms:0,sameResults:true,sameReference:true,sameSelection:true,samePage:true,builds:0,loads:0});
        await search.focus();await search.press('Enter');
        await page.waitForFunction(value=>window.__localApp.lookupSelectedReference?.blocks[0].translation===value,value);
        const durable=await page.evaluate(async chosen=>{const vm=window.__localApp;return(await vm.ctStorage(vm.ctWorkspace.scope).getSaved(vm.ctWorkspace.scope))[chosen.unitId].values[chosen.fieldId];},chosen);
        assert.equal(durable,value);
        reports.push({case:'Lookup remains stable across native Save; Enter refreshes saved reference',theme,units:imported.count,saveMs:saved.ms});
    }
    await input.fill('Lookup reopened target');
    assert.equal(await page.evaluate(()=>window.__localApp.ctSave(false)),true);
    await page.evaluate(async()=>{const vm=window.__localApp;vm.ctTool='dictionary';await vm.$nextTick();vm.ctTool='lookup';});
    await page.waitForFunction(()=>window.__localApp.lookupSelectedReference?.blocks[0].translation==='Lookup reopened target');
    assert.deepEqual(errors,[]);assert.deepEqual(networkWrites,[]);
    fs.writeFileSync(path.join(temp,'lookup-local-save-results.json'),JSON.stringify({ok:true,chosen,reports,errors,networkWrites},null,2));
}
async function chooseEditAndDraft(){return page.evaluate(async()=>{
    const vm=window.__localApp,units=vm.ctUnits.filter(unit=>vm.ctFieldsFor(unit).some(field=>field.kind!=='gender' && field.source && !ClientTextUI.isDNTSource(field.source)));
    const savedUnit=units[0],draftUnit=units.find(unit=>unit.id!==savedUnit.id);await vm.ctSelect(savedUnit,true);
    const savedField=vm.ctFieldsFor(savedUnit).find(field=>field.kind!=='gender'),draftField=vm.ctFieldsFor(draftUnit).find(field=>field.kind!=='gender');
    vm.ctValues[savedField.id]='Synthetic durable committed edit';vm.ctDraftDirty=true;vm.ctQueueDraft();const saved=await vm.ctSave(false);
    if(!saved)throw new Error('Save failed: '+vm.ctError);await vm.ctSelect(draftUnit,true);vm.ctValues[draftField.id]='Synthetic active draft \r\n [DNT] exact';vm.ctDraftDirty=true;vm.ctQueueDraft();
    // Exercise the timer-driven checkpoint, without a flush or unload event.
    for(let attempt=0;attempt<100 && vm.ctLocalDraftState==='pending';attempt++)await new Promise(resolve=>setTimeout(resolve,20));
    if(vm.ctLocalDraftState!=='checkpointed')throw new Error('Automatic draft checkpoint failed: '+vm.ctError);
    return{savedUnit:savedUnit.id,savedField:savedField.id,draftUnit:draftUnit.id,draftField:draftField.id,scope:JSON.parse(JSON.stringify(vm.ctWorkspace.scope)),status:vm.ctStatus(savedUnit),draftRevision:vm._ctDraftRevision};
});}
async function reopenAndAssert(scope,edits){
    const status=await page.evaluate(async({scope,edits})=>{const vm=window.__localApp,meta=await vm._ctStore.getMetadata(scope);if(!await vm.ctOpenCached(meta))throw new Error(vm.ctError);await vm.ctSelect(vm.ctUnits.find(unit=>unit.id===edits.draftUnit),true);return{saved:vm.ctSaved[edits.savedUnit]?.values[edits.savedField],draft:vm.ctValues[edits.draftField],history:(await vm.ctStorage(scope).listHistory(scope,edits.savedUnit)).length,draftDirty:vm.ctDraftDirty,checkpoint:vm.ctLocalDraftState,asset:await vm.ctStorage(scope).getAsset(scope,'normal').then(async asset=>({hash:await ClientTextState.sha256(await asset.blob.arrayBuffer()),bytes:asset.blob.size})),outbox:await vm._ctStore.getOutbox(scope)};},{scope,edits});
    assert.equal(status.saved,'Synthetic durable committed edit');assert.equal(status.draft,'Synthetic active draft \r\n [DNT] exact');assert.equal(status.draftDirty,true);assert.ok(status.history>=1);assert.deepEqual(status.outbox,[]);return status;
}
async function reviewFixes(){
    const result=await page.evaluate(async()=>{
        const vm=window.__localApp,base=vm._ctStore,local=vm._ctLocalStore,S=ClientTextState,C=ClientTextStore;
        const zip=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
        zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ClientStrings" sheetId="1" r:id="rId1"/></sheets></workbook>`);
        zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
        zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ID</t></is></c><c r="B1" t="inlineStr"><is><t>Text</t></is></c><c r="C1" t="inlineStr"><is><t>Translation</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>review-first</t></is></c><c r="B2" t="inlineStr"><is><t>First source</t></is></c><c r="C2" t="inlineStr"><is><t>Initial target</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>review-second</t></is></c><c r="B3" t="inlineStr"><is><t>Second source</t></is></c><c r="C3" t="inlineStr"><is><t>Other target</t></is></c></row></sheetData></worksheet>`);
        const bytes=await zip.generateAsync({type:'arraybuffer'}),parsed=await vm._ctWorker.parseWorkbook(bytes,{filename:'Thai.xlsx',role:'normal',language:'Thai',game:'poe2'}),units=parsed.units;
        const scope={...vm.ctRequestScope(),language:'Thai',versionId:'local:test:'+crypto.randomUUID(),groupId:'local:test:'+crypto.randomUUID()};
        const asset={role:'normal',name:'Thai.xlsx',blob:new Blob([bytes]),hash:parsed.artifactHash,parserVersion:parsed.parserVersion,parsed:{...parsed,units:undefined}},built=await S.buildDescriptors(units,[asset]);
        const input={units,assets:[asset],descriptors:built.descriptors,metadata:{version:{id:scope.versionId,name:'Protocol review fixture',game:'poe2',branchId:'default'},group:{id:scope.groupId,versionId:scope.versionId,contentMode:'clienttext',language:'Thai'}}};
        const stamped=await base.import(scope,input),db=await OfflineStore.openClientTextDb(),metaKey=JSON.stringify([C.scopeKey(scope),'meta']);
        const rawMeta=()=>new Promise((resolve,reject)=>{const tx=db.transaction(C.stores.meta,'readonly'),req=tx.objectStore(C.stores.meta).get(metaKey);tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error);});
        const writeMeta=row=>new Promise((resolve,reject)=>{const tx=db.transaction(C.stores.meta,'readwrite');tx.objectStore(C.stores.meta).put(row);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
        const canonical=async value=>{
            if(value instanceof Blob)return{blobBytes:value.size,type:value.type,sha256:await S.sha256(await value.arrayBuffer())};
            if(value instanceof ArrayBuffer)return{arrayBytes:value.byteLength,sha256:await S.sha256(value)};
            if(ArrayBuffer.isView(value))return{view:value.constructor.name,sha256:await S.sha256(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength))};
            if(Array.isArray(value))return Promise.all(value.map(canonical));
            if(value && typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=await canonical(value[key]);return out;}
            return value;
        };
        const snapshot=async()=>{
            const names=Array.from(db.objectStoreNames).sort(),tx=db.transaction(names,'readonly');
            const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
            const rows=await Promise.all(names.map(name=>new Promise((resolve,reject)=>{const req=tx.objectStore(name).getAll();req.onsuccess=()=>resolve([name,req.result]);req.onerror=()=>reject(req.error);})));await done;
            return JSON.stringify(await canonical(Object.fromEntries(rows)));
        };
        const rejected=async action=>{try{const value=await action();return{rejected:value===false,error:value===false?vm.ctError:'',value:value===false?null:value};}catch(error){return{rejected:true,error:error.message,code:error.code};}};
        if(!await vm.ctOpenCached(stamped))throw new Error('Current protocol Reopen failed: '+vm.ctError);
        await vm.ctSelect(vm.ctUnits[0],true);const unit=vm.ctCurrentUnit,fieldId=unit.fields.find(field=>field.kind!=='gender').id;
        const saveCommand={jobId:crypto.randomUUID(),values:S.valuesFor(unit),reviewed:{},expectedRevision:0,expectedDraftRevision:null},save=await base.save(scope,unit.id,saveCommand);
        const draft=await base.putDraft(scope,unit.id,{values:{...save.saved.values,[fieldId]:'Retained protocol draft'},reviewed:{}},{expectedRevision:null});
        await base.seedMemory(scope,[]);const good=await rawMeta(),backup=await local.backup(scope),protocolCases=[];
        for(const field of ['localProtocol','storageProtocol']){
            const value=field==='localProtocol'?'clienttext-local-v1':'clienttext-trusted-v1';
            const metadata=await base.getMetadata(scope);protocolCases.push({field,variant:'current',value:metadata[field],expected:value,reopen:await vm.ctOpenCached(metadata)});
        }
        for(const field of ['localProtocol','storageProtocol'])for(const variant of ['missing','malformed','future']){
            await writeMeta(good);await local.acquire(scope);vm.ctDraftDirty=false;
            const changed=structuredClone(good);if(variant==='missing')delete changed.value[field];else changed.value[field]=variant==='malformed'?{unexpected:1}:field==='localProtocol'?'clienttext-local-v99':'clienttext-trusted-v99';
            await writeMeta(changed);const probes=[];
            const actions={
                read:()=>base.getMetadata(scope),
                save:()=>base.save(scope,unit.id,{jobId:crypto.randomUUID(),values:save.saved.values,reviewed:{},expectedRevision:save.saved.revision,expectedDraftRevision:draft.revision}),
                'receipt-replay':()=>base.save(scope,unit.id,saveCommand),
                draft:()=>base.putDraft(scope,unit.id,{values:save.saved.values,reviewed:{}},{expectedRevision:draft.revision}),
                discard:()=>base.discardDraft(scope,unit.id,{expectedRevision:draft.revision}),
                seed:()=>base.seedMemory(scope,[]),
                reimport:()=>base.import(scope,input),
                reopen:()=>vm.ctOpenCached(changed.value),
            };
            for(const [action,operation]of Object.entries(actions)){const before=await snapshot(),outcome=await rejected(operation),after=await snapshot();probes.push({action,rejected:outcome.rejected,error:outcome.error,unchanged:before===after});}
            const badZip=await JSZip.loadAsync(backup),manifest=JSON.parse(await badZip.file('local-workbook.json').async('string'));
            if(variant==='missing')delete manifest.workspaces[0].metadata[field];else manifest.workspaces[0].metadata[field]=changed.value[field];
            badZip.file('local-workbook.json',JSON.stringify(manifest));const badBackup=await badZip.generateAsync({type:'blob'}),beforeRestore=await snapshot(),restore=await rejected(()=>local.restore(badBackup,vm.ctRequestScope(),vm._ctWorker)),afterRestore=await snapshot();
            probes.push({action:'backup-restore',rejected:restore.rejected,error:restore.error,unchanged:beforeRestore===afterRestore});protocolCases.push({field,variant,probes});
        }
        const atomicRaces=[];
        for(const field of ['localProtocol','storageProtocol'])for(const action of ['save','draft','discard','seed']){
            await writeMeta(good);const before=await snapshot(),nativeTx=IDBDatabase.prototype.transaction;let injected=false;
            IDBDatabase.prototype.transaction=function(names,mode,...rest){
                const selected=Array.from(typeof names==='string'?[names]:names),target=action==='save'?C.stores.saved:action==='seed'?C.stores.memory:C.stores.drafts;
                if(this===db && mode==='readwrite' && selected.includes(target) && !injected){
                    injected=true;const row=structuredClone(good);row.value[field]=field==='localProtocol'?'clienttext-local-v99':'clienttext-trusted-v99';
                    // Queue a separate native writer ahead of the target write
                    // transaction, after its ordinary readonly preparation.
                    const conflict=nativeTx.call(this,C.stores.meta,'readwrite');conflict.objectStore(C.stores.meta).put(row);
                }
                return nativeTx.call(this,names,mode,...rest);
            };
            let outcome;try{outcome=await rejected(()=>action==='save'?base.save(scope,unit.id,{jobId:crypto.randomUUID(),values:save.saved.values,reviewed:{},expectedRevision:save.saved.revision,expectedDraftRevision:draft.revision}):action==='draft'?base.putDraft(scope,unit.id,{values:save.saved.values,reviewed:{}},{expectedRevision:draft.revision}):action==='discard'?base.discardDraft(scope,unit.id,{expectedRevision:draft.revision}):base.seedMemory(scope,[]));}finally{IDBDatabase.prototype.transaction=nativeTx;}
            await writeMeta(good);atomicRaces.push({field,action,injected,rejected:outcome.rejected,error:outcome.error,unchanged:before===await snapshot()});
        }
        await writeMeta(good);vm.ctDraftDirty=false;if(!await vm.ctOpenCached(good.value))throw new Error('Current workspace did not recover after restoring test metadata: '+vm.ctError);await vm.ctSelect(vm.ctUnits[0],true);vm.ctError='';
        async function quotaFailure(text){
            const native=IDBObjectStore.prototype.put;let injected=false;IDBObjectStore.prototype.put=function(value,...rest){if(this.name===C.stores.drafts&&!injected){injected=true;throw new DOMException('Injected transient quota','QuotaExceededError');}return native.call(this,value,...rest);};
            vm.ctValues[fieldId]=text;vm.ctDraftDirty=true;vm.ctQueueDraft();let result;try{result=await vm.ctFlushDraft();}finally{IDBObjectStore.prototype.put=native;}
            return{result,injected,error:vm.ctError,state:vm.ctLocalDraftState};
        }
        const failed=await quotaFailure('Exact retry draft'),retried=await vm.ctFlushDraft(),retry={failed,retried,error:vm.ctError,state:vm.ctLocalDraftState,stored:(await local.getDraft(scope,unit.id)).values[fieldId]};
        const failedUnrelated=await quotaFailure('Retry with unrelated error'),nativePut=local.putDraft;let unrelatedRetry;
        local.putDraft=async(...args)=>{const saved=await nativePut(...args);vm.ctError='Unrelated export error must remain visible';return saved;};
        try{const result=await vm.ctFlushDraft();unrelatedRetry={failed:failedUnrelated,result,error:vm.ctError,state:vm.ctLocalDraftState,stored:(await local.getDraft(scope,unit.id)).values[fieldId]};}finally{local.putDraft=nativePut;}
        vm.ctError='';const failedOtherUnit=await quotaFailure('Retry after selection changed'),beforeUnit=vm.ctSelection,otherUnit=vm.ctUnits.find(value=>value.id!==beforeUnit);
        local.putDraft=async(...args)=>{const saved=await nativePut(...args);vm.ctSelection=otherUnit.id;return saved;};let otherUnitRetry;
        try{const result=await vm.ctFlushDraft();otherUnitRetry={failed:failedOtherUnit,result,error:vm.ctError,selection:vm.ctSelection,otherUnitId:otherUnit.id};}finally{local.putDraft=nativePut;vm.ctDraftDirty=false;vm.ctSelection=beforeUnit;}
        return{stamped:{localProtocol:stamped.localProtocol,storageProtocol:stamped.storageProtocol},protocolCases,atomicRaces,retry,unrelatedRetry,otherUnitRetry};
    });
    assert.deepEqual(result.stamped,{localProtocol:'clienttext-local-v2',storageProtocol:'clienttext-trusted-v1'});
    for(const item of result.protocolCases){if(item.variant==='current'){assert.equal(item.value,item.expected);assert.equal(item.reopen,true);}else for(const probe of item.probes){assert.equal(probe.rejected,true,JSON.stringify({field:item.field,variant:item.variant,...probe}));assert.equal(probe.unchanged,true,JSON.stringify({field:item.field,variant:item.variant,...probe}));}}
    for(const probe of result.atomicRaces){assert.equal(probe.injected,true,JSON.stringify(probe));assert.equal(probe.rejected,true,JSON.stringify(probe));assert.equal(probe.unchanged,true,JSON.stringify(probe));}
    assert.equal(result.retry.failed.result,false);assert.equal(result.retry.failed.injected,true);assert.match(result.retry.failed.error,/not stored/);assert.equal(result.retry.retried,true);assert.equal(result.retry.error,'');assert.equal(result.retry.state,'checkpointed');assert.equal(result.retry.stored,'Exact retry draft');
    assert.equal(result.unrelatedRetry.failed.result,false);assert.equal(result.unrelatedRetry.result,true);assert.equal(result.unrelatedRetry.error,'Unrelated export error must remain visible');assert.equal(result.unrelatedRetry.stored,'Retry with unrelated error');
    assert.equal(result.otherUnitRetry.failed.result,false);assert.equal(result.otherUnitRetry.result,true);assert.equal(result.otherUnitRetry.selection,result.otherUnitRetry.otherUnitId);assert.equal(result.otherUnitRetry.error,result.otherUnitRetry.failed.error);
    reports.push({case:'native protocol gates current/missing/malformed/future metadata, refused operations leave every IDB record unchanged',ok:true,negativeCases:result.protocolCases.filter(item=>item.variant!=='current').length,operationsPerCase:9});
    reports.push({case:'native metadata writer races after readonly preparation abort Save/draft/discard/seed atomically',ok:true,negativeCases:result.atomicRaces.length});
    reports.push({case:'native transient checkpoint retry clears its owned warning; unrelated and different-unit errors remain',ok:true});
    const report={ok:true,origin,profile,reports,result,errors,networkWrites};assert.deepEqual(errors,[]);assert.deepEqual(networkWrites,[]);fs.writeFileSync(path.join(temp,'clienttext-local-review-fixes-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
async function intentConflictCheck(){
    const seeded=await page.evaluate(async()=>{
        const vm=window.__localApp,S=ClientTextState,zip=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',cell=(r,v)=>`<c r="${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
        const specs=[['ClientStrings',['ID','Name','Translation','Gender'],['equal','Synthetic shared source','','M']],['Forms',['ID','Name','MS','FS'],['form','Synthetic form','','']],['DNT',['ID','Name','Translation'],['dnt','[DNT] Synthetic source','']]];
        zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
        zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${specs.map((s,i)=>`<sheet name="${s[0]}" sheetId="${i+1}" r:id="r${i+1}"/>`).join('')}</sheets></workbook>`);
        zip.file('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${specs.map((s,i)=>`<Relationship Id="r${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/s${i}.xml"/>`).join('')}</Relationships>`);
        for(const [i,s]of specs.entries())zip.file(`xl/worksheets/s${i}.xml`,`<worksheet xmlns="${ns}"><sheetData><row r="1">${s[1].map((v,j)=>cell(String.fromCharCode(65+j)+'1',v)).join('')}</row><row r="2">${s[2].map((v,j)=>cell(String.fromCharCode(65+j)+'2',v)).join('')}</row></sheetData></worksheet>`);
        await vm.ctOpenOfflineTest();vm.ctAddUploadFiles([new File([await zip.generateAsync({type:'uint8array'})],'Thai.xlsx')]);if(!await vm.ctOpenTestSheet())throw new Error(vm.ctError || vm.ctUploadError);
        const units=vm.ctUnits,unit=units.find(u=>u.sheet==='ClientStrings'),field=unit.fields[0],asset=await vm._ctLocalStore.getAsset(vm.ctWorkspace.scope,'normal'),scope={...vm.ctWorkspace.scope,versionId:'review-shared-version',groupId:'review-shared-group'};
        const version={id:scope.versionId,game:'poe2',branchId:'default',name:'Synthetic shared recovery'},group={id:scope.groupId,versionId:scope.versionId,contentMode:'clienttext',language:'Thai',roles:['normal']};
        await vm._ctStore.import(scope,{units,assets:[asset],descriptors:vm.ctWorkspace.metadata.descriptors,metadata:{version,group}});
        const values=S.valuesFor(unit),hash=S.sourceHash(field.source),mark=jobId=>({jobId,intentProtocol:S.ENGLISH_INTENT_PROTOCOL,englishActions:{[field.id]:{action:'set',sourceHash:hash}},values,reviewed:{[field.id]:hash}});
        const peer=(revision,decisionId)=>({unitId:unit.id,revision,values,reviewed:{[field.id]:hash},saved:false,englishIntent:{[field.id]:{state:'active',sourceHash:hash,decisionId}}});
        window.__intentReview={scope,unit,field,units,asset,group,version,mark,peer};
        window.__intentReload=async()=>{vm.ctWorkspace={scope,metadata:await vm._ctStore.getMetadata(scope)};vm.activeContentGroup=group;vm.ctPolicy={clientTextEnglishIntent:S.ENGLISH_INTENT_PROTOCOL,clientTextEnglishEligibility:S.ENGLISH_ELIGIBILITY_PROTOCOL};vm.ctSaved=Vue.markRaw(await vm._ctStore.getSaved(scope));vm.ctSelection='';vm.ctDraftDirty=false;vm._ctSaveJob=null;vm._ctSync=null;vm.ctActive=true;vm.ctEditor=true;await vm.ctSelect(unit,true);await vm.$nextTick();};
        await vm._ctStore.save(scope,unit.id,mark('my-first'));await vm._ctStore.applyRemote(scope,{events:[{unit:peer(1,'peer-first')}],sequence:1});await window.__intentReload();
        return{unitId:unit.id,fieldId:field.id};
    });
    assert.equal(await page.getByRole('button',{name:'Use English',exact:true}).first().isDisabled(),true);
    await page.evaluate(()=>{const store=window.__localApp._ctStore,native=store.acceptPendingPeer;let once=true;store.acceptPendingPeer=async(...args)=>{const result=await native(...args);if(once){once=false;throw new Error('Synthetic lost recovery acknowledgement');}return result;};});
    await page.getByRole('button',{name:'Accept shared version',exact:true}).click();
    await page.waitForFunction(()=>{const vm=window.__localApp;return !vm.ctBusy && !vm.ctRecoveryBusy && !!vm._ctRecoveryJob;});
    await page.getByRole('button',{name:'Accept shared version',exact:true}).click();
    await page.waitForFunction(()=>{const vm=window.__localApp;return !vm.ctBusy && !vm.ctPendingSharedRecovery();});
    const accepted=await page.evaluate(async()=>{const vm=window.__localApp,h=window.__intentReview;return{pending:(await vm._ctStore.getOutbox(h.scope)).length,decision:vm.ctSaved[h.unit.id].englishIntent[h.field.id].decisionId,job:!!vm._ctSaveJob};});
    assert.equal(accepted.pending,0);assert.equal(accepted.decision,'peer-first');assert.equal(accepted.job,false);
    await page.evaluate(async()=>{const vm=window.__localApp,h=window.__intentReview;await vm._ctStore.save(h.scope,h.unit.id,h.mark('my-second'));await vm._ctStore.applyRemote(h.scope,{events:[{unit:h.peer(2,'peer-second')}],sequence:2});await window.__intentReload();});
    await page.getByRole('button',{name:'Reapply retained work and save ID',exact:true}).click();
    await page.waitForFunction(()=>{const vm=window.__localApp;return !vm.ctBusy && !vm.ctPendingSharedRecovery() && !vm._ctSaveJob;});
    const reapplied=await page.evaluate(async()=>{const vm=window.__localApp,h=window.__intentReview,p=(await vm._ctStore.getOutbox(h.scope))[0],history=await vm._ctStore.listHistory(h.scope,h.unit.id);return{fresh:p.mutationId!=='my-second',predecessor:!!p.predecessor,proof:p.englishEligibility?.protocol,archived:history.some(e=>e.syncRecovery?.operation.mutationId==='my-second')};});
    assert.equal(reapplied.fresh,true);assert.equal(reapplied.predecessor,false);assert.equal(reapplied.archived,true);assert.equal(reapplied.proof,'clienttext-english-eligibility-v1');
    assert.ok(await page.getByTitle('Use English is unavailable for Gender metadata.',{exact:true}).count());
    const legacy=await page.evaluate(async()=>{const vm=window.__localApp,S=ClientTextState,h=window.__intentReview,scope={...h.scope,versionId:'review-legacy-version',groupId:'review-legacy-group'},version={...h.version,id:scope.versionId},group={...h.group,id:scope.groupId,versionId:scope.versionId};
        await vm._ctStore.import(scope,{units:h.units,assets:[h.asset],descriptors:vm.ctWorkspace.metadata.descriptors,metadata:{version,group}});await vm._ctStore.save(scope,h.unit.id,{jobId:'legacy-rejected',values:S.valuesFor(h.unit)});const peer=h.peer(1,'legacy-peer');await vm._ctStore.applyRemote(scope,{events:[{unit:peer}],sequence:1});const sent=[];
        const sync=ClientTextSync.create({scope,store:vm._ctStore,request:async(path,init)=>{sent.push(JSON.parse(JSON.stringify(init.body)));if(!init.body.intentProtocol)return new Response(JSON.stringify({error:{code:'CLIENTTEXT_INTENT_REQUIRED',message:'Update protocol'},current:peer}),{status:400,headers:{'content-type':'application/json'}});return{unit:{...peer,revision:2}};}});
        try{await sync.flush();}catch(error){if(error.code!=='CLIENTTEXT_INTENT_REQUIRED')throw error;}await sync.flush();
        h.scope=scope;h.group=group;h.version=version;window.__legacySync=sync;window.__legacySent=sent;
        vm.ctWorkspace={scope,metadata:await vm._ctStore.getMetadata(scope)};vm.activeContentGroup=group;vm.ctSaved=Vue.markRaw(await vm._ctStore.getSaved(scope));vm.ctSelection='';vm.ctDraftDirty=false;await vm.ctSelect(h.unit,true);return{sent:sent.length,state:(await vm._ctStore.getOutbox(scope))[0].state};
    });
    assert.equal(legacy.sent,1);assert.equal(legacy.state,'rejected');
    await page.getByRole('button',{name:'Reapply retained work and save ID',exact:true}).click();await page.waitForFunction(()=>!window.__localApp.ctBusy && !window.__localApp.ctRecoveryBusy && !window.__localApp._ctSaveJob && !window.__localApp.ctPendingSharedRecovery());
    const recovered=await page.evaluate(async()=>{const vm=window.__localApp,h=window.__intentReview;await window.__legacySync.flush();const history=await vm._ctStore.listHistory(h.scope,h.unit.id);return{sent:window.__legacySent.length,pending:(await vm._ctStore.getOutbox(h.scope)).length,oldBody:history.find(e=>e.syncRecovery?.operation.mutationId==='legacy-rejected')?.syncRecovery.operation.requestBody};});
    assert.equal(recovered.sent,2);assert.equal(recovered.pending,0);assert.equal(recovered.oldBody.mutationId,'legacy-rejected');assert.equal(recovered.oldBody.intentProtocol,undefined);
    const unsupported=await page.evaluate(async()=>{const vm=window.__localApp,h=window.__intentReview,S=ClientTextState,dnt=h.units.find(u=>u.sheet==='DNT'),field=dnt.fields[0];vm.hideDNT=false;await vm._ctStore.applyRemote(h.scope,{events:[{unit:{unitId:dnt.id,revision:1,values:S.valuesFor(dnt),reviewed:{},saved:false,englishIntent:{[field.id]:{state:'active',sourceHash:S.sourceHash(field.source),decisionId:'unsupported-old-server'}}}}],sequence:3});
        vm.ctSaved=Vue.markRaw(await vm._ctStore.getSaved(h.scope));await vm.ctSelect(dnt,true);await vm.$nextTick();return{state:vm.ctSaved[dnt.id].englishIntent[field.id].state,sequence:(await vm._ctStore.getMetadata(h.scope)).sequence};});
    assert.equal(unsupported.state,'needs_review');assert.equal(unsupported.sequence,3);assert.ok(await page.locator('.fieldEnglishTarget[title^="Use English is unavailable for DNT fields."]').count());
    await page.evaluate(async()=>{const vm=window.__localApp;await vm.ctSelect(window.__intentReview.units.find(u=>u.sheet==='Forms'),true);});assert.ok(await page.getByTitle('Use English is unavailable for grammatical and class forms until their fallback behavior is verified.',{exact:true}).count());
    assert.deepEqual(errors,[]);assert.deepEqual(networkWrites,[]);const report={ok:true,seeded,accepted,reapplied,legacy,recovered,unsupported,errors,networkWrites};fs.writeFileSync(path.join(temp,'clienttext-use-english-conflicts.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
async function englishIntentCheck(){
    const imported=await importReal('poe2');
    const chosen=await page.evaluate(async()=>{
        const vm=window.__localApp,u=vm.ctUnits.find(unit=>!ClientTextState.statusFor(unit).missing && vm.ctFieldsFor(unit).some(field=>vm.ctEnglishEligible(field) && field.target.trim()));
        await vm.ctSelect(u,true);vm.ctEditor=true;await vm.$nextTick();const field=vm.ctFieldsFor(u).find(field=>vm.ctEnglishEligible(field));
        vm.ctValues[field.id]=field.source;vm.ctDraftDirty=true;vm.ctQueueDraft();
        if(!await vm.ctSave(false))throw new Error(vm.ctError || 'Identical translation save failed');
        if(vm.ctSaved[u.id].englishIntent?.[field.id])throw new Error('Identical Save inferred Use English');
        window.__englishChoice={unitId:u.id,fieldId:field.id,previousValue:field.source,scope:JSON.parse(JSON.stringify(vm.ctWorkspace.scope))};
        return{unitId:u.id,fieldId:field.id,scope:window.__englishChoice.scope,offer:vm.ctEnglishOffer(field)};
    });
    assert.equal(chosen.offer,true);
    const offer=page.locator('.fieldEnglishTarget').first();
    await offer.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(temp,'use-english-offer.png')});
    await offer.getByRole('button',{name:'Use English',exact:true}).click();
    await page.waitForFunction(()=>{const vm=window.__localApp,c=window.__englishChoice;return !vm.ctBusy && vm.ctSaved[c.unitId]?.englishIntent?.[c.fieldId]?.state==='active';});
    const applied=await page.evaluate(async()=>{const vm=window.__localApp,c=window.__englishChoice,h=await vm.ctStorage(c.scope).listHistory(c.scope,c.unitId);return{blank:vm.ctSaved[c.unitId].values[c.fieldId]==='',normalMissingCounter:vm.ctCounts.missing,fieldMissing:vm.ctFieldStatus(vm.ctCurrentUnit.fields.find(f=>f.id===c.fieldId)).missing,history:h.length,prior:h.some(e=>e.intentChanges?.[c.fieldId]?.previousValue===c.previousValue),outbox:await vm._ctStore.getOutbox(c.scope)};});
    assert.equal(applied.blank,true);assert.equal(applied.fieldMissing,false);assert.equal(applied.prior,true);assert.equal(applied.history,2);assert.deepEqual(applied.outbox,[]);
    const output=await page.evaluate(async chosen=>{const vm=window.__localApp,native=window.saveAs;let result;window.saveAs=(blob,name)=>{result={blob,name};};try{if(!await vm.ctDownload())throw new Error(vm.ctError);}finally{window.saveAs=native;}
        const parsed=await vm._ctWorker.parseWorkbook(await result.blob.arrayBuffer(),{filename:result.name,role:'normal',language:'Thai',game:'poe2',parserVersion:vm.ctWorkspace.metadata.descriptors[0].parserVersion});
        return{name:result.name,target:parsed.units.find(u=>u.id===chosen.unitId).fields.find(f=>f.id===chosen.fieldId).target,colors:ClientTextCodec.TAB_COLORS};},chosen);
    assert.equal(output.target,'');assert.match(output.name,/_Translated\.xlsx$/);assert.equal(output.colors.revised,'793BB6');assert.equal(output.colors.filled,'626B7A');
    await page.getByRole('button',{name:'Close',exact:true}).last().click();
    await page.locator('.fieldEnglishButton.active').first().scrollIntoViewIfNeeded();
    for(const theme of ['light','grey','dark','modern-dark']){await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);await page.screenshot({path:path.join(temp,'use-english-'+theme+'.png')});}
    await page.reload();await bootstrap();
    const recovered=await page.evaluate(async chosen=>{const vm=window.__localApp,meta=await vm._ctStore.getMetadata(chosen.scope);if(!await vm.ctOpenCached(meta))throw new Error(vm.ctError);await vm.ctSelect(vm.ctUnits.find(u=>u.id===chosen.unitId),true);vm.ctEditor=true;const active=vm.ctUsesEnglish(vm.ctCurrentUnit.fields.find(f=>f.id===chosen.fieldId));
        const blob=await vm._ctLocalStore.backup(chosen.scope),scope=await vm._ctLocalStore.restore(blob,vm.ctRequestScope(),vm._ctWorker);const restored=await vm._ctStore.getSaved(scope);return{active,normalMissingCounter:vm.ctCounts.missing,fieldMissing:vm.ctFieldStatus(vm.ctCurrentUnit.fields.find(f=>f.id===chosen.fieldId)).missing,restoredMissing:ClientTextState.statusFor(vm.ctCurrentUnit,restored[chosen.unitId]).fields[chosen.fieldId].missing,restoredCounter:ClientTextState.counts(vm.ctUnits,restored).missing,scope,backupBytes:blob.size,restored:restored[chosen.unitId].englishIntent[chosen.fieldId].state};},chosen);
    assert.equal(recovered.active,true);assert.equal(recovered.fieldMissing,false);assert.equal(recovered.restoredMissing,false);assert.equal(recovered.normalMissingCounter,applied.normalMissingCounter);assert.equal(recovered.restoredCounter,applied.normalMissingCounter);assert.equal(recovered.restored,'active');assert.notEqual(recovered.scope.groupId,chosen.scope.groupId);
    await page.getByRole('button',{name:'Use English',exact:true}).first().click();
    await page.waitForFunction(chosen=>{const vm=window.__localApp;return !vm.ctBusy && !vm._ctSaveJob && vm.ctSaved[chosen.unitId]?.englishIntent?.[chosen.fieldId]?.state==='revoked';},chosen);
    assert.equal(await page.evaluate(()=>window.__localApp.ctCounts.missing),applied.normalMissingCounter+1,'revocation restores the visible normal Missing count');
    const predecessor=await page.evaluate(async()=>{const vm=window.__localApp,u=vm.ctUnits.find(unit=>vm.ctFieldsFor(unit).some(field=>vm.ctEnglishEligible(field) && !field.target.trim()));await vm.ctSelect(u,true);const field=vm.ctFieldsFor(u).find(field=>vm.ctEnglishEligible(field) && !field.target.trim());if(!await vm.ctChooseEnglish(field))throw new Error(vm.ctError || 'Blank decision failed');
        const scope=JSON.parse(JSON.stringify(vm.ctWorkspace.scope)),asset=await vm.ctStorage(scope).getAsset(scope,'normal');window.__englishNextFile=new File([asset.blob],asset.name || 'Thai.xlsx');await vm.ctShowVersionChooser();await vm.ctOpenOfflineTest();vm.ctAddUploadFiles([window.__englishNextFile]);return{scope,unitId:u.id,fieldId:field.id};});
    await page.getByLabel('Carry Use English decisions from a saved local workbook',{exact:false}).selectOption(predecessor.scope.groupId);
    const successor=await page.evaluate(async predecessor=>{const vm=window.__localApp;vm.ctUploadName='Explicit English successor';if(!await vm.ctOpenTestSheet())throw new Error(vm.ctUploadError || vm.ctError);return{scope:JSON.parse(JSON.stringify(vm.ctWorkspace.scope)),state:vm.ctSaved[predecessor.unitId]?.englishIntent?.[predecessor.fieldId]?.state,previous:vm.ctWorkspace.metadata.previousScope?.groupId,saved:vm.ctSaved[predecessor.unitId]?.saved};},predecessor);
    assert.equal(successor.state,'active');assert.equal(successor.previous,predecessor.scope.groupId);assert.equal(successor.saved,false);assert.notEqual(successor.scope.groupId,predecessor.scope.groupId);
    for(const [game,value]of Object.entries(originals))assert.equal(hash(value.file),value.hash,game+' original unchanged');
    assert.deepEqual(errors,[]);assert.deepEqual(networkWrites,[]);
    const report={ok:true,case:'Use English real PoE2 text: optional offer, ordinary identical save, explicit conversion/history, blank export, reload, backup/restore, revocation and explicit local successor',units:imported.count,applied,output,recovered,successor,errors,networkWrites,originals};
    fs.writeFileSync(path.join(temp,'clienttext-use-english-browser-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
async function run(){
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;await launch();
    try{
        await page.goto(origin+'/fixture/blank');await page.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('sdeditor',23);req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('kv',{keyPath:'key'});const revisions=db.createObjectStore('revisions_poe1',{keyPath:'id',autoIncrement:true});revisions.createIndex('by_file_lang_time',['filepath','lang','savedAt']);revisions.createIndex('by_file_time',['filepath','savedAt']);};req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['kv','revisions_poe1'],'readwrite');tx.objectStore('kv').put({key:'local-browser-legacy-sentinel',value:{preserve:'legacy SD evidence'}});tx.objectStore('revisions_poe1').put({id:7777,filepath:'fixture/sentinel.txt',lang:'Thai',savedAt:1,translations:['Preserve prior SD history']});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};}));
        await bootstrap();const legacy=await page.evaluate(async()=>{const db=await OfflineStore.openClientTextDb();return new Promise((resolve,reject)=>{const tx=db.transaction(['kv','revisions_poe1'],'readonly'),a=tx.objectStore('kv').get('local-browser-legacy-sentinel'),b=tx.objectStore('revisions_poe1').get(7777);tx.oncomplete=()=>resolve({version:db.version,kv:a.result,history:b.result});tx.onabort=()=>reject(tx.error);});});assert.equal(legacy.version,25);assert.equal(legacy.kv.value.preserve,'legacy SD evidence');assert.deepEqual(legacy.history.translations,['Preserve prior SD history']);reports.push({case:'native v23 to v25 migration preserves legacy SD KV and history',ok:true});
        if(process.argv.includes('--review-fixes-only')){await reviewFixes();return;}
        if(process.argv.includes('--blank-source-only')){await require('./clienttext-blank-source-local-browser-check.cjs')({page,bootstrap,temp,reports,errors,networkWrites});return;}
        if(process.argv.includes('--use-english-only')){await englishIntentCheck();return;}
        if(process.argv.includes('--intent-conflicts-only')){await intentConflictCheck();return;}
        if(process.argv.includes('--lookup-saves-only')){await lookupSaveCheck();return;}
        if(process.argv.includes('--lease-probe-only')){
            const lease=await page.evaluate(async()=>{
                const vm=window.__localApp,store=vm._ctLocalStore,scope={...vm.ctRequestScope(),language:'Thai',versionId:'local:test:'+crypto.randomUUID(),groupId:'local:test:'+crypto.randomUUID()},fieldId=JSON.stringify(['Text',null]);
                const unit=ClientTextState.normalizeUnit({id:JSON.stringify(['normal','ClientStrings','lease-unit']),role:'normal',sheet:'ClientStrings',recordId:'lease-unit',developerNotes:'',metadata:{},fields:[{id:fieldId,name:'Text',kind:'text',source:'Lease source',target:'',required:true,sourceCell:'B2',targetCell:'C2'}]});
                const blob=new Blob(['local-lease-fixture']),asset={role:'normal',name:'Thai.xlsx',blob,hash:await ClientTextState.sha256(await blob.arrayBuffer())},built=await ClientTextState.buildDescriptors([unit],[asset]);
                await store.import(scope,{units:[unit],assets:[asset],descriptors:built.descriptors,metadata:{localProtocol:ClientTextLocalStore.protocol,version:{id:scope.versionId,name:'Native lease probe'},group:{id:scope.groupId,versionId:scope.versionId,contentMode:'clienttext',language:'Thai'}}});
                const release=store.releaseCapturedExcept(null);await store.acquire(scope);release();const draft=await store.putDraft(scope,unit.id,{values:{[fieldId]:'Lease survives old release'},reviewed:{}},{expectedRevision:null});
                return{scope,unitId:unit.id,fieldId,draft:await store.getDraft(scope,unit.id),revision:draft.revision};
            });assert.equal(lease.draft.values[lease.fieldId],'Lease survives old release');assert.ok(lease.revision);
            const other=await context.newPage();await bootstrap(other);const conflict=await other.evaluate(async scope=>{try{await window.__localApp._ctLocalStore.acquire(scope);return'';}catch(error){return error.message;}},lease.scope);assert.match(conflict,/another tab/i);await other.close();reports.push({case:'reacquired native lease survives delayed old release and still excludes second tab',ok:true});
            const report={ok:true,origin,profile,reports,errors,networkWrites};assert.deepEqual(errors,[]);assert.deepEqual(networkWrites,[]);fs.writeFileSync(path.join(temp,'clienttext-local-lease-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));return;
        }
        const imported=await importReal('poe2'),edits=await chooseEditAndDraft();reports.push({case:'PoE2 real native import',units:imported.count});
        await page.reload();await bootstrap();let state=await reopenAndAssert(imported.scope,edits);assert.equal(state.asset.hash,originals.poe2.hash);assert.equal(state.asset.bytes,originals.poe2.bytes);reports.push({case:'browser reload retains committed edit, active CRLF draft, history, exact original',ok:true});
        if(process.argv.includes('--native-input-only')){
            await context.close();await launch();await bootstrap();await reopenAndAssert(imported.scope,edits);
            await page.evaluate(async()=>{const vm=window.__localApp;await vm.ctShowVersionChooser();await vm.activateGameVersion('poe1',{checkMigration:false});});
            const first=await importReal('poe1'),firstEdits=await chooseEditAndDraft();await page.reload();await bootstrap(page,'poe1');const firstState=await reopenAndAssert(first.scope,firstEdits);assert.equal(firstState.asset.hash,originals.poe1.hash);
            reports.push({case:'native file-input originals deleted after import; timer-only active drafts and browser restart survive for both games',ok:true,poe1Units:first.count});
            await page.evaluate(()=>{
                const vm=window.__localApp,scope=vm.ctWorkspace.scope,id=vm.ctSelection,native=IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put=function(...args){const req=native.apply(this,args);if(this.name==='clienttext_receipts'){
                    const store=this;const keepAlive=()=>{const request=store.get('fixture-keepalive');request.onsuccess=keepAlive;};keepAlive();window.__localCrashTransactionHeld=true;
                }return req;};
                window.__localCrashJobId=crypto.randomUUID();vm.ctStorage(scope).getDraft(scope,id).then(draft=>{const values={...draft.values},field=Object.keys(values)[0];values[field]='This interrupted Save must never commit';return vm.ctStorage(scope).save(scope,id,{jobId:window.__localCrashJobId,values,reviewed:draft.reviewed,expectedRevision:vm.ctSaved[id]?.revision||0,expectedDraftRevision:draft.revision});}).catch(error=>{window.__localCrashUnexpected=error.message;});
            });
            await page.waitForFunction(()=>window.__localCrashTransactionHeld || window.__localCrashUnexpected);assert.equal(await page.evaluate(()=>window.__localCrashUnexpected||''),'');
            const crashJobId=await page.evaluate(()=>window.__localCrashJobId),crash=page.waitForEvent('crash',{timeout:30000}),cdp=await context.newCDPSession(page);cdp.send('Page.crash').catch(()=>{});await crash;await page.close().catch(()=>{});page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await bootstrap(page,'poe1');await reopenAndAssert(first.scope,firstEdits);
            const crashBoundary=await page.evaluate(async({scope,edits,jobId})=>{const vm=window.__localApp,db=await OfflineStore.openClientTextDb(),receipt=await new Promise((resolve,reject)=>{const tx=db.transaction('clienttext_receipts','readonly'),req=tx.objectStore('clienttext_receipts').get(JSON.stringify([ClientTextStore.scopeKey(scope),jobId]));tx.oncomplete=()=>resolve(req.result||null);tx.onabort=()=>reject(tx.error);});return{receipt,saved:vm.ctSaved[edits.draftUnit]||null,history:(await vm.ctStorage(scope).listHistory(scope,edits.draftUnit)).length};},{scope:first.scope,edits:firstEdits,jobId:crashJobId});assert.deepEqual(crashBoundary,{receipt:null,saved:null,history:0});
            reports.push({case:'renderer crash during held native atomic Save preserves previous work, receipt/history boundary and active draft',ok:true});
            const dnt=await page.evaluate(()=>{const vm=window.__localApp,unit=vm.ctUnits.find(unit=>unit.fields.some(field=>ClientTextUI.isDNTSource(field.source))),saved=JSON.stringify(vm.ctSaved);if(!unit)return{found:false};vm.hideDNT=false;const revealed=vm.ctFieldsFor(unit).some(field=>ClientTextUI.isDNTSource(field.source));vm.hideDNT=true;return{found:true,revealed,hidden:vm.ctFieldsFor(unit).every(field=>!ClientTextUI.isDNTSource(field.source)),unchanged:saved===JSON.stringify(vm.ctSaved)};});assert.deepEqual(dnt,{found:true,revealed:true,hidden:true,unchanged:true});reports.push({case:'PoE1 DNT visibility toggle preserves saved state',ok:true});
            for(const theme of ['light','grey','dark','modern-dark']){await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);await page.screenshot({path:path.join(temp,'local-workbook-'+theme+'.png')});}
            for(const [game,value]of Object.entries(originals))assert.equal(hash(value.file),value.hash,game+' source unchanged');assert.deepEqual(errors,[]);assert.deepEqual(networkWrites,[]);
            const report={ok:true,origin,profile,originals,reports,errors,networkWrites};fs.writeFileSync(path.join(temp,'clienttext-local-native-input-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));return;
        }
        await context.close();await launch();await bootstrap();await reopenAndAssert(imported.scope,edits);reports.push({case:'browser process/profile close and reopen',ok:true});
        const other=await context.newPage();await bootstrap(other);const lock=await other.evaluate(async scope=>{const vm=window.__localApp;const meta=await vm._ctStore.getMetadata(scope);return{opened:await vm.ctOpenCached(meta),error:vm.ctError};},imported.scope);assert.equal(lock.opened,false);assert.match(lock.error,/another tab/i);await other.close();reports.push({case:'cross-tab ownership blocks second editor',ok:true});
        const failure=await page.evaluate(async()=>{
            const vm=window.__localApp,scope=vm.ctWorkspace.scope,unit=vm.ctCurrentUnit,field=unit.fields.find(field=>field.kind!=='gender'),store=vm.ctStorage(scope),before=await store.getDraft(scope,unit.id);
            const native=IDBObjectStore.prototype.put;let injected=false;IDBObjectStore.prototype.put=function(value,...rest){if(this.name==='clienttext_drafts'&&!injected){injected=true;throw new DOMException('Injected full storage','QuotaExceededError');}return native.call(this,value,...rest);};
            vm.ctValues[field.id]='Uncheckpointed quota value';vm.ctDraftDirty=true;vm.ctQueueDraft();const checkpoint=await vm.ctFlushDraft();IDBObjectStore.prototype.put=native;const after=await store.getDraft(scope,unit.id);
            const result={checkpoint,before:before.values[field.id],after:after.values[field.id],error:vm.ctError,state:vm.ctLocalDraftState};vm.ctValues[field.id]=before.values[field.id];vm.ctQueueDraft();await vm.ctFlushDraft();return result;
        });assert.equal(failure.checkpoint,false);assert.equal(failure.after,failure.before);assert.match(failure.error,/not stored/);assert.equal(failure.state,'failed');reports.push({case:'quota write failure leaves prior draft, no checkpoint confirmation',ok:true});
        const aborted=await page.evaluate(async()=>{
            const vm=window.__localApp,scope=vm.ctWorkspace.scope,unit=vm.ctCurrentUnit,store=vm.ctStorage(scope),before=await store.getSaved(scope),draft=await store.getDraft(scope,unit.id),historyBefore=(await store.listHistory(scope,unit.id)).length,job=crypto.randomUUID();
            const native=IDBObjectStore.prototype.put;let injected=false;IDBObjectStore.prototype.put=function(value,...rest){const request=native.call(this,value,...rest);if(this.name==='clienttext_history'&&!injected){injected=true;this.transaction.abort();}return request;};
            let error='';try{await store.save(scope,unit.id,{jobId:job,values:draft.values,reviewed:draft.reviewed,expectedRevision:before[unit.id]?.revision||0,expectedDraftRevision:draft.revision});}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=native;}
            return{error,injected,before:before[unit.id]||null,after:(await store.getSaved(scope))[unit.id]||null,draft:await store.getDraft(scope,unit.id),historyBefore,historyAfter:(await store.listHistory(scope,unit.id)).length};
        });assert.equal(aborted.injected,true);assert.ok(aborted.error);assert.deepEqual(aborted.before,aborted.after);assert.ok(aborted.draft);assert.equal(aborted.historyBefore,aborted.historyAfter);reports.push({case:'native interrupted save transaction is atomic',ok:true});
        const reads=await page.evaluate(async()=>{const vm=window.__localApp,scope=vm.ctWorkspace.scope,id=vm.ctSelection,store=vm.ctStorage(scope),before=await store.getDraft(scope,id),native=IDBObjectStore.prototype.get;let injected=false,error='';IDBObjectStore.prototype.get=function(...args){if(this.name==='clienttext_drafts'&&!injected){injected=true;throw new DOMException('Injected read failure','UnknownError');}return native.apply(this,args);};try{await store.getDraft(scope,id);}catch(e){error=e.message;}finally{IDBObjectStore.prototype.get=native;}return{injected,error,before,after:await store.getDraft(scope,id)};});assert.equal(reads.injected,true);assert.match(reads.error,/Injected read failure/);assert.deepEqual(reads.before,reads.after);reports.push({case:'native read failure propagates and preserves stored draft',ok:true});
        const malformed=await page.evaluate(async()=>{const vm=window.__localApp,scope=vm.ctWorkspace.scope,id=vm.ctSelection,db=await OfflineStore.openClientTextDb(),key=JSON.stringify([ClientTextStore.scopeKey(scope),id]);const raw=await new Promise((resolve,reject)=>{const tx=db.transaction('clienttext_drafts','readonly'),req=tx.objectStore('clienttext_drafts').get(key);tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error);});const write=value=>new Promise((resolve,reject)=>{const tx=db.transaction('clienttext_drafts','readwrite');tx.objectStore('clienttext_drafts').put(value);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});await write({...raw,value:{...raw.value,values:{untrusted:42}}});let error='';try{await vm.ctStorage(scope).getDraft(scope,id);}catch(e){error=e.message;}const retained=await new Promise(resolve=>{const tx=db.transaction('clienttext_drafts','readonly'),req=tx.objectStore('clienttext_drafts').get(key);tx.oncomplete=()=>resolve(req.result);});await write(raw);return{error,retained:retained.value.values};});assert.ok(malformed.error);assert.deepEqual(malformed.retained,{untrusted:42});reports.push({case:'malformed persisted fields rejected without deleting evidence',ok:true});
        await context.setOffline(true);try{await page.evaluate(async()=>{const vm=window.__localApp;await vm.ctShowVersionChooser();});await reopenAndAssert(imported.scope,edits);const offlineSaved=await page.evaluate(async()=>{const vm=window.__localApp;await vm.ctSelect(vm.ctUnits.find(unit=>unit.id===Object.keys(vm.ctSaved)[0]),true);return vm.ctSave(false);});assert.equal(offlineSaved,true);reports.push({case:'offline reopen, reads, draft and committed save require no network',ok:true});}finally{await context.setOffline(false);}await reopenAndAssert(imported.scope,edits);
        const exported=await page.evaluate(async edits=>{const vm=window.__localApp,native=window.saveAs;let output;window.saveAs=(blob,name)=>{output={blob,name};};try{if(!await vm.ctDownload())throw new Error(vm.ctError||'Workbook download failed');}finally{window.saveAs=native;}if(!output)throw new Error('No workbook export');window.__localExport=output;const parsed=await vm._ctWorker.parseWorkbook(await output.blob.arrayBuffer(),{filename:output.name,role:'normal',language:'Thai',game:'poe2',parserVersion:vm.ctWorkspace.metadata.descriptors[0].parserVersion});const a=parsed.units.find(unit=>unit.id===edits.savedUnit),b=parsed.units.find(unit=>unit.id===edits.draftUnit),originalDraft=vm.ctUnits.find(unit=>unit.id===edits.draftUnit).fields.find(field=>field.id===edits.draftField).target;return{name:output.name,saved:a.fields.find(field=>field.id===edits.savedField).target,draft:b.fields.find(field=>field.id===edits.draftField).target,originalDraft,colors:ClientTextCodec.TAB_COLORS};},edits);assert.match(exported.name,/_Translated\.xlsx$/);assert.equal(exported.saved,'Synthetic durable committed edit');assert.equal(exported.draft,exported.originalDraft);assert.equal(exported.colors.revised,'793BB6');assert.equal(exported.colors.filled,'626B7A');reports.push({case:'native workbook export preserves committed edits, excludes drafts, keeps translated naming/palette',ok:true});
        const exportImport=await page.evaluate(async edits=>{const vm=window.__localApp,output=window.__localExport;await vm.ctShowVersionChooser();await vm.ctOpenOfflineTest();vm.ctAddUploadFiles([new File([output.blob],output.name)]);vm.ctUploadName='Export reimport';if(!await vm.ctOpenTestSheet())throw new Error(vm.ctUploadError||vm.ctError);return{scope:JSON.parse(JSON.stringify(vm.ctWorkspace.scope)),target:vm.ctUnits.find(unit=>unit.id===edits.savedUnit).fields.find(field=>field.id===edits.savedField).target,saved:Object.keys(vm.ctSaved).length};},edits);assert.notEqual(exportImport.scope.groupId,imported.scope.groupId);assert.equal(exportImport.target,'Synthetic durable committed edit');assert.equal(exportImport.saved,0);reports.push({case:'exported workbook reimports as independent WIP original',ok:true});await reopenAndAssert(imported.scope,edits);
        // Recovery ZIP includes exact packages and all authored state. Restoring
        // creates new identities; source workspace remains intact.
        const restored=await page.evaluate(async scope=>{const vm=window.__localApp,blob=await vm._ctLocalStore.backup(scope),next=await vm._ctLocalStore.restore(blob,vm.ctRequestScope(),vm._ctWorker);return{scope:next,bytes:blob.size};},imported.scope);assert.notEqual(restored.scope.groupId,imported.scope.groupId);await reopenAndAssert(restored.scope,edits);reports.push({case:'recovery backup/restore reparses originals into new identity',ok:true,backupBytes:restored.bytes});
        await page.evaluate(async()=>{const vm=window.__localApp;await vm.ctShowVersionChooser();});const repeat=await importReal('poe2');assert.notEqual(repeat.scope.groupId,imported.scope.groupId);const repeatSaved=await page.evaluate(()=>Object.keys(window.__localApp.ctSaved).length);assert.equal(repeatSaved,0);await reopenAndAssert(imported.scope,edits);reports.push({case:'repeated imports isolated; switching preserves earlier work',ok:true});
        await page.evaluate(async()=>{const vm=window.__localApp;await vm.ctShowVersionChooser();await vm.activateGameVersion('poe1',{checkMigration:false});});const poe1=await importReal('poe1');const poe1Edits=await chooseEditAndDraft();await page.reload();await bootstrap(page,'poe1');const poe1State=await reopenAndAssert(poe1.scope,poe1Edits);assert.equal(poe1State.asset.hash,originals.poe1.hash);reports.push({case:'PoE1 real workbook reload and exact source retention',ok:true,units:poe1.count});
        assert.deepEqual(networkWrites,[],'No HTTP writes in local-only guest workflow');assert.deepEqual(errors,[],'No uncaught browser errors');
        for(const [game,value]of Object.entries(originals))assert.equal(hash(value.file),value.hash,game+' source remains byte-identical');
        const report={ok:true,origin,profile,originals,reports,errors,networkWrites,limitations:['Synthetic injected quota and abort errors; no physical disk failure or actual origin quota exhaustion.','Guest local-only path; authorized opt-in Dictionary/TM synchronization covered separately.','Browser offline via blocked authoring endpoints; external stylesheet/font requests may fail independently.']};
        fs.writeFileSync(path.join(temp,'clienttext-local-browser-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    }finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(async error=>{console.error(error.stack);await context?.close().catch(()=>{});server.close();process.exitCode=1;});
