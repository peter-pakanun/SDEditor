const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const N=require('../public/clientTextNpcIndex.js');
const C=require('../public/clientTextConvoIndex.js');

function unit(sheet,recordId,options={}) {
    const role=options.role || 'normal';
    return {id:JSON.stringify([role,sheet,recordId]),role,sheet,recordId,
        fields:options.fields || [{name:'Text',source:'English',target:'Original target'}],metadata:options.metadata || {}};
}
function npc(recordId,name,shortName='',options={}) {
    return unit('NPCs',recordId,{...options,fields:[{name:'Name',source:name,target:'Translated name'},
        {name:'Short Name',source:shortName,target:'Translated short name'}]});
}
function convo(id,options={}) {return unit(options.role==='gender'?'NPCTalkDialogueTextAudio_Gender':'NPCTalkDialogueTextAudio',id,options);}
async function build(rows,options={}) {return C.buildConvoIndex(rows,await N.buildNpcIndex(rows,{yield:async()=>{}}),options);}
function freeze(value) {if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}

test('family extraction groups turn, lowercase branch, class and conditional variants',()=>{
    for(const id of ['DoryaniA4_Intro_A','DoryaniA4_Intro_A_Sin','DoryaniA4_Intro_B_Dex4b',
        'DoryaniA4_Intro_C_Sin','DoryaniA4_Intro_C','DoryaniA4_Intro_StrInt4b_A1a',
        'DoryaniA4_Intro_A1b','DoryaniA4_Intro_D1=NoLore','DoryaniA4_Intro_E1=HasLore']) {
        assert.equal(C.familyForId(id).stem,'DoryaniA4_Intro',id);
        assert.equal(C.familyForId(id).anchor,'DoryaniA4');
    }
    assert.equal(C.familyForId('Kanu_OnTribe_B1=StrDex4').turn,'B1=StrDex4');
    for(const form of ['Str4','Str4b','Int4','Int4b','Dex4','Dex4b','StrDex4','StrDex4b','DexInt4','DexInt4b','StrInt4','StrInt4b'])
        assert.equal(C.familyForId('RogA4_OnKing_'+form+'_B1b').stem,'RogA4_OnKing');
});

test('nested namespaces, chapter context, case and nonstandard fallback stems remain intact',()=>{
    assert.deepEqual(C.familyForId('Doryani_Inc_Intro_A1'),{stem:'Doryani_Inc_Intro',anchor:'Doryani',turn:'A1'});
    assert.deepEqual(C.familyForId('Mentor_A5_ArriveHarbour_A2'),{stem:'Mentor_A5_ArriveHarbour',anchor:'Mentor',turn:'A2'});
    assert.equal(C.familyForId('Cedrus_HideoutIntro_B1_Int4b_a1_El').stem,'Cedrus_HideoutIntro');
    for(const id of ['HuntressDelwynIntroConvoA','ZelinaOnRitual','Lorandis_IntroListen_StrInt4b_B1response',
        'Matiki_EyeofHinekIntroAfterDead_B2H','RhodriHarbourPartingConversation_A2WarriorResponse','Renly_Intro'])
        assert.equal(C.familyForId(id).stem,id);
    assert.equal(C.familyForId('Renly_Intro_A1').stem,'Renly_Intro');
    assert.equal(C.familyForId('Renly_intro_A1').stem,'Renly_intro','exact stem case is an identity');
});

test('full Name resolves title collisions while suffix speakers and class metadata cannot choose the parent',async()=>{
    const rows=[npc('Metadata/NPC/Doryani','Doryani'),npc('Metadata/Monsters/DoryaniPast','Doryani, Royal Thaumaturge','Doryani'),
        npc('Metadata/NPC/Sin','Sin'),convo('DoryaniA4_Intro_A_Sin'),
        convo('DoryaniA4_Intro_B_Str4b',{metadata:{Character:'Metadata/Characters/Str/Sin'}}),convo('Sin_OnDoryani_A1')];
    const index=await build(rows),doryani=index.parents.find(parent=>parent.label==='Doryani'),sin=index.parents.find(parent=>parent.label==='Sin');
    assert.equal(index.parents[0].key,'unassigned');assert.equal(index.parents[0].units.length,0);
    assert.equal(doryani.units.length,2);assert.equal(sin.units.length,1);
    assert.deepEqual(index.memberships.get(rows[3].id),{parentKey:doryani.key,familyKey:'DoryaniA4_Intro',anchor:'DoryaniA4',turn:'A',aliases:['Doryani'],aliasType:'name',ambiguous:false});
    assert.equal(index.memberships.get(rows[4].id).parentKey,doryani.key);
    assert.equal(index.memberships.get(rows[5].id).parentKey,sin.key);
});

