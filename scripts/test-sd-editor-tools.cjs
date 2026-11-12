const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const root={SDText:require('../public/sdText.js'),ClientTextState:require('../public/clientTextState.js'),ClientTextMtlState:require('../public/clientTextMtlState.js'),ClientTextMtlUI:require('../public/clientTextMtlUi.js')};
vm.runInNewContext(fs.readFileSync(require.resolve('../public/sdEditorTools.js'),'utf8'),{window:root});
const methods=root.SDEditorTools.mixin.methods;
root.StatDescCodec=require('../public/statDescCodec.js');root.crypto=require('node:crypto').webcrypto;

test('SD Use English never overwrites translated drafts, DNT, IME or unresolved review buffers',()=>{
  const disabled=root.SDEditorTools.mixin.computed.sdEnglishIntentDisabledReason;
  const source={translations:{English:['Source'],Thai:[]}};
  const host={editorReady:true,editorCurrentEditingDesc:source,workspaceSourceFile:()=>source,sdMtlRows:{},serializeEditorTranslations:()=>[''],editorBlocks:[{}]};
  assert.equal(disabled.call(host),'');
  host.serializeEditorTranslations=()=>['Source'];assert.equal(disabled.call(host),'');
  host.serializeEditorTranslations=()=>[' Thai '];assert.match(disabled.call(host),/must be blank or exactly match/);
  host.sdEnglishIntentActive=true;assert.equal(disabled.call(host),'','Existing approvals remain removable.');
  source.isDNT=true;assert.match(disabled.call(host),/DNT/);source.isDNT=false;
  host.getEditorRef=()=>({composing:true});assert.match(disabled.call(host),/composing/);delete host.getEditorRef;
  host.sdMtlRows={review:{status:'review'}};assert.equal(disabled.call(host),'','Retired hidden MTL records never block the ordinary workflow.');
  host.sdMtlVisible=true;assert.match(disabled.call(host),/MTL/);
});

