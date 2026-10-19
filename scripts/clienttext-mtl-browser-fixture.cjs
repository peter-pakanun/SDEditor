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
    const consentHtml=html.match(/<label class="settingsToggle"><input type="checkbox" v-model="mtlConsentVersion"[\s\S]*?<\/details>/)?.[0];
    assert.ok(consentHtml,'Actual Settings consent and privacy details are available');
    const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"/:]+\.css)"[^>]*>/g)].map(match=>match[0].replace('href="','href="/')).join('\n');
    const scripts=['workspaceState.js','dictionaryScope.js','regexEngine.js','translationDiagnostics.js','translationMemory.js',
        'normalizedStore.js','normalizedRooms.js','offlineStore.js','clientTextState.js','contentAdapters.js','clientTextStore.js',
        'clientTextMtlState.js','clientTextMtlStore.js','clientTextMtlMemoryStore.js','clientTextMtlSync.js','clientTextMemoryStore.js',
        'vendor/fast-xml-parser-5.11.2.min.js','clientTextCodec.js','editorComponents.js','clientTextFormatting.js','clientTextComparisons.js',
        'clientTextExportProgress.js','clientTextMtlLookup.js','clientTextMtlContext.js','clientTextMtlTiming.js','clientTextMtlProgress.js','clientTextMtlSettingsUi.js','clientTextMtlUi.js','clientTextMtlDebug.js','clientTextUi.js','editorSession.js'];
    const fixture=String.raw`(async()=>{
const seed=${seed},ct=ClientTextUI.mixin,mtl=ClientTextMtlUI.mixin,debug=ClientTextMtlDebug.mixin,modelSettings=ClientTextMtlSettingsUI.mixin;
let app;
const options={
 data(){return{...ct.data(),...mtl.data(),...debug.data(),...modelSettings.data(),fixtureConsent:false,fixtureMode:'memory',lang:'Thai',gameVersion:'poe2',branchId:'default',cloudSignedIn:true,
 cloudProfileId:'synthetic-tester',cloudUser:{id:'synthetic-tester',role:'translator',language:'Thai',assignmentVersion:1},cloudCanAccessAllLanguages:false,
 managedCatalogScope:'synthetic-scope',mtlConsentVersion:'mtl-v2',mtlShortcut:'f8',ctMtlCapabilities:{enabled:true,reviewArchive:true,consentVersion:'mtl-v2'},inlineEditor:true,
 translationEditorBcp47:'th',dictionary:[],mapClientTextClassNames:true,autocompleteShortcut:'ctrl-space',ctEditor:false};},
 computed:{...ct.computed,...mtl.computed,...debug.computed,...modelSettings.computed},watch:{...mtl.watch,...debug.watch,...modelSettings.watch},
 methods:{...ct.methods,...mtl.methods,...debug.methods,...modelSettings.methods,
  ctKeyboardOverlayOpen(){return false;},ctInlineUnitVisible(){return this.ctActive&&!this.ctEditor&&!this.ctInlineClosed;},ctCloseCompletion(){this.ctCompletion=null;},
  scheduleClientTextDictionaryMatches(){},ctRefreshDiagnostics(){},ctRefreshDraftSummaries(){},ctLoadHistory(){},ctPresence(){},
  ctRefreshLayout(){},ctFocusRow(){},ctSync(){},ctClearDraftStageFailure(){},ctRememberDraftStageFailure(){},
  ctDictionaryTarget(id=this.ctFocusedField){return [...document.querySelectorAll('[data-ct-target]')].find(input=>input.dataset.ctTarget===id);},
  ctEditorElement(){return document.querySelector('#fixture-editor');},appConfirm:async()=>true,
  fixtureExplicitActions(){
   const unit=this.ctCurrentUnit,field=unit.fields[0],snapshot={available:true,unit:JSON.parse(JSON.stringify(unit)),values:{[field.id]:'Historical replacement {0}'},reviewed:{}};
   this.ctChoices=[{fieldId:field.id,local:'Previous saved {0}',upstream:'Incoming choice {0}'}];
   this.ctHistory=[{key:'synthetic-restore',id:'synthetic-restore',unitId:unit.id,context:this.ctContext(),createdAt:1,action:'save',actor:{name:'Synthetic'},before:snapshot,after:snapshot}];
   this.ctPolicy={clientTextSaveOrigins:['restore']};this._fixtureConfirmCalls=0;this._fixtureRestoreSaves=0;this._fixtureReplacements=0;
   this._fixtureOriginalConfirm=this.appConfirm;this._fixtureOriginalSave=this.ctSave;this._fixtureOriginalRestore=this.ctRestoreHistory;this._fixtureOriginalReplace=this.ctMtlUnderlyingReplaced;
   this.appConfirm=async()=>{this._fixtureConfirmCalls++;return true;};
   this.ctSave=(...args)=>{this._fixtureRestoreSaves++;return this._fixtureOriginalSave(...args);};
   this.ctMtlUnderlyingReplaced=(...args)=>{this._fixtureReplacements++;return this._fixtureOriginalReplace(...args);};
   this.ctRestoreHistory=(...args)=>(this._fixtureRestoreTask=this._fixtureOriginalRestore(...args));
  },
  fixtureFinishExplicitActions(){this.appConfirm=this._fixtureOriginalConfirm;this.ctSave=this._fixtureOriginalSave;this.ctRestoreHistory=this._fixtureOriginalRestore;this.ctMtlUnderlyingReplaced=this._fixtureOriginalReplace;this.ctChoices=[];this.ctHistory=[];},
  async fixtureEditSnapshot(){const scope=this.ctWorkspace.scope;return JSON.stringify([this.ctValues,this.ctReviewed,this.ctChoices,this.ctSaved,this.ctDraftDirty,
   await this._fixtureStore.getSaved(scope),await this._fixtureStore.listHistory(scope,this.ctSelection),await this._fixtureStore.getOutbox?.(scope)]);},
  async configure(mode){
   clearTimeout(this._ctDraftTimer);this.ctMtlReset();this.ctResetComparisons();this._fixtureStore?.dispose?.();
   this.fixtureMode=mode;this.cloudSignedIn=true;this.ctActive=false;this.ctBusy=false;this.ctError='';this.ctValues={};this.ctReviewed={};this.ctSaved=Vue.markRaw({});
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
   this.ctActive=true;this.ctEditor=false;this.ctMtlCapabilities={enabled:true,reviewArchive:true,consentVersion:'mtl-v2'};this._ctMtlDescriptors=Vue.markRaw(seed.descriptors);
   this._fixtureJobs=new Map();this._fixtureReleases=[];this._fixtureDefer=false;this._fixtureAsync=false;this._fixtureStarts=0;this._fixtureCancels=0;this._fixturePollErrors=0;
   this._fixtureCancelDefer=false;this._fixtureCancelReleases=[];this._fixtureCancelFailures=0;
   this._fixtureDismissals=[];this._fixtureArchiveFailures=0;this._fixtureArchiveLostAcks=0;this._fixtureArchiveDefer=false;this._fixtureArchiveReleases=[];
   this._cloud=Vue.markRaw({request:async(path,init={})=>{
    if(path==='/v1/mtl/capabilities')return{enabled:true,reviewArchive:true,consentVersion:'mtl-v2'};
    if(path==='/v1/admin/mtl/model-settings')return{settings:{version:'mtl-inference-settings-v1',models:[{model:'gpt-6-luna',efforts:['none','low','medium','high','xhigh','max']},{model:'gpt-6.1-sol',efforts:['low','medium','high','xhigh','max']}]}};
    if(path.includes('/dismissals')){
     const body=structuredClone(init.body);this._fixtureDismissals.push({path,body});
     if(body.consentVersion!=='mtl-v2')throw Object.assign(new Error('Updated private-retention consent is required.'),{status:403,code:'MTL_REVIEW_CONSENT_REQUIRED'});
     if(this._fixtureArchiveDefer)await new Promise(resolve=>this._fixtureArchiveReleases.push(resolve));
     if(this._fixtureArchiveFailures>0){this._fixtureArchiveFailures--;throw Object.assign(new Error('Dismissed on server; private review file is pending.'),{status:503,code:'MTL_REVIEW_ARCHIVE_PENDING'});}
     if(this._fixtureArchiveLostAcks>0){this._fixtureArchiveLostAcks--;throw new TypeError('Synthetic lost acknowledgement');}
     const candidate=(await this._fixtureStore.mtl.list(scope)).find(value=>value.id===(body.candidateId||decodeURIComponent(path.split('/').at(-2))));
     const archive={id:'mtl-review_'+'a'.repeat(64),format:'sdeditor-mtl-dismissal-v1',status:'saved'};
     return mode==='memory'?{dismissal:{candidateId:candidate.id,requestId:candidate.requestId,status:'dismissed',revision:2},archive}:{candidate:{...candidate,localDisposition:false,status:'dismissed',revision:2},archive};
    }
    if(path.startsWith('/v1/admin/mtl/requests/'))return{diagnostics:{requestId:decodeURIComponent(path.split('/').at(-2)),timing:{version:'mtl-timing-v1',domain:'api-process',origin:'request-handler-entry',outcome:this._fixtureAsync?'running':'completed',milestonesMs:{apiReceived:0,admitted:2,credentialsStart:2,credentialsReady:6,providerRequest:10,providerHeaders:16,providerFirstByte:18,providerFirstEvent:20,providerFirstOutputText:30,providerFirstTranslation:40,providerCompleted:55,providerStreamEnd:60,validationStart:60,validationEnd:65,persistenceEnd:69,finished:80},durationsMs:{admissionMs:2,credentialsMs:4,streamMs:44,validationMs:5,persistenceMs:4,totalMs:80}},providerRequest:{model:'synthetic-connection-config',instructions:'Synthetic executed prompt <img src=x onerror="window.__debugXss=true">',input:[{role:'user',content:'Synthetic context'}]},context:{accessToken:'synthetic-secret'},upstreamResponse:{contentType:'text/event-stream; charset=utf-8',hasBody:true,readableBody:true,bodyUsed:false,bodyLocked:false,redirected:false,responseType:'cors'},lookup:{enabled:false,rounds:[]},validation:'passed',elapsedMs:12}};
    if(this._fixtureAsync){
     const snapshot=()=>({requestId:this._fixtureLive.body.requestId,status:this._fixtureLive.status,scope:{...scope,local:mode==='memory'},pollAfterMs:250,
       progress:{revision:this._fixtureLive.revision,phase:this._fixtureLive.phase,translation:this._fixtureLive.text,provisional:true},errorCode:this._fixtureLive.errorCode});
     if(path.endsWith('/cancellations')){this._fixtureCancels++;if(this._fixtureCancelFailures>0){this._fixtureCancelFailures--;throw new TypeError('Synthetic stop interruption');}if(this._fixtureCancelDefer)await new Promise(resolve=>this._fixtureCancelReleases.push(resolve));
      this._fixtureLive.status='failed';this._fixtureLive.errorCode='MTL_CANCELLED';return snapshot();}
     if(init.method==='POST'){
      this._fixtureStarts++;this._fixtureLive={body:init.body,status:'running',text:'',revision:1,phase:'connecting'};return snapshot();
     }
     if(path.startsWith('/v1/mtl/requests/')){
      if(this._fixturePollErrors>0){this._fixturePollErrors--;throw new TypeError('Synthetic polling interruption');}
      if(!this._fixtureLive.complete)return snapshot();
      const body=this._fixtureLive.body;return{candidate:{id:'candidate-'+body.requestId,requestId:body.requestId,unitId:body.unitId,fieldId:body.fieldId,role:body.role,
       assetHash:body.assetHash,parserVersion:body.parserVersion,sourceHash:body.sourceHash,rawSourceHash:body.rawSourceHash,generatedText:this._fixtureLive.generatedText||'Generated {0}',
       revision:1,status:'pending',createdAt:Date.now(),baseTargetHash:body.baseTargetHash}};
     }
    }
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
 template:'<div class="appRoot" data-density="compact"><main class="ctWorkspace" style="margin:24px;width:min(1200px,calc(100vw - 48px))"><h1>Synthetic MTL fixture</h1><button id="fixture-mode" @click="ctEditor=!ctEditor">Toggle full editor</button><button id="fixture-save" data-inline-focus-surface @click="ctSave()">Save</button><span v-if="ctMtlVisible && ctMtlCount" class="ctMtlCount"><span class="ctMtlDot"></span>MTL {{ctMtlCount}}</span><table><tbody><tr :data-unit-id="ctSelection" @click="ctRowClick(ctCurrentUnit,$event)" @focusout="ctInlineFocusOut"><td><section id="fixture-editor" :class="ctEditor ? \'ctFull ctFullEditor\' : \'inlineEditor\'"><ct-fields v-if="ctCurrentUnit && !ctInlineClosed" :host="$root" :side="ctEditor ? \'both\' : \'translation\'"></ct-fields></section></td></tr></tbody></table><p class="fixture-error">{{ctError||ctMtlError}}</p></main><fixture-mtl-consent v-if="fixtureConsent"></fixture-mtl-consent><ct-mtl-debug-dialog v-if="ctMtlDebugAllowed && ctMtlDebugWindow" :host="$root"></ct-mtl-debug-dialog></div>'
};
const vue=Vue.createApp(options);vue.directive('tooltip',{});
vue.component('ct-fields',ClientTextUI.fieldsComponent);vue.component('ct-target',ClientTextUI.targetComponent);
vue.component('editor-native-field',EditorComponents.NativeField);vue.component('editor-field-toolbar',EditorComponents.FieldToolbar);
vue.component('editor-diagnostic-meta',EditorComponents.DiagnosticMeta);vue.component('app-notice',EditorComponents.Notice);
vue.component('ct-mtl-debug-dialog',ClientTextMtlDebug.Dialog);
vue.component('ct-mtl-progress',ClientTextMtlProgress.Overlay);
vue.component('ct-mtl-settings-bar',ClientTextMtlSettingsUI.Bar);
vue.component('fixture-mtl-consent',{template:${JSON.stringify('<section data-inline-focus-surface>'+consentHtml.replace('v-model="mtlConsentVersion"','v-model="$root.mtlConsentVersion"')+'</section>')}});
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
        await page.evaluate(()=>{const app=window.__mtlApp;app.fixtureConsent=true;app.mtlConsentVersion='mtl-v1';});
        const consent=page.getByRole('checkbox',{name:/Allow MTL requests and private review retention/});
        assert.equal(await consent.isChecked(),false,'Historical v1 consent is never silently promoted');
        assert.equal(await page.evaluate(()=>window.__mtlApp.mtlConsentVersion),'mtl-v1');
        assert.match(await consent.locator('..').textContent(),/source, prompt and context.*including for local workbooks/);
        await consent.check();assert.equal(await page.evaluate(()=>window.__mtlApp.mtlConsentVersion),'mtl-v2');
        assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureJobs.size),0,'Consent itself never invokes translation');
        await page.locator('.ctMtlButton').click();await page.waitForFunction(()=>window.__mtlApp.snapshot().visible==='Generated {0}');
        await target().fill('Rejected edited legacy text {0}');
        for(const version of ['mtl-v1','']){
            await page.evaluate(version=>{window.__mtlApp.mtlConsentVersion=version;},version);
            await page.getByRole('button',{name:'Dismiss',exact:true}).click();
            assert.match((await snapshot()).error,/updated.*private review-retention/);
            assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureDismissals.length),0,'Unapproved rejection never uploads');
            assert.equal((await snapshot()).candidates,1);assert.equal(await page.evaluate(()=>window.__mtlApp.mtlConsentVersion),version);
        }
        await consent.check();await page.getByRole('button',{name:'Dismiss',exact:true}).click();
        await page.waitForFunction(()=>window.__mtlApp._fixtureDismissals.length===1&&!window.__mtlApp.ctMtlDismissals.length);
        assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureDismissals[0].body.consentVersion),'mtl-v2');
        assert.equal((await snapshot()).underlying,'Confirmed {0}');
        await page.evaluate(()=>window.__mtlApp.configure('memory'));
        await page.evaluate(()=>{window.__mtlApp.fixtureConsent=false;});
        // Account/assignment changes use the actual shared toolbar and field,
        // in both storage modes and both editor presentations.
        for(const mode of ['memory','idb'])for(const full of [false,true]){
            await page.evaluate(async({mode,full})=>{
                const app=window.__mtlApp;app.cloudUser={id:'synthetic-tester',role:'translator',language:'Thai',assignmentVersion:1};
                app.cloudCanAccessAllLanguages=false;await app.configure(mode);app.ctEditor=full;
            },{mode,full});
            await target().fill('Ordinary unsaved {0}');
            await page.evaluate(()=>{window.__visibilityTarget=document.querySelector('[data-ct-target]');});
            for(const role of ['translator','manager','admin'])for(const language of [null,'Thai','French']){
                await page.evaluate(({role,language})=>{const app=window.__mtlApp;
                    app.cloudUser={id:'synthetic-tester',role,isAdmin:role==='admin',language,assignmentVersion:(app.cloudUser.assignmentVersion||0)+1};
                    app.cloudCanAccessAllLanguages=role!=='translator';
                },{role,language});
                const shown=role==='admin'||!!language;
                assert.equal(await page.locator('.ctMtlButton').count(),shown?1:0,mode+'/'+full+'/'+role+'/'+language);
                assert.equal(await target().inputValue(),'Ordinary unsaved {0}');
                assert.equal(await target().evaluate(node=>node===window.__visibilityTarget),true,'Visibility retains the mounted field');
                assert.equal(await page.evaluate(()=>window.__mtlApp.ctEditor),full);
                if(shown)assert.equal(await page.locator('.ctMtlButton').isDisabled(),role==='translator'&&language!=='Thai');
                else{
                    const starts=await page.evaluate(()=>window.__mtlApp._fixtureStarts);
                    await target().focus();await page.keyboard.press('F8');
                    assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureStarts),starts,'Hidden shortcut cannot admit a translation');
                    assert.equal(await page.locator('.ctMtlReview,.ctMtlSettingsButton,.ctMtlDebugButton').count(),0);
                }
            }
            await page.evaluate(()=>{const app=window.__mtlApp;app.cloudUser={...app.cloudUser,role:'manager',isAdmin:false,language:'Thai'};});
            await page.locator('.ctMtlButton').click();await page.waitForFunction(()=>window.__mtlApp.snapshot().visible==='Generated {0}');
            await target().fill('Separate retained review {0}');await page.locator('.ctMtlButton').focus();
            await page.evaluate(()=>{window.__mtlApp.cloudUser.language=null;});
            assert.equal(await page.locator('.ctMtlReview,.ctMtlButton,.ctMtlCount').count(),0);
            assert.equal(await page.evaluate(()=>window.__mtlApp.ctStatusFilterOptions.some(item=>item.key==='mtl')),false);
            assert.equal(await page.evaluate(()=>window.__mtlApp.ctMtlCount),1,'Hidden UI preserves candidate workload data');
            assert.equal(await target().inputValue(),'Ordinary unsaved {0}');
            assert.equal(await target().evaluate(node=>node===document.activeElement&&node===window.__visibilityTarget),true,'Removed-control focus returns to the stable field');
            await page.evaluate(()=>{window.__mtlApp.cloudUser.language='Thai';});
            assert.equal(await target().inputValue(),'Separate retained review {0}');
            await page.evaluate(()=>{window.__mtlApp.cloudSignedIn=false;});assert.equal(await page.locator('.ctMtlButton,.ctMtlReview').count(),0);
            await page.evaluate(()=>{const app=window.__mtlApp;app.cloudSignedIn=true;app.cloudUser={id:'different-account',role:'manager',language:null};});
            assert.equal(await page.locator('.ctMtlButton').count(),0);
            for(const width of [560,800,1440]){
                await page.setViewportSize({width,height:850});
                await page.evaluate(()=>{window.__mtlApp.cloudUser={id:'synthetic-tester',role:'admin',isAdmin:true,language:null};});
                const box=await page.locator('.ctMtlButton').boundingBox();assert.equal(box.width,25);assert.equal(box.height,25);
                assert.ok(box.x>=0&&box.x+box.width<=width,'Square Translate stays reachable at '+width);
                await page.screenshot({path:join(outDir,`visibility-${mode}-${full?'full':'inline'}-${width}.png`),fullPage:true});
            }
        }
        await page.setViewportSize({width:1440,height:1000});
        await page.evaluate(()=>{const app=window.__mtlApp;app.cloudUser={id:'synthetic-tester',role:'translator',language:'Thai',assignmentVersion:1};app.cloudCanAccessAllLanguages=false;});
        await page.evaluate(()=>window.__mtlApp.configure('memory'));
        const auditCopy=async()=>{
            const copy=await page.locator('body').evaluate(node=>{
                let visible=node.innerText;
                const details=node.querySelector('pre[aria-label="Selected request fields"]');
                if(details){const value=JSON.parse(details.textContent);delete value.inferenceSettings;visible=visible.replace(details.innerText,JSON.stringify(value));}
                for(const bar of node.querySelectorAll('.ctMtlSettingsBar'))visible=visible.replace(bar.innerText,'');
                return [visible,...[...node.querySelectorAll('[title],[aria-label],[placeholder]')]
                    .filter(item=>item.getClientRects().length&&!item.closest('.ctMtlSettingsButton,.ctMtlSettingsBar')).flatMap(item=>['title','aria-label','placeholder'].map(key=>item.getAttribute(key)||''))].join('\n');
            });
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
                    return{next:separator?.className,icon:!!mtl.querySelector('button > svg[aria-hidden="true"]'),button:box(mtl.querySelector('.ctMtlButton')),mtl:box(mtl),separator:box(separator),history:box(history)};
                });
                assert.equal(order.next,'fieldToolbarSeparator',mode+'/'+theme+': MTL immediately precedes history separator');
                assert.equal(order.icon,true,mode+'/'+theme+': SVG translation icon');
                assert.equal(order.button.right-order.button.left,25);assert.equal(order.button.bottom-order.button.top,25);
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
            assert.equal(await page.locator('.ctMtlSettingsButton').count(),0,'Manager has no model settings access');
            await page.evaluate(()=>{window.__mtlApp.cloudUser={...window.__mtlApp.cloudUser,role:'admin',isAdmin:true};});
            assert.equal(await page.locator('.ctMtlSettingsButton').count(),1,'Admin has model settings beside Translate');
            const beforeSettings=await page.evaluate(()=>window.__mtlApp.snapshot());
            await page.locator('.ctMtlSettingsButton').click();await page.waitForFunction(()=>!window.__mtlApp.ctMtlSettingsLoading);
            const settingsBar=page.getByRole('region',{name:'Translation model settings'});
            assert.equal(await settingsBar.getByLabel('Model',{exact:true}).inputValue(),'gpt-6.1-sol');
            assert.equal(await settingsBar.getByLabel('Reasoning',{exact:true}).inputValue(),'medium');
            assert.match(await settingsBar.textContent(),/Default: Sol \/ medium\./);
            await settingsBar.getByLabel('Model',{exact:true}).selectOption('gpt-6.1-sol');await settingsBar.getByLabel('Reasoning',{exact:true}).selectOption('low');
            assert.equal(await settingsBar.getByRole('checkbox',{name:'Fast · unavailable'}).isDisabled(),true);
            assert.deepEqual(await page.evaluate(()=>window.__mtlApp.ctMtlSettingsCapture()),{version:'mtl-inference-settings-v1',model:'gpt-6.1-sol',effort:'low'});
            assert.match(await settingsBar.locator('.ctMtlSettingsFast').getAttribute('title'),/Fast support and account entitlement have not been verified/);
            await settingsBar.getByLabel('Model',{exact:true}).selectOption('gpt-6-luna');
            assert.deepEqual(await settingsBar.getByLabel('Reasoning',{exact:true}).locator('option').allTextContents(),['none','low','medium','high','xhigh','max']);
            for(const effort of ['none','low','medium']){
                await settingsBar.getByLabel('Reasoning',{exact:true}).selectOption(effort);
                assert.deepEqual(await page.evaluate(()=>window.__mtlApp.ctMtlSettingsCapture()),{version:'mtl-inference-settings-v1',model:'gpt-6-luna',effort});
            }
            assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureJobs.size),0,'Model choices never generate or probe the provider');
            for(const theme of ['light','grey','dark','modern-dark']){
                await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(outDir,mode+'-model-settings-'+theme+'.png'),fullPage:true});
                const box=await settingsBar.boundingBox();assert.ok(box.width>250&&box.x>=0&&box.x+box.width<=1440,'Settings bar fits the desktop');
            }
            await page.setViewportSize({width:1000,height:850});assert.ok((await settingsBar.boundingBox()).width<1000,'Settings bar resizes');await page.setViewportSize({width:1440,height:1000});
            assert.deepEqual(await page.evaluate(()=>window.__mtlApp.snapshot()),beforeSettings,'Opening model controls does not edit or save the draft');
            await settingsBar.getByLabel('Reasoning',{exact:true}).press('Escape');assert.equal(await settingsBar.count(),0);assert.equal(await page.locator('.ctMtlSettingsButton').evaluate(node=>node===document.activeElement),true,'Escape restores settings-button focus');
            await page.evaluate(()=>window.__mtlApp.ctMtlSettingsDefault());
            assert.deepEqual(await page.evaluate(()=>window.__mtlApp.ctMtlSettingsSelected()),{version:'mtl-inference-settings-v1',model:'gpt-6.1-sol',effort:'medium'});
            await page.locator('.ctMtlDebugButton').click();
            assert.match(await page.locator('.ctMtlDebugDialog').textContent(),/Preview · not executed/);
            assert.equal(await page.getByRole('button',{name:'Copy response',exact:true}).count(),0,'Absent response has no copy action');
            assert.equal(await page.locator('pre[aria-label="Displayed MTL response"]').count(),0,'Preview does not invent a response JSON block');
            await page.locator('.ctMtlTimingPanel summary').click();assert.equal(await page.locator('.ctMtlTimingPanel table').count(),4);assert.match(await page.locator('.ctMtlTimingPanel').textContent(),/Unavailable/);
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
            await page.locator('.ctMtlTimingPanel summary').click();
            assert.match(await page.locator('.ctMtlTimingPanel').textContent(),/30.0 ms/);assert.match(await page.locator('.ctMtlTimingPanel').textContent(),/independent/);
            assert.equal(await page.locator('.ctMtlTimingPanel table[role=grid]').count(),0);
            for(const theme of ['light','grey','dark','modern-dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(outDir,mode+'-timing-'+theme+'.png'),fullPage:true});}
            await page.locator('.ctMtlTimingPanel summary').click();
            await auditCopy();
            const selected=JSON.parse(await page.locator('.ctMtlDebugDialog pre[aria-label="Selected request fields"]').textContent());assert.equal(selected.model,undefined);assert.equal(selected.provider,undefined);
            assert.deepEqual(selected.upstreamResponse,{contentType:'text/event-stream; charset=utf-8',hasBody:true,readableBody:true,bodyUsed:false,bodyLocked:false,redirected:false,responseType:'cors'});
            assert.equal(JSON.parse(await page.locator('.ctMtlDebugDialog pre[aria-label="Displayed MTL prompt"]').textContent()).instructions,'Synthetic executed prompt <img src=x onerror="window.__debugXss=true">');
            assert.equal(await page.locator('.ctMtlDebugDialog img').count(),0,'Request text is escaped');
            assert.equal(await page.evaluate(()=>window.__debugXss),undefined);assert.doesNotMatch(await page.locator('.ctMtlDebugDialog').textContent(),/synthetic-secret/);
            await page.evaluate(()=>{
                const app=window.__mtlApp,item=app.ctMtlDebugWindow,server=item.record.server;
                app.ctMtlDebugWindow={...item,record:{...item.record,server:{...server,source:'Synthetic request line\n'.repeat(3000)+'request-tail',
                    providerRequest:{...server.providerRequest,instructions:server.providerRequest.instructions+'\nSynthetic prompt line\n'.repeat(3000)+'prompt-tail',reasoning:'synthetic-hidden-reasoning'},
                    context:{...server.context,note:'Synthetic context line\n'.repeat(3000)+'context-tail'},
                    response:{translation:'Synthetic response line\n'.repeat(3000)+'response-tail',reasoning:'synthetic-hidden-reasoning',apiKey:'synthetic-secret'}}}};
                window.__fixtureCopied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__fixtureCopied.push(text);}}});
            });
            const beforeCopy=await page.locator('.ctMtlDebugDialog').boundingBox(),selectedBeforeCopy=await page.evaluate(()=>window.__mtlApp.ctSelection);
            const debugText=section=>page.locator('.ctMtlDebugDialog pre[aria-label="'+(section==='request'?'Selected request fields':'Displayed MTL '+section)+'"]');
            for(const section of ['prompt','context','request','response']){
                const box=debugText(section),text=await box.textContent(),button=page.getByRole('button',{name:'Copy '+section,exact:true});
                assert.ok(text.length>30000);assert.match(text,new RegExp(section+'-tail'));assert.doesNotMatch(text,/synthetic-secret|synthetic-hidden-reasoning|synthetic-connection-config/);
                const metrics=await box.evaluate(node=>({height:node.getBoundingClientRect().height,client:node.clientHeight,scroll:node.scrollHeight,overflow:getComputedStyle(node).overflowY}));
                assert.ok(metrics.height<=360&&metrics.scroll>metrics.client,section+' JSON has bounded internal overflow');assert.equal(metrics.overflow,'auto');
                const copiedCount=await page.evaluate(()=>window.__fixtureCopied.length);
                await button.focus();await button.press('Enter');await page.waitForFunction(count=>window.__fixtureCopied.length===count+1,copiedCount);
                assert.equal(await page.evaluate(()=>window.__fixtureCopied.at(-1)),text,'Copy uses full displayed '+section);
                assert.equal(await button.locator('..').getByRole('status').textContent(),'Copied');
                assert.equal(await button.evaluate(node=>node===document.activeElement),true,'Keyboard copy retains focus');
                await box.focus();await box.evaluate(node=>{node.scrollTop=0;});await box.press('PageDown');
                await page.waitForFunction(label=>document.querySelector('pre[aria-label="'+label+'"]').scrollTop>0,await box.getAttribute('aria-label'));
                await box.evaluate(node=>{node.scrollTop=0;});const bounds=await box.boundingBox(),bodyScroll=await page.locator('.ctMtlDebugBody').evaluate(node=>node.scrollTop);
                await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.wheel(0,180);
                await page.waitForFunction(label=>document.querySelector('pre[aria-label="'+label+'"]').scrollTop>0,await box.getAttribute('aria-label'));
                assert.equal(await page.locator('.ctMtlDebugBody').evaluate(node=>node.scrollTop),bodyScroll,'Pointer scroll stays inside '+section+' JSON');
            }
            assert.deepEqual(await page.locator('.ctMtlDebugDialog').boundingBox(),beforeCopy,'Copy controls do not drag the dialog');
            await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('Synthetic clipboard denial');};});
            for(const section of ['context','request','response']){
                const button=page.getByRole('button',{name:'Copy '+section,exact:true});await button.click();
                await page.waitForFunction(label=>document.activeElement?.getAttribute('aria-label')===label,await debugText(section).getAttribute('aria-label'));
                assert.match(await button.locator('../..').getByRole('alert').textContent(),/Could not copy automatically.*Ctrl\+C/);
                assert.equal(await page.evaluate(()=>getSelection().toString()),await debugText(section).textContent(),'Manual fallback selects the complete '+section+' including overflow');
            }
            assert.equal(await page.evaluate(()=>window.__mtlApp.ctSelection),selectedBeforeCopy);assert.equal(await page.evaluate(()=>window.__mtlApp.ctInlineClosed),false,'Copy actions preserve the inline editor');
            for(const theme of ['light','grey','dark','modern-dark']){
                await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
                await page.screenshot({path:join(outDir,mode+'-debug-'+theme+'.png'),fullPage:true});
            }
            await page.setViewportSize({width:920,height:650});
            await page.waitForFunction(()=>{const r=document.querySelector('.ctMtlDebugDialog').getBoundingClientRect();return r.x>=7&&r.y>=7&&r.right<=913&&r.bottom<=643;});
            const resized=await page.locator('.ctMtlDebugDialog').boundingBox();assert.ok(resized.x>=7&&resized.y>=7&&resized.x+resized.width<=913&&resized.y+resized.height<=643,'Resized desktop keeps dialog reachable');
            await page.setViewportSize({width:920,height:420});
            await page.waitForFunction(()=>{const r=document.querySelector('.ctMtlDebugDialog').getBoundingClientRect();return r.y>=7&&r.bottom<=413;});
            for(const section of ['prompt','context','request','response']){
                const box=debugText(section);await box.scrollIntoViewIfNeeded();
                assert.ok((await box.boundingBox()).height<=168.5,section+' JSON height follows a short desktop viewport');
            }
            const shortHeader=await page.locator('.ctMtlDebugHeader').boundingBox(),shortBody=await page.locator('.ctMtlDebugBody').evaluate(node=>({client:node.clientHeight,scroll:node.scrollHeight}));
            assert.ok(shortHeader.y>=7&&shortHeader.height>=38&&shortBody.client>100&&shortBody.scroll>shortBody.client,'Short-screen dialog retains its header and scrollable body');
            await page.screenshot({path:join(outDir,mode+'-debug-short.png'),fullPage:true});
            await page.getByRole('button',{name:'Close request details',exact:true}).focus();await page.keyboard.press('Escape');
            assert.equal(await page.locator('.ctMtlDebugButton').evaluate(node=>node===document.activeElement),true,'Large JSON dialog restores trigger focus');
            await page.locator('.ctMtlDebugButton').click();await page.waitForFunction(()=>!!window.__mtlApp.ctMtlDebugWindow?.record.server);
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
            await page.waitForFunction(()=>window.__mtlApp._fixtureReleases.length===1);await target().evaluate(input=>{const app=window.__mtlApp,field=app.ctCurrentUnit.fields[0];app.ctValues[field.id]='New ordinary {0}';app.ctEdited(field);});
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
            for(const full of [false,true]){
                await page.evaluate(async({mode,full})=>{const app=window.__mtlApp;await app.configure(mode);app.ctEditor=full;},{mode,full});
                await target().fill('Archive underlying draft {0}');
                const reviewedBeforeArchive=await page.evaluate(()=>JSON.stringify(window.__mtlApp.ctReviewed));
                await page.locator('.ctMtlButton').click();await page.waitForFunction(()=>window.__mtlApp.snapshot().visible==='Generated {0}');
                await target().fill('Rejected edited translation {0}');
                await page.evaluate(()=>{window.__mtlApp._fixtureArchiveFailures=1;window.__mtlApp._fixtureArchiveDefer=true;});
                await page.getByRole('button',{name:'Dismiss',exact:true}).click();
                await page.waitForFunction(()=>window.__mtlApp._fixtureArchiveReleases.length===1);
                assert.equal(await page.evaluate(()=>window.__mtlApp.ctMtlDismiss(window.__mtlApp.ctCurrentUnit.fields[0])),false,'Repeated Dismiss cannot stage a second archive');
                await page.evaluate(()=>{const app=window.__mtlApp;app._fixtureArchiveDefer=false;app._fixtureArchiveReleases.shift()();});
                await page.waitForFunction(()=>window.__mtlApp.ctMtlDismissals[0]?.state==='archive-pending');
                assert.match(await page.locator('.ctMtlDismissal').textContent(),/file is still pending/);
                assert.equal((await snapshot()).underlying,'Archive underlying draft {0}');
                assert.equal(await page.evaluate(()=>JSON.stringify(window.__mtlApp.ctReviewed)),reviewedBeforeArchive);
                assert.equal(await page.evaluate(()=>window.__mtlApp.exportTarget()),'Confirmed {0}','Rejected text and pending archive never export');
                assert.equal(await page.locator('.ctMtlButton').isDisabled(),true,'Pending archive cannot be replaced by generation');
                assert.equal((await page.locator('.ctMtlDismissal').textContent()).includes('closing or reloading loses'),mode==='memory');
                const firstDismissal=await page.evaluate(()=>JSON.stringify(window.__mtlApp._fixtureDismissals[0]));
                const firstBody=JSON.parse(firstDismissal).body;assert.equal(firstBody.reviewedText,'Rejected edited translation {0}');
                if(mode==='memory')assert.equal(firstBody.generatedText,'Generated {0}');else assert.equal(firstBody.generatedText,undefined);
                for(const theme of ['light','grey','dark','modern-dark']){
                    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
                    await page.screenshot({path:join(outDir,mode+'-'+(full?'full':'inline')+'-archive-pending-'+theme+'.png'),fullPage:true});
                }
                await page.evaluate(()=>{window.__mtlApp._fixtureArchiveLostAcks=1;});
                await page.getByRole('button',{name:'Retry dismissal upload',exact:true}).focus();await page.keyboard.press('Enter');
                await page.waitForFunction(()=>window.__mtlApp.ctMtlDismissals[0]?.state==='uncertain');
                assert.equal(await target().evaluate(node=>node===document.activeElement),true,'Retry preserves field focus');
                await page.getByRole('button',{name:'Retry dismissal upload',exact:true}).click();await page.waitForFunction(()=>!window.__mtlApp.ctMtlDismissals.length);
                assert.equal(await page.locator('.ctMtlDismissal').count(),0);assert.equal(await page.locator('.ctMtlButton').isDisabled(),false);
                const requests=await page.evaluate(()=>window.__mtlApp._fixtureDismissals.map(value=>JSON.stringify(value)));
                assert.deepEqual(requests,[firstDismissal,firstDismissal,firstDismissal],'503, lost acknowledgement and success reuse the exact command');
                assert.equal(await page.evaluate(()=>window.__mtlApp.ctInlineClosed),false);assert.equal((await snapshot()).error,'');
                if(mode==='memory'){
                    await page.evaluate(async()=>{await window.__mtlApp.configure('memory');});await page.locator('.ctMtlButton').click();
                    await page.waitForFunction(()=>window.__mtlApp.snapshot().visible==='Generated {0}');
                    await page.context().setOffline(true);await page.getByRole('button',{name:'Dismiss',exact:true}).click();
                    await page.waitForFunction(()=>window.__mtlApp.ctMtlDismissals.length===1);
                    assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureDismissals.length),0,'Offline local dismissal performs no network request');
                    assert.match(await page.locator('.ctMtlDismissal').textContent(),/closing or reloading loses/);
                    await page.context().setOffline(false);await page.waitForFunction(()=>!window.__mtlApp.ctMtlDismissals.length);
                    assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureDismissals.length),1,'Reconnect sends the single original local dismissal');
                }
            }
            for(const full of [false,true]){
                await page.evaluate(async ({mode,full})=>{const app=window.__mtlApp;await app.configure(mode);app.ctEditor=full;if(mode==='memory'&&!full)app.cloudUser={...app.cloudUser,role:'admin',isAdmin:true};app._fixtureAsync=true;app.ctMtlCapabilities={enabled:true,reviewArchive:true,consentVersion:'mtl-v2',delivery:'poll-v1'};},{mode,full});
                const memoryBeforeProgress=await page.evaluate(()=>window.__mtlApp.memoryCount());
                await target().fill('Original draft {0}');await target().focus();await page.locator('.ctMtlButton').click();
                await page.waitForSelector('.ctMtlSkeleton');await page.waitForFunction(()=>Object.values(window.__mtlApp.ctMtlLive).some(value=>value.canCancel));assert.equal(await target().getAttribute('readonly'),'');
                assert.equal(await page.locator('.ctMtlLiveButton,.ctMtlProgressPopup').count(),0,'No additional progress button or popup');
                assert.equal(await target().inputValue(),'Original draft {0}','Skeleton never replaces the native draft value');
                await target().press('x');assert.equal(await target().inputValue(),'Original draft {0}','Generating field is read-only');
                assert.equal(await page.locator('.fieldStyleButton:enabled').count(),0,'Formatting cannot change the generating field');
                await page.emulateMedia({reducedMotion:'reduce'});
                assert.equal(await page.locator('.ctMtlSkeleton i').first().evaluate(node=>getComputedStyle(node).animationName),'none');
                await page.emulateMedia({reducedMotion:'no-preference'});
                await page.evaluate(()=>{const job=window.__mtlApp._fixtureLive;job.revision++;job.phase='retrieving';});
                await page.waitForFunction(()=>Object.values(window.__mtlApp.ctMtlLive).some(value=>value.phase==='retrieving'));
                assert.equal(await page.locator('.ctMtlInlineOverlay').getAttribute('title'),'Looking up workbook context');
                assert.equal(await target().inputValue(),'Original draft {0}','Retrieval never changes the native draft');
                for(const theme of ['light','grey','dark','modern-dark']){
                    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
                    await page.screenshot({path:join(outDir,mode+'-'+(full?'full':'inline')+'-skeleton-'+theme+'.png'),fullPage:true});
                }
                assert.equal(await page.evaluate(()=>window.__mtlApp.exportTarget()),'Confirmed {0}','Provisional work cannot export');
                await page.evaluate(()=>{const job=window.__mtlApp._fixtureLive;job.revision++;job.phase='generating';job.text='Readable <img src=x onerror="window.__progressXss=true"> {0}\nNext \\ line';});
                await page.waitForSelector('.ctMtlStreamText');assert.equal(await page.locator('.ctMtlSkeleton').count(),0);
                assert.equal(await page.locator('.ctMtlInlineOverlay img').count(),0);assert.equal(await page.evaluate(()=>window.__progressXss),undefined);
                assert.match(await page.locator('.ctMtlStreamText').textContent(),/\nNext \\ line/);assert.equal(await target().inputValue(),'Original draft {0}');
                assert.equal((await snapshot()).candidates,0);assert.equal(await page.evaluate(()=>window.__mtlApp.memoryCount()),memoryBeforeProgress);
                if(mode==='memory'&&!full){await page.waitForFunction(()=>Object.values(window.__mtlApp.ctMtlDebugRecords).some(record=>record.browserTiming?.milestonesMs.firstTextFrameReady!==null));
                    const timing=await page.evaluate(()=>Object.values(window.__mtlApp.ctMtlDebugRecords).find(record=>record.browserTiming)?.browserTiming);
                    assert.ok(timing.milestonesMs.firstTextFrameReady>=timing.milestonesMs.firstProgress);assert.equal(timing.outcome,'running');}
                for(const theme of ['light','grey','dark','modern-dark']){
                    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
                    await page.screenshot({path:join(outDir,mode+'-'+(full?'full':'inline')+'-stream-'+theme+'.png'),fullPage:true});
                }
                await page.evaluate(()=>{window.__mtlApp._fixturePollErrors=1;});
                await page.waitForFunction(()=>Object.values(window.__mtlApp.ctMtlLive).some(value=>value.phase==='reconnecting'));
                assert.match(await page.locator('.ctMtlStreamText').textContent(),/Readable/);
                await page.waitForFunction(()=>Object.values(window.__mtlApp.ctMtlLive).some(value=>value.phase==='receiving'));
                assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureStarts),1,'Reconnect uses the existing request');
                await page.evaluate(()=>{window.__mtlApp._fixtureCancelDefer=true;document.body.style.minHeight='1800px';window.scrollTo(0,30);});
                const beforeStop=await page.evaluate(()=>({scroll:window.scrollY,selection:window.__mtlApp.ctSelection,field:window.__mtlApp.ctFocusedField}));
                const stop=page.getByRole('button',{name:'Stop translation',exact:true});await stop.focus();await stop.press('Enter');
                await page.waitForFunction(()=>window.__mtlApp._fixtureCancels===1);assert.equal(await page.locator('.ctMtlInlineOverlay').count(),0,'Stop reveals the original draft immediately');
                assert.equal(await target().inputValue(),'Original draft {0}');assert.equal(await page.locator('.ctMtlButton').isDisabled(),true);
                assert.equal(await page.evaluate(()=>document.activeElement===document.body),false,'Keyboard Stop retains toolbar focus');
                await page.keyboard.press('Enter');await page.locator('.ctMtlButton').evaluate(node=>node.click());await page.waitForTimeout(300);
                assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureCancels),1,'Repeated Stop sends one cancellation');
                await page.evaluate(()=>{window.__mtlApp._fixtureCancelReleases.shift()();window.__mtlApp._fixtureCancelDefer=false;});
                await page.waitForFunction(()=>!Object.keys(window.__mtlApp.ctMtlRequests).length);await page.waitForFunction(()=>document.querySelector('.ctMtlButton')===document.activeElement);
                assert.equal(await target().getAttribute('readonly'),null);assert.equal((await snapshot()).candidates,0);
                assert.deepEqual(await page.evaluate(()=>({scroll:window.scrollY,selection:window.__mtlApp.ctSelection,field:window.__mtlApp.ctFocusedField})),beforeStop);
                assert.equal(await page.evaluate(()=>window.__mtlApp.ctInlineClosed),false);await page.evaluate(()=>{document.body.style.minHeight='';window.scrollTo(0,0);});
                await page.locator('.ctMtlButton').click();await page.waitForSelector('.ctMtlSkeleton');await page.waitForFunction(()=>Object.values(window.__mtlApp.ctMtlLive).some(value=>value.canCancel));await page.evaluate(()=>{window.__mtlApp._fixtureCancelFailures=1;});
                await page.getByRole('button',{name:'Stop translation',exact:true}).click();
                await page.waitForFunction(()=>window.__mtlApp.ctMtlError.includes('stop request could not be confirmed'));
                assert.equal(await target().getAttribute('readonly'),'','Unconfirmed cancellation keeps the active field read-only');
                await page.getByRole('button',{name:'Stop translation',exact:true}).click();await page.waitForFunction(()=>!Object.keys(window.__mtlApp.ctMtlRequests).length);
                assert.equal(await target().getAttribute('readonly'),null);assert.equal(await target().inputValue(),'Original draft {0}');
                await page.locator('.ctMtlButton').click();await page.waitForSelector('.ctMtlSkeleton');await page.waitForFunction(()=>Object.values(window.__mtlApp.ctMtlLive).some(value=>value.canCancel));
                await page.evaluate(()=>{const job=window.__mtlApp._fixtureLive;job.revision++;job.phase='generating';job.text='Generated {0}';job.complete=true;});
                await page.waitForFunction(()=>window.__mtlApp.snapshot().visible==='Generated {0}');
                assert.equal(await target().getAttribute('readonly'),null);assert.equal(await page.locator('.ctMtlInlineOverlay').count(),0);
                assert.equal((await snapshot()).underlying,'Original draft {0}');assert.equal(await page.evaluate(()=>window.__mtlApp.exportTarget()),'Confirmed {0}');
                assert.equal(await page.getByRole('button',{name:'Accept',exact:true}).count(),1,'Validated completion enters usual review');
                await page.getByRole('button',{name:'Dismiss',exact:true}).click();await page.waitForFunction(()=>window.__mtlApp.snapshot().candidates===0);
                await page.locator('.ctMtlButton').click();await page.waitForSelector('.ctMtlSkeleton');await page.waitForFunction(()=>Object.values(window.__mtlApp.ctMtlLive).some(value=>value.canCancel));
                await page.evaluate(()=>{const job=window.__mtlApp._fixtureLive;job.generatedText='Invalid missing token';job.complete=true;});
                await page.waitForFunction(()=>!Object.keys(window.__mtlApp.ctMtlRequests).length);
                assert.equal(await target().getAttribute('readonly'),null);assert.equal(await target().inputValue(),'Original draft {0}');assert.equal((await snapshot()).candidates,0);
                await page.evaluate(()=>window.__mtlApp.fixtureExplicitActions());
                const beforeExplicit=await page.evaluate(()=>window.__mtlApp.fixtureEditSnapshot());
                await page.locator('.ctTarget .fieldHistoryMenuButton').click();
                await page.locator('.ctMtlButton').click();await page.waitForFunction(()=>Object.values(window.__mtlApp.ctMtlLive).some(value=>value.canCancel));
                assert.equal(await page.getByRole('button',{name:'Use previous saved text',exact:true}).isDisabled(),true);
                assert.equal(await page.getByRole('button',{name:'Keep incoming',exact:true}).isDisabled(),true);
                assert.equal(await page.getByRole('button',{name:'Restore after',exact:true}).isDisabled(),true);
                assert.equal(await page.getByRole('button',{name:'Restore before',exact:true}).isDisabled(),true);
                assert.deepEqual(await page.evaluate(async()=>{const app=window.__mtlApp,field=app.ctCurrentUnit.fields[0];return[app.ctChooseAlternative(app.ctChoices[0],'local'),app.ctMarkReviewed(field),await app.ctRestoreHistory(app.ctHistory[0])];}),[false,false,false]);
                assert.equal(await page.evaluate(()=>window.__mtlApp.fixtureEditSnapshot()),beforeExplicit,'Busy explicit actions cannot mutate draft, choices, Saved work, history or outbox');
                assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureConfirmCalls),0);assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureRestoreSaves),0);
                await page.getByRole('button',{name:'Stop translation',exact:true}).click();await page.waitForFunction(()=>!Object.keys(window.__mtlApp.ctMtlRequests).length);
                assert.equal(await target().inputValue(),'Original draft {0}');assert.equal(await page.getByRole('button',{name:'Use previous saved text',exact:true}).isEnabled(),true);
                assert.equal(await page.getByRole('button',{name:'Restore after',exact:true}).isEnabled(),true);
                for(const finishBeforeConfirm of [false,true]){
                    await page.evaluate(()=>{const app=window.__mtlApp;app._fixtureRestoreConfirm=null;app.appConfirm=()=>{app._fixtureConfirmCalls++;return new Promise(resolve=>app._fixtureRestoreConfirm=resolve);};});
                    await page.getByRole('button',{name:'Restore after',exact:true}).click();await page.waitForFunction(()=>typeof window.__mtlApp._fixtureRestoreConfirm==='function');
                    await page.locator('.ctMtlButton').click();await page.waitForFunction(()=>Object.values(window.__mtlApp.ctMtlLive).some(value=>value.canCancel));
                    if(finishBeforeConfirm){await page.getByRole('button',{name:'Stop translation',exact:true}).click();await page.waitForFunction(()=>!Object.keys(window.__mtlApp.ctMtlRequests).length);}
                    assert.equal(await page.evaluate(async()=>{const app=window.__mtlApp;app._fixtureRestoreConfirm(true);return await app._fixtureRestoreTask;}),false,'Generation beginning during confirmation invalidates Restore');
                    if(!finishBeforeConfirm){await page.getByRole('button',{name:'Stop translation',exact:true}).click();await page.waitForFunction(()=>!Object.keys(window.__mtlApp.ctMtlRequests).length);}
                    assert.equal(await page.evaluate(()=>window.__mtlApp.fixtureEditSnapshot()),beforeExplicit,'Late confirmation leaves the original draft and durable Saved work unchanged');
                    assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureRestoreSaves),0);assert.equal(await page.evaluate(()=>window.__mtlApp._fixtureReplacements),0);
                    assert.equal(await target().getAttribute('readonly'),null);assert.equal(await target().inputValue(),'Original draft {0}');
                }
                await page.evaluate(()=>window.__mtlApp.fixtureFinishExplicitActions());
                await page.locator('.ctMtlButton').click();await page.waitForSelector('.ctMtlSkeleton');await page.waitForFunction(()=>Object.values(window.__mtlApp.ctMtlLive).some(value=>value.canCancel));
                await page.evaluate(()=>{window.__mtlApp.cloudSignedIn=false;});await page.waitForFunction(()=>!Object.keys(window.__mtlApp.ctMtlRequests).length);
                assert.equal(await page.locator('.ctMtlInlineOverlay').count(),0);assert.equal(await target().getAttribute('readonly'),null);assert.equal(await target().inputValue(),'Original draft {0}');
                results.push({mode,editor:full?'full':'inline',themes:4,archive:['original and edited rejection separate','one dismissal command','503 file pending','lost acknowledgement exact retry','keyboard retry focus','pending upload blocks generation','private archive receipt',...(mode==='memory'?['offline memory queue','online same command']:[])],stream:['skeleton','read-only','escaped text','reduced motion','reconnect same request','keyboard spinner cancellation','repeated cancellation','cancel failure/retry','draft restored','validated completion','invalid completion','choice/review/restore guards','pending confirmation guard','completed-during-confirmation guard','Saved/history/outbox unchanged','logout clears'],exports:'original until Accept and Save'});
            }
        }
        assert.deepEqual(external,[],'No external request is made');assert.deepEqual(errors,[],'Real native controls render without page errors');
        const report={passed:true,visibilityChecks:['Translator/Manager require explicit assignment; selected language and Manager all-language access are independent','unassigned Admin visible; readiness still disables unavailable actions','live assignment, role, account and sign-out changes in memory/IndexedDB and inline/full editors','hidden F8 makes no request; review controls, counts and filters hidden together','ordinary drafts, separate reviews, field DOM and focus retained','25x25 square SVG icon, 560/800/1440 desktop widths and all four themes; existing spinner and keyboard/pointer cancellation'],debugJsonChecks:['absent response has no copy action','full sanitized prompt/context/request/response copies including overflow','Copied feedback and retained keyboard focus','keyboard and pointer internal scrolling','clipboard denial selects complete JSON for manual copy','four themes and 920x420 viewport','drag and Escape focus restoration','role change clears details'],modelSettingsChecks:['Admin-only toolbar bar','model and effort selection','Luna none/low/medium available','Sol/medium default retained','unverified Fast disabled','four themes and desktop resize','Escape restores focus','draft unchanged'],timingChecks:['separate Admin panel with unavailable preview milestones','four themed timing tables and exact request correlation','first provisional frame after nonempty progress; no paint claim','ordinary roles hidden and context fence clears records'],results,externalRequests:external,pageErrors:errors};writeFileSync(join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    }catch(error){
        const page=browser?.contexts()[0]?.pages()[0];
        if(page){await page.screenshot({path:join(outDir,'failure.png'),fullPage:true});console.error(await page.evaluate(()=>({
            inlineClosed:window.__mtlApp?.ctInlineClosed,editor:window.__mtlApp?.ctEditor,active:window.__mtlApp?.ctActive,
            signedIn:window.__mtlApp?.cloudSignedIn,role:window.__mtlApp?.cloudUser?.role,debugAllowed:window.__mtlApp?.ctMtlDebugAllowed,
            targetCount:document.querySelectorAll('[data-ct-target]').length,focused:document.activeElement?.outerHTML.slice(0,160)})));}
        throw error;
    }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
