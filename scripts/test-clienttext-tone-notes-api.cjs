'use strict';
// Actual API serializers/storage against isolated in-memory SQLite. No config
// loaders, environment files, HTTP authentication or live provider calls are used.
const {test}=require('node:test'),assert=require('node:assert/strict'),{join}=require('node:path'),{pathToFileURL}=require('node:url');
const {DatabaseSync}=require('node:sqlite'),N=require('../public/clientTextToneNotes.js'),UI=require('../public/clientTextToneNotesUi.js');
const apiModule=()=>import(pathToFileURL(join(__dirname,'../../SDEditor-API/src/mtl-tone-notes.js')).href);
const K='npc:Metadata/NPC/Synthetic/First';
async function fixture(t){
    const API=await apiModule(),db=new DatabaseSync(':memory:');db.exec("CREATE TABLE version_branches(game TEXT,id TEXT,PRIMARY KEY(game,id));INSERT INTO version_branches VALUES('poe2','default');");
    API.migrateMtlToneNotes(db);t.after(()=>db.close());
    const scope={accountId:'synthetic',game:'poe2',branchId:'default',language:'Thai',groupId:'local:one',versionId:'one'},
        content={store:{db,clock:()=>1800000000000},account(userId,language){assert.equal(userId,'synthetic');assert.equal(language,'Thai');return{id:userId,name:'Actual API fixture author'};},versions:{branch(game,id){assert.equal(game,'poe2');assert.equal(id,'default');}}},
        service=new API.MtlToneNotesStore({content}),requests=[];
    const app={...UI.mixin.data(),ctActive:true,ctSelection:'npc',ctCurrentUnit:{id:'npc',sheet:'NPCs',recordId:K.slice(4),fields:[{name:'Name',source:'Synthetic NPC'}]},ctUnits:[],
        ctWorkspace:{scope},lang:'Thai',gameVersion:'poe2',branchId:'default',cloudSignedIn:true,cloudProfileId:'synthetic',cloudUser:{id:'synthetic',role:'translator',language:'Thai'},
        ctContext:()=>({scope:structuredClone(scope)}),ctCurrent:ctx=>JSON.stringify(ctx.scope)===JSON.stringify(scope),$nextTick:async callback=>callback?.()};
    let loseAck=false;
    app._cloud={request:async(path,options={})=>{
        requests.push({path,body:options.body&&structuredClone(options.body)});const url=new URL(path,'https://synthetic.invalid'),query=Object.fromEntries(url.searchParams),selected=N.scope(options.body?.scope||query);
        try{
            if(options.method==='PUT'){const result=service.save('synthetic',options.body);if(loseAck){loseAck=false;throw new TypeError('Synthetic lost acknowledgement');}return result;}
            if(url.pathname.endsWith('/latest'))return service.latest('synthetic',selected,query.identityKey);
            return service.history('synthetic',selected,query.identityKey,query.cursor?{cursor:query.cursor}:{});
        }catch(error){if(error.extra)error.current=error.extra.current;throw error;}
    }};
    for(const[name,method]of Object.entries(UI.mixin.methods))app[name]=method.bind(app);
    for(const[name,getter]of Object.entries(UI.mixin.computed))Object.defineProperty(app,name,{get:()=>getter.call(app)});
    return{API,db,scope,service,app,requests,loseAck(){loseAck=true;}};
}
test('client limits and normalization match the actual API for Unicode, controls, whitespace and identity bytes',async()=>{
    const API=await apiModule();
    for(const text of ['', ' '.repeat(300),' '.repeat(301),'😀'.repeat(300),'😀'.repeat(301),'  literal <b>text</b>\r\nline\r\t ', '\ud800', '\udc00','\u0000','\u007f','\u0085','\t\n']){
        let accepted=true,result;try{result=API.toneNoteText(text);}catch(_){accepted=false;}
        assert.equal(N.validText(text),accepted,JSON.stringify(text).slice(0,40));if(accepted)assert.equal(N.normalize(text),result.text);
    }
    for(const identityKey of [K,'npc:Metadata/NPC/ภาษา','npc:'+'é'.repeat(510),'npc:'+'é'.repeat(511),'character:Exact record ID','npc: leading','npc:trailing ','npc:\ud800']){
        let accepted=true;try{API.toneNoteIdentity(identityKey);}catch(_){accepted=false;}assert.equal(!!N.identity(identityKey),accepted);
    }
});
test('actual API latest/save/history/clear envelopes round-trip through the client without seeded examples',async t=>{
    const h=await fixture(t);await h.app.ctToneOpen(K);assert.equal(h.app.ctToneCurrent.draft,'');assert.equal(await h.app.ctToneSave(),false);
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM mtl_tone_notes').get().n,0);
    h.app.ctToneEdited('😀'.repeat(300));assert.equal(await h.app.ctToneSave(),true);assert.equal(h.app.ctToneCurrent.saved.revision,1);
    for(let revision=2;revision<=22;revision++)h.service.save('synthetic',{scope:N.scope(h.scope),identityKey:K,baseRevision:revision-1,mutationId:'synthetic-'+revision,text:'Revision '+revision});
    await h.app.ctToneLoad(K);assert.equal(h.app.ctToneCurrent.saved.revision,22);
    assert.equal(await h.app.ctToneLoadHistory(K),true);assert.equal(h.app.ctToneCurrent.history.length,20);assert.ok(h.app.ctToneCurrent.nextCursor);
    assert.equal(await h.app.ctToneLoadHistory(K,true),true);assert.equal(h.app.ctToneCurrent.history.length,22);
    assert.equal(h.app.ctToneCurrent.history[0].author.name,'Actual API fixture author');assert.equal(h.app.ctToneCurrent.history[0].updatedAt,1800000000000);
    h.app.ctToneEdited('');assert.equal(await h.app.ctToneSave(),true);assert.equal(h.app.ctToneCurrent.saved.revision,23);assert.equal(h.app.ctToneCurrent.saved.text,'');
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM mtl_tone_note_history').get().n,23);
    assert.ok(h.requests.every(value=>!JSON.stringify(value).includes(N.placeholder('Thai'))));
});
test('actual API stale conflicts and lost-ack replay preserve drafts and the original mutation body',async t=>{
    const h=await fixture(t);await h.app.ctToneOpen(K);h.app.ctToneEdited('My edit');h.loseAck();assert.equal(await h.app.ctToneSave(),false);
    const body=structuredClone(h.app.ctToneCurrent.pending);h.service.save('synthetic',{scope:N.scope(h.scope),identityKey:K,baseRevision:1,mutationId:'peer',text:'Peer edit'});
    assert.equal(await h.app.ctToneSave(),true);assert.equal(h.app.ctToneCurrent.draft,'My edit');assert.equal(h.app.ctToneCurrent.conflict.revision,2);
    assert.deepEqual(h.requests.filter(value=>value.body).map(value=>value.body),[body,body]);assert.deepEqual(h.app.ctToneNotesSnapshot([K]).entries,[]);
    h.app.ctToneResolveConflict(true);assert.equal(await h.app.ctToneSave(),true);assert.equal(h.app.ctToneCurrent.saved.revision,3);
});

