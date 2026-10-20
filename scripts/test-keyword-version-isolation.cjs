'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const State=require('../public/clientTextState.js'),Codec=require('../public/clientTextCodec.js'),Adapters=require('../public/contentAdapters.js');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const field=(name,text)=>({id:name,name,kind:'text',source:text,target:text});
const units=(game,label='Current')=>[
 {id:'character',role:'normal',sheet:'Characters',recordId:'Metadata/Characters/Str/'+(game==='poe1'?'Str':'StrFour'),fields:[field('Name','Synthetic character')]},
 {id:'keyword',role:'normal',sheet:'KeywordPopups',recordId:'ReviewTag',fields:[field('Info Title',label),field('Info Content','Synthetic body')]}
];
function harness(){
 const window={ClientTextState:State,ClientTextCodec:Codec,ContentAdapters:Adapters};
 const context=vm.createContext({window,AbortController,setTimeout,clearTimeout});
 for(const file of ['editorReferenceCatalog.js','keywordPopups.js'])vm.runInContext(fs.readFileSync(require.resolve('../public/'+file),'utf8'),context,{filename:file});
 const scope={accountId:'review',game:'poe1',branchId:'default',versionId:'A',groupId:'sd',language:'Thai',sourceHash:'same-baseline'};
 const session={mode:'statdescription',scope,language:'Thai',version:{id:'A',game:'poe1',branchId:'default',contentGroups:[]},group:{id:'sd',versionId:'A',contentMode:'statdescription'}};
 const popup=window.KeywordPopups.mixin,reads=[],stored={units:units('poe1','A'),saved:{},signature:'original'},writes=[];
 const host={...popup.data(),ctActive:false,sourceIdentity:'same-baseline',gameVersion:'poe1',lang:'Thai',ctRevision:0,
  editorCurrentEditingDesc:{filepath:'same.txt'},cloudUser:{id:'review'},cloudCanAccessAllLanguages:true,editorLookupSession:()=>session,descs:[],
  hlPopup:{visible:true,selectedIndex:0,filtered:[{kwTagName:'ReviewTag'}],editorIndex:0,columnIndex:0},
  getGamePreviewFontFamily:()=>'',buildGamePreviewSegments:text=>({segments:[{text}]}),$nextTick:async()=>{},
  _ctStore:{async getMetadata(){return{state:'ready',signature:stored.signature};},async getUnits(scope){reads.push({...scope});return stored.units;},async getSaved(){return stored.saved;},
   async import(){writes.push('import');},async delete(){writes.push('delete');}}
 };
 for(const[name,method]of Object.entries(popup.methods))host[name]=method.bind(host);
 for(const[name,getter]of Object.entries(popup.computed))Object.defineProperty(host,name,{get:()=>getter.call(host)});
 function select(version,branch='default'){
  scope.versionId=session.version.id=version;scope.branchId=session.version.branchId=branch;session.group.versionId=version;
  session.version.contentGroups=[{id:'ct-'+version,versionId:version,contentMode:'clienttext',language:'Thai'}];
 }
 function fence(){const watcher=popup.watch.keywordReferenceKey;assert.ok(watcher,'Reference-session changes must synchronously fence pending work');(watcher.handler||watcher).call(host);}
 select('A');return{host,scope,session,stored,reads,writes,select,fence,window,catalog:window.EditorReferenceCatalog.create(host)};
}

test('ready wrong-game reference cache is omitted with an error and all stored data retained',async()=>{
 const h=harness();h.stored.units=units('poe2','Foreign');h.stored.saved={keyword:{values:{'Info Title':'Foreign saved'}}};
 const before=JSON.stringify(h.stored);assert.throws(()=>Codec.assertGame({units:h.stored.units},'poe1'));
 const loaded=await h.catalog.load(h.session,'Thai');
 assert.equal(loaded.sources.filter(source=>source.mode==='clienttext').length,0);
 assert.equal(h.window.KeywordPopups.snapshot(h.host,loaded.sources,true).entries.size,0);
 assert.equal(loaded.errors.length,1);assert.match(loaded.errors[0],/PoE2 workbook/);assert.equal(loaded.missing.length,1);
 assert.equal(JSON.stringify(h.stored),before);assert.deepEqual(h.writes,[]);
 h.stored.units=units('poe1','Corrected cache');
 assert.equal((await h.catalog.load(h.session,'Thai')).sources[1].units,h.stored.units,'Failed data cannot poison the retained reference cache');
});

test('replaced wrong-game references cannot reuse a previously retained context index',async()=>{
 const h=harness();assert.equal((await h.catalog.load(h.session,'Thai')).sources.length,2);
 h.stored.signature='replacement';h.stored.units=units('poe2');
 for(let attempt=0;attempt<2;attempt++){
  const result=await h.catalog.load(h.session,'Thai');assert.equal(result.sources.length,1);assert.equal(result.errors.length,1);
 }
 assert.equal(h.reads.length,3);assert.deepEqual(h.writes,[]);
});

test('active reference units and an unavailable validator cannot bypass the same publication guard',async()=>{
 const h=harness();h.session.mode='clienttext';h.session.group={id:'sd',versionId:'A',contentMode:'clienttext',language:'Thai'};
 h.host.ctUnits=units('poe2');h.session.version.contentGroups=[];
 const result=await h.catalog.load(h.session,'Thai');assert.equal(result.sources.length,0);assert.match(result.errors[0],/PoE2 workbook/);
 const fallback=harness();delete fallback.window.ClientTextCodec;
 const missing=await fallback.catalog.load(fallback.session,'Thai');assert.equal(missing.sources.length,1);assert.match(missing.errors[0],/validation is unavailable/);
 assert.deepEqual(fallback.writes,[]);
});

