const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../public/clientTextState.js');
const M=require('../public/clientTextMtlState.js');
const Store=require('../public/clientTextMtlStore.js');
const Memory=require('../public/clientTextMtlMemoryStore.js');
const Sync=require('../public/clientTextMtlSync.js');
const CT=require('../public/clientTextStore.js');
const {fixture,scope,unit,asset,fieldId}=require('./clienttext-storage-fixture.cjs');
const descriptor={role:'normal',assetHash:asset.hash,parserVersion:S.PARSER_VERSION};
function candidate(original=unit(),overrides={}){const field=original.fields[0];return {id:'candidate-1',requestId:'request-1',unitId:original.id,fieldId:field.id,
    role:original.role,assetHash:asset.hash,parserVersion:S.PARSER_VERSION,sourceHash:S.sourceHash(field.source),rawSourceHash:M.rawSourceHash(field.source),
    generatedText:'Generated translation',baseTargetHash:S.hash(field.target),revision:1,status:'pending',createdAt:1,...overrides};}
function prepared(){const f=fixture();for(const name of Store.names)if(!f.tables.has(name))f.tables.set(name,new Map());
    return {...f,mtl:Store.create({openDb:async()=>f.db})};}
const review=c=>({candidateId:c.id,candidateRevision:c.revision,rawSourceHash:c.rawSourceHash,text:'Edited MTL draft'});
const archive={id:'mtl-review_'+'a'.repeat(64),format:'sdeditor-mtl-dismissal-v1',status:'saved'};
async function tx(f,names,action){const transaction=f.db.transaction(names,'readwrite'),done=new Promise((resolve,reject)=>{
    transaction.oncomplete=resolve;transaction.onabort=transaction.onerror=()=>reject(transaction.error||new Error('Aborted'));});
    try{const result=await action(transaction);await done;return result;}catch(error){transaction.abort();await done.catch(()=>{});throw error;}}
