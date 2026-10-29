'use strict';
// Synthetic Admin model-settings UI. No sign-in, provider request or durable data.
const assert=require('node:assert/strict'),{readFileSync,existsSync,mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path'),{createServer}=require('node:http'),express=require('express');
const rootDir=join(__dirname,'..'),publicDir=join(rootDir,'public'),outDir=join(rootDir,'temp/mtl-model-settings-fixture');
const runtimeModules='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||require.resolve('playwright',{paths:[runtimeModules]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const vueScriptPath=process.env.FIXTURE_VUE_PATH||join(rootDir,'temp/clienttext-fixture-vue.min.js');
const cloudflareModel='@cf/deepseek-ai/deepseek-v4.1-flash-1017';
async function run(){
    assert.ok(executablePath&&existsSync(vueScriptPath),'Use an installed desktop browser and the cached fixture Vue runtime.');mkdirSync(outDir,{recursive:true});
    const html=readFileSync(join(publicDir,'index.html'),'utf8'),styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"/:]+\.css)"[^>]*>/g)].map(match=>match[0].replace('href="','href="/')).join('\n');
    const fixture=String.raw`(()=>{
const model=${JSON.stringify(cloudflareModel)},field={id:'synthetic-field'};
const app=Vue.createApp({mixins:[ClientTextMtlSettingsUI.mixin],data(){return{cloudSignedIn:true,cloudProfileId:'synthetic-admin',cloudUser:{id:'synthetic-admin',role:'admin',isAdmin:true,assignmentVersion:1},ctWorkspace:{scope:{accountId:'synthetic-admin'}},ctCurrentUnit:{fields:[field]},fixtureField:field,fixtureAvailable:true,fixtureRequests:0};},
created(){this._cloud=Vue.markRaw({epoch:1,request:async path=>{if(path!=='/v1/admin/mtl/model-settings')throw Error('Unexpected fixture request');this.fixtureRequests++;return{settings:{version:'mtl-inference-settings-v1',models:[{model:'gpt-6.1-sol',efforts:['low','medium','high','xhigh','max']},{model:'gpt-6-luna',efforts:['none','low','medium','high','xhigh','max']},{model,provider:'cloudflare',available:this.fixtureAvailable,efforts:['none','low','high','max']}]}};}});},
template:'<main style="margin:24px;max-width:1200px"><h1>Synthetic Admin model settings</h1><div><button v-if="ctMtlSettingsAllowed" class="ctMtlSettingsButton" @click="ctMtlSettingsToggle(fixtureField)">Model settings</button><ct-mtl-settings-bar v-if="ctMtlSettingsPanel" :host="$root"></ct-mtl-settings-bar></div></main>'});
app.component('ct-mtl-settings-bar',ClientTextMtlSettingsUI.Bar);window.__modelSettings=app.mount('#app');
})()`;
    writeFileSync(join(outDir,'fixture.js'),fixture);
    const frontend=express(),server=createServer(frontend),errors=[],external=[],checks=[];
    frontend.get('/',(_req,res)=>res.type('html').send('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">'+styles+'</head><body><div id="app"></div><script src="/fixture-vue.js"></script><script src="/clientTextMtlSettingsUi.js"></script><script src="/fixture.js"></script></body></html>'));
    frontend.get('/fixture-vue.js',(_req,res)=>res.type('js').send(readFileSync(vueScriptPath)));frontend.get('/fixture.js',(_req,res)=>res.type('js').send(fixture));frontend.use(express.static(publicDir));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
    try{
        browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
        page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.origin);return route.abort();}return route.continue();});
        await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__modelSettings);
        await page.getByRole('button',{name:'Model settings',exact:true}).click();const bar=page.getByRole('region',{name:'Translation model settings'}),model=bar.getByLabel('Model',{exact:true}),effort=bar.getByLabel('Reasoning',{exact:true});
        assert.equal(await model.inputValue(),'gpt-6.1-sol');assert.equal(await effort.inputValue(),'medium');await model.selectOption(cloudflareModel);assert.equal(await effort.inputValue(),'high');
        assert.deepEqual(await effort.locator('option').allTextContents(),['none','low','high','max']);assert.match(await bar.textContent(),/separate server credentials and billing/);
        for(const value of ['none','low','high','max']){await effort.selectOption(value);assert.deepEqual(await page.evaluate(()=>window.__modelSettings.ctMtlSettingsCapture()),{version:'mtl-inference-settings-v1',model:cloudflareModel,effort:value});}
        checks.push('Cloudflare native select, supported efforts, medium-to-high fallback and captured per-request choice');
        for(const theme of ['light','grey','dark','modern-dark'])for(const width of [800,1440]){
            await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
            const box=await bar.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
            await page.screenshot({path:join(outDir,'cloudflare-'+theme+'-'+width+'.png'),fullPage:true});
        }
        checks.push('all four themes at desktop widths 800 and 1440 without horizontal overflow');
        await effort.press('Escape');assert.equal(await bar.count(),0);assert.equal(await page.locator('.ctMtlSettingsButton').evaluate(node=>node===document.activeElement),true);
        await page.evaluate(()=>{window.__modelSettings.fixtureAvailable=false;});await page.locator('.ctMtlSettingsButton').click();
        await page.waitForFunction(()=>!window.__modelSettings.ctMtlSettingsLoading&&window.__modelSettings.ctMtlSettingsCatalog.models.some(item=>item.provider==='cloudflare'&&!item.available));
        assert.equal(await model.locator('option').filter({hasText:'DeepSeek V4.1 Flash'}).evaluate(node=>node.disabled),true);assert.match(await bar.textContent(),/unavailable until its server credentials are configured/);
        assert.equal(await page.evaluate(()=>window.__modelSettings.ctMtlSettingsChoose('model','@cf/deepseek-ai/deepseek-v4.1-flash-1017')),false);
        await bar.getByRole('button',{name:'Use default',exact:true}).click();assert.equal(await model.inputValue(),'gpt-6.1-sol');assert.equal(await effort.inputValue(),'medium');assert.equal(await page.evaluate(()=>window.__modelSettings.ctMtlSettingsCapture()),undefined);
        checks.push('Escape returns focus, unconfigured Cloudflare remains visible/disabled, default remains Sol/medium');
        for(const role of ['translator','manager']){await page.evaluate(role=>{const host=window.__modelSettings;host.cloudUser={...host.cloudUser,role,isAdmin:false};},role);assert.equal(await page.locator('.ctMtlSettingsButton').count(),0);assert.equal(await bar.count(),0);}
        assert.equal(await page.evaluate(()=>window.__modelSettings.fixtureRequests),2);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
        const report={passed:true,checks,pageErrors:errors,externalRequests:external};writeFileSync(join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
