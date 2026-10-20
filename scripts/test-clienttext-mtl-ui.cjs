const {test} = require('node:test');
const assert = require('node:assert/strict');
const S=require('../public/clientTextState.js'),M=require('../public/clientTextMtlState.js'),Memory=require('../public/clientTextMtlMemoryStore.js');
const UI=require('../public/clientTextMtlUi.js');
const Debug=require('../public/clientTextMtlDebug.js');
const ModelSettings=require('../public/clientTextMtlSettingsUi.js');
const {scope:baseScope,unit:makeUnit}=require('./clienttext-storage-fixture.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const descriptor={role:'normal',assetHash:'a'.repeat(64),parserVersion:S.PARSER_VERSION};
function harness(changes={}){
    const scope={...baseScope},original=makeUnit('Hello {0}','Confirmed {0}'),mtl=Memory.create();
    let epoch=0,ordinaryEdits=0;
    const normal={mtl,getMetadata:async()=>({descriptors:[descriptor]})};
    const app={...UI.mixin.data(),ctActive:true,ctBusy:false,ctHistoryViewer:false,ctWorkspace:{scope},ctSelection:original.id,
        ctValues:S.valuesFor(original),ctReviewed:{},ctDraftDirty:false,ctSaved:{},ctUnits:[original],_ctUnitIndex:new Map([[original.id,original]]),
        cloudSignedIn:true,cloudProfileId:scope.accountId,cloudUser:{id:scope.accountId,role:'translator',language:scope.language,assignmentVersion:1},
        cloudCanAccessAllLanguages:false,mtlConsentVersion:'mtl-v2',mtlShortcut:'disabled',ctMtlCapabilities:{enabled:true,reviewArchive:true,consentVersion:'mtl-v2'},
        ctContext:()=>({scope:structuredClone(scope),epoch}),ctCurrent:ctx=>ctx.epoch===epoch&&JSON.stringify(ctx.scope)===JSON.stringify(scope),
        ctStorage:()=>normal,ctCloseCompletion(){},
        ctEdited(field){if(this.ctMtlCandidate(field))return;this.ctMtlUnderlyingEdited(field);this.ctReviewed[field.id]=S.sourceHash(field.source);this.ctDraftDirty=true;ordinaryEdits++;},
        ...changes};
    for(const[name,method]of Object.entries(UI.mixin.methods))app[name]=method.bind(app);
    for(const[name,getter]of Object.entries(UI.mixin.computed))Object.defineProperty(app,name,{configurable:true,get:()=>getter.call(app)});
    Object.defineProperty(app,'ctCurrentUnit',{get:()=>app._ctUnitIndex.get(app.ctSelection)||null});
    app._ctMtlDescriptors=[descriptor];
    app._cloud={request:async(path,options)=>{const body=options.body;return{candidate:candidate(original,body.requestId,body.baseTargetHash)}}};
    const field=original.fields[0];
    return{app,scope,original,field,mtl,normal,changeEpoch(){epoch++;},ordinaryEdits:()=>ordinaryEdits,
        async put(value=candidate(original)){mtl.putCandidate(scope,value);app.ctMtlCandidates=mtl.list(scope);return value;},
        async reviews(){for(const head of app._ctMtlReviewQueues?.values()||[])await head.queue;}};
}
function candidate(unit,requestId='request1',baseTargetHash=S.hash(unit.fields[0].target),changes={}){
    const field=unit.fields[0];return{id:'candidate-'+requestId,requestId,unitId:unit.id,fieldId:field.id,role:unit.role,
        assetHash:descriptor.assetHash,parserVersion:descriptor.parserVersion,sourceHash:S.sourceHash(field.source),rawSourceHash:M.rawSourceHash(field.source),
        generatedText:'Generated {0}',revision:1,status:'pending',createdAt:1,baseTargetHash,...changes};
}

test('MTL visibility uses account assignments for Translator and Manager, independently of selected language and broad access',()=>{
    const h=harness(),app=h.app;
    for(const role of ['translator','manager'])for(const language of [null,'','all','Thai','French']){
        app.cloudUser={id:h.scope.accountId,role,language,assignmentVersion:1};app.cloudCanAccessAllLanguages=role==='manager';
        app.lang='Japanese';
        assert.equal(app.ctMtlVisible,['Thai','French'].includes(language),role+'/'+language);
        assert.equal(app.ctMtlCanGenerate(h.field),['Thai','French'].includes(language)&&(role==='manager'||language===h.scope.language));
        if(role==='manager')assert.equal(UI.permissions(app,app.ctContext()),true,'Unassigned Manager keeps existing private MTL/API access policy');
    }
    app.cloudUser={id:h.scope.accountId,role:'admin',isAdmin:true,language:null};
    assert.equal(app.ctMtlVisible,true);assert.equal(app.ctMtlCanGenerate(h.field),true);
    app.ctMtlCapabilities={enabled:false};assert.equal(app.ctMtlVisible,true);assert.equal(app.ctMtlCanGenerate(h.field),false);
    app.cloudSignedIn=false;assert.equal(app.ctMtlVisible,false);
});

test('assignment removal hides review overlay while retaining ordinary drafts, review edits and workload filters',async()=>{
    const h=harness(),app=h.app;await h.put();await app.ctMtlLoadReviews(h.original);
    app.ctValues[h.field.id]='Ordinary unsaved {0}';app.ctDraftDirty=true;
    app.ctMtlShow(h.field);app.ctMtlEdited(h.field,'Separate review edit {0}');
    app.ctFilter='mtl';app.ctSelectedFilters=['mtl'];const reviews=app.ctMtlReviews,candidates=app.ctMtlCandidates,ids=[...app.ctMtlUnitIds];
    app.cloudUser={...app.cloudUser,role:'manager',language:null};app.cloudCanAccessAllLanguages=true;
    UI.mixin.watch.ctMtlVisible.call(app,false);
    assert.equal(app.ctMtlCandidate(h.field),null);assert.equal(app.ctMtlFieldValue(h.field),'Ordinary unsaved {0}');
    assert.equal(app.ctMtlReviews,reviews);assert.equal(app.ctMtlCandidates,candidates);assert.equal(app.ctDraftDirty,true);
    assert.equal(app.ctFilter,'mtl');assert.deepEqual(app.ctSelectedFilters,['mtl']);assert.deepEqual([...app.ctMtlUnitIds],ids);
    let requests=0;app._cloud.request=async()=>{requests++;};app.ctMtlCapabilities=null;
    assert.equal(await app.ctMtlGenerate(h.field),false);assert.equal(requests,0);
    app.cloudUser.language='Thai';assert.equal(app.ctMtlFieldValue(h.field),'Separate review edit {0}');
});
function debugHarness(){
    const h=harness(),app=h.app;
    Object.assign(app,Debug.mixin.data());
    for(const[name,method]of Object.entries(Debug.mixin.methods))app[name]=method.bind(app);
    for(const[name,getter]of Object.entries(Debug.mixin.computed))Object.defineProperty(app,name,{configurable:true,get:()=>getter.call(app)});
    app.cloudUser={...app.cloudUser,role:'admin',isAdmin:true};
    return h;
}
function debugDialogHarness(record){
    const h=debugHarness();h.app.ctMtlDebugWindow={record};
    const dialog={...Debug.Dialog.data(),host:h.app,$refs:{}};
    Object.defineProperty(dialog,'item',{get:()=>h.app.ctMtlDebugWindow});
    for(const[name,method]of Object.entries(Debug.Dialog.methods))dialog[name]=method.bind(dialog);
    return{...h,dialog};
}

test('Admin copy actions use every complete displayed sanitized JSON section and never hidden transport fields',async()=>{
    const original=Object.getOwnPropertyDescriptor(global,'navigator'),copied=[],record={status:'completed',server:{context:{note:'Context '.repeat(6000),accessToken:'private-secret'},
        source:'Request line\n'.repeat(3000)+'request-tail',response:{translation:'Response line\n'.repeat(3000)+'response-tail',reasoning:'hidden-response-reasoning',apiKey:'private-response-key'},
        providerRequest:{model:'hidden-provider-value',reasoning:{effort:'hidden-effort'},instructions:'Prompt '.repeat(6000),input:[{role:'user',content:'Authorized source'}]},rawResponse:'hidden-raw-value'}};
    Object.defineProperty(global,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>copied.push(text)}}});
    const h=debugDialogHarness(record);
    try{
        for(const section of ['prompt','context','request','response']){assert.equal(await h.dialog.copySection(section),true);assert.equal(copied.at(-1),Debug.sectionText(record,section));assert.equal(h.dialog.copyMessage[section],'Copied');assert.ok(copied.at(-1).length>30000);}
        assert.doesNotMatch(copied.join(''),/private-secret|private-response-key|hidden-provider-value|hidden-effort|hidden-raw-value|hidden-response-reasoning/);
        assert.match(copied[1],/\n  "note"/);assert.equal(JSON.parse(copied[2]).source,record.server.source);assert.deepEqual(JSON.parse(copied[3]),{translation:record.server.response.translation});
        for(const key of ['prompt','context','response'])assert.equal(JSON.parse(copied[2])[key],undefined);
        h.app.cloudUser.role='manager';for(const section of ['prompt','context','request','response'])assert.equal(await h.dialog.copySection(section),false);assert.equal(copied.length,4);
    }finally{h.dialog.resetCopy();if(original)Object.defineProperty(global,'navigator',original);else delete global.navigator;}
});

test('an absent response has no copy action, while an explicit null response retains its JSON meaning',async()=>{
    const original=Object.getOwnPropertyDescriptor(global,'navigator'),copied=[],h=debugDialogHarness({status:'preview',snapshot:{source:'Synthetic source'}});
    Object.defineProperty(global,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>copied.push(text)}}});
    try{
        assert.equal(Debug.sectionText(h.dialog.item.record,'response'),'');assert.equal(await h.dialog.copySection('response'),false);
        assert.equal(await h.dialog.copySection('rawResponse'),false);assert.deepEqual(copied,[]);
        h.app.ctMtlDebugWindow={record:{status:'failed',server:{response:null}}};
        assert.equal(await h.dialog.copySection('response'),true);assert.deepEqual(copied,['null']);
    }finally{h.dialog.resetCopy();if(original)Object.defineProperty(global,'navigator',original);else delete global.navigator;}
});

test('clipboard failure selects the displayed section for manual copy and never reports success',async()=>{
    const previousNavigator=Object.getOwnPropertyDescriptor(global,'navigator'),previousDocument=global.document,previousSelection=global.getSelection;
    let selected,focused;const h=debugDialogHarness({status:'completed',server:{source:'Readable request',context:{note:'Readable context'},providerRequest:{instructions:'Readable prompt',input:[]},response:{translation:'Readable response'}}});
    global.document={createRange:()=>({selectNodeContents:value=>selected=value})};global.getSelection=()=>({removeAllRanges(){},addRange(){}});
    try{for(const unavailable of [false,true]){
        Object.defineProperty(global,'navigator',{configurable:true,value:unavailable?{}:{clipboard:{writeText:async()=>{throw new Error('Synthetic clipboard denial');}}}});
        for(const section of ['prompt','context','request','response']){
            selected=null;focused=false;const field={focus:options=>{assert.deepEqual(options,{preventScroll:true});focused=true;}};h.dialog.$refs[section+'Text']=[field];
            assert.equal(await h.dialog.copySection(section),false);assert.equal(selected,field);assert.equal(focused,true);assert.equal(h.dialog.copyMessage[section],'');assert.match(h.dialog.copyError[section],/Could not copy automatically.*Ctrl\+C/);
        }
    }}
    finally{h.dialog.resetCopy();if(previousNavigator)Object.defineProperty(global,'navigator',previousNavigator);else delete global.navigator;global.document=previousDocument;global.getSelection=previousSelection;}
});

test('copy completion is fenced after account/context changes and repeated copy does not duplicate an active write',async()=>{
    const original=Object.getOwnPropertyDescriptor(global,'navigator');
    try{for(const section of ['context','request','response'])for(const change of [h=>h.app.cloudSignedIn=false,h=>h.scope.language='German',h=>h.app.ctMtlDebugWindow=null]){
        const wait=deferred();let writes=0;Object.defineProperty(global,'navigator',{configurable:true,value:{clipboard:{writeText:()=>{writes++;return wait.promise;}}}});
        const h=debugDialogHarness({status:'completed',server:{context:{note:'Scoped context'},response:{translation:'Scoped response'}}});
        try{
            const pending=h.dialog.copySection(section);assert.equal(await h.dialog.copySection(section),false);assert.equal(writes,1);
            change(h);h.dialog.resetCopy();wait.resolve();assert.equal(await pending,false);assert.deepEqual(h.dialog.copyMessage,{});
        }finally{h.dialog.resetCopy();}
    }}finally{if(original)Object.defineProperty(global,'navigator',original);else delete global.navigator;}
});
function pollingHarness(){
    const h=harness();h.app.ctMtlCapabilities={enabled:true,reviewArchive:true,consentVersion:'mtl-v2',delivery:'poll-v1'};
    h.app.ctMtlRequestWait=async()=>{};
    h.status=(body,changes={})=>({requestId:body.requestId,status:'running',scope:{...h.scope,local:String(h.scope.groupId).startsWith('local:')},
        progress:{revision:1,phase:'generating',translation:'Working {0}',provisional:true},pollAfterMs:250,...changes});
    return h;
}