test('longer ambiguous paths never fall back to a shorter unique full Name',async()=>{
    const rows=[npc('Metadata/NPC/Doryani','Doryani'),npc('Metadata/Monsters/Past/DoryaniPast','Doryani, Royal Thaumaturge','Doryani'),
        npc('Metadata/Monsters/Other/DoryaniPast','Kulka, Vaal Thaumaturge','Kulka'),convo('DoryaniPast_Intro_A1')];
    const index=await build(rows),member=index.memberships.get(rows[3].id);
    assert.equal(member.parentKey,'unassigned');assert.equal(member.ambiguous,true);assert.equal(member.aliasType,'path');
    assert.deepEqual(member.aliases,['DoryaniPast']);assert.equal(index.parents.length,1);
    assert.equal(index.families[0].label,'DoryaniPast_Intro');
});

test('shared winning Short Name aliases stay unassigned and generic Info supplies only path aliases',async()=>{
    const rows=[npc('Metadata/NPC/One','First Guide','Guide'),npc('Metadata/NPC/Two','Second Guide','Guide'),
        npc('Metadata/NPC/Info/AncientTablet','Inscription','Guide'),convo('Guide_Intro_A1'),
        convo('Inscription_Intro_A1'),convo('AncientTablet_Intro_A1')];
    const index=await build(rows);
    assert.equal(index.memberships.get(rows[3].id).ambiguous,true);assert.equal(index.memberships.get(rows[3].id).aliasType,'short');
    assert.equal(index.memberships.get(rows[4].id).ambiguous,false);assert.equal(index.memberships.get(rows[4].id).aliasType,'');
    assert.equal(index.memberships.get(rows[4].id).parentKey,'unassigned');
    assert.equal(index.memberships.get(rows[5].id).aliasType,'path');
    assert.equal(index.parents.find(parent=>parent.label==='Inscription').units[0],rows[5]);
});

test('source article, unique short fallback, Monster paths and Unicode match at prefix boundaries',async()=>{
    const rows=[npc('Metadata/NPC/HoodedMentor','The Hooded One'),npc('Metadata/Monsters/NPC/UnknownGuide','','Elusive Guide'),
        npc('Metadata/NPC/Una','Una'),npc('Metadata/NPC/FullWidth','Ｒｅｎｌｙ'),convo('HoodedOne_Intro_A1'),
        convo('HoodedMentorEG_Asleep_A1'),convo('ElusiveGuide_Intro_A1'),convo('Unarmed_Intro_A1'),
        convo('Tribunal_Intro_A1'),convo('UnaRenly_Intro_A1'),convo('RenlyP1_Intro_A1')];
    const index=await build(rows);
    const labels=rows.slice(4).map(row=>index.parentByKey.get(index.memberships.get(row.id).parentKey).label);
    assert.deepEqual(labels,['The Hooded One','The Hooded One','Elusive Guide','Unassigned NPC','Unassigned NPC','Una','Renly']);
    assert.equal(index.memberships.get(rows[6].id).aliasType,'short');assert.equal(index.memberships.get(rows[5].id).aliasType,'path');
});

test('mapped NPC aggregates separate contexts and retains original row order across Normal/Gender units',async()=>{
    const rows=freeze([npc('Metadata/NPC/Doryani','Doryani'),convo('DoryaniA4_Intro_C_Sin'),convo('DoryaniA4_Intro_C'),
        convo('DoryaniA4_Intro_A'),convo('DoryaniInterlude_Intro_A1'),convo('Doryani_Inc_Intro_A1'),
        convo('DoryaniA4_Intro_A',{role:'gender'}),unit('NPCTextAudio','DoryaniA4_Intro_A'),unit('NPCTalk','Metadata/NPC/Doryani::0')]);
    const before=JSON.stringify(rows),npcIndex=freeze(await N.buildNpcIndex(rows,{yield:async()=>{}})),index=await C.buildConvoIndex(rows,npcIndex);
    const parent=index.parents.find(parent=>parent.label==='Doryani');
    assert.equal(index.units.length,6);assert.equal(parent.units.length,6);assert.equal(parent.families.length,3);
    assert.equal(index.familyByKey.get('DoryaniA4_Intro').label,'Intro');
    assert.equal(index.familyByKey.get('DoryaniInterlude_Intro').label,'Intro');
    assert.equal(index.familyByKey.get('Doryani_Inc_Intro').label,'Inc_Intro');
    assert.deepEqual(index.familyByKey.get('DoryaniA4_Intro').units,[rows[1],rows[2],rows[3],rows[6]],'workbook order does not become lexical turn order');
    assert.equal(index.memberships.get(rows[1].id).familyKey,'DoryaniA4_Intro');
    assert.equal(new Set(index.units.map(row=>row.id)).size,6);assert.equal(JSON.stringify(rows),before);
    assert.equal(parent.npcUnits[0],rows[0]);assert.notEqual(parent.npcUnits,npcIndex.groups[0].npcUnits);
});

