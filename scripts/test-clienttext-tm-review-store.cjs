'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../public/clientTextState.js'),C=require('../public/clientTextStore.js'),T=require('../public/clientTextTmState.js'),Store=require('../public/clientTextTmStore.js');
const M=require('../public/clientTextMtlState.js'),MStore=require('../public/clientTextMtlStore.js');
const {fixture,scope:shared,unit,fieldId,asset}=require('./clienttext-storage-fixture.cjs');
const scope={...shared,versionId:'local:test:tm-version',groupId:'local:test:tm-group'};
const rowKey=(scope,id)=>JSON.stringify([C.scopeKey(scope),id]);
const match=(target='Remembered {0}',id='remembered')=>({id,source:'Source {0}',target,gameScope:'poe2',context:{contentMode:'clienttext',fieldKind:'text',fieldName:'Text',role:'normal',sheet:'ClientStrings',recordId:'Earlier',fieldId},revision:4,localRevision:2,score:100,kind:'exact'});
async function prepared(rawScope=scope,changes={}){
    const f=fixture(),original=unit('Source {0}',''),blob=new Blob(['TM original bytes']),ownedAsset={...asset,blob,hash:S.sha256(await blob.arrayBuffer()),parserVersion:S.PARSER_VERSION};
    for(const name of MStore.names)if(!f.tables.has(name))f.tables.set(name,new Map());
    const metadata=await f.store.import(rawScope,{units:[original],assets:[ownedAsset],metadata:rawScope.groupId.startsWith('local:test:')?{localProtocol:'clienttext-local-v2'}:{}});
    const candidate={id:'candidate-1',unitId:original.id,fieldId,role:original.role,assetHash:ownedAsset.hash,parserVersion:S.PARSER_VERSION,source:original.fields[0].source,
        rawSourceHash:T.rawSourceHash(original.fields[0].source),baseTargetHash:T.targetHash(''),threshold:60,matches:[match()],status:'pending',revision:1,createdAt:1,...changes};
    const store=Store.create({openDb:async()=>f.db});return{...f,original,ownedAsset,metadata,candidate,tm:store};
}
async function accepted(f,rawScope=scope,text='Reviewed {0}'){
    await f.tm.putBatch(rawScope,[f.candidate]);
    const review=await f.tm.putReview(rawScope,f.original.id,fieldId,{candidateId:f.candidate.id,candidateRevision:1,rawSourceHash:f.candidate.rawSourceHash,text,matchId:f.candidate.matches[0].id,opened:true,acceptedDraft:true},{expectedRevision:null});
    const claim=T.acceptance(f.candidate,text,review.matchId);
    const draft=await f.store.putDraft(rawScope,f.original.id,{values:{[fieldId]:text},reviewed:{},tmAcceptances:[claim]},{expectedRevision:null});
    return{review,claim,draft,command:{jobId:'tm-save',values:draft.values,reviewed:{},tmAcceptances:[claim],expectedDraftRevision:draft.revision,expectedRevision:0}};
}
test('TM preparation is scoped review-only and promotes older durable workbook protocol without changing text/history/TM',async()=>{
    const f=await prepared();assert.equal(f.metadata.localProtocol,'clienttext-local-v2');
    const start=f.operations.length;assert.equal((await f.tm.putBatch(scope,[f.candidate])).length,1);const batchOperations=f.operations.slice(start);assert.equal((await f.store.getMetadata(scope)).localProtocol,'clienttext-local-v3');
    assert.deepEqual(await f.store.getSaved(scope),{});assert.equal(await f.store.getDraft(scope,f.original.id),undefined);assert.deepEqual(await f.store.listHistory(scope,f.original.id),[]);assert.equal((await f.store.getMemory(scope)).units.length,0);
    assert.equal((await f.tm.list(scope)).length,1);assert.equal((await f.tm.list({...scope,language:'German'})).length,0);
    assert.equal((await f.tm.putBatch(scope,[{...f.candidate,id:'candidate-2'}])).length,0,'a pending review is not overwritten');
    const scans=batchOperations.filter(op=>op.name===Store.stores.candidates&&op.method==='index.getAll');
    assert.ok(scans.every(op=>op.arg===JSON.stringify([C.scopeKey(scope),f.original.id])),'only selected ID candidate reads are used');
});
test('batch insertion rechecks blank saved text, durable drafts, original source and captured scope',async()=>{
    for(const mode of ['saved','draft','source','guard']){
        const f=await prepared();
        if(mode==='saved')await f.store.save(scope,f.original.id,{jobId:'before',values:{[fieldId]:'Existing {0}'}});
        if(mode==='draft')await f.store.putDraft(scope,f.original.id,{values:{[fieldId]:'Draft {0}'}},{expectedRevision:null});
        if(mode==='source')f.candidate.source='Other {0}',f.candidate.rawSourceHash=T.rawSourceHash(f.candidate.source);
        if(mode==='source'||mode==='guard')await assert.rejects(f.tm.putBatch(scope,[f.candidate],mode==='guard'?{guard:()=>false}:{}));
        else assert.equal((await f.tm.putBatch(scope,[f.candidate])).length,0);
        assert.equal((await f.tm.list(scope)).length,0,mode);
    }
});
test('candidate write failures roll back the whole batch and protocol promotion; oversized batches are rejected',async()=>{
    const f=await prepared();f.fail(Store.stores.candidates);
    await assert.rejects(f.tm.putBatch(scope,[f.candidate]),/Injected/);assert.equal((await f.tm.list(scope)).length,0);assert.equal((await f.store.getMetadata(scope)).localProtocol,'clienttext-local-v2');
    f.fail(null);await assert.rejects(f.tm.putBatch(scope,Array.from({length:129},(_,index)=>({...f.candidate,id:'candidate-'+index}))),/at most 128/);
    assert.equal((await f.tm.list(scope)).length,0);
});
test('batch writes atomically skip peer MTL candidates and pending journals using selected-unit index reads',async()=>{
    for(const mode of ['candidate','pending','uncertain','completed','old-source','other-account']){
        const f=await prepared(shared),native=f.db.transaction;let inserted=false;
        const evidence={unitId:f.original.id,fieldId,assetHash:f.ownedAsset.hash,parserVersion:S.PARSER_VERSION,
            rawSourceHash:M.rawSourceHash(f.original.fields[0].source),status:mode==='completed'?'completed':mode==='uncertain'?'uncertain':'pending',
            ...(mode==='candidate'||mode==='old-source'||mode==='other-account'?{}:{kind:'generation'})};
        if(mode==='old-source')evidence.rawSourceHash=M.rawSourceHash('Old source');
        const owner=mode==='other-account'?{...shared,accountId:'peer-other'}:shared,bucket=C.scopeKey(owner),table=evidence.kind?MStore.stores.meta:MStore.stores.candidates;
        f.db.transaction=(names,mode,...args)=>{
            if(mode==='readwrite'&&names.includes(Store.stores.candidates)&&!inserted){inserted=true;f.tables.get(table).set(JSON.stringify([bucket,'peer-work']),{key:JSON.stringify([bucket,'peer-work']),scope:bucket,value:evidence});}
            return native.call(f.db,names,mode,...args);
        };
        const start=f.operations.length,added=await f.tm.putBatch(shared,[f.candidate]);
        assert.equal(added.length,['candidate','pending','uncertain'].includes(mode)?0:1,mode);
        const reads=f.operations.slice(start).filter(operation=>[MStore.stores.meta,MStore.stores.candidates].includes(operation.name)&&operation.method==='index.getAll');
        assert.equal(reads.length,2);assert.ok(reads.every(operation=>JSON.stringify(operation.arg)===JSON.stringify([C.scopeKey(shared),f.original.id])));
    }
});
test('new MTL admission atomically checks pending TM reviews while existing journal updates remain available',async()=>{
    const f=await prepared(shared),mtl=MStore.create({openDb:async()=>f.db});await f.tm.putBatch(shared,[f.candidate]);
    const generation={requestId:'new-machine-request',unitId:f.original.id,fieldId,assetHash:f.ownedAsset.hash,parserVersion:S.PARSER_VERSION,
        rawSourceHash:M.rawSourceHash(f.original.fields[0].source),sourceHash:S.sourceHash(f.original.fields[0].source),baseTargetHash:S.hash(''),createdAt:1,status:'pending'};
    await assert.rejects(mtl.putGeneration(shared,generation),{code:'TM_REVIEW_PENDING'});assert.equal(await mtl.getGeneration(shared,generation.requestId),undefined);
    const old={...generation,requestId:'already-admitted'};f.tables.get(MStore.stores.meta).set(JSON.stringify([C.scopeKey(shared),JSON.stringify(['generation',old.requestId])]),{key:JSON.stringify([C.scopeKey(shared),JSON.stringify(['generation',old.requestId])]),scope:C.scopeKey(shared),value:{...old,kind:'generation'}});
    assert.equal((await mtl.putGeneration(shared,{requestId:old.requestId,status:'uncertain'})).status,'uncertain');
    assert.equal((await mtl.putGeneration(shared,{requestId:old.requestId,status:'completed'})).status,'completed');
    assert.equal((await mtl.putGeneration({...shared,accountId:'different-account'},generation)).status,'pending');
});
test('TM reviews have revision CAS and revalidation retains edits while requiring a new match choice',async()=>{
    const f=await prepared();await f.tm.putBatch(scope,[f.candidate]);
    const input={candidateId:f.candidate.id,candidateRevision:1,rawSourceHash:f.candidate.rawSourceHash,text:'My edited {0}',matchId:'remembered',opened:true,dirty:true};
    const first=await f.tm.putReview(scope,f.original.id,fieldId,input,{expectedRevision:null});
    await assert.rejects(f.tm.putReview(scope,f.original.id,fieldId,input,{expectedRevision:null}),{code:'TM_REVIEW_CHANGED'});
    const next=await f.tm.revalidate(scope,{...f.candidate,revision:2,matches:[match('Corrected {0}')]},{expectedRevision:1});
    assert.equal(next.revision,2);const restored=await f.tm.getReview(scope,f.original.id,fieldId);assert.equal(restored.text,first.text);assert.equal(restored.matchId,null);assert.equal(restored.candidateRevision,2);assert.equal(restored.acceptedDraft,false);
    assert.equal((await f.tm.listReviews(scope,f.original.id)).length,1);
});
test('an interrupted Accept review marker without an accepted draft can be revalidated after reload',async()=>{
    const f=await prepared();await f.tm.putBatch(scope,[f.candidate]);
    await f.tm.putReview(scope,f.original.id,fieldId,{candidateId:f.candidate.id,candidateRevision:1,rawSourceHash:f.candidate.rawSourceHash,text:'Uncheckpointed acceptance {0}',matchId:'remembered',opened:true,acceptedDraft:true},{expectedRevision:null});
    assert.equal(await f.store.getDraft(scope,f.original.id),undefined);
    assert.equal((await f.tm.revalidate(scope,{...f.candidate,revision:2},{expectedRevision:1})).revision,2);
    assert.equal((await f.tm.getReview(scope,f.original.id,fieldId)).acceptedDraft,false);
});
test('rejected authored reviews are retained separately with idempotent recovery IDs and monotonic edit revisions',async()=>{
    const f=await prepared();await f.tm.putBatch(scope,[f.candidate]);
    const review={candidateId:f.candidate.id,candidateRevision:1,rawSourceHash:f.candidate.rawSourceHash,text:'Peer review {0}',matchId:'remembered',opened:true};
    await f.tm.putReview(scope,f.original.id,fieldId,review,{expectedRevision:null});
    const mine={...review,text:'My retained review {0}',dirty:true};
    await assert.rejects(f.tm.putReview(scope,f.original.id,fieldId,mine,{expectedRevision:null}),{code:'TM_REVIEW_CHANGED'});
    const options={recoveryId:'same-rejected-buffer',editRevision:1};
    const first=await f.tm.putRecovery(scope,f.original.id,fieldId,mine,options);
    assert.deepEqual(await f.tm.putRecovery(scope,f.original.id,fieldId,mine,options),first);
    await assert.rejects(f.tm.putRecovery(scope,f.original.id,fieldId,{...mine,text:'Different body {0}'},options),{code:'TM_RECOVERY_MISMATCH'});
    const latest=await f.tm.putRecovery(scope,f.original.id,fieldId,{...mine,text:'Latest retained {0}'},{...options,editRevision:2});
    assert.equal((await f.tm.putRecovery(scope,f.original.id,fieldId,mine,options)).text,latest.text);
    assert.equal((await f.tm.getReview(scope,f.original.id,fieldId)).text,review.text);assert.equal((await f.tm.listReviews(scope,f.original.id)).length,1);
    assert.equal((await f.tm.listRecoveries(scope,f.original.id)).length,1);
    await f.tm.dismiss(scope,f.candidate);assert.equal((await f.tm.listRecoveries(scope,f.original.id))[0].text,'Latest retained {0}');
});
test('Accept claims resolve with Save/history/TM/receipt atomically and exact retries preserve newer drafts',async()=>{
    const f=await prepared(),{command,claim}=await accepted(f);
    const result=await f.store.save(scope,f.original.id,command);
    assert.equal(result.saved.values[fieldId],'Reviewed {0}');assert.deepEqual(result.saved.tmAcceptances,[claim]);assert.equal((await f.tm.get(scope,f.candidate.id)).status,'accepted');
    const commit=f.commits.find(writes=>writes.some(write=>write.name===C.stores.receipts));
    for(const name of [C.stores.saved,C.stores.history,C.stores.receipts,C.stores.memory,Store.stores.candidates,Store.stores.reviews])assert.ok(commit.some(write=>write.name===name),name);
    await f.store.putDraft(scope,f.original.id,{values:{[fieldId]:'New typing {0}'}},{expectedRevision:null});
    assert.equal((await f.store.save(scope,f.original.id,command)).replayed,true);assert.equal((await f.store.getDraft(scope,f.original.id)).values[fieldId],'New typing {0}');assert.equal((await f.store.listHistory(scope,f.original.id)).length,1);
});
test('failed Save leaves the accepted draft, review, candidate and receipt unchanged for retry',async()=>{
    const f=await prepared(),{command,draft}=await accepted(f);f.fail(C.stores.history);
    await assert.rejects(f.store.save(scope,f.original.id,command),/Injected/);assert.deepEqual(await f.store.getSaved(scope),{});assert.deepEqual(await f.store.getDraft(scope,f.original.id),draft);
    assert.equal((await f.tm.get(scope,f.candidate.id)).status,'pending');assert.equal((await f.tm.getReview(scope,f.original.id,fieldId)).acceptedDraft,true);assert.equal(f.tables.get(C.stores.receipts).size,0);
    f.fail(null);assert.equal((await f.store.save(scope,f.original.id,command)).saved.values[fieldId],'Reviewed {0}');
});
test('shared Save carries accepted text but never sends private TM review claims or candidate packages',async()=>{
    const f=await prepared(shared),{command}=await accepted(f,shared);await f.store.save(shared,f.original.id,command);
    const outbox=await f.store.getOutbox(shared);assert.equal(outbox.length,1);assert.equal(outbox[0].values[fieldId],'Reviewed {0}');assert.equal(outbox[0].tmAcceptances,undefined);assert.equal(outbox[0].matches,undefined);assert.equal(outbox[0].candidateId,undefined);
});
test('dismiss is local and retained review text survives; tied alternatives cannot be accepted without a choice',async()=>{
    const f=await prepared(scope,{matches:[match('First {0}','one'),match('Second {0}','two')]});await f.tm.putBatch(scope,[f.candidate]);
    assert.throws(()=>T.acceptance(f.candidate,'Edited {0}',null));
    await f.tm.putReview(scope,f.original.id,fieldId,{candidateId:f.candidate.id,candidateRevision:1,rawSourceHash:f.candidate.rawSourceHash,text:'Retain review {0}',matchId:null,opened:true},{expectedRevision:null});
    assert.equal((await f.tm.dismiss(scope,f.candidate)).status,'dismissed');assert.equal((await f.tm.getReview(scope,f.original.id,fieldId)).text,'Retain review {0}');assert.deepEqual(await f.store.getSaved(scope),{});
    assert.equal((await f.tm.dismiss(scope,f.candidate)).status,'dismissed');
});
test('TM validation preserves raw workbook literals but blocks protected token differences and changed live matches',()=>{
    const field=unit('Literal @ \\n {0}','').fields[0];assert.equal(T.validate(field,'Raw @ \\n {0}').valid,true);assert.equal(T.validate(field,'Wrong {1}').valid,false);
    assert.equal(T.eligible({...field,source:'lowercase dnt instructions'}),false);assert.equal(T.eligible({...field,kind:'gender'}),false);
    const frozen=T.normalizeMatch(match());assert.equal(T.matchCurrent(frozen,[frozen]),true);assert.equal(T.matchCurrent(frozen,[{...frozen,target:'Changed {0}'}]),false);assert.equal(T.matchCurrent(frozen,[{...frozen,deleted:true}]),false);
});
test('colliding private and shared TM IDs become stable explicit choices with independent evidence checks',async()=>{
    const first=match('Private source target {0}','ct-shared-id'),second={...match('Shared source target {0}','ct-shared-id'),source:'[NOAUDIO] Source {0}'};
    const f=await prepared(scope,{matches:[first,second]}),normalized=T.normalizeCandidate(f.candidate);
    assert.notEqual(normalized.matches[0].id,normalized.matches[1].id);assert.ok(normalized.matches.every(value=>value.tmId==='ct-shared-id'&&value.id.startsWith('tm-choice-')));
    assert.deepEqual(T.normalizeCandidate(normalized),normalized,'backup/reload normalization preserves choice IDs');
    for(const choice of normalized.matches){assert.equal(T.matchCurrent(choice,[second,first]),true);assert.equal(T.matchCurrent(choice,[first,second]),true);assert.equal(T.acceptance(normalized,choice.target,choice.id).matchId,choice.id);}
    assert.equal(T.matchCurrent(normalized.matches[0],[second]),false);assert.equal(T.matchCurrent(normalized.matches[1],[first]),false);
    assert.throws(()=>T.normalizeCandidate({...f.candidate,matches:[first,first]}),/duplicate/);
    assert.throws(()=>T.normalizeCandidate({...normalized,matches:[{...normalized.matches[0],id:'tm-choice-forged'},normalized.matches[1]]}),/choice identity/);
    const stored=(await f.tm.putBatch(scope,[f.candidate]))[0];assert.deepEqual(stored.matches,normalized.matches);
    const chosen=stored.matches[1],review=await f.tm.putReview(scope,f.original.id,fieldId,{candidateId:stored.id,candidateRevision:stored.revision,rawSourceHash:stored.rawSourceHash,text:chosen.target,matchId:chosen.id,opened:true,acceptedDraft:true},{expectedRevision:null});
    const claim=T.acceptance(stored,chosen.target,review.matchId);const result=await f.store.save(scope,f.original.id,{jobId:'collision-choice',values:{[fieldId]:chosen.target},tmAcceptances:[claim]});
    assert.equal(result.saved.values[fieldId],chosen.target);assert.equal(result.saved.tmAcceptances[0].matchId,chosen.id);
});

