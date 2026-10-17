const {test} = require('node:test');
const assert = require('node:assert/strict');
const Context = require('../public/clientTextMtlContext.js');
const S = require('../public/clientTextState.js');
const N = require('../public/clientTextNpcIndex.js');
const C = require('../public/clientTextConvoIndex.js');
const {fixture: storageFixture, scope: storageScope, asset: storageAsset, unit: storedUnit} = require('./clienttext-storage-fixture.cjs');
let nextWorksheetRow = 2;
function unit(recordId, sheet = 'ClientStrings', source = 'A [Spark|spark] for a Scout') {
    const row = nextWorksheetRow++;
    return { id: JSON.stringify(['normal', sheet, recordId]), recordId, sheet, role: 'normal', metadata: {}, developerNotes: '',
        fields: [{ id: 'text', name: 'Text', kind: 'text', source, target: 'UNSENT TARGET', sourceCell:'B'+row, targetCell:'C'+row }] };
}
test('context includes exact immutable references and labels speaker evidence precisely', () => {
    const selected = unit('Line'), actor = unit('Data/Actors/Scout', 'Characters', 'Scout'), keyword = unit('Spark', 'KeywordPopups', 'A small flash.');
    selected.metadata = { Speaker: 'Data/Actors/Scout', 'Character Filter': 'ListenerOnly', NPC: 'Data/NPC/Missing' };
    selected.developerNotes = 'Short and direct.';
    const built = Context.create({ unit: selected, field: selected.fields[0], units: [selected, actor, keyword], scope: {game: 'poe2'} });
    assert.equal(built.initial.source, undefined, 'The request carries raw source once, outside optional context.');
    assert.equal(built.initial.metadata.find(row => row.name === 'Speaker').evidence, 'explicit-speaker');
    assert.equal(built.initial.metadata.find(row => row.name === 'Character Filter').evidence, 'listener-constraint');
    assert.equal(built.initial.references[0].recordId, actor.recordId);
    assert.equal(built.initial.keywords[0].recordId, 'Spark');
    assert.ok(built.initial.unavailable.some(row => row.reason === 'reference-not-loaded'));
    assert.ok(!JSON.stringify(built.initial).includes('UNSENT TARGET'));
    assert.equal(built.contextHash, S.hash(built.initial));
});
test('NPC/conversation groups never establish a speaker', () => {
    const selected = unit('Line'), actor = unit('Data/Actors/Scout', 'NPCs', 'Scout');
    const npcIndex = { memberships: new Map([[selected.id, new Map([['scout', {kind: 'dialogue', aliases: ['Scout']} ]])]]),
        groupByKey: new Map([['scout', {npcUnits: [actor]}]]) };
    const convoIndex = { memberships: new Map([[selected.id, {familyKey: 'family1', ambiguous: true}]]) };
    const result = Context.build({ unit: selected, field: selected.fields[0], units: [selected, actor], npcIndex, convoIndex });
    assert.equal(result.references[0].speakerEstablished, false);
    assert.equal(result.metadata[0].speakerEstablished, false);
    assert.equal(result.metadata[0].ambiguous, true);
});
test('committed glossary uses matching main pairs and current-game shadowing', () => {
    const selected = unit('Line');
    const dictionary = [
        {_id:'all', find:'Scout', replace:'all-target', gameScope:'all'},
        {_id:'poe2', find:'Scout', replace:'current-target', gameScope:'poe2', alts:[{find:'Spark',replace:'unsent-alternate'}]},
        {_id:'poe1', find:'Spark', replace:'wrong-game', gameScope:'poe1'},
        {_id:'disabled', find:'spark', replace:'disabled-target', disabled:true},
        {_id:'unmatched', find:'Nothing', replace:'unmatched-target'},
        {_id:'blank', find:'A', replace:''}
    ];
    const result = Context.build({unit:selected,field:selected.fields[0],units:[selected],dictionary,scope:{game:'poe2'}});
    assert.deepEqual(result.glossary.map(row=>row.id), ['poe2']);
    assert.equal(result.glossary[0].translation, 'current-target');
    assert.ok(!JSON.stringify(result).includes('unsent-alternate'));
});
test('lookups are exact, bounded to two, read only and contained in loaded workbook', () => {
    const selected=unit('Line'), related=unit('Other','Characters','Related English');
    const before=structuredClone([selected,related]),context=Context.create({unit:selected,field:selected.fields[0],units:[selected,related]});
    assert.equal(context.lookup({recordId:'Other',sheet:'Characters'}).results[0].fields[0].source,'Related English');
    assert.equal(context.lookup({recordId:'Missing'}).unavailable,true);
    assert.throws(()=>context.lookup({recordId:'Other'}),/lookup limit/);
    assert.deepEqual([selected,related],before);
    const other=Context.create({unit:selected,field:selected.fields[0],units:[selected]});
    assert.throws(()=>other.lookup({recordId:'Line',url:'https://example.invalid'}),/Invalid workbook/);
    assert.equal(other.lookupsUsed,1);
});
test('missing or ambiguous optional sheets reduce context without inventing records', () => {
    const selected=unit('Line'),one=unit('Ref','Characters'),two=unit('Ref','Other'); selected.metadata={RelatedCharacter:'Ref'};
    const result=Context.build({unit:selected,field:selected.fields[0],units:[selected,one,two]});
    assert.equal(result.references.length,0);
    assert.ok(result.unavailable.some(row=>row.reason==='ambiguous-workbook-reference'));
    assert.ok(result.unavailable.some(row=>row.type==='NPC context'));
});
test('source is never truncated; optional context has a shared character budget', () => {
    const selected=unit('Line','ClientStrings','English'); selected.developerNotes='n'.repeat(1000);
    const context=Context.create({unit:selected,field:selected.fields[0],units:[selected],contextLimit:100});
    assert.deepEqual(context.initial.notes,[]);
    assert.ok(context.remainingCharacters>=0);
    selected.fields[0].source='s'.repeat(Context.LIMITS.source+1);
    assert.throws(()=>Context.create({unit:selected,field:selected.fields[0],units:[selected]}),/source exceeds/);
    selected.fields[0].source='[NOAUDIO]';
    assert.throws(()=>Context.build({unit:selected,field:selected.fields[0],units:[selected]}),/eligible field/);
});
test('skill context includes only resolver references belonging to this loaded workbook', () => {
    const selected=unit('Line'),related=unit('Skill','ActiveSkills','Description'),other=unit('External','ActiveSkills','NOT LOADED');
    const resolver={candidates:()=>['skill1'],referencedUnits:()=>[related,other]};
    const result=Context.build({unit:selected,field:selected.fields[0],units:[selected,related],skillResolver:resolver});
    assert.deepEqual(result.references.map(row=>row.recordId),['Skill']);
    assert.ok(!JSON.stringify(result).includes('NOT LOADED'));
});
test('the initial context budget counts fixed identities and rules as well as optional text',()=>{
    const selected=unit('Line');selected.metadata=Object.fromEntries(Array.from({length:32},(_,i)=>['Reference '+i,'x'.repeat(900)]));
    const result=Context.build({unit:selected,field:selected.fields[0],units:[selected]});
    const characters=value=>typeof value==='string'?value.length:Array.isArray(value)?value.reduce((sum,item)=>sum+characters(item),0)
        :value&&typeof value==='object'?Object.entries(value).reduce((sum,[key,item])=>sum+key.length+characters(item),0):0;
    assert.ok(characters(result)<=16000);assert.equal(result.source,undefined);
});

