const {test}=require('node:test');
const assert=require('node:assert/strict');
const UI=require('../public/mtlConnectionUi.js');
const clone=value=>structuredClone(value),deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const metadata=(changes={})=>({enabled:true,state:'connected',revision:4,connected:true,expiresAt:1800000000000,connectedAt:1700000000000,
    updatedAt:1750000000000,requiresReauthorization:false,remoteRevocationConfirmed:false,hostedConnectAvailable:false,bootstrap:'local-sign-in-import',canDisconnect:true,canRevoke:true,...changes});
function harness(changes={}){
    const requests=[],app={...UI.mixin.data(),cloudSignedIn:true,cloudProfileId:'admin1',cloudUser:{id:'admin1',isAdmin:true,role:'admin',assignmentVersion:2},
        privateMediaEpoch:1,_cloud:{epoch:1,request:async(path,options)=>{requests.push({path,options});return{connection:metadata()};}},...changes};
    for(const[name,method]of Object.entries(UI.mixin.methods))app[name]=method.bind(app);
    for(const[name,getter]of Object.entries(UI.mixin.computed))Object.defineProperty(app,name,{get:()=>getter.call(app)});
    return {app,requests,watch(){UI.mixin.watch.mtlConnectionAccessKey.handler.call(app,'new','old');}};
}
test('metadata load is explicit, preserves settled state while working, and exposes only allowlisted fields',async()=>{
    const h=harness();assert.equal(h.requests.length,0);assert.equal(h.app.mtlConnectionLoaded,false);
    const input=metadata({access_token:'NEVER_STORE',refresh_token:'NEVER_STORE',client_id:'NEVER_STORE',account:{name:'NEVER_STORE'},credentialPath:'NEVER_STORE'});
    h.app._cloud.request=async(path,options)=>{h.requests.push({path,options});return{connection:input,token:'NEVER_STORE'};};
    assert.equal(await h.app.mtlConnectionLoad(),true);
    assert.deepEqual(h.app.mtlConnectionState,metadata());assert.ok(!JSON.stringify(h.app.mtlConnectionState).includes('NEVER_STORE'));
    assert.equal(h.requests[0].path,'/v1/admin/mtl/connection');assert.equal(h.requests[0].options.method,'GET');
    assert.equal(h.requests[0].options.body,undefined);assert.equal(h.app.mtlConnectionLabel,'Connected');
    const wait=deferred();h.app._cloud.request=()=>wait.promise;const pending=h.app.mtlConnectionLoad();
    assert.equal(h.app.mtlConnectionBusy,true);assert.equal(h.app.mtlConnectionLoaded,true);assert.deepEqual(h.app.mtlConnectionState,metadata());
    wait.resolve({connection:metadata({revision:5})});assert.equal(await pending,true);assert.equal(h.app.mtlConnectionBusy,false);
});
test('sanitization never enumerates credential fields and rejects unsafe connection metadata',()=>{
    const input=metadata();Object.defineProperty(input,'access_token',{enumerable:true,get(){throw new Error('Credentials must not be accessed');}});
    assert.deepEqual(UI.sanitizeConnection(input),metadata());
    for(const changes of [{state:'oauth-start'},{revision:-1},{revision:1.5},{enabled:'true'},{connected:1},{hostedConnectAvailable:true},
        {bootstrap:'browser-import'},{expiresAt:'2030-01-01'},{updatedAt:Infinity},{canDisconnect:'true'},{canRevoke:'true'}])assert.throws(()=>UI.sanitizeConnection(metadata(changes)),TypeError);
});
test('only the configured signed-in Admin can load metadata or execute actions',async()=>{
    for(const changes of [{cloudSignedIn:false},{cloudProfileId:'other'},{cloudUser:{id:'admin1',isAdmin:false,role:'admin'}},
        {cloudUser:{id:'admin1',isAdmin:false,role:'manager'}},{cloudUser:{id:'admin1',isAdmin:false,role:'translator'}},{cloudUser:{id:'admin1',isAdmin:true,role:'translator'}}]){
        const h=harness(changes);assert.equal(await h.app.mtlConnectionLoad(),false);assert.equal(await h.app.mtlConnectionAction('disconnect'),false);
        assert.equal(h.requests.length,0);assert.equal(h.app.mtlConnectionState,null);
    }
});
test('account, role, assignment, sign-in and client changes fence pending metadata',async()=>{
    for(const change of [h=>h.app.cloudUser.id='other',h=>h.app.cloudUser.isAdmin=false,h=>h.app.cloudUser.role='manager',h=>h.app.cloudUser.assignmentVersion++,h=>h.app.cloudSignedIn=false,
        h=>h.app.cloudProfileId='other',h=>h.app._cloud={epoch:1,request:async()=>({connection:metadata()})},h=>h.app._cloud.epoch++,h=>h.app.privateMediaEpoch++]){
        const h=harness(),wait=deferred();h.app._cloud.request=()=>wait.promise;const pending=h.app.mtlConnectionLoad();change(h);
        wait.resolve({connection:metadata()});assert.equal(await pending,false);assert.equal(h.app.mtlConnectionState,null);
        assert.equal(h.app.mtlConnectionLoaded,false);assert.equal(h.app.mtlConnectionError,'');assert.equal(h.app.mtlConnectionBusy,false);
    }
});
test('access watcher resets metadata and aborts in-flight work without loading again',async()=>{
    const h=harness();await h.app.mtlConnectionLoad();const wait=deferred();let signal;
    h.app._cloud.request=(path,options)=>{signal=options.signal;return wait.promise;};const pending=h.app.mtlConnectionLoad();h.watch();
    assert.equal(signal.aborted,true);assert.equal(h.app.mtlConnectionState,null);assert.equal(h.app.mtlConnectionLoaded,false);
    wait.resolve({connection:metadata()});assert.equal(await pending,false);assert.equal(h.app.mtlConnectionState,null);
});
test('only disconnect and revoke use exact POST routes and revision-only request bodies',async()=>{
    for(const action of UI.actions){
        const h=harness();await h.app.mtlConnectionLoad();h.requests.length=0;
        h.app._cloud.request=async(path,options)=>{h.requests.push({path,options});return{connection:metadata({revision:5,state:'disconnected',connected:false,canRevoke:false})};};
        assert.equal(await h.app.mtlConnectionAction(action),true);assert.equal(h.requests[0].path,'/v1/admin/mtl/connection/'+action);
        assert.equal(h.requests[0].options.method,'POST');assert.deepEqual(h.requests[0].options.body,{expectedRevision:4});assert.equal(h.requests[0].options.timeout,45000);
        assert.equal(h.app.mtlConnectionLabel,'Disconnected');
    }
    const h=harness();for(const action of ['connect','import','oauth','../revoke','',null])await assert.rejects(h.app.mtlConnectionAction(action),TypeError);
    assert.equal(h.requests.length,0);
});
test('duplicate actions are blocked and pending actions cannot publish into a changed session',async()=>{
    const h=harness();await h.app.mtlConnectionLoad();const wait=deferred();let posts=0;
    h.app._cloud.request=()=>{posts++;return wait.promise;};const pending=h.app.mtlConnectionAction('disconnect');
    assert.equal(await h.app.mtlConnectionAction('revoke'),false);assert.equal(await h.app.mtlConnectionLoad(),false);assert.equal(posts,1);
    h.app._cloud.epoch++;wait.resolve({connection:metadata({state:'disconnected',connected:false,revision:5})});
    assert.equal(await pending,false);assert.equal(h.app.mtlConnectionState,null);assert.equal(h.app.mtlConnectionBusy,false);
});
test('status loads cannot clear a failed action; only the relevant successful action clears its failure',async()=>{
    const h=harness();await h.app.mtlConnectionLoad();h.app._cloud.request=async()=>{throw new Error('NEVER_SHOW credential=private');};
    assert.equal(await h.app.mtlConnectionAction('revoke'),false);const error=h.app.mtlConnectionError;assert.ok(error);assert.ok(!error.includes('NEVER_SHOW'));
    h.app._cloud.request=async()=>({connection:metadata()});assert.equal(await h.app.mtlConnectionLoad(),true);assert.equal(h.app.mtlConnectionError,error);
    assert.equal(await h.app.mtlConnectionAction('disconnect'),true);assert.equal(h.app.mtlConnectionError,error,'A different action does not confirm remote revocation.');
    h.app.mtlConnectionState=metadata();assert.equal(await h.app.mtlConnectionAction('revoke'),true);assert.equal(h.app.mtlConnectionError,'');
});
test('recent Admin verification guidance persists through status load and does not rely on activity',async()=>{
    const h=harness();await h.app.mtlConnectionLoad();h.app._cloud.request=async()=>{throw Object.assign(new Error('private server details'),{code:'MTL_ADMIN_REAUTH_REQUIRED',status:403});};
    assert.equal(await h.app.mtlConnectionAction('disconnect'),false);assert.match(h.app.mtlConnectionError,/sign in again with Google as Admin/);
    assert.match(h.app.mtlConnectionError,/five minutes/);assert.match(h.app.mtlConnectionGuidance,/activity does not extend/);
    assert.equal(h.app.mtlConnectionRequiresAdminReauth,true);h.app._cloud.request=async()=>({connection:metadata()});await h.app.mtlConnectionLoad();
    assert.equal(h.app.mtlConnectionRequiresAdminReauth,true);assert.equal(await h.app.mtlConnectionAction('disconnect'),true);
    assert.equal(h.app.mtlConnectionRequiresAdminReauth,false);
});
test('409 adopts only validated current metadata and preserves the actionable conflict',async()=>{
    const h=harness();await h.app.mtlConnectionLoad();h.app._cloud.request=async()=>{throw Object.assign(new Error('unsafe details'),
        {status:409,code:'MTL_CONNECTION_CHANGED',current:{connection:metadata({revision:6,access_token:'NEVER_STORE'})}});};
    assert.equal(await h.app.mtlConnectionAction('disconnect'),false);assert.equal(h.app.mtlConnectionState.revision,6);
    assert.equal(h.app.mtlConnectionState.access_token,undefined);assert.match(h.app.mtlConnectionError,/connection changed/);
    h.app._cloud.request=async()=>({connection:metadata({revision:6})});await h.app.mtlConnectionLoad();assert.match(h.app.mtlConnectionError,/connection changed/);
    h.app._cloud.request=async()=>{throw Object.assign(new Error(),{status:409,code:'MTL_CONNECTION_CHANGED',current:{connection:metadata({revision:9,hostedConnectAvailable:true})}});};
    await h.app.mtlConnectionAction('disconnect');assert.equal(h.app.mtlConnectionState.revision,6);
});
test('unconfigured states disable actions while explicit capability flags allow disconnecting intermediate states',async()=>{
    const h=harness();await h.app.mtlConnectionLoad();
    for(const state of ['disabled','not-configured','not-connected','disconnected','unavailable']){
        h.app.mtlConnectionState=metadata({state,connected:false,canDisconnect:false,canRevoke:false});assert.equal(h.app.mtlConnectionCanDisconnect,false);assert.equal(h.app.mtlConnectionCanRevoke,false);
        assert.equal(await h.app.mtlConnectionAction('disconnect'),false);
    }
    h.app.mtlConnectionState=metadata({state:'not-configured',revision:0,connected:false,canDisconnect:false,canRevoke:false});
    assert.match(h.app.mtlConnectionGuidance,/local sign-in helper/);assert.equal(h.app.mtlConnectionState.hostedConnectAvailable,false);
    for(const state of ['refreshing','revoking']){
        h.app.mtlConnectionState=metadata({state,canDisconnect:true,canRevoke:false});assert.equal(h.app.mtlConnectionCanDisconnect,true);assert.equal(h.app.mtlConnectionCanRevoke,false);
    }
    h.app.mtlConnectionState=metadata({enabled:false});assert.equal(h.app.mtlConnectionGenerationDisabled,true);assert.equal(h.app.mtlConnectionLabel,'Connected');
    assert.equal(h.app.mtlConnectionCanDisconnect,true);assert.equal(h.app.mtlConnectionCanRevoke,true);
});

