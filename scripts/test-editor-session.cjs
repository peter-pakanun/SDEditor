'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const State=require('../public/clientTextState.js');

function harness(text='First\r\nSecond\r\nThird',source='Fire [ColdDamage|Cold] {0}'){
    const calls=[],ticks=[],copied=[],window={ClientTextState:State,navigator:{clipboard:{writeText(value){copied.push(value);return Promise.resolve();}}}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/editorSession.js'),'utf8'),{window});
    const session=window.EditorSession,field={id:'text',name:'Text',kind:'text',source,targetCell:'C2',required:true},unit={id:'record',fields:[field]};
    const input={value:text.replace(/\r\n?/g,'\n'),selectionStart:0,selectionEnd:0,isConnected:true,
        focus(){calls.push('focus');},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
        setRangeText(value,start,end){this.value=this.value.slice(0,start)+value+this.value.slice(end);this.selectionStart=this.selectionEnd=start+value.length;}};
    const host={ctActive:true,ctBusy:false,ctHistoryViewer:false,ctEditor:false,ctCurrentUnit:unit,ctSelection:unit.id,ctFocusedField:field.id,
        ctWorkspace:{scope:{accountId:'alice',game:'poe2',branchId:'default',versionId:'v1',groupId:'g1',language:'Thai'}},
        ctValues:{[field.id]:text},_ctEpoch:1,gameVersion:'poe2',lang:'Thai',translationEditorBcp47:'th',dictionary:[],
        ctDictionaryTarget:()=>input,ctEdited:()=>calls.push('edited'),ctCloseCompletion:()=>calls.push('close-popup'),ctResizeField:()=>calls.push('resize'),
        ctSuggest:()=>calls.push('suggest'),ctTargetKeydown:()=>calls.push('keydown'),ctCompletionSelectionChanged:()=>calls.push('selection'),
        ctOpenHighlightDictionary:()=>calls.push('dictionary'),showTooltip:()=>calls.push('tooltip'),hideTooltip:()=>calls.push('hide-tooltip'),
        $nextTick:callback=>ticks.push(callback)};
    return {session,host,field,unit,input,window,calls,ticks,copied};
}
test('highlight ranges escape raw text and attributes, reject invalid overlap, and preserve supplied offsets',()=>{
    const {session}=harness(),text='<tag> & "quote" \'note\' [Keyword]',start=text.indexOf('[Keyword]'),ranges=[
        {start,end:text.length,className:'hl" onclick="unsafe'},
        {start:0,end:5,className:'source'},
        {start:1,end:4,className:'overlap'},
        {start:-1,end:2},{start:99,end:100},{start:5.5,end:8},{start:9,end:9}
    ],before=structuredClone(ranges),html=session.renderRanges(text,ranges);
    assert.deepEqual(ranges,before);assert.equal((html.match(/<span /g)||[]).length,2);
    assert.ok(html.includes('&lt;tag&gt;'));assert.ok(html.includes('&amp; &quot;quote&quot; &#039;note&#039;'));
    assert.ok(html.includes('class="hl&quot; onclick=&quot;unsafe"'));assert.equal(html.includes('<tag>'),false);
    assert.equal(html.replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;/g,"'"),text);
});
test('annotated overlaps escape imported text and tooltip data while retaining independent token and diagnostic ranges',()=>{
    const {session}=harness(),text='A[<unsafe>&"\']@literal\\nB',ranges=[
        {start:1,end:14,classes:['tagRange','vocab'],attrs:{'data-hl-id':'0" onclick="bad','onclick':'bad','style':'bad'}},
        {start:4,end:text.length,classes:['diagnosticRange','diagError'],message:'Unclosed <tag> & "quote"\nnext'},
        {start:NaN,end:5,classes:['invalid']},{start:0,end:Infinity,classes:['invalid']}
    ],before=structuredClone(ranges),html=session.renderAnnotatedRanges(text,ranges);
    assert.deepEqual(ranges,before);assert.ok(html.includes('class="tagRange vocab diagnosticRange diagError"'));
    assert.ok(html.includes('data-hl-id="0&quot; onclick=&quot;bad"'));
    assert.ok(html.includes('data-tooltip="Unclosed &lt;tag&gt; &amp; &quot;quote&quot;\nnext"'));
    assert.doesNotMatch(html,/<unsafe>|<tag>| onclick="| style="|class="invalid"/);
    assert.equal(html.replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;/g,"'"),text);
});
test('annotation spans never divide raw CRLF, lone CR or LF newlines from their adjacent line',()=>{
    const {session}=harness(),text='one\r\ntwo\rthree\nfour@literal\\nend',html=session.renderAnnotatedRanges(text,[
        {start:0,end:text.length,classes:['diagnosticRange'],message:'Whole-field warning'},
        {start:1,end:15,classes:['tagRange']}
    ]);
    assert.equal(html.replace(/<[^>]*>/g,''),text,'rendering preserves raw text while the browser normalizes each complete newline');
    for(const [,content] of html.matchAll(/<span[^>]*>([^<]*)<\/span>/g))assert.doesNotMatch(content,/[\r\n]/,'native newline segments remain outside annotation spans');
    assert.match(html,/<\/span>\r\n<span/);assert.match(html,/<\/span>\r<span/);assert.match(html,/<\/span>\n<span/);
});
test('raw edit mapping preserves untouched CRLF and literal @/backslash-n while keeping intentional newline edits',()=>{
    const {session}=harness(),before='one\r\ntwo@literal\\n\r\nthree';
    assert.equal(session.preserveRawEdit(before,before.replace(/\r\n/g,'\n')),before);
    assert.equal(session.preserveRawEdit(before,'one\ntwo@literal\\n changed\nthree'),'one\r\ntwo@literal\\n changed\r\nthree');
    assert.equal(session.preserveRawEdit(before,'one\nnew\nline@literal\\n\nthree'),'one\r\nnew\nline@literal\\n\r\nthree');
    assert.equal(session.preserveRawEdit('one\r\ntwo','one\r\nintentional'), 'one\r\nintentional');
    assert.equal(session.rawOffset('one\r\ntwo',4),5);assert.equal(session.rawOffset('one\r\ntwo',7),8);
});
test('raw insertion maps native selection offsets and preserves pasted CRLF without staging a save',()=>{
    const {session,host,field,input,calls,ticks}=harness();input.selectionStart=6;input.selectionEnd=12;
    const replacement='S\r\nline@\\n';assert.equal(session.insert(host,field,replacement,{input}),true);
    assert.equal(host.ctValues.text,'First\r\nS\r\nline@\\n\r\nThird');
    assert.equal(input.value,'First\nS\nline@\\n\nThird');assert.equal(calls.includes('edited'),true);
    ticks.shift()();assert.equal(input.selectionStart,'First\nS\nline@\\n'.length);assert.equal(input.selectionStart,input.selectionEnd);
    const control=session.fieldController(host,field),paste={target:input,clipboardData:{getData:()=> '\r\n@raw\\n'},preventDefault(){this.prevented=true;}};
    control.paste(paste);assert.equal(paste.prevented,true);assert.ok(host.ctValues.text.includes('\r\n@raw\\n'));
    assert.equal(Object.hasOwn(host,'ctSaved'),false);assert.equal(Object.hasOwn(host,'ctDraftDirty'),false,'controller delegates draft ownership to ctEdited');
});
test('raw insertion refuses mismatched native text and malformed raw selections before any mutation or focus action',()=>{
    for(const change of [h=>{h.input.value='different field text';},h=>{h.input.composing=true;},h=>{h.input.isConnected=false;},
        h=>{h.input.dataset={ctTarget:'another-field'};},h=>{h.input.dataset={ctSource:h.field.id};},h=>{h.input.readOnly=true;}]){
        const h=harness(),before=h.host.ctValues.text;change(h);
        assert.equal(h.session.insert(h.host,h.field,'blocked',{input:h.input}),false);assert.equal(h.host.ctValues.text,before);assert.deepEqual(h.calls,[]);
    }
    for(const [start,end] of [[-1,1],[2,1],[0,100],[1.5,2]]){
        const h=harness(),before=h.host.ctValues.text;
        assert.equal(h.session.insert(h.host,h.field,'blocked',{input:h.input,raw:true,start,end}),false);assert.equal(h.host.ctValues.text,before);assert.deepEqual(h.calls,[]);
    }
});
test('supported native insertion uses browser editing once and raw input reconciliation retains CRLF through undo within a line',()=>{
    const h=harness(),native=[],control=h.session.fieldController(h.host,h.field),original=h.input.value;
    h.input.selectionStart=6;h.input.selectionEnd=12;
    const setRangeText=h.input.setRangeText.bind(h.input);let fallback=0;h.input.setRangeText=()=>{fallback++;};
    h.window.document={execCommand(command,unused,value){native.push([command,value]);setRangeText(value.replace(/\r\n?/g,'\n'),h.input.selectionStart,h.input.selectionEnd);control.input({target:h.input});return true;}};
    assert.equal(h.session.insert(h.host,h.field,'new raw@literal\\n'),true);
    assert.deepEqual(native,[['insertText','new raw@literal\\n']]);assert.equal(fallback,0);
    assert.equal(h.host.ctValues.text,'First\r\nnew raw@literal\\n\r\nThird');
    h.input.value=original;control.input({target:h.input,inputType:'historyUndo'});
    assert.equal(h.host.ctValues.text,'First\r\nSecond\r\nThird');
});
test('native Undo and Redo recover exact raw CRLF checkpoints after replacing a whole multiline field',()=>{
    const original='First\r\nSecond@literal\\n\r\nThird',replacement='New\r\nline@literal\\n';
    const h=harness(original),control=h.session.fieldController(h.host,h.field);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/editorComponents.js'),'utf8'),{window:h.window});
    const Native=h.window.EditorComponents.NativeField,events=Native.computed.events.call({controller:control,field:control.field,source:false});
    h.window.document={execCommand(command,unused,value){h.input.setRangeText(value.replace(/\r\n?/g,'\n'),h.input.selectionStart,h.input.selectionEnd);events.input({target:h.input,inputType:'insertText'});return true;}};
    assert.equal(h.session.insert(h.host,h.field,replacement,{whole:true}),true);assert.equal(h.host.ctValues.text,replacement);
    h.input.value=original.replace(/\r\n/g,'\n');events.input({target:h.input,inputType:'historyUndo'});
    assert.equal(h.host.ctValues.text,original,'native undo restores the removed original CRLF bytes');
    h.input.value=replacement.replace(/\r\n/g,'\n');events.input({target:h.input,inputType:'historyRedo'});
    assert.equal(h.host.ctValues.text,replacement,'native redo restores pasted raw CRLF bytes');
});
test('native coalesced Undo retains multiline CRLF checkpoints beyond the ordinary input state ring',()=>{
    const original='First\r\nSecond@literal\\n\r\nThird',replacement='New\r\nline@literal\\n';
    const h=harness(original),control=h.session.fieldController(h.host,h.field);
    h.window.document={execCommand(command,unused,value){h.input.setRangeText(value.replace(/\r\n?/g,'\n'),h.input.selectionStart,h.input.selectionEnd);control.commitInput({target:h.input,inputType:'insertText'});return true;}};
    assert.equal(h.session.insert(h.host,h.field,replacement,{whole:true}),true);
    for(let index=0;index<160;index++){
        h.input.value+='x';control.commitInput({target:h.input,inputType:'insertText'});
    }
    assert.equal(h.host.ctValues.text,replacement+'x'.repeat(160));
    h.input.value=replacement.replace(/\r\n/g,'\n');control.commitInput({target:h.input,inputType:'historyUndo'});
    assert.equal(h.host.ctValues.text,replacement,'coalesced native typing undo reaches the exact pasted CRLF checkpoint');
    h.input.value=original.replace(/\r\n/g,'\n');control.commitInput({target:h.input,inputType:'historyUndo'});
    assert.equal(h.host.ctValues.text,original,'the older multiline undo checkpoint survives more than 128 ordinary edits');
    h.input.value=replacement.replace(/\r\n/g,'\n');control.commitInput({target:h.input,inputType:'historyRedo'});
    assert.equal(h.host.ctValues.text,replacement);
});
test('source modifier actions follow SD insert, copy and Dictionary navigation using exact raw token ranges',async()=>{
    const {session,host,field,calls,copied}=harness('', 'Fire [ColdDamage|Cold] {0}');
    host.ctDictionaryPack={units:[{key:field.id,english:field.source,HLs:[{rawStart:0,rawEnd:4,dictId:'fire',replace:'ไฟ',dictDefFind:'Fire'}]}]};
    host.dictionary=[{_id:'fire',replace:'ไฟ',tlnote:'Use the fire term'}];
    const control=session.fieldController(host,field,field.source),target={closest:()=>({dataset:{ctHl:'0'}})};
    control.sourceClick({target,ctrlKey:true});assert.deepEqual(calls,['dictionary']);assert.equal(host.ctValues.text,'');
    calls.length=0;control.sourceClick({target,altKey:true});await Promise.resolve();assert.equal(host.editorClipboard,'Fire');assert.deepEqual(copied,['Fire']);assert.equal(host.ctValues.text,'');
    control.sourceClick({target,metaKey:true});control.sourceClick({target,shiftKey:true});control.sourceClick({target,ctrlKey:true,altKey:true});assert.equal(host.ctValues.text,'');
    control.sourceClick({target});assert.equal(host.ctValues.text,'ไฟ');assert.ok(calls.includes('edited'));
    control.tooltip({target});assert.ok(calls.includes('tooltip'));assert.ok(control.highlight.includes('vocab'));
});

