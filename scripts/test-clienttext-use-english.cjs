'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../public/clientTextState.js');
const C=require('../public/clientTextStore.js');
const {fixture,scope:baseScope,unit,fieldId:id,asset}=require('./clienttext-storage-fixture.cjs');
const protocol=S.ENGLISH_INTENT_PROTOCOL,values=text=>({[id]:text});
const action=(name='set',previousValue='Source')=>({[id]:{action:name,sourceHash:S.sourceHash('Source'),previousValue}});
async function local(target=''){
    const f=fixture(),scope={...baseScope,versionId:'local:test:english-v',groupId:'local:test:english-g'},original=unit('Source',target);
    const blob=new Blob(['English intent original']),originalAsset={...asset,blob,hash:S.sha256(await blob.arrayBuffer())};
    await f.store.import(scope,{units:[original],assets:[originalAsset]});return {...f,scope,original};
}
test('blank or identical ordinary saves never infer English intent; explicit metadata-only approval does not manufacture Saved',async()=>{
    const f=await local(),u=f.original;
    const empty=await f.store.save(f.scope,u.id,{jobId:'blank',values:values('')});assert.equal(empty.saved.englishIntent,undefined);
    const g=await local();const command={jobId:'mark',intentProtocol:protocol,englishActions:action(),values:values(''),reviewed:{[id]:S.sourceHash('Source')},expectedRevision:0};
    const result=await g.store.save(g.scope,u.id,command);assert.equal(result.saved.saved,false);assert.equal(S.englishIntentFor(u.fields[0],result.saved),true);
    assert.equal((await g.store.save(g.scope,u.id,command)).replayed,true);assert.equal((await g.store.listHistory(g.scope,u.id)).length,1);
    assert.equal((await g.store.listHistory(g.scope,u.id))[0].intentChanges[id].previousValue,'Source');
    assert.deepEqual(await g.store.getOutbox(g.scope),[]);assert.deepEqual((await g.store.getMemory(g.scope)).units,[]);
    assert.equal(S.statusFor(u,result.saved).missing,true,'raw Missing semantics are unchanged');
});
test('conversion preserves committed and editor text, revocation and normal translation cannot resurrect approvals',async()=>{
    const f=await local('Original translation'),u=f.original;
    const marked=await f.store.save(f.scope,u.id,{jobId:'convert',intentProtocol:protocol,englishActions:action('set','Typed source'),values:values(''),reviewed:{[id]:S.sourceHash('Source')}});
    assert.equal(marked.saved.saved,true);assert.equal((await f.store.listHistory(f.scope,u.id))[0].intentChanges[id].previousValue,'Typed source');
    await assert.rejects(f.store.save(f.scope,u.id,{jobId:'old-writer',values:values('text')}),/Update the editor/);
    const revoked=await f.store.save(f.scope,u.id,{jobId:'revoke',intentProtocol:protocol,englishActions:action('revoke',''),values:values('')});
    assert.equal(revoked.saved.englishIntent[id].state,'revoked');
    const restored=await f.store.save(f.scope,u.id,{jobId:'restore',origin:'restore',intentProtocol:protocol,values:values('')});assert.equal(restored.saved.englishIntent[id].state,'revoked');
    assert.equal((await f.store.getMetadata(f.scope)).localProtocol,'clienttext-local-v2');
    const other={...f.scope,groupId:'local:test:other',versionId:'local:test:other-v'};assert.deepEqual(await f.store.getSaved(other),{});
});
test('failed decision transaction retains the original draft and leaves no partial history or receipt',async()=>{
    const f=await local('Prior'),u=f.original,draft=await f.store.putDraft(f.scope,u.id,{values:values('Source')});f.fail(C.stores.history);
    const command={jobId:'abort',intentProtocol:protocol,englishActions:action(),values:values(''),expectedDraftRevision:draft.revision};
    await assert.rejects(f.store.save(f.scope,u.id,command),/Injected/);assert.deepEqual(await f.store.getSaved(f.scope),{});
    assert.deepEqual(await f.store.getDraft(f.scope,u.id),draft);assert.equal(f.tables.get(C.stores.receipts).size,0);
    f.fail(null);assert.equal((await f.store.save(f.scope,u.id,command)).saved.values[id],'');
});
test('explicit local predecessor selection carries decisions without merging translations or unrelated imports',async()=>{
    const f=await local(),u=f.original;
    await f.store.save(f.scope,u.id,{jobId:'parent-mark',intentProtocol:protocol,englishActions:action(),values:values(''),reviewed:{[id]:S.sourceHash('Source')}});
    const next={...f.scope,versionId:'local:test:next-v',groupId:'local:test:next-g'},blob=new Blob(['next package']),nextAsset={...asset,blob,hash:S.sha256(await blob.arrayBuffer())};
    await f.store.import(next,{units:[u],assets:[nextAsset],previousScope:f.scope});
    const carried=(await f.store.getSaved(next))[u.id];assert.equal(carried.englishIntent[id].state,'active');assert.equal(carried.saved,false);assert.equal(carried.provenance.groupId,f.scope.groupId);
    const independent={...next,versionId:'local:test:independent-v',groupId:'local:test:independent-g'};await f.store.import(independent,{units:[u],assets:[nextAsset]});assert.deepEqual(await f.store.getSaved(independent),{});
    const changed={...next,versionId:'local:test:changed-v',groupId:'local:test:changed-g'},changedUnit=unit('Changed source','');const changedBlob=new Blob(['changed package']),changedAsset={...asset,blob:changedBlob,hash:S.sha256(await changedBlob.arrayBuffer())};
    await f.store.import(changed,{units:[changedUnit],assets:[changedAsset],previousScope:next});assert.equal((await f.store.getSaved(changed))[u.id].englishIntent[id].state,'needs_review');
});
test('source change invalidates, source reversion does not reactivate, upstream translations are never cleared automatically',()=>{
    const old=unit('Source',''),saved={values:values(''),reviewed:{},saved:false,englishIntent:{[id]:{state:'active',sourceHash:S.sourceHash('Source'),decisionId:'mark'}}};
    const same=S.carryForward(old,unit('Source',''),saved);assert.equal(same.englishIntent[id].state,'active');
    const changed=S.carryForward(old,unit('Changed source',''),saved);assert.equal(changed.englishIntent[id].state,'needs_review');
    const reverted=S.carryForward(unit('Changed source',''),old,{...changed});assert.equal(reverted.englishIntent[id].state,'needs_review');
    const upstream=S.carryForward(old,unit('Source','New upstream translation'),saved);assert.equal(upstream.values[id],'New upstream translation');assert.equal(upstream.englishIntent[id].reason,'upstream_translation');assert.equal(upstream.conflicts.length,1);
    assert.equal(S.carryForward(old,old,{...saved,englishIntent:{[id]:{...saved.englishIntent[id],state:'revoked'}}}).englishIntent[id].state,'revoked');
    const gender={...old,role:'gender',id:JSON.stringify(['gender',old.sheet,old.recordId])};assert.equal(S.carryForward(old,gender,saved).englishIntent,undefined,'Normal cannot mark a Gender workbook field');
    const changedUpstream=S.carryForward(unit('Source','Original upstream'),unit('Changed source','Original upstream'),saved);assert.equal(changedUpstream.values[id],'Original upstream','even changed-source carry never clears a nonblank incoming original');
});
test('a competing shared edit holds an unsent English action for explicit resolution instead of rebasing its approval',async()=>{
    const f=fixture(),u=unit();await f.store.import(baseScope,{units:[u],assets:[asset]});
    await f.store.save(baseScope,u.id,{jobId:'queued-mark',intentProtocol:protocol,englishActions:action(),values:values(''),reviewed:{[id]:S.sourceHash('Source')}});
    await f.store.applyRemote(baseScope,{events:[{unitId:u.id,unit:{unitId:u.id,revision:1,values:values('Peer translation'),reviewed:{},saved:true,englishIntent:{}}}],sequence:1});
    const pending=(await f.store.getOutbox(baseScope))[0];assert.equal(pending.state,'conflict');assert.equal(pending.baseRevision,0,'original command is not retargeted');
    assert.equal(S.englishIntentFor(u.fields[0],(await f.store.getSaved(baseScope))[u.id]),false);
    await assert.rejects(f.store.save(baseScope,u.id,{jobId:'implicit-blank',intentProtocol:protocol,values:values('')}),/explicitly/);
    const before=(await f.store.getSaved(baseScope))[u.id];
    await f.store.acceptPendingPeer(baseScope,u.id,{jobId:'accept-peer',mutationId:pending.mutationId,expectedRevision:before.revision});
    assert.deepEqual(await f.store.getOutbox(baseScope),[]);
    assert.equal((await f.store.listHistory(baseScope,u.id)).find(entry=>entry.id==='accept-peer').syncRecovery.resolution,'accept-peer');
});
test('identical blank approvals can accept peer without losing drafts or explicitly reapply with a new command and retained evidence',async()=>{
    const f=fixture(),u=unit('Source','');await f.store.import(baseScope,{units:[u],assets:[asset]});
    const mark=jobId=>({jobId,intentProtocol:protocol,englishActions:action(),values:values(''),reviewed:{[id]:S.sourceHash('Source')}});
    const peer=(revision,decisionId)=>({unitId:u.id,revision,values:values(''),reviewed:{[id]:S.sourceHash('Source')},saved:false,englishIntent:{[id]:{state:'active',sourceHash:S.sourceHash('Source'),decisionId}}});
    await f.store.save(baseScope,u.id,mark('mine'));
    await f.store.applyRemote(baseScope,{events:[{unit:peer(1,'peer')}],sequence:1});
    const draft=await f.store.putDraft(baseScope,u.id,{values:values('Private draft')});
    const accept={jobId:'accept-identical',mutationId:'mine',expectedRevision:(await f.store.getSaved(baseScope))[u.id].revision};
    assert.equal((await f.store.acceptPendingPeer(baseScope,u.id,accept)).saved.englishIntent[id].decisionId,'peer');
    assert.equal((await f.store.acceptPendingPeer(baseScope,u.id,accept)).replayed,true);assert.deepEqual(await f.store.getDraft(baseScope,u.id),draft);
    await f.store.save(baseScope,u.id,mark('mine-again'));
    await f.store.applyRemote(baseScope,{events:[{unit:peer(2,'peer-again')}],sequence:2});
    const archived=await f.store.getPendingRecovery(baseScope,u.id);
    const result=await f.store.save(baseScope,u.id,{...mark('fresh-choice'),pendingResolution:{mode:'reapply',mutationId:archived.mutationId,editorBeforeValues:values('Editor copy')}});
    assert.equal(result.saved.englishIntent[id].decisionId,'fresh-choice');
    const next=(await f.store.getOutbox(baseScope))[0];assert.equal(next.mutationId,'fresh-choice');assert.equal(next.baseRevision,2);assert.equal(next.predecessor,undefined);
    const history=(await f.store.listHistory(baseScope,u.id)).find(entry=>entry.syncRecovery?.operation.mutationId==='mine-again');
    assert.deepEqual(history.syncRecovery.editorBeforeValues,values('Editor copy'));
});

