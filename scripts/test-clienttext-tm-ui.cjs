'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../public/clientTextState.js'),T=require('../public/clientTextTmState.js'),TM=require('../public/translationMemory.js');
const UI=require('../public/clientTextTmUi.js');
const {scope:baseScope,unit:makeUnit}=require('./clienttext-storage-fixture.cjs');
const copy=value=>structuredClone(value),settle=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const key=(unitId,fieldId)=>JSON.stringify([unitId,fieldId]);
function unit(record,source='Sword',target=''){
    const value=makeUnit(source,target);value.recordId=record;value.id=JSON.stringify([value.role,value.sheet,record]);return value;
}
function memory(original,target='Epée',id='memory-'+original.recordId){
    const field=original.fields[0];return TM.normalizeUnit({id,source:field.source,target,gameScope:'poe2',revision:1,localRevision:2,
        context:{contentMode:'clienttext',filepath:original.sheet,role:original.role,sheet:original.sheet,recordId:original.recordId,
            fieldId:field.id,fieldName:field.name,fieldKind:field.kind,...(field.form?{form:field.form}:{})}});
}
function harness(units=[unit('first')],overrides={}){
    const scope={...baseScope,game:'poe2',accountId:'alice'},descriptor={role:'normal',assetHash:'a'.repeat(64),parserVersion:S.PARSER_VERSION};
    const reviews=new Map(),candidates=new Map(),drafts=new Map(),recoveries=new Map(),calls={batches:[],review:[],reviewScopes:[],edited:0,metadata:0};
    const store={
        async list(){return[...candidates.values()].map(copy);},async get(scope,id){return copy(candidates.get(id));},
        async listReviews(scope,unitId){return[...reviews.values()].filter(review=>!unitId||review.unitId===unitId).map(copy);},
        async getReview(scope,unitId,fieldId){return copy(reviews.get(key(unitId,fieldId)));},
        async putBatch(scope,input,options){assert.equal(options.guard(),true);calls.batches.push(copy(input));for(const value of input)candidates.set(value.id,copy(value));return copy(input);},
        async putReview(scope,unitId,fieldId,input,options){assert.equal(options.guard(),true);const id=key(unitId,fieldId),before=reviews.get(id);
            if((before?.revision || null)!==options.expectedRevision)throw Object.assign(Error('Peer review changed'),{code:'TM_REVIEW_CHANGED'});
            const saved={...copy(input),unitId,fieldId,revision:(before?.revision||0)+1};reviews.set(id,saved);calls.review.push(saved);calls.reviewScopes.push(copy(scope));return copy(saved);},
        async putRecovery(scope,unitId,fieldId,input,options){assert.equal(options.guard(),true);const value={...copy(input),unitId,fieldId,recoveryId:options.recoveryId,
            reason:'review-conflict',editRevision:options.editRevision,updatedAt:Date.now()};recoveries.set(value.recoveryId,value);return copy(value);},
        async listRecoveries(scope,unitId){return[...recoveries.values()].filter(value=>value.unitId===unitId).map(copy);},
        async dismiss(scope,input,options){assert.equal(options.guard(),true);const next={...copy(input),status:'dismissed',revision:input.revision+1};candidates.set(next.id,next);return next;},
        async revalidate(scope,input,options){assert.equal(options.guard(),true);assert.equal(candidates.get(input.id).revision,options.expectedRevision);const next=copy(input);delete next.restored;candidates.set(next.id,next);
            const id=key(input.unitId,input.fieldId),review=reviews.get(id);if(review)reviews.set(id,{...review,candidateRevision:input.revision,revision:review.revision+1,matchId:null,acceptedDraft:false,restored:false});return copy(next);},
    };
    const app={...UI.mixin.data(),ctActive:true,ctWorkspace:{scope,metadata:{descriptors:[descriptor]}},cloudProfileId:'alice',gameVersion:'poe2',lang:scope.language,
        cloudSignedIn:true,cloudUser:{id:'alice',role:'translator',language:scope.language},ctUnits:units,ctSaved:{},ctRows:units,ctPageRows:units.slice(0,2),
        ctSelection:units[0]?.id,ctValues:units[0]?S.valuesFor(units[0]):{},ctReviewed:{},ctDraftDirty:false,ctBusy:false,ctBrowseBusy:false,ctRecoveryBusy:false,
        ctMtlCandidates:[],ctChoices:[],ctHistoryViewer:false,tmThreshold:60,ctMemory:units.map(value=>memory(value)),
        _ctUnitIndex:new Map(units.map(value=>[value.id,value])),
        ctContext(){return{scope:copy(this.ctWorkspace.scope),epoch:this._epoch || 0};},
        ctCurrent(ctx){return JSON.stringify(ctx.scope)===JSON.stringify(this.ctWorkspace.scope)&&ctx.epoch===(this._epoch || 0);},
        ctStorage(){return{tm:store,getMetadata:async()=>{calls.metadata++;return{descriptors:[descriptor]};},getDraft:async(scope,id)=>copy(drafts.get(id))};},
        ctFlushDraft:async()=>true,ctEdited(){calls.edited++;this.ctDraftDirty=true;},ctMtlBusy:()=>false,ctMtlAccepted:()=>false,ctMtlPendingCandidate:()=>null,
        ...overrides};
    for(const[name,method]of Object.entries(UI.mixin.methods))app[name]=method.bind(app);
    for(const[name,getter]of Object.entries(UI.mixin.computed))Object.defineProperty(app,name,{get:()=>getter.call(app)});
    Object.defineProperty(app,'ctCurrentUnit',{get:()=>app._ctUnitIndex.get(app.ctSelection)});
    app.ctTmLoadedScopeKey=app.ctTmWorkspaceScopeKey;
    function addCandidate(original=units[0],matches=[memory(original)],changes={}){
        const field=original.fields[0],value=T.normalizeCandidate({id:'candidate-'+original.recordId,unitId:original.id,fieldId:field.id,role:original.role,
            assetHash:descriptor.assetHash,parserVersion:descriptor.parserVersion,source:field.source,rawSourceHash:T.rawSourceHash(field.source),
            baseTargetHash:T.targetHash(''),threshold:60,matches:matches.map(value=>({...value,score:101,kind:'context'})),status:'pending',revision:1,createdAt:1,...changes});
        candidates.set(value.id,copy(value));app.ctTmCandidates=[...app.ctTmCandidates,value];return value;
    }
    return{app,store,calls,reviews,candidates,drafts,recoveries,scope,descriptor,units,addCandidate};
}

