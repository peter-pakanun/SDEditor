const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const S=require('../public/clientTextState.js');
const {unit,fieldId,asset}=require('./clienttext-storage-fixture.cjs');
test('SHA256 and canonical hashes match Node crypto including Unicode and long blocks',()=>{
    for(const text of ['', 'abc', 'ไทย é 🦁', 'A'.repeat(10000)])assert.equal(S.sha256(new TextEncoder().encode(text)),crypto.createHash('sha256').update(text).digest('hex'));
    assert.equal(S.hash({z:1,a:{b:2,a:3}}),crypto.createHash('sha256').update('{"a":{"a":3,"b":2},"z":1}').digest('hex'));
});
test('NOAUDIO exemption is exact, single, uppercase and only at the beginning',()=>{
    assert.equal(S.canonicalSource('[NOAUDIO] Source'),'Source');assert.equal(S.canonicalSource(' [NOAUDIO] Source'),'Source');
    for(const source of ['  [NOAUDIO] Source','[NOAUDIO]Source','Source [NOAUDIO]','[noaudio] Source','[NOAUDIO] [NOAUDIO] Source'])assert.equal(S.canonicalSource(source),source);
    assert.equal(S.canonicalSource('[NOAUDIO]  Source'),' Source');assert.equal(S.audioOnly(' [NOAUDIO] '),true);
    assert.equal(S.audioOnly('[NOAUDIO]\n'),false);assert.equal(S.sourceHash('[NOAUDIO] Source'),S.sourceHash('Source'));
});
test('proofs protect all original source, target, metadata, field layout and asset roles',async()=>{
    const units=[unit(),{...unit(),id:JSON.stringify(['normal','ClientStrings','other']),recordId:'other'},
        {...unit(),id:JSON.stringify(['normal','OtherSheet','third']),sheet:'OtherSheet',recordId:'third'}];
    const manifest=await S.buildManifest(units,[asset]);
    for(const original of units){const compact=manifest.units.find(row=>row.id===original.id),proof=S.proofFor(manifest,original.id);
        assert.equal(S.verifyWitness(original,compact,proof,manifest.descriptors[0]),true);
        for(const mutation of [copy=>copy.fields[0].source='changed',copy=>copy.fields[0].target='changed',copy=>copy.developerNotes='changed',copy=>copy.fields[0].sourceCell='B99']){
            const changed=structuredClone(original);mutation(changed);assert.equal(S.verifyWitness(changed,compact,proof,manifest.descriptors[0]),false);}
        assert.equal(S.verifyWitness(original,compact,{...proof,index:99},manifest.descriptors[0]),false);
    }
    assert.throws(()=>S.normalizeUnit({...unit(),fields:[unit().fields[0],unit().fields[0]]}),/Duplicate/);
    await assert.rejects(S.buildManifest([unit(),unit()],[asset]),/Duplicate/);
});
test('optional forms, marker-only and field reviews preserve overlapping workload status',()=>{
    const original=unit('Source','Existing',true);
    const form={...original.fields[0],id:'form',kind:'form',required:false,target:'',outdated:false};
    const audio={...original.fields[0],id:'audio',source:'[NOAUDIO]',target:'',outdated:true};original.fields.push(form,audio);
    assert.equal(S.statusFor(original).missing,false);assert.equal(S.statusFor(original).outdated,true);
    const saved={values:S.valuesFor(original),reviewed:{[fieldId]:S.sourceHash('Source')}};
    assert.equal(S.statusFor(original,saved).outdated,false);assert.equal(S.statusFor(original,saved).saved,true);assert.equal(S.statusFor(original,saved).revised,false);
    assert.throws(()=>S.normalizeReviewed(original,{[fieldId]:S.sourceHash('Old')}),/current/);
    assert.equal(S.suggestions(form)[0].value,'NONEXISTENT');assert.equal(S.suggestions(form,{openedByChar:'['}).some(item=>item.value==='NONEXISTENT'),false);
    assert.equal(S.suggestions(original.fields[0]).some(item=>item.value==='NONEXISTENT'),false);
});
test('source advancement retains local text, isolates real upstream conflicts, and never drops',()=>{
    const before=unit(),after=unit('Changed English','Changed upstream');
    const result=S.carryForward(before,after,{values:{[fieldId]:'Local correction'},reviewed:{[fieldId]:S.sourceHash('Source')}});
    assert.equal(result.values[fieldId],'Changed upstream');assert.equal(result.conflicts[0].local,'Local correction');assert.equal(result.conflicts.length,1);assert.deepEqual(result.outdated,[fieldId]);assert.deepEqual(result.dropped,[]);
    const audio=S.carryForward(before,unit('[NOAUDIO] Source'),{values:{[fieldId]:'Local correction'},reviewed:{[fieldId]:S.sourceHash('Source')}});
    assert.deepEqual(audio.outdated,[]);assert.equal(audio.reviewed[fieldId],S.sourceHash('Source'));
    assert.equal(S.carryForward(before,after,null).values[fieldId],'Changed upstream');
});
test('ClientText raw values retain @, literal backslash-n and actual line breaks',()=>{
    const text='mail@example.com \\n\nActual line';const original=unit(text,text);
    assert.equal(S.valuesFor(original)[fieldId],text);assert.equal(S.normalizeValues(original,{[fieldId]:text})[fieldId],text);
    const field={...original.fields[0],source:'[Keyword|Text] {0} <size:16>'};
    assert.equal(S.diagnose(field,'[Keyword|คำ] {0} <size:16>').length,0);
    assert.ok(S.diagnose(field,'[Keyword').some(item=>item.level==='error'));
    assert.deepEqual(S.diagnose({...field,kind:'form'},'NONEXISTENT'),[]);
});
test('nested localizable formatting braces are separate from immutable numeric and double-angle substitutions',()=>{
    const source="<<ExpedRuneFire>><rgb(219,217,206)>{Fire Rune}\n<font:'fontin'>{<italic>{<rgb(110,87,66)>{Monsters gain:}}}\n<rgb(135,134,253)>{Extra Fire Damage} {0:+d}";
    const translated="<<ExpedRuneFire>><rgb(219,217,206)>{รูนไฟ}\n<font:'fontin'>{<italic>{<rgb(110,87,66)>{มอนสเตอร์ได้รับ:}}}\n<rgb(135,134,253)>{ความเสียหายไฟเพิ่ม} {0:+d}";
    const field={...unit().fields[0],source};assert.deepEqual(S.diagnose(field,translated),[]);
    assert.ok(S.diagnose(field,translated.replace('ExpedRuneFire','ExpedRuneIce')).some(item=>item.level==='error'));
    assert.ok(S.diagnose(field,translated.replace('{0:+d}','{1}')).some(item=>item.level==='error'));
    assert.ok(S.diagnose(field,translated.replace('>>','>')).some(item=>item.code==='missing-closing-substitution'));
    const tokens=S.tokenize('Remember <b>{1-2} <cackle> <<keybind:open_expedition_panel>> [Skill::{0}|{1}]');
    assert.equal(tokens.filter(token=>token.kind==='variable').length,1,'Visible keyword placeholder counts, keyrange and numeric ID do not');
    assert.equal(tokens.find(token=>token.full==='<cackle>').kind,'stage-direction');
});
test('Revised is determined per field, alongside Missing/Outdated elsewhere in the same row',()=>{
    const original=unit('Source','',false);original.fields.push({...unit().fields[0],id:'complete',target:'Complete',originalMissing:false,outdated:false});
    const saved={values:{[fieldId]:'Filled',complete:'Correction'},reviewed:{}};
    const status=S.statusFor(original,saved);assert.equal(status.fields[fieldId].revised,false);assert.equal(status.fields.complete.revised,true);assert.equal(status.revised,true);
});
test('source-only review facts do not fabricate Saved or Revised work',()=>{
    const original=unit('Changed English','Upstream');
    const fact={saved:false,values:{[fieldId]:'Carried text'},reviewed:{},outdated:[fieldId]};
    const status=S.statusFor(original,fact);
    assert.equal(S.valuesFor(original,fact)[fieldId],'Carried text');
    assert.equal(status.outdated,true);assert.equal(status.saved,false);assert.equal(status.revised,false);
    assert.equal(status.fields[fieldId].saved,false);
    fact.reviewed[fieldId]=S.sourceHash(original.fields[0].source);
    assert.equal(S.statusFor(original,fact).outdated,false);assert.equal(S.statusFor(original,fact).unchanged,true);
});

