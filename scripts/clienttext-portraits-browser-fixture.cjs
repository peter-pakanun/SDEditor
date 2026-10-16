'use strict';
// Real shared English fields + portrait component and API route, using private local game images.
const assert=require('node:assert/strict');
const {readFileSync,existsSync,mkdirSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {createServer}=require('node:http');
const express=require('express');
const modules='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright',{paths:[modules]}));
const root=resolve(__dirname,'..'),folder=join(root,'temp/portrait-browser');
const portraitCatalog=require('../public/clientTextPortraitCatalog.js'),npcSources=portraitCatalog.games.poe2.npcs;
const fixtureNames=['Ailith','Doryani','The Hooded One','Dannig','Alva','Tavakai','Sekhema Asala','Finn','Una','Renly','Zarka','Servi','Oswald','Ange','Aoife'];
const preferredPaths={Ailith:'Metadata/NPC/League/Chayula/ChayulaFarmerHub',Doryani:'Metadata/NPC/Four_Act4/DoryaniTownKingsmarchIntro','The Hooded One':'Metadata/NPC/Four_Act4/HoodedMentorKingsmarchIntro'};
const fixturePaths=fixtureNames.map(name=>preferredPaths[name] || Object.entries(npcSources).find(([path,item])=>item[1]===name)?.[0]);
fixturePaths.forEach((path,index)=>assert.ok(npcSources[path],fixtureNames[index]+' has an exact catalog source'));

