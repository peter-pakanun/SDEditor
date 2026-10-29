'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const JSZip=require('../../SDEditor-API/node_modules/jszip');
const Debug=require('../public/clientTextMtlDebug.js'),Timing=require('../public/clientTextMtlTiming.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const accountId='synthetic-admin',requestId='synthetic-request';
function record(status='completed'){
    const text='ภาษาไทย 日本語 한글 😀\n'.repeat(3000)+'unicode-tail',browserTiming=Timing.create({now:()=>0}).snapshot();
    return{requestId,status,submittedAt:100,browserTiming,snapshot:{scope:{accountId,game:'poe2',language:'Thai'},unit:{id:'unit',sheet:'Synthetic',recordId:'Line'},field:{id:'text'},source:text},
        server:{requestId,status,source:text,language:'Thai',context:{note:text,accessToken:'synthetic-token',headers:{'X-Api-Key':'synthetic-header-secret'}},
            providerRequest:{model:'synthetic-provider-config',reasoning:{text:'synthetic-raw-reasoning'},instructions:text,
                input:[{role:'user',content:text},{type:'reasoning',text:'synthetic-input-reasoning'}],headers:{Authorization:'synthetic-header-secret'}},
            response:{translation:text,reasoning:'synthetic-response-reasoning'},inferenceSettings:{version:'mtl-inference-settings-v1',model:'gpt-6-luna',effort:'xhigh',reasoning:'synthetic-settings-reasoning'},
            validation:'passed',error:{code:'SYNTHETIC_CODE',secret:'synthetic-error-secret'},rawResponse:'synthetic-raw-response',credentials:'synthetic-credentials',
            upstreamResponse:{contentType:'application/json',hasBody:true,headers:{cookie:'synthetic-cookie'},body:'synthetic-raw-body'},
            timing:{version:Timing.VERSION,domain:'api-process',origin:'request-handler-entry',outcome:status==='completed'?'completed':'running',
                milestonesMs:{apiReceived:0,providerRequest:10,providerCompleted:30},durationsMs:{totalMs:40},headers:{Authorization:'synthetic-timing-secret'},reasoning:'synthetic-timing-reasoning'}}};
}
function harness(value=record()){
    const host={ctActive:true,cloudSignedIn:true,cloudProfileId:accountId,cloudUser:{id:accountId,isAdmin:true,role:'admin'},ctWorkspace:{scope:{accountId}},
        _cloud:{epoch:1,request(){throw Error('Download must not make a request');}},ctMtlDebugOrigin:'origin',ctMtlDebugWindow:{fieldId:'text',record:value}};
    const dialog={...Debug.Dialog.data(),host};Object.defineProperty(dialog,'item',{get:()=>host.ctMtlDebugWindow});
    for(const[name,method]of Object.entries(Debug.Dialog.methods))dialog[name]=method.bind(dialog);
    return{host,dialog};
}
async function globals(values,run){
    const previous=Object.fromEntries(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(global,key)]));
    for(const[key,value]of Object.entries(values))Object.defineProperty(global,key,{configurable:true,writable:true,value});
    try{return await run();}finally{for(const[key,value]of Object.entries(previous))if(value)Object.defineProperty(global,key,value);else delete global[key];}
}
async function unzip(blob){
    const zip=await JSZip.loadAsync(await blob.arrayBuffer()),files={};
    for(const[name,file]of Object.entries(zip.files)){assert.equal(file.dir,false);files[name]=JSON.parse(await file.async('string'));}
    return files;
}

