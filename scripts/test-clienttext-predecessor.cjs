const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const S=require('../public/clientTextState.js');
const {unit,fieldId,asset}=require('./clienttext-storage-fixture.cjs');
function harness(){
    const window={ClientTextState:S,Vue:{markRaw:value=>value}},context=vm.createContext({window,console,AbortController,setTimeout,clearTimeout,setInterval,clearInterval});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/clientTextUi.js'),'utf8'),context);
    const mixin=window.ClientTextUI.mixin,app={...mixin.data(),managedCatalogScope:'alice:poe2',cloudProfileId:'alice',gameVersion:'poe2',branchId:'default',ctUploadVersion:{id:'target'},_ctAbort:new AbortController()};
    for(const [name,method]of Object.entries(mixin.methods))app[name]=method.bind(app);
    return app;
}
const prior=()=>({version:{id:'previous-with-content',game:'poe2',branchId:'default'},group:{id:'previous-group',versionId:'previous-with-content',contentMode:'clienttext',language:'Thai'}});
test('preparation asks the API for release ancestry rather than guessing from catalog order',async()=>{
    for(const contentMode of ['clienttext','statdescription']){
        const app=harness(),calls=[],result=prior();
        if(contentMode==='statdescription'){result.group.contentMode=contentMode;result.group.language=null;}
        app.managedVersions=[{id:'newer-unrelated',contentGroups:[{id:'wrong',contentMode}]}];
        app._cloud={async request(url,options){calls.push({url,options});return result;}};
        assert.equal((await app.ctFindPreviousGroup({contentMode,language:'Thai'})).group.id,'previous-group');
        const query=new URL('http://fixture'+calls[0].url).searchParams;
        assert.equal(query.get('versionId'),'target');assert.equal(query.get('contentMode'),contentMode);
        assert.equal(query.get('language'),contentMode==='clienttext'?'Thai':null);
        assert.equal(calls[0].options.signal,app._ctAbort.signal);
    }
});
test('late or mismatched predecessor discovery cannot become another upload scope',async()=>{
    const changes=[app=>app.managedCatalogScope='bob:poe2',app=>app.ctUploadVersion={id:'new-target'},app=>app.gameVersion='poe1',app=>app._ctAbort.abort()];
    for(const change of changes){const app=harness();app._cloud={async request(){change(app);return prior();}};
        await assert.rejects(app.ctFindPreviousGroup({contentMode:'clienttext',language:'Thai'}),error=>error.name==='AbortError');}
    for(const mutation of [result=>result.group.language='French',result=>result.group.versionId='other',result=>result.version.game='poe1',result=>result.version.id='target']){
        const app=harness(),result=prior();mutation(result);app._cloud={async request(){return result;}};
        await assert.rejects(app.ctFindPreviousGroup({contentMode:'clienttext',language:'Thai'}),/does not match/);
    }
    const app=harness();app._cloud={async request(){return{version:null,group:null};}};
    assert.equal(await app.ctFindPreviousGroup({contentMode:'clienttext',language:'Thai'}),null);
});
test('ClientText compares and proves carried work from the discovered group beyond omitted versions',async()=>{
    const app=harness(),original=unit(),incoming=unit('Changed source'),oldManifest=await S.buildManifest([original],[asset]),manifest=await S.buildManifest([incoming],[asset]),calls=[];
    app.managedVersions=[{id:'omitted-content',contentGroups:[]}];
    app._ctStore={async getMetadata(){return{state:'ready'};},async getUnits(){return[original];},async getAsset(){return{parsed:{sheets:[]},tree:oldManifest.trees.normal};},async getProof(){throw new Error('A comparison must not reread the workbook proof tree per ID.');}};
    app._cloud={async request(url){calls.push(url);if(url.startsWith('/v1/content-predecessor'))return prior();return{events:[{sequence:1,unitId:original.id,unit:{id:original.id,revision:3,values:{[fieldId]:'Accepted prior target'},reviewed:{}}}],hasMore:false};}};
    const prepared={contentMode:'clienttext',language:'Thai',units:[incoming],assets:[{...asset,parsed:{sheets:[]}}],manifest,warnings:[]};
    await app.ctPrepareCarry(prepared);
    assert.equal(prepared.parentGroupId,'previous-group');assert.equal(prepared.carry.length,1);
    const carry=prepared.carry[0];assert.equal(carry.values[fieldId],'Accepted prior target');assert.equal(carry.provenance.groupId,'previous-group');assert.equal(carry.provenance.revision,3);
    assert.equal(S.verifyWitness(carry.previousBaseline,oldManifest.units[0],carry.previousProof,oldManifest.descriptors[0]),true);
    assert.equal(S.verifyWitness(carry.baseline,manifest.units[0],carry.proof,manifest.descriptors[0]),true);
    assert.match(calls[1],/^\/v1\/content-groups\/previous-group\/events/);
});

test('carry comparison reads each previous proof tree once and preserves every membership proof',async()=>{
    const app=harness(),template=unit(),originals=Array.from({length:96},(_,index)=>({...template,recordId:'record-'+index,id:JSON.stringify([template.role,template.sheet,'record-'+index])}));
    const incoming=originals.map(original=>({...original,fields:original.fields.map(field=>({...field,source:'Changed dialogue'}))}));
    const oldManifest=await S.buildManifest(originals,[asset]),manifest=await S.buildManifest(incoming,[asset]);let assetReads=0;
    app._ctStore={async getMetadata(){return{state:'ready'};},async getUnits(){return originals;},async getAsset(){assetReads++;return{parsed:{sheets:[]},tree:oldManifest.trees.normal};},async getProof(){throw new Error('Per-ID aggregate reads are forbidden.');}};
    app._cloud={async request(url){return url.startsWith('/v1/content-predecessor')?prior():{events:[],hasMore:false};}};
    const prepared={contentMode:'clienttext',language:'Thai',units:incoming,assets:[{...asset,parsed:{sheets:[]}}],manifest,warnings:[]};
    await app.ctPrepareCarry(prepared);assert.equal(assetReads,1);assert.equal(prepared.carry.length,originals.length);
    const oldById=new Map(oldManifest.units.map(compact=>[compact.id,compact])),nextById=new Map(manifest.units.map(compact=>[compact.id,compact]));
    for(const carried of prepared.carry){
        assert.equal(S.verifyWitness(carried.previousBaseline,oldById.get(carried.id),carried.previousProof,oldManifest.descriptors[0]),true);
        assert.equal(S.verifyWitness(carried.baseline,nextById.get(carried.id),carried.proof,manifest.descriptors[0]),true);
        assert.equal(carried.sourceOnly,true);
    }
});

test('cancelled carry comparison cannot publish partial prepared work after an awaited tree read',async()=>{
    const app=harness(),original=unit(),incoming=unit('Changed'),manifest=await S.buildManifest([incoming],[asset]);
    app._cloud={async request(){return prior();}};
    app._ctStore={async getMetadata(){return{state:'ready'};},async getUnits(){return[original];},async getAsset(){app._ctAbort.abort();return{parsed:{sheets:[]}};}};
    const prepared={contentMode:'clienttext',language:'Thai',units:[incoming],assets:[{...asset,parsed:{sheets:[]}}],manifest,warnings:[]};
    await assert.rejects(app.ctPrepareCarry(prepared),error=>error.name==='AbortError');assert.equal(prepared.carry,undefined);
});