const executablePath=process.env.FIXTURE_BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const listen=server=>new Promise(done=>server.listen(0,'127.0.0.1',done)),stop=server=>new Promise(done=>{server.close(done);server.closeAllConnections();});
const base=server=>'http://127.0.0.1:'+server.address().port;
(async()=>{
    mkdirSync(folder,{recursive:true});
    const {installPortraitRoutes}=await import(pathToFileURL(resolve(root,'../SDEditor-API/src/portraits.js')));
    const front=express(),api=express(),server=createServer(front),apiServer=createServer(api);
    let browser,page,expectedMediaFailure=false;const errors=[],responses=[];
    try{
        await listen(server);const origin=base(server);
        api.use((req,res,next)=>{res.set('Access-Control-Allow-Origin',origin);next();});
        installPortraitRoutes(api,{config:{portraitDirectory:resolve(root,'../SDEditor-API/assets/portraits')},limit:(req,res,next)=>next()});
        api.use((error,req,res,next)=>res.status(error.status || 500).json({code:error.code}));await listen(apiServer);
        const prepared=JSON.parse(readFileSync(resolve(root,'../SDEditor-API/assets/portraits/manifest.json'),'utf8'));
        let deliveredPortraits=0;
        for(const [game,store] of Object.entries(prepared.games))for(const [id,item] of Object.entries(store.portraits))if(item.reviewed){
            const response=await fetch(base(apiServer)+'/portraits/'+game+'/'+id+'.webp?v=4');
            assert.equal(response.status,200,id+' prepared image is deliverable');assert.equal(response.headers.get('content-type'),'image/webp');await response.arrayBuffer();deliveredPortraits++;
        }
        front.get('/fixture/vue.js',(req,res)=>res.type('js').send(readFileSync(process.env.FIXTURE_VUE_PATH || join(root,'temp/clienttext-fixture-vue.min.js'))));
        front.get('/',(req,res)=>res.type('html').send(`<!doctype html><html data-theme="modern-dark"><head><link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/interface.css"><link rel="stylesheet" href="/client-text.css"><style>:root{--density:1}body{padding:24px;box-sizing:border-box}main{max-width:1400px;margin:auto}.panes{display:grid;grid-template-columns:1fr 1fr;gap:24px}.panes>section{min-width:0}textarea{box-sizing:border-box;width:100%;min-height:90px}h2{font-size:16px}.ctFields{min-width:0}</style></head><body><main id="app"><h1>ClientText English reference portraits</h1><div :class="full?'full':'panes'"><section><h2>English</h2><ct-fields :host="host" :side="full?'both':'source'"></ct-fields></section><section v-if="!full"><h2>Translation</h2><textarea aria-label="Translation">A translation draft</textarea></section></div></main><script src="/fixture/vue.js"></script><script src="/clientTextPortraitCatalog.js"></script><script src="/clientTextPortraits.js"></script><script src="/editorComponents.js"></script><script src="/clientTextUi.js"></script><script>
        window.CloudUI={apiBase:()=>${JSON.stringify(base(apiServer))}};
        const names=${JSON.stringify(fixtureNames)},paths=${JSON.stringify(fixturePaths)},keys=names.map(name=>JSON.stringify(['name',name.toLowerCase()]));
        const groups=names.map((name,index)=>({key:keys[index],label:name,paths:[paths[index]]}));
        const npcIndex={groups,groupByKey:new Map(groups.map(group=>[group.key,group])),memberships:new Map()};
        const convoIndex={memberships:new Map([['ailith',{parentKey:keys[0]}],['doryani',{parentKey:keys[1]}],['dannig',{parentKey:keys[3]}]])};
        const resolver=ClientTextPortraits.createResolver({npcIndex,convoIndex,game:'poe2'});
        const records={ailith:{id:'ailith',metadata:{Character:'Metadata/Characters/Int/IntFour',NPC:''}},doryani:{id:'doryani',metadata:{NPC:groups[2].paths[0]}},dannig:{id:'dannig',metadata:{NPC:groups[3].paths[0]}}};
        names.slice(4).forEach((name,index)=>{records['major'+index]={id:'major'+index,metadata:{NPC:groups[index+4].paths[0]}};});
        const field={id:'Text',name:'Text',kind:'text',source:'What is it this time?',targetCell:'D5254'};
        window.fixtureHost=Vue.reactive({ctCurrentUnit:records.ailith,ctBusy:false,ctChoices:[],ctNotes:()=>[],ctFieldsKeydown:()=>{},ctResizeFields:()=>{},ctClassFields:()=>[],ctNamedForms:()=>[],ctDefaultForms:()=>[],ctRowPortraits:unit=>resolver(unit),ctFieldGroups:[{key:'Text',name:'Text',fields:[field],source:field.source}],ctGroupSources:group=>[{key:'Text',source:group.source,fieldIds:['Text']}],ctSourceFieldController:(group,source)=>({field:{english:source.source,isMultiline:true,readonly:true}})});
        window.fixtureRecords=records;window.fixtureResolver=resolver;window.fixtureGroups=groups;
        const app=Vue.createApp({data:()=>({host:window.fixtureHost,full:false})});app.component('ct-fields',ClientTextUI.fieldsComponent);app.component('editor-native-field',EditorComponents.NativeField);app.component('ct-target',{template:'<textarea></textarea>'});app.directive('tooltip',{});window.fixtureApp=app.mount('#app');
        </script></body></html>`));
        front.use(express.static(join(root,'public')));
        browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});
        const context=await browser.newContext({viewport:{width:1440,height:900}});page=await context.newPage();
        page.on('console',message=>{if(expectedMediaFailure && message.text().includes('net::ERR_FAILED'))return;if(message.type()==='error' || message.type()==='warning')errors.push(message.text());});
        page.on('response',response=>{if(response.url().includes('/portraits/'))responses.push([response.status(),response.url()]);});
        page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
        await page.waitForFunction(()=>[...document.querySelectorAll('.ctPortrait img')].length===2 && [...document.querySelectorAll('.ctPortrait img')].every(img=>img.complete && img.naturalWidth>0));
        assert.deepEqual(await page.locator('.ctPortraitCaption').allTextContents(),['Ailith','Witch']);
        for(const theme of ['light','grey','dark','modern-dark'])for(const width of [1440,1100]){
            await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
            const geometry=await page.locator('.ctSourceBlock').evaluate(block=>{const field=block.querySelector('.editorTextField').getBoundingClientRect(),group=block.querySelector('.ctPortraitStack').getBoundingClientRect(),images=[...block.querySelectorAll('.ctPortrait')].map(x=>{const r=x.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width,z:Number(getComputedStyle(x).zIndex)};});return {fieldBottom:field.bottom,groupY:group.y,groupWidth:group.width,blockWidth:block.getBoundingClientRect().width,images,overflow:document.documentElement.scrollWidth>innerWidth};});
            assert.ok(geometry.groupY>=geometry.fieldBottom,'portraits sit below English field');assert.ok(geometry.groupWidth<=geometry.blockWidth+1);assert.equal(geometry.overflow,false);assert.ok(geometry.images[0].x<geometry.images[1].x);assert.ok(geometry.images[0].z>geometry.images[1].z);
            if(width===1440 && ['light','modern-dark'].includes(theme))await page.screenshot({path:join(folder,'english-'+theme+'.png')});
        }
        await page.evaluate(()=>fixtureApp.full=true);
        for(const theme of ['light','grey','dark','modern-dark']){
            await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
            await page.waitForFunction(()=>document.querySelector('.ctFullFieldPair .ctPortrait img')?.naturalWidth>0);
            assert.equal(await page.locator('.ctFullFieldPair .ctFieldTranslation .ctPortraitStack').count(),0,'art belongs only to English');
            assert.equal(await page.locator('.ctFullFieldPair .ctPortrait').count(),2);
            if(theme==='modern-dark')await page.screenshot({path:join(folder,'english-full-modern-dark.png')});
        }
        await page.evaluate(()=>fixtureApp.full=false);
        await page.evaluate(()=>fixtureHost.ctCurrentUnit=fixtureRecords.doryani);
        await page.waitForFunction(()=>[...document.querySelectorAll('.ctPortrait img')].every(img=>img.complete && img.naturalWidth>0));
        assert.deepEqual(await page.locator('.ctPortraitCaption').allTextContents(),['Doryani','The Hooded One']);
        const majorNames=['Alva','Tavakai','Sekhema Asala','Finn','Una','Renly','Zarka','Servi','Oswald','Ange','Aoife'];
        for(const [index,name] of majorNames.entries()){
            await page.evaluate(index=>fixtureHost.ctCurrentUnit=fixtureRecords['major'+index],index);
            await page.waitForFunction(()=>document.querySelector('.ctPortrait img')?.complete && document.querySelector('.ctPortrait img')?.naturalWidth>0);
            assert.deepEqual(await page.locator('.ctPortraitCaption').allTextContents(),[name]);
            if(index===0)await page.screenshot({path:join(folder,'english-alva-modern-dark.png')});
        }
        const classes=Object.entries(portraitCatalog.games.poe2.characters);
        for(const [path,entry] of classes){
            await page.evaluate(path=>fixtureHost.ctCurrentUnit={id:'class:'+path,sheet:'NPCTalkDialogueTextAudio',recordId:'Partial_Player_A',metadata:{Character:path}},path);
            await page.waitForFunction(()=>document.querySelector('.ctPortrait img')?.complete && document.querySelector('.ctPortrait img')?.naturalWidth>0);
            const provisional=!!portraitCatalog.games.poe2.labels[entry[0]].provisional;
            assert.deepEqual(await page.locator('.ctPortraitCaption').allTextContents(),[entry[1]+(provisional?' *':'')]);
        }
        expectedMediaFailure=true;await page.route('**/portraits/poe2/'+npcSources[fixturePaths[3]][0]+'.webp?*',route=>route.abort());await page.evaluate(()=>fixtureHost.ctCurrentUnit=fixtureRecords.dannig);
        await page.locator('.ctPortraitMissing').waitFor();assert.equal(await page.locator('textarea[aria-label="Translation"]').inputValue(),'A translation draft');
        await page.unroute('**/portraits/poe2/'+npcSources[fixturePaths[3]][0]+'.webp?*');await page.evaluate(()=>dispatchEvent(new Event('online')));
        await page.waitForFunction(()=>document.querySelector('.ctPortrait img')?.naturalWidth>0);
        expectedMediaFailure=false;
        await page.evaluate(()=>{const known=fixtureResolver(fixtureRecords.ailith);fixtureHost.ctRowPortraits=()=>[...known,...fixtureResolver(fixtureRecords.doryani).concat(fixtureResolver(fixtureRecords.dannig)).map((item,index)=>({...item,key:'extra'+index}))];});
        await page.mouse.move(0,0);await page.locator('.ctPortraitMore').waitFor();assert.equal(await page.locator('.ctPortrait').count(),4);
        await page.locator('.ctPortraitStack').focus();assert.equal(await page.locator('.ctPortrait').count(),5);await page.keyboard.press('Escape');assert.equal(await page.locator('.ctPortrait').count(),4);
        assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,deliveredPortraits,majorNpcRenders:majorNames.length,staticClassRenders:classes.length,themes:4,widths:[1440,1100],screenshots:folder,checks:['English placement','canonical order','image delivery','verified major NPC rendering','partial-export Character hints','offline fallback and recovery','draft stability','many-reference keyboard expansion']}));
    }catch(error){console.error(JSON.stringify({errors,responses,state:await page?.evaluate(()=>({html:document.querySelector('#app')?.innerHTML.slice(0,4000),images:[...document.images].map(image=>({src:image.src,complete:image.complete,width:image.naturalWidth}))})).catch(()=>null)}));await page?.screenshot({path:join(folder,'failure.png')});throw error;}
    finally{await browser?.close();await stop(server);await stop(apiServer);}
})().catch(error=>{console.error(error);process.exitCode=1;});