test('Download all creates one real Unicode ZIP with every safe section and a manifest',async()=>{
    const original=record(),before=JSON.stringify(original),h=harness(original),downloads=[];
    await globals({JSZip,saveAs:(blob,name)=>downloads.push({blob,name})},async()=>{
        assert.equal(await h.dialog.downloadAll(),true);assert.equal(downloads.length,1);assert.equal(downloads[0].name,'sdeditor-mtl-debug-synthetic-request.zip');
        assert.equal(downloads[0].blob.type,'application/zip');const files=await unzip(downloads[0].blob);
        assert.deepEqual(Object.keys(files).sort(),['context.json','inference-settings.json','manifest.json','prompt.json','request-identity.json','request.json','response.json','timing.json','validation-error.json'].sort());
        assert.equal(files['prompt.json'].instructions,original.server.providerRequest.instructions);assert.equal(files['context.json'].note,original.server.context.note);
        assert.equal(files['request.json'].source,original.server.source);assert.equal(files['response.json'].translation,original.server.response.translation);
        assert.ok(files['response.json'].translation.length>30000);assert.match(files['response.json'].translation,/unicode-tail$/);
        assert.deepEqual(files['inference-settings.json'],{version:'mtl-inference-settings-v1',model:'gpt-6-luna',effort:'xhigh'});
        assert.equal(files['request-identity.json'].requestId,requestId);assert.equal(files['request-identity.json'].scope.accountId,accountId);
        assert.equal(files['validation-error.json'].validation,'passed');assert.equal(files['validation-error.json'].error.code,'SYNTHETIC_CODE');
        assert.equal(files['timing.json'].api.durationsMs.totalMs,40);assert.equal(files['timing.json'].groups.length,4);
        assert.deepEqual(files['manifest.json'].missingSections,[]);assert.equal(files['manifest.json'].format,'sdeditor-mtl-debug-v1');
        for(const entry of Object.values(files['manifest.json'].sections))assert.equal(entry.status,'available');
        assert.doesNotMatch(JSON.stringify(files),/synthetic-(?:token|header-secret|raw-reasoning|input-reasoning|response-reasoning|settings-reasoning|error-secret|raw-response|credentials|cookie|raw-body|timing-secret|timing-reasoning|provider-config)/);
        assert.equal(h.dialog.downloadBusy,false);assert.equal(h.dialog.downloadError,'');assert.equal(h.dialog.downloadMessage,'Download started.');
    });assert.equal(JSON.stringify(original),before,'Export never changes the diagnostic record');
});

test('preview, preparation, running and failure snapshots distinguish missing sections from explicit null responses',()=>{
    for(const status of ['preview','preparing','running','failed']){
        const value={status,snapshot:{source:'Synthetic source',context:{note:'Available browser context'}}};
        if(status!=='preview'){value.requestId=requestId;value.browserTiming=Timing.create({now:()=>0}).snapshot();}
        if(status==='running')value.server={requestId,status,response:null,validation:'pending'};
        if(status==='failed')value.server={requestId,status,response:null,validation:'rejected',failureReason:'output_invalid',error:{code:'MTL_OUTPUT_INVALID'}};
        const bundle=Debug.downloadBundle(value,{loading:status==='running',error:status==='failed'?'Server diagnostics are unavailable.':''}),manifest=JSON.parse(bundle.files['manifest.json']);
        assert.equal(manifest.sections.prompt.status,'missing');assert.equal(manifest.sections.prompt.file,null);assert.ok(manifest.missingSections.includes('prompt'));
        assert.equal(manifest.sections.inferenceSettings.status,'missing');assert.equal(manifest.status,status);assert.equal(manifest.diagnosticsLoading,status==='running');
        if(status==='preview')assert.equal(manifest.sections.timing.status,'missing');else assert.equal(manifest.sections.timing.status,'available');
        if(['running','failed'].includes(status)){assert.equal(manifest.sections.response.status,'empty');assert.equal(bundle.files['response.json'],'null\n');}
        else{assert.equal(manifest.sections.response.status,'missing');assert.equal(bundle.files['response.json'],undefined);}
        if(status==='failed')assert.equal(JSON.parse(bundle.files['validation-error.json']).diagnosticsError,'Server diagnostics are unavailable.');
    }
    const wrong=record();wrong.server.requestId='another-request';
    assert.equal(JSON.parse(Debug.downloadBundle(wrong).files['timing.json']).api,null,'API timings require the matching request ID');
});

