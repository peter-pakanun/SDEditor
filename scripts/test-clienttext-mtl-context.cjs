const {test} = require('node:test');
const assert = require('node:assert/strict');
const Context = require('../public/clientTextMtlContext.js');
const S = require('../public/clientTextState.js');
function unit(recordId, sheet = 'ClientStrings', source = 'A [Spark|spark] for a Scout') {
    return { id: JSON.stringify(['normal', sheet, recordId]), recordId, sheet, role: 'normal', metadata: {}, developerNotes: '',
        fields: [{ id: 'text', name: 'Text', kind: 'text', source, target: 'UNSENT TARGET' }] };
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
