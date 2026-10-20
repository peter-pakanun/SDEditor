// Local-only collection endpoints, native IndexedDB and production dialog/worker. No real team is ended.
// Matrix: FIXTURE_TAB_STATUS=revised|filled and FIXTURE_WORKBOOK_EXTENSION=xlsx|xlsm.
'use strict';
const assert=require('node:assert/strict');
const {readFileSync,existsSync,mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const express=require('express'),JSZip=require('jszip');
const Codec=require('../public/clientTextCodec.js');
const runtime='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(require.resolve('playwright',{paths:[runtime]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const tabStatus=process.env.FIXTURE_TAB_STATUS || 'revised',extension=process.env.FIXTURE_WORKBOOK_EXTENSION || 'xlsx';
assert.ok(['revised','filled'].includes(tabStatus));assert.ok(['xlsx','xlsm'].includes(extension));
const expectedTab=tabStatus==='filled'?'626B7A':'793BB6';
const output=resolve(__dirname,'../temp/clienttext-export-browser',tabStatus+'-'+extension);mkdirSync(output,{recursive:true});process.env.TEMP=output;process.env.TMP=output;
const publicDir=resolve(__dirname,'../public'),html=readFileSync(join(publicDir,'index.html'),'utf8');
const dialog=html.slice(html.indexOf('    <dialog ref="ctExportDialog"'),html.indexOf('    <section v-if="workspaceInitializationActive'));
async function workbook(){
 const zip=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const cell=(r,v)=>`<c r="${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
 zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="${extension==='xlsm'?'application/vnd.ms-excel.sheet.macroEnabled.main+xml':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'}"/></Types>`);
 zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Normal" sheetId="1" r:id="rId1"/></sheets></workbook>`);
 zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
 zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetPr codeName="ExportFixture"><tabColor rgb="FFFA8072"/><outlinePr summaryBelow="0"/></sheetPr><sheetData><row r="1">${cell('A1','ID')+cell('C1','Name')+cell('D1','Translation')}</row><row r="2">${cell('A2','fixture')+cell('C2','Source')+cell('D2',tabStatus==='filled'?'':'Original')}</row></sheetData></worksheet>`);
 zip.file('xl/styles.xml',`<styleSheet xmlns="${ns}"><fonts count="1"><font/></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
 zip.file('xl/native.bin',new Uint8Array([0,255,7,8,9]));if(extension==='xlsm')zip.file('xl/vbaProject.bin',new Uint8Array([1,9,255]));return zip.generateAsync({type:'nodebuffer'});
}
async function assertCellFillsAndPackage(bytes,name,target){
 const parsed=await Codec.parseWorkbook(bytes,{filename:name,role:name.includes('_Gender')?'gender':'normal'});
 assert.equal(parsed.units[0].fields[0].target,target);
 assert.equal(parsed.units[0].fields[0].originalFill,tabStatus==='filled'?'D9D9D9':'D9D2E9','Darker tabs never replace standard cell fills');
 const original=await JSZip.loadAsync(await workbook()),output=await JSZip.loadAsync(bytes);
 for(const name of Object.keys(original.files))if(!original.files[name].dir && !['xl/styles.xml','xl/worksheets/sheet1.xml'].includes(name))assert.deepEqual(await output.file(name).async('uint8array'),await original.file(name).async('uint8array'),name+' remains byte exact');
}
async function main(){
 let mode='success',manifest,collection={id:'fixture-collection'},posts=0,abortedConnections=0,held=[];
 const serverApp=express();serverApp.use(express.json());
 serverApp.get('/',(req,res)=>res.type('html').send(`<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/interface.css"><style>body{padding:32px}.fixture{max-width:900px;margin:auto}</style></head><body><div id="app" class="fixture"><h1>Local ClientText export fixture</h1><p>Disposable browser storage, simulated collection service, real workbook worker.</p><button id="collect" @click="ctCollect(version,group,team,true)">Download and end</button><button id="export" @click="ctDownload()">Export local Saved work</button><button id="reopen" @click="ctShowExport">View export timings</button>${dialog}</div><script src="/fixture/vue.js"></script>${['clientTextState.js','clientTextStore.js','clientTextTransport.js','clientTextWorkerClient.js','clientTextExportProgress.js','clientTextUi.js'].map(name=>'<script src="/'+name+'"></script>').join('')}<script>
 const mixin=ClientTextUI.mixin;window.app=Vue.createApp({data(){return{...mixin.data(),lang:'French',gameVersion:'poe2',cloudProfileId:'fixture',branchId:'default',managedCatalogScope:'fixture:poe2',cloudCanAccessAllLanguages:true,version:{id:'fixture-version',name:'Fixture'},group:{id:'fixture-group',contentMode:'clienttext'},team:{language:'French'}}},computed:mixin.computed,methods:mixin.methods}).mount('#app');
 </script></body></html>`));
 serverApp.get('/fixture/vue.js',(req,res)=>{const source=process.env.FIXTURE_VUE_PATH || resolve(__dirname,'../temp/clienttext-fixture-vue.min.js');if(existsSync(source))res.type('js').send(readFileSync(source));else res.redirect('https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js');});
 serverApp.get('/fixture/jszip.js',(req,res)=>res.type('js').send(readFileSync(require.resolve('jszip/dist/jszip.min.js'))));
 serverApp.get('/clientTextWorker.js',(req,res)=>res.type('js').send(readFileSync(join(publicDir,'clientTextWorker.js'),'utf8').replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js','/fixture/jszip.js')));
 serverApp.get('/fixture.xlsx',async(req,res)=>res.send(await workbook()));
 serverApp.post('/v1/content-groups/:group/teams/:lang/collections',(req,res)=>{
  posts++;if(mode==='collection-hold'){held.push(res);res.on('close',()=>{if(!res.writableEnded)abortedConnections++;});return;}
  res.json({collection});
 });
 serverApp.get('/v1/content-collections/:id/manifest',(req,res)=>{
  if(mode==='manifest-hold'){held.push(res);res.on('close',()=>{if(!res.writableEnded)abortedConnections++;});return;}
  if(mode==='failure')return res.status(503).json({error:'fixture manifest failure'});
  res.json({collection,manifest});
 });
 serverApp.use(express.static(publicDir));
 const server=await new Promise(resolve=>{const server=serverApp.listen(0,'127.0.0.1',()=>resolve(server));});
 let browser;const results=[],layouts=[],errors=[];
 try{
  browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();page.on('console',message=>{if(message.type()==='error')console.error(message.text());});page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  manifest=await page.evaluate(async({extension})=>{
   const app=window.app;const opening=indexedDB.open('export-fixture',1);
   const db=await new Promise((resolve,reject)=>{opening.onupgradeneeded=()=>ClientTextStore.upgrade(opening.result,opening.transaction);opening.onsuccess=()=>resolve(opening.result);opening.onerror=()=>reject(opening.error);});
   app._ctStore=ClientTextStore.create({openDb:async()=>db});app.ctFlushDraft=async()=>true;app.managedReadDetails=async()=>{};
   app._cloud={async request(path,options={}){const response=await fetch(path,{method:options.method||'GET',headers:{'Content-Type':'application/json'},body:options.body?JSON.stringify(options.body):undefined,signal:options.signal});if(!response.ok)throw Error('Local fixture response failed');return response.json();}};
   const bytes=await(await fetch('/fixture.xlsx')).arrayBuffer(),worker=ClientTextWorkerClient.create();
   const assets=[],units=[],descriptors=[];
   for(const role of ['normal','gender']){
    const name=(role==='normal'?'French':'French_Gender')+'.'+extension;const parsed=await worker.parseWorkbook(bytes,{filename:name,role,language:'French'});
    units.push(...parsed.units);const descriptor={role,assetHash:parsed.artifactHash,parserVersion:parsed.parserVersion};descriptors.push(descriptor);
    assets.push({role,name,blob:new Blob([bytes]),parsed:{...parsed,units:undefined},descriptor});
   }
   const originals=await worker.buildDescriptors(units,assets.map(asset=>({role:asset.role,hash:asset.parsed.artifactHash,parserVersion:asset.parsed.parserVersion})));descriptors.splice(0,descriptors.length,...originals.descriptors);for(const asset of assets)asset.descriptor=descriptors.find(item=>item.role===asset.role);
   worker.dispose();const scope=app.ctScope(app.version.id,app.group.id,'French');
   await app._ctStore.import(scope,{units,assets,descriptors,metadata:{version:app.version,group:app.group}});
   for(const unit of units)await app._ctStore.save(scope,unit.id,{jobId:'fixture-'+unit.role,values:Object.fromEntries(unit.fields.map(field=>[field.id,'Local Saved target'])),reviewed:{},baseRevision:0,expectedRevision:0});
   app.ctWorkspace={scope,metadata:{version:app.version,group:app.group}};
   window.workers=[];const create=ClientTextWorkerClient.create;ClientTextWorkerClient.create=(...args)=>{const worker=create(...args);window.workers.push(worker);return worker;};
   window.savedBlobs=[];window.saveAs=(blob,name)=>{savedBlobs.push({blob,name});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
   return{groupId:app.group.id,versionId:app.version.id,language:'French',assets:assets.map(asset=>({role:asset.role,artifactHash:asset.parsed.artifactHash,descriptor:asset.descriptor})),units:units.map(unit=>({id:unit.id,values:Object.fromEntries(unit.fields.map(field=>[field.id,'Frozen target @ value']))}))};
  },{extension});
  const waitFinished=()=>page.waitForFunction(()=>app.ctExportTiming?.status!=='running' && !app.ctBusy);
  // Keep a real fetch pending long enough to inspect the compact dialog and keyboard focus.
  mode='manifest-hold';await page.locator('#collect').click();await page.waitForFunction(()=>app.ctExportTiming?.rows.at(-1)?.label==='Manifest retrieval (network + server)');
  const modal=page.locator('dialog');assert(await modal.isVisible());assert.equal(await modal.evaluate(d=>d.contains(document.activeElement)),true);
  for(const viewport of [{width:1440,height:1000},{width:900,height:650},{width:390,height:740}]){
   await page.setViewportSize(viewport);
   for(const theme of ['light','grey','dark','modern-dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const box=await modal.boundingBox();assert(box.x>=0 && box.y>=0 && box.x+box.width<=viewport.width+1 && box.y+box.height<=viewport.height+1);assert(box.height<viewport.height-20);
    layouts.push({theme,viewport,box});await page.screenshot({path:join(output,theme+'-'+viewport.width+'.png')});
   }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.keyboard.press('Shift+Tab');assert.equal(await modal.evaluate(d=>d.contains(document.activeElement)),true);
  await page.keyboard.press('Escape');await waitFinished();assert.equal(await page.evaluate(()=>app.ctExportTiming.status),'aborted');assert.equal(await page.evaluate(()=>app.ctExportTiming.collection),'accepted');assert.equal(await page.evaluate(()=>savedBlobs.length),0);
  await page.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.locator('#collect').evaluate(e=>e===document.activeElement),true);
  for(const response of held)response.destroy();held=[];
  results.push('All four themes at 1440x1000, 900x650 and 390x740 fit a compact dialog; native modal focus is trapped, Escape aborts fetch and Close restores trigger focus.');
  assert(abortedConnections>=1);
  mode='success';let download=page.waitForEvent('download').catch(()=>null);await page.locator('#collect').click();await waitFinished();if(await page.evaluate(()=>app.ctExportTiming.status!=='done'))throw Error(await page.evaluate(()=>app.ctError+' '+app.ctExportLogText));let downloaded=await download;await downloaded.saveAs(join(output,'paired.zip'));await waitFinished();
  assert.equal(posts,1,'Accepted collection retry sends no new end request');
  assert.equal(downloaded.suggestedFilename(),'Fixture_French_ClientText_Translated.zip');
  const zip=await JSZip.loadAsync(readFileSync(join(output,'paired.zip')));assert.deepEqual(Object.keys(zip.files),['French_Translated.'+extension,'French_Gender_Translated.'+extension]);
  for(const name of Object.keys(zip.files)){
   await assertCellFillsAndPackage(await zip.file(name).async('nodebuffer'),name,'Frozen target @ value');
   const workbookZip=await JSZip.loadAsync(await zip.file(name).async('nodebuffer'));
   assert.deepEqual(await workbookZip.file('xl/native.bin').async('uint8array'),new Uint8Array([0,255,7,8,9]));
   assert((await workbookZip.file('xl/worksheets/sheet1.xml').async('string')).includes('Frozen target @ value'));
   assert((await workbookZip.file('xl/worksheets/sheet1.xml').async('string')).includes('<tabColor rgb="FF'+expectedTab+'"/>'),'Frozen collection uses the darker '+tabStatus+' sheet tab');
   if(extension==='xlsm')assert.deepEqual(await workbookZip.file('xl/vbaProject.bin').async('uint8array'),new Uint8Array([1,9,255]));
   assert((await workbookZip.file('xl/worksheets/sheet1.xml').async('string')).includes('<outlinePr summaryBelow="0"/>'));
  }
  assert.equal(await page.evaluate(()=>workers.every(w=>w.disposed && !w.worker && w.pending.size===0)),true);
  await context.grantPermissions(['clipboard-read','clipboard-write']);await page.getByRole('button',{name:'Copy timings',exact:true}).click();
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Worker compression/);
  assert(!(await page.evaluate(()=>navigator.clipboard.readText())).includes('Frozen target'));
  assert(await page.locator('.ctExportPhases').evaluate(element=>element.clientHeight<=230 && element.scrollHeight>element.clientHeight));await page.screenshot({path:join(output,'completed.png')});await page.getByRole('button',{name:'Close',exact:true}).click();await page.locator('#reopen').click();assert.match(await modal.textContent(),/Download initiated/);await page.getByRole('button',{name:'Close',exact:true}).click();
  results.push('Accepted receipt retry produces the real paired ZIP without a second POST; native package bytes and frozen targets survive. Worker resources are disposed. Completed timings reopen and copy without translation text.');
  // A collection abort before response retains its request ID; retry is deliberately the same operation.
  mode='collection-hold';await page.locator('#collect').click();await page.waitForFunction(()=>app.ctExportTiming?.collection==='uncertain');await page.getByRole('button',{name:'Abort',exact:true}).click();await waitFinished();assert.equal(await page.evaluate(()=>app.ctExportTiming.collection),'uncertain');await page.getByRole('button',{name:'Close',exact:true}).click();held.forEach(r=>r.destroy());held=[];
  mode='failure';await page.locator('#collect').click();await waitFinished();assert.equal(await page.evaluate(()=>app.ctExportTiming.status),'failed');assert.match(await modal.textContent(),/highlighted phase failed/);await page.screenshot({path:join(output,'failed.png')});await page.getByRole('button',{name:'Close',exact:true}).click();
  results.push('Abort during collection fetch reports unknown server outcome; failed manifest retains an accepted receipt and readable timings.');
  mode='success';download=page.waitForEvent('download').catch(()=>null);await page.locator('#collect').click();await download;await waitFinished();await page.getByRole('button',{name:'Close',exact:true}).click();
  download=page.waitForEvent('download').catch(()=>null);await page.locator('#export').click();const localDownload=await download;await localDownload.saveAs(join(output,'local-paired.zip'));await waitFinished();
  const localZip=await JSZip.loadAsync(readFileSync(join(output,'local-paired.zip')));for(const name of Object.keys(localZip.files)){const packageZip=await JSZip.loadAsync(await localZip.file(name).async('nodebuffer'));const raw=await packageZip.file('xl/worksheets/sheet1.xml').async('string');assert(raw.includes('Local Saved target'));assert(raw.includes('<tabColor rgb="FF'+expectedTab+'"/>'),'Local Saved export uses the darker '+tabStatus+' sheet tab');if(extension==='xlsm')assert.deepEqual(await packageZip.file('xl/vbaProject.bin').async('uint8array'),new Uint8Array([1,9,255]));}
  for(const name of Object.keys(localZip.files))await assertCellFillsAndPackage(await localZip.file(name).async('nodebuffer'),name,'Local Saved target');
  await page.getByRole('button',{name:'Close',exact:true}).click();results.push('Local export reads durable Saved targets independently of frozen collection content and preserves both workbook packages.');
  // Report an absent reference without deleting any immutable data.
  const beforeFailure=await page.evaluate(()=>savedBlobs.length);
  await page.evaluate(()=>{window.originalLookup=app._ctStore.getUnitsByIds;app._ctStore.getUnitsByIds=(scope,ids,options)=>originalLookup(scope,[...ids,JSON.stringify(['normal','Normal','PRIVATE-ID'])],options);});
  await page.locator('#export').click();await waitFinished();
  assert.equal(await page.evaluate(()=>savedBlobs.length),beforeFailure);assert.match(await modal.getByRole('alert').textContent(),/Reopen the same content group/);
  assert.match(await page.evaluate(()=>app.ctExportLogText),/Failure code: CLIENTTEXT_ORIGINAL_UNIT_MISSING/);assert(!(await page.evaluate(()=>app.ctExportLogText)).includes('PRIVATE-ID'));
  for(const theme of ['light','grey','dark','modern-dark']){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);const box=await modal.boundingBox();assert(box.height<980);await page.screenshot({path:join(output,'original-lookup-failed-'+theme+'.png')});
  }
  await page.evaluate(()=>{app._ctStore.getUnitsByIds=originalLookup;});await page.getByRole('button',{name:'Close',exact:true}).click();
  results.push('Missing original reference reports its safe code and exact lookup step in Copy timings, displays retry guidance in all four desktop themes, and initiates no download. Originals remain intact.');
  // Abort from the real worker compression phase: terminate, suppress saveAs, and release all busy flags.
  await page.evaluate(()=>{const create=ClientTextWorkerClient.create;ClientTextWorkerClient.create=(...args)=>{const worker=create(...args),exp=worker.exportWorkbook.bind(worker);worker.exportWorkbook=(b,p,s,o)=>exp(b,p,s,{...o,onProgress(value){o.onProgress?.(value);if(value.phase==='packing')app.ctAbortExport();}});return worker;};});
  const before=await page.evaluate(()=>savedBlobs.length);await page.locator('#collect').click();await waitFinished();assert.equal(await page.evaluate(()=>app.ctExportTiming.status),'aborted');assert.equal(await page.evaluate(()=>savedBlobs.length),before);assert.equal(await page.evaluate(()=>workers.every(w=>w.disposed && !w.worker && w.pending.size===0)),true);
  await page.screenshot({path:join(output,'worker-aborted.png')});results.push('Abort at real workbook compression terminates the dedicated worker, leaves no pending listeners/jobs, clears busy, and never calls saveAs.');
  assert.deepEqual(errors,[]);const report={status:'PASS',browser:executablePath,normalIndexedDB:true,realWorker:true,localEndpointsOnly:true,results,layouts,posts,abortedConnections,errors};writeFileSync(join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{held.forEach(r=>r.destroy());await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