test('bounded lookup evidence enters the sanitized ZIP request section with call and wait accounting',async()=>{
    const value=record();value.server.lookup={enabled:true,rounds:[{round:1,queries:[{kind:'keyword',recordId:'Spark',sheet:'KeywordPopups'}],
        results:[{queryIndex:0,unavailable:true,truncated:false,records:[]}],startedAt:1,finishedAt:3,elapsedMs:2,status:'received'}],
        calls:[{round:1,startedAt:0,finishedAt:1,elapsedMs:1,status:'completed'},{round:2,startedAt:3,finishedAt:7,elapsedMs:4,status:'completed'}],
        budget:{version:'mtl-local-byte-budget-v1',callReservations:2,requestBytesReserved:12345,receivedStreamBytes:4200,outputTextBytes:500,
            providerTokenCapEnforced:false,providerTokens:null,reasoningTokens:null},providerRequests:[{
            instructions:'Quoted synthetic prompt',input:[{role:'user',content:'Synthetic context'},{type:'reasoning',text:'hidden-lookup-reasoning'}],
            headers:{Authorization:'Bearer lookup-private-secret'},credentials:'lookup-private-credential',reasoning:{text:'hidden-lookup-thought'} }]};
    const downloads=[],h=harness(value);
    await globals({JSZip,saveAs:blob=>downloads.push(blob)},async()=>{
        assert.equal(await h.dialog.downloadAll(),true);const files=await unzip(downloads[0]),lookup=files['request.json'].lookup;
        assert.equal(lookup.rounds[0].queries[0].recordId,'Spark');assert.equal(lookup.rounds[0].elapsedMs,2);
        assert.equal(lookup.calls[1].elapsedMs,4);assert.equal(lookup.budget.callReservations,2);assert.equal(lookup.budget.requestBytesReserved,12345);
        assert.equal(lookup.budget.outputTextBytes,500);assert.equal(lookup.budget.providerTokenCapEnforced,false);
        assert.equal(lookup.budget.providerTokens,null);assert.equal(lookup.budget.reasoningTokens,null);
        assert.equal(lookup.budget.outputTokensReserved,undefined);assert.equal(lookup.budget.totalTokenUpperBound,undefined);
        assert.doesNotMatch(JSON.stringify(files),/lookup-private-secret|lookup-private-credential|hidden-lookup-reasoning|hidden-lookup-thought/);
    });
});

