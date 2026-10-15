const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const N=require('../public/clientTextNpcIndex.js');

function unit(sheet,recordId,options={}) {
    const role=options.role || 'normal';
    return {id:JSON.stringify([role,sheet,recordId]),role,sheet,recordId,
        fields:options.fields || [{name:'Text',source:'Original English',target:'Original translation'}],
        metadata:options.metadata || {},developerNotes:'Preserved note'};
}
function npc(recordId,name,shortName='',options={}) {
    return unit('NPCs',recordId,{...options,fields:[{name:'Name',source:name,target:'Translated name'},
        {name:'Short Name',source:shortName,target:'Translated short name'}]});
}
function group(index,label) {return index.groups.find(row=>row.label===label);}
function labels(index,row) {return [...index.memberships.get(row.id).keys()].map(key=>index.groupByKey.get(key).label).sort();}
function freeze(value) {
    if(value && typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}
    return value;
}

test('browser export and sheet classification retain full normal/Gender identity',()=>{
    const context=vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/clientTextNpcIndex.js'),'utf8'),context);
    assert.equal(typeof context.ClientTextNpcIndex.buildNpcIndex,'function');
    for(const [sheet,kind] of Object.entries({NPCs:'names',NPCTalk:'topics',NPCTextAudio:'dialogue',NPCTalkDialogueTextAudio:'conversations'})) {
        assert.equal(N.kindFor(unit(sheet,'id')),kind);
        assert.equal(N.kindFor(unit(sheet+'_Gender','id',{role:'gender'})),kind);
        assert.equal(N.kindFor(unit(sheet+'_Gender_Gender','id')),null);
    }
    for(const sheet of ['Quest','QuestStates','ClientStrings','NotNPCs'])assert.equal(N.kindFor(unit(sheet,'Renly')),null);
    assert.equal(N.kindFor(null),null);
});

test('named variants and exact menu links cross bundle roles without mutating originals',async()=>{
    const originals=freeze([
        npc('Metadata/NPC/Four_Act1/Renly','Renly'),npc('Metadata/NPC/Four_Act4/RenlyKingsmarch',' Renly '),
        unit('NPCTalk','Metadata/NPC/Four_Act4/RenlyKingsmarch::12'),
        unit('NPCTextAudio_Gender','RenlyIntro',{role:'gender'}),
        unit('NPCTalkDialogueTextAudio_Gender','RenlyP1_Intro_A2_Str4b',{role:'gender',metadata:{Character:'Metadata/Characters/Str/StrFourb'}}),
        unit('NPCTalk','Metadata/NPC/Four_Act1/OtherRenly::1'),unit('NPCTalk','Metadata/NPC/Four_Act1/Renly::not-a-number'),
        unit('Quest','RenlysTools'),unit('ClientStrings','Renly')
    ]),before=JSON.stringify(originals),index=await N.buildNpcIndex(originals),renly=group(index,'Renly');
    assert.equal(index.groups.length,1);assert.equal(renly.npcUnits.length,2);assert.equal(renly.units.length,5);
    assert.equal(index.units.length,7);assert.equal(index.unassigned.length,0);
    assert.deepEqual(renly.paths,['Metadata/NPC/Four_Act1/Renly','Metadata/NPC/Four_Act4/RenlyKingsmarch']);
    assert.deepEqual(index.memberships.get(originals[2].id).get(renly.key),{kind:'topics',aliases:[]});
    assert.deepEqual(index.memberships.get(originals[3].id).get(renly.key),{kind:'dialogue',aliases:['Renly']});
    assert.equal(index.memberships.get(originals[4].id).get(renly.key).kind,'conversations');
    assert.equal(index.memberships.get(originals[5].id).size,0);assert.equal(index.memberships.get(originals[6].id).size,0);
    assert.equal(renly.units[3],originals[3]);assert.equal(index.units[0],originals[0]);assert.equal(JSON.stringify(originals),before);
});

