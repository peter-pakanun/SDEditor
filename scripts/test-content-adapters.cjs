const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../public/contentAdapters.js'),S=require('../public/clientTextState.js'),TM=require('../public/translationMemory.js');
const {unit,fieldId}=require('./clienttext-storage-fixture.cjs');
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