test('row checkbox, range, page and all-filtered selection preserve IDs across pages',()=>{
    const {app,units}=harness([unit('a'),unit('b'),unit('c'),unit('d')]);
    app.ctTmToggleRow(units[0],{target:{checked:true}});app.ctTmToggleRow(units[2],{shiftKey:true,target:{checked:true}});
    assert.deepEqual(app.ctTmSelectedIds,units.slice(0,3).map(value=>value.id));assert.equal(app.ctTmPageSelection,'all');
    app.ctPageRows=units.slice(2);assert.equal(app.ctTmPageSelection,'some');app.ctTmSelectPage({target:{checked:true}});assert.equal(app.ctTmSelectedCount,4);
    app.ctTmSelectPage({target:{checked:false}});assert.deepEqual(app.ctTmSelectedIds,units.slice(0,2).map(value=>value.id));
    app.ctTmSelectAllFiltered();assert.equal(app.ctTmSelectedCount,4);UI.mixin.watch.ctTmSelectionScopeKey.call(app);assert.equal(app.ctTmSelectedCount,0);
});

test('preparation uses current percentage and creates only private candidates, leaving translations and drafts unchanged',async()=>{
    const {app,units,calls}=harness([unit('a'),unit('b')]);app.ctTmSelectAllFiltered();
    const before=copy([app.ctValues,app.ctSaved,units]);assert.equal(await app.ctTmPrepareSelected(),true);
    assert.equal(app.ctTmCandidates.length,2);assert.equal(app.ctTmProgress.prepared,2);assert.equal(app.ctTmProgress.processed,2);
    assert.ok(calls.batches.every(batch=>batch.length<=64));assert.ok(app.ctTmCandidates.every(value=>value.threshold===app.tmThreshold));
    assert.deepEqual([app.ctValues,app.ctSaved,units],before);assert.equal(calls.edited,0);
});

