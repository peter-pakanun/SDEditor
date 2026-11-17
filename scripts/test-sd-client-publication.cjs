const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const JSZip=require('../../SDEditor-API/node_modules/jszip');
const Codec=require('../public/statDescCodec.js');
const Publication=require('../public/sdClientPublication.js');
const Protocol=require('../public/collaborationProtocol.js');
const owner=path.resolve(__dirname,'../../SDEditor-API/src');
const backend=Promise.all(['sd-baseline-artifacts.js','source-carry.js'].map(name=>import(pathToFileURL(path.join(owner,name)).href)));
const file=(changes={})=>({filepath:'specific_skill_stat_descriptions/test/test.txt',name:'test',stats:['test_stat'],variables:['#'],remarks:[''],
    translations:{English:['Fire damage'],Thai:['เดิม'],French:['Original']},...changes});
async function prepared(files){return Publication.prepare({rawSource:structuredClone(files),identity:{zipHash:'a'.repeat(64),zipSize:100,fileCount:files.length}},[]);}
async function original(files){const zip=new JSZip();for(const desc of files)zip.file(desc.filepath,Codec.descEncode(desc),{createFolders:false});return new File([await zip.generateAsync({type:'uint8array',compression:'DEFLATE'})],'StatDescriptions.zip');}

test('browser source facts and aggregate summaries match API calculation without retaining a full server catalog',async()=>{
    const [artifacts]=await backend,files=[file(),file({filepath:'specific_skill_stat_descriptions/blank/blank.txt',translations:{English:['One','Two'],Thai:['valid',''],German:['eins','zwei','obsolete']},variables:['#','#'],remarks:['','']}),
        file({filepath:'specific_skill_stat_descriptions/dnt/dnt.txt',translations:{English:['[DNT] internal'],Thai:['']}})];
    for(const desc of files)assert.deepEqual(await Publication.sourceFacts(desc),artifacts.sdSourceFacts(desc));
    assert.deepEqual(Publication.summary(files),artifacts.sdBaselineSummary(files));
    assert.equal(Publication.summary(files).summaries.Thai.missing,1);
    assert.equal(Publication.summary(files).summaries.Korean.error,0,'An absent tag is Missing only');
    assert.equal(Publication.summary(files).summaries.German.error,1);
});

test('incoming ZIP is parsed and hashed in the browser with exact immutable descriptor identity',async()=>{
    const files=[file()],blob=await original(files),parsed=await Publication.parse(blob,{JSZip,game:'poe2'}),built=await Publication.prepare(parsed,[]);
    assert.equal(parsed.identity.zipHash,await Protocol.zipHash(blob));assert.equal(built.archive.zipHash,parsed.identity.zipHash);
    assert.equal(built.archive.descriptionCount,1);assert.deepEqual(built.files.get(files[0].filepath).translations,files[0].translations);
    assert.equal(built.archive.treeRoot,undefined);assert.equal(parsed.original.size,blob.size);
    await assert.rejects(Publication.parse(blob,{JSZip,game:'poe1'}),/selected game/);
    const realZip=await JSZip.loadAsync(await blob.arrayBuffer()),entry=Object.values(realZip.files).find(item=>!item.dir);entry._data.crc32^=1;
    await assert.rejects(Publication.parse(blob,{JSZip:{loadAsync:async()=>realZip},game:'poe2'}),/checksum is invalid/);
});

test('duplicate decisions and existing v1 identities retain their exact accepted parser configuration',async()=>{
    const desc=file(),encoded=Codec.descEncode(desc),text=Codec.decodeUTF16(encoded),duplicate=text+'\r\nlang "Thai"\r\n\t1\r\n\t# "อีกค่า"\r\n',zip=new JSZip();
    zip.file(desc.filepath,new Uint8Array(Codec.strEncodeUTF16(duplicate).buffer));const blob=new File([await zip.generateAsync({type:'uint8array'})],'StatDescriptions.zip');
    const parsed=await Publication.parse(blob,{JSZip,game:'poe2'}),group=parsed.duplicateGroups[0];assert.equal(group.lang,'Thai');
    await assert.rejects(Publication.prepare(parsed,[]),/decisions/);
    const option=group.options[1],decisions=[{filepath:group.filepath,language:group.lang,occurrence:option.occurrence,blockHash:await Codec.blockHash(option)}],
        built=await Publication.prepare(parsed,decisions),canonical=await Protocol.finalizeArchive({...built.archive,version:1,treeRoot:'b'.repeat(64),baselineId:undefined});
    const accepted=await Publication.prepare(parsed,[],{canonicalArchive:canonical});assert.deepEqual(accepted.archive,canonical);
    assert.deepEqual(accepted.files.get(desc.filepath).translations.Thai,['อีกค่า']);
});

