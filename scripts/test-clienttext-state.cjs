const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const S=require('../public/clientTextState.js');
const {unit,fieldId,asset}=require('./clienttext-storage-fixture.cjs');
const AUDIO_MARKERS=['[NOAUDIO]','[NO AUDIO]','[OLD AUDIO]','[AUDIOTEST]'];

test('sheet colours distinguish completed Missing grey from unmarked complete content and no-op saves',()=>{
    const plain=unit('English','Original'),missing=unit('English',''),id=plain.fields[0].id;
    missing.fields[0].required=true;missing.fields[0].originalMissing=true;missing.fields[0].originalFill=S.FILLS.missing;
    assert.equal(S.unitColorFor(plain),'');assert.equal(S.unitColorFor(plain,{values:S.valuesFor(plain)}),'');
    assert.equal(S.unitColorFor(missing),'missing');
    assert.equal(S.unitColorFor(missing,{values:{[id]:'Filled'}}),'filled');
    assert.equal(S.unitColorFor(missing,{values:{[id]:'  '}}),'missing');
    assert.equal(S.unitColorFor(plain,{values:{[id]:'Correction'}}),'revised');
    const outdated={...plain,fields:plain.fields.map(field=>({...field,outdated:true,originalFill:S.FILLS.outdated}))};
    assert.equal(S.unitColorFor(outdated),'outdated');
    assert.equal(S.unitColorFor(outdated,{values:S.valuesFor(outdated),reviewed:{[id]:S.sourceHash('English')}}),'reviewed');
    const optional={...plain,fields:[{...plain.fields[0],kind:'form',required:false,target:'',originalMissing:false}]};
    assert.equal(S.unitColorFor(optional),'');assert.equal(S.unitColorFor(optional,{values:S.valuesFor(optional)}),'');
    assert.equal(S.unitColorFor({...optional,fields:[{...optional.fields[0],originalFill:S.FILLS.filled}]}),'','Grey formatting on an unused optional blank is not completed workload');
    for(const fill of [null,'FFFFFF','989898','B4A7D7'])assert.equal(S.unitColorFor({...plain,fields:[{...plain.fields[0],originalFill:fill}]}),'','Other original formatting never implies completion');
    for(const color of ['filled','reviewed','revised'])assert.equal(S.unitColorFor({...plain,fields:[{...plain.fields[0],originalFill:S.FILLS[color]}]}),color,'Recognised completion fill survives original replay');
    const audio={...missing,fields:[{...missing.fields[0],source:'[NOAUDIO]',originalFill:S.FILLS.filled}]};
    assert.equal(S.unitColorFor(audio),'');
});