test('submitted context uses scoped saved neighboring translations and excludes active provisional text',()=>{
    const h=harness(),neighbor=makeUnit('Hello neighbor {0}','Workbook neighbor {0}');
    neighbor.id='synthetic-neighbor';neighbor.recordId='Neighbor';neighbor.fields[0].sourceCell='B3';neighbor.fields[0].targetCell='C3';h.app.ctUnits=[neighbor,h.original];
    h.app.ctSaved={[neighbor.id]:{saved:true,values:{[h.field.id]:'Authored neighbor {0}'}}};
    h.app.ctValues[h.field.id]='Unsaved selected {0}';h.app.ctMtlLive={synthetic:{text:'Unvalidated provisional {0}'}};
    const context=h.app.ctMtlBuildContext(h.field).initial,field=context.surrounding.entries[0].fields[0];
    assert.equal(field.translation,'Authored neighbor {0}');assert.equal(field.translationOrigin,'saved');
    assert.doesNotMatch(JSON.stringify(context),/Unsaved selected|Unvalidated provisional/);
});

test('tone-note preparation keeps generation bound to its captured record across record navigation and fences scope changes',async()=>{
    for(const changeScope of [false,true]){
        const h=harness(),wait=deferred(),other=makeUnit('Other English {0}','Other target {0}');other.id='other-unit';other.recordId='Other record';
        h.app.ctUnits.push(other);h.app._ctUnitIndex.set(other.id,other);h.app.ctToneNotesPrepare=()=>wait.promise;
        h.app.ctToneNotesSnapshot=()=>({status:'ready',accountId:h.scope.accountId,scope:{game:h.scope.game,branchId:h.scope.branchId,language:h.scope.language},entries:[]});
        let sent;h.app._cloud.request=async(_path,options)=>{sent=options.body;return{candidate:candidate(h.original,sent.requestId,sent.baseTargetHash)};};
        const pending=h.app.ctMtlGenerate(h.field);await settle();
        if(changeScope)h.changeEpoch();else{h.app.ctSelection=other.id;h.app.ctValues=S.valuesFor(other);}
        wait.resolve();assert.equal(await pending,!changeScope);
        if(changeScope)assert.equal(sent,undefined);
        else{assert.equal(sent.context.identity.unitId,h.original.id);assert.equal(sent.unitId,h.original.id);assert.equal(h.app.ctValues[h.field.id],'Other target {0}');}
    }
});

test('unavailable tone-note preparation cannot admit a translation or change its underlying draft',async()=>{
    const h=harness();let requests=0;h.app.ctValues[h.field.id]='Private ordinary draft {0}';
    h.app.ctToneNotesPrepare=async()=>{throw Object.assign(new Error('Shared tone notes could not be checked.'),{code:'MTL_TONE_NOTES_UNAVAILABLE'});};
    h.app._cloud.request=async()=>{requests++;throw Error('Inference must not start');};
    assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(requests,0);assert.deepEqual(h.app.ctMtlGenerations,[]);
    assert.equal(h.app.ctValues[h.field.id],'Private ordinary draft {0}');assert.match(h.app.ctMtlError,/could not be checked/);
});

test('stale tone-note admission refreshes notes and ends the request without automatic translation replay',async()=>{
    for(const asynchronous of [false,true]){
        const h=harness();if(asynchronous)h.app.ctMtlCapabilities.delivery='poll-v1';let reads=0,posts=0;
        h.app.ctToneNotesPrepare=async()=>{reads++;};h.app._cloud.request=async(_path,options={})=>{
            assert.equal(options.method,'POST');posts++;throw Object.assign(new Error('Synthetic stale guidance'),{status:409,code:'MTL_TONE_NOTES_CHANGED'});
        };
        assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(reads,2);assert.equal(posts,1);
        assert.equal(h.app.ctMtlGenerations[0].status,'failed');assert.equal(h.app.ctMtlPendingGeneration(h.field),null);
        assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.match(h.app.ctMtlError,/changed before translation started/);
    }
});

test('advertised polling starts once and shows only request-local provisional text until validated completion',async()=>{
    for(const local of [false,true]){
        const h=pollingHarness();if(local)h.scope.groupId='local:test:live';let body,posts=0,gets=0;
        h.app._cloud.request=async(path,options={})=>{
            if(options.method==='POST'){
                posts++;body=options.body;assert.match(path,local?/^\/v1\/mtl\/local\/requests\?async=1$/:/\?language=Thai&async=1$/);
                assert.equal(options.timeout,15000);return h.status(body);
            }
            gets++;assert.equal(path,'/v1/mtl/requests/'+body.requestId);
            assert.equal(h.app.ctMtlProgressFor(h.field).text,gets===1?'Working {0}':'Working <b>{0}</b>\nNext');
            assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.equal(h.app.ctDraftDirty,false);
            assert.deepEqual(h.mtl.list(h.scope),[]);assert.deepEqual(h.app.ctMtlAcceptances(),[]);
            assert.doesNotMatch(JSON.stringify(h.mtl.getGenerations(h.scope)),/Working/);
            return gets===1?h.status(body,{progress:{revision:2,phase:'generating',translation:'Working <b>{0}</b>\nNext',provisional:true}})
                :{candidate:candidate(h.original,body.requestId,body.baseTargetHash)};
        };
        assert.equal(await h.app.ctMtlGenerate(h.field),true);assert.equal(posts,1);assert.equal(gets,2);
        assert.deepEqual(h.app.ctMtlLive,{});assert.equal(h.app.ctMtlFieldValue(h.field),'Generated {0}');
        assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
    }
});

test('lost start response and interrupted polling reconnect using the original ID without inference replay',async()=>{
    const h=pollingHarness();let body,posts=0,gets=0;const phases=[];
    const update=h.app.ctMtlProgressUpdate;h.app.ctMtlProgressUpdate=(job,value)=>{phases.push(value.phase);return update(job,value);};
    h.app._cloud.request=async(path,options={})=>{
        if(options.method==='POST'){posts++;body=options.body;throw new TypeError('Synthetic connection interruption');}
        gets++;assert.equal(path,'/v1/mtl/requests/'+body.requestId);
        if(gets===1)throw new TypeError('Synthetic connection interruption');
        return gets===2?h.status(body):{candidate:candidate(h.original,body.requestId,body.baseTargetHash)};
    };
    assert.equal(await h.app.ctMtlGenerate(h.field),true);assert.equal(posts,1);assert.equal(gets,3);
    assert.ok(phases.includes('reconnecting'));assert.ok(phases.includes('receiving'));assert.deepEqual(h.app.ctMtlLive,{});
});

test('polling rejects mismatched scope, request, malformed preview and nonmonotonic snapshots safely',async()=>{
    for(const change of [value=>({...value,requestId:'another-request'}),value=>({...value,scope:{...value.scope,language:'German'}}),
        value=>({...value,progress:{...value.progress,translation:'bad\u0000text'}}),value=>({...value,progress:{...value.progress,translation:'x'.repeat(32769)}}),
        value=>({...value,progress:{...value.progress,provisional:false}}),value=>({...value,progress:{...value.progress,phase:'private-internal-phase'}})]){
        const h=pollingHarness();h.app._cloud.request=async(_path,{body})=>change(h.status(body));
        assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.match(h.app.ctMtlError,/does not match/);
        assert.deepEqual(h.app.ctMtlLive,{});assert.deepEqual(h.mtl.list(h.scope),[]);assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
    }
    const h=pollingHarness();let body,gets=0;
    h.app._cloud.request=async(_path,options={})=>{
        if(options.method==='POST'){body=options.body;return h.status(body,{progress:{revision:2,phase:'generating',translation:'Newer {0}',provisional:true}});}
        if(++gets===1)return h.status(body,{progress:{revision:1,phase:'connecting',translation:'Older {0}',provisional:true}});
        assert.equal(h.app.ctMtlProgressFor(h.field).text,'Newer {0}');return{candidate:candidate(h.original,body.requestId,body.baseTargetHash)};
    };
    assert.equal(await h.app.ctMtlGenerate(h.field),true);
});

test('Stop confirms cancellation once and removes preview without candidates or ordinary edits',async()=>{
    const h=pollingHarness();let body,cancels=0,posts=0;
    h.app.ctMtlRequestWait=job=>new Promise(resolve=>{job.wake=resolve;});
    h.app._cloud.request=async(path,options={})=>{
        if(path.endsWith('/cancellations')){cancels++;assert.deepEqual(options.body,{});return h.status(body,{status:'failed',errorCode:'MTL_CANCELLED'});}
        posts++;body=options.body;return h.status(body);
    };
    const pending=h.app.ctMtlGenerate(h.field);await settle();
    assert.equal(h.app.ctMtlProgressFor(h.field).canCancel,true);assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(posts,1);
    const first=h.app.ctMtlCancel(h.field),second=h.app.ctMtlCancel(h.field);assert.equal(await second,false);assert.equal(await first,true);
    assert.equal(await pending,false);assert.equal(cancels,1);assert.deepEqual(h.app.ctMtlLive,{});assert.deepEqual(h.mtl.list(h.scope),[]);
    assert.equal(h.app.ctMtlGenerations[0].status,'failed');assert.match(h.app.ctMtlError,/Translation stopped/);assert.equal(h.app.ctDraftDirty,false);
    assert.equal(h.mtl.getGenerations(h.scope)[0].suppressed,true);
    h.mtl.putCandidate(h.scope,candidate(h.original,body.requestId,body.baseTargetHash));h.app.ctMtlCandidates=h.mtl.list(h.scope);
    assert.equal(h.app.ctMtlCandidate(h.field),null,'A server result delivered after Stop waits for explicit review');
    h.app.ctMtlReset();h.app._ctMtlDescriptors=[descriptor];h.app.ctMtlGenerations=h.mtl.getGenerations(h.scope);h.app.ctMtlCandidates=h.mtl.list(h.scope);
    assert.equal(h.app.ctMtlCandidate(h.field),null,'Stop suppression survives workspace reload');
});

test('pending polling recovers after reload by GET only and authorization loss stops further polls',async()=>{
    const h=pollingHarness();let body,posts=0,gets=0;
    h.app._cloud.request=async(_path,options={})=>{
        if(options.method==='POST'){posts++;body=options.body;throw Object.assign(new Error('Synthetic permission loss'),{status:403});}
        gets++;return gets===1?h.status(body):{candidate:candidate(h.original,body.requestId,body.baseTargetHash)};
    };
    assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(gets,0);assert.equal(h.app.ctMtlGenerations[0].status,'uncertain');
    assert.equal(await h.app.ctMtlGenerate(h.field),true);assert.equal(posts,1);assert.equal(gets,2);
});

test('context boundaries abort polling and clear provisional text before late completion; typing suppresses its overlay',async()=>{
    for(const change of [h=>h.app.cloudSignedIn=false,h=>h.app.cloudUser.assignmentVersion++,h=>h.scope.language='German',h=>h.changeEpoch(),h=>h.field.source='Changed {0}']){
        const h=pollingHarness(),wait=deferred();let body;
        h.app._cloud.request=async(_path,options={})=>{
            if(options.method==='POST'){body=options.body;return h.status(body);}
            await wait.promise;return{candidate:candidate(h.original,body.requestId,body.baseTargetHash)};
        };
        const pending=h.app.ctMtlGenerate(h.field);await settle();assert.ok(h.app.ctMtlProgressFor(h.field));
        change(h);UI.mixin.watch.ctMtlRequestScopeKey.handler.call(h.app);assert.deepEqual(h.app.ctMtlLive,{});
        wait.resolve();assert.equal(await pending,false);assert.deepEqual(h.mtl.list(h.scope),[]);
    }
    const h=pollingHarness(),wait=deferred();let body;
    h.app._cloud.request=async(_path,options={})=>{
        if(options.method==='POST'){body=options.body;return h.status(body);}
        await wait.promise;return{candidate:candidate(h.original,body.requestId,body.baseTargetHash)};
    };
    const pending=h.app.ctMtlGenerate(h.field);await settle();h.app.ctValues[h.field.id]='Typing {0}';h.app.ctEdited(h.field);
    wait.resolve();assert.equal(await pending,true);assert.equal(h.app.ctMtlCandidate(h.field),null);assert.equal(h.app.ctValues[h.field.id],'Typing {0}');
    assert.equal(h.app.ctMtlCount,1);assert.deepEqual(h.app.ctMtlLive,{});
});

test('poll wait is abortable and does not keep a timer after a context change',async()=>{
    const h=harness(),controller=new AbortController(),job={controller};
    const pending=h.app.ctMtlRequestWait(job,10000);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(job.wake,null);
});

test('poll rate limits back off and resume the same snapshot stream; terminal expiry never regenerates',async()=>{
    const h=pollingHarness(),delays=[];let body,gets=0,posts=0;
    h.app.ctMtlRequestWait=async(_job,delay)=>{delays.push(delay);};
    h.app._cloud.request=async(_path,options={})=>{
        if(options.method==='POST'){posts++;body=options.body;return h.status(body);}
        if(++gets<=2)throw Object.assign(new Error('Synthetic rate limit'),{status:429});
        if(gets===3)return h.status(body,{progress:{revision:2,phase:'validating',translation:'Working {0}',provisional:true}});
        return h.status(body,{status:'completed',errorCode:'MTL_RESULT_EXPIRED',progress:undefined});
    };
    assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.deepEqual(delays,[250,500,1000,250]);assert.equal(posts,1);
    assert.match(h.app.ctMtlError,/no longer available/);assert.deepEqual(h.app.ctMtlLive,{});assert.equal(h.app.ctMtlGenerations[0].status,'failed');
    assert.deepEqual(h.mtl.list(h.scope),[]);assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
});

