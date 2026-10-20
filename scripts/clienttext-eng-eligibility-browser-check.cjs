'use strict';
// Synthetic originals; actual Vue, worker/IndexedDB, authenticated localhost API.
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {randomUUID,createHash}=require('node:crypto');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function({page,api,files,Codec,ClientState:S,failures,directory,touch=false}){
    const content=api.locals.content,upload=content.createUpload('fixture-admin',{game:'poe2',name:'Eng draft eligibility',contentMode:'clienttext',storageProtocol:S.STORAGE_PROTOCOL,language:'French',idempotencyKey:randomUUID()}),units=[],assets=[];
    for(const [index,file]of files.entries()){
        const role=index?'gender':'normal',parsed=await Codec.parseWorkbook(file.buffer,{filename:file.name,role,language:'French',game:'poe2'});
        units.push(...parsed.units);assets.push({role,hash:createHash('sha256').update(file.buffer).digest('hex'),parserVersion:parsed.parserVersion});
        await content.receiveAsset(upload.upload.id,role,'fixture-admin',Readable.from([file.buffer]),file.name);
    }
    const built=await S.buildDescriptors(units,assets),accepted=await content.finalize(upload.upload.id,'fixture-admin',{storageProtocol:S.STORAGE_PROTOCOL,descriptors:built.descriptors,summaries:built.summaries,idempotencyKey:randomUUID()});
    const inference=[],cases=[],touchCases=[];page.on('request',request=>{if(request.method()==='POST'&&/\/v1\/mtl\/(?:local\/)?requests/.test(request.url()))inference.push(request.url());});
    await page.evaluate(async accepted=>{
        const vm=window.__clientFixtureApp;window.__engHttp=[];window.__engSaveAttempts=0;
        const request=vm._cloud.request.bind(vm._cloud),save=vm.ctSave.bind(vm);window.__engSync=vm.ctSync.bind(vm);vm.ctSync=()=>{};
        vm._cloud.request=async(path,init={})=>{if(init.method==='PATCH'&&/\/units\//.test(path))window.__engHttp.push({path,body:JSON.parse(JSON.stringify(init.body))});return request(path,init);};
        vm.ctSave=(...args)=>{window.__engSaveAttempts++;return save(...args);};
        if(!await vm.ctOpenGroup(accepted.version,accepted.group,'French'))throw Error(vm.ctError||'Shared group open failed');
        clearInterval(vm._ctSyncTimer);vm.appConfirm=async()=>true;
        window.__engSnapshot=async()=>({unitId:vm.ctSelection,values:JSON.parse(JSON.stringify(vm.ctValues)),saved:JSON.parse(JSON.stringify(vm.ctSaved[vm.ctSelection]||null)),
            history:(await vm._ctStore.listHistory(vm.ctWorkspace.scope,vm.ctSelection)).length,outbox:(await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length,saveAttempts:window.__engSaveAttempts,http:window.__engHttp.length});
    },accepted);
    if(touch)await page.evaluate(()=>{
        window.__engTouchEvents=[];
        for(const type of ['pointerdown','pointerup','touchstart','touchend','click'])document.addEventListener(type,event=>{
            const target=event.target.closest?.('.fieldEnglishTarget');if(!target)return;
            window.__engTouchEvents.push({type,pointerType:event.pointerType||'',disabled:!!target.querySelector('button:disabled'),editor:window.__clientFixtureApp.ctEditor});
        },true);
    });
    const select=async(recordId,role='normal')=>page.evaluate(async({recordId,role})=>{
        const vm=window.__clientFixtureApp,unit=vm.ctUnits.find(u=>u.role===role&&u.recordId===recordId);if(!unit)throw Error('Synthetic record absent');
        await vm.ctSelect(unit,true);vm.ctEditor=true;return{unitId:unit.id,fieldId:unit.fields.find(f=>f.kind!=='gender').id,source:unit.fields.find(f=>f.kind!=='gender').source};
    },{recordId,role});
    const input=()=>page.locator('[data-ct-target]').filter({visible:true}).first();
    const tools=()=>input().locator('xpath=ancestor::div[contains(@class,"editorFieldTools")][1]');
    const english=()=>tools().getByRole('button',{name:'Use English',exact:true});
    const wrapper=()=>tools().locator('.fieldEnglishTarget');
    const snapshot=()=>page.evaluate(()=>window.__engSnapshot());
    const record=async name=>{const row=await english().evaluate(el=>({disabled:el.disabled,active:el.getAttribute('aria-pressed'),description:el.getAttribute('aria-description')}));cases.push({name,...row});return row;};
    const tapEnglish=async()=>{
        const before=await page.evaluate(()=>window.__engTouchEvents.length),box=await english().boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
        const events=await page.evaluate(before=>window.__engTouchEvents.slice(before),before);
        for(const type of ['pointerdown','pointerup'])assert.ok(events.some(event=>event.type===type&&event.pointerType==='touch'),'actual touch '+type+' reaches Eng');
    };
    const touchState=async(name,visible)=>{
        await page.waitForTimeout(150);const state=await page.evaluate(()=>({visible:window.__clientFixtureApp.tooltip.visible,text:window.__clientFixtureApp.tooltip.text,focus:document.activeElement?.className,editor:window.__clientFixtureApp.ctEditor}));
        touchCases.push({name,...state});assert.equal(state.visible,visible,name+': '+JSON.stringify(state));
        if(visible){assert.equal(await page.getByRole('tooltip').count(),1);assert.equal(state.text,await english().getAttribute('aria-description'));assert.equal(await wrapper().evaluate(el=>document.activeElement===el),true);}
    };
    const touchOutside=async()=>{const box=await page.locator('.ctEditorActions h1').boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);};
    const chosen=await select('record');
    for(const [name,text,disabled]of [['blank','',false],['identical',chosen.source,false],['translated','Different translation',true],['trailing space',chosen.source+' ',true],['case difference',chosen.source.toLowerCase(),true],['whitespace',' \t\n',false]]){
        await input().fill(text);assert.equal((await record(name)).disabled,disabled);
    }
    await input().fill('Different translation');const beforeDisabled=await snapshot();
    if(touch){
        await tapEnglish();await touchState('fresh disabled tap',true);await touchOutside();await touchState('outside tap dismisses',false);
        await tapEnglish();await touchState('tap reopens after outside',true);await page.keyboard.press('Escape');await touchState('Escape dismisses touch hint',false);
        await tapEnglish();await touchState('same focused trigger reopens after Escape',true);await touchOutside();await touchState('second outside dismissal',false);
        await tools().getByRole('button',{name:'Underline',exact:true}).focus();await page.keyboard.press('Tab');await page.keyboard.press('Escape');
        await tapEnglish();await touchState('tap after keyboard-focus Escape',true);await touchOutside();await touchState('keyboard-to-touch outside dismissal',false);
        assert.deepEqual(await snapshot(),beforeDisabled,'touch exploration cannot mark, queue, save or alter the draft');
    }
    await wrapper().hover();await page.getByRole('tooltip').waitFor();assert.match(await page.getByRole('tooltip').innerText(),/current translation is blank or exactly matches English/);
    await tools().getByRole('button',{name:'Underline',exact:true}).focus();await page.keyboard.press('Tab');
    assert.equal(await wrapper().evaluate(el=>document.activeElement===el),true);assert.match(await page.getByRole('tooltip').innerText(),/different translation/i);
    await page.keyboard.press('Enter');await page.keyboard.press('Space');await page.keyboard.press('Escape');
    assert.equal(await wrapper().evaluate(el=>document.activeElement===el),true);await page.getByRole('tooltip').waitFor({state:'detached'});
    await english().click({force:true});assert.equal(await page.evaluate(()=>window.__clientFixtureApp.ctChooseEnglish(window.__clientFixtureApp.ctCurrentUnit.fields.find(f=>f.kind==='text'))),false);
    assert.deepEqual(await snapshot(),beforeDisabled,'disabled explanation and activation attempts do not save, mark, queue or change editor text');
    const saveEnglish=async key=>{const previous=await page.evaluate(()=>window.__clientFixtureApp.ctSaved[window.__clientFixtureApp.ctSelection]?.revision||0);if(touch)await tapEnglish();else{await english().focus();await page.keyboard.press(key);}
        await page.waitForFunction(previous=>{const vm=window.__clientFixtureApp;return !vm.ctBusy&&!vm._ctSaveJob&&(vm.ctSaved[vm.ctSelection]?.revision||0)>previous;},previous);await page.evaluate(()=>window.__engSync());};
    await input().fill(chosen.source);await saveEnglish('Space');
    assert.equal((await record('real identical activation')).active,'true');assert.equal(await input().inputValue(),'');
    const marked=await snapshot();assert.equal(marked.saved.englishIntent[chosen.fieldId].state,'active');assert.equal(marked.saved.values[chosen.fieldId],'');
    await input().fill('Different draft while approval is active');assert.equal((await record('active approval remains removable with a different draft')).disabled,false);
    await saveEnglish('Enter');const revoked=await snapshot();assert.equal(revoked.saved.englishIntent[chosen.fieldId].state,'revoked');assert.equal(revoked.saved.values[chosen.fieldId],'Different draft while approval is active');
    assert.equal((await record('revoked different draft disables new activation')).disabled,true);
    await input().fill('');await saveEnglish('Space');assert.equal((await record('real blank activation')).active,'true');await saveEnglish('Enter');
    assert.equal((await snapshot()).saved.englishIntent[chosen.fieldId].state,'revoked');
    // Current source-bound suspension projection; immutable originals/API data stay intact.
    await page.evaluate(async()=>{
        const vm=window.__clientFixtureApp,unit=vm.ctCurrentUnit,field=unit.fields.find(f=>f.kind==='text');window.__engRestore={unit,saved:vm.ctSaved[unit.id],values:{...vm.ctValues},reviewed:{...vm.ctReviewed},queueDraft:vm.ctQueueDraft,dirty:vm.ctDraftDirty};vm.ctQueueDraft=()=>{};
        const changed=Vue.markRaw({...unit,fields:unit.fields.map(f=>f===field?{...f,source:'Changed English source',sourceHash:ClientTextState.sourceHash('Changed English source')}:f)});
        vm._ctUnitIndex.set(unit.id,changed);vm.ctUnits=Vue.markRaw(vm.ctUnits.map(u=>u.id===unit.id?changed:u));
        vm.ctSaved=Vue.markRaw({...vm.ctSaved,[unit.id]:{...vm.ctSaved[unit.id],englishIntent:{[field.id]:{state:'needs_review',sourceHash:ClientTextState.sourceHash(field.source),decisionId:'synthetic-old-source'}}}});
        vm.ctValues={...vm.ctValues,[field.id]:field.source};await vm.$nextTick();
    });
    assert.equal((await record('old English cannot reactivate a changed-source decision')).disabled,true);
    await input().fill('Changed English source');assert.equal((await record('current English allows explicit source reapproval')).disabled,false);
    await page.evaluate(async()=>{const vm=window.__clientFixtureApp,s=window.__engRestore;vm._ctUnitIndex.set(s.unit.id,s.unit);vm.ctUnits=Vue.markRaw(vm.ctUnits.map(u=>u.id===s.unit.id?s.unit:u));vm.ctSaved=Vue.markRaw({...vm.ctSaved,[s.unit.id]:s.saved});vm.ctValues=s.values;vm.ctReviewed=s.reviewed;vm.ctQueueDraft=s.queueDraft;vm.ctDraftDirty=s.dirty;await vm.$nextTick();});
    await page.evaluate(()=>{const vm=window.__clientFixtureApp;window.__engRetainedController=vm.ctFieldToolbar(vm.ctCurrentUnit.fields.find(f=>f.kind==='text'),'translation');});
    await select('complete');const beforeStale=await snapshot();assert.equal(await page.evaluate(()=>window.__engRetainedController.englishToggle()),false);assert.deepEqual(await snapshot(),beforeStale);cases.push({name:'retained callback after record switch',blocked:true});
    await select('form','gender');const beforeUnsupported=await snapshot();assert.equal((await record('unsupported grammatical form')).disabled,true);
    await wrapper().hover();await page.getByRole('tooltip').waitFor();assert.match(await page.getByRole('tooltip').innerText(),/grammatical/);assert.equal(await page.evaluate(()=>window.__clientFixtureApp.ctChooseEnglish(window.__clientFixtureApp.ctCurrentUnit.fields[0])),false);assert.deepEqual(await snapshot(),beforeUnsupported);
    if(touch){await tapEnglish();await touchState('unsupported form explanation',true);assert.deepEqual(await snapshot(),beforeUnsupported);}
    await select('record');await input().fill('Inline different translation');
    await input().evaluate(el=>el.blur());
    await page.evaluate(async()=>{const vm=window.__clientFixtureApp;vm.inlineEditor=true;vm.ctEditor=false;vm.ctInlineClosed=false;vm.ctSheet='';vm.ctSearch='';vm.ctAppliedSearch='';vm.ctFilter='';vm.ctPage=1;vm.ctSelectedFilters=vm.ctStatusFilterOptions.map(o=>o.key);await vm.$nextTick();});
    await page.waitForSelector('.ctListWorkspace [data-ct-target]');assert.equal((await record('inline translated draft')).disabled,true);
    await input().fill(chosen.source);assert.equal((await record('inline identical draft')).disabled,false);await input().fill('');assert.equal((await record('inline blank draft')).disabled,false);
    await input().fill('Different translation');const beforeInline=await snapshot();await wrapper().hover();await page.getByRole('tooltip').waitFor();
    await tools().getByRole('button',{name:'Underline',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await wrapper().evaluate(el=>document.activeElement===el),true);await page.keyboard.press('Enter');await page.keyboard.press('Space');assert.deepEqual(await snapshot(),beforeInline,'inline disabled explanation cannot save or mark the record');
    if(touch){await page.keyboard.press('Escape');await tapEnglish();await touchState('inline tap after keyboard dismissal',true);await page.keyboard.press('Escape');await touchState('inline Escape dismissal',false);await tapEnglish();await touchState('inline same-trigger reopen',true);assert.deepEqual(await snapshot(),beforeInline,'inline touch does not save, navigate or alter the draft');}
    await page.screenshot({path:join(directory,'eng-translated-disabled-inline.png')});
    const server=content.units(accepted.group.id,'French','fixture-admin').units.find(u=>u.id===chosen.unitId).work;
    assert.equal(server.englishIntent[chosen.fieldId].state,'revoked');assert.equal(server.values[chosen.fieldId],'');
    const requests=await page.evaluate(()=>window.__engHttp);assert.equal(requests.length,4);assert.deepEqual(failures,[]);assert.deepEqual(inference,[]);
    const touchInputEvents=touch?await page.evaluate(()=>window.__engTouchEvents):[];
    const report={ok:true,cases,touchCases,touchInputEvents,touchLimit:touch?'Edge desktop touch emulation; physical touchscreen not tested.':null,disabledInteractionUnchanged:true,actualSharedActions:requests.map(r=>r.body.englishActions),httpSaves:requests.length,sourceSuspension:'Synthetic read-only UI projection; original files and API source facts unchanged',errors:failures,inference};
    writeFileSync(join(directory,'eng-draft-eligibility-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
};
