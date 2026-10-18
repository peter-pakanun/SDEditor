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
        fields: [{ id: 'text', name: 'Text', kind: 'text', source, target: source.includes('[Spark|spark]') ? '[Spark|spark] UNSENT TARGET' : 'UNSENT TARGET', sourceCell:'B'+row, targetCell:'C'+row }] };
}
test('context includes exact immutable references and labels speaker evidence precisely', () => {
    const selected = unit('Line'), actor = unit('Data/Actors/Scout', 'Characters', 'Scout'), keyword = unit('Spark', 'KeywordPopups', 'A small flash.');
    keyword.fields[0].target='Original keyword translation';
    selected.metadata = { Speaker: 'Data/Actors/Scout', 'Character Filter': 'ListenerOnly', NPC: 'Data/NPC/Missing' };
    selected.developerNotes = 'Short and direct.';
    const built = Context.create({ unit: selected, field: selected.fields[0], units: [selected, actor, keyword], scope: {game: 'poe2'} });
    assert.equal(built.initial.source, undefined, 'The request carries raw source once, outside optional context.');
    assert.equal(built.initial.metadata.find(row => row.name === 'Speaker').evidence, 'explicit-speaker');
    assert.equal(built.initial.metadata.find(row => row.name === 'Character Filter').evidence, 'listener-constraint');
    assert.equal(built.initial.references[0].recordId, actor.recordId);
    assert.equal(built.initial.keywords[0].recordId, 'Spark');
    assert.equal(built.initial.keywords[0].fields[0].translation, 'Original keyword translation');
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

test('nearest two conversation neighbors exclude the target and keep original order', () => {
    const rows=Array.from({length:81},(_,i)=>conversation('Line'+i,'x')), selected=rows[40];
    for(const row of rows)row.fields[0].target='';
    const result=build(selected,rows,{convoIndex:familyIndex(rows)});
    assert.equal(result.surrounding.entries.length,2);
    assert.deepEqual(ids(result),rows.slice(39,42).filter(row=>row!==selected).map(row=>row.recordId));
    assert.deepEqual(result.surrounding.omitted,{entryLimit:78,contextBudget:0,untranslated:0,fieldLimit:0,worksheetCoordinates:0,existingReference:0,incompatibleField:0,protectedStructure:0,irrelevant:0});
    assert.equal(result.surrounding.truncated,true);
    assert.equal(new Set(result.surrounding.entries.map(row=>row.unitId)).size,2);
});

test('size pressure selects closest preceding turn on ties and omits whole source fields', () => {
    const rows=Array.from({length:7},(_,i)=>conversation('Line'+i,String(i).repeat(600))), selected=rows[3];
    const result=build(selected,rows,{convoIndex:familyIndex(rows),contextLimit:3500});
    assert.deepEqual(ids(result),['Line2']);
    assert.equal(result.surrounding.entries[0].fields[0].source,rows[2].fields[0].source);
    assert.equal(result.surrounding.omitted.contextBudget,1);
    assert.ok(JSON.stringify(result).length<=3500);
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
    const before=unit('Before','ClientStrings','Synthetic matching source'), selected=unit('Selected','ClientStrings','Synthetic matching source'), blank=unit('Blank','ClientStrings','Synthetic matching source'), after=unit('After','ClientStrings','Synthetic matching source'),
        wrongSheet=unit('WrongSheet','Characters'), wrongRole=unit('WrongRole','ClientStrings','Synthetic matching source'), audio=unit('Audio','ClientStrings','Synthetic matching source'), emptySource=unit('Empty','ClientStrings','Synthetic matching source');
    blank.fields[0].target=' ';wrongRole.role='gender';audio.fields[0].source='[NOAUDIO]';emptySource.fields[0].source='';
    before.fields[0].target='Existing before';after.fields[0].target='Existing after';selected.metadata={Context:'Selected'};
    const result=build(selected,[before,wrongSheet,selected,blank,wrongRole,audio,emptySource,after,after]);
    assert.equal(result.surrounding.mode,'same-sheet-translated');
    assert.equal(result.surrounding.reason,'relevant-compatible-translations');
    assert.deepEqual(ids(result),['Before','After']);
    assert.equal(result.surrounding.omitted.untranslated,1);
    assert.equal(result.surrounding.entries[0].fields[0].translation,'Existing before');
    assert.equal(result.surrounding.entries[0].fields[0].translationOrigin,'original-workbook');
    assert.ok(!result.references.some(row=>row.unitId===selected.id));
});

test('relevance selection reaches trusted rows beyond untranslated rows before applying the two-entry cap', () => {
    const rows=Array.from({length:101},(_,i)=>unit('Line'+i,'ClientStrings','x')),selected=rows[50];
    for(let i=0;i<rows.length;i++)rows[i].fields[0].target=i>=30 && i<=70?'':'t';
    const result=build(selected,rows);
    assert.deepEqual(ids(result),[rows[29],rows[71]].map(row=>row.recordId));
    assert.equal(result.surrounding.omitted.untranslated,40);
    assert.equal(result.surrounding.omitted.entryLimit,58);
    assert.equal(result.surrounding.omitted.contextBudget,0);
});

test('same-sheet pairs use only scoped Saved or current original translations, never MTL review overlays or drafts', () => {
    const selected=unit('Selected','ClientStrings','Synthetic matching source'), original=unit('Original','ClientStrings','Synthetic matching source'), savedRow=unit('Saved','ClientStrings','Synthetic matching source'), blankSave=unit('BlankSave','ClientStrings','Synthetic matching source'),
        draftOnly=unit('DraftOnly','ClientStrings','Synthetic matching source'), stale=unit('Stale','ClientStrings','Synthetic matching source'), reviewed=unit('Reviewed','ClientStrings','Synthetic matching source'), conflicted=unit('Conflicted','ClientStrings','Synthetic matching source'), incomplete=unit('Incomplete','ClientStrings','Synthetic matching source');
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
        assert.deepEqual(ids(result),['Original','Saved']);
        assert.deepEqual(result.surrounding.entries.map(row=>row.fields[0].translation),['Original pair','Saved pair']);
        assert.deepEqual(result.surrounding.entries.map(row=>row.fields[0].translationOrigin),['original-workbook','saved']);
        assert.equal(build(selected,[selected,reviewed],{saved:snapshot}).surrounding.entries[0].fields[0].translation,'Reviewed pair');
        assert.ok(!JSON.stringify(result).includes('SECRET'));
    }
});

test('Saved-false state cannot promote a draft and an outdated original is not trusted context', () => {
    const selected=unit('Selected','ClientStrings','Synthetic matching source'), neighbor=unit('Neighbor','ClientStrings','Synthetic matching source');neighbor.fields[0].target='Original pair';
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
    const selected=unit('Selected','ClientStrings','Synthetic matching source'), neighbor=unit('Neighbor','ClientStrings','Synthetic matching source'), external=unit('External','NPCs','NOT LOADED');
    const npcIndex={memberships:new Map([[selected.id,new Map([['npc',{kind:'dialogue'}]])]]),
        groupByKey:new Map([['npc',{npcUnits:[external]}]])};
    const result=build(selected,[null,{id:'broken'},neighbor,selected],{npcIndex,convoIndex:{memberships:new Map()}});
    assert.deepEqual(ids(result),['Neighbor']);
    assert.ok(!JSON.stringify(result).includes('NOT LOADED'));
    const empty=build(selected,[null,neighbor]);
    assert.equal(empty.surrounding.reason,'target-not-loaded');assert.deepEqual(ids(empty),[]);
});

test('same-sheet partial workbook handles absent translations and only sends paired fields', () => {
    const selected=unit('Selected','ClientStrings','Synthetic matching source'), neighbor=unit('Neighbor','ClientStrings','Synthetic matching source'), untranslated=unit('Untranslated','ClientStrings','Synthetic matching source');
    delete untranslated.fields[0].target;
    neighbor.fields.push({id:'empty',name:'Empty',kind:'text',source:'Untranslated source',target:''},
        {id:'gender',name:'Gender',kind:'gender',source:'English gender',target:'Gender target'},
        {id:'form',name:'Name',kind:'form',form:'StrFour',source:'Form source',target:'Form translation'});
    const result=build(selected,[untranslated,neighbor,selected]);
    assert.deepEqual(ids(result),['Neighbor']);
    assert.deepEqual(result.surrounding.entries[0].fields.map(row=>row.fieldId),['text']);
    assert.equal(result.surrounding.omitted.untranslated,1);
});

test('surrounding rows and exact metadata references are deduplicated by full unit identity', () => {
    const before=conversation('Before_A'), selected=conversation('Selected_A'), after=conversation('After_A');
    selected.metadata={Context:'Before_A',Other:'Before_A',Self:'Selected_A'};
    const result=build(selected,[before,selected,after,before],{convoIndex:familyIndex([before,selected,after])});
    assert.deepEqual(ids(result),['After_A']);assert.deepEqual(result.references.map(row=>row.recordId),['Before_A']);
    assert.equal(result.surrounding.omitted.existingReference,1);assert.equal(result.surrounding.omitted.contextBudget,0);
    const json=JSON.stringify(result), again=build(selected,[before,selected,after,before],{convoIndex:familyIndex([before,selected,after])});
    assert.equal(JSON.stringify(again),json);
});

test('field caps and server text, UTF-8 and structural budgets include selection provenance', () => {
    const rows=Array.from({length:65},(_,i)=>({id:'u'+i,recordId:String(i),sheet:'N',role:'n',metadata:{},fields:
        Array.from({length:9},(_,j)=>({id:String(j),name:'',kind:'text',source:'x',target:'',sourceCell:'B'+(i+2),targetCell:'C'+(i+2)}))})),selected=rows[32];
    const result=build(selected,rows,{convoIndex:familyIndex(rows)});
    assert.ok(result.surrounding.entries.length<=2);
    assert.ok(result.surrounding.omitted.entryLimit>0);
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
    const result=build(selected,rows,{convoIndex:familyIndex(rows),contextLimit:3500});
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

function keyword(recordId = 'Spark', fields = [
    {name:'Info Title',kind:'text',source:'Synthetic title English',target:'Synthetic title translation'},
    {name:'Info Content',kind:'text',source:'Synthetic content English',target:'Synthetic content translation'}
]) {
    const value=unit(recordId,'KeywordPopups'),template=value.fields[0];
    value.fields=fields.map(field=>({...template,...field,id:field.id || JSON.stringify([field.name,field.form || null])}));
    return value;
}

test('keyword context retains English titles, content and labels with current original translations and provenance', () => {
    const selected=unit('Selected'),popup=keyword('Spark',[
        {name:'Info Title',kind:'text',source:'Synthetic title English',target:'  Synthetic title translation  '},
        {name:'Info Content',kind:'text',source:'Synthetic content English',target:'Synthetic content translation'},
        {name:'Label',kind:'form',form:'StrFour',source:'Synthetic label English',target:'Synthetic label translation'},
        {name:'Gender',kind:'gender',source:'Gender English',target:'EXCLUDED GENDER'},
        {name:'Empty',kind:'text',source:'',target:'EXCLUDED BLANK SOURCE'}
    ]),rows=freeze([selected,popup]),before=JSON.stringify(rows),context=Context.create({unit:selected,field:selected.fields[0],units:rows});
    const record=context.initial.keywords[0];
    assert.equal(record.unitId,popup.id);assert.equal(record.sheet,'KeywordPopups');assert.equal(record.role,'normal');
    assert.equal(record.recordId,'Spark');assert.equal(record.reason,'exact-keyword-identity');
    assert.deepEqual(record.fields.map(field=>field.fieldId),popup.fields.slice(0,3).map(field=>field.id));
    assert.deepEqual(record.fields.map(field=>field.name),['Info Title','Info Content','Label']);
    assert.deepEqual(record.fields.map(field=>field.source),popup.fields.slice(0,3).map(field=>field.source));
    assert.deepEqual(record.fields.map(field=>field.translation),popup.fields.slice(0,3).map(field=>field.target));
    assert.ok(record.fields.every(field=>field.translationOrigin==='original-workbook'));
    assert.doesNotMatch(JSON.stringify(context.initial),/EXCLUDED/);
    assert.equal(context.contextHash,S.hash(context.initial));assert.equal(JSON.stringify(rows),before);
});

test('keyword Saved overrides use the scoped snapshot while drafts and MTL overlays stay excluded', () => {
    const selected=unit('Selected'),popup=keyword(),title=popup.fields[0],saved=freeze({[popup.id]:{saved:true,values:{[title.id]:'Authored keyword title'}}});
    for(const snapshot of [saved,new Map(Object.entries(saved))]) {
        const result=build(selected,[selected,popup],{saved:snapshot,drafts:{[popup.id]:{values:{[title.id]:'DRAFT SECRET'}}},
            candidates:[{unitId:popup.id,fieldId:title.id,generatedText:'MTL SECRET'}],reviewBuffers:{[popup.id]:'REVIEW SECRET'}});
        assert.equal(result.keywords[0].fields[0].translation,'Authored keyword title');
        assert.equal(result.keywords[0].fields[0].translationOrigin,'saved');
        assert.equal(result.keywords[0].fields[1].translation,popup.fields[1].target);
        assert.equal(result.keywords[0].fields[1].translationOrigin,'original-workbook');
        assert.doesNotMatch(JSON.stringify(result),/SECRET/);
    }
    const unsaved=build(selected,[selected,popup],{saved:{[popup.id]:{saved:false,values:{[title.id]:'UNSAVED SECRET'}}}});
    assert.equal(unsaved.keywords[0].fields[0].translation,title.target);
    const cleared=build(selected,[selected,popup],{saved:{[popup.id]:{saved:true,values:{[title.id]:''}}}});
    assert.equal(cleared.keywords[0].fields[0].translation,undefined,'an intentionally blank Saved value never falls back to the old target');
    assert.equal(cleared.keywords[0].fields[0].source,title.source);
});

test('keyword context keeps current English but rejects stale, conflicted and unreviewed target text', () => {
    const selected=unit('Selected'),popup=keyword('Spark',[
        {name:'Original stale',kind:'text',source:'Current English 1',target:'STALE ORIGINAL SECRET',outdated:true},
        {name:'Saved stale',kind:'text',source:'Current English 2',target:'STALE BASE SECRET',outdated:true},
        {name:'Reviewed',kind:'text',source:'Current English 3',target:'STALE BASE SECRET',outdated:true},
        {name:'Inherited stale',kind:'text',source:'Current English 4',target:'STALE INHERITED SECRET'},
        {name:'Conflicted',kind:'text',source:'Current English 5',target:'CONFLICT BASE SECRET'},
        {name:'Missing',kind:'text',source:'Current English 6',target:'MISSING SECRET',originalMissing:true},
        {name:'Current',kind:'text',source:'Current English 7',target:'Current original translation'},
        {name:'Audio',kind:'text',source:'[NOAUDIO]',target:'AUDIO SECRET'}
    ]),fields=popup.fields,saved={[popup.id]:{saved:true,values:{[fields[1].id]:'STALE SAVED SECRET',[fields[2].id]:'Reviewed current translation',
        [fields[3].id]:'INHERITED SAVED SECRET',[fields[4].id]:'CONFLICT SAVED SECRET'},reviewed:{[fields[1].id]:'old-source',
        [fields[2].id]:S.sourceHash(fields[2].source)},outdated:[fields[3].id],conflicts:[{fieldId:fields[4].id}]}};
    const result=build(selected,[selected,popup],{saved}),projected=result.keywords[0].fields;
    assert.deepEqual(projected.map(field=>field.source),fields.map(field=>field.source));
    assert.deepEqual(projected.map(field=>field.translation),[undefined,undefined,'Reviewed current translation',undefined,undefined,undefined,'Current original translation',undefined]);
    assert.equal(projected[2].translationOrigin,'saved');assert.equal(projected[6].translationOrigin,'original-workbook');
    assert.doesNotMatch(JSON.stringify(result),/SECRET/);
});

test('partial keyword workbooks retain source-only fields and optional missing records without invented translations', () => {
    const selected=unit('Selected'),popup=keyword('Spark',[
        {name:'Info Title',kind:'text',source:'Title English',target:undefined},
        {name:'Info Content',kind:'text',source:'Content English',target:'   '},
        {name:'Blank source',kind:'text',source:' ',target:'EXCLUDED'},
        {name:'Nonexistent form',kind:'form',form:'StrFour',source:'Form English',target:'NONEXISTENT'}
    ]);
    const result=build(selected,[selected,popup]);
    assert.deepEqual(result.keywords[0].fields.map(field=>field.name),['Info Title','Info Content','Nonexistent form']);
    assert.ok(result.keywords[0].fields.every(field=>!Object.hasOwn(field,'translation')));
    assert.doesNotMatch(JSON.stringify(result),/EXCLUDED/);
    const absent=build(selected,[selected]);
    assert.deepEqual(absent.keywords,[]);assert.ok(absent.unavailable.some(row=>row.reference==='Spark' && row.reason==='keyword-not-loaded'));
});

test('translated keywords preserve exact ID matching, role guards and reference deduplication', () => {
    const selected=unit('Selected','ClientStrings','[Spark|visible label] [Spark|another label] [Missing|missing label]'),popup=keyword(),wrongRole=keyword('Spark');
    wrongRole.id=JSON.stringify(['gender','KeywordPopups','Spark']);wrongRole.role='gender';wrongRole.fields[0].target='WRONG ROLE SECRET';
    const result=build(selected,[selected,popup,popup,wrongRole]);
    assert.equal(result.keywords.length,1);assert.equal(result.keywords[0].recordId,'Spark');
    assert.equal(result.keywords[0].fields[0].translation,popup.fields[0].target);
    assert.ok(result.unavailable.some(row=>row.reference==='Missing' && row.reason==='keyword-not-loaded'));
    assert.doesNotMatch(JSON.stringify(result),/WRONG ROLE SECRET/);
    selected.metadata={Context:'Spark'};
    const deduplicated=build(selected,[selected,popup]);
    assert.deepEqual(deduplicated.keywords,[]);assert.equal(deduplicated.references.length,1);
    assert.equal(deduplicated.references[0].fields[0].translation,popup.fields[0].target);
    const otherSheet=keyword();otherSheet.sheet='OtherKeywordPopups';otherSheet.id=JSON.stringify(['normal',otherSheet.sheet,'Spark']);
    selected.metadata={};
    const ambiguous=build(selected,[selected,popup,otherSheet]);
    assert.deepEqual(ambiguous.keywords,[]);assert.ok(ambiguous.unavailable.some(row=>row.reference==='Spark' && row.reason==='ambiguous-keyword'));
});

test('keyword translation budgeting preserves all retained English and omits oversized translations whole', () => {
    const selected=unit('Selected','ClientStrings','[Spark|spark] [Stone|stone]'),spark=keyword('Spark'),stone=keyword('Stone');
    spark.fields[0].target='ก'.repeat(20000);stone.fields[1].target='Small complete translation';
    const result=build(selected,[selected,spark,stone],{contextLimit:2400});
    assert.deepEqual(result.keywords.map(row=>row.recordId),['Spark','Stone']);
    assert.deepEqual(result.keywords.flatMap(row=>row.fields.map(field=>field.source)),[...spark.fields,...stone.fields].map(field=>field.source));
    assert.equal(result.keywords[0].fields[0].translation,undefined);
    assert.equal(result.keywords[1].fields[1].translation,'Small complete translation');
    assert.ok(JSON.stringify(result).length<=2400);assert.ok(Buffer.byteLength(JSON.stringify(result))<=Context.LIMITS.contextBytes);
    assert.ok(valueCount(result)<=Context.LIMITS.contextEntries);
});

test('keyword field caps remain unchanged when trusted translations are attached', () => {
    const selected=unit('Selected'),popup=keyword('Spark',Array.from({length:12},(_,i)=>({name:'Field '+i,kind:'text',source:'English '+i,target:'Translation '+i}))),
        result=build(selected,[selected,popup]);
    assert.equal(result.keywords[0].fields.length,8);
    assert.deepEqual(result.keywords[0].fields.map(field=>field.translation),popup.fields.slice(0,8).map(field=>field.target));
    assert.ok(!JSON.stringify(result).includes('Translation 8'));
});

function dialogueVariants(recordId, sheet = 'NPCTalkDialogueTextAudio') {
    const value=unit(recordId,sheet,'Synthetic dialogue'),base=value.fields[0],row=base.targetCell.match(/\d+$/)[0];
    base.id=JSON.stringify(['Text',null]);base.target='Original dialogue translation';
    value.fields.push(...S.CLASS_FORMS.map((form,index)=>({...base,id:JSON.stringify(['Text',form]),kind:'form',form,group:'Text',
        target:'',required:false,originalMissing:false,targetCell:String.fromCharCode(68+index)+row})));
    return value;
}

test('empty inherited class variants are removed before surrounding field and text limits', () => {
    const selected=dialogueVariants('Selected'),neighbors=Array.from({length:10},(_,i)=>dialogueVariants('Neighbor'+i));
    for(const value of neighbors)for(const field of value.fields)field.source='Synthetic dialogue '.repeat(16);
    const rows=freeze([...neighbors.slice(0,5),selected,...neighbors.slice(5)]),before=JSON.stringify(rows),
        result=build(selected,rows,{convoIndex:familyIndex(rows)});
    assert.equal(result.surrounding.availableEntries,10);assert.equal(result.surrounding.selectedEntries,2);
    assert.equal(result.surrounding.omitted.contextBudget,0);assert.equal(result.surrounding.omitted.fieldLimit,0);
    assert.ok(result.surrounding.entries.every(row=>row.fields.length===1 && row.fields[0].fieldId===neighbors[0].fields[0].id));
    const trimmed=rows.map(value=>({...value,fields:value.fields.slice(0,1)})),trimmedTarget=trimmed.find(value=>value.id===selected.id),
        expected=build(trimmedTarget,trimmed,{convoIndex:familyIndex(trimmed)});
    assert.deepEqual(result,expected,'blank forms cost no extra context characters or field slots');
    assert.equal(JSON.stringify(rows),before);
});

test('distinct variant source text, separate source cells and trusted original or Saved translations retain exact identities', () => {
    const selected=dialogueVariants('Selected'),neighbor=dialogueVariants('Neighbor'),fields=neighbor.fields;
    fields[2].source='A genuinely distinct class source';
    fields[3].sourceCell=fields[3].sourceCell.replace('B','Z');
    fields[4].target='Approved class translation';
    fields[6].target=fields[0].target;
    fields[7].target='STALE SECRET';fields[7].outdated=true;
    fields[9].target='NONEXISTENT';fields[10].required=true;fields[10].originalMissing=true;
    fields[11].originalMissing=true;fields[12].target='Cleared original translation';
    const saved={[neighbor.id]:{saved:true,values:{[fields[5].id]:'Saved class translation',[fields[8].id]:'CONFLICT SECRET',
        [fields[11].id]:'Corrected class translation',[fields[12].id]:''},conflicts:[{fieldId:fields[8].id}]}},
        rows=freeze([neighbor,selected]),result=build(selected,rows,{saved,convoIndex:familyIndex(rows)}),projected=result.surrounding.entries[0].fields;
    assert.deepEqual(projected.map(field=>field.fieldId),[0,2,3,4,5,6,11].map(index=>fields[index].id));
    assert.equal(projected[1].source,'A genuinely distinct class source');assert.equal(projected[1].translation,undefined);
    assert.equal(projected[2].source,fields[0].source);assert.equal(projected[2].translation,undefined);
    assert.equal(projected[3].translation,'Approved class translation');assert.equal(projected[3].translationOrigin,'original-workbook');
    assert.equal(projected[4].translation,'Saved class translation');assert.equal(projected[4].translationOrigin,'saved');
    assert.equal(projected[5].translation,fields[0].target,'a trusted explicit variant remains even when its translation equals the base');
    assert.equal(projected[6].translation,'Corrected class translation');assert.doesNotMatch(JSON.stringify(result),/SECRET/);
});

test('a form-only source retains one representative and preserves the requested form identity', () => {
    const selected=dialogueVariants('Selected'),neighbor=dialogueVariants('Neighbor');
    selected.fields=selected.fields.slice(1);neighbor.fields=neighbor.fields.slice(1);
    const field=selected.fields.at(-1),result=Context.create({unit:selected,field,units:[neighbor,selected],convoIndex:familyIndex([neighbor,selected])});
    assert.equal(result.initial.identity.fieldId,field.id);assert.equal(result.initial.identity.form,field.form);
    assert.deepEqual(result.initial.surrounding.entries[0].fields.map(item=>[item.fieldId,item.form,item.source]),[[field.id,field.form,field.source]]);
    const requested=result.lookup({recordId:'Neighbor'}).results[0];
    assert.equal(requested.fields.length,1);assert.equal(requested.fields[0].fieldId,field.id);assert.equal(requested.fields[0].form,field.form);
});

test('the field cap preserves a useful target-matching variant while keeping source field order', () => {
    const selected=dialogueVariants('Selected'),neighbor=dialogueVariants('Neighbor');
    for(const field of neighbor.fields)field.target='Approved '+(field.form || 'base');
    const field=selected.fields.at(-1),context=Context.create({unit:selected,field,units:[neighbor,selected],convoIndex:familyIndex([neighbor,selected])}),
        expected=[...neighbor.fields.slice(0,7),neighbor.fields.at(-1)].map(item=>item.id);
    assert.deepEqual(context.initial.surrounding.entries[0].fields.map(item=>item.fieldId),expected);
    assert.equal(context.initial.surrounding.omitted.fieldLimit,5);
    assert.equal(context.initial.surrounding.entries[0].fields.at(-1).translation,'Approved '+field.form);
    assert.deepEqual(context.lookup({recordId:'Neighbor'}).results[0].fields.map(item=>item.fieldId),expected);
});

test('missing optional form metadata deduplicates only unambiguous shared sources', () => {
    const selected=dialogueVariants('Selected'),neighbor=dialogueVariants('Neighbor');
    for(const field of neighbor.fields){delete field.group;delete field.sourceCell;}
    const reduced=build(selected,[neighbor,selected],{convoIndex:familyIndex([neighbor,selected])});
    assert.deepEqual(reduced.surrounding.entries[0].fields.map(field=>field.fieldId),[neighbor.fields[0].id]);
    neighbor.fields=neighbor.fields.slice(0,3);for(const field of neighbor.fields)delete field.name;
    const unknown=build(selected,[neighbor,selected],{convoIndex:familyIndex([neighbor,selected])});
    assert.equal(unknown.surrounding.entries[0].fields.length,3,'missing source names and coordinates cannot prove inheritance');
    for(const field of neighbor.fields)field.name='Text';neighbor.fields[0].sourceCell='B2';neighbor.fields[1].sourceCell='Z2';
    for(const field of neighbor.fields)field.targetCell='C2';
    const ambiguous=build(selected,[neighbor,selected],{convoIndex:familyIndex([neighbor,selected])});
    assert.equal(ambiguous.surrounding.entries[0].fields.length,3,'an unknown coordinate cannot merge two explicitly distinct source cells');
});

test('distinct named source groups are not collapsed merely because the source text is identical', () => {
    const selected=dialogueVariants('Selected'),neighbor=dialogueVariants('Neighbor');neighbor.fields=neighbor.fields.slice(0,2);
    neighbor.fields[1].name='Other field';neighbor.fields[1].group='Other field';
    const result=build(selected,[neighbor,selected],{convoIndex:familyIndex([neighbor,selected])});
    assert.deepEqual(result.surrounding.entries[0].fields.map(field=>field.fieldId),neighbor.fields.map(field=>field.id));
});

test('keyword and exact-reference projections omit empty inherited forms but retain approved variant translations', () => {
    const selected=unit('Selected','ClientStrings','Use [Spark|spark].'),popup=dialogueVariants('Spark','KeywordPopups'),last=popup.fields.at(-1),
        saved={[popup.id]:{saved:true,values:{[last.id]:'Approved keyword class translation'}}};
    for(const reference of [false,true]) {
        selected.metadata=reference?{Context:'Spark'}:{};
        const context=Context.create({unit:selected,field:selected.fields[0],units:[selected,popup],saved}),
            rows=reference?context.initial.references:context.initial.keywords;
        assert.equal(rows.length,1);assert.deepEqual(rows[0].fields.map(field=>field.fieldId),[popup.fields[0].id,last.id]);
        assert.equal(rows[0].fields[0].translation,popup.fields[0].target);
        assert.equal(rows[0].fields[1].translation,'Approved keyword class translation');assert.equal(rows[0].fields[1].translationOrigin,'saved');
        assert.equal(rows[0].fields[1].form,last.form);
        const requested=context.lookup({recordId:'Spark'}).results[0];
        assert.deepEqual(requested.fields.map(field=>field.fieldId),[popup.fields[0].id,last.id]);
    }
});

test('large surrounding workloads cannot crowd out direct keywords, references, glossary, core rules or lookup diagnostics', () => {
    const selected=atRow(unit('Selected','ClientStrings','Use [SyntheticAlpha|alpha] and [SyntheticBeta|beta] with TargetTerm.'),502),
        alpha=keyword('SyntheticAlpha'),beta=keyword('SyntheticBeta'),actor=unit('Data/Actors/Synthetic','Characters','Synthetic reference source'),
        neighbors=Array.from({length:1000},(_,i)=>atRow(unit('Nearby'+i,'ClientStrings','Nearby English '.repeat(12)),i+3));
    selected.developerNotes='Direct developer guidance.';selected.metadata={Speaker:actor.recordId};
    for(const row of neighbors)row.fields[0].target='Nearby approved translation '.repeat(8);
    const saved={[alpha.id]:{saved:true,values:{[alpha.fields[0].id]:'Saved keyword title'}}},
        dictionary=[{_id:'synthetic-term',find:'TargetTerm',replace:'Approved term',gameScope:'poe2'}],options={saved,dictionary,scope:{game:'poe2'}},
        result=build(selected,[...neighbors,selected,actor,alpha,beta],options),direct=build(selected,[selected,actor,alpha,beta],options);
    for(const key of ['notes','metadata','references','keywords','glossary','unavailable','evidenceRules'])assert.deepEqual(result[key],direct[key],key);
    assert.deepEqual(result.keywordLookup,{requested:2,matched:2,missing:0,ambiguous:0,selfReferences:0});
    assert.equal(result.keywords[0].fields[0].translation,'Saved keyword title');
    assert.equal(result.omitted.keywords,0);assert.equal(result.omitted.keywordTranslations,0);
    assert.equal(result.omitted.references,0);assert.equal(result.omitted.glossary,0);assert.equal(result.omitted.unavailable,0);
    assert.equal(result.surrounding.selectedEntries,0);assert.equal(result.surrounding.omitted.irrelevant,999);
    assert.equal(result.surrounding.omitted.contextBudget,0);
    assert.ok(JSON.stringify(result).length<=Context.LIMITS.context);
    assert.ok(Buffer.byteLength(JSON.stringify(result))<=Context.LIMITS.contextBytes);assert.ok(valueCount(result)<=Context.LIMITS.contextEntries);
});

test('lookup summaries distinguish missing, ambiguous and budget-omitted keywords when detailed warnings cannot fit', () => {
    const selected=unit('Selected','ClientStrings','[SyntheticLoaded|loaded] [SyntheticMissing|missing] [SyntheticAmbiguous|ambiguous]'),
        loaded=keyword('SyntheticLoaded'),one=keyword('SyntheticAmbiguous'),two=keyword('SyntheticAmbiguous');
    two.sheet='OtherKeywordPopups';two.id=JSON.stringify(['normal',two.sheet,two.recordId]);
    const result=build(selected,[selected,loaded,one,two],{contextLimit:100});
    assert.deepEqual(result.keywordLookup,{requested:3,matched:1,missing:1,ambiguous:1,selfReferences:0});
    assert.deepEqual(result.keywords,[]);assert.deepEqual(result.unavailable,[]);
    assert.equal(result.omitted.keywords,1);assert.equal(result.omitted.keywordTranslations,2);assert.equal(result.omitted.unavailable,4);
    assert.equal(result.evidenceRules.length,2);
});

test('a genuinely oversized direct keyword is reported as a budget omission and its source is not truncated', () => {
    const selected=unit('Selected','ClientStrings','[SyntheticLarge|large]'),popup=keyword('SyntheticLarge');
    popup.fields[0].source='Synthetic source '.repeat(2000);
    const result=build(selected,[selected,popup]);
    assert.deepEqual(result.keywordLookup,{requested:1,matched:1,missing:0,ambiguous:0,selfReferences:0});
    assert.deepEqual(result.keywords,[]);assert.equal(result.omitted.keywords,1);
    assert.equal(popup.fields[0].source,'Synthetic source '.repeat(2000));
});

test('relevance ranks protected keyword overlap before exact metadata, fuzzy text and proximity, independently of editor filters',()=>{
    const selected=atRow(unit('Selected','ActiveSkills','Gain [SyntheticAlpha|alpha] power when you strike a foe.'),50),
        shared=atRow(unit('SharedKeyword','ActiveSkills','[SyntheticAlpha|alpha]'),90),
        metadata=atRow(unit('SharedMetadata','ActiveSkills','A completely different sentence.'),80),
        similar=atRow(unit('Similar','ActiveSkills','Gain power when you strike a foe.'),49),
        unrelated=atRow(unit('Unrelated','ActiveSkills','Open the options menu.'),51);
    selected.metadata={SkillType:'SyntheticExact'};metadata.metadata={SkillType:'SyntheticExact'};
    shared.fields[0].target='[SyntheticAlpha|approved alpha]';
    const rows=[selected,unrelated,similar,metadata,shared], options={visibleUnits:[similar],filters:{search:'Similar',saved:false}},
        result=build(selected,rows,options),reversed=build(selected,[...rows].reverse(),options);
    assert.deepEqual(ids(result),['SharedMetadata','SharedKeyword']);assert.deepEqual(result,reversed);
    const scores=result.surrounding.entries.map(row=>row.relevance);
    assert.equal(scores[0].metadataMatches,1);assert.equal(scores[0].keywordOverlap,0);
    assert.equal(scores[1].keywordOverlap,1);assert.equal(scores[1].metadataMatches,0);
    assert.equal(result.surrounding.omitted.irrelevant,1);assert.equal(result.surrounding.omitted.entryLimit,1);
    assert.equal(result.surrounding.selectionOrder,'keyword-overlap-metadata-text-proximity');
    assert.equal(Context.exampleScore(selected,selected.fields[0],shared,shared.fields[0]).keywordOverlap,1);
});

test('fuzzy matching and field compatibility reject unrelated same-sheet rows and choose the closest equal-score row deterministically',()=>{
    const selected=atRow(unit('Selected','ActiveSkills','Release a blazing wave of fire at nearby enemies.'),50),
        similar=atRow(unit('Fuzzy','ActiveSkills','Release a blazing wave of frost at nearby enemies.'),80),
        preceding=atRow(unit('Before','ActiveSkills','Release a blazing wave of fire at nearby enemies.'),49),
        following=atRow(unit('After','ActiveSkills','Release a blazing wave of fire at nearby enemies.'),51),
        wrongField=atRow(unit('WrongField','ActiveSkills',selected.fields[0].source),48),
        unrelated=atRow(unit('Unrelated','ActiveSkills','Open settings to change your account.'),47);
    wrongField.fields[0].name='Name';
    const rows=[selected,similar,following,unrelated,wrongField,preceding],result=build(selected,rows);
    assert.deepEqual(ids(result),['Before','After']);assert.equal(result.surrounding.omitted.incompatibleField,1);
    assert.equal(result.surrounding.omitted.irrelevant,1);
    const fuzzy=build(selected,[selected,similar]);assert.deepEqual(ids(fuzzy),['Fuzzy']);
    assert.ok(fuzzy.surrounding.entries[0].relevance.textSimilarity>=350);
    assert.equal(Context.exampleScore(selected,selected.fields[0],similar,similar.fields[0]).textSimilarity,
        Context.exampleScore({...selected}, {...selected.fields[0],source:selected.fields[0].source.toUpperCase()},similar,similar.fields[0]).textSimilarity);
});

test('trusted examples use the existing validator for complex keyword grammar and reject added tags, raw variable changes and broken syntax',()=>{
    const selected=unit('Selected','ActiveSkills','Gain power.'),valid=unit('Valid','ActiveSkills','[Skill::{0}|Name {1}] grants [Skill<gemlevel={2}>|power].'),
        injected=unit('Injected','ActiveSkills','Gain power.'),variable=unit('Variable','ActiveSkills','Gain @{0}% power.'),
        broken=unit('Broken','ActiveSkills','Gain power.'),literal=unit('Literal','ActiveSkills','Gain\\npower.'),style=unit('Style','ActiveSkills','Gain power.'),
        spaced=unit('Spaced','ActiveSkills','[SyntheticKeyword|power]');
    selected.metadata={Type:'Synthetic'};for(const row of [valid,injected,variable,broken,literal,style,spaced])row.metadata={Type:'Synthetic'};
    valid.fields[0].target='[Skill::{0}|Nom {1}] donne [Skill<gemlevel={2}>|pouvoir].';
    injected.fields[0].target='Gain [Consume|power].';variable.fields[0].target='Gain {0}% power.';
    broken.fields[0].target='Gain [power.';literal.fields[0].target='Gain\npower.';style.fields[0].target='<italic>{Gain power.}';
    spaced.fields[0].target='[ SyntheticKeyword|power]';
    const result=build(selected,[selected,injected,variable,broken,literal,valid,style,spaced]);
    assert.deepEqual(ids(result),['Valid','Style']);assert.equal(result.surrounding.omitted.protectedStructure,5);
    assert.equal(result.surrounding.entries[0].fields[0].translation,valid.fields[0].target);
    assert.ok(!JSON.stringify(result.surrounding.entries).includes('Consume'));
});

test('keywords and their whole approved definitions survive pressure from developer notes, references and optional examples',()=>{
    const selected=unit('Selected','ActiveSkills','Use [SyntheticPriority|priority].'),popup=keyword('SyntheticPriority'),
        related=unit('SyntheticRelated','Characters','Unrelated biography '.repeat(200)),neighbor=unit('Neighbor','ActiveSkills',selected.fields[0].source);
    selected.developerNotes='Long optional notes '.repeat(220);selected.metadata={Context:related.recordId};
    popup.fields[1].source='A useful exact keyword definition. '.repeat(16);
    const saved={[popup.id]:{saved:true,values:{[popup.fields[1].id]:'Whole approved keyword definition. '.repeat(12)}}},
        options={contextLimit:4200,saved},alone=build(selected,[selected,popup],options),result=build(selected,[related,neighbor,selected,popup],options);
    assert.deepEqual(result.keywords,alone.keywords);assert.equal(result.omitted.keywords,0);assert.equal(result.omitted.keywordTranslations,0);
    assert.equal(result.keywords[0].fields[1].source,popup.fields[1].source);
    assert.equal(result.keywords[0].fields[1].translation,saved[popup.id].values[popup.fields[1].id]);
    assert.equal(result.omitted.notes,1);assert.ok(JSON.stringify(result).length<=4200);
    assert.ok(Object.keys(result).indexOf('keywords')<Object.keys(result).indexOf('surrounding'));
});

test('glossary matches the selected source and direct keyword definitions, without substring or unrelated-reference expansion',()=>{
    const selected=unit('Selected','ActiveSkills','Lifetime [SyntheticKeyword|power].'),popup=keyword('SyntheticKeyword'),actor=unit('Actor','Characters','UnrelatedBiographyTerm');
    selected.metadata={Context:'Actor'};popup.fields[1].source='UsefulDefinitionTerm';
    const dictionary=[['life','Life'],['definition','UsefulDefinitionTerm'],['unrelated','UnrelatedBiographyTerm']]
        .map(([id,find])=>({_id:id,find,replace:'Approved '+id})),result=build(selected,[selected,popup,actor],{dictionary});
    assert.deepEqual(result.glossary.map(row=>row.id),['definition']);
});

test('a conversation preserves adjacent source turns while excluding structurally invalid example translations',()=>{
    const before=atRow(conversation('Before_A','First turn.'),9),selected=atRow(conversation('Selected_A','Second turn.'),10),after=atRow(conversation('After_A','Third turn.'),11);
    before.fields[0].target='First [Consume|turn].';after.fields[0].target='';
    const rows=[after,selected,before],result=build(selected,rows,{convoIndex:familyIndex(rows)});
    assert.deepEqual(ids(result),['Before_A','After_A']);assert.equal(result.surrounding.omitted.protectedStructure,1);
    assert.ok(result.surrounding.entries.every(row=>row.fields[0].translation===undefined));
    assert.equal(result.roleHints?.speaker?.identityKey,undefined);assert.equal(result.roleHints?.listener?.identityKey,undefined);
    assert.equal(result.surrounding.selectionOrder,'conversation-proximity-preceding-on-ties');
});