test('poll authorization rejection stops reads and preserves the original recoverable request',async()=>{
    const h=pollingHarness();let body,calls=0;
    h.app._cloud.request=async(_path,options={})=>{
        calls++;if(options.method==='POST'){body=options.body;return h.status(body);}
        throw Object.assign(new Error('Synthetic access revoked'),{status:403});
    };
    assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(calls,2);assert.deepEqual(h.app.ctMtlLive,{});
    assert.equal(h.app.ctMtlGenerations[0].requestId,body.requestId);assert.equal(h.app.ctMtlGenerations[0].status,'uncertain');
    assert.match(h.app.ctMtlError,/access revoked/);assert.deepEqual(h.mtl.list(h.scope),[]);
});

test('Admin details preview is read-only, sends no inference, and ordinary roles cannot inspect',async()=>{
    const h=debugHarness();let calls=0;h.app._cloud.request=async()=>{calls++;throw new Error('No request expected');};
    assert.equal(await h.app.ctMtlDebugOpen(h.field),true);assert.equal(h.app.ctMtlDebugWindow.record.status,'preview');
    assert.equal(h.app.ctMtlDebugWindow.record.snapshot.source,h.field.source);assert.equal(calls,0);
    for(const role of ['translator','manager']){
        h.app.cloudUser={...h.app.cloudUser,role,isAdmin:role==='manager'};h.app.ctMtlDebugReset();
        assert.equal(await h.app.ctMtlDebugOpen(h.field),false);assert.equal(h.app.ctMtlDebugWindow,null);
    }
    h.app.cloudUser={...h.app.cloudUser,role:'admin',isAdmin:true};h.app.cloudProfileId='different-account';
    assert.equal(await h.app.ctMtlDebugOpen(h.field),false);
    assert.equal(calls,0);assert.deepEqual(h.app.ctValues,S.valuesFor(h.original));
});

test('Admin details show submitted context and escaped/redacted server data without persisting diagnostics',async()=>{
    const h=debugHarness(),requests=[],generate=h.app._cloud.request;
    h.app._cloud.request=async(path,options)=>{requests.push(path);return path.includes('/debug')
        ?{diagnostics:{providerRequest:{instructions:'<img src=x onerror=alert(1)>',input:[]},context:{accessToken:'secret-context'},validation:'passed'}}
        :generate(path,options);};
    assert.equal(await h.app.ctMtlGenerate(h.field),true);assert.equal(requests.length,1);
    assert.equal(await h.app.ctMtlDebugOpen(h.field),true);assert.equal(requests.length,2);assert.match(requests[1],/^\/v1\/admin\/mtl\/requests\/.*\/debug$/);
    const record=h.app.ctMtlDebugWindow.record;
    assert.equal(record.snapshot.source,h.field.source);assert.equal(record.server.context.accessToken,'[redacted]');
    assert.equal(record.server.providerRequest.instructions,'<img src=x onerror=alert(1)>');
    assert.equal(JSON.stringify(h.mtl.getGenerations(h.scope)).includes('providerRequest'),false);
    assert.equal(JSON.stringify(h.mtl.list(h.scope)).includes('instructions'),false);
    assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.deepEqual(h.app.ctMtlAcceptances(),[]);
    h.app.ctMtlReset();assert.equal(h.app.ctMtlDebugWindow,null);assert.deepEqual(h.app.ctMtlDebugRecords,{});
});

test('late diagnostics cannot return after account/language/source/context changes or logout',async()=>{
    for(const change of [h=>h.app.cloudSignedIn=false,h=>h.app.cloudUser.role='manager',h=>h.scope.language='German',h=>h.field.source='Changed source']){
        const h=debugHarness(),wait=deferred();h.app.ctMtlDebugBegin(h.field,{requestId:'synthetic',context:{}});
        h.app._cloud.request=()=>wait.promise;
        const pending=h.app.ctMtlDebugOpen(h.field);await settle();change(h);Debug.mixin.watch.ctMtlDebugOrigin.call(h.app);
        wait.resolve({diagnostics:{source:'late private context'}});await pending;
        assert.equal(h.app.ctMtlDebugWindow,null);assert.deepEqual(h.app.ctMtlDebugRecords,{});
    }
});

test('preview redacts embedded credential-like values and diagnostic template uses escaped text',()=>{
    const value=Debug.redact({refresh_token:'synthetic-secret',source:'Bearer synthetic-token accessToken="synthetic-value" sk-syntheticsecret123'});
    assert.doesNotMatch(JSON.stringify(value),/synthetic/);assert.doesNotMatch(Debug.Dialog.template,/v-html/);
    assert.match(Debug.Dialog.template,/<pre[^>]*>\{\{ section === 'request' \? details : responseText \}\}<\/pre>/);
});

test('all MTL settings use neutral wording and retain an honest accessible data-sharing disclosure',()=>{
    const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/index.html'),'utf8');
    const settings=html.split('<section id="settings-panel-mtl"')[1].split('</section>')[0];
    assert.doesNotMatch(settings.replace(/<[^>]*>/g,''),/OpenAI|ChatGPT|gpt-6|\bmodels?\b|\bAI\b/i);
    assert.match(settings,/<summary>MTL data sharing and privacy<\/summary>[\s\S]*bounded relevant workbook context[\s\S]*external translation service/);
    assert.match(settings,/human review and Save before they replace the prior saved or original translation/);
});

test('debug displays selected prompt/context/response without connection configuration or rewriting quoted text',()=>{
    const quote='Source text mentions AI, OpenAI, ChatGPT and model names literally.';
    const record={requestId:'synthetic-request',status:'completed',snapshot:{unit:{id:'unit',sheet:'ClientStrings'},field:{id:'field',kind:'text'},source:quote,context:{notes:[quote]}},
        server:{status:'completed',provider:'synthetic-provider',model:'synthetic-model',providerRequest:{model:'synthetic-model',reasoning:{effort:'synthetic-effort'},instructions:'Translate the selected field.',input:[{role:'user',content:quote}]},
            response:{translation:quote,model:'synthetic-model'},upstreamResponse:{contentType:'text/event-stream; charset=utf-8',hasBody:true,readableBody:true,bodyUsed:false,bodyLocked:false,redirected:false,responseType:'cors',
                model:'synthetic-model',provider:'synthetic-provider',headers:{Authorization:'synthetic-secret'},body:'synthetic-upstream-body',url:'synthetic-upstream-url'},validation:'passed',elapsedMs:3}};
    const shown=Debug.present(record);
    assert.equal(shown.source,quote);assert.equal(shown.context.notes[0],quote);
    assert.equal(shown.prompt.instructions,record.server.providerRequest.instructions);assert.equal(shown.prompt.messages[0].content,quote);assert.equal(shown.response.translation,quote);
    assert.equal(shown.model,undefined);assert.equal(shown.provider,undefined);assert.equal(shown.response.model,undefined);
    assert.deepEqual(shown.upstreamResponse,{contentType:'text/event-stream; charset=utf-8',hasBody:true,readableBody:true,bodyUsed:false,bodyLocked:false,redirected:false,responseType:'cors'});
    assert.doesNotMatch(JSON.stringify(shown),/synthetic-model|synthetic-provider|synthetic-effort|providerRequest|synthetic-secret|synthetic-upstream/);
    assert.equal(Debug.present({...record,server:{...record.server,response:null}}).response,null,'A missing executed response remains explicitly null');
    assert.match(Debug.Dialog.template,/Prompt and context/);assert.match(Debug.Dialog.template,/Selected fields from the executed request/);
});

test('selected debug presentation includes only bounded structural stream summary and precise protocol check',()=>{
    const record={requestId:'synthetic-stream',status:'failed',server:{status:'failed',response:null,failureReason:'response_shape',
        protocolCheck:'completion_output',protocolExplanation:'The completed response did not contain an output array.',
        streamSummary:{events:4,completedEventSeen:true,eventKind:'object',eventType:'response.completed',eventTypeKind:'string',sseEventType:'response.completed',
            responseKind:'object',responseStatus:'missing',outputKind:'missing',outputItems:0,outputItemTypes:['message','synthetic private type'],
            contentTypes:['output_text'],textValueTypes:['string'],outputTextCharacters:22,outputItemsTruncated:false,contentPartsTruncated:false,
            textDeltaEvents:0,textDoneEvents:2,contentPartDoneEvents:1,outputItemDoneEvents:0,reconstructedOutput:true,
            text:'synthetic raw output',delta:'synthetic partial translation',reasoning:'synthetic hidden reasoning',model:'synthetic-model',provider:'synthetic-provider',
            reconstructedText:'synthetic raw reconstructed text',reconstructedReasoning:'synthetic hidden reconstructed reasoning',
            response:{output:'synthetic raw response'},headers:{Authorization:'synthetic secret'},url:'synthetic private endpoint'}}};
    const shown=JSON.parse(Debug.Dialog.computed.details.call({item:{record}}));
    assert.equal(shown.protocolCheck,'completion_output');assert.equal(shown.protocolExplanation,record.server.protocolExplanation);
    assert.equal(shown.streamSummary.events,4);assert.equal(shown.streamSummary.completedEventSeen,true);
    assert.equal(shown.streamSummary.responseStatus,'missing');assert.equal(shown.streamSummary.outputKind,'missing');
    assert.equal(shown.streamSummary.outputTextCharacters,22);assert.deepEqual(shown.streamSummary.outputItemTypes,['message','other']);
    assert.deepEqual(shown.streamSummary.contentTypes,['output_text']);assert.deepEqual(shown.streamSummary.textValueTypes,['string']);
    assert.equal(shown.streamSummary.textDeltaEvents,0);assert.equal(shown.streamSummary.textDoneEvents,2);
    assert.equal(shown.streamSummary.contentPartDoneEvents,1);assert.equal(shown.streamSummary.outputItemDoneEvents,0);assert.equal(shown.streamSummary.reconstructedOutput,true);
    assert.doesNotMatch(JSON.stringify(shown),/synthetic raw|synthetic partial|synthetic hidden|synthetic-model|synthetic-provider|synthetic secret|synthetic private/);
    const oversized=Debug.present({...record,server:{...record.server,streamSummary:{...record.server.streamSummary,events:Infinity,outputItemTypes:Array(30).fill('message')}}});
    assert.equal(oversized.streamSummary.events,null);assert.equal(oversized.streamSummary.outputItemTypes.length,16);
    const counts=['textDeltaEvents','textDoneEvents','contentPartDoneEvents','outputItemDoneEvents'];
    const zeros=Debug.present({...record,server:{...record.server,streamSummary:{...record.server.streamSummary,...Object.fromEntries(counts.map(field=>[field,0])),reconstructedOutput:false}}});
    for(const field of counts)assert.equal(zeros.streamSummary[field],0);
    assert.equal(zeros.streamSummary.reconstructedOutput,false);
    for(const invalid of [-1,0.5,Infinity,2*1024*1024+1]){
        const bounded=Debug.present({...record,server:{...record.server,streamSummary:{...record.server.streamSummary,...Object.fromEntries(counts.map(field=>[field,invalid]))}}});
        for(const field of counts)assert.equal(bounded.streamSummary[field],null);
    }
});

test('a proxy-masked generation failure reads the original job once and presents its validation failure without another POST',async()=>{
    const h=harness(),calls=[];let requestId;
    h.app._cloud.request=async(path,options={})=>{calls.push({path,method:options.method||'GET'});
        if(options.method==='POST'){requestId=options.body.requestId;throw new TypeError('NetworkError when attempting to fetch resource.');}
        assert.equal(path,'/v1/mtl/requests/'+requestId);return{status:'failed',errorCode:'MTL_OUTPUT_INVALID'};};
    assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.deepEqual(calls.map(call=>call.method),['POST','GET']);
    assert.match(h.app.ctMtlError,/invalid or incomplete translation/);assert.doesNotMatch(h.app.ctMtlError,/NetworkError/);
    assert.equal(h.app.ctMtlGenerations[0].status,'failed');assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
});

test('an explicit HTTP 422 rejection ends the request without a pending recovery or another provider POST',async()=>{
    const h=harness();let calls=0;
    h.app._cloud.request=async()=>{calls++;throw Object.assign(new Error('MTL returned an invalid or incomplete translation. The existing text is unchanged.'),{status:422,code:'MTL_OUTPUT_INVALID'});};
    assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(calls,1);
    assert.equal(h.app.ctMtlGenerations[0].status,'failed');assert.equal(h.app.ctMtlPendingGeneration(h.field),null);
    assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.match(h.app.ctMtlError,/invalid or incomplete/);
});

test('Admin can inspect a precise protocol reason after a proxy masks a 502, without another inference',async()=>{
    const h=debugHarness(),calls=[];
    h.app._cloud.request=async(path,options={})=>{calls.push({path,method:options.method||'GET'});
        if(options.method==='POST')throw new TypeError('NetworkError when attempting to fetch resource.');
        if(path.endsWith('/debug'))return{diagnostics:{status:'failed',upstreamStatus:200,apiStatus:502,failureReason:'stream_json',validation:'not completed',validationReason:'An event-stream data record was not valid JSON.'}};
        return{status:'failed',errorCode:'MTL_OUTPUT_INVALID'};};
    assert.equal(await h.app.ctMtlGenerate(h.field),false);
    assert.equal(await h.app.ctMtlDebugOpen(h.field),true);
    assert.deepEqual(calls.map(call=>call.method),['POST','GET','GET']);
    assert.equal(h.app.ctMtlDebugWindow.record.server.failureReason,'stream_json');
    assert.equal(h.app.ctMtlDebugWindow.record.server.upstreamStatus,200);assert.equal(h.app.ctMtlDebugWindow.record.server.apiStatus,502);
    assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
});

test('unavailable status keeps a network-uncertain request recoverable and cannot publish across context changes',async()=>{
    for(const changed of [false,true]){
        const h=harness();let calls=0;
        h.app._cloud.request=async(_path,options={})=>{calls++;if(options.method==='POST')throw new TypeError('Failed to fetch');
            if(changed)h.changeEpoch();throw new TypeError('Failed to fetch');};
        assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(calls,2);
        assert.equal(h.mtl.getGenerations(h.scope)[0].status,'uncertain');assert.equal(h.app.ctMtlError,changed?'': 'Failed to fetch');
    }
});