test('separate scoped candidates and review buffers never write ordinary drafts, Saved, history or memory',async()=>{
    const f=prepared(),c=candidate();await f.mtl.putCandidate(scope,c);const input={...review(c),previousValue:'Original draft',suppressed:true};
    const saved=await f.mtl.putReview(scope,c.unitId,c.fieldId,input,{expectedRevision:null});input.text='Mutated after save';
    assert.equal(saved.revision,1);assert.equal((await f.mtl.getReview(scope,c.unitId,c.fieldId)).text,'Edited MTL draft');
    assert.equal((await f.mtl.list({...scope,accountId:'bob'})).length,0);assert.equal((await f.mtl.list({...scope,language:'French'})).length,0);
    assert.equal((await f.mtl.listReviews(scope,{unitId:c.unitId})).length,1);
    for(const name of [CT.stores.saved,CT.stores.drafts,CT.stores.history,CT.stores.memory,CT.stores.outbox])assert.equal(f.tables.get(name).size,0);
    assert.ok(f.operations.filter(op=>op.method==='index.getAll').every(op=>typeof op.arg==='string'&&JSON.parse(op.arg).length===6),'all scans are exact-scope index queries');
    await assert.rejects(f.mtl.putReview(scope,c.unitId,c.fieldId,review(c),{expectedRevision:null}),error=>error.code==='MTL_REVIEW_CHANGED');
});
test('peer regeneration and resolution never overwrite a personal review buffer',async()=>{
    const f=prepared(),c=candidate();await f.mtl.putCandidate(scope,c);const saved=await f.mtl.putReview(scope,c.unitId,c.fieldId,{...review(c),dirty:true});
    await f.mtl.applyRemote(scope,{candidates:[{...c,status:'superseded',revision:2},candidate(unit(),{id:'second',requestId:'second',createdAt:2})],sequence:2});
    assert.deepEqual(await f.mtl.getReview(scope,c.unitId,c.fieldId),saved);assert.equal((await f.mtl.list(scope)).length,2);
    await assert.rejects(f.mtl.applyRemote(scope,{candidates:[],sequence:1}),error=>error.code==='MTL_STALE_SEQUENCE');
    assert.equal((await f.mtl.getMetadata(scope)).sequence,2);
    const late=await f.mtl.putReview(scope,c.unitId,c.fieldId,{...review(c),dirty:true,text:'Last keystroke'},{expectedRevision:saved.revision});
    const next=candidate(unit(),{id:'second',requestId:'second',createdAt:2});
    await f.mtl.putReview(scope,c.unitId,c.fieldId,review(next),{expectedRevision:late.revision});
    assert.equal((await f.mtl.listReviews(scope)).length,1);assert.equal((await f.mtl.listReviews(scope,{includeArchived:true})).length,2);
    const archived=await f.mtl.getReview(scope,c.unitId,c.fieldId,{candidateId:c.id});
    assert.equal(archived.text,'Last keystroke');assert.equal(archived.dirty,true);assert.equal(archived.archived,true);
});
test('rejected cross-tab typing survives reload in an ordered recovery without changing the peer current review',async()=>{
    const f=prepared(),c=candidate(),peer=Store.create({openDb:async()=>f.db});await f.mtl.putCandidate(scope,c);
    const initial=await f.mtl.putReview(scope,c.unitId,c.fieldId,{...review(c),text:'Shared initial text'},{expectedRevision:null});
    const peerValue=await peer.putReview(scope,c.unitId,c.fieldId,{...review(c),text:'Other tab current text'},{expectedRevision:initial.revision});
    const rejected={...review(c),text:'Rejected local typing',dirty:true,previousDraft:{values:{secret:'not a recovery body'}},previousReview:{text:'No recursive review'}};
    await assert.rejects(f.mtl.putReview(scope,c.unitId,c.fieldId,rejected,{expectedRevision:initial.revision}),error=>error.code==='MTL_REVIEW_CHANGED');
    const options={recoveryId:'tab-session-one',editRevision:1},first=await f.mtl.archiveReview(scope,c.unitId,c.fieldId,rejected,options);
    assert.equal(first.reason,'review-conflict');assert.equal(first.archived,true);assert.equal(first.text,rejected.text);
    assert.equal(Object.hasOwn(first,'previousDraft'),false);assert.equal(Object.hasOwn(first,'previousReview'),false);
    const newer={...rejected,text:'Latest rejected local typing'},latest=await f.mtl.archiveReview(scope,c.unitId,c.fieldId,newer,{...options,editRevision:3});
    assert.deepEqual(await f.mtl.archiveReview(scope,c.unitId,c.fieldId,rejected,{...options,editRevision:2}),latest,'a late older retry cannot replace newer recovery');
    assert.deepEqual(await f.mtl.archiveReview(scope,c.unitId,c.fieldId,newer,{...options,editRevision:3}),latest,'exact retry retains timestamps and signature');
    await assert.rejects(f.mtl.archiveReview(scope,c.unitId,c.fieldId,{...newer,text:'Different same revision'},{...options,editRevision:3}),error=>error.code==='MTL_RECOVERY_MISMATCH');
    await assert.rejects(f.mtl.archiveReview(scope,c.unitId,c.fieldId,{...newer,candidateId:'another'},{...options,editRevision:4}),error=>error.code==='MTL_RECOVERY_MISMATCH');
    assert.deepEqual(await peer.getReview(scope,c.unitId,c.fieldId),peerValue,'recovery writes never replace the current review');
    const reloaded=Store.create({openDb:async()=>f.db});assert.deepEqual(await reloaded.getReview(scope,c.unitId,c.fieldId,{recoveryId:options.recoveryId}),latest);
    assert.equal((await reloaded.listReviews(scope,{includeArchived:true})).find(record=>record.recoveryId===options.recoveryId).text,newer.text);
    assert.equal((await reloaded.listReviews(scope)).length,1);assert.equal((await reloaded.listReviews({...scope,accountId:'bob'},{includeArchived:true})).length,0);
    const next=candidate(unit(),{id:'second',requestId:'second',createdAt:2});await f.mtl.putCandidate(scope,next);
    await peer.putReview(scope,next.unitId,next.fieldId,review(next),{expectedRevision:peerValue.revision});
    assert.equal((await reloaded.listReviews(scope,{includeArchived:true})).length,3,'generation archives and conflict recovery coexist');
    assert.deepEqual(await reloaded.getReview(scope,c.unitId,c.fieldId,{recoveryId:options.recoveryId}),latest);
    for(const name of [CT.stores.saved,CT.stores.drafts,CT.stores.history,CT.stores.memory,CT.stores.outbox,CT.stores.receipts])assert.equal(f.tables.get(name).size,0,name);
});
test('local review-conflict recovery is separate, monotonic, bounded and disposable',async()=>{
    const store=Memory.create(),c=candidate();store.putCandidate(scope,c);
    const initial=store.putReview(scope,c.unitId,c.fieldId,{...review(c),text:'Current review'}),options={recoveryId:'local-tab',editRevision:1},
        first=store.archiveReview(scope,c.unitId,c.fieldId,{...review(c),text:'Recovered typing',dirty:true},options);
    const latest=store.archiveReview(scope,c.unitId,c.fieldId,{...review(c),text:'Newest typing',dirty:true},{...options,editRevision:2});
    assert.deepEqual(store.archiveReview(scope,c.unitId,c.fieldId,{...review(c),text:'Recovered typing',dirty:true},options),latest);
    assert.equal(first.reason,'review-conflict');assert.deepEqual(store.getReview(scope,c.unitId,c.fieldId),initial);
    assert.equal(store.getReview(scope,c.unitId,c.fieldId,{recoveryId:'local-tab'}).text,'Newest typing');
    assert.throws(()=>store.archiveReview(scope,c.unitId,c.fieldId,{...review(c),text:'x'.repeat(M.MAX_TEXT+1)},{...options,editRevision:3}),/Invalid MTL review buffer/);
    assert.throws(()=>store.archiveReview(scope,c.unitId,c.fieldId,{...review(c),text:'Different'},{...options,editRevision:2}),error=>error.code==='MTL_RECOVERY_MISMATCH');
    assert.equal(store.listReviews(scope,{includeArchived:true}).length,2);store.dispose();assert.throws(()=>store.listReviews(scope,{includeArchived:true}),/disposed/);
});
test('MTL dismissal commits candidate, exact outbox body and receipt atomically and retries once',async()=>{
    const f=prepared(),c=candidate();await f.mtl.putCandidate(scope,c);f.fail(Store.stores.receipts);
    await assert.rejects(f.mtl.dismiss(scope,c,{mutationId:'dismiss'}),/Injected storage failure/);
    assert.equal((await f.mtl.getCandidate(scope,c.id)).status,'pending');assert.deepEqual(await f.mtl.getOutbox(scope),[]);
    f.fail(null);await f.mtl.dismiss(scope,c,{mutationId:'dismiss'});
    assert.equal((await f.mtl.dismiss(scope,c,{mutationId:'dismiss'})).replayed,true);
    const operation=(await f.mtl.getOutbox(scope))[0];assert.deepEqual(operation.requestBody,{mutationId:'dismiss',candidateRevision:1});
    await f.mtl.applyRemote(scope,{candidates:[c],sequence:1});assert.equal((await f.mtl.getCandidate(scope,c.id)).status,'dismissed');
    await f.mtl.acknowledge(scope,operation,{candidate:{...c,status:'dismissed',revision:2}});
    assert.equal((await f.mtl.getOutbox(scope)).length,0);assert.equal((await f.mtl.getCandidate(scope,c.id)).revision,2);
    await assert.rejects(f.mtl.dismiss(scope,{...c,revision:2},{mutationId:'dismiss'}),error=>error.code==='MTL_RECEIPT_MISMATCH');
});