test('source highlighting rejects dictionary packs from a different exact English field while retaining raw syntax tokens',()=>{
    const {session,host,field}=harness('', 'Fire [ColdDamage|Cold] {0}');
    host.ctDictionaryPack={units:[{key:field.id,english:'Fire from another source',HLs:[{rawStart:0,rawEnd:4,dictId:'fire',replace:'Old translation'}]}]};
    const stale=session.ranges(host,field,field.source,true);assert.equal(stale.some(range=>range.dictId==='fire'),false);
    assert.ok(stale.some(range=>range.value==='[ColdDamage|Cold]'));assert.ok(stale.some(range=>range.value==='{0}'));
    host.ctDictionaryPack.units[0].english=field.source;const current=session.ranges(host,field,field.source,true);
    assert.equal(current.find(range=>range.dictId==='fire').replace,'Old translation');
    assert.equal(session.ranges(host,field,'Different field source',true).some(range=>range.dictId==='fire'),false);
});
test('field controllers stop late mutations, keyboard, highlight navigation and tooltip after scoped context replacement',()=>{
    for(const invalidate of [h=>h.host._ctEpoch++,h=>h.host.ctWorkspace.scope.accountId='bob',h=>h.host.ctWorkspace.scope.groupId='g2',
        h=>h.host.ctWorkspace.scope.language='German',h=>h.host.ctCurrentUnit={...h.unit},h=>h.unit.fields=[]]){
        const h=harness(),control=h.session.fieldController(h.host,h.field),source=h.session.fieldController(h.host,h.field,h.field.source),before=h.host.ctValues.text;
        invalidate(h);assert.equal(control.ready,false);control.field.translation='obsolete';
        const event={target:{value:'obsolete',closest:()=>({dataset:{ctHl:'0'}})},key:'1',altKey:true,clipboardData:{getData:()=> 'obsolete'},preventDefault(){throw Error('Stale paste consumed');}};
        control.input(event);control.focus(event);control.selection(event);control.keydown(event);control.paste(event);control.altKeyup(event);source.sourceClick(event);source.tooltip(event);
        assert.equal(h.host.ctValues.text,before);assert.deepEqual(h.calls,[]);
    }
});
test('delayed insertion refocus cannot reclaim focus after another field or workspace replaces its captured target',()=>{
    for(const invalidate of [h=>h.host.ctFocusedField='different',h=>h.host.ctWorkspace.scope.versionId='v2',h=>h.input.isConnected=false]){
        const h=harness('original');assert.equal(h.session.insert(h.host,h.field,'X'),true);h.calls.length=0;invalidate(h);h.ticks.shift()();assert.deepEqual(h.calls,[]);
    }
});
test('delayed native insertion cannot reclaim focus from a sidebar control with the same focused field',()=>{
    const h=harness('original');h.window.document={activeElement:h.input,body:{},documentElement:{}};
    assert.equal(h.session.insert(h.host,h.field,'X'),true);h.calls.length=0;
    const sidebar={id:'editorLookupSearch'};h.window.document.activeElement=sidebar;
    h.ticks.shift()();assert.deepEqual(h.calls,[]);assert.equal(h.window.document.activeElement,sidebar);
});
test('native fields reject stale source and access scopes even when the field and unit objects are retained',()=>{
    for(const invalidate of [h=>h.host.ctWorkspace.scope.sourceHash='new-baseline',h=>h.host.ctWorkspace.scope.branchId='branch-two',
        h=>h.host.cloudUser={id:'alice',role:'translator',language:'German',assignmentVersion:2}]){
        const h=harness(),control=h.session.fieldController(h.host,h.field),before=h.host.ctValues.text;invalidate(h);
        assert.equal(control.ready,false);control.field.translation='stale';control.input({target:{value:'stale'}});
        assert.equal(h.host.ctValues.text,before);assert.deepEqual(h.calls,[]);
    }
});
test('native field IME commits once and busy controls suppress delayed model and input mutations',()=>{
    const h=harness();vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/editorComponents.js'),'utf8'),{window:h.window});
    const control=h.session.fieldController(h.host,h.field),Native=h.window.EditorComponents.NativeField,
        events=Native.computed.events.call({controller:control,field:control.field,source:false});
    events.compositionstart({target:h.input});h.input.value='First\nไทย\nThird';events.input({target:h.input,isComposing:true});
    assert.equal(h.host.ctValues.text,'First\r\nSecond\r\nThird');assert.equal(h.calls.includes('edited'),false);
    events.compositionend({target:h.input});assert.equal(h.host.ctValues.text,'First\r\nไทย\r\nThird');assert.equal(h.calls.filter(call=>call==='edited').length,1);
    h.calls.length=0;h.host.ctBusy=true;h.input.value='Delayed input during save';events.input({target:h.input});
    assert.equal(h.host.ctValues.text,'First\r\nไทย\r\nThird');assert.deepEqual(h.calls,[]);
});
test('History comparison leaves source highlights visible while preventing native field and adapter draft edits',()=>{
    const h=harness(),control=h.session.fieldController(h.host,h.field),adapter=h.session.formatAdapter(h.host,'clienttext'),field=adapter.fields[0],before=h.host.ctValues.text;
    h.host.ctHistoryViewer=true;assert.equal(control.ready,true);assert.equal(control.field.readonly,true);
    control.field.translation='blocked';control.input({target:{value:'blocked'}});adapter.actions.edit(field,'blocked');
    assert.equal(h.session.insert(h.host,h.field,'blocked'),false);assert.equal(h.host.ctValues.text,before);assert.deepEqual(h.calls,[]);
});
test('shared session proxy keeps SD ownership and maps ClientText presentation without copying saved text',()=>{
    const {session,host,unit}=harness();host.ctTool='dictionary';host.ctDictionaryFilter='find';host.ctFieldsFor=()=>unit.fields;host.ctDictionaryController={editorReady:true};host.$refs={};
    const proxy=session.create(host);assert.equal(proxy.editorCurrentEditingDesc.filepath,unit.id);proxy.sideTab='lookup';assert.equal(host.ctTool,'lookup');
    proxy.dictionaryFilter='new query';assert.equal(host.ctDictionaryFilter,'new query');
    const captured=proxy.getSessionContext();assert.equal(proxy.sessionCurrent(captured),true);host.ctWorkspace.scope.groupId='next';assert.equal(proxy.sessionCurrent(captured),false);
    host.ctActive=false;host.sideTab='history';host.editorCurrentEditingDesc={filepath:'sd.txt'};assert.equal(proxy.sideTab,'history');assert.equal(proxy.editorCurrentEditingDesc.filepath,'sd.txt');
});