test('sheet colour aggregation follows every level of red, orange, purple, green, grey, no colour',()=>{
    const keys=S.SHEET_COLORS.filter(Boolean),counts=S.emptyColorCounts();
    assert.equal(S.sheetColorFor(counts),'');
    for(const key of [...keys].reverse()){counts[key]++;assert.equal(S.sheetColorFor(counts),key);}
    for(const key of keys){counts[key]--;assert.equal(S.sheetColorFor(counts),keys[keys.indexOf(key)+1]||'');}
});
function sdKeywordDiagnostics(source,target){
    const context=vm.createContext({}),code=fs.readFileSync(path.join(__dirname,'../public/index.js'),'utf8');
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/regexEngine.js'),'utf8'),context);
    const methods=['splitLinesWithOffsets','extractKeywordPopupIdentityTags','countKeywordPopupIdentityTags','formatKeywordPopupIdentityCounts','findKeywordPopupTagNameMismatchRange','buildKeywordPopupTagNameDiagnostics']
        .map(name=>{const start=code.indexOf('    '+name+'('),end=code.indexOf('\n    },',start);assert.ok(start>=0 && end>start,name);return code.slice(start,end+7);});
    context.source=source;context.target=target;
    return JSON.parse(vm.runInContext('JSON.stringify(({'+methods.join('\n')+'}).buildKeywordPopupTagNameDiagnostics(source,target))',context));
}
test('SHA256 and canonical hashes match Node crypto including Unicode and long blocks',()=>{
    for(const text of ['', 'abc', 'ไทย é 🦁', 'A'.repeat(10000)])assert.equal(S.sha256(new TextEncoder().encode(text)),crypto.createHash('sha256').update(text).digest('hex'));
    assert.equal(S.hash({z:1,a:{b:2,a:3}}),crypto.createHash('sha256').update('{"a":{"a":3,"b":2},"z":1}').digest('hex'));
});
test('trusted descriptors describe original bytes and parser authority without any corpus fingerprints or trees',async()=>{
    const originals=[unit(),{...unit('[NOAUDIO]',''),id:JSON.stringify(['normal','ClientStrings','Audio']),recordId:'Audio',fields:[{...unit().fields[0],source:'[NOAUDIO]',target:'',required:true,originalMissing:true,outdated:true}]}];
    const result=await S.buildDescriptors(originals,[asset]);
    assert.equal(result.storageProtocol,'clienttext-trusted-v1');assert.equal(result.units,undefined);assert.equal(result.trees,undefined);
    assert.equal(result.descriptors[0].format,S.TRUSTED_FORMAT);assert.equal(result.descriptors[0].root,undefined);assert.equal(result.descriptors[0].unitCount,2);
    const {baselineId,...identity}=result.descriptors[0];assert.equal(baselineId,S.hash(identity));
    assert.deepEqual(result.summaries.normal,{...S.emptySummary(),loaded:2,eligible:1,fields:1});
    const v1=await S.buildDescriptors(originals,[{...asset,parserVersion:'clienttext-v1'}]);assert.notEqual(v1.descriptors[0].baselineId,baselineId);
    assert.notEqual(S.originalCacheKey(asset.hash,'clienttext-v1','normal'),S.originalCacheKey(asset.hash,'clienttext-v2','normal'));
    assert.notEqual(S.originalCacheKey(asset.hash,'clienttext-v2','normal'),S.originalCacheKey(asset.hash,'clienttext-v2','gender'));
    assert.notEqual(S.originalCacheKey(asset.hash,'clienttext-v2','normal'),S.originalCacheKey(asset.hash,'clienttext-v2','normal',{schemaHash:'b'.repeat(64)}));
    await assert.rejects(S.buildDescriptors([unit(),unit()],[asset]),/duplicate/i);
    await assert.rejects(S.buildDescriptors([unit()],[{...asset,parserVersion:'future'}]),/cache identity/);
});
test('sparse trusted facts preserve source reviews and original raw target fingerprints without retaining full witnesses',()=>{
    const original=unit(' [NOAUDIO] Raw  English\n',' @raw\\n target\r\n '),facts=S.clientFacts(original);
    assert.equal(facts.hash,undefined);assert.equal(facts.developerNotes,undefined);assert.equal(facts.fields[0].source,undefined);
    assert.deepEqual(facts.fields,S.compactUnit(original).fields);
    assert.equal(facts.fields[0].originalHash,S.hash(original.fields[0].target));
    assert.equal(facts.fields[0].sourceHash,S.sourceHash(original.fields[0].source));
    assert.deepEqual(S.originalValues(original),{[fieldId]:original.fields[0].target});
    const marked=unit('Source','',true),summary=S.addOriginalSummary(S.emptySummary(),marked);
    assert.equal(summary.workloadFields,1);assert.equal(summary.missingFields,1);assert.equal(summary.outdatedFields,1);assert.equal(summary.resolvedFields,0);
});
test('audio metadata source equivalence is exact, single, uppercase and only at the beginning',()=>{
    for(const marker of AUDIO_MARKERS){
        for(const source of [marker+' Source',' '+marker+' Source'])assert.equal(S.canonicalSource(source),'Source');
        assert.equal(S.canonicalSource(marker),'');assert.equal(S.canonicalSource(' '+marker+' '),'');
        assert.equal(S.canonicalSource(marker+'  Source'),' Source','remove only one following separator');
        for(const source of ['  '+marker+' Source',marker+'Source','Source '+marker,marker.toLowerCase()+' Source',
            '\t'+marker+' Source',marker+'\tSource',marker+'\nSource',marker.slice(0,-1)+'|Display] Source'])
            assert.equal(S.canonicalSource(source),source);
        for(const repeated of AUDIO_MARKERS)assert.equal(S.canonicalSource(marker+' '+repeated+' Source'),marker+' '+repeated+' Source');
    }
    for(const source of ['[AUDIO] Source','[AUDIOFUTURE] Source','[OLD AUDIO EXTRA] Source'])assert.equal(S.canonicalSource(source),source);
    assert.equal(S.audioOnly(' [NOAUDIO] '),true);assert.equal(S.audioOnly('[NOAUDIO]\n'),false);
    for(const marker of AUDIO_MARKERS.slice(1))assert.equal(S.audioOnly(marker),false,'legacy marker-only workload facts remain unchanged');
});