test('unknown angle syntax warns without rewriting raw text, while continue controls retain identity',()=>{
    const field={...unit().fields[0],source:'Source <future-control>{Content} <continue>'},target='คำ <future-control>{เนื้อหา} <continue>';
    const issues=S.diagnose(field,target);
    assert.ok(issues.some(issue=>issue.code==='clienttext-unknown-syntax'&&issue.token==='<future-control>'&&issue.level==='warning'));
    assert.ok(!issues.some(issue=>issue.level==='error'));assert.equal(S.normalizeValues({...unit(),fields:[field]},{[fieldId]:target})[fieldId],target);
    assert.equal(S.tokenize('<continue>')[0].kind,'control');assert.equal(S.tokenize('<cackle>')[0].kind,'stage-direction');
    assert.ok(S.diagnose(field,target.replace('<continue>','')).some(issue=>issue.code==='clienttext-token-identity'&&issue.message.includes('control')));
});

test('whole form sentinels tolerate surrounding whitespace while retaining their exact raw value',()=>{
    const field={...unit().fields[0],kind:'form',required:false,source:'Value {0}'},target='  NONEXISTENT \n';
    assert.deepEqual(S.diagnose(field,target),[]);
    assert.equal(S.normalizeValues({...unit(),fields:[field]},{[fieldId]:target})[fieldId],target);
    assert.ok(S.diagnose(field,'NONEXISTENT literal text').some(issue=>issue.code==='clienttext-token-identity'));
});
