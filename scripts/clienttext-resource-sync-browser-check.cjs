'use strict';
const assert=require('node:assert/strict');
module.exports=async function({page,bootstrap,files,failures}){
    const peerContext=await page.context().browser().newContext({viewport:{width:1440,height:1000},ignoreHTTPSErrors:true}),peer=await peerContext.newPage();
    peer.on('pageerror',error=>failures.push(error.message));
    const inference=[];
    for(const target of [page,peer])target.on('request',request=>{if(request.method()==='POST'&&/\/v1\/mtl\/(?:local\/)?requests(?:\?|$)/.test(request.url()))inference.push(request.url());});
    const app=fn=>page.evaluate(fn),other=fn=>peer.evaluate(fn);
    async function open(target){
        await target.evaluate(async()=>{const vm=window.__clientFixtureApp;if(vm.ctActive)await vm.ctShowVersionChooser();await vm.ctOpenOfflineTest();});
        const upload=target.locator('.ctUploadDialog');
        await upload.locator('section[aria-label="Current workbooks"] input[type=file]').first().setInputFiles(files);
        const sync=upload.getByRole('checkbox',{name:'Sync Dictionary and TM',exact:true});assert.equal(await sync.isChecked(),false);await sync.check();
        await upload.getByRole('button',{name:'Open',exact:true}).click();
        await target.waitForFunction(()=>window.__clientFixtureApp.ctActive&&window.__clientFixtureApp.ctOfflineTest&&!window.__clientFixtureApp.ctBusy&&!window.__clientFixtureApp.workspaceInitializationActive);
        assert.equal(await target.evaluate(()=>window.__clientFixtureApp.ctResourceSyncEnabled),true);
        console.log('Opened temporary workbook with authorized sync');
        await target.evaluate(async()=>{
            const vm=window.__clientFixtureApp;vm.appConfirm=async()=>true;
            await vm.ctSelect(vm.ctUnits.find(unit=>unit.role==='normal'&&unit.recordId==='record'),true);
            vm.ctFocusedField=vm.ctCurrentUnit.fields.find(field=>field.name==='Name').id;vm.ctTool='dictionary';
        });
    }
    try{
        await bootstrap(peer);await open(page);await open(peer);
        await app(()=>{
            window.__resourceWrites=[];window.__resourceRequests=[];
            const put=IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put=function(value,...rest){
                if(JSON.stringify([value?.key,value?.scope,value?.value?.groupId]).includes('local:test:'))window.__resourceWrites.push({store:this.name,key:value?.key});
                return put.call(this,value,...rest);
            };
            const vm=window.__clientFixtureApp,request=vm._cloud.request.bind(vm._cloud);
            vm._cloud.request=async(path,...rest)=>{if(/local(?::|%3A)test/.test(path))window.__resourceRequests.push(path);return request(path,...rest);};
            vm.dictionary=[{_id:'online-sword',find:'Sword',replace:'Online sword',alts:[],tlnote:'Online note'}];vm.dictionaryEntryInput(vm.dictionary[0]);
        });
        await app(async()=>{const vm=window.__clientFixtureApp;await vm.saveSettings();await vm._cloud.sync();});
        await other(async()=>{const vm=window.__clientFixtureApp;await vm._cloud.sync();});
        await peer.waitForFunction(()=>window.__clientFixtureApp.dictionary.some(word=>word._id==='online-sword'&&word.replace==='Online sword'));
        console.log('Shared Dictionary synchronized');
        const target=page.locator('.ctFullEditor [data-ct-target][aria-label="Name"]');
        await target.fill('Private unsaved workbook draft');
        await other(async()=>{const vm=window.__clientFixtureApp,word=vm.dictionary.find(word=>word._id==='online-sword');word.replace='Peer dictionary';vm.dictionaryEntryInput(word);await vm.saveSettings();await vm._cloud.sync();});
        await app(async()=>{await window.__clientFixtureApp._cloud.sync();});
        await page.waitForFunction(()=>window.__clientFixtureApp.dictionary.some(word=>word.replace==='Peer dictionary'));
        assert.equal(await target.inputValue(),'Private unsaved workbook draft');
        await app(async()=>{const vm=window.__clientFixtureApp;await vm.ctMtlDebugOpen(vm.ctPreviewField);});
        await app(()=>{const vm=window.__clientFixtureApp,word=vm.dictionary.find(word=>word._id==='online-sword');word.replace='Preview live term';word.tlnote='Preview live note';vm.dictionaryEntryInput(word);});
        await page.waitForFunction(()=>JSON.stringify(window.__clientFixtureApp.ctMtlDebugWindow?.record).includes('Preview live term'));
        assert.equal(await app(()=>JSON.stringify(window.__clientFixtureApp.ctMtlDebugWindow.record).includes('Preview live note')),true);
        console.log('Live context preview refreshed');
        await app(()=>{
            const vm=window.__clientFixtureApp,word=vm.dictionary.find(word=>word._id==='online-sword');
            word.find='SyntheticSwordBundle';word.replace='';word.alts=[{_id:'synthetic-preview-alt',find:'Sword',replace:'Alternate preview term'}];vm.dictionaryEntryInput(word);
        });
        await page.waitForFunction(()=>window.__clientFixtureApp.ctMtlDebugWindow?.record.snapshot?.context?.glossary.some(row=>row.source==='Sword'&&row.translation==='Alternate preview term'));
        console.log('Alternate-only live glossary preview refreshed');
        await app(()=>{
            const vm=window.__clientFixtureApp,field=vm.ctPreviewField;
            vm.ctMtlDebugBegin(field,{requestId:'synthetic-already-submitted',context:vm.ctMtlBuildContext(field).initial});
            window.__frozenResourceRequest=JSON.stringify(vm.ctMtlDebugWindow.record);
            vm.dictionary[0].alts[0].replace='After captured request';vm.dictionaryEntryInput(vm.dictionary[0]);
        });
        await page.waitForTimeout(250);
        assert.equal(await app(()=>JSON.stringify(window.__clientFixtureApp.ctMtlDebugWindow.record)===window.__frozenResourceRequest),true);
        await app(()=>window.__clientFixtureApp.ctMtlDebugClose());
        await target.fill('Shared saved sword');
        assert.equal(await app(()=>window.__clientFixtureApp.ctSave()),true);
        await app(async()=>{const vm=window.__clientFixtureApp;await vm.flushScheduledSettingsSave();await vm._cloud.sync();});
        await other(async()=>{const vm=window.__clientFixtureApp;await vm._cloud.sync();await vm.loadTranslationMemory();});
        await peer.waitForFunction(()=>window.__clientFixtureApp.ctMemoryResults.some(match=>match.target==='Shared saved sword'));
        console.log('Shared ClientText TM synchronized');
        const shared=await other(()=>window.__clientFixtureApp.tmUnits.find(unit=>unit.target==='Shared saved sword'));
        assert.equal(shared.context.contentMode,'clienttext');assert.equal(shared.context.fieldName,'Name');
        await other(async()=>{
            const vm=window.__clientFixtureApp,unit=vm.tmUnits.find(unit=>unit.target==='Shared saved sword');
            await vm.tmPut([{...unit,target:'Peer TM correction'}],{origin:'edit',expectedUnits:{[unit.id]:unit}});await vm._cloud.sync();
        });
        await app(async()=>{const vm=window.__clientFixtureApp;await vm._cloud.sync();await vm.loadTranslationMemory();});
        await page.waitForFunction(()=>window.__clientFixtureApp.ctMemoryResults.some(match=>match.target==='Peer TM correction'));
        await app(async()=>{
            const vm=window.__clientFixtureApp,worker=vm.ensureTMWorker();await worker.waitReady({generation:vm.tmGeneration});
            const result=await worker.query({source:'Sword',game:'poe2',context:{}},{threshold:100,limit:20});
            if(result.matches.some(match=>match.unit?.context?.contentMode==='clienttext'))throw Error('ClientText leaked into SD suggestions');
            await vm._cloud.running;window.__resourceFetcher=vm._cloud.fetcher;window.__resourceSchedule=vm._cloud.schedule;
            vm._cloud.schedule=()=>{};vm._cloud.fetcher=async()=>{throw Error('Synthetic offline connection');};
            vm.dictionary[0].replace='Queued offline dictionary';vm.dictionaryEntryInput(vm.dictionary[0]);await vm.saveSettings();
        });
        await target.fill('Queued offline TM');assert.equal(await app(()=>window.__clientFixtureApp.ctSave()),true);
        const pending=await app(async()=>{
            const vm=window.__clientFixtureApp;
            return {tm:(await OfflineStore.getTranslationMemoryPending(vm.tmScope())).length,workbook:vm.ctSaved[vm.ctSelection].values[vm.ctFocusedField],writes:window.__resourceWrites,requests:window.__resourceRequests};
        });
        assert.ok(pending.tm>0);assert.equal(pending.workbook,'Queued offline TM');assert.deepEqual(pending.writes,[]);assert.deepEqual(pending.requests,[]);
        await app(()=>window.__clientFixtureApp.ctShowVersionChooser());
        assert.equal(await app(()=>window.__clientFixtureApp.ctActive),false);
        await app(async()=>{
            const vm=window.__clientFixtureApp;vm._cloud.fetcher=window.__resourceFetcher;vm._cloud.schedule=window.__resourceSchedule;
            await vm._cloud.sync();
        });
        await other(async()=>{const vm=window.__clientFixtureApp;await vm._cloud.sync();await vm.loadTranslationMemory();});
        await peer.waitForFunction(()=>window.__clientFixtureApp.ctMemoryResults.some(match=>match.target==='Queued offline TM'));
        assert.equal(await other(()=>window.__clientFixtureApp.dictionary[0].replace),'Queued offline dictionary');
        await other(async()=>{const vm=window.__clientFixtureApp,unit=vm.tmUnits.find(unit=>unit.target==='Queued offline TM');await vm.removeTMUnit(unit);await vm._cloud.sync();});
        await page.reload();await page.waitForFunction(()=>window.__clientFixtureApp?.offlineStoreReady&&!window.__clientFixtureApp.workspaceInitializationActive);
        assert.equal(await app(()=>window.__clientFixtureApp.ctActive),false);
        assert.equal(await app(()=>window.__clientFixtureApp.ctWorkspace),null);
        assert.deepEqual(inference,[]);assert.deepEqual(failures,[]);
        console.log(JSON.stringify({ok:true,checks:['explicit authorized resource sync with two real API clients','incoming Dictionary preserves unsaved workbook draft',
            'live context JSON refresh and immutable submitted snapshot','shared TM pairs/corrections retain ClientText field identity','SD suggestions exclude ClientText pairs',
            'offline Dictionary/TM queues survive test exit and retry on reconnect','no temporary workbook IndexedDB writes or content-group uploads','reload clears temporary workbook; no inference']},null,2));
    }finally{await peerContext.close();}
};
