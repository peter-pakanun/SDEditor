const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../public/clientTextState.js');
const CT=require('../public/clientTextStore.js');
const {fixture,scope,fieldId,unit,asset}=require('./clienttext-storage-fixture.cjs');
async function prepared(){const f=fixture();await f.store.import(scope,{units:[unit()],assets:[asset]});return f;}
test('durable upload request journals preserve binary originals and isolate account and game',async()=>{
    const f=fixture(),owner={accountId:'alice',game:'poe2',branchId:'default'},payload={requestId:'upload',assets:[asset],units:[unit()]};
    const first=await f.store.putRequest(owner,'upload',payload);payload.units[0].fields[0].target='Mutated after queue';
    const recovered=await f.store.getRequest(owner,'upload');
    assert.equal(recovered.payload.assets[0].blob.size,asset.blob.size);assert.equal(await recovered.payload.assets[0].blob.text(),await asset.blob.text());
    assert.notEqual(recovered.payload.units[0].fields[0].target,payload.units[0].fields[0].target);
    assert.equal(await f.store.getRequest({...owner,accountId:'bob'},'upload'),undefined);
    assert.equal((await f.store.listRequests({...owner,game:'poe1'})).length,0);
    await f.store.putRequest(owner,'upload',{...recovered.payload,versionId:'confirmed'});
    assert.equal((await f.store.getRequest(owner,'upload')).createdAt,first.createdAt);
    assert.equal((await f.store.listRequests(owner)).length,1);await f.store.deleteRequest(owner,'upload');
    assert.equal((await f.store.listRequests(owner)).length,0);
});

