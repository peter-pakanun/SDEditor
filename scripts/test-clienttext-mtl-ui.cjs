const {test} = require('node:test');
const assert = require('node:assert/strict');
const S=require('../public/clientTextState.js'),M=require('../public/clientTextMtlState.js'),Memory=require('../public/clientTextMtlMemoryStore.js');
const UI=require('../public/clientTextMtlUi.js');
const Debug=require('../public/clientTextMtlDebug.js');
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
        cloudCanAccessAllLanguages:false,mtlConsentVersion:'mtl-v1',mtlShortcut:'disabled',ctMtlCapabilities:{enabled:true},
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
function debugHarness(){
    const h=harness(),app=h.app;
    Object.assign(app,Debug.mixin.data());
    for(const[name,method]of Object.entries(Debug.mixin.methods))app[name]=method.bind(app);
    for(const[name,getter]of Object.entries(Debug.mixin.computed))Object.defineProperty(app,name,{configurable:true,get:()=>getter.call(app)});
    app.cloudUser={...app.cloudUser,role:'admin',isAdmin:true};
    return h;
}

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
    assert.match(Debug.Dialog.template,/<pre[^>]*>\{\{ details \}\}<\/pre>/);
});

test('all MTL settings use neutral wording and retain an honest accessible data-sharing disclosure',()=>{
    const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/index.html'),'utf8');
    const settings=html.split('<h3 class="settingsSubheading">MTL</h3>')[1].split('id="autocompleteShortcut"')[0];
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
            text:'synthetic raw output',delta:'synthetic partial translation',reasoning:'synthetic hidden reasoning',model:'synthetic-model',provider:'synthetic-provider',
            response:{output:'synthetic raw response'},headers:{Authorization:'synthetic secret'},url:'synthetic private endpoint'}}};
    const shown=JSON.parse(Debug.Dialog.computed.details.call({item:{record}}));
    assert.equal(shown.protocolCheck,'completion_output');assert.equal(shown.protocolExplanation,record.server.protocolExplanation);
    assert.equal(shown.streamSummary.events,4);assert.equal(shown.streamSummary.completedEventSeen,true);
    assert.equal(shown.streamSummary.responseStatus,'missing');assert.equal(shown.streamSummary.outputKind,'missing');
    assert.equal(shown.streamSummary.outputTextCharacters,22);assert.deepEqual(shown.streamSummary.outputItemTypes,['message','other']);
    assert.deepEqual(shown.streamSummary.contentTypes,['output_text']);assert.deepEqual(shown.streamSummary.textValueTypes,['string']);
    assert.doesNotMatch(JSON.stringify(shown),/synthetic raw|synthetic partial|synthetic hidden|synthetic-model|synthetic-provider|synthetic secret|synthetic private/);
    const oversized=Debug.present({...record,server:{...record.server,streamSummary:{...record.server.streamSummary,events:Infinity,outputItemTypes:Array(30).fill('message')}}});
    assert.equal(oversized.streamSummary.events,null);assert.equal(oversized.streamSummary.outputItemTypes.length,16);
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
test('only own selected language and Manager/Admin can generate; consent and provider stay gated',async()=>{
    const h=harness();h.app.cloudUser.language='German';assert.equal(h.app.ctMtlCanGenerate(h.field),false);
    h.app.cloudUser.role='manager';assert.equal(h.app.ctMtlCanGenerate(h.field),true);
    h.app.mtlConsentVersion='';assert.equal(await h.app.ctMtlGenerate(h.field),false);assert.equal(h.app.ctMtlError,'Review and enable the MTL data-sharing choice in MTL settings first.');
    h.app.mtlConsentVersion='mtl-v1';h.app.ctMtlCapabilities={enabled:false};assert.equal(await h.app.ctMtlGenerate(h.field),false);
    assert.equal(h.app.ctMtlCandidates.length,0);
});
test('committed glossary excludes editable Dictionary and other accounts',()=>{
    const h=harness();h.app.dictionary=[{find:'Secret draft',replace:'Not committed'}];
    h.app._cloud.state={activeProfile:h.scope.accountId,profiles:{[h.scope.accountId]:{dictionaries:{Thai:{base:{entries:[{find:'Hello',replace:'Approved'}]}}}}}};
    assert.deepEqual(h.app.ctMtlCommittedGlossary(),[{find:'Hello',replace:'Approved'}]);
    h.app._cloud.state.activeProfile='other';assert.deepEqual(h.app.ctMtlCommittedGlossary(),[]);
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
