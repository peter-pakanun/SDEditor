'use strict';
// Synthetic catalog, text and media in a disposable browser profile; never the user's editor.
const assert=require('node:assert/strict');
const {readFileSync,existsSync,mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {createServer}=require('node:http');
const express=require('express');
const State=require('../public/clientTextState.js');
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
const card={id:'example',activeSkillId:'example_skill',baseItemId:'ExampleGem',title:ref('ActiveSkills','example_skill','DisplayName','Example ability'),
    itemTitle:ref('BaseItemTypes','ExampleGem','Display Name','Example gem'),description:ref('ActiveSkills','example_skill','Description','An example [Quality] description.'),
    tags:[{position:'type',ref:ref('GemTags','example_tag','Display Name','[Quality|Example type]','[Quality|Target type]')}],
    tabs:[{id:'example-mode',label:ref('GrantedEffectLabels','ExampleMode','LabelString','Example mode'),lines:[]}],
    footer:ref('ClientStrings','ExampleFooter','Text','Example footer.'),examples:{level:ref('ClientStrings','ExampleLevel','Text','Level','Target level'),
        quality:ref('ClientStrings','ExampleQuality','Text','[Quality]','[Quality|Target quality]'),cost:ref('ClientStrings','ExampleCost','Text','Cost','Target cost'),
        criticalChance:ref('ClientStrings','ExampleCritical','Text','[Critical|Critical Hit] Chance','[Critical|Target critical] Chance'),
        costFormat:ref('ClientStrings','ExampleMana','Text','{0} Mana','{0} Target mana')},assets:{id:'example',icon:true,background:true}};
for(const id of ['Quality','Critical']){ref('KeywordPopups',id,'Info Title',id+' concept','Target '+id+' concept');ref('KeywordPopups',id,'Info Content','Example explanation. '+(id==='Quality'?'[Critical]':''),'Target explanation. '+(id==='Quality'?'[Critical|Target critical]':''));}
const audioRef=ref('NPCTextAudio','ExampleAudio','Text','Example dialogue.');
units.find(u=>u.sheet==='NPCTextAudio').metadata['Audio File']='synthetic/example.wav';
const catalog={schemaVersion:1,game:'poe2',revision:'synthetic-browser-1',clientBuild:'12345',cards:[card]};
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
(async()=>{let browser;try{
    mkdirSync(folder,{recursive:true});await new Promise(done=>server.listen(0,'127.0.0.1',done));
    browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
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
    assert.equal(await page.locator('.ctSkillCard').count(),2);
    const source=page.locator('.gamePreviewSourcePane .ctSkillCard'),target=page.locator('.gamePreviewTargetPane .ctSkillCard');
    assert.deepEqual(await source.locator('dd').allTextContents(),['1','+10%','5 Mana','7.00%']);
    assert.match(await target.innerText(),/Target quality/);assert.match(await target.innerText(),/5 Target mana/);
    const input=page.getByRole('textbox',{name:'Preview example: level',exact:true});await input.fill('6');await settle(page);assert.equal(await source.locator('dd').first().innerText(),'6');
    await page.getByRole('textbox',{name:'Preview example: critical-chance',exact:true}).fill('12.5');await settle(page);assert.equal(await target.locator('dd').nth(3).innerText(),'12.50%');
    await page.getByRole('textbox',{name:'Preview example: cost',exact:true}).fill('<img src=x>');await settle(page);assert.equal(await source.locator('dd').nth(2).innerText(),'5 Mana');assert.equal(await page.locator('.gamePreviewVarInput[aria-invalid="true"]').count(),1);
    await page.getByRole('button',{name:'Reset preview examples'}).click();await settle(page);assert.deepEqual(await source.locator('dd').allTextContents(),['1','+10%','5 Mana','7.00%']);
    await page.evaluate(async()=>{fixtureApp.ctValues.Description='Current [Quality|edited description]';await fixtureApp.$nextTick();});await settle(page);
    assert.match(await target.locator('.ctSkillCardDescription').innerText(),/Current edited description/);assert.match(await source.locator('.ctSkillCardDescription').innerText(),/An example Quality description/);
    assert.equal(await page.evaluate(()=>JSON.stringify(fixtureApp.ctUnits)===fixtureUnitsBefore),true);
    await target.locator('.ctSkillCardProperties .gamePreviewKw').first().click();await page.waitForSelector('.keywordPreviewWindow');assert.match(await page.locator('.keywordPreviewWindow').innerText(),/Target Quality concept/);await page.locator('.keywordPreviewClose').click();
    for(const theme of ['light','grey','dark','modern-dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await settle(page);await page.screenshot({path:join(folder,'card-'+theme+'.png')});}
    await page.setViewportSize({width:1150,height:850});await settle(page);assert.equal(await target.isVisible(),true);
    await page.evaluate(async()=>{fixtureApp.ctUnits=Vue.markRaw(fixtureApp.ctUnits.filter(u=>u.sheet!=='GemTags'));fixtureApp._ctUnitIndex=Vue.markRaw(new Map(fixtureApp.ctUnits.map(u=>[u.id,u])));fixtureApp.ctRevision++;await fixtureApp.$nextTick();});await settle(page);assert.equal(await target.locator('.ctSkillCardPartial').count(),1);
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
    assert.deepEqual(errors,[]);writeFileSync(join(folder,'results.json'),JSON.stringify({passed:true,requests,checks:['defaults','edit','reset','validation','source-target separation','draft','no mutation','keyword popup','four themes','resized desktop','partial workbook','assembled keyword sheet before blur/full/inline/nested/language/blank/record switch','portrait and audio authenticated Blob sources','logout URL revocation']},null,2));
    console.log('Skill-card browser fixture passed: examples, drafts, themes, partial workbook, live full/inline keyword cards, authenticated native portraits/audio and logout revocation; '+requests.length+' authenticated private requests.');
}finally{await browser?.close();await new Promise(done=>{server.close(done);server.closeAllConnections();});}})().catch(error=>{console.error(error);process.exitCode=1;});
