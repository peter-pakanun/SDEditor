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

test('lowercase numbered turns join their conversation stem and retain exact marker evidence',()=>{
    for(const [id,turn] of [
        ['Ailith_MonasteryFirstInteract_i1_Dex4','i1'],
        ['Ailith_MonasteryFirstInteract_i1_StrDex4b_a1','i1'],
        ['Ailith_MonasteryFirstInteract_i2','i2'],
        ['Ailith_MonasteryFirstInteract_i2=DexInt4b','i2=DexInt4b'],
        ['Ailith_MonasteryFirstInteract_Str4b_a1b','a1b']
    ])assert.deepEqual(C.familyForId(id),{stem:'Ailith_MonasteryFirstInteract',anchor:'Ailith',turn});
    assert.deepEqual(C.familyForId('ElderMadox_DeliCraft_i1'),{stem:'ElderMadox_DeliCraft',anchor:'ElderMadox',turn:'i1'});
});

test('nested lowercase branches preserve earlier uppercase turns without broadening bare letters or uppercase suffixes',()=>{
    for(const [id,stem,turn] of [
        ['Farrow_TreeOfSouls_B2_b_a1','Farrow_TreeOfSouls','B2'],
        ['Ailith_MonasteryFirstInteract_F2_a_a1','Ailith_MonasteryFirstInteract','F2'],
        ['ElderMadox_Saved_A2=Met_d_a1','ElderMadox_Saved','A2=Met']
    ])assert.deepEqual(C.familyForId(id),{stem,anchor:id.split('_')[0],turn});
    for(const id of ['Ailith_MonasteryFirstInteract_a','Ailith_MonasteryFirstInteract_b_Dex4',
        'Ailith_MonasteryFirstInteract_a=NoLore','Matiki_EyeofHinekIntroAfterDead_B2H'])
        assert.deepEqual(C.familyForId(id),{stem:id,anchor:id.split('_')[0],turn:''});
});