test('word boundaries find related responses while excluding free text and class-only matches',async()=>{
    const rows=[npc('Metadata/NPC/Una','Una'),npc('Metadata/NPC/Renly','Renly'),npc('Metadata/NPC/Delwyn','Delwyn'),
        unit('NPCTextAudio','RenlyIntro'),unit('NPCTalkDialogueTextAudio','HuntressDelwynIntroConvoA'),
        unit('NPCTextAudio','UnaRenly'),unit('NPCTextAudio','Unarmed'),unit('NPCTextAudio','Tribunal'),
        unit('NPCTextAudio','HuntressGreeting',{metadata:{'Character Class':'Metadata/Characters/Dex/Delwyn'},fields:[{name:'Text',source:'Una meets Renly and Delwyn',target:'Renly'}]})];
    const index=await N.buildNpcIndex(rows);
    assert.deepEqual(labels(index,rows[3]),['Renly']);assert.deepEqual(labels(index,rows[4]),['Delwyn']);
    assert.deepEqual(labels(index,rows[5]),['Renly','Una']);
    assert.deepEqual(index.unassigned,rows.slice(6));
});

test('explicit NPC paths own audio records before misleading related-name aliases',async()=>{
    const doryani='Metadata/NPC/Four_Act4/DoryaniTown',hood='Metadata/NPC/Four_Act4/HoodedMentor',una='Metadata/NPC/Four_Act1/Una';
    const rows=freeze([npc(doryani,'Doryani'),npc(hood,'The Hooded One'),npc(una,'Una'),npc('Metadata/NPC/Four_Act1/Renly','Renly'),
        unit('NPCTalkDialogueTextAudio','DoryaniA4_Intro_A_Sin',{metadata:{NPC:hood}}),
        unit('NPCTextAudio','UnaRenlySon',{metadata:{NPC:una}}),
        unit('NPCTextAudio','UnknownAssetName',{metadata:{NPC:doryani}})]),before=JSON.stringify(rows),index=await N.buildNpcIndex(rows);
    assert.deepEqual(labels(index,rows[4]),['The Hooded One']);assert.deepEqual(labels(index,rows[5]),['Una']);assert.deepEqual(labels(index,rows[6]),['Doryani']);
    assert.deepEqual(index.memberships.get(rows[4].id).get(group(index,'The Hooded One').key),{kind:'conversations',aliases:[],references:[hood]});
    assert.deepEqual(index.memberships.get(rows[5].id).get(group(index,'Una').key),{kind:'dialogue',aliases:[],references:[una]});
    assert.deepEqual(index.referenceEvidence.get(rows[4].id),{references:[hood],unresolved:[],ambiguous:[]});
    assert.equal(index.unassigned.length,0);assert.equal(index.units.length,rows.length);assert.equal(JSON.stringify(rows),before);
    assert.equal(index.units[4],rows[4]);assert.equal(group(index,'The Hooded One').units.at(-1),rows[4]);
});

test('explicit comma and newline NPC lists deduplicate paths and each group membership',async()=>{
    const renly1='Metadata/NPC/Four_Act1/Renly',renly4='Metadata/NPC/Four_Act4/Renly',una='Metadata/NPC/Four_Act1/Una';
    const rows=[npc(renly1,'Renly'),npc(renly4,' Renly '),npc(una,'Una'),unit('NPCTextAudio','UnrelatedID',{
        metadata:{NPC:' '+renly4+', '+renly1+', '+renly4+'\r\n'+una+', , '+una+'\n '}})];
    const index=await N.buildNpcIndex(rows),renly=group(index,'Renly'),entry=rows[3];
    assert.deepEqual(labels(index,entry),['Renly','Una']);assert.equal(index.memberships.get(entry.id).size,2);
    assert.deepEqual(index.memberships.get(entry.id).get(renly.key),{kind:'dialogue',aliases:[],references:[renly1,renly4]});
    assert.deepEqual(index.memberships.get(entry.id).get(group(index,'Una').key),{kind:'dialogue',aliases:[],references:[una]});
    assert.equal(renly.units.filter(row=>row===entry).length,1);assert.deepEqual(index.referenceEvidence.get(entry.id),{references:[renly1,una,renly4],unresolved:[],ambiguous:[]});
});