test('an older uncertain intent receipt preserves a newer peer version and clears the resolved queue',async()=>{
    const f=fixture(),u=unit('Source','');await f.store.import(baseScope,{units:[u],assets:[asset]});
    await f.store.save(baseScope,u.id,{jobId:'uncertain-mark',intentProtocol:protocol,englishActions:action(),values:values('')});
    const pending=await f.store.markSending(baseScope,u.id,'uncertain-mark','uncertain');
    await f.store.applyRemote(baseScope,{events:[{unit:{unitId:u.id,revision:2,values:values('Later peer'),reviewed:{},saved:true}}],sequence:2});
    assert.equal((await f.store.getSaved(baseScope))[u.id].syncRecovery,undefined,'an unknown receipt cannot offer destructive recovery');
    await f.store.acknowledge(baseScope,pending,{unitId:u.id,revision:1,values:values(''),reviewed:{},englishIntent:{[id]:{state:'active',sourceHash:S.sourceHash('Source'),decisionId:'uncertain-mark'}}});
    const saved=(await f.store.getSaved(baseScope))[u.id];assert.equal(saved.values[id],'Later peer');assert.equal(saved.serverRevision,2);
    assert.deepEqual(saved.englishIntent,{});assert.deepEqual(saved.conflicts,[]);assert.equal(saved.syncRecovery,undefined);assert.deepEqual(await f.store.getOutbox(baseScope),[]);
});

