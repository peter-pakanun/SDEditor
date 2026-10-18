'use strict';
// Synthetic, loopback-only download checks. No sign-in, inference or uploads.
const assert=require('node:assert/strict'),{readFileSync,existsSync,mkdirSync,writeFileSync}=require('node:fs'),{join}=require('node:path'),{createServer}=require('node:http');
const express=require('express'),JSZip=require('../../SDEditor-API/node_modules/jszip');
const rootDir=join(__dirname,'..'),publicDir=join(rootDir,'public'),outDir=join(rootDir,'temp/mtl-debug-download-fixture');
const runtimeModules='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||require.resolve('playwright',{paths:[runtimeModules]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const vueScriptPath=process.env.FIXTURE_VUE_PATH||join(rootDir,'temp/clienttext-fixture-vue.min.js');
if(!executablePath||!existsSync(vueScriptPath))throw new Error('Use an installed Edge/Chrome and the cached fixture Vue runtime.');
const fixture=String.raw`(()=>{
const accountId='synthetic-admin',unit={id:'unit',fields:[{id:'text',source:'Synthetic English'}]};
function record(status){
 const text='ภาษาไทย 日本語 한글 😀\n'.repeat(3000)+'unicode-tail',requestId='synthetic-'+status,timing=ClientTextMtlTiming.create({now:()=>0}).snapshot();
 const value={status,snapshot:{scope:{accountId,game:'poe2',language:'Thai'},unit:{id:'unit',sheet:'Synthetic',recordId:'Line'},field:{id:'text'},source:text,context:{note:text}}};
 if(status==='preview')return value;
 Object.assign(value,{requestId,submittedAt:100,browserTiming:timing,server:{requestId,status,source:text,context:{note:text,accessToken:'synthetic-token'},
  providerRequest:{instructions:text,input:[{role:'user',content:text}],reasoning:'synthetic-raw-reasoning',headers:{Authorization:'synthetic-header-secret'}},
  inferenceSettings:{version:'mtl-inference-settings-v1',model:'gpt-6-luna',effort:'xhigh'},response:status==='completed'?{translation:text,reasoning:'synthetic-response-reasoning'}:null,
  validation:status==='completed'?'passed':status==='failed'?'rejected':'pending',
  ...(status==='failed'?{error:{code:'MTL_OUTPUT_INVALID'},failureReason:'output_invalid'}:{}),
  timing:{version:'mtl-timing-v1',domain:'api-process',origin:'request-handler-entry',outcome:status==='completed'?'completed':status==='failed'?'failed':'running',milestonesMs:{apiReceived:0},durationsMs:{totalMs:40}}}});
 return value;
}
const vue=Vue.createApp({mixins:[ClientTextMtlDebug.mixin],data(){return{ctActive:true,ctWorkspace:{scope:{accountId,game:'poe2',language:'Thai'}},
 ctSelection:'unit',lang:'Thai',gameVersion:'poe2',cloudSignedIn:true,cloudProfileId:accountId,cloudUser:{id:accountId,role:'admin',isAdmin:true,assignmentVersion:1},requests:0};},
 computed:{ctCurrentUnit(){return unit;}},methods:{
 async open(status='completed'){
  this.ctMtlDebugClose();this.ctSelection='unit';this.cloudSignedIn=true;this.cloudProfileId=accountId;this.cloudUser={id:accountId,role:'admin',isAdmin:true,assignmentVersion:1};
  this._cloud=Vue.markRaw({epoch:1,request:()=>{this.requests++;throw Error('Download must not make a request');}});
  await this.$nextTick();this.ctMtlDebugWindow={fieldId:'text',anchor:this.$refs.open,loading:status==='running',error:'',record:record(status)};await this.$nextTick();
 }
},template:'<main class="appRoot" style="padding:24px"><h1>Synthetic Admin diagnostics download</h1><button id="fixture-open" ref="open" @click="open()">Open details</button><ct-mtl-debug-dialog v-if="ctMtlDebugAllowed && ctMtlDebugWindow" :host="$root"></ct-mtl-debug-dialog></main>'});
vue.component('ct-mtl-debug-dialog',ClientTextMtlDebug.Dialog);window.__debugDownloadApp=vue.mount('#app');window.__debugDownloadApp.open().then(()=>window.__debugDownloadReady=true);
window.__normalZipGenerate=JSZip.prototype.generateAsync;window.__zipBuilds=0;
window.__deferZip=()=>{JSZip.prototype.generateAsync=function(options){window.__zipBuilds++;const zip=this;return new Promise(resolve=>{window.__releaseZip=()=>resolve(window.__normalZipGenerate.call(zip,options));});};};
window.__restoreZip=()=>{JSZip.prototype.generateAsync=window.__normalZipGenerate;};
})()`;
async function run(){
    mkdirSync(outDir,{recursive:true});const html=readFileSync(join(publicDir,'index.html'),'utf8');
    const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"/:]+\.css)"[^>]*>/g)].map(match=>match[0].replace('href="','href="/')).join('\n');
    const frontend=express(),server=createServer(frontend),errors=[],external=[],checks=[],archives=[];
    frontend.get('/',(_req,res)=>res.type('html').send('<!doctype html><html data-theme="light"><head><meta charset="utf-8">'+styles+'</head><body><div id="app"></div><script src="/fixture-vue.js"></script><script src="/fixture-jszip.js"></script><script src="/FileSaver.js"></script><script src="/clientTextMtlTiming.js"></script><script src="/clientTextMtlDebug.js"></script><script src="/fixture.js"></script></body></html>'));
    frontend.get('/fixture-vue.js',(_req,res)=>res.type('js').send(readFileSync(vueScriptPath)));
    frontend.get('/fixture-jszip.js',(_req,res)=>res.type('js').send(readFileSync(join(rootDir,'../SDEditor-API/node_modules/jszip/dist/jszip.min.js'))));
    frontend.get('/fixture.js',(_req,res)=>res.type('js').send(fixture));frontend.use(express.static(publicDir));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
    try{
        browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});
        const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();let downloads=0;
        page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>downloads++);
        await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'&&url.protocol!=='blob:'){external.push(url.origin);return route.abort();}return route.continue();});
        await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__debugDownloadReady);
        const button=()=>page.getByRole('button',{name:'Download all',exact:true}),open=status=>page.evaluate(status=>window.__debugDownloadApp.open(status),status);
        const receive=async(action)=>{const event=page.waitForEvent('download');await action();const download=await event;
            assert.match(download.suggestedFilename(),/^sdeditor-mtl-debug-[a-z-]+\.zip$/);const zip=await JSZip.loadAsync(readFileSync(await download.path())),files={};
            for(const[name,file]of Object.entries(zip.files)){assert.match(name,/^[a-z-]+\.json$/);files[name]=JSON.parse(await file.async('string'));}
            archives.push({filename:download.suggestedFilename(),sections:Object.keys(files),manifest:files['manifest.json']});return files;
        };
        for(const status of ['preview','running','failed','completed']){
            await open(status);const before=await page.locator('.ctMtlDebugDialog').boundingBox();
            const files=await receive(async()=>{await button().focus();await button().press('Enter');});
            assert.equal(files['manifest.json'].status,status);assert.equal(files['manifest.json'].diagnosticsLoading,status==='running');
            assert.equal(files['context.json'].note,'ภาษาไทย 日本語 한글 😀\n'.repeat(3000)+'unicode-tail');
            assert.equal(files['request.json'].source,files['context.json'].note);
            if(status==='preview'){assert.ok(files['manifest.json'].missingSections.includes('prompt'));assert.ok(files['manifest.json'].missingSections.includes('response'));}
            else{assert.equal(files['prompt.json'].instructions,files['context.json'].note);assert.equal(files['inference-settings.json'].effort,'xhigh');assert.equal(files['timing.json'].api.durationsMs.totalMs,40);
                if(status==='completed')assert.equal(files['response.json'].translation,files['context.json'].note);else{assert.equal(files['response.json'],null);assert.equal(files['manifest.json'].sections.response.status,'empty');}}
            if(status==='failed')assert.equal(files['validation-error.json'].error.code,'MTL_OUTPUT_INVALID');
            assert.doesNotMatch(JSON.stringify(files),/synthetic-token|synthetic-raw-reasoning|synthetic-header-secret|synthetic-response-reasoning/);
            assert.deepEqual(await page.locator('.ctMtlDebugDialog').boundingBox(),before,'Download does not drag or resize the dialog');
            assert.equal(await button().evaluate(node=>node===document.activeElement),true,'Keyboard download retains focus');
        }
        checks.push('real ZIP downloads for preview/running/failed/completed; exact full Unicode, sections, null/missing manifest and redaction');
        await page.evaluate(()=>window.__deferZip());await button().click();await button().dispatchEvent('click');
        assert.equal(await page.evaluate(()=>window.__zipBuilds),1);assert.equal(await button().getAttribute('aria-busy'),'true');
        const repeated=await receive(()=>page.evaluate(()=>window.__releaseZip()));assert.equal(repeated['manifest.json'].requestId,'synthetic-completed');
        await page.evaluate(()=>window.__restoreZip());checks.push('repeated clicks prepare and download only once');
        for(const change of ['selection','account','logout','close','client']){
            await open('running');await page.evaluate(()=>window.__deferZip());const count=downloads;await button().click();
            await page.evaluate(change=>{const app=window.__debugDownloadApp;
                if(change==='selection')app.ctSelection='other';else if(change==='account')app.cloudProfileId='other';else if(change==='logout')app.cloudSignedIn=false;
                else if(change==='close')app.ctMtlDebugClose();else app._cloud=Vue.markRaw({epoch:2});
            },change);
            if(change!=='client')await page.waitForFunction(()=>!document.querySelector('.ctMtlDebugDialog'));
            await page.evaluate(()=>window.__releaseZip());await page.waitForTimeout(120);
            assert.equal(downloads,count,'Late ZIP is discarded after '+change);await page.evaluate(()=>window.__restoreZip());
        }
        checks.push('late ZIPs discarded after selection/account/logout/close/client changes');
        for(const role of ['translator','manager']){await open('completed');await page.evaluate(role=>{window.__debugDownloadApp.cloudUser={...window.__debugDownloadApp.cloudUser,role,isAdmin:false};},role);assert.equal(await button().count(),0);}
        checks.push('ordinary roles have no download control');
        await open('failed');await page.evaluate(()=>{JSZip.prototype.generateAsync=async()=>{throw Error('synthetic-private-provider-error');};});await button().click();
        assert.match(await page.locator('.ctMtlDebugDialog [role="alert"]').textContent(),/Could not prepare the ZIP/);assert.doesNotMatch(await page.locator('.ctMtlDebugDialog').textContent(),/synthetic-private-provider-error/);
        await page.evaluate(()=>window.__restoreZip());await receive(()=>button().click());assert.equal(await page.locator('.ctMtlDebugDialog [role="alert"]').count(),0);
        checks.push('generic generation failure; explicit retry succeeds and clears its error');
        for(const theme of ['light','grey','dark','modern-dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(outDir,'download-'+theme+'.png'),fullPage:true});}
        await page.setViewportSize({width:920,height:420});await page.waitForFunction(()=>{const box=document.querySelector('.ctMtlDebugDialog').getBoundingClientRect();return box.y>=7&&box.bottom<=413;});
        await button().focus();await page.screenshot({path:join(outDir,'download-short.png'),fullPage:true});
        await button().press('Escape');assert.equal(await page.locator('#fixture-open').evaluate(node=>node===document.activeElement),true);checks.push('four themes, short desktop viewport and Escape focus restoration');
        assert.equal(await page.evaluate(()=>window.__debugDownloadApp.requests),0,'Download never reads diagnostics or uploads data');assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
        const report={passed:true,checks,downloads,archives,externalRequests:external,pageErrors:errors};writeFileSync(join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,checks,downloads,externalRequests:external,pageErrors:errors},null,2));
    }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