test('shared archive dismissal retains original output and the exact optional edited rejection until a valid receipt',async()=>{
    for(const reviewedText of [undefined,'Edited rejection','']){
        const f=prepared(),c=candidate();await f.mtl.putCandidate(scope,c);
        const options={mutationId:'archive-dismiss',archiveRequired:true,consentVersion:'mtl-v2',...(reviewedText===undefined?{}:{reviewedText})};
        await f.mtl.dismiss(scope,c,options);assert.equal((await f.mtl.dismiss(scope,c,options)).replayed,true);
        const op=(await f.mtl.getOutbox(scope))[0];
        assert.deepEqual(op.requestBody,{mutationId:options.mutationId,candidateRevision:1,consentVersion:'mtl-v2',...(reviewedText===undefined?{}:{reviewedText})});
        assert.equal(op.candidate.generatedText,c.generatedText);assert.equal(op.archiveRequired,true);
        for(const bad of [undefined,{...archive,status:'pending'},{...archive,format:'other'},{...archive,id:'untrusted-id'}]){
            await assert.rejects(f.mtl.acknowledge(scope,op,{candidate:{...c,status:'dismissed',revision:2},archive:bad}),e=>e.code==='MTL_REVIEW_ARCHIVE_UNCONFIRMED');
            assert.equal((await f.mtl.getOutbox(scope)).length,1);
        }
        await f.mtl.acknowledge(scope,op,{candidate:{...c,status:'dismissed',revision:2},archive});
        assert.deepEqual(await f.mtl.getOutbox(scope),[]);assert.equal((await f.mtl.getCandidate(scope,c.id)).generatedText,c.generatedText);
        for(const name of [CT.stores.saved,CT.stores.drafts,CT.stores.history,CT.stores.memory,CT.stores.outbox])assert.equal(f.tables.get(name).size,0,name);
    }
});

test('new archive commands cannot persist without explicit v2 consent at either storage boundary',async()=>{
    for(const local of [false,true])for(const consentVersion of [undefined,'','mtl-v1']){
        const f=prepared(),store=local?Memory.create():f.mtl,c=candidate(),selected=local?{...scope,groupId:'local:test:consent'}:scope;
        await store.putCandidate(selected,c);
        await assert.rejects(async()=>store.dismiss(selected,c,{mutationId:'unapproved',archiveRequired:true,reviewedText:'Private rejected text',
            ...(consentVersion===undefined?{}:{consentVersion})}),e=>e.code==='MTL_REVIEW_CONSENT_REQUIRED');
        assert.deepEqual(await store.getOutbox(selected),[]);assert.equal((await store.getCandidate(selected,c.id)).status,'pending');
    }
});