test('Saved dispositions preserve current carry rules, metadata corrections, source loss and explicit Use English',async()=>{
    const [,carry]=await backend,previous=file(),facts=await Publication.sourceFacts(previous),target=['Authored target'];
    const cases=[
        {label:'authored carry',next:file(),target,action:'carry'},
        {label:'unchanged explicit save already in source',next:file(),target:previous.translations.Thai,action:'baseline'},
        {label:'missing incoming tag',next:file({translations:{English:['Fire damage']}}),target,action:'drop'},
        {label:'blank incoming translation',next:file({translations:{English:['Fire damage'],Thai:[' ']}}),target,action:'drop'},
        {label:'changed English',next:file({translations:{English:['Cold damage'],Thai:['เดิม']}}),target,action:'drop'},
        {label:'metadata correction keeps saved work even if same target',next:file({name:'corrected'}),target:previous.translations.Thai,action:'carry'},
        {label:'unknown predecessor English',next:file(),target,facts:null,action:'drop'},
        {label:'removed file',next:null,target,action:'remove'},
    ];
    for(const scenario of cases){
        const built=await prepared(scenario.next?[scenario.next]:[file({filepath:'specific_skill_stat_descriptions/other/other.txt'})]);
        const record={id:scenario.label,kind:'saved',filepath:previous.filepath,translations:scenario.target,sourceFacts:Object.hasOwn(scenario,'facts')?scenario.facts:facts};
        const result=await Publication.disposition(record,'Thai',built);assert.equal(result.action,scenario.action,scenario.label);
        assert.equal(result.action,carry.classifySourceCarry(record.sourceFacts,scenario.next,'Thai',scenario.target).action,scenario.label+' matches server carry');
        if(['carry','baseline'].includes(result.action))assert.deepEqual(result.originalTranslations,scenario.next.translations.Thai);
        else assert.equal(result.originalTranslations,undefined);
    }
    const intent=await Codec.englishIntentFor(previous,'explicit-decision'),record={id:'english',kind:'saved',filepath:previous.filepath,translations:previous.translations.English,sourceFacts:null,englishIntent:intent};
    assert.equal((await Publication.disposition(record,'Thai',await prepared([file({translations:{English:['Fire damage']}})]))).action,'carry');
    assert.equal((await Publication.disposition(record,'Thai',await prepared([file({name:'changed',translations:{English:['Fire damage']}})]))).action,'drop');
    assert.equal((await Publication.disposition(record,'Thai',await prepared([file()]))).action,'drop','An upstream translation different from English needs review');
});

test('existing recovery generations remain frozen and only authoritative filepath absence removes their destination assignment',async()=>{
    const desc=file(),built=await prepared([desc]);
    for(const kind of ['dropped','recovery']){
        const record={id:kind,kind,filepath:desc.filepath,translations:['Frozen target'],originSourceHash:'c'.repeat(64)},before=structuredClone(record),result=await Publication.disposition(record,'Thai',built);
        assert.equal(result.action,'drop');assert.equal(result.translations,undefined);assert.deepEqual(record,before);
        assert.equal((await Publication.disposition(record,'Thai',await prepared([file({filepath:'specific_skill_stat_descriptions/other/other.txt'})]))).action,'remove');
    }
});

test('frozen records are paged and sent in bounded deterministic chunks without historical ZIP reads or client target replacements',async()=>{
    const desc=file(),built=await prepared([desc]),facts=await Publication.sourceFacts(desc),records=Array.from({length:205},(_,index)=>({id:'saved-'+index,kind:'saved',filepath:desc.filepath,translations:['Saved '+index],sourceFacts:facts})),
        snapshot={id:'frozen',recordCount:records.length,teams:[{language:'Thai',recordCount:records.length}]},calls=[],read=async(language,cursor)=>{
            calls.push({language,cursor});return{snapshotId:'frozen',language,total:records.length,records:records.slice(cursor,cursor+100),nextCursor:cursor+100<records.length?cursor+100:null};};
    const chunks=await Publication.buildDispositions(snapshot,read,built),retry=await Publication.buildDispositions(snapshot,read,built);
    assert.deepEqual(chunks,retry);assert.deepEqual(chunks.map(chunk=>chunk.records.length),[100,100,5]);assert.equal(calls.length,6);
    for(const [index,chunk]of chunks.entries()){
        assert.equal(chunk.index,index);assert.equal(chunk.storageProtocol,Publication.STORAGE_PROTOCOL);assert.ok(new TextEncoder().encode(JSON.stringify(chunk)).length<2*1024*1024);
        for(const item of chunk.records){assert.equal(item.translations,undefined);assert.equal(item.nextFacts.translations,undefined);assert.equal(item.nextFacts.english,undefined);}
    }
    const controller=new AbortController();controller.abort();await assert.rejects(Publication.buildDispositions(snapshot,read,built,{signal:controller.signal}),error=>error.name==='AbortError');
    await assert.rejects(Publication.buildDispositions(snapshot,async()=>({snapshotId:'another',language:'Thai',records,total:205}),built),/changed or is incomplete/);
});