test('hint membership preserves complete roles and sheets when record IDs and referenced paths repeat',async()=>{
    const npcPath='Metadata/NPC/Guide',rows=[npc(npcPath,'Guide'),unit('NPCs_Gender',npcPath,{role:'gender',fields:[{name:'Name',source:'Guide',target:'Guide translated'}]}),
        ...['NPCTextAudio','NPCTalkDialogueTextAudio'].flatMap(sheet=>[
            unit(sheet,'RepeatedID',{metadata:{NPC:npcPath}}),unit(sheet+'_Gender','RepeatedID',{role:'gender',metadata:{NPC:npcPath}})])];
    const originalIDs=rows.map(row=>row.id),index=await N.buildNpcIndex([...rows,rows[2]]),guide=group(index,'Guide');
    assert.equal(index.units.length,6);assert.equal(guide.npcUnits.length,2);assert.equal(guide.units.length,6);
    assert.deepEqual(index.units.map(row=>row.id),originalIDs);assert.equal(new Set(guide.units.map(row=>row.id)).size,6);
    for(const entry of rows.slice(2)) {
        assert.equal(guide.units.includes(entry),true);assert.equal(index.memberships.get(entry.id).size,1);
        assert.deepEqual(index.memberships.get(entry.id).get(guide.key),{kind:entry.sheet.startsWith('NPCTalkDialogue')?'conversations':'dialogue',aliases:[],references:[npcPath]});
    }
});

test('exact NPC hints resolve Monster and generic Info identities without using shared labels',async()=>{
    const monster='Metadata/Monsters/Masters/Einhar',tablet1='Metadata/NPC/Info/First/Tablet',tablet2='Metadata/NPC/Info/Second/Tablet';
    const rows=[npc(monster,'Einhar'),npc(tablet1,'Inscription'),npc(tablet2,'Inscription'),
        unit('NPCTextAudio','InscriptionText',{metadata:{NPC:tablet2}}),unit('NPCTalkDialogueTextAudio','Unknown_A1',{metadata:{NPC:monster}})];
    const index=await N.buildNpcIndex(rows);
    assert.deepEqual(labels(index,rows[3]),['Inscription — Second/Tablet']);assert.deepEqual(labels(index,rows[4]),['Einhar']);
    assert.deepEqual(index.memberships.get(rows[3].id).get(group(index,'Inscription — Second/Tablet').key),{kind:'dialogue',aliases:[],references:[tablet2]});
    assert.equal(group(index,'Inscription — First/Tablet').units.length,1);
});

test('nonblank unresolved and ambiguous NPC hints stay unassigned without alias or terminal fallback',async()=>{
    const valid='Metadata/NPC/Renly',ambiguous='Metadata/NPC/SharedPath',missing='Metadata/NPC/Missing';
    const rows=[npc(valid,'Renly'),npc(ambiguous,'First NPC'),npc(ambiguous,'Second NPC','',{role:'gender'}),
        unit('NPCTextAudio','RenlyMissing',{metadata:{NPC:missing}}),unit('NPCTextAudio','RenlyAmbiguous',{metadata:{NPC:ambiguous}}),
        unit('NPCTextAudio','RenlyCaseMismatch',{metadata:{NPC:'metadata/NPC/Renly'}}),unit('NPCTextAudio','RenlyTerminalOnly',{metadata:{NPC:'Renly'}}),
        unit('NPCTalkDialogueTextAudio','RenlyMixed_A1',{metadata:{NPC:missing+', '+valid+', '+ambiguous}})];
    const index=await N.buildNpcIndex(rows);
    assert.deepEqual(index.unassigned,rows.slice(3,7));for(const entry of rows.slice(3,7))assert.equal(index.memberships.get(entry.id).size,0);
    assert.deepEqual(index.referenceEvidence.get(rows[3].id),{references:[missing],unresolved:[missing],ambiguous:[]});
    assert.deepEqual(index.referenceEvidence.get(rows[4].id),{references:[ambiguous],unresolved:[],ambiguous:[ambiguous]});
    assert.deepEqual(labels(index,rows[7]),['Renly'],'An independent unique reference survives other missing or ambiguous references');
    assert.deepEqual(index.memberships.get(rows[7].id).get(group(index,'Renly').key),{kind:'conversations',aliases:[],references:[valid]});
    assert.deepEqual(index.referenceEvidence.get(rows[7].id),{references:[missing,valid,ambiguous],unresolved:[missing],ambiguous:[ambiguous]});
});

