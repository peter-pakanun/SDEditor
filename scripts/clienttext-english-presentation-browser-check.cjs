'use strict';
// Desktop acceptance: current Vue/components, real IndexedDB/worker and localhost API.
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {randomUUID,createHash}=require('node:crypto');
const {writeFileSync,readFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function({page,api,files,Codec,ClientState:S,failures,directory,JSZip,bootstrap}){
    const content=api.locals.content,upload=content.createUpload('fixture-admin',{game:'poe2',name:'Eng presentation',contentMode:'clienttext',storageProtocol:S.STORAGE_PROTOCOL,language:'French',idempotencyKey:randomUUID()}),units=[],assets=[];
    for(const [index,file]of files.entries()){
        const role=index?'gender':'normal',parsed=await Codec.parseWorkbook(file.buffer,{filename:file.name,role,language:'French',game:'poe2'});
        units.push(...parsed.units);assets.push({role,hash:createHash('sha256').update(file.buffer).digest('hex'),parserVersion:parsed.parserVersion});
        await content.receiveAsset(upload.upload.id,role,'fixture-admin',Readable.from([file.buffer]),file.name);
    }
    const built=await S.buildDescriptors(units,assets),accepted=await content.finalize(upload.upload.id,'fixture-admin',{storageProtocol:S.STORAGE_PROTOCOL,descriptors:built.descriptors,summaries:built.summaries,idempotencyKey:randomUUID()});
    const inference=[],cases=[],themes=[];
    page.on('request',request=>{if(request.method()==='POST'&&/\/v1\/mtl\/(?:local\/)?requests/.test(request.url()))inference.push(request.url());});
    const open=()=>page.evaluate(async accepted=>{
        const vm=window.__clientFixtureApp;if(!await vm.ctOpenGroup(accepted.version,accepted.group,'French'))throw Error(vm.ctError||'Shared group open failed');
        clearInterval(vm._ctSyncTimer);window.__presentationSync=vm.ctSync.bind(vm);vm.ctSync=()=>{};vm.appConfirm=async()=>true;
    },accepted);
    await open();
    const choose=async(recordId,name='Name')=>page.evaluate(async({recordId,name})=>{
        const vm=window.__clientFixtureApp,unit=vm.ctUnits.find(unit=>unit.role==='normal'&&unit.recordId===recordId),field=unit.fields.find(field=>field.name===name);
        await vm.ctSelect(unit,true);vm.ctEditor=true;vm.ctFocusedField=field.id;return {unitId:unit.id,fieldId:field.id,source:field.source};
    },{recordId,name});
    const input=name=>page.getByRole('textbox',{name,exact:true});
    const tools=name=>input(name).locator('xpath=ancestor::div[contains(@class,"editorFieldTools")][1]');
    const english=name=>tools(name).getByRole('button',{name:'Use English',exact:true});
    const snapshot=()=>page.evaluate(async()=>{
        const vm=window.__clientFixtureApp,field=vm.ctPreviewField,unit=vm.ctCurrentUnit;
        return {value:vm.ctValues[field.id],saved:vm.ctSaved[unit.id]?.values[field.id],active:vm.ctUsesEnglish(field),missing:vm.ctCounts.missing,progress:vm.ctWorkProgress,
            preview:JSON.parse(JSON.stringify(vm.ctGamePreview)),history:(await vm._ctStore.listHistory(vm.ctWorkspace.scope,unit.id)).length};
    });
    const toggle=async name=>{
        const revision=await page.evaluate(()=>{const vm=window.__clientFixtureApp;return vm.ctSaved[vm.ctSelection]?.revision||0;});
        await english(name).focus();await page.keyboard.press('Space');
        await page.waitForFunction(revision=>{const vm=window.__clientFixtureApp;return !vm.ctBusy&&!vm._ctSaveJob&&(vm.ctSaved[vm.ctSelection]?.revision||0)>revision;},revision);
        await page.evaluate(()=>window.__presentationSync());
    };
    const check=async(name,fieldName='Name',active=true)=>{
        assert.equal(await input(fieldName).getAttribute('placeholder'),active?'-- Use English --':'Translation');
        const state=await snapshot();assert.equal(state.active,active);
        if(active){assert.equal(state.value,'');assert.equal(state.saved,'');assert.deepEqual(state.preview.target.segments,state.preview.source.segments);}
        cases.push({name,...state});return state;
    };
    const chosen=await choose('record'),initial=await check('unmarked blank','Name',false);
    assert.equal(await english('Name').isEnabled(),true);await toggle('Name');
    const marked=await check('blank approved');assert.equal(marked.missing,initial.missing-1);assert.equal(marked.progress.resolved,initial.progress.resolved+1);
    assert.equal(await input('Name').evaluate(el=>el.matches(':placeholder-shown')),true);
    for(const theme of ['light','grey','dark','modern-dark']){
        await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
        const style=await input('Name').evaluate(el=>({placeholder:getComputedStyle(el,'::placeholder').color,muted:getComputedStyle(el).getPropertyValue('--ui-muted').trim(),color:getComputedStyle(el).color,opacity:getComputedStyle(el,'::placeholder').opacity}));
        assert.notEqual(style.placeholder,style.color);assert.equal(style.opacity,'1');themes.push({theme,...style});
    }
    await page.screenshot({path:join(directory,'eng-placeholder-full.png')});
    await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
    await input('Name').fill(' \t');
    assert.equal(await tools('Name').locator('.editorHighlightContent').innerText(),'-- Use English --');
    const whitespace=await snapshot();assert.equal(whitespace.value,' \t');assert.deepEqual(whitespace.preview.target.segments,whitespace.preview.source.segments);
    assert.equal(await page.evaluate(()=>window.__clientFixtureApp.ctSave()),true);await page.evaluate(()=>window.__presentationSync());
    assert.equal((await snapshot()).saved,' \t');cases.push({name:'approved whitespace has a display overlay and saves exact raw whitespace'});
    await input('Name').fill('');
    // Ordinary durable save of an active blank must retain its actual blank.
    assert.equal(await page.evaluate(()=>window.__clientFixtureApp.ctSave()),true);await page.evaluate(()=>window.__presentationSync());
    await check('ordinary blank save preserves approval');
    await bootstrap();await open();await choose('record');await check('reload and reopen preserve placeholder');
    // Collapsed display, independently of the editable native placeholder.
    await page.evaluate(async()=>{const vm=window.__clientFixtureApp;vm.ctEditor=false;vm.inlineEditor=false;vm.ctSheet='';vm.ctFilter='';vm.ctSearch='';vm.ctAppliedSearch='';vm.ctSelectedFilters=vm.ctStatusFilterOptions.map(option=>option.key);await vm.$nextTick();});
    const row=page.locator('tr[data-unit-id='+JSON.stringify(chosen.unitId)+']');
    assert.equal(await row.locator('.ctEnglishPlaceholder').innerText(),'-- Use English --');
    assert.equal(await page.evaluate(()=>window.__clientFixtureApp.ctListText(window.__clientFixtureApp.ctCurrentUnit,'target')),'Old description');
    cases.push({name:'collapsed row shows dimmed presentation only'});
    await page.evaluate(async()=>{const vm=window.__clientFixtureApp;vm.inlineEditor=true;vm.ctInlineClosed=false;await vm.$nextTick();});
    await check('inline active placeholder');await page.screenshot({path:join(directory,'eng-placeholder-inline.png')});
    await toggle('Name');const revoked=await check('inline revoke restores empty translation','Name',false);assert.equal(revoked.missing,initial.missing);assert.equal(revoked.progress.resolved,initial.progress.resolved);
    await input('Name').fill(chosen.source);assert.equal(await english('Name').isEnabled(),true);assert.equal(await input('Name').evaluate(el=>el.matches(':placeholder-shown')),false);
    await toggle('Name');await check('identical source approval becomes placeholder');
    await input('Name').fill('A different draft');assert.equal(await english('Name').isEnabled(),true);assert.equal(await input('Name').evaluate(el=>el.matches(':placeholder-shown')),false);
    assert.equal((await snapshot()).preview.target.segments.map(segment=>segment.text||'').join(''),'A different draft');
    await toggle('Name');assert.equal(await english('Name').isDisabled(),true);assert.equal(await input('Name').inputValue(),'A different draft');cases.push({name:'active removal preserves typed text and translated state disables activation'});
    await input('Name').fill('');await toggle('Name');await check('blank reapproval');
    // Real identical-source field with variable and keybind markup: target uses the real renderer.
    const formatted=await choose('complete','Description');assert.match(formatted.source,/\{0:\+d\}/);assert.match(formatted.source,/keybind/);
    assert.equal(await input('Description').inputValue(),formatted.source);await toggle('Description');const formattedState=await check('formatted English target preview','Description');
    assert.ok(formattedState.preview.target.segments.some(segment=>segment.type!=='text'));assert.ok(await page.locator('.gamePreviewTargetPane').innerText());
    await choose('record');
    // Invalid/stale UI projections never persist and never show resolved presentation.
    const invalid=[];
    for(const reason of ['source changed','revoked','conflict','suspended']){
        const projection=await page.evaluate(async reason=>{
            const vm=window.__clientFixtureApp,unit=vm.ctCurrentUnit,field=vm.ctPreviewField,saved=vm.ctSaved[unit.id];
            window.__presentationRestore={unit,saved};let next=saved;
            if(reason==='source changed'){
                const changed=Vue.markRaw({...unit,fields:unit.fields.map(f=>f===field?{...f,source:'Changed source',sourceHash:ClientTextState.sourceHash('Changed source')}:f)});
                vm._ctUnitIndex.set(unit.id,changed);vm.ctUnits=Vue.markRaw(vm.ctUnits.map(u=>u.id===unit.id?changed:u));
            }else if(reason==='revoked')next={...saved,englishIntent:{...saved.englishIntent,[field.id]:{...saved.englishIntent[field.id],state:'revoked'}}};
            else if(reason==='conflict')next={...saved,conflicts:[{fieldId:field.id}]};else next={...saved,syncRecovery:{state:'rejected'}};
            vm.ctSaved=Vue.markRaw({...vm.ctSaved,[unit.id]:next});await vm.$nextTick();
            return {active:vm.ctUsesEnglish(vm.ctPreviewField),preview:vm.ctPreviewValue(vm.ctPreviewField),missing:vm.ctCounts.missing};
        },reason);
        assert.equal(await input('Name').getAttribute('placeholder'),'Translation');assert.equal(projection.active,false);assert.equal(projection.preview,'');invalid.push({reason,...projection});
        await page.evaluate(async()=>{const vm=window.__clientFixtureApp,{unit,saved}=window.__presentationRestore;vm._ctUnitIndex.set(unit.id,unit);vm.ctUnits=Vue.markRaw(vm.ctUnits.map(u=>u.id===unit.id?unit:u));vm.ctSaved=Vue.markRaw({...vm.ctSaved,[unit.id]:saved});await vm.$nextTick();});
    }
    await check('valid approval restored after projections');
    const durable=await page.evaluate(async()=>{
        const vm=window.__clientFixtureApp,store=vm._ctStore,scope=vm.ctWorkspace.scope,saved=await store.getSaved(scope),history=[],drafts=[];
        for(const unit of vm.ctUnits){history.push(...await store.listHistory(scope,unit.id));drafts.push(await store.getDraft(scope,unit.id));}
        const outbox=await store.getOutbox(scope);return {saved,placeholderLeaked:JSON.stringify([saved,history,drafts,outbox]).includes('-- Use English --'),outbox:outbox.length};
    });
    assert.equal(durable.placeholderLeaked,false);assert.equal(durable.saved[chosen.unitId].values[chosen.fieldId],'');assert.equal(durable.saved[formatted.unitId].values[formatted.fieldId],'');assert.equal(durable.outbox,0);
    const downloadEvent=page.waitForEvent('download');await page.evaluate(()=>window.__clientFixtureApp.ctDownload());const downloaded=await downloadEvent;
    const archive=await JSZip.loadAsync(readFileSync(await downloaded.path())),normalName=Object.keys(archive.files).find(name=>/\.xlsm$/i.test(name)&&!/_Gender/i.test(name));
    const output=await archive.file(normalName).async('uint8array'),parsed=await Codec.parseWorkbook(output,{filename:normalName,role:'normal',language:'French',game:'poe2'});
    for(const expected of [chosen,formatted]){
        const exported=parsed.units.find(unit=>unit.id===expected.unitId).fields.find(field=>field.id===expected.fieldId);assert.equal(exported.target,'');assert.equal(exported.source,expected.source);
    }
    const workbook=await JSZip.loadAsync(output);for(const name of Object.keys(workbook.files).filter(name=>/\.xml$/.test(name)))assert.equal((await workbook.file(name).async('string')).includes('-- Use English --'),false,'placeholder never enters workbook '+name);
    const server=content.units(accepted.group.id,'French','fixture-admin').units;assert.equal(JSON.stringify(server).includes('-- Use English --'),false);
    assert.equal(server.find(unit=>unit.id===chosen.unitId).work.values[chosen.fieldId],'');
    assert.deepEqual(failures,[]);assert.deepEqual(inference,[]);
    const report={ok:true,cases,invalid,themes,placeholder:'-- Use English --',actualWorkerIndexedDbAndHttp:true,exportedWorkbook:normalName,exportBlankFields:[chosen,formatted],durablePlaceholderLeak:false,pageErrors:failures,inference,limit:'Synthetic desktop Edge/localhost acceptance; no hosted deployment or private workbooks.'};
    writeFileSync(join(directory,'eng-presentation-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
};