test('shared component ref registry survives overlapping teleport surfaces and leaves Vue readonly refs untouched',()=>{
    const {session,host}=harness(),native={name:'native'},old={name:'old-tools'},replacement={name:'new-tools'},comments={name:'comments'};
    host.$refs=Object.freeze({native});const proxy=session.create(host),first={},second={},third={};
    proxy.registerRefs({dictionaryFilterInput:old},first);proxy.registerRefs({commentsFileList:comments},third);
    assert.equal(session.mixin.methods.getEditorComponentRef.call(host,'dictionaryFilterInput'),old);
    assert.equal(session.mixin.methods.getEditorComponentRef.call(host,'native'),native);
    proxy.registerRefs({dictionaryFilterInput:replacement},second);proxy.unregisterRefs(first);
    assert.equal(host._sharedEditorRefs.dictionaryFilterInput,replacement,'old surface disposal cannot remove a newly mounted reference');
    assert.equal(host._sharedEditorRefs.commentsFileList,comments,'unrelated surfaces retain refs');
    proxy.registerRefs({},second);assert.equal(session.mixin.methods.getEditorComponentRef.call(host,'dictionaryFilterInput'),undefined);
    proxy.unregisterRefs(third);assert.equal(host._sharedEditorRefs.commentsFileList,undefined);assert.deepEqual(host.$refs,{native});
});

