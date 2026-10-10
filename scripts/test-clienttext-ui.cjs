const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const S=require('../public/clientTextState.js'),Store=require('../public/clientTextStore.js');
const {fixture,scope,fieldId,unit,asset}=require('./clienttext-storage-fixture.cjs');
const clone=value=>structuredClone(value),settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function harness(changes={}){
    let nextId=0;
    const window={ClientTextState:S,ClientTextStore:Store,Vue:{markRaw:value=>value},crypto:{randomUUID:()=> 'save-'+(++nextId)}};
    const context=vm.createContext({window,console,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,Blob,File,TextEncoder});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/editorComponents.js'),'utf8'),context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/clientTextUi.js'),'utf8'),context);
    const mixin=window.ClientTextUI.mixin,original=unit(),app={...mixin.data(),managedCatalogScope:'alice:poe2',cloudProfileId:scope.accountId,gameVersion:scope.game,branchId:scope.branchId,
        ctWorkspace:{scope:clone(scope)},ctActive:true,ctSelection:original.id,ctUnits:[original],ctSaved:{},ctValues:S.valuesFor(original),ctReviewed:{},
        _ctUnitIndex:new Map([[original.id,original]]),_ctWorkUnits:new Map(),_ctEditRevision:0,_ctDraftRevision:null,...changes};
    for(const[name,method]of Object.entries(mixin.methods))app[name]=method.bind(app);
    Object.defineProperty(app,'ctCurrentUnit',{get:()=>app._ctUnitIndex.get(app.ctSelection)||null});
    Object.defineProperty(app,'ctPreviewField',{get:()=>mixin.computed.ctPreviewField.call(app)});
    app.ctLoadHistory=()=>{};app.ctPresence=async()=>{};app.ctRefreshDiagnostics=()=>{};
    return {app,mixin,window,original};
}
function assignmentHarness(changes={}){
    const managed=require('../public/managedVersions.js').mixin.methods,
        h=harness({managedCatalogAccess:true,cloudCanAccessAllLanguages:true,managedTeamSort:'language',managedTeamSortDir:'asc',
            managedSelectedVersion:{id:'v1',game:'poe2',branchId:'default'},managedSelectedDetails:{version:{id:'v1'},teams:[]},...changes});
    h.app.managedProgress=managed.managedProgress.bind(h.app);h.app.managedProgressTooltip=managed.managedProgressTooltip.bind(h.app);
    Object.defineProperty(h.app,'ctGroups',{get:()=>h.mixin.computed.ctGroups.call(h.app)});
    Object.defineProperty(h.app,'ctAssignmentRows',{get:()=>h.mixin.computed.ctAssignmentRows.call(h.app)});
    return h;
}
function listHarness(changes={}){
    // Mechanics fixtures deliberately show complete records; product defaults
    // are asserted separately from mixin.data() in the status-filter test.
    const h=harness({inlineEditor:false,pageSize:2,ctSelectedFilters:['missing','saved','revised','outdated','error','warning','unchanged'],$nextTick:async()=>{},$refs:{},...changes});
    for(const name of ['ctRows','ctPageRows','ctPageCount','ctEffectivePageSize','ctCounts','ctStatusFilterOptions','ctDiagnosticCounts'])
        Object.defineProperty(h.app,name,{get:()=>h.mixin.computed[name].call(h.app)});
    return h;
}
function namedUnit(id,source='English',target='Translation',outdated=false){
    return {...unit(source,target,outdated),id:JSON.stringify(['normal','ClientStrings',id]),recordId:id};
}
const rowEvent=(key,control=false)=>({key,target:{closest:()=>control?{}:null},preventDefault(){this.defaultPrevented=true;},stopPropagation(){}});

function blankEnglishUnit(id='BlankThenEnglish',source='Visible English'){
    const original=namedUnit(id),base=original.fields[0];
    original.fields=[
        {...base,id:JSON.stringify(['Blank',null]),name:'Blank',source:'',target:'RECOVERABLE_HIDDEN_TRANSLATION',required:false,sourceCell:'D2',targetCell:'E2'},
        {...base,source,target:'Visible translation'},
        {...base,id:JSON.stringify(['Gender',null]),name:'Gender',kind:'gender',source:'',target:'F',required:false,sourceCell:'',targetCell:'F2'},
    ];return original;
}
function visibleFieldsHarness(original,changes={}){
    const h=listHarness({ctUnits:[original],ctSelection:original.id,_ctUnitIndex:new Map([[original.id,original]]),ctValues:S.valuesFor(original),...changes});
    for(const name of ['ctFieldGroups','ctLookupResults','ctMemoryResults'])
        Object.defineProperty(h.app,name,{get:()=>h.mixin.computed[name].call(h.app)});
    return {...h,original};
}
test('blank English fields hide without trimming nonempty English or removing its Gender metadata',()=>{
    const raw=' \tEnglish@literal\\n\nline \t',original=blankEnglishUnit('Whitespace',raw),before=clone(original),{app}=visibleFieldsHarness(original);
    original.fields.splice(1,0,{...original.fields[0],id:JSON.stringify(['Whitespace',null]),name:'Whitespace',source:' \t\r\n\u00a0\uFEFF',target:'Hidden whitespace target'});
    const snapshot=clone(original),visible=app.ctFieldsFor(original);
    assert.deepEqual(Array.from(visible,field=>field.name),['Text','Gender']);assert.equal(visible[0],original.fields[2]);assert.equal(visible[0].source,raw);
    assert.deepEqual(Array.from(app.ctFieldGroups.flatMap(group=>group.fields),field=>field.name),['Text','Gender']);
    assert.deepEqual(original,snapshot,'view construction keeps every baseline field and raw whitespace');assert.equal(before.fields.length,3);
    assert.equal(original.fields[0].target,'RECOVERABLE_HIDDEN_TRANSLATION');
});
test('ClientText list omits all-blank units and ignores hidden targets in search and sort summaries',()=>{
    const mixed=blankEnglishUnit(),blank=blankEnglishUnit('AllBlank',' \t\r\n'),snapshot=clone([mixed,blank]),
        {app}=visibleFieldsHarness(mixed,{ctUnits:[mixed,blank],_ctUnitIndex:new Map([[mixed.id,mixed],[blank.id,blank]])});
    assert.deepEqual(Array.from(app.ctRows,unit=>unit.id),[mixed.id]);assert.equal(app.ctFieldsFor(blank).length,0,'Gender alone cannot create a visible prose record');
    assert.equal(app.ctSortValue(mixed,'english').includes('Visible English'),true);assert.equal(app.ctSortValue(mixed,'translation').includes('Visible translation'),true);
    assert.equal(app.ctSortValue(mixed,'translation').includes('RECOVERABLE_HIDDEN_TRANSLATION'),false);
    app.ctSearch='RECOVERABLE_HIDDEN_TRANSLATION';app.ctApplySearch();assert.equal(app.ctRows.length,0);
    app.ctSearch='Visible translation';app.ctApplySearch();assert.deepEqual(Array.from(app.ctRows,unit=>unit.id),[mixed.id]);
    assert.deepEqual([mixed,blank],snapshot);assert.equal(app.ctCounts.total,2,'status totals continue to describe the retained originals');
});
test('blank-first-field preview, Lookup and TM fall back to real English while hidden authored text stays intact',()=>{
    const original=blankEnglishUnit(),reference=blankEnglishUnit('Reference'),{app,window}=visibleFieldsHarness(original,{ctUnits:[original,reference],
        _ctUnitIndex:new Map([[original.id,original],[reference.id,reference]]),ctFocusedField:original.fields[0].id});
    reference.fields[1].target='Reference translation';const seen=[];
    window.ContentAdapters={clienttext:{findMemory(memory,unit,field){seen.push(field);return[{target:'TM@literal\\n\ntranslation'}];}}};
    assert.equal(app.ctPreviewField,original.fields[1]);assert.equal(app.ctMemoryResults.length,1);assert.equal(seen[0],original.fields[1]);
    assert.deepEqual(Array.from(app.ctLookupResults,match=>match.name),['Text']);assert.equal(app.ctLookupResults[0].target,'Reference translation');
    app.ctEdited=field=>{assert.equal(field,original.fields[1]);app.ctDraftDirty=true;};app.ctApplyMemory({target:'TM@literal\\n\ntranslation'});
    assert.equal(app.ctValues[original.fields[1].id],'TM@literal\\n\ntranslation');assert.equal(app.ctValues[original.fields[0].id],'RECOVERABLE_HIDDEN_TRANSLATION');
    app.ctFocusedField=original.fields[2].id;assert.equal(app.ctPreviewField,original.fields[1],'Gender focus retains a prose preview');
});
test('initial ClientText selection focuses later real English and hydrates hidden durable values unchanged',async()=>{
    const original=blankEnglishUnit(),hidden=original.fields[0],visible=original.fields[1],before=clone(original),{app}=visibleFieldsHarness(original,{ctSelection:'',ctValues:{}}),focus=[];
    app._ctStore={async getDraft(){return{revision:3,values:{[hidden.id]:'Hidden durable draft',[visible.id]:'Visible durable draft'},reviewed:{}};}};
    app.ctFlushDraft=async()=>true;app.ctFlushCommentDraft=async()=>{};app.ctLoadComments=()=>{};app.ctLoadCommentDraft=()=>{};app.ctFocusTarget=()=>focus.push(app.ctFocusedField);
    assert.equal(await app.ctSelect(original,true),true);assert.equal(app.ctFocusedField,visible.id);assert.deepEqual(focus,[visible.id]);
    assert.equal(app.ctValues[hidden.id],'Hidden durable draft');assert.equal(app.ctValues[visible.id],'Visible durable draft');assert.equal(app.ctValues[original.fields[2].id],'F');
    assert.deepEqual(original,before);
});
test('hidden English fields remain in real durable saves, immutable originals and recoverable history',async()=>{
    const original=blankEnglishUnit(),snapshot=clone(original),hidden=original.fields[0],visible=original.fields[1],f=fixture();
    await f.store.import(scope,{units:[original],assets:[asset]});const {app}=visibleFieldsHarness(original);
    app._ctStore=f.store;app.ctSync=()=>{};app.ctLoadMemory=()=>{};app.ctDraftDirty=true;
    app.ctValues[hidden.id]='Authored hidden@value\\n\nkept';app.ctValues[visible.id]='Authored visible';
    assert.deepEqual(Array.from(app.ctFieldsFor(original),field=>field.name),['Text','Gender']);assert.equal(await app.ctSave(),true);
    const saved=(await f.store.getSaved(scope))[original.id],retained=await f.store.getUnit(scope,original.id),history=await f.store.listHistory(scope,original.id);
    assert.equal(saved.values[hidden.id],'Authored hidden@value\\n\nkept');assert.equal(saved.values[visible.id],'Authored visible');assert.equal(saved.values[original.fields[2].id],'F');
    assert.deepEqual(S.normalizeUnit(retained),S.normalizeUnit(snapshot));assert.equal(history.at(-1).after.values[hidden.id],saved.values[hidden.id]);
    assert.deepEqual(original,snapshot);assert.equal(app.ctStatus(original).saved,true);
});
test('late same-ID hydration cannot publish old blank-field drafts or focus into a replacement content group',async()=>{
    const original=blankEnglishUnit(),replacement=blankEnglishUnit(),pending=deferred(),{app}=visibleFieldsHarness(original,{ctSelection:'',ctValues:{}});
    replacement.fields[1].source='Replacement visible English';const values=S.valuesFor(replacement);
    app._ctStore={getDraft:()=>pending.promise};app.ctFlushDraft=async()=>true;app.ctFlushCommentDraft=async()=>{};
    app.ctLoadComments=()=>{};app.ctLoadCommentDraft=()=>{};app.ctFocusTarget=()=>assert.fail('Old hydration must not steal focus');
    const selecting=app.ctSelect(original,true);await settle();
    app.ctWorkspace={scope:{...scope,versionId:'v2',groupId:'replacement-group'}};app.ctUnits=[replacement];app._ctUnitIndex=new Map([[replacement.id,replacement]]);
    app.ctSelection=replacement.id;app.ctValues=values;app.ctFocusedField=replacement.fields[1].id;
    pending.resolve({values:{[original.fields[0].id]:'Old hidden draft'},revision:4});assert.equal(await selecting,false);
    assert.equal(app.ctValues,values);assert.equal(app.ctWorkspace.scope.groupId,'replacement-group');assert.equal(app.ctPreviewField,replacement.fields[1]);
    assert.equal(app.ctValues[replacement.fields[0].id],'RECOVERABLE_HIDDEN_TRANSLATION');
});

test('ClientText status chips default Unchanged off and use OR matching with scoped diagnostic IDs',()=>{
    const complete=namedUnit('ID1'),missing=namedUnit('ID2','Blank',''),outdated=namedUnit('ID3','Review','Translation',true),
        {app,mixin}=listHarness({ctUnits:[complete,missing,outdated],ctSelection:complete.id,_ctUnitIndex:new Map([complete,missing,outdated].map(value=>[value.id,value]))});
    app.ctSelectedFilters=mixin.data().ctSelectedFilters;
    assert.deepEqual(Array.from(app.ctSelectedFilters),['missing','saved','revised','outdated','error','warning']);
    assert.deepEqual(Array.from(app.ctRows,row=>row.id),[missing.id,outdated.id]);
    app.ctSelectedFilters.push('unchanged');assert.deepEqual(Array.from(app.ctRows,row=>row.id),[complete.id,missing.id,outdated.id]);
    app.ctSelectedFilters=['unchanged'];assert.deepEqual(Array.from(app.ctRows,row=>row.id),[complete.id]);
    app.ctDiagnostics={[complete.id]:[{severity:'error'},{severity:'error'},{severity:'warning'}],[missing.id]:[{severity:'warning'}]};
    assert.equal(app.ctDiagnosticCounts.error,1);assert.equal(app.ctDiagnosticCounts.warning,2);
    app.ctSelectedFilters=['error','outdated'];assert.deepEqual(Array.from(app.ctRows,row=>row.id),[complete.id,outdated.id]);
    assert.equal(app.ctStatusFilterOptions.find(option=>option.key==='warning').count,2);
    app.ctSelectedFilters=[];assert.equal(app.ctRows.length,0);
    app.ctFilter='missing';assert.deepEqual(Array.from(app.ctRows,row=>row.id),[missing.id],'legacy scalar filters remain compatible');
});
test('ClientText table sorting and search preserve raw @, literal escapes, newlines and committed values',()=>{
    const first=namedUnit('ID10','A@literal\\nactual\nline','Z'),second=namedUnit('ID2','B','A'),
        {app}=listHarness({ctUnits:[first,second],ctSelectedFilters:['unchanged','saved','revised']});
    assert.deepEqual(Array.from(app.ctRows,row=>row.recordId),['ID2','ID10']);
    app.ctSortBy('filename');assert.deepEqual(Array.from(app.ctRows,row=>row.recordId),['ID10','ID2']);
    app.ctSortBy('english');assert.equal(app.ctRows[0],first);
    const order=app._ctOrderCache.ascending;app.ctAppliedSearch='B';assert.equal(app.ctRows[0],second);assert.equal(app._ctOrderCache.ascending,order,'search filters reuse immutable source order');app.ctAppliedSearch='';
    app.ctSortBy('translation');assert.equal(app.ctRows[0],second);
    app.ctValues={[fieldId]:'0 draft'};assert.equal(app.ctRows[0],second,'drafts never change committed sort data');
    app.ctSaved={[first.id]:{values:{[fieldId]:'0 accepted'},revision:1,reviewed:{}}};assert.equal(app.ctRows[0],first,'saved identity invalidates target sort cache');
    app.ctSearch='literal\\n';app.ctApplySearch();assert.deepEqual(Array.from(app.ctRows,row=>row.id),[first.id]);
    app.ctSearch='literal\n';app.ctApplySearch();assert.equal(app.ctRows.length,0,'literal escape never becomes an actual newline');
    app.ctResetFilters();assert.equal(app.ctSearch,'');assert.equal(app.ctAppliedSearch,'');assert.equal(app.ctPage,1);
    assert.equal(first.fields[0].source,'A@literal\\nactual\nline');
});
test('row clicks follow inline preference and controls keep native editing and selection',async()=>{
    const {app,original}=listHarness(),calls=[];app.ctSelect=async(...args)=>{calls.push(args);return true;};
    for(const method of ['ctRowClick','ctRowDoubleClick'])assert.equal(app[method](original,rowEvent('',true)),false);
    const typing=rowEvent('Enter',true);assert.equal(await app.ctRowKeydown(original,typing),false);assert.equal(typing.defaultPrevented,undefined);
    await app.ctRowClick(original,rowEvent(''));assert.equal(calls.at(-1)[1],true);
    app.inlineEditor=true;await app.ctRowClick(original,rowEvent(''));assert.equal(calls.at(-1)[1],false);
    await app.ctRowDoubleClick(original,rowEvent(''));assert.equal(calls.at(-1)[1],true);
});
test('same-unit inline to full transitions preserve exact drafts, review choices, tool tab and history',async()=>{
    const {app,original}=listHarness({inlineEditor:true,ctTool:'history',ctHistory:[{key:'history'}],ctLookup:'retained lookup',ctDraftDirty:true}),
        values={[fieldId]:'@literal\\nactual\nไทย'},reviews={[fieldId]:'review'},choices=[{fieldId,local:'prior'}];
    app.ctValues=values;app.ctReviewed=reviews;app.ctChoices=choices;app.ctComments=[{text:'kept'}];let layouts=0,focus=0;
    app.ctFlushDraft=async()=>{throw Error('same-unit transition must not reload its draft');};
    app.observeInlineBlocks=()=>layouts++;app.ctFocusTarget=()=>focus++;
    assert.equal(await app.ctSelect(original,true),true);assert.equal(app.ctEditor,true);assert.equal(app.ctValues,values);assert.equal(app.ctReviewed,reviews);
    assert.equal(app.ctChoices,choices);assert.equal(app.ctTool,'history');assert.equal(app.ctHistory[0].key,'history');assert.equal(app.ctLookup,'retained lookup');
    assert.equal(app.ctComments[0].text,'kept');assert.equal(app.ctDraftDirty,true);assert.equal(layouts,1);assert.equal(focus,1);
});
test('a double-click during inline draft hydration keeps its full-editor intent without reloading the record',async()=>{
    const pending=deferred(),{app,original}=listHarness({inlineEditor:true,ctSelection:''});let reads=0;
    app.ctFlushDraft=async()=>true;app.ctFlushCommentDraft=async()=>true;
    app._ctStore={async getDraft(){reads++;return pending.promise;}};app.ctLoadComments=()=>{};app.ctLoadCommentDraft=()=>{};
    const selecting=app.ctRowClick(original,rowEvent(''));await settle();assert.equal(app.ctBusy,true);
    assert.equal(app.ctRowDoubleClick(original,rowEvent('')),true);pending.resolve({values:{[fieldId]:'preserved draft'},reviewed:{},revision:2});
    assert.equal(await selecting,true);assert.equal(reads,1);assert.equal(app.ctEditor,true);assert.equal(app.ctValues[fieldId],'preserved draft');assert.equal(app.ctDraftDirty,true);
});
test('keyboard list navigation uses the page-size preference, keeps row focus and fences late scope changes',async()=>{
    const rows=Array.from({length:5},(_,index)=>namedUnit('ID'+index)),{app}=listHarness({ctUnits:rows,ctSelectedFilters:['unchanged'],ctSelection:rows[0].id,
        _ctUnitIndex:new Map(rows.map(value=>[value.id,value]))}),focus=[];
    app.ctSelect=async(target,full,options)=>{assert.equal(full,false);assert.equal(options.focus,false);app.ctSelection=target.id;return true;};
    app.ctFocusRow=id=>focus.push(id);
    const next=rowEvent('PageDown');assert.equal(await app.ctRowKeydown(rows[0],next),true);assert.equal(next.defaultPrevented,true);
    assert.equal(app.ctSelection,rows[2].id);assert.equal(app.ctPage,2);assert.equal(focus.at(-1),rows[2].id);
    const end=rowEvent('End');await app.ctRowKeydown(null,end);assert.equal(app.ctSelection,rows[4].id);assert.equal(app.ctPage,3);
    const pending=deferred();app.ctSelect=()=>pending.promise;const moving=app.ctRowKeydown(rows[4],rowEvent('Home'));
    app.managedCatalogScope='bob:poe2';app.ctWorkspace={scope:{...scope,accountId:'bob'}};pending.resolve(true);
    assert.equal(await moving,false);assert.equal(focus.length,2,'late navigation never focuses another account workspace');
});
test('page changes and Close preserve durable drafts and cannot alter a replacement workspace',async()=>{
    const {app}=listHarness({ctUnits:[namedUnit('1'),namedUnit('2'),namedUnit('3')],ctSelectedFilters:['unchanged'],ctEditor:true}),pending=deferred();
    app.ctFlushDraft=()=>pending.promise;app.ctFlushCommentDraft=async()=>{};
    const turning=app.ctSetPage(2);app.ctWorkspace={scope:{...scope,groupId:'replacement'}};pending.resolve(true);
    assert.equal(await turning,false);assert.equal(app.ctPage,1);
    const closing=deferred();app.ctFlushDraft=()=>closing.promise;const close=app.ctCloseEditor();
    app.ctWorkspace={scope:{...scope,groupId:'newer'}};closing.resolve(true);assert.equal(await close,false);assert.equal(app.ctEditor,true);
    app.ctFlushDraft=async()=>true;let focused=0;app.ctFocusRow=()=>focused++;
    assert.equal(await app.ctCloseEditor(),true);assert.equal(app.ctEditor,false);assert.equal(focused,1);assert.ok(app.ctCurrentUnit);
});
test('Discard draft is revision-checked, preserves saved work and retains typing that arrived during deletion',async()=>{
    const f=fixture();await f.store.import(scope,{units:[unit()],assets:[asset]});
    const {app,original}=listHarness({ctDraftDirty:true,ctValues:{[fieldId]:'discard me'}});app._ctStore=f.store;
    const saved=await f.store.save(scope,original.id,{jobId:'accepted',values:{[fieldId]:'Saved exact@\\n'},reviewed:{}});
    app.ctSaved={[original.id]:saved.saved};app._ctEditRevision=saved.saved.revision;
    assert.equal(await app.ctDiscardDraft(),true);assert.ok(!await f.store.getDraft(scope,original.id));
    assert.equal(app.ctValues[fieldId],'Saved exact@\\n');assert.equal(app.ctDraftDirty,false);assert.equal((await f.store.getSaved(scope))[original.id].values[fieldId],'Saved exact@\\n');
    const pending=deferred(),calls=[];app.ctValues={[fieldId]:'old draft'};app.ctDraftDirty=true;
    app.ctFlushDraft=async()=>{app._ctDraftRevision=8;return true;};app._ctStore={async discardDraft(captured,id,options){calls.push({captured,id,options});await pending.promise;}};
    app.ctQueueDraft=()=>calls.push('new draft queued');const removing=app.ctDiscardDraft();await settle();app.ctValues[fieldId]='newer typing';pending.resolve();
    assert.equal(await removing,false);assert.equal(app.ctValues[fieldId],'newer typing');assert.equal(app.ctDraftDirty,true);
    assert.equal(calls[0].options.expectedRevision,8);assert.equal(calls[0].captured.groupId,scope.groupId);assert.equal(calls[1],'new draft queued');
});
test('inline translation shortcuts respect autocomplete, raw text and read-only diagnostic modal boundaries',async()=>{
    const {app,original,inputFor,event,focuses}=keyboardHarness(),field=original.fields[0],first=inputFor(original,field);first.focus();
    const tab=event(field,'Tab');await app.ctTargetKeydown(field,tab);
    assert.equal(tab.defaultPrevented,true);assert.equal(focuses.at(-1).fieldId,original.fields[1].id);
    app.ctValues[field.id]='raw@literal\\nactual\nไทย';let selects=0;app.ctSelect=async(target,full)=>{assert.equal(target,original);assert.equal(full,true);selects++;};
    first.focus();const enter=event(field,'Enter',{ctrlKey:true});await app.ctTargetKeydown(field,enter);assert.equal(selects,1);assert.equal(app.ctValues[field.id],'raw@literal\\nactual\nไทย');
    app.ctCompletion={fieldId:field.id,items:[]};const escape=event(field,'Escape');app.ctTargetKeydown(field,escape);assert.equal(escape.defaultPrevented,true);assert.equal(app.ctCompletion,null);
    const composing=event(field,'Enter',{ctrlKey:true,isComposing:true});app.ctTargetKeydown(field,composing);assert.equal(selects,1);
    let saves=0;app.ctSave=async()=>saves++;app.$refs.ctDiagnosticDialog={open:true,close(){this.open=false;}};
    const save=rowEvent('F2');await app.ctKey(save);assert.equal(saves,0);
    let scanned;app.ctIncludeConsistency=false;app.ctScan=value=>scanned=value;app.ctStartScan();assert.equal(scanned,false);assert.equal(app.$refs.ctDiagnosticDialog.open,false);
    const sideSave=rowEvent('F2',true);await app.ctKey(sideSave);assert.equal(saves,0,'sidebar controls never save the underlying translation');
});
test('ClientText target navigation uses numeric worksheet columns without changing immutable export coordinates',()=>{
    const {app,original,inputs}=keyboardHarness(),before=clone(original),fieldIds=original.fields.map(field=>field.id),
        expected=['D2','F2','H2','I2','Z2','AB2'];
    assert.deepEqual(Array.from(app.ctTabFields(),field=>field.targetCell),expected);
    assert.deepEqual(Array.from(app.ctTargetInputs(),input=>original.fields.find(field=>field.id===input.dataset.ctTarget).targetCell),expected);
    assert.deepEqual(Array.from(inputs(),input=>original.fields.find(field=>field.id===input.dataset.ctTarget).targetCell),['F2','H2','I2','Z2','AB2','D2'],
        'rendered grouped order deliberately differs from worksheet order');
    assert.deepEqual(original,before);assert.deepEqual(original.fields.map(field=>field.id),fieldIds);
    assert.equal(app.ctTabFields().find(field=>field.kind==='form' && !field.target).required,false,'optional blank forms stay in the navigation order');
});