test('durable dismissal rechecks consent after opening storage and rolls back an unapproved command',async()=>{
    const f=prepared(),c=candidate();await f.mtl.putCandidate(scope,c);let release,consent='mtl-v2';
    const waiting=new Promise(resolve=>{release=resolve;}),store=Store.create({openDb:async()=>{await waiting;return f.db;}});
    const pending=store.dismiss(scope,c,{mutationId:'revoked',archiveRequired:true,consentVersion:'mtl-v2',reviewedText:'Private rejected text',guard:()=>consent==='mtl-v2'});
    consent='';release();await assert.rejects(pending,e=>e.stale===true);
    assert.deepEqual(await f.mtl.getOutbox(scope),[]);assert.equal((await f.mtl.getCandidate(scope,c.id)).status,'pending');
});

test('archive-pending and lost acknowledgement replay the identical dismissal after a restart with no generation',async()=>{
    for(const local of [false,true]){
        const f=prepared(),selected=local?{...scope,groupId:'local:test:archive'}:scope,c=candidate(),calls=[];
        const store=local?Memory.create():f.mtl;await store.putCandidate(selected,c);
        await store.dismiss(selected,c,{mutationId:'retained-command',reviewedText:'Rejected edited text',archiveRequired:true,consentVersion:'mtl-v2'});
        let attempt=0;
        const options={scope:selected,local,store,request:async(path,init)=>{
            calls.push({path,body:structuredClone(init.body)});assert.equal(init.method,'POST');assert.match(path,/\/dismissals\??/);
            if(++attempt===1)throw Object.assign(new Error('Private file pending'),{status:503,code:'MTL_REVIEW_ARCHIVE_PENDING'});
            if(attempt===2)throw new TypeError('Lost acknowledgement');
            return local?{dismissal:{candidateId:c.id,requestId:c.requestId,status:'dismissed',revision:2},archive}:{candidate:{...c,status:'dismissed',revision:2},archive};
        }};
        let sync=Sync.create(options);await assert.rejects(sync.flush(),e=>e.code==='MTL_REVIEW_ARCHIVE_PENDING');
        assert.equal((await store.getOutbox(selected))[0].state,'archive-pending');sync.stop();
        // A fresh client/server connection uses the committed operation, even if
        // a shared event already reports that the candidate was dismissed.
        if(!local)await store.applyRemote(selected,{candidates:[{...c,status:'dismissed',revision:2}],sequence:2});
        sync=Sync.create({...options,store:local?store:Store.create({openDb:async()=>f.db})});
        await assert.rejects(sync.flush(),/Lost acknowledgement/);assert.equal((await store.getOutbox(selected))[0].state,'uncertain');
        assert.equal((await sync.flush()).uploaded,1);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1],calls[2]);
        assert.deepEqual(await store.getOutbox(selected),[]);assert.equal((await store.getCandidate(selected,c.id)).generatedText,c.generatedText);
        if(local){assert.deepEqual(calls[0].body,{mutationId:'retained-command',candidateId:c.id,candidateRevision:1,generatedText:c.generatedText,consentVersion:'mtl-v2',reviewedText:'Rejected edited text'});
            assert.equal(calls[0].path,'/v1/mtl/local/requests/'+c.requestId+'/dismissals');}
        else assert.deepEqual(calls[0].body,{mutationId:'retained-command',candidateRevision:1,consentVersion:'mtl-v2',reviewedText:'Rejected edited text'});
        sync.stop();
    }
});

test('local offline dismissal is memory-only, guarded on reconnect, and cannot acknowledge another request',async()=>{
    const store=Memory.create(),selected={...scope,groupId:'local:test:offline'},c=candidate(),calls=[];
    store.putCandidate(selected,c);store.dismiss(selected,c,{mutationId:'offline',archiveRequired:true,consentVersion:'mtl-v2',reviewedText:''});
    let offline=true,current=true;
    const sync=Sync.create({scope:selected,local:true,store,isCurrent:()=>current,offline:()=>offline,request:async(path,init)=>{
        calls.push({path,body:structuredClone(init.body)});return{dismissal:{candidateId:c.id,requestId:c.requestId,status:'dismissed',revision:2},archive};
    }});
    assert.equal((await sync.flush()).pending,1);await sync.pull();assert.deepEqual(calls,[]);
    const operation=store.getOutbox(selected)[0];
    assert.throws(()=>store.acknowledge(selected,operation,{dismissal:{candidateId:c.id,requestId:'another',status:'dismissed',revision:2},archive}),e=>e.code==='MTL_RECEIPT_MISMATCH');
    assert.deepEqual(store.getOutbox({...selected,accountId:'other'}),[]);
    offline=false;current=false;await assert.rejects(sync.flush(),e=>e.stale);assert.deepEqual(calls,[]);
    current=true;assert.equal((await sync.flush()).uploaded,1);sync.stop();
    const second=Memory.create();second.putCandidate(selected,c);second.dismiss(selected,c,{mutationId:'unsent',archiveRequired:true,consentVersion:'mtl-v2'});
    second.dispose();assert.throws(()=>second.getOutbox(selected),/disposed/);assert.deepEqual(Memory.create().getOutbox(selected),[]);
});