test('only absent NPC columns use ID fallback while blank hints and Character or class paths never imply ownership',async()=>{
    const path='Metadata/NPC/Renly',character='Metadata/Characters/Dex/DexFour';
    const rows=[npc(path,'Renly'),npc('Metadata/NPC/DexFour','DexFour'),
        unit('NPCTextAudio','RenlyAbsent',{metadata:{Character:character,'Character Class':'Metadata/Characters/Renly'}}),
        unit('NPCTextAudio','RenlyBlank',{metadata:{NPC:' \r\n ',Character:character}}),
        unit('NPCTextAudio','RenlyEmpty',{metadata:{NPC:'',Character:character}}),
        unit('NPCTextAudio','UnrelatedCharacterOnly',{metadata:{Character:'Metadata/Characters/Renly','Character Class':'Metadata/Characters/DexFour'}}),
        unit('NPCTextAudio','RenlyInvalidNPCPath',{metadata:{NPC:character,Character:path,'Character Class':path}})];
    const index=await N.buildNpcIndex(rows),renly=group(index,'Renly');
    assert.deepEqual(labels(index,rows[2]),['Renly']);assert.deepEqual(index.memberships.get(rows[2].id).get(renly.key),{kind:'dialogue',aliases:['Renly']});
    assert.equal(index.referenceEvidence.has(rows[2].id),false,'A workbook without NPC hints retains evidence from the immutable audio ID');
    for(const entry of rows.slice(3,5)) {
        assert.equal(index.memberships.get(entry.id).size,0,'A blank explicit NPC cell does not assign a player line by conversation owner');
        assert.deepEqual(index.referenceEvidence.get(entry.id),{references:[],unresolved:[],ambiguous:[]});
    }
    assert.deepEqual(index.unassigned,rows.slice(3));assert.equal(group(index,'DexFour').units.length,1);
});

test('source aliases use articles, short names, metadata leaves, Unicode and numeric boundaries',async()=>{
    const rows=[npc('Metadata/NPC/HoodedMentor','The Hooded One'),npc('Metadata/Monsters/Masters/Einhar','Einhar, Beastmaster','Einhar'),
        npc('Metadata/NPC/FullWidth','Ｒｅｎｌｙ'),npc('Metadata/NPC/Numbered2','Numbered 2'),
        unit('NPCTextAudio','HoodedOneA2Intro'),unit('NPCTalkDialogueTextAudio','HoodedMentorEG_Asleep_A1'),
        unit('NPCTextAudio','EinharGreeting'),unit('NPCTextAudio','RenlyP1Intro'),unit('NPCTextAudio','Numbered2Greeting')];
    const index=await N.buildNpcIndex(rows);
    assert.deepEqual(labels(index,rows[4]),['The Hooded One']);assert.deepEqual(labels(index,rows[5]),['The Hooded One']);
    assert.deepEqual(labels(index,rows[6]),['Einhar, Beastmaster']);assert.deepEqual(labels(index,rows[7]),['Renly']);
    assert.deepEqual(labels(index,rows[8]),['Numbered 2']);
    const hood=group(index,'The Hooded One');
    assert.deepEqual(index.memberships.get(rows[4].id).get(hood.key).aliases,['Hooded One']);
    assert.deepEqual(index.memberships.get(rows[5].id).get(hood.key).aliases,['HoodedMentor']);
});