test('a late predecessor receipt cannot regress a newer queued command base or alter retained request evidence',async()=>{
    const f=fixture(),u=unit('Source','');await f.store.import(baseScope,{units:[u],assets:[asset]});
    await f.store.save(baseScope,u.id,{jobId:'old-mark',intentProtocol:protocol,englishActions:action(),values:values('')});
    const previous=await f.store.markSending(baseScope,u.id,'old-mark','uncertain');
    await f.store.save(baseScope,u.id,{jobId:'newer-target',intentProtocol:protocol,values:values('Current editor')});
    await f.store.applyRemote(baseScope,{events:[{unit:{unitId:u.id,revision:2,values:values('Newer peer'),reviewed:{},saved:true}}],sequence:2});
    await f.store.acknowledge(baseScope,previous,{unitId:u.id,revision:1,values:values(''),reviewed:{}});
    const next=(await f.store.getOutbox(baseScope))[0];assert.equal(next.mutationId,'newer-target');assert.equal(next.baseRevision,2);assert.equal(next.base.values[id],'Newer peer');
    assert.equal(next.predecessor,undefined);assert.equal(next.values[id],'Current editor');assert.equal(previous.values[id],'');
});

test('a queued approval behind an uncertain predecessor still requires explicit recovery after a newer peer',async()=>{
    const f=fixture(),u=unit('Source','');await f.store.import(baseScope,{units:[u],assets:[asset]});
    await f.store.save(baseScope,u.id,{jobId:'older-save',values:values('Older target')});
    const previous=await f.store.markSending(baseScope,u.id,'older-save','uncertain');
    await f.store.save(baseScope,u.id,{jobId:'queued-choice',intentProtocol:protocol,englishActions:action(),values:values('')});
    await f.store.applyRemote(baseScope,{events:[{unit:{unitId:u.id,revision:2,values:values('Peer target'),reviewed:{},saved:true}}],sequence:2});
    await f.store.acknowledge(baseScope,previous,{unitId:u.id,revision:1,values:values('Older target'),reviewed:{}});
    const next=(await f.store.getOutbox(baseScope))[0];assert.equal(next.state,'conflict');assert.equal(next.baseRevision,0,'the original approval is not retargeted to the peer');
    assert.equal(next.predecessor,undefined);assert.equal((await f.store.getSaved(baseScope))[u.id].syncRecovery.mutationId,'queued-choice');
});

