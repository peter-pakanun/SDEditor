'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Portraits=require('../public/clientTextPortraits.js');
const NPC=require('../public/clientTextNpcIndex.js');
const Convo=require('../public/clientTextConvoIndex.js');
const unit=(sheet,id,metadata={},name='')=>({id:JSON.stringify(['normal',sheet,id]),role:'normal',sheet,recordId:id,metadata,fields:[{name:'Name',source:name}]});
async function fixture(){
    const ailith='Metadata/NPC/League/Chayula/ChayulaFarmerHub',ailithOther='Metadata/NPC/League/Chayula/ChayulaFarmerNearDreamer',
        doryani='Metadata/NPC/Four_Act4/DoryaniTownKingsmarchIntro',hood='Metadata/NPC/Four_Act4/HoodedMentorKingsmarchIntro';
    const rows=[unit('NPCs',ailith,{},'Ailith'),unit('NPCs',ailithOther,{},'Ailith'),unit('NPCs',doryani,{},'Doryani'),unit('NPCs',hood,{},'The Hooded One'),
        unit('NPCTalkDialogueTextAudio','Ailith_BreachFirstInteract_A1',{NPC:ailith+', '+ailithOther}),
        unit('NPCTalkDialogueTextAudio','Ailith_BreachFirstInteract_A2_Int4',{NPC:'',Character:'Metadata/Characters/Int/IntFour'}),
        unit('NPCTalkDialogueTextAudio','DoryaniA4_Intro_A',{NPC:doryani}),
        unit('NPCTalkDialogueTextAudio','DoryaniA4_Intro_A_Sin',{NPC:hood})];
    const before=JSON.stringify(rows),npcIndex=await NPC.buildNpcIndex(rows),convoIndex=await Convo.buildConvoIndex(rows,npcIndex);
    return {rows,ailith,ailithOther,hood,npcIndex,convoIndex,before,resolve:Portraits.createResolver({npcIndex,convoIndex,game:'poe2'})};
}
test('5254 displays contextual Ailith before explicit Character Witch despite blank row NPC',async()=>{
    const f=await fixture(),result=f.resolve(f.rows[5]);
    assert.deepEqual(result.map(x=>[x.id,x.relation]),[['ailith','Conversation NPC'],['witch','Character']]);
    assert.equal(f.npcIndex.memberships.get(f.rows[5].id).size,0,'portrait context must not turn a player line into an NPC speaker');
    assert.equal(JSON.stringify(f.rows),f.before);
});
test('Doryani family retains primary and appends a different NPC hint, not only Character',async()=>{
    const f=await fixture();assert.deepEqual(f.resolve(f.rows[7]).map(x=>x.id),['doryanihelmet','hooded-one']);
});
test('deduplicates all repeated paths and primary while preserving different related identities',async()=>{
    const f=await fixture(),row={...f.rows[4],metadata:{NPC:[f.ailith,f.ailithOther,f.hood,f.hood].join(',\n'),Character:'Metadata/Characters/Int/IntFour, Metadata/Characters/Int/IntFour'}};
    assert.deepEqual(f.resolve(row).map(x=>x.id),['ailith','witch','hooded-one']);
});
test('does not guess unresolved/ambiguous paths, lowercase hints, filters or invalid character identities',async()=>{
    const f=await fixture();
    for(const metadata of [{npc:f.ailith},{NPC:'metadata/NPC/League/Chayula/ChayulaFarmerHub'},{Character:'IntFour'},
        {Character:'Metadata/Characters/Dex/IntFour'},{Character:'Metadata/Characters/Int/constructor'},
        {'Character Filter':'Metadata/Characters/Int/IntFour','Character Class':'Metadata/Characters/Int/IntFour'}])
        assert.deepEqual(f.resolve(unit('Other','Unassigned',metadata)),[]);
    const ambiguous='Metadata/NPC/Ambiguous',a=unit('NPCs',ambiguous,{},'First'),b={...unit('NPCs',ambiguous,{},'Second'),id:'second'};
    const npcIndex=await NPC.buildNpcIndex([a,b]);
    assert.deepEqual(Portraits.createResolver({npcIndex,game:'poe2'})(unit('Other','ambiguous',{NPC:ambiguous})),[]);
});
test('game-specific mappings never reuse another game character path and provisional classes are explicit',async()=>{
    const f=await fixture(),resolve=Portraits.createResolver({...f,game:'poe1'});
    assert.deepEqual(resolve(f.rows[5]).map(x=>[x.id,x.name,x.game]),[['','Ailith','poe1']]);
    assert.equal(resolve(unit('Other','poe1',{NPC:f.ailith}))[0].id,'ailith');
    const marauder=f.resolve(unit('Other','Marauder',{Character:'Metadata/Characters/Str/StrFour'}));
    assert.equal(marauder[0].name,'Marauder');assert.equal(marauder[0].id,'marauder');assert.equal(marauder[0].provisional,true);
});