test('audio source equivalence preserves accepted legacy fingerprints, facts and proof witnesses',async()=>{
    const cases=[['[NOAUDIO] Source','Source'],[' [NOAUDIO] Source','Source'],
        ['[NO AUDIO] Source','[NO AUDIO] Source'],['[OLD AUDIO] Source','[OLD AUDIO] Source'],['[AUDIOTEST] Source','[AUDIOTEST] Source'],
        ['[NOAUDIO] [AUDIOTEST] Source','[AUDIOTEST] Source'],['[NOAUDIO] [NO AUDIO] Source','[NO AUDIO] Source'],
        ['[AUDIOTEST] [NOAUDIO] Source','[AUDIOTEST] [NOAUDIO] Source'],['[NOAUDIO] [NOAUDIO] Source','[NOAUDIO] [NOAUDIO] Source']];
    for(const [source,legacyNormalized] of cases){
        const original=unit(source,'Thai',true),before=structuredClone(original),field=original.fields[0];
        const legacyFields=[{id:fieldId,kind:'text',sourceHash:S.hash(legacyNormalized),originalHash:S.hash('Thai'),
            required:true,originalMissing:false,outdated:true,audioOnly:false}];
        assert.equal(S.sourceHash(source),S.hash(legacyNormalized),source);
        assert.deepEqual(S.clientFacts(original).fields,legacyFields,source);
        const legacyCompact={id:original.id,role:original.role,sheet:original.sheet,recordId:original.recordId,
            hash:S.hash(S.normalizeUnit(original)),fields:legacyFields};
        for(const parserVersion of ['clienttext-v1','clienttext-v2']){
            const descriptor={format:S.FORMAT,role:'normal',assetHash:asset.hash,parserVersion,
                root:S.leafHash(original.id,legacyCompact.hash),unitCount:1};
            assert.equal(S.verifyWitness(original,legacyCompact,{index:0,siblings:[]},descriptor),true,source+' / '+parserVersion);
        }
        assert.deepEqual(original,before);assert.equal(field.source,source);
    }
    for(const marker of AUDIO_MARKERS.slice(1)){
        const original=unit(marker,''),facts=S.clientFacts(original).fields[0];
        assert.equal(facts.sourceHash,S.hash(marker));assert.equal(facts.required,true);
        assert.equal(facts.originalMissing,true);assert.equal(facts.audioOnly,false);
    }
    assert.equal(S.sourceHash('[NOAUDIO] Source'),S.sourceHash('Source'));
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
test('parser revisions keep legacy proofs reproducible and commit new parsing authority separately',async()=>{
    const original=unit(), legacy=await S.buildManifest([original],[{...asset,parsed:{parserVersion:'clienttext-v1'}}]);
    const current=await S.buildManifest([original],[{...asset,parsed:{parserVersion:'clienttext-v2'}}]);
    assert.equal(legacy.descriptors[0].parserVersion,'clienttext-v1');
    assert.equal(current.descriptors[0].parserVersion,'clienttext-v2');
    assert.equal(legacy.descriptors[0].root,current.descriptors[0].root);
    assert.notEqual(legacy.descriptors[0].baselineId,current.descriptors[0].baselineId);
    for(const manifest of [legacy,current])assert.equal(S.verifyWitness(original,manifest.units[0],S.proofFor(manifest,original.id),manifest.descriptors[0]),true);
    assert.equal(S.verifyWitness(original,current.units[0],S.proofFor(current,original.id),{...current.descriptors[0],parserVersion:'future-parser'}),false);
    await assert.rejects(S.buildManifest([original],[{...asset,parsed:{parserVersion:'future-parser'}}]),/Unsupported ClientText parser/);
});
test('class variants keep independent field identities, reviews, raw text and carry-forward conflicts',()=>{
    const original=unit();original.fields=S.CLASS_FORMS.map((form,index)=>({...original.fields[0],id:JSON.stringify(['Text',form]),kind:'form',form,group:'Text',
        target:index===0?'Old class text':'',required:index===0,outdated:index===0,originalMissing:false}));
    const first=original.fields[0],second=original.fields[1],values=S.valuesFor(original);
    values[first.id]='Authored\nclass @ text \\n';values[second.id]='NONEXISTENT';
    const reviewed={[first.id]:S.sourceHash(first.source)},saved={values,reviewed};
    assert.equal(S.normalizeUnit(original).fields.length,12);
    assert.equal(S.isClassForm(first),true);assert.equal(S.isClassForm('MS'),false);assert.equal(S.isClassForm({...first,kind:'gender'}),false);
    assert.deepEqual(S.normalizeValues(original,values),values);
    assert.equal(S.statusFor(original,saved).outdated,false);
    const next=structuredClone(original);next.fields[0].source='New source';next.fields[0].target='Upstream class text';
    const carried=S.carryForward(original,next,saved);
    assert.deepEqual(carried.outdated,[first.id]);assert.equal(carried.conflicts[0].fieldId,first.id);
    assert.equal(carried.values[second.id],'NONEXISTENT');assert.deepEqual(carried.dropped,[]);
    assert.equal(S.suggestions(first).some(item=>item.value==='NONEXISTENT'),true);
    assert.equal(S.diagnose(first,'NONEXISTENT').length,0);
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
test('source changes retain optional blank variants without creating review work for unused cells',()=>{
    const before=unit();before.fields=['MS',...S.CLASS_FORMS].map(form=>({...before.fields[0],id:JSON.stringify(['Text',form]),kind:'form',form,group:'Text',target:'',required:false,outdated:false,originalMissing:false}));
    const next=structuredClone(before);for(const field of next.fields)field.source='Changed English';
    assert.deepEqual(S.carryForward(before,next,null).outdated,[]);
    const active=next.fields[1],marked=next.fields[2],red=next.fields[3],intentional=next.fields[4];
    marked.outdated=true;red.required=true;red.originalMissing=true;
    const saved={values:{[active.id]:'Accepted class translation',[intentional.id]:'NONEXISTENT'}};
    const carried=S.carryForward(before,next,saved);
    assert.deepEqual(carried.outdated,[active.id,marked.id,red.id,intentional.id]);
    assert.equal(carried.values[active.id],'Accepted class translation');assert.equal(carried.values[next.fields[0].id],'');
});
test('source advancement retains local text, isolates real upstream conflicts, and never drops',()=>{
    const before=unit(),after=unit('Changed English','Changed upstream');
    const result=S.carryForward(before,after,{values:{[fieldId]:'Local correction'},reviewed:{[fieldId]:S.sourceHash('Source')}});
    assert.equal(result.values[fieldId],'Changed upstream');assert.equal(result.conflicts[0].local,'Local correction');assert.equal(result.conflicts.length,1);assert.deepEqual(result.outdated,[fieldId]);assert.deepEqual(result.dropped,[]);
    const audio=S.carryForward(before,unit('[NOAUDIO] Source'),{values:{[fieldId]:'Local correction'},reviewed:{[fieldId]:S.sourceHash('Source')}});
    assert.deepEqual(audio.outdated,[]);assert.equal(audio.reviewed[fieldId],S.sourceHash('Source'));
    assert.equal(S.carryForward(before,after,null).values[fieldId],'Changed upstream');
});

test('audio metadata add, remove and swap carry exact current reviews without marking unchanged dialogue Outdated',()=>{
    const sources=['Dialogue',...AUDIO_MARKERS.map(marker=>marker+' Dialogue')];
    for(const beforeSource of sources)for(const afterSource of sources){
        const before=unit(beforeSource,'Thai',true),after=unit(afterSource,'Thai',true),originals=structuredClone([before,after]);
        const saved={values:{[fieldId]:'Local correction'},reviewed:{[fieldId]:S.sourceHash(beforeSource)}};
        const carried=S.carryForward(before,after,saved);
        assert.equal(carried.values[fieldId],'Local correction');assert.deepEqual(carried.outdated,[]);
        assert.equal(carried.reviewed[fieldId],S.sourceHash(afterSource));assert.equal(S.statusFor(after,carried).outdated,false);
        assert.deepEqual([before,after],originals);
        const changed=S.carryForward(before,unit(afterSource.replace('Dialogue','Changed dialogue'),'Thai',true),saved);
        assert.deepEqual(changed.outdated,[fieldId]);assert.equal(changed.reviewed[fieldId],undefined);
    }
});
test('ClientText raw values retain @, literal backslash-n and actual line breaks',()=>{
    const text='mail@example.com \\n\nActual line';const original=unit(text,text);
    assert.equal(S.valuesFor(original)[fieldId],text);assert.equal(S.normalizeValues(original,{[fieldId]:text})[fieldId],text);
    const field={...original.fields[0],source:'[Keyword|Text] {0} <size:16>'};
    assert.equal(S.diagnose(field,'[Keyword|คำ] {0} <size:16>').length,0);
    assert.ok(S.diagnose(field,'[Keyword').some(item=>item.level==='error'));
    assert.deepEqual(S.diagnose({...field,kind:'form'},'NONEXISTENT'),[]);
});

test('optional audio metadata never requires translated keyword tokens while real links and variables remain checked',()=>{
    const markers=AUDIO_MARKERS.join(' '),source=markers+' Dialogue [Fire|Fire damage] {0}%',field={...unit().fields[0],source};
    const target='Translation [Fire|Dégâts de feu] +{0}%';
    assert.deepEqual(S.diagnose(field,target),[]);
    assert.deepEqual(S.tokenize(source).filter(token=>token.kind==='audio').map(token=>token.full),AUDIO_MARKERS);
    for(const marker of AUDIO_MARKERS){
        assert.deepEqual(S.diagnose({...field,source:marker+' Dialogue'},'Translation'),[]);
        assert.deepEqual(S.diagnose({...field,source:'Dialogue'},marker+' Translation'),[]);
        assert.deepEqual(S.diagnose(field,marker+' '+target),[],'translations may retain optional audio metadata');
    }
    assert.ok(S.diagnose(field,target.replace('[Fire|Dégâts de feu]','Dégâts de feu')).some(issue=>issue.kind==='keyword'));
    assert.ok(S.diagnose(field,target.replace('+{0}%','chance')).some(issue=>issue.kind==='variable'));
    for(const tag of ['[AUDIOFUTURE]','[audiotest]','[AUDIOTEST|Display]','[OLD AUDIO EXTRA]']){
        assert.equal(S.tokenize(tag)[0].kind,'keyword');
        assert.ok(S.diagnose({...field,source:tag+' Dialogue'},'Translation').some(issue=>issue.kind==='keyword'),tag);
    }
    assert.deepEqual(S.suggestions(field,{openedByChar:'['}).map(item=>item.value),['[Fire|Fire damage]']);
    assert.equal(S.suggestions(field).some(item=>AUDIO_MARKERS.includes(item.value)),false);
    assert.equal(S.normalizeValues({...unit(),fields:[field]},{[field.id]:target})[field.id],target);
    assert.equal(field.source,source);
});

test('ClientText missing and excess keyword diagnostics follow the actual SD range, error and count policy',()=>{
    const cases=[
        ['[Fire] damage and [Cold] chance','Feu damage and [Cold|Froid] chance'],
        ['[Fire] damage','Plain translation without tags'],
        ['[Fire] damage','[Fire|Feu] and [Fire|Feu] damage'],
        ['[Fire] damage and [Cold] chance','[Fire|Feu] and [Wrong|Froid] chance'],
        ['[Fire] damage\r\n[Cold] chance','& <raw> @literal\\n\r\n[Cold|Froid] chance'],
        ['[Skill::{0}|Name] [Skill<gemlevel={2}>]','[Skill::{1}|Nom] [Skill<gemlevel={2}>]'],
        ['[Chill] or [Freeze] will [Trigger] [IceFragment|Ice Fragments]','[Chill|Frigorifier] ou [Freeze|Geler] crée [IceFragment|Fragments de glace]'],
        ['[Attack] [Attack] [Attack] [Trigger]','[Attack|Attaque] [Wrong]'],
    ];
    for(const [source,target] of cases){
        const field={...unit().fields[0],source},before=structuredClone(field),actual=S.diagnose(field,target).filter(issue=>issue.kind==='keyword'),expected=sdKeywordDiagnostics(source,target);
        assert.equal(actual.length,1);assert.equal(expected.length,1);assert.equal(actual[0].level,'error');
        assert.deepEqual({start:actual[0].start,end:actual[0].end,message:actual[0].message},{start:expected[0].start,end:expected[0].end,message:expected[0].message},target);
        assert.deepEqual(actual[0].missingTags,expected[0].missingTags,target);
        if(actual[0].start!==undefined)assert.ok(target.slice(actual[0].start,actual[0].end).startsWith('['));
        else assert.equal(Object.hasOwn(actual[0],'end'),false,'a missing counterpart cannot paint unrelated translation text');
        assert.deepEqual(field,before);assert.equal(S.normalizeValues({...unit(),fields:[field]},{[fieldId]:target})[fieldId],target);
    }
});

test('ClientText variable, format, substitution and control mismatches only annotate a relevant target token',()=>{
    const field={...unit().fields[0],source:'{0}% {0}% <size:16> <<Icon>> <continue>'},target='prefix@literal\\n\r\n{0}% <size:20> <<Other>> <continue> <continue>';
    const issues=S.diagnose(field,target).filter(issue=>issue.code==='clienttext-token-identity');
    assert.deepEqual(issues.map(issue=>[issue.kind,issue.level,target.slice(issue.start,issue.end)]),[
        ['variable','error','{0}%'],['substitution','error','<<Other>>'],['format','warning','<size:20>'],['control','error','<continue>'],
    ]);
    assert.equal(issues.find(issue=>issue.kind==='control').start,target.lastIndexOf('<continue>'));
    const absent=S.diagnose(field,'plain target').filter(issue=>issue.code==='clienttext-token-identity');
    assert.equal(absent.length,4);assert.ok(absent.every(issue=>!Object.hasOwn(issue,'start')&&!Object.hasOwn(issue,'end')));
});

test('ClientText source-only opaque syntax has no fabricated target range and categories can be explicitly disabled',()=>{
    const field={...unit().fields[0],source:'prefix <future-control> [Fire] {0} <size:16> <<Icon>> <continue>'},target='Court <future-control> [Cold] {1} <size:20> <<Other>>';
    const unknown=S.diagnose(field,target).find(issue=>issue.code==='clienttext-unknown-syntax');
    assert.equal(target.slice(unknown.start,unknown.end),'<future-control>');
    const sourceOnly=S.diagnose(field,'plain target').find(issue=>issue.code==='clienttext-unknown-syntax');
    assert.equal(sourceOnly.level,'warning');assert.equal(Object.hasOwn(sourceOnly,'start'),false);assert.equal(Object.hasOwn(sourceOnly,'end'),false);
    const options={tagSyntax:false,variables:false,keywords:false,decorations:false,substitutions:false,controls:false};
    assert.deepEqual(S.diagnose(field,target,options),[]);
    assert.deepEqual(S.diagnose(field,'  '),[sourceOnly],'intentional blanks retain the existing non-blocking opaque syntax warning');
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

test('Turkish named forms preserve raw values without grammatical-form sentinel behavior',()=>{
    const original=unit('Name {0}','Original'),fields=['Normal Translation','Possessive Translation'].map(form=>({
        ...original.fields[0],id:JSON.stringify(['Display Name',form]),name:'Display Name',kind:'form',form,group:'Display Name'
    }));
    for(const field of fields){
        assert.equal(S.isNamedForm(field),true);assert.equal(S.allowsNonexistent(field),false);
        assert.equal(S.suggestions(field).some(item=>item.value==='NONEXISTENT'),false);
        assert.ok(S.diagnose(field,'NONEXISTENT').some(issue=>issue.code==='clienttext-token-identity'));
        assert.deepEqual(S.diagnose(field,'Turkish {0}'),[]);
    }
    const raw='  literal\r\nNONEXISTENT  ',named={...original,fields};
    assert.equal(S.normalizeValues(named,{[fields[0].id]:raw,[fields[1].id]:''})[fields[0].id],raw);
    for(const form of ['MS','FS','StrFour','custom-legacy-form']){
        const field={...fields[0],form};
        assert.equal(S.isNamedForm(field),false);assert.equal(S.allowsNonexistent(field),true);
        assert.deepEqual(S.diagnose(field,'NONEXISTENT'),[]);
        assert.ok(S.suggestions(field).some(item=>item.value==='NONEXISTENT'));
    }
});

test('v1 through v4 originals retain distinct cache identities without changing legacy sparse field fingerprints',async()=>{
    const original=unit(' [NOAUDIO] Exact {0}','Raw\r\n @value\\n '),facts=S.clientFacts(original),ids=new Set(),caches=new Set();
    assert.equal(S.PARSER_VERSION,'clienttext-v4');
    assert.deepEqual(S.PARSER_VERSIONS,['clienttext-v1','clienttext-v2','clienttext-v3','clienttext-v4']);
    for(const parserVersion of S.PARSER_VERSIONS){
        const prepared=await S.buildDescriptors([original],[{...asset,parserVersion}]);
        ids.add(prepared.descriptors[0].baselineId);caches.add(S.originalCacheKey(asset.hash,parserVersion,'normal'));
        assert.deepEqual(S.clientFacts(original),facts);assert.equal(prepared.descriptors[0].parserVersion,parserVersion);
    }
    assert.equal(ids.size,4);assert.equal(caches.size,4);
    assert.equal(facts.fields[0].sourceHash,S.hash('Exact {0}'));
    assert.equal(facts.fields[0].originalHash,S.hash('Raw\r\n @value\\n '));
});

test('v4 metadata classification excludes a previous editable Gender without changing its retained source or authored evidence',()=>{
    const previous=unit('Renly','Original name'),genderId=JSON.stringify(['Gender',null]);
    previous.sheet='NPCs';previous.recordId='Metadata/NPC/Four_Act1/Renly';previous.id=JSON.stringify([previous.role,previous.sheet,previous.recordId]);
    previous.fields.push({id:genderId,name:'Gender',kind:'gender',source:'',target:'Male',required:true,
        originalMissing:false,outdated:false,sourceCell:'',targetCell:'H2',originalFill:null,originalStyleId:'0'});
    const saved={values:{[fieldId]:'Authored name',[genderId]:' Authored gender\r\n '},reviewed:{[fieldId]:S.sourceHash('Renly'),[genderId]:S.sourceHash('')},saved:true};
    const next=structuredClone(previous);next.fields=next.fields.filter(field=>field.id!==genderId);next.metadata={Gender:'Male',Act:'1'};
    const originals=structuredClone({previous,next,saved}),previousFacts=S.clientFacts(previous),previousCompact=S.compactUnit(previous);
    const carried=S.carryForward(previous,next,saved);
    assert.equal(next.id,previous.id,'A metadata change preserves workbook role, sheet and record identity');
    assert.deepEqual(carried.values,{[fieldId]:'Authored name'});
    assert.deepEqual(carried.reviewed,{[fieldId]:S.sourceHash('Renly')});
    assert.deepEqual(carried.outdated,[]);assert.deepEqual(carried.conflicts,[]);
    assert.deepEqual(carried.removed,[{field:previous.fields[1],value:saved.values[genderId]}],'Removed authored values remain separate evidence');
    assert.deepEqual(S.valuesFor(previous,saved),saved.values,'The previous interpretation still exposes its exact saved targets');
    assert.deepEqual(S.clientFacts(previous),previousFacts);assert.deepEqual(S.compactUnit(previous),previousCompact);
    assert.deepEqual(S.clientFacts(next).fields.map(field=>field.id),[fieldId]);
    assert.deepEqual(S.originalValues(next),{[fieldId]:'Original name'});
    assert.deepEqual(S.normalizeValues(next,carried.values),carried.values);assert.deepEqual(S.normalizeReviewed(next,carried.reviewed),carried.reviewed);
    assert.throws(()=>S.normalizeValues(next,saved.values),/Unknown or non-text/,'Old Gender targets cannot enter v4 saves');
    assert.throws(()=>S.normalizeReviewed(next,saved.reviewed),/current field/,'Old Gender reviews cannot enter v4 saves');
    assert.equal(S.addOriginalSummary(S.emptySummary(),previous).fields,2);assert.equal(S.addOriginalSummary(S.emptySummary(),next).fields,1);
    assert.deepEqual({previous,next,saved},originals,'Advancement leaves both originals and the previous saved snapshot unchanged');
});

test('Turkish carry-forward keeps independent form conflicts and optional blanks without fallback',()=>{
    const original=unit('Old item','unused');
    original.fields=['Normal Translation','Possessive Translation'].map((form,index)=>({
        ...original.fields[0],id:JSON.stringify(['Display Name',form]),name:'Display Name',kind:'form',form,
        target:index?'':'Base normal',required:!index,originalMissing:false,outdated:false
    }));
    const [normal,possessive]=original.fields,values={[normal.id]:'Authored normal',[possessive.id]:''};
    const saved={values,reviewed:{[normal.id]:S.sourceHash(normal.source)}},next=structuredClone(original);
    next.fields.forEach(field=>field.source='New item');next.fields[0].target='Incoming normal';
    const carried=S.carryForward(original,next,saved);
    assert.deepEqual(carried.conflicts,[{fieldId:normal.id,base:'Base normal',local:'Authored normal',upstream:'Incoming normal'}]);
    assert.deepEqual(carried.values,{[normal.id]:'Incoming normal',[possessive.id]:''});
    assert.deepEqual(carried.outdated,[normal.id]);assert.deepEqual(carried.reviewed,{});
    next.fields[1].outdated=true;
    const marked=S.carryForward(original,next,saved),status=S.statusFor(next,marked);
    assert.equal(status.fields[possessive.id].missing,false);assert.equal(status.fields[possessive.id].outdated,true);
    const populated={...saved,values:{...values,[possessive.id]:'  Independent possessive\r\n '}};
    const independent=S.carryForward(original,next,populated);
    assert.equal(independent.values[possessive.id],populated.values[possessive.id]);
    assert.deepEqual(independent.outdated,[normal.id,possessive.id]);assert.equal(independent.conflicts.length,1);
});

test('ClientText variables match SD empty, numeric, sign, format and percent rules with exact raw offsets',()=>{
    const context=vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/regexEngine.js'),'utf8'),context);
    const source='ไทย mail@example.com @{} +{0}% -{1:+d}% {d} {:+d} {0:d}\n[Skill::{0}|Visible {2}%] [Skill<gemlevel={0}>|Level {3}] <white>{{Damage {4}%}} literal\\n{5}';
    const expected=Array.from(context.extractGGGVarTags(source),({full,start,end})=>({full,start,end}));
    const actual=S.extractVariables(source);
    assert.deepEqual(actual.map(({full,start,end})=>({full,start,end})),expected);
    for(const token of actual){
        assert.equal(source.slice(token.start,token.end),token.full);
        assert.equal(token.key,context.getGggVarIdentityKey(token.full));
        assert.equal(S.variableIdentityKey(token.full),token.key);
        assert.equal(token.identity,'{'+token.key+'}'+(token.trailingPercent?'%':''));
    }
    assert.deepEqual(actual[0],{full:'@{}',start:source.indexOf('@{}'),end:source.indexOf('@{}')+3,
        kind:'variable',identity:'{}',key:'',prefix:'@',trailingPercent:false});
    assert.equal(actual.find(token=>token.full==='-{1:+d}%').prefix,'-');
    assert.equal(actual.find(token=>token.full==='+{0}%').trailingPercent,true);
    assert.equal(S.variableIdentityKey('ordinary text'),'ordinary text');
});

test('ClientText numeric format extension preserves float format while localizable brace bodies stay text',()=>{
    const source='{2:0.1f} seconds <b>{1-2} <rgb(219,217,206)>{Fire Rune}\n<font:\'fontin\'>{<italic>{Monsters gain:}}';
    assert.deepEqual(S.extractVariables(source).map(token=>[token.full,token.key]),[['{2:0.1f}','2:0.1f']]);
    const field={...unit().fields[0],source};
    assert.deepEqual(S.diagnose(field,'{2:0.1f} secondes <b>{1-2} <rgb(219,217,206)>{Rune de feu}\n<font:\'fontin\'>{<italic>{Les monstres gagnent :}}'),[]);
    assert.ok(S.diagnose(field,source.replace('{2:0.1f}','{2}')).some(issue=>issue.code==='clienttext-token-identity'&&issue.level==='error'));
});

test('ClientText diagnostic variable identities count repeated placeholders and percentages independently of prefix',()=>{
    const field={...unit().fields[0],source:'{} attempts {1:+d}% damage\n{1:+d}% chance {2}'};
    assert.deepEqual(S.diagnose(field,'@{} tentatives +{1:+d}% dégâts\n-{2} et -{1:+d}% chance'),[]);
    for(const target of ['{} tentatives {1:+d} dégâts\n{1:+d}% chance {2}', '{} tentatives {1:+d}% dégâts\n{2}',
        '{} tentatives {1}% dégâts\n{1:+d}% chance {2}', 'tentatives {1:+d}% dégâts\n{1:+d}% chance {2}'])
        assert.ok(S.diagnose(field,target).some(issue=>issue.code==='clienttext-token-identity'&&issue.level==='error'),target);
});

test('keyword ID braces are immutable reference metadata and display variables retain their own offsets',()=>{
    const source='[Skill::{0}|Name {1}%] [Skill_2<gemlevel={12}>|Level {}] [Bare]';
    const field={...unit().fields[0],source};
    assert.deepEqual(S.extractVariables(source).map(token=>token.full),['{1}%','{}']);
    assert.deepEqual(S.diagnose(field,'[Skill::{0}|Nom +{1}%] [Skill_2<gemlevel={12}>|Niveau {}] [Bare]'),[]);
    assert.ok(S.diagnose(field,source.replace('::{0}','::{1}')).some(issue=>issue.code==='clienttext-token-identity'&&issue.level==='error'));
    assert.ok(S.diagnose(field,source.replace('Name {1}%','Nom')).some(issue=>issue.code==='clienttext-token-identity'&&issue.level==='error'));
    for(const identity of ['Skill:{0}','Skill:::{0}','Skill::{d}','Skill::{0}%','Skill<gemlevel={d}>','Skill<gemlevel={0}>suffix','Skill{{0}}']){
        const malformed='['+identity+'|Name]';
        assert.ok(S.diagnose({...field,source:malformed},malformed).some(issue=>issue.code==='nested-tags'),identity);
    }
});

test('brace and bracket completion preserve SD-style full syntax, display text and exact prefixes',()=>{
    const source='[NOAUDIO] @{} +{0}% -{1:+d}% [Skill::{0}|Nom {2}%] [Skill<gemlevel={3}>|Name] [Bare]';
    const field={...unit().fields[0],source};
    const braces=S.suggestions(field,{openedByChar:'{'}).map(item=>item.value);
    assert.deepEqual(braces,['{}','{0}%','{1:+d}%','{2}%']);
    const brackets=S.suggestions(field,{openedByChar:'['}).map(item=>item.value);
    assert.deepEqual(brackets,['[Skill::{0}|Nom {2}%]','[Skill<gemlevel={3}>|Name]','[Bare]']);
    assert.equal(brackets.some(value=>value.includes('NOAUDIO')),false);
    assert.ok(S.suggestions(field).some(item=>item.value==='-{1:+d}%'));
    assert.equal(S.suggestions({...field,kind:'form'},{openedByChar:'['}).some(item=>item.value==='NONEXISTENT'),false);
    assert.equal(S.suggestions({...field,kind:'form'},{openedByChar:'{'}).some(item=>item.value==='NONEXISTENT'),false);
    assert.equal(source,'[NOAUDIO] @{} +{0}% -{1:+d}% [Skill::{0}|Nom {2}%] [Skill<gemlevel={3}>|Name] [Bare]');
});

test('keyword completion follows SD pipe and multiline display grammar without accepting empty identities',()=>{
    const field={...unit().fields[0],source:'[] [|{}] [Skill::{0}|line one\nline two {1}%] [Bare|] [Other|A|B]'};
    const keywords=S.tokenize(field.source).filter(token=>token.kind==='keyword');
    assert.deepEqual(keywords.map(token=>token.full),['[Skill::{0}|line one\nline two {1}%]','[Bare|]','[Other|A|B]']);
    assert.deepEqual(S.extractVariables(field.source).map(token=>token.full),['{}','{1}%']);
    assert.deepEqual(S.suggestions(field,{openedByChar:'['}).map(item=>item.value),keywords.map(token=>token.full));
});

test('SD rarity and item formatting wrappers are recognized while nested variables remain checked',()=>{
    for(const name of ['unique','magic','rare','gem','currency','enchanted']){
        const source='<'+name+'>{{{0}}}',field={...unit().fields[0],source};
        assert.equal(S.tokenize(source)[0].kind,'format');
        assert.deepEqual(S.diagnose(field,source),[]);
        assert.deepEqual(S.extractVariables(source).map(token=>token.full),['{0}']);
        assert.ok(S.diagnose(field,source.replace('{0}','{1}')).some(issue=>issue.code==='clienttext-token-identity'&&issue.level==='error'));
    }
});

test('ClientText diagnostics accept nested modifiers, keyword display variables and localizable brace bodies',()=>{
    const originals=[
        '<i>{Outer <bold>{<underline>{<rgb(12,34,56)>{Color {0}%}}}}',
        '<italic>{{<b>{{<color:rare>{{[Skill::{7}|<u>{{Display {0}%}}]}}}}}}',
        '<font:\'fontin\'>{<italic>{[Skill<gemlevel={7}>|Name {0}]}}',
        '<b>{1-2} {Fire Rune {0}} <i>{Literal {Word} {1}}',
    ];
    for(const source of originals){
        const field={...unit().fields[0],source},before=structuredClone(field);
        assert.deepEqual(S.diagnose(field,source),[],source);
        assert.deepEqual(field,before,'diagnostics preserve the original tags');
    }
});

test('ClientText diagnostics compare inner formatting identities and recognize underline',()=>{
    const source='<i>{<underline>{Text {0}}}',field={...unit().fields[0],source};
    assert.equal(S.tokenize(source).find(token=>token.full==='<underline>').kind,'format');
    assert.deepEqual(S.diagnose(field,'<i>{<underline>{Texte {0}}}'),[]);
    const target='<i>{<b>{Texte {0}}}',issues=S.diagnose(field,target);
    assert.ok(!issues.some(issue=>issue.code==='clienttext-unknown-syntax'));
    const mismatch=issues.find(issue=>issue.code==='clienttext-token-identity' && issue.kind==='format');
    assert.ok(mismatch);assert.equal(mismatch.level,'warning');assert.equal(target.slice(mismatch.start,mismatch.end),'<b>');
});

test('ClientText added, removed and changed styling warn while preserving nested runtime tokens and raw text',()=>{
    for(const tag of ['i','italic','b','bold','u','underline','size:20',"font:'fontin'",'rgb(12,34,56)','color:rare','shadow','center']){
        const plain='Dialogue [Skill|Name] {0}% <<Icon>> <continue>',styled='<'+tag+'>{'+plain+'}',
            sourceStyled='<'+tag+'>{Source [Skill|Name] {0}% <<Icon>> <continue>}';
        for(const [source,target] of [[plain,styled],[sourceStyled,plain],[sourceStyled,'<size:24>{'+plain+'}']]){
            const field={...unit().fields[0],source},before=structuredClone(field),issues=S.diagnose(field,target);
            assert.equal(issues.length,1,tag+' '+target);assert.equal(issues[0].kind,'format');assert.equal(issues[0].level,'warning');
            if(target===plain)assert.equal(Object.hasOwn(issues[0],'start'),false);
            else assert.equal(target.slice(issues[0].start,issues[0].end),target.slice(0,target.indexOf('>')+1));
            assert.deepEqual(field,before);assert.equal(S.normalizeValues({...unit(),fields:[field]},{[fieldId]:target})[fieldId],target);
            assert.deepEqual(S.diagnose(field,target,{decorations:false}),[]);
        }
    }
    const field={...unit().fields[0],source:'Dialogue [Skill] {0}% <<Icon>> <continue>'},target='😀\r\n<i>{<u>{Texte [Wrong] {1}% <<Other>>}}';
    const issues=S.diagnose(field,target);
    assert.deepEqual(issues.map(issue=>[issue.kind,issue.level]),[
        ['keyword','error'],['variable','error'],['substitution','error'],['format','warning'],['control','error']]);
    const style=issues.find(issue=>issue.kind==='format');assert.equal(style.start,4);assert.equal(target.slice(style.start,style.end),'<i>');
});

test('ClientText nested wrappers report missing, extra and crossed closing delimiters at raw offsets',()=>{
    for(const text of ['<i>{<b>{Text {0}}','<i>{{<b>{{Text {0}}}}','<i>{[Skill|Text}]','[Skill|<i>{Text]}']){
        const field={...unit().fields[0],source:text},issues=S.diagnose(field,text,{identity:false});
        assert.ok(issues.some(issue=>issue.code==='missing-closing-tag'),text);
        if(text.includes('Skill')){
            const crossed=issues.find(issue=>issue.code==='extra-closing-tag');
            assert.ok(crossed,text);assert.match(crossed.message,/Expected [\]}] first/);
            assert.equal(crossed.end-crossed.start,1);
            assert.ok(']}'.includes(text.slice(crossed.start,crossed.end)));
        }
        assert.deepEqual(S.diagnose(field,text,{identity:false,tagSyntax:false}),[],'syntax selection remains optional');
    }
    const extra='<i>{<b>{Text}}}';
    const issue=S.diagnose({...unit().fields[0],source:extra},extra,{identity:false}).find(issue=>issue.code==='extra-closing-tag');
    assert.ok(issue);assert.equal(issue.start,extra.length-1);assert.equal(issue.end,extra.length);
});

test('ClientText keyword links cannot nest in their identity or display, including inside formatting wrappers',()=>{
    for(const text of ['[Fire [Cold]]','[Fire|Display [Cold]]','[Fire|<i>{Display [Cold|Word]}]',
        '<i>{[Fire|<bold>{Display [Cold]}]}']){
        const issues=S.diagnose({...unit().fields[0],source:text},text,{identity:false});
        const issue=issues.find(item=>item.code==='nested-tags');
        assert.ok(issue,text);assert.equal(text.slice(issue.start,issue.end),'[');
    }
});