test('blank NPC/filter cells through actual indexes refresh only the canonical-character saved note and reach API admission and fake provider input',async t=>{
    const h=await fixture(t),S=require('../public/clientTextState.js'),Context=require('../public/clientTextMtlContext.js'),Npc=require('../public/clientTextNpcIndex.js'),Convo=require('../public/clientTextConvoIndex.js'),
        api=name=>import(pathToFileURL(join(__dirname,'../../SDEditor-API/src',name)).href),
        {migrateMtlQuota}=await api('mtl-quota.js'),{createMtlService}=await api('mtl-service.js'),{createMtlProvider,MTL_PROMPT_VERSION}=await api('mtl-provider.js'),
        character='Metadata/Characters/Dex/DexFourb',identityKey='character:'+character,
        make=(sheet,recordId,source,metadata={})=>S.normalizeUnit({role:'normal',sheet,recordId,metadata,
            fields:[{id:'text',name:sheet==='NPCs'?'Name':'Text',kind:'text',source,target:''}]}),
        selected=make('NPCTalkDialogueTextAudio','Synthetic_Spirit_A_Dex4b=NoLore','Synthetic source {0}',
            {NPC:'',Character:character,'Character Filter':' \t\r\n ','Prohibited Character Filter':''}),
        first=make('NPCs','Metadata/NPC/Synthetic/First','Same Synthetic Name'),second=make('NPCs','Metadata/NPC/Synthetic/Second','Same Synthetic Name'),
        firstLine=make('NPCTalkDialogueTextAudio','Synthetic_Spirit_B','Synthetic first NPC dialogue.',{NPC:first.recordId,Character:''}),
        secondLine=make('NPCTalkDialogueTextAudio','Synthetic_Spirit_C','Synthetic second NPC dialogue.',{NPC:second.recordId,Character:''}),
        units=[selected,first,second,firstLine,secondLine],npcIndex=await Npc.buildNpcIndex(units,{yield:async()=>{}}),
        convoIndex=await Convo.buildConvoIndex(units,npcIndex,{yield:async()=>{}});
    assert.equal(convoIndex.memberships.get(selected.id).ambiguous,false);
    assert.deepEqual(convoIndex.memberships.get(selected.id).npcEvidence.participants[0].references,[first.recordId,second.recordId]);
    Object.assign(h.app,{ctCurrentUnit:selected,ctSelection:selected.id,ctUnits:units,_ctNpcIndex:npcIndex,_ctConvoIndex:convoIndex});
    assert.equal(await h.app.ctToneOpen(identityKey),true);assert.equal(h.app.ctToneCurrent.saved.revision,0);
    h.app.ctToneEdited('Synthetic saved voice guidance');assert.equal(await h.app.ctToneSave(),true);
    h.app.ctToneEdited('PRIVATE UNSAVED GUIDANCE');h.requests.length=0;
    const keys=N.roleKeys(h.app);assert.deepEqual(keys,[identityKey]);await h.app.ctToneNotesPrepare(keys);
    assert.equal(h.requests.length,1);assert.equal(new URL(h.requests[0].path,'https://synthetic.invalid').searchParams.get('identityKey'),identityKey);
    const context=Context.build({unit:selected,field:selected.fields[0],units,npcIndex,convoIndex,scope:h.scope,toneNotes:h.app.ctToneNotesSnapshot(keys)});
    assert.equal(context.roleHints.speaker.status,'suggested');assert.equal(context.roleHints.listener.status,'unknown');
    assert.deepEqual(context.roleHints.order.reasons,['ambiguous-npc-group-identity']);
    assert.deepEqual(context.roleHints.constraints,[]);
    assert.deepEqual(context.sharedToneNotes.entries,[{identityKey,revision:1,text:'Synthetic saved voice guidance',roles:['speaker']}]);
    assert.ok(!JSON.stringify(context).includes('PRIVATE UNSAVED GUIDANCE'));assert.equal(h.app.ctToneCurrent.draft,'PRIVATE UNSAVED GUIDANCE');
    migrateMtlQuota(h.db);let calls=0,wire;
    const provider=createMtlProvider({config:{enabled:true},tokenProvider:async()=> 'synthetic-test-only',transport:async(_url,options)=>{
        calls++;wire=JSON.parse(options.body);const text=JSON.stringify({translation:'Synthetic target {0}'}),
            response={id:'resp_synthetic',status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]};
        return new Response('data: '+JSON.stringify({type:'response.completed',response})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
    }}),service=createMtlService({db:h.db,clock:()=>1800000000000,config:{enabled:true},provider,toneNotes:h.service}),
        input={requestId:'synthetic-guarded-character',userId:'synthetic',consentVersion:'mtl-v2',scope:{...N.scope(h.scope),local:true},
            source:selected.fields[0].source,field:{id:selected.fields[0].id,name:'Text',kind:'text'},context},authorize=async()=>{};
    try{
        const result=await service.generate(input,{authorize});assert.equal(calls,1);assert.equal(MTL_PROMPT_VERSION,'clienttext-mtl-v8');
        assert.deepEqual(JSON.parse(wire.input[0].content).context.sharedToneNotes,context.sharedToneNotes);
        assert.match(wire.instructions,/row-character-convention evidence is a tentative speaker suggestion/);
        assert.match(wire.instructions,/Keep the listener unknown/);assert.equal(result.provenance.promptVersion,MTL_PROMPT_VERSION);
        assert.deepEqual(result.provenance.sharedToneNotes.entries,[{identityKey,revision:1,roles:['speaker']}]);
        h.service.save('synthetic',{scope:N.scope(h.scope),identityKey,text:'Synthetic peer guidance',baseRevision:1,mutationId:'synthetic-peer'});
        assert.deepEqual(await service.generate(input,{authorize}),result);assert.equal(calls,1);
        await assert.rejects(service.generate({...input,requestId:'synthetic-stale-guidance'},{authorize}),{code:'MTL_TONE_NOTES_CHANGED'});
        const forged=structuredClone(context);forged.sharedToneNotes.entries[0].roles=['listener'];
        await assert.rejects(service.generate({...input,requestId:'synthetic-forged-listener',context:forged},{authorize}),{code:'MTL_TONE_NOTE_INVALID'});
        assert.equal(calls,1);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM mtl_generation_jobs').get().n,1);
    }finally{await service.shutdown();}
});
