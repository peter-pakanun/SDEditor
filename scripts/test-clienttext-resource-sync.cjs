'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Resource=require('../public/clientTextResourceSync.js'),A=require('../public/contentAdapters.js');
const S=require('../public/clientTextState.js'),TM=require('../public/translationMemory.js');
const {scope:originalScope,unit:makeUnit}=require('./clienttext-storage-fixture.cjs');
const fs=require('node:fs'),vm=require('node:vm');
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
function harness(changes={}){
    const scope={...originalScope,groupId:'local:test:sync'},unit=makeUnit('Hello {0}','Target {0}');
    const host={...Resource.mixin.data(),cloudSignedIn:true,cloudProfileId:scope.accountId,cloudUser:{id:scope.accountId,role:'translator',language:scope.language},
        _cloud:{schedule(){}},ctWorkspace:{scope,metadata:{syncResources:true}},ctOfflineTest:true,lang:scope.language,gameVersion:scope.game,
        ctMemory:[],tmUnits:[],tmTombstones:[],tmScopeKey:'account:language',loadTranslationMemory:async()=>{},...changes};
    host.ctCurrent=ctx=>JSON.stringify(ctx.scope)===JSON.stringify(host.ctWorkspace?.scope);
    host.ctContext=()=>({scope:structuredClone(host.ctWorkspace.scope)});
    for(const[name,method]of Object.entries(Resource.mixin.methods))host[name]=method.bind(host);
    for(const[name,getter]of Object.entries(Resource.mixin.computed))Object.defineProperty(host,name,{get:()=>getter.call(host)});
    return{host,scope,unit};
}
test('resource sync requires explicit test opt-in and the selected account/assigned language; offline connectivity retains the retry queue',()=>{
    const {host,scope}=harness();assert.equal(host.ctResourceSyncEnabled,true);
    for(const change of [{cloudSignedIn:false},{cloudProfileId:'other'},{lang:'German'},{testMode:true},{_cloud:{destroyed:true}},
        {cloudUser:{id:scope.accountId,role:'translator',language:'German'}},{cloudUser:{id:scope.accountId,role:'translator',language:null}}]){
        assert.equal(harness(change).host.ctResourceSyncEnabled,false);
    }
    host.ctWorkspace.metadata.syncResources=false;assert.equal(host.ctResourceSyncEnabled,false);
    for(const role of ['manager','admin'])assert.equal(harness({cloudCanAccessAllLanguages:true,cloudUser:{id:scope.accountId,role,language:null}}).host.ctResourceSyncEnabled,true);
});
test('shared ClientText memory overlays cached rows, honors deletion and keeps SD, game and form contexts separate',()=>{
    const {host,unit,scope}=harness(),entry=A.clienttext.memoryUnits(unit,S.valuesFor(unit),scope.language,{game:scope.game})[0];
    host.ctMemory=[entry];host.tmUnits=[{...entry,target:'Remote correction'},TM.normalizeUnit({id:'sd',source:entry.source,target:'SD text',gameScope:scope.game})];
    assert.equal(host.ctEditorMemory.length,1);assert.equal(host.ctEditorMemory[0].target,'Remote correction');
    host.tmTombstones=[{...entry,deleted:true}];assert.deepEqual(host.ctEditorMemory,[]);
    host.ctWorkspace.metadata.syncResources=false;assert.equal(host.ctEditorMemory[0].target,entry.target);
});
test('only an eligible explicit save queues detached TM pairs with stable identity; failure can retry without publishing workbook state',async()=>{
    const {host,unit,scope}=harness(),previous=global.OfflineStore,calls=[];let fail=true;
    global.OfflineStore={async putTranslationMemoryUnits(captured,units,options){calls.push({captured,units,options});assert.equal(options.guard(),true);if(fail)throw Error('Synthetic storage failure');}};
    try{
        const saved={jobId:'exact-save',origin:'save',saved:true,values:S.valuesFor(unit),reviewed:{},savedAt:1};
        assert.equal(await host.ctQueueResourceMemory(host.ctContext(),unit,saved),false);assert.match(host.ctResourceIssue,/could not be queued/);
        saved.values[unit.fields[0].id]='Later typing';fail=false;
        assert.equal(await host.ctFlushResourceMemory(),true);assert.equal(host.ctResourceIssue,'');
        assert.equal(calls[1].units[0].target,'Target {0}');assert.equal(calls[1].options.mutationId,calls[0].options.mutationId);
        assert.deepEqual(calls[0].captured,{profile:scope.accountId,language:scope.language});
        assert.equal(calls[0].options.origin,'learn');assert.equal(calls[0].units[0].context.contentMode,'clienttext');
        assert.equal(calls[0].units[0].assets,undefined);assert.equal(calls[0].units[0].values,undefined);assert.equal(host._ctResourceJobs.size,0);
        const count=calls.length;await host.ctQueueResourceMemory(host.ctContext(),unit,{...saved,jobId:'invalid',values:{...S.valuesFor(unit),[unit.fields[0].id]:'Missing variable'}});
        assert.equal(calls.length,count,'invalid pairs never enter shared TM');
    }finally{global.OfflineStore=previous;}
});
test('closed or changed scopes cannot retry failed shared memory jobs into another account or workbook',async()=>{
    const {host,unit}=harness(),previous=global.OfflineStore;let calls=0;
    global.OfflineStore={async putTranslationMemoryUnits(){calls++;throw Error('Hold');}};
    try{
        await host.ctQueueResourceMemory(host.ctContext(),unit,{jobId:'old',saved:true,values:S.valuesFor(unit),reviewed:{}});
        host.ctWorkspace.scope={...host.ctWorkspace.scope,accountId:'other'};await host.ctFlushResourceMemory();assert.equal(calls,1);assert.equal(host._ctResourceJobs.size,0);
        host.ctClearResourceSync();assert.equal(host.ctResourceIssue,'');
    }finally{global.OfflineStore=previous;}
});