test('batch eligibility excludes populated originals/drafts, DNT/audio/gender, active English and existing machine review',async()=>{
    const values=[unit('good'),unit('original','Shield','Already translated'),unit('draft'),unit('dnt','DNT no'),unit('audio','[NOAUDIO]'),unit('gender')];
    values.at(-1).fields[0].kind='gender';const {app,drafts}=harness(values);drafts.set(values[2].id,{values:{[values[2].fields[0].id]:'Private draft'}});
    app.ctMtlCandidates=[{id:'mtl',status:'pending',unitId:values[0].id,fieldId:values[0].fields[0].id}];app.ctTmSelectAllFiltered();
    await app.ctTmPrepareSelected();assert.equal(app.ctTmCandidates.length,0);
    app.ctMtlCandidates=[];await app.ctTmPrepareSelected();assert.deepEqual(app.ctTmCandidates.map(value=>value.unitId),[values[0].id]);
    const english=unit('english'),field=english.fields[0];app.ctSaved[english.id]={values:{[field.id]:''},englishIntent:{[field.id]:{state:'active',sourceHash:S.sourceHash(field.source),decisionId:'use'}},reviewed:{}};
    assert.equal(app.ctTmFieldEligible(english,field),false);
});

test('review edits remain separate; Accept creates a draft, Undo restores blank, and Dismiss leaves workbook work intact',async()=>{
    const h=harness(),{app,calls,units,reviews}=h,candidate=h.addCandidate(),field=units[0].fields[0];
    assert.equal(app.ctTmFieldValue(field),candidate.matches[0].target);assert.equal(app.ctValues[field.id],'');
    assert.equal(app.ctTmEdited(field,'Reviewed sword'),true);await settle();await app._ctTmReviewQueues.get(key(units[0].id,field.id)).queue;
    assert.equal(reviews.get(key(units[0].id,field.id)).text,'Reviewed sword');assert.equal(calls.edited,0);
    assert.equal(await app.ctTmAccept(field),true);assert.equal(app.ctValues[field.id],'Reviewed sword');assert.equal(app.ctTmAccepted(field),true);
    assert.equal(app.ctTmAcceptances()[0].matchId,candidate.matches[0].id);assert.equal(app.ctTmCheckpointAcceptances()[0].reviewedTextHash,S.hash('Reviewed sword'));
    assert.equal(await app.ctTmUndoAccept(field),true);assert.equal(app.ctValues[field.id],'');assert.equal(app.ctTmAccepted(field),false);
    assert.equal(app.ctTmFieldValue(field),'Reviewed sword');assert.equal(await app.ctTmDismiss(field),true);assert.equal(app.ctValues[field.id],'');
    assert.equal(app.ctTmPendingCandidate(field),null);assert.equal(app.ctTmCount,0);
});

test('different top translations require explicit choice while edited review text survives changing the choice',async()=>{
    const h=harness(),{app,units}=h,first=memory(units[0],'One','one'),second=memory(units[0],'Two','two');app.ctMemory=[first,second];h.addCandidate(units[0],[first,second]);
    const field=units[0].fields[0];assert.equal(app.ctTmFieldValue(field),'');assert.equal(await app.ctTmAccept(field),false);assert.match(app.ctTmError,/Choose/);
    await app.ctTmChooseMatch(field,'one');assert.equal(app.ctTmFieldValue(field),'One');app.ctTmEdited(field,'My review');await settle();
    await app.ctTmChooseMatch(field,'two');assert.equal(app.ctTmFieldValue(field),'My review');assert.equal(await app.ctTmAccept(field),true);assert.equal(app.ctTmAcceptances()[0].matchId,'two');
});

test('invalid controls and overflow alternatives cannot be accepted',async()=>{
    const h=harness([unit('variables','Value {0}')]),{app,units}=h;h.addCandidate();const field=units[0].fields[0];
    app.ctTmEdited(field,'Missing variable');await settle();assert.equal(await app.ctTmAccept(field),false);assert.equal(app.ctValues[field.id],'');
    app.ctTmEdited(field,'Value {0}');await settle();app.ctTmCandidates=[{...app.ctTmCandidates[0],overflow:true}];
    assert.equal(await app.ctTmAccept(field),false);assert.match(app.ctTmError,/Too many/);
});

test('a changed or deleted TM entry blocks Accept but revalidation preserves authored review text',async()=>{
    const h=harness(),{app,units}=h;h.addCandidate();const field=units[0].fields[0];app.ctTmEdited(field,'Authored review');await settle();
    await app._ctTmReviewQueues.get(key(units[0].id,field.id)).queue;app.ctMemory=[{...app.ctMemory[0],target:'New remembered text',localRevision:3}];
    assert.equal(await app.ctTmAccept(field),false);assert.equal(app.ctTmFieldValue(field),'Authored review');assert.equal(app.ctTmReviewController(field).stale,true);
    assert.equal(await app.ctTmRevalidate(field),true);assert.equal(app.ctTmFieldValue(field),'Authored review');assert.equal(app.ctTmPendingCandidate(field).revision,2);
    assert.equal(await app.ctTmAccept(field),true);assert.equal(app.ctValues[field.id],'Authored review');
});