function conversation(recordId, source = recordId) { return unit(recordId, 'NPCTalkDialogueTextAudio', source); }
function atRow(value, row) {
    for (const field of value.fields) { field.sourceCell='B'+row; field.targetCell='C'+row; }
    return value;
}
function npc(path, name) { const value=unit(path,'NPCs',name);value.fields[0].name='Name';return value; }
function familyIndex(rows, key = 'known-family') {
    return { memberships: new Map(rows.map(row => [row.id, {familyKey:key}])) };
}
function build(selected, rows, options = {}) {
    return Context.build({unit:selected,field:selected.fields[0],units:rows,...options});
}
const ids = result => result.surrounding.entries.map(row => row.recordId);
function freeze(value) {
    if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
    return value;
}
function valueCount(value) {
    return 1 + (Array.isArray(value) ? value.reduce((sum, item) => sum + valueCount(item), 0)
        : value && typeof value === 'object' ? Object.values(value).reduce((sum, item) => sum + valueCount(item), 0) : 0);
}

test('known conversation chooses its own loaded rows in workbook order, including untranslated turns', async () => {
    const actor=unit('Metadata/NPC/Scout','NPCs','Scout'), a=conversation('Scout_Intro_A'), b=conversation('Scout_Intro_B'),
        c=conversation('Scout_Intro_C'), unrelated=conversation('Scout_Other_A'), otherNpc=conversation('Guard_Intro_A');
    for (const row of [a,b,c]) row.fields[0].target='';
    const rows=freeze([actor,a,unrelated,b,otherNpc,c]), before=JSON.stringify(rows), npcIndex=await N.buildNpcIndex(rows,{yield:async()=>{}}),
        convoIndex=await C.buildConvoIndex(rows,npcIndex,{yield:async()=>{}}), result=build(b,rows,{npcIndex,convoIndex});
    assert.deepEqual(ids(result),[a.recordId,c.recordId]);
    assert.equal(result.surrounding.mode,'conversation-family');
    assert.equal(result.surrounding.familyKey,'Scout_Intro');
    assert.equal(result.surrounding.availableEntries,2);
    assert.deepEqual(result.surrounding.entries.map(row=>row.position),['before','after']);
    assert.equal(result.surrounding.truncated,false);
    assert.equal(result.surrounding.entries[0].fields[0].source,a.fields[0].source);
    assert.equal(result.surrounding.entries[0].fields[0].translation,undefined);
    assert.equal(JSON.stringify(rows),before);
});

