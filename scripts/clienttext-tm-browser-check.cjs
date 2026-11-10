'use strict';
// Synthetic workbooks, disposable authenticated API, and native IndexedDB only.
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {randomUUID,createHash}=require('node:crypto');
const {join}=require('node:path');
const {writeFileSync}=require('node:fs');

module.exports=async function({page,api,files,Codec,ClientState:S,failures,directory}){
    const inference=[],checks=[];
    page.on('request',request=>{if(request.method()==='POST'&&/\/v1\/mtl\/(?:local\/)?requests/.test(request.url()))inference.push(request.url());});
    const app=fn=>page.evaluate(fn);
    async function settled(predicate,message){
        const deadline=Date.now()+12000;
        do{if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30));}while(Date.now()<deadline);
        throw new Error(message);
    }
    const workspace=()=>page.getByRole('region',{name:'ClientText workspace',exact:true});
    const review=()=>page.locator('.ctFullEditor .ctTmReview').first();
    const fieldInput=name=>page.locator('.ctFullEditor').getByRole('textbox',{name,exact:true});
    async function showSelection(){
        await app(()=>{const vm=window.__clientFixtureApp;vm.inlineEditor=true;vm.inlineSidebarVisible=true;});
        await page.getByRole('button',{name:'TM',exact:true}).click();
        if(!await page.getByRole('checkbox',{name:'Show row selection'}).isVisible())await page.getByText('TM options',{exact:true}).click();
        await page.getByRole('checkbox',{name:'Show row selection'}).check();
        await workspace().getByRole('checkbox',{name:'Select rows on this page'}).waitFor();
    }
    async function select(recordId){
        await app(async()=>{const vm=window.__clientFixtureApp;if(vm.ctEditor)await vm.ctCloseEditor();vm.ctShowAllLoaded();});
        await workspace().getByRole('button',{name:recordId,exact:true}).click();
        await page.waitForFunction(recordId=>{const vm=window.__clientFixtureApp;return vm.ctEditor&&vm.ctCurrentUnit?.recordId===recordId&&!vm.ctBusy&&!vm._ctSelectRun?.pending;},recordId);
    }
    async function prepare(recordId){
        await app(async()=>{const vm=window.__clientFixtureApp;if(vm.ctEditor)await vm.ctCloseEditor();vm.ctShowAllLoaded();vm.ctTmClearSelection();});
        await showSelection();
        await workspace().getByRole('checkbox',{name:'Select '+recordId,exact:true}).check();
        await workspace().getByRole('button',{name:'Pre-translate selected with TM',exact:true}).click();
        await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return !vm.ctTmBusy&&!!vm.ctTmProgress;});
        const state=await app(()=>{const vm=window.__clientFixtureApp;return{progress:vm.ctTmProgress,error:vm.ctTmError};});
        assert.equal(state.error,'');return state.progress;
    }
    async function storeSnapshot(recordId,exportBytes=false){
        return page.evaluate(async({recordId,exportBytes})=>{
            const vm=window.__clientFixtureApp,unit=vm.ctUnits.find(unit=>unit.recordId===recordId),store=vm.ctStorage(vm.ctWorkspace.scope),scope=vm.ctWorkspace.scope;
            const saved=await store.getSaved(scope),draft=await store.getDraft(scope,unit.id),history=await store.listHistory(scope,unit.id);
            let exportHash;
            if(exportBytes){const asset=await store.getAsset(scope,unit.role),units=vm.ctUnits.filter(value=>value.role===unit.role&&saved[value.id]);
                const bytes=await vm._ctWorker.exportWorkbook(await asset.blob.arrayBuffer(),{...asset.parsed,units},saved,{});exportHash=await ClientTextState.sha256(bytes);}
            return{saved:saved[unit.id]||null,draft:draft||null,history,exportHash,original:unit.fields.map(field=>({id:field.id,source:field.source,target:field.target}))};
        },{recordId,exportBytes});
    }
    async function seed(recordId,fieldName,targets){
        return page.evaluate(async({recordId,fieldName,targets})=>{
            const vm=window.__clientFixtureApp,unit=vm.ctUnits.find(value=>value.recordId===recordId),field=unit.fields.find(field=>field.name===fieldName);
            const entries=targets.map((target,index)=>({id:'bulk-tm-'+recordId+'-'+index,source:field.source,target,gameScope:vm.gameVersion,
                context:{...ContentAdapters.clienttext.contextFor(unit,field),recordId:targets.length>1?'tie-'+index:unit.recordId},provenance:{origin:'manual'}}));
            await OfflineStore.putTranslationMemoryUnits(vm.tmScope(),entries,{origin:'edit'});await vm._cloud.sync();await vm.loadTranslationMemory();
            vm.tmThreshold=60;return{unitId:unit.id,fieldId:field.id,ids:entries.map(entry=>entry.id)};
        },{recordId,fieldName,targets});
    }
    async function save(text,name='Name'){
        await fieldInput(name).fill(text);
        await page.locator('.ctFullEditor').getByRole('button',{name:'Save',exact:true}).click();
        await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return !vm.ctBusy&&!vm._ctSaveJob&&!vm.ctDraftDirty;});
    }
    async function waitReviewText(unitId,fieldId,value){
        try{await settled(()=>page.evaluate(async({unitId,fieldId,value})=>{
            const vm=window.__clientFixtureApp;return(await vm.ctTmStorage().getReview(vm.ctWorkspace.scope,unitId,fieldId))?.text===value;
        },{unitId,fieldId,value}),'Edited TM review was not durably checkpointed');}
        catch(error){const details=await page.evaluate(async({unitId,fieldId})=>{const vm=window.__clientFixtureApp,field=vm.ctCurrentUnit?.fields.find(field=>field.id===fieldId);
            return{error:vm.ctTmError,stored:await vm.ctTmStorage().getReview(vm.ctWorkspace.scope,unitId,fieldId),candidate:vm.ctTmPendingCandidate(field),
                candidateVisible:!!vm.ctTmCandidate(field),visible:vm.ctTmFieldValue(field),underlying:vm.ctValues[fieldId],reviews:vm.ctTmReviews};},{unitId,fieldId});
            throw new Error(error.message+': '+JSON.stringify(details));}
    }
    async function openLocal(){
        await app(async()=>{const vm=window.__clientFixtureApp;if(vm.ctActive)await vm.ctShowVersionChooser();await vm.ctOpenOfflineTest();});
        const upload=page.locator('.ctUploadDialog');
        await upload.locator('section[aria-label="Current workbooks"] input[type=file]').first().setInputFiles(files);
        await upload.getByRole('checkbox',{name:'Sync Dictionary and TM',exact:true}).check();
        await upload.getByRole('button',{name:'Open',exact:true}).click();
        await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return !vm.ctUploading&&!vm.ctBusy&&!vm.workspaceInitializationActive;});
        const opened=await app(()=>{const vm=window.__clientFixtureApp;return{active:vm.ctActive,error:vm.ctError,upload:vm.ctUploadError};});
        assert.equal(opened.active,true,JSON.stringify(opened));
        await app(()=>{window.__clientFixtureApp.appConfirm=async()=>true;});
    }
    await openLocal();
    const scope=await app(()=>JSON.parse(JSON.stringify(window.__clientFixtureApp.ctWorkspace.scope)));
    const sword=await seed('record','Name',['Remembered sword']);
    const before=await storeSnapshot('record',true);
    assert.equal(before.saved,null);assert.equal(before.draft,null);assert.equal(before.history.length,0);
    // Checkbox keyboard selection, pagination retention, and filter clearing.
    await app(()=>{const vm=window.__clientFixtureApp;vm.ctShowAllLoaded();vm.pageSize=1;});
    const selectPage=workspace().getByRole('checkbox',{name:'Select rows on this page',exact:true});
    const toolbar=workspace().locator('.ctBulkTmToolbar');
    assert.equal(await selectPage.count(),0);assert.equal(await toolbar.count(),0);
    await showSelection();
    await page.getByRole('checkbox',{name:'Show row selection'}).uncheck();assert.equal(await toolbar.count(),0);
    await page.getByRole('checkbox',{name:'Show row selection'}).check();assert.equal(await toolbar.count(),1);
    await page.locator('.ctTools').getByRole('button',{name:/Dictionary/}).first().click();
    assert.equal(await selectPage.count(),0);assert.equal(await toolbar.count(),0);
    await page.getByRole('button',{name:'TM',exact:true}).click();
    assert.equal(await toolbar.count(),0);
    await showSelection();
    await workspace().getByRole('checkbox',{name:'Select rows on this page',exact:true}).focus();
    await workspace().getByRole('checkbox',{name:'Select rows on this page',exact:true}).press('Space');
    assert.ok(await app(()=>window.__clientFixtureApp.ctTmSelectedCount>0));
    await app(()=>{const vm=window.__clientFixtureApp;vm.ctPage=2;});
    assert.ok(await app(()=>window.__clientFixtureApp.ctTmSelectedCount>0));
    assert.equal(await app(()=>window.__clientFixtureApp.ctPageRows.length),1);
    await app(()=>{const vm=window.__clientFixtureApp;vm.pageSize=20;vm.ctPage=1;vm.ctTmClearSelection();});
    const boxes=workspace().locator('.ctTable tbody input[type=checkbox]');
    await boxes.nth(0).click();await boxes.nth(2).click({modifiers:['Shift']});
    assert.equal(await app(()=>window.__clientFixtureApp.ctTmSelectedCount),3);
    await app(()=>{const vm=window.__clientFixtureApp;vm.ctAppliedSearch='Sword';});
    await page.waitForFunction(()=>window.__clientFixtureApp.ctTmSelectedCount===0);
    const progress=await prepare('record');assert.equal(progress.prepared,1);
    assert.deepEqual(await storeSnapshot('record',true),before,'Preparation leaves committed values, draft, history, originals and exported bytes unchanged');
    await select('record');
    assert.equal(await fieldInput('Name').inputValue(),'Remembered sword');
    await fieldInput('Name').fill('Reviewed sword');await waitReviewText(sword.unitId,sword.fieldId,'Reviewed sword');
    assert.deepEqual(await storeSnapshot('record',true),before,'Editing a pending review is separate from ordinary drafts and exports');
    for(const theme of ['light','grey','dark','modern-dark']){
        await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
        const box=await review().boundingBox();assert.ok(box&&box.width>200&&box.x>=0&&box.x+box.width<=1441);
        await page.screenshot({path:join(directory,'tm-review-offline-'+theme+'.png'),fullPage:true});
    }
    // The same review controller must preserve its draft boundary in the table.
    await app(async()=>{const vm=window.__clientFixtureApp;await vm.ctCloseEditor();vm.inlineEditor=true;vm.ctShowAllLoaded();});
    const inlineRow=workspace().locator('.ctTable tbody tr').filter({has:page.getByRole('button',{name:'record',exact:true})});
    await inlineRow.locator('td').nth(2).click();
    await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return vm.ctInlineUnitVisible()&&!vm._ctSelectRun?.pending;});
    const inlineInput=inlineRow.locator('[data-ct-target][aria-label="Name"]'),inlineReview=inlineRow.locator('.ctTmReview').first();
    await inlineInput.fill('Inline reviewed sword');await waitReviewText(sword.unitId,sword.fieldId,'Inline reviewed sword');
    assert.deepEqual(await storeSnapshot('record',true),before,'Inline review edits do not become an ordinary draft or save');
    for(const [width,theme]of [[1024,'modern-dark'],[1440,'light']]){
        await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
        const tools=workspace().getByRole('button',{name:width===1024?'Hide file tools':'Show file tools',exact:true});
        await tools.focus();await tools.press('Enter');
        if(!await inlineInput.isVisible())await inlineRow.getByRole('button',{name:'record, Name',exact:true}).click();
        await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return vm.ctInlineUnitVisible()&&!vm._ctSelectRun?.pending;});
        assert.equal(await inlineInput.inputValue(),'Inline reviewed sword','Review text survives the file-tools layout switch');
        const visible=await inlineReview.evaluate(node=>{
            const box=node.getBoundingClientRect(),pane=node.closest('.fileTableScroll')?.getBoundingClientRect();
            return box.left>=0&&box.right<=innerWidth+1&&(!pane||box.left>=pane.left-1&&box.right<=pane.right+1);
        });
        assert.ok(visible,'TM review controls fit the visible table pane at '+width+'px');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Inline bulk toolbar/review fits resized desktop');
        await page.screenshot({path:join(directory,'tm-review-inline-'+width+'-'+theme+'.png'),fullPage:true});
    }
    assert.deepEqual(await storeSnapshot('record',true),before,'Keyboard file-tools toggles leave the pending review outside drafts and Save');
    await inlineReview.getByRole('button',{name:'Accept',exact:true}).click();
    await inlineReview.getByRole('button',{name:'Undo accept',exact:true}).waitFor();
    await inlineReview.getByRole('button',{name:'Undo accept',exact:true}).click();
    await inlineReview.getByRole('button',{name:'Accept',exact:true}).waitFor();
    const inlineUndone=await storeSnapshot('record',true);assert.equal(inlineUndone.saved,null);assert.equal(inlineUndone.history.length,0);
    assert.equal(inlineUndone.draft?.values[sword.fieldId]??'','');assert.equal(inlineUndone.exportHash,before.exportHash);
    await showSelection();
    const inlineCheckbox=inlineRow.getByRole('checkbox',{name:'Select record',exact:true});await inlineCheckbox.uncheck();await inlineCheckbox.check();
    await inlineReview.getByRole('button',{name:'Dismiss',exact:true}).click();
    await settled(()=>app(()=>!window.__clientFixtureApp.ctTmCandidates.some(candidate=>candidate.status==='pending'&&candidate.unitId===window.__clientFixtureApp.ctSelection)),'Inline dismissal did not settle');
    const inlineDismissed=await storeSnapshot('record',true);assert.equal(inlineDismissed.saved,null);assert.equal(inlineDismissed.history.length,0);assert.equal(inlineDismissed.exportHash,before.exportHash);
    checks.push('Inline table review, keyboard/range/page selection, checkbox focus without autosave, resized desktop layouts');
    await app(()=>{window.__clientFixtureApp.inlineEditor=false;});
    assert.equal((await prepare('record')).prepared,1);await select('record');
    await fieldInput('Name').fill('Reviewed sword');await waitReviewText(sword.unitId,sword.fieldId,'Reviewed sword');
    await review().getByRole('button',{name:'Accept',exact:true}).click();
    await review().getByRole('button',{name:'Undo accept',exact:true}).waitFor();
    assert.equal(await app(()=>window.__clientFixtureApp.ctValues[window.__clientFixtureApp.ctFocusedField]),'Reviewed sword');
    assert.equal((await storeSnapshot('record',true)).saved,null);
    await review().getByRole('button',{name:'Undo accept',exact:true}).click();
    await review().getByRole('button',{name:'Accept',exact:true}).waitFor();
    assert.equal(await page.evaluate(fieldId=>window.__clientFixtureApp.ctValues[fieldId],sword.fieldId),'');
    await review().getByRole('button',{name:'Accept',exact:true}).click();
    await review().getByRole('button',{name:'Undo accept',exact:true}).waitFor();
    await page.locator('.ctFullEditor').getByRole('button',{name:'Save',exact:true}).click();
    await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return !vm.ctBusy&&!vm._ctSaveJob&&vm.ctTmCandidates.some(candidate=>candidate.status==='accepted');});
    const committed=await storeSnapshot('record',true);assert.equal(committed.saved.values[sword.fieldId],'Reviewed sword');
    assert.equal(committed.history.length,1);assert.equal(committed.history[0].id,committed.saved.jobId);assert.notEqual(committed.exportHash,before.exportHash);
    const receipt=await page.evaluate(async({scope,jobId})=>{
        const db=await OfflineStore.openClientTextDb();return new Promise((resolve,reject)=>{const tx=db.transaction(['clienttext_receipts'],'readonly'),request=tx.objectStore('clienttext_receipts').get(JSON.stringify([ClientTextStore.scopeKey(scope),jobId]));request.onsuccess=()=>resolve(request.result?.value);request.onerror=()=>reject(request.error);});
    },{scope,jobId:committed.saved.jobId});
    assert.equal(receipt.saved.values[sword.fieldId],'Reviewed sword');checks.push('Offline selection, review-only preparation/editing, Accept/Undo/Save, exported bytes, native receipt/history');
    await save('');assert.equal((await prepare('record')).prepared,1);await select('record');
    await fieldInput('Name').fill('Edited pending single match');await waitReviewText(sword.unitId,sword.fieldId,'Edited pending single match');
    const tied=await seed('new-form','Text',['Tied translation A','Tied translation B']);
    const ties=await prepare('new-form');assert.equal(ties.prepared,1);
    await select('new-form');
    const choice=review().getByRole('combobox',{name:'Choose translation',exact:true});
    assert.equal(await review().getByRole('button',{name:'Accept',exact:true}).isEnabled(),false);
    await choice.selectOption(tied.ids[0]);await fieldInput('Text MS').fill('Edited pending form');await waitReviewText(tied.unitId,tied.fieldId,'Edited pending form');
    await page.reload();await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return vm?.offlineStoreReady&&vm.cloudSignedIn&&!vm.workspaceInitializationActive;});
    await page.evaluate(async scope=>{const vm=window.__clientFixtureApp;await vm.activateGameVersion('poe2',{checkMigration:false});await vm.ctRefreshLocal();const metadata=await vm._ctLocalStore.getMetadata(scope);if(!await vm.ctOpenCached(metadata))throw Error(vm.ctError);},scope);
    await select('new-form');assert.equal(await fieldInput('Text MS').inputValue(),'Edited pending form');
    const restoredMeta=await app(async()=>{const vm=window.__clientFixtureApp;return vm.ctStorage(vm.ctWorkspace.scope).getMetadata(vm.ctWorkspace.scope);});
    assert.equal(restoredMeta.localProtocol,'clienttext-local-v3');
    const backup=await app(async()=>{
        const vm=window.__clientFixtureApp,blob=await vm._ctLocalStore.backup(vm.ctWorkspace.scope),zip=await JSZip.loadAsync(blob),manifest=JSON.parse(await zip.file('local-workbook.json').async('string'));
        window.__bulkTmBackupBlob=blob;
        const scope=await vm._ctLocalStore.restore(blob,vm.ctRequestScope(),vm._ctWorker);const metadata=await vm._ctLocalStore.getMetadata(scope);if(!await vm.ctOpenCached(metadata))throw Error(vm.ctError);
        return{protocol:manifest.protocol,scope,candidates:await vm.ctTmStorage().list(scope),reviews:await vm.ctTmStorage().listReviews(scope),drafts:await vm._ctLocalStore.getDraftSummaries(scope)};
    });
    assert.equal(backup.protocol,'clienttext-local-v3');assert.notEqual(backup.scope.groupId,scope.groupId);
    assert.ok(backup.reviews.some(value=>value.text==='Edited pending form'&&!value.acceptedDraft&&value.matchId===null));
    await select('record');assert.equal(await fieldInput('Name').inputValue(),'Edited pending single match');
    assert.equal(await review().getByRole('button',{name:'Accept',exact:true}).isEnabled(),false,'Restored single match requires renewed review');
    const singleRestored=await storeSnapshot('record',true);
    await review().getByRole('button',{name:'Review current match',exact:true}).click();
    await page.waitForFunction(()=>window.__clientFixtureApp.ctTmError.includes('No current TM match'));
    assert.equal(await review().getByRole('button',{name:'Accept',exact:true}).isEnabled(),false,'Frozen recovery evidence cannot replace an absent live TM');
    assert.equal(await fieldInput('Name').inputValue(),'Edited pending single match');
    assert.deepEqual(await storeSnapshot('record',true),singleRestored,'Absent live memory preserves restored workbook and reviewed text');
    // A second fresh restore receives an independently constructed current TM
    // through the ordinary private-seed API before its first activation.
    await app(async()=>{const vm=window.__clientFixtureApp,unit=vm.ctCurrentUnit,field=unit.fields.find(field=>field.name==='Name');
        const current={id:'fresh-restored-tm-record',source:field.source,target:'Fresh current sword',gameScope:vm.gameVersion,language:vm.lang,
            context:ContentAdapters.clienttext.contextFor(unit,field),revision:1,localRevision:1};
        const fresh=await vm._ctLocalStore.restore(window.__bulkTmBackupBlob,vm.ctRequestScope(),vm._ctWorker);
        await vm._ctLocalStore.seedMemory(fresh,[current]);const metadata=await vm._ctLocalStore.getMetadata(fresh);
        if(!await vm.ctOpenCached(metadata))throw Error(vm.ctError);
    });
    await select('record');assert.equal(await fieldInput('Name').inputValue(),'Edited pending single match');
    const seededRestored=await storeSnapshot('record',true);
    await review().getByRole('button',{name:'Review current match',exact:true}).click();
    await review().getByRole('button',{name:'Accept',exact:true}).waitFor({state:'visible'});
    try{await settled(()=>review().getByRole('button',{name:'Accept',exact:true}).isEnabled(),'Renewed restored single match did not become acceptable');}
    catch(error){const details=await app(()=>{const vm=window.__clientFixtureApp,field=vm.ctCurrentUnit.fields.find(field=>field.name==='Name'),candidate=vm.ctTmPendingCandidate(field);
        return{error:vm.ctTmError,candidate,review:vm.ctTmReviewFor(candidate),eligible:vm.ctTmFieldEligible(vm.ctCurrentUnit,field,null,{allowOwn:true}),memory:vm.ctTmLiveMemory().filter(row=>row.source==='Sword')};});throw new Error(error.message+': '+JSON.stringify(details));}
    assert.equal(await fieldInput('Name').inputValue(),'Edited pending single match','Renewed single-match review preserves edited text');
    assert.deepEqual(await storeSnapshot('record',true),seededRestored,'Renewed review leaves the restored workbook and ordinary draft unchanged');
    await select('new-form');assert.equal(await fieldInput('Text MS').inputValue(),'Edited pending form');
    assert.equal(await review().getByRole('button',{name:'Accept',exact:true}).isEnabled(),false,'Restored match choice is inert until renewed review');
    await review().getByRole('button',{name:'Dismiss',exact:true}).click();
    await settled(()=>app(()=>!window.__clientFixtureApp.ctTmCandidates.some(candidate=>candidate.status==='pending'&&candidate.unitId===window.__clientFixtureApp.ctSelection)),'Dismissal was not retained');
    checks.push('Tied alternatives, refresh recovery, v3 backup/restore with inert acceptance, restored single-match renewal, Dismiss');
    // Build a real published group from the same synthetic originals.
    const content=api.locals.content,upload=content.createUpload('fixture-admin',{game:'poe2',name:'Bulk TM browser',contentMode:'clienttext',storageProtocol:S.STORAGE_PROTOCOL,language:'French',idempotencyKey:randomUUID()}),units=[],assets=[];
    for(const[index,file]of files.entries()){
        const role=index?'gender':'normal',parsed=await Codec.parseWorkbook(file.buffer,{filename:file.name,role,language:'French',game:'poe2'});
        units.push(...parsed.units);assets.push({role,hash:createHash('sha256').update(file.buffer).digest('hex'),parserVersion:parsed.parserVersion});
        await content.receiveAsset(upload.upload.id,role,'fixture-admin',Readable.from([file.buffer]),file.name);
    }
    const built=await S.buildDescriptors(units,assets),published=await content.finalize(upload.upload.id,'fixture-admin',{storageProtocol:S.STORAGE_PROTOCOL,descriptors:built.descriptors,summaries:built.summaries,idempotencyKey:randomUUID()});
    await page.evaluate(async published=>{const vm=window.__clientFixtureApp;if(!await vm.ctOpenGroup(published.version,published.group,'French'))throw Error(vm.ctError);vm.appConfirm=async()=>true;},published);
    await select('record');await save('Published memory source');
    await app(async()=>{const vm=window.__clientFixtureApp;await vm._ctSync.flush();await vm._ctSync.pull();});
    await save('');await app(async()=>{const vm=window.__clientFixtureApp;await vm._ctSync.flush();await vm._ctSync.pull();await vm.ctLoadMemory();
        window.__bulkTmSaves=[];const request=vm._cloud.request.bind(vm._cloud);vm._cloud.request=async(path,options,...rest)=>{if(options?.method==='PATCH'&&/\/units\//.test(path))window.__bulkTmSaves.push(JSON.parse(JSON.stringify(options.body)));return request(path,options,...rest);};});
    const publishedBefore=await storeSnapshot('record',true);assert.equal(publishedBefore.saved.values[sword.fieldId],'');
    assert.equal((await prepare('record')).prepared,1);assert.deepEqual(await storeSnapshot('record',true),publishedBefore);
    await select('record');assert.equal(await fieldInput('Name').inputValue(),'Published memory source');
    await fieldInput('Name').fill('Reviewed shared sword');await review().getByRole('button',{name:'Accept',exact:true}).click();
    await review().getByRole('button',{name:'Undo accept',exact:true}).waitFor();
    await page.locator('.ctFullEditor').getByRole('button',{name:'Next',exact:true}).click();
    await page.waitForFunction(unitId=>{const vm=window.__clientFixtureApp;return !vm.ctBusy&&!vm._ctSaveJob&&vm.ctSelection!==unitId&&!vm._ctSelectRun?.pending;},sword.unitId);
    await app(async()=>{const vm=window.__clientFixtureApp;await vm._ctSync.flush();await vm._ctSync.pull();});
    const work=content.units(published.group.id,'French','fixture-admin').units.find(row=>row.id===sword.unitId)?.work;
    assert.equal(work.values[sword.fieldId],'Reviewed shared sword');
    const publishedCommitted=await storeSnapshot('record');assert.ok(publishedCommitted.history.some(entry=>entry.id===publishedCommitted.saved.jobId));
    const publishedReceipt=await page.evaluate(async({unitId,jobId})=>{
        const vm=window.__clientFixtureApp,scope=vm.ctWorkspace.scope,db=await OfflineStore.openClientTextDb();return new Promise((resolve,reject)=>{
            const tx=db.transaction(['clienttext_receipts'],'readonly'),request=tx.objectStore('clienttext_receipts').get(JSON.stringify([ClientTextStore.scopeKey(scope),jobId]));
            request.onsuccess=()=>resolve(request.result?.value);request.onerror=()=>reject(request.error);});
    },{unitId:sword.unitId,jobId:publishedCommitted.saved.jobId});
    assert.equal(publishedReceipt.saved.values[sword.fieldId],'Reviewed shared sword');
    const sent=await app(()=>window.__bulkTmSaves);assert.ok(sent.length>0);assert.ok(sent.every(body=>!body.tmAcceptances&&!body.tmCandidates&&!body.tmReviews));
    checks.push('Published workbook Save-and-next retains native receipt/history and uses existing authenticated Save wire; private evidence stays local');
    assert.deepEqual(inference,[]);assert.deepEqual(failures,[]);
    const report={ok:true,checks,screenshots:['light','grey','dark','modern-dark'],inference:false,errors:failures};
    writeFileSync(join(directory,'clienttext-tm-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
};