test('late durable review acknowledgement cannot accept into another field, account or changed draft',async()=>{
    for(const change of [app=>{app.ctValues[app.ctCurrentUnit.fields[0].id]='Later manual draft';},app=>{app.cloudProfileId='other';},app=>{app._epoch=1;}]){
        const h=harness(),{app,store,units}=h;h.addCandidate();const field=units[0].fields[0],held=deferred(),write=store.putReview;
        store.putReview=async(...args)=>{await held.promise;return write(...args);};const pending=app.ctTmAccept(field);await settle();change(app);held.resolve();
        assert.equal(await pending,false);assert.equal(app._ctTmClaims?.[units[0].id]?.length || 0,0);assert.notEqual(app.ctValues[field.id],'Epée');
    }
});

test('draft restoration restores only matching acceptance claims and ordinary saved refresh uses point candidate reads',async()=>{
    const h=harness(),{app,units,candidates}=h,candidate=h.addCandidate(),field=units[0].fields[0];await app.ctTmAccept(field);
    const claims=app.ctTmCheckpointAcceptances();app._ctTmClaims={};app.ctTmRestoreAcceptances({tmAcceptances:claims});assert.equal(app.ctTmAccepted(field),true);
    app.ctTmRestoreAcceptances({tmAcceptances:[{...claims[0],reviewedTextHash:S.hash('Wrong')} ]});assert.equal(app.ctTmAccepted(field),false);
    app.ctTmRestoreAcceptances({tmAcceptances:claims});candidates.set(candidate.id,{...candidate,status:'accepted',revision:2});
    await app.ctTmSaved(app.ctContext(),units[0].id);assert.equal(app.ctTmCount,0);assert.equal(app._ctTmClaims[units[0].id],undefined);
});

test('Stop retains completed suggestions even before a full durable batch and a changed workspace cannot publish into its replacement',async()=>{
    const h=harness([unit('a'),unit('b'),unit('c')]),{app,units,candidates}=h,normal=app.ctStorage;
    app.ctStorage=scope=>({...normal(scope),getDraft:async(scope,id)=>{if(id===units[1].id)app.ctTmStop();return null;}});
    app.ctTmSelectAllFiltered();assert.equal(await app.ctTmPrepareSelected(),false);assert.equal(app.ctTmProgress.stopped,true);
    assert.equal(app.ctTmProgress.prepared,1);assert.equal(candidates.size,1);assert.equal(app.ctTmCandidates[0].unitId,units[0].id);
    app.lang='German';assert.equal(app.ctTmPendingCandidate(units[0].fields[0]),null);assert.equal(app.ctTmCount,0);
    app.ctTmReset();assert.equal(candidates.size,1,'scope changes retain durable old-scope suggestions');
});

test('Stop during an admitted native write drains its completed suggestions instead of rolling them back',async()=>{
    const h=harness(),{app,store,candidates}=h,started=deferred(),release=deferred(),write=store.putBatch;
    store.putBatch=async(...args)=>{started.resolve();await release.promise;return write(...args);};app.ctTmSelectAllFiltered();
    const preparing=app.ctTmPrepareSelected();await started.promise;app.ctTmStop();release.resolve();await preparing;
    assert.equal(candidates.size,1);assert.equal(app.ctTmCandidates.length,1);assert.equal(app.ctTmProgress.prepared,1);assert.equal(app.ctTmProgress.stopped,true);
});

test('preparation stops after a scope change while committed earlier batches remain recoverable',async()=>{
    const h=harness(Array.from({length:67},(_,index)=>unit('row'+index,'English '+index))),{app,candidates,units,calls}=h,normal=app.ctStorage;
    app.ctStorage=scope=>({...normal(scope),getDraft:async(scope,id)=>{if(id===units[65].id)app._epoch=1;return null;}});
    app.ctTmSelectAllFiltered();assert.equal(await app.ctTmPrepareSelected(),false);
    assert.equal(candidates.size,64);assert.deepEqual(calls.batches.map(batch=>batch.length),[64]);assert.equal(app.ctTmCount,0);
});