test('nearest 50 conversation neighbors exclude the target and keep original order', () => {
    const rows=Array.from({length:81},(_,i)=>conversation('Line'+i,'x')), selected=rows[40];
    for(const row of rows)row.fields[0].target='';
    const result=build(selected,rows,{convoIndex:familyIndex(rows)});
    assert.equal(result.surrounding.entries.length,50);
    assert.deepEqual(ids(result),rows.slice(15,66).filter(row=>row!==selected).map(row=>row.recordId));
    assert.deepEqual(result.surrounding.omitted,{entryLimit:30,contextBudget:0,untranslated:0,fieldLimit:0,worksheetCoordinates:0});
    assert.equal(result.surrounding.truncated,true);
    assert.equal(new Set(result.surrounding.entries.map(row=>row.unitId)).size,50);
});

test('size pressure selects closest preceding turn on ties and omits whole source fields', () => {
    const rows=Array.from({length:7},(_,i)=>conversation('Line'+i,String(i).repeat(600))), selected=rows[3];
    const result=build(selected,rows,{convoIndex:familyIndex(rows),contextLimit:2100});
    assert.deepEqual(ids(result),['Line2']);
    assert.equal(result.surrounding.entries[0].fields[0].source,rows[2].fields[0].source);
    assert.equal(result.surrounding.omitted.contextBudget,5);
    assert.ok(JSON.stringify(result).length<=2100);
});

