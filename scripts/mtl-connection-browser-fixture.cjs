'use strict';
// Synthetic Admin connection UI only. No credentials, real API, OAuth or provider calls.
const assert=require('node:assert/strict');
const {readFileSync,existsSync,mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {createServer}=require('node:http');
const express=require('express');
const runtimeModules='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||require.resolve('playwright',{paths:[runtimeModules]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH||[
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const rootDir=join(__dirname,'..'),publicDir=join(rootDir,'public'),outDir=join(rootDir,'temp/mtl-connection-fixture');
const vueScriptPath=process.env.FIXTURE_VUE_PATH||join(rootDir,'temp/clienttext-fixture-vue.min.js');
if(!executablePath||!existsSync(vueScriptPath))throw new Error('Use an installed Edge/Chrome and the cached synthetic-fixture Vue runtime.');

async function run(){
    mkdirSync(outDir,{recursive:true});
    const html=readFileSync(join(publicDir,'index.html'),'utf8');
    const matches=[...html.matchAll(/<section id="settings-panel-mtl"[\s\S]*?<\/section>/g)];
    assert.equal(matches.length,1,'Extract the integrated product MTL settings block exactly once.');
    const mtlBlock=matches[0][0],styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"/:]+\.css)"[^>]*>/g)]
        .map(match=>match[0].replace('href="','href="/')).join('\n');
    const template='<div class="settingPage settingsBackdrop"><section class="settingsDialog" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" tabindex="-1">'
        +'<header class="settingsHeader"><div><p class="settingsEyebrow">WORKSPACE PREFERENCES</p><h2 id="settingsTitle">Settings</h2></div><button class="settingsClose">Close <kbd>Esc</kbd></button></header>'
        +'<nav class="settingsTabs" role="tablist" aria-label="Settings sections"><button role="tab">General</button><button role="tab">Editor</button><button role="tab" aria-selected="true">MTL</button><button role="tab">Cloud backup</button></nav>'
        +'<div class="settingsBody">'+mtlBlock+'</div></section></div>';
    const fixture=String.raw`(()=>{
const connection=(changes={})=>({enabled:true,state:'connected',revision:4,connected:true,expiresAt:1800000000000,connectedAt:1700000000000,
 updatedAt:1750000000000,requiresReauthorization:false,remoteRevocationConfirmed:false,hostedConnectAvailable:false,bootstrap:'local-sign-in-import',canDisconnect:true,canRevoke:true,...changes});
const metadata={connected:connection(),'generation-disabled':connection({enabled:false}),
 disconnected:connection({state:'disconnected',revision:5,connected:false,canDisconnect:false,canRevoke:false,requiresReauthorization:true}),
 'revocation-failed':connection({state:'revocation-failed',revision:5,connected:false}),
 refreshing:connection({state:'refreshing',canRevoke:false}),revoking:connection({state:'revoking',connected:false,canRevoke:false})};
const app=Vue.createApp({
 mixins:[MtlConnectionUI.mixin],
 data(){return{cloudSignedIn:true,cloudProfileId:'synthetic-admin',cloudUser:{id:'synthetic-admin',role:'admin',isAdmin:true,assignmentVersion:1},
 privateMediaEpoch:1,ctMtlCapabilities:{enabled:true},mtlConsentVersion:'',mtlShortcut:'disabled',mtlLimitsAllowed:false,settingsTab:'mtl'};},
 methods:{
  fixtureConfigure(mode='connected'){
   this.mtlConnectionReset();this.cloudSignedIn=true;this.cloudProfileId='synthetic-admin';
   this.cloudUser={id:'synthetic-admin',role:'admin',isAdmin:true,assignmentVersion:1};this.privateMediaEpoch++;
   this.ctMtlCapabilities={enabled:mode!=='generation-disabled'};this._fixtureMode=mode;this._fixtureMetadata=structuredClone(metadata[mode]||metadata.connected);
   if(MtlConnectionUI.states.includes(mode)&&!metadata[mode])this._fixtureMetadata={...metadata.disconnected,state:mode,enabled:mode!=='disabled'};
   this._fixtureRequests=[];this._fixtureDeferred=false;this._fixtureRelease=null;
   this._cloud=Vue.markRaw({epoch:1,request:async(path,options={})=>{
    this._fixtureRequests.push({path,method:options.method||'GET',body:options.body?structuredClone(options.body):undefined,timeout:options.timeout});
    if(this._fixtureDeferred)await new Promise(resolve=>this._fixtureRelease=resolve);
    if(path==='/v1/admin/mtl/connection'&&(options.method||'GET')==='GET')return{connection:structuredClone(this._fixtureMetadata)};
    if(path==='/v1/admin/mtl/connection/revoke'&&options.method==='POST'&&this._fixtureMode==='revocation-unconfirmed'){
     this._fixtureMetadata=structuredClone(metadata['revocation-failed']);throw Object.assign(new Error('Unsafe raw provider detail'),{
      status:502,code:'MTL_REVOCATION_UNCONFIRMED',details:{connection:{...this._fixtureMetadata,access_token:'NEVER_STORE'}}});
    }
    if(path==='/v1/admin/mtl/connection/disconnect'&&options.method==='POST'&&this._fixtureMode==='recent-admin')throw Object.assign(new Error('Unsafe raw session detail'),{status:403,code:'MTL_ADMIN_REAUTH_REQUIRED'});
    if(['/v1/admin/mtl/connection/disconnect','/v1/admin/mtl/connection/revoke'].includes(path)&&options.method==='POST'){
     this._fixtureMetadata={...metadata.disconnected,revision:this._fixtureMetadata.revision+1,remoteRevocationConfirmed:path.endsWith('/revoke')};return{connection:structuredClone(this._fixtureMetadata)};
    }
    throw new Error('Unexpected synthetic request');
   }});return this.$nextTick();
  },
  fixtureSnapshot(){return{requests:this._fixtureRequests,state:this.mtlConnectionState,error:this.mtlConnectionError,busy:this.mtlConnectionBusy,loaded:this.mtlConnectionLoaded};}
 },
 template:${JSON.stringify(template)}
});
app.component('app-notice',EditorComponents.Notice);window.__mtlConnectionApp=app.mount('#app');
window.__mtlConnectionApp.fixtureConfigure().then(()=>window.__mtlConnectionReady=true);
})()`.replace(/<\/script/gi,'<\\/script');
    writeFileSync(join(outDir,'fixture.js'),fixture);
    const frontend=express(),server=createServer(frontend),errors=[],external=[],serverRequests=[];
    frontend.use((req,res,next)=>{serverRequests.push({method:req.method,path:req.path});next();});
    frontend.get('/',(req,res)=>res.type('html').send('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">'+styles+'</head><body><div id="app"></div>'
        +'<script src="/fixture-vue.js"></script><script src="/editorComponents.js"></script><script src="/mtlConnectionUi.js"></script><script src="/fixture.js"></script></body></html>'));
    frontend.get('/fixture-vue.js',(req,res)=>res.type('js').send(readFileSync(vueScriptPath)));
    frontend.get('/fixture.js',(req,res)=>res.type('js').send(fixture));frontend.use(express.static(publicDir));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
    const checks=[],screenshots=[];
    try{
        browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});
        const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
        page.on('pageerror',error=>errors.push(error.message));
        await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.origin);return route.abort();}return route.continue();});
        await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__mtlConnectionReady);
        const check=()=>page.getByRole('button',{name:'Check connection',exact:true}),disconnect=()=>page.getByRole('button',{name:'Disconnect',exact:true}),revoke=()=>page.getByRole('button',{name:'Revoke',exact:true});
        const snapshot=()=>page.evaluate(()=>window.__mtlConnectionApp.fixtureSnapshot());
        const configure=mode=>page.evaluate(mode=>window.__mtlConnectionApp.fixtureConfigure(mode),mode);
        const auditCopy=async label=>{
            await page.locator('.settingsPanel details').evaluateAll(nodes=>nodes.forEach(node=>node.open=true));
            const copy=await page.locator('.settingsPanel').evaluate(node=>[node.innerText,...[...node.querySelectorAll('[title],[aria-label],[placeholder]')]
                .filter(item=>item.getClientRects().length).flatMap(item=>['title','aria-label','placeholder'].map(key=>item.getAttribute(key)||''))].join('\n'));
            assert.doesNotMatch(copy,/OpenAI|ChatGPT|\bAI\b|\bmodels?\b|gpt-/i,label+': visible Settings, expanded privacy, labels and hints are neutral');
            assert.match(copy,/external translation service/);assert.match(copy,/human review/);assert.match(copy,/prior saved or original translation/);
            checks.push({neutralCopy:label,expandedPrivacy:true});
        };
        const load=async mode=>{await configure(mode);await check().click();await page.waitForFunction(()=>window.__mtlConnectionApp.mtlConnectionLoaded);await auditCopy(mode);};
        assert.equal((await snapshot()).requests.length,0,'Opening the isolated view does not fetch status or credentials.');
        await auditCopy('initial Admin view');
        assert.equal(await disconnect().isDisabled(),true);assert.equal(await revoke().isDisabled(),true);assert.equal(await check().isEnabled(),true);
        await check().focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__mtlConnectionApp.mtlConnectionLoaded);
        assert.equal(await disconnect().isEnabled(),true);assert.equal(await revoke().isEnabled(),true);assert.equal(await check().count(),0);
        assert.equal((await snapshot()).requests.length,1);checks.push('explicit keyboard status load; settled controls');

        for(const width of [1440,1100])for(const theme of ['light','grey','dark','modern-dark']){
            await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
            await load('generation-disabled');
            const content=await page.locator('.settingsPanel').innerText();assert.match(content,/Connected · Generation is disabled on the server\./);
            assert.equal(await disconnect().isEnabled(),true);assert.equal(await revoke().isEnabled(),true);
            assert.equal(await page.getByRole('button',{name:/^Connect$/i}).count(),0,'No hosted Connect action.');
            assert.equal(await page.locator('input[type="password"],input[type="file"],input[type="text"]').count(),0,'No browser credential fields.');
            const geometry=await page.locator('.settingsDialog').evaluate(node=>{
                const rect=node.getBoundingClientRect(),body=node.querySelector('.settingsBody'),panel=node.querySelector('.settingsPanel'),buttons=[...node.querySelectorAll('.settingsActions button')],
                    box=element=>{const r=element.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
                return{dialog:box(node),panel:box(panel),buttons:buttons.map(box),horizontalOverflow:body.scrollWidth-body.clientWidth,
                    viewport:innerWidth,verticalFits:rect.top>=0&&rect.bottom<=innerHeight+1,noticeColor:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor};
            });
            assert.ok(geometry.verticalFits,'Dialog fits desktop height: '+JSON.stringify(geometry));assert.ok(geometry.horizontalOverflow<=1,'No settings horizontal overflow.');
            for(const button of geometry.buttons){assert.ok(button.left>=geometry.panel.left&&button.right<=geometry.panel.right,'Buttons fit settings panel.');assert.ok(button.height>=38,'Native action remains pointer accessible.');}
            const screenshot=theme+'-'+width+'.png';await page.screenshot({path:join(outDir,screenshot),fullPage:true});screenshots.push(screenshot);
            checks.push({theme,width,generationDisabledConnectionPreserved:true,geometry});
        }
        await load('disconnected');assert.equal(await disconnect().isDisabled(),true);assert.equal(await revoke().isDisabled(),true);
        assert.match(await page.locator('.settingsPanel').innerText(),/local sign-in helper/);checks.push('disconnected status and human bootstrap guidance');
        for(const state of ['refreshing','revoking']){await load(state);assert.equal(await disconnect().isEnabled(),true);assert.equal(await revoke().isDisabled(),true);}
        checks.push('intermediate states permit explicit local disconnect only');

        await load('revocation-unconfirmed');await revoke().click();await page.waitForFunction(()=>!!window.__mtlConnectionApp.mtlConnectionError);
        const revocationError=(await snapshot()).error;assert.match(revocationError,/Remote revocation was not confirmed/);assert.match(revocationError,/translation service account settings/);await auditCopy('revocation error');
        assert.equal((await snapshot()).state.state,'revocation-failed');assert.ok(!JSON.stringify((await snapshot()).state).includes('NEVER_STORE'));
        assert.equal(await check().isEnabled(),true);await check().click();await page.waitForFunction(()=>!window.__mtlConnectionApp.mtlConnectionBusy);
        assert.equal((await snapshot()).error,revocationError,'Checking status cannot clear failed revoke.');
        assert.equal(await disconnect().isEnabled(),true);assert.equal(await revoke().isEnabled(),true);
        await page.screenshot({path:join(outDir,'revocation-unconfirmed.png'),fullPage:true});screenshots.push('revocation-unconfirmed.png');checks.push('502 safe metadata and persistent revocation warning');

        await load('recent-admin');await disconnect().click();await page.waitForFunction(()=>!!window.__mtlConnectionApp.mtlConnectionError);
        const reauthError=(await snapshot()).error;assert.match(reauthError,/sign in again with Google as Admin/);assert.match(reauthError,/five minutes/);
        await auditCopy('recent Admin error');
        assert.equal(await page.locator('[role="alert"]').count(),1);assert.ok(!(await page.locator('.settingsPanel').innerText()).includes('Unsafe raw'));
        await check().click();await page.waitForFunction(()=>!window.__mtlConnectionApp.mtlConnectionBusy);assert.equal((await snapshot()).error,reauthError);
        await page.screenshot({path:join(outDir,'recent-admin.png'),fullPage:true});screenshots.push('recent-admin.png');checks.push('403 recent Admin guidance persists through explicit status check');

        await load('connected');await page.evaluate(()=>window.__mtlConnectionApp._fixtureDeferred=true);await revoke().click();
        await page.waitForFunction(()=>!!window.__mtlConnectionApp._fixtureRelease);assert.equal(await disconnect().isDisabled(),true);assert.equal(await revoke().isDisabled(),true);
        assert.equal(await page.getByText('Connected',{exact:true}).count(),1,'Explicit action preserves settled metadata.');
        await page.evaluate(()=>{const app=window.__mtlConnectionApp;app.cloudUser={...app.cloudUser,role:'translator',isAdmin:false};});
        await page.waitForFunction(()=>!window.__mtlConnectionApp.mtlConnectionAllowed);assert.equal(await disconnect().count(),0);assert.equal(await revoke().count(),0);
        await page.evaluate(()=>window.__mtlConnectionApp._fixtureRelease());await page.waitForFunction(()=>!window.__mtlConnectionApp.mtlConnectionBusy);
        assert.equal((await snapshot()).state,null);assert.equal((await snapshot()).error,'');checks.push('role loss hides controls and fences pending action');
        for(const state of await page.evaluate(()=>MtlConnectionUI.states))await load(state);
        for(const role of ['translator','manager']){
            await configure('connected');await page.evaluate(role=>{const app=window.__mtlConnectionApp;app.cloudUser={...app.cloudUser,role,isAdmin:false};},role);
            assert.equal(await page.getByText('MTL connection · Admin',{exact:true}).count(),0);assert.equal((await snapshot()).requests.length,0);await auditCopy(role);
        }
        const requests=(await snapshot()).requests;assert.deepEqual(requests,[]);
        assert.deepEqual(external,[],'No external network requests.');assert.deepEqual(errors,[],'No page errors.');
        assert.equal(serverRequests.filter(request=>request.path.startsWith('/v1/')).length,0,'Fake metadata never reaches any API.');
        const report={passed:true,source:'Actual MTL settings block extracted from public/index.html; product styles and mixin',checks,screenshots,
            externalRequests:external,pageErrors:errors,apiRequests:0};writeFileSync(join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
        await context.close();
    }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
