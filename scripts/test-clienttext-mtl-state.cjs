const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../public/clientTextState.js');
const M=require('../public/clientTextMtlState.js');
const {unit,asset,fieldId}=require('./clienttext-storage-fixture.cjs');
const descriptor={role:'normal',assetHash:asset.hash,parserVersion:S.PARSER_VERSION};
function candidate(original=unit(),overrides={}){const field=original.fields[0];return {id:'candidate-1',requestId:'request-1',unitId:original.id,fieldId:field.id,
    role:original.role,assetHash:asset.hash,parserVersion:S.PARSER_VERSION,sourceHash:S.sourceHash(field.source),rawSourceHash:M.rawSourceHash(field.source),
    generatedText:'Reviewed translation',baseTargetHash:S.hash(field.target),revision:1,status:'pending',createdAt:1,provider:'fake',model:'test',effort:'xhigh',...overrides};}
test('MTL exact source identity is distinct from legacy marker-normalized review hashes',()=>{
    const first=unit('Hello'),next=unit('[NOAUDIO] Hello'),c=candidate(first);
    assert.equal(S.sourceHash(first.fields[0].source),S.sourceHash(next.fields[0].source));
    assert.notEqual(M.rawSourceHash(first.fields[0].source),M.rawSourceHash(next.fields[0].source));
    assert.equal(M.applicable(c,first.fields[0],descriptor),true);
    for(const changed of [{...descriptor,assetHash:'b'.repeat(64)},{...descriptor,parserVersion:'clienttext-v1'},{...descriptor,role:'gender'},{...descriptor,unitId:'other'}])
        assert.equal(M.applicable(c,first.fields[0],changed),false);
    assert.equal(M.applicable(c,next.fields[0],descriptor),false);
    assert.equal(M.applicable({...c,status:'accepted'},first.fields[0],descriptor),false);
    assert.equal(M.applicable(c,first.fields[0],null),false);
});
test('only meaningful text and form fields are eligible; no markers, genders or whitespace',()=>{
    const field=unit().fields[0];
    assert.equal(M.eligible(field),true);assert.equal(M.eligible({...field,kind:'form'}),true);
    for(const changed of [{...field,kind:'gender'},{...field,source:' '},{...field,source:'[NOAUDIO]'},{...field,source:'[OLD AUDIO]'}])assert.equal(M.eligible(changed),false);
});
test('MTL validation retains structural tokens, raw controls and line-break spelling',()=>{
    const field=unit('Use @{0}% [Keyword|Name] <<icon:test>> <continue>\r\nNext\\nLast').fields[0];
    const valid='Translated @{0}% [Keyword|Localized] <<icon:test>> <continue>\r\nLine\\nEnd';
    assert.equal(M.validate(field,valid).valid,true);
    for(const text of ['',valid.replace('@{0}','{0}'),valid.replace('Keyword','Other'),valid.replace('<<icon:test>>',''),
        valid.replace('\r\n','\n'),valid.replace('\\n','\n'),valid.replace('[Keyword|Localized]','[Keyword|Localized')])
        assert.equal(M.validate(field,text).valid,false,text);
    assert.equal(M.validate(unit('<b>{Bold}').fields[0],'<i>{Translated}').valid,true,'styling differences remain warnings');
    assert.equal(M.validate(unit('[NOAUDIO] Hello').fields[0],'Translation').valid,true,'audio metadata is optional');
    assert.equal(M.validate(unit().fields[0],'x'.repeat(M.MAX_TEXT+1)).valid,false);
});
test('acceptance requires current candidate revision, raw source and exact reviewed submitted text',()=>{
    const original=unit(),c=candidate(original),text='Reviewed translation',claim=M.acceptance(c,text);
    assert.equal(M.validateAcceptances([c],original,[claim],{[fieldId]:text},descriptor)[0].candidateId,c.id);
    for(const bad of [{...claim,candidateRevision:2},{...claim,rawSourceHash:'b'.repeat(64)},{...claim,reviewedTextHash:S.hash('other')},
        {...claim,fieldId:'other'}])assert.throws(()=>M.validateAcceptances([c],original,[bad],{[fieldId]:text},descriptor),error=>error.code==='MTL_CANDIDATE_CHANGED');
    assert.throws(()=>M.validateAcceptances([c],original,[claim,claim],{[fieldId]:text},descriptor),/invalid|Duplicate/i);
    assert.throws(()=>M.validateAcceptances([{...c,status:'dismissed'}],original,[claim],{[fieldId]:text},descriptor),error=>error.code==='MTL_CANDIDATE_CHANGED');
    assert.throws(()=>M.validateAcceptances([c],unit('Changed'),[claim],{[fieldId]:text},descriptor),error=>error.code==='MTL_CANDIDATE_CHANGED');
    const blank=M.acceptance(c,'');assert.equal(M.validateAcceptances([c],original,[blank],{[fieldId]:''},descriptor)[0].reviewedTextHash,S.hash(''));
});
test('candidate identity and generated payload are immutable, with local dispositions protected from stale snapshots',()=>{
    const c=candidate(),local={...c,status:'accepted',localDisposition:true,acceptanceJobId:'save-1'};
    assert.deepEqual(M.mergeCandidate(local,c),local);
    assert.equal(M.mergeCandidate(local,{...c,status:'accepted',revision:2}).localDisposition,undefined);
    assert.throws(()=>M.mergeCandidate(c,{...c,generatedText:'Another translation',revision:2}),error=>error.code==='MTL_CANDIDATE_CHANGED');
    assert.throws(()=>M.normalizeCandidate({...c,generatedText:' '}),/translation/);
    assert.equal(Object.hasOwn(M.normalizeCandidate({...c,source:'Never persist a source catalog',token:'secret'}),'source'),false);
});
module.exports={candidate,descriptor};
