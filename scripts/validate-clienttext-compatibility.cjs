/* Opt-in local workbook audit. Reads supplied originals; exports exist only in
 * memory. Logs counts/hashes, never source or translated workbook contents.
 * node scripts/validate-clienttext-compatibility.cjs poe1 path/to/workbook.xlsm */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const JSZip=require('../../SDEditor-API/node_modules/jszip');
const Parser=require('../public/vendor/fast-xml-parser-5.11.2.min.js').default;
const Codec=require('../public/clientTextCodec.js'),State=require('../public/clientTextState.js');
const Npc=require('../public/clientTextNpcIndex.js'),Convo=require('../public/clientTextConvoIndex.js'),Audio=require('../public/clientTextAudio.js');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const parser=new Parser({ignoreAttributes:false,parseTagValue:false,trimValues:false,removeNSPrefix:true,alwaysCreateTextNode:true,htmlEntities:true});
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const withoutFill=xf=>Object.fromEntries(Object.entries(xf).filter(([key])=>!['@_fillId','@_applyFill'].includes(key)));
const withoutTab=raw=>raw.replace(/<((?:[\w.-]+:)?tabColor)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/,'')
 .replace(/<((?:[\w.-]+:)?sheetPr)([^>]*?)>\s*<\/\1>/,'<$1$2/>').replace(/<(?:[\w.-]+:)?sheetPr\s*\/>/,'');
async function check(game,filename){
 const bytes=await fs.readFile(filename),originalHash=hash(bytes),name=path.basename(filename),started=performance.now();
 const parsed=await Codec.parseWorkbook(bytes,{filename:name,game});
 assert.equal(Codec.assertGame(parsed,game),game,'Full sample has internal game evidence');
 assert.throws(()=>Codec.assertGame(parsed,game==='poe1'?'poe2':'poe1'),{code:'CLIENTTEXT_GAME_MISMATCH'});
 assert.deepEqual(await Codec.exportWorkbook(bytes,parsed,{}),bytes,'No-op export is byte-exact');
 const before=await JSZip.loadAsync(bytes),records={},selected=new Map();let editedFields=0;
 for(const sheet of parsed.sheets){
  const unit=parsed.units.find(unit=>unit.sheet===sheet.name);
  if(!unit)continue;
  const values={};for(const field of unit.fields){
   // Include intentional empty/whitespace targets and raw XML/Excel escapes.
   values[field.id]=editedFields++%3===0?'':editedFields%3===0?' \t ':'Audit \r\n_x0041_ & < > '+editedFields;
  }
  records[unit.id]={values};selected.set(sheet.path,unit);
 }
 const output=await Codec.exportWorkbook(bytes,{...parsed,units:[...selected.values()]},records),after=await JSZip.loadAsync(output);
 assert.deepEqual(Object.keys(after.files).sort(),Object.keys(before.files).sort(),'Every native package entry is retained');
 const oldStyles=parser.parse(await before.file('xl/styles.xml').async('string')).styleSheet;
 const newStyles=parser.parse(await after.file('xl/styles.xml').async('string')).styleSheet;
 const oldXfs=array(oldStyles.cellXfs.xf),newXfs=array(newStyles.cellXfs.xf);
 assert.deepEqual(newXfs.slice(0,oldXfs.length),oldXfs,'Original style records stay intact');
 assert.deepEqual(array(newStyles.fills.fill).slice(0,array(oldStyles.fills.fill).length),array(oldStyles.fills.fill));
 for(const key of Object.keys(oldStyles))if(!['cellXfs','fills'].includes(key))assert.deepEqual(newStyles[key],oldStyles[key]);
 let untouchedParts=0;
 for(const entry of Object.values(before.files)){
  if(entry.dir||entry.name==='xl/styles.xml')continue;
  const unit=selected.get(entry.name);
  if(!unit){assert.deepEqual(await after.file(entry.name).async('uint8array'),await entry.async('uint8array'),'Untouched part: '+entry.name);untouchedParts++;continue;}
  let original=await entry.async('string'),changed=await after.file(entry.name).async('string');
  for(const field of unit.fields){
   const pattern=new RegExp('<((?:[\\w.-]+:)?c)\\b[^>]*?\\br="'+field.targetCell+'"[^>]*?(?:/>|>[\\s\\S]*?</\\1\\s*>)','g');
   const cells=[...changed.matchAll(pattern)];
   if(!cells.length){assert.equal(records[unit.id].values[field.id],'','An absent unchanged blank needs no new cell');assert.equal([...original.matchAll(pattern)].length,0);continue;}
   assert.equal(cells.length,1,'Unique edited target');
   const cell=parser.parse(cells[0][0]).c;
   // An already blank cell can remain native and self-closing.
   assert.equal(String(cell.is?.t?.['#text']??'').replace(/_x([0-9a-f]{4})_/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))),records[unit.id].values[field.id],'Exact authored target');
   assert.equal(cell.f,undefined);assert.deepEqual(withoutFill(newXfs[Number(cell['@_s']||0)]),withoutFill(oldXfs[Number(field.originalStyleId)]));
   const originalCells=[...original.matchAll(pattern)];assert.ok(originalCells.length<=1);
   original=original.replace(pattern,'<validated-target/>');changed=changed.replace(pattern,originalCells.length?'<validated-target/>':'');
  }
  const oldRest=withoutTab(original),newRest=withoutTab(changed);
  assert.ok(newRest===oldRest,'Source, other targets, metadata, notes, properties and formulas remain byte-exact: '+entry.name);
 }
 const npc=await Npc.buildNpcIndex(parsed.units),convo=await Convo.buildConvoIndex(parsed.units,npc);
 const descriptors=await State.buildDescriptors(parsed.units,[{role:parsed.role,hash:parsed.artifactHash,parserVersion:parsed.parserVersion}]);
 assert.equal(descriptors.descriptors[0].unitCount,parsed.units.length);
 const dntFields=parsed.units.reduce((count,unit)=>count+unit.fields.filter(field=>/\bDNT\b/i.test(field.source)).length,0);
 const mixedDntRows=parsed.units.filter(unit=>unit.fields.some(field=>/\bDNT\b/i.test(field.source))&&unit.fields.some(field=>field.source.trim()&&!/\bDNT\b/i.test(field.source))).length;
 assert.equal(hash(await fs.readFile(filename)),originalHash,'Sample file stays unchanged');assert.equal(hash(bytes),originalHash);
 console.log(JSON.stringify({filename:name,game,status:'PASS',originalHash,sheets:parsed.sheets.length,units:parsed.units.length,
  fields:parsed.units.reduce((n,unit)=>n+unit.fields.length,0),warnings:parsed.warnings.length,editedSheets:selected.size,editedFields,untouchedParts,
  macroParts:Object.keys(before.files).filter(name=>/vbaProject\.bin$/i.test(name)).length,
  formulaCount:(await Promise.all(parsed.sheets.map(async sheet=>(await before.file(sheet.path).async('string')).match(/<(?:[\w.-]+:)?f(?:\s|>)/g)?.length||0))).reduce((a,b)=>a+b,0),
  npcGroups:npc.groups.length,conversationRows:convo.memberships.size,audioRows:parsed.units.filter(unit=>Audio.clipsFor(unit,game).length).length,
  dntFields,mixedDntRows,durationMs:Math.round(performance.now()-started)}));
}
const [game,...files]=process.argv.slice(2);
if(!['poe1','poe2'].includes(game)||!files.length)throw new Error('Provide poe1/poe2 and local workbook paths.');
(async()=>{for(const filename of files)await check(game,filename);})().catch(error=>{console.error(error);process.exitCode=1;});
