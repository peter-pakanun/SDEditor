'use strict';
// Local-only filename acceptance: actual downloads, re-imports, saves, native
// IndexedDB/frozen manifests and workbook workers. No real account/API is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createServer}=require('node:http'),{createHash}=require('node:crypto');
const JSZip=require('jszip'),Codec=require('../public/clientTextCodec.js'),UI=require('../public/clientTextUi.js');
const runtime='C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(require.resolve('playwright',{paths:[runtime]}));
const executablePath=process.env.FIXTURE_BROWSER_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const root=path.resolve(__dirname,'../public'),output=path.resolve(__dirname,'../temp/clienttext-filenames-browser');fs.mkdirSync(output,{recursive:true});process.env.TEMP=output;process.env.TMP=output;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function workbook(role,macro){
 const zip=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',cell=(r,value)=>`<c r="${r}" t="inlineStr"><is><t>${value}</t></is></c>`;
 zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="${macro?'application/vnd.ms-excel.sheet.macroEnabled.main+xml':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'}"/></Types>`);
 zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Records" sheetId="1" r:id="rId1"/></sheets></workbook>`);
 zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
 const headings=role==='normal'?cell('C1','Name')+cell('D1','Translation'):cell('C1','Text')+cell('D1','MS')+cell('E1','FS');
 zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetData><row r="1">${cell('A1','ID')+headings}</row><row r="2">${cell('A2','fixture')+cell('C2','Source')+cell('D2','Original')+(role==='gender'?cell('E2','Other form'):'')}<c r="Z2"><f>SUM(1,2)</f><v>3</v></c></row></sheetData></worksheet>`);
 zip.file('xl/styles.xml',`<styleSheet xmlns="${ns}"><fonts count="1"><font/></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
 if(macro)zip.file('xl/vbaProject.bin',new Uint8Array([0,255,13,10,42]));zip.file('customXml/native.bin',new Uint8Array([8,6,4,2,0]));
 return zip.generateAsync({type:'nodebuffer'});
}
const cases=[
 {name:'single-memory',game:'poe1',files:[['French.XLSM','normal']],expected:['French_Translated.XLSM']},
 {name:'paired-memory',game:'poe2',files:[['French.xlsx','normal'],['French_Gender.xlsm','gender']],expected:['French_Translated.xlsx','French_Gender_Translated.xlsm']},
 {name:'frozen-existing-marker-counter',game:'poe1',frozen:true,versionName:'Release_Translated',files:[['French_tRaNsLaTeD.xlsx','normal'],['French_Gender_Translated(2).XLSM','gender']],expected:['French_tRaNsLaTeD.xlsx','French_Gender (2)_Translated.XLSM']},
 {name:'duplicate-input-names',game:'poe2',manualRoles:true,files:[['French.xlsx','normal'],['French.xlsx','gender']],expected:['French_Translated.xlsx','French_Gender_Translated.xlsx']},
 {name:'frozen-suffix-case-collision',game:'poe2',frozen:true,manualRoles:true,files:[['French.XLSX','normal'],['french_Translated.xlsx','gender']],expected:['French_Translated.XLSX','french_Gender_Translated.xlsx']}
];
async function main(){
 let selected;const scripts=['clientTextState.js','clientTextStore.js','contentAdapters.js','clientTextMemoryStore.js','clientTextTransport.js','clientTextWorkerClient.js','clientTextExportProgress.js','clientTextUi.js'];
 const server=createServer((req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;res.setHeader('Cache-Control','no-store');
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><style>body{font:16px system-ui;background:#f5f6f8;color:#20242a;padding:32px}pre{white-space:pre-wrap}</style></head><body><div id="app"></div><script src="/fixture/vue.js"></script>${scripts.map(name=>`<script src="/${name}"></script>`).join('')}<script>const mixin=ClientTextUI.mixin;window.app=Vue.createApp({data(){return{...mixin.data(),lang:'French',gameVersion:${JSON.stringify(selected.game)},cloudProfileId:'fixture',branchId:'default',managedCatalogScope:'filename-fixture',cloudCanAccessAllLanguages:true}},computed:mixin.computed,methods:mixin.methods,template:'<div><h1>ClientText translated filenames</h1><p>Actual browser exports and re-imports using disposable workbooks.</p><pre id="result"></pre></div>'}).mount('#app');window.workers=[];const create=ClientTextWorkerClient.create;ClientTextWorkerClient.create=(options)=>{const worker=create(options);workers.push(worker);return worker;};window.saveAs=(blob,name)=>{const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};app.ctReport=()=>{};</script></body></html>`);return;}
  if(pathname==='/fixture/vue.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(process.env.FIXTURE_VUE_PATH||path.resolve(__dirname,'../temp/clienttext-fixture-vue.min.js')));return;}
  if(pathname==='/fixture/jszip.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(require.resolve('jszip/dist/jszip.min.js')));return;}
  const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)||!file.endsWith('.js')||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','text/javascript');const source=fs.readFileSync(file,'utf8');res.end(pathname==='/clientTextWorker.js'?source.replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js','/fixture/jszip.js'):source);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const results=[];
 try{
  browser=await chromium.launch({executablePath,headless:true});
  for(const spec of cases){selected=spec;const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));const result={name:spec.name,frozen:!!spec.frozen,game:spec.game,cycles:[]};
   try{
    await page.goto('http://127.0.0.1:'+server.address().port);let inputs=await Promise.all(spec.files.map(async([name,role])=>({name,role,bytes:await workbook(role,/\.xlsm$/i.test(name))})));
    for(let cycle=1;cycle<=3;cycle++){
     const prepared=await page.evaluate(async({spec,cycle,inputs})=>{
      const files=inputs.map(input=>new File([new Uint8Array(input.bytes)],input.name));app.ctUploadTest=true;app.ctUploadLocal=true;app.ctUploadHistory=false;app.ctUploadFiles=[];app._ctWorker=ClientTextWorkerClient.create();
      if(spec.manualRoles&&cycle===1)app.ctUploadFiles=files.map((file,index)=>({file,role:inputs[index].role,language:'French',testVersion:'current'}));
      else app.ctChooseFiles({target:{files,value:''}});
      try{await app.ctPrepareUpload();}finally{app._ctWorker.dispose();app._ctWorker=null;}
      if(app.ctUploadError||app.ctPrepared.length!==1)throw Error(app.ctUploadError||'Preparation failed');
      const prepared=app.ctPrepared[0],prefix=spec.frozen?'local:':'local:test:',scope=app.ctScope(prefix+'v'+cycle,prefix+spec.name+cycle,'French');let store;
      if(spec.frozen){if(!app._filenameDb){const open=indexedDB.open('filename-fixture',1);app._filenameDb=await new Promise((resolve,reject)=>{open.onupgradeneeded=()=>ClientTextStore.upgrade(open.result,open.transaction);open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});}const db=app._filenameDb;store=ClientTextStore.create({openDb:async()=>db});app._ctStore=store;}
      else{store=ClientTextMemoryStore.create();app._ctTestStores||=new Map();app._ctTestStores.set(scope.groupId,store);}
      const version={id:scope.versionId,name:spec.versionName||'Naming fixture'},group={id:scope.groupId,contentMode:'clienttext'};
      await store.import(scope,{units:prepared.units,assets:prepared.assets,descriptors:prepared.originals.descriptors,metadata:{version,group}});
      app.ctWorkspace={scope,metadata:{version,group}};app.ctUnits=Vue.markRaw(await store.getUnits(scope));app._ctUnitIndex=new Map(app.ctUnits.map(unit=>[unit.id,unit]));app.ctSelection=app.ctUnits[0].id;app.ctValues=ClientTextState.valuesFor(app.ctUnits[0]);app.ctReviewed={};app.ctDraftDirty=false;app._ctDraftRevision=null;app._ctDraftHeads=new Map();
      const frozen=[];
      for(const unit of app.ctUnits){const field=unit.fields.find(field=>field.kind!=='gender'),values=ClientTextState.valuesFor(unit);values[field.id]=spec.frozen?'Local excluded '+unit.role:cycle===1?'Saved '+unit.role:field.target;await store.save(scope,unit.id,{jobId:'name-save-'+cycle+unit.id,values,reviewed:{},expectedRevision:0},{sync:false});const accepted=ClientTextState.valuesFor(unit);if(cycle===1)accepted[field.id]='Frozen '+unit.role;frozen.push({id:unit.id,values:accepted,reviewed:{},saved:true});}
      const collection={id:'filename-snapshot'},manifest={groupId:scope.groupId,versionId:scope.versionId,language:'French',assets:prepared.assets.map(asset=>({role:asset.role,artifactHash:asset.hash,descriptor:prepared.originals.descriptors.find(d=>d.role===asset.role)})),units:frozen};
      app._cloud={request(route){if(!spec.frozen||!route.includes('/v1/content-collections/'))throw Error('No API request permitted');return Promise.resolve({collection,manifest});}};
      app._filenameCollection=spec.frozen?collection:null;app.ctSaved=Vue.markRaw(await store.getSaved(scope));
      return{inputNames:files.map(file=>file.name),roles:prepared.assets.map(asset=>asset.role),assetNames:prepared.assets.map(asset=>asset.name)};
     },{spec,cycle,inputs:inputs.map(input=>({...input,bytes:Array.from(input.bytes)}))});
     assert.deepEqual(prepared.inputNames,inputs.map(input=>input.name));assert.equal(new Set(prepared.roles).size,inputs.length);assert.deepEqual(prepared.assetNames.slice().sort(),prepared.inputNames.slice().sort());
     const event=page.waitForEvent('download');assert.equal(await page.evaluate(()=>app.ctDownload(app._filenameCollection)),true,await page.evaluate(()=>app.ctError));const download=await event;
     const outer=inputs.length===1?spec.expected[0]:(spec.versionName||'Naming fixture')+'_French_ClientText_Translated.zip';assert.equal(download.suggestedFilename(),outer);const file=path.join(output,spec.name+'-'+cycle+path.extname(outer));await download.saveAs(file);const exported=fs.readFileSync(file),archive=inputs.length===1?null:await JSZip.loadAsync(exported),names=archive?Object.keys(archive.files).filter(name=>!archive.files[name].dir):[outer];
     assert.deepEqual(names.slice().sort(),spec.expected.slice().sort());assert.equal(new Set(names.map(name=>name.toLowerCase())).size,inputs.length);
     const next=[];
     for(const name of names){const role=UI.detect(name).role;assert.equal(UI.detect(name).language,'French');const bytes=archive?await archive.file(name).async('nodebuffer'):exported,prior=inputs.find(input=>input.role===role),parsed=await Codec.parseWorkbook(bytes,{filename:name,role,language:'French',game:spec.game}),unit=parsed.units[0],field=unit.fields.find(field=>field.kind!=='gender');assert.equal(field.target,(spec.frozen?'Frozen ':'Saved ')+role);if(cycle>1)assert.equal(sha(bytes),sha(prior.bytes),'repeat output changes only its download name');const before=await JSZip.loadAsync(prior.bytes),after=await JSZip.loadAsync(bytes);assert.deepEqual(Object.keys(after.files).sort(),Object.keys(before.files).sort());for(const member of Object.keys(before.files).filter(member=>!before.files[member].dir&&!['xl/styles.xml','xl/worksheets/sheet1.xml'].includes(member)))assert.equal(sha(await after.file(member).async('nodebuffer')),sha(await before.file(member).async('nodebuffer')),member);assert((await after.file('xl/worksheets/sheet1.xml').async('string')).includes('<f>SUM(1,2)</f>'));next.push({name,role,bytes});}
     assert.deepEqual(await page.evaluate(async()=>{const store=app.ctStorage(app.ctWorkspace.scope),metadata=await store.getMetadata(app.ctWorkspace.scope);return Promise.all(metadata.descriptors.map(async descriptor=>(await store.getAsset(app.ctWorkspace.scope,descriptor.role)).name));}),prepared.assetNames);
     result.cycles.push({cycle,download:outer,members:names,imported:prepared.inputNames,roles:prepared.roles,byteIdenticalToImported:cycle>1});inputs=next;
    }
    assert.deepEqual(errors,[]);assert(await page.evaluate(()=>workers.every(worker=>worker.disposed)));await page.evaluate(text=>document.getElementById('result').textContent=text,JSON.stringify(result,null,2));await page.screenshot({path:path.join(output,spec.name+'.png')});result.status='PASS';results.push(result);console.log('PASS '+spec.name);
   }finally{await context.close();}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:'PASS',base:'abe2dea178856df5d881372ead1f3cd35bcb63bf',results},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,cycles:results.reduce((n,result)=>n+result.cycles.length,0)}));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