test('queued review text drains into its captured scope after a forced switch without updating the new scope UI',async()=>{
    const h=harness(),{app,store,calls,reviews,units}=h;h.addCandidate();const field=units[0].fields[0],held=deferred(),write=store.putReview;
    store.putReview=async(...args)=>{await held.promise;return write(...args);};app.ctTmEdited(field,'Outgoing private review');
    const queue=app._ctTmReviewQueues.get(key(units[0].id,field.id)).queue,flushing=app.ctTmFlushReviews();
    app._epoch=1;app.cloudProfileId='bob';app.ctWorkspace={scope:{...app.ctWorkspace.scope,accountId:'bob'}};app.ctTmReset();held.resolve();await queue;
    assert.equal(await flushing,true,'the captured checkpoint reports its durable result even after the UI scope changes');
    assert.equal(calls.reviewScopes[0].accountId,'alice');assert.equal(reviews.get(key(units[0].id,field.id)).text,'Outgoing private review');
    assert.deepEqual(app.ctTmReviews,{});assert.equal(app.ctTmError,'');assert.equal(app.ctTmCandidates.length,0);
});

test('review flush also waits for a second edit queued while its first checkpoint is pending',async()=>{
    const h=harness(),{app,store,reviews,units}=h;h.addCandidate();const field=units[0].fields[0],held=deferred(),write=store.putReview;
    store.putReview=async(...args)=>{await held.promise;return write(...args);};
    app.ctTmEdited(field,'First review edit');const flushing=app.ctTmFlushReviews();await settle();app.ctTmEdited(field,'Latest review edit');held.resolve();
    assert.equal(await flushing,true);assert.equal(reviews.get(key(units[0].id,field.id)).text,'Latest review edit');
});

test('CAS failure retains authored review durably and explicit recovery preserves the peer review',async()=>{
    const h=harness(),{app,reviews,recoveries,units}=h;h.addCandidate();const field=units[0].fields[0],id=key(units[0].id,field.id);
    app.ctTmEdited(field,'First edit');assert.equal(await app.ctTmFlushReviews(),true);
    reviews.set(id,{...reviews.get(id),text:'Peer revision',revision:2});app.ctTmEdited(field,'My retained revision');
    assert.equal(await app.ctTmFlushReviews(),false);assert.equal(app.ctTmFieldValue(field),'My retained revision');assert.equal(app.ctValues[field.id],'');
    assert.equal(recoveries.size,1);assert.equal(app.ctTmReviewController(field).recover instanceof Function,true);
    assert.equal(await app.ctTmRecoverReview(field),true);assert.equal(await app.ctTmFlushReviews(),true);
    assert.equal(reviews.get(id).text,'My retained revision');assert.ok([...recoveries.values()].some(value=>value.text==='Peer revision'));
});

test('Undo accept checkpoints an ordinary blank draft with claims removed instead of editing the review buffer',async()=>{
    const h=harness(),{app,units}=h;h.addCandidate();const field=units[0].fields[0],checkpoints=[];
    app.ctQueueDraft=()=>checkpoints.push({values:copy(app.ctValues),reviewed:copy(app.ctReviewed),tmAcceptances:app.ctTmCheckpointAcceptances()});
    app.ctEdited=field=>{if(app.ctTmCandidate(field))return;app.ctReviewed[field.id]=S.sourceHash(field.source);app.ctDraftDirty=true;app.ctQueueDraft();};
    assert.equal(await app.ctTmAccept(field),true);assert.equal(checkpoints.at(-1).tmAcceptances.length,1);
    assert.equal(await app.ctTmUndoAccept(field),true);assert.equal(checkpoints.at(-1).values[field.id],'');assert.equal(checkpoints.at(-1).tmAcceptances.length,0);
    assert.equal(checkpoints.at(-1).reviewed[field.id],undefined);assert.equal(app.ctTmFieldValue(field),'Epée');assert.equal(app.ctDraftDirty,true);
    app.ctTmRestoreAcceptances(checkpoints.at(-1));assert.equal(app.ctTmAccepted(field),false);
});

test('a populated peer translation hides the overlay and blocks acceptance without losing review text',async()=>{
    const h=harness(),{app,units}=h;h.addCandidate();const field=units[0].fields[0];app.ctTmEdited(field,'Authored pending text');await app.ctTmFlushReviews();
    app.ctSaved[units[0].id]={saved:true,values:{[field.id]:'Peer committed text'},reviewed:{}};
    assert.equal(app.ctTmCandidate(field),null);assert.equal(await app.ctTmAccept(field),false);assert.equal(app.ctTmReviewController(field).stale,true);
    assert.equal(app.ctTmReviewFor(app.ctTmPendingCandidate(field)).text,'Authored pending text');assert.equal(app.ctSaved[units[0].id].values[field.id],'Peer committed text');
});