test('ClientText format adapter retains all raw and hidden fields while selection and save actions use mode owners',()=>{
    const {session,host,field,unit,input,calls}=harness('Raw@text\\n\r\nunchanged');
    const hidden={id:'hidden',name:'Hidden',source:'',kind:'text',target:'Kept'},gender={id:'gender',name:'Gender',source:'',kind:'gender',target:' F '};
    unit.fields.push(hidden,gender);host.ctValues.hidden='Hidden authored';host.ctValues.gender=' F ';host.ctDiagnostics={record:[{fieldId:field.id,severity:'warning',message:'Visible issue'}]};
    host.ctSave=(...args)=>calls.push(['save',...args]);host.ctSaveAndNavigate=reverse=>calls.push(['navigate',reverse]);host.ctFocusTarget=(...args)=>calls.push(['target',...args]);
    const adapter=session.formatAdapter(host,'clienttext'),fields=adapter.fields,visible=fields[0],snapshot=structuredClone(unit);
    assert.equal(fields.length,3);assert.equal(fields[1].target,'Hidden authored');assert.equal(fields[2].control,'input');assert.equal(visible.target,'Raw@text\\n\r\nunchanged');
    assert.equal(visible.diagnostics[0].message,'Visible issue');assert.equal(adapter.capabilities.forms,true);assert.ok(adapter.slots.includes('developerNotes'));
    input.selectionStart=1;input.selectionEnd=4;input.selectionDirection='backward';input.scrollTop=12;input.scrollLeft=3;
    const selected=adapter.actions.captureSelection(visible);input.selectionStart=input.selectionEnd=0;assert.equal(adapter.actions.restoreSelection(visible,selected),true);
    assert.deepEqual([input.selectionStart,input.selectionEnd,input.scrollTop,input.scrollLeft],[1,4,12,3]);
    adapter.actions.save({close:true,origin:'restore'});adapter.actions.navigate(true);adapter.actions.edit(visible,'Next raw@value\\n\r\ntext');
    assert.deepEqual(calls.find(call=>Array.isArray(call)&&call[0]==='save'),['save',true,{close:true,origin:'restore'}]);assert.ok(calls.some(call=>Array.isArray(call)&&call[0]==='navigate'&&call[1]===true));
    assert.equal(host.ctValues.text,'Next raw@value\\n\r\ntext');assert.deepEqual(unit,snapshot,'presentation actions keep the immutable original unchanged');
    host.ctWorkspace.scope.groupId='replacement';assert.equal(adapter.actions.restoreSelection(visible,selected),false);
});
test('default selection snapshots cannot restore another unit or field within the same content group',()=>{
    for(const replace of [h=>{h.host.ctSelection='different-record';h.host.ctCurrentUnit={id:'different-record',fields:[{...h.field}]};},
        h=>{h.host.ctFocusedField='different-field';}]){
        const h=harness(),adapter=h.session.formatAdapter(h.host,'clienttext');h.input.scrollTop=12;
        const selection=adapter.actions.captureSelection();replace(h);h.calls.length=0;h.input.scrollTop=0;
        assert.equal(adapter.actions.restoreSelection(undefined,selection),false);
        assert.deepEqual(h.calls,[]);assert.equal(h.input.scrollTop,0);
    }
});
test('selection restoration refuses native text changed after capture without replacing the new caret or scroll',()=>{
    const h=harness(),adapter=h.session.formatAdapter(h.host,'clienttext'),field=adapter.fields[0];
    const selection=adapter.actions.captureSelection(field);h.input.value='newly typed value';h.input.selectionStart=3;h.input.scrollTop=6;h.calls.length=0;
    assert.equal(adapter.actions.restoreSelection(field,selection),false);
    assert.deepEqual(h.calls,[]);assert.deepEqual([h.input.selectionStart,h.input.scrollTop],[3,6]);
});

