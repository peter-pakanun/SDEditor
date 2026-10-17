/* Admin-only numeric timings. Browser and API clocks remain independent. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ClientTextMtlTiming=api;})(typeof window!=='undefined'?window:globalThis,function(root){
    'use strict';
    const VERSION='mtl-timing-v1',MAX_MS=600000;
    const browserPoints=['click','capabilitiesStart','capabilitiesEnd','roleHintsStart','roleHintsEnd','toneNotesStart','toneNotesEnd','contextStart','contextEnd','pendingStoreStart','pendingStoreEnd','postStart','postEnd','firstProgress','firstTextFrameReady','candidateReceived','adoptionStart','adoptionEnd','finalFrameReady','cancelRequested','finished'];
    const apiPoints=['apiReceived','admitted','credentialsStart','credentialsReady','providerRequest','providerHeaders','providerFirstByte','providerFirstEvent','providerFirstOutputText','providerFirstTranslation','providerCompleted','providerStreamEnd','validationStart','validationEnd','persistenceEnd','cancelRequested','finished'];
    const browserPairs={capabilitiesMs:['capabilitiesStart','capabilitiesEnd'],roleHintsMs:['roleHintsStart','roleHintsEnd'],toneNotesMs:['toneNotesStart','toneNotesEnd'],contextMs:['contextStart','contextEnd'],pendingStoreMs:['pendingStoreStart','pendingStoreEnd'],postRoundTripMs:['postStart','postEnd'],adoptionMs:['adoptionStart','adoptionEnd'],totalMs:['click','finished']};
    const apiDurations=['admissionMs','credentialsMs','providerHeadersMs','providerFirstEventMs','providerFirstTextMs','streamMs','validationMs','persistenceMs','totalMs'];
    const outcomes=['running','completed','failed','cancelled','stale','recovery','unavailable'];
    const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=MAX_MS?Math.round(value*10)/10:null;
    const difference=(points,a,b)=>points?.[a]!==null&&points?.[b]!==null&&typeof points?.[a]==='number'&&typeof points?.[b]==='number'&&points[b]>=points[a]?number(points[b]-points[a]):null;
    function sanitize(value,domain){
        if(!value||value.version!==VERSION||value.domain!==domain)return null;
        const points=domain==='browser'?browserPoints:apiPoints,keys=domain==='browser'?Object.keys(browserPairs):apiDurations;
        return{version:VERSION,domain,origin:['translate-click','request-handler-entry','service-entry'].includes(value.origin)?value.origin:'unavailable',
            outcome:outcomes.includes(value.outcome)?value.outcome:'unavailable',milestonesMs:Object.fromEntries(points.map(key=>[key,number(value.milestonesMs?.[key])])),durationsMs:Object.fromEntries(keys.map(key=>[key,number(value.durationsMs?.[key])]))};
    }
    function create({now=()=>root.performance.now(),onChange=()=>{}}={}){
        let start;try{start=now();}catch(_){return null;}if(!Number.isFinite(start))return null;
        const points=Object.fromEntries(browserPoints.map(key=>[key,null]));points.click=0;let outcome='running',last=0;
        const notify=()=>{try{onChange();}catch(_){/* Diagnostics never affect generation. */}};
        const mark=name=>{
            if(!Object.hasOwn(points,name)||points[name]!==null||outcome!=='running'&&!(name==='firstTextFrameReady'&&outcome==='completed'||name==='finalFrameReady'&&['completed','failed','cancelled'].includes(outcome)))return false;
            let elapsed;try{elapsed=now()-start;}catch(_){return false;}if(number(elapsed)===null)return false;
            points[name]=last=Math.max(last,elapsed);notify();return true;
        };
        return{mark,finish(value='completed'){if(outcome!=='running')return;mark('finished');outcome=outcomes.includes(value)?value:'failed';notify();},
            snapshot(){return{version:VERSION,domain:'browser',origin:'translate-click',outcome,milestonesMs:Object.fromEntries(Object.entries(points).map(([key,value])=>[key,number(value)])),durationsMs:Object.fromEntries(Object.entries(browserPairs).map(([key,[a,b]])=>[key,difference(points,a,b)]))};}};
    }
    function states(record={}){return{browser:sanitize(record.browserTiming,'browser'),api:record.requestId&&record.server?.requestId===record.requestId?sanitize(record.server.timing,'api-process'):null};}
    function groups(record={}){
        const {browser,api}=states(record);
        const rows=(entries,values)=>entries.map(([key,label])=>({key,label,value:values?.[key]??null}));
        return[
            {title:'Browser phases',description:'Durations measured in this browser. Parallel or overlapping rows must not be added.',rows:rows([['capabilitiesMs','Capabilities check'],['roleHintsMs','Initial role resolution'],['toneNotesMs','Fresh tone-note reads (parallel wall time)'],['contextMs','Context preparation'],['pendingStoreMs','Pending request storage'],['postRoundTripMs','Admission POST round trip (includes network/proxy)'],['adoptionMs','Candidate validation and adoption'],['totalMs',browser?.outcome==='recovery'?'Click to recovery handoff':'Click to workflow completion']],browser?.durationsMs)},
            {title:'Browser milestones',description:'Offsets from Translate click. Frame ready means DOM update plus an animation-frame callback; it does not prove a screen paint.',rows:rows([['firstProgress','First nonempty progress received'],['firstTextFrameReady','First provisional text frame ready'],['candidateReceived','Final candidate received'],['finalFrameReady','Final state frame ready'],['cancelRequested','Stop requested']],browser?.milestonesMs)},
            {title:'API phases',description:'Independent API-process durations. Admission begins at the route handler, after body parsing; total ends at durable job completion, before response delivery.',rows:rows([['admissionMs','Handler to admission'],['credentialsMs','Credential acquisition (including any refresh)'],['streamMs','Response headers to stream EOF'],['validationMs','Final authorization and validation'],['persistenceMs','Durable result and review evidence'],['totalMs','API job total']],api?.durationsMs)},
            {title:'Observed provider wait',description:'API observations since provider dispatch. These include transport and provider time; queue and reasoning durations cannot be distinguished.',rows:[['providerHeaders','Response headers'],['providerFirstByte','First response-body bytes'],['providerFirstEvent','First parsed SSE event'],['providerFirstOutputText','First output-text delta'],['providerFirstTranslation','First nonempty translation prefix'],['providerCompleted','Terminal completion event'],['providerStreamEnd','Stream EOF']].map(([key,label])=>({key,label,value:difference(api?.milestonesMs,'providerRequest',key)}))}
        ];
    }
    return{VERSION,create,sanitize,states,groups,format:value=>number(value)===null?'Unavailable':number(value).toFixed(1)+' ms'};
});