test('explicit preparation also validates returned reference units before publication',async()=>{
 const h=harness();let prepared=false;
 h.host.managedOnlineAvailable=true;h.host._ctWorker={};h.host._cloud={async request(){return{group:h.session.version.contentGroups[0]};}};
 h.host._ctStore.getMetadata=async()=>prepared?{state:'ready'}:null;
 h.host.ctCacheGroup=async()=>{prepared=true;};h.stored.units=units('poe2');
 const result=await h.catalog.load(h.session,'Thai',{prepare:true});
 assert.equal(prepared,true);assert.equal(result.sources.length,1);assert.match(result.errors[0],/PoE2 workbook/);assert.deepEqual(h.writes,[]);
});

test('disposing a pending reference load fences an A to B to A transition even when the final key is identical',async()=>{
 const h=harness(),entered=deferred(),pending=deferred();
 h.host._ctStore.getUnits=async()=>{entered.resolve();return pending.promise;};
 const loading=h.catalog.load(h.session,'Thai');await entered.promise;
 h.select('B');h.catalog.dispose();h.select('A');
 pending.resolve(units('poe1','Old A'));await assert.rejects(loading,{name:'AbortError'});
});

test('a stale reference request cannot evict or cancel valid pending work in the selected session',async()=>{
 const h=harness(),entered=deferred(),pending=deferred();
 h.host._ctStore.getUnits=async()=>{entered.resolve();return pending.promise;};
 const current=h.catalog.load(h.session,'Thai');await entered.promise;
 const stale={...h.session,scope:{...h.scope,versionId:'old'},version:{...h.session.version,id:'old'}};
 await assert.rejects(h.catalog.load(stale,'Thai'),{name:'AbortError'});
 pending.resolve(units('poe1','Current A'));assert.equal((await current).sources.length,2);
});

test('SD popup origins and autocomplete keys follow complete release/branch/account/access scope with an unchanged baseline/file/tag',async()=>{
 const h=harness();h.host._ctStore.getMetadata=async()=>({state:'ready'});
 h.host._ctStore.getUnits=async scope=>{h.reads.push({...scope});return units('poe1',scope.versionId+':'+scope.branchId);};
 for(const[version,branch]of [['A','default'],['B','default'],['A','default'],['B','alternate'],['B','default'],['A','default']]){
  h.select(version,branch);await h.host.updateKeywordAutocomplete();
  assert.equal(h.host.keywordAutocomplete.context.scope.versionId,version);
  assert.equal(h.host.keywordAutocomplete.title[0].text,version+':'+branch);
 }
 assert.equal(h.reads.length,6);
 for(const change of [()=>h.scope.accountId='other',()=>h.scope.groupId='other',()=>h.scope.language='German',()=>h.session.generation=1,
  ()=>h.host.cloudUser.assignmentVersion=2,()=>h.host.cloudUser.role='manager']){
  const origin=h.host.keywordPreviewOrigin,key=h.host.keywordAutocompleteKey;change();
  assert.notEqual(h.host.keywordPreviewOrigin,origin);assert.notEqual(h.host.keywordAutocompleteKey,key);
 }
});

test('rapid repeated SD release changes discard retained and pending autocomplete contexts without publishing old A or B',async()=>{
 const h=harness(),pending=[];
 h.host._ctStore.getMetadata=async()=>({state:'ready'});
 h.host._ctStore.getUnits=async scope=>{const gate=deferred();pending.push({gate,version:scope.versionId});return gate.promise;};
 const until=async n=>{for(let i=0;i<20&&pending.length<n;i++)await Promise.resolve();assert.equal(pending.length,n);};
 const first=h.host.updateKeywordAutocomplete();await until(1);
 h.select('B');h.fence();const second=h.host.updateKeywordAutocomplete();await until(2);
 h.select('A');h.fence();const third=h.host.updateKeywordAutocomplete();await until(3);
 pending[0].gate.resolve(units('poe1','Old A'));await first;assert.equal(h.host.keywordAutocomplete,null);
 pending[1].gate.resolve(units('poe1','Old B'));await second;assert.equal(h.host.keywordAutocomplete,null);
 pending[2].gate.resolve(units('poe1','New A'));await third;
 assert.equal(h.host.keywordAutocomplete.title[0].text,'New A');assert.equal(h.host.keywordAutocomplete.context.scope.versionId,'A');
 h.select('B');h.fence();assert.equal(h.host.keywordAutocomplete,null);assert.equal(h.host._keywordAutocompleteCache,null);
});

test('scope fencing cancels a pending root hover while retaining only explicitly pinned frozen cards',async()=>{
 const h=harness(),pending=deferred(),entered=deferred(),anchor={isConnected:true};
 h.host._ctStore.getUnits=async()=>{entered.resolve();return pending.promise;};
 const entering=h.host.previewKeywordEnter({type:'focus',currentTarget:anchor},{tagName:'ReviewTag'},true);await entered.promise;
 const frozen={id:10,pinned:true,origin:'old',anchor:{},context:{scope:{versionId:'A'}}};
 h.host.keywordWindows.push(frozen,{id:11,pinned:false,anchor:{}});h.select('B');h.fence();h.select('A');h.fence();
 pending.resolve(units('poe1','Old hover'));assert.equal(await entering,undefined);
 assert.equal(h.host.keywordWindows.length,1);assert.equal(h.host.keywordWindows[0],frozen);assert.equal(frozen.context.scope.versionId,'A');
 assert.equal(h.host._keywordAnchor,null);assert.equal(h.host._keywordAutocompleteCache,null);
});
