const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../public/contentAdapters.js'),S=require('../public/clientTextState.js'),TM=require('../public/translationMemory.js');
const {unit,fieldId}=require('./clienttext-storage-fixture.cjs');

const plainEntry=(name,value)=>({name,value,parts:[{text:value}]});
test('class form controls bridge exact short IDs and canonical Character paths through one catalog',()=>{
    const identities=require('../public/clientTextIdentities.js'),catalog=require('../public/clientTextPortraitCatalog.js').games.poe2.characters;
    for(const [path,[,label]]of Object.entries(catalog)){
        const form=path.split('/').at(-1);
        assert.equal(identities.characterForm(form,'poe2').label,label);
        assert.deepEqual(identities.characterForm(path,'poe2'),identities.reference(path,'poe2'));
        assert.equal(identities.reference(form,'poe2'),null,'bare form IDs stay scoped to class controls');
    }
    for(const id of ['IntFourFuture','intfour','Metadata/Characters/Dex/IntFour','constructor'])assert.equal(identities.characterForm(id,'poe2'),null);
    assert.equal(identities.characterForm('IntFour','poe1'),null);
});
const character=(recordId,source,role='normal',sourceCell='B10')=>({
    id:JSON.stringify([role,'Characters',recordId]),role,sheet:'Characters',recordId,metadata:{},
    fields:[{id:JSON.stringify(['Name',null]),name:'Name',kind:'text',source,target:'Translated label',sourceCell,targetCell:'C10'}]
});

test('Character metadata falls back to the shared game catalog while workbook labels remain primary',async()=>{
    const witch='Metadata/Characters/Int/IntFour',sorceress=witch+'b',unknown='Metadata/Characters/Int/IntFourFuture',original=unit();
    original.metadata={Character:' '+witch+',\r\n'+sorceress+'; '+unknown,Other:'Unchanged value'};
    const before=structuredClone(original),options={game:'poe2'};
    const [entry,other]=A.clienttext.referenceMetadata(original,undefined,options);
    assert.equal(entry.display,' Witch,\r\nSorceress; '+unknown);assert.equal(entry.value,original.metadata.Character);
    assert.equal(entry.parts.filter(part=>part.tooltip).length,2);
    assert.match(entry.parts.find(part=>part.text==='Witch').tooltip,/Full path: Metadata\/Characters\/Int\/IntFour\nStatic Character mapping \(poe2\)/);
    assert.deepEqual(other,plainEntry('Other','Unchanged value'));assert.deepEqual(original,before);
    assert.equal(A.clienttext.referenceMetadata(original,undefined,{game:'poe1'})[0].display,undefined,'no cross-game identity fallback');
    for(const bad of [witch.toLowerCase(),witch+'Suffix',witch+'\\n'])assert.equal(A.clienttext.referenceMetadata({...original,metadata:{Character:bad}},undefined,options)[0].display,undefined);
    const resolved=await A.clienttext.contextReferenceIndex([original,character(witch,'Workbook Witch')]);
    assert.equal(A.clienttext.referenceMetadata({...original,metadata:{Character:witch}},resolved,options)[0].display,'Workbook Witch');
    const unresolved=await A.clienttext.contextReferenceIndex([original,character(witch,''),character(witch,'Conflicting label','gender')]);
    const [fallback]=A.clienttext.referenceMetadata({...original,metadata:{Character:witch}},unresolved,options);
    assert.equal(fallback.display,'Witch');assert.match(fallback.parts[0].tooltip,/Static Character mapping/);assert.match(fallback.parts[0].tooltip,/Related matches/);
});

