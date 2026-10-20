'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const State=require('../public/clientTextState.js');
const browser={ClientTextState:State};vm.runInNewContext(fs.readFileSync(require.resolve('../public/keywordPopups.js'),'utf8'),{window:browser});
const Popup=browser.KeywordPopups;

test('identical KeywordPopups IDs remain isolated by game, account, branch, language and release',()=>{
 const {host}=fixture(),scope={...host.ctWorkspace.scope,branchId:'default',versionId:'release'};
 host.ctWorkspace.scope=scope;
 const source=(changes,title)=>({scope:{...scope,...changes},units:[row('Example',title,'body')],saved:{}});
 const wrong=[source({game:'poe1'},'other game'),source({accountId:'other'},'other account'),source({branchId:'other'},'other branch'),
  source({versionId:'old'},'old release'),source({language:'German'},'other language'),{scope:{},units:[row('Example','unscoped','body')]}];
 assert.equal(Popup.snapshot(host,wrong,true).entries.size,0);
 const own=source({},'own');
 assert.equal(Popup.snapshot(host,[...wrong,own],false).entries.get('Example').title,'English own');
 host.ctWorkspace.scope={...scope,game:'poe1'};
 const poe1=source({game:'poe1'},'one');
 assert.equal(Popup.snapshot(host,[own,poe1],false).entries.get('Example').title,'English one');
 host.ctValues={'Info Title':'Unsaved active draft'};
 assert.equal(Popup.snapshot(host,[source({game:'poe1',groupId:'sibling'},'sibling')],true).entries.get('Example').title,'Target sibling',
  'An identical unit ID in a sibling group cannot receive the active draft');
 assert.equal(Popup.snapshot(host,[poe1],true).entries.get('Example').title,'Unsaved active draft');
});
const field=(id,source,target)=>({id,name:id,kind:'text',source,target});
const row=(id,title,body)=>({id:'unit-'+id,role:'normal',sheet:'KeywordPopups',recordId:id,fields:[field('Info Title','English '+title,'Target '+title),field('Info Content','English '+body,'Target '+body)]});
function fixture(){const units=[row('Example','heading','body [Nested]'),row('Nested','nested heading','nested body')];
 const host={ctActive:true,ctCurrentUnit:units[0],ctUnits:units,ctSaved:{},ctValues:State.valuesFor(units[0]),ctWorkspace:{scope:{accountId:'test',game:'poe2',groupId:'test-source',language:'Thai'}},lang:'Thai',keywordPreviewOrigin:'scope-and-row',
 gamePreviewVarValues:{0:'Example variable'},getGamePreviewFontFamily:lang=>'Font '+lang,
 buildGamePreviewSegments:text=>({segments:[{type:'text',text}],keysOrder:[...String(text).matchAll(/\{(\d+)\}/g)].map(match=>match[1])})};return{host,units};}
const context=(host,translated)=>Popup.snapshot(host,[{units:host.ctUnits,saved:host.ctSaved,scope:host.ctWorkspace.scope}],translated);

test('sheet preview reuses the existing popup Card and Text components',()=>{
 assert.equal(Popup.SheetPreview.components['keyword-preview-card'],Popup.Card);
 assert.equal(Popup.Card.components['keyword-preview-text'],Popup.Text);
 assert.match(Popup.Card.template,/keywordPreviewTitle/);assert.match(Popup.Card.template,/keywordPreviewSeparator/);assert.match(Popup.Card.template,/keywordPreviewContent/);
});
test('typing either field immediately overlays only that record while keeping its sibling',()=>{
 const {host,units}=fixture();host.ctValues={'Info Title':'Typed [Nested|heading]'};
 assert.equal(context(host,true).entries.get('Example').title,'Typed [Nested|heading]');
 assert.equal(context(host,true).entries.get('Example').content,'Target body [Nested]');
 host.ctValues['Info Content']='Typed content [Nested]';
 const item=Popup.cardContent(host,'Example',context(host,true),{id:-2,origin:host.keywordPreviewOrigin});
 assert.equal(item.title[0].text,'Typed [Nested|heading]');assert.equal(item.content[0].text,'Typed content [Nested]');
 assert.equal(item.context.entries.get('Nested').title,'Target nested heading');
 assert.equal(units[0].fields[0].target,'Target heading');assert.equal(units[0].fields[1].target,'Target body [Nested]');
});
test('English stays immutable while translated siblings use Saved and intentional blank drafts',()=>{
 const {host,units}=fixture();host.ctSaved[units[0].id]={values:{'Info Title':'Saved heading','Info Content':'Saved body'}};host.ctValues={'Info Content':''};
 assert.equal(context(host,false).entries.get('Example').title,'English heading');assert.equal(context(host,false).entries.get('Example').content,'English body [Nested]');
 const target=context(host,true);assert.equal(target.entries.get('Example').title,'Saved heading');assert.equal(target.entries.get('Example').content,'');
 assert.match(Popup.cardContent(host,'Example',target).notice,/Missing Thai translation/);
});
test('nested keyword cards retain the opening context after record or draft changes',()=>{
 const {host,units}=fixture(),opened=context(host,true);host.ctCurrentUnit=units[1];host.ctValues={'Info Title':'Next typed heading'};
 assert.equal(Popup.cardContent(host,'Nested',opened).title[0].text,'Target nested heading');
 assert.equal(Popup.cardContent(host,'Nested',context(host,true)).title[0].text,'Next typed heading');
 assert.equal(Popup.cardContent(host,'Example',context(host,true)).title[0].text,'Target heading');
 assert.equal(opened.language,'Thai');assert.equal(context(host,false).language,'English');
});
test('partial sheets and missing keywords produce the same actionable popup notices',()=>{
 const {host}=fixture();host.ctUnits=host.ctUnits.slice(0,1);
 assert.match(Popup.cardContent(host,'Nested',context(host,true)).notice,/not found/);
 host.ctUnits=[];assert.match(Popup.cardContent(host,'Example',context(host,true)).notice,/data unavailable/);
});
test('both assembled title and content contribute preview variable keys',()=>{
 const {host}=fixture();host.ctCurrentUnit.fields[0].source='Title {0}';host.ctCurrentUnit.fields[1].source='Body {1}';host.ctValues['Info Content']='Typed {2}';
 assert.deepEqual(Array.from(Popup.mixin.computed.keywordSheetPreviewKeys.call(host)),['0','1','2']);
 host.ctCurrentUnit={sheet:'Other',fields:[]};assert.deepEqual(Array.from(Popup.mixin.computed.keywordSheetPreviewKeys.call(host)),[]);
});
