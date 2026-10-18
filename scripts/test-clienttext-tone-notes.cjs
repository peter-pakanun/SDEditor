'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const N=require('../public/clientTextToneNotes.js'),UI=require('../public/clientTextToneNotesUi.js'),Context=require('../public/clientTextMtlContext.js');
const {scope:baseScope,unit:makeUnit}=require('./clienttext-storage-fixture.cjs');
const P='Metadata/NPC/Synthetic/First',Q='Metadata/NPC/Synthetic/Second',K='npc:'+P;
const copy=value=>structuredClone(value),turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
function harness(){
    const scope={...baseScope},line={...makeUnit(),id:'line',sheet:'NPCTextAudio',recordId:'SyntheticLine',metadata:{Speaker:P,Listener:Q}},
        npc=(path,name)=>({...makeUnit(),id:path,sheet:'NPCs',recordId:path,fields:[{...makeUnit().fields[0],name:'Name',source:name}]}),
        records=new Map(),history=new Map(),receipts=new Map(),requests=[];let epoch=0,mode='normal';
    const app={...UI.mixin.data(),ctActive:true,ctSelection:line.id,ctCurrentUnit:line,ctUnits:[line,npc(P,'First'),npc(Q,'Second')],ctRevision:0,
        ctWorkspace:{scope},lang:scope.language,gameVersion:scope.game,branchId:scope.branchId,cloudSignedIn:true,cloudProfileId:scope.accountId,
        cloudUser:{id:scope.accountId,role:'translator',language:scope.language,assignmentVersion:1},privateMediaEpoch:1,
        ctContext:()=>({scope:copy(scope),epoch}),ctCurrent:ctx=>ctx.epoch===epoch&&JSON.stringify(ctx.scope)===JSON.stringify(scope),
        $nextTick:async callback=>callback?.(),_ctToneRoleHints:options=>Context.roleHints(options)};
    const current=identityKey=>records.get(identityKey)||{identityKey,text:'',revision:0},response=(identityKey,appliedRevision)=>({scope:N.scope(scope),note:copy(current(identityKey)),...(appliedRevision?{appliedRevision}:{})});
    async function request(path,options={}){
        requests.push({path,method:options.method||'GET',body:options.body&&copy(options.body)});
        const url=new URL(path,'https://synthetic.invalid'),key=url.searchParams.get('identityKey')||options.body?.identityKey;
        if(mode==='load-error'&&options.method!=='PUT')throw new TypeError('Synthetic load failure');
        if(url.pathname.endsWith('/latest'))return response(key);
        if(url.pathname.endsWith('/history'))return{scope:N.scope(scope),identityKey:key,entries:copy(history.get(key)||[]),nextCursor:null};
        assert.equal(path,'/v1/mtl/tone-notes');assert.equal(options.method,'PUT');const body=options.body;
        assert.deepEqual(body.scope,N.scope(scope));assert.deepEqual(Object.keys(body).sort(),['baseRevision','identityKey','mutationId','scope','text']);
        const previous=receipts.get(body.mutationId);
        if(previous){assert.deepEqual(previous.body,body);return response(key,previous.revision);}
        if(current(key).revision!==body.baseRevision)throw Object.assign(new Error('Synthetic conflict'),{status:409,code:'MTL_TONE_NOTE_CHANGED',current:copy(current(key))});
        const next={...body.scope,identityKey:key,text:N.normalize(body.text),revision:body.baseRevision+1,updatedAt:1800000000000,author:{name:'Synthetic contributor'}};
        records.set(key,next);history.set(key,[copy(next),...(history.get(key)||[])]);receipts.set(body.mutationId,{body:copy(body),revision:next.revision});
        if(mode==='lost-ack'){mode='normal';throw new TypeError('Synthetic lost acknowledgement');}
        return response(key,next.revision);
    }
    app._cloud={epoch:1,request};for(const[name,method]of Object.entries(UI.mixin.methods))app[name]=method.bind(app);
    for(const[name,getter]of Object.entries(UI.mixin.computed))Object.defineProperty(app,name,{get:()=>getter.call(app)});
    app._ctToneOwner=String(app.cloudUser.id);
    return{app,scope,line,records,history,requests,request,mode:value=>mode=value,fence(){epoch++;UI.mixin.watch.ctToneFenceKey.handler.call(app);},
        seed(text,revision=1,key=K){records.set(key,{...N.scope(scope),identityKey:key,text,revision,updatedAt:1800000000000,author:{name:'Earlier contributor'}});},
        async open(key=K){assert.equal(await app.ctToneOpen(key),true);return app.ctToneCurrent;}};
}