test('Ascendancy metadata retains exact variants, workbook precedence, separators and unknown IDs',async()=>{
    const original=unit(),options={game:'poe2'};
    original.metadata={'Ascendancy Filter':' Witch3, Witch3b; Sorceress2\r\nMercenary3, Monk3, Witch3Future',Other:'Witch3'};
    const before=structuredClone(original),[entry,other]=A.clienttext.referenceMetadata(original,undefined,options);
    assert.equal(entry.display,' Lich, Abyssal Lich; Chronomancer\r\nGemling Legionnaire, Acolyte of Chayula, Witch3Future');
    assert.equal(entry.value,original.metadata['Ascendancy Filter']);assert.deepEqual(other,plainEntry('Other','Witch3'));
    assert.match(entry.parts.find(part=>part.text==='Abyssal Lich').tooltip,/Static class variant mapping \(poe2\)/);
    const source={...character('Witch3b','Workbook Abyssal label'),sheet:'Ascendancy'},index=await A.clienttext.contextReferenceIndex([original,source]);
    assert.match(A.clienttext.referenceMetadata(original,index,options)[0].display,/Lich, Workbook Abyssal label;/);
    assert.match(A.clienttext.referenceMetadata(original,index,options)[0].parts.find(part=>part.text==='Workbook Abyssal label').tooltip,/Ascendancy!B10/);
    assert.equal(A.clienttext.referenceMetadata(original,undefined,{game:'poe1'})[0].display,undefined);
    const prohibited=A.clienttext.referenceMetadata({...original,metadata:{'Prohibited Ascendancy Filter':'Witch3, Witch3b'}},undefined,options)[0];
    assert.equal(prohibited.display,'Lich, Abyssal Lich');assert.deepEqual(original,before);
    const portraits=require('../public/clientTextPortraits.js').createResolver({game:'poe2'});
    assert.deepEqual(portraits(original),[],'variant/filter hints do not infer artwork');
});
test('ClientText context displays every populated heading in workbook order, without changing raw metadata',()=>{
    const original=unit();original.metadata={Context:'Raw <img src=x onerror=alert(1)>',Character:' path\r\nliteral\\n ',
        'Character Class':'Metadata/Characters/Str/StrFourb',Tags:'0',FutureHeading:'false',Empty:' \r\n ',Blank:'',Null:null};
    original.developerNotes='Separate note';const before=structuredClone(original);
    assert.deepEqual(A.clienttext.referenceMetadata(original),Object.entries(original.metadata).filter(([,v])=>typeof v==='string'&&v.trim()).map(([n,v])=>plainEntry(n,v)));
    assert.deepEqual(original,before);assert.deepEqual(A.clienttext.referenceMetadata(null),[]);
});
test('ClientText paths use exact immutable English with per-part source tooltips',async()=>{
    const path='Metadata/Characters/Dex/DexFourb',original=unit(),source=character(path,'Huntress');
    original.metadata={Context:'Same raw context',Character:path,'Character Class':'Metadata/Characters/Str/StrFourb'};
    const warrior=character(original.metadata['Character Class'],'Warrior','normal','B8'),units=[source,warrior,original],before=structuredClone(units);
    const index=await A.clienttext.contextReferenceIndex(units),references=A.clienttext.referenceMetadata(original,index);
    assert.equal(index.get(path)[0].unit,source);assert.equal(index.get(path)[0].fields[0],source.fields[0]);
    assert.deepEqual(references[0],plainEntry('Context','Same raw context'));assert.equal(references[1].value,path);
    assert.equal(references[1].display,'Huntress');assert.match(references[1].parts[0].tooltip,/English Name: Huntress/);
    assert.ok(references[1].parts[0].tooltip.includes(path));assert.match(references[1].parts[0].tooltip,/Characters!B10 \(normal workbook\)/);
    assert.equal(references[2].display,'Warrior');assert.match(references[2].parts[0].tooltip,/Characters!B8 \(normal workbook\)/);
    assert.deepEqual(units,before);
});
test('ClientText mapping preserves commas, raw newlines, unknown paths and literal escapes',async()=>{
    const path='Metadata/Characters/Dex/DexFourb',unknown='Metadata/Characters/NPC/Unknown',original=unit(),
        raw=' \t'+path+',\r\n  '+unknown+'\n'+path+' \r\n';
    original.metadata={Character:raw};const index=await A.clienttext.contextReferenceIndex([character(path,'Huntress'),original]);
    const [entry]=A.clienttext.referenceMetadata(original,index);assert.equal(entry.value,raw);
    assert.equal(entry.display,' \tHuntress,\r\n  '+unknown+'\nHuntress \r\n');
    assert.equal(entry.parts.filter(part=>part.tooltip).length,2);
    assert.ok(entry.parts.filter(part=>part.tooltip).every(part=>part.tooltip.includes(path)));
    const unmatched='metadata/Characters/Dex/DexFourb\n'+path+'Suffix\n'+path+'\\n';
    assert.deepEqual(A.clienttext.referenceMetadata({...original,metadata:{Character:unmatched}},index),[plainEntry('Character',unmatched)]);
});
test('ClientText sparse references work with arbitrary sheets, columns and path prefixes',async()=>{
    const path='Data/Actors/Scout',original=unit();original.metadata={NewContext:'Speaker ('+path+'); missing Data/Actors/Missing.'};
    const target={...character(path,'Scout'),sheet:'FutureActors',fields:[{...character(path,'Scout').fields[0],name:'DisplayLabel'}]},
        index=await A.clienttext.contextReferenceIndex([target,character('unrelated','Other'),original]);
    assert.equal(index.size,1);const [entry]=A.clienttext.referenceMetadata(original,index);
    assert.equal(entry.display,'Speaker (Scout); missing Data/Actors/Missing.');assert.equal(entry.value,original.metadata.NewContext);
    assert.match(entry.parts.find(part=>part.tooltip).tooltip,/English DisplayLabel: Scout/);
    assert.equal((await A.clienttext.contextReferenceIndex(null)).size,0);
});
test('ClientText duplicate sheet and workbook-role IDs remain raw even when English names agree',async()=>{
    const path='Metadata/Characters/Dex/DexFourb',original=unit();original.metadata={Character:path};
    const normal=character(path,'Normal English'),gender=character(path,'Gender English','gender','C10');
    let index=await A.clienttext.contextReferenceIndex([normal,gender,original]);
    for(const role of ['normal','gender','other']){
        const [entry]=A.clienttext.referenceMetadata({...original,role},index);assert.equal(entry.display,path);
        assert.match(entry.parts[0].tooltip,/Related matches/);assert.ok(entry.parts[0].tooltip.includes('Normal English'));
        assert.ok(entry.parts[0].tooltip.includes('Gender English'));
    }
    index=await A.clienttext.contextReferenceIndex([gender,original]);
    assert.equal(A.clienttext.referenceMetadata(original,index)[0].display,'Gender English');
    index=await A.clienttext.contextReferenceIndex([normal,{...normal,sheet:'OtherActors'},original]);
    assert.equal(A.clienttext.referenceMetadata(original,index)[0].display,path);
});
test('ClientText paired gender forms sharing one English source do not duplicate tooltip provenance',async()=>{
    const path='Metadata/Characters/Dex/DexFourb',gender=character(path,'Huntress','gender','C10'),original=unit();
    gender.fields=['MS','FS','NS'].map(form=>({...gender.fields[0],id:JSON.stringify(['Name',form]),kind:'form',form}));
    original.metadata={Character:path};const [entry]=A.clienttext.referenceMetadata(original,await A.clienttext.contextReferenceIndex([gender,original]));
    assert.equal(entry.display,'Huntress');assert.match(entry.parts[0].tooltip,/Characters!C10 \(gender workbook\)/);
    assert.equal(entry.parts[0].tooltip.split('Characters!C10').length,2);
});
test('ClientText tags keep their raw IDs and match exact list items without inferring prose words',async()=>{
    const original=unit();original.metadata={Tags:' ring, crossbow, default ',Generation:'Corruption',Prose:'a ring in prose'};
    const ring={...character('ring','Rings'),sheet:'DelveCraftingTags'},crossbow={...character('crossbow','Crossbow'),sheet:'FilterSearchOptions'},
        crossbow2={...character('crossbow','[Crossbow]'),sheet:'GemTags'},corruption={...character('Corruption','Corruption Chamber'),sheet:'Incursion2Rooms'};
    const entries=A.clienttext.referenceMetadata(original,await A.clienttext.contextReferenceIndex([original,ring,crossbow,crossbow2,corruption]));
    assert.equal(entries[0].display,original.metadata.Tags);assert.equal(entries[1].display,'Corruption');
    assert.deepEqual(entries[2],plainEntry('Prose',original.metadata.Prose));
    const matches=entries[0].parts.filter(part=>part.tooltip);assert.equal(matches.length,2);assert.equal(matches[0].text,'ring');
    assert.match(matches[0].tooltip,/Related matches for: ring/);assert.ok(matches[0].tooltip.includes('Rings'));
    assert.ok(matches[1].tooltip.includes('[Crossbow]'));assert.ok(matches[1].tooltip.includes('Crossbow'));
});
test('ClientText blank, enum and paragraph labels remain raw without hiding record ambiguity',async()=>{
    const path='Data/Actors/Scout',original=unit();original.metadata={Actor:path};
    const empty=character(path,' \r\n'),gender={...character(path,'M'),fields:[{...character(path,'M').fields[0],kind:'gender'}]},
        paragraph=character(path,'Long English\nparagraph'),long=character(path,'a'.repeat(161));
    for(const targets of [[empty],[gender],[paragraph],[long],[character(path,'Scout'),{...empty,sheet:'OtherActors'}]]){
        const [entry]=A.clienttext.referenceMetadata(original,await A.clienttext.contextReferenceIndex([original,...targets]));
        assert.equal(entry.display,path);assert.match(entry.parts[0].tooltip,/Related matches/);
    }
});
test('ClientText multi-field records use the first concise worksheet source with other fields in the tooltip',async()=>{
    const path='Metadata/Characters/Dex/DexFourb',original=unit();original.metadata={Character:path};
    const record=character(path,'Huntress');record.fields.unshift(
        {...record.fields[0],id:'traits',name:'Traits Description',source:'Trait: Trained to block incoming attacks',sourceCell:'H10'},
        {...record.fields[0],id:'description',name:'Description',source:'A full English biography follows the label.',sourceCell:'E10'});
    const before=structuredClone(record),[entry]=A.clienttext.referenceMetadata(original,await A.clienttext.contextReferenceIndex([original,record]));
    assert.equal(entry.display,'Huntress');assert.match(entry.parts[0].tooltip,/English Name: Huntress/);
    assert.match(entry.parts[0].tooltip,/English Description: A full English biography/);assert.match(entry.parts[0].tooltip,/Characters!B10/);
    assert.match(entry.parts[0].tooltip,/\+1 more English fields/);assert.deepEqual(record,before);
});
test('ClientText caches only complete cooperatively prepared indexes and checks scope before cache reuse',async()=>{
    const path='Data/Actors/Scout',original=unit();original.metadata={Actor:path};const units=[original,character(path,'Scout')];
    assert.equal(A.clienttext.cachedContextReferenceIndex(units),undefined);let current=true,pauses=0;
    await assert.rejects(A.clienttext.contextReferenceIndex(units,{guard:()=>current,yield:async()=>{pauses++;current=false;}}),{name:'AbortError',stale:true});
    assert.equal(pauses,1);assert.equal(A.clienttext.cachedContextReferenceIndex(units),undefined);current=true;
    const index=await A.clienttext.contextReferenceIndex(units,{guard:()=>current});assert.equal(A.clienttext.cachedContextReferenceIndex(units),index);
    assert.equal(await A.clienttext.contextReferenceIndex(units,{yield:async()=>{throw new Error('Cached index must not yield');}}),index);
    current=false;await assert.rejects(A.clienttext.contextReferenceIndex(units,{guard:()=>current}),{name:'AbortError'});
    assert.equal(A.clienttext.cachedContextReferenceIndex([...units]),undefined);
    const other=[{...original,metadata:{Actor:path}},character(path,'Other group')];
    assert.equal(A.clienttext.referenceMetadata(other[0],await A.clienttext.contextReferenceIndex(other))[0].display,'Other group');
    assert.equal(A.clienttext.referenceMetadata(original,index)[0].display,'Scout');
});
test('ClientText related-match tooltip previews stay bounded for large matching records',async()=>{
    const original=unit();original.metadata={Tag:'match'};
    const targets=Array.from({length:6},(_,number)=>{
        const row={...character('match','English '+number+'\n'+'a'.repeat(500)),sheet:'Sheet'+number};
        row.fields.push({...row.fields[0],name:'Second',source:'Second'}, {...row.fields[0],name:'Third',source:'Third'});return row;
    });
    const [entry]=A.clienttext.referenceMetadata(original,await A.clienttext.contextReferenceIndex([original,...targets]));
    assert.equal(entry.display,'match');assert.match(entry.parts[0].tooltip,/\+2 more matching records/);
    assert.match(entry.parts[0].tooltip,/\+1 more English fields/);assert.ok(entry.parts[0].tooltip.length<2000);
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

test('Turkish Normal and Possessive memory stays independent and preserves literal NONEXISTENT',()=>{
    const original=unit('English item','unused');
    original.fields=['Normal Translation','Possessive Translation'].map((form,index)=>({
        ...original.fields[0],id:JSON.stringify(['Display Name',form]),kind:'form',name:'Display Name',form,
        target:index?'Possessive raw\r\nvalue':'  NONEXISTENT  ',targetCell:index?'D2':'C2',required:!index
    }));
    const rows=A.clienttext.memoryUnits(original,S.valuesFor(original),'Turkish',{game:'poe2'});
    assert.equal(rows.length,2);
    assert.equal(new Set(rows.map(row=>TM.identityFor(row))).size,2);
    for(const field of original.fields){
        const matches=A.clienttext.findMemory(rows,original,field,{game:'poe2',threshold:100});
        assert.equal(matches.length,1);assert.equal(matches[0].target,field.target);
        assert.equal(matches[0].unit.context.form,field.form);
    }
    const invalid={...original,fields:[{...original.fields[0],source:'Item {0}'}]};
    assert.equal(A.clienttext.memoryUnits(invalid,S.valuesFor(invalid),'Turkish').length,0);
    const ordinary={...original,fields:[{...original.fields[0],kind:'text',form:undefined}]};
    assert.equal(A.clienttext.memoryUnits(ordinary,S.valuesFor(ordinary),'Turkish').length,0);
    assert.deepEqual(A.clienttext.findMemory([{...rows[0],context:A.clienttext.contextFor(ordinary,ordinary.fields[0])}],ordinary,ordinary.fields[0]),[]);
});