test('a singleton conversation uses verified explicit NPC relationships in its own worksheet', async () => {
    const actor=npc('Metadata/NPC/Scout','Scout'), selected=atRow(conversation('Only_A'),10), before=atRow(conversation('Before_A'),9), after=atRow(conversation('Next_A'),11),
        relatedOnly=conversation('NPCNameInIdentifier_A'), wrongNpc=conversation('Other_A'), multiple=conversation('Multiple_A'),
        nondialogue=unit('Menu','NPCTalk'), wrongRole=conversation('Gender_A'), otherSheet=unit('CrossSheet','NPCTextAudio');
    selected.metadata={NPC:'Metadata/NPC/Scout'};before.metadata={NPC:'Metadata/NPC/Scout'};
    after.metadata={Speaker:'Metadata/NPC/Scout'};relatedOnly.metadata={RelatedCharacter:'Metadata/NPC/Scout','Character Filter':'Metadata/NPC/Scout'};
    wrongNpc.metadata={NPC:'Metadata/NPC/Other'};multiple.metadata={NPC:'Metadata/NPC/Scout,Metadata/NPC/Other'};
    nondialogue.metadata={NPC:'Metadata/NPC/Scout'};wrongRole.metadata={NPC:'Metadata/NPC/Scout'};wrongRole.role='gender';
    otherSheet.metadata={NPC:'Metadata/NPC/Scout'};
    const rows=[actor,before,relatedOnly,selected,wrongNpc,after,multiple,nondialogue,wrongRole,otherSheet],
        npcIndex=await N.buildNpcIndex(rows,{yield:async()=>{}}), result=build(selected,rows,{npcIndex,convoIndex:familyIndex([selected])});
    assert.deepEqual(ids(result),['Before_A','Next_A']);
    assert.equal(result.surrounding.mode,'same-explicit-npc');
    assert.equal(result.surrounding.reason,'singleton-conversation');
    assert.equal(result.surrounding.npc.reference,'Metadata/NPC/Scout');
    assert.equal(result.surrounding.npc.speakerEstablished,false);
    assert.equal(result.surrounding.entries[0].npc.speakerEstablished,false);
    assert.equal(result.surrounding.entries[1].npc.speakerEstablished,true);
});

test('singleton families never broaden to sheet adjacency or inferred NPCs', () => {
    const selected=conversation('Scout_Only_A'), other=conversation('Scout_Other_A');
    selected.metadata={'Character Filter':'Metadata/NPC/Scout',RelatedCharacter:'Metadata/NPC/Scout',Character:'Metadata/NPC/Scout'};
    other.metadata={NPC:'Metadata/NPC/Scout'};
    const npcIndex={memberships:new Map([[selected.id,new Map([['scout',{aliases:['Scout']} ]])]]),groupByKey:new Map()};
    const result=build(selected,[other,selected],{npcIndex,convoIndex:familyIndex([selected])});
    assert.deepEqual(ids(result),[]);
    assert.equal(result.surrounding.reason,'singleton-without-verified-npc');
    assert.equal(result.surrounding.mode,'same-explicit-npc');
});

test('blank, contradictory or multi-NPC identity evidence cannot select a fallback', async () => {
    const selected=conversation('Only_A'), other=conversation('Other_A'), scout=npc('Metadata/NPC/Scout','Scout'), guard=npc('Metadata/NPC/Other','Guard');
    other.metadata={NPC:'Metadata/NPC/Scout'};
    const rows=[scout,guard,other,selected],npcIndex=await N.buildNpcIndex(rows,{yield:async()=>{}});
    for (const metadata of [{NPC:'Metadata/NPC/Scout',Speaker:''}, {NPC:'Metadata/NPC/Scout,Metadata/NPC/Other'},
        {Speaker:'Metadata/NPC/Scout','Speaking Character':'Metadata/NPC/Other'}]) {
        selected.metadata=metadata;
        assert.deepEqual(ids(build(selected,rows,{npcIndex,convoIndex:familyIndex([selected])})),[]);
    }
});