test('generic information rows and blank names retain separate metadata-path groups',async()=>{
    const rows=[npc('Metadata/NPC/Info/RigwaldGlyph1','Inscription'),npc('Metadata/NPC/Info/RigwaldGlyph2','Inscription'),
        npc('Metadata/NPC/UnknownOne','','Unknown'),npc('Metadata/NPC/UnknownTwo','','Unknown'),
        unit('NPCTalk','Metadata/NPC/Info/RigwaldGlyph1::0'),unit('NPCTextAudio','RigwaldGlyph1Text'),
        unit('NPCTextAudio','InscriptionText'),unit('NPCTextAudio','UnknownGreeting')];
    const index=await N.buildNpcIndex(rows);
    assert.equal(index.groups.length,4);assert.equal(new Set(index.groups.map(row=>row.key)).size,4);
    assert.deepEqual(index.groups.filter(row=>row.label.startsWith('Inscription — ')).map(row=>row.paths),[
        ['Metadata/NPC/Info/RigwaldGlyph1'],['Metadata/NPC/Info/RigwaldGlyph2']]);
    assert.deepEqual(index.groups.map(row=>row.label),['Inscription — RigwaldGlyph1','Inscription — RigwaldGlyph2',
        'Unknown — UnknownOne','Unknown — UnknownTwo']);
    assert.equal(index.memberships.get(rows[4].id).size,1);assert.equal(index.memberships.get(rows[5].id).size,1);
    assert.deepEqual(index.unassigned,[rows[6],rows[7]]);
});

test('repeated path terminals use a longer distinguishing label suffix without changing identities',async()=>{
    const rows=[npc('Metadata/NPC/Info/First/Tablet','Inscription'),npc('Metadata/NPC/Info/Second/Tablet','Inscription'),
        unit('NPCTalk','Metadata/NPC/Info/Second/Tablet::0')];
    const index=await N.buildNpcIndex(rows),reverse=await N.buildNpcIndex([...rows].reverse());
    assert.deepEqual(index.groups.map(row=>row.label),['Inscription — First/Tablet','Inscription — Second/Tablet']);
    assert.deepEqual(index.groups.map(row=>row.label),reverse.groups.map(row=>row.label));
    assert.deepEqual(index.groups.map(row=>row.key),[
        JSON.stringify(['path','Metadata/NPC/Info/First/Tablet']),JSON.stringify(['path','Metadata/NPC/Info/Second/Tablet'])]);
    assert.deepEqual(labels(index,rows[2]),['Inscription — Second/Tablet']);
});

test('an unnamed NPC uses a unique immutable Short Name alias while its group stays path keyed',async()=>{
    const rows=[npc('Metadata/NPC/UnknownGuide','','Elusive Guide'),
        npc('Metadata/NPC/Info/AncientTablet','Inscription','Elusive Guide'),
        unit('NPCTextAudio','ElusiveGuideGreeting'),unit('NPCTextAudio','InscriptionGreeting')];
    const index=await N.buildNpcIndex(rows),guide=group(index,'Elusive Guide');
    assert.equal(guide.key,JSON.stringify(['path','Metadata/NPC/UnknownGuide']));
    assert.deepEqual(labels(index,rows[2]),['Elusive Guide']);
    assert.deepEqual(index.memberships.get(rows[2].id).get(guide.key),{kind:'dialogue',aliases:['Elusive Guide']});
    assert.deepEqual(index.unassigned,[rows[3]],'generic Info names and short names provide no aliases');
    assert.equal(index.groups.length,2,'a shared short label never merges metadata-path groups');
});

test('alias collisions stay unassigned and a longer ambiguous match never falls back',async()=>{
    const rows=[npc('Metadata/NPC/AlvaOne','Alva'),npc('Metadata/NPC/AlvaTwo','Alva, Master Explorer','Alva'),
        npc('Metadata/NPC/Hooded','Hooded'),npc('Metadata/NPC/HoodedOne','First Mentor','Hooded One'),
        npc('Metadata/NPC/HoodedOther','Second Mentor','Hooded One'),npc('Metadata/NPC/Una','Una'),
        unit('NPCTextAudio','AlvaGreeting'),unit('NPCTextAudio','HoodedOneIntro'),unit('NPCTextAudio','AlvaUnaGreeting')];
    const index=await N.buildNpcIndex(rows);
    assert.deepEqual(index.unassigned,[rows[6],rows[7]]);
    assert.deepEqual(labels(index,rows[8]),['Una']);
    assert.equal(index.memberships.get(rows[7].id).size,0,'ambiguous Hooded One does not fall back to unique Hooded');
    assert.equal(index.groups.length,6,'shared aliases never merge English-name groups');
});