test('HTML proxy responses through the real cloud JSON reader recover once without repeating inference',async()=>{
    const Cloud=require('../public/cloudSync.js');
    for(const lookupFails of [false,true]){
        const h=harness(),calls=[];let originalError,requestId;
        const client={apiBase:'https://synthetic.invalid',context:()=>({token:null}),permissionsCurrent:()=>true,
            fetcher:async(url,options)=>{const path=new URL(url).pathname;calls.push({path,method:options.method});
                if(options.method==='POST'){
                    requestId=JSON.parse(options.body).requestId;
                    return new Response('<html>Synthetic proxy error</html>',{status:502,headers:{'Content-Type':'text/html'}});
                }
                assert.equal(path,'/v1/mtl/requests/'+requestId);
                if(lookupFails)throw new Error('Synthetic status lookup unavailable');
                return new Response(JSON.stringify({status:'failed',errorCode:'MTL_OUTPUT_INVALID'}),{headers:{'Content-Type':'application/json'}});
            }};
        h.app._cloud.request=async(path,options)=>{try{return await Cloud.Client.prototype.request.call(client,path,options);}
            catch(error){if(options?.method==='POST')originalError=error;throw error;}};
        assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(originalError.name,'SyntaxError');
        assert.deepEqual(calls.map(call=>call.method),['POST','GET']);
        assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.equal(h.app.ctMtlCandidates.length,0);
        assert.equal(h.mtl.getGenerations(h.scope)[0].status,lookupFails?'uncertain':'failed');
        if(lookupFails)assert.equal(h.app.ctMtlError,originalError.message,'A failed status lookup preserves the original request error');
        else {assert.match(h.app.ctMtlError,/invalid or incomplete translation/);assert.doesNotMatch(h.app.ctMtlError,/Unexpected token|not valid JSON/);}
    }
});
test('all proxy input writes edit only the separate review until explicit Accept',async()=>{
    const h=harness();await h.put();
    assert.equal(h.app.ctInputValues[h.field.id],'Generated {0}');
    h.app.ctInputValues[h.field.id]='Reviewed {0}';h.app.ctEdited(h.field);await h.reviews();
    assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.deepEqual(h.app.ctReviewed,{});assert.equal(h.app.ctDraftDirty,false);
    assert.equal(h.ordinaryEdits(),0);assert.equal(h.mtl.getReview(h.scope,h.original.id,h.field.id).text,'Reviewed {0}');
    assert.deepEqual(h.app.ctMtlAcceptances(),[]);
    assert.equal(await h.app.ctMtlAccept(h.field),true);
    assert.equal(h.app.ctValues[h.field.id],'Reviewed {0}');assert.equal(h.ordinaryEdits(),1);assert.equal(h.app.ctDraftDirty,true);
    assert.equal(h.app.ctMtlCandidate(h.field),null);assert.equal(h.app.ctMtlAcceptances()[0].reviewedTextHash,S.hash('Reviewed {0}'));
    assert.equal(h.mtl.getReview(h.scope,h.original.id,h.field.id).previousValue,'Confirmed {0}');
    assert.equal(h.app.ctMtlCount,1); // Candidate remains pending until the ordinary save transaction.
});
test('Dismiss restores underlying draft and never marks Source reviewed',async()=>{
    const h=harness();h.app.ctValues[h.field.id]='Unconfirmed draft {0}';await h.put();
    await h.app.ctMtlShow(h.field);
    h.app.ctInputValues[h.field.id]='Edited MTL {0}';await h.reviews();
    assert.equal(await h.app.ctMtlDismiss(h.field),true);
    assert.equal(h.app.ctInputValues[h.field.id],'Unconfirmed draft {0}');assert.equal(h.app.ctMtlCount,0);
    assert.deepEqual(h.app.ctReviewed,{});assert.equal(h.ordinaryEdits(),0);
});

test('explicit dismissal captures the original output and edited rejection once, preserving the ordinary draft',async()=>{
    const h=harness();h.scope.groupId='local:test:dismiss';h.app.ctValues[h.field.id]='Underlying draft {0}';const c=await h.put();
    await h.app.ctMtlShow(h.field);h.app.ctInputValues[h.field.id]='Rejected edit {0}';await h.reviews();
    const wait=deferred(),dismiss=h.mtl.dismiss;let staged=0;
    h.mtl.dismiss=async(...args)=>{staged++;await wait.promise;return dismiss(...args);};
    const first=h.app.ctMtlDismiss(h.field);assert.equal(h.app.ctMtlDismissBusyFor(h.field),true);
    assert.equal(await h.app.ctMtlDismiss(h.field),false);assert.equal(await h.app.ctMtlGenerate(h.field),false);
    assert.equal(await h.app.ctMtlAccept(h.field),false);assert.equal(await h.app.ctMtlShow(h.field),false);
    wait.resolve();assert.equal(await first,true);assert.equal(staged,1);assert.equal(h.app.ctMtlDismissBusyFor(h.field),false);
    const op=h.mtl.getOutbox(h.scope)[0];assert.equal(op.candidateId,c.id);assert.equal(op.requestBody.generatedText,c.generatedText);
    assert.equal(op.requestBody.reviewedText,'Rejected edit {0}');assert.equal(h.app.ctMtlPendingDismissal(h.field).mutationId,op.mutationId);
    assert.equal(h.app.ctMtlFieldValue(h.field),'Underlying draft {0}');assert.deepEqual(h.app.ctReviewed,{});assert.equal(h.app.ctDraftDirty,false);
    assert.equal(h.app.ctMtlCanGenerate(h.field),false);assert.match(h.app.ctMtlHint(h.field),/pending dismissal/);
});

test('legacy candidates require explicit v2 retention consent before a new dismissal can stage edited rejection text',async()=>{
    for(const consent of ['', 'mtl-v1','mtl-v2']){
        const h=harness();h.scope.groupId='local:test:legacy-consent';h.app.mtlConsentVersion=consent;
        const c=await h.put(candidate(h.original,'legacy-v1-request'));await h.app.ctMtlShow(h.field);
        h.app.ctInputValues[h.field.id]='Legacy edited rejection {0}';await h.reviews();
        const before=structuredClone(h.app.ctMtlReviews),dismiss=h.mtl.dismiss;let staged=0;
        h.mtl.dismiss=(...args)=>{staged++;return dismiss(...args);};
        assert.equal(await h.app.ctMtlDismiss(h.field),consent==='mtl-v2');
        assert.equal(staged,consent==='mtl-v2'?1:0);assert.equal(h.app.mtlConsentVersion,consent,'no implicit consent promotion');
        const operations=h.mtl.getOutbox(h.scope);
        if(consent==='mtl-v2'){
            assert.equal(operations.length,1);assert.equal(operations[0].requestBody.generatedText,c.generatedText);
            assert.equal(operations[0].requestBody.reviewedText,'Legacy edited rejection {0}');
        }else{
            assert.deepEqual(operations,[]);assert.equal(h.mtl.getCandidate(h.scope,c.id).status,'pending');
            assert.deepEqual(h.app.ctMtlReviews,before);assert.match(h.app.ctMtlError,/updated.*private review-retention/);
        }
        assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.deepEqual(h.app.ctReviewed,{});
    }
});

test('revoking retention consent before the async dismissal storage guard prevents staging',async()=>{
    for(const consent of ['', 'mtl-v1']){
        const h=harness(),wait=deferred();h.scope.groupId='local:test:consent-guard';const c=await h.put(candidate(h.original,'legacy-v1-request'));
        await h.app.ctMtlShow(h.field);h.app.ctInputValues[h.field.id]='Private edited rejection {0}';await h.reviews();
        const before=structuredClone(h.app.ctMtlReviews),dismiss=h.mtl.dismiss;
        h.mtl.dismiss=async(...args)=>{await wait.promise;return dismiss(...args);};
        const pending=h.app.ctMtlDismiss(h.field);assert.equal(h.app.ctMtlDismissBusyFor(h.field),true);
        h.app.mtlConsentVersion=consent;wait.resolve();assert.equal(await pending,false);
        assert.deepEqual(h.mtl.getOutbox(h.scope),[]);assert.equal(h.mtl.getCandidate(h.scope,c.id).status,'pending');
        assert.deepEqual(h.app.ctMtlReviews,before);assert.equal(h.app.ctMtlDismissBusyFor(h.field),false);
    }
});

test('previously consented pending dismissal retries retain their exact command after consent is withdrawn',async t=>{
    const previous=globalThis.ClientTextMtlSync;globalThis.ClientTextMtlSync=require('../public/clientTextMtlSync.js');t.after(()=>{globalThis.ClientTextMtlSync=previous;});
    for(const consent of ['', 'mtl-v1']){
        const h=harness();h.scope.groupId='local:test:consent-retry';const c=await h.put(candidate(h.original,'legacy-v1-request'));
        await h.app.ctMtlShow(h.field);h.app.ctInputValues[h.field.id]='Authorized edited rejection {0}';await h.reviews();
        let fail=true;const calls=[];h.app._cloud.request=async(path,options)=>{calls.push({path,body:structuredClone(options.body)});
            if(fail)throw Object.assign(new Error('Private file pending'),{status:503,code:'MTL_REVIEW_ARCHIVE_PENDING'});
            return{dismissal:{candidateId:c.id,requestId:c.requestId,status:'dismissed',revision:2},archive:{id:'mtl-review_'+'a'.repeat(64),format:'sdeditor-mtl-dismissal-v1',status:'saved'}};
        };
        try{
            assert.equal(await h.app.ctMtlDismiss(h.field),true);await h.app.ctMtlSync();
            const original=structuredClone(h.mtl.getOutbox(h.scope)[0].requestBody);assert.equal(original.reviewedText,'Authorized edited rejection {0}');
            h.app.mtlConsentVersion=consent;UI.mixin.watch.ctMtlRequestScopeKey.handler.call(h.app);await settle();fail=false;
            assert.equal(await h.app.ctMtlRetryDismissals(),true);assert.deepEqual(h.mtl.getOutbox(h.scope),[]);
            assert.equal(h.app.mtlConsentVersion,consent);assert.ok(calls.every(value=>JSON.stringify(value.body)===JSON.stringify(original)));
            assert.ok(calls.length>=2);assert.ok(calls.every(value=>value.path.endsWith('/dismissals')),'retry never invokes generation');
        }finally{h.app.ctMtlReset();}
    }
});

test('new translation requires explicit v2 retention consent and an archive-capable server; v1 recovery remains GET-only',async()=>{
    const h=harness();let requests=0;h.app._cloud.request=async()=>{requests++;throw new Error('No generation expected');};
    h.app.mtlConsentVersion='mtl-v1';assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.match(h.app.ctMtlError,/updated.*retention/);
    h.app.mtlConsentVersion='mtl-v2';h.app.ctMtlCapabilities={enabled:true,consentVersion:'mtl-v1'};
    assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.match(h.app.ctMtlError,/upgrade/);
    await h.put();assert.equal(await h.app.ctMtlDismiss(h.field),false);assert.equal(h.mtl.getOutbox(h.scope).length,0);assert.equal(requests,0);
    h.app.ctMtlGenerations=[h.mtl.putGeneration(h.scope,{requestId:'old-v1',unitId:h.original.id,fieldId:h.field.id,status:'uncertain',
        sourceHash:S.sourceHash(h.field.source),rawSourceHash:M.rawSourceHash(h.field.source),assetHash:descriptor.assetHash,parserVersion:descriptor.parserVersion,
        baseTargetHash:S.hash(h.field.target),createdAt:1,requestBodyHash:'a'.repeat(64)})];
    h.app.mtlConsentVersion='mtl-v1';h.app._cloud.request=async(path,options={})=>{requests++;assert.equal(options.method,undefined);assert.equal(path,'/v1/mtl/requests/old-v1');return{candidate:candidate(h.original,'old-v1')};};
    assert.equal(await h.app.ctMtlGenerate(h.field),true);assert.equal(requests,1);
});

test('archive-pending stays visible until its own receipt and account changes fence retries and late acknowledgements',async t=>{
    const previous=globalThis.ClientTextMtlSync;globalThis.ClientTextMtlSync=require('../public/clientTextMtlSync.js');t.after(()=>{globalThis.ClientTextMtlSync=previous;});
    const h=harness();h.scope.groupId='local:test:archive-ui';await h.put();const calls=[];let fail=true,wait;
    h.app._cloud.request=async(path,options={})=>{calls.push({path,body:structuredClone(options.body)});
        if(fail)throw Object.assign(new Error('Dismissed on server; private review file is pending.'),{status:503,code:'MTL_REVIEW_ARCHIVE_PENDING'});
        if(wait)await wait.promise;
        return{dismissal:{candidateId:options.body.candidateId,requestId:path.split('/').at(-2),status:'dismissed',revision:2},archive:{id:'mtl-review_'+'a'.repeat(64),format:'sdeditor-mtl-dismissal-v1',status:'saved'}};
    };
    t.after(()=>h.app.ctMtlReset());assert.equal(await h.app.ctMtlDismiss(h.field),true);await h.app.ctMtlSync();
    assert.equal(h.app.ctMtlDismissals[0].state,'archive-pending');assert.match(h.app.ctMtlDismissalText(h.app.ctMtlDismissals[0]),/file is still pending/);
    assert.match(h.app.ctMtlError,/private review file/);h.app.ctMtlClearOperationError();assert.match(h.app.ctMtlError,/private review file/);
    fail=false;wait=deferred();const retry=h.app.ctMtlRetryDismissals();await settle();assert.ok(calls.length>=2);
    const before=calls.length;h.app.cloudSignedIn=false;UI.mixin.watch.ctMtlRequestScopeKey.handler.call(h.app);wait.resolve();await retry;await settle();
    assert.equal(h.mtl.getOutbox(h.scope).length,1);assert.deepEqual(h.app.ctMtlDismissals,[]);assert.equal(h.app._ctMtlSync,null);
    assert.equal(await h.app.ctMtlRetryDismissals(),false);assert.equal(calls.length,before);
    h.app.cloudSignedIn=true;wait=null;UI.mixin.watch.ctMtlRequestScopeKey.handler.call(h.app);await settle();await h.app.ctMtlRetryDismissals();
    assert.equal(h.app.ctMtlDismissals.length,0);assert.equal(h.app.ctMtlError,'');
    assert.ok(calls.every(value=>JSON.stringify(value)===JSON.stringify(calls[0])),'every retry has the original path and body');
});

