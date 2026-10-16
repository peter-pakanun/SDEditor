'use strict';
const {readFileSync}=require('node:fs');
const Codec=require('../public/clientTextCodec.js'),NPC=require('../public/clientTextNpcIndex.js'),Convo=require('../public/clientTextConvoIndex.js'),Portraits=require('../public/clientTextPortraits.js');
(async()=>{
    const filename=process.argv[2];if(!filename)throw new Error('Usage: node scripts/clienttext-portrait-coverage.cjs <workbook.xlsx>');
    const parsed=await Codec.parseWorkbook(readFileSync(filename),{filename,language:process.argv[3] || ''});
    const npcIndex=await NPC.buildNpcIndex(parsed.units),convoIndex=await Convo.buildConvoIndex(parsed.units,npcIndex),resolve=Portraits.createResolver({npcIndex,convoIndex,game:'poe2'});
    const identities=new Map(),coverageBySheet=new Map();let rowsWithContext=0,rowsWithImages=0;
    for(const unit of parsed.units){const items=resolve(unit);if(items.length)rowsWithContext++;if(items.some(item=>item.id))rowsWithImages++;
        const sheet=unit.sheet || '(no sheet)';if(!coverageBySheet.has(sheet))coverageBySheet.set(sheet,{sheet,rows:0,rowsWithContext:0,rowsWithImages:0});
        const counts=coverageBySheet.get(sheet);counts.rows++;if(items.length)counts.rowsWithContext++;if(items.some(item=>item.id))counts.rowsWithImages++;
        for(const item of items){if(!identities.has(item.key))identities.set(item.key,{name:item.name,portraitId:item.id || null,rows:0,paths:item.paths});identities.get(item.key).rows++;}}
    const kind=item=>item.paths.every(path=>/^Metadata\/Characters\/(?:Str|Int|Dex|StrDex|DexInt|StrInt)\/(?:Str|Int|Dex|StrDex|DexInt|StrInt)Fourb?$/.test(path))?'class'
        :item.paths.every(path=>path.startsWith('Metadata/NPC/Info/'))?'info-reference'
        :item.paths.every(path=>path.startsWith('Metadata/Terrain/'))?'terrain-reference':'npc-or-actor';
    const items=[...identities.values()].map(item=>({...item,pathKind:kind(item)})),pathKinds={};
    for(const item of items)pathKinds[item.pathKind]=(pathKinds[item.pathKind] || 0)+1;
    console.log(JSON.stringify({workbook:filename,rows:parsed.units.length,npcGroups:npcIndex.groups.length,rowsWithContext,rowsWithImages,
        uniqueIdentities:identities.size,referencedSourcePaths:new Set(items.flatMap(item=>item.paths)).size,pathKinds,
        coverageBySheet:[...coverageBySheet.values()].sort((a,b)=>b.rows-a.rows),
        mappedIdentities:items.filter(item=>item.portraitId),missingIdentities:items.filter(item=>!item.portraitId)},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
