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
test('uncertain uploads retry the exact mutation body and original proof until acknowledged',async()=>{
    const f=await prepared(),calls=[];await f.store.save(scope,unit().id,{jobId:'durable',values:{[fieldId]:'Saved'},reviewed:{}});
    const sync=Sync.create({scope,store:f.store,isCurrent:()=>true,request:async(path,init)=>{calls.push(structuredClone(init.body));
        const compact=S.compactUnit(init.body.baseline),stored=await f.store.getProof(scope,unit().id);
        assert.equal(S.verifyWitness(init.body.baseline,compact,init.body.proof,stored.descriptor),true);
        if(calls.length===1)throw new Error('Response lost after server accepted');
        return {unit:{unitId:unit().id,values:init.body.values,reviewed:init.body.reviewed,revision:1},sequence:1,mutationId:'durable'};}});
    await assert.rejects(sync.flush(),/lost/);assert.equal((await f.store.getOutbox(scope))[0].state,'uncertain');
    await sync.flush();assert.deepEqual(calls[1],calls[0]);assert.deepEqual(await f.store.getOutbox(scope),[]);
    assert.equal((await f.store.getMetadata(scope)).sequence,0,'Write acknowledgement must not skip unseen events');
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