test('entries without known conversations use translated neighbors from the exact sheet and role', () => {
    const before=unit('Before'), selected=unit('Selected'), blank=unit('Blank'), after=unit('After'),
        wrongSheet=unit('WrongSheet','Characters'), wrongRole=unit('WrongRole'), audio=unit('Audio'), emptySource=unit('Empty');
    blank.fields[0].target=' ';wrongRole.role='gender';audio.fields[0].source='[NOAUDIO]';emptySource.fields[0].source='';
    before.fields[0].target='Existing before';after.fields[0].target='Existing after';selected.metadata={Context:'Selected'};
    const result=build(selected,[before,wrongSheet,selected,blank,wrongRole,audio,emptySource,after,after]);
    assert.equal(result.surrounding.mode,'same-sheet-translated');
    assert.equal(result.surrounding.reason,'no-known-conversation');
    assert.deepEqual(ids(result),['Before','After']);
    assert.equal(result.surrounding.omitted.untranslated,1);
    assert.equal(result.surrounding.entries[0].fields[0].translation,'Existing before');
    assert.equal(result.surrounding.entries[0].fields[0].translationOrigin,'original-workbook');
    assert.ok(!result.references.some(row=>row.unitId===selected.id));
});

test('same-sheet adjacency reaches translated neighbors beyond untranslated rows before applying the 50-entry cap', () => {
    const rows=Array.from({length:101},(_,i)=>unit('Line'+i,'ClientStrings','x')),selected=rows[50];
    for(let i=0;i<rows.length;i++)rows[i].fields[0].target=i>=30 && i<=70?'':'t';
    const result=build(selected,rows);
    assert.deepEqual(ids(result),[...rows.slice(5,30),...rows.slice(71,96)].map(row=>row.recordId));
    assert.equal(result.surrounding.omitted.untranslated,40);
    assert.equal(result.surrounding.omitted.entryLimit,10);
    assert.equal(result.surrounding.omitted.contextBudget,0);
});

test('same-sheet pairs use only scoped Saved or current original translations, never MTL review overlays or drafts', () => {
    const selected=unit('Selected'), original=unit('Original'), savedRow=unit('Saved'), blankSave=unit('BlankSave'),
        draftOnly=unit('DraftOnly'), stale=unit('Stale'), reviewed=unit('Reviewed'), conflicted=unit('Conflicted'), incomplete=unit('Incomplete');
    original.fields[0].target='Original pair';savedRow.fields[0].target='';draftOnly.fields[0].target='';
    stale.fields[0].outdated=true;reviewed.fields[0].outdated=true;incomplete.fields[0].originalMissing=true;
    const rows=freeze([original,savedRow,blankSave,draftOnly,selected,stale,reviewed,conflicted,incomplete]),
        saved=freeze({[savedRow.id]:{saved:true,values:{text:'Saved pair'}},[blankSave.id]:{saved:true,values:{text:''}},
            [stale.id]:{saved:true,values:{text:'Stale pair'},reviewed:{text:'old-source'}},
            [reviewed.id]:{saved:true,values:{text:'Reviewed pair'},reviewed:{text:S.sourceHash(reviewed.fields[0].source)}},
            [conflicted.id]:{saved:true,values:{text:'Conflict pair'},conflicts:[{fieldId:'text'}]}});
    for (const snapshot of [saved,new Map(Object.entries(saved))]) {
        const result=build(selected,rows,{saved:snapshot,drafts:{[draftOnly.id]:{values:{text:'DRAFT SECRET'}}},
            candidates:[{unitId:draftOnly.id,translation:'MTL SECRET'}],reviewBuffers:{[original.id]:'REVIEW SECRET'}});
        assert.deepEqual(ids(result),['Original','Saved','Reviewed']);
        assert.deepEqual(result.surrounding.entries.map(row=>row.fields[0].translation),['Original pair','Saved pair','Reviewed pair']);
        assert.deepEqual(result.surrounding.entries.map(row=>row.fields[0].translationOrigin),['original-workbook','saved','saved']);
        assert.ok(!JSON.stringify(result).includes('SECRET'));
    }
});

