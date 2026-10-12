const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../public/contentAdapters.js'),S=require('../public/clientTextState.js'),TM=require('../public/translationMemory.js');
const {unit,fieldId}=require('./clienttext-storage-fixture.cjs');

test('ClientText reference metadata retains raw context and character paths separately from notes',()=>{
    const original=unit(),raw=' Metadata/Characters/Dex/DexFourb\r\nMetadata/Characters/Int/IntFourb\\n ',
        metadata={Context:'Raw <img src=x onerror=alert(1)>',Character:raw,'Character Class':'Metadata/Characters/Str/StrFourb',Tags:'Other retained metadata'};
    original.metadata=metadata;original.developerNotes='Separate developer note';
    const before=structuredClone(original);
    assert.deepEqual(A.clienttext.referenceMetadata(original),[
        {name:'Context',value:metadata.Context},{name:'Character',value:raw},{name:'Character Class',value:metadata['Character Class']}
    ]);
    assert.deepEqual(original,before);
    assert.deepEqual(A.clienttext.referenceMetadata({metadata:{Context:' \r\n ',Character:'','Character Class':null}}),[]);
    assert.deepEqual(A.clienttext.referenceMetadata(null),[]);
});
const character=(recordId,source,role='normal',sourceCell='B10')=>({
    id:JSON.stringify([role,'Characters',recordId]),role,sheet:'Characters',recordId,metadata:{},
    fields:[{id:JSON.stringify(['Name',null]),name:'Name',kind:'text',source,target:'Translated label',sourceCell,targetCell:'C10'}]
});
test('ClientText character references display exact immutable English Names with source cells in tooltips',()=>{
    const path='Metadata/Characters/Dex/DexFourb',source=character(path,'Huntress'),original=unit();
    original.metadata={Context:'Same raw context',Character:path,'Character Class':'Metadata/Characters/Str/StrFourb'};
    const warrior=character(original.metadata['Character Class'],'Warrior','normal','B8'),units=[source,warrior,original],before=structuredClone(units);
    const index=A.clienttext.characterReferenceIndex(units),references=A.clienttext.referenceMetadata(original,index);
    assert.equal(index.get(path)[0].unit,source);assert.equal(index.get(path)[0].field,source.fields[0]);
    assert.deepEqual(references[0],{name:'Context',value:'Same raw context'});
    assert.equal(references[1].value,path);assert.equal(references[1].display,'Huntress');
    assert.match(references[1].tooltip,/English Name: Huntress/);assert.ok(references[1].tooltip.includes(path));
    assert.match(references[1].tooltip,/Characters!B10 \(normal workbook\)/);
    assert.equal(references[2].display,'Warrior');assert.match(references[2].tooltip,/Characters!B8 \(normal workbook\)/);
    assert.deepEqual(units,before);
});
test('ClientText character references preserve multiline whitespace and unknown paths with complete raw tooltip',()=>{
    const path='Metadata/Characters/Dex/DexFourb',unknown='Metadata/Characters/NPC/Unknown',raw=' \t'+path+'\r\n  '+unknown+'\n'+path+' \r\n';
    const original=unit();original.metadata={Character:raw};
    const index=A.clienttext.characterReferenceIndex([character(path,'Huntress')]);
    const [reference]=A.clienttext.referenceMetadata(original,index);
    assert.equal(reference.value,raw);assert.equal(reference.display,' \tHuntress\r\n  '+unknown+'\nHuntress \r\n');
    assert.ok(reference.tooltip.includes(raw));assert.equal(reference.tooltip.split('English Name: Huntress').length,2);
    const unmatched='metadata/Characters/Dex/DexFourb\n'+path+'Suffix\n'+path+'\\n';
    assert.deepEqual(A.clienttext.referenceMetadata({...original,metadata:{Character:unmatched}},index),[{name:'Character',value:unmatched}]);
});
test('ClientText character indexes use only exact Characters-sheet Name source fields',()=>{
    const path='Metadata/Characters/Dex/DexFourb',valid=character(path,'Huntress');
    const wrongSheet={...valid,sheet:'NPCText'},wrongField={...valid,fields:[{...valid.fields[0],name:'Description'}]},
        empty=character(path,' \r\n'),enumField={...valid,fields:[{...valid.fields[0],kind:'gender',source:'M'}]};
    const index=A.clienttext.characterReferenceIndex([wrongSheet,wrongField,empty,enumField]);
    assert.equal(index.size,0);
    const original=unit();original.metadata={Character:path};
    assert.deepEqual(A.clienttext.referenceMetadata(original,index),[{name:'Character',value:path}]);
    assert.equal(A.clienttext.characterReferenceIndex(null).size,0);
});
test('ClientText character mapping prefers the current workbook role and rejects ambiguous fallback names',()=>{
    const path='Metadata/Characters/Dex/DexFourb',original=unit();original.metadata={Character:path};
    const normal=character(path,'Normal English','normal','B10'),gender=character(path,'Gender English','gender','C10');
    let index=A.clienttext.characterReferenceIndex([gender,normal]);
    assert.equal(A.clienttext.referenceMetadata(original,index)[0].display,'Normal English');
    assert.equal(A.clienttext.referenceMetadata({...original,role:'gender'},index)[0].display,'Gender English');
    assert.deepEqual(A.clienttext.referenceMetadata({...original,role:'other'},index),[{name:'Character',value:path}]);
    index=A.clienttext.characterReferenceIndex([gender]);
    assert.equal(A.clienttext.referenceMetadata(original,index)[0].display,'Gender English');
    const conflicting=character(path,'Different English','normal','B11');
    index=A.clienttext.characterReferenceIndex([gender,normal,conflicting]);
    assert.deepEqual(A.clienttext.referenceMetadata(original,index),[{name:'Character',value:path}]);
});
test('ClientText character mapping accepts gender forms with the same English source without arbitrary form choice',()=>{
    const path='Metadata/Characters/Dex/DexFourb',gender=character(path,'Huntress','gender','C10'),original=unit();
    gender.fields= ['MS','FS','NS'].map(form=>({...gender.fields[0],id:JSON.stringify(['Name',form]),kind:'form',form}));
    original.metadata={Character:path};
    const [reference]=A.clienttext.referenceMetadata(original,A.clienttext.characterReferenceIndex([gender]));
    assert.equal(reference.display,'Huntress');assert.match(reference.tooltip,/Characters!C10 \(gender workbook\)/);
    assert.equal(reference.tooltip.split('Characters!C10').length,2);
});
test('content adapters preserve ClientText literals and preserve legacy StatDescription TM context keys',()=>{
    const raw='Email@example.com \\n literal\nactual',original=unit(raw,raw),fields=A.clienttext.fields(original);
    assert.equal(A.forMode('ClientText'),A.clienttext);assert.equal(A.forMode('StatDescription'),A.statdescription);
    const values=A.clienttext.serialize(original,{[fieldId]:raw});assert.equal(values[fieldId],raw);
    assert.equal(A.clienttext.history(original,{values,reviewed:{}}).values[fieldId],raw);
    const legacy={filepath:'stats/a.txt',stats:['stat'],condition:'#',remarks:'',entryIndex:0};
    assert.equal(TM.canonicalContext(legacy),JSON.stringify(legacy));
    assert.equal(TM.canonicalContext({...legacy,contentMode:'statdescription'}),JSON.stringify(legacy));
    const context=A.clienttext.contextFor(original,fields[0]);
    assert.equal(TM.normalizeContext(context).contentMode,'clienttext');assert.equal(TM.normalizeContext(context).recordId,original.recordId);
});
test('ClientText memory scopes fields and forms, excludes enum/sentinel/empty entries, and preserves exact raw text',()=>{
    const raw='mail@example.com \\n literal\nactual',original=unit(raw,raw);
    original.fields.push({...original.fields[0],id:'ms',kind:'form',name:'Name',form:'MS',required:false},
        {...original.fields[0],id:'fs',kind:'form',name:'Name',form:'FS',required:false},
        {...original.fields[0],id:'enum',kind:'gender',source:'M',target:'F'},
        {...original.fields[0],id:'absent',kind:'form',form:'NS',target:'NONEXISTENT'},
        {...original.fields[0],id:'empty',kind:'form',form:'MP',target:''},
        {...original.fields[0],id:'audio',source:'[NOAUDIO]',target:''});
    const rows=A.clienttext.memoryUnits(original,S.valuesFor(original),'French',{game:'poe2'});
    assert.equal(rows.length,3);assert.equal(rows[0].source,raw);assert.equal(rows[0].target,raw);
    assert.equal(new Set(rows.map(row=>TM.identityFor(row))).size,3);
    const matches=A.clienttext.findMemory(rows,original,original.fields[1],{game:'poe2',threshold:100});
    assert.equal(matches.length,1);assert.equal(matches[0].unit.context.form,'MS');assert.equal(matches[0].score,101);
    const different=unit(raw.replace('\\n','\n'),raw);
    assert.equal(A.clienttext.findMemory(rows,different,different.fields[0],{game:'poe2',threshold:100}).length,0);
    assert.deepEqual(A.clienttext.findMemory(rows,original,original.fields[3]),[]);
});
test('ClientText memory uses its own tag diagnostic and requires reviewed outdated fields',()=>{
    const original=unit("<<ExpedRuneFire>><font:'fontin'>{Fire Rune} {0}",'',true),good="<<ExpedRuneFire>><font:'fontin'>{รูนไฟ} {0}";
    assert.equal(A.clienttext.memoryUnits(original,{[fieldId]:good},'Thai',{saved:{values:{[fieldId]:good},reviewed:{}}}).length,0);
    const reviewed={values:{[fieldId]:good},reviewed:{[fieldId]:S.sourceHash(original.fields[0].source)}};
    assert.equal(A.clienttext.memoryUnits(original,reviewed.values,'Thai',{saved:reviewed}).length,1);
    assert.equal(A.clienttext.memoryUnits(original,{[fieldId]:good.replace('{0}','{1}')},'Thai').length,0);
    assert.equal(A.clienttext.memoryUnits(original,reviewed.values,'Thai',{saved:{...reviewed,saved:false}}).length,0);
    assert.equal(A.clienttext.memoryUnits(original,reviewed.values,'Thai',{saved:{...reviewed,conflicts:[{fieldId}]}}).length,0);
});

test('unknown syntax and whitespace-wrapped NONEXISTENT are excluded from learned and suggested memory',()=>{
    const unknown=unit('Source <future-control>','คำ <future-control>');
    assert.equal(A.clienttext.memoryUnits(unknown,S.valuesFor(unknown),'Thai').length,0);
    const original=unit();original.fields[0].kind='form';original.fields[0].form='MS';original.fields[0].required=false;
    const target=' \nNONEXISTENT  ';
    assert.equal(A.clienttext.memoryUnits(original,{[fieldId]:target},'Thai').length,0);
    const record={source:original.fields[0].source,target,language:'Thai',gameScope:'poe2',context:A.clienttext.contextFor(original,original.fields[0])};
    assert.deepEqual(A.clienttext.findMemory([record],original,original.fields[0],{game:'poe2'}),[]);
});