test('Cloudflare debug ZIP retains a bounded sanitized terminal chunk trail even with a null final response',async()=>{
    const value=record('failed'),content='Visible rejected output ไทย Bearer synthetic-hidden-token '+'x'.repeat(2000);
    value.server.response=null;value.server.streamSummary={events:304,completedEventSeen:false,cloudflare:{version:'cloudflare-stream-v1',
        stopSeen:true,doneSeen:false,acceptedTrailingChunks:2,omittedChunks:1,rawBody:'synthetic-raw-stream',
        chunks:Array.from({length:8},(_,index)=>({event:index+1,phase:'after-stop',disposition:index===7?'rejected':'trailing',object:'chat.completion.chunk',
            idMatches:true,id:'synthetic-private-id',choicesCount:3,malformedJson:index===7,error:{message:'synthetic-provider-error'},
            choices:Array.from({length:3},()=>({index:0,finishReason:'stop',role:'assistant',content,contentCharacters:content.length,
                reasoningPresent:true,refusalPresent:true,toolsPresent:true,deltaKind:'object',contentKind:'string',
                unknownDeltaFieldsPresent:true,unknownChoiceFieldsPresent:false,audioPresent:true,reasoning_content:'synthetic-hidden-thought',
                refusal:'synthetic-private-refusal',tool_calls:'synthetic-private-tool',arbitrary:'synthetic-arbitrary'}))}))}};
    const before=JSON.stringify(value),downloads=[],h=harness(value);
    await globals({JSZip,saveAs:blob=>downloads.push(blob)},async()=>{
        assert.equal(await h.dialog.downloadAll(),true);const files=await unzip(downloads[0]),trail=files['stream-chunks.json'];
        assert.equal(files['response.json'],null);assert.equal(files['manifest.json'].sections.streamChunks.status,'available');
        assert.equal(trail.stopSeen,true);assert.equal(trail.doneSeen,false);assert.equal(trail.acceptedTrailingChunks,2);assert.equal(trail.omittedChunks,3);
        assert.equal(trail.chunks.length,6);assert.equal(trail.chunks[0].event,3);assert.equal(trail.chunks[5].disposition,'rejected');
        assert.equal(trail.chunks[5].choices.length,2);assert.equal(trail.chunks[5].choices[0].content.length,1024);assert.equal(trail.chunks[5].choices[0].contentTruncated,true);
        assert.equal(trail.chunks[5].choices[0].contentCharacters,content.length);assert.equal(trail.chunks[5].choices[0].reasoningPresent,true);
        assert.equal(trail.chunks[5].choices[0].deltaKind,'object');assert.equal(trail.chunks[5].choices[0].contentKind,'string');
        assert.equal(trail.chunks[5].choices[0].unknownDeltaFieldsPresent,true);assert.equal(trail.chunks[5].choices[0].unknownChoiceFieldsPresent,false);
        assert.equal(trail.chunks[5].choices[0].audioPresent,true);
        assert.match(trail.chunks[5].choices[0].content,/Visible rejected output ไทย Bearer \[redacted\]/);
        assert.deepEqual(files['request.json'].streamSummary.cloudflare,trail);
        assert.doesNotMatch(JSON.stringify(files),/synthetic-(?:hidden-token|raw-stream|private-id|provider-error|hidden-thought|private-refusal|private-tool|arbitrary)/);
    });assert.equal(JSON.stringify(value),before,'Chunk export does not change retained diagnostics');
    value.server.streamSummary.cloudflare.chunks[7].choices[0]={deltaKind:'synthetic-private-kind',contentKind:'synthetic-private-kind',
        unknownDeltaFieldsPresent:'synthetic-private-flag',unknownChoiceFieldsPresent:true,audioPresent:{secret:'synthetic-private-audio'}};
    const invalid=JSON.parse(Debug.downloadBundle(value).files['stream-chunks.json']).chunks[5].choices[0];
    assert.equal(invalid.deltaKind,'other');assert.equal(invalid.contentKind,'other');assert.equal(invalid.unknownDeltaFieldsPresent,false);
    assert.equal(invalid.unknownChoiceFieldsPresent,true);assert.equal(invalid.audioPresent,false);assert.doesNotMatch(JSON.stringify(invalid),/synthetic-private/);
});

test('archive and entry filenames never incorporate unsafe IDs, paths or credential-like values',()=>{
    for(const id of ['../private','..\\private','C:\\private','a/b','a\u0000b','日本語','x'.repeat(81),'Bearer synthetic-token','sk-syntheticsecret123']){
        const bundle=Debug.downloadBundle({...record(),requestId:id});assert.equal(bundle.filename,'sdeditor-mtl-debug-request.zip');
        for(const filename of Object.keys(bundle.files))assert.match(filename,/^[a-z-]+\.json$/);
    }
    assert.equal(Debug.downloadBundle({status:'preview',snapshot:{}}).filename,'sdeditor-mtl-debug-preview.zip');
});