test('StatDescription adapter preserves table column identity and dispatches its own draft, save and navigation actions',()=>{
    const {session,host,calls}=harness();host.ctActive=false;const first={english:'English@literal',translation:'First',isMultiline:false},
        left={english:'Left',translation:'Old left',isMultiline:false},right={english:'Right\nline',translation:'Old right',isMultiline:true};
    host.editorCurrentEditingDesc={filepath:'folder/file.txt'};host.editorBlocks=[first,{isTable:true,tableColumns:[left,right]}];
    host.editorSave=options=>calls.push(['sd-save',options]);host.saveAndSkipFile=(...args)=>calls.push(['sd-navigate',...args]);host.refreshEditorBlockHLter=index=>calls.push(['refresh',index]);host.queueEditorDraft=()=>calls.push('sd-draft');
    const adapter=session.formatAdapter(host,'statdescription'),fields=adapter.fields;
    assert.equal(fields.length,3);assert.equal(fields[0].source,'English@literal');assert.equal(fields[2].metadata.columnIndex,1);assert.equal(fields[2].control,'textarea');
    assert.notEqual(fields[1].identity,fields[2].identity);assert.equal(adapter.capabilities.entryAlignment,true);assert.ok(adapter.slots.includes('droppedRecovery'));
    adapter.actions.edit(fields[2],'New right\nline');assert.equal(right.translation,'New right\nline');assert.equal(left.translation,'Old left');assert.ok(calls.includes('sd-draft'));
    adapter.actions.save({close:false});adapter.actions.navigate(false);assert.deepEqual(calls.find(call=>Array.isArray(call)&&call[0]==='sd-save'),['sd-save',{close:false}]);
    assert.deepEqual(calls.find(call=>Array.isArray(call)&&call[0]==='sd-navigate'),['sd-navigate',false,true]);
    host.editorTranslationReadOnly=true;adapter.actions.edit(fields[0],'Blocked');assert.equal(first.translation,'First');
});

test('shared shortcut dispatch suppresses composition and dialogs, routes ClientText once and leaves SD to its controller',()=>{
    const {session,host,window,calls}=harness();host.ctKey=event=>calls.push(event);
    const event={key:'F2',target:{}};assert.equal(session.dispatchShortcut(host,event),true);assert.equal(calls[0],event);calls.length=0;
    for(const blocked of [{...event,defaultPrevented:true},{...event,isComposing:true},{...event,keyCode:229},{...event,target:{composing:true}}])assert.equal(session.dispatchShortcut(host,blocked),true);
    window.AppDialogs={isOpen:true};assert.equal(session.dispatchShortcut(host,event),true);assert.equal(calls.length,0);
    window.AppDialogs.isOpen=false;host.ctActive=false;assert.equal(session.dispatchShortcut(host,event),false);assert.equal(calls.length,0);
});
