'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const State=require('../public/clientTextState.js');
const Diagnostics=require('../public/translationDiagnostics.js');
const Matching=require('../public/dictionaryMatching.js');
const Shred=require('./clienttext-highlight-fixture.cjs');
const drain=iterator=>{let result;do{result=iterator.next();}while(!result.done);return result.value;};
const unescape=value=>String(value).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&amp;/g,'&');
const highlightedText=html=>unescape(html.replace(/<[^>]*>/g,''));
const highlightSpans=html=>Array.from(html.matchAll(/<span\b([^>]*)>([^<]*)<\/span>/g),match=>({
    attrs:match[1],text:unescape(match[2]),classes:/\bclass="([^"]*)"/.exec(match[1])?.[1].split(' ') || [],
}));

function harness(text='First\r\nSecond\r\nThird',source='Fire [ColdDamage|Cold] {0}'){
    const calls=[],ticks=[],copied=[],window={ClientTextState:State,TranslationDiagnostics:Diagnostics,navigator:{clipboard:{writeText(value){copied.push(value);return Promise.resolve();}}}};
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

test('ClientText missing keyword labels leave existing counterparts neutral and preserve the raw target',()=>{
    for(const target of ['Feu & <raw & "quote" @literal\\n\r\n[Cold|Froid] chance','Plain translation without tags']){
        const h=harness(target,'[Fire] damage and [Cold] chance'),control=h.session.fieldController(h.host,h.field),spans=highlightSpans(control.highlight),presentation=control.diagnosticPresentation;
        assert.equal(highlightedText(control.highlight),target);assert.equal(presentation.errorCount,1);assert.equal(presentation.warningCount,0);assert.equal(presentation.notes.length,0);
        assert.equal(control.field.dataAttrs['aria-invalid'],true);assert.match(presentation.errorTitle,/English has \[Cold\], \[Fire\]; translation has/);
        assert.deepEqual(spans.filter(span=>span.classes.includes('diagnosticRange')),[]);
        assert.deepEqual(Array.from(presentation.missingTags,tag=>tag.label),target.includes('[Cold')?['Missing tag: [Fire]']:['Missing tag: [Cold]','Missing tag: [Fire]']);
        assert.equal(h.host.ctValues.text,target);assert.deepEqual(h.calls,[]);
    }
});

test('Escape Shot names the absent Trigger tag and removes the label when the draft supplies it',()=>{
    const source='Leap backwards, firing an icy arrow which can [Chill] or [Freeze] enemies. This arrow will [Trigger] [IceFragment|Ice Fragments] on impact.',
        target="Un bond vers l'arrière pouvant [Chill|Frigorifier] ou [Freeze|Geler] les ennemis. Cette flèche crée des [IceFragment|Fragments de glace] à l'impact.",
        h=harness(target,source),control=h.session.fieldController(h.host,h.field);
    assert.deepEqual(Array.from(control.diagnosticPresentation.missingTags,tag=>tag.label),['Missing tag: [Trigger]']);
    assert.equal(control.diagnosticPresentation.errorCount,1);assert.doesNotMatch(control.highlight,/diagError/);
    h.host.ctValues.text=target.replace('crée','[Trigger|crée]');
    assert.equal(control.diagnosticPresentation.missingTags.length,0);assert.equal(control.diagnosticPresentation.errorCount,0);
    assert.equal(highlightedText(control.highlight),h.host.ctValues.text);
});

test('shared missing keyword labels name each deficit and retain SD table column locations',()=>{
    const {session}=harness(),issues=[{code:'keyword-popup-tag-name-mismatch',level:'error',columnIndex:1,message:'Missing repeated tags',
        missingTags:[{tagName:'Trigger',count:2},{tagName:'Skill::{0}',count:1}]}],before=structuredClone(issues);
    assert.deepEqual(Array.from(session.diagnosticPresentation(issues).missingTags,tag=>[tag.label,tag.title]),[
        ['Column 2 · Missing tag: [Trigger] x2','Missing repeated tags'],['Column 2 · Missing tag: [Skill::{0}]','Missing repeated tags']]);
    assert.deepEqual(issues,before);
});

test('shared diagnostic presentation normalizes legacy severity and displays only manual notes alongside count hover titles',()=>{
    const {session}=harness(),issues=[{severity:'error',message:'Legacy error'},{level:'warning',severity:'error',message:'Canonical warning'},
        {severity:'warning',code:'clienttext-consistency',message:'Saved translations differ'},
        {level:'warning',code:'dictionary-terminology',message:'Use Dictionary spelling'},...Array.from({length:8},(_,index)=>({level:'warning',message:'Warning '+index}))],before=structuredClone(issues);
    const presentation=session.diagnosticPresentation(issues);
    assert.equal(presentation.errorCount,1);assert.equal(presentation.warningCount,11);assert.equal(presentation.errorTitle,'Legacy error');
    assert.match(presentation.warningTitle,/Canonical warning/);assert.match(presentation.warningTitle,/\.\.\.and 3 more$/);
    assert.deepEqual(Array.from(presentation.notes,issue=>issue.kind),['consistency','terminology']);assert.deepEqual(issues,before);
});

test('ClientText live field diagnostics refresh independently of saved scan issues and suppress stale manual notes',()=>{
    const h=harness('  [Cold|Froid] chance\r\n','[Fire] damage and [Cold] chance'),control=h.session.fieldController(h.host,h.field);
    h.host.ctDiagnostics={record:[{fieldId:'text',severity:'error',message:'Old saved automatic issue'},
        {fieldId:'text',severity:'warning',code:'clienttext-consistency',message:'Saved translations differ'}]};
    h.host.ctValuesFor=()=>({text:'  [Cold|Froid] chance\r\n'});
    assert.equal(control.diagnosticPresentation.warningCount,2);assert.equal(control.diagnosticPresentation.errorCount,1);assert.equal(control.diagnosticPresentation.notes.length,1);
    assert.doesNotMatch(control.diagnosticPresentation.errorTitle,/Old saved/);assert.ok(highlightSpans(control.highlight).some(span=>span.text==='  '&&span.classes.includes('diagWarning')));
    h.host.ctValues.text='[Fire|Feu] damage and [Cold|Froid] chance';
    assert.equal(control.diagnosticPresentation.errorCount,0);assert.equal(control.diagnosticPresentation.warningCount,0);assert.equal(control.diagnosticPresentation.notes.length,0);
    assert.equal(control.field.dataAttrs['aria-invalid'],undefined);assert.equal(h.host.ctDiagnostics.record.length,2,'draft presentation does not rewrite committed scan results');
});

test('ClientText styling differences show warning counts and highlights without marking the shared field invalid',()=>{
    for(const [source,target] of [['Dialogue','<i>{Texte}'],['<u>{Dialogue}','Texte'],['<size:16>{Dialogue}','<size:20>{Texte}']]){
        const h=harness(target,source),control=h.session.fieldController(h.host,h.field),presentation=control.diagnosticPresentation;
        assert.equal(presentation.errorCount,0);assert.equal(presentation.warningCount,1);assert.match(presentation.warningTitle,/Text decoration tagName mismatch/);
        assert.equal(control.field.dataAttrs['aria-invalid'],undefined);assert.equal(highlightedText(control.highlight),target);
        const spans=highlightSpans(control.highlight).filter(span=>span.classes.includes('diagnosticRange'));
        assert.equal(spans.length,target==='Texte'?0:1);assert.ok(spans.every(span=>span.classes.includes('diagWarning')&&!span.classes.includes('diagError')));
        assert.equal(h.host.ctValues.text,target);assert.deepEqual(h.calls,[]);
    }
    const h=harness('<i>{Texte {1}}','Dialogue {0}'),control=h.session.fieldController(h.host,h.field);
    assert.equal(control.diagnosticPresentation.errorCount,1);assert.equal(control.diagnosticPresentation.warningCount,1);assert.equal(control.field.dataAttrs['aria-invalid'],true);
});

test('named Turkish controls diagnose literal NONEXISTENT without changing older form exemptions',()=>{
    for(const form of ['Normal Translation','Possessive Translation']){
        const h=harness('NONEXISTENT','Item {0}');
        Object.assign(h.field,{name:'Display Name',kind:'form',form,group:'Display Name'});
        const control=h.session.fieldController(h.host,h.field);
        assert.ok(control.diagnostics.some(issue=>issue.code==='clienttext-token-identity'));
        assert.ok(control.diagnosticPresentation.errorCount>0);
        assert.equal(control.field.translation,'NONEXISTENT');
    }
    const h=harness('NONEXISTENT','Item {0}');Object.assign(h.field,{kind:'form',form:'MS'});
    assert.equal(h.session.fieldController(h.host,h.field).diagnostics.length,0);
});

test('ClientText blank fields never inherit StatDescription blank errors while Missing and Outdated retain their field rules',()=>{
    for(const text of ['', ' \t\r\n '])for(const options of [
        {kind:'text',name:'Text',required:true},
        {kind:'form',name:'Display Name',form:'Normal Translation',required:true},
        {kind:'form',name:'Display Name',form:'Possessive Translation',required:false},
        {kind:'form',name:'Display Name',form:'Possessive Translation',required:false,outdated:true},
        {kind:'form',name:'Display Name',form:'Possessive Translation',required:true},
        {kind:'form',name:'Text',form:'MS',required:false},
        {kind:'form',name:'Text',form:'StrFour',required:false}
    ]){
        const h=harness(text,'[CurrencyItem] {0}');Object.assign(h.field,{target:'',outdated:false},options);
        const control=h.session.fieldController(h.host,h.field),status=State.statusFor(h.unit,{values:h.host.ctValues,reviewed:{}}).fields.text;
        assert.equal(control.diagnostics.some(issue=>issue.code==='blank-translation'),false);
        assert.equal(control.diagnosticPresentation.errorCount,0);assert.equal(control.diagnosticPresentation.errorTitle,'');
        assert.equal(control.field.dataAttrs['aria-invalid'],undefined);
        assert.equal(control.field.placeholder,options.kind==='form'&&!options.required?'Optional translation':'Translation');
        assert.equal(status.missing,options.required);assert.equal(status.outdated,!!options.outdated);
        assert.equal(h.host.ctValues.text,text,'diagnostic presentation preserves exact blank/whitespace input');
    }
    assert.equal(Diagnostics.analyze('').diagnostics.some(issue=>issue.code==='blank-translation'&&issue.level==='error'),true,
        'The default StatDescription analyzer still requires nonblank translation');
});

test('ClientText live common whitespace and dash diagnostics retain workbook gender, form sentinel and audio-only exemptions',()=>{
    for(const exemption of ['gender','sentinel','audio']){
        const h=harness('  - NONEXISTENT \r\n','source {0}');
        if(exemption==='gender')h.field.kind='gender';
        if(exemption==='sentinel'){h.field.kind='form';h.host.ctValues.text='  NONEXISTENT \r\n';}
        if(exemption==='audio')h.field.source='[NOAUDIO]';
        const control=h.session.fieldController(h.host,h.field);assert.equal(control.diagnostics.length,0);assert.equal(control.diagnosticPresentation.errorCount,0);assert.equal(control.diagnosticPresentation.warningCount,0);
    }
});

test('ActiveSkills shred source highlights retain whole original keywords and every surrounding character',()=>{
    for(const [source,keywords]of [[Shred.thaiEnglish,Shred.thaiKeywords],[Shred.germanEnglish,Shred.germanEnglishKeywords]]){
        for(const prefix of ['', 'A&B <raw> "quote" \'note\' @literal\\n\r\n']){
            const text=prefix+source+'\r\nuntouched @literal\\n &amp; end',h=harness(Shred.germanTarget,text),control=h.session.fieldController(h.host,h.field,text),before=structuredClone(h.field);
            const spans=highlightSpans(control.highlight);assert.equal(highlightedText(control.highlight),text);
            assert.deepEqual(spans.filter(span=>span.classes.includes('keywordHL')).map(span=>span.text),keywords);
            for(const range of h.session.ranges(h.host,h.field,text,true))assert.equal(range.value,text.slice(range.start,range.end));
            assert.deepEqual(h.field,before);assert.equal(h.host.ctValues.text,Shred.germanTarget);assert.deepEqual(h.calls,[]);
        }
    }
});

test('ActiveSkills shred Dictionary worker ranges use raw source coordinates after escaping and CRLF',()=>{
    const snapshot=drain(Matching.buildSnapshot(Shred.dictionary,'poe2',1));
    for(const [source,keywords]of [[Shred.thaiEnglish,Shred.thaiKeywords],[Shred.germanEnglish,Shred.germanEnglishKeywords]]){
        const text='A&B <raw> "quote" \'note\' @literal\\n\r\n'+source+'\r\n尾 &amp; end',h=harness(Shred.germanTarget,text),
            pack=drain(Matching.matchSnapshot(snapshot,[{key:h.field.id,english:text,tokens:State.tokenize(text)}],{contentMode:'clienttext',highlightDict:true}));
        h.host.ctDictionaryPack=pack;h.host.dictionary=structuredClone(Shred.dictionary);const control=h.session.fieldController(h.host,h.field,text);
        assert.equal(pack.units[0].english,text);assert.equal(highlightedText(control.highlight),text);
        for(const range of pack.units[0].HLs){assert.equal(unescape(range.find),text.slice(range.rawStart,range.rawEnd));
            assert.equal(range.index,Matching.escapeHtml(text.slice(0,range.rawStart)).length);}
        const spans=highlightSpans(control.highlight).filter(span=>span.text.startsWith('['));assert.deepEqual(spans.map(span=>span.text),keywords);
        for(const span of spans){const index=Number(/data-ct-hl="(\d+)"/.exec(span.attrs)?.[1]);assert.ok(Number.isInteger(index));
            const range=h.session.ranges(h.host,h.field,text,true)[index];assert.equal(range.value,span.text);
            control.sourceClick({target:{closest:()=>({dataset:{ctHl:String(index)}})},altKey:true});}
        assert.deepEqual(h.copied,keywords,'every rendered source span copies its exact whole token');assert.equal(h.host.ctValues.text,Shred.germanTarget);
    }
});

test('ActiveSkills shred German translation highlights retain complete Attack display tokens without raw text normalization',()=>{
    for(const prefix of ['', 'A&B <raw> "quote" \'note\' @literal\\n\r\n']){
        const text=prefix+Shred.germanTarget+'\r\n尾 &amp; end',source=prefix+Shred.germanEnglish+'\r\n尾 &amp; end',h=harness(text,source),
            control=h.session.fieldController(h.host,h.field),html=control.highlight,spans=highlightSpans(html);
        assert.equal(highlightedText(html),text);assert.deepEqual(spans.filter(span=>span.classes.includes('vocab')).map(span=>span.text),Shred.germanKeywords);
        assert.equal(spans.filter(span=>span.text==='[Attack|Angriff]').length,2);assert.equal(h.host.ctValues.text,text);assert.deepEqual(h.calls,[]);
        for(const span of spans)assert.doesNotMatch(span.text,/[\r\n]/,'raw line endings stay outside every overlay span');
    }
});

test('ClientText native scroll keeps its highlight viewport stationary and preserves raw text, caret, and editing state',()=>{
    for(const source of [false,true])for(const useInner of [false,true]){
        const h=harness('raw@literal\\n\r\n'+Shred.germanTarget,Shred.thaiEnglish),before=structuredClone(h.unit),values=h.host.ctValues,
            inner={style:{transform:''}},overlay={style:{transform:'',left:'5px',top:'3px',width:'900px',height:'96px'},scrollTop:0,scrollLeft:0,
                querySelector:selector=>{assert.equal(selector,'.editorHighlightContent');return useInner?inner:null;}},
            viewport=structuredClone(overlay.style),content=useInner?inner:overlay,control=h.session.fieldController(h.host,h.field,source?h.field.source:undefined);
        h.input.parentElement={querySelector:selector=>{assert.equal(selector,'.HLter');return overlay;}};
        h.input.selectionStart=7;h.input.selectionEnd=11;h.input.scrollTop=73;h.input.scrollLeft=29;
        const native=h.input.value;control.scroll({target:h.input});
        const offsets=()=>/^translate\((-?\d+)px,\s*(-?\d+)px\)$/.exec(content.style.transform)?.slice(1).map(Number);
        assert.deepEqual(offsets(),[-29,-73]);assert.deepEqual([overlay.scrollLeft,overlay.scrollTop],[0,0]);
        if(useInner)assert.deepEqual(overlay.style,viewport,'the measured clipping viewport remains stationary while only its text moves');
        assert.equal(h.input.value,native);assert.deepEqual([h.input.selectionStart,h.input.selectionEnd],[7,11]);
        assert.equal(h.host.ctValues,values);assert.equal(h.host.ctValues.text,'raw@literal\\n\r\n'+Shred.germanTarget);assert.deepEqual(h.unit,before);assert.deepEqual(h.calls,[]);
        h.input.scrollTop=h.input.scrollLeft=0;control.scroll({target:h.input});assert.deepEqual(offsets(),[0,0]);
    }
});

test('SD native scroll uses the same stationary highlight viewport and supports legacy overlays',()=>{
    const code=fs.readFileSync(path.join(__dirname,'../public/index.js'),'utf8'),start=code.indexOf('    syncHlScroll(kind,'),end=code.indexOf('    autosizeTextarea(el,',start);
    assert.ok(start>=0 && end>start);const sync=vm.runInNewContext('({'+code.slice(start,end)+'})').syncHlScroll;
    for(const kind of ['english','translation'])for(const useInner of [false,true]){
        const input={value:kind==='english'?Shred.thaiEnglish:Shred.germanTarget,selectionStart:3,selectionEnd:12,scrollLeft:21,scrollTop:67},before=structuredClone(input),
            inner={style:{transform:''}},overlay={style:{transform:'',width:'420px',height:'72px'},querySelector:()=>useInner?inner:null},viewport=structuredClone(overlay.style);
        sync.call({getEditorRef(name,index,column){assert.equal(index,7);assert.equal(column,2);return name===kind+'HLter'?overlay:input;}},kind,7,2);
        const content=useInner?inner:overlay,offsets=/^translate\((-?\d+)px,\s*(-?\d+)px\)$/.exec(content.style.transform)?.slice(1).map(Number);
        assert.deepEqual(Array.from(offsets),[-21,-67]);assert.deepEqual(input,before);
        if(useInner)assert.deepEqual(overlay.style,viewport,'SD retains the clipping viewport while moving its inner text');
    }
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
function formattingHistoryHarness(original){
    const h=harness(original),control=h.session.fieldController(h.host,h.field),nativeCalls=[],selectionEvents=[];
    const document={body:{},documentElement:{},activeElement:h.input,
        execCommand(command,unused,value){
            nativeCalls.push(command);
            h.input.setRangeText(String(value ?? '').replace(/\r\n?/g,'\n'),h.input.selectionStart,h.input.selectionEnd);
            control.commitInput({target:h.input,inputType:command==='delete'?'deleteContentBackward':'insertText'});
            return true;
        }};
    h.window.document=document;
    h.input.selectionDirection='none';
    h.input.setSelectionRange=function(start,end,direction='none'){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;};
    h.input.focus=()=>{document.activeElement=h.input;h.calls.push('focus');};
    h.host.ctFormattingSelectionChanged=(_field,event)=>selectionEvents.push([event.target.selectionStart,event.target.selectionEnd]);
    const flush=()=>{while(h.ticks.length)h.ticks.shift()();};
    const nativeHistory=(value,inputType)=>{
        h.input.value=value.replace(/\r\n?/g,'\n');
        h.input.setSelectionRange(h.input.value.length,h.input.value.length);
        control.commitInput({target:h.input,inputType});
    };
    return {...h,control,nativeCalls,selectionEvents,flush,nativeHistory};
}

test('formatting insertion restores affected selection and exact CRLF through native Undo and Redo',()=>{
    const original='First\r\nSecond@literal\\n\r\nThird',formatted='First\r\n<b>{Second}@literal\\n\r\nThird',h=formattingHistoryHarness(original);
    h.input.setSelectionRange(6,12,'backward');
    assert.equal(h.session.insert(h.host,h.field,'<b>{Second}',{raw:true,start:7,end:13,caretOffset:4,selectionEndOffset:10,historySelection:true}),true);
    h.flush();assert.equal(h.host.ctValues.text,formatted);assert.deepEqual([h.input.selectionStart,h.input.selectionEnd],[10,16]);
    assert.deepEqual(h.nativeCalls,['insertText'],'formatting remains one native edit');
    h.nativeHistory(original,'historyUndo');h.flush();
    assert.equal(h.host.ctValues.text,original);assert.deepEqual([h.input.selectionStart,h.input.selectionEnd,h.input.selectionDirection],[6,12,'backward']);
    assert.deepEqual(h.selectionEvents.at(-1),[6,12],'active styles refresh after the restored original selection');
    h.nativeHistory(formatted,'historyRedo');h.flush();
    assert.equal(h.host.ctValues.text,formatted);assert.deepEqual([h.input.selectionStart,h.input.selectionEnd],[10,16]);
    assert.deepEqual(h.selectionEvents.at(-1),[10,16],'Redo restores the selected affected text before refreshing active styles');
});

test('removing a containing style restores the original caret on Undo and highlights all inner text on Redo',()=>{
    const original='prefix <i>{One\r\n<u>{Two}} suffix',removed='prefix One\r\n<u>{Two} suffix',h=formattingHistoryHarness(original),start=original.indexOf('<i>'),end=original.indexOf(' suffix');
    const inside='One\r\n<u>{Two}';h.input.setSelectionRange(13,13);
    assert.equal(h.session.insert(h.host,h.field,inside,{raw:true,start,end,caretOffset:0,selectionEndOffset:inside.length,historySelection:true}),true);
    h.flush();assert.equal(h.host.ctValues.text,removed);
    assert.deepEqual([h.input.selectionStart,h.input.selectionEnd],[start,start+inside.replace(/\r\n/g,'\n').length]);
    h.nativeHistory(original,'historyUndo');h.flush();assert.equal(h.host.ctValues.text,original);assert.deepEqual([h.input.selectionStart,h.input.selectionEnd],[13,13]);
    h.nativeHistory(removed,'historyRedo');h.flush();assert.equal(h.host.ctValues.text,removed);
    assert.deepEqual([h.input.selectionStart,h.input.selectionEnd],[start,start+inside.replace(/\r\n/g,'\n').length]);
    assert.deepEqual(h.nativeCalls,['insertText']);
});

test('late native history selection replies cannot steal newer selection across scope, unit, input or focus changes',()=>{
    const original='First\r\nSecond',formatted='<b>{First\r\nSecond}';
    const changes=[
        ['account scope',h=>{h.host.ctWorkspace.scope.accountId='bob';}],
        ['unit replacement',h=>{h.host.ctCurrentUnit={...h.unit};}],
        ['field removed from the retained unit',h=>{h.unit.fields=[];}],
        ['disconnected native field',h=>{h.input.isConnected=false;}],
        ['changed native text before commit',h=>{h.input.value+=' uncommitted';}],
        ['newer committed input',h=>{h.input.value+=' newer';h.control.commitInput({target:h.input,inputType:'insertText'});}],
        ['foreign focus',h=>{h.window.document.activeElement={};}],
    ];
    for(const[label,invalidate]of changes){
        const h=formattingHistoryHarness(original);h.input.setSelectionRange(1,3);
        assert.equal(h.session.insert(h.host,h.field,formatted,{whole:true,caretOffset:4,selectionEndOffset:formatted.length-1,historySelection:true}),true);h.flush();
        h.nativeHistory(original,'historyUndo');assert.ok(h.ticks.length,'Undo schedules selection recovery');
        invalidate(h);h.input.setSelectionRange(2,2);const focusCount=h.calls.filter(call=>call==='focus').length;
        h.flush();assert.deepEqual([h.input.selectionStart,h.input.selectionEnd],[2,2],label);
        assert.equal(h.calls.filter(call=>call==='focus').length,focusCount,label+' must not reclaim focus');
    }
});

test('ordinary insertions retain native Undo selection behavior without formatting selection opt-in',()=>{
    const original='First\r\nSecond',replacement='New\r\nline',h=formattingHistoryHarness(original);
    h.input.setSelectionRange(1,4);assert.equal(h.session.insert(h.host,h.field,replacement,{whole:true}),true);h.flush();
    h.nativeHistory(original,'historyUndo');h.input.setSelectionRange(2,2);h.flush();
    assert.equal(h.host.ctValues.text,original);assert.deepEqual([h.input.selectionStart,h.input.selectionEnd],[2,2]);
});

test('Undo of ordinary typing after formatting preserves native caret instead of recovering the earlier format selection',()=>{
    const original='First\r\nSecond',formatted='<b>{First\r\nSecond}',h=formattingHistoryHarness(original);
    h.input.setSelectionRange(1,3);
    assert.equal(h.session.insert(h.host,h.field,formatted,{whole:true,caretOffset:4,selectionEndOffset:formatted.length-1,historySelection:true}),true);h.flush();
    h.input.value+=' typed';h.input.setSelectionRange(h.input.value.length,h.input.value.length);
    h.control.commitInput({target:h.input,inputType:'insertText'});h.flush();
    const events=h.selectionEvents.length;
    h.input.value=formatted.replace(/\r\n/g,'\n');h.input.setSelectionRange(2,2);
    h.control.commitInput({target:h.input,inputType:'historyUndo'});h.flush();
    assert.equal(h.host.ctValues.text,formatted);assert.deepEqual([h.input.selectionStart,h.input.selectionEnd],[2,2]);
    assert.equal(h.selectionEvents.length,events+1,'normal input tracking runs once without an extra asynchronous formatting restore');
    assert.deepEqual(h.selectionEvents.at(-1),[2,2]);
    h.nativeHistory(original,'historyUndo');h.flush();
    assert.equal(h.host.ctValues.text,original);assert.deepEqual([h.input.selectionStart,h.input.selectionEnd],[1,3],'the next Undo crosses the format edit and restores its original selection');
    h.nativeHistory(formatted,'historyRedo');h.flush();
    assert.deepEqual([h.input.selectionStart,h.input.selectionEnd],[4,formatted.replace(/\r\n/g,'\n').length-1],'Redo of the format edit still highlights affected text');
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

function toolsLifecycleHarness(mode='clienttext'){
    const h=harness(),{host,session}=h,offsets={top:300,left:19},writes=[],node={isConnected:true};
    for(const [property,key] of [['scrollTop','top'],['scrollLeft','left']])Object.defineProperty(node,property,{
        get:()=>offsets[key],set:value=>{offsets[key]=value;writes.push([property,value]);},
    });
    host.ctTool=host.sideTab='dictionary';host.cloudProfileId='alice';host.managedCatalogScope='alice:poe2:Thai';
    host.cloudSignedIn=true;host.cloudUser={id:'alice',role:'translator',language:'Thai',assignmentVersion:1};
    host.ctWorkspace.scope.sourceHash='baseline-one';host._sharedEditorRefs={editorSide:node};
    host.getEditorComponentRef=session.mixin.methods.getEditorComponentRef.bind(host);
    if(mode==='statdescription'){
        host.ctActive=false;host.managedWorkspaceScope={...host.ctWorkspace.scope};host.editorVisible=false;
        host.editorCurrentEditingDesc={filepath:'folder/file.txt'};host._editorOpenCancelRevision=1;
    }
    Object.defineProperty(host,'sharedEditorToolsTarget',{get:()=>session.mixin.computed.sharedEditorToolsTarget.call(host)});
    const hooks=session.mixin;hooks.mounted.call(host);
    return {...h,node,writes,offsets,hooks,scope:host.ctActive?host.ctWorkspace.scope:host.managedWorkspaceScope,
        switchSurface(){if(host.ctActive)host.ctEditor=!host.ctEditor;else host.editorVisible=!host.editorVisible;},
        // Removing a Teleport host clamps native offsets before its child updates.
        clamp(){offsets.top=offsets.left=0;},
    };
}

test('shared Tools retain native sidebar offsets across actual mode surface handoffs within one unit',()=>{
    for(const mode of ['clienttext','statdescription']){
        const h=toolsLifecycleHarness(mode),before=h.host.ctValues.text;
        h.switchSurface();h.hooks.beforeUpdate.call(h.host);h.clamp();h.hooks.updated.call(h.host);
        assert.deepEqual([h.node.scrollTop,h.node.scrollLeft],[300,19],`${mode} inline to full`);
        h.offsets.top=522;h.offsets.left=7;h.writes.length=0;
        if(h.host.ctActive)h.host.ctFocusedField='another-field';else h.host.editorFocusedIndex=2;
        h.switchSurface();h.hooks.beforeUpdate.call(h.host);h.clamp();h.hooks.updated.call(h.host);
        assert.deepEqual([h.node.scrollTop,h.node.scrollLeft],[522,7],`${mode} full to inline may change focused field`);
        assert.deepEqual(h.writes,[['scrollTop',522],['scrollLeft',7]]);
        assert.equal(h.host.ctValues.text,before);assert.deepEqual(h.calls,[],'sidebar restoration cannot edit or reclaim native field focus');
    }
});

test('ordinary Tools updates preserve explicit page resets and background scroll changes without assigning old offsets',()=>{
    for(const mode of ['clienttext','statdescription']){
        const h=toolsLifecycleHarness(mode);
        h.hooks.beforeUpdate.call(h.host);h.clamp();h.hooks.updated.call(h.host);
        assert.deepEqual([h.node.scrollTop,h.node.scrollLeft],[0,0],`${mode} Dictionary page reset`);assert.deepEqual(h.writes,[]);
        h.offsets.top=87;h.offsets.left=2;h.hooks.beforeUpdate.call(h.host);h.hooks.updated.call(h.host);
        assert.deepEqual([h.node.scrollTop,h.node.scrollLeft],[87,2],`${mode} background update`);assert.deepEqual(h.writes,[]);
        h.switchSurface();h.hooks.beforeUpdate.call(h.host);h.clamp();h.hooks.updated.call(h.host);
        assert.deepEqual([h.node.scrollTop,h.node.scrollLeft],[87,2],'a later handoff uses the current live offsets');
    }
});

test('Tools surface restoration is fenced against every workspace, account, access and selected-tool transition',()=>{
    const changes=[
        ['unit',h=>h.host.ctActive?h.host.ctSelection='other-record':h.host.editorCurrentEditingDesc={filepath:'other.txt'}],
        ['account',h=>h.scope.accountId='bob'],['profile',h=>h.host.cloudProfileId='bob'],['catalog',h=>h.host.managedCatalogScope='bob:poe2:Thai'],
        ['language',h=>h.scope.language='German'],['mode',h=>h.host.ctActive=!h.host.ctActive],['game',h=>h.scope.game='poe1'],
        ['branch',h=>h.scope.branchId='branch-two'],['group',h=>h.scope.groupId='group-two'],['version',h=>h.scope.versionId='v2'],
        ['baseline',h=>h.scope.sourceHash='baseline-two'],['generation',h=>h.host.ctActive?h.host._ctEpoch++:h.host._editorOpenCancelRevision++],
        ['sign-in',h=>h.host.cloudSignedIn=false],['role',h=>h.host.cloudUser.role='manager'],
        ['assignment',h=>h.host.cloudUser.assignmentVersion=2],['access',h=>h.host.cloudCanAccessAllLanguages=true],
        ['tool',h=>{h.host.ctTool=h.host.sideTab='history';}],
    ];
    for(const mode of ['clienttext','statdescription'])for(const [name,change] of changes){
        const h=toolsLifecycleHarness(mode);h.switchSurface();change(h);
        h.hooks.beforeUpdate.call(h.host);h.clamp();h.hooks.updated.call(h.host);
        assert.deepEqual([h.node.scrollTop,h.node.scrollLeft],[0,0],`${mode}: ${name}`);assert.deepEqual(h.writes,[],`${mode}: ${name} cannot restore another scope's offsets`);
    }
});

test('Tools restoration cannot transfer offsets to replaced, detached or unmounted sidebar nodes',()=>{
    for(const disposition of ['replaced','detached-before','detached-after','unmounted']){
        const h=toolsLifecycleHarness();h.switchSurface();
        if(disposition==='detached-before')h.node.isConnected=false;
        h.hooks.beforeUpdate.call(h.host);h.clamp();
        if(disposition==='replaced')h.host._sharedEditorRefs.editorSide={isConnected:true,scrollTop:41,scrollLeft:3};
        if(disposition==='detached-after')h.node.isConnected=false;
        if(disposition==='unmounted')h.hooks.beforeUnmount.call(h.host);
        h.hooks.updated.call(h.host);assert.deepEqual(h.writes,[],disposition);
        assert.deepEqual([h.node.scrollTop,h.node.scrollLeft],[0,0],disposition);
        if(disposition==='replaced')assert.deepEqual([h.host._sharedEditorRefs.editorSide.scrollTop,h.host._sharedEditorRefs.editorSide.scrollLeft],[41,3]);
    }
});

test('ClientText format adapter retains all raw and hidden fields while selection and save actions use mode owners',()=>{
    const {session,host,field,unit,input,calls}=harness('Raw@text\\n\r\nunchanged');
    const hidden={id:'hidden',name:'Hidden',source:'',kind:'text',target:'Kept'},gender={id:'gender',name:'Gender',source:'',kind:'gender',target:' F '};
    unit.fields.push(hidden,gender);host.ctValues.hidden='Hidden authored';host.ctValues.gender=' F ';host.ctDiagnostics={record:[{fieldId:field.id,severity:'warning',code:'dictionary-terminology',message:'Visible issue'}]};
    host.ctSave=(...args)=>calls.push(['save',...args]);host.ctSaveAndNavigate=reverse=>calls.push(['navigate',reverse]);host.ctFocusTarget=(...args)=>calls.push(['target',...args]);
    const adapter=session.formatAdapter(host,'clienttext'),fields=adapter.fields,visible=fields[0],snapshot=structuredClone(unit);
    assert.equal(fields.length,3);assert.equal(fields[1].target,'Hidden authored');assert.equal(fields[2].control,'input');assert.equal(visible.target,'Raw@text\\n\r\nunchanged');
    assert.ok(visible.diagnostics.some(issue=>issue.message==='Visible issue'));assert.equal(adapter.capabilities.forms,true);assert.ok(adapter.slots.includes('developerNotes'));
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