test('access or source changes while dismissal is checkpointing cannot stage a new archive command',async()=>{
    for(const change of [h=>{h.app.cloudSignedIn=false;},h=>{h.original.fields[0]={...h.field,source:'Changed {0}'};}]){
        const h=harness();h.scope.groupId='local:test:fenced';await h.put();const wait=deferred(),dismiss=h.mtl.dismiss;
        h.mtl.dismiss=async(...args)=>{await wait.promise;return dismiss(...args);};
        const pending=h.app.ctMtlDismiss(h.field);change(h);wait.resolve();assert.equal(await pending,false);assert.deepEqual(h.mtl.getOutbox(h.scope),[]);
    }
});

test('late queue reads cannot restore stale pending notices after newer reads or logout',async()=>{
    for(const logout of [false,true]){
        const h=harness(),wait=deferred();h.scope.groupId='local:test:read-guard';await h.put();await h.app.ctMtlDismiss(h.field);
        const operations=h.mtl.getOutbox(h.scope),read=h.mtl.getOutbox;
        h.mtl.getOutbox=()=>wait.promise;const pending=h.app.ctMtlRefreshDismissals();
        if(logout){h.app.cloudSignedIn=false;UI.mixin.watch.ctMtlRequestScopeKey.handler.call(h.app);}
        else{h.mtl.getOutbox=()=>[];await h.app.ctMtlRefreshDismissals();}
        wait.resolve(operations);assert.equal(await pending,false);assert.deepEqual(h.app.ctMtlDismissals,[]);h.mtl.getOutbox=read;
    }
});

test('workspace-level explicit retry can resend a conflict from another selected field without changing its body',async t=>{
    const previous=globalThis.ClientTextMtlSync;globalThis.ClientTextMtlSync=require('../public/clientTextMtlSync.js');t.after(()=>{globalThis.ClientTextMtlSync=previous;});
    const h=harness();h.scope.groupId='local:test:conflict';const c=await h.put();
    h.mtl.dismiss(h.scope,c,{mutationId:'exact-conflict',reviewedText:'Rejected',archiveRequired:true,consentVersion:'mtl-v2'});
    h.mtl.markSending(h.scope,'exact-conflict','conflict');await h.app.ctMtlRefreshDismissals();const original=h.mtl.getOutbox(h.scope)[0].requestBody;
    const calls=[];h.app._cloud.request=async(path,options)=>{calls.push({path,body:options.body});return{dismissal:{candidateId:c.id,requestId:c.requestId,status:'dismissed',revision:2},
        archive:{id:'mtl-review_'+'a'.repeat(64),format:'sdeditor-mtl-dismissal-v1',status:'saved'}};};
    t.after(()=>h.app.ctMtlReset());assert.equal(await h.app.ctMtlRetryDismissals(),true);assert.equal(calls.length,1);assert.deepEqual(calls[0].body,original);
    assert.deepEqual(h.app.ctMtlDismissals,[]);
});
test('source changes hide exact-bound candidates silently, including normalized audio markers',async()=>{
    const h=harness();await h.put();h.original.fields[0]={...h.field,source:'[NOAUDIO] '+h.field.source};
    const field=h.original.fields[0];assert.equal(S.sourceHash(h.field.source),S.sourceHash(field.source));
    assert.equal(h.app.ctMtlPendingCandidate(field),null);assert.equal(h.app.ctMtlCount,0);assert.equal(h.app.ctMtlError,'');
});
test('late generation after typing then undo never replaces the latest ordinary field',async()=>{
    const h=harness(),wait=deferred();let sent;
    h.app._cloud.request=async(path,options)=>{sent=options.body;await wait.promise;return{candidate:candidate(h.original,sent.requestId,sent.baseTargetHash)}};
    const pending=h.app.ctMtlGenerate(h.field);await settle();assert.equal(h.app.ctMtlBusy(h.field),true);
    h.app.ctValues[h.field.id]='Typing {0}';h.app.ctEdited(h.field);
    h.app.ctValues[h.field.id]='Confirmed {0}';h.app.ctEdited(h.field);
    wait.resolve();assert.equal(await pending,true);assert.equal(h.app.ctMtlBusy(h.field),false);
    assert.equal(h.app.ctMtlCandidate(h.field),null);assert.equal(h.app.ctInputValues[h.field.id],'Confirmed {0}');assert.equal(h.app.ctMtlCount,1);
    assert.equal(await h.app.ctMtlShow(h.field),true);assert.equal(h.app.ctInputValues[h.field.id],'Generated {0}');
});
test('late results cannot publish after account, assignment, source or scope changes',async()=>{
    for(const change of [h=>h.changeEpoch(),h=>h.app.cloudUser.assignmentVersion++,h=>h.app.cloudUser.language='German',h=>h.field.source='Different {0}']){
        const h=harness(),wait=deferred();let body;
        h.app._cloud.request=async(path,options)=>{body=options.body;await wait.promise;return{candidate:candidate(h.original,body.requestId,body.baseTargetHash)}};
        const pending=h.app.ctMtlGenerate(h.field);await settle();change(h);wait.resolve();assert.equal(await pending,false);
        assert.equal(h.app.ctMtlCandidates.length,0);assert.equal(h.app.ctMtlError,'');
    }
});
test('network failure and invalid structural output preserve ordinary text and prior candidate',async()=>{
    const h=harness();await h.put();const previous=h.app.ctMtlCandidates[0];
    h.app._cloud.request=async()=>{throw new Error('Provider unavailable');};
    assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(h.app.ctMtlError,'Provider unavailable');
    h.app._cloud.request=async()=>{throw Object.assign(new Error('Not found'),{status:404});};
    assert.equal(await h.app.ctMtlGenerate(h.field),false);
    h.app._cloud.request=async(path,{body})=>({candidate:candidate(h.original,body.requestId,body.baseTargetHash,{generatedText:'Lost placeholder'})});
    assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
    assert.deepEqual(h.app.ctMtlCandidates,[previous]);
});
test('an uncertain generation is retrieved by the original request ID without another POST',async()=>{
    const h=harness();let posts=0,gets=0,body;
    h.app._cloud.request=async(path,options={})=>{
        if(options.method==='POST'){posts++;body=options.body;throw new Error('Connection lost');}
        gets++;assert.equal(path,'/v1/mtl/requests/'+body.requestId);
        return{candidate:candidate(h.original,body.requestId,body.baseTargetHash)};
    };
    assert.equal(await h.app.ctMtlGenerate(h.field),false);
    assert.equal(h.mtl.getGenerations(h.scope,{activeOnly:true}).length,1);
    assert.equal(await h.app.ctMtlGenerate(h.field),true);
    assert.equal(posts,1);assert.equal(gets,1);assert.equal(h.mtl.getGenerations(h.scope,{activeOnly:true}).length,0);
    assert.equal(h.app.ctInputValues[h.field.id],'Generated {0}');
});
test('journal survives reload and typing suppression prevents event-delivered overlays',async()=>{
    const h=harness();let body;
    h.app._cloud.request=async(path,options)=>{body=options.body;throw new Error('Connection lost');};
    assert.equal(await h.app.ctMtlGenerate(h.field),false);
    h.app.ctValues[h.field.id]='Typing {0}';h.app.ctEdited(h.field);
    h.app.ctValues[h.field.id]='Confirmed {0}';h.app.ctEdited(h.field);await settle();
    const journal=h.mtl.getGenerations(h.scope)[0];assert.equal(journal.suppressed,true);
    h.app.ctMtlReset();h.app._ctMtlDescriptors=[descriptor];h.app.ctMtlGenerations=h.mtl.getGenerations(h.scope);
    h.mtl.putCandidate(h.scope,candidate(h.original,body.requestId,body.baseTargetHash));h.app.ctMtlCandidates=h.mtl.list(h.scope);
    assert.equal(h.app.ctMtlCandidate(h.field),null);assert.equal(h.app.ctMtlCount,1);
    assert.equal(await h.app.ctMtlShow(h.field),true);assert.equal(h.app.ctInputValues[h.field.id],'Generated {0}');
});
test('local generation carries game/language/branch and uses only disposable memory',async()=>{
    const h=harness();h.scope.groupId='local:test:mtl';let path,body;
    h.app._cloud.request=async(url,options)=>{path=url;body=options.body;return{candidate:candidate(h.original,body.requestId,body.baseTargetHash)}};
    assert.equal(await h.app.ctMtlGenerate(h.field),true);
    assert.equal(path,'/v1/mtl/local/requests');assert.equal(body.game,'poe2');assert.equal(body.language,'Thai');assert.equal(body.branchId,'default');
    h.mtl.dispose();h.app.ctMtlReset();assert.equal(h.app.ctMtlCount,0);assert.throws(()=>h.mtl.list(h.scope),/disposed/);
});
test('opening an explicit local workbook performs no capability or provider request',async()=>{
    const h=harness();h.scope.groupId='local:test:no-network';let calls=0;
    h.app._cloud.request=async()=>{calls++;return{enabled:false};};h.app.ctMtlCapabilities=null;
    assert.equal(await h.app.ctMtlActivate(),true);assert.equal(calls,0);assert.equal(h.app.ctMtlCapabilities,null);
    assert.equal(h.app.ctMtlCanGenerate(h.field),true,'An explicit icon action can check the connection.');
    assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(calls,1);assert.equal(h.app.ctMtlCapabilities.enabled,false);
    assert.equal(h.app.ctMtlCanGenerate(h.field),false);
});
test('an unrelated successful action cannot clear an outstanding MTL sync failure',async()=>{
    const h=harness();await h.put();h.app._ctMtlSyncError='Sync conflict';h.app.ctMtlError='Sync conflict';
    assert.equal(await h.app.ctMtlAccept(h.field),true);assert.equal(h.app.ctMtlError,'Sync conflict');
    assert.equal(await h.app.ctMtlUndoAccept(h.field),true);assert.equal(h.app.ctMtlError,'Sync conflict');
});
test('a post-save overlay refresh failure cannot retain an already committed acceptance claim',async()=>{
    const h=harness();await h.put();await h.app.ctMtlAccept(h.field);assert.equal(h.app.ctMtlAcceptances().length,1);
    h.mtl.list=()=>{throw new Error('Read failed after commit');};
    await assert.rejects(h.app.ctMtlSaved(h.app.ctContext(),h.original.id),/Read failed/);
    assert.deepEqual(h.app.ctMtlAcceptances(),[]);
});
test('another tab review revision is not overwritten by stale personal typing',async()=>{
    const h=harness();const value=await h.put();
    h.mtl.putReview(h.scope,h.original.id,h.field.id,{candidateId:value.id,candidateRevision:value.revision,rawSourceHash:value.rawSourceHash,text:'Peer review {0}',dirty:true});
    h.app.ctInputValues[h.field.id]='My stale review {0}';await settle();
    assert.match(h.app.ctMtlError,/review changed/);
    assert.equal(h.mtl.getReview(h.scope,h.original.id,h.field.id).text,'Peer review {0}');
    assert.equal(h.app.ctInputValues[h.field.id],'My stale review {0}','The rejected local edit remains available for recovery.');
    const archives=h.mtl.listReviews(h.scope,{includeArchived:true}).filter(value=>value.reason==='review-conflict');
    assert.equal(archives.length,1);assert.equal(archives[0].text,'My stale review {0}');
    assert.equal(h.app.ctMtlRecoveryReviews(h.field).length,1);
});
test('a durable conflicting review survives reload and explicit recovery uses a fresh peer CAS',async()=>{
    const h=harness(),value=await h.put();
    h.mtl.putReview(h.scope,h.original.id,h.field.id,{candidateId:value.id,candidateRevision:value.revision,rawSourceHash:value.rawSourceHash,text:'Peer review {0}',dirty:true});
    h.app.ctInputValues[h.field.id]='Recover this {0}';await settle();
    const fresh=harness();fresh.normal.mtl=h.mtl;fresh.app.ctMtlCandidates=h.mtl.list(h.scope);
    await fresh.app.ctMtlLoadReviews();
    assert.equal(fresh.app.ctMtlFieldValue(fresh.field),'Peer review {0}');assert.equal(fresh.app.ctMtlRecoveryReviews(fresh.field).length,1);
    assert.equal(await fresh.app.ctMtlRecoverReview(fresh.field),true);
    assert.equal(fresh.app.ctMtlFieldValue(fresh.field),'Recover this {0}');assert.equal(fresh.app.ctValues[fresh.field.id],'Confirmed {0}');
    assert.equal(h.mtl.getReview(h.scope,h.original.id,h.field.id).text,'Recover this {0}');assert.equal(fresh.app.ctMtlRecoveryReviews(fresh.field).length,0);
    assert.equal(h.mtl.listReviews(h.scope,{includeArchived:true}).filter(row=>row.reason==='review-conflict').length,1,'Recovery archives remain durable after use.');
});
test('a peer change during explicit review recovery is archived again without overwriting the peer',async()=>{
    const h=harness(),value=await h.put();
    h.mtl.putReview(h.scope,h.original.id,h.field.id,{candidateId:value.id,candidateRevision:value.revision,rawSourceHash:value.rawSourceHash,text:'Peer review {0}',dirty:true});
    h.app.ctInputValues[h.field.id]='My recovery {0}';await settle();
    const get=h.mtl.getReview;let changed=false;
    h.mtl.getReview=(...args)=>{const result=get(...args);if(!changed){changed=true;h.mtl.putReview(h.scope,h.original.id,h.field.id,{...result,text:'Newest peer {0}'},{expectedRevision:result.revision});}return result;};
    assert.equal(await h.app.ctMtlRecoverReview(h.field),false);
    assert.equal(get(h.scope,h.original.id,h.field.id).text,'Newest peer {0}');
    assert.ok(h.mtl.listReviews(h.scope,{includeArchived:true}).some(row=>row.reason==='review-conflict'&&row.text==='My recovery {0}'));
    assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
});
test('dirty personal review survives peer candidate replacement without an automatic overlay',async()=>{
    const h=harness();await h.put();h.app.ctInputValues[h.field.id]='My review {0}';await h.reviews();
    await h.put(candidate(h.original,'request2',S.hash(h.field.target),{createdAt:2}));
    assert.equal(h.app.ctMtlCandidate(h.field),null);assert.equal(h.app.ctMtlReviews[JSON.stringify([h.original.id,h.field.id])].text,'My review {0}');
    assert.equal(h.app.ctInputValues[h.field.id],'Confirmed {0}');assert.equal(h.app.ctMtlCount,1);
});
test('reload requires a matching ordinary draft acceptance rather than only persisted review flag',async()=>{
    const h=harness();await h.put();await h.app.ctMtlAccept(h.field);const claims=h.app.ctMtlAcceptances();
    h.app.ctValues[h.field.id]='Confirmed {0}';h.app.ctMtlRestoreAcceptances(null);assert.ok(h.app.ctMtlCandidate(h.field));
    h.app.ctValues[h.field.id]='Generated {0}';h.app.ctMtlRestoreAcceptances({mtlAcceptances:claims});assert.equal(h.app.ctMtlCandidate(h.field),null);
    h.app.ctValues[h.field.id]='Human changed {0}';h.app.ctEdited(h.field);
    assert.equal(h.app.ctMtlAcceptances()[0].reviewedTextHash,S.hash('Human changed {0}'));
});
test('Undo acceptance restores only the replaced ordinary field and its exact Source review',async()=>{
    const h=harness();h.app.ctValues[h.field.id]='Original draft {0}';h.app.ctReviewed[h.field.id]='old-review';
    h.app.ctValues.other='Other draft';h.app.ctReviewed.other='other-review';await h.put();await h.app.ctMtlShow(h.field);
    assert.equal(await h.app.ctMtlAccept(h.field),true);assert.equal(h.app.ctMtlAccepted(h.field),true);
    assert.equal(h.app.ctMtlCanGenerate(h.field),false);
    h.app.ctValues[h.field.id]='Accepted then edited {0}';h.app.ctEdited(h.field);h.app.ctValues.other='Newer other draft';
    assert.equal(await h.app.ctMtlUndoAccept(h.field),true);
    assert.equal(h.app.ctValues[h.field.id],'Original draft {0}');assert.equal(h.app.ctReviewed[h.field.id],'old-review');
    assert.equal(h.app.ctValues.other,'Newer other draft');assert.equal(h.app.ctReviewed.other,'other-review');
    assert.equal(h.app.ctInputValues[h.field.id],'Accepted then edited {0}');assert.deepEqual(h.app.ctMtlAcceptances(),[]);
});
test('explicit history replacement detaches MTL claims without promoting or discarding recovery',async()=>{
    const h=harness();await h.put();await h.app.ctMtlAccept(h.field);
    h.app.ctMtlUnderlyingReplaced();h.app.ctValues[h.field.id]='Restored history {0}';await h.reviews();
    assert.equal(h.app.ctMtlCandidate(h.field),null);assert.equal(h.app.ctInputValues[h.field.id],'Restored history {0}');
    assert.deepEqual(h.app.ctMtlAcceptances(),[]);assert.equal(h.app.ctMtlCount,1);
    assert.equal(h.mtl.getReview(h.scope,h.original.id,h.field.id).text,'Generated {0}');
});
test('a peer-resolved accepted draft retains a durable checkpoint and can Undo without a pending candidate',async()=>{
    const h=harness(),value=await h.put();await h.app.ctMtlAccept(h.field);
    h.mtl.applyRemote(h.scope,{candidates:[{...value,status:'dismissed',revision:2}]});h.app.ctMtlCandidates=h.mtl.list(h.scope);
    assert.equal(h.app.ctMtlPendingCandidate(h.field),null);assert.equal(h.app.ctMtlAccepted(h.field),true);
    assert.equal(h.app.ctMtlCount,1);assert.equal(h.app.ctMtlFieldCount,1,'A stale accepted draft remains discoverable until Save or Undo.');
    assert.throws(()=>h.app.ctMtlAcceptances(),/changed/);assert.equal(h.app.ctMtlCheckpointAcceptances()[0].candidateId,value.id);
    assert.equal(await h.app.ctMtlUndoAccept(h.field),true);
    assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.equal(h.app.ctReviewed[h.field.id],undefined);
    assert.equal(h.app.ctMtlAccepted(h.field),false);assert.deepEqual(h.app.ctMtlCheckpointAcceptances(),[]);assert.equal(h.app.ctMtlCount,0);
});
test('Accept refuses malformed structure and rechecks scope/access/ordinary mutation after persistence',async()=>{
    const h=harness();await h.put();h.app.ctInputValues[h.field.id]='No variable';await h.reviews();
    assert.equal(await h.app.ctMtlAccept(h.field),false);assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
    h.app.ctInputValues[h.field.id]='Valid {0}';await h.reviews();
    const persist=h.app.ctMtlPersistReview,wait=deferred();h.app.ctMtlPersistReview=async(...args)=>{await wait.promise;return persist(...args);};
    const pending=h.app.ctMtlAccept(h.field);h.app.cloudUser.assignmentVersion++;wait.resolve();
    assert.equal(await pending,false);assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
});