test('all supported-language examples are placeholders, never initial values or empty saves',async()=>{
    const languages=['French','German','Japanese','Korean','Polish','Portuguese','Russian','Simplified Chinese','Spanish','Thai','Traditional Chinese','Turkish'];
    assert.deepEqual(Object.keys(N.examples).sort(),languages.sort());
    for(const language of languages){
        const h=harness();h.scope.language=h.app.lang=h.app.cloudUser.language=language;const value=await h.open();
        assert.ok(h.app.ctTonePlaceholder);assert.equal(value.draft,'');assert.equal(h.app.ctToneCount,0);assert.equal(h.app.ctToneCanSave,false);
        assert.equal(await h.app.ctToneSave(),false);await h.app.ctToneLoad(K);assert.equal(value.draft,'');
        h.app.ctToneEdited(' \t\r\n ');assert.equal(await h.app.ctToneSave(),false);
        assert.equal(h.records.size,0);assert.equal(h.history.size,0);assert.equal(h.requests.every(value=>value.method==='GET'),true);
        assert.deepEqual(h.app.ctToneNotesSnapshot([K]).entries,[]);
        assert.ok(h.requests.every(value=>!JSON.stringify(value).includes(N.examples[language])));
    }
});

test('Unicode count, normalization and validation match the 300-codepoint / 1200-byte contract',()=>{
    assert.equal(N.count('😀'.repeat(300)),300);assert.equal(N.validText('😀'.repeat(300)),true);assert.equal(N.validText('😀'.repeat(301)),false);
    assert.equal(N.normalize('  literal <b>text</b>\r\nnext\rline\t '),'  literal <b>text</b>\nnext\nline\t ');
    assert.equal(N.normalize(' \t\r\n '),'');assert.equal(N.count('e\u0301'),2);
    for(const text of ['\ud800','\udc00','a\u0000b','a\u007fb','a\u0085b','a\u000bb'])assert.equal(N.validText(text),false);
});

test('canonical identities stay distinct and explicit metadata works with partial workbooks',()=>{
    const h=harness(),entries=h.app.ctToneIdentities;assert.deepEqual(entries.map(value=>value.key),[K,'npc:'+Q]);
    h.app.ctUnits=[h.line];assert.equal(h.app.ctToneIdentities.some(value=>value.key===K),true);
    assert.equal(N.identity('portrait:shared-art'),null);assert.equal(N.identity('npc: Name Only'),null);assert.equal(N.identity('npc:Metadata/NPC/First\u0000'),null);
    assert.notEqual(N.identity(K).key,N.identity(K.toLowerCase().replace('metadata','Metadata')).key);
    assert.equal(N.identity('npc:Metadata/NPC/'+'x'.repeat(1024)),null);
});

test('metadata cannot change the canonical table kind of a loaded record or invent a kind for a cross-table collision',()=>{
    const h=harness();h.line.metadata={Character:P};assert.deepEqual(h.app.ctToneIdentities.map(value=>value.key),[K]);
    h.app.ctUnits.push({...h.app.ctUnits[1],id:'collision',sheet:'Characters'});
    assert.deepEqual(h.app.ctToneIdentities,[]);
});

test('only explicit Save adds a shared note; drafts stay out of context, workbook values and history',async()=>{
    const h=harness(),original=copy(h.line);await h.open();h.app.ctToneEdited('  Gruff voice\r\nUse informal address. ');
    assert.equal(h.app.ctToneNotesSnapshot([K]).entries.length,0);assert.equal(h.records.size,0);
    assert.equal(await h.app.ctToneSave(),true);const value=h.app.ctToneCurrent;
    assert.equal(value.saved.text,'  Gruff voice\nUse informal address. ');assert.equal(value.saved.revision,1);assert.equal(h.app.ctToneNotesSnapshot([K]).entries[0].text,value.saved.text);
    h.app.ctToneEdited('Unsaved private draft');assert.equal(h.app.ctToneNotesSnapshot([K]).entries[0].text,value.saved.text);
    assert.deepEqual(h.line,original);assert.equal(h.history.get(K).length,1);
    h.app.ctToneClose();await h.open();assert.equal(h.app.ctToneCurrent.draft,'Unsaved private draft');
});

