const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../public/sdText.js');
test('SD formatting preserves exact source aliases and double-brace delimiters',()=>{
  for(const [style,name]of [['b','bold'],['i','italic'],['u','underline']]){
    const edit=S.format('คำ','<'+name+'>{{Word}}',0,2,style);assert.equal(edit.text,'<'+name+'>{{คำ}}');
    assert.deepEqual(S.issues('<'+name+'>{{Word}}',edit.text),[]);
    const remove=S.format(edit.text,'<'+name+'>{{Word}}',edit.offset,edit.text.length-2,style);assert.equal(remove.text,'คำ');
  }
});
test('SD accepts nested formatting around variables and link display text',()=>{
  const source='<bold>{{Damage {0}% [Skill::{1}|<i>{{Skill {2}}}]}}';
  const target='<bold>{{ความเสียหาย {0}% [Skill::{1}|<i>{{สกิล {2}}}]}}';
  assert.deepEqual(S.issues(source,target),[]);
});
test('SD rejects ClientText wrappers, changed headers, missing variables and cross-column cancellation',()=>{
  for(const [source,target]of [['<b>{{Text}}','<b>{คำ}'],['<bold>{{Text}}','<b>{{คำ}}'],['{0}% more','เพิ่ม'],['{0}@{1}','{1}@{0}']])assert.ok(S.issues(source,target).length);
});
test('SD cell output cannot introduce another table column',()=>{
  assert.ok(S.issues('Damage','คำ@อื่น',{cell:true}).length);assert.deepEqual(S.issues('Damage','คำ',{cell:true}),[]);
});
test('SD context uses exact current entry metadata and matching glossary definitions only',()=>{
  const context=S.context({filepath:'stat.txt',stats:['damage'],variables:['1|#'],remarks:['local remark'],translations:{English:['Fire Damage@Cold Damage']}},0,0,[{find:'Fire',replace:'ไฟ',alts:[{find:'Cold',replace:'น้ำแข็ง'}]},{find:'Fir',replace:'wrong'},{find:'Fire Damage',replace:'other game',gameScope:'poe1'},{find:'Fire',replace:'disabled',disabled:true}],'poe2');
  assert.equal(context.entry.conditions,'1|#');assert.equal(context.identity.column,0);assert.deepEqual(context.glossary,[{source:'Fire',translation:'ไฟ'}]);
});