for(const full of [false,true])test(`worksheet-order Tab and Shift+Tab ${full?'full':'inline'} traversal skips hidden English and includes Gender and optional forms`,async()=>{
    const {app,original,inputFor,event,focuses}=keyboardHarness(undefined,{ctEditor:full}),byCell=cell=>original.fields.find(field=>field.targetCell===cell);
    for(const [from,to,reverse] of [['D2','F2',false],['F2','H2',false],['H2','I2',false],['I2','Z2',false],['Z2','AB2',false],
        ['AB2','Z2',true],['Z2','I2',true],['I2','H2',true],['H2','F2',true],['F2','D2',true]]){
        const field=byCell(from),input=inputFor(original,field);input.focus();const key=event(field,'Tab',{shiftKey:reverse});
        await app.ctTargetKeydown(field,key);assert.equal(key.defaultPrevented,true,from+' to '+to);assert.equal(key.propagationStopped,true);
        assert.equal(focuses.at(-1).fieldId,byCell(to).id);assert.equal(app.ctFocusedField,byCell(to).id);
    }
    assert.equal(app.ctValues[byCell('K2').id],'Hidden authored translation');assert.equal(app.ctValues[byCell('I2').id],'');
});

test('inline worksheet boundaries save and navigate inline while full boundaries retain native surrounding controls',async()=>{
    const {app,original,inputFor,event}=keyboardHarness(),calls=[],first=original.fields.find(field=>field.targetCell==='D2'),last=original.fields.find(field=>field.targetCell==='AB2');
    app.ctSaveAndNavigate=async(...args)=>{calls.push(args);return true;};
    for(const [field,reverse] of [[last,false],[first,true]]){
        inputFor(original,field).focus();const key=event(field,'Tab',{shiftKey:reverse});await app.ctTargetKeydown(field,key);
        assert.equal(key.defaultPrevented,true);assert.equal(calls.at(-1)[0],reverse);assert.equal(calls.at(-1)[1].inline,true);assert.equal(calls.at(-1)[1].focusEnd,reverse);
    }
    const count=calls.length;app.ctEditor=true;
    for(const [field,reverse] of [[last,false],[first,true]]){
        inputFor(original,field).focus();const key=event(field,'Tab',{shiftKey:reverse});await app.ctTargetKeydown(field,key);assert.equal(key.defaultPrevented,undefined);
    }
    assert.equal(calls.length,count,'the full editor never moves to another ID on Tab');
});

test('full worksheet Tab reaches review and choice buttons before adjacent outside controls',async()=>{
    const {app,window,original,inputFor,event,focuses,controls,documentControls,inputs}=keyboardHarness(undefined,{ctEditor:true}),before=clone(app.ctValues);
    const control=(name,disabled=false)=>({dataset:{},tabIndex:0,isConnected:true,disabled,closest:()=>null,getClientRects:()=>[{}],
        focus(){window.document.activeElement=this;focuses.push({control:name});}});
    const prior=control('previous outside'),next=control('next outside'),disabled=control('disabled review',true),review=control('review'),choice=control('choice');
    controls.push(disabled,review,choice);documentControls.push(prior,...inputs(),...controls,next);
    const first=original.fields.find(field=>field.targetCell==='D2'),last=original.fields.find(field=>field.targetCell==='AB2');
    inputFor(original,last).focus();const toReview=event(last,'Tab');await app.ctTargetKeydown(last,toReview);
    assert.equal(toReview.defaultPrevented,true);assert.equal(focuses.at(-1).control,'review');
    const fromReview={...rowEvent('Tab'),target:review,shiftKey:true};app.ctFieldsKeydown(fromReview);assert.equal(fromReview.defaultPrevented,true);
    assert.equal(focuses.at(-1).fieldId,last.id,'reverse from the first auxiliary button reaches the last worksheet cell');
    const toChoice={...rowEvent('Tab'),target:review};app.ctFieldsKeydown(toChoice);assert.equal(toChoice.defaultPrevented,true);assert.equal(focuses.at(-1).control,'choice');
    const toNext={...rowEvent('Tab'),target:choice};app.ctFieldsKeydown(toNext);assert.equal(toNext.defaultPrevented,true);assert.equal(focuses.at(-1).control,'next outside');
    inputFor(original,first).focus();const toPrior=event(first,'Tab',{shiftKey:true});await app.ctTargetKeydown(first,toPrior);
    assert.equal(toPrior.defaultPrevented,true);assert.equal(focuses.at(-1).control,'previous outside');
    const count=focuses.length;
    for(const flags of [{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true}])app.ctFieldsKeydown({...rowEvent('Tab'),target:review,...flags});
    assert.equal(focuses.length,count);assert.deepEqual(app.ctValues,before);assert.equal(app.ctEditor,true);assert.equal(app.ctSelection,original.id);
});

test('completion and whole-cell optional-form NONEXISTENT take precedence over worksheet traversal',async()=>{
    const {app,original,inputFor,event,focuses}=keyboardHarness(),form=original.fields.find(field=>field.form==='FS'),input=inputFor(original,form);
    input.focus();app.ctValues[form.id]='NON';input.setSelectionRange(3,3);let moves=0;app.ctSaveAndNavigate=async()=>{moves++;};
    const non=event(form,'Tab');await app.ctTargetKeydown(form,non);assert.equal(non.defaultPrevented,true);assert.equal(app.ctValues[form.id],'NONEXISTENT');assert.equal(moves,0);
    form.source='[First] [Second]';app.ctValues[form.id]='[';input.setSelectionRange(1,1);assert.equal(app.ctSuggest(form,{target:input}),true);
    const tab=event(form,'Tab');await app.ctTargetKeydown(form,tab);assert.equal(tab.defaultPrevented,true);
    assert.equal(app.ctValues[form.id],'[First]');assert.equal(focuses.at(-1).fieldId,form.id,'completion inserts into the current field rather than moving');
    app.ctValues[form.id]='[';input.setSelectionRange(1,1);app.ctSuggest(form,{target:input});const backward=event(form,'Tab',{shiftKey:true});
    await app.ctTargetKeydown(form,backward);assert.equal(app.ctCompletion,null);assert.equal(app.ctValues[form.id],'[');assert.equal(app.ctFocusedField,original.fields.find(field=>field.form==='MS').id);
});

test('inline Ctrl+Enter and Escape return to the exact worksheet field and caret without rehydrating or changing raw drafts',async()=>{
    const {app,original,inputFor,event,focuses}=keyboardHarness(),form=original.fields.find(field=>field.form==='FS'),input=inputFor(original,form),
        values=S.valuesFor(original),reviews={[form.id]:'retained review'},choices=[{fieldId:form.id,local:'retained alternative'}];
    values[form.id]='@raw\\nactual\nไทย';app.ctValues=values;app.ctReviewed=reviews;app.ctChoices=choices;app.ctDraftDirty=true;app.ctTool='history';
    app._ctStore.getDraft=()=>assert.fail('the same immutable record must not be rehydrated');input.focus();input.setSelectionRange(2,7,'backward');
    const enter=event(form,'Enter',{ctrlKey:true});await app.ctTargetKeydown(form,enter);
    assert.equal(enter.defaultPrevented,true);assert.equal(enter.propagationStopped,true);assert.equal(app.ctEditor,true);assert.equal(app.ctFocusedField,form.id);
    assert.equal(focuses.at(-1).fieldId,form.id);assert.equal(app.ctValues,values);assert.equal(app.ctReviewed,reviews);assert.equal(app.ctChoices,choices);
    app.ctValues[form.id]+=' edited';const escape=event(form,'Escape');await app.ctTargetKeydown(form,escape);if(!escape.defaultPrevented)await app.ctKey(escape);
    assert.equal(escape.defaultPrevented,true);assert.equal(app.ctEditor,false);assert.equal(app.ctFocusedField,form.id);assert.equal(focuses.at(-1).fieldId,form.id);
    assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,7);assert.equal(app.ctValues[form.id],'@raw\\nactual\nไทย edited');
    assert.equal(app.ctDraftDirty,true);assert.equal(app.ctTool,'history');assert.equal(app.ctValues,values);
});

test('worksheet keyboard navigation rejects IME, modifiers, busy work, overlays and pending selection',async()=>{
    const cases=[{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true},{defaultPrevented:true},
        {state:{ctBusy:true}},{state:{ctActive:false}},{state:{ctHistoryViewer:true}},{state:{versionChooserVisible:true}},
        {state:{settingsDialogVisible:true}},{state:{showSetting:true}},{state:{ctUploadVisible:true}},
        {dialog:true},{pending:true}];
    for(const changed of cases){
        const {app,original,inputFor,event,focuses}=keyboardHarness(),field=original.fields[0],input=inputFor(original,field);input.focus();
        let moves=0,opens=0;app.ctSaveAndNavigate=async()=>moves++;app.ctOpenInlineFull=async()=>opens++;
        Object.assign(app,changed.state);if(changed.dialog)app.$refs.ctDiagnosticDialog={open:true};
        if(changed.pending)app._ctSelectRun={unitId:original.id,ctx:app.ctContext(),pending:true};
        const count=focuses.length,key=event(field,'Tab',Object.fromEntries(Object.entries(changed).filter(([key])=>!['state','dialog','pending'].includes(key))));
        await app.ctTargetKeydown(field,key);assert.equal(focuses.length,count,JSON.stringify(changed));assert.equal(moves,0);assert.equal(opens,0);
    }
});

test('worksheet keyboard events cannot navigate from detached, unrelated, hidden or obsolete same-ID fields',async()=>{
    const cases=['detached','wrong-field','foreign-input','hidden','old-source','same-id-group'];
    for(const changed of cases){
        const {app,original,inputFor,event,focuses}=keyboardHarness(),field=original.fields[0],input=inputFor(original,field);input.focus();
        const key=event(field,'Tab');let requestedField=field;
        if(changed==='detached')input.isConnected=false;
        if(changed==='wrong-field')input.dataset.ctTarget='not-this-field';
        if(changed==='foreign-input')key.target={...input,closest:()=>null};
        if(changed==='hidden'){requestedField=original.fields.find(field=>field.targetCell==='K2');key.target=inputFor(original,requestedField);}
        if(changed==='old-source')requestedField={...field,source:'Different historical English'};
        if(changed==='same-id-group'){
            const next=worksheetUnit();app.ctWorkspace={scope:{...scope,groupId:'replacement'}};app.ctUnits=[next];app._ctUnitIndex=new Map([[next.id,next]]);app.ctValues=S.valuesFor(next);
        }
        const count=focuses.length;await app.ctTargetKeydown(requestedField,key);assert.equal(focuses.length,count,changed);
        assert.equal(app.ctValues[field.id],'Main translation',changed+' preserves the current values');
    }
});

test('inline special shortcuts keep inline destinations while F1/F2 retain their full-editor behavior',async()=>{
    const {app,original,inputFor,event}=keyboardHarness(),field=original.fields[0],calls=[];inputFor(original,field).focus();
    app.ctSaveAndNavigate=async(...args)=>{calls.push(['navigate',...args]);return true;};app.ctSave=async(close=false)=>{calls.push(['save',close]);return true;};
    for(const [key,reverse] of [['ArrowUp',true],['ArrowDown',false]]){
        const arrow=event(field,key,{ctrlKey:true});await app.ctTargetKeydown(field,arrow);if(!arrow.defaultPrevented)await app.ctKey(arrow);
        assert.equal(arrow.defaultPrevented,true);assert.equal(calls.at(-1)[0],'navigate');assert.equal(calls.at(-1)[1],reverse);assert.equal(calls.at(-1)[2].inline,true);
    }
    const save=event(field,'s',{code:'KeyS',ctrlKey:true});await app.ctKey(save);assert.deepEqual(calls.at(-1),['save',false]);
    for(const [key,reverse] of [['F1',true],['F2',false]]){
        const next=event(field,key,{code:key});await app.ctKey(next);assert.equal(next.defaultPrevented,true);assert.equal(calls.at(-1)[1],reverse);
        assert.equal(calls.at(-1)[2]?.inline,undefined,'F1/F2 keep the established full-editor destination');
    }
    const count=calls.length;
    for(const modifiers of [{ctrlKey:true,shiftKey:true},{ctrlKey:true,altKey:true},{ctrlKey:true,metaKey:true},{ctrlKey:true,isComposing:true},{ctrlKey:true,keyCode:229}]){
        const ignored=event(field,'ArrowDown',modifiers);await app.ctTargetKeydown(field,ignored);if(!ignored.defaultPrevented)await app.ctKey(ignored);assert.equal(calls.length,count);
    }
});

test('Ctrl+Up/Down only navigate from current inline translations and selected row or table background',async()=>{
    const rows=[worksheetUnit('ID1'),worksheetUnit('ID2',3),worksheetUnit('ID3',4)],
        {app,inputFor}=keyboardHarness(rows[1],{ctUnits:rows,_ctUnitIndex:new Map(rows.map(unit=>[unit.id,unit])),ctDraftDirty:true});
    const field=rows[1].fields[0],input=inputFor(rows[1],field),tableMembers=new Set(),table={contains:target=>tableMembers.has(target),closest:()=>null},
        selectedRow={dataset:{unitId:rows[1].id}},otherRow={dataset:{unitId:rows[0].id}};
    app.$refs.ctFileTableRegion=table;app.ctValues[field.id]='Underlying raw@draft\\n\n';let saves=0,opens=0;
    app.ctSave=async()=>{saves++;return false;};app.ctSelect=async()=>{opens++;return true;};
    const target=(kind,row=null,inside=false)=>{const node={closest(selector){
        if(selector==='tr[data-unit-id]')return row;
        if(selector==='.ctTools')return kind==='sidebar'?{}:null;
        if(selector.startsWith('textarea,input,'))return ['search','navbar','source','sidebar','button','link','select'].includes(kind)?{}:null;
        return null;
    }};if(inside)tableMembers.add(node);return node;};
    const excluded=[['search',target('search')],['navbar',target('navbar')],['source',target('source',selectedRow,true)],
        ['other row',target('background',otherRow,true)],['sidebar',target('sidebar')],['row button',target('button',selectedRow,true)],
        ['row link',target('link',selectedRow,true)],['row select',target('select',selectedRow,true)],['unrelated background',target('background',selectedRow)]];
    for(const [name,node] of excluded)for(const key of ['ArrowUp','ArrowDown']){
        const arrow={...rowEvent(key),ctrlKey:true,target:node};await app.ctKey(arrow);
        assert.equal(arrow.defaultPrevented,undefined,name);assert.equal(saves,0,name+' cannot save the underlying draft');assert.equal(opens,0,name);
        assert.equal(app.ctSelection,rows[1].id);assert.equal(app.ctValues[field.id],'Underlying raw@draft\\n\n');
    }
    for(const node of [input,target('background',selectedRow,true),table])for(const key of ['ArrowUp','ArrowDown']){
        const before=saves,arrow={...rowEvent(key),ctrlKey:true,target:node};await app.ctKey(arrow);
        assert.equal(arrow.defaultPrevented,true);assert.equal(saves,before+1,'a current editing target routes through the save guard');
        assert.equal(opens,0,'failed save still preserves the current ID');assert.equal(app.ctSelection,rows[1].id);
    }
});

