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
    const assertRowVisible=async(selector,edge)=>{
      await page.waitForFunction(({selector,edge})=>{
        const row=document.querySelector(selector),workspace=row?.closest('.workspace');if(!row || !workspace)return false;
        const bounds=row.getBoundingClientRect(),top=workspace.querySelector('.workspaceHeader').getBoundingClientRect().bottom+8,
          bottom=workspace.querySelector('.workspaceFooter').getBoundingClientRect().top-8;
        return edge==='start'?bounds.top>=top-1 && bounds.top<bottom-40:bounds.bottom<=bottom+1 && bounds.bottom>top+40;
      },{selector,edge});
    };
    await page.evaluate(async()=>{
      const h=window.__attentionApp;
      Object.assign(h,{showSetting:false,needsInitialSettings:false,versionChooserVisible:false,gameVersion:'poe2',loadingProgress:100,
        inlineEditor:false,pageSize:20,currentSort:'filename',currentSortDir:'asc',selectedFileFilters:['missing','saved','revised','dropped','diagnosticError','diagnosticWarning','unchanged']});
      const rows=Array.from({length:45},(_,index)=>({filepath:'scroll/'+String(index).padStart(2,'0')+'.txt',filename:String(index).padStart(2,'0')+'.txt',filedir:'scroll',
        translations:{English:index===38?Array.from({length:30},(_,entry)=>'English '+index+' entry '+entry):[Array.from({length:4},()=> 'English '+index).join('\\n')],
          Thai:index===38?Array(30).fill(''):[index===18?'':Array.from({length:4},()=> 'Translation '+index).join('\\n')]}}));
      h.descs=rows;h._workspaceSourceBaseline=structuredClone(rows);h.localDescs={staged:{},dropped:{},droppedArchive:{},stagedVersion:1};
      h.filterDesc();h.currentPage=1;h.selectedFilepath=rows[0].filepath;await h.$nextTick();
    });
    const nextPage=page.getByRole('button',{name:'Next page',exact:true}),previousPage=page.getByRole('button',{name:'Previous page',exact:true});
    await nextPage.click();await assertRowVisible('tr[data-filepath="scroll/20.txt"]','start');
    assert.equal(await nextPage.evaluate(button=>document.activeElement===button),true);
    await nextPage.click();await assertRowVisible('tr[data-filepath="scroll/40.txt"]','start');
    await previousPage.click();await assertRowVisible('tr[data-filepath="scroll/39.txt"]','end');
    await previousPage.click();await assertRowVisible('tr[data-filepath="scroll/19.txt"]','end');
    await page.locator('tr[data-filepath="scroll/19.txt"]').focus();await page.keyboard.press('ArrowRight');
    await assertRowVisible('tr[data-filepath="scroll/20.txt"]','start');
    await page.keyboard.press('ArrowLeft');await assertRowVisible('tr[data-filepath="scroll/19.txt"]','end');
    await page.evaluate(async()=>{const h=window.__attentionApp;h.inlineEditor=true;h.selectedFilepath='scroll/00.txt';await h.$nextTick();});
    await page.getByRole('button',{name:'Next file needing attention',exact:true}).click();
    await page.waitForFunction(()=>window.__attentionApp.inlineActive && !window.__attentionApp.editorLoading);
    await assertRowVisible('tr[data-filepath="scroll/18.txt"]','start');
    await page.getByRole('button',{name:'Next file needing attention',exact:true}).click();
    await page.waitForFunction(()=>window.__attentionApp.editorCurrentEditingDesc?.filepath==='scroll/38.txt' && !window.__attentionApp.editorLoading);
    await assertRowVisible('tr[data-filepath="scroll/38.txt"]','start');
    assert.ok(await page.locator('tr[data-filepath="scroll/38.txt"]').evaluate(row=>row.getBoundingClientRect().height>window.innerHeight),'A tall inline SD file reveals its beginning.');
    await page.evaluate(()=>window.__attentionApp.finishInlineSession({promote:false}));
    console.log('Long SD pages reveal first/last files and the opened inline attention file with pointer and keyboard navigation.');
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
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
    await page.keyboard.press('Control+Shift+Period');
    await page.waitForFunction(()=>window.__attentionApp.editorCurrentEditingDesc.filepath==='attention/5.txt' && !window.__attentionApp.editorLoading);
    await page.waitForFunction(()=>Math.abs(document.querySelector('.editor').getBoundingClientRect().top)<1);
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
      await page.waitForFunction(()=>Math.abs(document.querySelector('.editor').getBoundingClientRect().top)<1);
      console.log('ClientText '+mode+' inline/full attention navigation passed.');
    }
    await page.evaluate(async()=>{
      const h=window.__attentionApp;
      const units=Array.from({length:45},(_,index)=>Vue.markRaw({id:'scroll-'+index,role:'normal',sheet:'ClientStrings',recordId:'Scroll_'+String(index).padStart(2,'0'),notes:[],fields:[{
        id:'Text',kind:'text',name:'Text',source:Array.from({length:index===38?60:4},()=> 'English '+index).join('\n'),
        target:index===18 || index===38?'':Array.from({length:4},()=> 'Translation '+index).join('\n'),required:true,originalMissing:index===18 || index===38
      }]}));
      h.ctEditor=false;h.ctSelection='';h.ctUnits=Vue.markRaw(units);h._ctUnitIndex=Vue.markRaw(new Map(units.map(unit=>[unit.id,unit])));
      Object.assign(h,{ctBrowseMode:'sheets',ctSheet:'',ctPage:1,pageSize:20,ctInlineClosed:false,ctValues:{},ctSaved:{},ctReviewed:{},ctDiagnostics:{}});await h.$nextTick();
    });
    await nextPage.click();await assertRowVisible('tr[data-unit-id="scroll-20"]','start');
    assert.equal(await nextPage.evaluate(button=>document.activeElement===button),true);
    await nextPage.click();await assertRowVisible('tr[data-unit-id="scroll-40"]','start');
    await previousPage.click();await assertRowVisible('tr[data-unit-id="scroll-39"]','end');
    await previousPage.click();await assertRowVisible('tr[data-unit-id="scroll-19"]','end');
    await next.click();await waitCt('Scroll_18');await assertRowVisible('tr[data-unit-id="scroll-18"]','start');
    await next.click();await waitCt('Scroll_38');await assertRowVisible('tr[data-unit-id="scroll-38"]','start');
    assert.ok(await page.locator('tr[data-unit-id="scroll-38"]').evaluate(row=>row.getBoundingClientRect().height>window.innerHeight),'A tall inline ClientText file reveals its beginning.');
    console.log('Long ClientText pages reveal first/last files and the opened inline attention file.');
    await page.evaluate(async()=>{const h=window.__attentionApp;h.ctEditor=false;h.ctSelection='scroll-0';h.ctInlineClosed=true;h.ctPage=1;await h.$nextTick();});
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
