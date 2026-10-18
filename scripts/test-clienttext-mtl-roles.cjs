/* Synthetic workbook evidence only: no private text, network or inference. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const Context = require('../public/clientTextMtlContext.js');
const MtlState = require('../public/clientTextMtlState.js');
const S = require('../public/clientTextState.js');
const N = require('../public/clientTextNpcIndex.js');
const Convo = require('../public/clientTextConvoIndex.js');
const Codec = require('../public/clientTextCodec.js');
const JSZip = require('../../SDEditor-API/node_modules/jszip');
const Catalog = require('../public/clientTextPortraitCatalog.js');
const DictionaryScope = require('../public/dictionaryScope.js');
const UI = require('../public/clientTextMtlUi.js');
const A = 'Metadata/Characters/Int/IntFour', B = 'Metadata/Characters/Str/StrFour';
const P = 'Metadata/NPC/Synthetic/Scout', Q = 'Metadata/NPC/Synthetic/Guard';
let nextRow = 2;
function field(name, source, target = '', row = nextRow++, extra = {}) {
    return {id:JSON.stringify([name,null]), name, kind:'text', source, target, sourceCell:'B'+row, targetCell:'C'+row, ...extra};
}
function unit(sheet,recordId,fields,metadata={}) {
    return S.normalizeUnit({role:'normal',sheet,recordId,fields,metadata});
}
const npc = (path,name) => unit('NPCs',path,[field('Name',name)]);
const character = (path,name,source='Synthetic authored introduction.',target='Approved introduction.') =>
    unit('Characters',path,[field('Name',name),field('Description',source,target),field('Traits Description','DNT-UNUSED gameplay trait','UNUSED TARGET')]);
const line = (id='Selected',metadata={},row=30,source='Synthetic selected dialogue.') =>
    unit('NPCTalkDialogueTextAudio',id,[field('Text',source,'',row)],metadata);
async function build(selected,units,extra={}) {
    const npcIndex = await N.buildNpcIndex(units,{yield:async()=>{}});
    return Context.build({unit:selected,field:selected.fields[0],units,npcIndex,scope:{game:'poe2'},...extra});
}
const key = (result,role) => result.roleHints[role].identityKey;
const profile = (result,id) => result.toneContext.profiles.find(item=>item.identityKey==='character:'+id);
const textSize = value => (value.source||'').length+(value.translation||'').length;
function bounds(result) {
    const json=JSON.stringify(result), count=value=>1+(Array.isArray(value)?value.reduce((sum,item)=>sum+count(item),0)
        :value&&typeof value==='object'?Object.values(value).reduce((sum,item)=>sum+count(item),0):0);
    assert.ok(json.length<=Context.LIMITS.context); assert.ok(Buffer.byteLength(json)<=Context.LIMITS.contextBytes);
    assert.ok(count(result)<=Context.LIMITS.contextEntries);
    assert.equal(result.toneContext.characters,[...result.toneContext.profiles,...result.toneContext.voiceExamples].reduce((sum,item)=>sum+textSize(item),0));
    assert.ok(result.toneContext.characters<=1200);
}

test('explicit resolved speaker and listener metadata win over conflicting portrait order and suffix',async()=>{
    const selected=line('Selected=StrFour',{Character:A,NPC:P,Speaker:P,Addressee:A}),actor=npc(P,'Synthetic Scout'),hero=character(A,'Synthetic Mage');
    const result=await build(selected,[selected,actor,hero]);
    assert.equal(result.roleHints.identities.find(item=>item.key===key(result,'speaker')).references[0],P); assert.equal(result.roleHints.speaker.priority,3);
    assert.equal(result.roleHints.speaker.confidence,'explicit'); assert.equal(result.roleHints.listener.confidence,'explicit');
    assert.ok(result.roleHints.conflicts.some(item=>item.reason==='suffix-disagrees-with-explicit-role'));
    assert.ok(result.roleHints.conflicts.some(item=>item.reason==='portrait-convention-disagrees-with-stronger-role'));
    assert.ok(profile(result,A)); assert.equal(result.roleHints.listener.status,'resolved'); bounds(result);
});

test('explicit NPC names resolve only against unique loaded identity evidence',async()=>{
    const selected=line('Selected',{Speaker:'Synthetic Scout'}),actor=npc(P,'Synthetic Scout');
    const result=await build(selected,[selected,actor]);
    assert.equal(result.roleHints.speaker.status,'resolved'); assert.equal(result.roleHints.speaker.confidence,'explicit');
    assert.equal(result.roleHints.identities.find(item=>item.key===key(result,'speaker')).references[0],P);
    const missing=await build(selected,[selected]);
    assert.equal(missing.roleHints.speaker.status,'unknown'); assert.equal(key(missing,'speaker'),undefined);
});

test('conflicting or unresolved authoritative role columns block weaker role guesses',async()=>{
    const actor=npc(P,'Synthetic Scout'),hero=character(A,'Synthetic Mage');
    for(const metadata of [{NPC:P,Speaker:'Player'}, {NPC:P,Speaker:''}, {NPC:P,Speaker:P,'Speaking Character':A}]) {
        const selected=line('Selected',metadata),result=await build(selected,[selected,actor,hero]);
        assert.notEqual(result.roleHints.speaker.status,'suggested'); assert.equal(key(result,'speaker'),undefined);
        assert.equal(key(result,'listener'),undefined);
    }
});

test('exact known suffix identity is a listener convention with raw provenance, never a speaker',async()=>{
    const selected=line('Selected=IntFour',{NPC:P}),actor=npc(P,'Synthetic Scout'),hero=character(A,'Synthetic Mage');
    const result=await build(selected,[selected,actor,hero]);
    assert.equal(key(result,'listener'),'character:'+A); assert.equal(result.roleHints.listener.priority,2);
    assert.equal(result.roleHints.listener.confidence,'convention'); assert.equal(result.roleHints.idSuffix.raw,'IntFour');
    assert.equal(result.roleHints.idSuffix.status,'resolved'); assert.equal(result.roleHints.speaker.confidence,'heuristic');
    assert.ok(profile(result,A));
});

test('lore flags remain conditions, and arbitrary or compound suffixes never become listener identities',async()=>{
    const actor=npc(P,'Synthetic Scout'),hero=character(A,'Synthetic Mage');
    for(const suffix of ['HasLore','NoLore','Met_d_a1','IntFour=HasLore','StrDex4b','']) {
        const selected=line('Selected='+suffix,{NPC:P}),result=await build(selected,[selected,actor,hero]);
        assert.equal(key(result,'listener'),undefined,suffix);
        assert.equal(result.roleHints.idSuffix.raw,suffix);
        if(['HasLore','NoLore'].includes(suffix)) {
            assert.equal(result.roleHints.idSuffix.status,'condition'); assert.equal(result.roleHints.speaker.confidence,'heuristic');
        } else { assert.equal(result.roleHints.idSuffix.status,'unresolved'); assert.equal(key(result,'speaker'),undefined); }
    }
    const selected=line('Selected='+'x'.repeat(300),{NPC:P}),result=await build(selected,[selected,actor]);
    assert.equal(result.roleHints.idSuffix.truncated,true); assert.equal(result.roleHints.idSuffix.originalCharacters,300);
    assert.equal(result.roleHints.idSuffix.raw.length,256); assert.equal(key(result,'listener'),undefined);
});

test('a listener suffix cannot assign an explicit speaker to the listener role by convention',async()=>{
    const hero=character(A,'Synthetic Mage'),selected=line('Selected=IntFour',{Speaker:A}),result=await build(selected,[selected,hero]);
    assert.equal(result.roleHints.speaker.status,'resolved'); assert.equal(key(result,'speaker'),'character:'+A);
    assert.equal(result.roleHints.listener.status,'conflict'); assert.equal(key(result,'listener'),undefined);
    assert.ok(result.roleHints.conflicts.some(item=>item.reason==='suffix-would-duplicate-explicit-speaker'));
});

test('two reliable semantic participants suggest first listener and second speaker before art projection',async()=>{
    const selected=line('Selected',{Character:A,NPC:P}),actor=npc(P,'Synthetic Scout'),hero=character(A,'Synthetic Mage');
    const result=await build(selected,[selected,actor,hero]);
    assert.equal(result.roleHints.order.status,'reliable');
    assert.equal(key(result,'listener'),result.roleHints.order.participantKeys[0]);
    assert.equal(key(result,'speaker'),'character:'+A); assert.equal(result.roleHints.speaker.confidence,'heuristic');
    assert.equal(result.roleHints.speaker.evidence[0].rule,'first-listens-second-speaks');
});

test('a single participant suggests only a speaker and never manufactures a listener',async()=>{
    const selected=line('Selected',{Character:A}),hero=character(A,'Synthetic Mage'),result=await build(selected,[selected,hero]);
    assert.equal(key(result,'speaker'),'character:'+A); assert.equal(result.roleHints.listener.status,'unknown');
    assert.equal(result.roleHints.speaker.evidence[0].rule,'single-participant-speaks');
});

test('sorted multiple NPC memberships and ambiguous conversations suppress portrait conventions',async()=>{
    const one=npc(P,'Synthetic Scout'),two=npc(Q,'Synthetic Guard');
    for(const metadata of [{NPC:P+','+Q},{NPC:P}]) {
        const selected=line('Selected',metadata),extra=metadata.NPC===P?{convoIndex:{memberships:new Map([[selected.id,{familyKey:'F',ambiguous:true}]])}}:{};
        const result=await build(selected,[selected,one,two],extra);
        assert.equal(result.roleHints.order.status,'suppressed'); assert.equal(key(result,'speaker'),undefined); assert.equal(key(result,'listener'),undefined);
    }
});

test('distinct semantic identities merged by portrait art or NPC grouping suppress conventions',async()=>{
    const paths=['Metadata/NPC/League/Chayula/ChayulaFarmerHub','Metadata/NPC/League/Chayula/ChayulaFarmerNearDreamer'];
    const one=npc(paths[0],'Synthetic First'),two=npc(paths[1],'Synthetic Second'),selected=line('Selected',{NPC:paths[1]});
    const npcIndex=await N.buildNpcIndex([selected,one,two],{yield:async()=>{}}),parentKey=[...npcIndex.groupByKey.keys()].find(k=>npcIndex.groupByKey.get(k).npcUnits.includes(one));
    const result=await build(selected,[selected,one,two],{npcIndex,convoIndex:{memberships:new Map([[selected.id,{familyKey:'F',parentKey}]])}});
    assert.equal(result.roleHints.order.reason,'merged-portrait-identities'); assert.equal(key(result,'speaker'),undefined);
    const aliases=[npc(P,'Same Synthetic Name'),npc(Q,'Same Synthetic Name')],merged=line('Selected',{NPC:P+','+Q});
    const mergedResult=await build(merged,[merged,...aliases]);
    assert.equal(mergedResult.roleHints.order.reason,'ambiguous-npc-group-identity'); assert.equal(key(mergedResult,'speaker'),undefined);
});

test('unresolved participant references suppress guesses while explicit resolved roles survive',async()=>{
    const actor=npc(P,'Synthetic Scout'),selected=line('Selected',{NPC:P,Character:'Metadata/Characters/Unknown',Speaker:P});
    const result=await build(selected,[selected,actor]);
    assert.equal(result.roleHints.order.status,'suppressed'); assert.equal(result.roleHints.speaker.status,'resolved');
    assert.equal(result.roleHints.listener.status,'unknown'); assert.ok(result.roleHints.unresolved.some(item=>item.role==='participant'));
});

test('Character Filter is only a listener constraint, including prohibited and conflicting forms',async()=>{
    const actor=npc(P,'Synthetic Scout'),hero=character(A,'Synthetic Mage'),other=character(B,'Synthetic Warrior');
    const only=line('Only',{'Character Filter':A}),constraint=await build(only,[only,hero]);
    assert.equal(key(constraint,'speaker'),undefined); assert.equal(key(constraint,'listener'),undefined);
    assert.equal(constraint.roleHints.constraints[0].kind,'listener-constraint');
    for(const metadata of [{NPC:P,'Character Filter':B},{NPC:P,'Prohibited Character Filter':A}]) {
        const selected=line('Selected=IntFour',metadata),result=await build(selected,[selected,actor,hero,other]);
        assert.equal(result.roleHints.listener.status,'conflict'); assert.equal(key(result,'listener'),undefined);
        assert.equal(key(result,'speaker'),undefined); assert.ok(result.roleHints.conflicts.some(item=>item.reason==='listener-constraint-mismatch'));
    }
    const explicit=line('Explicit',{Speaker:P,Listener:A,'Character Filter':B}),result=await build(explicit,[explicit,actor,hero,other]);
    assert.equal(result.roleHints.listener.status,'resolved'); assert.equal(key(result,'listener'),'character:'+A);
    assert.ok(result.roleHints.conflicts.some(item=>item.reason==='listener-constraint-mismatch'));
    const paths=Object.keys(Catalog.games.poe2.characters).slice(0,5),longFilter=line('LongFilter',{Speaker:P,Listener:paths[4],'Character Filter':paths.join(',')});
    const longResult=await build(longFilter,[longFilter,actor]);
    assert.equal(longResult.roleHints.constraints[0].complete,false);
    assert.ok(!longResult.roleHints.conflicts.some(item=>item.reason==='listener-constraint-mismatch'));
});

test('two sourced introductions share a 1200-character budget with at most 600 per participant',async()=>{
    const one=character(A,'Synthetic Mage','S'.repeat(900),'\u0e01'.repeat(1000)),two=character(B,'Synthetic Warrior','T'.repeat(1500),'\u0e02'.repeat(800)),
        selected=line('Selected',{Speaker:A,Listener:B}),original=JSON.stringify([selected,one,two]),result=await build(selected,[selected,one,two]);
    assert.equal(result.toneContext.profiles.length,2); assert.equal(result.toneContext.characters,1200);
    for(const item of result.toneContext.profiles) {
        assert.equal(textSize(item),600); assert.equal(item.kind,'authored-character-introduction');
        assert.equal(item.sourceTruncated,true); assert.equal(item.translationTruncated,true);
        const source=[one,two].find(value=>value.id===item.provenance.unitId),description=source.fields.find(value=>value.name==='Description');
        assert.equal(item.provenance.fieldId,description.id); assert.equal(item.provenance.sourceCell,description.sourceCell);
        assert.equal(item.provenance.targetCell,description.targetCell); assert.equal(item.sourceCharacters,description.source.length);
        assert.equal(item.translationOrigin,'original-workbook');
    }
    assert.ok(result.references.every(item=>item.fields.every(value=>!['Description','Traits Description'].includes(value.name))));
    assert.ok(!JSON.stringify(result).includes('DNT-UNUSED gameplay trait')); assert.equal(JSON.stringify([selected,one,two]),original); bounds(result);
});

test('introduction truncation preserves complete surrogate pairs and reports exact source lengths',async()=>{
    const hero=character(A,'Synthetic Mage','😀'.repeat(400),'😀'.repeat(400)),selected=line('Selected',{Speaker:A});
    const item=profile(await build(selected,[selected,hero]),A);
    assert.ok(textSize(item)<=600); assert.equal(item.sourceCharacters,800); assert.equal(item.translationCharacters,800);
    assert.ok(!/[\uD800-\uDBFF]$/.test(item.source)); assert.ok(!/[\uD800-\uDBFF]$/.test(item.translation));
});

test('profile translations use scoped Saved or immutable targets and reject stale, conflicted and unreviewed overlays',async()=>{
    const hero=character(A,'Synthetic Mage'),selected=line('Selected',{Speaker:A}),description=hero.fields.find(value=>value.name==='Description');
    const saved={[hero.id]:{saved:true,values:{[description.id]:'Approved saved tone.'}}};
    const result=await build(selected,[selected,hero],{saved,drafts:{[hero.id]:{[description.id]:'UNTRUSTED DRAFT'}},candidates:[{translation:'UNTRUSTED MTL'}]});
    assert.equal(profile(result,A).translation,'Approved saved tone.'); assert.equal(profile(result,A).translationOrigin,'saved');
    for(const record of [{saved:true,values:{[description.id]:'STALE'},outdated:[description.id]},
        {saved:true,values:{[description.id]:'CONFLICT'},conflicts:[{fieldId:description.id}]},
        {saved:true,values:{[description.id]:'   '}}]) {
        const value=profile(await build(selected,[selected,hero],{saved:{[hero.id]:record}}),A); assert.equal(value.translation,undefined);
    }
    saved[hero.id].outdated=[description.id]; saved[hero.id].reviewed={[description.id]:S.sourceHash(description.source)};
    assert.equal(profile(await build(selected,[selected,hero],{saved}),A).translation,'Approved saved tone.');
    saved[hero.id]={saved:false,values:{[description.id]:'UNTRUSTED UNSAVED'}};
    assert.equal(profile(await build(selected,[selected,hero],{saved}),A).translation,description.target);
    assert.ok(!JSON.stringify(result).includes('UNTRUSTED'));
});

test('partial workbooks, unused fields and ambiguous character rows report unavailable tone without invented biographies',async()=>{
    const selected=line('Selected',{Speaker:A}),partial=await build(selected,[selected]);
    assert.equal(partial.roleHints.speaker.status,'resolved'); assert.equal(partial.toneContext.profiles.length,0);
    assert.ok(partial.toneContext.unavailable.some(item=>item.reason==='characters-sheet-not-loaded'));
    const hero=character(A,'Synthetic Mage','DNT-UNUSED legacy source');
    const unused=await build(selected,[selected,hero]); assert.ok(unused.toneContext.unavailable.some(item=>item.reason==='unused-description'));
    const other=character(A,'Synthetic Mage');other.id='other-explicit-unit';
    const ambiguous=await build(selected,[selected,hero,other]); assert.ok(ambiguous.toneContext.unavailable.some(item=>item.reason==='ambiguous-character-profile'));
    const actor=npc(P,'Synthetic Scout'),spoken=line('Spoken',{Speaker:P}),npcResult=await build(spoken,[spoken,actor]);
    assert.ok(npcResult.toneContext.unavailable.some(item=>item.reason==='npc-biography-not-in-workbook'));
    assert.equal(npcResult.toneContext.profiles.length,0);
});

test('matching class introduction forms retain exact field provenance and ambiguous translations stay source-only',async()=>{
    const selected=line('Selected',{Speaker:A}),hero=character(A,'Synthetic Mage');
    hero.fields=hero.fields.filter(value=>value.name!=='Description');
    for(const form of ['IntFour','StrFour'])hero.fields.push(field('Description','Shared synthetic introduction.','Approved '+form,9,{id:'description-'+form,kind:'form',form}));
    const result=await build(selected,[selected,hero]); assert.equal(profile(result,A).source,'Shared synthetic introduction.'); assert.equal(profile(result,A).translation,undefined);
    selected.fields[0].kind='form';selected.fields[0].form='StrFour';
    const matching=await build(selected,[selected,hero]); assert.equal(profile(matching,A).translation,'Approved StrFour');
    assert.equal(profile(matching,A).provenance.fieldId,'description-StrFour');
});

test('NPC voice examples require exact explicit speaker evidence and exclude listener-only, player and other NPC turns',async()=>{
    const actor=npc(P,'Synthetic Scout'),other=npc(Q,'Synthetic Guard'),selected=line('Selected',{Speaker:P,NPC:P},30),
        good=line('Good',{Speaker:P},29,'Verified speaker voice.'),duplicate=line('Duplicate',{Speaker:P},28,'Verified speaker voice.'),
        second=line('Second',{Speaker:P},31,'Second verified voice.'),third=line('Third',{Speaker:P},33,'Third verified voice.'),
        listener=line('ListenerOnly',{Listener:P},27,'LISTENER LINE'),associated=line('RelatedOnly',{NPC:P},26,'ASSOCIATED LINE'),
        player=line('Player',{Speaker:A,NPC:P},25,'PLAYER LINE'),wrong=line('Wrong',{Speaker:Q},24,'OTHER NPC LINE');
    good.fields[0].target='Approved voice.'; duplicate.fields[0].target='Approved voice.';
    const result=await build(selected,[selected,actor,other,good,duplicate,second,third,listener,associated,player,wrong]);
    assert.deepEqual(result.toneContext.voiceExamples.map(item=>item.provenance.recordId),['Good','Second']);
    assert.equal(result.toneContext.selection.eligibleVoiceExamples,3);
    assert.deepEqual(result.toneContext.selection.omittedVoiceExamples,{duplicate:1,entryLimit:1,contextBudget:0});
    assert.ok(result.toneContext.voiceExamples.every(item=>item.speakerEvidence==='explicit-metadata'&&item.role==='speaker'&&textSize(item)<=200));
    assert.equal(result.toneContext.voiceExamples[0].translation,'Approved voice.');
    assert.ok(!result.toneContext.voiceExamples.some(item=>item.source.includes('LINE'))); bounds(result);
    const listening=line('Listening',{Speaker:A,Listener:P}),listenerResult=await build(listening,[listening,actor,good]);
    assert.equal(listenerResult.toneContext.voiceExamples.length,0);
});

test('tone evidence is retained before optional surrounding rows and keeps omission diagnostics under budget pressure',async()=>{
    const selected=line('Selected',{Speaker:A},50),hero=character(A,'Synthetic Mage','A'.repeat(1000),'B'.repeat(1000)),
        neighbors=Array.from({length:70},(_,i)=>line('Nearby'+i,{},i+100,'C'.repeat(1200))),units=[selected,hero,...neighbors],
        convoIndex={memberships:new Map([selected,...neighbors].map(value=>[value.id,{familyKey:'F'}]))};
    const result=await build(selected,units,{convoIndex}); assert.ok(profile(result,A));
    assert.equal(result.surrounding.selectedEntries,2);assert.equal(result.surrounding.omitted.entryLimit,68);
    assert.equal(result.omitted.roleHints,0); assert.equal(result.omitted.toneProfiles,0); bounds(result);
    const tight=await build(selected,[selected,hero],{contextLimit:1500});
    assert.equal(tight.roleHints,undefined); assert.equal(tight.omitted.roleHints,1); assert.equal(tight.omitted.toneProfiles,1); bounds(tight);
});

test('voice and introduction evidence never includes a translation that adds protected structure absent from its own English',async()=>{
    const actor=npc(P,'Synthetic Scout'),selected=line('Selected',{Speaker:P},30),bad=line('Bad',{Speaker:P},29,'Synthetic voice.'),
        hero=character(A,'Synthetic Mage','An authored introduction.','An authored [Consume|introduction].');
    bad.fields[0].target='Synthetic [Consume|voice].';
    const result=await build(selected,[selected,actor,bad]);
    assert.equal(result.toneContext.voiceExamples[0].translation,undefined);
    assert.equal(result.toneContext.voiceExamples[0].translationOmitted,'protected-structure');
    const heroLine=line('Hero',{Speaker:A}),profileResult=await build(heroLine,[heroLine,hero]);
    assert.equal(profile(profileResult,A).translation,undefined);
    assert.equal(profile(profileResult,A).translationOmitted,'protected-structure');
});

test('clipped profile and voice pairs are validated after clipping and keep only structurally compatible translated excerpts',async()=>{
    for(const kind of ['profile','voice'])for(const displaced of [true,false]){
        const source=(displaced?'s'.repeat(400):'')+'[SyntheticTag|source] '+'s'.repeat(400),
            target='[SyntheticTag|localized] '+'t'.repeat(400),
            selected=line('Selected',{Speaker:kind==='profile'?A:P},30),
            original=kind==='profile'?character(A,'Synthetic Mage',source,target):line('Voice',{Speaker:P},29,source);
        if(kind==='voice')original.fields[0].target=target;
        const originalField=kind==='profile'?original.fields.find(value=>value.name==='Description'):original.fields[0];
        assert.equal(MtlState.validate(originalField,target).valid,true,'the complete immutable pair is valid');
        const result=await build(selected,kind==='profile'?[selected,original]:[selected,npc(P,'Synthetic Scout'),original]),
            excerpt=kind==='profile'?profile(result,A):result.toneContext.voiceExamples[0];
        assert.equal(excerpt.sourceTruncated,true);assert.ok(textSize(excerpt)<=(kind==='profile'?600:200));
        if(displaced){
            assert.equal(excerpt.translation,undefined,kind);
            assert.equal(excerpt.translationOmitted,'protected-structure-after-clipping');
        }else{
            assert.ok(excerpt.translation,kind);assert.equal(excerpt.translationTruncated,true);
            assert.equal(MtlState.validate({...originalField,source:excerpt.source},excerpt.translation).valid,true,kind);
        }
        bounds(result);
    }
});

test('full and inline UI filters, pagination, variant selection and view rows cannot change roles or sourced tone',async()=>{
    const selected=line('Selected',{Speaker:A,Listener:P}),hero=character(A,'Synthetic Mage'),actor=npc(P,'Synthetic Scout'),units=[selected,hero,actor],
        npcIndex=await N.buildNpcIndex(units,{yield:async()=>{}}),host={ctContext:()=>({scope:{game:'poe2'}}),ctCurrentUnit:selected,ctUnits:units,
            _ctNpcIndex:npcIndex,ctSaved:{},ctMtlCommittedGlossary:()=>[]};
    for(const name of ['ctRows','ctPageRows','ctDisplayedFields'])Object.defineProperty(host,name,{get(){throw new Error('view projection accessed');}});
    const create=()=>UI.mixin.methods.ctMtlBuildContext.call(host,selected.fields[0]),initial=create();
    for(const state of [{ctEditor:'full',ctSearch:'hidden'}, {ctEditor:'inline',ctPage:99}, {ctNpcKey:'another-npc',ctConvoKey:'another-family'},
        {ctStatusFilter:'missing',ctSort:'descending'}, {ctVariant:'StrFour',ctSelectedForm:'IntFour'}]) {
        Object.assign(host,state); const result=create(); assert.deepEqual(result.initial,initial.initial); assert.equal(result.contextHash,initial.contextHash);
    }
    assert.ok(initial.initial.roleHints); assert.ok(profile(initial.initial,A));
});

test('browser factory uses the existing loaded public catalog without a Node require or API workbook parse',()=>{
    const sandbox={ClientTextState:S,ClientTextMtlState:MtlState,DictionaryScope,ClientTextPortraitCatalog:Catalog,TextEncoder}; vm.createContext(sandbox);
    vm.runInContext(readFileSync(require.resolve('../public/clientTextMtlContext.js'),'utf8'),sandbox);
    const selected=line('Selected',{Speaker:A}),hero=character(A,'Synthetic Mage'),neighbor=line('Neighbor',{},29);
    neighbor.fields[0].target='Approved nearby dialogue.';
    const result=sandbox.ClientTextMtlContext.build({unit:selected,field:selected.fields[0],units:[selected,hero,neighbor],scope:{game:'poe2'}});
    assert.equal(result.roleHints.speaker.status,'resolved'); assert.equal(result.toneContext.profiles.length,1);
    assert.equal(result.surrounding.entries[0].fields[0].translation,'Approved nearby dialogue.');
});

test('row-specific merged artwork suppresses participant conventions before portrait deduplication',async()=>{
    const selected=line('OverrideLine',{NPC:Q});selected.sheet='NPCTextAudio';
    const first=npc(P,'Synthetic First'),second=npc(Q,'Synthetic Second'),units=[selected,first,second],
        npcIndex=await N.buildNpcIndex(units,{yield:async()=>{}}),parentKey=[...npcIndex.groupByKey.keys()].find(k=>npcIndex.groupByKey.get(k).npcUnits.includes(first)),
        convoIndex={memberships:new Map([[selected.id,{familyKey:'Synthetic',parentKey}]])},
        sandbox={ClientTextState:S,ClientTextMtlState:MtlState,DictionaryScope,TextEncoder,ClientTextPortraitCatalog:{games:{poe2:{characters:{},npcs:{[P]:['one','Synthetic First'],[Q]:['two','Synthetic Second']},
            overrides:{OverrideLine:{id:'one',npcs:[Q]}}}}}};
    vm.createContext(sandbox);vm.runInContext(readFileSync(require.resolve('../public/clientTextMtlContext.js'),'utf8'),sandbox);
    const result=sandbox.ClientTextMtlContext.build({unit:selected,field:selected.fields[0],units,npcIndex,convoIndex,scope:{game:'poe2'}});
    assert.equal(result.roleHints.order.reason,'merged-portrait-identities');assert.equal(key(result,'speaker'),undefined);
});

test('same-name NPC paths remain distinct role identities and conflicting explicit paths cannot resolve',async()=>{
    const first=npc(P,'Synthetic Guard'),second=npc(Q,'Synthetic Guard'),selected=line('Selected',{Speaker:P,'Speaking Character':Q}),
        result=await build(selected,[selected,first,second]);
    assert.equal(result.roleHints.speaker.status,'conflict'); assert.equal(result.roleHints.speaker.reason,'conflicting-explicit-roles');
    assert.equal(key(result,'speaker'),undefined); assert.equal(result.toneContext.voiceExamples.length,0);
    assert.deepEqual(result.roleHints.speaker.evidence.map(value=>value.raw),[P,Q]);
    selected.metadata={Speaker:P,Listener:Q};
    const separate=await build(selected,[selected,first,second]);
    assert.equal(key(separate,'speaker'),'npc:'+P); assert.equal(key(separate,'listener'),'npc:'+Q);
    assert.notEqual(key(separate,'speaker'),key(separate,'listener'));
    assert.deepEqual(separate.roleHints.identities.map(value=>value.references),[[P],[Q]]);
});

test('shared NPC names are ambiguous while unique loaded short-name aliases retain exact identity',async()=>{
    const first=npc(P,'Synthetic Guard'),second=npc(Q,'Synthetic Guard');
    first.fields.push(field('Short Name','First Guard'));second.fields.push(field('Short Name','Second Guard'));
    for(const name of ['Synthetic Guard','  SYNTHETIC   GUARD  ']) {
        const selected=line('Selected',{Speaker:name}),result=await build(selected,[selected,first,second]);
        assert.equal(result.roleHints.speaker.status,'unknown'); assert.equal(key(result,'speaker'),undefined);
        assert.ok(result.roleHints.unresolved.some(value=>value.reason==='ambiguous-identity'));
    }
    const selected=line('Selected',{Speaker:' first guard ',Listener:'Second Guard'}),result=await build(selected,[selected,first,second]);
    assert.equal(key(result,'speaker'),'npc:'+P); assert.equal(key(result,'listener'),'npc:'+Q);
    assert.equal(result.roleHints.speaker.confidence,'explicit');
});

test('paired workbook rows sharing one exact NPC path do not make its verified aliases ambiguous',async()=>{
    const first=npc(P,'Synthetic Guard'); first.fields.push(field('Short Name','Guard Alias'));
    const paired=S.normalizeUnit({...structuredClone(first),role:'hint',id:undefined});
    const selected=line('Selected',{Speaker:'Guard Alias','Speaking Character':P}),before=JSON.stringify([selected,first,paired]),
        result=await build(selected,[selected,first,paired]);
    assert.equal(result.roleHints.speaker.status,'resolved'); assert.equal(key(result,'speaker'),'npc:'+P);
    assert.deepEqual(result.roleHints.identities.find(value=>value.key===key(result,'speaker')).references,[P]);
    assert.equal(JSON.stringify([selected,first,paired]),before);
});

test('same-name NPC dialogue cannot contaminate verified speaker examples through a browsing group',async()=>{
    const first=npc(P,'Synthetic Guard'),second=npc(Q,'Synthetic Guard');first.fields.push(field('Short Name','First Guard'));
    const selected=line('Selected',{Speaker:P},30),own=line('Own',{Speaker:P},29,'Verified own voice.'),
        alias=line('Alias',{Speaker:'First Guard'},31,'Verified alias voice.'),other=line('Other',{Speaker:Q},28,'WRONG NPC VOICE'),
        ambiguous=line('Ambiguous',{Speaker:'Synthetic Guard'},27,'AMBIGUOUS NAME VOICE'),
        conflict=line('Conflict',{Speaker:P,'Speaking Character':Q},26,'CONFLICTING SPEAKER VOICE'),
        result=await build(selected,[selected,first,second,own,alias,other,ambiguous,conflict]);
    assert.equal(key(result,'speaker'),'npc:'+P);
    assert.deepEqual(result.toneContext.voiceExamples.map(value=>value.provenance.recordId),['Alias','Own']);
    assert.ok(result.toneContext.voiceExamples.every(value=>value.identityKey==='npc:'+P));
    assert.equal(result.toneContext.selection.eligibleVoiceExamples,2);
});

test('same portrait artwork and same display name never prove cross-path NPC voice equivalence',async()=>{
    const paths=['Metadata/NPC/League/Chayula/ChayulaFarmerHub','Metadata/NPC/League/Chayula/ChayulaFarmerNearDreamer'],
        first=npc(paths[0],'Synthetic Guard'),second=npc(paths[1],'Synthetic Guard'),selected=line('Selected',{Speaker:paths[0]}),
        own=line('Own',{Speaker:paths[0]},29,'Same exact path voice.'),other=line('Other',{Speaker:paths[1]},28,'OTHER PATH SAME ART'),
        result=await build(selected,[selected,first,second,own,other]);
    assert.equal(Catalog.games.poe2.npcs[paths[0]][0],Catalog.games.poe2.npcs[paths[1]][0]);
    assert.deepEqual(result.toneContext.voiceExamples.map(value=>value.provenance.recordId),['Own']);
    assert.equal(result.toneContext.voiceExamples[0].identityKey,'npc:'+paths[0]);
});

test('ambiguous browsing-group participants need exact family reference evidence before role suggestions',async()=>{
    const first=npc(P,'Synthetic Guard'),second=npc(Q,'Synthetic Guard'),hero=character(A,'Synthetic Mage'),selected=line('Selected',{Character:A}),
        units=[selected,first,second,hero],npcIndex=await N.buildNpcIndex(units,{yield:async()=>{}}),parentKey=[...npcIndex.groupByKey.keys()][0],
        family={familyKey:'Synthetic',parentKey},convoIndex={memberships:new Map([[selected.id,family]])},
        unknown=await build(selected,units,{npcIndex,convoIndex});
    assert.equal(unknown.roleHints.order.reason,'ambiguous-npc-group-identity');assert.equal(key(unknown,'speaker'),undefined);
    family.npcEvidence={participants:[{key:parentKey,references:[P]}]};
    const verified=await build(selected,units,{npcIndex,convoIndex});
    assert.equal(verified.roleHints.order.status,'reliable');assert.equal(key(verified,'listener'),'npc:'+P);
    assert.equal(key(verified,'speaker'),'character:'+A);
});

async function ambiguousRowCharacter({sheet='NPCTalkDialogueTextAudio',id='Synthetic_Spirit=NoLore',metadata={Character:A},extra=[],change=()=>{}}={}) {
    const selected=unit(sheet,id,[field('Text','Synthetic selected dialogue.')],metadata),
        first=npc(P,'Same Synthetic Name'),second=npc(Q,'Same Synthetic Name'),units=[selected,first,second,...extra],
        npcIndex=await N.buildNpcIndex(units,{yield:async()=>{}}),parentKey=[...npcIndex.groupByKey].find(([,group])=>group.npcUnits.includes(first))[0],
        family={familyKey:'Synthetic',parentKey,ambiguous:false,npcEvidence:{participants:[{key:parentKey,references:[P,Q]}],unresolved:[],ambiguous:[]}},
        convoIndex={memberships:new Map([[selected.id,family]])};
    change({selected,units,npcIndex,family,convoIndex});
    return {selected,units,npcIndex,convoIndex,result:await build(selected,units,{npcIndex,convoIndex})};
}

// Actual OOXML decoding and both derived indexes, including empty metadata
// cells retained by the decoder. No hand-authored conversation membership.
async function decodedRowCharacter({blank='',filter=blank,prohibited=blank,npcReference=blank,suffix='NoLore',roleColumn,
    sheetName='NPCTalkDialogueTextAudio'}={}) {
    const zip=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',
        escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r/g,'&#13;'),
        meta=value=>({value,metadata:true}),
        sheets=[
            [sheetName,[
                ['ID',meta('NPC'),meta('Character'),'Text','Translation',meta('Character Filter'),meta('Prohibited Character Filter'),meta('AudioFile'),...(roleColumn?[meta(roleColumn)]:[])],
                ['Synthetic_Spirit_A_Dex4b='+suffix,npcReference,A,'Synthetic selected dialogue.','',filter,prohibited,'Synthetic/clip.ogg',...(roleColumn?[blank]:[])],
                ['Synthetic_Spirit_B',P,'','Synthetic first NPC dialogue.'],
                ['Synthetic_Spirit_C',Q,'','Synthetic second NPC dialogue.']]],
            ['NPCs',[['ID','Name','Translation'],[P,'Same Synthetic Name',''],[Q,'Same Synthetic Name','']]],
            ['Characters',[['ID','Name','Translation','Description','Translation','Traits Description','Translation'],
                [A,'Synthetic Mage','','Synthetic authored introduction.','','Synthetic gameplay traits.','']]]
        ];
    zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
    zip.file('xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map(([name],index)=>'<sheet name="'+name+'" sheetId="'+(index+1)+'" r:id="rId'+(index+1)+'"/>').join('')+'</sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,index)=>'<Relationship Id="rId'+(index+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(index+1)+'.xml"/>').join('')+'</Relationships>');
    zip.file('xl/styles.xml','<styleSheet xmlns="'+ns+'"><fonts count="2"><font/><font><i/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><cellStyleXfs count="1"><xf fontId="0" fillId="0"/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" xfId="0"/><xf fontId="1" fillId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>');
    for(const [index,[,rows]]of sheets.entries())zip.file('xl/worksheets/sheet'+(index+1)+'.xml','<worksheet xmlns="'+ns+'"><sheetData>'+rows.map((cells,row)=>'<row r="'+(row+1)+'">'+cells.map((cell,column)=>{
        const metadata=typeof cell==='object';return '<c r="'+String.fromCharCode(65+column)+(row+1)+'" s="'+(metadata?1:0)+'" t="inlineStr"><is><t xml:space="preserve">'+escape(metadata?cell.value:cell)+'</t></is></c>';
    }).join('')+'</row>').join('')+'</sheetData></worksheet>');
    const parsed=await Codec.parseWorkbook(await zip.generateAsync({type:'uint8array'}),{filename:'Thai.xlsx',language:'Thai'}),
        units=parsed.units,selected=units.find(value=>value.recordId==='Synthetic_Spirit_A_Dex4b='+suffix),
        npcIndex=await N.buildNpcIndex(units,{yield:async()=>{}}),convoIndex=await Convo.buildConvoIndex(units,npcIndex,{yield:async()=>{}}),
        scope={accountId:'synthetic',game:'poe2',branchId:'default',language:'Thai'},
        toneNotes={status:'ready',accountId:scope.accountId,scope,entries:[{identityKey:'character:'+A,revision:1,text:'Synthetic saved voice guidance'}]},
        result=await build(selected,units,{npcIndex,convoIndex,scope,toneNotes});
    return {selected,units,npcIndex,convoIndex,result};
}

test('decoded empty NPC and filter cells permit only the independent canonical-character speaker hint',async()=>{
    for(const blank of ['', ' \t\r\n ']) {
        const {selected,convoIndex,result}=await decodedRowCharacter({blank});
        assert.deepEqual(selected.metadata,{NPC:blank,Character:A,'Character Filter':blank,'Prohibited Character Filter':blank,AudioFile:'Synthetic/clip.ogg'});
        const family=convoIndex.memberships.get(selected.id);
        assert.equal(family.ambiguous,false);assert.equal(family.npcEvidence.participants.length,1);
        assert.deepEqual(family.npcEvidence.participants[0].references,[Q,P].sort());
        assert.equal(result.roleHints.speaker.status,'suggested');assert.equal(key(result,'speaker'),'character:'+A);
        assert.equal(result.roleHints.speaker.evidence[0].rule,'single-canonical-character-speaks');
        assert.equal(result.roleHints.listener.status,'unknown');assert.equal(result.roleHints.order.status,'suppressed');
        assert.deepEqual(result.roleHints.order.reasons,['ambiguous-npc-group-identity']);
        assert.deepEqual(result.roleHints.constraints,[]);assert.deepEqual(result.roleHints.conflicts,[]);assert.deepEqual(result.roleHints.unresolved,[]);
        assert.deepEqual(result.sharedToneNotes.entries,[{identityKey:'character:'+A,revision:1,text:'Synthetic saved voice guidance',roles:['speaker']}]);
        assert.equal(result.roleHints.idSuffix.status,'condition');bounds(result);
    }
});

test('decoded populated filters, explicit role columns, NPC references and unknown suffixes still block the row-character fallback',async()=>{
    const cases=[
        ...['filter','prohibited'].flatMap(name=>[A,B,'Unknown'].map(value=>({[name]:value}))),
        ...['Speaker','Speaking Character','Listener','Listening Character','Addressee'].flatMap(roleColumn=>['',' \t\r\n '].map(blank=>({roleColumn,blank}))),
        {npcReference:P},{npcReference:'Unknown'},{suffix:'Unknown'},{suffix:'StrFour'}
    ];
    for(const options of cases) {
        const {result}=await decodedRowCharacter(options);
        assert.equal(result.roleHints.speaker.status,'unknown',JSON.stringify(options));
        assert.equal(result.sharedToneNotes?.entries.length||0,0,JSON.stringify(options));
        assert.ok(!result.roleHints.speaker.evidence?.some(value=>value.kind==='row-character-convention'),JSON.stringify(options));
        if(options.filter||options.prohibited) {
            assert.equal(result.roleHints.constraints.length,1);assert.equal(result.roleHints.constraints[0].raw,options.filter||options.prohibited);
            assert.equal(result.roleHints.constraints[0].complete,(options.filter||options.prohibited)!=='Unknown');
        }
        bounds(result);
    }
});

test('one canonical row Character can tentatively speak despite only an ambiguous NPC group; condition suffixes never identify listeners',async()=>{
    for(const sheet of ['NPCTalkDialogueTextAudio','NPCTalkDialogueTextAudio_Gender'])for(const suffix of ['', '=NoLore','=HasLore']){
        const {result}=await ambiguousRowCharacter({sheet,id:'Synthetic_Spirit'+suffix,metadata:{Character:A,AudioFile:'UnrelatedSynthetic/clip.ogg'}});
        assert.equal(result.roleHints.order.status,'suppressed');assert.equal(result.roleHints.order.reason,'ambiguous-npc-group-identity');
        assert.deepEqual(result.roleHints.order.reasons,['ambiguous-npc-group-identity']);
        assert.equal(result.roleHints.speaker.status,'suggested');assert.equal(key(result,'speaker'),'character:'+A);
        assert.equal(result.roleHints.speaker.confidence,'heuristic');assert.equal(result.roleHints.speaker.priority,1);
        assert.equal(result.roleHints.speaker.evidence[0].kind,'row-character-convention');
        assert.equal(result.roleHints.speaker.evidence[0].rule,'single-canonical-character-speaks');
        assert.equal(result.roleHints.speaker.evidence[0].independentOfParticipantOrder,true);
        assert.equal(result.roleHints.listener.status,'unknown');assert.equal(key(result,'listener'),undefined);
        if(suffix){assert.equal(result.roleHints.idSuffix.status,'condition');assert.equal(result.roleHints.idSuffix.identityKey,undefined);}
        bounds(result);
    }
});

test('row-character fallback rejects unresolved, conflicting, filtered, suffix-bearing and unverified evidence',async()=>{
    const cases=[
        {metadata:{}},{metadata:{Character:A+','+B}},{metadata:{Character:A+','+A}},{metadata:{Character:'Synthetic Mage'}},
        {metadata:{Character:'Metadata/Characters/Unknown'}},{metadata:{Character:A,character:B}},
        {metadata:{Character:A,NPC:P}},{metadata:{Character:A,npc:P}},{metadata:{Character:A,'Related Character':B}},
        {metadata:{Character:A,'Related Character':''}},
        ...['Speaker','Speaking Character','Listener','Listening Character','Addressee'].flatMap(name=>['',P,'Unknown'].map(value=>({metadata:{Character:A,[name]:value}}))),
        ...['Character Filter','Prohibited Character Filter'].flatMap(name=>[A,B,'Unknown'].map(value=>({metadata:{Character:A,[name]:value}}))),
        ...['Unknown','IntFour','StrFour','Scout','NoLore=HasLore','', ' '.repeat(300)+'NoLore'].map(suffix=>({id:'Synthetic='+suffix})),
        ...['NPCTextAudio','CharacterTextAudio','ClientStrings'].map(sheet=>({sheet})),
        {change:({family})=>{family.ambiguous=true;}},{change:({family})=>{delete family.ambiguous;}},
        {change:({family})=>{family.npcEvidence.unresolved=['Unknown'];}},
        {change:({family})=>{family.npcEvidence.ambiguous=['Unknown'];}},
        {change:({family})=>{family.npcEvidence.participants.push({key:'other',references:[]});}},
        {change:({selected,npcIndex})=>npcIndex.memberships.set(selected.id,new Map([['another-group',{}]]))},
        {extra:[npc(A,'Cross-table collision')]}
    ];
    for(const options of cases){
        const {result}=await ambiguousRowCharacter(options);
        assert.ok(!result.roleHints?.speaker.evidence?.some(value=>value.kind==='row-character-convention'),JSON.stringify(options));
        assert.ok(!result.roleHints?.speaker.evidence?.some(value=>value.rule==='single-canonical-character-speaks'));
    }
});

test('all order suppression reasons survive the first ambiguous-group failure and prevent the fallback',async()=>{
    const {result}=await ambiguousRowCharacter({metadata:{Character:A+','+B+',Metadata/Characters/Unknown'}});
    assert.equal(result.roleHints.order.reason,'ambiguous-npc-group-identity');
    assert.deepEqual(result.roleHints.order.reasons,['ambiguous-npc-group-identity','unresolved-participant','unordered-reference-list']);
    assert.equal(result.roleHints.speaker.status,'unknown');assert.equal(result.roleHints.listener.status,'unknown');
    assert.ok(result.roleHints.unresolved.some(value=>value.reason==='identity-not-loaded-or-known'));
});

test('singleton conversation fallback matches exact NPC identity rather than its shared-name browsing group',async()=>{
    const first=npc(P,'Synthetic Guard'),second=npc(Q,'Synthetic Guard');first.fields.push(field('Short Name','First Guard'));
    const selected=line('Selected',{Speaker:P},30),own=line('Own',{Speaker:'First Guard'},29),other=line('Other',{Speaker:Q},31),
        units=[selected,first,second,own,other],convoIndex={memberships:new Map([[selected.id,{familyKey:'Singleton'}]])},
        result=await build(selected,units,{convoIndex});
    assert.equal(result.surrounding.mode,'same-explicit-npc'); assert.equal(result.surrounding.npc.identityKey,'npc:'+P);
    assert.deepEqual(result.surrounding.entries.map(value=>value.recordId),['Own']);
    selected.metadata={Speaker:'Synthetic Guard'};
    const ambiguous=await build(selected,units,{convoIndex});
    assert.equal(ambiguous.surrounding.reason,'singleton-without-verified-npc');assert.equal(ambiguous.surrounding.entries.length,0);
});

test('explicit known catalog NPC paths resolve partial-workbook roles without inventing workbook names or biography',async()=>{
    const path='Metadata/NPC/Four_Act4/HoodedMentorKingsmarchIntro',selected=line('Selected',{Speaker:path}),
        speaker=await build(selected,[selected]);
    assert.equal(speaker.roleHints.speaker.status,'resolved');assert.equal(key(speaker,'speaker'),'npc:'+path);
    assert.equal(speaker.roleHints.speaker.confidence,'explicit');assert.equal(speaker.roleHints.speaker.priority,3);
    const identity=speaker.roleHints.identities.find(value=>value.key==='npc:'+path);
    assert.deepEqual(identity,{key:'npc:'+path,kind:'npc',identityEvidence:'reviewed-catalog-exact-path',references:[path]});
    assert.equal(identity.name,undefined);assert.deepEqual(speaker.toneContext.profiles,[]);
    assert.ok(speaker.toneContext.unavailable.some(value=>value.reason==='npc-biography-not-in-workbook'));
    selected.metadata={Listener:path};
    const listener=await build(selected,[selected]);assert.equal(listener.roleHints.listener.status,'resolved');
    assert.equal(key(listener,'listener'),'npc:'+path);assert.equal(key(listener,'speaker'),undefined);
});

test('catalog fallback is unavailable to NPC relationships, filters, names and suffixes even after resolving an explicit role',async()=>{
    const path='Metadata/NPC/Four_Act4/HoodedMentorKingsmarchIntro',other='Metadata/NPC/Four_Act4/DoryaniTownKingsmarchIntro';
    for(const [recordId,metadata] of [['Selected',{NPC:path}],['Selected',{'Character Filter':path}],
        ['Selected='+path,{}],['Selected='+path.split('/').at(-1),{}],['Selected',{Speaker:Catalog.games.poe2.npcs[path][1]}]]) {
        const selected=line(recordId,metadata),result=await build(selected,[selected]);
        assert.equal(key(result,'speaker'),undefined);assert.equal(key(result,'listener'),undefined);
    }
    const selected=line('Selected='+other,{Speaker:path,NPC:other}),result=await build(selected,[selected]);
    assert.equal(key(result,'speaker'),'npc:'+path);assert.equal(key(result,'listener'),undefined);
    assert.equal(result.roleHints.idSuffix.status,'unresolved');assert.equal(result.roleHints.order.status,'suppressed');
});

test('unknown, malformed, wrong-case and conflicting explicit paths cannot become catalog identities',async()=>{
    const path='Metadata/NPC/Four_Act4/HoodedMentorKingsmarchIntro',other='Metadata/NPC/Four_Act4/DoryaniTownKingsmarchIntro';
    for(const value of [P,path.toLowerCase(),path+'?',path+'/../Unknown','https://example.invalid/'+path,'constructor']) {
        const selected=line('Selected',{Speaker:value}),result=await build(selected,[selected]);
        assert.equal(result.roleHints.speaker.status,'unknown');assert.equal(key(result,'speaker'),undefined);
    }
    const selected=line('Selected',{Speaker:path,'Speaking Character':other}),result=await build(selected,[selected]);
    assert.equal(result.roleHints.speaker.status,'conflict');assert.equal(key(result,'speaker'),undefined);assert.deepEqual(result.toneContext.voiceExamples,[]);
});

test('missing or wrong-game catalogs preserve unresolved roles while loaded NPC identity still works',async()=>{
    const path='Metadata/NPC/Four_Act4/HoodedMentorKingsmarchIntro',selected=line('Selected',{Speaker:path});
    assert.equal(Object.hasOwn(Catalog.games.poe1.npcs,path),false);
    const wrongGame=await build(selected,[selected],{scope:{game:'poe1'}});assert.equal(wrongGame.roleHints.speaker.status,'unknown');
    for(const catalog of [undefined,{games:{poe2:{characters:{},npcs:{}}}}]) {
        const sandbox={ClientTextState:S,ClientTextMtlState:MtlState,DictionaryScope,TextEncoder,ClientTextPortraitCatalog:catalog};vm.createContext(sandbox);
        vm.runInContext(readFileSync(require.resolve('../public/clientTextMtlContext.js'),'utf8'),sandbox);
        const args={unit:selected,field:selected.fields[0],units:[selected],scope:{game:'poe2'}},result=sandbox.ClientTextMtlContext.build(args);
        assert.equal(result.roleHints.speaker.status,'unknown');assert.equal(key(result,'speaker'),undefined);
        const loaded=sandbox.ClientTextMtlContext.build({...args,units:[selected,npc(path,'Synthetic source name')]});
        assert.equal(loaded.roleHints.speaker.status,'resolved');assert.equal(key(loaded,'speaker'),'npc:'+path);
    }
});

test('catalog exact paths cannot be displaced by a different loaded NPC name that resembles the path',async()=>{
    const path='Metadata/NPC/Four_Act4/HoodedMentorKingsmarchIntro',impostor=npc(P,path),selected=line('Selected',{Speaker:path}),
        result=await build(selected,[selected,impostor]);
    assert.equal(key(result,'speaker'),'npc:'+path);assert.notEqual(key(result,'speaker'),'npc:'+P);
    assert.equal(result.roleHints.identities.find(value=>value.key==='npc:'+path).name,undefined);
});

test('partial-workbook voice examples match exact explicit catalog paths without merging shared artwork',async()=>{
    const paths=['Metadata/NPC/League/Chayula/ChayulaFarmerHub','Metadata/NPC/League/Chayula/ChayulaFarmerNearDreamer'],
        selected=line('Selected',{Speaker:paths[0]},30),own=line('Own',{Speaker:paths[0]},29,'Verified same path voice.'),
        other=line('Other',{Speaker:paths[1]},31,'OTHER PATH VOICE'),name=line('NameOnly',{Speaker:Catalog.games.poe2.npcs[paths[0]][1]},28,'NAME ONLY VOICE'),
        result=await build(selected,[selected,own,other,name]);
    assert.equal(Catalog.games.poe2.npcs[paths[0]][0],Catalog.games.poe2.npcs[paths[1]][0]);
    assert.deepEqual(result.toneContext.voiceExamples.map(value=>value.provenance.recordId),['Own']);
    assert.ok(result.toneContext.voiceExamples.every(value=>value.identityKey==='npc:'+paths[0]));
});