for(const full of [false,true])test('Shared Dictionary history blocks underlying '+(full?'full':'inline')+' save, navigation and Escape shortcuts',async()=>{
    const {app,original,event}=keyboardHarness(undefined,{ctEditor:full,cloudHistoryVisible:true,ctDraftDirty:true}),field=original.fields[0],
        values=app.ctValues,calls=[];app.ctValues[field.id]='Underlying raw@draft\\n\n';
    for(const name of ['ctSave','ctSaveAndNavigate','ctDownload','ctNavigate','ctCloseEditor','ctCloseInline','ctCloseHistoryViewer'])
        app[name]=async()=>calls.push(name);
    app.ctCompletion={fieldId:field.id,items:[{value:'[Retained]'}]};const completion=app.ctCompletion;
    for(const [key,flags] of [['s',{ctrlKey:true,code:'KeyS'}],['s',{metaKey:true,code:'KeyS'}],['F1',{}],['F2',{}],
        [',',{ctrlKey:true,code:'Comma'}],['.',{ctrlKey:true,code:'Period'}]]){
        const keypress=event(field,key,flags);await app.ctKey(keypress);assert.equal(keypress.defaultPrevented,true);
    }
    const escape=event(field,'Escape');await app.ctKey(escape);assert.equal(escape.defaultPrevented,undefined,'the overlay keeps its own Escape handling');
    assert.deepEqual(calls,[]);assert.equal(app.ctCompletion,completion);assert.equal(app.ctValues,values);assert.equal(app.ctDraftDirty,true);
    assert.equal(app.ctValues[field.id],'Underlying raw@draft\\n\n');assert.equal(app.ctEditor,full);assert.equal(app.ctInlineClosed,false);assert.equal(app.cloudHistoryVisible,true);
    app.ctCompletion=null;app.cloudHistoryVisible=false;app.ctHistoryViewer=true;const ownHistoryEscape=event(field,'Escape');await app.ctKey(ownHistoryEscape);
    assert.equal(ownHistoryEscape.defaultPrevented,true);assert.deepEqual(calls,['ctCloseHistoryViewer'],'CT history retains its own Escape action');
});

for(const overlay of ['settingsDialogVisible','cloudHistoryVisible'])test('guarded selection cancels pending preparation/render behind '+overlay+' and releases busy/pending for retry',async()=>{
    for(const phase of ['draft','comment','hydrate','render']){
        const rows=[worksheetUnit('ID1'),worksheetUnit('ID2',3)],{app,focuses}=keyboardHarness(rows[0],{ctUnits:rows,
            _ctUnitIndex:new Map(rows.map(unit=>[unit.id,unit]))}),pending=deferred(),values=app.ctValues;
        app.ctFlushDraft=phase==='draft'?()=>pending.promise:async()=>true;
        app.ctFlushCommentDraft=phase==='comment'?()=>pending.promise:async()=>{};
        app._ctStore.getDraft=phase==='hydrate'?()=>pending.promise:async()=>null;
        app.$nextTick=phase==='render'?()=>pending.promise:async()=>{};
        const selecting=app.ctSelect(rows[1],true,{guard:()=>!app.ctKeyboardOverlayOpen()});await settle();
        assert.equal(app._ctSelectRun.pending,true,phase);if(phase==='hydrate')assert.equal(app.ctBusy,true);
        app[overlay]=true;pending.resolve(phase==='hydrate'?{revision:2,values:{[rows[1].fields[0].id]:'Target durable draft'}}:true);
        assert.equal(await selecting,false,phase);assert.equal(app._ctSelectRun.pending,false,phase+' must release its pending selection');
        assert.equal(app.ctBusy,false,phase+' must release its owned busy state');assert.equal(focuses.length,0,phase+' cannot focus behind the overlay');
        if(phase!=='render'){assert.equal(app.ctSelection,rows[0].id);assert.equal(app.ctEditor,false);assert.equal(app.ctValues,values);}
        else{assert.equal(app.ctSelection,rows[1].id);assert.equal(app.ctEditor,true,'a transition committed before the overlay stays selected');}
        app[overlay]=false;app.ctFlushDraft=async()=>true;app.ctFlushCommentDraft=async()=>{};app._ctStore.getDraft=async()=>null;app.$nextTick=async()=>{};
        assert.equal(await app.ctSelect(rows[1],true,{guard:()=>!app.ctKeyboardOverlayOpen()}),true,phase+' must permit a later retry');
        assert.equal(app._ctSelectRun.pending,false);assert.equal(app.ctBusy,false);assert.equal(focuses.length,1);
    }
});

for(const overlay of ['settingsDialogVisible','cloudHistoryVisible'])test('deferred inline navigation cannot change records behind '+overlay,async()=>{
    for(const phase of ['save','hydrate','render']){
        const rows=[worksheetUnit('ID1'),worksheetUnit('ID2',3)],{app,focuses}=keyboardHarness(rows[0],{ctUnits:rows,
            _ctUnitIndex:new Map(rows.map(unit=>[unit.id,unit])),ctDraftDirty:true}),pending=deferred(),reached=deferred(),values=app.ctValues;
        app.ctValues[rows[0].fields[0].id]='Pending raw@work\\n\n';
        const pause=()=>{reached.resolve();return pending.promise;};
        app.ctSave=phase==='save'?pause:async()=>true;
        app._ctStore.getDraft=phase==='hydrate'?pause:async()=>null;app.$nextTick=phase==='render'?pause:async()=>{};
        const moving=app.ctSaveAndNavigate(false,{inline:true});await reached.promise;app[overlay]=true;pending.resolve(phase==='hydrate'?null:true);
        assert.equal(await moving,false,phase);assert.equal(app._ctNavigationRun,null);assert.equal(app._ctSelectRun?.pending || false,false);assert.equal(app.ctBusy,false);
        assert.equal(focuses.length,0);assert.equal(app.ctEditor,false);
        if(phase!=='render'){assert.equal(app.ctSelection,rows[0].id);assert.equal(app.ctValues,values);assert.equal(app.ctValues[rows[0].fields[0].id],'Pending raw@work\\n\n');}
        else assert.equal(app.ctSelection,rows[1].id,'an already committed selection is retained without stealing overlay focus');
    }
});

for(const overlay of ['settingsDialogVisible','cloudHistoryVisible'])test('deferred inline/full handoff and closes cannot focus or toggle after '+overlay+' opens',async()=>{
    const {app,original,inputFor,event,focuses}=keyboardHarness(),field=original.fields.find(field=>field.form==='FS'),input=inputFor(original,field),pending=deferred();
    input.focus();input.setSelectionRange(0,0);app.$nextTick=()=>pending.promise;const focusCount=focuses.length;
    const opening=app.ctTargetKeydown(field,event(field,'Enter',{ctrlKey:true}));await settle();assert.equal(app.ctEditor,true);
    app[overlay]=true;pending.resolve();assert.equal(await opening,false);assert.equal(focuses.length,focusCount);assert.equal(app._ctInlineReturn,null);
    assert.equal(app._ctSelectRun.pending,false);assert.equal(app.ctBusy,false);
    app[overlay]=false;app.ctEditor=false;app.$nextTick=async()=>{};input.focus();assert.equal(await app.ctOpenInlineFull(field,input),true,'handoff retry succeeds after the overlay closes');
    for(const full of [true,false])for(const phase of ['draft','comment','render']){
        app.ctEditor=full;app.ctInlineClosed=false;const closePending=deferred(),count=focuses.length;
        app.ctFlushDraft=phase==='draft'?()=>closePending.promise:async()=>true;app.ctFlushCommentDraft=phase==='comment'?()=>closePending.promise:async()=>{};
        app.$nextTick=phase==='render'?()=>closePending.promise:async()=>{};
        const closing=full?app.ctCloseEditor():app.ctCloseInline();await settle();
        const editorBefore=app.ctEditor,inlineBefore=app.ctInlineClosed;app[overlay]=true;closePending.resolve(true);
        assert.equal(await closing,false);assert.equal(focuses.length,count);assert.equal(app._ctCloseRun,null);
        assert.equal(app.ctEditor,editorBefore);assert.equal(app.ctInlineClosed,inlineBefore,'cancellation never introduces a new close toggle behind the overlay');
        if(phase!=='render'){assert.equal(app.ctEditor,full);assert.equal(app.ctInlineClosed,false);}
        app[overlay]=false;app.ctFlushDraft=async()=>true;app.ctFlushCommentDraft=async()=>{};app.$nextTick=async()=>{};
        assert.equal(await (full?app.ctCloseEditor():app.ctCloseInline()),true,'close can be retried after the overlay closes');assert.equal(app._ctCloseRun,null);
    }
});

test('inline Escape closes completion first then closes only the inline session after its draft is durable',async()=>{
    const {app,original,inputFor,event,focuses}=keyboardHarness(),field=original.fields[0],input=inputFor(original,field);field.source='[First]';
    app.ctValues[field.id]='[';input.focus();input.setSelectionRange(1,1);assert.equal(app.ctSuggest(field,{target:input}),true);
    const first=event(field,'Escape');await app.ctTargetKeydown(field,first);if(!first.defaultPrevented)await app.ctKey(first);
    assert.equal(first.defaultPrevented,true);assert.equal(app.ctCompletion,null);assert.equal(app.ctInlineClosed,false);assert.equal(app.ctEditor,false);
    const pending=deferred();app.ctFlushDraft=()=>pending.promise;const second=event(field,'Escape'),closing=app.ctTargetKeydown(field,second);
    await settle();assert.equal(app.ctInlineClosed,false,'an unresolved draft write keeps the inline editor visible');pending.resolve(true);
    await closing;if(!second.defaultPrevented)await app.ctKey(second);assert.equal(second.defaultPrevented,true);assert.equal(app.ctInlineClosed,true);
    assert.equal(app.ctSelection,original.id);assert.equal(app.ctValues[field.id],'[');assert.equal(focuses.at(-1).row,true);
});

for(const changed of ['account','group','unit','run'])test(`late inline-full field focus and return ignore replacement ${changed}`,async()=>{
    const {app,original,inputFor,event,focuses}=keyboardHarness(),field=original.fields.find(field=>field.form==='FS'),input=inputFor(original,field),pending=deferred();
    input.focus();input.setSelectionRange(0,0);app.$nextTick=()=>pending.promise;const count=focuses.length;
    const opening=app.ctTargetKeydown(field,event(field,'Enter',{ctrlKey:true}));await settle();
    if(changed==='account')app.ctWorkspace={scope:{...scope,accountId:'other-account'}};
    if(changed==='group')app.ctWorkspace={scope:{...scope,groupId:'other-group'}};
    if(changed==='unit'){const next=worksheetUnit();app.ctUnits=[next];app._ctUnitIndex=new Map([[next.id,next]]);}
    if(changed==='run')app._ctSelectRun={ctx:app.ctContext(),unitId:original.id,pending:false};
    pending.resolve();await opening;assert.equal(focuses.length,count,'delayed opening never focuses replacement content');
    app.ctEditor=true;app.$nextTick=async()=>{};app.ctFlushDraft=async()=>true;app.ctFlushCommentDraft=async()=>{};
    await app.ctCloseEditor();assert.equal(focuses.at(-1).row,true,'obsolete return evidence falls back to the current row');
});

test('late full-to-inline return keeps a replacement same-ID group and newer drafts intact',async()=>{
    const {app,original,inputFor,event,focuses}=keyboardHarness(),field=original.fields.find(field=>field.form==='FS'),input=inputFor(original,field);
    input.focus();await app.ctTargetKeydown(field,event(field,'Enter',{ctrlKey:true}));assert.equal(app.ctEditor,true);
    const pending=deferred();app.ctFlushDraft=()=>pending.promise;const count=focuses.length,closing=app.ctCloseEditor();await settle();
    const next=worksheetUnit();app.ctWorkspace={scope:{...scope,groupId:'new-group'}};app.ctUnits=[next];app._ctUnitIndex=new Map([[next.id,next]]);
    const values={...S.valuesFor(next),[field.id]:'New group raw@draft\\n\n'};app.ctValues=values;app.ctFocusedField=next.fields[0].id;app.ctDraftDirty=true;
    pending.resolve(true);assert.equal(await closing,false);assert.equal(app.ctEditor,true);assert.equal(app.ctValues,values);assert.equal(app.ctFocusedField,next.fields[0].id);
    assert.equal(focuses.length,count);assert.equal(app.ctDraftDirty,true);
});

test('dirty inline drafts at a worksheet boundary or before only occupied IDs are retained without saving',async()=>{
    for(const scenario of ['next-boundary','previous-boundary','all-occupied']){
        const rows=[worksheetUnit('ID1'),worksheetUnit('ID2',3),worksheetUnit('ID3',4)],index=scenario==='next-boundary'?2:0,
            {app,focuses}=keyboardHarness(rows[index],{ctUnits:rows,_ctUnitIndex:new Map(rows.map(unit=>[unit.id,unit])),
                ctDraftDirty:true,ctPage:Math.floor(index/2)+1,instanceTabId:'our-session'}),original=rows[index],field=original.fields[0];let saves=0,opens=0;
        app.ctValues[field.id]='Unsaved@draft\\n\nstill recoverable';app.ctSave=async()=>{saves++;return true;};app.ctSelect=async()=>{opens++;return true;};
        if(scenario==='all-occupied')app.ctPeers=rows.slice(1).map(unit=>({unitId:unit.id,sessionId:'other-session',away:false}));
        assert.equal(await app.ctSaveAndNavigate(scenario==='previous-boundary',{inline:true,focusEnd:scenario==='previous-boundary'}),false);
        assert.equal(saves,0,scenario);assert.equal(opens,0,scenario);assert.equal(focuses.length,0);assert.equal(app.ctSelection,original.id);
        assert.equal(app.ctValues[field.id],'Unsaved@draft\\n\nstill recoverable');assert.equal(app.ctDraftDirty,true);
    }
});

test('inline cross-ID navigation saves exact raw work, skips all-blank and occupied IDs and focuses the worksheet edge',async()=>{
    const rows=[worksheetUnit('ID1'),worksheetUnit('ID2',3),worksheetUnit('ID3',4),worksheetUnit('ID4',5)];
    for(const field of rows[1].fields)if(field.kind!=='gender')field.source=' \t\n';
    const f=fixture();await f.store.import(scope,{units:rows,assets:[asset]});
    const {app,focuses}=keyboardHarness(rows[0],{ctUnits:rows,_ctUnitIndex:new Map(rows.map(unit=>[unit.id,unit])),ctDraftDirty:true,
        instanceTabId:'our-session',ctPeers:[{unitId:rows[2].id,sessionId:'other-session',away:false}]});
    app._ctStore=f.store;app.ctLoadMemory=()=>{};app.ctSync=()=>{};const first=rows[0].fields[0],last=rows[3].fields.find(field=>field.targetCell==='AB5');
    app.ctValues[first.id]='Raw@translated\\n\nline';assert.equal(await app.ctSaveAndNavigate(false,{inline:true,focusEnd:false}),true);
    assert.equal((await f.store.getSaved(scope))[rows[0].id].values[first.id],'Raw@translated\\n\nline');assert.equal(app.ctSelection,rows[3].id);
    assert.equal(app.ctEditor,false);assert.equal(app.ctFocusedField,rows[3].fields.find(field=>field.targetCell==='D5').id);assert.equal(app.ctPage,2);
    assert.equal(focuses.at(-1).unitId,rows[3].id);assert.equal(await app.ctSaveAndNavigate(true,{inline:true,focusEnd:true}),true);
    assert.equal(app.ctSelection,rows[0].id);assert.equal(app.ctEditor,false);assert.equal(app.ctFocusedField,last.id,'backward traversal focuses the last visible worksheet column');
    assert.equal((await f.store.getSaved(scope))[rows[3].id],undefined,'an untouched optional-form record does not manufacture a save');
});

test('full save navigation keeps the current physical sort anchor when a filter hides the active ID',async()=>{
    const rows=[namedUnit('ID1','Earlier',''),namedUnit('ID2','Current','Complete'),namedUnit('ID3','Later','')],
        {app}=listHarness({ctUnits:rows,_ctUnitIndex:new Map(rows.map(unit=>[unit.id,unit])),ctSelection:rows[1].id,ctEditor:true,
            ctSelectedFilters:['missing'],ctValues:S.valuesFor(rows[1])}),calls=[];
    app.ctValues[fieldId]='Corrected@translation\\n\n';app.ctSave=async()=>{calls.push('save');return true;};
    app.ctSelect=async(target,full)=>{calls.push(target.id);app.ctSelection=target.id;app.ctEditor=full;return true;};
    assert.deepEqual(Array.from(app.ctRows,unit=>unit.id),[rows[0].id,rows[2].id]);assert.equal(await app.ctSaveAndNavigate(),true);
    assert.deepEqual(calls,['save',rows[2].id]);assert.equal(app.ctSelection,rows[2].id);assert.equal(app.ctEditor,true);
});

