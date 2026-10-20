'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Resource=require('../public/clientTextResourceSync.js'),A=require('../public/contentAdapters.js');
const S=require('../public/clientTextState.js'),TM=require('../public/translationMemory.js');
const {scope:originalScope,unit:makeUnit}=require('./clienttext-storage-fixture.cjs');
const fs=require('node:fs'),vm=require('node:vm');
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