test('Saved-false state cannot promote a draft and an outdated original is not trusted context', () => {
    const selected=unit('Selected'), neighbor=unit('Neighbor');neighbor.fields[0].target='Original pair';
    const saved={[neighbor.id]:{saved:false,values:{text:'NOT SAVED'}}};
    assert.equal(build(selected,[neighbor,selected],{saved}).surrounding.entries[0].fields[0].translation,'Original pair');
    neighbor.fields[0].outdated=true;
    assert.deepEqual(ids(build(selected,[neighbor,selected],{saved})),[]);
});

test('known conversation keeps source when a neighbor translation is unreviewed or conflicted', () => {
    const selected=conversation('Selected_A'), neighbor=conversation('Neighbor_A');neighbor.fields[0].outdated=true;
    const result=build(selected,[neighbor,selected],{convoIndex:familyIndex([neighbor,selected]),
        saved:{[neighbor.id]:{saved:true,values:{text:'STALE SECRET'}}}});
    assert.deepEqual(ids(result),['Neighbor_A']);
    assert.equal(result.surrounding.entries[0].fields[0].translation,undefined);
    assert.ok(!JSON.stringify(result).includes('STALE SECRET'));
});

test('partial or missing indexes use only loaded rows and never introduce stale index source', () => {
    const selected=unit('Selected'), neighbor=unit('Neighbor'), external=unit('External','NPCs','NOT LOADED');
    const npcIndex={memberships:new Map([[selected.id,new Map([['npc',{kind:'dialogue'}]])]]),
        groupByKey:new Map([['npc',{npcUnits:[external]}]])};
    const result=build(selected,[null,{id:'broken'},neighbor,selected],{npcIndex,convoIndex:{memberships:new Map()}});
    assert.deepEqual(ids(result),['Neighbor']);
    assert.ok(!JSON.stringify(result).includes('NOT LOADED'));
    const empty=build(selected,[null,neighbor]);
    assert.equal(empty.surrounding.reason,'target-not-loaded');assert.deepEqual(ids(empty),[]);
});

test('same-sheet partial workbook handles absent translations and only sends paired fields', () => {
    const selected=unit('Selected'), neighbor=unit('Neighbor'), untranslated=unit('Untranslated');
    delete untranslated.fields[0].target;
    neighbor.fields.push({id:'empty',name:'Empty',kind:'text',source:'Untranslated source',target:''},
        {id:'gender',name:'Gender',kind:'gender',source:'English gender',target:'Gender target'},
        {id:'form',name:'Name',kind:'form',form:'StrFour',source:'Form source',target:'Form translation'});
    const result=build(selected,[untranslated,neighbor,selected]);
    assert.deepEqual(ids(result),['Neighbor']);
    assert.deepEqual(result.surrounding.entries[0].fields.map(row=>row.fieldId),['text','form']);
    assert.equal(result.surrounding.entries[0].fields[1].form,'StrFour');
    assert.equal(result.surrounding.omitted.untranslated,1);
});

test('surrounding rows and exact metadata references are deduplicated by full unit identity', () => {
    const before=conversation('Before_A'), selected=conversation('Selected_A'), after=conversation('After_A');
    selected.metadata={Context:'Before_A',Other:'Before_A',Self:'Selected_A'};
    const result=build(selected,[before,selected,after,before],{convoIndex:familyIndex([before,selected,after])});
    assert.deepEqual(ids(result),['Before_A','After_A']);assert.deepEqual(result.references,[]);
    const json=JSON.stringify(result), again=build(selected,[before,selected,after,before],{convoIndex:familyIndex([before,selected,after])});
    assert.equal(JSON.stringify(again),json);
});

