/* Opt-in local audit. No input writes; generated exports stay in memory.
 * node scripts/validate-clienttext-dnt.cjs poe1 path/to/workbook.xlsm */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const JSZip=require('../../SDEditor-API/node_modules/jszip');
const Codec=require('../public/clientTextCodec.js'),State=require('../public/clientTextState.js'),UI=require('../public/clientTextUi.js'),SD=require('../public/statDescCodec.js');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function check(game,filename){
    const bytes=await fs.readFile(filename),originalHash=hash(bytes),parsed=await Codec.parseWorkbook(bytes,{filename:path.basename(filename),game});
    Codec.assertGame(parsed,game);
    const host={hideDNT:true},fieldsFor=unit=>UI.mixin.methods.ctFieldsFor.call(host,unit);
    let markedFields=0,rawPrefixFields=0,markedRows=0,mixedRows=0,hiddenRows=0;
    for(const unit of parsed.units){
        const marked=unit.fields.filter(field=>field.kind!=='gender'&&UI.isDNTSource(field.source));
        if(!marked.length)continue;
        markedFields+=marked.length;markedRows++;rawPrefixFields+=marked.filter(field=>SD.computeIsDNT([field.source])).length;
        const ordinary=unit.fields.filter(field=>field.kind!=='gender'&&field.source.trim()&&!marked.includes(field));
        if(ordinary.length)mixedRows++;else hiddenRows++;
        assert.deepEqual(fieldsFor(unit),ordinary.length?unit.fields.filter(field=>field.kind==='gender'||ordinary.includes(field)):[]);
        host.hideDNT=false;assert.equal(fieldsFor(unit).filter(field=>marked.includes(field)).length,marked.length);host.hideDNT=true;
    }
    const augury=parsed.units.filter(unit=>unit.sheet==='AuguryCardTiers'),auguryHidden=augury.filter(unit=>!fieldsFor(unit).length).length;
    if(augury.length){assert.ok(auguryHidden>0);assert.ok(auguryHidden<augury.length);}
    // Visibility and repeated toggles cannot turn a no-op export into a rewrite.
    for(let turn=0;turn<6;turn++){host.hideDNT=!!(turn%2);for(const unit of parsed.units)fieldsFor(unit);}
    assert.deepEqual(await Codec.exportWorkbook(bytes,parsed,{}),bytes);
    const selected=parsed.units.find(unit=>unit.fields.some(field=>UI.isDNTSource(field.source))),field=selected.fields.find(field=>UI.isDNTSource(field.source)),
        values={...State.valuesFor(selected),[field.id]:' DNT audit @literal\\n\r\n raw target '};
    const output=await Codec.exportWorkbook(bytes,parsed,{[selected.id]:{values}}),after=await Codec.parseWorkbook(output,{filename:path.basename(filename),game});
    const byId=new Map(after.units.map(unit=>[unit.id,unit]));
    for(const unit of parsed.units){const actual=byId.get(unit.id);assert.ok(actual);assert.equal(actual.fields.length,unit.fields.length);
        for(let index=0;index<unit.fields.length;index++){const before=unit.fields[index],next=actual.fields[index];
            assert.equal(next.id,before.id);assert.equal(next.source,before.source);assert.equal(next.sourceCell,before.sourceCell);assert.equal(next.targetCell,before.targetCell);
            assert.equal(next.target,unit===selected&&before===field?values[field.id]:before.target);
        }
    }
    const originalZip=await JSZip.loadAsync(bytes),exportedZip=await JSZip.loadAsync(output),sheet=parsed.sheets.find(sheet=>sheet.name===selected.sheet);
    assert.deepEqual(Object.keys(exportedZip.files).sort(),Object.keys(originalZip.files).sort());let untouchedParts=0;
    for(const entry of Object.values(originalZip.files))if(!entry.dir&&entry.name!==sheet.path&&entry.name!=='xl/styles.xml'){
        assert.deepEqual(await exportedZip.file(entry.name).async('uint8array'),await entry.async('uint8array'));untouchedParts++;
    }
    assert.equal(hash(bytes),originalHash);assert.equal(hash(await fs.readFile(filename)),originalHash);
    console.log(JSON.stringify({game,filename:path.basename(filename),status:'PASS',originalHash,markedFields,rawPrefixFields,markedRows,mixedRows,hiddenRows,
        auguryRows:augury.length,auguryHidden,untouchedParts,noOpByteExact:true,allOtherFieldValuesPreserved:true}));
}
const [game,...filenames]=process.argv.slice(2);
if(!['poe1','poe2'].includes(game)||!filenames.length)throw Error('Provide poe1/poe2 and local workbook paths.');
(async()=>{for(const filename of filenames)await check(game,filename);})().catch(error=>{console.error(error);process.exitCode=1;});