test('MTL explicit review actions cannot change a generating field, including Accept after its storage await',async()=>{
    const h=harness();await h.put();const name=JSON.stringify([h.original.id,h.field.id]),values=structuredClone(h.app.ctValues),reviews=structuredClone(h.app.ctReviewed);
    h.app.ctMtlRequests={[name]:'running'};
    for(const action of ['ctMtlShow','ctMtlAccept','ctMtlDismiss'])assert.equal(await h.app[action](h.field),false,action);
    assert.deepEqual(h.app.ctValues,values);assert.deepEqual(h.app.ctReviewed,reviews);assert.equal(h.app.ctDraftDirty,false);
    h.app.ctMtlRequests={};const wait=deferred(),persist=h.app.ctMtlPersistReview;
    h.app.ctMtlPersistReview=async(...args)=>{await wait.promise;return persist(...args);};
    const pending=h.app.ctMtlAccept(h.field);await settle();h.app.ctMtlRequests={[name]:'running'};wait.resolve();
    assert.equal(await pending,false);assert.deepEqual(h.app.ctValues,values);assert.deepEqual(h.app.ctReviewed,reviews);
    assert.equal(h.ordinaryEdits(),0);assert.deepEqual(h.app.ctMtlAcceptances(),[]);
});

test('request activity changes its unit guard even when generation completes before a pending action resumes',async()=>{
    const h=harness();assert.equal(h.app.ctMtlUnitRequestVersion(h.original),0);
    assert.equal(await h.app.ctMtlGenerate(h.field),true);const version=h.app.ctMtlUnitRequestVersion(h.original);assert.ok(version>0);
    assert.equal(h.app.ctMtlBusy(h.field),false);h.app.ctMtlNoteRequest({id:'other-unit'});assert.equal(h.app.ctMtlUnitRequestVersion(h.original),version);
    h.app.ctMtlReset();h.app.ctMtlNoteRequest(h.original);assert.ok(h.app.ctMtlUnitRequestVersion(h.original)>version);
});

test('starting MTL moves focus off editor action buttons before disabling them, without taking outside focus',()=>{
    const previous=global.document,h=harness(),button={tagName:'BUTTON'},outside={tagName:'BUTTON'},calls=[];
    global.document={activeElement:button};h.app.ctEditorElement=()=>({contains:value=>value===button});
    h.app.ctDictionaryTarget=id=>({focus:options=>calls.push({id,options})});
    try{
        h.app.ctMtlFocusBeforeRequest(h.field);assert.deepEqual(calls,[{id:h.field.id,options:{preventScroll:true}}]);
        global.document.activeElement=outside;h.app.ctMtlFocusBeforeRequest(h.field);assert.equal(calls.length,1);
        global.document.activeElement={tagName:'TEXTAREA'};h.app.ctMtlFocusBeforeRequest(h.field);assert.equal(calls.length,1);
    }finally{global.document=previous;}
});
test('only own selected language and Manager/Admin can generate; consent and provider stay gated',async()=>{
    const h=harness();h.app.cloudUser.language='German';assert.equal(h.app.ctMtlCanGenerate(h.field),false);
    h.app.cloudUser.role='manager';assert.equal(h.app.ctMtlCanGenerate(h.field),true);
    h.app.mtlConsentVersion='';assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.match(h.app.ctMtlError,/updated MTL data-sharing and private review-retention/);
    h.app.mtlConsentVersion='mtl-v1';h.app.ctMtlCapabilities={enabled:false};assert.equal(await h.app.ctMtlGenerate(h.field),false);
    assert.equal(h.app.ctMtlCandidates.length,0);
});
test('committed glossary excludes editable Dictionary and other accounts',()=>{
    const h=harness();h.app.dictionary=[{find:'Secret draft',replace:'Not committed'}];
    h.app._cloud.state={activeProfile:h.scope.accountId,profiles:{[h.scope.accountId]:{dictionaries:{Thai:{base:{entries:[{find:'Hello',replace:'Approved'}]}}}}}};
    assert.deepEqual(h.app.ctMtlCommittedGlossary(),[{find:'Hello',replace:'Approved'}]);
    h.app._cloud.state.activeProfile='other';assert.deepEqual(h.app.ctMtlCommittedGlossary(),[]);
});

test('new MTL contexts and open unsent previews follow live Dictionary edits while submitted records remain immutable',async()=>{
    const h=harness(),app=h.app;app.cloudUser={id:h.scope.accountId,role:'admin',isAdmin:true};app.lang=h.scope.language;
    app.dictionary=[{_id:'hello',find:'Hello',replace:'Live definition',alts:[],tlnote:'Live note'}];
    const captured=app.ctMtlContextGlossary();app.dictionary[0].replace='Updated definition';
    assert.equal(captured[0].replace,'Live definition');assert.equal(app.ctMtlContextGlossary()[0].replace,'Updated definition');
    Object.assign(app,Debug.mixin.data());for(const[name,method]of Object.entries(Debug.mixin.methods))app[name]=method.bind(app);
    for(const[name,getter]of Object.entries(Debug.mixin.computed))Object.defineProperty(app,name,{get:()=>getter.call(app)});
    app._cloud.request=async()=>assert.fail('Opening or refreshing context must never send inference or diagnostics requests');
    assert.equal(await app.ctMtlDebugOpen(h.field),true);
    const before=app.ctMtlDebugWindow.record;assert.match(JSON.stringify(before),/Updated definition/);
    app.dictionary[0].replace='Newest definition';app.dictionary[0].tlnote='Newest note';app.ctMtlDebugRefreshPreview();
    assert.match(JSON.stringify(app.ctMtlDebugWindow.record),/Newest definition/);assert.match(JSON.stringify(app.ctMtlDebugWindow.record),/Newest note/);
    assert.doesNotMatch(JSON.stringify(before),/Newest definition/);
    const context=app.ctMtlBuildContext(h.field).initial;
    app.ctMtlDebugBegin(h.field,{requestId:'frozen-request',context});
    const sent=app.ctMtlDebugWindow.record,json=JSON.stringify(sent);
    app.dictionary[0].replace='After submission';app.ctMtlDebugRefreshPreview();
    assert.equal(app.ctMtlDebugWindow.record,sent);assert.equal(JSON.stringify(sent),json);
    assert.equal(JSON.stringify(app.ctMtlBuildContext(h.field).initial).includes('After submission'),true);
    h.changeEpoch();assert.deepEqual(app.ctMtlContextGlossary({scope:{...h.scope,accountId:'other'},epoch:-1}),[]);
});
test('alternate-only Dictionary edits refresh unsent glossary previews without changing submitted request contexts',async()=>{
    const h=harness(),app=h.app;app.cloudUser={id:h.scope.accountId,role:'admin',isAdmin:true};app.lang=h.scope.language;
    app.dictionary=[{_id:'synthetic-parent',find:'UnusedParent',replace:'',alts:[{_id:'synthetic-alt',find:'Hello',replace:'First alternate'}],tlnote:''}];
    Object.assign(app,Debug.mixin.data());for(const[name,method]of Object.entries(Debug.mixin.methods))app[name]=method.bind(app);
    for(const[name,getter]of Object.entries(Debug.mixin.computed))Object.defineProperty(app,name,{get:()=>getter.call(app)});
    app._cloud.request=async()=>assert.fail('Glossary previews must never send inference or diagnostics requests');
    assert.equal(await app.ctMtlDebugOpen(h.field),true);
    assert.deepEqual(app.ctMtlDebugWindow.record.snapshot.context.glossary,[{id:'synthetic-parent',source:'Hello',translation:'First alternate',gameScope:'all'}]);
    app.dictionary[0].alts[0].replace='Edited alternate';app.ctMtlDebugRefreshPreview();
    assert.equal(app.ctMtlDebugWindow.record.snapshot.context.glossary[0].translation,'Edited alternate');
    app.ctMtlDebugBegin(h.field,{requestId:'synthetic-frozen-alt',context:app.ctMtlBuildContext(h.field).initial});
    const captured=app.ctMtlDebugWindow.record,snapshot=JSON.stringify(captured);
    app.dictionary[0].alts[0].find='No longer matches';app.dictionary[0].alts[0].replace='Unrelated change';app.ctMtlDebugRefreshPreview();
    assert.equal(app.ctMtlDebugWindow.record,captured);assert.equal(JSON.stringify(captured),snapshot);
    assert.deepEqual(app.ctMtlBuildContext(h.field).initial.glossary,[]);
});
test('MTL hotkey is exact, focused, IME safe and disabled by default',()=>{
    const h=harness();let calls=0;h.app.ctMtlGenerate=()=>{calls++;};h.app.ctFocusedField=h.field.id;
    const event=extra=>({key:'F8',target:{dataset:{ctTarget:h.field.id}},preventDefault(){this.defaultPrevented=true;},...extra});
    assert.equal(h.app.ctMtlKey(event()),false);h.app.mtlShortcut='f8';assert.equal(h.app.ctMtlKey(event()),true);
    for(const extra of [{repeat:true},{isComposing:true},{ctrlKey:true},{altKey:true},{metaKey:true},{target:{dataset:{ctSource:h.field.id}}}])assert.equal(h.app.ctMtlKey(event(extra)),false);
    h.app.mtlShortcut='ctrl-alt-f8';assert.equal(h.app.ctMtlKey(event({ctrlKey:true,altKey:true})),true);assert.equal(calls,2);
});
test('reset aborts in-flight work and removes ephemeral overlays',async()=>{
    const h=harness(),wait=deferred();let body,signal;
    h.app._cloud.request=async(path,options)=>{body=options.body;signal=options.signal;await wait.promise;return{candidate:candidate(h.original,body.requestId,body.baseTargetHash)}};
    const pending=h.app.ctMtlGenerate(h.field);await settle();h.app.ctMtlReset();assert.equal(signal.aborted,true);wait.resolve();
    assert.equal(await pending,false);assert.equal(h.app.ctMtlCount,0);assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
});