test('field caps and server text, UTF-8 and structural budgets include selection provenance', () => {
    const rows=Array.from({length:65},(_,i)=>({id:'u'+i,recordId:String(i),sheet:'N',role:'n',metadata:{},fields:
        Array.from({length:9},(_,j)=>({id:String(j),name:'',kind:'text',source:'x',target:'',sourceCell:'B'+(i+2),targetCell:'C'+(i+2)}))})),selected=rows[32];
    const result=build(selected,rows,{convoIndex:familyIndex(rows)});
    assert.ok(result.surrounding.entries.length<50);
    assert.ok(result.surrounding.omitted.contextBudget>0);
    assert.equal(result.surrounding.omitted.fieldLimit,result.surrounding.entries.length);
    assert.ok(result.surrounding.entries.every(row=>row.fields.length===8));
    assert.ok(JSON.stringify(result).length<=Context.LIMITS.context);
    assert.ok(Buffer.byteLength(JSON.stringify(result))<=Context.LIMITS.contextBytes);
    assert.ok(valueCount(result)<=Context.LIMITS.contextEntries);
    assert.equal(result.surrounding.truncated,true);
    for(const row of rows)for(const field of row.fields)field.source='ก'.repeat(500);
    const unicode=build(selected,rows,{convoIndex:familyIndex(rows)});
    assert.ok(Buffer.byteLength(JSON.stringify(unicode))<=Context.LIMITS.contextBytes);
    assert.ok(JSON.stringify(unicode).length<=Context.LIMITS.context);
    assert.ok(valueCount(unicode)<=Context.LIMITS.contextEntries);
});

test('oversized nearby records are omitted whole while smaller applicable records still fit', () => {
    const before=conversation('Before_A','Short context'), selected=conversation('Selected_A','Target source'), huge=conversation('Huge_A','s'.repeat(20000));
    const result=build(selected,[before,selected,huge],{convoIndex:familyIndex([before,selected,huge])});
    assert.deepEqual(ids(result),['Before_A']);
    assert.equal(result.surrounding.omitted.contextBudget,1);
    assert.equal(result.surrounding.truncated,true);
    assert.equal(selected.fields[0].source,'Target source');
});

test('immutable worksheet coordinates preserve adjacency through an ID-sorted storage reload', async () => {
    for(const sheet of ['ClientStrings','NPCTalkDialogueTextAudio']) {
        const rows=['Z','A','M'].map((recordId,i)=>atRow({...storedUnit('English '+recordId,'Translation '+recordId),
            id:JSON.stringify(['normal',sheet,recordId]),sheet,recordId},i+2)), originalSelected=rows[1],f=storageFixture();
        await f.store.import(storageScope,{units:rows,assets:[storageAsset]});
        const loaded=await f.store.getUnits(storageScope),selected=loaded.find(row=>row.recordId==='A');
        assert.deepEqual(loaded.map(row=>row.recordId),['A','M','Z'],'the fixture reproduces IndexedDB primary-key ordering');
        const options=sheet==='NPCTalkDialogueTextAudio'?{convoIndex:familyIndex(loaded)}:{},
            before=build(originalSelected,rows,options),after=build(selected,loaded,options);
        assert.deepEqual(ids(after),['Z','M']);
        assert.deepEqual(after.surrounding.entries.map(row=>[row.worksheetRow,row.position]),[[2,'before'],[4,'after']]);
        assert.equal(after.surrounding.orderEvidence,'immutable-worksheet-coordinates');
        assert.equal(after.surrounding.outputOrder,'worksheet-row');
        assert.deepEqual(after,before);
    }
});

test('worksheet row distance determines proximity independently of array and ID order', () => {
    const before=atRow(conversation('Z','b'.repeat(600)),9),selected=atRow(conversation('A','target'),10),
        farther=atRow(conversation('M','m'.repeat(600)),40),rows=[farther,selected,before];
    const result=build(selected,rows,{convoIndex:familyIndex(rows),contextLimit:2100});
    assert.deepEqual(ids(result),['Z']);
    assert.equal(result.surrounding.entries[0].position,'before');
    assert.equal(result.surrounding.omitted.contextBudget,1);
});

