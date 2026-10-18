'use strict';
// Synthetic scoped API and ordinary field; no authentication, storage or inference.
const assert=require('node:assert/strict'),{readFileSync,existsSync,mkdirSync,writeFileSync}=require('node:fs'),{join}=require('node:path'),{createServer}=require('node:http');
const express=require('express'),rootDir=join(__dirname,'..'),publicDir=join(rootDir,'public'),outDir=join(rootDir,'temp/character-tone-notes-fixture');
const modules='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||require.resolve('playwright',{paths:[modules]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync),vuePath=process.env.FIXTURE_VUE_PATH||join(rootDir,'temp/clienttext-fixture-vue.min.js');
async function run(){
    assert.ok(executablePath&&existsSync(vuePath));mkdirSync(outDir,{recursive:true});const html=readFileSync(join(publicDir,'index.html'),'utf8');
    const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"/:]+\.css)"[^>]*>/g)].map(match=>match[0].replace('href="','href="/')).join('\n');
    const fixture=String.raw`(()=>{
const detach=value=>JSON.parse(JSON.stringify(value));
const P='Metadata/NPC/Synthetic/First',Q='Metadata/NPC/Synthetic/Second',key='npc:'+P;
const field={id:'text',name:'Text',kind:'text',source:'Synthetic English {0}',target:'Original translation {0}',sourceCell:'B2',targetCell:'C2'},
 line={id:'line',role:'normal',sheet:'NPCTextAudio',recordId:'SyntheticLine',metadata:{Speaker:P,Listener:Q},fields:[field]},
 npc=(path,name)=>({id:path,role:'normal',sheet:'NPCs',recordId:path,fields:[{...field,name:'Name',source:name}]});
const app=Vue.createApp({mixins:[ClientTextToneNotesUI.mixin],data(){return{ctActive:true,ctSelection:'line',ctRevision:0,ctCurrentUnit:line,ctUnits:[line,npc(P,'First guard'),npc(Q,'Second guard')],
 ctWorkspace:{scope:{accountId:'synthetic-account',game:'poe2',branchId:'default',language:'Thai',versionId:'synthetic-v1',groupId:'local:synthetic'}},
 lang:'Thai',gameVersion:'poe2',branchId:'default',cloudSignedIn:true,cloudProfileId:'synthetic-account',cloudUser:{id:'synthetic-account',role:'translator',language:'Thai',assignmentVersion:1},privateMediaEpoch:1,ordinary:field.target};},
 methods:{ctContext(){return{scope:detach(this.ctWorkspace.scope),epoch:this._fixtureEpoch};},ctCurrent(ctx){return ctx.epoch===this._fixtureEpoch&&JSON.stringify(ctx.scope)===JSON.stringify(this.ctWorkspace.scope);},
 async configure(role='translator'){
  this.ctToneReset(true);this._fixtureEpoch=(this._fixtureEpoch||0)+1;this.cloudSignedIn=true;this.cloudUser={id:'synthetic-account',role,language:'Thai',isAdmin:role==='admin',assignmentVersion:1};
  this.ctCurrentUnit=line;this.ctUnits=[line,npc(P,'First guard'),npc(Q,'Second guard')];
  this.ctSelection='line';this.lang='Thai';this.ctWorkspace.scope={accountId:'synthetic-account',game:'poe2',branchId:'default',language:'Thai',versionId:'synthetic-v1',groupId:'local:synthetic'};
  this.ordinary=field.target;this._fixtureNotes=new Map();this._fixtureHistory=new Map();this._fixtureReceipts=new Map();this._fixtureRequests=[];this._fixtureMode='normal';this._fixtureDefer=false;this._fixtureReleases=[];
  this._cloud=Vue.markRaw({epoch:1,request:async(path,options={})=>{
   this._fixtureRequests.push({path,method:options.method||'GET',body:options.body&&detach(options.body)});
   if(this._fixtureDefer)await new Promise(resolve=>this._fixtureReleases.push(resolve));
   const url=new URL(path,'https://synthetic.invalid'),identityKey=url.searchParams.get('identityKey')||options.body?.identityKey,
    current=()=>this._fixtureNotes.get(identityKey)||{identityKey,text:'',revision:0},reply=appliedRevision=>({scope:ClientTextToneNotes.scope(this.ctWorkspace.scope),note:detach(current()),...(appliedRevision?{appliedRevision}:{})});
   if(options.method!=='PUT'){
    if(this._fixtureMode==='read-error')throw new TypeError('Synthetic read interruption');
    if(this._fixtureMode==='read-denied')throw Object.assign(new Error('Synthetic private response must stay hidden'),{status:403,code:'LANGUAGE_FORBIDDEN'});
    if(this._fixtureMode==='branch-missing')throw Object.assign(new Error('Synthetic private response must stay hidden'),{status:404,code:'BRANCH_NOT_FOUND'});
    if(url.pathname.endsWith('/history'))return{scope:ClientTextToneNotes.scope(this.ctWorkspace.scope),identityKey,entries:detach(this._fixtureHistory.get(identityKey)||[]),nextCursor:null};
    return reply();
   }
   const body=options.body,receipt=this._fixtureReceipts.get(body.mutationId);if(receipt)return reply(receipt.revision);
   if(body.baseRevision!==current().revision)throw Object.assign(new Error('Synthetic conflict'),{status:409,code:'MTL_TONE_NOTE_CHANGED',current:detach(current())});
   const next={scope:detach(body.scope),identityKey,text:ClientTextToneNotes.normalize(body.text),revision:body.baseRevision+1,updatedAt:1800000000000,author:{name:'Synthetic contributor'}};
   this._fixtureNotes.set(identityKey,next);this._fixtureHistory.set(identityKey,[next,...(this._fixtureHistory.get(identityKey)||[])]);this._fixtureReceipts.set(body.mutationId,{revision:next.revision});
   if(this._fixtureMode==='lost-ack'){this._fixtureMode='normal';throw new TypeError('Synthetic lost acknowledgement');}return reply(next.revision);
  }});await this.$nextTick();
 },
 context(){return ClientTextMtlContext.build({unit:line,field,units:this.ctUnits,scope:this.ctWorkspace.scope,toneNotes:this.ctToneNotesSnapshot()});},
 peer(text){const old=this._fixtureNotes.get(key)||{revision:0};this._fixtureNotes.set(key,{identityKey:key,text,revision:old.revision+1,updatedAt:1800000000001,author:{name:'Synthetic peer'}});}
 },template:'<main class="appRoot" style="padding:28px;max-width:1000px"><h1>Synthetic character context</h1><section class="editorSourceField"><pre>Synthetic English {0}</pre><ct-tone-notes-button :host="$root"></ct-tone-notes-button></section><label>Ordinary translation<textarea id="ordinary" v-model="ordinary"></textarea></label><ct-tone-notes-dialog v-if="ctToneWindow" ref="ctToneDialog" :host="$root"></ct-tone-notes-dialog></main>'});
app.component('ct-tone-notes-button',ClientTextToneNotesUI.Button);app.component('ct-tone-notes-dialog',ClientTextToneNotesUI.Dialog);
window.__toneApp=app.mount('#app');window.__toneApp.configure().then(()=>window.__toneReady=true);
})()`;
    writeFileSync(join(outDir,'fixture.js'),fixture);const frontend=express(),server=createServer(frontend),errors=[],external=[],checks=[];
    const scripts=['clientTextState.js','clientTextMtlContext.js','clientTextToneNotes.js','clientTextToneNotesUi.js'];
    frontend.get('/',(_req,res)=>res.type('html').send('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">'+styles+'</head><body><div id="app"></div><script src="/fixture-vue.js"></script>'+scripts.map(src=>'<script src="/'+src+'"></script>').join('')+'<script src="/fixture.js"></script></body></html>'));
    frontend.get('/fixture-vue.js',(_req,res)=>res.type('js').send(readFileSync(vuePath)));frontend.get('/fixture.js',(_req,res)=>res.type('js').send(fixture));frontend.use(express.static(publicDir));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
    try{
        browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
        page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.origin);return route.abort();}return route.continue();});
        await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__toneReady);
        const open=async()=>{await page.getByRole('button',{name:'Character tone notes',exact:true}).click();try{await page.waitForFunction(()=>window.__toneApp.ctToneCurrent?.loaded);}catch(error){console.error('Synthetic tone state',await page.evaluate(()=>{const app=window.__toneApp;return{allowed:app.ctToneAllowed,current:app.ctToneCurrent,window:app.ctToneWindow,requests:app._fixtureRequests,context:app.ctContext(),fence:app.ctToneFenceKey};}));throw error;}},text=()=>page.locator('#ct-tone-text'),save=()=>page.getByRole('button',{name:'Save note',exact:true});
        await open();assert.equal(await text().inputValue(),'');assert.match(await text().getAttribute('placeholder'),/^ตัวอย่าง:/);assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
        assert.equal(await text().evaluate(node=>node===document.activeElement),true,'initial read hands focus to the editor');
        await save().evaluate(node=>node.click());assert.equal(await page.evaluate(()=>window.__toneApp._fixtureNotes.size),0);assert.equal(await page.evaluate(()=>window.__toneApp.context().sharedToneNotes),undefined);
        await text().fill('  ก้าวร้าว ใช้สรรพนามตรงไปตรงมา <img src=x onerror=alert(1)>  ');assert.equal(await page.evaluate(()=>window.__toneApp.context().sharedToneNotes),undefined);
        await text().press('Control+s');await page.waitForFunction(()=>window.__toneApp.ctToneCurrent?.saved?.revision===1&&!window.__toneApp.ctToneCurrent.saving);
        assert.equal(await save().evaluate(node=>node===document.activeElement),true,'keyboard Save preserves stable focus');
        assert.equal((await page.evaluate(()=>window.__toneApp.context().sharedToneNotes.entries))[0].text.startsWith('  ก้าวร้าว'),true);
        await page.getByText('Revision history',{exact:true}).click();await page.waitForFunction(()=>window.__toneApp.ctToneCurrent.historyLoaded);
        assert.match(await page.locator('.ctToneHistory').textContent(),/Synthetic contributor/);assert.equal(await page.locator('.ctToneHistory img').count(),0,'history renders literal markup safely');
        await text().fill('Unsaved private wording');await page.getByRole('button',{name:'Close tone notes'}).click();await open();assert.equal(await text().inputValue(),'Unsaved private wording');
        await text().fill('😀'.repeat(301));assert.match(await page.locator('#ct-tone-counter').innerText(),/301 \/ 300/);assert.equal(await save().getAttribute('aria-disabled'),'true');
        const writesBefore=await page.evaluate(()=>window.__toneApp._fixtureRequests.filter(value=>value.method==='PUT').length);await text().press('Control+s');assert.equal(await page.evaluate(()=>window.__toneApp._fixtureRequests.filter(value=>value.method==='PUT').length),writesBefore);
        await text().fill('😀'.repeat(300));await text().press('Control+s');await page.waitForFunction(()=>window.__toneApp.ctToneCurrent.saved.revision===2&&!window.__toneApp.ctToneCurrent.saving);
        assert.equal(await text().getAttribute('maxlength'),null);checks.push('empty examples never saved or injected; explicit Save only; literal history with author/time; Unicode limits and focus');
        await text().fill('My new style');await page.evaluate(()=>window.__toneApp.peer('Peer style'));
        await save().click();await page.waitForFunction(()=>!!window.__toneApp.ctToneCurrent.conflict);assert.equal(await text().inputValue(),'My new style');
        await page.getByRole('button',{name:'Keep my draft',exact:true}).click();await save().click();await page.waitForFunction(()=>window.__toneApp.ctToneCurrent.saved.text==='My new style'&&!window.__toneApp.ctToneCurrent.saving);
        await text().fill('Lost acknowledgement style');await page.evaluate(()=>{window.__toneApp._fixtureMode='lost-ack';});await save().click();await page.waitForFunction(()=>!!window.__toneApp.ctToneCurrent.pending&&!window.__toneApp.ctToneCurrent.saving);
        const before=await page.evaluate(()=>JSON.stringify(window.__toneApp._fixtureRequests.filter(value=>value.method==='PUT').at(-1).body));
        await page.getByRole('button',{name:'Retry Save note',exact:true}).click();await page.waitForFunction(()=>!window.__toneApp.ctToneCurrent.pending);
        assert.equal(await page.evaluate(()=>JSON.stringify(window.__toneApp._fixtureRequests.filter(value=>value.method==='PUT').at(-1).body)),before);
        await text().fill('');await save().click();await page.waitForFunction(()=>window.__toneApp.ctToneCurrent.saved.text===''&&!window.__toneApp.ctToneCurrent.saving);
        assert.equal(await page.evaluate(()=>window.__toneApp.context().sharedToneNotes),undefined);checks.push('stale conflict preserves drafts; lost acknowledgement retries exact command; clearing records a revision without older fallback');
        await text().fill('Offline draft');await context.setOffline(true);await page.waitForFunction(()=>window.__toneApp.ctToneOffline);
        assert.equal(await save().getAttribute('aria-disabled'),'true');assert.equal(await page.evaluate(()=>window.__toneApp.context().sharedToneNotes),undefined);
        await save().evaluate(node=>node.click());assert.equal(await text().inputValue(),'Offline draft');await context.setOffline(false);await page.waitForFunction(()=>!window.__toneApp.ctToneOffline&&!window.__toneApp.ctToneCurrent.loading);
        assert.equal(await text().inputValue(),'Offline draft');checks.push('offline status is truthful and drafts survive reconnect');
        for(const theme of ['light','grey','dark','modern-dark'])for(const width of [1440,620]){
            await page.setViewportSize({width,height:width===620?650:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
            const bounds=await page.locator('.ctToneDialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0);
            await page.screenshot({path:join(outDir,'tone-'+theme+'-'+width+'.png'),fullPage:true});
        }
        await text().focus();await text().dispatchEvent('keydown',{key:'Escape',isComposing:true,bubbles:true});assert.equal(await page.locator('.ctToneDialog').count(),1);
        await text().press('Escape');assert.equal(await page.getByRole('button',{name:'Character tone notes',exact:true}).evaluate(node=>node===document.activeElement),true);assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
        assert.equal(await page.locator('#ordinary').inputValue(),'Original translation {0}');checks.push('all themes/resized desktop; IME safe Escape; return focus; ordinary translation unchanged');
        await page.setViewportSize({width:1440,height:1000});
        for(const role of ['translator','manager','admin']){
            await page.evaluate(role=>window.__toneApp.configure(role),role);await open();assert.equal(await text().isEnabled(),true);await text().press('Escape');
        }
        await page.evaluate(async()=>{const app=window.__toneApp;await app.configure('admin');app.ctCurrentUnit={...app.ctCurrentUnit,sheet:'NPCs',recordId:'Metadata/NPC/Synthetic/First',metadata:{}};app.ctUnits=[app.ctCurrentUnit];app.cloudUser.language='German';});
        await open();assert.equal(await text().isEnabled(),true);assert.equal(await text().inputValue(),'');
        await text().fill('Synthetic Admin guidance');await page.screenshot({path:join(outDir,'tone-admin-local-partial-1440.png'),fullPage:true});
        await save().click();await page.waitForFunction(()=>window.__toneApp.ctToneCurrent.saved?.revision===1);
        await text().press('Escape');checks.push('configured Admin can edit and save an absent note from a local partial workbook in another selected language');
        for(const [mode,message]of [['read-denied',/server denied access/i],['branch-missing',/branch is unavailable/i]]){
            await page.evaluate(async mode=>{await window.__toneApp.configure('admin');window.__toneApp._fixtureMode=mode;},mode);
            await page.getByRole('button',{name:'Character tone notes',exact:true}).click();
            await page.waitForFunction(()=>!!window.__toneApp.ctToneCurrent?.loadError&&!window.__toneApp.ctToneCurrent.loading);
            assert.equal(await text().isDisabled(),true);assert.match(await page.locator('#ct-tone-state').innerText(),message);
            assert.doesNotMatch(await page.locator('.ctToneDialog').innerText(),/private response must stay hidden/);
            await page.screenshot({path:join(outDir,'tone-admin-'+mode+'-1440.png'),fullPage:true});
            await page.evaluate(()=>window.__toneApp._fixtureMode='normal');await page.getByRole('button',{name:'Retry loading',exact:true}).click();
            await page.waitForFunction(()=>window.__toneApp.ctToneCurrent?.loaded);assert.equal(await text().isEnabled(),true);await text().press('Escape');
        }
        checks.push('denied and missing-branch reads explain the disabled editor; Retry loading enables an absent note without a write');
        await page.evaluate(()=>{window.__toneApp.cloudUser={id:'synthetic-account',role:'translator',language:'German',assignmentVersion:1};});
        await page.getByRole('button',{name:'Character tone notes',exact:true}).click();assert.equal(await text().isDisabled(),true);assert.match(await page.locator('.ctToneDialog').innerText(),/assigned language/);
        await page.getByRole('button',{name:'Close tone notes'}).click();await page.evaluate(()=>window.__toneApp.configure());await open();await text().fill('Private draft');
        await page.evaluate(()=>{window.__toneApp.cloudSignedIn=false;});await page.waitForSelector('.ctToneDialog',{state:'detached'});assert.equal(await page.evaluate(()=>Object.keys(window.__toneApp.ctToneRecords).length),0);
        checks.push('assigned-language permissions; Manager/Admin access; logout fences and clears private drafts');
        assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const report={passed:true,checks,pageErrors:errors,externalRequests:external};writeFileSync(join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
