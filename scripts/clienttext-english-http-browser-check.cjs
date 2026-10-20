'use strict';
// Real SPA/IndexedDB/worker and authenticated HTTP saves. Synthetic originals only.
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {randomUUID,createHash}=require('node:crypto');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function({page,api,files,Codec,ClientState:S,failures,directory}){
    const content=api.locals.content,upload=content.createUpload('fixture-admin',{game:'poe2',name:'English HTTP browser',contentMode:'clienttext',storageProtocol:S.STORAGE_PROTOCOL,language:'French',idempotencyKey:randomUUID()}),units=[],assets=[];
    for(const [index,file]of files.entries()){
        const role=index?'gender':'normal',parsed=await Codec.parseWorkbook(file.buffer,{filename:file.name,role,language:'French',game:'poe2'});
        units.push(...parsed.units);assets.push({role,hash:createHash('sha256').update(file.buffer).digest('hex'),parserVersion:parsed.parserVersion});
        await content.receiveAsset(upload.upload.id,role,'fixture-admin',Readable.from([file.buffer]),file.name);
    }
    const built=await S.buildDescriptors(units,assets),accepted=await content.finalize(upload.upload.id,'fixture-admin',{storageProtocol:S.STORAGE_PROTOCOL,descriptors:built.descriptors,summaries:built.summaries,idempotencyKey:randomUUID()});
    await page.evaluate(async accepted=>{
        const vm=window.__clientFixtureApp;window.__httpSent=[];window.__httpInference=[];
        window.__originalHttp=vm._cloud.request.bind(vm._cloud);window.__syncHttpUI=vm.ctSync.bind(vm);vm.ctSync=()=>{};
        vm._cloud.request=async(path,init={})=>{
            const save=init.method==='PATCH' && /\/units\//.test(path),entry=save?{path,body:JSON.parse(JSON.stringify(init.body))}:null;
            if(entry)window.__httpSent.push(entry);
            try{const result=await window.__originalHttp(path,init);if(entry)entry.status=200;
                if(save && window.__loseHttpReceipt){window.__loseHttpReceipt=false;throw Error('Synthetic lost committed HTTP receipt');}return result;
            }catch(error){if(entry)entry.error=error.code || error.message;throw error;}
        };
        if(!await vm.ctOpenGroup(accepted.version,accepted.group,'French'))throw Error(vm.ctError || 'Open real shared group failed');
        clearInterval(vm._ctSyncTimer);vm.appConfirm=async()=>true;
        window.__reloadHttp=async()=>{const vm=window.__clientFixtureApp,id=vm.ctSelection;vm.ctSaved=Vue.markRaw(await vm._ctStore.getSaved(vm.ctWorkspace.scope));vm.ctRevision++;if(id)await vm.ctSelect(vm.ctUnits.find(u=>u.id===id),true);};
    },accepted);
    page.on('request',request=>{if(request.method()==='POST' && /\/v1\/mtl\/(?:local\/)?requests/.test(request.url()))failures.push('Unexpected inference request');});
    const select=async recordId=>page.evaluate(async recordId=>{const vm=window.__clientFixtureApp,u=vm.ctUnits.find(u=>u.role==='normal' && u.recordId===recordId);if(!u)throw Error('Missing fixture record');await vm.ctSelect(u,true);vm.ctEditor=true;return{unitId:u.id,fieldId:u.fields.find(f=>f.kind==='text').id};},recordId);
    const clickSave=async(button,key)=>{const revision=await page.evaluate(()=>window.__clientFixtureApp.ctSaved[window.__clientFixtureApp.ctSelection]?.revision || 0);if(key){await button.focus();await button.press(key);}else await button.click();await page.waitForFunction(revision=>{const vm=window.__clientFixtureApp;return !vm.ctBusy && !vm._ctSaveJob && (vm.ctSaved[vm.ctSelection]?.revision || 0)>revision;},revision);};
    const english=()=>page.getByRole('button',{name:'Use English',exact:true}).first();
    const save=()=>page.getByRole('button',{name:'Save',exact:true}).first();
    const flush=()=>page.evaluate(async()=>{const vm=window.__clientFixtureApp,result=await vm._ctSync.flush();await vm._ctSync.pull();await window.__reloadHttp();return result;});
    const current=recordId=>content.units(accepted.group.id,'French','fixture-admin').units.find(row=>row.id===units.find(u=>u.role==='normal' && u.recordId===recordId).id)?.work;
    const chosen=await select('record');
    const visibleMissing=async()=>Number(await page.locator('.ctWorkspace .statusPill.missing strong').textContent());
    const beforeMissing=await visibleMissing();
    const placement=await english().evaluate(button=>({text:button.textContent.trim(),separator:button.parentElement.previousElementSibling.getAttribute('role'),previous:button.parentElement.previousElementSibling.previousElementSibling.getAttribute('aria-label')}));
    assert.deepEqual(placement,{text:'Eng',separator:'separator',previous:'Underline'});
    await clickSave(english(),'Space');
    assert.equal(await english().getAttribute('aria-pressed'),'true');assert.equal(await visibleMissing(),beforeMissing-1);
    assert.equal(await page.getByText('Raw Missing counts and the existing team progress calculation are unchanged.',{exact:true}).count(),0);
    const resolved=await page.evaluate(()=>{const vm=window.__clientFixtureApp,field=vm.ctCurrentUnit.fields.find(f=>f.kind==='text');return{field:vm.ctFieldStatus(field),progress:vm.ctWorkProgress,missingFilter:vm.ctStatusFilterOptions.find(option=>option.key==='missing').count,frame:document.querySelector('.fieldEnglishButton').closest('.editorFieldFrame').className};});
    assert.equal(resolved.field.missing,false);assert.equal(resolved.field.rawMissing,true);assert.equal(resolved.missingFilter,beforeMissing-1);assert.equal(resolved.frame.includes('missing'),false);
    await page.getByRole('button',{name:'Close',exact:true}).first().click();await page.waitForFunction(()=>!window.__clientFixtureApp.ctEditor);
    const missingCounter=page.locator('.ctWorkspace .statusPill.missing');assert.equal(await missingCounter.isVisible(),true);await missingCounter.click();
    assert.equal(await page.evaluate(id=>window.__clientFixtureApp.ctRows.some(unit=>unit.id===id),chosen.unitId),false);
    assert.equal(await page.getByRole('button',{name:'record',exact:true}).count(),0,'resolved row is absent from the actual Missing table');
    await page.evaluate(()=>window.__clientFixtureApp.ctShowAllLoaded());await select('record');
    for(const theme of ['light','grey','dark','modern-dark']){await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);await english().scrollIntoViewIfNeeded();await page.screenshot({path:join(directory,'english-toolbar-'+theme+'.png')});}
    assert.equal((await flush()).uploaded,1);assert.equal(current('record').englishIntent[chosen.fieldId].state,'active');
    await page.locator('[data-ct-target]').filter({visible:true}).first().fill('Ordinary HTTP editor save');await clickSave(save());assert.equal((await flush()).uploaded,1);assert.equal(current('record').values[chosen.fieldId],'Ordinary HTTP editor save');
    // Exercise a real validation response from an actual current-editor command.
    await page.locator('[data-ct-target]').filter({visible:true}).first().fill(await page.evaluate(()=>window.__clientFixtureApp.ctCurrentUnit.fields.find(f=>f.kind==='text').source));
    await page.evaluate(()=>{const vm=window.__clientFixtureApp;window.__eligibleHttp=vm.ctEnglishWitness;vm.ctEnglishWitness=actions=>{const result=window.__eligibleHttp(actions);for(const field of Object.values(result.fields))field.eligible=false;return result;};});
    await clickSave(english(),'Enter');await page.evaluate(()=>{window.__clientFixtureApp.ctEnglishWitness=window.__eligibleHttp;});
    const rejected=await page.evaluate(async()=>{const vm=window.__clientFixtureApp;await window.__syncHttpUI();const pending=(await vm._ctStore.getOutbox(vm.ctWorkspace.scope))[0],code=pending.rejection.code,retry=await vm._ctSync.flush();return{code,retry};});
    assert.equal(rejected.code,'CLIENTTEXT_INTENT_ELIGIBILITY_REQUIRED');assert.equal(rejected.retry.rejected,1);assert.equal(await visibleMissing(),beforeMissing,'rejected decision returns normal Missing');
    await page.getByRole('button',{name:'Reapply retained work and save ID',exact:true}).click();await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return !vm.ctRecoveryBusy && !vm.ctBusy && !vm.ctPendingSharedRecovery();});
    assert.equal((await flush()).uploaded,1);assert.equal(current('record').englishIntent[chosen.fieldId].state,'active');
    const conflicts=[];
    for(const [recordId,resolution]of [['complete','accept-peer'],['second','reapply']]){
        const choice=await select(recordId);await page.locator('[data-ct-target]').filter({visible:true}).first().fill(await page.evaluate(()=>window.__clientFixtureApp.ctCurrentUnit.fields.find(f=>f.kind==='text').source));await clickSave(english());
        await page.evaluate(()=>{window.__loseHttpReceipt=true;});
        assert.equal(await page.evaluate(async()=>{try{await window.__clientFixtureApp._ctSync.flush();return '';}catch(error){return error.message;}}),'Synthetic lost committed HTTP receipt');
        await page.locator('[data-ct-target]').filter({visible:true}).first().fill('Local queued successor');await clickSave(save());
        await page.evaluate(async choice=>{
            const vm=window.__clientFixtureApp,first=window.__httpSent.findLast(entry=>entry.body.englishActions && entry.path.includes(encodeURIComponent(choice.unitId)));
            const body={...first.body,mutationId:crypto.randomUUID(),baseRevision:1,values:{...first.body.values,[choice.fieldId]:'Peer competing translation'}};delete body.englishActions;delete body.englishEligibility;
            await window.__originalHttp('/v1/content-groups/'+encodeURIComponent(vm.ctWorkspace.scope.groupId)+'/teams/French/units/'+encodeURIComponent(choice.unitId),{method:'PATCH',body,headers:{'X-SDEditor-ClientText-Protocol':ClientTextState.STORAGE_PROTOCOL}});
            await vm._ctSync.pull();await window.__reloadHttp();
        },choice);
        const retried=await flush();assert.equal(retried.uploaded,1);assert.equal(retried.conflicts,1);assert.equal(current(recordId).values[choice.fieldId],'Peer competing translation');
        const held=await page.evaluate(async()=>{const vm=window.__clientFixtureApp,pending=(await vm._ctStore.getOutbox(vm.ctWorkspace.scope))[0];return{mutationId:pending.mutationId,state:pending.state,requiresResolution:pending.requiresResolution,conflicts:vm.ctSaved[vm.ctSelection].conflicts.length};});
        assert.equal(held.state,'conflict');assert.equal(held.requiresResolution,true);assert.ok(held.conflicts);
        await page.getByRole('button',{name:resolution==='accept-peer'?'Accept shared version':'Reapply retained work and save ID',exact:true}).click();
        await page.waitForFunction(()=>{const vm=window.__clientFixtureApp;return !vm.ctRecoveryBusy && !vm.ctBusy && !vm.ctPendingSharedRecovery();});
        await flush();assert.equal(current(recordId).values[choice.fieldId],resolution==='accept-peer'?'Peer competing translation':'Local queued successor');
        const archived=await page.evaluate(async mutationId=>{const vm=window.__clientFixtureApp;return(await vm._ctStore.listHistory(vm.ctWorkspace.scope,vm.ctSelection)).some(entry=>entry.syncRecovery?.operation.mutationId===mutationId);},held.mutationId);assert.equal(archived,true);
        conflicts.push({recordId,resolution,held,serverAfter:current(recordId).values[choice.fieldId]});
    }
    const sent=await page.evaluate(()=>window.__httpSent);assert.ok(sent.every(entry=>entry.body.intentProtocol===S.ENGLISH_INTENT_PROTOCOL));
    assert.deepEqual(failures,[]);const report={ok:true,toolbar:{placement,beforeMissing,afterMissing:beforeMissing-1,resolved,keyboard:['Space','Enter']},case:'Real current-editor bodies through authenticated HTTP; validation recovery and late receipt ordinary-successor conflicts',rejected,conflicts,httpSaves:sent,errors:failures,inference:false};
    writeFileSync(join(directory,'clienttext-english-http-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
};
