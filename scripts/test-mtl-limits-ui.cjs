'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const UI=require('../public/mtlLimitsUi.js'),{quota}=require('./mtl-limits-fixture.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function harness(changes={}){
    const requests=[],app={...UI.mixin.data(),cloudSignedIn:true,cloudProfileId:'synthetic-admin',cloudUser:{id:'synthetic-admin',role:'admin',isAdmin:true,assignmentVersion:1},
        settingsDialogVisible:false,settingsTab:'editor',privateMediaEpoch:1,_cloud:{epoch:1,request:async(path,options={})=>{
            requests.push({path,options});return{quota:quota('synthetic-admin',options.method==='PUT'?{revision:1,limits:options.body.limits,mutationId:options.body.mutationId,appliedRevision:1}:{})};}},...changes};
    for(const[name,method]of Object.entries(UI.mixin.methods))app[name]=method.bind(app);
    for(const[name,getter]of Object.entries(UI.mixin.computed))Object.defineProperty(app,name,{get:()=>getter.call(app)});
    return{app,requests,watch(){UI.mixin.watch.mtlLimitsAccessKey.handler.call(app);}};
}
test('limits load is read-only and current server counters remain independent of unsaved edits',async()=>{
    const h=harness();assert.equal(h.requests.length,0);assert.equal(await h.app.mtlLimitsLoad(),true);
    assert.equal(h.requests[0].path,'/v1/admin/mtl/limits');assert.equal(h.requests[0].options.method,undefined);
    assert.equal(h.app.mtlLimitsState.usage.user.day.used,12);assert.equal(h.app.mtlLimitsState.usage.shared.day.used,40);
    h.app.mtlLimitsDraft.userDay=75;assert.equal(h.app.mtlLimitsDirty,true);await h.app.mtlLimitsLoad();
    assert.equal(h.app.mtlLimitsDraft.userDay,75);assert.equal(h.app.mtlLimitsState.usage.user.day.limit,50);assert.equal(h.app.mtlLimitsState.usage.user.day.used,12);
    assert.equal(h.requests.every(value=>!value.options.body),true);
});
test('sanitization selects quota metadata only and rejects another account, malformed counters or limits',()=>{
    const input=quota();Object.defineProperty(input,'credentials',{enumerable:true,get(){throw Error('Do not read credentials');}});
    const clean=UI.sanitize(input,'synthetic-admin');assert.equal(clean.credentials,undefined);assert.equal(clean.usage.shared.subscriptionId,undefined);
    for(const mutate of [value=>value.revision=-1,value=>value.usage.user.id='other',value=>value.usage.user.day.used=-1,
        value=>value.usage.user.day.limit=4,value=>value.usage.timezone='invalid',value=>value.bounds.userMinute.max=Infinity,
        value=>value.usage.user.minute.fullyResetsAt='invalid',value=>value.limits.userWeek=0]){
        const value=quota();mutate(value);assert.throws(()=>UI.sanitize(value,'synthetic-admin'),TypeError);
    }
});
test('only the configured signed-in Admin can read or save limits',async()=>{
    for(const changes of [{cloudSignedIn:false},{cloudProfileId:'other'},{cloudUser:{id:'synthetic-admin',role:'admin',isAdmin:false}},
        {cloudUser:{id:'synthetic-admin',role:'manager',isAdmin:true}},{cloudUser:{id:'synthetic-admin',role:'translator',isAdmin:false}}]){
        const h=harness(changes);assert.equal(await h.app.mtlLimitsLoad(),false);assert.equal(await h.app.mtlLimitsSave(),false);assert.equal(h.requests.length,0);
    }
});
test('explicit Save sends only supported limits with revision and mutation ID; usage is not reset',async()=>{
    const h=harness();await h.app.mtlLimitsLoad();h.app.mtlLimitsDraft.userDay=75;
    assert.equal(await h.app.mtlLimitsSave(),true);const request=h.requests.at(-1);assert.equal(request.options.method,'PUT');
    assert.deepEqual(Object.keys(request.options.body).sort(),['expectedRevision','limits','mutationId']);assert.equal(request.options.body.expectedRevision,0);
    assert.equal(typeof request.options.body.mutationId,'string');assert.equal(h.app.mtlLimitsState.limits.userDay,75);
    assert.equal(h.app.mtlLimitsState.usage.user.day.used,12);assert.equal(h.app.mtlLimitsPending,false);assert.equal(h.app.mtlLimitsDirty,false);
});
test('invalid edits never send a write and cannot substitute an aggregate per-user numerator',async()=>{
    for(const value of ['',0,-1,1.5,NaN,Infinity,1000001,'55']){
        const h=harness();await h.app.mtlLimitsLoad();h.app.mtlLimitsDraft.userDay=value;
        assert.ok(h.app.mtlLimitsValidation);assert.equal(await h.app.mtlLimitsSave(),false);assert.equal(h.requests.length,1);
    }
    const h=harness();await h.app.mtlLimitsLoad();const row=UI.rows.find(value=>value.key==='userDay');assert.equal(h.app.mtlLimitsBucket(row).used,12);
});
test('an uncertain Save retains exact body and ID until explicit retry; background reads do not clear its error',async()=>{
    const h=harness();await h.app.mtlLimitsLoad();h.app.mtlLimitsDraft.userDay=75;let body;
    h.app._cloud.request=async(_path,options={})=>{if(options.method==='PUT'){body=structuredClone(options.body);throw new TypeError('Synthetic interrupted save');}return{quota:quota()};};
    assert.equal(await h.app.mtlLimitsSave(),false);const failure=h.app.mtlLimitsSaveError;assert.equal(h.app.mtlLimitsPending,true);
    await h.app.mtlLimitsLoad();assert.equal(h.app.mtlLimitsSaveError,failure);assert.equal(h.app.mtlLimitsDraft.userDay,75);
    h.app._cloud.request=async(_path,options)=>{assert.deepEqual(options.body,body);return{quota:quota('synthetic-admin',{revision:1,limits:body.limits,mutationId:body.mutationId,appliedRevision:1})};};
    assert.equal(await h.app.mtlLimitsSave(),true);assert.equal(h.app.mtlLimitsSaveError,'');assert.equal(h.app.mtlLimitsPending,false);
});
test('revision conflict refreshes current values but preserves the Admin draft for review',async()=>{
    const h=harness();await h.app.mtlLimitsLoad();h.app.mtlLimitsDraft.userDay=75;
    h.app._cloud.request=async()=>{throw Object.assign(new Error('Synthetic conflict'),{status:409,code:'MTL_LIMITS_CHANGED',details:{quota:quota('synthetic-admin',{revision:2,limits:{userDay:60}})}});};
    assert.equal(await h.app.mtlLimitsSave(),false);assert.equal(h.app.mtlLimitsState.limits.userDay,60);assert.equal(h.app.mtlLimitsDraft.userDay,75);
    assert.equal(h.app.mtlLimitsState.usage.user.day.used,12);assert.equal(h.app.mtlLimitsPending,false);assert.match(h.app.mtlLimitsSaveError,/Compare/);
});
test('background quota refresh cannot silently advance the revision of an edited limits form',async()=>{
    const h=harness();await h.app.mtlLimitsLoad();h.app.mtlLimitsDraft.userDay=75;
    h.app._cloud.request=async(_path,options={})=>{
        const current=quota('synthetic-admin',{revision:2,limits:{concurrency:3}});
        if(options.method!=='PUT')return{quota:current};
        assert.equal(options.body.expectedRevision,0,'The edited form keeps its original revision even after polling');
        throw Object.assign(new Error('Synthetic peer change'),{status:409,code:'MTL_LIMITS_CHANGED',details:{quota:current}});
    };
    await h.app.mtlLimitsLoad();assert.equal(h.app.mtlLimitsState.revision,2);assert.equal(h.app.mtlLimitsDraftRevision,0);
    assert.equal(h.app.mtlLimitsDraft.concurrency,2);assert.equal(await h.app.mtlLimitsSave(),false);
    assert.equal(h.app.mtlLimitsDraftRevision,2,'Explicit conflict review can retry against the returned current revision');
});
test('older API is gracefully unsupported and failed refresh preserves settled quota and edits',async()=>{
    const h=harness();await h.app.mtlLimitsLoad();h.app.mtlLimitsDraft.userDay=75;
    h.app._cloud.request=async()=>{throw new TypeError('Unsafe private transport detail');};assert.equal(await h.app.mtlLimitsLoad(),false);
    assert.equal(h.app.mtlLimitsDraft.userDay,75);assert.equal(h.app.mtlLimitsState.usage.user.day.used,12);assert.doesNotMatch(h.app.mtlLimitsLoadError,/Unsafe/);
    h.app._cloud.request=async()=>{throw Object.assign(new Error('Old API'),{status:404});};assert.equal(await h.app.mtlLimitsLoad(),false);
    assert.equal(h.app.mtlLimitsUnsupported,true);assert.equal(h.app.mtlLimitsCanSave,false);
});
test('scope reset aborts requests and removes counters, pending changes and late responses',async()=>{
    for(const save of [false,true]){
        const h=harness();await h.app.mtlLimitsLoad();h.app.mtlLimitsDraft.userDay=75;const wait=deferred();let signal;
        h.app._cloud.request=async(_path,options)=>{signal=options.signal;return wait.promise;};const pending=save?h.app.mtlLimitsSave():h.app.mtlLimitsLoad();
        h.app.cloudSignedIn=false;h.watch();assert.equal(signal.aborted,true);assert.equal(h.app.mtlLimitsState,null);assert.deepEqual(h.app.mtlLimitsDraft,{});
        wait.resolve({quota:quota()});assert.equal(await pending,false);assert.equal(h.app.mtlLimitsState,null);assert.equal(h.app.mtlLimitsPending,false);
    }
});
test('authorization rejection removes quota data and automatic polling stops',async()=>{
    const h=harness();await h.app.mtlLimitsLoad();h.app._cloud.request=async()=>{throw Object.assign(new Error('Denied'),{status:403});};
    assert.equal(await h.app.mtlLimitsLoad(),false);assert.equal(h.app.mtlLimitsState,null);assert.equal(h.app._mtlLimitsDenied,true);assert.equal(await h.app.mtlLimitsLoad(),false);
});
test('limits from an earlier client cannot be saved through a replacement client without a fresh read',async()=>{
    const h=harness();await h.app.mtlLimitsLoad();h.app.mtlLimitsDraft.userDay=75;let writes=0;
    h.app._cloud={epoch:1,request:async(_path,options={})=>{if(options.method==='PUT')writes++;return{quota:quota('synthetic-admin',{revision:3,limits:{userDay:60}})};}};
    assert.equal(h.app.mtlLimitsCanSave,false);assert.equal(await h.app.mtlLimitsSave(),false);assert.equal(writes,0);
    assert.equal(await h.app.mtlLimitsLoad(),true);assert.equal(h.app.mtlLimitsDraft.userDay,60);assert.equal(h.app.mtlLimitsDraftRevision,3);
});
test('usage may exceed a reduced limit and reset labels use the server timezone and actual reset windows',async()=>{
    const value=quota('synthetic-admin',{limits:{userDay:5}}),clean=UI.sanitize(value,'synthetic-admin');assert.equal(clean.usage.user.day.used,12);assert.equal(clean.usage.user.day.limit,5);
    const h=harness();await h.app.mtlLimitsLoad();assert.match(h.app.mtlLimitsResetText(UI.rows[0]),/Next release.*fully clears/);
    assert.equal(h.app.mtlLimitsResetText(UI.rows[3]),'When requests finish');
});