test('missing, inconsistent or overlapping worksheet coordinates are omitted without fabricated positions', () => {
    const selected=atRow(unit('Selected'),10),targetOnly=atRow(unit('TargetOnly'),2),missing=unit('Missing'),
        inconsistent=atRow(unit('Inconsistent'),5),overlap=atRow(unit('Overlap'),10);
    targetOnly.fields[0].sourceCell='';missing.fields[0].sourceCell='';missing.fields[0].targetCell='';
    inconsistent.fields[0].targetCell='C6';
    const result=build(selected,[selected,missing,inconsistent,overlap,targetOnly]);
    assert.deepEqual(ids(result),['TargetOnly']);
    assert.equal(result.surrounding.entries[0].position,'before');
    assert.equal(result.surrounding.omitted.worksheetCoordinates,3);
    assert.equal(result.surrounding.truncated,true);
    selected.fields[0].sourceCell='';selected.fields[0].targetCell='';
    const unknown=build(selected,[selected,targetOnly]);
    assert.deepEqual(ids(unknown),[]);
    assert.equal(unknown.surrounding.reason,'worksheet-order-unavailable');
});

test('unverified generic Speaker values cannot join unrelated singleton NPC conversations', async () => {
    const scout=npc('Metadata/NPC/Scout','Scout'),guard=npc('Metadata/NPC/Guard','Guard'),
        selected=atRow(conversation('Scout_Only_A'),10),other=atRow(conversation('Guard_Other_A'),9),
        sameNpc=atRow(conversation('Scout_Another_A'),11);
    selected.metadata={Speaker:'Player'};other.metadata={Speaker:'Player'};sameNpc.metadata={Speaker:'Player'};
    const rows=[scout,guard,other,selected,sameNpc],npcIndex=await N.buildNpcIndex(rows,{yield:async()=>{}}),
        convoIndex=await C.buildConvoIndex(rows,npcIndex,{yield:async()=>{}});
    const unknown=build(selected,rows,{npcIndex,convoIndex});
    assert.deepEqual(ids(unknown),[]);
    assert.equal(unknown.surrounding.reason,'singleton-without-verified-npc');
    selected.metadata.NPC='Metadata/NPC/Scout';sameNpc.metadata.NPC='Metadata/NPC/Scout';other.metadata.NPC='Metadata/NPC/Guard';
    const related=build(selected,rows,{npcIndex,convoIndex});
    assert.deepEqual(ids(related),['Scout_Another_A']);
    assert.equal(related.surrounding.npc.speakerEstablished,false);
    assert.equal(related.surrounding.entries[0].npc.speakerEstablished,false);
});

test('speaker identities require unique loaded NPC records, including exact explicit names', async () => {
    const scout=npc('Metadata/NPC/Scout','Scout'),selected=atRow(conversation('Only_A'),10),before=atRow(conversation('Before_A'),9);
    selected.metadata={Speaker:'Scout'};before.metadata={Speaker:'Metadata/NPC/Scout'};
    const rows=[scout,before,selected],npcIndex=await N.buildNpcIndex(rows,{yield:async()=>{}}),convoIndex=familyIndex([selected]);
    const result=build(selected,rows,{npcIndex,convoIndex});
    assert.deepEqual(ids(result),['Before_A']);assert.equal(result.surrounding.npc.speakerEstablished,true);
    assert.deepEqual(ids(build(selected,[before,selected],{npcIndex,convoIndex})),[],'stale index records cannot establish a missing NPC');
    selected.metadata={NPC:'Metadata/NPC/NotLoaded'};before.metadata={NPC:'Metadata/NPC/NotLoaded'};
    assert.deepEqual(ids(build(selected,rows,{npcIndex,convoIndex})),[],'equal unresolved paths do not establish an NPC identity');
    selected.metadata={Speaker:'Scout'};before.metadata={Speaker:'Scout'};
    const collision=npc('Metadata/Monsters/Other','Other NPC');
    collision.fields.push({id:'extra',name:'Short Name',kind:'text',source:'Scout',target:''});
    const ambiguous=[...rows,collision];
    // An exact speaker alias shared by distinct NPC-index groups is unresolved.
    const distinctIndex=await N.buildNpcIndex(ambiguous,{yield:async()=>{}});
    assert.deepEqual(ids(build(selected,ambiguous,{npcIndex:distinctIndex,convoIndex})),[]);
});