test('clearing a saved note creates an authored empty audit revision with no example or older-note fallback',async()=>{
    const h=harness();h.seed('Previous tone');await h.open();h.app.ctToneEdited('');assert.equal(await h.app.ctToneSave(),true);
    assert.equal(h.records.get(K).revision,2);assert.equal(h.records.get(K).text,'');assert.equal(h.app.ctToneNotesSnapshot([K]).entries[0].text,'');
    await h.app.ctToneLoadHistory(K);assert.equal(h.app.ctToneCurrent.history[0].text,'');assert.equal(h.app.ctToneCurrent.history[0].author.name,'Synthetic contributor');
    assert.equal(await h.app.ctToneSave(),false);assert.ok(h.requests.filter(value=>value.method==='PUT').every(value=>!value.body.text.includes('Example')));
});

test('lost acknowledgement retries one stable command; a newer peer revision preserves the authored draft for comparison',async()=>{
    const h=harness();await h.open();h.app.ctToneEdited('My saved tone');h.mode('lost-ack');assert.equal(await h.app.ctToneSave(),false);
    const body=copy(h.app.ctToneCurrent.pending),error=h.app.ctToneCurrent.saveError;assert.equal(h.records.get(K).text,'My saved tone');
    await h.app.ctToneLoad(K);assert.equal(h.app.ctToneCurrent.saveError,error,'an unrelated successful read does not clear a failed Save');
    h.seed('Newer peer tone',2);assert.equal(await h.app.ctToneSave(),true);
    assert.deepEqual(h.requests.filter(value=>value.method==='PUT').map(value=>value.body),[body,body]);
    assert.equal(h.app.ctToneCurrent.draft,'My saved tone');assert.equal(h.app.ctToneCurrent.conflict.text,'Newer peer tone');
    assert.deepEqual(h.app.ctToneNotesSnapshot([K]).entries,[]);assert.equal(h.app.ctToneCurrent.pending,null);
    h.app.ctToneResolveConflict(false);assert.equal(h.app.ctToneNotesSnapshot([K]).entries[0].text,'Newer peer tone');
});

test('stale Save conflicts keep drafts and require explicit latest-versus-mine comparison before a new command',async()=>{
    const h=harness();h.seed('Old tone');await h.open();h.app.ctToneEdited('My draft');h.seed('Peer tone',2);
    assert.equal(await h.app.ctToneSave(),false);assert.equal(h.app.ctToneCurrent.draft,'My draft');assert.equal(h.app.ctToneCanSave,false);
    h.app.ctToneResolveConflict(true);assert.equal(h.app.ctToneCurrent.draft,'My draft');assert.equal(await h.app.ctToneSave(),true);
    assert.equal(h.requests.filter(value=>value.method==='PUT').at(-1).body.baseRevision,2);assert.equal(h.records.get(K).revision,3);
    h.app.ctToneEdited('Another draft');h.seed('Newest peer',4);await h.app.ctToneLoad(K);h.app.ctToneResolveConflict(false);
    assert.equal(h.app.ctToneCurrent.draft,'Newest peer');assert.equal(h.app.ctToneCanSave,false);
});

test('background failures preserve dirty text and history, and failed reads cannot enter the context snapshot',async()=>{
    const h=harness();h.seed('Saved tone');await h.open();h.app.ctToneEdited('Dirty draft');await h.app.ctToneLoadHistory(K);
    h.mode('load-error');assert.equal(await h.app.ctToneLoad(K),false);assert.equal(h.app.ctToneCurrent.draft,'Dirty draft');
    assert.deepEqual(h.app.ctToneNotesSnapshot([K]).entries,[]);assert.equal(await h.app.ctToneLoadHistory(K),false);
    assert.match(h.app.ctToneCurrent.historyError,/could not be loaded/);h.mode('normal');assert.equal(await h.app.ctToneLoad(K),true);
    assert.equal(h.app.ctToneCurrent.draft,'Dirty draft');assert.equal(h.app.ctToneCurrent.loadError,'');
});

test('preparing a new translation stops on unreadable, conflicted or pending guidance without discarding drafts',async()=>{
    const h=harness();h.seed('Original guidance');await h.open();h.app.ctToneEdited('Private draft');h.mode('load-error');
    await assert.rejects(h.app.ctToneNotesPrepare([K]),error=>error.code==='MTL_TONE_NOTES_UNAVAILABLE');assert.equal(h.app.ctToneCurrent.draft,'Private draft');
    h.mode('normal');h.seed('Peer guidance',3);await assert.rejects(h.app.ctToneNotesPrepare([K]),/conflict or pending Save/);
    assert.equal(h.app.ctToneCurrent.draft,'Private draft');h.app.ctToneResolveConflict(false);
    assert.equal((await h.app.ctToneNotesPrepare([K])).entries[0].text,'Peer guidance');
});