test('failed or late inline boundary saves cannot select a different ID or steal replacement focus',async()=>{
    for(const changed of ['failure','account','group','same-id-unit','selection-run']){
        const rows=[worksheetUnit('ID1'),worksheetUnit('ID2',3)],{app,focuses}=keyboardHarness(rows[0],{ctUnits:rows,
            _ctUnitIndex:new Map(rows.map(unit=>[unit.id,unit])),ctDraftDirty:true}),pending=deferred();let opens=0;
        app.ctValues[rows[0].fields[0].id]='Retained draft';app.ctSave=()=>pending.promise;app.ctSelect=async()=>{opens++;return true;};
        const moving=app.ctSaveAndNavigate(false,{inline:true});await settle();
        if(changed==='account')app.ctWorkspace={scope:{...scope,accountId:'replacement-account'}};
        if(changed==='group')app.ctWorkspace={scope:{...scope,groupId:'replacement-group'}};
        if(changed==='same-id-unit'){const replacement=worksheetUnit('ID1');app._ctUnitIndex=new Map([[replacement.id,replacement],[rows[1].id,rows[1]]]);}
        if(changed==='selection-run')app._ctSelectRun={unitId:rows[0].id,ctx:app.ctContext(),pending:false};
        pending.resolve(changed!=='failure');assert.equal(await moving,false,changed);assert.equal(opens,0);assert.equal(focuses.length,0);
        assert.equal(app.ctValues[rows[0].fields[0].id],'Retained draft');assert.equal(app.ctDraftDirty,true);
    }
});
function completionHarness(source,text='',kind='text',changes={}){
    const h=listHarness({inlineEditor:true,$nextTick:fn=>{fn?.();return Promise.resolve();},...changes}),field=h.original.fields[0];
    field.source=source;field.kind=kind;h.app.ctValues[field.id]=text;h.app.ctFocusedField=field.id;
    let edits=0;h.app.ctEdited=()=>edits++;
    const input={value:text,selectionStart:text.length,selectionEnd:text.length,isConnected:true,dataset:{ctTarget:field.id},tagName:'TEXTAREA',
        focus(){this.focused=true;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
        closest(selector){return selector==='tr[data-unit-id]'?{dataset:{unitId:h.original.id}}:null;}};
    h.app.$refs.ctEditorRegion={contains:target=>target===input,querySelectorAll:selector=>selector==='[data-ct-target]'?[input]:[]};
    const event=(key,modifiers={})=>({...rowEvent(key),target:input,...modifiers});
    return {...h,field,input,event,edits:()=>edits};
}
test('ClientText completion arrows choose a source token and preserve raw workbook text',()=>{
    const prefix='@literal\\nactual\n',h=completionHarness('[First] [Second] {0}',prefix+'['),{app,field,input,event}=h;
    assert.equal(app.ctSuggest(field,{target:input}),true);assert.equal(app.ctCompletion.selectedIndex,0);
    const down=event('ArrowDown');app.ctTargetKeydown(field,down);assert.equal(down.defaultPrevented,true);assert.equal(app.ctCompletion.selectedIndex,1);
    const enter=event('Enter');app.ctTargetKeydown(field,enter);assert.equal(enter.defaultPrevented,true);
    assert.equal(app.ctValues[field.id],prefix+'[Second]');assert.equal(h.edits(),1);assert.equal(app.ctCompletion,null);assert.equal(input.focused,true);
    app.ctValues[field.id]='[';input.value='[';input.selectionStart=input.selectionEnd=1;app.ctSuggest(field,{target:input});
    app.ctTargetKeydown(field,event('ArrowUp'));assert.equal(app.ctCompletion.selectedIndex,1,'up wraps to the final source keyword');
    const escape=event('Escape');app.ctTargetKeydown(field,escape);assert.equal(escape.defaultPrevented,true);assert.equal(app.ctCompletion,null);
});
test('ClientText configured completion shortcuts replace only the selected raw text',()=>{
    const {app,field,input,event}=completionHarness('[Keyword] {0}','@literal\\n\ntext','text',{autocompleteShortcut:'ctrl-space'});
    input.selectionStart=1;input.selectionEnd=8;
    const trigger=event(' ',{ctrlKey:true,code:'Space'});app.ctTargetKeydown(field,trigger);
    assert.equal(trigger.defaultPrevented,true);assert.equal(app.ctCompletion.items.some(item=>item.value==='[Keyword]'),true);
    app.ctTargetKeydown(field,event('ArrowDown'));app.ctTargetKeydown(field,event('Tab'));
    assert.equal(app.ctValues[field.id],'@{0}\\n\ntext');
    input.value=app.ctValues[field.id];input.selectionStart=input.selectionEnd=input.value.length;
    app.autocompleteShortcut='ctrl-i';const alternate=event('i',{ctrlKey:true,code:'KeyI'});app.ctTargetKeydown(field,alternate);assert.equal(alternate.defaultPrevented,true);
    app.ctCloseCompletion();app.autocompleteShortcut='disabled';const disabled=event(' ',{ctrlKey:true,code:'Space'});app.ctTargetKeydown(field,disabled);
    assert.equal(disabled.defaultPrevented,undefined);assert.equal(app.ctCompletion,null);
});
test('ClientText completions leave Shift+Tab and Ctrl+Enter to field and editor navigation',async()=>{
    const {app,field,input,event}=completionHarness('[Keyword]','[');let opened=0;const moves=[];
    app.ctSaveAndNavigate=async(...args)=>{moves.push(args);return false;};
    app.ctSuggest(field,{target:input});const previous=event('Tab',{shiftKey:true});await app.ctTargetKeydown(field,previous);
    assert.equal(previous.defaultPrevented,true);assert.equal(moves[0][0],true);assert.equal(moves[0][1].inline,true);
    assert.equal(app.ctValues[field.id],'[');assert.equal(app.ctCompletion,null);
    app.ctSuggest(field,{target:input});app.ctSelect=(unit,full)=>{assert.equal(unit,app.ctCurrentUnit);assert.equal(full,true);opened++;};
    const full=event('Enter',{ctrlKey:true});await app.ctTargetKeydown(field,full);assert.equal(opened,1);assert.equal(app.ctValues[field.id],'[');
    app.ctSuggest(field,{target:input});const composing=event('Enter',{isComposing:true});app.ctTargetKeydown(field,composing);
    assert.equal(composing.defaultPrevented,undefined);assert.equal(app.ctValues[field.id],'[');
});
test('ClientText completion rejects moved selection, replaced text, field, unit, group and account scopes',()=>{
    const variations=[
        h=>{h.input.selectionStart=h.input.selectionEnd=0;},
        h=>{h.input.selectionEnd=0;},
        h=>{h.app.ctValues[h.field.id]='new typing';},
        h=>{h.app.ctFocusedField='another field';},
        h=>{h.app.ctSelection='another unit';},
        h=>{h.app.ctWorkspace.scope.groupId='replacement-group';},
        h=>{h.app.managedCatalogScope='other-account:poe2';},
        h=>{h.field.source='replacement source';},
        h=>{h.input.isConnected=false;},
        h=>{h.app.ctBusy=true;},
    ];
    for(const change of variations){
        const h=completionHarness('[Keyword]','[');h.app.ctSuggest(h.field,{target:h.input});const item=h.app.ctCompletion.items[0];change(h);
        const before=h.app.ctValues[h.field.id];assert.equal(h.app.ctApplyCompletion(h.field,item,h.input),false);
        assert.equal(h.app.ctValues[h.field.id],before);assert.equal(h.edits(),0);assert.equal(h.app.ctCompletion,null);
    }
    const h=completionHarness('[Keyword]','[');h.app.ctSuggest(h.field,{target:h.input});h.input.selectionStart=h.input.selectionEnd=0;
    h.app.ctCompletionSelectionChanged(h.field,{target:h.input});assert.equal(h.app.ctCompletion,null);
    h.app.ctSuggest(h.field,{target:h.input});assert.equal(h.app.ctCompletion,null,'no automatic menu at an unrelated caret');
});
test('ClientText Dictionary completions preserve keyword metadata and exact translated display text',()=>{
    const display='Dégâts@feu\\n\ntexte',dictionary=[{_id:'fire',find:'FireDamage',replace:'Dégâts de feu',alts:[{_id:'burning',find:'Burning damage',replace:display}]},
        {_id:'disabled',find:'FireDamage',replace:'Inactive',disabled:true},{_id:'invalid',find:'FireDamage',replace:'Broken] token'}];
    const {app,field,input,event}=completionHarness('[FireDamage<gemlevel={2}>|Burning damage] [Other]','[','text',{dictionary,isDictionaryEntryActive:entry=>!entry.disabled});
    app.ctSuggest(field,{target:input});assert.equal(app.ctCompletion.items[0].value,'[FireDamage<gemlevel={2}>|'+display+']');
    assert.equal(app.ctCompletion.items.some(item=>item.value.includes('Inactive') || item.value.includes('Broken]')),false);
    app.ctTargetKeydown(field,event('Enter'));assert.equal(app.ctValues[field.id],'[FireDamage<gemlevel={2}>|'+display+']');
    const malformed=completionHarness('[FireDamage<gemlevel=oops>|Burning damage]','[','text',{dictionary});
    malformed.app.ctSuggest(malformed.field,{target:malformed.input});assert.equal(malformed.app.ctCompletion.items.length,1);
    assert.equal(malformed.app.ctCompletion.items[0].value,'[FireDamage<gemlevel=oops>|Burning damage]');
    const stale=completionHarness('[FireDamage|Burning damage]','[','text',{dictionary:clone(dictionary)});
    stale.app.ctSuggest(stale.field,{target:stale.input});const item=stale.app.ctCompletion.items[0];stale.app.dictionary[0].alts[0].replace='New shared display';
    assert.equal(stale.app.ctApplyCompletion(stale.field,item,stale.input),false);assert.equal(stale.app.ctValues[stale.field.id],'[');
});
test('NONEXISTENT completion is form-only, whole-cell and never consumes backward traversal',()=>{
    const h=completionHarness('{0}','NON','form');h.app.ctSuggest(h.field,{target:h.input});h.app.ctTargetKeydown(h.field,h.event('Tab'));
    assert.equal(h.app.ctValues[h.field.id],'NONEXISTENT');
    const blank=completionHarness('[Keyword] {0}','','form');
    blank.app.ctTargetKeydown(blank.field,blank.event(' ',{ctrlKey:true,code:'Space'}));
    assert.ok(blank.app.ctCompletion.items.some(item=>item.replaceWholeField && item.value==='NONEXISTENT'));
    assert.ok(blank.app.ctCompletion.items.some(item=>item.value==='[Keyword]'));
    assert.ok(blank.app.ctCompletion.items.some(item=>item.value==='{0}'));
    for(const [kind,text]of [['text','NON'],['form','prefix NON']]){
        const h=completionHarness('{0}',text,kind);assert.equal(h.app.ctSuggest(h.field,{target:h.input}),false);
        h.app.ctTargetKeydown(h.field,h.event('Tab'));assert.equal(h.app.ctValues[h.field.id],text);
        h.app.ctTargetKeydown(h.field,h.event(' ',{ctrlKey:true,code:'Space'}));assert.equal(h.app.ctCompletion.items.some(item=>item.replaceWholeField),false);
    }
    const backward=completionHarness('{0}','NON','form');backward.app.ctSuggest(backward.field,{target:backward.input});
    backward.app.ctTargetKeydown(backward.field,backward.event('Tab',{shiftKey:true}));assert.equal(backward.app.ctValues[backward.field.id],'NON');
    const moved=completionHarness('{0}','NON','form');moved.input.selectionStart=moved.input.selectionEnd=0;
    moved.app.ctTargetKeydown(moved.field,moved.event('Tab'));assert.equal(moved.app.ctValues[moved.field.id],'NON');
});
test('ClientText completion options use escaped bindings and expose keyboard selection to assistive technology',()=>{
    const {window}=harness(),template=window.ClientTextUI.targetComponent.template;
    assert.match(template,/role="listbox"/);assert.match(template,/role="option"/);assert.match(template,/:aria-selected=/);
    assert.match(template,/:aria-activedescendant=/);assert.match(template,/@blur="host.ctCloseCompletion\(\)"/);
    assert.match(template,/\{\{ item.label \}\}/);assert.doesNotMatch(template,/v-html/);
});
function dictionaryHarness(source,dictionary,changes={}){
    const h=listHarness({dictionary,dictionaryPageSize:2,$nextTick:fn=>{fn?.();return Promise.resolve();},...changes});
    h.original.fields[0].source=source;h.app.ctFocusedField=h.original.fields[0].id;
    h.window.DictionaryScope=require('../public/dictionaryScope.js');
    for(const name of ['ctDictionaryMatches','ctDictionaryReady','ctDictionaryScopeKey','ctDictionaryMatchedDefinitions','ctDictionaryFiltered',
        'ctDictionaryPageSize','ctDictionaryPageCount','ctDictionaryVisible','ctDictionaryRangeLabel','ctDictionaryController'])
        Object.defineProperty(h.app,name,{get:()=>h.mixin.computed[name].call(h.app)});
    return h;
}
function worksheetUnit(id='WorksheetOrder',row=2){
    const original=namedUnit(id),base=original.fields[0];
    const field=(name,kind,source,target,column,extra={})=>({...base,id:JSON.stringify([name,extra.form || null]),name,kind,source,target,
        sourceCell:kind==='gender'?'':column+row,targetCell:column+row,required:kind==='text',...extra});
    // The codec appends Gender after prose definitions; rendered groups need
    // not have the same order as the immutable worksheet coordinates.
    original.fields=[field('Text','text','Main English','Main translation','F'),
        field('Word','form','Shared form English','Form MS','H',{form:'MS',group:'Word',required:false}),
        field('Word','form','Shared form English','','I',{form:'FS',group:'Word',required:false}),
        field('Blank','text',' \t\r\n','Hidden authored translation','K',{required:false}),
        field('Later','text','Later English','Later translation','Z'),
        field('Wide','text','Wide English','Wide translation','AB'),
        field('Gender','gender','','F','D',{required:false})];
    return original;
}
function keyboardHarness(original=worksheetUnit(),changes={}){
    const h=visibleFieldsHarness(original,{inlineEditor:true,...changes}),app=h.app,focuses=[],nodes=new WeakMap(),controls=[],documentControls=[];
    const row={dataset:{unitId:original.id}},region={contains:input=>inputs().includes(input) || controls.includes(input),querySelectorAll:selector=>selector==='[data-ct-target]'?inputs()
        :selector==='textarea'?inputs().filter(input=>input.tagName==='TEXTAREA'):selector.startsWith('button,')?[...inputs(),...controls]:[]};
    function inputFor(unit,field){
        const key=JSON.stringify([field.id,!!app.ctEditor]);let fields=nodes.get(unit);if(!fields){fields=new Map();nodes.set(unit,fields);}if(fields.has(key))return fields.get(key);
        const input={dataset:{ctTarget:field.id},tagName:field.kind==='gender'&&!app.ctGenderMultiline(field)?'INPUT':'TEXTAREA',tabIndex:0,isConnected:true,disabled:false,readOnly:false,
            selectionStart:0,selectionEnd:0,selectionDirection:'none',style:{},scrollHeight:12,scrollTop:0,
            get value(){return app.ctValues[field.id] ?? '';},set value(value){app.ctValues[field.id]=value;},
            getAttribute(name){return name==='data-ct-target'?field.id:null;},
            closest(selector){return selector.includes('tr[data-unit-id]')?{dataset:{unitId:unit.id}}:selector.includes('.ctFields')?region:null;},
            focus(){h.window.document.activeElement=this;app.ctFocusedField=field.id;focuses.push({unitId:unit.id,fieldId:field.id});},
            setSelectionRange(start,end,direction='none'){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;},scrollIntoView(){}};
        fields.set(key,input);return input;
    }
    function inputs(){
        const unit=app.ctCurrentUnit;if(!unit)return [];
        return Array.from(app.ctFieldGroups.flatMap(group=>group.fields),field=>inputFor(unit,field));
    }
    h.window.document={activeElement:null,querySelectorAll:()=>documentControls.length?documentControls:[...inputs(),...controls]};app.$refs.ctEditorRegion=region;app.$refs.ctFileTableRegion={focus(){focuses.push({row:true});}};
    app.$nextTick=async callback=>{callback?.();};app.ctFlushDraft=async()=>true;app.ctFlushCommentDraft=async()=>{};
    app._ctStore={getDraft:async()=>null};app.ctLoadComments=()=>{};app.ctLoadCommentDraft=()=>{};
    app.ctRefreshLayout=()=>{};app.ctFocusRow=unitId=>focuses.push({row:true,unitId});
    const event=(field,key,modifiers={})=>({...rowEvent(key),target:inputFor(app.ctCurrentUnit,field),...modifiers,
        stopPropagation(){this.propagationStopped=true;}});
    return {...h,inputFor,inputs,event,focuses,row,region,controls,documentControls};
}
test('Gender suggestions retain exact originals and opening inline/full editors never normalizes arbitrary metadata',async()=>{
    for(const value of ['-', ' ', '  custom\tvalue  ', 'NONEXISTENT', ' first\r\nsecond\n '])for(const full of [false,true]){
        const original=worksheetUnit('RawGender'),gender=original.fields.find(field=>field.kind==='gender');gender.target=value;
        const snapshot=clone(original),{app,inputFor}=keyboardHarness(original,{ctSelection:'',ctValues:{}});
        assert.equal(await app.ctSelect(original,full),true);assert.equal(app.ctValues[gender.id],value);assert.equal(inputFor(original,gender).value,value);
        const suggestions=Array.from(app.ctGenderSuggestions(gender));assert.deepEqual(suggestions.slice(0,6),['M','F','N','MP','FP','NP']);
        assert.equal(suggestions.includes(value),!/[\r\n]/.test(value),'Native datalist offers one-line original metadata without trimming it');
        assert.equal(app.ctGenderMultiline(gender),/[\r\n]/.test(value));
        assert.equal(inputFor(original,gender).tagName,/[\r\n]/.test(value)?'TEXTAREA':'INPUT');
        if(value===' ')assert.equal(app.ctGenderSuggestionLabel(value,gender),'Original value (1 space)');
        assert.deepEqual(original,snapshot);assert.equal(app.ctDraftDirty,false,'Mount/focus creates no authored draft');
    }
});

test('editing another field saves raw Gender values through actual CT save, immutable originals and history',async()=>{
    for(const value of ['-', ' ', ' custom\t@literal\\n ', 'NONEXISTENT', ' first\r\nsecond\n ']){
        const original=worksheetUnit('SaveRawGender'),gender=original.fields.find(field=>field.kind==='gender'),prose=original.fields[0];gender.target=value;
        const f=fixture();await f.store.import(scope,{units:[original],assets:[asset]});
        const {app}=visibleFieldsHarness(original,{ctDraftDirty:true});app._ctStore=f.store;app.ctSync=()=>{};app.ctLoadMemory=()=>{};
        app.ctValues[prose.id]='Authored prose';assert.equal(await app.ctSave(),true);
        const saved=(await f.store.getSaved(scope))[original.id],history=await f.store.listHistory(scope,original.id),retained=await f.store.getUnit(scope,original.id);
        assert.equal(saved.values[gender.id],value);assert.equal(history.at(-1).after.values[gender.id],value);
        assert.equal(retained.fields.find(field=>field.kind==='gender').target,value);assert.equal(saved.values[prose.id],'Authored prose');
    }
});

test('Gender input keeps authored strings verbatim and ignores IME, stale targets and blocked scopes',()=>{
    const {app,original,inputFor}=keyboardHarness(),gender=original.fields.find(field=>field.kind==='gender'),input=inputFor(original,gender),edited=[];
    app.ctQueueDraft=()=>edited.push(app.ctValues[gender.id]);app.ctResizeField=()=>{};
    Object.defineProperty(input,'value',{value:'  custom\t@literal\\n  ',writable:true,configurable:true});
    assert.equal(app.ctGenderEdited(gender,{target:input}),true);assert.equal(app.ctValues[gender.id],input.value);assert.deepEqual(edited,[input.value]);
    input.value='NONEXISTENT';assert.equal(app.ctGenderEdited(gender,{target:input}),true);assert.equal(app.ctValues[gender.id],'NONEXISTENT');
    const accepted=app.ctValues[gender.id],drafts=edited.length;
    for(const value of [null,0,false,[],{}]){input.value=value;assert.equal(app.ctGenderEdited(gender,{target:input}),false);assert.equal(app.ctValues[gender.id],accepted);}
    input.value='Uncommitted IME';assert.equal(app.ctGenderEdited(gender,{target:input,isComposing:true}),false);
    input.composing=true;assert.equal(app.ctGenderEdited(gender,{target:input}),false);input.composing=false;
    assert.equal(app.ctGenderEdited(gender,{target:{...input,value:'Stale element'}}),false);
    app.ctBusy=true;assert.equal(app.ctGenderEdited(gender,{target:input}),false);app.ctBusy=false;
    app.cloudHistoryVisible=true;assert.equal(app.ctGenderEdited(gender,{target:input}),false);app.cloudHistoryVisible=false;
    app.ctActive=false;assert.equal(app.ctGenderEdited(gender,{target:input}),false);
    assert.equal(app.ctValues[gender.id],accepted);assert.equal(edited.length,drafts);
});

test('editable Gender input keeps worksheet Tab order and Ctrl+S saves its raw value in inline/full mode',async()=>{
    for(const full of [false,true]){
        const original=worksheetUnit('GenderKeyboard'),gender=original.fields.find(field=>field.kind==='gender');gender.target='  arbitrary value  ';
        const f=fixture();await f.store.import(scope,{units:[original],assets:[asset]});
        const {app,inputFor,event,focuses}=keyboardHarness(original,{ctEditor:full,ctDraftDirty:true,autoOpenNextFile:false});
        app._ctStore=f.store;app.ctLoadMemory=()=>{};app.ctSync=()=>{};
        const input=inputFor(original,gender);assert.equal(input.tagName,'INPUT');input.focus();
        const forward=event(gender,'Tab');await app.ctTargetKeydown(gender,forward);assert.equal(forward.defaultPrevented,true);assert.equal(focuses.at(-1).fieldId,original.fields[0].id);
        const reverse=event(original.fields[0],'Tab',{shiftKey:true});await app.ctTargetKeydown(original.fields[0],reverse);assert.equal(reverse.defaultPrevented,true);assert.equal(focuses.at(-1).fieldId,gender.id);
        for(const key of ['ArrowUp','ArrowDown']){const native=event(gender,key);app.ctTargetKeydown(gender,native);assert.equal(native.defaultPrevented,undefined,'Datalist arrows keep their native behavior');}
        const save=event(gender,'s',{ctrlKey:true,code:'KeyS'});await app.ctKey(save);assert.equal(save.defaultPrevented,true);
        const saved=(await f.store.getSaved(scope))[original.id];assert.equal(saved.values[gender.id],gender.target);assert.equal(app.ctValues[gender.id],gender.target);
    }
});

test('ordinary Gender textarea edits retain untouched raw CRLF and distinguish intentional newline replacement',()=>{
    const original=worksheetUnit('CRLFGender'),gender=original.fields.find(field=>field.kind==='gender');gender.target='head-one\r\ntwo\rthree\n ';
    const {app,inputFor}=keyboardHarness(original),input=inputFor(original,gender);app.ctQueueDraft=()=>{};app.ctResizeField=()=>{};
    Object.defineProperty(input,'value',{value:'head-one\ntwo\nthree\n X',writable:true,configurable:true});
    assert.equal(app.ctGenderEdited(gender,{target:input}),true);assert.equal(app.ctValues[gender.id],'head-one\r\ntwo\rthree\n X');
    input.value='head-one\nTWO\nthree\n X';assert.equal(app.ctGenderEdited(gender,{target:input}),true);
    assert.equal(app.ctValues[gender.id],'head-one\r\nTWO\rthree\n X','Only edited characters are replaced inside the original raw string');
    input.value='head-oneTWO\nthree\n X';assert.equal(app.ctGenderEdited(gender,{target:input}),true);
    assert.equal(app.ctValues[gender.id],'head-oneTWO\rthree\n X','Deleting a displayed newline removes its complete original CRLF');
});

test('Gender multiline paste and Shift+Enter preserve raw selection and fence delayed focus across scope changes',async()=>{
    const original=worksheetUnit('PasteGender'),gender=original.fields.find(field=>field.kind==='gender');gender.target='head-one\r\ntwo\n ';
    const {app,inputFor,event,focuses,window}=keyboardHarness(original),input=inputFor(original,gender);app.ctQueueDraft=()=>{};app.ctResizeField=()=>{};
    Object.defineProperty(input,'value',{get:()=>app.ctValues[gender.id].replace(/\r\n?/g,'\n'),configurable:true});input.focus();input.setSelectionRange(9,12);
    const paste={...event(gender,'paste'),clipboardData:{getData:()=> 'TH\r\nREE'}};
    assert.equal(await app.ctGenderPaste(gender,paste),true);assert.equal(paste.defaultPrevented,true);
    assert.equal(app.ctValues[gender.id],'head-one\r\nTH\r\nREE\n ');assert.deepEqual([input.selectionStart,input.selectionEnd],[15,15]);
    const oneLine={...event(gender,'paste'),clipboardData:{getData:()=> 'native paste'}};assert.equal(app.ctGenderPaste(gender,oneLine),false);assert.equal(oneLine.defaultPrevented,undefined);
    input.setSelectionRange(0,0);const enter=event(gender,'Enter',{shiftKey:true});assert.equal(await app.ctGenderKeydown(gender,enter),true);
    assert.equal(app.ctValues[gender.id],'\nhead-one\r\nTH\r\nREE\n ');assert.deepEqual([input.selectionStart,input.selectionEnd],[1,1]);
    const before=app.ctValues[gender.id];for(const changes of [{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true}]){
        const key=event(gender,'Enter',{shiftKey:true,...changes});await app.ctGenderKeydown(gender,key);assert.equal(app.ctValues[gender.id],before);assert.equal(key.defaultPrevented,undefined);}
    const pending=deferred();app.$nextTick=()=>pending.promise;const held=event(gender,'Enter',{shiftKey:true}),inserting=app.ctGenderKeydown(gender,held);await settle();
    const old=app.ctValues[gender.id],priorFocus=focuses.length;app.ctWorkspace={scope:{...scope,groupId:'replacement'}};app.ctValues={[gender.id]:'Replacement raw text'};
    window.document.activeElement={tagName:'INPUT'};pending.resolve();await inserting;
    assert.notEqual(old,'Replacement raw text');assert.equal(app.ctValues[gender.id],'Replacement raw text');assert.equal(focuses.length,priorFocus,'Late insertion cannot steal focus or publish text into a replacement group');
});

test('Gender controls bind raw values explicitly with native suggestions and composition-safe input events',()=>{
    const {window}=harness(),template=window.ClientTextUI.targetComponent.template;
    assert.match(template,/<input type="text"[^>]*:list="'ctgender-'\+field.targetCell"[^>]*:value="host.ctValues\[field.id\]"/);
    assert.match(template,/<datalist[^>]*><option[^>]*ctGenderSuggestions\(field\)/);
    assert.match(template,/@compositionend="host.ctGenderEdited\(field,\$event\)"/);
    assert.match(template,/<textarea[^>]*:value="host.ctValues\[field.id\]"[^>]*@input="host.ctGenderEdited\(field,\$event\)"/);
    assert.doesNotMatch(template,/<select[^>]*aria-label="Gender"/);
    assert.doesNotMatch(template,/<(?:input|textarea)[^>]*v-model[^>]*aria-label="Gender"/,'Mounting a control cannot feed sanitized browser text back into metadata');
});

test('ClientText Dictionary lists all entries with game-scoped matches first and searches notes and alternates',()=>{
    const unrelated={_id:'unrelated',find:'Unrelated',replace:'Autre',alts:[],tlnote:'Note to search'},
        matched={_id:'matched',find:'FireDamage',replace:'Feu',alts:[{_id:'alt',find:'Burning damage',replace:'Flammes'}]},
        foreign={_id:'foreign',find:'FireDamage',replace:'PoE1',gameScope:'poe1',alts:[]};
    const {app}=dictionaryHarness('[FireDamage<gemlevel={2}>|Burning damage]',[unrelated,foreign,matched]);
    assert.deepEqual(Array.from(app.ctDictionaryFiltered,word=>word._id),['matched','unrelated','foreign']);
    assert.equal(app.ctDictionaryController.isDictionaryEntryFindMatched(matched),true);assert.equal(app.ctDictionaryController.isDictionaryAltFindMatched(matched,matched.alts[0]),true);
    assert.equal(app.ctDictionaryController.isDictionaryEntryFound(foreign),false);assert.equal(app.ctDictionaryPageCount,2);assert.equal(app.ctDictionaryRangeLabel,'1–2 of 3');
    app.ctSetDictionaryPage(2);assert.deepEqual(Array.from(app.ctDictionaryVisible,word=>word._id),['foreign']);assert.equal(app.ctDictionaryRangeLabel,'3–3 of 3');
    app.ctDictionaryFilter='flammes';assert.deepEqual(Array.from(app.ctDictionaryFiltered,word=>word._id),['matched']);
    app.ctDictionaryFilter='note to search';assert.deepEqual(Array.from(app.ctDictionaryFiltered,word=>word._id),['unrelated']);
    app.ctDictionaryFilter='not present';assert.equal(app.ctDictionaryFiltered.length,0);assert.equal(app.ctDictionaryRangeLabel,'0–0 of 0');
});
test('ClientText Dictionary keeps the edited row and order stable while definitions stop matching',()=>{
    const matched={_id:'first',find:'Fire',replace:'Feu',alts:[]},other={_id:'second',find:'Cold',replace:'Froid',alts:[]},
        {app}=dictionaryHarness('Fire',[other,matched]);
    app.ctDictionaryBeginEdit(matched._id);matched.find='Changed definition';app.ctDictionaryFilter='Fire';
    assert.deepEqual(Array.from(app.ctDictionaryFiltered,word=>word._id),['first'],'editing row stays visible after the Find changes');
    app.ctDictionaryFilter='';assert.deepEqual(Array.from(app.ctDictionaryFiltered,word=>word._id),['first','second']);
    app.ctDictionaryEndEdit();assert.deepEqual(Array.from(app.ctDictionaryFiltered,word=>word._id),['second','first']);
});
test('ClientText Dictionary reuses guarded shared CRUD and cannot mutate a replacement group or account',async()=>{
    const word={_id:'fire',find:'Fire',replace:'Feu',alts:[{_id:'alt',find:'Flame',replace:'Flamme'}]},h=dictionaryHarness('Fire',[word]),{app}=h;
    const code=fs.readFileSync(path.join(__dirname,'../public/index.js'),'utf8'),sections=[
        code.slice(code.indexOf('    addDictionaryAltRow(word)'),code.indexOf('    addDictionaryAltPair(word')),
        code.slice(code.indexOf('    createDictionaryEntry(fields'),code.indexOf('    findActiveDictionaryKeywordEntry(tagName)')),
        code.slice(code.indexOf('    async removeVocab(word'),code.indexOf('    async exportZip(doFullExport)')),
    ];
    const shared=vm.runInNewContext('({'+sections.join('\n')+'})',{window:{DictionaryScope:h.window.DictionaryScope}});
    for(const [name,method]of Object.entries(shared))app[name]=method.bind(app);
    const dirty=[];app.markDictionarySnapshotDirty=(...args)=>dirty.push(args);app.invalidateEditorDictionaryIndex=(...args)=>dirty.push(args);
    app.dictionaryEntryScope=h.window.DictionaryScope.normalize;app.beginDictionaryEdit=()=>{};app.endDictionaryEdit=()=>{};app.saveSettings=()=>dirty.push('saved');
    const controller=app.ctDictionaryController;controller.addDictionaryAltRow(word);assert.equal(word.alts.length,2);assert.equal(word.alts[1].replace,'Feu');
    controller.setDictionaryEntryScope(word,'poe2');assert.equal(word.gameScope,'poe2');
    const confirmation=deferred();app.appConfirm=()=>confirmation.promise;const removal=controller.removeVocab(word);
    app.ctWorkspace.scope.groupId='new-group';confirmation.resolve(true);await removal;assert.equal(app.dictionary.includes(word),true);
    const newer=app.ctDictionaryController,alternateConfirmation=deferred();app.appConfirm=()=>alternateConfirmation.promise;
    const alternateRemoval=newer.removeDictionaryAltRow(word,word.alts[0]);app.managedCatalogScope='new-account:poe2';alternateConfirmation.resolve(true);await alternateRemoval;
    assert.equal(word.alts.length,2);const count=dirty.length;controller.dictionaryEntryInput(word);controller.setDictionaryEntryScope(word,'poe1');
    assert.equal(dirty.length,count);assert.equal(word.gameScope,'poe2');
    app.appConfirm=async()=>true;await app.removeVocab(word);assert.equal(app.dictionary.length,0,'default SD deletion remains available without a CT context guard');
});
test('ClientText Dictionary Add shares creation and persistence without changing translation drafts or scanning',()=>{
    const word={_id:'existing',find:'Fire',replace:'Feu',alts:[]},h=dictionaryHarness('Fire',[word]),{app}=h;
    const before=clone(app.ctValues),events=[];app.createDictionaryEntry=()=>({_id:'new',find:'',replace:'',alts:[],tlnote:'',gameScope:'poe2'});
    app.invalidateEditorDictionaryIndex=(id,options)=>events.push({id,options});app.ctDictionaryFilter='Fire';
    app.ctScan=()=>assert.fail('Dictionary controls must not run an optional translation scan');
    const entry=app.ctDictionaryAdd();assert.equal(app.dictionary[0],entry);assert.equal(app.ctDictionaryEditingId,'new');
    assert.equal(app.ctDictionaryVisible[0],entry);assert.equal(app.ctDictionaryFilter,'');assert.equal(app.ctDictionaryPage,1);
    assert.deepEqual(app.ctValues,before);assert.equal(events[0].id,'new');assert.equal(events[0].options.membership,true);
    app.ctBusy=true;assert.equal(app.ctDictionaryAdd(),false);
});
test('ClientText Dictionary inserts exact multiline text at the focused translation selection',()=>{
    const word={_id:'raw',find:'Fire\nSecond line',replace:'Dégâts@feu\\n\nligne',alts:[{_id:'alt',find:'Flame',replace:'Autre\ntexte'}]},
        h=dictionaryHarness('Fire',[word]),{app}=h,field=h.original.fields[0],input={value:'Before selected after',selectionStart:7,selectionEnd:15,isConnected:true,
            focus(){this.focused=true;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};
    app.ctValues[field.id]=input.value;app.ctDictionaryTarget=()=>input;app.ctEdited=changed=>{assert.equal(changed,field);app.ctDraftDirty=true;};
    const controller=app.ctDictionaryController;assert.equal(controller.dictionaryMultiline,true);assert.equal(controller.dictionaryCanUse,true);
    for(const composing of [{isComposing:true},{keyCode:229}]){
        const event={...rowEvent('Enter'),...composing};assert.equal(controller.useDictionaryTranslation(word,null,event),false);
        assert.equal(event.defaultPrevented,undefined);assert.equal(app.ctValues[field.id],input.value);
    }
    assert.equal(controller.useDictionaryTranslation(word),true);assert.equal(app.ctValues[field.id],'Before '+word.replace+' after');assert.equal(input.focused,true);assert.equal(app.ctDraftDirty,true);
    input.value=app.ctValues[field.id];input.selectionStart=0;input.selectionEnd=input.value.length;
    assert.equal(controller.useDictionaryTranslation(word,word.alts[0]),true);assert.equal(app.ctValues[field.id],'Autre\ntexte');
    input.value=app.ctValues[field.id];input.selectionStart=input.selectionEnd=0;
    app.ctWorkspace.scope.groupId='replacement-group';assert.equal(controller.useDictionaryTranslation(word),false);assert.equal(app.ctValues[field.id],'Autre\ntexte');
    const gender=app.ctDictionaryController;field.kind='gender';assert.equal(gender.dictionaryCanUse,false);assert.equal(gender.useDictionaryTranslation(word),false);
});
test('SD and ClientText share Dictionary entry markup while CT multiline fields keep Enter for newlines',()=>{
    const {window}=harness(),shared=window.EditorComponents.DictionaryEntries.template,tools=window.ClientTextUI.toolsComponent,
        html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
    assert.equal(tools.components['editor-dictionary-entries'],window.EditorComponents.DictionaryEntries);
    assert.match(html,/<editor-dictionary-entries v-if="sideTab === 'dictionary'" :controller="\$root">/);
    for(const feature of ['dictRow','dictScopeSelect','dictHistoryBtn','dictAltRow','dictTlnote','dictDeleteBtn'])assert.equal(shared.includes(feature),true);
    assert.match(shared,/<input v-else type="text" v-model="word.find"/,'SD retains existing input geometry');
    assert.match(shared,/<textarea v-if="controller.dictionaryMultiline" rows="2" v-model="word.replace"[^>]*@keydown.ctrl.enter="controller.useDictionaryTranslation\(word,null,\$event\)"/);
    assert.doesNotMatch(shared,/<textarea[^>]*@keydown\.enter/,'plain Enter is never consumed by CT Dictionary fields');
    assert.match(shared,/v-model="alt.find"/);assert.match(shared,/v-model="alt.replace"/);assert.doesNotMatch(shared,/v-html/);
    for(const feature of ['Search dictionary entries','Add entry','Previous dictionary page','Next dictionary page','Matches in this file first'])assert.equal(tools.template.includes(feature),true);
});
test('shared field components preserve distinct form sources and autosizing changes layout only',()=>{
    const {app,window}=listHarness(),rawText='@literal\\nactual\nไทย',field={value:rawText,scrollHeight:96,scrollTop:15,selectionStart:3,selectionEnd:7,style:{}};
    app.ctResizeField(field);assert.equal(field.style.height,'98px');assert.equal(field.value,rawText);assert.equal(field.selectionStart,3);assert.equal(field.selectionEnd,7);assert.equal(field.scrollTop,15);
    const groups=app.ctGroupSources({name:'Text',fields:[{id:'m',form:'MS',source:'Masculine'},{id:'f',form:'FS',source:'Feminine'}]});
    assert.deepEqual(Array.from(groups,entry=>entry.text),['Masculine','Feminine']);assert.deepEqual(Array.from(groups,entry=>entry.label),['MS','FS']);
    const fields=window.ClientTextUI.fieldsComponent,target=window.ClientTextUI.targetComponent,tools=window.ClientTextUI.toolsComponent;
    assert.equal(fields.props.side.default,'both');assert.match(fields.template,/side !== 'translation'/);assert.match(fields.template,/side !== 'source'/);
    assert.match(fields.template,/textHL editorTextField multiline/);assert.match(fields.template,/:value="source.text"[^>]* readonly/);
    assert.match(fields.template,/field.kind !== 'gender' \|\| field.source/,'blank enum metadata has no fake English textarea');
    assert.match(target.template,/v-model="host.ctValues\[field.id\]"/);assert.match(target.template,/ctTargetKeydown/);
    assert.match(tools.template,/side sharedEditorSidebar ctTools/);assert.match(tools.template,/sideHeader/);assert.match(tools.template,/sideTabs/);assert.match(tools.template,/aria-label="TM"/);
    assert.match(tools.template,/class="lookupResults"/,'Lookup follows the shared scroll layout');
});
test('save navigation captures candidates before current work disappears from Missing filters',async()=>{
    const rows=[namedUnit('ID1','First',''),namedUnit('ID2','Second',''),namedUnit('ID3','Third','')],
        {app}=listHarness({ctUnits:rows,ctSelection:rows[0].id,ctEditor:true,ctSelectedFilters:['missing'],ctValues:{[fieldId]:'Translated first'},
            _ctUnitIndex:new Map(rows.map(value=>[value.id,value]))}),calls=[];
    app.ctSave=async()=>{calls.push('save');app.ctSaved={[rows[0].id]:{values:{[fieldId]:'Translated first'},reviewed:{},revision:1}};return true;};
    app.ctSelect=async(value,full)=>{calls.push(value.id);assert.equal(full,true);app.ctSelection=value.id;return true;};
    assert.equal(await app.ctSaveAndNavigate(),true);assert.deepEqual(calls,['save',rows[1].id]);assert.equal(app.ctSelection,rows[1].id);assert.equal(app.ctPage,1);
});
test('F-key navigation avoids untouched and reverted saves, retains the editor at bounds and saves Outdated reviews',async()=>{
    const rows=[namedUnit('ID1'),namedUnit('ID2')],{app}=listHarness({ctUnits:rows,ctSelection:rows[0].id,ctEditor:true,
        ctValues:S.valuesFor(rows[0]),_ctUnitIndex:new Map(rows.map(value=>[value.id,value]))});let saves=0;
    app.ctSave=async()=>{saves++;return true;};app.ctSelect=async(value,full)=>{app.ctSelection=value.id;app.ctValues=S.valuesFor(value);app.ctEditor=full;return true;};
    app.ctDraftDirty=true;app.ctReviewed={[fieldId]:S.sourceHash(rows[0].fields[0].source)};
    assert.equal(await app.ctSaveAndNavigate(),true);assert.equal(saves,0,'reverted text with no review workload does not fabricate Saved');
    assert.equal(await app.ctSaveAndNavigate(),false);assert.equal(saves,0);assert.equal(app.ctEditor,true);assert.equal(app.ctSelection,rows[1].id);
    assert.equal(await app.ctSaveAndNavigate(true),true);assert.equal(app.ctSelection,rows[0].id);assert.equal(saves,0);
    rows[0].fields[0].outdated=true;app._ctStatusCache=new WeakMap();app.ctReviewed={[fieldId]:S.sourceHash(rows[0].fields[0].source)};
    assert.equal(app.ctHasEditorChanges(),true,'review-only work resolves Outdated without changing text');
    assert.equal(await app.ctSaveAndNavigate(),true);assert.equal(saves,1);
});
test('save navigation fences changed selection/account while awaiting save, and retains failed work',async()=>{
    const rows=[namedUnit('ID1'),namedUnit('ID2')];
    for(const change of ['account','unit','failed']){
        const {app}=listHarness({ctUnits:rows,ctSelection:rows[0].id,ctEditor:true,ctValues:{[fieldId]:'changed'},
            _ctUnitIndex:new Map(rows.map(value=>[value.id,value]))}),pending=deferred();let opens=0;
        app.ctSave=()=>pending.promise;app.ctSelect=async()=>{opens++;return true;};const moving=app.ctSaveAndNavigate();
        if(change==='account'){app.managedCatalogScope='bob:poe2';app.ctWorkspace={scope:{...scope,accountId:'bob'}};}
        if(change==='unit')app.ctSelection=rows[1].id;
        pending.resolve(change!=='failed');assert.equal(await moving,false);assert.equal(opens,0);assert.equal(app.ctEditor,true);
    }
});
test('F2 replays a matching uncertain intentional unchanged save before navigating and ignores another scope job',async()=>{
    const rows=[namedUnit('ID1'),namedUnit('ID2')],{app}=listHarness({ctUnits:rows,ctSelection:rows[0].id,ctEditor:true,
        ctValues:S.valuesFor(rows[0]),_ctUnitIndex:new Map(rows.map(value=>[value.id,value]))}),calls=[];
    app._ctSaveJob={unitId:rows[0].id,scopeKey:Store.scopeKey(scope),id:'uncertain-unchanged',command:{values:S.valuesFor(rows[0])}};
    app.ctSave=async()=>{calls.push('replay');return true;};app.ctSelect=async value=>{calls.push(value.id);app.ctSelection=value.id;return true;};
    assert.equal(app.ctHasEditorChanges(),false);assert.equal(await app.ctSaveAndNavigate(),true);assert.deepEqual(calls,['replay',rows[1].id]);
    app.ctSelection=rows[0].id;app._ctSaveJob.scopeKey=Store.scopeKey({...scope,groupId:'other'});calls.length=0;
    assert.equal(await app.ctSaveAndNavigate(),true);assert.deepEqual(calls,[rows[1].id],'another group receipt is never replayed for this unit');
});
test('SD-style keyboard aliases route F1/F2, full Ctrl+S, inline staging and table export through CT actions',async()=>{
    const {app}=listHarness(),calls=[];app.ctSaveAndNavigate=async(...args)=>calls.push(['navigate',...args]);
    app.ctSave=async(close=false)=>calls.push(['save',close]);app.ctDownload=async()=>calls.push(['download']);
    const press=async(key,code,ctrlKey=false)=>{const event=rowEvent(key);event.code=code;event.ctrlKey=ctrlKey;await app.ctKey(event);assert.equal(event.defaultPrevented,true);};
    app.ctEditor=true;await press('F2','F2');await press('F1','F1');await press('.','Period',true);await press(',','Comma',true);
    assert.deepEqual(calls.splice(0),[['navigate',false],['navigate',true],['navigate',false],['navigate',true]]);
    app.autoOpenNextFile=true;await press('s','KeyS',true);assert.equal(calls[0][0],'navigate');assert.equal(calls[0][2].saveUnchanged,true);calls.length=0;
    app.autoOpenNextFile=false;await press('s','KeyS',true);assert.deepEqual(calls.splice(0),[['save',true]]);
    app.ctEditor=false;app.inlineEditor=true;await press('s','KeyS',true);assert.deepEqual(calls.splice(0),[['save',false]]);
    app.inlineEditor=false;await press('s','KeyS',true);assert.deepEqual(calls.splice(0),[['download']]);
});
test('Save and close retains the acknowledged row and uses the real SD layout measurement methods',async()=>{
    const f=fixture();await f.store.import(scope,{units:[unit()],assets:[asset]});
    const {app,original}=listHarness({ctEditor:true,ctDraftDirty:true,ctValues:{[fieldId]:'saved@literal\\nactual\nไทย'}}),calls=[];
    app._ctStore=f.store;app.ctLoadMemory=()=>{};app.ctSync=()=>{};app.observeInlineBlocks=()=>calls.push('observe');app.measureWorkspaceChrome=()=>calls.push('measure');app.ctFocusRow=id=>calls.push(id);
    assert.equal(await app.ctSave(true),true);assert.equal(app.ctEditor,false);assert.equal(app.ctSelection,original.id);assert.equal(app.ctDraftDirty,false);
    assert.deepEqual(calls,['observe','measure',original.id]);assert.equal((await f.store.getSaved(scope))[original.id].values[fieldId],'saved@literal\\nactual\nไทย');
});
test('filter-panel changes register the real shared chrome observer after render',async()=>{
    const {app,mixin}=listHarness(),calls=[];app.$nextTick=fn=>{calls.push('render');fn?.();};app.observeInlineBlocks=()=>calls.push('observe');app.measureWorkspaceChrome=()=>calls.push('measure');
    mixin.watch.ctFiltersVisible.call(app);assert.deepEqual(calls,['render','observe','measure']);
});
test('closing the version chooser rebinds shared chrome observers after CT table remount',()=>{
    const {app,mixin}=listHarness({versionChooserVisible:false}),calls=[];app.$nextTick=fn=>{calls.push('render');fn?.();};
    app.observeInlineBlocks=()=>calls.push('observe');app.measureWorkspaceChrome=()=>calls.push('measure');
    mixin.watch.versionChooserVisible.call(app,false);assert.deepEqual(calls,['render','observe','measure']);
    calls.length=0;app.ctActive=false;mixin.watch.versionChooserVisible.call(app,false);assert.deepEqual(calls,[]);
});
test('Versions preserves translation and comment drafts before opening, and stays closed after either failure',async()=>{
    const {app}=listHarness({versionChooserVisible:false}),calls=[];
    app.ctFlushDraft=async()=>{calls.push('translation');return true;};app.ctFlushCommentDraft=async()=>calls.push('comment');
    assert.equal(await app.ctShowVersionChooser(),true);assert.deepEqual(calls,['translation','comment']);assert.equal(app.versionChooserVisible,true);
    app.versionChooserVisible=false;calls.length=0;app.ctFlushDraft=async()=>false;
    assert.equal(await app.ctShowVersionChooser(),false);assert.equal(app.versionChooserVisible,false);assert.deepEqual(calls,[]);
    app.ctFlushDraft=async()=>true;app.ctFlushCommentDraft=async()=>{throw Error('Comment storage failed');};
    assert.equal(await app.ctShowVersionChooser(),false);assert.equal(app.versionChooserVisible,false);assert.match(app.ctError,/Comment storage failed/);
});
test('a delayed Versions action cannot open or store comments after account, group or record replacement',async()=>{
    for(const change of ['account','group','unit']){
        const {app}=listHarness({versionChooserVisible:false}),pending=deferred();let comments=0;
        app.ctFlushDraft=()=>pending.promise;app.ctFlushCommentDraft=async()=>comments++;
        const opening=app.ctShowVersionChooser();
        if(change==='account'){app.managedCatalogScope='bob:poe2';app.ctWorkspace={scope:{...scope,accountId:'bob'}};}
        if(change==='group')app.ctWorkspace={scope:{...scope,groupId:'newer'}};
        if(change==='unit')app.ctSelection='newer record';
        pending.resolve(true);assert.equal(await opening,false);assert.equal(comments,0);assert.equal(app.versionChooserVisible,false);
    }
    const {app}=listHarness({versionChooserVisible:false}),comment=deferred();app.ctFlushDraft=async()=>true;app.ctFlushCommentDraft=()=>comment.promise;
    const opening=app.ctShowVersionChooser();await settle();app.ctSelection='newer record';comment.resolve();
    assert.equal(await opening,false);assert.equal(app.versionChooserVisible,false);
});

test('the unified Assignment table retains legacy API teams and their exact progress/actions data',()=>{
    const thai={language:'Thai',ended:true,latestCollection:{id:'collection'},collections:[{id:'collection'}],presence:[{name:'Peer'}],counts:{saved:3,missing:2,revised:1}},
        french={language:'French',counts:{saved:1,missing:0,revised:0}},
        {app}=assignmentHarness({managedSelectedDetails:{version:{id:'v1'},teams:[thai,french]}});
    const rows=app.ctAssignmentRows;assert.deepEqual(Array.from(rows,row=>row.label),['French — StatDescription','Thai — StatDescription']);
    assert.ok(rows.every(row=>row.legacy&&row.group===null&&row.contentMode==='statdescription'));
    const row=rows.find(row=>row.team===thai);assert.ok(row);assert.equal(row.team.latestCollection.id,'collection');
    const progress=app.ctAssignmentProgress(row),legacy=app.managedProgress(thai);
    for(const name of Object.keys(legacy))assert.equal(progress[name],legacy[name]);
    assert.equal(app.ctAssignmentProgressTooltip(row),app.managedProgressTooltip(thai));
});
test('mixed assignments deduplicate each legacy team and preserve independent modern content-group rows',()=>{
    const thai={language:'Thai',counts:{saved:1,missing:0}},french={language:'French',counts:{saved:0,missing:1}},
        legacy={id:'legacy',versionId:'v1',legacyVersionId:'v1',contentMode:'statdescription',teams:[{...thai},french]},
        sd={id:'sd',versionId:'v1',contentMode:'StatDescription',teams:[thai]},ct={id:'ct',versionId:'v1',contentMode:'clienttext',teams:[thai]},
        {app}=assignmentHarness({managedSelectedDetails:{version:{id:'v1'},teams:[thai],contentGroups:[legacy,sd,ct,ct]}});
    const rows=app.ctAssignmentRows;assert.equal(rows.length,4);assert.equal(new Set(rows.map(row=>row.key)).size,4);
    assert.equal(rows.find(row=>row.legacy&&row.team.language==='Thai').team,thai);
    assert.equal(rows.find(row=>row.legacy&&row.team.language==='French').group,legacy,'a legacy group supplies a team absent from old top-level details');
    assert.equal(rows.find(row=>row.group===ct).legacy,false);assert.equal(rows.find(row=>row.group===sd).legacy,false);
    app.managedSelectedDetails={version:{id:'v1'},contentGroups:[legacy]};assert.equal(app.ctAssignmentRows.length,2,'legacy group fallback works without top-level teams');
});
test('cached modern group team details do not manufacture an extra legacy StatDescription assignment',()=>{
    const team={language:'Thai',counts:{saved:1,missing:0},latestCollection:{id:'modern-collection'}},
        sd={id:'modern-sd',versionId:'v1',contentMode:'statdescription',teams:[team]},
        ct={id:'modern-ct',versionId:'v1',contentMode:'clienttext',teams:[{language:'Thai',counts:{workloadFields:1,resolvedFields:0}}]},
        {app}=assignmentHarness({managedSelectedDetails:{version:{id:'v1'},teams:[team],contentGroups:[sd,ct]}});
    const rows=app.ctAssignmentRows;assert.equal(rows.length,2);assert.ok(rows.every(row=>!row.legacy));
    const sdRow=rows.find(row=>row.contentMode==='statdescription');assert.equal(sdRow.group,sd);assert.equal(sdRow.team,team);
    assert.equal(sdRow.team.latestCollection.id,'modern-collection','modern actions retain the original group/team facts');
    app.managedSelectedDetails.contentGroups=[ct];assert.equal(app.ctAssignmentRows.length,1);assert.equal(app.ctAssignmentRows[0].group,ct);
    app.managedSelectedDetails.contentGroups=[sd];assert.equal(app.ctAssignmentRows.length,1);assert.equal(app.ctAssignmentRows[0].group,sd);
});
test('assignment rows use assigned access and selected game/branch/version rather than editor language',()=>{
    const team=language=>({language,counts:{}}),ct={id:'ct',versionId:'v1',contentMode:'clienttext',teams:[team('French'),team('Thai')]},
        legacy={id:'legacy',versionId:'v1',legacyVersionId:'v1',contentMode:'statdescription',teams:[team('French'),team('Thai')]},
        foreign={id:'other',versionId:'other',contentMode:'clienttext',teams:[team('French')]},
        {app}=assignmentHarness({cloudCanAccessAllLanguages:false,cloudUser:{language:'French'},lang:'Thai',
            managedSelectedDetails:{version:{id:'v1'},teams:[team('French'),team('Thai')],contentGroups:[legacy,ct,foreign]}});
    assert.deepEqual(Array.from(app.ctAssignmentRows,row=>row.label),['French — ClientText','French — StatDescription']);
    app.cloudCanAccessAllLanguages=true;assert.equal(app.ctAssignmentRows.length,4);
    app.managedCatalogAccess=false;assert.equal(app.ctAssignmentRows.length,0);app.managedCatalogAccess=true;
    app.gameVersion='poe1';assert.equal(app.ctAssignmentRows.length,0);app.gameVersion='poe2';
    app.branchId='another';assert.equal(app.ctAssignmentRows.length,0);app.branchId='default';
    app.managedSelectedDetails={version:{id:'stale'},teams:[team('German')],contentGroups:[ct]};
    app.managedSelectedVersion.contentGroups=[ct];assert.equal(app.ctAssignmentRows.length,2);assert.ok(app.ctAssignmentRows.every(row=>row.group===ct));
});
test('the shared assignment sort compares SD file progress against CT initial field progress',()=>{
    const thai={language:'Thai',counts:{saved:2,missing:2,revised:1}},ctThai={language:'Thai',counts:{saved:200,missing:100,workloadFields:4,resolvedFields:3}},
        german={language:'German',counts:{saved:500,missing:500,workloadFields:0,resolvedFields:0}},
        {app}=assignmentHarness({managedTeamSort:'progress',managedTeamSortDir:'desc',managedSelectedDetails:{version:{id:'v1'},teams:[thai],
            contentGroups:[{id:'legacy',legacyVersionId:'v1',contentMode:'statdescription',teams:[thai]},
                {id:'ct-thai',contentMode:'clienttext',teams:[ctThai]},{id:'ct-german',contentMode:'clienttext',teams:[german]}]}});
    assert.deepEqual(Array.from(app.ctAssignmentRows,row=>[row.label,app.ctAssignmentProgress(row).percent]),
        [['Thai — ClientText',75],['Thai — StatDescription',50],['German — ClientText',0]]);
    app.managedTeamSortDir='asc';assert.equal(app.ctAssignmentRows[0].team,german);
    app.managedTeamSort='language';app.managedTeamSortDir='desc';assert.deepEqual(Array.from(app.ctAssignmentRows,row=>row.label),
        ['Thai — StatDescription','Thai — ClientText','German — ClientText']);
});
test('ClientText meters count each initial field once and explain overlapping status counts separately',()=>{
    const {app}=assignmentHarness(),row={contentMode:'clienttext',label:'French — ClientText',team:{language:'French',counts:{
        loaded:100,fields:400,workloadFields:10,resolvedFields:4,outdatedFields:3,missingFields:8,
        saved:30,revised:2,missing:5,outdated:3,savedFields:120,revisedFields:12}}},progress=app.ctAssignmentProgress(row);
    assert.equal(progress.total,10);assert.equal(progress.saved,4);assert.equal(progress.percent,40);
    assert.equal(progress.missing,3);assert.equal(progress.outdated,3);assert.equal(progress.savedWidth,'40%');
    assert.equal(progress.missingWidth,'30%');assert.equal(progress.outdatedWidth,'30%');assert.equal(progress.revisedWidth,'0%');
    assert.equal(progress.saved+progress.missing+progress.outdated,progress.total);assert.equal(progress.savedIds,30);assert.equal(progress.revisedFields,12);
    const tooltip=app.ctAssignmentProgressTooltip(row);
    assert.match(tooltip,/Resolved initial fields: 4 \/ 10 \(40%\)/);assert.match(tooltip,/Saved: 30 · Revised: 2/);
    assert.match(tooltip,/Revised corrections: 12 · Missing: 8 · Outdated: 3/);
    assert.match(tooltip,/Orange fields are Outdated and may also be Missing/);
    assert.match(tooltip,/outside the initial workload and are excluded from the progress bar/);
    assert.match(tooltip,/unsaved drafts and pending offline saves are excluded/);
    row.team.counts.outdatedFields=100;row.team.counts.resolvedFields=100;
    assert.equal(app.ctAssignmentProgress(row).savedWidth,'100%');assert.equal(app.ctAssignmentProgress(row).outdatedWidth,'0%');
});
test('ClientText zero and unavailable initial workloads remain neutral without using loaded IDs or Saved counts',()=>{
    const {app}=assignmentHarness(),row={contentMode:'clienttext',label:'Thai — ClientText',team:{language:'Thai',counts:{loaded:149550,saved:1000,missing:100,workloadFields:0,resolvedFields:0}}},
        progress=app.ctAssignmentProgress(row);
    assert.equal(progress.total,0);assert.equal(progress.saved,0);assert.equal(progress.percent,0);assert.equal(progress.empty,true);assert.equal(progress.known,true);
    for(const name of ['savedWidth','revisedWidth','missingWidth','outdatedWidth'])assert.equal(progress[name],'0%');
    assert.match(app.ctAssignmentProgressTooltip(row),/No initial field workload; the bar is neutral/);
    delete row.team.counts.workloadFields;assert.equal(app.ctAssignmentProgress(row).known,false);
    assert.match(app.ctAssignmentProgressTooltip(row),/workload counts are unavailable/);
});
test('draft queues capture unit/scope revisions and serialize subsequent edits against their own head',async()=>{
    const first=deferred(),calls=[],{app}=harness();app.ctDraftDirty=true;
    app._ctStore={async putDraft(captured,id,input,options){calls.push({captured,id,input,options});if(calls.length===1)await first.promise;return {revision:calls.length};}};
    app.ctValues={[fieldId]:'First'};const a=app.ctFlushDraft();
    app.ctValues={[fieldId]:'Second'};const b=app.ctFlushDraft();await settle();
    assert.equal(calls.length,1);assert.equal(calls[0].options.expectedRevision,null);
    first.resolve();assert.equal(await a,true);assert.equal(await b,true);
    assert.equal(calls[1].options.expectedRevision,1);assert.equal(app._ctDraftRevision,2);
    await app.ctFlushDraft();assert.equal(calls.length,2,'Identical text and reviews do not rewrite a checkpoint');
    app.ctValues={[fieldId]:'Captured old group'};const c=app.ctFlushDraft();
    app.ctWorkspace={scope:{...scope,groupId:'other'}};app._ctDraftRevision=99;await c;
    assert.equal(calls[2].captured.groupId,'group1');assert.equal(calls[2].options.expectedRevision,2);
    assert.equal(app._ctDraftRevision,99,'Late old-unit checkpoint cannot publish into the new selection');
});

function enableHistory(h) {
    h.app.ctLoadHistory=h.mixin.methods.ctLoadHistory.bind(h.app);
    Object.defineProperty(h.app,'ctHistoryChoices',{get:()=>h.mixin.computed.ctHistoryChoices.call(h.app)});
    Object.defineProperty(h.app,'ctHistoryComparison',{get:()=>h.mixin.computed.ctHistoryComparison.call(h.app)});
    Object.defineProperty(h.app,'ctHistoryPreviousProvenance',{get:()=>h.mixin.computed.ctHistoryPreviousProvenance.call(h.app)});
    return h;
}
test('history normalizes local and shared before/after values with verified raw field context',async()=>{
    const h=enableHistory(harness()),{app,window,original}=h,requests=[],calls=[];
    original.fields[0].source='Thai ไทย@literal\\nactual\n<script>alert(1)</script>';
    original.fields.push({id:'gender',name:'Gender',kind:'gender',source:'',target:'M',required:false},
        {id:'form-ms',name:'Name',kind:'form',form:'MS',source:'Male {0}',target:'Old MS',required:false});
    original.developerNotes='Developer <img src=x onerror=alert(1)> note';
    app.ctValues=S.valuesFor(original);app.ctValues[fieldId]='Current draft';
    app.managedOnlineAvailable=true;app.cloudCanAccessAllLanguages=true;
    app._ctStore={async listHistory(){return[{id:'job-1',unitId:original.id,createdAt:10,before:null,
        after:{values:{[fieldId]:'Literal \\n and real\n@<img>',gender:'F','form-ms':'New MS'},reviewed:{}}}];}};
    app._cloud={async request(route){requests.push(route);return{history:[{id:7,createdAt:'2026-10-10T00:00:00Z',actor:{name:'Translator'},
        before:{id:original.id,values:{[fieldId]:'Shared before'}},after:{id:original.id,values:{[fieldId]:'Shared after'}}}],nextCursor:null};}};
    window.Diff={diffChars(before,after){calls.push({before,after});return before===after?[{value:before}]:[{value:before,removed:true},{value:after,added:true}];}};
    assert.equal(await app.ctLoadHistory(),true);assert.equal(app.ctHistory.length,2);
    assert.match(requests[0],new RegExp('/units/'+encodeURIComponent(original.id)+'/history\\?language=Thai&limit=50'));
    const local=app.ctHistory.find(entry=>entry.origin==='local'),shared=app.ctHistory.find(entry=>entry.origin==='shared');
    assert.equal(local.before.values[fieldId],original.fields[0].target);
    assert.equal(shared.before.values[fieldId],'Shared before');assert.equal(shared.after.values[fieldId],'Shared after');
    assert.equal(app.ctPickHistory(local),true);
    const diff=app.ctHistoryComparison;
    assert.equal(diff.rows[0].beforeSource,original.fields[0].source);assert.equal(diff.rows[0].afterSource,original.fields[0].source);
    assert.equal(diff.rows[0].afterTarget,'Literal \\n and real\n@<img>');
    assert.equal(diff.rows.find(row=>row.kind==='gender').afterTarget,'F');
    assert.equal(diff.rows.find(row=>row.form==='MS').afterTarget,'New MS');assert.equal(diff.notes[0].value,original.developerNotes);
    assert.ok(calls.some(call=>call.after==='Literal \\n and real\n@<img>'));
    app.ctHistoryWhitespace=true;
    assert.equal(app.ctHistoryDisplay('x@\\n y\nz'),'x@\\n·y↵\nz');
    assert.ok(!window.ClientTextUI.toolsComponent.template.includes('v-html'), 'Vue text interpolation escapes source, notes and target HTML');
    app.ctHistoryCompareA=shared.key+':before';app.ctHistoryCompareB=local.key+':after';
    assert.equal(app.ctHistoryComparison.rows[0].beforeTarget,'Shared before');
    assert.equal(app.ctHistoryComparison.rows[0].afterTarget,local.after.values[fieldId]);
});
test('older history expands local rows and follows the shared cursor without duplicate or empty-page loss',async()=>{
    const {app,original}=enableHistory(harness()),limits=[],routes=[];
    app.managedOnlineAvailable=true;app.cloudCanAccessAllLanguages=true;
    const local=Array.from({length:101},(_,index)=>({id:'local-'+index,unitId:original.id,createdAt:index+1,after:{values:{[fieldId]:'Text '+index}}}));
    app._ctStore={async listHistory(_scope,_id,options){limits.push(options.limit);return local.slice(0,options.limit);}};
    app._cloud={async request(route){routes.push(route);return routes.length===1
        ?{history:[{id:11,createdAt:1000,after:{id:original.id,values:{[fieldId]:'Remote'}}}],nextCursor:'11'}
        :{history:[],nextCursor:null};}};
    await app.ctLoadHistory();assert.equal(app.ctHistory.length,101);assert.equal(app.ctHistoryLocalMore,true);assert.equal(app.ctHistoryCursor,'11');
    await app.ctLoadOlderHistory();assert.equal(app.ctHistory.length,102);assert.equal(app.ctHistoryLocalMore,false);assert.equal(app.ctHistoryCursor,null);
    assert.deepEqual(limits,[101,201]);assert.match(routes[1],/&cursor=11$/);
    assert.equal(app.ctHistory.filter(entry=>entry.key==='shared:11').length,1);
});
test('late history loads cannot replace another unit, account or group timeline',async()=>{
    for(const changed of ['unit','account','group']){
        const {app,original}=enableHistory(harness()),pending=deferred(),entered=deferred();
        app._ctStore={async listHistory(){entered.resolve();return pending.promise;}};
        const loading=app.ctLoadHistory();await entered.promise;
        if(changed==='unit')app.ctSelection='other-unit';
        else {app.ctWorkspace={scope:{...scope,[changed==='account'?'accountId':'groupId']:'other'}};if(changed==='account')app.managedCatalogScope='bob:poe2';}
        const current=[{key:'current-scope-history'}];app.ctHistory=current;app.ctHistoryLoading=true;
        pending.resolve([{id:'old',unitId:original.id,after:{values:{[fieldId]:'Old'}}}]);
        assert.equal(await loading,false);assert.equal(app.ctHistory,current);assert.equal(app.ctHistoryLoading,true);
    }
});
test('history restore creates an exact durable draft and retains only current field review hashes',async()=>{
    const f=fixture(),{app,original}=enableHistory(harness());await f.store.import(scope,{units:[original],assets:[asset]});
    const saved=await f.store.save(scope,original.id,{jobId:'saved',values:{[fieldId]:'Committed'},reviewed:{}});
    app.ctSaved={[original.id]:saved.saved};app._ctStore=f.store;
    const raw='Restored @literal\\nreal\n<script>x</script>';
    app._ctStore={...f.store,async listHistory(){return[{id:'valid',unitId:original.id,createdAt:1,after:{values:{[fieldId]:raw,removed:'Do not restore'},reviewed:{[fieldId]:S.sourceHash(original.fields[0].source),removed:'hash'}}},
        {id:'stale',unitId:original.id,createdAt:2,after:{values:{[fieldId]:'Older'},reviewed:{[fieldId]:'f'.repeat(64)}}}];}};
    await app.ctLoadHistory();const valid=app.ctHistory.find(entry=>entry.id==='valid');
    assert.equal(await app.ctRestoreHistory(valid),true);
    assert.equal(app.ctValues[fieldId],raw);assert.equal(app.ctValues.removed,undefined);
    assert.equal(app.ctReviewed[fieldId],S.sourceHash(original.fields[0].source));assert.equal(app.ctReviewed.removed,undefined);
    const draft=await f.store.getDraft(scope,original.id);assert.equal(draft.values[fieldId],raw);
    assert.equal((await f.store.getSaved(scope))[original.id].values[fieldId],'Committed', 'History restore does not commit or export work');
    assert.equal(await app.ctRestoreHistory(app.ctHistory.find(entry=>entry.id==='stale')),true);
    assert.deepEqual(clone(app.ctReviewed),{});
});
test('history restore refuses stale rows and rechecks unit/account/group after draft preservation',async()=>{
    for(const changed of ['unit','account','group']){
        const {app,original}=enableHistory(harness()),held=deferred(),entered=deferred();
        app._ctStore={async listHistory(){return[{id:'entry',unitId:original.id,after:{values:{[fieldId]:'Historical'}}}];}};
        await app.ctLoadHistory();const entry=app.ctHistory[0];
        app.ctFlushDraft=async()=>{entered.resolve();return held.promise;};
        const restoring=app.ctRestoreHistory(entry);await entered.promise;
        if(changed==='unit')app.ctSelection='other-unit';else app.ctWorkspace={scope:{...scope,[changed==='account'?'accountId':'groupId']:'other'}};
        app.ctValues={[fieldId]:'Current scoped text'};held.resolve(true);
        assert.equal(await restoring,false);assert.equal(app.ctValues[fieldId],'Current scoped text');
        assert.equal(app.ctPickHistory(entry),false);assert.equal(await app.ctRestoreHistory(entry),false);
    }
});
test('history restore preserves text typed while an earlier draft checkpoint is pending',async()=>{
    const {app,original}=enableHistory(harness()),held=deferred(),entered=deferred();
    app._ctStore={async listHistory(){return[{id:'entry',unitId:original.id,after:{values:{[fieldId]:'Historical'}}}];}};
    await app.ctLoadHistory();app.ctFlushDraft=async()=>{entered.resolve();return held.promise;};
    const restoring=app.ctRestoreHistory(app.ctHistory[0]);await entered.promise;
    app.ctValues[fieldId]='Newly typed text';held.resolve(true);
    assert.equal(await restoring,false);assert.equal(app.ctValues[fieldId],'Newly typed text');
});
test('the read-only history dialog blocks save shortcuts and Escape restores focus',async()=>{
    const {app,window}=harness();let focused=0,saved=0,prevented=0;
    const button={isConnected:true,focus(){focused++;}};window.document={activeElement:button,getElementById(){return{focus(){}};}};
    app.$nextTick=callback=>callback?.();app.ctSave=async()=>saved++;
    app.ctOpenHistoryViewer();assert.equal(app.ctHistoryViewer,true);
    for(const event of [{key:'F2'},{key:'s',ctrlKey:true},{key:'s',metaKey:true}])await app.ctKey({...event,preventDefault(){prevented++;}});
    assert.equal(saved,0);assert.equal(prevented,3);
    await app.ctKey({key:'Escape',preventDefault(){prevented++;}});
    assert.equal(app.ctHistoryViewer,false);assert.equal(focused,1);assert.equal(prevented,4);
});
test('explicit previous-version comparison uses verified old English and the accepted remote base rather than pending text',async()=>{
    const {app,original}=enableHistory(harness()),previous=clone(original),oldScope={...scope,versionId:'v0',groupId:'previous-group'};
    original.fields[0].source='New English';previous.fields[0].source='Previous English';previous.developerNotes='Previous developer note';
    previous.fields.push({id:'removed-field',name:'Removed',kind:'text',source:'Removed English',target:'Removed original'});
    app.ctValues={[fieldId]:'New draft'};
    app.ctSaved={[original.id]:{provenance:{groupId:oldScope.groupId,unitId:original.id,revision:2}}};
    let activations=0;app.ctOpenGroup=async()=>activations++;
    app._ctStore={async listWorkspaces(){return[{...oldScope,state:'ready'}];},async getUnit(captured,id){assert.deepEqual(clone(captured),oldScope);assert.equal(id,previous.id);return previous;},
        async listHistory(){return[{after:{values:{[fieldId]:'Unaccepted pending correction'},remoteBase:{revision:2,values:{[fieldId]:'Accepted previous', 'removed-field':'Kept old'},reviewed:{}}}}];}};
    assert.equal(await app.ctLoadPreviousHistory(),true);assert.equal(activations,0);
    assert.equal(app.ctWorkspace.scope.groupId,scope.groupId);assert.equal(app.ctValues[fieldId],'New draft');
    const comparison=app.ctHistoryComparison;
    assert.equal(comparison.rows[0].beforeSource,'Previous English');assert.equal(comparison.rows[0].afterSource,'New English');
    assert.equal(comparison.rows[0].beforeTarget,'Accepted previous');assert.equal(comparison.rows[0].afterTarget,'New draft');
    assert.equal(comparison.rows.find(row=>row.id==='removed-field').removed,true);
    assert.ok(comparison.notes.some(part=>part.value==='Previous developer note'&&part.removed));
});
test('uncached previous-version comparison verifies the prior group without activation and pages to its exact frozen revision',async()=>{
    const {app,original}=enableHistory(harness()),previous=clone(original),requests=[],opens=[];
    const group={id:'previous-group',versionId:'v0',contentMode:'clienttext',language:'Thai'},version={id:'v0',game:'poe2',branchId:'default'};
    previous.fields[0].source='Old source';app.ctSaved={[original.id]:{provenance:{groupId:group.id,unitId:original.id,revision:2}}};
    app.managedOnlineAvailable=true;app.cloudCanAccessAllLanguages=true;
    app._ctStore={async listWorkspaces(){return[];},async getUnit(){return previous;},async listHistory(){return[];}};
    app.ctOpenGroup=async(...args)=>{opens.push(args);return{version,group};};
    app._cloud={async request(route){requests.push(route);if(!route.includes('/history?'))return{group:{...group,version}};
        return route.endsWith('&cursor=9')?{history:[{after:{id:original.id,revision:2,values:{[fieldId]:'Captured accepted target'}}}],nextCursor:null}
            :{history:[{after:{id:original.id,revision:3,values:{[fieldId]:'Newer target must not be used'}}}],nextCursor:'9'};}};
    assert.equal(await app.ctLoadPreviousHistory(),true);assert.equal(opens.length,1);assert.equal(opens[0][3],false);
    assert.equal(requests.length,3);assert.match(requests[2],/&cursor=9$/);
    assert.equal(app.ctHistoryComparison.rows[0].beforeSource,'Old source');
    assert.equal(app.ctHistoryComparison.rows[0].beforeTarget,'Captured accepted target');
    assert.equal(app.ctWorkspace.scope.groupId,scope.groupId);
});
test('previous-version comparison fences late account, group and unit replies before caching or showing source',async()=>{
    for(const changed of ['account','group','unit']){
        const {app,original}=enableHistory(harness()),held=deferred(),reached=deferred();let reads=0;
        app.ctSaved={[original.id]:{provenance:{groupId:'previous-group',unitId:original.id,revision:0}}};
        app._ctStore={async listWorkspaces(){reached.resolve();return held.promise;},async getUnit(){reads++;return original;}};
        const comparing=app.ctLoadPreviousHistory();await reached.promise;
        if(changed==='unit')app.ctSelection='other-unit';else app.ctWorkspace={scope:{...scope,[changed==='account'?'accountId':'groupId']:'other'}};
        held.resolve([{...scope,versionId:'v0',groupId:'previous-group',state:'ready'}]);
        assert.equal(await comparing,false);assert.equal(reads,0);assert.equal(app.ctHistoryViewer,false);
        assert.equal(app.ctHistory.length,0);
    }
});
test('an unavailable previous saved revision is labelled and uses only its verified original translation',async()=>{
    const {app,original}=enableHistory(harness()),previous=clone(original);
    previous.fields[0].source='Verified earlier English';previous.fields[0].target='Verified workbook target';
    app.ctSaved={[original.id]:{provenance:{groupId:'previous-group',revision:7}}};
    app._ctStore={async listWorkspaces(){return[{...scope,versionId:'v0',groupId:'previous-group',state:'ready'}];},async getUnit(){return previous;},async listHistory(){return[];}};
    assert.equal(await app.ctLoadPreviousHistory(),true);
    assert.equal(app.ctHistoryComparison.rows[0].beforeTarget,'Verified workbook target');
    assert.match(app.ctHistoryError,/Saved revision 7 is unavailable/);
    assert.match(app.ctHistory[0].action,/saved revision 7 unavailable/);
});
test('a foreign predecessor group is rejected before its workbook is cached',async()=>{
    const {app,original}=enableHistory(harness());let opens=0;
    app.ctSaved={[original.id]:{provenance:{groupId:'previous-group',revision:1}}};
    app.managedOnlineAvailable=true;app.cloudCanAccessAllLanguages=true;app._ctStore={async listWorkspaces(){return[];}};
    app._cloud={async request(){return{group:{id:'previous-group',versionId:'v0',contentMode:'clienttext',language:'Thai'},version:{id:'v0',game:'poe1',branchId:'default'}};}};
    app.ctOpenGroup=async()=>opens++;
    assert.equal(await app.ctLoadPreviousHistory(),false);assert.equal(opens,0);assert.match(app.ctHistoryError,/does not match/);
});
test('uncertain saves replay the exact receipt command and retain subsequently typed text',async()=>{
    const f=fixture();await f.store.import(scope,{units:[unit()],assets:[asset]});const {app,original}=harness();
    const commands=[];let fail=true;app._ctStore={...f.store,async save(captured,id,command){commands.push(clone(command));const result=await f.store.save(captured,id,command);if(fail){fail=false;throw new Error('Uncertain completion');}return result;}};
    app.ctSync=()=>{};app.ctValues={[fieldId]:'First authored text'};app.ctDraftDirty=true;
    assert.equal(await app.ctSave(),false);const pending=app._ctSaveJob;assert.ok(pending.command);
    app.ctValues={[fieldId]:'Newer unsaved editor text'};app.ctDraftDirty=true;
    assert.equal(await app.ctSave(true),false);assert.deepEqual(commands[1],commands[0]);
    assert.equal(app.ctValues[fieldId],'Newer unsaved editor text');assert.equal(app.ctDraftDirty,true);assert.equal(app.ctSelection,original.id);
    assert.equal(app.ctSaved[original.id].values[fieldId],'First authored text');assert.equal(app._ctSaveJob,null);
    assert.equal(await app.ctFlushDraft(),true);assert.equal((await f.store.getDraft(scope,original.id)).values[fieldId],'Newer unsaved editor text');
    assert.equal(await app.ctSave(),true);assert.notEqual(commands[2].jobId,commands[0].jobId);
    assert.equal((await f.store.getSaved(scope))[original.id].values[fieldId],'Newer unsaved editor text');
});
test('fencing clears pending job identities before another group opens the same sheet ID',async()=>{
    const {app,original}=harness();app._ctSaveJob={unitId:original.id,scopeKey:Store.scopeKey(scope),id:'old-job',command:{jobId:'old-job'}};
    app.ctFence();assert.equal(app._ctSaveJob,null);assert.equal(app.ctSelection,'');assert.equal(app._ctDraftRevision,null);
    assert.equal(app._ctUnitIndex.size,0);assert.equal(app._ctWorkUnits.size,0);
    const next={...scope,groupId:'other'};app.ctWorkspace={scope:next};app.ctSelection=original.id;app.ctActive=true;app.ctBusy=false;app.ctChoices=[];app.ctUnits=[original];app._ctUnitIndex=new Map([[original.id,original]]);
    app._ctStore={async save(captured,id,command){assert.equal(captured.groupId,'other');assert.notEqual(command.jobId,'old-job');return{saved:{unitId:id,values:command.values,reviewed:command.reviewed,revision:1}};}};
    app.ctSync=()=>{};assert.equal(await app.ctSave(),true);
});
test('cached status rows re-evaluate only changed saved objects and distinguish source groups',()=>{
    const {app,mixin,window,original}=harness();let evaluated=0;
    window.ClientTextState={...S,statusFor(...args){evaluated++;return S.statusFor(...args);}};
    const one=app.ctStatus(original);assert.equal(app.ctStatus(original),one);assert.equal(evaluated,1);
    assert.equal(mixin.computed.ctCounts.call(app).total,1);assert.equal(evaluated,1);
    app.ctSaved={[original.id]:{values:{[fieldId]:'Correction'},reviewed:{}}};
    assert.equal(app.ctStatus(original).revised,true);assert.equal(evaluated,2);
    const next=clone(original);next.fields[0].target='Different original';app.ctStatus(next);assert.equal(evaluated,3);
});
test('unchanged sync remains silent, retains saved identity and actionable conflicts, and fences late requests',async()=>{
    const {app,original}=harness(),saved={unitId:original.id,values:{[fieldId]:'Saved'},reviewed:{},revision:1,serverRevision:1};
    app.ctSaved={[original.id]:saved};app.ctRevision=3;app._ctStore={async getSaved(){return{[original.id]:clone(saved)};}};
    let flushes=0,diagnostics=0;app.ctRefreshDiagnostics=()=>diagnostics++;
    app._ctSync={async flush(){flushes++;return{conflicts:0};},async pull(){},snapshot(){return{error:''};}};
    const before=app.ctSaved;app.ctError='A manual export error';await app.ctSync();
    assert.equal(app.ctSaved,before);assert.equal(app.ctSaved[original.id],saved);assert.equal(app.ctRevision,3);assert.equal(diagnostics,0);assert.equal(app.ctError,'A manual export error');
    app._ctSync.flush=async()=>({conflicts:1});app._ctSync.snapshot=()=>({error:'Choose the conflicting translation'});await app.ctSync();
    assert.equal(app.ctError,'Choose the conflicting translation');assert.equal(app.ctRevision,3);
    const pending=deferred();let pulls=0;app._ctSync={async flush(){flushes++;await pending.promise;return{};},async pull(){pulls++;}};
    const a=app.ctSync(),b=app.ctSync();await settle();assert.equal(flushes,2,'Concurrent polls share one in-flight operation');
    app.ctFence();pending.resolve();await Promise.all([a,b]);assert.equal(pulls,0);assert.equal(Object.keys(app.ctSaved).length,0);assert.equal(app.ctUnits.length,0);assert.equal(app.ctWorkspace,null);assert.equal(app.ctRevision,3);
});

test('completed consistency scans refresh changed rows and their peers without clearing unrelated diagnostics',async()=>{
    const {app,mixin}=harness();
    const first=unit({recordId:'first'}),second=unit({recordId:'second'}),unrelated=unit({recordId:'third'});
    first.id=JSON.stringify(['normal','Sheet','first']);second.id=JSON.stringify(['normal','Sheet','second']);unrelated.id=JSON.stringify(['normal','Sheet','third']);
    first.fields[0].source=second.fields[0].source='Power {0}';first.fields[0].target='Force {0}';second.fields[0].target='Strength {0}';
    unrelated.fields[0].source='Icon <<button_x>>';unrelated.fields[0].target='Without icon';
    app.ctUnits=[first,second,unrelated];app._ctUnitIndex=new Map(app.ctUnits.map(value=>[value.id,value]));
    app.ctRefreshDiagnostics=mixin.methods.ctRefreshDiagnostics.bind(app);
    await app.ctScan(true);
    assert.ok(app.ctDiagnostics[first.id].some(issue=>issue.code==='clienttext-consistency'));
    assert.ok(app.ctDiagnostics[second.id].some(issue=>issue.code==='clienttext-consistency'));
    const third=app.ctDiagnostics[unrelated.id];assert.ok(third.some(issue=>issue.severity==='error'));
    app.ctSaved={[first.id]:{values:{[fieldId]:'Strength {0}'},reviewed:{}}};app.ctRefreshDiagnostics([first.id]);
    assert.ok(!app.ctDiagnostics[first.id].some(issue=>issue.code==='clienttext-consistency'));
    assert.ok(!app.ctDiagnostics[second.id].some(issue=>issue.code==='clienttext-consistency'));
    assert.equal(app.ctDiagnostics[unrelated.id],third);
});

test('comment drafts retain their captured account/group while late loads cannot replace the current composer',async()=>{
    const f=fixture(),{app,original}=harness(),pending=deferred();let first=true;
    app.ctCommentText='Old group draft';app.ctCommentGlobal=true;app._ctStore={...f.store,async getRequest(...args){if(first){first=false;await pending.promise;}return f.store.getRequest(...args);}};
    const ctx=app.ctContext(),oldKey=app.ctCommentKey(ctx,original.id),writing=app.ctFlushCommentDraft();await settle();
    app.managedCatalogScope='bob:poe2';app.ctWorkspace={scope:{...scope,accountId:'bob',groupId:'other'}};app.ctCommentText='Current composer';
    pending.resolve();await writing;
    const saved=await f.store.getRequest({accountId:scope.accountId,game:scope.game,branchId:scope.branchId},oldKey);
    assert.equal(saved.payload.text,'Old group draft');assert.equal(saved.payload.groupId,scope.groupId);assert.equal(saved.payload.audience,'global');
    assert.equal((await f.store.listRequests({accountId:'bob',game:scope.game,branchId:scope.branchId})).length,0);
    await app.ctLoadCommentDraft(ctx,original.id);assert.equal(app.ctCommentText,'Current composer');
});

test('selection interrupted during draft flush cannot open an old record in a different group',async()=>{
    const {app,original}=harness({ctSelection:''}),pending=deferred();let reads=0;
    app.ctFlushDraft=()=>pending.promise;app.ctFlushCommentDraft=async()=>{};app._ctStore={async getDraft(){reads++;return null;}};
    app.$nextTick=async()=>{};app.$refs={};app.ctLoadComments=()=>{};app.ctLoadCommentDraft=()=>{};
    const selecting=app.ctSelect(original);await settle();
    app.managedCatalogScope='bob:poe2';app.ctWorkspace={scope:{...scope,accountId:'bob',groupId:'other'}};
    app.ctSelection='current-group-record';app.ctValues={[fieldId]:'Current translation'};
    pending.resolve(true);await selecting;
    assert.equal(reads,0);assert.equal(app.ctSelection,'current-group-record');assert.equal(app.ctValues[fieldId],'Current translation');
});

test('comment posting stops before network after its account changes during journal preparation',async()=>{
    const {app}=harness(),pending=deferred(),requests=[];let first=true;
    app.cloudProfileId=scope.accountId;app.ctCommentText='Authorized old comment';
    const payload={kind:'comment',text:app.ctCommentText,audience:'language',idempotencyKey:'comment-id'};
    app._ctStore={async getRequest(){if(first){first=false;await pending.promise;}return {payload};},async putRequest(){},async deleteRequest(){}};
    app._cloud={async request(...args){requests.push(args);return{};}};
    const posting=app.ctPostComment();await settle();
    app.managedCatalogScope='bob:poe2';app.cloudProfileId='bob';app.ctWorkspace={scope:{...scope,accountId:'bob',groupId:'other'}};
    pending.resolve();await posting;assert.equal(requests.length,0);
});

test('collection creation stops before network after account changes during journal read',async()=>{
    const {app}=harness(),pending=deferred(),requests=[];
    app.cloudProfileId=scope.accountId;app._ctStore={async getRequest(){await pending.promise;return {payload:{idempotencyKey:'collection-id'}};},async putRequest(){}};
    app._cloud={async request(...args){requests.push(args);return{collection:{id:'frozen'}};}};
    const collecting=app.ctCollect({id:scope.versionId},{id:scope.groupId,contentMode:'clienttext'},{language:scope.language});await settle();
    app.managedCatalogScope='bob:poe2';app.cloudProfileId='bob';pending.resolve();await collecting;
    assert.equal(requests.length,0);
});

test('uncertain metadata creation retries its immutable journal body even after form edits',async()=>{
    const {app,window}=harness(),journal=new Map(),bodies=[];let fail=true;
    window.ManagedVersions={parseDeadline:value=>Number(value)};
    app.cloudProfileId=scope.accountId;app.gameVersion=scope.game;app.branchId=scope.branchId;app.ctUploadVersion=null;app.ctUploadLocal=false;app.ctUploadName='First name';app.ctUploadDeadline='10';
    app._ctStore={async putRequest(_,id,payload){journal.set(id,clone(payload));},async getRequest(_,id){return journal.has(id)?{requestId:id,payload:clone(journal.get(id))}:null;},async deleteRequest(_,id){journal.delete(id);}};
    app._cloud={async request(_,options){bodies.push(clone(options.body));if(fail){fail=false;throw new Error('Reply lost after acceptance');}return{version:{id:'created-once'}};}};
    app.refreshManagedVersions=async()=>{};
    await app.ctSaveMetadataDraft();assert.equal(app.ctUploadVersion,null);assert.equal(journal.size,1);
    app.ctUploadName='Changed after uncertainty';app.ctUploadDeadline='20';await app.ctSaveMetadataDraft();
    assert.deepEqual(bodies[1],bodies[0]);assert.equal(app.ctUploadVersion.id,'created-once');assert.equal(journal.size,0);
});

test('publication resume hydrates the durable journal instead of using its compact list header',async()=>{
    const {app}=harness(),opened=[],payload={kind:'publication',name:'Release',deadline:'10',releaseRequest:'release-id',
        groups:[{contentMode:'statdescription',carry:[{id:'unit',values:{field:'Exact carried text'}}],uploadId:'staged-upload'}]};
    app._ctStore={async getRequest(captured,id,options){assert.equal(captured.accountId,scope.accountId);assert.equal(id,'publication-id');assert.equal(options.guard(),true);return{requestId:id,payload};}};
    app.ctOpenUpload=async(version,local)=>opened.push({version,local});
    await app.ctResumePublication({requestId:'publication-id',payload:{...payload,groups:[{contentMode:'statdescription',carry:[]}]},storage:{format:1}});
    assert.equal(opened.length,1);assert.equal(app.ctUploadName,'Release');assert.equal(app._ctPublicationRequest,'publication-id');
    assert.equal(app._ctReleaseRequest,'release-id');assert.equal(app.ctPrepared[0].carry[0].values.field,'Exact carried text');
    assert.equal(app.ctPrepared[0].uploadId,'staged-upload');
});

test('late journal hydration cannot open publication controls after an account change',async()=>{
    const {app}=harness(),pending=deferred();let opens=0;
    app._ctStore={async getRequest(){await pending.promise;return{payload:{kind:'publication',name:'Old private release',groups:[]}};}};
    app.ctOpenUpload=async()=>{opens++;};
    const resuming=app.ctResumePublication({requestId:'publication-id',payload:{kind:'publication'}});await settle();
    app.managedCatalogScope='bob:poe2';app.cloudProfileId='bob';pending.resolve();await resuming;
    assert.equal(opens,0);assert.equal(app._ctPublicationRequest,undefined);
});

test('cached publication resume reuses bounded accepted compact data without rehashing original units',async()=>{
    const {app,window,original}=harness(),compact=S.compactUnit(original),metadata={descriptors:[{...asset,baselineId:'accepted',root:'accepted-root'}]},tree={ids:[original.id],levels:[['leaf']]};let compactReads=0;
    const payload={kind:'publication',name:'Release',groups:[{contentMode:'clienttext',language:scope.language,cacheScope:scope,carry:[]}]};
    window.ClientTextState={...S,compactUnit(){throw new Error('Resume must not rehash originals on the UI thread.');}};
    app._ctStore={async getRequest(){return{payload};},async getUnits(captured,options){assert.equal(options.guard(),true);assert.equal(captured.groupId,scope.groupId);return[original];},
        async getMetadata(){return metadata;},async getAsset(){return{...asset,name:'Thai_PoE2.xlsm',blob:new Blob(['original bytes']),parsed:{sheets:[]},descriptor:metadata.descriptors[0],tree};},
        async getCompactUnits(captured,options){assert.equal(options.guard(),true);assert.equal(captured.groupId,scope.groupId);compactReads++;return[compact];}};
    app.ctOpenUpload=async()=>{};
    await app.ctResumePublication({requestId:'publication-id',payload:{kind:'publication'}});
    assert.equal(compactReads,1);assert.equal(app.ctPrepared[0].manifest.units[0],compact);
    assert.equal(app.ctPrepared[0].manifest.trees.normal,tree);assert.equal(app.ctPrepared[0].manifest.descriptors[0].baselineId,'accepted');
    assert.equal(await app.ctPrepared[0].candidates[0].file.text(),'original bytes');assert.equal(app.ctUploadError,'');
});

test('comment acknowledgement preserves a newer composer draft and its durable journal',async()=>{
    const f=fixture(),{app,original}=harness(),posted=deferred(),started=deferred();
    app.cloudProfileId=scope.accountId;app._ctStore=f.store;app.ctCommentText='First posted comment';app.ctLoadComments=async()=>{};
    app._cloud={async request(_,options){assert.equal(options.body.text,'First posted comment');started.resolve();await posted.promise;return{};}};
    const posting=app.ctPostComment();await started.promise;
    app.ctCommentText='Newer unsent draft';app.ctCommentGlobal=true;await app.ctFlushCommentDraft();
    posted.resolve();await posting;
    const request=await f.store.getRequest({accountId:scope.accountId,game:scope.game,branchId:scope.branchId},app.ctCommentKey(app.ctContext(),original.id));
    assert.ok(request,'The sent command must not consume a newer queued draft');assert.equal(request.payload.text,'Newer unsent draft');
    assert.equal(app.ctCommentText,'Newer unsent draft');assert.equal(app.ctCommentGlobal,true);
});

test('late activation after draft preservation cannot replace a newer account workspace',async()=>{
    const {app}=harness(),pending=deferred();let reads=0;
    app.ctFlushDraft=()=>pending.promise;app._ctStore={async getUnits(){reads++;return[];},async getSaved(){reads++;return{};}};
    const activating=app.ctActivate(scope,{name:'Old account'});await settle();
    app.managedCatalogScope='bob:poe2';const current={scope:{...scope,accountId:'bob',groupId:'other'}};app.ctWorkspace=current;
    pending.resolve(true);assert.equal(await activating,false);assert.equal(reads,0);assert.equal(app.ctWorkspace,current);
});

test('cached activation refuses a foreign account, game or branch before reading its private data',async()=>{
    for(const changes of [{accountId:'bob'},{game:'poe1'},{branchId:'other-release'}]){
        const {app}=harness();let reads=0;app._ctStore={async getUnits(){reads++;return[];},async getSaved(){reads++;return{};}};
        assert.equal(await app.ctActivate({...scope,...changes},{name:'Wrong workspace'}),false);assert.equal(reads,0);
    }
});

test('opening a workbook group refuses a different game or branch before cache/network work',async()=>{
    for(const changes of [{game:'poe1'},{branchId:'other-release'}]){
        const {app}=harness();let reads=0;app.cloudCanAccessAllLanguages=true;app._ctStore={async listWorkspaces(){reads++;return[];}};
        app._cloud={async request(){reads++;return{group:{assets:[]}};}};app._ctWorker={async buildManifest(){return{descriptors:[]};}};
        await app.ctOpenGroup({id:scope.versionId,game:scope.game,branchId:scope.branchId,...changes},{id:scope.groupId,contentMode:'clienttext'},scope.language);
        assert.equal(reads,0);
    }
});

test('frozen collection export excludes local work and carries source-only review facts without fabricating Saved',async()=>{
    const {app,window,original}=harness(),sourceOnly=clone(original),exported=[],downloads=[];
    sourceOnly.id=JSON.stringify(['normal',original.sheet,'source-only']);sourceOnly.recordId='source-only';
    const group={id:scope.groupId,contentMode:'clienttext'},version={id:scope.versionId,name:'Snapshot'},collection={id:'cutoff'};
    const local={values:{[fieldId]:'Unaccepted local edit'},reviewed:{},revision:2};app.ctSaved={[original.id]:local};const savedView=app.ctSaved;
    app._ctStore={async getMetadata(){return{state:'ready'};},async getSaved(){return clone(app.ctSaved);},async getUnits(){return[original,sourceOnly];},async getAsset(){return{role:'normal',name:'Thai_PoE2.xlsx',blob:new Blob(['original']),parsed:{artifactHash:'verified'}};}};
    app._cloud={async request(){return{collection,manifest:{groupId:group.id,versionId:version.id,language:scope.language,
      units:[{id:original.id,values:{[fieldId]:'Accepted cutoff'},reviewed:{},saved:true}],sourceReviews:[{id:sourceOnly.id,outdated:[fieldId],reviewed:{}}]}};}};
    app._ctWorker={async exportWorkbook(bytes,parsed,saved){exported.push({bytes,parsed,saved});return new Uint8Array([1,2,3]);}};
    window.saveAs=(...args)=>downloads.push(args);
    assert.equal(await app.ctDownload(collection,group,scope.language,version),true);
    assert.equal(exported[0].saved[original.id].values[fieldId],'Accepted cutoff');
    assert.equal(exported[0].saved[sourceOnly.id].saved,false);assert.deepEqual(Array.from(exported[0].saved[sourceOnly.id].outdated),[fieldId]);
    assert.equal(S.valuesFor(sourceOnly,exported[0].saved[sourceOnly.id])[fieldId],sourceOnly.fields[0].target);
    assert.equal(app.ctSaved,savedView);assert.equal(app.ctSaved[original.id],local);assert.equal(downloads[0][1],'Thai_PoE2.xlsx');
});

test('a fetched workbook group must belong to the selected version before parser or cache writes run',async()=>{
    for(const changes of [{id:'other-group'},{versionId:'other-version'}]){
        const {app}=harness();let work=0;app.cloudCanAccessAllLanguages=true;
        app._ctStore={async listWorkspaces(){return[];},async import(){work++;}};
        app._cloud={async request(){return{group:{id:scope.groupId,versionId:scope.versionId,game:scope.game,branchId:scope.branchId,assets:[],...changes}};}};
        app._ctWorker={async buildManifest(){work++;return{descriptors:[]};}};
        await app.ctOpenGroup({id:scope.versionId,game:scope.game,branchId:scope.branchId},{id:scope.groupId,contentMode:'clienttext'},scope.language,false);
        assert.equal(work,0);
    }
});

test('local multi-team imports retain complete content membership in every cached workspace',async()=>{
    const {app}=harness(),imports=[];
    app.ctUploadLocal=true;app.ctUploadName='Local release';app.ctPrepared=['Thai','French'].map(language=>({language,units:[],assets:[{role:'normal'}],manifest:{}}));
    app._ctStore={async import(captured,payload){imports.push({captured:clone(captured),metadata:clone(payload.metadata)});}};app.ctRefreshLocal=async()=>{};
    await app.ctPublishPrepared();
    assert.equal(app.ctUploadError,'');assert.equal(imports.length,2);
    for(const item of imports){
        assert.deepEqual(item.metadata.version.contentGroups.map(group=>group.language),['Thai','French']);
        assert.equal(item.metadata.group.versionId,item.captured.versionId);
        assert.equal(item.metadata.group.id,item.captured.groupId);
    }
    assert.notEqual(imports[0].captured.groupId,imports[1].captured.groupId);
});

function uploadPreparationHarness(names,game='poe2'){
    const h=harness({gameVersion:game,ctUploadVersion:{id:'selected-release',game,branchId:scope.branchId},ctUploadLocal:false,
        ctPolicy:{clientTextRoles:{default:['normal'],German:['normal','gender'],French:['normal','gender']}}}),
        parseCalls=[],manifestCalls=[],requests=[],storeCalls=[],files=names.map(name=>new File(['Exact original bytes: '+name],name));
    h.app.ctReport=()=>{};
    h.app._ctWorker={
        async parseWorkbook(bytes,options){
            parseCalls.push({bytes:Buffer.from(bytes).toString('utf8'),filename:options.filename,role:options.role,language:options.language,signal:options.signal});
            const original={...unit(),role:options.role,id:JSON.stringify([options.role,'ClientStrings','ID/1'])},artifactHash=S.hash(Buffer.from(bytes).toString('utf8'));
            return{units:[original],artifactHash,assetHash:artifactHash,sheets:[{name:'ClientStrings',headers:[]}],warnings:[]};
        },
        async buildManifest(units,assets,options){
            manifestCalls.push({units:units.slice(),assets:assets.slice(),signal:options.signal});return S.buildManifest(units,assets);
        }
    };
    h.app._ctStore=new Proxy({}, {get(_target,name){return async()=>{storeCalls.push(String(name));throw Error('Preparation must not write to storage: '+String(name));};}});
    h.app._cloud={async request(url,options){requests.push({url,options});assert.match(url,/^\/v1\/content-predecessor\?/);
        assert.equal(options?.method,undefined,'preparation only reads predecessor metadata');return{version:null,group:null};}};
    h.app.ctChooseFiles({target:{files}});return{...h,files,parseCalls,manifestCalls,requests,storeCalls};
}

for(const game of ['poe1','poe2'])test('neutral German normal/Gender filenames prepare in the explicitly selected '+game+' version',async()=>{
    const {app,files,parseCalls,manifestCalls,requests,storeCalls}=uploadPreparationHarness(['German_Gender.xlsm','German.xlsm'],game);
    assert.deepEqual(Array.from(app.ctUploadFiles,candidate=>[candidate.file.name,candidate.language,candidate.role]),
        [['German_Gender.xlsm','German','gender'],['German.xlsm','German','normal']]);
    await app.ctPrepareUpload();assert.equal(app.ctUploadError,'');assert.equal(app.ctPrepared.length,1);assert.equal(app.ctUploading,false);
    const group=app.ctPrepared[0];assert.equal(group.contentMode,'clienttext');assert.equal(group.language,'German');assert.deepEqual(Array.from(group.assignments),['German']);
    assert.deepEqual(Array.from(group.assets,asset=>[asset.role,asset.name]),[['normal','German.xlsm'],['gender','German_Gender.xlsm']]);
    assert.deepEqual(parseCalls.map(call=>[call.filename,call.role,call.language]),[['German.xlsm','normal','German'],['German_Gender.xlsm','gender','German']]);
    for(const asset of group.assets){const original=files.find(file=>file.name===asset.name);assert.equal(asset.blob,original);assert.equal(await asset.blob.text(),'Exact original bytes: '+asset.name);}
    assert.equal(manifestCalls.length,1);assert.equal(group.manifest.descriptors.length,2);assert.equal(storeCalls.length,0);assert.equal(requests.length,1);
    assert.ok(requests[0].url.includes('game='+game));assert.ok(requests[0].url.includes('versionId=selected-release'));
});

for(const game of ['poe1','poe2'])test('workbook PoE filename markers are informational under the explicitly selected '+game+' release',async()=>{
    const other=game==='poe2'?'PoE1':'PoE2';
    for(const names of [['German_'+other+'.xlsm','German_Gender.xlsm'],['German.xlsm','German_Gender_'+other+'.xlsm'],['German_PoE1.xlsm','German_Gender_PoE2.xlsm']]){
        const {app,parseCalls,manifestCalls,requests,storeCalls}=uploadPreparationHarness(names,game);await app.ctPrepareUpload();
        assert.equal(app.ctUploadError,'');assert.equal(app.ctPrepared.length,1);assert.equal(app.ctUploading,false);
        assert.equal(parseCalls.length,2);assert.equal(manifestCalls.length,1);assert.equal(requests.length,1);assert.equal(storeCalls.length,0);
        assert.deepEqual(Array.from(app.ctPrepared[0].assets,asset=>asset.name),names);assert.deepEqual(Array.from(app.ctUploadFiles,candidate=>candidate.file.name),names);
        assert.ok(requests[0].url.includes('game='+game),'the selected release remains the preparation context');
    }
});

test('bounded workbook game markers preserve neutral PoE20 names and case-insensitive explicit game names',async()=>{
    for(const game of ['poe1','poe2'])for(const marker of ['PoE20','NotPoE2','PoE2copy']){
        const names=['German_'+marker+'.xlsm','German_Gender_'+marker+'.xlsm'],{app,parseCalls}=uploadPreparationHarness(names,game);
        await app.ctPrepareUpload();assert.equal(app.ctUploadError,'',game+' '+marker);assert.equal(parseCalls.length,2);
        assert.deepEqual(Array.from(app.ctPrepared[0].assets,asset=>asset.name),names);
    }
    const names=['gErMaN_pOe2.XlSm','GERMAN_gEnDeR_pOe2.XLSM'],correct=uploadPreparationHarness(names,'poe2');await correct.app.ctPrepareUpload();
    assert.equal(correct.app.ctUploadError,'');assert.deepEqual(correct.parseCalls.map(call=>[call.filename,call.language,call.role]),
        [[names[0],'German','normal'],[names[1],'German','gender']]);assert.deepEqual(Array.from(correct.app.ctPrepared[0].assets,asset=>asset.name),names);
    const other=uploadPreparationHarness(names,'poe1');await other.app.ctPrepareUpload();assert.equal(other.app.ctUploadError,'');assert.equal(other.parseCalls.length,2);
    assert.deepEqual(Array.from(other.app.ctPrepared[0].assets,asset=>asset.name),names);
});

test('existing explicitly marked French originals continue to prepare their paired group unchanged',async()=>{
    for(const game of ['poe1','poe2']){
        const marker=game==='poe2'?'PoE2':'PoE1',names=['French_'+marker+'.xlsm','French_Gender_'+marker+'.xlsm'],
            {app,parseCalls}=uploadPreparationHarness(names,game);await app.ctPrepareUpload();
        assert.equal(app.ctUploadError,'');assert.deepEqual(parseCalls.map(call=>[call.filename,call.role,call.language]),
            [[names[0],'normal','French'],[names[1],'gender','French']]);assert.deepEqual(Array.from(app.ctPrepared[0].assignments),['French']);
        assert.deepEqual(Array.from(app.ctPrepared[0].assets,asset=>asset.name),names);
    }
});

test('relaxed workbook filename handling still rejects missing, duplicate and unsupported roles before parsing',async()=>{
    const cases=[{names:['German.xlsm'],error:/requires exactly.*normal.*gender/i},
        {names:['German_Gender.xlsm'],error:/requires exactly.*normal.*gender/i},
        {names:['German.xlsm','German.xlsm'],error:/Duplicate normal workbook/i},
        {names:['German.xlsm','German_Gendered.xlsm'],error:/Duplicate normal workbook/i},
        {names:['German.xlsm','German_Gender.xlsm'],role:'unexpected',error:/requires exactly.*normal.*gender/i},
        {names:['French_PoE1.xlsm'],error:/requires exactly.*normal.*gender/i}];
    for(const changed of cases){
        const {app,parseCalls,manifestCalls,requests,storeCalls}=uploadPreparationHarness(changed.names);if(changed.role)app.ctUploadFiles[0].role=changed.role;
        await app.ctPrepareUpload();assert.match(app.ctUploadError,changed.error);assert.equal(app.ctPrepared.length,0);assert.equal(app.ctUploading,false);
        assert.equal(parseCalls.length,0);assert.equal(manifestCalls.length,0);assert.equal(requests.length,0);assert.equal(storeCalls.length,0);
    }
});

test('language-team detection requires a bounded name and still asks for confirmation instead of guessing',async()=>{
    for(const filename of ['Germanium.xlsm','German2.xlsm','Frenchman.xlsm']){
        const {app,parseCalls,manifestCalls,requests,storeCalls}=uploadPreparationHarness([filename]);assert.equal(app.ctUploadFiles[0].language,'');
        await app.ctPrepareUpload();assert.match(app.ctUploadError,/Confirm the language team/i);assert.ok(app.ctUploadError.includes(filename));
        assert.equal(app.ctPrepared.length,0);assert.equal(parseCalls.length,0);assert.equal(manifestCalls.length,0);assert.equal(requests.length,0);assert.equal(storeCalls.length,0);
    }
});

test('structural workbook parser failure prevents prepared publication while retaining exact selected originals',async()=>{
    const {app,files,parseCalls,manifestCalls,requests,storeCalls}=uploadPreparationHarness(['German.xlsm','German_Gender.xlsm']),
        parse=app._ctWorker.parseWorkbook,attempts=[];
    app._ctWorker.parseWorkbook=async(bytes,options)=>{attempts.push(options.filename);if(options.role==='gender')throw Error('Unsupported gender-form columns in sheet Words_Gender.');
        return parse(bytes,options);};
    await app.ctPrepareUpload();assert.match(app.ctUploadError,/Unsupported gender-form columns/i);assert.equal(app.ctPrepared.length,0);assert.equal(app.ctUploading,false);
    assert.deepEqual(attempts,['German.xlsm','German_Gender.xlsm']);assert.equal(parseCalls.length,1);assert.equal(manifestCalls.length,0);assert.equal(requests.length,0);assert.equal(storeCalls.length,0);
    assert.equal(app.ctProgress,null);
    for(let index=0;index<files.length;index++){assert.equal(app.ctUploadFiles[index].file,files[index]);assert.equal(await files[index].text(),'Exact original bytes: '+files[index].name);}
});

test('paired neutral originals prepare while Missing text files are ignored without renaming assets',async()=>{
    const {app,parseCalls}=uploadPreparationHarness(['German.xlsm','German_Gender.xlsm','Missing_German.txt']);
    assert.deepEqual(Array.from(app.ctUploadFiles,candidate=>candidate.file.name),['German.xlsm','German_Gender.xlsm']);
    await app.ctPrepareUpload();assert.equal(app.ctUploadError,'');assert.equal(parseCalls.length,2);
    assert.deepEqual(Array.from(app.ctPrepared[0].assets,asset=>asset.name),['German.xlsm','German_Gender.xlsm']);
});