test('portrait URL carries only the canonical ID and no credentials or arbitrary path',()=>{
    global.CloudUI={apiBase:()=> 'https://api.test'};
    assert.equal(Portraits.portraitUrl('witch'),'https://api.test/portraits/poe2/witch.webp?v=4');
    for(const id of ['../witch','https://other/witch','Witch','witch?url=evil',''])assert.equal(Portraits.portraitUrl(id),'');
    delete global.CloudUI;
});
test('NPC-only partial exports resolve exact known Character paths without a Characters sheet',()=>{
    const resolve=Portraits.createResolver({game:'poe2'});
    for(const [attribute,form,name,id] of [['Str','StrFourb','Warrior','warrior'],['Int','IntFour','Witch','witch'],
        ['Int','IntFourb','Sorceress','sorceress'],['Dex','DexFour','Ranger','ranger'],['Dex','DexFourb','Huntress','huntress'],
        ['StrDex','StrDexFourb','Mercenary','mercenary'],['DexInt','DexIntFourb','Monk','monk'],['StrInt','StrIntFourb','Druid','druid']]){
        const items=resolve(unit('Other',form,{Character:`Metadata/Characters/${attribute}/${form}`}));
        assert.equal(items[0].name,name);assert.equal(items[0].id,id);
    }
    for(const [attribute,form] of [['Str','StrFour'],['StrDex','StrDexFour'],['DexInt','DexIntFour'],['StrInt','StrIntFour']])
        assert.equal(resolve(unit('Other',form,{Character:`Metadata/Characters/${attribute}/${form}`}))[0].provisional,true);
});

test('major dialogue NPCs use validated workbook groups without inventing aliases for unresolved characters',async()=>{
    const alva='Metadata/NPC/Four_Act3/AlvaZiggurat',alvaOther='Metadata/NPC/Four_Act4/AlvaKingsmarch',
        asala='Metadata/NPC/Four_Act2/MarakethMatriarch',raven='Metadata/NPC/League/Affliction/RavenBoy';
    const rows=[unit('NPCs',alva,{},'Alva'),unit('NPCs',alvaOther,{},'Alva'),unit('NPCs',asala,{},'Sekhema Asala'),
        unit('NPCs',raven,{},'The Raven'),unit('NPCs','Metadata/NPC/UnverifiedAlvaAlias',{},'Alva Valai')];
    const npcIndex=await NPC.buildNpcIndex(rows),resolve=Portraits.createResolver({npcIndex,game:'poe2'});
    const result=resolve(unit('Other','major',{NPC:[alva,alvaOther,asala,raven,'Metadata/NPC/UnverifiedAlvaAlias'].join(', ')}));
    assert.deepEqual(result.map(item=>[item.name,item.id]),[['Alva','alva'],['Sekhema Asala','asala'],['The Raven','ravenboy'],['Alva Valai','']]);
});

test('exact NPC forms preserve helmet/night variants and do not assign art to StrangeVoice or Squire',()=>{
    const resolve=Portraits.createResolver({game:'poe2'});
    const item=path=>resolve(unit('Other','exact',{NPC:path}));
    assert.equal(item('Metadata/NPC/Four_Act3/DoryaniEndgameTown')[0].id,'doryanihelmet');
    assert.equal(item('Metadata/NPC/Four_Act1/HoodedMentor')[0].id,'hooded-one-night');
    assert.equal(item('Metadata/NPC/Four_Act4/HoodedMentorKingsmarchIntro')[0].id,'hooded-one');
    assert.equal(item('Metadata/NPC/League/Affliction/RavenBoy')[0].id,'ravenboy');
    assert.deepEqual(item('Metadata/NPC/League/Affliction/StrangeVoice'),[]);
    for(const suffix of ['01','02','03'])assert.deepEqual(item('Metadata/Pet/LoyalCompanion/LoyalCompanion'+suffix),[]);
    const key=JSON.stringify(['name','the raven']),group={key,label:'The Raven',paths:['Metadata/NPC/League/Affliction/RavenBoy','Metadata/NPC/League/Affliction/StrangeVoice']};
    const npcIndex={groups:[group],groupByKey:new Map([[key,group]]),memberships:new Map()};
    const contextual=Portraits.createResolver({npcIndex,convoIndex:{memberships:new Map([['family',{parentKey:key}]])},game:'poe2'});
    assert.equal(contextual({id:'family',metadata:{NPC:''}})[0].id,'','a name group with an unassigned form cannot choose boy art');
    assert.equal(contextual({id:'family',metadata:{NPC:group.paths[0]}})[0].id,'ravenboy');
    assert.equal(contextual({id:'family',metadata:{NPC:group.paths[1]}})[0].id,'');
});

test('identifier catalog contains no image payloads or external image locations',()=>{
    const text=require('node:fs').readFileSync(require.resolve('../public/clientTextPortraitCatalog.js'),'utf8');
    assert.doesNotMatch(text,/data:|base64|https?:\/\//i);
    assert.equal(Object.keys(require('../public/clientTextPortraitCatalog.js').games.poe2.characters).length,12);
});