test('longest unique names override shorter overlaps and equal competing spans are unassigned',async()=>{
    const rows=[npc('Metadata/NPC/Short','Zana'),npc('Metadata/NPC/Long','Zana Caeserius'),
        npc('Metadata/NPC/Left','Alpha Beta'),npc('Metadata/NPC/Right','Beta Gamma'),
        unit('NPCTextAudio','ZanaCaeseriusIntro'),unit('NPCTextAudio','AlphaBetaGammaGreeting')];
    const index=await N.buildNpcIndex(rows);
    assert.deepEqual(labels(index,rows[4]),['Zana Caeserius']);assert.deepEqual(index.unassigned,[rows[5]]);
});

test('shared record IDs across sheets stay distinct and output ordering is stable',async()=>{
    const rows=[npc('Metadata/NPC/Zarka','Zarka'),npc('Metadata/NPC/Renly','Renly'),npc('Metadata/NPC/Una','Una'),
        unit('NPCTextAudio','RenlyIntro'),unit('NPCTalkDialogueTextAudio','RenlyIntro'),
        unit('NPCTextAudio_Gender','RenlyIntro',{role:'gender'})];
    const index=await N.buildNpcIndex([...rows,rows[3]]),reverse=await N.buildNpcIndex([...rows].reverse());
    assert.deepEqual(index.groups.map(row=>row.label),['Renly','Una','Zarka']);
    assert.deepEqual(index.groups.map(row=>row.key),reverse.groups.map(row=>row.key));
    assert.equal(index.units.length,6);assert.equal(group(index,'Renly').units.length,4);
    assert.equal(new Set(group(index,'Renly').units.map(row=>row.id)).size,4);
    assert.equal(index.groupByKey.get(index.groups[0].key),index.groups[0]);
});

test('cooperative preparation rejects aborted or obsolete contexts without publishing partial results',async()=>{
    const rows=[npc('Metadata/NPC/Renly','Renly'),...Array.from({length:1800},(_,i)=>unit('NPCTextAudio','RenlyIntro_'+i))];
    let current=true,yields=0;
    await assert.rejects(N.buildNpcIndex(rows,{guard:()=>current,yield:async()=>{yields++;current=false;}}),error=>error.name==='AbortError' && error.stale===true);
    assert.equal(yields,1);
    const controller=new AbortController();controller.abort();
    await assert.rejects(N.buildNpcIndex(rows,{signal:controller.signal}),error=>error.name==='AbortError');
    const during=new AbortController();
    await assert.rejects(N.buildNpcIndex(rows,{signal:during.signal,yield:async()=>during.abort()}),error=>error.name==='AbortError');
    let passes=0,clock=0;const index=await N.buildNpcIndex(rows,{yield:async()=>{passes++;},now:()=>clock+=8});
    assert.ok(passes>1);assert.equal(index.units.length,rows.length);assert.equal(index.unassigned.length,0);
    await assert.rejects(N.buildNpcIndex(rows,{guard:()=>false}),error=>error.stale===true);
});

test('fast batches do not pay repeated timer yields before the CPU budget elapses',async()=>{
    const rows=[npc('Metadata/NPC/Renly','Renly'),...Array.from({length:1800},(_,i)=>unit('NPCTextAudio','RenlyIntro_'+i))];
    let pauses=0;
    const index=await N.buildNpcIndex(rows,{now:()=>0,yield:async()=>{pauses++;}});
    assert.equal(pauses,1,'one initial yield is sufficient while work remains within its time budget');
    assert.equal(index.units.length,rows.length);
    let clock=0,budgetPauses=0;
    await N.buildNpcIndex(rows,{now:()=>clock,yield:async()=>{budgetPauses++;},guard:()=>{clock+=1;return true;}});
    assert.ok(budgetPauses>1,'elapsed CPU budget yields even when row batches are otherwise fast');
});
