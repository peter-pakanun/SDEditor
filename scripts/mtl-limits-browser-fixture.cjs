'use strict';
// Loopback-only Admin limits fixture. Every API response and counter is synthetic.
const assert=require('node:assert/strict'),{readFileSync,existsSync,mkdirSync,writeFileSync}=require('node:fs'),{join}=require('node:path'),{createServer}=require('node:http');
const express=require('express'),{quota}=require('./mtl-limits-fixture.cjs');
const rootDir=join(__dirname,'..'),publicDir=join(rootDir,'public'),outDir=join(rootDir,'temp/mtl-limits-fixture');
const runtimeModules='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||require.resolve('playwright',{paths:[runtimeModules]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const vueScriptPath=process.env.FIXTURE_VUE_PATH||join(rootDir,'temp/clienttext-fixture-vue.min.js');
if(!executablePath||!existsSync(vueScriptPath))throw new Error('Use an installed Edge/Chrome and the cached synthetic-fixture Vue runtime.');
async function run(){
    mkdirSync(outDir,{recursive:true});const html=readFileSync(join(publicDir,'index.html'),'utf8'),block=html.match(/<details v-if="mtlLimitsAllowed"[\s\S]*?<\/details>/)?.[0];
    assert.ok(block,'Render the actual product Admin limits panel');
    const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"/:]+\.css)"[^>]*>/g)].map(match=>match[0].replace('href="','href="/')).join('\n');
    const fixture=String.raw`(()=>{
const seed=${JSON.stringify(quota())};
const app=Vue.createApp({mixins:[MtlLimitsUI.mixin],data(){return{settingsDialogVisible:true,settingsTab:'mtl',cloudSignedIn:true,cloudProfileId:'synthetic-admin',
 cloudUser:{id:'synthetic-admin',role:'admin',isAdmin:true,assignmentVersion:1},privateMediaEpoch:1};},methods:{
 async configure(mode='normal',role='admin'){
  this.mtlLimitsReset();this.mtlLimitsExpanded=false;this.$el.querySelector('details')?.removeAttribute('open');
  this.cloudSignedIn=true;this.cloudProfileId='synthetic-admin';this.cloudUser={id:'synthetic-admin',role,isAdmin:role==='admin',assignmentVersion:1};
  this._fixtureMode=mode;this._fixtureQuota=structuredClone(seed);this._fixtureRequests=[];this._fixtureDeferred=false;this._fixtureRelease=null;
  this._cloud=Vue.markRaw({epoch:1,request:async(path,options={})=>{
   const record={path,method:options.method||'GET',body:options.body?structuredClone(options.body):undefined};this._fixtureRequests.push(record);
   if(this._fixtureDeferred)await new Promise(resolve=>this._fixtureRelease=resolve);
   if(record.method==='GET'){
    if(this._fixtureMode==='unsupported')throw Object.assign(new Error('Synthetic old API'),{status:404});
    if(this._fixtureMode==='load-failure')throw new TypeError('Synthetic interruption');
    return{quota:structuredClone(this._fixtureQuota)};
   }
   if(record.method!=='PUT')throw Error('Unexpected synthetic mutation');
   if(this._fixtureMode==='save-uncertain'){this._fixtureMode='normal';throw new TypeError('Synthetic uncertain save');}
   if(this._fixtureMode==='conflict'){
    this._fixtureMode='normal';this._fixtureQuota.revision++;this._fixtureQuota.limits.userDay=60;this._fixtureQuota.usage.user.day.limit=60;
    throw Object.assign(new Error('Synthetic conflict'),{status:409,code:'MTL_LIMITS_CHANGED',details:{quota:structuredClone(this._fixtureQuota)}});
   }
   this._fixtureQuota.revision++;this._fixtureQuota.limits=structuredClone(options.body.limits);
   for(const row of MtlLimitsUI.rows)this._fixtureQuota.usage[row.group][row.bucket].limit=options.body.limits[row.key];
   return{quota:{...structuredClone(this._fixtureQuota),mutationId:options.body.mutationId,appliedRevision:this._fixtureQuota.revision}};
  }});await this.$nextTick();
 },
 snapshot(){return{state:this.mtlLimitsState,draft:this.mtlLimitsDraft,requests:this._fixtureRequests,saveError:this.mtlLimitsSaveError,loadError:this.mtlLimitsLoadError};}
},template:${JSON.stringify('<div class="appRoot" style="padding:24px"><main class="settingsPanel" style="max-width:1050px"><h1>Synthetic MTL Admin settings</h1>'+block+'</main></div>')}});
app.component('app-notice',EditorComponents.Notice);window.__limitsApp=app.mount('#app');window.__limitsApp.configure().then(()=>window.__limitsReady=true);
})()`;
    writeFileSync(join(outDir,'fixture.js'),fixture);const frontend=express(),server=createServer(frontend),errors=[],external=[],checks=[];
    frontend.get('/',(_req,res)=>res.type('html').send('<!doctype html><html data-theme="light"><head><meta charset="utf-8">'+styles+'</head><body><div id="app"></div><script src="/fixture-vue.js"></script><script src="/editorComponents.js"></script><script src="/mtlLimitsUi.js"></script><script src="/fixture.js"></script></body></html>'));
    frontend.get('/fixture-vue.js',(_req,res)=>res.type('js').send(readFileSync(vueScriptPath)));frontend.get('/fixture.js',(_req,res)=>res.type('js').send(fixture));frontend.use(express.static(publicDir));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
    try{
        browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
        page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.origin);return route.abort();}return route.continue();});
        await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__limitsReady);
        const snapshot=()=>page.evaluate(()=>window.__limitsApp.snapshot()),input=key=>page.locator('[data-mtl-limit="'+key+'"]'),save=()=>page.getByRole('button',{name:'Save limits',exact:true});
        const configure=(mode='normal',role='admin')=>page.evaluate(({mode,role})=>window.__limitsApp.configure(mode,role),{mode,role});
        const open=async()=>{await page.locator('.mtlLimitsPanel summary').click();await page.waitForFunction(()=>window.__limitsApp.mtlLimitsState||window.__limitsApp.mtlLimitsUnsupported||window.__limitsApp.mtlLimitsLoadError);};
        assert.equal((await snapshot()).requests.length,0,'Closed panel does not request quotas');await open();assert.equal(await input('userDay').inputValue(),'50');
        assert.equal(await page.getByRole('rowheader',{name:'Per user',exact:true}).count(),4);
        assert.equal(await input('userDay').getAttribute('aria-label'),'Per user · requests / day limit');
        assert.match(await page.locator('.mtlLimitsPanel > .settingsHelp').first().textContent(),/Per-user limits apply separately to each account\. Your usage below is for the signed-in Admin/);
        checks.push('Per user row and input labels; signed-in Admin usage explained separately');
        assert.match(await page.locator('.mtlLimitsPanel').textContent(),/synthetic-admin/);assert.match(await page.locator('.mtlLimitsPanel').textContent(),/12 \/ 50/);
        assert.match(await page.locator('.mtlLimitsPanel').textContent(),/40 \/ 100/);assert.match(await page.locator('.mtlLimitsPanel').textContent(),/Asia\/Bangkok/);
        assert.equal(await save().isDisabled(),true);await input('userDay').fill('75');assert.equal(await save().isEnabled(),true);
        assert.equal((await snapshot()).state.usage.user.day.limit,50);assert.equal((await snapshot()).requests.some(value=>value.method==='PUT'),false,'Editing never writes settings');
        await page.evaluate(()=>{window.__limitsApp._fixtureQuota.usage.user.day.used=13;});
        await page.waitForFunction(()=>window.__limitsApp.mtlLimitsState.usage.user.day.used===13,{timeout:7000});
        assert.equal(await input('userDay').inputValue(),'75','Five-second counter refresh retains edits');checks.push('live server counters; dirty inputs preserved');
        await input('userDay').fill('0');assert.equal(await save().isDisabled(),true);await input('userDay').fill('75');
        for(const theme of ['light','grey','dark','modern-dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(outDir,'limits-'+theme+'.png'),fullPage:true});}
        await save().focus();await save().press('Enter');await page.waitForFunction(()=>window.__limitsApp.mtlLimitsState.limits.userDay===75);
        assert.equal(await save().evaluate(node=>node===document.activeElement),true,'Keyboard Save retains focus after its values are committed');
        assert.equal((await snapshot()).state.usage.user.day.used,13);assert.equal((await snapshot()).state.usage.shared.day.used,40);assert.equal(await input('userDay').inputValue(),'75');checks.push('explicit keyboard Save; counters unchanged');
        await input('userDay').fill('80');await page.evaluate(()=>{window.__limitsApp._fixtureMode='conflict';});await save().click();await page.waitForFunction(()=>!!window.__limitsApp.mtlLimitsSaveError);
        assert.equal(await input('userDay').inputValue(),'80');assert.equal((await snapshot()).state.limits.userDay,60);assert.match((await snapshot()).saveError,/Compare/);checks.push('revision conflict preserves edits and current counters');
        await page.evaluate(()=>{window.__limitsApp._fixtureMode='save-uncertain';});await save().click();await page.waitForFunction(()=>window.__limitsApp.mtlLimitsPending&&!window.__limitsApp.mtlLimitsSaving);
        const beforeRetry=(await snapshot()).requests.filter(value=>value.method==='PUT').at(-1).body;assert.equal(await input('userDay').isDisabled(),true);
        await page.getByRole('button',{name:'Retry Save limits',exact:true}).click();await page.waitForFunction(()=>!window.__limitsApp.mtlLimitsPending);
        assert.deepEqual((await snapshot()).requests.filter(value=>value.method==='PUT').at(-1).body,beforeRetry);checks.push('uncertain Save retries identical ID and limits');
        await configure('load-failure');await open();assert.match((await snapshot()).loadError,/could not be loaded/);
        await page.evaluate(()=>{window.__limitsApp._fixtureMode='normal';});await page.getByRole('button',{name:'Reload limits and usage',exact:true}).click();await page.waitForFunction(()=>!!window.__limitsApp.mtlLimitsState);
        await configure('unsupported');await open();assert.match(await page.locator('.mtlLimitsPanel').textContent(),/unavailable on this server version/);assert.equal(await page.locator('[data-mtl-limit]').count(),0);checks.push('failure recovery and older API');
        for(const role of ['manager','translator']){await configure('normal',role);assert.equal(await page.locator('.mtlLimitsPanel').count(),0);assert.equal((await snapshot()).requests.length,0);}checks.push('Admin only; no requests for other roles');
        await configure();await open();await page.evaluate(()=>{window.__limitsApp.cloudSignedIn=false;});await page.waitForFunction(()=>window.__limitsApp.mtlLimitsState===null);
        assert.equal(await page.locator('.mtlLimitsPanel').count(),0);checks.push('logout clears quota and drafts');
        assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const report={passed:true,checks,pageErrors:errors,externalRequests:external};writeFileSync(join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