test('merged lowercase families preserve ownership, full Normal/Gender identities, original casing and source row order',async()=>{
    const rows=freeze([npc('Metadata/NPC/Ailith','Ailith'),npc('Metadata/NPC/ElderMadox','Elder Madox'),
        convo('Ailith_MonasteryFirstInteract_F2_a_a1'),convo('Ailith_MonasteryFirstInteract_i1_Dex4'),
        convo('Ailith_MonasteryFirstInteract_i2=DexInt4b'),convo('Ailith_MonasteryFirstInteract_i1_Dex4',{role:'gender'}),
        convo('ElderMadox_DeliCraft_A1'),convo('ElderMadox_DeliCraft_i1')]);
    const before=JSON.stringify(rows),previous=await build([rows[0],rows[1],rows[2],rows[6]]),index=await build(rows);
    const ailith=index.familyByKey.get('Ailith_MonasteryFirstInteract'),madox=index.familyByKey.get('ElderMadox_DeliCraft');
    assert.deepEqual(ailith.units,[rows[2],rows[3],rows[4],rows[5]]);
    assert.deepEqual(madox.units,[rows[6],rows[7]]);
    assert.deepEqual(index.memberships.get(rows[2].id),previous.memberships.get(rows[2].id),'existing uppercase membership stays exact');
    assert.deepEqual(index.memberships.get(rows[6].id),previous.memberships.get(rows[6].id));
    for(const row of ailith.units)assert.equal(index.memberships.get(row.id).parentKey,previous.memberships.get(rows[2].id).parentKey);
    assert.equal(index.memberships.get(rows[7].id).parentKey,previous.memberships.get(rows[6].id).parentKey);
    assert.equal(index.memberships.get(rows[3].id).turn,'i1');assert.equal(index.memberships.get(rows[4].id).turn,'i2=DexInt4b');
    assert.equal(new Set(ailith.units.map(row=>row.id)).size,4);
    assert.notEqual(rows[3].id,rows[5].id);assert.equal(rows[3].recordId,rows[5].recordId);
    assert.equal(ailith.units[1],rows[3]);assert.equal(ailith.units[3],rows[5]);assert.equal(JSON.stringify(rows),before);
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

test('explicit NPC participants keep complete ID families under a matching shared context parent',async()=>{
    const doryaniPath='Metadata/NPC/Four_Act4/DoryaniTownKingsmarchIntro',hoodPath='Metadata/NPC/Four_Act4/HoodedMentorKingsmarchIntro';
    const rows=freeze([npc(doryaniPath,'Doryani'),npc(hoodPath,'The Hooded One'),
        convo('DoryaniA4_Intro_A',{metadata:{NPC:doryaniPath}}),
        convo('DoryaniA4_Intro_A_Sin',{metadata:{NPC:hoodPath}}),
        convo('DoryaniA4_Intro_B_Dex4b',{metadata:{NPC:'',Character:'Metadata/Characters/Dex/DexFourb'}}),
        convo('DoryaniA4_Intro_C_Sin',{metadata:{NPC:hoodPath}}),convo('DoryaniA4_Intro_C',{metadata:{NPC:doryaniPath}}),
        convo('DoryaniA4_Intro_i1_StrDex4b',{metadata:{NPC:'',Character:'Metadata/Characters/StrDex/StrDexFourb'}}),
        convo('DoryaniA4_Intro_A_Sin',{role:'gender',metadata:{NPC:hoodPath}}),
        convo('DoryaniInterlude_Intro_A1',{metadata:{NPC:doryaniPath}}),
        convo('Doryani_Inc_Intro_a1',{metadata:{NPC:doryaniPath}})]);
    const before=JSON.stringify(rows),npcIndex=await N.buildNpcIndex(rows,{yield:async()=>{}}),index=await C.buildConvoIndex(rows,npcIndex);
    const participantLabels=row=>[...npcIndex.memberships.get(row.id).keys()].map(key=>npcIndex.groupByKey.get(key).label);
    assert.deepEqual(participantLabels(rows[2]),['Doryani']);assert.deepEqual(participantLabels(rows[3]),['The Hooded One']);
    assert.deepEqual(participantLabels(rows[4]),[]);assert.deepEqual(participantLabels(rows[7]),[]);
    assert.deepEqual(participantLabels(rows[8]),['The Hooded One']);
    assert.deepEqual(npcIndex.unassigned,[rows[4],rows[7]],'Player character turns remain accessible without a guessed NPC actor');
    const doryani=index.parents.find(parent=>parent.label==='Doryani'),intro=index.familyByKey.get('DoryaniA4_Intro');
    assert.deepEqual(intro.units,rows.slice(2,9),'NPC, other-participant and player turns retain workbook order in one family');
    assert.deepEqual(doryani.units,rows.slice(2));assert.equal(doryani.families.length,3);
    assert.equal(index.parents.some(parent=>parent.label==='The Hooded One'),false,'A matching ID anchor resolves a multi-participant conversation parent');
    for(const row of intro.units){assert.equal(index.memberships.get(row.id).familyKey,intro.key);assert.equal(index.memberships.get(row.id).parentKey,doryani.key);}
    assert.equal(index.memberships.get(rows[7].id).turn,'i1');
    assert.equal(index.memberships.get(rows[10].id).familyKey,'Doryani_Inc_Intro');assert.equal(index.memberships.get(rows[10].id).turn,'a1');
    assert.notEqual(rows[3].id,rows[8].id);assert.equal(rows[3].recordId,rows[8].recordId);
    const withoutHints=rows.map(row=>({...row,metadata:Object.fromEntries(Object.entries(row.metadata).filter(([name])=>name!=='NPC'))}));
    const legacy=await build(withoutHints);
    for(const row of index.units)for(const name of ['parentKey','familyKey','anchor','turn'])
        assert.equal(index.memberships.get(row.id)[name],legacy.memberships.get(row.id)[name],'NPC hints preserve this established family context and exact turn identity');
    assert.equal(new Set(index.units.map(row=>row.id)).size,9);assert.equal(JSON.stringify(rows),before);
    assert.equal(intro.units[1],rows[3]);assert.equal(intro.units[6],rows[8]);
});

test('explicit NPC family ownership resolves Mort aliases and overrides misleading Renly ID prefixes',async()=>{
    const mort='Metadata/NPC/Four_Act1/DogTrader',una='Metadata/NPC/Four_Act1/Una';
    const rows=freeze([npc(mort,'Mortimer'),npc(una,'Una'),npc('Metadata/NPC/Four_Act1/Renly','Renly'),
        convo('Mort_FirstTimeConvo_A1',{metadata:{NPC:mort}}),
        convo('Mort_FirstTimeConvo_i1_Dex4',{metadata:{NPC:'',Character:'Metadata/Characters/Dex/DexFour'}}),
        convo('Renly_Intro_A1',{metadata:{NPC:una}}),convo('Renly_Intro_B1_Dex4',{metadata:{NPC:'',Character:'Metadata/Characters/Dex/DexFour'}})]);
    const before=JSON.stringify(rows),index=await build(rows),mortimer=index.parents.find(parent=>parent.label==='Mortimer'),unaParent=index.parents.find(parent=>parent.label==='Una');
    assert.deepEqual(mortimer.units,rows.slice(3,5));assert.deepEqual(unaParent.units,rows.slice(5));
    assert.equal(index.familyByKey.get('Mort_FirstTimeConvo').parentKey,mortimer.key);assert.equal(index.familyByKey.get('Mort_FirstTimeConvo').label,'FirstTimeConvo');
    assert.equal(index.familyByKey.get('Renly_Intro').parentKey,unaParent.key);assert.equal(index.parents.some(parent=>parent.label==='Renly'),false);
    const mortFamily=index.familyByKey.get('Mort_FirstTimeConvo');
    assert.deepEqual(mortFamily.npcEvidence,{reason:'npc',references:[mort],participants:[{key:mortimer.key,label:'Mortimer',references:[mort]}],unresolved:[],ambiguous:[]});
    for(const row of mortFamily.units) {
        const member=index.memberships.get(row.id);assert.equal(member.npcEvidence,mortFamily.npcEvidence);assert.deepEqual(member.aliases,[]);assert.equal(member.aliasType,'');
    }
    assert.equal(index.units.length,4);assert.equal(JSON.stringify(rows),before);assert.equal(index.memberships.get(rows[4].id).turn,'i1');
    const legacy=await build(rows.map(row=>({...row,metadata:{}})));
    assert.equal(legacy.familyByKey.get('Mort_FirstTimeConvo').parentKey,'unassigned');
    assert.equal(legacy.parentByKey.get(legacy.familyByKey.get('Renly_Intro').parentKey).label,'Renly','Workbooks without hints retain prefix ownership');
});

test('25 Doryani actor and player turns stay together regardless of first player, Gender role or input order',async()=>{
    const doryani='Metadata/NPC/Four_Act4/DoryaniTown',hood='Metadata/NPC/Four_Act4/HoodedMentor';
    const suffixes=['A','A_Sin','B','B_Dex4b','B_DexInt4b','B_Str4b','B_Int4','B_Int4b','B_StrDex4','B_StrDex4b','B_StrInt4','B_StrInt4b',
        'C_Sin','C','D','D_Dex4b','D_DexInt4b','D_Str4b','D_Int4','D_Int4b','D_StrDex4','D_StrDex4b','D_StrInt4','D_StrInt4b','E'];
    const turns=suffixes.map((suffix,index)=>convo('DoryaniA4_Intro_'+suffix,{...(index===3?{role:'gender'}:{}),metadata:suffix.endsWith('_Sin')?{NPC:hood}:
        /^[A-Z]$/.test(suffix)?{NPC:doryani}:{NPC:'',Character:'Metadata/Characters/Dex/DexFourb'}}));
    const ordered=[turns[3],...turns.slice(0,3),...turns.slice(4)],rows=freeze([npc(doryani,'Doryani'),npc(hood,'The Hooded One'),...ordered]),before=JSON.stringify(rows);
    const index=await build([...rows,ordered[0]]),reversed=await build([...rows].reverse()),family=index.familyByKey.get('DoryaniA4_Intro');
    assert.equal(index.units.length,25);assert.equal(index.families.length,1);assert.equal(family.units.length,25);assert.deepEqual(family.units,ordered);
    assert.equal(index.parentByKey.get(family.parentKey).label,'Doryani');assert.equal(reversed.familyByKey.get(family.key).parentKey,family.parentKey);
    assert.equal(family.npcEvidence.reason,'npc-anchor');assert.deepEqual(family.npcEvidence.references,[doryani,hood]);
    assert.deepEqual(family.npcEvidence.participants.map(participant=>participant.label),['Doryani','The Hooded One']);
    assert.deepEqual(family.npcEvidence,reversed.familyByKey.get(family.key).npcEvidence,'NPC evidence does not depend on the first line or participant frequency');
    assert.deepEqual(reversed.familyByKey.get(family.key).units,[...ordered].reverse(),'Each input keeps its own worksheet row order');
    for(const row of ordered) {
        assert.equal(index.memberships.get(row.id).parentKey,family.parentKey);assert.equal(index.memberships.get(row.id).familyKey,family.key);
        assert.equal(index.memberships.get(row.id).npcEvidence,family.npcEvidence);assert.deepEqual(index.memberships.get(row.id).aliases,['Doryani']);assert.equal(index.memberships.get(row.id).aliasType,'name');
        assert.equal(reversed.memberships.get(row.id).parentKey,family.parentKey);
    }
    assert.equal(family.units[0],ordered[0]);assert.equal(ordered[0].role,'gender');assert.equal(new Set(index.units.map(row=>row.id)).size,25);assert.equal(JSON.stringify(rows),before);
});

test('multiple explicit participants need a matching ID anchor and never choose by row frequency',async()=>{
    const renly='Metadata/NPC/Renly',una='Metadata/NPC/Una',doryani='Metadata/NPC/Doryani';
    const rows=[npc(renly,'Renly'),npc(una,'Una'),npc(doryani,'Doryani'),
        ...Array.from({length:8},(_,index)=>convo('Unknown_Intro_A'+(index+1),{metadata:{NPC:index===7?renly:una}})),
        convo('Doryani_Conflict_A1',{metadata:{NPC:una}}),convo('Doryani_Conflict_B1',{metadata:{NPC:renly}})];
    for(const input of [rows,[...rows].reverse()]) {
        const index=await build(input);
        assert.equal(index.familyByKey.get('Unknown_Intro').parentKey,'unassigned','A majority of Una turns does not establish the family owner');
        assert.equal(index.familyByKey.get('Doryani_Conflict').parentKey,'unassigned','A unique ID prefix outside the explicit participant set cannot own the family');
        for(const family of index.families) {
            assert.equal(family.npcEvidence.reason,'multiple-npcs');assert.deepEqual(family.npcEvidence.participants.map(participant=>participant.label),['Renly','Una']);
            for(const row of family.units)assert.equal(index.memberships.get(row.id).ambiguous,true);
        }
        assert.equal(index.parents.length,1);assert.equal(index.parents[0].units.length,10);
    }
});

test('one hinted participant controls the whole mixed Normal/Gender family while original identities stay distinct',async()=>{
    const una='Metadata/NPC/Una',rows=freeze([npc('Metadata/NPC/Renly','Renly'),npc(una,'Una'),
        convo('Renly_Intro_A1',{role:'gender'}),convo('Renly_Intro_A1',{metadata:{NPC:una}}),convo('Renly_Intro_B1'),
        unit('NPCTextAudio','Renly_Intro_A1',{metadata:{NPC:una}})]),before=JSON.stringify(rows),index=await build(rows),reversed=await build([...rows].reverse());
    const family=index.familyByKey.get('Renly_Intro'),parent=index.parentByKey.get(family.parentKey);
    assert.equal(parent.label,'Una');assert.deepEqual(family.units,rows.slice(2,5));assert.equal(index.units.length,3);
    assert.equal(family.npcEvidence.reason,'npc');assert.deepEqual(family.npcEvidence.references,[una]);assert.equal(family.npcEvidence.participants[0].label,'Una');
    assert.equal(new Set(family.units.map(row=>row.id)).size,3);assert.notEqual(rows[2].id,rows[3].id);assert.equal(rows[2].recordId,rows[3].recordId);
    assert.equal(reversed.familyByKey.get(family.key).parentKey,parent.key);assert.equal(JSON.stringify(rows),before);
    for(const row of family.units)assert.equal(index.memberships.get(row.id).parentKey,parent.key);
});

test('blank hinted families and any unresolved or ambiguous path keep the complete family unassigned',async()=>{
    const renly='Metadata/NPC/Renly',missing='Metadata/NPC/Missing',ambiguous='Metadata/NPC/Shared';
    const rows=[npc(renly,'Renly'),npc(ambiguous,'First Guide'),npc(ambiguous,'Second Guide','',{role:'gender'}),
        convo('Renly_Player_A1',{metadata:{NPC:'',Character:'Metadata/Characters/Dex/DexFour'}}),
        convo('Renly_Player_B1',{role:'gender'}),
        convo('Renly_Missing_A1',{metadata:{NPC:missing}}),
        convo('Renly_Partial_A1',{metadata:{NPC:renly}}),convo('Renly_Partial_B1',{metadata:{NPC:missing}}),
        convo('Renly_Ambiguous_A1',{metadata:{NPC:ambiguous}}),convo('Renly_Ambiguous_B1',{metadata:{NPC:renly}})];
    const index=await build(rows),reversed=await build([...rows].reverse());
    assert.equal(index.parents.length,1);assert.equal(index.parents[0].units.length,7);
    for(const family of index.families) {
        assert.equal(family.parentKey,'unassigned');assert.equal(family.label,family.stem);assert.deepEqual(family.npcEvidence,reversed.familyByKey.get(family.key).npcEvidence);
        for(const row of family.units) {
            const member=index.memberships.get(row.id);assert.equal(member.npcEvidence,family.npcEvidence);assert.deepEqual(member.aliases,[]);assert.equal(member.aliasType,'');
        }
    }
    assert.deepEqual(index.familyByKey.get('Renly_Player').npcEvidence,{reason:'no-npc',references:[],participants:[],unresolved:[],ambiguous:[]});
    assert.equal(index.memberships.get(rows[3].id).ambiguous,false);
    const absent=index.familyByKey.get('Renly_Missing').npcEvidence,partial=index.familyByKey.get('Renly_Partial').npcEvidence,conflict=index.familyByKey.get('Renly_Ambiguous').npcEvidence;
    assert.equal(absent.reason,'unresolved-references');assert.deepEqual(absent.unresolved,[missing]);assert.deepEqual(absent.participants,[]);
    assert.equal(partial.reason,'unresolved-references');assert.deepEqual(partial.references,[missing,renly]);assert.deepEqual(partial.unresolved,[missing]);assert.equal(partial.participants[0].label,'Renly');
    assert.equal(conflict.reason,'unresolved-references');assert.deepEqual(conflict.ambiguous,[ambiguous]);assert.equal(conflict.participants[0].label,'Renly');
    assert.equal(index.memberships.get(rows[8].id).ambiguous,true);
});

test('explicit participants never narrow an ambiguous global ID alias to manufacture a parent',async()=>{
    const first='Metadata/NPC/First',second='Metadata/NPC/Second';
    const rows=[npc(first,'First Guide','Guide'),npc(second,'Second Guide','Second'),npc('Metadata/NPC/Third','Third Guide','Guide'),
        convo('Guide_Intro_A1',{metadata:{NPC:first}}),convo('Guide_Intro_B1',{metadata:{NPC:second}})];
    const index=await build(rows),family=index.familyByKey.get('Guide_Intro');
    assert.equal(family.parentKey,'unassigned');assert.equal(family.npcEvidence.reason,'multiple-npcs');assert.equal(family.units.length,2);
    assert.deepEqual(family.npcEvidence.participants.map(participant=>participant.label),['First Guide','Second Guide']);
    for(const row of family.units){assert.equal(index.memberships.get(row.id).ambiguous,true);assert.deepEqual(index.memberships.get(row.id).aliases,[]);}
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
    const rows=[npc('Metadata/NPC/Renly','Renly'),...Array.from({length:2000},(_,i)=>convo('Renly_Intro_A1_Variant'+i,{metadata:{NPC:'Metadata/NPC/Renly'}}))],npcIndex=await N.buildNpcIndex(rows,{yield:async()=>{}});
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
