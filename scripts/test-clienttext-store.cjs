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
test('large publication journals use bounded hidden fragments and rehydrate exact witnesses and Blobs',async()=>{
    const f=fixture({requestChunkBytes:2048,requestChunkRows:3}),owner={accountId:'alice',game:'poe2'},
        carry=Array.from({length:18},(_,index)=>({id:index,baseline:{...unit('English '+index),developerNotes:'Notes '+index},proof:['a'.repeat(64),'b'.repeat(64)]})),
        payload={kind:'publication',name:'Release',groups:[{language:'Thai',carry,original:asset.blob}],extra:'x'.repeat(3000)};
    await f.store.putRequest(owner,'large',payload);
    const listed=await f.store.listRequests(owner);assert.equal(listed.length,1);assert.equal(listed[0].payload.kind,'publication');
    assert.deepEqual(listed[0].payload.groups[0].carry,[]);assert.ok(listed[0].storage.parts.length>1);
    const fragments=[...f.tables.get(CT.stores.requests).values()].filter(row=>Array.isArray(row.value.values));
    assert.ok(fragments.length>5);assert.ok(fragments.every(row=>row.value.values.length<=3));
    assert.ok(fragments.every(row=>JSON.stringify(row.value).length*2<4096),'witness fragments remain bounded by bytes as well as rows');
    const restored=await f.store.getRequest(owner,'large');assert.deepEqual(restored.payload.groups[0].carry,carry);
    assert.equal(restored.payload.extra,payload.extra);assert.equal(await restored.payload.groups[0].original.text(),'original');
    carry[0].baseline.fields[0].source='Changed after queue';assert.equal((await f.store.getRequest(owner,'large')).payload.groups[0].carry[0].baseline.fields[0].source,'English 0');
    assert.equal(await f.store.getRequest({...owner,accountId:'bob'},'large'),undefined);
    await f.store.deleteRequest(owner,'large');assert.equal(f.tables.get(CT.stores.requests).size,0);
});
test('an interrupted checkpoint retains the prior complete generation and retry removes orphan fragments',async()=>{
    let interrupt=false,current=true;
    const f=fixture({requestChunkRows:2,yield:async()=>{if(interrupt)current=false;}}),owner={accountId:'alice',game:'poe2'};
    await f.store.putRequest(owner,'release',{kind:'publication',name:'Accepted checkpoint',carry:[{id:1},{id:2},{id:3}]});
    interrupt=true;
    await assert.rejects(f.store.putRequest(owner,'release',{kind:'publication',name:'Incomplete',carry:Array.from({length:8},(_,id)=>({id}))},{guard:()=>current}),error=>error.stale===true);
    const retained=await f.store.getRequest(owner,'release');assert.equal(retained.payload.name,'Accepted checkpoint');assert.deepEqual(retained.payload.carry,[{id:1},{id:2},{id:3}]);
    current=true;interrupt=false;
    await f.store.putRequest(owner,'release',{kind:'publication',name:'Retry',carry:[{id:4},{id:5},{id:6}]});
    const recovered=await f.store.getRequest(owner,'release');assert.equal(recovered.payload.name,'Retry');
    const referenced=new Set(recovered.storage.parts.flatMap(part=>part.chunkIds));
    assert.ok([...f.tables.get(CT.stores.requests).values()].every(row=>row.value.requestId==='release'||referenced.has(row.key)));
});
test('immutable publication checkpoints reuse durable carry fragments while mutable requests resnapshot',async()=>{
    const f=fixture({requestChunkRows:2}),owner={accountId:'alice',game:'poe2'},carry=Array.from({length:7},(_,id)=>({id,text:'Value '+id}));
    await f.store.putRequest(owner,'release',{kind:'publication',carry},{immutablePublicationData:true});
    const first=await f.store.listRequests(owner),ids=first[0].storage.parts[0].chunkIds;
    f.operations.length=0;
    await f.store.putRequest(owner,'release',{kind:'publication',carry,version:{id:'server-version'}},{immutablePublicationData:true});
    assert.deepEqual((await f.store.listRequests(owner))[0].storage.parts[0].chunkIds,ids);
    assert.equal(f.operations.filter(operation=>operation.method==='put').length,2,'only intent and visible header are updated');
    carry[0].text='Mutable replacement';
    await f.store.putRequest(owner,'release',{kind:'publication',carry});
    assert.notDeepEqual((await f.store.listRequests(owner))[0].storage.parts[0].chunkIds,ids);
    assert.equal((await f.store.getRequest(owner,'release')).payload.carry[0].text,'Mutable replacement');
});
test('a newer request can replace an interrupted large write without the older writer resurfacing',async()=>{
    let entered,release;
    const ready=new Promise(resolve=>entered=resolve),resume=new Promise(resolve=>release=resolve);let hold=true;
    const f=fixture({requestChunkRows:2,yield:async()=>{if(hold){hold=false;entered();await resume;}}}),owner={accountId:'alice',game:'poe2'};
    const old=f.store.putRequest(owner,'request',{idempotencyKey:'old',carry:[1,2,3,4]});await ready;
    await f.store.putRequest(owner,'request',{idempotencyKey:'new',text:'Newer checkpoint'});
    release();await assert.rejects(old,error=>error.code==='REQUEST_SUPERSEDED');
    assert.equal((await f.store.getRequest(owner,'request')).payload.text,'Newer checkpoint');
    assert.equal(await f.store.deleteRequest(owner,'request',{expectedIdempotencyKey:'old'}),false);
    assert.equal(await f.store.deleteRequest(owner,'request',{expectedIdempotencyKey:'new'}),true);
    assert.equal(f.tables.get(CT.stores.requests).size,0);
});
test('an old acknowledgement cannot delete a newer same-ID checkpoint while its fragments are staging',async()=>{
    let entered,release,hold=false;
    const ready=new Promise(resolve=>entered=resolve),resume=new Promise(resolve=>release=resolve),
        f=fixture({requestChunkRows:2,yield:async()=>{if(hold){hold=false;entered();await resume;}}}),owner={accountId:'alice',game:'poe2'};
    await f.store.putRequest(owner,'comment',{idempotencyKey:'old',text:'Submitted'});
    hold=true;const next=f.store.putRequest(owner,'comment',{idempotencyKey:'new',text:'Newer draft',carry:[1,2,3,4]});await ready;
    assert.equal(await f.store.deleteRequest(owner,'comment',{expectedIdempotencyKey:'old'}),false);
    assert.equal((await f.store.getRequest(owner,'comment')).payload.text,'Submitted','prior checkpoint stays recoverable until the new one commits');
    release();await next;assert.equal((await f.store.getRequest(owner,'comment')).payload.text,'Newer draft');
    assert.equal(await f.store.deleteRequest(owner,'comment',{expectedIdempotencyKey:'old'}),false);
    assert.equal(await f.store.deleteRequest(owner,'comment',{expectedIdempotencyKey:'new'}),true);
});
test('large object request payloads and nested array parts preserve their exact structure',async()=>{
    const f=fixture({requestChunkRows:2,requestChunkBytes:2048}),owner={accountId:'alice',game:'poe2'},
        payload={kind:'publication',groups:[{carry:Array.from({length:5},(_,id)=>({id,proof:Array.from({length:5},(_,index)=>({index,hash:'a'.repeat(64)}))}))}],
            metadata:Object.fromEntries(Array.from({length:60},(_,index)=>['key'+index,'value'.repeat(20)]))};
    await f.store.putRequest(owner,'nested',payload);
    assert.deepEqual((await f.store.getRequest(owner,'nested')).payload,payload);
    assert.ok((await f.store.listRequests(owner))[0].storage.parts.some(part=>part.kind==='object'));
});
test('workspaces read immutable units and Saved records in bounded exact-scope pages',async()=>{
    const f=fixture(),units=Array.from({length:270},(_,index)=>({...unit(),id:JSON.stringify(['normal','ClientStrings','ID'+index]),recordId:'ID'+index}));
    await f.store.import(scope,{units,assets:[asset]});
    assert.equal(f.operations.filter(operation=>operation.name===CT.stores.originals&&operation.method==='get').length,0,'fresh immutable import does not await 270 per-unit existence reads');
    await f.store.import({...scope,groupId:'another-group'},{units:[unit('Other group')],assets:[asset]});
    f.operations.length=0;const loaded=await f.store.getUnits(scope);
    assert.equal(loaded.length,270);assert.equal(new Set(loaded.map(value=>value.id)).size,270);assert.ok(loaded.every(value=>value.fields[0].source==='Source'));
    const pages=f.operations.filter(operation=>operation.name===CT.stores.originals&&operation.method==='getAll');
    assert.equal(pages.length,3);assert.ok(pages.every(operation=>operation.arg.count===128));
    assert.equal(f.operations.some(operation=>operation.name===CT.stores.originals&&operation.method==='index.getAll'),false);
    f.operations.length=0;const compact=await f.store.getCompactUnits(scope);
    assert.equal(compact.length,270);assert.deepEqual(compact.find(value=>value.id===units[0].id),S.compactUnit(units[0]));
    assert.equal(f.operations.filter(operation=>operation.name===CT.stores.originals&&operation.method==='getAll').length,3);
    await assert.rejects(f.store.getCompactUnits({...scope,language:'French'}),/prepared/);
    const id=CT.scopeKey(scope);
    for(let index=0;index<270;index++)f.tables.get(CT.stores.saved).set(JSON.stringify([id,units[index].id]),{key:JSON.stringify([id,units[index].id]),scope:id,value:{unitId:units[index].id,values:{[fieldId]:'Saved '+index}}});
    f.operations.length=0;assert.equal(Object.keys(await f.store.getSaved(scope)).length,270);
    assert.equal(f.operations.filter(operation=>operation.name===CT.stores.saved&&operation.method==='getAll').length,3);
});
test('bounded proof tree assets keep retained binary originals and return identical point proofs',async()=>{
    const f=fixture({requestChunkBytes:2048}),units=Array.from({length:75},(_,index)=>({...unit('Source '+index),id:JSON.stringify(['normal','ClientStrings','ID'+index]),recordId:'ID'+index})),
        original={...asset,name:'Thai.xlsm',blob:new Blob([new Uint8Array([0,255,13,10,42])]),parsed:{units,marker:'Workbook schema',sheets:[{name:'ClientStrings'}]}},
        manifest=await S.buildManifest(units,[original]);
    await f.store.import(scope,{units,assets:[original],manifest});
    const stored=f.tables.get(CT.stores.assets).get(JSON.stringify([CT.scopeKey(scope),'normal'])).value;
    assert.equal(stored.tree,undefined);assert.equal(stored.parsed.units,undefined);assert.ok(stored.treeStorage.ids.parts.length>1);
    const reconstructed=await f.store.getAsset(scope,'normal');assert.deepEqual(reconstructed.tree,manifest.trees.normal);
    assert.deepEqual([...new Uint8Array(await reconstructed.blob.arrayBuffer())],[0,255,13,10,42]);
    f.operations.length=0;
    for(const index of [0,1,33,74]){
        const actual=await f.store.getProof(scope,units[index].id);
        assert.deepEqual(actual.proof,S.proofFor(manifest,units[index].id));assert.deepEqual(actual.descriptor,manifest.descriptors[0]);
        assert.equal(S.verifyWitness(units[index],S.compactUnit(units[index]),actual.proof,actual.descriptor),true);
    }
    assert.equal(f.operations.some(operation=>operation.method==='getAll'||operation.method==='index.getAll'),false,'single-unit proof reads only its bounded tree path');
    // A pre-upgrade partial unit lacks proofIndex, so search bounded ID chunks.
    const row=f.tables.get(CT.stores.originals).get(JSON.stringify([CT.scopeKey(scope),units[33].id]));delete row.value.proofIndex;
    assert.deepEqual((await f.store.getProof(scope,units[33].id)).proof,S.proofFor(manifest,units[33].id));
    // Existing v11 whole-tree records remain readable without rewriting them.
    stored.tree=manifest.trees.normal;delete stored.treeStorage;
    assert.deepEqual((await f.store.getAsset(scope,'normal')).tree,manifest.trees.normal);
    assert.deepEqual((await f.store.getProof(scope,units[74].id)).proof,S.proofFor(manifest,units[74].id));
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
