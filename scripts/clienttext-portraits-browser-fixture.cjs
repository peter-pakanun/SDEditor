'use strict';
// Real shared English fields, preview/shell, portrait component and API route.
const assert=require('node:assert/strict');
const {readFileSync,existsSync,mkdirSync}=require('node:fs');
const {resolve,join,basename}=require('node:path');
const Codec=require('../public/clientTextCodec.js'),Identities=require('../public/clientTextIdentities.js'),NPC=require('../public/clientTextNpcIndex.js'),Convo=require('../public/clientTextConvoIndex.js');
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
    const workbookChecks=[];let workbookContext=null;
    if(process.argv[2]){
        const parsed=await Codec.parseWorkbook(readFileSync(process.argv[2]),{filename:basename(process.argv[2]).replace(/^hint-/,''),language:'Thai'});
        assert.ok(!parsed.units.some(unit=>unit.sheet==='Characters'),'partial fixture omits Characters');
        for(const [path,entry]of Object.entries(portraitCatalog.games.poe2.characters)){
            const unit=parsed.units.find(unit=>unit.metadata?.Character===path);assert.ok(unit,'actual workbook Character '+path);
            workbookChecks.push({unit:{id:unit.id,recordId:unit.recordId,role:unit.role,sheet:unit.sheet,metadata:unit.metadata},heading:'Character',name:entry[1],id:entry[0]});
        }
        for(const id of ['Witch3','Witch3b','Sorceress2','Mercenary3','Monk3']){
            const unit=parsed.units.find(unit=>unit.metadata?.['Ascendancy Filter']?.split(/[,\s]+/).includes(id));assert.ok(unit,'actual workbook Ascendancy '+id);
            workbookChecks.push({unit:{id:unit.id,recordId:unit.recordId,role:unit.role,sheet:unit.sheet,metadata:unit.metadata},heading:'Ascendancy Filter',name:Identities.reference(id,'poe2',{variants:true}).label});
        }
        const observed=[parsed.units.find(unit=>unit.recordId.startsWith('Mentor_A5_ArriveHarbour') && unit.metadata?.NPC?.trim()),
            parsed.units.find(unit=>unit.recordId==='Mentor_A5_ArriveHarbour_A3_Int4'),parsed.units.find(unit=>unit.recordId==='PantheonAfterCutscene_A1_Sin'),parsed.units.find(unit=>unit.recordId==='Mentor_A5_OnOriath_A1')];
        observed.forEach(unit=>{assert.ok(unit,'observed Hooded One row exists');workbookChecks.push({unit:{id:unit.id,recordId:unit.recordId,role:unit.role,sheet:unit.sheet,metadata:unit.metadata},portraitIds:unit.metadata.Character?['hooded-one','witch']:['hooded-one']});});
        const npcIndex=await NPC.buildNpcIndex(parsed.units),convoIndex=await Convo.buildConvoIndex(parsed.units,npcIndex);
        workbookContext={groups:npcIndex.groups,memberships:workbookChecks.map(check=>[check.unit.id,convoIndex.memberships.get(check.unit.id)])};
    }
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
        front.get('/',(req,res)=>res.type('html').send(`<!doctype html><html data-theme="modern-dark"><head><link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/interface.css"><link rel="stylesheet" href="/client-text.css"><link rel="stylesheet" href="/inline-editor.css"><style>:root{--density:1}body{padding:24px;box-sizing:border-box}main{max-width:1400px;margin:auto}.panes{display:grid;grid-template-columns:1fr 1fr;gap:24px}.panes>section{min-width:0}textarea{box-sizing:border-box;width:100%;min-height:90px}h2{font-size:16px}.ctFields{min-width:0}.editor>.edit{margin-right:0}.editor>.side{display:none}</style></head><body><main id="app"><h1>ClientText English reference portraits</h1><ct-context :host="host" :items="host.ctReferenceMetadata(host.ctCurrentUnit)"></ct-context><editor-full-shell class="ctFull ctFullEditor" v-if="full" :controller="host" preview-host-id="ctFullEditorPreviewHost" sidebar-host-id="fixtureSidebar"><ct-fields :host="host"></ct-fields></editor-full-shell><div v-else class="panes"><section><h2>English</h2><ct-fields :host="host" side="source"></ct-fields></section><section><h2>Translation</h2><textarea aria-label="Translation">A translation draft</textarea></section></div><div v-if="!full" id="inlineEditorPreviewHost" class="inlinePreviewHost" v-show="host.ctTool==='preview'"></div><editor-preview :controller="host" :target="full?'#ctFullEditorPreviewHost':'#inlineEditorPreviewHost'"></editor-preview></main><script src="/fixture/vue.js"></script><script src="/clientTextPortraitCatalog.js"></script><script src="/clientTextIdentities.js"></script><script src="/contentAdapters.js"></script><script src="/clientTextPortraits.js"></script><script src="/editorComponents.js"></script><script src="/clientTextUi.js"></script><script>
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
        window.fixtureWorkbookContext=${JSON.stringify(workbookContext)};window.fixtureWorkbookChecks=${JSON.stringify(workbookChecks).replace(/</g,'\\u003c')};window.fixtureRecords=records;window.fixtureResolver=resolver;window.fixtureGroups=groups;
        const actualContext=window.fixtureWorkbookContext,actualIndex=actualContext?{groups:actualContext.groups,groupByKey:new Map(actualContext.groups.map(group=>[group.key,group])),memberships:new Map()}:null;
        const actualResolver=actualContext?ClientTextPortraits.createResolver({npcIndex:actualIndex,convoIndex:{memberships:new Map(actualContext.memberships)},game:'poe2'}):null;
        const actualIds=new Set(fixtureWorkbookChecks.map(check=>check.unit.id));window.fixtureResolvePortraits=unit=>actualIds.has(unit.id)?actualResolver(unit):resolver(unit);
        fixtureHost.ctRowPortraits=fixtureResolvePortraits;
        Object.assign(fixtureHost,{ctReferenceMetadata:unit=>ContentAdapters.clienttext.referenceMetadata(unit,undefined,{game:'poe2'}),ctActive:true,ctEditor:false,inlineSidebarVisible:true,ctTool:'dictionary',ctPreviewMounted:true,hideSourceInPreviewPanel:false,hideEditorClipboard:true,fullEditorPreviewHeight:null,
            gamePreviewFrame:'m',gamePreviewIsDialogue:true,gamePreviewDefaultTextColor:'#fffbd6',gamePreviewSourceFontFamily:'sans-serif',gamePreviewFontFamily:'sans-serif',gamePreviewSourceIsTable:false,gamePreviewTargetIsTable:false,
            gamePreviewVarKeyList:[],gamePreviewVarValues:{},ctPossessivePreviewForms:false,translationEditorBcp47:'th',gamePreviewDisplaySource:[{type:'text',text:'What is it this time?'}],
            gamePreviewTargetRows:[{key:'target',label:'',segments:[{type:'text',text:'มีอะไรอีกล่ะ?'}]}],gamePreviewAudioSegments:segments=>segments});
        Object.defineProperties(fixtureHost,{ctPortraitsInPreview:{get(){return ClientTextUI.mixin.computed.ctPortraitsInPreview.call(this);}},ctPreviewPortraits:{get(){return ClientTextUI.mixin.computed.ctPreviewPortraits.call(this);}},gamePreviewFullEditor:{get(){return this.ctEditor;}}});
        const app=Vue.createApp({data:()=>({host:window.fixtureHost}),computed:{full:{get(){return this.host.ctEditor;},set(value){this.host.ctEditor=value;}}}});app.component('ct-context',ClientTextUI.contextComponent);app.component('ct-fields',ClientTextUI.fieldsComponent);app.component('ct-portraits',ClientTextPortraits.component);app.component('editor-preview',EditorComponents.Preview);app.component('editor-full-shell',EditorComponents.FullEditorShell);app.component('editor-native-field',EditorComponents.NativeField);app.component('ct-target',{template:'<textarea></textarea>'});app.directive('tooltip',{});window.fixtureApp=app.mount('#app');
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
        for(const theme of ['light','grey','dark','modern-dark'])for(const width of [1440,1100]){
            await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
            await page.waitForFunction(()=>document.querySelector('.ctPreviewPortraitBand .ctPortrait img')?.naturalWidth>0);
            assert.equal(await page.locator('.ctFullFieldPair .ctPortraitStack').count(),0,'preview portraits are not duplicated below source');
            assert.equal(await page.locator('.ctPreviewPortraitBand .ctPortrait').count(),2);
            const geometry=await page.locator('.gamePreviewStrip').evaluate(strip=>{const band=strip.querySelector('.ctPreviewPortraitBand').getBoundingClientRect(),source=strip.querySelector('.gamePreviewSourcePane .gamePreviewWindow').getBoundingClientRect(),target=strip.querySelector('.gamePreviewTargetPane .gamePreviewWindow').getBoundingClientRect();return {bandBottom:band.bottom,sourceY:source.y,targetY:target.y,sourceHeight:source.height,targetHeight:target.height,bottom:strip.getBoundingClientRect().bottom,sourceBottom:source.bottom,targetBottom:target.bottom,overflow:document.documentElement.scrollWidth>innerWidth};});
            assert.ok(geometry.bandBottom<=geometry.sourceY,'portraits are above English preview');assert.ok(Math.abs(geometry.sourceY-geometry.targetY)<=1,'English and Thai start aligned below the band');
            assert.ok(geometry.sourceHeight>=80 && geometry.targetHeight>=80,'portraits leave useful preview space');assert.ok(geometry.sourceBottom<=geometry.bottom && geometry.targetBottom<=geometry.bottom,'both short previews remain visible');assert.equal(geometry.overflow,false);
            if(width===1440 && ['light','modern-dark'].includes(theme))await page.screenshot({path:join(folder,'english-full-'+theme+'.png')});
        }
        await page.locator('.editorPreviewResizeHandle').focus();await page.keyboard.press('Home');
        assert.ok(await page.locator('.gamePreviewSourcePane .gamePreviewWindow').evaluate(element=>element.getBoundingClientRect().height)>=80,'minimum resize leaves text space below portraits');
        await page.keyboard.press('End');assert.ok(await page.locator('.editorPreviewPane').evaluate(element=>element.getBoundingClientRect().height)<=451);
        await page.evaluate(()=>fixtureHost.gamePreviewDisplaySource=[{type:'text',text:'A long dialogue line. '.repeat(500)}]);
        const scrolling=await page.locator('.gamePreviewStrip').evaluate(strip=>{const source=strip.querySelector('.gamePreviewSourcePane'),target=strip.querySelector('.gamePreviewTargetPane'),band=strip.querySelector('.ctPreviewPortraitBand'),top=band.getBoundingClientRect().top;source.scrollTop=500;return {source:source.scrollTop,target:target.scrollTop,top,after:band.getBoundingClientRect().top};});
        assert.ok(scrolling.source>0,'long English preview scrolls');assert.equal(scrolling.target,0,'translation retains its independent scroll');assert.equal(scrolling.top,scrolling.after,'portrait band stays above both scrolling panes');
        await page.evaluate(()=>fixtureHost.gamePreviewDisplaySource=[{type:'text',text:'What is it this time?'}]);
        await page.evaluate(()=>fixtureHost.hideSourceInPreviewPanel=true);
        assert.equal(await page.locator('.ctPreviewPortraitBand').count(),0,'hidden English preview has no portrait band');
        assert.equal(await page.locator('.ctSourceBlock .ctPortrait').count(),2,'hidden English preview returns portraits below source/audio');
        await page.screenshot({path:join(folder,'english-preview-hidden-modern-dark.png')});
        await page.evaluate(()=>{fixtureHost.hideSourceInPreviewPanel=false;fixtureHost.ctRowPortraits=()=>[];});
        assert.equal(await page.locator('.ctPreviewPortraitBand').count(),0,'rows with no character reference reserve no band');
        await page.evaluate(()=>fixtureHost.ctRowPortraits=fixtureResolvePortraits);
        await page.evaluate(()=>fixtureApp.full=false);
        await page.evaluate(()=>fixtureHost.ctTool='preview');
        assert.equal(await page.locator('.ctSourceBlock .ctPortraitStack').count(),0,'open inline preview owns portraits');
        assert.equal(await page.locator('#inlineEditorPreviewHost .ctPreviewPortraitBand .ctPortrait').count(),2);
        const inlineGeometry=await page.locator('#inlineEditorPreviewHost').evaluate(element=>({band:element.querySelector('.ctPreviewPortraitBand').getBoundingClientRect().bottom,source:element.querySelector('.gamePreviewSourcePane .gamePreviewWindow').getBoundingClientRect().top}));
        assert.ok(inlineGeometry.band<=inlineGeometry.source,'inline portraits are above English preview');
        await page.evaluate(()=>fixtureHost.ctTool='dictionary');
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
        for(let index=0;index<workbookChecks.length;index++){
            const check=workbookChecks[index];await page.evaluate(index=>fixtureHost.ctCurrentUnit=fixtureWorkbookChecks[index].unit,index);
            const context=await page.locator('.ctReferenceContext').evaluate(element=>Object.fromEntries([...element.querySelectorAll('.ctContextEntry')].map(row=>[row.querySelector('dt').textContent,row.querySelector('dd').textContent])));
            if(check.heading)assert.ok(context[check.heading].includes(check.name),'actual partial workbook metadata renders '+check.name);
            if(check.portraitIds)assert.deepEqual(await page.locator('.ctPortrait').evaluateAll(cards=>cards.map(card=>card.querySelector('img')?.src.split('/').at(-1).split('.webp')[0] || '')),check.portraitIds,'observed Hooded One row has no duplicate or placeholder');
            if(check.id){assert.ok((await page.locator('.ctPortraitCaption').allTextContents()).includes(check.name+(portraitCatalog.games.poe2.labels[check.id].provisional?' *':'')),'actual partial workbook portrait matches '+check.name);}
            if(check.portraitIds)await page.screenshot({path:join(folder,'actual-'+check.unit.recordId+'.png')});
            if(['Witch','Sorceress','Abyssal Lich'].includes(check.name))await page.screenshot({path:join(folder,'actual-metadata-'+check.name.toLowerCase().replaceAll(' ','-')+'.png')});
        }
        expectedMediaFailure=true;await page.route('**/portraits/poe2/'+npcSources[fixturePaths[3]][0]+'.webp?*',route=>route.abort());await page.evaluate(()=>fixtureHost.ctCurrentUnit=fixtureRecords.dannig);
        await page.locator('.ctPortraitMissing').waitFor();assert.equal(await page.locator('textarea[aria-label="Translation"]').inputValue(),'A translation draft');
        await page.unroute('**/portraits/poe2/'+npcSources[fixturePaths[3]][0]+'.webp?*');await page.evaluate(()=>dispatchEvent(new Event('online')));
        await page.waitForFunction(()=>document.querySelector('.ctPortrait img')?.naturalWidth>0);
        expectedMediaFailure=false;
        await page.evaluate(()=>{const known=fixtureResolver(fixtureRecords.ailith);fixtureHost.ctRowPortraits=()=>[...known,...fixtureResolver(fixtureRecords.doryani).concat(fixtureResolver(fixtureRecords.dannig)).map((item,index)=>({...item,key:'extra'+index}))];});
        await page.mouse.move(0,0);await page.locator('.ctPortraitMore').waitFor();assert.equal(await page.locator('.ctPortrait').count(),4);
        await page.locator('.ctPortraitStack').focus();assert.equal(await page.locator('.ctPortrait').count(),5);await page.keyboard.press('Escape');assert.equal(await page.locator('.ctPortrait').count(),4);
        assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,partialWorkbookChecks:workbookChecks.length,deliveredPortraits,majorNpcRenders:majorNames.length,staticClassRenders:classes.length,themes:4,widths:[1440,1100],screenshots:folder,checks:['preview portrait band','aligned English/Thai preview starts','preview-hidden source fallback','inline preview/source handoff','preview resize and independent scrolling','canonical order','image delivery','verified major NPC rendering','partial-export Character hints','offline fallback and recovery','draft stability','many-reference keyboard expansion']}));
    }catch(error){console.error(JSON.stringify({errors,responses,state:await page?.evaluate(()=>({html:document.querySelector('#app')?.innerHTML.slice(0,4000),images:[...document.images].map(image=>({src:image.src,complete:image.complete,width:image.naturalWidth}))})).catch(()=>null)}));await page?.screenshot({path:join(folder,'failure.png')});throw error;}
    finally{await browser?.close();await stop(server);await stop(apiServer);}
})().catch(error=>{console.error(error);process.exitCode=1;});
