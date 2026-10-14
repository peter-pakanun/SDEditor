// Real desktop presentation and navigation checks. Synthetic workbooks and test
// mode exercise UI contracts; they do not validate durable storage or cloud sync.
'use strict';
const assert=require('node:assert/strict');
const {readFileSync,existsSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
const express=require('express');
const runtimeModules='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright',{paths:[runtimeModules]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);
const publicDir=join(__dirname,'../public'),artifacts=join(__dirname,'../temp/attention-navigation');

async function run(){
  const serverApp=express();
  serverApp.get('/',(_req,res)=>res.type('html').send(readFileSync(join(publicDir,'index.html'),'utf8')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js','/fixture/jszip.min.js')));
  serverApp.get('/fixture/jszip.min.js',(_req,res)=>res.type('js').send(readFileSync(require.resolve('jszip/dist/jszip.min.js',{paths:[runtimeModules]}))));
  serverApp.get('/index.js',(_req,res)=>res.type('js').send(readFileSync(join(publicDir,'index.js'),'utf8')
    .replace("app.mount('#app');","window.__attentionApp=app.mount('#app');")));
  serverApp.use(express.static(publicDir));
  const server=await new Promise(resolve=>{const instance=serverApp.listen(0,'127.0.0.1',()=>resolve(instance));});
  let browser;
  const errors=[];
  try{
    assert.ok(executablePath,'Use an installed desktop browser.');
    browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});
    const page=await browser.newPage({viewport:{width:1440,height:900},ignoreHTTPSErrors:true});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/?testMode=1&lang=Thai',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.__attentionApp);
    await page.evaluate(async()=>{
      const h=window.__attentionApp;
      Object.assign(h,{showSetting:false,needsInitialSettings:false,versionChooserVisible:false,gameVersion:'poe2',loadingProgress:100,
        inlineEditor:false,pageSize:2,currentSort:'filename',currentSortDir:'asc',selectedFileFilters:['missing','saved','revised','dropped','diagnosticError','diagnosticWarning','unchanged']});
      const rows=Array.from({length:6},(_,index)=>({filepath:'attention/'+index+'.txt',filename:index+'.txt',filedir:'attention',
        translations:{English:['English '+index],Thai:[index===3?'':index===5?'Translation  5':'Translation '+index]}}));
      h.descs=rows;h._workspaceSourceBaseline=structuredClone(rows);h.localDescs={staged:{},dropped:{},droppedArchive:{},stagedVersion:1};
      await h.$nextTick();
      h.diagnosticScanChecks=Object.fromEntries(h.diagnosticScanTypes.map(type=>[type.key,type.key==='whitespace']));
      await h.scanAllDiagnostics();
      h.filterDesc();h.currentPage=1;h.selectedFilepath=rows[0].filepath;await h.$nextTick();
    });
    const next=page.getByRole('button',{name:'Next file needing attention',exact:true});
    await next.hover();await page.waitForFunction(()=>window.__attentionApp.tooltip.visible);
    assert.match(await page.locator('.appTooltip').innerText(),/Ctrl\+Shift\+\./);
    await next.click();await page.waitForFunction(()=>window.__attentionApp.editorVisible && !window.__attentionApp.editorLoading);
    assert.equal(await page.evaluate(()=>window.__attentionApp.editorCurrentEditingDesc.filepath),'attention/3.txt');
    await page.keyboard.press('Control+Shift+Period');
    await page.waitForFunction(()=>window.__attentionApp.editorCurrentEditingDesc.filepath==='attention/5.txt' && !window.__attentionApp.editorLoading);
    assert.equal(await next.isDisabled(),true);
    await page.keyboard.press('Control+Shift+Comma');
    await page.waitForFunction(()=>window.__attentionApp.editorCurrentEditingDesc.filepath==='attention/3.txt' && !window.__attentionApp.editorLoading);
    await page.evaluate(async()=>{
      const h=window.__attentionApp;await h.editorExit();h.inlineEditor=true;h.currentPage=1;h.selectedFilepath='attention/0.txt';await h.$nextTick();
    });
    await next.click();await page.waitForFunction(()=>window.__attentionApp.inlineActive && !window.__attentionApp.editorLoading);
    assert.equal(await page.evaluate(()=>window.__attentionApp.editorCurrentEditingDesc.filepath),'attention/3.txt');
    assert.equal(await page.evaluate(()=>window.__attentionApp.editorVisible),false);
    console.log('SD pointer, tooltip and inline/full attention shortcuts passed.');
    await page.evaluate(async()=>{
      const h=window.__attentionApp;await h.finishInlineSession({promote:false});
      const units=Array.from({length:6},(_,index)=>Vue.markRaw({id:JSON.stringify(['normal','NPCTalkDialogueTextAudio','Renly_Intro_A'+index]),
        role:'normal',sheet:'NPCTalkDialogueTextAudio',recordId:'Renly_Intro_A'+index,notes:[],fields:[{
          id:'Text',kind:'text',name:'Text',source:'Conversation source '+index,target:index===3?'':'Conversation translation '+index,
          sourceCell:'B'+(index+2),targetCell:'C'+(index+2),required:true,originalMissing:index===3,outdated:index===5
        }]}));
      h.ctWorkspace={scope:{accountId:'guest',game:'poe2',branchId:'default',versionId:'fixture',groupId:'local:fixture',language:'Thai'},metadata:{version:{name:'Attention fixture'}}};
      h.ctUnits=Vue.markRaw(units);h._ctUnitIndex=Vue.markRaw(new Map(units.map(unit=>[unit.id,unit])));h._ctWorkUnits=Vue.markRaw(new Map());
      h._ctNpcIndex=Vue.markRaw(await ClientTextNpcIndex.buildNpcIndex(units));
      h._ctConvoIndex=Vue.markRaw(await ClientTextConvoIndex.buildConvoIndex(units,h._ctNpcIndex));
      Object.assign(h,{ctActive:true,ctEditor:false,ctSelection:'',ctBrowseMode:'sheets',ctSheet:'',ctPage:1,ctValues:{},ctSaved:{},ctReviewed:{},ctDiagnostics:{},
        ctSelectedFilters:['missing','saved','revised','outdated','error','warning','unchanged'],ctInitializing:false,ctBusy:false,ctTool:'dictionary'});
      h.ctStorage=()=>({getDraft:async()=>null});h.ctQueueDraft=()=>{};h.ctFlushDraft=async()=>true;h.ctFlushCommentDraft=async()=>{};
      h.ctLoadHistory=()=>{};h.ctPresence=()=>{};h.ctRefreshDraftSummaries=()=>{};h.ctLoadCommentDraft=()=>{};h.ctSync=()=>{};h.ctLoadMemory=()=>{};
      await h.$nextTick();
    });
    const waitCt=recordId=>page.waitForFunction(recordId=>{
      const h=window.__attentionApp;return h.ctCurrentUnit?.recordId===recordId && !h.ctBusy && !h._ctNavigationRun && !h._ctSelectRun?.pending;
    },recordId);
    for(const mode of ['sheets','npcs','convo']){
      await page.evaluate(async mode=>{
        const h=window.__attentionApp;h.ctEditor=false;h.ctSelection='';h.ctPage=1;h.ctBrowseMode=mode;h.ctInlineClosed=false;await h.$nextTick();
      },mode);
      await next.click();await waitCt('Renly_Intro_A3');
      assert.equal(await page.evaluate(()=>window.__attentionApp.ctPage),2,mode);
      assert.equal(await page.evaluate(()=>window.__attentionApp.attentionNavigationBlocked),false,'completed navigation re-enables controls');
      await page.keyboard.press('Control+Shift+Period');await waitCt('Renly_Intro_A5');
      assert.equal(await next.isDisabled(),true,mode);
      await page.keyboard.press('Control+Shift+Comma');await waitCt('Renly_Intro_A3');
      assert.equal(await page.evaluate(()=>window.__attentionApp.ctSelectedFilters.includes('unchanged')),true,mode);
      await page.evaluate(async()=>{const h=window.__attentionApp;h.ctEditor=true;await h.$nextTick();});
      await page.getByRole('button',{name:'Next file needing attention',exact:true}).click();
      await waitCt('Renly_Intro_A5');assert.equal(await page.evaluate(()=>window.__attentionApp.ctEditor),true);
      console.log('ClientText '+mode+' inline/full attention navigation passed.');
    }
    await page.evaluate(async()=>{const h=window.__attentionApp;h.ctEditor=false;h.ctSelection='';h.ctPage=1;await h.$nextTick();});
    mkdirSync(artifacts,{recursive:true});
    for(const theme of ['light','grey','dark','modern-dark'])for(const width of [1440,1024]){
      await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
      const boxes=await page.locator('.workspacePagination .attentionArrow').evaluateAll(buttons=>buttons.map(button=>{
        const r=button.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width,height:r.height,color:getComputedStyle(button).color};
      }));
      assert.equal(boxes.length,2);assert.ok(boxes.every(box=>box.x>=0 && box.right<=width && box.width===36 && box.height===36),theme+'/'+width);
      assert.ok(await page.locator('.workspacePagination .attentionNavigationTarget').first().getAttribute('aria-label'));
      await page.screenshot({path:join(artifacts,theme+'-'+width+'.png')});
    }
    await page.locator('.workspacePagination .attentionNavigationTarget').first().focus();
    await page.waitForFunction(()=>window.__attentionApp.tooltip.visible);
    assert.match(await page.locator('.appTooltip').innerText(),/No available file needing attention/);
    assert.deepEqual(errors,[]);
    console.log('Attention buttons, tooltips, pointer and keyboard navigation passed in SD and ClientText Sheets/NPCs/Convo, inline/full, four themes and two desktop widths.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
