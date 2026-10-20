/* Atomic storage contracts; real browser transactions are exercised separately. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../public/clientTextState.js');
const C=require('../public/clientTextStore.js');
const {fixture,scope:sharedScope,unit,fieldId,asset}=require('./clienttext-storage-fixture.cjs');
const scope={...sharedScope,versionId:'local:test:v1',groupId:'local:test:g1'};
const values=text=>({[fieldId]:text});
const rowKey=(rawScope,id)=>JSON.stringify([C.scopeKey(rawScope),id]);
const ownedAsset=async(source='Source')=>{const blob=new Blob(['workbook bytes:'+source]);return {...asset,blob,hash:S.sha256(await blob.arrayBuffer())};};
async function prepared(rawScope=scope,source='Source',target='Thai',dependencies={}){
    const f=fixture(dependencies),original=unit(source,target),originalAsset=await ownedAsset(source);
    await f.store.import(rawScope,{units:[original],assets:[originalAsset]});return {...f,original,originalAsset};
}

test('local commits durably retain exact bytes, saved edits, reviews, history and independent active drafts',async()=>{
    const f=await prepared(),reviewed={[fieldId]:S.sourceHash('Source')};
    const before=await f.store.putDraft(scope,f.original.id,{values:values('Committed \r\nไทย \\n'),reviewed},{expectedRevision:null});
    const command={jobId:'local-save',values:before.values,reviewed,expectedRevision:0,expectedDraftRevision:before.revision};
    const saved=await f.store.save(scope,f.original.id,command);
    const draft=await f.store.putDraft(scope,f.original.id,{values:values('Still typing'),reviewed},{expectedRevision:null});
    assert.deepEqual(await f.store.getDraft(scope,f.original.id),draft);
    assert.deepEqual((await f.store.getSaved(scope))[f.original.id],saved.saved);
    assert.equal((await f.store.listHistory(scope,f.original.id)).length,1);
    assert.equal((await f.store.save(scope,f.original.id,command)).replayed,true);
    assert.deepEqual(await f.store.getDraft(scope,f.original.id),draft,'receipt replay preserves a newer draft');
    assert.equal((await f.store.listHistory(scope,f.original.id)).length,1);
    assert.equal(S.sha256(await (await f.store.getAsset(scope)).blob.arrayBuffer()),f.originalAsset.hash);
    const commit=f.commits.find(writes=>writes.some(write=>write.name===C.stores.receipts));
    for(const label of ['saved','history','drafts','receipts'])assert.ok(commit.some(write=>write.name===C.stores[label]),label+' shares the durable save transaction');
    assert.equal(f.tables.get(C.stores.outbox).size,0,'local saves cannot accidentally enqueue workbook synchronization');
    await assert.rejects(f.store.save(scope,f.original.id,{...command,values:values('Different retry')}),{code:'SAVE_RECEIPT_MISMATCH'});
});

test('local writes request strict durability and failures preserve the entire prior committed snapshot',async()=>{
    const f=await prepared(),calls=[],transaction=f.db.transaction;
    f.db.transaction=(names,mode,options)=>{calls.push({mode,options});return transaction(names,mode,options);};
    const draft=await f.store.putDraft(scope,f.original.id,{values:values('Retain after failure')},{expectedRevision:null});
    f.fail(C.stores.history);
    await assert.rejects(f.store.save(scope,f.original.id,{jobId:'failure',values:draft.values,expectedDraftRevision:draft.revision,expectedRevision:0}),/Injected storage failure/);
    assert.deepEqual(await f.store.getSaved(scope),{});assert.deepEqual(await f.store.listHistory(scope,f.original.id),[]);
    assert.deepEqual(await f.store.getDraft(scope,f.original.id),draft);assert.equal(f.tables.get(C.stores.receipts).size,0);
    assert.ok(calls.filter(call=>call.mode==='readwrite').every(call=>call.options.durability==='strict'));
    f.fail(null);const saved=await f.store.save(scope,f.original.id,{jobId:'failure',values:draft.values,expectedDraftRevision:draft.revision,expectedRevision:0});
    assert.equal(saved.saved.values[fieldId],'Retain after failure');
});

test('local TM stays in the exact workbook scope and resource seeding cannot replace learned work',async()=>{
    const f=await prepared(),localId=C.scopeKey(scope);
    await f.store.save(scope,f.original.id,{jobId:'learn',values:values('Private target')});
    assert.ok(f.tables.get(C.stores.memory).size>0);
    assert.ok([...f.tables.get(C.stores.memory).values()].every(row=>row.scope===localId));
    const learned=await f.store.getMemory(scope);
    const seed={id:'seed',language:'Thai',gameScope:'poe2',source:'Cached source',target:'Cached target',context:{contentMode:'clienttext',fieldKind:'text'}};
    await f.store.seedMemory(scope,[seed]);seed.target='Caller mutation';
    assert.equal((await f.store.getMemory(scope)).units.find(value=>value.id==='seed').target,'Cached target');
    await f.store.seedMemory(scope,[{...seed,id:learned.units[0].id,target:'Do not replace'}]);
    assert.equal((await f.store.getMemory(scope)).units.find(value=>value.id===learned.units[0].id).target,'Private target');
    assert.equal((await f.store.getMemory(sharedScope)).counts.total,0);
    for(const change of [{accountId:'bob'},{game:'poe1'},{branchId:'another'},{versionId:'local:test:v2'},{groupId:'local:test:g2'},{language:'French'}]){
        const other={...scope,...change};assert.equal((await f.store.getMemory(other)).counts.total,0);
        assert.deepEqual(await f.store.getSaved(other),{});assert.equal(await f.store.getDraft(other,f.original.id),undefined);
    }
    await assert.rejects(f.store.applyRemote(scope,[]),/cannot receive shared/);
    await assert.rejects(f.store.markSending(scope,f.original.id,'learn'),/cannot enter shared/);
    await assert.rejects(f.store.acknowledge(scope,{unitId:f.original.id},{}),/cannot receive shared/);
});

test('previous source review/history and ready metadata publish atomically after preparation',async()=>{
    const f=await prepared(),next={...scope,versionId:'local:test:v2',groupId:'local:test:g2'},nextUnit=unit('Changed source','New original'),nextAsset=await ownedAsset('Changed source');
    f.fail(C.stores.history);
    await assert.rejects(f.store.import(next,{units:[nextUnit],assets:[nextAsset],previousScope:scope}),/Injected storage failure/);
    assert.equal(await f.store.getMetadata(next),undefined,'a half imported previous comparison is never ready');
    assert.deepEqual(await f.store.getSaved(next),{});
    assert.equal((await f.store.listWorkspaces({accountId:scope.accountId})).length,1);
    f.fail(null);await f.store.import(next,{units:[nextUnit],assets:[nextAsset],previousScope:scope});
    const metadata=await f.store.getMetadata(next),saved=(await f.store.getSaved(next))[nextUnit.id],history=await f.store.listHistory(next,nextUnit.id);
    assert.deepEqual(metadata.previousScope,scope);assert.equal(saved.saved,false);assert.deepEqual(saved.outdated,[fieldId]);
    assert.equal(saved.provenance.requiredReview[fieldId],S.sourceHash('Changed source'));
    assert.equal(history.length,1);assert.equal(history[0].origin,'version_import');
    assert.ok(f.commits.some(writes=>['meta','saved','history'].every(label=>writes.some(write=>write.name===C.stores[label]))));
    await f.store.seedPreviousVersion(next,scope);assert.equal((await f.store.listHistory(next,nextUnit.id)).length,1,'retries do not duplicate source review history');
    await assert.rejects(f.store.seedPreviousVersion(next,{...scope,accountId:'bob'}),/must match/);
});

test('same original imports never overwrite work and source changes require a distinct identity',async()=>{
    const f=await prepared();await f.store.save(scope,f.original.id,{jobId:'keep',values:values('Keep work')});
    await f.store.import(scope,{units:[f.original],assets:[f.originalAsset]});
    assert.equal((await f.store.getSaved(scope))[f.original.id].values[fieldId],'Keep work');
    await assert.rejects(f.store.import(scope,{units:[unit('Changed')],assets:[await ownedAsset('Changed')]}),/immutable/);
    const other={...scope,versionId:'local:test:repeat',groupId:'local:test:repeat'};
    await f.store.import(other,{units:[f.original],assets:[f.originalAsset]});
    assert.deepEqual(await f.store.getSaved(other),{});assert.equal((await f.store.listHistory(scope,f.original.id)).length,1);
    await assert.rejects(f.store.import({...other,groupId:'local:test:corrupt'},{units:[f.original],assets:[{...f.originalAsset,blob:new Blob(['Wrong bytes'])}]}),{code:'CLIENTTEXT_LOCAL_INVALID'});
});

test('malformed persisted originals, saved fields, drafts, metadata and retained bytes fail without deletion',async()=>{
    const f=await prepared(),cache=(await f.store.getMetadata(scope)).originalCaches.normal;
    await f.store.save(scope,f.original.id,{jobId:'save',values:values('Keep')});
    await f.store.putDraft(scope,f.original.id,{values:values('Keep draft')});
    const scenarios=[
        [C.stores.saved,rowKey(scope,f.original.id),row=>{row.value.values={unknown:'bad'};},()=>f.store.getSaved(scope)],
        [C.stores.drafts,rowKey(scope,f.original.id),row=>{row.value.reviewed={[fieldId]:'wrong source'};},()=>f.store.getDraft(scope,f.original.id)],
        [C.stores.cacheUnits,JSON.stringify([cache,f.original.id]),row=>{row.value.unit.fields[0].source={bad:true};},()=>f.store.getUnit(scope,f.original.id)],
        [C.stores.meta,rowKey(scope,'meta'),row=>{row.value.accountId='bob';},()=>f.store.getMetadata(scope)],
        [C.stores.cacheAssets,JSON.stringify([cache,'asset']),row=>{row.value.blob=new Blob(['corrupt']);},()=>f.store.getAsset(scope)],
    ];
    for(const [store,id,alter,read]of scenarios){
        const original=structuredClone(f.tables.get(store).get(id)),changed=structuredClone(original);alter(changed);f.tables.get(store).set(id,changed);
        const before=f.tables.get(store).size;await assert.rejects(read(),{code:'CLIENTTEXT_LOCAL_INVALID'});
        assert.equal(f.tables.get(store).size,before);assert.deepEqual(f.tables.get(store).get(id),changed,'failed reads retain recovery evidence');
        f.tables.get(store).set(id,original);
    }
    const metadata=f.tables.get(C.stores.meta).get(rowKey(scope,'meta'));metadata.value.localRestorePending=true;
    assert.equal((await f.store.getMetadata(scope)).localRestorePending,true);await assert.rejects(f.store.getUnits(scope),{code:'CLIENTTEXT_NOT_READY'});
});

test('captured ownership guards abort pending writes and preserve existing drafts',async()=>{
    const f=await prepared(),draft=await f.store.putDraft(scope,f.original.id,{values:values('Before')},{expectedRevision:null});
    let checks=0;
    await assert.rejects(f.store.putDraft(scope,f.original.id,{values:values('After')},{expectedRevision:draft.revision,guard:()=>++checks<6}),error=>error.stale);
    assert.equal((await f.store.getDraft(scope,f.original.id)).values[fieldId],'Before');
    await assert.rejects(f.store.putDraft(scope,f.original.id,{values:values('Stale')},{expectedRevision:null}),{code:'DRAFT_CHANGED'});
});

test('a delayed same-original importer cannot overwrite a ready workspace or its authored work',async()=>{
    const releases=[],entered=[];let count=0;
    const f=fixture({yield:async()=>{const index=count++;entered[index]?.();await new Promise(resolve=>{releases[index]=resolve;});}}),original=unit(),originalAsset=await ownedAsset();
    const firstEntered=new Promise(resolve=>entered[0]=resolve),secondEntered=new Promise(resolve=>entered[1]=resolve);
    const first=f.store.import(scope,{units:[original],assets:[originalAsset],metadata:{label:'first'}});await firstEntered;
    const second=f.store.import(scope,{units:[original],assets:[originalAsset],metadata:{label:'late'}});await secondEntered;
    releases[0]();await first;
    await f.store.save(scope,original.id,{jobId:'first-save',values:values('Authored before delayed import')});
    await f.store.seedMemory(scope,[]);
    releases[1]();await second;
    assert.equal((await f.store.getMetadata(scope)).label,'first');assert.equal((await f.store.getMetadata(scope)).memorySeeded,true);
    assert.equal((await f.store.getSaved(scope))[original.id].values[fieldId],'Authored before delayed import');
    assert.equal((await f.store.listHistory(scope,original.id)).length,1);
});
