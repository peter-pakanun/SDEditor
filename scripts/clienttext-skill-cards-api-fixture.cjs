'use strict';
// Real private API, in-memory accounts, frontend request/composer/Blob loader; synthetic upstream media.
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {resolve,join}=require('node:path'),{pathToFileURL}=require('node:url'),{createServer}=require('node:http');
const vm=require('node:vm');
const Cards=require('../public/clientTextSkillCards.js'),Assets=require('../public/privateAssets.js');
const Cloud=require('../public/cloudSync.js'),Dictionary=require('../public/dictionarySync.js');
const root=resolve(__dirname,'..'),apiRoot=resolve(root,'../SDEditor-API');
(async()=>{
 const [{createApp},{loadConfig},{openDatabase,CloudStore}]=await Promise.all(['app.js','config.js','database.js'].map(name=>import(pathToFileURL(join(apiRoot,'src',name)))));
 mkdirSync(join(root,'temp'),{recursive:true});const folder=mkdtempSync(join(root,'temp/skill-card-api-'));
 const config=loadConfig({ADMIN_GOOGLE_SUB:'fixture-admin',DATA_DIR:folder,PORTRAIT_DIR:join(apiRoot,'assets/portraits')}),db=openDatabase(':memory:'),store=new CloudStore(db,config);
 const image=Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64');
 const wav=Buffer.alloc(128);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);
 let upstreamCalls=0,audioUpstreamCalls=0;const app=createApp({config,store,oauthProvider:null,audioFetch:async()=>{audioUpstreamCalls++;return new Response(wav,{headers:{'content-type':'audio/wav'}});},skillAssetRequest:async()=>{upstreamCalls++;return new Response(image,{headers:{'content-type':'image/webp'}});},logger:{error(){},warn(){}}});
 const sessions={};for(const id of ['fixture-admin','fixture-manager','fixture-translator','fixture-unassigned','fixture-viewer'])store.registerIdentity({sub:id,email:id+'@test.invalid',name:id});
 store.assignRole('fixture-admin','fixture-manager','manager');store.assignLanguage('fixture-admin','fixture-translator','Thai');store.assignLanguage('fixture-admin','fixture-viewer','Thai');
 for(const id of ['fixture-admin','fixture-manager','fixture-translator','fixture-unassigned','fixture-viewer'])sessions[id]=store.createSession(id);
 const user=store.user.bind(store);store.user=id=>id==='fixture-viewer'?{...user(id),role:'viewer',canAccessAllLanguages:true}:user(id);
 const server=createServer(app);await new Promise(done=>server.listen(0,'127.0.0.1',done));const base='http://127.0.0.1:'+server.address().port,results=[];
 const routes=['/v1/skill-card-catalogs/poe2/v1','/skill-assets/poe2/spark/icon','/portraits/poe2/witch.webp?v=4','/audio/poe2db?path=synthetic%2Fexample.wav'];
 try{
  for(const path of routes){
   const requestedHeaders=['authorization'];
   const preflight=await fetch(base+path,{method:'OPTIONS',headers:{Origin:config.frontendOrigin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':requestedHeaders.join(',')}});
   assert.equal(preflight.status,204,path+' bearer-only preflight');assert.equal(preflight.headers.get('access-control-allow-origin'),config.frontendOrigin);
   const allowed=preflight.headers.get('access-control-allow-headers').toLowerCase().split(',').map(value=>value.trim());assert.ok(requestedHeaders.every(header=>allowed.includes(header)));assert.deepEqual(requestedHeaders,['authorization']);await preflight.arrayBuffer();
  }
  for(const id of ['fixture-admin','fixture-manager','fixture-translator']){
   let allocations=0,revocations=0;const sent=[];
   const client=new Cloud.Client({store:{},merge:Dictionary,apiBase:base,fetch:async(url,options)=>{sent.push({url,headers:options.headers});assert.deepEqual(Object.keys(options.headers),['Authorization'],'adapter sends bearer only, without language selector or protocol headers');return fetch(url,{...options,headers:{...options.headers,Origin:config.frontendOrigin}});}});
   client.state=Cloud.initializeState({...Cloud.completeSettings({lang:'Thai'}),dictionary:[]});client.state.profiles[id]=structuredClone(client.state.profiles.guest);client.state.activeProfile=id;client.state.auth={token:sessions[id].token,user:store.user(id)};
   const window={PrivateAssets:{create:options=>Assets.create({...options,createObjectURL:()=>{allocations++;return'blob:synthetic-'+allocations;},revokeObjectURL:()=>revocations++})}};
   vm.runInNewContext(readFileSync(join(root,'public/privateMediaUi.js'),'utf8'),{window});
   const mixin=window.PrivateMediaUI.mixin,host={...mixin.data(),_cloud:client,cloudSignedIn:true,cloudProfileId:id,cloudUser:store.user(id),lang:'Thai',gameVersion:'poe2',branchId:'default',ctActive:true,ctWorkspace:{scope:{accountId:id,game:'poe2',language:'Thai',groupId:'fixture-source'}}};
   for(const[name,method]of Object.entries(mixin.methods))host[name]=method.bind(host);
   for(const[name,get]of Object.entries(mixin.computed))Object.defineProperty(host,name,{get:()=>get.call(host)});
   assert.equal(host.privateMediaAllowed,true,id+' frontend assigned/global access');
   const catalog=await host.privateMediaJson(routes[0]);Cards.validateCatalog(catalog);
   const refs=catalog.cards.flatMap(card=>[card.title,card.itemTitle,card.description,card.shortDescription,...card.tags.map(tag=>tag.ref),...card.tabs.map(tab=>tab.label),card.footer,card.qualityLabel,...Object.values(card.examples)]).filter(Boolean),units=new Map();
   for(const ref of refs){const key=JSON.stringify(['normal',ref.sheet,ref.recordId]);if(!units.has(key))units.set(key,{id:key,role:'normal',sheet:ref.sheet,recordId:ref.recordId,fields:[]});const unit=units.get(key);if(!unit.fields.some(field=>field.name===ref.field))unit.fields.push({id:ref.field,name:ref.field,kind:'text',source:ref.source,target:'Synthetic translation'});}
   const scope={accountId:id,game:'poe2',groupId:'fixture-source',language:'Thai'},resolver=Cards.createResolver(catalog,[...units.values()],scope),unit=[...units.values()].find(unit=>unit.sheet==='ActiveSkills');
   const model=resolver.compose({scope,unit});assert.equal(model.compatibility.matched,3);assert.deepEqual(model.source.properties.map(p=>p.text),['1','+10%','5 Mana','7.00%']);
   for(const path of routes.slice(1)){const lease=await host.privateMediaLoad(path,path.startsWith('/audio/')?'audio':'image');assert.ok(lease.url.startsWith('blob:'));}
   assert.equal(allocations,3);host._privateMediaLoader.clear();assert.equal(revocations,3);mixin.beforeUnmount.call(host);
   assert.equal(sent.length,4);assert.ok(sent.every(request=>!request.url.includes(sessions[id].token)));
   results.push({role:store.user(id).role,catalog:true,composed:true,privateImage:true,portrait:true,audio:true,bearerOnly:true,cleanup:true});client.destroy();
  }
  for(const [id,status] of [[null,401],['fixture-unassigned',403],['fixture-viewer',403]]){
   for(const path of routes){
    const response=await fetch(base+path,{headers:{Origin:config.frontendOrigin,...(id?{Authorization:'Bearer '+sessions[id].token}:{})}});assert.equal(response.status,status,path+' bearer-only denial');assert.match(response.headers.get('cache-control'),/no-store/);await response.arrayBuffer();
   }
   results.push({role:id?store.user(id).role:'anonymous',selector:false,denied:status});
  }
  for(const path of routes){
   const response=await fetch(base+path,{headers:{Origin:config.frontendOrigin,Authorization:'Bearer '+sessions['fixture-translator'].token,'X-SDEditor-Language':'German'}});assert.equal(response.status,403,path+' explicit wrong-language denial');assert.match(response.headers.get('cache-control'),/no-store/);await response.arrayBuffer();
  }
  results.push({role:'translator',language:'German',denied:403});
  const token=sessions['fixture-translator'].token;store.revokeSession(require('node:crypto').createHash('sha256').update(token).digest('hex'));
  for(const path of routes){const revoked=await fetch(base+path,{headers:{Origin:config.frontendOrigin,Authorization:'Bearer '+token}});assert.equal(revoked.status,401,path+' revoked session');assert.match(revoked.headers.get('cache-control'),/no-store/);await revoked.arrayBuffer();}
  writeFileSync(join(folder,'results.json'),JSON.stringify({passed:true,results,bearerOnlyPreflight:routes.length,upstreamCalls,audioUpstreamCalls,revokedSession:401},null,2));console.log('Real API/frontend skill-card fixture passed with actual PrivateMediaUI bearer-only adapter across catalog/skill/portrait/audio: Admin, Manager, assigned Translator; anonymous, unassigned, unsupported role, explicit wrong language and revoked session denied. Bearer-only CORS preflights: '+routes.length+'. Synthetic image/audio upstream calls: '+upstreamCalls+'/'+audioUpstreamCalls+'. Evidence: '+folder);
 }finally{await app.locals.collaborationRealtime?.close();server.closeAllConnections();await new Promise(done=>server.close(done));db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
