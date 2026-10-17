'use strict';
// Real Settings navigation and MTL panels; all account, quota and preference data
// is synthetic and stays in memory. No authentication, credentials or inference.
const assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync,existsSync,mkdirSync,writeFileSync}=require('node:fs'),{join}=require('node:path'),{createServer}=require('node:http');
const express=require('express'),{quota}=require('./mtl-limits-fixture.cjs');
const rootDir=join(__dirname,'..'),publicDir=join(rootDir,'public'),outDir=join(rootDir,'temp/mtl-settings-fixture');
const runtimeModules='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||require.resolve('playwright',{paths:[runtimeModules]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const vueScriptPath=process.env.FIXTURE_VUE_PATH||join(rootDir,'temp/clienttext-fixture-vue.min.js');
function settingsConfig(){
    let config;const window={location:{search:''}};
    const context=vm.createContext({window,document:{},URLSearchParams,console,setTimeout,clearTimeout,
        Vue:{defineComponent(value){config=value;return value;},createApp(){return{component(){},directive(){},mount(){}};}}});
    for(const file of ['workspaceState.js','dictionaryScope.js','cloudUi.js','index.js'])vm.runInContext(readFileSync(join(publicDir,file),'utf8'),context);
    return config;
}
async function run(){
    assert.ok(executablePath&&existsSync(vueScriptPath),'Use the installed desktop browser and cached fixture Vue runtime.');
    mkdirSync(outDir,{recursive:true});const html=readFileSync(join(publicDir,'index.html'),'utf8'),config=settingsConfig();
    let dialog=html.slice(html.indexOf('    <div class="settingPage settingsBackdrop"'),html.indexOf('    <!-- Multi-instance detection gate -->'));
    assert.ok(dialog.includes('id="settings-panel-mtl"'),'Render the actual MTL panel.');
    // Other panel contents have separate fixtures. Keep their real section shell
    // here so every navigation target participates in the actual Settings tabs.
    for(const id of ['cloud','data','logs'])dialog=dialog.replace(new RegExp('<section id="settings-panel-'+id+'"[^>]*>[\\s\\S]*?<\\/section>'),match=>
        match.slice(0,match.indexOf('>')+1)+'<h3>'+config.data().settingsTabs.find(tab=>tab.id===id).label+'</h3></section>');
    const template='<div @keydown="settingsDialogVisible && handleKeydown($event)"><button id="open-settings" ref="settingsButton" @click="openSettings()">Open settings</button><button id="open-mtl" @click="openSettings(\'mtl\')">Open MTL settings</button>'+dialog+'</div>';
    const methods=['openSettings','setSettingsTab','handleSettingsTabKeydown','settingsTrapFocus','settingsSaveClose','handleKeydown','isImeComposingEvent'].map(name=>config.methods[name].toString()).join(',');
    const watch=['settingsDialogVisible','mtlConsentVersion','mtlShortcut'].map(name=>config.watch[name].toString()).join(',');
    const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"/:]+\.css)"[^>]*>/g)].map(match=>match[0].replace('href="','href="/')).join('\n');
    const fixture=String.raw`(()=>{
const defaults=${JSON.stringify(config.data())},seed=${JSON.stringify(quota())};
const navigation={${methods}},settingsWatch={${watch}};
const app=Vue.createApp({mixins:[MtlConnectionUI.mixin,MtlLimitsUI.mixin],
 data(){return{...defaults,gameVersionSelected:true,needsInitialSettings:false,showSetting:false,lang:'Thai',gameVersion:'poe2',
  cloudLanguageSwitching:false,privateMediaEpoch:1,cloudSignedIn:true,cloudProfileId:'synthetic-admin',cloudUser:{id:'synthetic-admin',role:'admin',isAdmin:true,assignmentVersion:1},ctMtlCapabilities:null};},
 computed:{${config.computed.settingsDialogVisible.toString()}},watch:settingsWatch,
 methods:{...navigation,handleFileListKeydown(){return false;},normalizeGameVersion(value){return value==='poe2'?'poe2':'poe1';},
  async saveSettings(){this._fixturePreferenceWrites.push({mtlConsentVersion:this.mtlConsentVersion,mtlShortcut:this.mtlShortcut});return true;},
  async ctMtlLoadCapabilities(){const value=await this._cloud.request('/v1/mtl/capabilities');this.ctMtlCapabilities=value;return value;},
  async configure(role='admin',mode='normal'){
   this.showSetting=false;this.mtlLimitsReset();this.mtlConnectionReset();this.mtlLimitsExpanded=false;
   this.mtlConsentVersion='';this.mtlShortcut='disabled';this.privateMediaEpoch++;
   this.cloudUser={id:'synthetic-admin',role,isAdmin:role==='admin',assignmentVersion:1};
   this._fixtureMode=mode;this._fixtureQuota=structuredClone(seed);this._fixtureRequests=[];this._fixturePreferenceWrites=[];this._fixtureLimitReleases=[];this._fixtureDeferLimits=false;
   this._cloud=Vue.markRaw({epoch:1,request:async(path,options={})=>{
    const record={path,method:options.method||'GET',body:options.body&&structuredClone(options.body)};this._fixtureRequests.push(record);
    if(path==='/v1/mtl/capabilities')return{enabled:true};
    if(path==='/v1/admin/mtl/connection'){
     if(this._fixtureMode==='connection-error')throw new Error('Synthetic connection failure');
     return{connection:{enabled:true,state:'connected',revision:4,connected:true,hostedConnectAvailable:false,bootstrap:'local-sign-in-import',canDisconnect:true,canRevoke:true}};
    }
    if(path==='/v1/admin/mtl/limits'){
     if(record.method!=='GET')throw Error('Navigation must not write limits');
     if(this._fixtureDeferLimits)await new Promise(resolve=>this._fixtureLimitReleases.push(resolve));
     if(this._fixtureMode==='limits-error')throw new Error('Synthetic limits failure');
     return{quota:structuredClone(this._fixtureQuota)};
    }
    throw Error('Unexpected synthetic request');
   }});await this.$nextTick();
  }
 },template:${JSON.stringify(template)}});
app.component('app-notice',EditorComponents.Notice);window.__mtlSettings=app.mount('#app');window.__mtlSettings.configure().then(()=>window.__mtlSettingsReady=true);
})()`;
    writeFileSync(join(outDir,'fixture.js'),fixture);
    const frontend=express(),server=createServer(frontend),errors=[],external=[],checks=[];
    frontend.get('/',(_req,res)=>res.type('html').send('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">'+styles+'</head><body><div id="app"></div><script src="/fixture-vue.js"></script><script src="/editorComponents.js"></script><script src="/mtlConnectionUi.js"></script><script src="/mtlLimitsUi.js"></script><script src="/fixture.js"></script></body></html>'));
    frontend.get('/fixture-vue.js',(_req,res)=>res.type('js').send(readFileSync(vueScriptPath)));frontend.get('/fixture.js',(_req,res)=>res.type('js').send(fixture));frontend.use(express.static(publicDir));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
    try{
        browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});
        const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
        page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.origin);return route.abort();}return route.continue();});
        await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__mtlSettingsReady);
        const tab=id=>page.locator('#settings-tab-'+id),input=()=>page.locator('[data-mtl-limit="userDay"]');
        const configure=(role='admin',mode='normal')=>page.evaluate(({role,mode})=>window.__mtlSettings.configure(role,mode),{role,mode});
        const openMtl=()=>page.locator('#open-mtl').click(),expand=async()=>{await page.locator('.mtlLimitsPanel summary').click();await page.waitForFunction(()=>window.__mtlSettings.mtlLimitsState||window.__mtlSettings.mtlLimitsLoadError);};
        const assertTabs=async selected=>{
            assert.equal(await page.getByRole('dialog',{name:'Settings',exact:true}).count(),1);
            assert.equal(await page.getByRole('tab',{selected:true}).count(),1);assert.equal(await tab(selected).getAttribute('tabindex'),'0');
            const pairs=await page.getByRole('tab').evaluateAll(nodes=>nodes.map(node=>({id:node.id,target:node.getAttribute('aria-controls'),panel:document.getElementById(node.getAttribute('aria-controls'))?.getAttribute('aria-labelledby')})));
            assert.ok(pairs.every(pair=>pair.id===pair.panel));assert.equal(new Set(pairs.map(pair=>pair.target)).size,6);
        };
        await page.locator('#open-settings').click();await assertTabs('general');
        await tab('editor').focus();await page.keyboard.press('ArrowRight');await assertTabs('mtl');
        assert.equal(await tab('mtl').evaluate(node=>node===document.activeElement),true);
        assert.equal(await page.getByLabel('Translate current field with MTL').count(),1);assert.equal(await page.locator('#settings-panel-editor #mtlShortcut').count(),0);
        await page.keyboard.press('End');await assertTabs('logs');await page.keyboard.press('ArrowRight');await assertTabs('general');
        await page.keyboard.press('ArrowLeft');await assertTabs('logs');await page.keyboard.press('Home');await assertTabs('general');
        await page.evaluate(()=>window.__mtlSettings.openSettings('general','settingsLanguage'));assert.equal(await page.locator('#settingsLanguage').evaluate(node=>node===document.activeElement),true);
        await tab('mtl').click();await page.waitForFunction(()=>window.__mtlSettings.mtlConnectionLoaded);await expand();
        await input().fill('75');await page.getByLabel('Translate current field with MTL').selectOption('f8');
        await page.evaluate(()=>{window.__dirtyLimit=document.querySelector('[data-mtl-limit="userDay"]');});
        for(const id of ['editor','cloud','data','logs','general','mtl'])await tab(id).click();
        assert.equal(await input().inputValue(),'75');assert.equal(await input().evaluate(node=>node===window.__dirtyLimit),true,'tab navigation keeps quota controls mounted');
        assert.equal(await page.evaluate(()=>window.__mtlSettings.mtlLimitsState.usage.user.day.limit),50);
        await page.getByRole('button',{name:'Save and close',exact:true}).focus();await page.keyboard.press('Tab');
        assert.equal(await page.locator('.settingsClose').evaluate(node=>node===document.activeElement),true,'Tab wraps into the dialog');
        await page.keyboard.press('Shift+Tab');assert.equal(await page.getByRole('button',{name:'Save and close',exact:true}).evaluate(node=>node===document.activeElement),true);
        await page.keyboard.press('Escape');await page.waitForSelector('.settingsDialog',{state:'detached'});
        assert.equal(await page.locator('#open-settings').evaluate(node=>node===document.activeElement),true,'Escape restores opener focus');
        assert.equal(await page.evaluate(()=>!!window.__mtlSettings._mtlLimitsTimer),false,'closed Settings stops polling');
        await openMtl();await assertTabs('mtl');assert.equal(await page.locator('.mtlLimitsPanel').getAttribute('open'),'');
        assert.equal(await input().inputValue(),'75');assert.equal(await page.getByLabel('Translate current field with MTL').inputValue(),'f8');
        assert.equal(await page.evaluate(()=>window.__mtlSettings.mtlConsentVersion),'');
        assert.equal(await page.evaluate(()=>window.__mtlSettings._fixtureRequests.some(value=>value.method!=='GET')),false);
        checks.push('actual tab/panel associations, arrow/Home/End navigation, legacy General focus links, focus trap and Escape return','dirty quota and personal preferences survive navigation and reopen; no limit writes');
        for(const theme of ['light','grey','dark','modern-dark'])for(const size of [{width:1440,height:1000},{width:800,height:600},{width:560,height:640}]){
            await page.setViewportSize(size);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
            await tab('mtl').focus();const geometry=await page.evaluate(()=>{
                const box=document.querySelector('.settingsDialog').getBoundingClientRect(),nav=document.querySelector('.settingsTabs'),tab=document.querySelector('#settings-tab-mtl').getBoundingClientRect(),navBox=nav.getBoundingClientRect();
                return{left:box.left,right:box.right,bottom:box.bottom,top:box.top,tabVisible:tab.left>=navBox.left&&tab.right<=navBox.right,horizontal:document.documentElement.scrollWidth>innerWidth};
            });
            assert.ok(geometry.left>=0&&geometry.right<=size.width&&geometry.top>=0&&geometry.bottom<=size.height);assert.equal(geometry.horizontal,false);assert.equal(geometry.tabVisible,true);
            await page.screenshot({path:join(outDir,'mtl-'+theme+'-'+size.width+'.png'),fullPage:true});
        }
        checks.push('all four themes and resized desktop 560/800/1440 widths; reachable horizontally scrolling tabs');
        await page.setViewportSize({width:1440,height:1000});await configure('admin','limits-error');await openMtl();await expand();
        const error=await page.locator('.mtlLimitsPanel [role="alert"]').innerText();await tab('editor').click();await tab('mtl').click();assert.equal(await page.locator('.mtlLimitsPanel [role="alert"]').innerText(),error);
        await page.evaluate(()=>{window.__mtlSettings._fixtureMode='normal';});await page.getByRole('button',{name:'Reload limits and usage',exact:true}).click();await page.waitForFunction(()=>!!window.__mtlSettings.mtlLimitsState);
        await configure('admin','connection-error');await openMtl();await page.waitForFunction(()=>!!window.__mtlSettings.mtlConnectionError);assert.equal(await page.locator('#settings-panel-mtl [role="alert"]').count(),1);
        await page.evaluate(()=>{window.__mtlSettings._fixtureMode='normal';});await page.getByRole('button',{name:'Check connection',exact:true}).click();await page.waitForFunction(()=>window.__mtlSettings.mtlConnectionLoaded&&!window.__mtlSettings.mtlConnectionError);
        await configure();await openMtl();await page.evaluate(()=>{window.__mtlSettings._fixtureDeferLimits=true;});await page.locator('.mtlLimitsPanel summary').click();await page.waitForFunction(()=>window.__mtlSettings.mtlLimitsLoading);
        assert.match(await page.locator('.mtlLimitsPanel [role="status"]').innerText(),/Loading limits/);await tab('editor').click();assert.equal(await page.evaluate(()=>!!window.__mtlSettings._mtlLimitsTimer),false);
        await page.evaluate(()=>{const app=window.__mtlSettings;app._fixtureDeferLimits=false;app._fixtureLimitReleases.splice(0).forEach(resolve=>resolve());});
        await tab('mtl').click();await page.waitForFunction(()=>!!window.__mtlSettings.mtlLimitsState);checks.push('loading abort/resume, persistent actionable errors and explicit successful recovery');
        for(const role of ['translator','manager']){
            await configure(role);await openMtl();await assertTabs('mtl');assert.equal(await page.locator('.mtlLimitsPanel').count(),0);
            assert.equal(await page.getByRole('button',{name:'Disconnect',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Check connection',exact:true}).count(),0);
            assert.equal(await page.getByLabel('Translate current field with MTL').inputValue(),'disabled');assert.equal(await page.getByRole('checkbox',{name:/Allow MTL requests/}).isChecked(),false);
            assert.equal(await page.evaluate(()=>window.__mtlSettings._fixtureRequests.some(value=>value.path.startsWith('/v1/admin/'))),false);
            await page.getByRole('button',{name:'Save and close',exact:true}).click();await openMtl();await assertTabs('mtl');
        }
        checks.push('Translator/Manager MTL preferences available; Admin-only panels hidden with zero Admin requests');
        assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
        const report={passed:true,checks,pageErrors:errors,externalRequests:external};writeFileSync(join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