test('SD Use English captures context through hashing and saves the whole file through the ordinary guarded save',async()=>{
  const source={filepath:'stat.txt',name:'',stats:['example'],variables:['#'],remarks:[''],translations:{English:['Source']}};
  const calls=[],host={...methods,editorCurrentEditingDesc:source,editorBlocks:[{translation:''}],_draftSession:{},
    workspaceSourceFile:()=>source,captureCollaborationContext:()=>({language:'Thai'}),collaborationContextCurrent:()=>true,
    serializeEditorTranslations(){return this.editorBlocks.map(b=>b.translation);},prepareMatchedEditorBlocks:async(english,targets)=>targets.map(translation=>({translation})),
    applyPreparedEditorBlocks(blocks){this.editorBlocks=blocks;},editorSave:async options=>{calls.push(options);return true;}};
  assert.equal(await methods.sdToggleUseEnglish.call(host),true);
  assert.deepEqual(host.serializeEditorTranslations(),['Source']);
  assert.equal(calls[0].englishIntent.protocol,'sd-use-english-v1');assert.equal(calls[0].close,false);assert.equal(calls[0].defer,false);
  host.sdEnglishIntentActive=true;assert.equal(await methods.sdToggleUseEnglish.call(host),true);assert.equal(calls[1].englishIntent,null);
  host.sdEnglishIntentActive=false;host._collaboration={};host.captureCollaborationContext=()=>({client:{contentPolicy:async()=>{host.collaborationContextCurrent=()=>false;return {statDescriptionEnglishIntent:'sd-use-english-v1'};}}});
  assert.equal(await methods.sdToggleUseEnglish.call(host),false);assert.equal(calls.length,2,'A context change cannot approve the next file.');
  host.collaborationContextCurrent=()=>true;
  host.captureCollaborationContext=()=>({client:{sdEnglishIntent:true,contentPolicy:()=>assert.fail('Cached compatible work can save while disconnected.')}});
  assert.equal(await methods.sdToggleUseEnglish.call(host),true);assert.equal(calls.length,3);
});
test('retired SD controls keep pending text separate and include only a human-accepted current source on Save',async()=>{
  const blocks=['acceptedDraft','pending','review','acceptedDraft'].map((status,index)=>({english:'English '+index,translation:'Translation '+index,status}));
  const host={...methods,editorBlocks:blocks,sdMtlScopeKey:'scope',sdToolContext:'session',sdMtlVisible:false,mtlUiEnabled:false,sdMtlRows:{}};
  host._sdReviewLoad=Promise.resolve().then(()=>{
    for(const [index,block] of blocks.entries()){
      const field=host.sdField(index),key=host.sdKey(field);
      host.sdMtlRows[key]={key,status:block.status,sourceHash:root.SDText.hash(index===3?'Earlier source':block.english),requestId:'request'+index,revision:3,provenance:{provider:'historical'},reviewText:'Separate candidate'};
    }
  });
  const lines=blocks.map(block=>block.translation);
  const claims=await host.sdSaveClaims(lines);
  assert.deepEqual([...claims].map(c=>[c.requestId,c.revision,c.text]),[['request0',3,lines[0]]]);
  assert.equal(host.sdRow(host.sdField(0)),null);assert.equal(host.sdValue(host.sdField(2)),lines[2]);
  assert.equal(host.sdMtlRows[host.sdKey(host.sdField(1))].status,'pending');
});
test('SD and ClientText use exactly the same MTL button visibility policy',()=>{
  const getter=root.SDEditorTools.mixin.computed.sdMtlVisible;
  for(const role of ['translator','manager','admin'])for(const language of [null,'Thai','all'])for(const cloudSignedIn of [false,true]){
    const host={cloudSignedIn,cloudUser:{role,language,isAdmin:role==='admin'}};
    assert.equal(getter.call(host),root.ClientTextMtlUI.visible(host));
  }
});
test('SD context includes approved keyword evidence and committed same-stat examples without drafts',async()=>{
  const file={filepath:'stat.txt',stats:['damage'],variables:['1|#','-#|-1'],translations:{English:['Damage {0} [Life]','Reduced {0} [Life]'],Thai:['เก่า {0} [Life|พลังชีวิต]','ลด {0} [Life|พลังชีวิต]']}};
  const field={index:0,column:null,target:{english:file.translations.English[0],translation:'DRAFT_CANARY'}};
  const host={sdToolContext:'fixed',editorCurrentEditingDesc:file,workspaceSourceFile:()=>file,getActiveDictionaryEntries:()=>[{find:'Damage',replace:'ความเสียหาย'}],gameVersion:'poe2',lang:'Thai',
    keywordContext:async translated=>({entries:new Map([['Life',translated?{title:'พลังชีวิต',content:'พลังชีวิตสูงสุด'}:{title:'Life',content:'Maximum Life'}]])})};
  const packet=await methods.sdContext.call(host,field);
  assert.equal(packet.keywords[0].translation.title,'พลังชีวิต');assert.equal(packet.examples[0].translation,file.translations.Thai[1]);
  assert.ok(!JSON.stringify(packet).includes('DRAFT_CANARY'));assert.equal(packet.glossary[0].translation,'ความเสียหาย');
});
test('SD reference preparation cannot publish context after a scope change',async()=>{
  const file={filepath:'a.txt',translations:{English:['[Life]']}};
  const host={sdToolContext:'before',editorCurrentEditingDesc:file,workspaceSourceFile:()=>file,dictionary:[],gameVersion:'poe2',lang:'Thai',keywordContext:async()=>{host.sdToolContext='after';return {entries:new Map()};}};
  await assert.rejects(methods.sdContext.call(host,{index:0,column:null,target:{english:'[Life]'}}),/context changed/);
});
test('SD MTL cannot start while IME composition is unfinished or source exceeds the field limit',()=>{
  const field={index:0,column:null,target:{english:'Source'}},input={composing:true};
  const host={sdMtlVisible:true,sdAllowed:()=>true,sdBusy:()=>false,sdRow:()=>null,mtlConsentVersion:'mtl-v2',getEditorRef:()=>input};
  assert.equal(methods.sdCanGenerate.call(host,field),false);
  input.composing=false;assert.equal(methods.sdCanGenerate.call(host,field),true);
  field.target.english='x'.repeat(12001);assert.equal(methods.sdCanGenerate.call(host,field),false);
});
