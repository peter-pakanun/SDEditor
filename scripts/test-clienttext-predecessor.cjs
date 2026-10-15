const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const S=require('../public/clientTextState.js');
const {unit,fieldId,asset}=require('./clienttext-storage-fixture.cjs');
const AUDIO_MARKERS=['[NOAUDIO]','[NO AUDIO]','[OLD AUDIO]','[AUDIOTEST]'];
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
test('new release predecessor discovery is bound to the HEAD captured by the upload dialog',async()=>{
    const app=harness();app.ctUploadVersion=null;app.ctUploadPredecessor={id:'captured-head',name:'Captured release'};
    app._cloud={async request(url){assert.equal(new URL('http://fixture'+url).searchParams.get('expectedHeadId'),'captured-head');return prior();}};
    assert.equal((await app.ctFindPreviousGroup({contentMode:'clienttext',language:'Thai'})).group.id,'previous-group');
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
test('ClientText carries trusted sparse facts and work from the discovered group beyond omitted versions',async()=>{
    const app=harness(),original=unit(),incoming=unit('Changed source'),oldManifest=await S.buildManifest([original],[asset]),manifest=await S.buildManifest([incoming],[asset]),calls=[];
    app.managedVersions=[{id:'omitted-content',contentGroups:[]}];
    app._ctStore={async getMetadata(){return{state:'ready'};},async getUnits(){return[original];},async getAsset(){return{...asset,parserVersion:S.PARSER_VERSION,parsed:{sheets:[]}};},async getProof(){throw new Error('A comparison must not reread the workbook proof tree per ID.');}};
    app._cloud={async request(url){calls.push(url);if(url.startsWith('/v1/content-predecessor'))return prior();return{events:[{sequence:1,unitId:original.id,unit:{id:original.id,revision:3,values:{[fieldId]:'Accepted prior target'},reviewed:{}}}],hasMore:false};}};
    const prepared={contentMode:'clienttext',language:'Thai',units:[incoming],assets:[{...asset,parsed:{sheets:[]}}],manifest,warnings:[]};
    await app.ctPrepareCarry(prepared);
    assert.equal(prepared.parentGroupId,'previous-group');assert.equal(prepared.carry.length,1);
    const carry=prepared.carry[0];assert.equal(carry.values[fieldId],'Accepted prior target');assert.equal(carry.provenance.groupId,'previous-group');assert.equal(carry.provenance.revision,3);
    assert.deepEqual(JSON.parse(JSON.stringify(carry.previousFacts)),S.clientFacts(original));
    assert.deepEqual(JSON.parse(JSON.stringify(carry.clientFacts)),S.clientFacts(incoming));
    assert.deepEqual(JSON.parse(JSON.stringify(carry.previousOriginalValues)),S.originalValues(original));
    assert.equal(carry.previousAssetHash,asset.hash);assert.equal(carry.baseline,undefined);assert.equal(carry.proof,undefined);
    assert.match(calls[1],/^\/v1\/content-groups\/previous-group\/events/);
});

test('carry comparison reads each previous asset once and emits only affected-unit facts',async()=>{
    const app=harness(),template=unit(),originals=Array.from({length:96},(_,index)=>({...template,recordId:'record-'+index,id:JSON.stringify([template.role,template.sheet,'record-'+index])}));
    const incoming=originals.map(original=>({...original,fields:original.fields.map(field=>({...field,source:'Changed dialogue'}))}));
    const oldManifest=await S.buildManifest(originals,[asset]),manifest=await S.buildManifest(incoming,[asset]);let assetReads=0;
    app._ctStore={async getMetadata(){return{state:'ready'};},async getUnits(){return originals;},async getAsset(){assetReads++;return{...asset,parserVersion:S.PARSER_VERSION,parsed:{sheets:[]}};},async getProof(){throw new Error('Per-ID aggregate reads are forbidden.');}};
    app._cloud={async request(url){return url.startsWith('/v1/content-predecessor')?prior():{events:[],hasMore:false};}};
    const prepared={contentMode:'clienttext',language:'Thai',units:incoming,assets:[{...asset,parsed:{sheets:[]}}],manifest,warnings:[]};
    await app.ctPrepareCarry(prepared);assert.equal(assetReads,1);assert.equal(prepared.carry.length,originals.length);
    const oldById=new Map(oldManifest.units.map(compact=>[compact.id,compact])),nextById=new Map(manifest.units.map(compact=>[compact.id,compact]));
    for(const carried of prepared.carry){
        assert.equal(carried.previousFacts.id,carried.id);assert.equal(carried.clientFacts.id,carried.id);
        assert.equal(carried.previousFacts.fields[0].sourceHash,S.sourceHash('Source'));assert.equal(carried.clientFacts.fields[0].sourceHash,S.sourceHash('Changed dialogue'));
        assert.equal(carried.provenance.revision,0);assert.equal(carried.sourceOnly,undefined,'API derives source-only from accepted predecessor state');
        assert.equal(carried.previousBaseline,undefined);assert.equal(carried.previousProof,undefined);
    }
});

test('cancelled carry comparison cannot publish partial prepared work after an awaited original asset read',async()=>{
    const app=harness(),original=unit(),incoming=unit('Changed'),manifest=await S.buildManifest([incoming],[asset]);
    app._cloud={async request(){return prior();}};
    app._ctStore={async getMetadata(){return{state:'ready'};},async getUnits(){return[original];},async getAsset(){app._ctAbort.abort();return{parsed:{sheets:[]}};}};
    const prepared={contentMode:'clienttext',language:'Thai',units:[incoming],assets:[{...asset,parsed:{sheets:[]}}],manifest,warnings:[]};
    await assert.rejects(app.ctPrepareCarry(prepared),error=>error.name==='AbortError');assert.equal(prepared.carry,undefined);
});


test('strict verified audio metadata add, remove and swap reviews meaningful dialogue without prior Saved work',async()=>{
    const sources=['Dialogue',...AUDIO_MARKERS.map(marker=>marker+' Dialogue')],pairs=[];
    for(const before of sources)for(const after of sources)if(before!==after)pairs.push([before,after]);
    for(const marker of AUDIO_MARKERS)pairs.push(['Dialogue',' '+marker+' Dialogue']);
    for(const [before,after] of pairs){
        const app=harness(),original=unit(before),incoming=unit(after,'Thai',true);
        app._ctStore={async getMetadata(){return{state:'ready'};},async getUnits(){return[original];},async getAsset(){return{...asset,parserVersion:S.PARSER_VERSION,parsed:{sheets:[]}};}};
        app._cloud={async request(route){return route.startsWith('/v1/content-predecessor')?prior():{events:[],hasMore:false};}};
        const prepared={contentMode:'clienttext',language:'Thai',units:[incoming],assets:[{...asset,parsed:{sheets:[]}}],warnings:[]};await app.ctPrepareCarry(prepared);
        assert.equal(prepared.carry[0].reviewed[fieldId],S.sourceHash(after));assert.equal(prepared.carry[0].provenance.revision,0);
        assert.equal(prepared.carry[0].previousFacts.fields[0].sourceHash,S.sourceHash(before));
        assert.equal(prepared.carry[0].clientFacts.fields[0].sourceHash,S.sourceHash(after));
        if(!after.includes('[NOAUDIO]'))assert.equal(prepared.carry[0].clientFacts.fields[0].sourceHash,S.hash(after),'new markers keep their accepted raw fingerprint');
        assert.equal(prepared.carry[0].clientFacts.fields[0].outdated,true);assert.equal(incoming.fields[0].source,after);
    }
});
test('missing predecessor evidence, malformed markers and actual dialogue changes never fabricate review',async()=>{
    const pairs=[];
    for(const marker of AUDIO_MARKERS){
        pairs.push([null,marker+' Dialogue'],['Dialogue',marker+'  Dialogue'],['Dialogue',marker+' New dialogue'],
            ['Dialogue','  '+marker+' Dialogue'],['Dialogue',marker.toLowerCase()+' Dialogue'],['Dialogue',marker+'\tDialogue']);
        for(const repeated of AUDIO_MARKERS)pairs.push(['Dialogue',marker+' '+repeated+' Dialogue']);
    }
    pairs.push(['Dialogue','[AUDIOFUTURE] Dialogue']);
    for(const [before,after] of pairs){
        const app=harness(),incoming=unit(after,'Thai',true);app._ctStore={async getMetadata(){return{state:'ready'};},async getUnits(){return before===null?[]:[unit(before)];},async getAsset(){return{...asset,parsed:{sheets:[]}};}};
        app._cloud={async request(route){return route.startsWith('/v1/content-predecessor')?prior():{events:[],hasMore:false};}};
        const prepared={contentMode:'clienttext',language:'Thai',units:[incoming],assets:[{...asset,parsed:{sheets:[]}}],warnings:[]};await app.ctPrepareCarry(prepared);
        assert.equal(prepared.carry[0]?.reviewed[fieldId],undefined);
    }
});