test('local late archive acknowledgement is fenced after access changes; acceptance never queues an archive',async()=>{
    const store=Memory.create(),selected={...scope,groupId:'local:test:late'},c=candidate();store.putCandidate(selected,c);
    store.dismiss(selected,c,{mutationId:'late',archiveRequired:true,consentVersion:'mtl-v2'});let current=true,release;
    const response=new Promise(resolve=>{release=resolve;});
    const sync=Sync.create({scope:selected,local:true,store,isCurrent:()=>current,request:()=>response});
    const running=sync.flush();await new Promise(resolve=>setImmediate(resolve));current=false;
    release({dismissal:{candidateId:c.id,requestId:c.requestId,status:'dismissed',revision:2},archive});
    await assert.rejects(running,e=>e.stale);assert.equal(store.getOutbox(selected).length,1);sync.stop();
    const accepted=Memory.create();accepted.putCandidate(selected,c);accepted.resolveAcceptances(selected,[M.acceptance(c,c.generatedText)],{jobId:'save'});
    assert.deepEqual(accepted.getOutbox(selected),[]);
});
test('acceptance validation and resolution can share the owning Save transaction and rollback together',async()=>{
    const f=prepared(),c=candidate(),original=unit(),claim=M.acceptance(c,c.generatedText),values={[fieldId]:c.generatedText};await f.mtl.putCandidate(scope,c);
    const selected=[...Store.names,CT.stores.saved];
    f.fail(CT.stores.saved);
    await assert.rejects(tx(f,selected,async transaction=>{
        const claims=await Store.validateAcceptancesTx(transaction,scope,original,[claim],values,descriptor);
        await Store.resolveAcceptancesTx(transaction,scope,claims,{jobId:'save'});
        transaction.objectStore(CT.stores.saved).put({key:'test',scope:CT.scopeKey(scope),value:values});
    }),/Injected storage failure/);
    assert.equal((await f.mtl.getCandidate(scope,c.id)).status,'pending');
    f.fail(null);await tx(f,selected,async transaction=>{
        const claims=await Store.validateAcceptancesTx(transaction,scope,original,[claim],values,descriptor);
        await Store.resolveAcceptancesTx(transaction,scope,claims,{jobId:'save',now:42});
        transaction.objectStore(CT.stores.saved).put({key:'test',scope:CT.scopeKey(scope),value:values});
    });
    assert.equal((await f.mtl.getCandidate(scope,c.id)).acceptanceJobId,'save');assert.equal(f.tables.get(CT.stores.saved).size,1);
    await f.mtl.applyRemote(scope,{candidates:[c],sequence:1});assert.equal((await f.mtl.getCandidate(scope,c.id)).status,'accepted');
});
test('local memory MTL is disposable, synchronous to Save and preserves buffers across peer events',()=>{
    const store=Memory.create(),c=candidate(),original=unit(),values={[fieldId]:c.generatedText};store.putCandidate(scope,c);
    const buffer=store.putReview(scope,c.unitId,c.fieldId,review(c));
    const claims=store.validateAcceptances(scope,original,[M.acceptance(c,c.generatedText)],values,descriptor);
    assert.equal(typeof claims.then,'undefined');store.resolveAcceptances(scope,claims,{jobId:'local-save'});
    assert.equal(store.getCandidate(scope,c.id).status,'accepted');assert.deepEqual(store.getReview(scope,c.unitId,c.fieldId),buffer);
    assert.deepEqual(store.getOutbox(scope),[]);store.dispose();assert.throws(()=>store.list(scope),/disposed/);
    assert.deepEqual(Memory.create().list(scope),[]);
});
test('generation journals retain exact request identity without source/context bodies and fence uncertain retries',async()=>{
    const f=prepared(),c=candidate(),record={requestId:c.requestId,unitId:c.unitId,fieldId:c.fieldId,rawSourceHash:c.rawSourceHash,
        assetHash:c.assetHash,parserVersion:c.parserVersion,baseTargetHash:c.baseTargetHash,sourceHash:c.sourceHash,createdAt:12,status:'pending'};
    await f.mtl.putGeneration(scope,{...record,source:'not persisted',context:{private:'not persisted'}});
    await f.mtl.putGeneration(scope,{requestId:c.requestId,status:'uncertain',suppressed:true});
    const saved=await f.mtl.getGeneration(scope,c.requestId);assert.equal(saved.status,'uncertain');assert.equal(Object.hasOwn(saved,'source'),false);
    assert.equal(Object.hasOwn(saved,'context'),false);assert.equal((await f.mtl.getGenerations(scope,{activeOnly:true})).length,1);
    assert.equal((await f.mtl.getGenerations({...scope,accountId:'bob'})).length,0);
    await assert.rejects(f.mtl.putGeneration(scope,{requestId:c.requestId,rawSourceHash:'b'.repeat(64)}),error=>error.code==='MTL_REQUEST_MISMATCH');
    await f.mtl.putGeneration(scope,{requestId:c.requestId,status:'completed',suppressed:false});
    assert.equal((await f.mtl.getGeneration(scope,c.requestId)).suppressed,true);assert.equal((await f.mtl.getGenerations(scope,{activeOnly:true})).length,0);
    await assert.rejects(f.mtl.putGeneration(scope,{requestId:c.requestId,status:'pending'}),error=>error.code==='MTL_REQUEST_MISMATCH');
    const memory=Memory.create();memory.putGeneration(scope,record);memory.putGeneration(scope,{requestId:c.requestId,status:'uncertain'});
    assert.equal(memory.getGeneration(scope,c.requestId).status,'uncertain');memory.dispose();assert.throws(()=>memory.getGenerations(scope),/disposed/);
});
test('owning durable and local Save preserve candidate overlays until explicit acceptance then resolve atomically',async()=>{
    const f=prepared(),original=unit(),c=candidate(original);await f.store.import(scope,{units:[original],assets:[asset]});await f.mtl.putCandidate(scope,c);
    await f.store.save(scope,original.id,{jobId:'ordinary',values:S.originalValues(original),reviewed:{}},{sync:false});
    assert.equal((await f.mtl.getCandidate(scope,c.id)).status,'pending');assert.equal((await f.store.getSaved(scope))[original.id].values[fieldId],original.fields[0].target);
    const command={jobId:'reviewed',values:{[fieldId]:c.generatedText},reviewed:{[fieldId]:S.sourceHash(original.fields[0].source)},mtlAcceptances:[M.acceptance(c,c.generatedText)]};
    await f.store.save(scope,original.id,command,{sync:false});assert.equal((await f.mtl.getCandidate(scope,c.id)).status,'accepted');
    assert.equal((await f.store.save(scope,original.id,command,{sync:false})).replayed,true);
    const normalMemory=require('../public/clientTextMemoryStore.js').create(),localScope={...scope,groupId:'local:test:mtl'};
    await normalMemory.import(localScope,{units:[original],assets:[asset]});normalMemory.mtl.putCandidate(localScope,c);
    await normalMemory.save(localScope,original.id,{jobId:'ordinary',values:S.originalValues(original),reviewed:{}});
    assert.equal(normalMemory.mtl.getCandidate(localScope,c.id).status,'pending');
    await normalMemory.save(localScope,original.id,command);assert.equal(normalMemory.mtl.getCandidate(localScope,c.id).status,'accepted');
    assert.equal((await normalMemory.save(localScope,original.id,command)).replayed,true);normalMemory.dispose();
});
test('actual Save rolls back candidate resolution, draft removal, TM, outbox, history and receipt on failure',async()=>{
    const f=prepared(),original=unit(),c=candidate(original),values={[fieldId]:c.generatedText},mtlAcceptances=[M.acceptance(c,c.generatedText)];
    await f.store.import(scope,{units:[original],assets:[asset]});await f.mtl.putCandidate(scope,c);
    const reviewed={[fieldId]:S.sourceHash(original.fields[0].source)},draft=await f.store.putDraft(scope,original.id,{values,reviewed,mtlAcceptances});
    const reloaded=CT.create({openDb:async()=>f.db});assert.deepEqual((await reloaded.getDraft(scope,original.id)).mtlAcceptances,mtlAcceptances);
    const command={jobId:'atomic',values,reviewed,mtlAcceptances,expectedDraftRevision:draft.revision};
    f.fail(Store.stores.candidates);await assert.rejects(f.store.save(scope,original.id,command),/Injected storage failure/);f.fail(null);
    assert.equal((await f.mtl.getCandidate(scope,c.id)).status,'pending');assert.equal((await f.store.getDraft(scope,original.id)).revision,draft.revision);
    for(const name of [CT.stores.saved,CT.stores.history,CT.stores.memory,CT.stores.outbox,CT.stores.receipts])assert.equal(f.tables.get(name).size,0,name);
    await f.mtl.applyRemote(scope,{candidates:[{...c,status:'dismissed',revision:2}],sequence:1});
    await assert.rejects(f.store.save(scope,original.id,command),error=>error.code==='MTL_CANDIDATE_CHANGED');
    assert.equal(f.tables.get(CT.stores.saved).size,0);assert.equal((await f.store.getDraft(scope,original.id)).revision,draft.revision);
    const fresh=candidate(original,{id:'new',requestId:'new',createdAt:2});await f.mtl.putCandidate(scope,fresh);
    const accepted={...command,mtlAcceptances:[M.acceptance(fresh,fresh.generatedText)]};await f.store.save(scope,original.id,accepted);
    assert.equal((await f.store.save(scope,original.id,accepted)).replayed,true);
    await assert.rejects(f.store.save(scope,original.id,{...accepted,values:{[fieldId]:'Changed'}}),error=>error.code==='SAVE_RECEIPT_MISMATCH');
    assert.equal((await f.store.getOutbox(scope))[0].mtlAcceptances[0].candidateId,fresh.id);assert.equal((await f.store.getDraft(scope,original.id)),undefined);
});
test('new local generations supersede previous pending overlays without deleting review recovery',async()=>{
    for(const store of [prepared().mtl,Memory.create()]){
        const first=candidate(),next=candidate(unit(),{id:'next',requestId:'next',createdAt:2});await store.putCandidate(scope,first);
        await store.putReview(scope,first.unitId,first.fieldId,{...review(first),dirty:true});await store.putCandidate(scope,next);
        assert.equal((await store.getCandidate(scope,first.id)).status,'superseded');
        await store.dismiss(scope,next,{mutationId:'dismiss-new'});assert.equal((await store.list(scope)).filter(candidate=>candidate.status==='pending').length,0);
        assert.equal((await store.getReview(scope,first.unitId,first.fieldId)).text,'Edited MTL draft');
    }
});
test('after explicit review ordinary human blank/token edits retain ClientText Save semantics',async()=>{
    const f=prepared(),original=unit('Source {0}'),c=candidate(original,{generatedText:'Translation {0}'});await f.store.import(scope,{units:[original],assets:[asset]});
    assert.equal(M.validate(original.fields[0],c.generatedText).valid,true);await f.mtl.putCandidate(scope,c);
    const reviewed={[fieldId]:S.sourceHash(original.fields[0].source)},values={[fieldId]:''},claim=M.acceptance(c,'');await f.store.save(scope,original.id,{jobId:'accepted-then-blank',values,reviewed,mtlAcceptances:[claim]},{sync:false});
    assert.equal((await f.store.getSaved(scope))[original.id].values[fieldId],'');assert.equal((await f.mtl.getCandidate(scope,c.id)).status,'accepted');
    const normal=require('../public/clientTextMemoryStore.js').create(),local={...scope,groupId:'local:test:blank'};await normal.import(local,{units:[original],assets:[asset]});
    normal.mtl.putCandidate(local,c);await normal.save(local,original.id,{jobId:'accepted-manual',values:{[fieldId]:'Manual translation'},reviewed,
        mtlAcceptances:[M.acceptance(c,'Manual translation')]});
    assert.equal((await normal.getSaved(local))[original.id].values[fieldId],'Manual translation');assert.equal(normal.mtl.getCandidate(local,c.id).status,'accepted');normal.dispose();
});
test('actual durable and local Save reject missing source review and history-restore acceptance without partial effects',async()=>{
    for(const mode of ['durable','memory']){
        const f=mode==='durable'?prepared():null,normal=f?.store||require('../public/clientTextMemoryStore.js').create(),
            selected=mode==='durable'?scope:{...scope,groupId:'local:test:review-guard'},mtl=f?.mtl||normal.mtl,original=unit(),c=candidate(original),
            values={[fieldId]:c.generatedText},reviewed={[fieldId]:c.sourceHash},mtlAcceptances=[M.acceptance(c,c.generatedText)];
        await normal.import(selected,{units:[original],assets:[asset]});await mtl.putCandidate(selected,c);
        const draft=await normal.putDraft(selected,original.id,{values,reviewed,mtlAcceptances}),
            command={jobId:'blocked-review',values,reviewed:{},mtlAcceptances,expectedDraftRevision:draft.revision};
        for(const [input,options] of [[command,{}],[{...command,reviewed,origin:'restore'},{}],[{...command,reviewed},{origin:'restore'}]]){
            await assert.rejects(normal.save(selected,original.id,input,options),error=>error.code==='MTL_REVIEW_MISMATCH',mode);
            assert.equal((await mtl.getCandidate(selected,c.id)).status,'pending',mode);
            assert.deepEqual(await normal.getSaved(selected),{},mode);assert.deepEqual(await normal.listHistory(selected,original.id),[],mode);
            assert.equal((await normal.getDraft(selected,original.id)).revision,draft.revision,mode);
            assert.deepEqual((await normal.getMemory(selected)).units,[],mode);
            if(f)for(const name of [CT.stores.saved,CT.stores.history,CT.stores.memory,CT.stores.outbox,CT.stores.receipts])assert.equal(f.tables.get(name).size,0,name);
        }
        const accepted={...command,reviewed};await normal.save(selected,original.id,accepted);
        assert.equal((await normal.save(selected,original.id,accepted)).replayed,true,mode);
        assert.equal((await mtl.getCandidate(selected,c.id)).status,'accepted',mode);normal.dispose?.();
    }
});
test('silent event sync captures scope and preserves exact uncertain dismissal bodies',async()=>{
    const f=prepared(),c=candidate(),calls=[];let fail=true,current=true;
    const sync=Sync.create({scope,store:f.mtl,isCurrent:()=>current,request:async(path,init)=>{
        calls.push({path,init:structuredClone(init)});
        if(path.includes('/events?'))return {events:path.includes('after=0&')?[{sequence:1,candidate:c}]:[],sequence:1,hasMore:false};
        if(fail){fail=false;throw new Error('Offline');}return {candidate:{...c,status:'dismissed',revision:2}};
    }});
    await sync.pull();await f.mtl.dismiss(scope,c,{mutationId:'retry'});await assert.rejects(sync.flush(),/Offline/);
    assert.equal((await f.mtl.getOutbox(scope))[0].state,'uncertain');assert.match(sync.snapshot().flushError,/Offline/);
    await sync.pull();assert.match(sync.snapshot().flushError,/Offline/,'unrelated replay cannot clear upload failure');
    assert.equal((await sync.flush()).uploaded,1);assert.equal(sync.snapshot().error,'');
    const posts=calls.filter(call=>call.init.method==='POST');assert.deepEqual(posts[0],posts[1]);
    assert.deepEqual(posts[0].init.body,{mutationId:'retry',candidateRevision:1},'historical outbox bodies are never rewritten to add new consent');
    current=false;await assert.rejects(sync.pull(),error=>error.stale===true);sync.stop();
});