test('a workbook save publishes only acknowledged TM changes and does not reread the full language corpus',async()=>{
    const written=deferred(),started=deferred(),previous=global.OfflineStore,events=[];
    const {host,unit,scope}=harness({
        applyClientTextMemoryPatch(patch){events.push('patch');assert.equal(patch.profile,scope.accountId);return true;},
        loadTranslationMemory(){assert.fail('A bounded acknowledged save must not reload the entire language TM.');},
        _cloud:{schedule(){events.push('schedule');}},
    });
    global.OfflineStore={
        async putTranslationMemoryUnits(captured,units,options){
            assert.deepEqual(captured,{profile:scope.accountId,language:scope.language});assert.equal(options.returnChanges,true);assert.equal(options.notify,false);
            assert.equal(options.guard(),true);started.resolve();await written.promise;events.push('commit');
            return{changed:true,patch:{profile:scope.accountId,language:scope.language,previousVersion:7,localVersion:8,entries:[{unit:units[0],conflict:null}]}};
        },
        notifyTranslationMemoryChange(captured){assert.deepEqual(captured,{profile:scope.accountId,language:scope.language});events.push('notify');},
    };
    try{
        const saving=host.ctQueueResourceMemory(host.ctContext(),unit,{jobId:'bounded-save',saved:true,values:S.valuesFor(unit),reviewed:{}});
        await started.promise;assert.deepEqual(events,[],'No suggestion or peer notification may precede the durable acknowledgement.');
        written.resolve();assert.equal(await saving,true);assert.deepEqual(events,['commit','patch','notify','schedule']);assert.equal(host._ctResourceJobs.size,0);
    }finally{written.resolve();global.OfflineStore=previous;}
});

test('a stale snapshot falls back to a background TM reload without delaying the acknowledged workbook save',{timeout:1000},async()=>{
    const pendingReload=deferred(),previous=global.OfflineStore;let refreshes=0,notifications=0;
    const {host,unit}=harness({applyClientTextMemoryPatch:()=>false,loadTranslationMemory(){refreshes++;return pendingReload.promise;}});
    global.OfflineStore={async putTranslationMemoryUnits(){return{changed:true,patch:{}};},notifyTranslationMemoryChange(){notifications++;}};
    try{
        assert.equal(await host.ctQueueResourceMemory(host.ctContext(),unit,{jobId:'concurrent-save',saved:true,values:S.valuesFor(unit),reviewed:{}}),true);
        assert.equal(refreshes,1);assert.equal(notifications,1);assert.equal(host._ctResourceJobs.size,0);
    }finally{pendingReload.resolve();global.OfflineStore=previous;}
});

test('a late TM acknowledgement cannot publish a patch or notification in a replacement workbook/account',async()=>{
    const written=deferred(),started=deferred(),previous=global.OfflineStore;let published=0;
    const {host,unit}=harness({applyClientTextMemoryPatch(){published++;return true;},loadTranslationMemory(){published++;}});
    global.OfflineStore={async putTranslationMemoryUnits(){started.resolve();await written.promise;return{changed:true,patch:{}};},notifyTranslationMemoryChange(){published++;}};
    try{
        const saving=host.ctQueueResourceMemory(host.ctContext(),unit,{jobId:'outgoing-save',saved:true,values:S.valuesFor(unit),reviewed:{}});
        await started.promise;host.ctWorkspace.scope={...host.ctWorkspace.scope,accountId:'replacement-account'};written.resolve();await saving;
        assert.equal(published,0);assert.equal(host._ctResourceJobs.size,0);
    }finally{written.resolve();global.OfflineStore=previous;}
});

test('shared TM management validates ClientText literals and protected tokens with ClientText rules',()=>{
    const window={TranslationMemory:TM,ClientTextState:S};
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/tmUi.js'),'utf8'),{window});
    const validate=window.TranslationMemoryUI.mixin.methods.tmValidateUnit.bind({lang:'French'});
    const unit={source:'Literal @ \\n {0}',target:'Texte {0}',context:{contentMode:'clienttext',fieldId:'text',fieldKind:'text'}};
    assert.equal(validate(unit).valid,true,'@ and literal backslash-n are text, not SD columns/lines');
    assert.equal(validate({...unit,target:'Missing token'}).valid,false);
    assert.equal(validate({...unit,source:'',target:''}).valid,false);
    assert.equal(validate({...unit,context:{}}).valid,false,'SD retains its own structure validation');
});
