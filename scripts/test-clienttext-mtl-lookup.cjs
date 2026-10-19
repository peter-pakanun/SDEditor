const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/clientTextState.js');
const M = require('../public/clientTextMtlState.js');
const Context = require('../public/clientTextMtlContext.js');
const Wire = require('../public/clientTextMtlLookup.js');
const scope = {accountId:'synthetic',groupId:'group',versionId:'version',game:'poe2',branchId:'default',language:'Thai'};
const unit = (recordId, sheet='ClientStrings', source='English {0}', target='Original {0}', role='normal') => S.normalizeUnit({
    role,sheet,recordId,fields:[{id:'["Text",null]',name:'Text',kind:'text',source,target}]});
function fixture(extra=[], saved={}) {
    const selected=unit('Selected'), request={requestId:'synthetic-request',unitId:selected.id,fieldId:selected.fields[0].id,role:'normal',
        rawSourceHash:M.rawSourceHash(selected.fields[0].source),assetHash:'a'.repeat(64),parserVersion:S.PARSER_VERSION},
        units=[selected,...extra],session=Context.createLookupSession({unit:selected,field:selected.fields[0],units,saved,scope},request);
    const challenge=(queries,round=1,id='synthetic-challenge-'+round)=>({id,requestId:request.requestId,requestHash:'b'.repeat(64),round,
        binding:structuredClone(session.binding),queries,expiresAt:Date.now()+15000});
    return {session,request,units,challenge};
}
const query=(recordId,sheet='ClientStrings',kind='record')=>({kind,recordId,sheet});
const fs=require('node:fs'),path=require('node:path'),apiWire=path.resolve(__dirname,'../../SDEditor-API/src/vendor/client-text-mtl-lookup.cjs');
test('API lookup wire copy is byte-identical', {skip:!fs.existsSync(apiWire)&&'Requires sibling API checkout.'},()=>{
    assert.deepEqual(fs.readFileSync(apiWire),fs.readFileSync(path.resolve(__dirname,'../public/clientTextMtlLookup.js')));
});

test('exact lookups use the full loaded scope, freeze Saved pairs and exclude draft, provisional and other-role content',()=>{
    const related=unit('HiddenByEditorFilter'),otherRole=unit('GenderOnly','ClientStrings','Gender English','Gender target','gender'),
        saved={[related.id]:{saved:true,values:{[related.fields[0].id]:'Approved {0}'}}},f=fixture([related,otherRole],saved),before=structuredClone(f.units);
    saved[related.id].values[related.fields[0].id]='Changed Saved {0}';
    const reply=f.session.reply(f.challenge([query(related.recordId),query(otherRole.recordId)]));
    assert.equal(reply.results[0].records[0].fields[0].translation,'Approved {0}');
    assert.equal(reply.results[0].records[0].fields[0].translationOrigin,'saved');assert.equal(reply.results[1].unavailable,true);
    assert.equal(reply.binding.language,'Thai');assert.deepEqual(f.units,before);
    assert.doesNotMatch(JSON.stringify(reply),/Changed Saved|Gender English|Gender target|draft|provisional/);
});

test('keyword priority and exact related dialogue retrieval do not guess roles or invent missing sheets',()=>{
    const keyword=unit('Spark','KeywordPopups','Spark definition','Approved keyword'),dialogue=unit('ExactDialogue','NPCTalkDialogueTextAudio','Related {0}','Approved {0}'),f=fixture([keyword,dialogue]);
    const first=f.session.reply(f.challenge([query('Spark','KeywordPopups','keyword'),query('ExactDialogue','NPCTalkDialogueTextAudio')]));
    assert.equal(first.results[0].records[0].fields[0].translation,'Approved keyword');
    assert.equal(first.results[1].records[0].fields[0].source,'Related {0}');
    assert.equal(first.results[1].records[0].roleHints,undefined);
    const missing=f.session.reply(f.challenge([query('Missing','Characters')],2));
    assert.deepEqual(missing.results,[{queryIndex:0,unavailable:true,truncated:false,records:[]}]);
});

test('unreviewed/conflicted/invalid translations never become approved extra context',()=>{
    for(const mode of ['stale','conflict','invalid']){
        const related=unit('Related');if(mode==='stale')related.fields[0].outdated=true;
        const saved={[related.id]:{saved:true,values:{[related.fields[0].id]:mode==='invalid'?'Broken {1}':'Saved {0}'},
            ...(mode==='conflict'?{conflicts:[{fieldId:related.fields[0].id}]}:{})}},f=fixture([related],saved),
            field=f.session.reply(f.challenge([query('Related')])).results[0].records[0].fields[0];
        assert.equal(field.source,'English {0}');assert.equal(field.translation,undefined);
    }
});

test('strict queries, two rounds, single challenge identity, expiry and every snapshot binding fence are enforced',()=>{
    const f=fixture([unit('Related')]),c=f.challenge([query('Related')]),body=f.session.reply(c);
    assert.deepEqual(f.session.reply(c),body,'the same exact challenge returns only the same frozen reply');
    for(const bad of [{...c,id:'new-challenge'}, {...c,queries:[{...query('Related'),url:'https://invalid.test'}]},
        {...c,round:2,binding:{...c.binding,language:'French'}}, {...c,binding:{...c.binding,assetHash:'d'.repeat(64)}},
        {...c,binding:{...c.binding,snapshotHash:'e'.repeat(64)}}, {...c,expiresAt:Date.now()-1}])assert.throws(()=>f.session.reply(bad));
    f.session.reply(f.challenge([query('Missing')],2));assert.throws(()=>f.session.reply(f.challenge([query('Related')],3)),/stale/);
});

test('byte/character/field limits omit whole values and report truncation without cutting protected content',()=>{
    const huge=unit('Huge','ClientStrings','x'.repeat(2049),'target'),heavy=unit('Heavy','ClientStrings','['+'K'.repeat(1800)+'|label]','Approved'),f=fixture([huge,heavy]);
    const reply=f.session.reply(f.challenge([query('Huge'),query('Heavy')]));
    assert.deepEqual(reply.results[0],{queryIndex:0,unavailable:false,truncated:true,records:[]});
    assert.equal(reply.results[1].records[0].fields[0].source,heavy.fields[0].source);
    assert.equal(reply.results[1].records[0].fields[0].translation,undefined,'invalid approved token structure is excluded');
    assert.ok(Wire.bytes(reply.results)<=Wire.LIMITS.roundBytes);assert.ok(Wire.characters(reply.results)<=Wire.LIMITS.totalCharacters);
    const multibyte=unit('Thai','ClientStrings','ภ'.repeat(2000),'ท'.repeat(2000)),g=fixture([multibyte]);
    const clipped=g.session.reply(g.challenge([query('Thai')]));assert.equal(clipped.results[0].truncated,true);
    assert.deepEqual(clipped.results[0].records,[],'whole record dropped rather than splitting UTF-8 or a trusted pair');
});
