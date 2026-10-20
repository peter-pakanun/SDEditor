const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const C=require('../public/clientTextStore.js'),S=require('../public/clientTextState.js');
const {fixture,scope:shared,unit,asset,fieldId}=require('./clienttext-storage-fixture.cjs');
const scope={...shared,versionId:'local:test:version',groupId:'local:test:group'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function runtime(f,locks) {
    const window={ClientTextStore:{...C,create:()=>f.store},ClientTextState:S,ClientTextMtlStore:{create:()=>({})},OfflineStore:{openClientTextDb:async()=>f.db},navigator:{locks},crypto:require('node:crypto').webcrypto};
    const context=vm.createContext({window,console,Blob,ArrayBuffer});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/clientTextLocalStore.js'),'utf8'),context);
    return {window,store:window.ClientTextLocalStore.create()};
}
function lockManager() {
    const active=new Map();return {async request(name,options,callback){
        await tick();if(active.has(name))return callback(null);
        const lock={name};active.set(name,lock);try{return await callback(lock);}finally{if(active.get(name)===lock)active.delete(name);}
    }};
}
async function setup() {
    const f=fixture(),blob=new Blob(['owned original']),original=unit(),ownedAsset={...asset,blob,hash:S.sha256(await blob.arrayBuffer()),parserVersion:S.PARSER_VERSION};
    const metadata=await f.store.import(scope,{units:[original],assets:[ownedAsset],metadata:{localProtocol:'clienttext-local-v1',version:{id:scope.versionId,game:scope.game,branchId:scope.branchId},group:{id:scope.groupId,versionId:scope.versionId,language:scope.language}}});
    return {f,original,ownedAsset,metadata};
}
test('exclusive ownership rejects a second editor and stale release cannot revoke a reused lease',async()=>{
    const {f,original}=await setup(),locks=lockManager(),a=runtime(f,locks).store,b=runtime(f,locks).store;
    await a.acquire(scope);await assert.rejects(b.acquire(scope),/another tab/);
    const delayedRelease=a.releaseCapturedExcept(null),old=await a.acquire(scope);
    delayedRelease();await a.putDraft(scope,original.id,{values:{[fieldId]:'Retained owner'}},{expectedRevision:null});
    await assert.rejects(b.acquire(scope),/another tab/);
    const newer=await a.acquire(scope);a.releaseLease(old);
    await assert.rejects(a.putDraft(scope,original.id,{values:{[fieldId]:'Old queued activation'}},{expectedRevision:1,localLease:old}),/activation changed/);
    await a.putDraft(scope,original.id,{values:{[fieldId]:'Newer lease'}},{expectedRevision:1});
    a.releaseLease(newer);await tick();await b.acquire(scope);
    await assert.rejects(async()=>a.putDraft(scope,original.id,{values:{[fieldId]:'Stale owner'}}),/no longer owns/);
    b.releaseExcept();await tick();
});
test('unsupported ownership fails closed while immutable reads remain available',async()=>{
    const {f,original}=await setup(),a=runtime(f,undefined).store;
    await assert.rejects(a.acquire(scope),/requires Web Locks/);
    assert.equal((await a.getUnit(scope,original.id)).id,original.id);
    await assert.rejects(async()=>a.save(scope,original.id,{jobId:'unowned',values:{[fieldId]:'Unsafe'}}),/no longer owns/);
    assert.deepEqual(await f.store.getSaved(scope),{});
});
test('malformed recovery rows are rejected before publishing any workspace',async()=>{
    const {f,original,ownedAsset,metadata}=await setup(),h=runtime(f,lockManager()),bytes=await ownedAsset.blob.arrayBuffer();
    const valid={unitId:original.id,values:{[fieldId]:'Recovered'},reviewed:{},revision:1,saved:true};
    for(const invalid of [{...valid,revision:0},{...valid,saved:'yes'},{...valid,outdated:['unknown']},{...valid,provenance:{requiredReview:{[fieldId]:'invalid'}}}]){
        const manifest={protocol:'clienttext-local-v1',workspaces:[{scope,metadata,assets:[{path:'original',name:ownedAsset.name,role:'normal',parserVersion:S.PARSER_VERSION,hash:ownedAsset.hash}],rows:{saved:[invalid],drafts:[],history:[],receipts:[],memory:[],memoryHistory:[]}}]};
        h.window.JSZip={loadAsync:async()=>({file:name=>({async:async()=>name==='local-workbook.json'?JSON.stringify(manifest):bytes})})};
        await assert.rejects(h.store.restore(new Blob(['backup']),{accountId:scope.accountId,game:scope.game,branchId:'other'},{parseWorkbook:async()=>({units:[original],artifactHash:ownedAsset.hash,parserVersion:S.PARSER_VERSION})}),/invalid|Invalid/);
        assert.equal((await f.store.listWorkspaces({accountId:scope.accountId})).length,1);
    }
    h.store.releaseExcept();
});
test('backup completion cannot release a workspace opened while ZIP generation awaited',async()=>{
    const {f,original,ownedAsset}=await setup(),h=runtime(f,lockManager()),other={...scope,versionId:'local:test:other-version',groupId:'local:test:other-group'};
    await f.store.import(other,{units:[original],assets:[ownedAsset]});await h.store.acquire(scope);
    h.window.JSZip=class {file(){} async generateAsync(){await h.store.acquire(other);return new Blob(['backup']);}};
    await h.store.backup(scope);
    await h.store.putDraft(other,original.id,{values:{[fieldId]:'Still owns current workspace'}},{expectedRevision:null});
    h.store.releaseExcept();await tick();
});
test('restored work and version metadata use the new account/branch while original evidence remains',async()=>{
    const {f,original,ownedAsset,metadata}=await setup(),h=runtime(f,lockManager()),bytes=await ownedAsset.blob.arrayBuffer(),
        saved={unitId:original.id,values:{[fieldId]:'Recovered'},reviewed:{},revision:1,saved:true},
        manifest={protocol:'clienttext-local-v1',workspaces:[{scope,metadata,assets:[{path:'original',name:ownedAsset.name,role:'normal',parserVersion:S.PARSER_VERSION,hash:ownedAsset.hash}],rows:{saved:[saved],drafts:[],history:[],receipts:[],memory:[],memoryHistory:[]}}]};
    h.window.JSZip={loadAsync:async()=>({file:name=>({async:async()=>name==='local-workbook.json'?JSON.stringify(manifest):bytes})})};
    const restored=await h.store.restore(new Blob(['backup']),{accountId:'restored-owner',game:scope.game,branchId:'other-branch'},{parseWorkbook:async()=>({units:[original],artifactHash:ownedAsset.hash,parserVersion:S.PARSER_VERSION})});
    const next=await h.store.getMetadata(restored);
    assert.equal(next.version.branchId,restored.branchId);assert.equal(next.version.game,restored.game);assert.equal(next.group.language,restored.language);
    assert.equal((await h.store.getSaved(restored))[original.id].values[fieldId],'Recovered');assert.equal(next.restoredFrom.accountId,scope.accountId);
    h.store.releaseExcept();await tick();
});
