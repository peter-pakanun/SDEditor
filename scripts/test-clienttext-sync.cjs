const {test}=require('node:test');
const assert=require('node:assert/strict');
const Sync=require('../public/clientTextSync.js');
const S=require('../public/clientTextState.js');
const {fixture,scope,fieldId,unit,asset}=require('./clienttext-storage-fixture.cjs');
async function prepared(){const f=fixture();await f.store.import(scope,{units:[unit()],assets:[asset]});return f;}
test('paged events commit only the consumed cursor and replay durable saved units',async()=>{
    const f=await prepared(),calls=[];
    const sync=Sync.create({scope,store:f.store,isCurrent:()=>true,request:async(path)=>{calls.push(path);
        if(calls.length===1)return{events:[{sequence:2,unitId:unit().id,unit:{values:{[fieldId]:'Peer'},reviewed:{},revision:1}}],sequence:10,hasMore:true};
        assert.match(path,/after=2/);assert.equal((await f.store.getMetadata(scope)).sequence,2);
        return {events:[{sequence:10,unitId:unit().id,unit:{values:{[fieldId]:'Peer second'},reviewed:{},revision:2}}],sequence:10,hasMore:false};}});
    const result=await sync.pull();assert.equal(result.sequence,10);assert.equal((await f.store.getSaved(scope))[unit().id].values[fieldId],'Peer second');
    assert.ok(calls.every(path=>path.includes('language=Thai')));
});
test('uncertain trusted uploads retry the exact sparse mutation body without originals or proofs',async()=>{
    const f=await prepared(),calls=[];await f.store.save(scope,unit().id,{jobId:'durable',values:{[fieldId]:'Saved'},reviewed:{}});
    const sync=Sync.create({scope,store:f.store,isCurrent:()=>true,request:async(path,init)=>{calls.push(structuredClone(init.body));
        assert.equal(init.body.storageProtocol,S.STORAGE_PROTOCOL);assert.deepEqual(init.body.clientFacts,S.clientFacts(unit()));
        assert.deepEqual(init.body.originalValues,S.originalValues(unit()));assert.equal(init.body.baseline,undefined);assert.equal(init.body.proof,undefined);
        assert.equal(init.headers['X-SDEditor-ClientText-Protocol'],S.STORAGE_PROTOCOL);
        if(calls.length===1)throw new Error('Response lost after server accepted');
        return {unit:{unitId:unit().id,values:init.body.values,reviewed:init.body.reviewed,revision:1},sequence:1,mutationId:'durable'};}});
    await assert.rejects(sync.flush(),/lost/);assert.equal((await f.store.getOutbox(scope))[0].state,'uncertain');
    await sync.flush();assert.deepEqual(calls[1],calls[0]);assert.deepEqual(await f.store.getOutbox(scope),[]);
    assert.equal((await f.store.getMetadata(scope)).sequence,0,'Write acknowledgement must not skip unseen events');
});
test('uncertain restore uploads retain origin while a later ordinary save waits behind their exact command',async()=>{
    const f=await prepared(),calls=[];
    await f.store.save(scope,unit().id,{jobId:'restored',origin:'restore',values:{[fieldId]:'Restored'},reviewed:{}});
    const sync=Sync.create({scope,store:f.store,isCurrent:()=>true,request:async(_,init)=>{
        calls.push(structuredClone(init.body));if(calls.length===1)throw new Error('Accepted restore response lost');
        return {unit:{unitId:unit().id,origin:init.body.origin||'save',values:init.body.values,reviewed:init.body.reviewed,revision:calls.length-1},mutationId:init.body.mutationId};}});
    await assert.rejects(sync.flush(),/lost/);
    await f.store.save(scope,unit().id,{jobId:'new-save',values:{[fieldId]:'Newer saved text'},reviewed:{}});
    await sync.flush();assert.deepEqual(calls[1],calls[0]);assert.equal(calls[1].origin,'restore');
    assert.equal(calls[2].mutationId,'new-save');assert.equal(Object.hasOwn(calls[2],'origin'),false);
    assert.equal(calls[2].baseRevision,1);assert.deepEqual(await f.store.getOutbox(scope),[]);
    assert.equal((await f.store.getSaved(scope))[unit().id].values[fieldId],'Newer saved text');
});
test('source/account changes fence late replay and preserve pending local work',async()=>{
    const f=await prepared();let current=true;
    const sync=Sync.create({scope,store:f.store,isCurrent:()=>current,request:async()=>{current=false;return {events:[{sequence:1,unitId:unit().id,unit:{values:{[fieldId]:'Wrong'},reviewed:{},revision:1}}],sequence:1};}});
    await assert.rejects(sync.pull(),error=>error.stale===true);assert.deepEqual(await f.store.getSaved(scope),{});assert.equal((await f.store.getMetadata(scope)).sequence,0);
});
test('shared conflicts preserve current local text and stop automatic retry',async()=>{
    const f=await prepared();await f.store.save(scope,unit().id,{jobId:'conflict',values:{[fieldId]:'Local'},reviewed:{}});let calls=0;
    const sync=Sync.create({scope,store:f.store,isCurrent:()=>true,request:async()=>{calls++;throw Object.assign(new Error('Peer changed the unit'),{status:409,current:{unitId:unit().id,values:{[fieldId]:'Peer'},reviewed:{},revision:1}});}});
    await assert.rejects(sync.flush(),/Peer/);assert.equal((await f.store.getSaved(scope))[unit().id].values[fieldId],'Local');
    const second=await sync.flush();assert.equal(second.conflicts,1);assert.equal(calls,1);
});

test('legacy uncertain requests replay their durable exact body and ID after cache cleanup',async()=>{
    const baseline=unit(),manifest=await S.buildManifest([baseline],[asset]),body={mutationId:'legacy-uncertain',baseRevision:3,values:{[fieldId]:'Legacy saved'},reviewed:{},baseline,proof:S.proofFor(manifest,baseline.id)},calls=[];
    let pending={unitId:baseline.id,mutationId:body.mutationId,origin:'restore',requestBody:structuredClone(body),state:'uncertain'};
    const store={async getOutbox(){return pending?[pending]:[];},async markSending(){return pending;},async getUnit(){throw Error('Original reads are forbidden');},async getProof(){throw Error('Proof cache was cleaned');},async acknowledge(){pending=null;}};
    const sync=Sync.create({scope,store,request:async(_,options)=>{calls.push(structuredClone(options));if(calls.length===1)throw Error('Lost acknowledgement');return{unit:{id:baseline.id,values:body.values,reviewed:{},revision:4}};}});
    await assert.rejects(sync.flush(),/Lost/);await sync.flush();
    assert.deepEqual(calls[0].body,body);assert.deepEqual(calls[1].body,body);assert.equal(calls[0].headers['X-SDEditor-ClientText-Protocol'],S.STORAGE_PROTOCOL);
});

test('missing legacy replay material blocks the upload instead of rebuilding a different request',async()=>{
    let requests=0,state;
    const pending={unitId:unit().id,mutationId:'old-id',values:{[fieldId]:'Unsynced'}};
    const store={async getOutbox(){return[pending];},async markSending(_,__,___,value){state=value;return pending;},async getUnit(){throw Error('Do not rebuild');},async getProof(){throw Error('Do not rebuild');}};
    const sync=Sync.create({scope,store,request:async()=>requests++});
    await assert.rejects(sync.flush(),/cache migration/);assert.equal(requests,0);assert.equal(state,'uncertain');
});