test('request acknowledgement atomically consumes only its exact submitted draft identity',async()=>{
    const f=fixture(),owner={accountId:scope.accountId,game:scope.game,branchId:scope.branchId};
    await f.store.putRequest(owner,'comment',{text:'Sent',idempotencyKey:'first'});
    await f.store.putRequest(owner,'comment',{text:'Newer draft',idempotencyKey:'second'});
    assert.equal(await f.store.deleteRequest(owner,'comment',{expectedIdempotencyKey:'first'}),false);
    assert.equal((await f.store.getRequest(owner,'comment')).payload.text,'Newer draft');
    assert.equal(await f.store.deleteRequest(owner,'comment',{expectedIdempotencyKey:'second'}),true);
    assert.equal(await f.store.getRequest(owner,'comment'),undefined);
    assert.equal(await f.store.deleteRequest(owner,'comment',{expectedIdempotencyKey:'second'}),false);
});
test('originals/assets activate only when complete and remain scoped and immutable',async()=>{
    const f=await prepared();assert.equal((await f.store.getUnits(scope))[0].fields[0].source,'Source');
    assert.equal((await f.store.getAsset(scope,'normal')).blob.size,asset.blob.size);
    await assert.rejects(f.store.import(scope,{units:[unit('Other')],assets:[asset]}),/immutable/);
    await assert.rejects(f.store.getUnits({...scope,language:'French'}),/prepared/);
    assert.deepEqual(await f.store.getSaved({...scope,accountId:'bob'}),{});
    assert.equal((await f.store.listWorkspaces({accountId:'alice'})).length,1);
    assert.equal((await f.store.listWorkspaces({accountId:'bob'})).length,0);
});
test('source-only remote reviews retain carry conflicts and manual saves become Saved',async()=>{
    const f=await prepared(),original=unit(),conflict={fieldId,base:'Existing',local:'Preserved',upstream:'Existing'};
    await f.store.applyRemote(scope,{events:[{unitId:original.id,unit:{revision:1,saved:false,values:S.valuesFor(original),reviewed:{},
        provenance:{requiredReview:{[fieldId]:S.sourceHash('Source')},conflicts:[conflict]}}}],sequence:1});
    const fact=(await f.store.getSaved(scope))[original.id];
    assert.equal(fact.saved,false);assert.deepEqual(fact.outdated,[fieldId]);assert.deepEqual(fact.conflicts,[conflict]);
    assert.equal(S.statusFor(original,fact).saved,false);assert.equal(S.statusFor(original,fact).outdated,true);
    const saved=await f.store.save(scope,original.id,{jobId:'review',values:fact.values,reviewed:{[fieldId]:S.sourceHash('Source')}});
    assert.equal(saved.saved.saved,true);assert.equal(S.statusFor(original,saved.saved).saved,true);assert.equal(S.statusFor(original,saved.saved).outdated,false);
});
test('save, history, exact draft consumption, outbox and receipt share one affected-unit transaction',async()=>{
    const f=await prepared();const draft=await f.store.putDraft(scope,unit().id,{values:{[fieldId]:'Draft'},reviewed:{}});
    f.operations.length=0;const saved=await f.store.save(scope,unit().id,{jobId:'job1',values:draft.values,reviewed:{},expectedRevision:0,expectedDraftRevision:draft.revision});
    assert.equal(saved.saved.values[fieldId],'Draft');assert.equal(await f.store.getDraft(scope,unit().id),undefined);
    assert.equal((await f.store.listHistory(scope,unit().id)).length,1);assert.equal((await f.store.getOutbox(scope)).length,1);
    assert.ok(f.operations.every(operation=>!['kv','baseline_files','translation_workspaces'].includes(operation.name)));
    const replay=await f.store.save(scope,unit().id,{jobId:'job1',values:draft.values,reviewed:{},expectedRevision:0,expectedDraftRevision:draft.revision});
    assert.equal(replay.replayed,true);assert.equal((await f.store.listHistory(scope,unit().id)).length,1);
    await assert.rejects(f.store.save(scope,unit().id,{jobId:'job1',values:{[fieldId]:'Different'},reviewed:{}}),error=>error.code==='SAVE_RECEIPT_MISMATCH');
});
test('failed storage atomically preserves draft and avoids false saved/history/receipt',async()=>{
    const f=await prepared();await f.store.putDraft(scope,unit().id,{values:{[fieldId]:'Recoverable'},reviewed:{}});
    f.fail(CT.stores.history);
    await assert.rejects(f.store.save(scope,unit().id,{jobId:'failed',values:{[fieldId]:'Recoverable'},reviewed:{},expectedDraftRevision:1}),/failure/);
    f.fail(null);assert.equal((await f.store.getDraft(scope,unit().id)).values[fieldId],'Recoverable');assert.deepEqual(await f.store.getSaved(scope),{});
    assert.deepEqual(await f.store.getOutbox(scope),[]);assert.deepEqual(await f.store.listHistory(scope,unit().id),[]);
});
test('ClientText memory and its independent history commit atomically with saves and survive source removal',async()=>{
    const f=await prepared(),original=unit(),memoryScope={accountId:scope.accountId,game:scope.game,language:scope.language};
    await f.store.save(scope,original.id,{jobId:'first-memory',values:{[fieldId]:'Learned'},reviewed:{}});
    const memory=await f.store.getMemory(memoryScope);assert.equal(memory.counts.total,1);assert.equal(memory.units[0].target,'Learned');
    assert.equal((await f.store.getMemory({...memoryScope,accountId:'other'})).counts.total,0);
    f.fail(CT.stores.memoryHistory);
    await assert.rejects(f.store.save(scope,original.id,{jobId:'failed-memory',values:{[fieldId]:'Uncommitted'},reviewed:{}}),/failure/);f.fail(null);
    assert.equal((await f.store.getSaved(scope))[original.id].values[fieldId],'Learned');assert.equal((await f.store.getMemory(memoryScope)).units[0].target,'Learned');
    await f.store.save(scope,original.id,{jobId:'correct-memory',values:{[fieldId]:'Correction'},reviewed:{}});
    const records=await f.store.getMemoryHistory(memoryScope,memory.units[0].id);assert.equal(records.length,2);
    assert.equal(records.some(record=>record.before?.target==='Learned'&&record.after.target==='Correction'),true);
    f.tables.get(CT.stores.originals).clear();assert.equal((await f.store.getMemory(memoryScope)).units[0].target,'Correction');
});
test('accepted remote work learns memory while source-only, conflicted and unreviewed work remain excluded',async()=>{
    const f=await prepared(),original=unit();
    const event=(revision,changes={})=>({events:[{unitId:original.id,unit:{revision,values:{[fieldId]:'Shared '+revision},reviewed:{},...changes}}],sequence:revision});
    await f.store.applyRemote(scope,event(1,{saved:false}));assert.equal((await f.store.getMemory(scope)).counts.total,0);
    await f.store.applyRemote(scope,event(2,{conflicts:[{fieldId,local:'local',upstream:'upstream'}]}));assert.equal((await f.store.getMemory(scope)).counts.total,0);
    await f.store.applyRemote(scope,event(3,{outdated:[fieldId]}));assert.equal((await f.store.getMemory(scope)).counts.total,0);
    await f.store.applyRemote(scope,event(4,{outdated:[fieldId],reviewed:{[fieldId]:S.sourceHash(original.fields[0].source)}}));
    assert.equal((await f.store.getMemory(scope)).units[0].target,'Shared 4');
});
test('newer drafts and changed accounts cannot be consumed by an old operation',async()=>{
    const f=await prepared();await f.store.putDraft(scope,unit().id,{values:{[fieldId]:'Older'},reviewed:{}});
    await f.store.putDraft(scope,unit().id,{values:{[fieldId]:'Newer'},reviewed:{}},{expectedRevision:1});
    await assert.rejects(f.store.save(scope,unit().id,{jobId:'old',values:{[fieldId]:'Older'},reviewed:{},expectedDraftRevision:1}),error=>error.code==='DRAFT_CHANGED');
    assert.equal((await f.store.getDraft(scope,unit().id)).values[fieldId],'Newer');
    await assert.rejects(f.store.save(scope,unit().id,{jobId:'stale',values:{[fieldId]:'Older'},reviewed:{}},{guard:()=>false}),error=>error.stale===true);
});
test('uncertain remote job remains immutable while later edits wait, ACK rebases pending successor',async()=>{
    const f=await prepared();await f.store.save(scope,unit().id,{jobId:'first',values:{[fieldId]:'First'},reviewed:{}});
    const first=await f.store.markSending(scope,unit().id,'first');
    await f.store.save(scope,unit().id,{jobId:'second',values:{[fieldId]:'Second'},reviewed:{}});
    assert.equal((await f.store.getOutbox(scope))[0].predecessor.mutationId,'first');
    await f.store.acknowledge(scope,first,{revision:1,values:first.values,reviewed:{}});
    const pending=(await f.store.getOutbox(scope))[0];assert.equal(pending.mutationId,'second');assert.equal(pending.baseRevision,1);assert.equal(pending.predecessor,undefined);
    assert.equal((await f.store.getSaved(scope))[unit().id].values[fieldId],'Second');
});
test('shared event page commits its cursor with values, preserves local conflicts, and rejects invalid fields',async()=>{
    const f=await prepared();await f.store.save(scope,unit().id,{jobId:'local',values:{[fieldId]:'Local'},reviewed:{}});
    await f.store.applyRemote(scope,{events:[{unitId:unit().id,unit:{values:{[fieldId]:'Peer'},reviewed:{},revision:1}}],sequence:1});
    const saved=(await f.store.getSaved(scope))[unit().id];assert.equal(saved.values[fieldId],'Local');assert.equal(saved.conflicts.length,1);
    assert.equal((await f.store.getOutbox(scope))[0].state,'conflict');assert.equal((await f.store.getMetadata(scope)).sequence,1);
    await assert.rejects(f.store.applyRemote(scope,{events:[{unitId:unit().id,unit:{values:{unexpected:'Peer'},reviewed:{},revision:2}}],sequence:2}),/Unknown/);
    assert.equal((await f.store.getMetadata(scope)).sequence,1);
});
test('interrupted import resumes batches without exposing partial originals',async()=>{
    const f=fixture();const units=Array.from({length:140},(_,index)=>({...unit(),id:JSON.stringify(['normal','ClientStrings','ID'+index]),recordId:'ID'+index}));
    const manifest=await S.buildManifest(units,[asset]);let current=true;
    await assert.rejects(f.store.import(scope,{units,assets:[asset],manifest},{guard:()=>current,onProgress:event=>{if(event.processed>=128)current=false;}}),error=>error.stale===true);
    await assert.rejects(f.store.getUnits(scope),/prepared/);current=true;
    await f.store.import(scope,{units,assets:[asset],manifest},{guard:()=>current});assert.equal((await f.store.getUnits(scope)).length,140);
});