test('a restored single match exposes renewed review, preserves authored text and clears restored guards only after revalidation',async()=>{
    const h=harness(),{app,units,reviews}=h,candidate=h.addCandidate(units[0],[appMemory(h)],{restored:true}),field=units[0].fields[0],id=key(units[0].id,field.id);
    const review={candidateId:candidate.id,candidateRevision:1,rawSourceHash:candidate.rawSourceHash,text:'Edited restored suggestion',matchId:null,
        dirty:true,opened:true,acceptedDraft:false,restored:true,revision:1,unitId:units[0].id,fieldId:field.id};
    reviews.set(id,copy(review));app.ctTmReviews[id]=copy(review);
    assert.equal(app.ctTmFieldValue(field),'Edited restored suggestion');assert.equal(app.ctTmReviewController(field).stale,true);
    assert.equal(typeof app.ctTmReviewController(field).revalidate,'function');assert.equal(await app.ctTmAccept(field),false);assert.equal(app.ctValues[field.id],'');
    assert.equal(await app.ctTmRevalidate(field),true);assert.equal(app.ctTmPendingCandidate(field).restored,undefined);assert.equal(app.ctTmReviews[id].restored,false);
    assert.equal(app.ctTmFieldValue(field),'Edited restored suggestion');assert.equal(app.ctTmReviewController(field).stale,false);
    assert.equal(await app.ctTmAccept(field),true);assert.equal(app.ctValues[field.id],'Edited restored suggestion');
});
function appMemory(h){return h.app.ctMemory[0];}

test('restored candidates without review records also require a current explicit review before selection',async()=>{
    const h=harness(),{app,units}=h;h.addCandidate(units[0],[app.ctMemory[0]],{restored:true});const field=units[0].fields[0];
    assert.equal(app.ctTmReviewController(field).selectedMatchId,null);assert.equal(app.ctTmReviewController(field).stale,true);
    app.ctMemory=[{...app.ctMemory[0],target:'Current remembered translation',localRevision:3}];
    assert.equal(await app.ctTmRevalidate(field),true);assert.equal(app.ctTmFieldValue(field),'Current remembered translation');assert.equal(await app.ctTmAccept(field),true);
});

test('pending MTL generations and request maps exclude non-current fields and flush rechecks newly competing work',async()=>{
    const h=harness([unit('a','Sword'),unit('b','Shield')]),{app,units,candidates}=h,normal=app.ctStorage;
    app.ctMtlPendingGeneration=(field,unit)=>unit.id===units[1].id?{requestId:'restored-request'}:null;
    assert.equal(app.ctTmFieldEligible(units[1],units[1].fields[0]),false);app.ctMtlPendingGeneration=()=>null;
    app.ctMtlRequests={[key(units[1].id,units[1].fields[0].id)]:{requestId:'live-request'}};
    assert.equal(app.ctTmFieldEligible(units[1],units[1].fields[0]),false);app.ctMtlRequests={};
    app.ctStorage=scope=>({...normal(scope),getDraft:async(scope,id)=>{if(id===units[1].id)app.ctMtlRequests[key(units[0].id,units[0].fields[0].id)]={requestId:'newly-started'};return null;}});
    app.ctTmSelectAllFiltered();assert.equal(await app.ctTmPrepareSelected(),true);
    assert.deepEqual([...candidates.values()].map(candidate=>candidate.unitId),[units[1].id]);
});

test('saving one candidate refreshes its resolved review revision before editing a new suggestion in the same field',async()=>{
    const h=harness(),{app,units,reviews,candidates}=h,first=h.addCandidate(),field=units[0].fields[0],id=key(units[0].id,field.id);
    assert.equal(await app.ctTmAccept(field),true);const accepted=reviews.get(id);
    candidates.set(first.id,{...first,status:'accepted',revision:2});reviews.set(id,{...accepted,acceptedDraft:false,resolved:true,revision:accepted.revision+1});
    await app.ctTmSaved(app.ctContext(),units[0].id);assert.equal(app._ctTmReviewQueues.get(id).revision,reviews.get(id).revision);
    app.ctValues[field.id]='';h.addCandidate(units[0],[app.ctMemory[0]],{id:'second-candidate',createdAt:2});
    assert.equal(app.ctTmEdited(field,'Second suggestion review'),true);assert.equal(await app.ctTmFlushReviews(),true);
    assert.equal(reviews.get(id).candidateId,'second-candidate');assert.equal(reviews.get(id).text,'Second suggestion review');assert.equal(app.ctTmRecoveries.length,0);
});