test('revoking transmission consent while generation is checkpointed prevents its first POST',async()=>{
    const h=harness(),wait=deferred(),put=h.mtl.putGeneration.bind(h.mtl);let posts=0;
    h.mtl.putGeneration=async(...args)=>{const result=put(...args);if(args[1].status==='pending')await wait.promise;return result;};
    h.app._cloud.request=async(path,options)=>{posts++;return{candidate:candidate(h.original,options.body.requestId,options.body.baseTargetHash)};};
    const pending=h.app.ctMtlGenerate(h.field);await settle();
    h.app.mtlConsentVersion='';wait.resolve();
    assert.equal(await pending,false);assert.equal(posts,0);
    assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.equal(h.app.ctMtlCandidates.length,0);
    assert.equal(h.mtl.getGenerations(h.scope,{activeOnly:true}).length,0);
});


test('an older API without MTL capabilities leaves normal workbook activation quiet and skips lifecycle requests',async t=>{
    const h=harness(),previous=globalThis.ClientTextMtlSync;let syncs=0,requests=0;
    t.after(()=>{if(previous===undefined)delete globalThis.ClientTextMtlSync;else globalThis.ClientTextMtlSync=previous;});
    globalThis.ClientTextMtlSync={create(){syncs++;throw new Error('Old API has no MTL lifecycle');}};
    h.app._cloud.request=async path=>{requests++;assert.equal(path,'/v1/mtl/capabilities');throw Object.assign(new Error('Not found'),{status:404});};
    assert.equal(await h.app.ctMtlActivate(),true);assert.equal(requests,1);assert.equal(syncs,0);
    assert.equal(h.app.ctMtlError,'');assert.equal(h.app.ctMtlCapabilities.unsupported,true);
    assert.equal(h.app.ctMtlCanGenerate(h.field),false);assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
});


test('Admin timing starts at click and separates capabilities, notes, context, POST and adoption without changing drafts',async()=>{
    const h=debugHarness();let now=0;h.app._ctMtlTimingNow=()=>now;h.app.ctMtlCapabilities=null;
    h.app.ctToneNotesPrepare=async()=>{now=20;};
    const build=h.app.ctMtlBuildContext;h.app.ctMtlBuildContext=(...args)=>{const result=build(...args);now=35;return result;};
    const adopt=h.app.ctMtlAdoptCandidate;h.app.ctMtlAdoptCandidate=async(...args)=>{const result=await adopt(...args);now=80;return result;};
    h.app._cloud.request=async(path,options)=>{if(path==='/v1/mtl/capabilities'){now=5;return{enabled:true,reviewArchive:true,consentVersion:'mtl-v2'};}
        now=55;return{candidate:candidate(h.original,options.body.requestId,options.body.baseTargetHash)};};
    assert.equal(await h.app.ctMtlGenerate(h.field),true);const record=h.app.ctMtlDebugRecords[h.field.id],timing=record.browserTiming;
    assert.equal(record.requestId,h.app.ctMtlCandidates[0].requestId);assert.equal(timing.outcome,'completed');
    assert.equal(timing.durationsMs.capabilitiesMs,5);assert.equal(timing.durationsMs.toneNotesMs,15);assert.equal(timing.durationsMs.contextMs,15);
    assert.equal(timing.durationsMs.postRoundTripMs,20);assert.equal(timing.durationsMs.adoptionMs,25);assert.equal(timing.durationsMs.totalMs,80);
    assert.equal(timing.milestonesMs.firstProgress,null);assert.equal(timing.milestonesMs.firstTextFrameReady,null);
    assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.equal(h.ordinaryEdits(),0);
    assert.doesNotMatch(JSON.stringify(h.app.ctMtlCandidates),/milestonesMs|durationsMs/);
});

test('Admin preparation failures retain bounded browser timings without a POST or invented server milestones',async()=>{
    const h=debugHarness();let now=0,posts=0;h.app._ctMtlTimingNow=()=>now;
    h.app.ctToneNotesPrepare=async()=>{now=40;throw Error('Synthetic note read failed');};h.app._cloud.request=async()=>{posts++;};
    assert.equal(await h.app.ctMtlGenerate(h.field),false);const timing=h.app.ctMtlDebugRecords[h.field.id].browserTiming;
    assert.equal(timing.outcome,'failed');assert.equal(timing.durationsMs.toneNotesMs,40);assert.equal(timing.durationsMs.totalMs,40);
    assert.equal(timing.milestonesMs.postStart,null);assert.equal(posts,0);assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
});

test('ordinary roles cannot create timing records and timing state is cleared on the existing debug fence',()=>{
    const h=debugHarness();h.app.cloudUser={...h.app.cloudUser,role:'translator',isAdmin:false};
    assert.equal(h.app.ctMtlDebugTimingStart(h.field),null);assert.equal(h.app._ctMtlTimingRuns,undefined);
    h.app.cloudUser={...h.app.cloudUser,role:'admin',isAdmin:true};const timing=h.app.ctMtlDebugTimingStart(h.field);assert.ok(timing);
    h.app.ctMtlDebugReset();timing.mark('contextEnd');assert.deepEqual(h.app.ctMtlDebugRecords,{});assert.equal(h.app._ctMtlTimingRuns.size,0);
});


test('Admin frame-ready timing follows DOM flush and an animation frame and is fenced on context reset',async()=>{
    const previous={document:global.document,requestAnimationFrame:global.requestAnimationFrame,cancelAnimationFrame:global.cancelAnimationFrame};
    const frames=new Map();let serial=0,now=0;global.document={hidden:false};global.requestAnimationFrame=callback=>{frames.set(++serial,callback);return serial;};global.cancelAnimationFrame=id=>frames.delete(id);
    try{const h=debugHarness();h.app._ctMtlTimingNow=()=>now;h.app.$nextTick=callback=>callback();
        h.app.ctDictionaryTarget=()=>({getClientRects:()=>[{}],closest:()=>({querySelector:()=>({textContent:'Synthetic provisional text'})})});
        const timing=h.app.ctMtlDebugTimingStart(h.field);now=10;timing.mark('firstProgress');h.app.ctMtlDebugTimingFrame(timing,'firstTextFrameReady',h.field.id,true);
        assert.equal(timing.snapshot().milestonesMs.firstTextFrameReady,null);now=16;for(const callback of frames.values())callback();frames.clear();
        assert.equal(timing.snapshot().milestonesMs.firstTextFrameReady,16);
        global.document.hidden=true;h.app.ctMtlDebugTimingFrame(timing,'finalFrameReady',h.field.id);assert.equal(frames.size,0);
        global.document.hidden=false;h.app.ctMtlDebugTimingFrame(timing,'finalFrameReady',h.field.id);assert.equal(frames.size,1);
        h.app.ctMtlDebugReset();assert.equal(frames.size,0);assert.deepEqual(h.app.ctMtlDebugRecords,{});
    }finally{for(const[key,value]of Object.entries(previous)){if(value===undefined)delete global[key];else global[key]=value;}}
});

test('Admin timing records stay capped at 32 and evicted traces cannot repopulate private state',()=>{
    const h=debugHarness();let oldest;for(let i=0;i<35;i++){const field={...h.field,id:'synthetic-field-'+i};h.original.fields.push(field);const trace=h.app.ctMtlDebugTimingStart(field);if(!i)oldest=trace;}
    assert.equal(h.app._ctMtlTimingRuns.size,32);assert.equal(Object.keys(h.app.ctMtlDebugRecords).length,32);
    oldest.mark('postStart');assert.equal(h.app.ctMtlDebugRecords['synthetic-field-0'],undefined);
    h.app.ctMtlDebugReset();assert.equal(h.app._ctMtlTimingRuns.size,0);
});


test('a repeated click during Admin capability preflight cannot replace the first active timing trace',()=>{
    const h=debugHarness(),first=h.app.ctMtlDebugTimingStart(h.field);assert.ok(first);
    assert.equal(h.app.ctMtlDebugTimingStart(h.field),null);assert.equal(h.app._ctMtlTimingRuns.get(h.field.id).timing,first);
    first.finish('failed');const next=h.app.ctMtlDebugTimingStart(h.field);assert.ok(next);assert.notEqual(next,first);
});


test('Admin Stop records cancellation time and workflow outcome without another provider POST',async()=>{
    const h=debugHarness();let now=0,body,posts=0;h.app._ctMtlTimingNow=()=>now;h.app.ctMtlCapabilities.delivery='poll-v1';
    const status=changes=>({requestId:body.requestId,status:'running',scope:{...h.scope,local:false},progress:{revision:1,phase:'generating',translation:'Working {0}',provisional:true},pollAfterMs:250,...changes});
    h.app.ctMtlRequestWait=job=>new Promise(resolve=>{job.wake=resolve;});
    h.app._cloud.request=async(path,options={})=>{if(path.endsWith('/cancellations'))return status({status:'failed',errorCode:'MTL_CANCELLED'});posts++;body=options.body;return status();};
    const pending=h.app.ctMtlGenerate(h.field);await settle();now=30;assert.equal(await h.app.ctMtlCancel(h.field),true);assert.equal(await pending,false);
    const timing=h.app.ctMtlDebugRecords[h.field.id].browserTiming;assert.equal(timing.outcome,'cancelled');assert.equal(timing.milestonesMs.cancelRequested,30);
    assert.equal(timing.durationsMs.totalMs,30);assert.equal(timing.milestonesMs.candidateReceived,null);assert.equal(posts,1);assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
});


