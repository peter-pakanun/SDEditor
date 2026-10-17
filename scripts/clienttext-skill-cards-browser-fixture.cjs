'use strict';
// Synthetic catalog, text and media in a disposable browser profile; never the user's editor.
const assert=require('node:assert/strict');
const {readFileSync,existsSync,mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {createServer}=require('node:http');
const express=require('express');
const State=require('../public/clientTextState.js');
const {checkRelatedSkillFooter}=require('./related-skill-footer-browser-check.cjs');
const modules='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright',{paths:[modules]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const root=resolve(__dirname,'..'),folder=join(root,'temp/skill-card-browser'),units=[];
function ref(sheet,recordId,field,source,target){
    let unit=units.find(u=>u.sheet===sheet && u.recordId===recordId);
    if(!unit){unit={id:JSON.stringify(['normal',sheet,recordId]),role:'normal',sheet,recordId,metadata:{},fields:[]};units.push(unit);}
    unit.fields.push({id:field,name:field,kind:'text',source,target:target ?? 'Target '+source,required:true});
    return {sheet,recordId,field,source,sourceHash:State.sourceHash(source)};
}
const card={id:'example',activeSkillId:'example_skill',baseItemId:'ExampleGem',title:ref('ActiveSkills','example_skill','DisplayName','Example [Quality|ability]'),
    itemTitle:ref('BaseItemTypes','ExampleGem','Display Name','Example gem'),description:ref('ActiveSkills','example_skill','Description','An example [Quality] description.'),
    shortDescription:ref('ActiveSkills','example_skill','Short Description','A brief [Quality|ability] with [Critical|keywords].','A translated brief [Quality|ability] with [Critical|keywords].'),
    tags:[{position:'type',ref:ref('GemTags','spell','Display Name','[Quality|Example type]','[Quality|Target type]')}],
    tabs:[{id:'example-mode',label:ref('GrantedEffectLabels','ExampleMode','LabelString','Example mode'),lines:[]}],
    footer:ref('ClientStrings','ExampleFooter','Text','Example footer.'),examples:{level:ref('ClientStrings','ExampleLevel','Text','Level','Target level'),
        quality:ref('ClientStrings','ExampleQuality','Text','[Quality]','[Quality|Target quality]'),cost:ref('ClientStrings','ExampleCost','Text','Cost','Target cost'),
        criticalChance:ref('ClientStrings','ExampleCritical','Text','[Critical|Critical Hit] Chance','[Critical|Target critical] Chance'),
        costFormat:ref('ClientStrings','ExampleMana','Text','{0} Mana','{0} Target mana')},assets:{id:'example',icon:true,background:true}};
for(const [type,id] of [['Cast','CastTime'],['Attack','AttackTimeOverride'],['Use','UseTime']]){
    ref('ClientStrings','ItemDisplaySkillGem'+id,'Text',type+' Time','Target '+type+' Time');
    ref('ClientStrings','SkillPopup'+type+'Time','Text',type+' Time','Target '+type+' Time');
}
ref('ClientStrings','ItemDisplaySkillGemCastTimeValue','Text','{0}s','{0} target seconds');
ref('ClientStrings','SkillPopupCastTimeValue','Text','{0} s','{0} target s');
const attackTag=ref('GemTags','attack','Display Name','[Quality|Attack type]','[Quality|Target attack type]'),useTag=ref('GemTags','buff','Display Name','[Quality|Buff type]','[Quality|Target buff type]');
for(const id of ['Quality','Critical']){ref('KeywordPopups',id,'Info Title',id+' concept','Target '+id+' concept');ref('KeywordPopups',id,'Info Content','Example explanation. '+(id==='Quality'?'[Critical]':''),'Target explanation. '+(id==='Quality'?'[Critical|Target critical]':''));}
const audioRef=ref('NPCTextAudio','ExampleAudio','Text','Example dialogue.');
units.find(u=>u.sheet==='NPCTextAudio').metadata['Audio File']='synthetic/example.wav';
const secondCard={...card,id:'second-example',activeSkillId:'second_skill',baseItemId:'SecondGem',
    title:ref('ActiveSkills','second_skill','DisplayName','Second ability'),itemTitle:ref('BaseItemTypes','SecondGem','Display Name','Second gem'),
    description:ref('ActiveSkills','second_skill','Description','Second ability description.'),shortDescription:undefined,assets:undefined,
    tabs:[...card.tabs,{id:'other-mode',label:ref('GrantedEffectLabels','OtherMode','LabelString','Other mode'),lines:[]}]};
const catalog={schemaVersion:1,game:'poe2',revision:'synthetic-browser-1',clientBuild:'12345',cards:[card,secondCard]};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const wav=Buffer.alloc(44+882000);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(882000,40);
const requests=[],app=express(),server=createServer(app);
app.get('/index.js',(_req,res)=>res.type('js').send(readFileSync(join(root,'public/index.js'),'utf8').replace("app.mount('#app');","window.fixtureApp=app.mount('#app');")));
app.use(['/v1/skill-card-catalogs','/skill-assets','/portraits','/audio'],(req,res,next)=>{
    const authorized=req.headers.authorization==='Bearer '+'x'.repeat(43),language=req.headers['x-sdeditor-language'];
    requests.push({path:req.originalUrl,authorized,language});res.set('Cache-Control','private, no-store');
    if(!authorized || language!==undefined)return res.status(403).json({error:{message:'Private fixture access denied'}});next();
});
app.get('/v1/skill-card-catalogs/poe2/v1',(_req,res)=>res.json(catalog));
app.get('/skill-assets/poe2/example/:kind',(_req,res)=>res.type('png').send(png));
app.get('/portraits/poe2/example-person.webp',(_req,res)=>res.type('png').send(png));
app.get('/audio/poe2db',(_req,res)=>res.type('audio/wav').send(wav));
app.use(express.static(join(root,'public')));
const settle=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const plainText=locator=>locator.locator('.skillCardText>span:not(.gamePreviewKw)').first();
const navigationState=page=>page.evaluate(()=>({calls:fixtureNavigation.length,pins:fixturePins.length,selection:fixtureApp.ctSelection,language:fixtureApp.ctWorkspace.scope.language}));
async function jump(page,locator,sheet,field,alt=false){
    const before=await navigationState(page);await locator.click({modifiers:alt?['Alt']:[]});
    await page.waitForFunction(({sheet,field})=>fixtureApp.ctCurrentUnit?.sheet===sheet && document.activeElement?.dataset.ctTarget===field,{sheet,field});
    const after=await navigationState(page);assert.equal(after.calls,before.calls+1,'one navigation per click');assert.equal(after.pins,before.pins,'navigation never pins a keyword');assert.equal(after.language,'Thai');
}
(async()=>{let browser;try{
    mkdirSync(folder,{recursive:true});await new Promise(done=>server.listen(0,'127.0.0.1',done));
    browser=await chromium.launch({executablePath,headless:true,ignoreDefaultArgs:['--hide-scrollbars']});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    await page.addInitScript(()=>{window.fixtureRevoked=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{fixtureRevoked.push(url);return revoke(url);};});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error' && !message.text().includes('Failed to load resource')){errors.push(message.text());console.log('Browser:',message.text().slice(0,800));}});
    await page.route('https://**/*',route=>{const url=route.request().url();if(url.includes('vue.global'))return route.fulfill({contentType:'text/javascript',body:readFileSync(process.env.FIXTURE_VUE_PATH || join(root,'temp/clienttext-fixture-vue.min.js'))});if(url.includes('jszip.min'))return route.fulfill({contentType:'text/javascript',body:readFileSync(join(root,'../SDEditor-API/node_modules/jszip/dist/jszip.min.js'))});return route.fulfill({contentType:'text/javascript',body:''});});
    await page.goto('http://127.0.0.1:'+server.address().port+'/?testMode=1&lang=Thai');await page.waitForFunction(()=>window.fixtureApp?.startupReady);
    await page.evaluate(async units=>{
        const host=fixtureApp;host.gameVersion='poe2';await host.$nextTick();await host.$nextTick();
        host.cloudUser={id:'fixture-owner',role:'manager',language:null,canAccessAllLanguages:true};host.cloudProfileId='fixture-owner';
        const auth={epoch:1,profile:'fixture-owner',token:'x'.repeat(43),language:'Thai',assignedLanguage:null,assignmentVersion:1,role:'manager',allLanguages:true};
        const client={apiBase:location.origin,fetcher:fetch.bind(window),context:()=>({...auth}),permissionsCurrent:ctx=>host.cloudSignedIn && ctx.token===auth.token && ctx.assignmentVersion===auth.assignmentVersion,
            request:CloudSync.Client.prototype.request,refreshSession:async()=>{},sync:async()=>{}};host._cloud=Vue.markRaw(client);host.cloudSignedIn=true;
        await host.$nextTick();await host.$nextTick();
        const scope={accountId:'fixture-owner',game:'poe2',language:'Thai',branchId:'default',groupId:'local:test:skill-card',versionId:'local:test:skill-card'};
        const store=ClientTextMemoryStore.create();await store.import(scope,{units,assets:[{role:'normal',name:'Thai.xlsx',hash:'a'.repeat(64),blob:new Blob(['synthetic original'])}]});host.ctWorkspace={metadata:{},scope};host._ctTestStores=new Map([[scope.groupId,store]]);
        host.ctUnits=Vue.markRaw(units);host._ctUnitIndex=Vue.markRaw(new Map(units.map(u=>[u.id,u])));host.ctSaved=Vue.markRaw({});
        const unit=units.find(u=>u.sheet==='ActiveSkills');host.ctSelection=unit.id;host.ctFocusedField='Description';host.ctValues=ClientTextState.valuesFor(unit);host.ctSheet=JSON.stringify(['normal','ActiveSkills']);host.ctTool='preview';host.inlineEditor=true;host.ctEditor=true;host.versionChooserVisible=false;host.showSetting=false;
        host.ctActive=true;host.ctRevision++;
        window.fixtureUnitsBefore=JSON.stringify(units);await host.$nextTick();
    },units);
    try{await page.waitForSelector('.ctSkillCard');}catch(error){console.log('Fixture state',JSON.stringify(await page.evaluate(()=>({active:fixtureApp.ctActive,workspace:fixtureApp.ctWorkspace,signedIn:fixtureApp.cloudSignedIn,allowed:fixtureApp.privateMediaAllowed,catalog:!!fixtureApp.ctSkillCatalog,scope:fixtureApp.ctSkillContextKey,model:fixtureApp.ctSkillBaseModel,selection:fixtureApp.ctSelection,fields:fixtureApp.ctPreviewField?.name}))),errors,requests);throw error;}await page.waitForFunction(()=>fixtureApp.ctSkillImages.icon?.startsWith('blob:'));
    assert.equal(await page.locator('.ctSkillCard').count(),4);
    const source=page.locator('.gamePreviewSourcePane .ctSkillFullCard'),target=page.locator('.gamePreviewTargetPane .ctSkillFullCard');
    const shortSource=page.locator('.gamePreviewSourcePane .ctSkillShortCard'),shortTarget=page.locator('.gamePreviewTargetPane .ctSkillShortCard');
    assert.equal(await page.locator('.skillCardEdit').count(),0,'no trailing edit controls');
    assert.equal(await source.locator('.skillCardClickEditable').count(),2,'only name and description use ordinary click');
    assert.deepEqual(await source.locator('dd').allTextContents(),['1','+10%','5 Mana','7.00%','1.00s']);
    assert.equal(await source.locator('dt').last().innerText(),'Cast Time:');assert.equal(await shortSource.locator('dt').last().innerText(),'Cast Time');
    assert.match(await target.innerText(),/Target quality/);assert.match(await target.innerText(),/5 Target mana/);
    const input=page.getByRole('textbox',{name:'Preview example: level',exact:true});await input.fill('6');await settle(page);assert.equal(await source.locator('dd').first().innerText(),'6');
    await page.getByRole('textbox',{name:'Preview example: critical-chance',exact:true}).fill('12.5');await settle(page);assert.equal(await target.locator('dd').nth(3).innerText(),'12.50%');
    await page.getByRole('textbox',{name:'Preview example: cost',exact:true}).fill('<img src=x>');await settle(page);assert.equal(await source.locator('dd').nth(2).innerText(),'5 Mana');assert.equal(await page.locator('.gamePreviewVarInput[aria-invalid="true"]').count(),1);
    await page.getByRole('textbox',{name:'Preview example: cost',exact:true}).fill('19');await settle(page);
    assert.equal(await shortSource.locator('dd').first().innerText(),'19 Mana');assert.equal(await shortTarget.locator('dd').first().innerText(),'19 Target mana');
    await page.getByRole('textbox',{name:'Preview example: time',exact:true}).fill('1.3');await settle(page);
    assert.equal(await source.locator('dd').last().innerText(),'1.30s');assert.equal(await shortSource.locator('dd').last().innerText(),'1.30 s');
    assert.equal(await target.locator('dd').last().innerText(),'1.30 target seconds');assert.equal(await shortTarget.locator('dd').last().innerText(),'1.30 target s');
    await page.getByRole('button',{name:'Reset preview examples'}).click();await settle(page);assert.deepEqual(await source.locator('dd').allTextContents(),['1','+10%','5 Mana','7.00%','1.00s']);
    await page.evaluate(async()=>{fixtureApp.ctValues.Description='Current [Quality|edited description]';await fixtureApp.$nextTick();});await settle(page);
    assert.match(await target.locator('.ctSkillCardDescription').innerText(),/Current edited description/);assert.match(await source.locator('.ctSkillCardDescription').innerText(),/An example Quality description/);
    assert.equal(await page.evaluate(()=>JSON.stringify(fixtureApp.ctUnits)===fixtureUnitsBefore),true);
    await page.evaluate(()=>{window.fixtureTimingUnits=fixtureApp.ctUnits;});
    for(const [recordId,affected] of [['ItemDisplaySkillGemCastTime','full'],['ItemDisplaySkillGemCastTimeValue','full'],['SkillPopupCastTime','short'],['SkillPopupCastTimeValue','short']]){
        for(const blank of [false,true]){
            await page.evaluate(async({recordId,blank})=>{const host=fixtureApp,units=JSON.parse(JSON.stringify(fixtureTimingUnits));
                if(blank)units.find(unit=>unit.recordId===recordId).fields[0].target='';else units.splice(units.findIndex(unit=>unit.recordId===recordId),1);
                host.ctUnits=Vue.markRaw(units);host._ctUnitIndex=Vue.markRaw(new Map(units.map(unit=>[unit.id,unit])));host.ctRevision++;await host.$nextTick();},{recordId,blank});await settle(page);
            const missing=affected==='full'?target:shortTarget,retained=affected==='full'?shortTarget:target;
            assert.doesNotMatch(await missing.locator('dt').allTextContents().then(labels=>labels.join('|')),/Target Cast Time/);
            assert.match(await retained.locator('dt').allTextContents().then(labels=>labels.join('|')),/Target Cast Time/,'the other card retains its independently valid timing');
            assert.equal(await page.getByRole('textbox',{name:'Preview example: time',exact:true}).count(),1,'partial bindings keep one duration control');
        }
    }
    await page.evaluate(async()=>{const host=fixtureApp;host.ctUnits=fixtureTimingUnits;host._ctUnitIndex=Vue.markRaw(new Map(host.ctUnits.map(unit=>[unit.id,unit])));host.ctRevision++;await host.$nextTick();});await settle(page);
    await target.locator('.ctSkillCardProperties .gamePreviewKw').first().click();await page.waitForSelector('.keywordPreviewWindow');assert.match(await page.locator('.keywordPreviewWindow').innerText(),/Target Quality concept/);await page.locator('.keywordPreviewClose').click();
    assert.equal(await page.evaluate(()=>fixtureApp.ctCurrentUnit.recordId),'example_skill','keyword actions never navigate fields');
    await page.evaluate(()=>{const host=fixtureApp,navigate=host.ctSkillEditField,pin=host.pinKeywordWindow;window.fixtureNavigation=[];window.fixturePins=[];
        host.ctSkillEditField=(...args)=>{fixtureNavigation.push(args[0].reference);return navigate(...args);};host.pinKeywordWindow=item=>{fixturePins.push(item.id);return pin(item);};});
    await jump(page,plainText(shortTarget.locator('.ctSkillShortDescription')),'ActiveSkills','Short Description');
    const shortInput=page.locator('textarea[data-ct-target="Short Description"]:visible');
    await shortInput.fill('Live brief [Quality|nested keyword]');await settle(page);
    assert.equal(await shortInput.evaluate(node=>node===document.activeElement),true,'short card updates before blur');
    assert.equal(await shortTarget.locator('.ctSkillShortDescription').innerText(),'Live brief nested keyword');
    assert.equal(await shortSource.locator('.ctSkillShortDescription').innerText(),'A brief ability with keywords.');
    assert.equal(await page.locator('.ctSkillFullCard').count(),2,'selecting Short Description keeps the full preview');
    for(const [card,language] of [[shortSource,'English'],[shortTarget,'Thai']]){
        const keyword=card.locator('.ctSkillShortDescription .gamePreviewKw').first(),before=await navigationState(page);
        await keyword.hover();await settle(page);assert.equal(await page.locator('[data-keyword-window]').getAttribute('data-language'),language);
        await keyword.click();await settle(page);assert.equal((await navigationState(page)).pins,before.pins+1);assert.equal((await navigationState(page)).calls,before.calls);
        await page.locator('[data-keyword-window] .keywordPreviewContent .gamePreviewKw').click();await settle(page);
        assert.equal(await page.locator('[data-keyword-window]').last().getAttribute('data-language'),language);
        assert.match(await page.locator('[data-keyword-window]').last().innerText(),/Critical concept/);await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    }
    await jump(page,shortTarget.locator('.ctSkillShortDescription .gamePreviewKw'),'ActiveSkills','Short Description',true);
    await shortInput.fill('');await settle(page);assert.equal(await shortTarget.locator('.ctSkillShortDescription').innerText(),'(empty)');
    assert.equal(await shortSource.locator('.ctSkillShortDescription').innerText(),'A brief ability with keywords.');
    await shortInput.fill('Live brief [Quality|nested keyword]');
    await jump(page,plainText(shortSource.locator('h3')),'ActiveSkills','DisplayName');
    const beforeCost=await navigationState(page);await plainText(shortTarget.locator('dt').first()).click();assert.deepEqual(await navigationState(page),beforeCost);
    await jump(page,plainText(shortTarget.locator('dt').first()),'ClientStrings','Text',true);
    assert.equal(await page.evaluate(()=>fixtureApp.ctCurrentUnit.recordId),'ExampleCost');
    await page.waitForFunction(()=>fixtureApp.ctSkillPreviewModel?.target.shortDescription.text.startsWith('Live brief'));
    await jump(page,plainText(shortTarget.locator('.ctSkillShortDescription')),'ActiveSkills','Short Description');
    assert.equal(await shortInput.inputValue(),'Live brief [Quality|nested keyword]','cross-sheet round trip preserves short draft');
    await page.evaluate(async()=>{const host=fixtureApp,unit=host.ctUnits.find(u=>u.sheet==='BaseItemTypes' && u.recordId==='ExampleGem');await host.ctSelect(unit,true,{focus:false});host.ctTool='preview';await host.$nextTick();});await settle(page);
    assert.equal(await source.locator('h3').innerText(),'Example gem');assert.equal(await shortSource.locator('h3').innerText(),'Example ability');
    await jump(page,plainText(shortTarget.locator('h3')),'ActiveSkills','DisplayName');
    for(const [tag,type] of [[attackTag,'Attack'],[useTag,'Use'],[card.tags[0].ref,'Cast']]){
        await page.evaluate(async tag=>{const host=fixtureApp,catalog=JSON.parse(JSON.stringify(host.ctSkillCatalog));catalog.cards.find(card=>card.id==='example').tags[0].ref=tag;host.ctSkillCatalog=Vue.markRaw(catalog);await host.$nextTick();},tag);await settle(page);
        assert.equal(await source.locator('dt').last().innerText(),type+' Time:');assert.equal(await shortSource.locator('dt').last().innerText(),type+' Time');
        assert.equal(await target.locator('dt').last().innerText(),'Target '+type+' Time:');assert.equal(await shortTarget.locator('dt').last().innerText(),'Target '+type+' Time');
    }
    await jump(page,plainText(shortTarget.locator('dt').last()),'ClientStrings','Text',true);
    assert.equal(await page.evaluate(()=>fixtureApp.ctCurrentUnit.recordId),'SkillPopupCastTime');
    await page.locator('textarea[data-ct-target="Text"]:visible').fill('Live cast label');await settle(page);
    assert.equal(await shortTarget.locator('dt').last().innerText(),'Live cast label');assert.equal(await shortSource.locator('dt').last().innerText(),'Cast Time');
    await jump(page,plainText(shortTarget.locator('h3')),'ActiveSkills','DisplayName');
    await page.locator('textarea[data-ct-target="Description"]:visible').fill('Unsaved navigation [Quality|draft]');
    await jump(page,plainText(source.locator('h3')),'ActiveSkills','DisplayName');
    await jump(page,plainText(target.locator('.ctSkillCardDescription')),'ActiveSkills','Description');
    for(const [keyword,language] of [[source.locator('h3 .gamePreviewKw'),'English'],[target.locator('.ctSkillCardDescription .gamePreviewKw'),'Thai']]){
        const before=await navigationState(page);await keyword.hover();await settle(page);assert.equal(await page.locator('[data-keyword-window]').getAttribute('data-language'),language);
        await keyword.click();await settle(page);const after=await navigationState(page);assert.equal(after.calls,before.calls);assert.equal(after.pins,before.pins+1);await page.locator('.keywordPreviewClose').click();
    }
    await jump(page,plainText(source.locator('h3')),'ActiveSkills','DisplayName',true);
    await jump(page,target.locator('.ctSkillCardDescription .gamePreviewKw'),'ActiveSkills','Description',true);
    await jump(page,source.locator('h3 .gamePreviewKw'),'ActiveSkills','DisplayName',true);
    for(const locator of [plainText(source.locator('footer')),plainText(target.locator('dt').first()),target.getByRole('tab').first()]){
        const before=await navigationState(page);await locator.click();await settle(page);assert.deepEqual(await navigationState(page),before,'other mapped text does not navigate on plain click');
    }
    const unmapped=target.locator('dd .skillCardText').first(),beforeUnmapped=await navigationState(page);assert.equal(await unmapped.getAttribute('title'),null);await unmapped.click({modifiers:['Alt']});assert.deepEqual(await navigationState(page),beforeUnmapped,'generated sample values are not mapped workbook text');
    await jump(page,plainText(source.locator('footer')),'ClientStrings','Text',true);assert.equal(await page.evaluate(()=>fixtureApp.ctCurrentUnit.recordId),'ExampleFooter');
    await jump(page,plainText(target.locator('dt').first()),'ClientStrings','Text',true);assert.equal(await page.evaluate(()=>fixtureApp.ctCurrentUnit.recordId),'ExampleLevel');
    await jump(page,target.locator('.ctSkillCardProperties .gamePreviewKw').first(),'ClientStrings','Text',true);assert.equal(await page.evaluate(()=>fixtureApp.ctCurrentUnit.recordId),'ExampleQuality');
    await jump(page,source.locator('.ctSkillCardType .gamePreviewKw'),'GemTags','Display Name',true);
    assert.equal(await page.locator('.ctSkillRelatedChoice select').inputValue(),'example','shared tag retains the explicit originating skill');
    await page.waitForFunction(()=>fixtureApp.ctSkillPreviewModel?.target.description.text.includes('Unsaved navigation'));
    assert.match(await target.locator('.ctSkillCardDescription').innerText(),/Unsaved navigation draft/,'related-row preview preserves checkpointed unsaved draft');
    await checkRelatedSkillFooter(page,folder);
    await page.locator('.ctSkillRelatedChoice select').selectOption('second-example');await page.waitForFunction(()=>fixtureApp.ctSkillPreviewModel?.skillId==='second-example');assert.match(await target.locator('h3').innerText(),/Second ability/);
    assert.equal(await page.locator('.ctSkillShortCard').count(),0,'an absent short field hides the compact card in both languages');
    const otherMode=target.getByRole('tab',{name:'Target Other mode'}),beforeTab=await navigationState(page);await otherMode.click();assert.equal(await otherMode.getAttribute('aria-selected'),'true');assert.deepEqual(await navigationState(page),beforeTab,'plain tabs select mode without changing workbook row');
    await jump(page,otherMode.locator('.skillCardText'),'GrantedEffectLabels','LabelString',true);assert.equal(await page.evaluate(()=>fixtureApp.ctCurrentUnit.recordId),'OtherMode');
    await jump(page,plainText(target.locator('.ctSkillCardDescription')),'ActiveSkills','Description');assert.equal(await page.evaluate(()=>fixtureApp.ctCurrentUnit.recordId),'second_skill');
    await page.evaluate(async()=>{const host=fixtureApp,unit=host.ctUnits.find(u=>u.sheet==='ActiveSkills' && u.recordId==='example_skill');await host.ctSelect(unit,true,{focus:false});host.ctTool='preview';await host.$nextTick();});await page.waitForFunction(()=>fixtureApp.ctSkillPreviewModel?.skillId==='example');
    assert.match(await page.locator('textarea[data-ct-target="Description"]:visible').inputValue(),/Unsaved navigation/,'returning restores the same durable unsaved draft');
    assert.equal(await page.locator('.ctSkillRelatedChoice').count(),0,'a row without multiple related skills has no footer');
    assert.equal(await page.locator('.relatedSkillPreviewActive').count(),0,'single-skill rows do not enable the footer scrolling layout');
    const layout=[];
    for(const theme of ['light','grey','dark','modern-dark']){
        await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;for(const pane of document.querySelectorAll('.gamePreviewSourcePane,.gamePreviewTargetPane'))pane.scrollTop=0;},theme);await page.mouse.move(0,0);await settle(page);
        const measure=()=>source.evaluate(node=>[node,...node.querySelectorAll('h3,.ctSkillCardType,.ctSkillCardProperties,.ctSkillCardDescription,footer')].map(element=>{const rect=element.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};}));
        const before=await measure();await plainText(source.locator('h3')).hover();await settle(page);assert.deepEqual(await measure(),before,'hover hint preserves all card geometry');
        assert.match(await source.locator('h3 .skillCardText').getAttribute('title'),/Click or Alt\+Click.*DisplayName.*Thai/);assert.match(await source.locator('footer .skillCardText').getAttribute('title'),/^Alt\+Click/);
        assert.equal(await page.locator('.skillCardEdit').count(),0);layout.push({theme,rects:before});await page.screenshot({path:join(folder,'card-'+theme+'.png')});
        for(const card of [shortSource,shortTarget])await card.scrollIntoViewIfNeeded();await settle(page);
        const shortLayout=await shortTarget.evaluate(node=>{const pane=node.closest('.gamePreviewTargetPane'),card=node.getBoundingClientRect(),full=pane.querySelector('.ctSkillFullCard').getBoundingClientRect(),frame=pane.getBoundingClientRect();return {clearance:frame.left+pane.clientLeft+pane.clientWidth-card.right,gap:card.top-full.bottom,horizontalOverflow:pane.scrollWidth-pane.clientWidth};});
        assert.ok(shortLayout.clearance>=5.9,'card frame stays clear of the scrollbar: '+JSON.stringify(shortLayout));assert.ok(shortLayout.gap>=11.9,'short preview is a separate card below the full one');assert.equal(shortLayout.horizontalOverflow,0);
        layout.at(-1).short=shortLayout;await page.screenshot({path:join(folder,'short-card-'+theme+'.png')});
    }
    writeFileSync(join(folder,'navigation-layout.json'),JSON.stringify(layout,null,2));
    await page.evaluate(async()=>{fixtureApp.hideSourceInPreviewPanel=true;await fixtureApp.$nextTick();});await settle(page);await shortTarget.scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.gamePreviewSourcePane').count(),0);
    assert.equal(await shortTarget.evaluate(node=>{const heading=node.querySelector('header'),title=heading.querySelector('h3').getBoundingClientRect(),properties=heading.querySelector('dl').getBoundingClientRect();return properties.left>=title.right && properties.top<title.bottom;}),true,'wide compact header keeps the timing columns to the right of the name');
    await shortTarget.screenshot({path:join(folder,'short-card-wide.png')});
    await page.evaluate(async()=>{fixtureApp.hideSourceInPreviewPanel=false;await fixtureApp.$nextTick();});await settle(page);
    await page.evaluate(async()=>{fixtureApp.ctEditor=false;fixtureApp.ctInlineClosed=false;await fixtureApp.$nextTick();});await settle(page);assert.equal(await page.locator('#inlineEditorPreviewHost .ctSkillCard').count(),4);
    assert.equal(await page.locator('.ctSkillRelatedChoice,.relatedSkillPreviewActive').count(),0);
    assert.equal(await page.locator('.sharedEditorSidebar').evaluate(node=>getComputedStyle(node).overflowY),'auto','without the selector the inline sidebar keeps its ordinary scroll owner');
    assert.equal(await page.locator('.gamePreviewMainRow').evaluate(node=>getComputedStyle(node).overflowY),'visible','without the selector preview content does not gain a nested scroll trap');
    await jump(page,source.locator('.ctSkillCardType .gamePreviewKw'),'GemTags','Display Name',true);assert.equal(await page.evaluate(()=>fixtureApp.ctEditor),false);
    await jump(page,plainText(target.locator('.ctSkillCardDescription')),'ActiveSkills','Description');assert.match(await page.locator('textarea[data-ct-target="Description"]:visible').inputValue(),/Unsaved navigation/);
    await page.evaluate(async()=>{fixtureApp.ctEditor=true;await fixtureApp.$nextTick();});await settle(page);
    await page.setViewportSize({width:1150,height:850});await settle(page);assert.equal(await target.isVisible(),true);await shortTarget.scrollIntoViewIfNeeded();
    assert.equal(await shortTarget.evaluate(node=>node.scrollWidth-node.clientWidth),0);await page.screenshot({path:join(folder,'short-card-resized.png')});
    await page.evaluate(async()=>{fixtureApp.ctUnits=Vue.markRaw(fixtureApp.ctUnits.filter(u=>u.sheet!=='GemTags'));fixtureApp._ctUnitIndex=Vue.markRaw(new Map(fixtureApp.ctUnits.map(u=>[u.id,u])));fixtureApp.ctRevision++;await fixtureApp.$nextTick();});await settle(page);assert.equal(await target.locator('.ctSkillCardPartial').count(),1);
    const unavailable=source.locator('.ctSkillCardType .skillCardText'),beforeUnavailable=await navigationState(page);assert.equal(await unavailable.getAttribute('title'),null);await unavailable.locator('.gamePreviewKw').click({modifiers:['Alt']});await settle(page);assert.deepEqual(await navigationState(page),beforeUnavailable,'unavailable mapped text neither navigates nor pins a popup');
    const navigation=await navigationState(page);
    // The KeywordPopups sheet assembles the same Card used by floating popups.
    await page.evaluate(async()=>{const host=fixtureApp,unit=host.ctUnits.find(u=>u.sheet==='KeywordPopups' && u.recordId==='Quality');clearTimeout(host._ctDraftTimer);host.ctReviewed={};host.ctDraftDirty=false;host._ctDraftRevision=null;host.ctDraftStageFailure=null;host.ctSelection=unit.id;host.ctSheet=JSON.stringify(['normal','KeywordPopups']);host.ctFocusedField='Info Title';host.ctValues=ClientTextState.valuesFor(unit);host.ctRevision++;await host.$nextTick();});await settle(page);
    const keywordSource=page.locator('.gamePreviewSourcePane .keywordSheetPreview'),keywordTarget=page.locator('.gamePreviewTargetPane .keywordSheetPreview'),windows=page.locator('[data-keyword-window]');
    assert.equal(await keywordSource.locator('.keywordPreviewTitle').innerText(),'Quality concept');assert.equal(await keywordTarget.locator('.keywordPreviewTitle').innerText(),'Target Quality concept');
    const titleInput=page.locator('textarea[data-ct-target="Info Title"]:visible');await titleInput.fill('Live [Critical|title]');await settle(page);
    assert.equal(await titleInput.evaluate(node=>node===document.activeElement),true,'assembled card updates before blur');assert.equal(await keywordTarget.locator('.keywordPreviewTitle').innerText(),'Live title');assert.match(await keywordTarget.locator('.keywordPreviewContent').innerText(),/Target explanation/);
    const bodyInput=page.locator('textarea[data-ct-target="Info Content"]:visible');await bodyInput.fill('Live body [Critical|nested]');await settle(page);assert.equal(await keywordTarget.locator('.keywordPreviewContent').innerText(),'Live body nested');assert.match(await keywordSource.locator('.keywordPreviewContent').innerText(),/Example explanation/);
    await keywordTarget.locator('.keywordPreviewContent .gamePreviewKw').click();await settle(page);assert.equal(await windows.locator('.keywordPreviewTitle').innerText(),'Target Critical concept');assert.equal(await windows.getAttribute('data-language'),'Thai');await windows.locator('.keywordPreviewClose').click();
    await keywordSource.locator('.keywordPreviewContent .gamePreviewKw').focus();await page.keyboard.press('Enter');await settle(page);assert.equal(await windows.locator('.keywordPreviewTitle').innerText(),'Critical concept');assert.equal(await windows.getAttribute('data-language'),'English');await page.keyboard.press('Escape');
    await page.evaluate(async()=>{fixtureApp.ctEditor=false;fixtureApp.ctInlineClosed=false;fixtureApp.ctSelectedFilters=['missing','outdated','revised','saved','unchanged'];await fixtureApp.$nextTick();});await settle(page);
    assert.equal(await page.locator('#inlineEditorPreviewHost .keywordSheetPreview').count(),2);await page.locator('textarea[data-ct-target="Info Title"]:visible').fill('Inline live title');await settle(page);assert.equal(await keywordTarget.locator('.keywordPreviewTitle').innerText(),'Inline live title');
    await page.evaluate(async()=>{const host=fixtureApp,unit=host.ctUnits.find(u=>u.sheet==='KeywordPopups' && u.recordId==='Critical');clearTimeout(host._ctDraftTimer);host.ctReviewed={};host.ctDraftDirty=false;host._ctDraftRevision=null;host.ctDraftStageFailure=null;host.ctSelection=unit.id;host.ctFocusedField='Info Content';host.ctValues=ClientTextState.valuesFor(unit);host.ctRevision++;await host.$nextTick();});await settle(page);assert.equal(await keywordTarget.locator('.keywordPreviewTitle').innerText(),'Target Critical concept');assert.doesNotMatch(await keywordTarget.innerText(),/Inline live title/);
    await page.evaluate(async()=>{fixtureApp.ctValues['Info Content']='';await fixtureApp.$nextTick();});await settle(page);assert.match(await keywordTarget.innerText(),/Missing Thai translation/);assert.doesNotMatch(await keywordTarget.innerText(),/Example explanation/);
    assert.equal(await page.evaluate(()=>fixtureApp.ctError),'');await page.screenshot({path:join(folder,'keyword-sheet-inline.png')});
    await page.evaluate(async()=>{const host=fixtureApp,unit=host.ctUnits.find(u=>u.sheet==='NPCTextAudio');host.ctRowPortraits=()=>[{key:'example-person',id:'example-person',game:'poe2',name:'Example person',relation:'NPC',paths:['Synthetic/NPC']}];clearTimeout(host._ctDraftTimer);host.ctReviewed={};host.ctDraftDirty=false;host._ctDraftRevision=null;host.ctDraftStageFailure=null;host.ctSelection=unit.id;host.ctSheet=JSON.stringify(['normal','NPCTextAudio']);host.ctFocusedField='Text';host.ctValues=ClientTextState.valuesFor(unit);host.ctEditor=true;host.ctRevision++;await host.$nextTick();});await settle(page);
    const portrait=page.locator('.ctPortrait img:visible').first();await page.waitForFunction(()=>document.querySelector('.ctPortrait img')?.src.startsWith('blob:'));const portraitUrl=await portrait.getAttribute('src');
    await page.locator('.ctAudioTrack:visible').first().click();await page.waitForFunction(()=>document.querySelector('audio')?.src.startsWith('blob:'));const audioUrl=await page.locator('audio').getAttribute('src');assert.match(audioUrl,/^blob:/);assert.ok(requests.some(request=>request.path.startsWith('/audio/poe2db?path=')));assert.ok(requests.some(request=>request.path.startsWith('/portraits/')));
    await page.evaluate(async()=>{fixtureApp.cloudSignedIn=false;await fixtureApp.$nextTick();});await settle(page);assert.equal(await page.locator('.ctSkillCard').count(),0);assert.equal(await page.locator('.gamePreviewWindow').count(),2);
    assert.equal(await page.locator('.ctPortrait img').count(),0);assert.equal(await page.locator('audio').count(),0);assert.equal(await page.evaluate(urls=>urls.every(url=>fixtureRevoked.includes(url)),[portraitUrl,audioUrl]),true,'logout revokes both native-media Blob URLs');
    assert.ok(requests.length>=3);assert.ok(requests.every(r=>r.authorized && r.language===undefined && !r.path.includes('xxxxxxxx')));
    assert.deepEqual(errors,[]);writeFileSync(join(folder,'results.json'),JSON.stringify({passed:true,requests,navigation,checks:['defaults','edit','reset','validation','source-target separation','draft','no mutation','keyword popup','plain full/short name/description clicks','short description live before blur, blanks, related drafts and absent fields','first-tag Spell/Attack/otherwise Use timing in both cards, live labels and shared duration','Alt+Click all mapped categories and nested keywords exactly once without pinning','other plain clicks and unmapped values do not navigate','cross-sheet drafts and selected language/full/inline','no trailing controls or hover layout changes in four themes','visible scrollbar clearance and separate short-card frames','wide header and resized desktop','partial workbook and unavailable destination','assembled keyword sheet before blur/full/inline/nested/language/blank/record switch','portrait and audio authenticated Blob sources','logout URL revocation']},null,2));
    console.log('Skill-card browser fixture passed: click/Alt+Click navigation, keyword precedence, preserved drafts/language, full/inline cards, stable layout in four themes, unavailable targets, examples and authenticated media; '+requests.length+' authenticated private requests.');
}finally{await browser?.close();await new Promise(done=>{server.close(done);server.closeAllConnections();});}})().catch(error=>{console.error(error);process.exitCode=1;});