test('preparation ignores repeated clicks and retains the exact clicked snapshot through same-request updates',async()=>{
    const wait=deferred(),downloads=[],h=harness(record('running'));let preparations=0,prepared;
    class Zip{constructor(){this.files={};prepared=this.files;}file(name,text){this.files[name]=text;}generateAsync(){preparations++;return wait.promise;}}
    await globals({JSZip:Zip,saveAs:(blob,name)=>downloads.push({blob,name})},async()=>{
        const pending=h.dialog.downloadAll();assert.equal(h.dialog.downloadBusy,true);assert.equal(await h.dialog.downloadAll(),false);assert.equal(preparations,1);
        const before=h.host.ctMtlDebugWindow;h.host.ctMtlDebugWindow={...before,loading:false,record:{...before.record,status:'completed'}};
        Debug.Dialog.watch.item.call(h.dialog,h.host.ctMtlDebugWindow,before);assert.equal(h.dialog.downloadBusy,true);
        wait.resolve('synthetic-blob');assert.equal(await pending,true);assert.equal(downloads.length,1);assert.equal(h.dialog.downloadBusy,false);
        assert.equal(JSON.parse(new TextDecoder().decode(prepared['manifest.json'])).status,'running','The ZIP keeps its clicked snapshot when the request finishes');
    });
});

test('Admin, account, selection, client and dialog fences discard late ZIPs without a download or stale error',async()=>{
    const changes=[h=>h.host.ctActive=false,h=>h.host.cloudSignedIn=false,h=>h.host.cloudUser.role='manager',h=>h.host.cloudProfileId='other',
        h=>h.host.ctWorkspace.scope.accountId='other',h=>h.host.ctMtlDebugOrigin='another-selection',h=>h.host._cloud={epoch:2},
        h=>h.host.ctMtlDebugWindow=null,h=>h.host.ctMtlDebugWindow={...h.host.ctMtlDebugWindow,fieldId:'other'},
        h=>h.host.ctMtlDebugWindow={...h.host.ctMtlDebugWindow,record:{...h.host.ctMtlDebugWindow.record,requestId:'another-request'}},h=>h.dialog.resetDownload()];
    for(const change of changes){
        const wait=deferred(),h=harness();let downloads=0;
        class Zip{file(){}generateAsync(){return wait.promise;}}
        await globals({JSZip:Zip,saveAs:()=>downloads++},async()=>{
            const pending=h.dialog.downloadAll();change(h);wait.resolve('synthetic-blob');assert.equal(await pending,false);assert.equal(downloads,0);assert.equal(h.dialog.downloadError,'');
        });
    }
    for(const change of [h=>h.host.cloudUser.role='translator',h=>h.host.cloudUser.role='manager',h=>h.host.ctActive=false,h=>h.host.ctMtlDebugWindow.record.origin='old-selection']){
        const h=harness();change(h);
        await globals({JSZip:class{constructor(){throw Error('Must not prepare');}},saveAs:()=>{throw Error('Must not download');}},async()=>assert.equal(await h.dialog.downloadAll(),false));
    }
});

test('dependency and generation failures remain generic, keep the dialog usable and permit an explicit retry',async()=>{
    const h=harness();let downloads=0;
    await globals({JSZip:null,saveAs:()=>downloads++},async()=>assert.equal(await h.dialog.downloadAll(),false));
    const message=h.dialog.downloadError;assert.match(message,/Could not prepare the ZIP/);assert.equal(h.dialog.downloadBusy,false);
    class FailedZip{file(){}async generateAsync(){throw Error('synthetic-private-provider-failure');}}
    await globals({JSZip:FailedZip,saveAs:()=>downloads++},async()=>assert.equal(await h.dialog.downloadAll(),false));
    assert.equal(h.dialog.downloadError,message);assert.equal(downloads,0);
    const wait=deferred();class RetryZip{file(){}generateAsync(){return wait.promise;}}
    await globals({JSZip:RetryZip,saveAs:()=>downloads++},async()=>{
        const pending=h.dialog.downloadAll();assert.equal(h.dialog.downloadError,message,'Retry preparation does not clear a failure');
        wait.resolve('synthetic-blob');assert.equal(await pending,true);assert.equal(h.dialog.downloadError,'');assert.equal(downloads,1);
    });
});
