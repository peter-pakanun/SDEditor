'use strict';
// Synthetic, loopback-only MTL acceptance fixture. No OAuth, API or provider calls.
const assert=require('node:assert/strict');
const {readFileSync,existsSync,mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {createServer}=require('node:http');
const {randomUUID}=require('node:crypto');
const express=require('express');
const JSZip=require('../../SDEditor-API/node_modules/jszip');
const Codec=require('../public/clientTextCodec.js'),State=require('../public/clientTextState.js');
const runtimeModules='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||require.resolve('playwright',{paths:[runtimeModules]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH||[
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const rootDir=join(__dirname,'..'),publicDir=join(rootDir,'public'),outDir=join(rootDir,'temp/clienttext-mtl-fixture');
const vueScriptPath=process.env.FIXTURE_VUE_PATH||join(rootDir,'temp/clienttext-fixture-vue.min.js');
if(!executablePath||!existsSync(vueScriptPath))throw new Error('Use an installed Edge/Chrome and the cached synthetic-fixture Vue runtime.');
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const xml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const cell=(ref,value)=>`<c r="${ref}" s="0" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
async function workbook(){
    const zip=new JSZip();
    zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
    zip.file('xl/workbook.xml',`<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ClientStrings" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${NS}"><sheetData><row r="1">${cell('A1','ID')+cell('B1','Text')+cell('C1','Translation')}</row><row r="2">${cell('A2','SyntheticMtlField')+cell('B2','Hello {0}')+cell('C2','Confirmed {0}')}</row></sheetData></worksheet>`);
    zip.file('xl/styles.xml',`<styleSheet xmlns="${NS}"><fonts count="1"><font><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
    return zip.generateAsync({type:'uint8array'});
}
async function run(){
    mkdirSync(outDir,{recursive:true});
    const bytes=await workbook(),parsed=await Codec.parseWorkbook(bytes,{filename:'Thai.xlsx',role:'normal'});
    const described=await State.buildDescriptors(parsed.units,[{role:'normal',hash:parsed.artifactHash,parserVersion:parsed.parserVersion}]);
    const seed=JSON.stringify({bytes:Array.from(bytes),parsed,descriptors:described.descriptors});
    const html=readFileSync(join(publicDir,'index.html'),'utf8');
    const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"/:]+\.css)"[^>]*>/g)].map(match=>match[0].replace('href="','href="/')).join('\n');
    const scripts=['workspaceState.js','dictionaryScope.js','regexEngine.js','translationDiagnostics.js','translationMemory.js',
        'normalizedStore.js','normalizedRooms.js','offlineStore.js','clientTextState.js','contentAdapters.js','clientTextStore.js',
        'clientTextMtlState.js','clientTextMtlStore.js','clientTextMtlMemoryStore.js','clientTextMtlSync.js','clientTextMemoryStore.js',
        'vendor/fast-xml-parser-5.11.2.min.js','clientTextCodec.js','editorComponents.js','clientTextFormatting.js','clientTextComparisons.js',
        'clientTextExportProgress.js','clientTextMtlContext.js','clientTextMtlUi.js','clientTextMtlDebug.js','clientTextUi.js','editorSession.js'];
    const fixture=String.raw`(async()=>{
const seed=${seed},ct=ClientTextUI.mixin,mtl=ClientTextMtlUI.mixin,debug=ClientTextMtlDebug.mixin;
let app;
const options={
 data(){return{...ct.data(),...mtl.data(),...debug.data(),fixtureMode:'memory',lang:'Thai',gameVersion:'poe2',branchId:'default',cloudSignedIn:true,
 cloudProfileId:'synthetic-tester',cloudUser:{id:'synthetic-tester',role:'translator',language:'Thai',assignmentVersion:1},cloudCanAccessAllLanguages:false,
 managedCatalogScope:'synthetic-scope',mtlConsentVersion:'mtl-v1',mtlShortcut:'f8',ctMtlCapabilities:{enabled:true},inlineEditor:true,
 translationEditorBcp47:'th',dictionary:[],mapClientTextClassNames:true,autocompleteShortcut:'ctrl-space',ctEditor:false};},
 computed:{...ct.computed,...mtl.computed,...debug.computed},watch:{...debug.watch},
 methods:{...ct.methods,...mtl.methods,...debug.methods,
  ctKeyboardOverlayOpen(){return false;},ctInlineUnitVisible(){return this.ctActive&&!this.ctEditor&&!this.ctInlineClosed;},ctCloseCompletion(){this.ctCompletion=null;},
  scheduleClientTextDictionaryMatches(){},ctRefreshDiagnostics(){},ctRefreshDraftSummaries(){},ctLoadHistory(){},ctPresence(){},
  ctRefreshLayout(){},ctFocusRow(){},ctSync(){},ctMtlSync(){},ctClearDraftStageFailure(){},ctRememberDraftStageFailure(){},
  ctDictionaryTarget(id=this.ctFocusedField){return [...document.querySelectorAll('[data-ct-target]')].find(input=>input.dataset.ctTarget===id);},
  ctEditorElement(){return document.querySelector('#fixture-editor');},appConfirm:async()=>true,
  async configure(mode){
   clearTimeout(this._ctDraftTimer);this.ctMtlReset();this._fixtureStore?.dispose?.();
   this.fixtureMode=mode;this.ctActive=false;this.ctBusy=false;this.ctError='';this.ctValues={};this.ctReviewed={};this.ctSaved=Vue.markRaw({});
   this.ctDraftDirty=false;this.ctDraftStageFailure=null;this._ctDraftHeads=new Map();this._ctDraftRevision=null;this._ctEditRevision=0;
   this._ctSaveJob=null;this._ctEpoch=(this._ctEpoch||0)+1;this._ctSelectRun={};this.ctVariantSelections={};
   const groupId=(mode==='memory'?'local:test:':'online:')+crypto.randomUUID();
   const scope={accountId:'synthetic-tester',game:'poe2',branchId:'default',versionId:'synthetic-version',groupId,language:'Thai'};
   this._fixtureStore=mode==='memory'?Vue.markRaw(ClientTextMemoryStore.create()):Vue.markRaw(ClientTextStore.create());
   if(mode==='idb')this._fixtureStore.mtl=Vue.markRaw(ClientTextMtlStore.create());
   const bytes=new Uint8Array(seed.bytes),asset={role:'normal',hash:seed.parsed.artifactHash,parserVersion:seed.parsed.parserVersion,
       name:'Thai.xlsx',blob:new Blob([bytes]),parsed:seed.parsed};
   await this._fixtureStore.import(scope,{units:seed.parsed.units,assets:[asset],descriptors:seed.descriptors,metadata:{}});
   const units=await this._fixtureStore.getUnits(scope);
   this.ctWorkspace={scope,metadata:{descriptors:seed.descriptors}};this.ctUnits=Vue.markRaw(units);this._ctUnitIndex=Vue.markRaw(new Map(units.map(unit=>[unit.id,unit])));
   this.ctSelection=units[0].id;this.ctValues=ClientTextState.valuesFor(units[0]);this.ctFocusedField=units[0].fields[0].id;
   this.ctActive=true;this.ctEditor=false;this.ctMtlCapabilities={enabled:true};this._ctMtlDescriptors=Vue.markRaw(seed.descriptors);
   this._fixtureJobs=new Map();this._fixtureReleases=[];this._fixtureDefer=false;
   this._cloud=Vue.markRaw({request:async(path,init={})=>{
    if(path==='/v1/mtl/capabilities')return{enabled:true};
    if(path.startsWith('/v1/admin/mtl/requests/'))return{diagnostics:{providerRequest:{model:'synthetic-connection-config',instructions:'Synthetic executed prompt <img src=x onerror="window.__debugXss=true">',input:[{role:'user',content:'Synthetic context'}]},context:{accessToken:'synthetic-secret'},upstreamResponse:{contentType:'text/event-stream; charset=utf-8',hasBody:true,readableBody:true,bodyUsed:false,bodyLocked:false,redirected:false,responseType:'cors'},lookup:{enabled:false,rounds:[]},validation:'passed',elapsedMs:12}};
    if(init.method==='POST'){
     const body=init.body;
     if(this._fixtureDefer)await new Promise(resolve=>this._fixtureReleases.push(resolve));
     const candidate={id:'candidate-'+body.requestId,requestId:body.requestId,unitId:body.unitId,fieldId:body.fieldId,role:body.role,
      assetHash:body.assetHash,parserVersion:body.parserVersion,sourceHash:body.sourceHash,rawSourceHash:body.rawSourceHash,
      generatedText:'Generated {0}',revision:1,status:'pending',createdAt:Date.now(),baseTargetHash:body.baseTargetHash};
     this._fixtureJobs.set(body.requestId,candidate);return{candidate};
    }
    if(path.startsWith('/v1/mtl/requests/'))return{candidate:this._fixtureJobs.get(decodeURIComponent(path.split('/').at(-1)))};
    return{events:[],sequence:0};
   }});
   await this.$nextTick();return true;
  },
  ctStorage(){return this._fixtureStore;},
  async exportTarget(){const saved=await this._fixtureStore.getSaved(this.ctWorkspace.scope),bytes=await ClientTextCodec.exportWorkbook(new Uint8Array(seed.bytes),seed.parsed,saved),
    reopened=await ClientTextCodec.parseWorkbook(bytes,{filename:'Thai.xlsx',role:'normal'});return reopened.units[0].fields[0].target;},
  snapshot(){const field=this.ctCurrentUnit.fields[0];return{underlying:this.ctValues[field.id],visible:this.ctMtlFieldValue(field),reviewed:this.ctReviewed[field.id]||'',dirty:this.ctDraftDirty,
    candidates:this.ctMtlCount,accepted:this.ctMtlAccepted(field),error:this.ctError||this.ctMtlError};},
  async memoryCount(){return (await this._fixtureStore.getMemory(this.ctWorkspace.scope))?.units?.length||0;}
 },
 template:'<div class="appRoot" data-density="compact"><main class="ctWorkspace" style="margin:24px;width:min(1200px,calc(100vw - 48px))"><h1>Synthetic MTL fixture</h1><button id="fixture-mode" @click="ctEditor=!ctEditor">Toggle full editor</button><button id="fixture-save" data-inline-focus-surface @click="ctSave()">Save</button><span v-if="ctMtlCount" class="ctMtlCount"><span class="ctMtlDot"></span>MTL {{ctMtlCount}}</span><table><tbody><tr :data-unit-id="ctSelection" @click="ctRowClick(ctCurrentUnit,$event)" @focusout="ctInlineFocusOut"><td><section id="fixture-editor" :class="ctEditor ? \'ctFull ctFullEditor\' : \'inlineEditor\'"><ct-fields v-if="ctCurrentUnit && !ctInlineClosed" :host="$root" :side="ctEditor ? \'both\' : \'translation\'"></ct-fields></section></td></tr></tbody></table><p class="fixture-error">{{ctError||ctMtlError}}</p></main><ct-mtl-debug-dialog v-if="ctMtlDebugAllowed && ctMtlDebugWindow" :host="$root"></ct-mtl-debug-dialog></div>'
};
const vue=Vue.createApp(options);vue.directive('tooltip',{});
vue.component('ct-fields',ClientTextUI.fieldsComponent);vue.component('ct-target',ClientTextUI.targetComponent);
vue.component('editor-native-field',EditorComponents.NativeField);vue.component('editor-field-toolbar',EditorComponents.FieldToolbar);
vue.component('editor-diagnostic-meta',EditorComponents.DiagnosticMeta);vue.component('app-notice',EditorComponents.Notice);
vue.component('ct-mtl-debug-dialog',ClientTextMtlDebug.Dialog);
app=vue.mount('#app');window.__mtlApp=app;
document.addEventListener('keydown',event=>app.ctKey(event));await app.configure('memory');window.__mtlReady=true;
})().catch(error=>{window.__mtlError=String(error.stack||error);console.error(error);});`;
    writeFileSync(join(outDir,'fixture.js'),fixture);
    const frontend=express(),server=createServer(frontend),errors=[],external=[];
    frontend.get('/',(req,res)=>res.type('html').send(`<!doctype html><html data-theme="light"><head><meta charset="utf-8">${styles}</head><body><div id="app"></div><script src="/fixture-vue.js"></script><script src="/fixture-jszip.js"></script>${scripts.map(src=>`<script src="/${src}"></script>`).join('')}<script src="/fixture.js"></script></body></html>`));
    frontend.get('/fixture-vue.js',(req,res)=>res.type('js').send(readFileSync(vueScriptPath)));
    frontend.get('/fixture-jszip.js',(req,res)=>res.type('js').send(readFileSync(join(rootDir,'../SDEditor-API/node_modules/jszip/dist/jszip.min.js'))));
    frontend.get('/fixture.js',(req,res)=>res.type('js').send(fixture));frontend.use(express.static(publicDir));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
    const results=[];
    try{
        browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});
        const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Bangkok',permissions:['clipboard-read','clipboard-write']});
        const page=await context.newPage();page.on('pageerror',error=>{errors.push(error.message);console.error('Synthetic fixture page error: '+error.message);});
        await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.origin);return route.abort();}return route.continue();});
        await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__mtlReady||window.__mtlError);
        assert.equal(await page.evaluate(()=>window.__mtlError),undefined,'Synthetic fixture initializes');
        const target=()=>page.locator('textarea[data-ct-target]').first(),snapshot=()=>page.evaluate(()=>window.__mtlApp.snapshot());
        const auditCopy=async()=>{
            const copy=await page.locator('body').evaluate(node=>[node.innerText,...[...node.querySelectorAll('[title],[aria-label],[placeholder]')]
                .filter(item=>item.getClientRects().length).flatMap(item=>['title','aria-label','placeholder'].map(key=>item.getAttribute(key)||''))].join('\n'));
            assert.doesNotMatch(copy,/OpenAI|ChatGPT|\bAI\b|\bmodels?\b|gpt-|synthetic-connection-config/i,'Editor, hints and selected debug fields contain no connection identity or branded system copy');
        };
        for(const mode of ['memory','idb']){
            await page.evaluate(mode=>window.__mtlApp.configure(mode),mode);
            await page.evaluate(()=>{window.__mtlApp.cloudUser={...window.__mtlApp.cloudUser,role:'translator',isAdmin:false};});
            assert.equal(await page.locator('.ctMtlDebugButton').count(),0,'Translator sees ordinary MTL controls');
            await auditCopy();
            for(const theme of ['light','grey','dark','modern-dark']){
                await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
                const toolbar=page.locator('[aria-label="Translation field tools"]').first();
                const order=await toolbar.evaluate(node=>{
                    const mtl=node.querySelector('.ctMtlButtonTarget'),separator=mtl.nextElementSibling,history=separator?.nextElementSibling,
                        box=element=>{const rect=element?.getBoundingClientRect();return rect?{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}:null;};
                    return{next:separator?.className,icon:mtl.textContent.trim(),mtl:box(mtl),separator:box(separator),history:box(history)};
                });
                assert.equal(order.next,'fieldToolbarSeparator',mode+'/'+theme+': MTL immediately precedes history separator');
                assert.equal(order.icon,'A\u2194\u3042',mode+'/'+theme+': restrained translate icon');
                assert.ok(order.separator.left>=order.mtl.right-1&&order.separator.left-order.mtl.right<=16,
                    mode+'/'+theme+': MTL is visually adjacent before the history separator '+JSON.stringify(order));
                assert.ok(order.history.left>=order.separator.right-1&&order.history.left-order.separator.right<=16,
                    mode+'/'+theme+': history follows the separator without a flexible gap '+JSON.stringify(order));
                assert.ok(Math.min(order.mtl.bottom,order.history.bottom)>Math.max(order.mtl.top,order.history.top),mode+'/'+theme+': toolbar actions share one row');
                await page.locator('#fixture-mode').click();assert.equal(await target().getAttribute('rows'),'4');
                await page.locator('#fixture-mode').click();assert.equal(await target().getAttribute('rows'),'1');
            }
            await page.evaluate(()=>{window.__mtlApp.cloudUser={...window.__mtlApp.cloudUser,role:'manager',isAdmin:false};});
            assert.equal(await page.locator('.ctMtlDebugButton').count(),0,'Manager has no debug access');
            await page.evaluate(()=>{window.__mtlApp.cloudUser={...window.__mtlApp.cloudUser,role:'admin',isAdmin:true};});
            await page.locator('.ctMtlDebugButton').click();
            assert.match(await page.locator('.ctMtlDebugDialog').textContent(),/Preview · not executed/);
            await auditCopy();
            assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureJobs.size),0,'Preview never generates');
            const header=page.locator('.ctMtlDebugHeader'),before=await page.locator('.ctMtlDebugDialog').boundingBox(),handle=await header.boundingBox();
            await page.mouse.move(handle.x+80,handle.y+12);await page.mouse.down();await page.mouse.move(handle.x+160,handle.y+62,{steps:8});await page.mouse.up();
            const after=await page.locator('.ctMtlDebugDialog').boundingBox();assert.ok(after.x>before.x+40&&after.y>before.y+20,'Dialog drags like KeywordPopups');
            await header.focus();await header.press('ArrowLeft');assert.ok((await page.locator('.ctMtlDebugDialog').boundingBox()).x<after.x,'Keyboard can move dialog');
            await header.press('Escape');assert.equal(await page.locator('.ctMtlDebugDialog').count(),0);
            assert.equal(await page.locator('.ctMtlDebugButton').evaluate(node=>node===document.activeElement),true,'Escape restores focus');
            await page.evaluate(()=>{window.__mtlApp._fixtureDefer=true;});
            await target().focus();await page.locator('.ctMtlButton').click();await page.waitForFunction(()=>window.__mtlApp._fixtureReleases.length===1);
            await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.__mtlApp.ctInlineClosed),false,'Translate does not collapse the inline row while busy');
            assert.equal(await page.locator('.ctMtlButton .ctAudioSpinner').count(),1,'Use existing audio spinner');
            assert.equal((await snapshot()).underlying,'Confirmed {0}');
            await page.evaluate(()=>{window.__mtlApp._fixtureReleases.shift()();window.__mtlApp._fixtureDefer=false;});
            await page.waitForFunction(()=>window.__mtlApp.snapshot().visible==='Generated {0}');
            assert.equal(await page.locator('.ctMtlCount').count(),1);
            await page.locator('.ctMtlDebugButton').click();await page.waitForFunction(()=>!!window.__mtlApp.ctMtlDebugWindow?.record.server);
            assert.match(await page.locator('.ctMtlDebugDialog').textContent(),/Selected fields from the executed request and server validation/);
            await auditCopy();
            const selected=JSON.parse(await page.locator('.ctMtlDebugDialog pre').textContent());assert.equal(selected.model,undefined);assert.equal(selected.provider,undefined);
            assert.deepEqual(selected.upstreamResponse,{contentType:'text/event-stream; charset=utf-8',hasBody:true,readableBody:true,bodyUsed:false,bodyLocked:false,redirected:false,responseType:'cors'});
            assert.equal(selected.prompt.instructions,'Synthetic executed prompt <img src=x onerror="window.__debugXss=true">');
            assert.equal(await page.locator('.ctMtlDebugDialog img').count(),0,'Request text is escaped');
            assert.equal(await page.evaluate(()=>window.__debugXss),undefined);assert.doesNotMatch(await page.locator('.ctMtlDebugDialog').textContent(),/synthetic-secret/);
            for(const theme of ['light','grey','dark','modern-dark']){
                await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
                await page.screenshot({path:join(outDir,mode+'-debug-'+theme+'.png'),fullPage:true});
            }
            await page.setViewportSize({width:920,height:650});
            await page.waitForFunction(()=>{const r=document.querySelector('.ctMtlDebugDialog').getBoundingClientRect();return r.x>=7&&r.y>=7&&r.right<=913&&r.bottom<=643;});
            const resized=await page.locator('.ctMtlDebugDialog').boundingBox();assert.ok(resized.x>=7&&resized.y>=7&&resized.x+resized.width<=913&&resized.y+resized.height<=643,'Resized desktop keeps dialog reachable');
            await page.setViewportSize({width:1440,height:1000});
            await page.evaluate(()=>{window.__mtlApp.cloudUser={...window.__mtlApp.cloudUser,role:'translator',isAdmin:false};});
            assert.equal(await page.locator('.ctMtlDebugDialog').count(),0);assert.equal(await page.evaluate(()=>Object.keys(window.__mtlApp.ctMtlDebugRecords).length),0,'Role change clears details');
            const accent=await page.locator('.ctMtlReview .ctMtlDot').evaluate(node=>getComputedStyle(node).backgroundColor);
            assert.equal(accent,'rgb(103, 212, 241)');
            for(const theme of ['light','grey','dark','modern-dark']){
                await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
                await page.screenshot({path:join(outDir,mode+'-'+theme+'.png'),fullPage:true});
            }
            await target().fill('Typed {0}');assert.equal((await snapshot()).underlying,'Confirmed {0}');
            await target().evaluate(input=>{input.focus();input.setSelectionRange(0,input.value.length);const data=new DataTransfer();data.setData('text/plain','Pasted {0}');input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
            await page.waitForFunction(()=>window.__mtlApp.snapshot().visible==='Pasted {0}');assert.equal((await snapshot()).underlying,'Confirmed {0}');
            await target().evaluate(input=>{input.focus();input.setSelectionRange(0,6);});await target().press('Control+b');
            await page.waitForFunction(()=>window.__mtlApp.snapshot().visible.includes('<b>{Pasted}'));assert.equal((await snapshot()).underlying,'Confirmed {0}');
            await target().fill('Autocomplete ');
            const completed=await page.evaluate(()=>{const app=window.__mtlApp,field=app.ctCurrentUnit.fields[0],input=app.ctDictionaryTarget(field.id);
                input.focus();input.setSelectionRange(input.value.length,input.value.length);const started=app.ctSuggest(field,{target:input},{manual:true}),item=app.ctCompletion?.items.find(item=>item.value==='{0}');
                return !!started&&!!item&&app.ctApplyCompletion(field,item,input);});
            assert.equal(completed,true,'Real autocomplete routes into separate review');assert.equal((await snapshot()).underlying,'Confirmed {0}');
            await page.evaluate(()=>window.__mtlApp.ctApplyMemory({target:'From memory {0}'}));
            assert.equal((await snapshot()).visible,'From memory {0}');assert.equal((await snapshot()).underlying,'Confirmed {0}');
            assert.equal(await page.evaluate(()=>window.__mtlApp.memoryCount()),0,'Unaccepted MTL does not teach TM');
            await page.locator('#fixture-mode').click();assert.equal(await target().inputValue(),'From memory {0}');await page.locator('#fixture-mode').click();
            assert.equal(await page.evaluate(()=>window.__mtlApp.exportTarget()),'Confirmed {0}','Unaccepted overlay does not export');
            await page.getByRole('button',{name:'Accept',exact:true}).click();await page.waitForFunction(()=>window.__mtlApp.snapshot().accepted);
            assert.equal(await page.evaluate(()=>window.__mtlApp.ctInlineClosed),false,'Accept preserves inline editor');
            assert.equal(await target().evaluate(node=>node===document.activeElement),true,'Accept returns focus to the same native field');
            assert.equal((await snapshot()).underlying,'From memory {0}');assert.equal(await page.evaluate(()=>window.__mtlApp.exportTarget()),'Confirmed {0}','Accepted unsaved draft does not export');
            await page.locator('#fixture-save').click();await page.waitForFunction(()=>{const app=window.__mtlApp,field=app.ctCurrentUnit.fields[0];
                return app.ctError||!app.ctBusy&&app.ctSaved[app.ctSelection]?.values[field.id]==='From memory {0}';});
            assert.equal((await snapshot()).error,'',mode+': save succeeds');assert.equal((await snapshot()).candidates,0,mode+': normal atomic save resolves candidate');
            assert.equal(await page.evaluate(()=>window.__mtlApp.exportTarget()),'From memory {0}','Saved accepted text exports');
            const savedMemory=await page.evaluate(()=>window.__mtlApp.memoryCount());
            if(mode==='idb')assert.ok(savedMemory>0,'Only authored saved text teaches durable TM');
            else assert.equal(savedMemory,0,'Disposable local work never writes durable TM');
            await page.evaluate(()=>{window.__mtlApp._fixtureDefer=true;});await page.locator('.ctMtlButton').click();
            await page.waitForFunction(()=>window.__mtlApp._fixtureReleases.length===1);await target().fill('New ordinary {0}');
            await page.evaluate(()=>{window.__mtlApp._fixtureReleases.shift()();window.__mtlApp._fixtureDefer=false;});
            await page.waitForFunction(()=>!Object.keys(window.__mtlApp.ctMtlRequests).length);
            assert.equal((await snapshot()).visible,'New ordinary {0}','Late generation preserves typed ordinary content');
            assert.equal(await page.getByRole('button',{name:'Review MTL',exact:true}).count(),1);
            const sourceHidden=await page.evaluate(()=>{const app=window.__mtlApp,unit=app.ctCurrentUnit,field=unit.fields[0];
                const next=Vue.markRaw({...unit,fields:[{...field,source:'Changed source {0}'}]});app.ctUnits=Vue.markRaw([next]);app._ctUnitIndex=Vue.markRaw(new Map([[next.id,next]]));app.ctMtlRevision++;
                return app.ctMtlPendingCandidate(next.fields[0])===null&&app.ctMtlCount===0;});
            assert.equal(sourceHidden,true,'Source change silently hides candidate');
            await page.evaluate(mode=>window.__mtlApp.configure(mode),mode);
            await target().fill('Unconfirmed ordinary {0}');
            const selection=await page.evaluate(()=>window.__mtlApp.ctSelection);
            await page.evaluate(()=>{window.__mtlApp._fixtureDefer=true;});
            await page.locator('.ctMtlButton').focus();await page.locator('.ctMtlButton').press('Enter');
            await page.waitForFunction(()=>window.__mtlApp._fixtureReleases.length===1);await page.waitForTimeout(30);
            assert.equal(await page.evaluate(()=>window.__mtlApp.ctInlineClosed),false,'Keyboard Translate preserves inline editor while disabled');
            assert.equal((await snapshot()).underlying,'Unconfirmed ordinary {0}','Translate preserves ordinary draft');
            await page.evaluate(()=>{window.__mtlApp._fixtureReleases.shift()();window.__mtlApp._fixtureDefer=false;});
            await page.waitForFunction(()=>window.__mtlApp.snapshot().visible==='Generated {0}');
            assert.equal(await page.evaluate(()=>window.__mtlApp.ctSelection),selection,'Async result preserves selection');
            await page.getByRole('button',{name:'Dismiss',exact:true}).focus();await page.getByRole('button',{name:'Dismiss',exact:true}).press('Enter');
            await page.waitForFunction(()=>window.__mtlApp.snapshot().candidates===0);await page.waitForTimeout(30);
            assert.equal(await page.evaluate(()=>window.__mtlApp.ctInlineClosed),false,'Dismiss preserves inline editor');
            assert.equal((await snapshot()).underlying,'Unconfirmed ordinary {0}');assert.equal(await target().evaluate(node=>node===document.activeElement),true,'Dismiss returns focus to the stable field');
            results.push({mode,themes:4,inputRoutes:['typing','paste','format','autocomplete','TM'],exports:'original before Save, accepted after Save',raceGuards:true,
                debug:['admin-only','read-only preview','actual request','drag','keyboard move','escape focus','resize','escaped','redacted','role reset'],inlineStable:['pointer Translate','keyboard Translate','async result','debug dialog','Accept','Dismiss','draft','selection']});
        }
        assert.deepEqual(external,[],'No external request is made');assert.deepEqual(errors,[],'Real native controls render without page errors');
        const report={passed:true,results,externalRequests:external,pageErrors:errors};writeFileSync(join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