function localRuntime(f){
    const held=new Map(),locks={async request(name,options,callback){if(held.has(name))return callback(null);held.set(name,true);try{return await callback({name});}finally{held.delete(name);}}};
    const window={ClientTextStore:{...C,create:()=>f.store},ClientTextState:S,ClientTextTmState:T,ClientTextTmStore:{...Store,create:()=>f.tm},ClientTextMtlStore:{create:()=>({})},OfflineStore:{openClientTextDb:async()=>f.db},navigator:{locks},crypto:require('node:crypto').webcrypto};
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/clientTextLocalStore.js'),'utf8'),{window,Blob,ArrayBuffer,console});
    return{window,local:window.ClientTextLocalStore.create()};
}
test('v3 recovery restores review text into fresh scopes with accepted claims inert',async()=>{
    const f=await prepared(),{claim,draft}=await accepted(f),{window,local}=localRuntime(f);await local.acquire(scope);
    await f.tm.putRecovery(scope,f.original.id,fieldId,{candidateId:f.candidate.id,candidateRevision:1,rawSourceHash:f.candidate.rawSourceHash,text:'Rejected review {0}',matchId:'remembered',dirty:true},{recoveryId:'retained',editRevision:1});
    const files=new Map();window.JSZip=class{file(name,value){files.set(name,value);}async generateAsync(){return new Blob(['zip']);}};
    await local.backup(scope);const manifest=JSON.parse(files.get('local-workbook.json'));assert.equal(manifest.protocol,'clienttext-local-v3');assert.equal(manifest.workspaces[0].rows.tmCandidates.length,1);assert.equal(manifest.workspaces[0].rows.tmReviews.length,2);
    const bytes=await f.ownedAsset.blob.arrayBuffer();window.JSZip={loadAsync:async()=>({file:name=>({async:async()=>name==='local-workbook.json'?JSON.stringify(manifest):bytes})})};
    const next=await local.restore(new Blob(['zip']),{accountId:'restored',game:'poe2',branchId:'default'},{parseWorkbook:async()=>({units:[f.original],artifactHash:f.ownedAsset.hash,parserVersion:S.PARSER_VERSION})});
    assert.notEqual(C.scopeKey(next),C.scopeKey(scope));const restored=await local.getDraft(next,f.original.id);assert.equal(restored.values[fieldId],draft.values[fieldId]);assert.equal(restored.tmAcceptances,undefined);assert.deepEqual(restored.restoredTmAcceptances,[claim]);
    const review=await f.tm.getReview(next,f.original.id,fieldId);assert.equal(review.text,'Reviewed {0}');assert.equal(review.acceptedDraft,false);assert.equal(review.matchId,null);assert.equal((await f.tm.get(next,f.candidate.id)).restored,true);
    const recovered=(await f.tm.listRecoveries(next,f.original.id))[0];assert.equal(recovered.text,'Rejected review {0}');assert.equal(recovered.signature,manifest.workspaces[0].rows.tmReviews.find(value=>value.recoveryId).signature);
    const proposal=await f.tm.get(next,f.candidate.id);assert.throws(()=>T.acceptance(proposal,review.text,proposal.matches[0].id),{code:'TM_CANDIDATE_CHANGED'});
    const renewed=await f.tm.revalidate(next,{...proposal,revision:proposal.revision+1},{expectedRevision:proposal.revision});
    assert.equal(renewed.restored,undefined);const renewedReview=await f.tm.getReview(next,f.original.id,fieldId);assert.equal(renewedReview.restored,false);assert.equal(renewedReview.text,review.text);assert.equal(renewedReview.matchId,null);
    assert.equal(T.acceptance(renewed,renewedReview.text,renewed.matches[0].id).candidateRevision,renewed.revision);
    local.releaseExcept();
});