function modelSettingsHarness(){
    const h=debugHarness(),app=h.app;Object.assign(app,ModelSettings.mixin.data());
    for(const[name,method]of Object.entries(ModelSettings.mixin.methods))app[name]=method.bind(app);
    for(const[name,getter]of Object.entries(ModelSettings.mixin.computed))Object.defineProperty(app,name,{configurable:true,get:()=>getter.call(app)});
    const generate=app._cloud.request;app._cloud.request=async(path,options)=>path==='/v1/admin/mtl/model-settings'?{settings:{version:'mtl-inference-settings-v1',models:[
        {model:'gpt-6-luna',efforts:['none','low','medium','high','xhigh','max']},{model:'gpt-6.1-sol',efforts:['low','medium','high','xhigh','max']}]}}:generate(path,options);
    return h;
}
test('model settings are pinned-Admin-only, session-local and preserve the Sol/medium default and explicit choices',async()=>{
    const h=modelSettingsHarness(),{app,field}=h;assert.equal(app.ctMtlSettingsAllowed,true);assert.equal(app.ctMtlSettingsCapture(),undefined);
    await app.ctMtlSettingsToggle(field);assert.deepEqual(app.ctMtlSettingsSelected(),{version:'mtl-inference-settings-v1',model:'gpt-6.1-sol',effort:'medium'});assert.equal(app.ctMtlSettingsCapture(),undefined);
    assert.equal(app.ctMtlSettingsChoose('model','gpt-6.1-sol'),true);assert.equal(app.ctMtlSettingsChoose('effort','low'),true);
    const selected=app.ctMtlSettingsCapture();assert.deepEqual(selected,{version:'mtl-inference-settings-v1',model:'gpt-6.1-sol',effort:'low'});
    selected.effort='max';assert.equal(app.ctMtlSettingsCapture().effort,'low');
    assert.equal(app.ctMtlSettingsChoose('model','gpt-6-luna'),true);assert.equal(app.ctMtlSettingsCapture().effort,'low');
    for(const effort of ['none','low','medium','high','xhigh','max']){assert.equal(app.ctMtlSettingsChoose('effort',effort),true);assert.equal(app.ctMtlSettingsCapture().effort,effort);}
    for(const effort of ['minimal','ultra','fast'])assert.equal(app.ctMtlSettingsChoose('effort',effort),false);
    assert.equal(app.ctMtlSettingsDefault(),true);assert.equal(app.ctMtlSettingsCapture(),undefined);
    for(const role of ['translator','manager','viewer']){app.cloudUser={...app.cloudUser,role,isAdmin:role==='viewer'};assert.equal(app.ctMtlSettingsAllowed,false);assert.equal(await app.ctMtlSettingsToggle(field),false);assert.equal(app.ctMtlSettingsCapture(),undefined);}
});
test('model metadata and selections cannot cross account, client, role or assignment changes',async()=>{
    for(const change of [app=>{app.cloudSignedIn=false;},app=>{app.cloudUser.role='manager';},app=>{app.cloudUser.assignmentVersion++;},app=>{app._cloud={...app._cloud};},app=>{app.cloudProfileId='other';}]){
        const {app,field}=modelSettingsHarness(),gate=deferred();app._cloud.request=()=>gate.promise;
        const loading=app.ctMtlSettingsToggle(field);change(app);gate.resolve({settings:{version:'mtl-inference-settings-v1',models:[{model:'gpt-6.1-sol',efforts:['low']}]}});
        assert.equal(await loading,false);assert.equal(app.ctMtlSettingsCatalog,null);assert.equal(app.ctMtlSettingsCapture(),undefined);
        ModelSettings.mixin.watch.ctMtlSettingsOrigin.call(app);assert.equal(app.ctMtlSettingsPanel,'');assert.equal(app.ctMtlSettingsLoading,false);
    }
    const {app,field}=modelSettingsHarness();await app.ctMtlSettingsToggle(field);app.ctMtlSettingsChoose('effort','max');app._cloud={...app._cloud};assert.equal(app.ctMtlSettingsCapture(),undefined);
});
test('each panel opening rechecks account availability; failed and unavailable choices never alter defaults',async()=>{
    const {app,field}=modelSettingsHarness();let calls=0;const request=app._cloud.request;app._cloud.request=(...args)=>{calls++;return request(...args);};
    await app.ctMtlSettingsToggle(field);await app.ctMtlSettingsToggle(field);await app.ctMtlSettingsToggle(field);assert.equal(calls,2);
    await app.ctMtlSettingsToggle(field);app._cloud.request=async()=>{throw new Error('synthetic private token');};assert.equal(await app.ctMtlSettingsToggle(field),false);
    assert.doesNotMatch(app.ctMtlSettingsError,/private token/);assert.equal(app.ctMtlSettingsCapture(),undefined);assert.deepEqual(app.ctMtlSettingsSelected(),ModelSettings.DEFAULT);
    assert.throws(()=>ModelSettings.catalog({version:'mtl-inference-settings-v1',models:[{model:'gpt-6-astra',efforts:['high']}]}));
    assert.throws(()=>ModelSettings.settings({...ModelSettings.DEFAULT,model:'gpt-6-luna',effort:'minimal'}));
});

test('a limited or older API catalog keeps unavailable lower efforts out of captured requests',async()=>{
    const {app,field}=modelSettingsHarness();
    app._cloud.request=async()=>({settings:{version:'mtl-inference-settings-v1',models:[{model:'gpt-6-luna',efforts:['high','xhigh','max']}]}});
    await app.ctMtlSettingsToggle(field);assert.equal(app.ctMtlSettingsChoose('model','gpt-6-luna'),true);
    assert.equal(app.ctMtlSettingsCapture().effort,'high');
    for(const effort of ['none','low','medium'])assert.equal(app.ctMtlSettingsChoose('effort',effort),false);
    app.ctMtlSettingsChoice={version:'mtl-inference-settings-v1',model:'gpt-6-luna',effort:'low'};
    assert.throws(()=>app.ctMtlSettingsCapture(),/unavailable/);
    assert.deepEqual(ModelSettings.DEFAULT,{version:'mtl-inference-settings-v1',model:'gpt-6.1-sol',effort:'medium'});
});
test('Translate freezes the Admin selection before tone/context awaits and debug retains the captured request',async()=>{
  for(const [model,effort]of [['gpt-6.1-sol','low'],['gpt-6-luna','none'],['gpt-6-luna','low'],['gpt-6-luna','medium']]){
    const h=modelSettingsHarness(),{app,field}=h;await app.ctMtlSettingsToggle(field);app.ctMtlSettingsChoose('model',model);app.ctMtlSettingsChoose('effort',effort);
    const notes=deferred();app.ctToneNotesPrepare=()=>notes.promise;let submitted;const request=app._cloud.request;
    app._cloud.request=async(path,options)=>{if(options?.method==='POST')submitted=structuredClone(options.body);return request(path,options);};
    const task=app.ctMtlGenerate(field);await settle();app.ctMtlSettingsChoose('effort','max');notes.resolve();assert.equal(await task,true);
    assert.deepEqual(submitted.inferenceSettings,{version:'mtl-inference-settings-v1',model,effort});assert.equal(app.ctMtlDebugRecords[field.id].snapshot.inferenceSettings.effort,effort);
    assert.equal(app.ctMtlSettingsCapture().effort,'max');assert.equal(h.ordinaryEdits(),0);assert.equal(app.ctValues[field.id],field.target);
  }
});
test('ordinary and reset-to-default generation omit overrides; candidates retain bounded immutable settings',async()=>{
    const h=modelSettingsHarness(),{app,field}=h;let body;const request=app._cloud.request;app.cloudUser.role='translator';app.cloudUser.isAdmin=false;
    app._cloud.request=async(path,options)=>{if(options?.method==='POST')body=options.body;return request(path,options);};
    assert.equal(await app.ctMtlGenerate(field),true);assert.equal(Object.hasOwn(body,'inferenceSettings'),false);
    const value=candidate(h.original,'settings-candidate',S.hash(field.target),{model:'gpt-6.1-sol',effort:'low',inferenceSettings:{version:'mtl-inference-settings-v1',model:'gpt-6.1-sol',effort:'low'}});
    const normalized=M.normalizeCandidate(value);assert.deepEqual(normalized.inferenceSettings,value.inferenceSettings);
    assert.throws(()=>M.mergeCandidate(normalized,{...value,inferenceSettings:{...value.inferenceSettings,effort:'high'},effort:'high'}),{code:'MTL_CANDIDATE_CHANGED'});
    assert.throws(()=>M.normalizeCandidate({...value,inferenceSettings:{...value.inferenceSettings,accessToken:'synthetic'}}));
});

test('Admin request diagnostics capture the Sol/medium default without changing explicit Luna requests',()=>{
    const {app,field}=debugHarness();
    app.ctMtlDebugBegin(field,{requestId:'default-model',context:{}});
    assert.deepEqual(app.ctMtlDebugRecords[field.id].snapshot.inferenceSettings,{version:'mtl-inference-settings-v1',model:'gpt-6.1-sol',effort:'medium'});
    const explicit={version:'mtl-inference-settings-v1',model:'gpt-6-luna',effort:'xhigh'};
    app.ctMtlDebugBegin(field,{requestId:'explicit-model',context:{},inferenceSettings:explicit});
    explicit.effort='max';assert.equal(app.ctMtlDebugRecords[field.id].snapshot.inferenceSettings.effort,'xhigh');
});

function lookupHarness(){
    const h=pollingHarness(),wire=require('../public/clientTextMtlLookup.js');
    Object.assign(h.app.ctMtlCapabilities,{contextLookupsEnabled:true,contextLookup:{version:wire.VERSION}});
    const related=makeUnit('Related {0}','Approved {0}');related.recordId='Extra';related.sheet='NPCTalkDialogueTextAudio';
    related.id=JSON.stringify([related.role,related.sheet,related.recordId]);h.app.ctUnits.push(related);
    const status=h.status,challenges=new Map();h.status=(body,changes={})=>status(body,{requestHash:'d'.repeat(64),...changes});
    h.challenge=(body,round=1)=>{
        if(!challenges.has(round))challenges.set(round,{id:'challenge-'+round,requestId:body.requestId,requestHash:'d'.repeat(64),round,
            binding:wire.binding(body,h.scope),queries:[{kind:'record',recordId:'Extra',sheet:related.sheet}],expiresAt:Date.now()+15000});
        return structuredClone(challenges.get(round));
    };
    h.snapshot=(body,round=1)=>h.status(body,{requestHash:'d'.repeat(64),lookupChallenge:h.challenge(body,round),
        progress:{revision:round,phase:'retrieving',translation:'',provisional:true}});
    return h;
}

for(const rounds of [0,1,2])test('bounded polling handles '+rounds+' lookup rounds with one admission and preserves native draft',async()=>{
    const h=lookupHarness();let body,admissions=0,replies=0,gets=0;const phases=[];
    const update=h.app.ctMtlProgressUpdate;h.app.ctMtlProgressUpdate=(job,value)=>{phases.push(value.phase);return update(job,value);};
    h.app._cloud.request=async(path,options={})=>{
        if(path.endsWith('/context-replies')){
            replies++;assert.equal(options.body.round,replies);assert.equal(options.body.binding.language,'Thai');
            assert.equal(options.body.results[0].records[0].fields[0].translation,'Approved {0}');
            assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.deepEqual(h.mtl.list(h.scope),[]);
            return{requestId:body.requestId,accepted:true,round:replies};
        }
        if(options.method==='POST'){admissions++;body=options.body;assert.equal(body.lookup.version,'clienttext-mtl-lookup-v1');return rounds?h.snapshot(body):h.status(body);}
        gets++;return replies<rounds?h.snapshot(body,replies+1):{candidate:candidate(h.original,body.requestId,body.baseTargetHash)};
    };
    assert.equal(await h.app.ctMtlGenerate(h.field),true);assert.equal(admissions,1);assert.equal(replies,rounds);
    assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.equal(h.app.ctDraftDirty,false);assert.deepEqual(h.app.ctMtlAcceptances(),[]);
    assert.equal(h.app._ctMtlLookupSessions.size,0);if(rounds)assert.ok(phases.includes('retrieving'));
});

test('lost context acknowledgement never resubmits a challenge or another admission',async()=>{
    const h=lookupHarness();let body,replies=0,posts=0,gets=0;
    h.app._cloud.request=async(path,options={})=>{
        if(path.endsWith('/context-replies')){replies++;throw new TypeError('Synthetic lost acknowledgement');}
        if(options.method==='POST'){posts++;body=options.body;return h.snapshot(body);}
        return ++gets===1?h.snapshot(body):{candidate:candidate(h.original,body.requestId,body.baseTargetHash)};
    };
    assert.equal(await h.app.ctMtlGenerate(h.field),true);assert.equal(posts,1);assert.equal(replies,1);assert.equal(gets,2);
});

test('lookup scope/session changes, workbook replacement and stale challenges stop safely without replying',async()=>{
    for(const mode of ['language','snapshot','round','workbook','logout']){
        const h=lookupHarness();let body,replies=0,stops=0,posts=0;
        h.app._cloud.request=async(path,options={})=>{
            if(path.endsWith('/cancellations')){stops++;return h.status(body,{status:'failed',errorCode:'MTL_CANCELLED'});}
            if(path.endsWith('/context-replies')){replies++;return{};}
            if(options.method==='POST'){
                posts++;body=options.body;const response=h.snapshot(body);
                if(mode==='language')response.lookupChallenge.binding.language='French';
                if(mode==='snapshot')response.lookupChallenge.binding.snapshotHash='e'.repeat(64);
                if(mode==='round')response.lookupChallenge.round=2;
                if(mode==='workbook')h.app.ctUnits=[...h.app.ctUnits];
                if(mode==='logout')h.app.cloudSignedIn=false;
                return response;
            }
            throw Error('No extra request expected');
        };
        assert.equal(await h.app.ctMtlGenerate(h.field),false);await settle();assert.equal(posts,1);assert.equal(replies,0);assert.equal(stops,1);
        assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');assert.deepEqual(h.mtl.list(h.scope),[]);
    }
});

test('request recovery never rebuilds a lost original lookup snapshot or starts another model request',async()=>{
    const h=lookupHarness(),wire=require('../public/clientTextMtlLookup.js');let body,stops=0;
    body={requestId:'old-lookup',unitId:h.original.id,fieldId:h.field.id,role:h.original.role,assetHash:descriptor.assetHash,
        parserVersion:descriptor.parserVersion,rawSourceHash:M.rawSourceHash(h.field.source),lookup:{version:wire.VERSION,snapshotHash:'b'.repeat(64)}};
    const generation=await h.mtl.putGeneration(h.scope,{...body,sourceHash:S.sourceHash(h.field.source),status:'pending',baseTargetHash:S.hash(h.field.target),createdAt:Date.now()});
    h.app._cloud.request=async(path,options={})=>{
        if(path.endsWith('/cancellations')){stops++;return h.status(body,{status:'failed',errorCode:'MTL_CANCELLED'});}
        assert.notEqual(options.method,'POST');return h.snapshot(body);
    };
    assert.equal(await h.app.ctMtlRecover(h.field,generation),false);assert.equal(stops,1);
    assert.match(h.app.ctMtlError,/snapshot is unavailable/);assert.equal(h.app.ctValues[h.field.id],'Confirmed {0}');
});