test('a definitive English conflict exposes recovery even if its peer event was already applied',async()=>{
    const f=fixture(),u=unit('Source','');await f.store.import(baseScope,{units:[u],assets:[asset]});
    await f.store.save(baseScope,u.id,{jobId:'sending-mark',intentProtocol:protocol,englishActions:action(),values:values('')});
    await f.store.markSending(baseScope,u.id,'sending-mark','sending');
    const peer={unitId:u.id,revision:1,values:values(''),reviewed:{},englishIntent:{[id]:{state:'active',sourceHash:S.sourceHash('Source'),decisionId:'peer'}}};
    await f.store.applyRemote(baseScope,{events:[{unit:peer}],sequence:1});
    await f.store.applyRemote(baseScope,{events:[{unit:peer}]});
    await f.store.markSending(baseScope,u.id,'sending-mark','conflict');
    assert.equal((await f.store.getSaved(baseScope))[u.id].syncRecovery.mutationId,'sending-mark');
    assert.equal((await f.store.getPendingRecovery(baseScope,u.id)).state,'conflict');
});
test('unsupported legacy intent is suspended while accepting later events and advancing the shared sequence',async()=>{
    const f=fixture(),u=unit('[DNT] Source','Original');await f.store.import(baseScope,{units:[u],assets:[asset]});
    await f.store.applyRemote(baseScope,{events:[{unit:{unitId:u.id,revision:1,values:values(''),reviewed:{},saved:true,englishIntent:{[id]:{state:'active',sourceHash:S.sourceHash(u.fields[0].source),decisionId:'legacy-unsupported'}}}}],sequence:1});
    const saved=(await f.store.getSaved(baseScope))[u.id];assert.equal(saved.englishIntent[id].state,'needs_review');assert.equal(saved.englishIntent[id].reason,'unsupported_field');
    assert.equal((await f.store.getMetadata(baseScope)).sequence,1);
    await f.store.applyRemote(baseScope,{events:[{unit:{unitId:u.id,revision:2,values:values('Literal target'),reviewed:{},saved:true}}],sequence:2});assert.equal((await f.store.getMetadata(baseScope)).sequence,2);
});
test('forms, Gender, DNT and PoE1 cannot acquire new English decisions; raw text and metadata hashes remain untouched',()=>{
    const u=unit();for(const field of [{...u.fields[0],kind:'form',form:'MS'},{...u.fields[0],kind:'gender'},{...u.fields[0],source:'[DNT] Source'},{...u.fields[0],source:'<tag>{[DNT] Source}'}])assert.equal(S.englishEligible(field),false);
    assert.throws(()=>S.applyEnglishActions(u,null,values(''),action(),'poe1-mark','poe1'),/PoE2/);
    assert.throws(()=>S.applyEnglishActions(u,null,values(''),{[id]:{...action()[id],sourceHash:'a'.repeat(64)}},'bad','poe2'),/current/);
    assert.equal(S.sourceHash('[NOAUDIO] Source'),S.sourceHash('Source'),'accepted historical source hashing remains unchanged');
});