test('unassigned children retain anchors and fallback entries join only identical stems',async()=>{
    const rows=[npc('Metadata/NPC/Renly','Renly'),convo('MentorP1_Intro_A1'),convo('MentorP2_Intro_A1'),
        convo('HuntressDelwynIntroConvoA'),convo('Renly_Intro'),convo('Renly_Intro_A1'),convo('Renly_intro_A1'),
        convo('ZelinaOnRitual')];
    const index=await build(rows);
    assert.equal(index.familyByKey.get('MentorP1_Intro').label,'MentorP1_Intro');
    assert.equal(index.familyByKey.get('MentorP2_Intro').label,'MentorP2_Intro');
    assert.equal(index.familyByKey.get('HuntressDelwynIntroConvoA').label,'HuntressDelwynIntroConvoA');
    assert.equal(index.familyByKey.get('Renly_Intro').units.length,2);
    assert.equal(index.familyByKey.get('Renly_intro').units.length,1);
    assert.equal(index.families.length,6);
});

test('duplicate full IDs are ignored, mapped parents sort stably and browser export works',async()=>{
    const rows=[npc('Metadata/NPC/Zarka','Zarka'),npc('Metadata/NPC/Una','Una'),npc('Metadata/NPC/Renly','Renly'),
        convo('Zarka_Intro_A1'),convo('Renly_Intro_A1'),convo('Una_Intro_A1')];
    const index=await build([...rows,rows[4]]),reversed=await build([...rows].reverse());
    assert.deepEqual(index.parents.map(parent=>parent.label),['Unassigned NPC','Renly','Una','Zarka']);
    assert.deepEqual(index.parents.map(parent=>parent.key),reversed.parents.map(parent=>parent.key));assert.equal(index.units.length,3);
    assert.equal(index.parentByKey.get(index.parents[1].key),index.parents[1]);
    assert.equal(index.familyByKey.get(index.families[0].key),index.families[0]);
    const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/clientTextConvoIndex.js'),'utf8'),context);
    assert.equal(typeof context.ClientTextConvoIndex.buildConvoIndex,'function');assert.equal(context.ClientTextConvoIndex.familyForId('Renly_Intro_A1').stem,'Renly_Intro');
});

test('cooperative work aborts obsolete contexts and yields for CPU budget rather than every fast batch',async()=>{
    const rows=[npc('Metadata/NPC/Renly','Renly'),...Array.from({length:2000},(_,i)=>convo('Renly_Intro_A1_Variant'+i))],npcIndex=await N.buildNpcIndex(rows,{yield:async()=>{}});
    let current=true;
    await assert.rejects(C.buildConvoIndex(rows,npcIndex,{guard:()=>current,yield:async()=>{current=false;}}),error=>error.name==='AbortError'&&error.stale===true);
    const controller=new AbortController();controller.abort();
    await assert.rejects(C.buildConvoIndex(rows,npcIndex,{signal:controller.signal}),error=>error.name==='AbortError');
    let pauses=0;const index=await C.buildConvoIndex(rows,npcIndex,{now:()=>0,yield:async()=>{pauses++;}});
    assert.equal(pauses,1);assert.equal(index.units.length,2000);assert.equal(index.families.length,1);
    let clock=0,timed=0;await C.buildConvoIndex(rows,npcIndex,{now:()=>clock,yield:async()=>{timed++;},guard:()=>{clock++;return true;}});
    assert.ok(timed>1);
    let calls=0;
    await assert.rejects(C.buildConvoIndex(rows,npcIndex,{now:()=>0,yield:async()=>{},guard:()=>++calls<4}),error=>error.stale===true);
});
