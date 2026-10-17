'use strict';
// Actual API serializers/storage against isolated in-memory SQLite. No config
// loaders, environment files, HTTP authentication or provider calls are used.
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