test('later queued Saves retain the MTL acceptance operation until its server receipt arrives',async()=>{
    const f=prepared(),original=unit(),c=candidate(original);
    await f.store.import(scope,{units:[original],assets:[asset]});await f.mtl.putCandidate(scope,c);
    const reviewed={[fieldId]:c.sourceHash},acceptedValues={...S.originalValues(original),[fieldId]:c.generatedText},
        claim=M.acceptance(c,c.generatedText);
    await f.store.save(scope,original.id,{jobId:'mtl-first',values:acceptedValues,reviewed,mtlAcceptances:[claim]});
    const accepted=(await f.store.getOutbox(scope))[0];
    await f.store.save(scope,original.id,{jobId:'human-second',values:{...acceptedValues,[fieldId]:'Later human text'},reviewed});
    await f.store.save(scope,original.id,{jobId:'human-third',values:{...acceptedValues,[fieldId]:'Final human text'},reviewed});
    const pending=(await f.store.getOutbox(scope))[0];
    assert.equal(pending.mutationId,'human-third');assert.deepEqual(pending.predecessor,accepted);
    const calls=[],ContentSync=require('../public/clientTextSync.js');
    const sync=ContentSync.create({scope,store:f.store,request:async(path,options)=>{
        assert.equal(options.method,'PATCH');calls.push(S.copy(options.body));
        return {unit:{id:original.id,revision:calls.length,values:options.body.values,reviewed:options.body.reviewed,
            provenance:{mtl:[{candidateId:c.id,fieldId,reviewedTextHash:claim.reviewedTextHash}]}}};
    }});
    assert.equal((await sync.flush()).uploaded,2);sync.stop();
    assert.equal(calls[0].mutationId,'mtl-first');assert.deepEqual(calls[0].mtlAcceptances,[claim]);
    assert.equal(calls[0].values[fieldId],c.generatedText);
    assert.equal(calls[1].mutationId,'human-third');assert.equal(calls[1].baseRevision,1);
    assert.equal(calls[1].values[fieldId],'Final human text');assert.equal(calls[1].mtlAcceptances,undefined);
    assert.deepEqual(await f.store.getOutbox(scope),[]);
    assert.equal((await f.store.getSaved(scope))[original.id].provenance.mtl[0].candidateId,c.id);
});