test('unconfirmed revocation adopts guarded safe metadata while preserving its action error through status loads',async()=>{
    const h=harness();await h.app.mtlConnectionLoad();const connection=metadata({state:'revocation-failed',connected:false,revision:5,access_token:'NEVER_STORE'});
    h.app._cloud.request=async()=>{throw Object.assign(new Error('private raw message'),{status:502,code:'MTL_REVOCATION_UNCONFIRMED',details:{connection}});};
    assert.equal(await h.app.mtlConnectionAction('revoke'),false);assert.equal(h.app.mtlConnectionState.state,'revocation-failed');assert.equal(h.app.mtlConnectionState.revision,5);
    assert.equal(h.app.mtlConnectionState.access_token,undefined);assert.match(h.app.mtlConnectionError,/Remote revocation was not confirmed/);
    assert.match(h.app.mtlConnectionError,/translation service account settings/);const error=h.app.mtlConnectionError;
    h.app._cloud.request=async()=>({connection});assert.equal(await h.app.mtlConnectionLoad(),true);assert.equal(h.app.mtlConnectionError,error);
    const wait=deferred();h.app._cloud.request=()=>wait.promise;const pending=h.app.mtlConnectionAction('revoke');h.app.cloudUser.assignmentVersion++;
    wait.reject(Object.assign(new Error(),{status:502,code:'MTL_REVOCATION_UNCONFIRMED',details:{connection}}));assert.equal(await pending,false);assert.equal(h.app.mtlConnectionState,null);
});

test('action timeout is actionable without automatic replay, while an explicit reset remains silent',async()=>{
    const h=harness();await h.app.mtlConnectionLoad();let calls=0;
    h.app._cloud.request=async()=>{calls++;throw Object.assign(new Error('private timeout detail'),{name:'AbortError'});};
    assert.equal(await h.app.mtlConnectionAction('revoke'),false);assert.equal(calls,1);assert.match(h.app.mtlConnectionError,/timed out/);
    assert.match(h.app.mtlConnectionError,/check its status/);assert.ok(!h.app.mtlConnectionError.includes('private'));
    const wait=deferred();h.app._cloud.request=()=>wait.promise;const pending=h.app.mtlConnectionAction('revoke');h.app.mtlConnectionReset();
    wait.reject(Object.assign(new Error(),{name:'AbortError'}));assert.equal(await pending,false);assert.equal(h.app.mtlConnectionError,'');
});