test('dirty revision-1 draft versus loaded revision-3 peer note cannot enter context until explicit conflict resolution',async()=>{
    const h=harness();h.seed('Original shared note',1);await h.open();h.app.ctToneEdited('My private draft');h.seed('New shared note',3);await h.app.ctToneLoad(K);
    const build=()=>Context.build({unit:h.line,field:h.line.fields[0],units:h.app.ctUnits,scope:h.scope,toneNotes:h.app.ctToneNotesSnapshot()});
    assert.equal(h.app.ctToneCurrent.conflict.revision,3);assert.equal(build().sharedToneNotes,undefined);
    h.app.ctToneResolveConflict(true);const context=build();assert.equal(context.sharedToneNotes.entries[0].text,'New shared note');
    assert.ok(!JSON.stringify(context).includes('My private draft'));
});

test('account, language, branch, workspace and record fences suppress stale reads and writes',async()=>{
    for(const save of [false,true])for(const change of [h=>h.app.cloudSignedIn=false,h=>h.app.cloudUser.id='other',h=>h.scope.language='German',h=>h.scope.branchId='other',h=>h.scope.groupId='other',h=>h.app.ctSelection='other']){
        const h=harness();await h.open();h.app.ctToneEdited('Kept draft');const wait=deferred();h.app._cloud.request=()=>wait.promise;
        const pending=save?h.app.ctToneSave():h.app.ctToneLoad(K);change(h);h.fence();wait.resolve({note:{identityKey:K,text:'Late response',revision:4},appliedRevision:4});
        assert.equal(await pending,false);assert.equal(h.app.ctToneWindow,null);assert.equal(Object.values(h.app.ctToneRecords).some(value=>value.saved?.text==='Late response'),false);
    }
});

test('late completion from an earlier source cannot clear the new scoped read flag',async()=>{
    const h=harness();h.seed('Saved tone');await h.open();const old=deferred(),next=deferred();h.app._cloud.request=()=>old.promise;
    const first=h.app.ctToneLoad(K);h.scope.versionId='next-source';h.fence();h.app._cloud.request=()=>next.promise;
    const second=h.app.ctToneLoad(K);old.resolve({scope:N.scope(h.scope),note:{identityKey:K,text:'Stale read',revision:2}});
    assert.equal(await first,false);assert.equal(h.app.ctToneRecord(K).loading,true);
    next.resolve({scope:N.scope(h.scope),note:{identityKey:K,text:'Fresh read',revision:3}});assert.equal(await second,true);assert.equal(h.app.ctToneRecord(K).loading,false);
    assert.equal(h.app.ctToneRecord(K).saved.text,'Fresh read');
});

test('permission guards allow the assigned translator and cross-language configured Manager/Admin only',async()=>{
    for(const [role,isAdmin,language,expected]of [['translator',false,'Thai',true],['translator',false,'German',false],['manager',false,'German',true],['admin',true,'German',true],['admin',false,'German',false]]){
        const h=harness();Object.assign(h.app.cloudUser,{role,isAdmin,language});assert.equal(await h.app.ctToneOpen(K),expected);
        assert.equal(h.requests.length,expected?1:0);
    }
});

test('configured Admin and Manager can edit an absent note from a local partial workbook in another selected language',async()=>{
    for(const role of ['admin','manager'])for(const sheet of ['NPCs','NPCTextAudio']){
        const h=harness();h.scope.groupId='local:partial-npc-export';h.app.ctUnits=[h.line];
        if(sheet==='NPCs'){h.line.sheet=sheet;h.line.recordId=P;h.line.metadata={};h.line.fields[0].name='Name';}
        Object.assign(h.app.cloudUser,{role,isAdmin:role==='admin',language:'German'});
        assert.equal(h.app.ctToneIdentities.some(value=>value.key===K),true);
        assert.equal(await h.app.ctToneOpen(K),true);assert.equal(h.app.ctToneAllowed,true);
        assert.equal(h.app.ctToneCurrent.loaded,true);assert.equal(h.app.ctToneCurrent.saved.revision,0);assert.equal(h.app.ctToneState,'');
        h.app.ctToneEdited('Synthetic explicit guidance');assert.equal(h.app.ctToneCanSave,true);assert.equal(await h.app.ctToneSave(),true);
        assert.equal(h.records.get(K).text,'Synthetic explicit guidance');assert.equal(h.requests[0].body,undefined);
    }
});

