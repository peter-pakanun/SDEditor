const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const root={SDText:require('../public/sdText.js'),ClientTextState:require('../public/clientTextState.js'),ClientTextMtlState:require('../public/clientTextMtlState.js'),ClientTextMtlUI:require('../public/clientTextMtlUi.js')};
vm.runInNewContext(fs.readFileSync(require.resolve('../public/sdEditorTools.js'),'utf8'),{window:root});
const methods=root.SDEditorTools.mixin.methods;
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