test('initial load failures explain the disabled editor safely and successful retry enables an absent note',async()=>{
    for(const [status,code,message]of [[401,'SESSION_EXPIRED',/session expired/i],[403,'LANGUAGE_FORBIDDEN',/server denied access/i],
        [404,'BRANCH_NOT_FOUND',/branch is unavailable/i],[404,undefined,/server update/i],[400,'MTL_TONE_NOTE_INVALID',/identity or workspace scope/i],
        [429,undefined,/temporarily limited/i],[503,undefined,/service is unavailable/i],[undefined,undefined,/check your connection/i]]){
        const h=harness();h.app._cloud.request=async()=>{throw Object.assign(new Error('Do not expose synthetic-private-payload'),{status,code});};
        assert.equal(await h.app.ctToneOpen(K),false);assert.equal(h.app.ctToneAllowed,true);assert.equal(h.app.ctToneCurrent.loaded,false);
        assert.equal(h.app.ctToneCanSave,false);assert.match(h.app.ctToneState,message);assert.doesNotMatch(h.app.ctToneState,/synthetic-private-payload/);
        assert.deepEqual(h.app.ctToneNotesSnapshot([K]).entries,[]);
        h.app._cloud.request=h.request;assert.equal(await h.app.ctToneLoad(K),true);assert.equal(h.app.ctToneState,'');
        assert.equal(h.app.ctToneCurrent.loaded,true);assert.equal(h.app.ctToneCurrent.saved.revision,0);
    }
    const h=harness();h.app._cloud.request=async()=>({scope:N.scope(h.scope),note:{identityKey:K,text:'',revision:-1}});
    assert.equal(await h.app.ctToneOpen(K),false);assert.match(h.app.ctToneState,/incompatible shared tone-note response/);
    assert.equal(h.app.ctToneCurrent.loaded,false);assert.deepEqual(h.app.ctToneNotesSnapshot([K]).entries,[]);
});

test('disabled permission states identify account, language and role problems without issuing shared requests',async()=>{
    for(const [change,message]of [[h=>h.app.cloudSignedIn=false,/Sign in with access/],
        [h=>h.scope.accountId='guest',/guest profile/],[h=>h.app.lang='German',/Workbook language: Thai\. Selected language: German\./],
        [h=>h.app.cloudUser.language='German',/assigned language/],[h=>Object.assign(h.app.cloudUser,{role:'admin',isAdmin:false}),/check your role/]]){
        const h=harness();change(h);assert.equal(await h.app.ctToneOpen(K),false);assert.equal(h.app.ctToneAllowed,false);
        assert.match(h.app.ctToneState,message);assert.equal(h.requests.length,0);assert.equal(h.app.ctToneCanSave,false);
    }
    const h=harness();h.scope.groupId='local:test:mismatch';h.app.lang='German';
    Object.assign(h.app.cloudUser,{role:'admin',isAdmin:true});assert.equal(await h.app.ctToneOpen(K),false);
    assert.match(h.app.ctToneState,/Workbook language: Thai\. Selected language: German\./);
    assert.match(h.app.ctToneState,/Choose Thai in Settings before reopening this test/);
    assert.match(h.app.ctToneState,/Changing language closes the current test\./);
    assert.equal(h.app.lang,'German');assert.equal(h.scope.language,'Thai');assert.equal(h.requests.length,0);
});

test('offline editing has no false save or usable stale snapshot and performs no writes',async t=>{
    const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');let online=true;
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{get onLine(){return online;}}});t.after(()=>{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;});
    const h=harness();h.seed('Saved tone');await h.open();h.app.ctToneEdited('Offline draft');online=false;
    assert.equal(await h.app.ctToneSave(),false);assert.equal(h.app.ctToneCurrent.draft,'Offline draft');assert.deepEqual(h.app.ctToneNotesSnapshot([K]).entries,[]);
    assert.equal(h.requests.some(value=>value.method==='PUT'),false);online=true;assert.equal(await h.app.ctToneSave(),true);
});

test('Ctrl/Cmd+S explicitly save and Escape closes while IME composition stays untouched',()=>{
    let saves=0,closes=0,prevented=0;const dialog={host:{ctToneSave(){saves++;},ctToneClose(){closes++;}},trap(){}};
    for(const metaKey of [false,true])UI.Dialog.methods.keydown.call(dialog,{code:'KeyS',ctrlKey:!metaKey,metaKey,preventDefault(){prevented++;}});
    UI.Dialog.methods.keydown.call(dialog,{key:'Escape',preventDefault(){prevented++;}});
    UI.Dialog.methods.keydown.call(dialog,{key:'Escape',isComposing:true,preventDefault(){throw Error('IME must remain active');}});
    assert.equal(saves,2);assert.equal(closes,1);assert.equal(prevented,3);
});
