const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const S=require('../public/clientTextState.js'),Store=require('../public/clientTextStore.js');
const {fixture,scope,fieldId,unit,asset}=require('./clienttext-storage-fixture.cjs');
const clone=value=>structuredClone(value),settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function harness(changes={}){
    let nextId=0;
    const window={ClientTextState:S,ClientTextStore:Store,TranslationDiagnostics:require('../public/translationDiagnostics.js'),
        ClientTextNpcIndex:require('../public/clientTextNpcIndex.js'),
        ClientTextConvoIndex:require('../public/clientTextConvoIndex.js'),
        ContentAdapters:require('../public/contentAdapters.js'),
        TerminologyDiagnostics:require('../public/terminologyDiagnostics.js'),Vue:{markRaw:value=>value},crypto:{randomUUID:()=> 'save-'+(++nextId)}};
    const context=vm.createContext({window,console,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,Blob,File,TextEncoder});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/editorSession.js'),'utf8'),context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/editorComponents.js'),'utf8'),context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/clientTextUi.js'),'utf8'),context);
    const mixin=window.ClientTextUI.mixin,original=unit(),app={...mixin.data(),managedCatalogScope:'alice:poe2',cloudProfileId:scope.accountId,gameVersion:scope.game,branchId:scope.branchId,
        ctPolicy:{clientTextStorageProtocols:[S.STORAGE_PROTOCOL],clientTextParserVersions:S.PARSER_VERSIONS,clientTextSaveOrigins:['save','restore']},ctWorkspace:{scope:clone(scope)},ctActive:true,ctSelection:original.id,ctUnits:[original],ctSaved:{},ctValues:S.valuesFor(original),ctReviewed:{},
        appConfirm:async()=>true,
        _ctUnitIndex:new Map([[original.id,original]]),_ctWorkUnits:new Map(),_ctEditRevision:0,_ctDraftRevision:null,...changes};
    for(const[name,method]of Object.entries(mixin.methods))app[name]=method.bind(app);
    Object.defineProperty(app,'ctCurrentUnit',{get:()=>app._ctUnitIndex.get(app.ctSelection)||null});
    Object.defineProperty(app,'ctOfflineTest',{get:()=>mixin.computed.ctOfflineTest.call(app)});
    Object.defineProperty(app,'ctPreviewField',{get:()=>mixin.computed.ctPreviewField.call(app)});
    for(const name of ['ctHasScanSelection','ctScanScopeKey','ctScanPercent','ctScanResultFiles','ctScanResultPageCount','ctScanResultRangeLabel','ctScanVisibleResults','ctScanIssueCounts','ctDiagnosticScanController','ctDraftBlocked'])
        Object.defineProperty(app,name,{get:()=>mixin.computed[name].call(app)});
    for(const name of ['ctNpcGroups','ctNpcFilteredGroups','ctNpcBrowseTitle','ctNpcTotal','ctNpcKindOptions','ctNpcSeverities',
        'ctConvoParents','ctConvoTree','ctConvoBrowseTitle','ctConvoTotal','ctConvoSeverities'])
        Object.defineProperty(app,name,{get:()=>mixin.computed[name].call(app)});
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
function cloudAccessHarness(h,language=null){
    h.window.CloudSync=require('../public/cloudSync.js');
    h.window.ManagedVersions=require('../public/managedVersions.js');
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/cloudUi.js'),'utf8'),{window:h.window});
    Object.assign(h.app,{cloudSignedIn:true,cloudUser:{id:scope.accountId,role:'manager',language},lang:'German'});
    const computed={cloudCanAccessAllLanguages:h.window.CloudUI.mixin.computed.cloudCanAccessAllLanguages,
        ...Object.fromEntries(['managedCatalogAccess','managedManagerAccess','managedOnlineAvailable','managedSingleLanguage','managedCatalogScope']
            .map(name=>[name,h.window.ManagedVersions.mixin.computed[name]]))};
    for(const[name,getter]of Object.entries(computed))Object.defineProperty(h.app,name,{configurable:true,get:()=>getter.call(h.app)});
    return h;
}
function listHarness(changes={}){
    // Mechanics fixtures deliberately show complete records; product defaults
    // are asserted separately from mixin.data() in the status-filter test.
    const h=harness({inlineEditor:false,pageSize:2,ctSelectedFilters:['missing','saved','revised','outdated','error','warning','unchanged'],$nextTick:async()=>{},$refs:{},...changes});
    for(const name of ['ctRows','ctPageRows','ctPageCount','ctEffectivePageSize','ctCounts','ctStatusFilterOptions','ctDiagnosticCounts','ctDraftUnitIds','ctDraftCount'])
        Object.defineProperty(h.app,name,{get:()=>h.mixin.computed[name].call(h.app)});
    return h;
}
function namedUnit(id,source='English',target='Translation',outdated=false){
    return {...unit(source,target,outdated),id:JSON.stringify(['normal','ClientStrings',id]),recordId:id};
}
const rowEvent=(key,control=false)=>({key,target:{closest:()=>control?{}:null},preventDefault(){this.defaultPrevented=true;},stopPropagation(){}});

function npcUiHarness(changes={}) {
    const row=(sheet,id,number,target='Translation',role='normal')=>{
        const result={...namedUnit(id,'English '+id,target),id:JSON.stringify([role,sheet,id]),role,sheet};
        result.fields=result.fields.map(field=>({...field,sourceCell:'B'+number,targetCell:'C'+number}));return result;
    };
    const names=row('NPCs','Metadata/NPC/Renly',2),topic=row('NPCTalk','Metadata/NPC/Renly::1',3),
        dialogue=row('NPCTextAudio','RenlyIntro',4),reply=row('NPCTalkDialogueTextAudio','RenlyIntro',5,''),
        gender=row('NPCTextAudio_Gender','RenlyIntro',6,'Gender translation','gender'),
        una=row('NPCTextAudio','UnaIntro',7),unassigned=row('NPCTextAudio','UnknownIntro',8),other=row('ClientStrings','Unrelated',9);
    const groups=[{key:'renly',label:'Renly',paths:['Metadata/NPC/Renly'],npcUnits:[names],units:[names,topic,dialogue,reply,gender]},
        {key:'una',label:'Una',paths:['Metadata/NPC/Una'],npcUnits:[],units:[una]}],memberships=new Map();
    for(const group of groups)for(const unit of group.units)memberships.set(unit.id,new Map([[group.key,{kind:require('../public/clientTextNpcIndex.js').kindFor(unit),
        aliases:['NPCs','NPCTalk'].includes(unit.sheet)?[]:[group.label]}]]));
    memberships.set(unassigned.id,new Map());names.fields[0].name='Name';
    const units=[names,topic,dialogue,reply,gender,una,unassigned,other],index={groups,groupByKey:new Map(groups.map(group=>[group.key,group])),
        units:units.slice(0,-1),unassigned:[unassigned],memberships};
    const h=listHarness({ctUnits:units,_ctUnitIndex:new Map(units.map(unit=>[unit.id,unit])),ctSelection:dialogue.id,
        ctValues:S.valuesFor(dialogue),_ctNpcIndex:index,...changes});
    h.app.ctFlushDraft=async()=>true;h.app.ctFlushCommentDraft=async()=>{};
    return {...h,index,names,topic,dialogue,reply,gender,una,unassigned,other};
}

function convoUiHarness(changes={}) {
    const h=npcUiHarness(),row=(id,number,target='Translation',role='normal')=>{
        const sheet='NPCTalkDialogueTextAudio'+(role==='gender'?'_Gender':''),result={...namedUnit(id,'English '+id,target),id:JSON.stringify([role,sheet,id]),role,sheet};
        result.fields=result.fields.map(field=>({...field,sourceCell:'B'+number,targetCell:'C'+number}));return result;
    };
    const cSin=row('RenlyP1_Intro_C_Sin',7),a=row('RenlyP1_Intro_A1',8),gender=row('RenlyP1_Intro_A1',9,'Gender translation','gender'),
        missing=row('RenlyP1_Intro_B1',10,''),c=row('RenlyP1_Intro_C',11),unassigned=row('Nameless_Story_A1',12),
        una=row('Una_Greeting_A1',16),bye=row('RenlyP1_Farewell_A1',20);
    const family=(key,parentKey,units)=>({key,stem:key,anchor:key.split('_')[0],label:parentKey==='unassigned'?key:key.slice(key.indexOf('_')+1),parentKey,units});
    const intro=family('RenlyP1_Intro','renly',[cSin,a,gender,missing,c]),farewell=family('RenlyP1_Farewell','renly',[bye]),
        unknown=family('Nameless_Story','unassigned',[unassigned]),greeting=family('Una_Greeting','una',[una]);
    const parents=[{key:'unassigned',label:'Unassigned',paths:[],npcUnits:[],families:[unknown],units:[unassigned]},
        {...h.index.groups[0],families:[farewell,intro],units:[cSin,a,gender,missing,c,bye]},
        {...h.index.groups[1],families:[greeting],units:[una]}],families=[unknown,farewell,intro,greeting],units=[cSin,a,gender,missing,c,unassigned,una,bye],memberships=new Map();
    for(const family of families)for(const unit of family.units)memberships.set(unit.id,{parentKey:family.parentKey,familyKey:family.key,anchor:family.anchor,
        turn:unit.recordId.slice(family.stem.length+1),aliases:family.parentKey==='unassigned'?[]:[family.parentKey==='renly'?'Renly':'Una'],aliasType:'name',ambiguous:false});
    const convoIndex={parents,parentByKey:new Map(parents.map(parent=>[parent.key,parent])),families,familyByKey:new Map(families.map(family=>[family.key,family])),memberships,units};
    h.app.ctUnits=[...h.app.ctUnits,...units];h.app._ctUnitIndex=new Map(h.app.ctUnits.map(unit=>[unit.id,unit]));h.app._ctConvoIndex=convoIndex;
    Object.assign(h.app,{ctSelection:a.id,ctValues:S.valuesFor(a)},changes);
    return {...h,convoIndex,cSin,a,gender,missing,c,unassigned,una,bye,intro,farewell,unknown,greeting};
}

test('Convo uses only its original conversation records, shared row order, all-status context and existing filters',async()=>{
    const {app,convoIndex,cSin,a,gender,missing,c,intro}=convoUiHarness({ctSheet:JSON.stringify(['normal','NPCs']),ctSelectedFilters:['saved']}),
        before=clone(app.ctUnits),counts=clone(app.ctCounts);
    assert.equal(await app.ctSetBrowseMode('convo'),true);assert.equal(app.ctSort,'row');assert.equal(app.ctSortDir,'asc');assert.ok(app.ctSelectedFilters.includes('unchanged'));
    assert.equal(app.ctConvoBrowseTitle,'All conversations');assert.equal(app.ctConvoTotal,convoIndex.units.length);
    assert.deepEqual(Array.from(app.ctRows,unit=>unit.id),convoIndex.units.map(unit=>unit.id),'the inactive sheet filter cannot constrain Convo');
    assert.equal(await app.ctSetConvo('family',intro.key),true);assert.equal(app.ctConvoTotal,5);assert.equal(app.ctConvoBrowseTitle,'Renly / Intro (RenlyP1)');
    assert.deepEqual(Array.from(app.ctRows),[cSin,a,gender,missing,c]);assert.equal(app.ctRows[0],cSin,'worksheet rows place C_Sin before C');
    assert.equal(a.recordId,gender.recordId);assert.notEqual(a.id,gender.id);assert.equal(app.ctRows[2],gender);
    app.ctSelectedFilters=['missing'];assert.deepEqual(Array.from(app.ctRows),[missing]);app.ctSearch='No match';app.ctApplySearch();assert.equal(app.ctRows.length,0);
    app.ctResetFilters();assert.ok(app.ctSelectedFilters.includes('unchanged'));assert.equal(app.ctRows.length,5);
    assert.deepEqual(clone(app.ctCounts),counts);assert.deepEqual(app.ctUnits,before);
    assert.equal(app.ctConvoRelation(a).label,'ID match');assert.match(app.ctConvoRelation(a).tooltip,/RenlyP1/);assert.match(app.ctConvoRelation(a).tooltip,/Matched NPC aliases: Renly/);
    assert.match(app.ctConvoRelation(a).tooltip,/does not identify the speaker or conversation order/);assert.equal(app.ctConvoRelation(app.other).label,'');
});

test('Convo tree search temporarily reveals matching children and preserves stored expansion and selection',async()=>{
    const {app,intro,farewell,unknown,names,unassigned}=convoUiHarness();await app.ctSetBrowseMode('convo');
    assert.deepEqual(Array.from(app.ctConvoTree,row=>row.type),['parent','parent','parent']);
    app.ctConvoToggle('renly');const expanded=app.ctConvoExpanded.slice();assert.equal(app.ctConvoTree.filter(row=>row.type==='family').length,2);
    await app.ctSetConvo('family',intro.key);app.ctConvoFilter='Intro';
    assert.deepEqual(Array.from(app.ctConvoTree,row=>[row.type,row.node.key]),[['parent','renly'],['family',intro.key]]);assert.equal(app.ctConvoToggle('renly'),false);
    app.ctConvoFilter='Renly';assert.deepEqual(Array.from(app.ctConvoTree.filter(row=>row.type==='family'),row=>row.node.key),[farewell.key,intro.key]);
    app.ctSaved={[names.id]:{values:{[fieldId]:'เรนลี'},reviewed:{},revision:1}};app.ctRevision++;app.ctConvoFilter='เรน';assert.equal(app.ctConvoTree.length,3);
    app.ctConvoFilter='Nameless_Story_A1';assert.deepEqual(Array.from(app.ctConvoTree,row=>row.node.key),['unassigned',unknown.key]);
    assert.equal(app.ctConvoRelation(unassigned).label,'ID family');assert.equal(app.ctConvoSelection,app.ctConvoNodeKey('family',intro.key));
    app.ctConvoFilter='';assert.deepEqual(Array.from(app.ctConvoExpanded),Array.from(expanded));assert.equal(app.ctConvoTree.filter(row=>row.type==='family').length,2);
    app.ctConvoToggle('renly');assert.equal(app.ctConvoTree.filter(row=>row.type==='family').length,0);assert.equal(app.ctConvoTree.filter(row=>row.focused).length,1);
    assert.equal(app.ctConvoSelection,app.ctConvoNodeKey('family',intro.key),'collapsing an NPC retains its selected family and current editor');
    app._ctConvoIndex={...app._ctConvoIndex,units:[]};app.ctRevision++;assert.equal(app.ctConvoTree.length,0);
});

test('Convo tree arrows, expansion and typeahead move focus separately from checkpointed activation',async()=>{
    const {app,intro,farewell}=convoUiHarness();await app.ctSetBrowseMode('convo');const focuses=[];let checkpoints=0;
    app.ctFlushDraft=async()=>{checkpoints++;return true;};app.ctConvoFocus=row=>{app.ctConvoFocusKey=row.key;focuses.push(row.key);return true;};
    const key=(value,targetKey=app.ctConvoFocusKey)=>({...rowEvent(value),target:{closest:selector=>selector==='[data-convo-key]'?{dataset:{convoKey:targetKey}}:null}});
    app.ctConvoFocusKey=app.ctConvoNodeKey('parent','renly');assert.equal(app.ctConvoTreeKeydown(key('ArrowRight')),true);assert.deepEqual(Array.from(app.ctConvoExpanded),['renly']);
    assert.equal(app.ctConvoTreeKeydown(key('ArrowRight')),true);assert.equal(app.ctConvoFocusKey,app.ctConvoNodeKey('family',farewell.key));
    app.ctConvoTreeKeydown(key('ArrowDown'));assert.equal(app.ctConvoFocusKey,app.ctConvoNodeKey('family',intro.key));assert.equal(checkpoints,0);assert.equal(app.ctConvoSelection,'all');
    await app.ctConvoTreeKeydown(key('Enter'));assert.equal(checkpoints,1);assert.equal(app.ctConvoSelection,app.ctConvoNodeKey('family',intro.key));
    app.ctConvoTreeKeydown(key('ArrowLeft'));assert.equal(app.ctConvoFocusKey,app.ctConvoNodeKey('parent','renly'));
    app.ctConvoTreeKeydown(key('ArrowLeft'));assert.equal(app.ctConvoExpanded.length,0);app.ctConvoTreeKeydown(key('Home'));assert.equal(app.ctConvoFocusKey,app.ctConvoNodeKey('parent','unassigned'));
    app.ctConvoTreeKeydown(key('u'));assert.equal(app.ctConvoFocusKey,app.ctConvoNodeKey('parent','una'));app.ctConvoTreeKeydown(key('End'));assert.equal(app.ctConvoFocusKey,app.ctConvoNodeKey('parent','una'));
    await app.ctConvoTreeKeydown(key(' '));assert.equal(app.ctConvoSelection,app.ctConvoNodeKey('parent','una'));assert.equal(checkpoints,2);
    assert.ok(focuses.length>4);
});

test('Convo chevrons focus their parent and retain selected children without checkpointing or stealing hidden-view focus',async()=>{
    const {app,intro}=convoUiHarness();await app.ctSetBrowseMode('convo');app.ctConvoToggle('renly');await app.ctSetConvo('family',intro.key);
    const focused=[];let checkpoints=0;app.ctFlushDraft=async()=>{checkpoints++;return true;};
    app.$refs.ctConvoTree={querySelectorAll:()=>app.ctConvoTree.map(row=>({dataset:{convoKey:row.key},focus(){focused.push(row.key);}}))};
    const child=app.ctConvoTree.find(row=>row.node.key===intro.key);assert.equal(app.ctConvoFocus(child),true);
    assert.equal(app.ctConvoToggle('renly'),true);assert.equal(focused.at(-1),app.ctConvoNodeKey('parent','renly'));assert.equal(app.ctConvoExpanded.length,0);
    assert.equal(app.ctConvoSelection,child.key);assert.equal(checkpoints,0);
    const native={...rowEvent('Enter'),target:{closest:selector=>selector==='button'?{}:{dataset:{convoKey:app.ctConvoNodeKey('parent','renly')}}}};
    assert.equal(app.ctConvoTreeKeydown(native),false);assert.equal(native.defaultPrevented,undefined,'native chevron activation is retained');
    app.ctBrowseMode='npcs';const count=focused.length;app.ctConvoToggle('renly');assert.equal(focused.length,count);
});

test('three browse modes restore independent Convo state, query, filters, sorting, page and scroll',async()=>{
    const {app,intro}=convoUiHarness({ctSheet:'sheet',ctSearch:'sheet text',ctAppliedSearch:'sheet text',ctSelectedFilters:['saved'],ctPage:2}),
        region={scrollTop:0,scrollLeft:19,clientHeight:100,scrollHeight:100};app.$refs.ctFileTableRegion=region;
    await app.ctSetBrowseMode('npcs');await app.ctSetNpc('renly');app.ctSearch='npc text';app.ctAppliedSearch='npc text';
    await app.ctSetBrowseMode('convo');await app.ctSetConvo('family',intro.key);app.ctConvoToggle('renly');
    Object.assign(app,{ctConvoFilter:'Intro',ctConvoFocusKey:app.ctConvoNodeKey('family',intro.key),ctSearch:'convo text',ctAppliedSearch:'convo text',ctSelectedFilters:['missing'],ctSort:'filename',ctSortDir:'desc',ctPage:3});region.scrollLeft=72;
    await app.ctSetBrowseMode('sheets');assert.equal(app.ctSheet,'sheet');assert.equal(app.ctSearch,'sheet text');assert.deepEqual(Array.from(app.ctSelectedFilters),['saved']);assert.equal(region.scrollLeft,19);
    await app.ctSetBrowseMode('npcs');assert.equal(app.ctSearch,'npc text');assert.equal(app.ctNpcSelection,'renly');
    await app.ctSetBrowseMode('convo');assert.equal(app.ctConvoSelection,app.ctConvoNodeKey('family',intro.key));assert.deepEqual(Array.from(app.ctConvoExpanded),['renly']);assert.equal(app.ctConvoFilter,'Intro');
    assert.equal(app.ctSearch,'convo text');assert.deepEqual(Array.from(app.ctSelectedFilters),['missing']);assert.equal(app.ctSort,'filename');assert.equal(app.ctSortDir,'desc');assert.equal(app.ctPage,3);assert.equal(region.scrollLeft,72);
    await app.ctShowAllLoaded();assert.equal(app.ctBrowseMode,'sheets');assert.equal(app.ctRows.length,app.ctUnits.length);
    app.ctFence();assert.equal(app._ctConvoIndex,null);assert.equal(app.ctConvoSelection,'all');assert.equal(app.ctConvoExpanded.length,0);assert.equal(app.ctConvoFocusKey,'');
});

test('all three navigation lists restore independent offsets after hidden panels clamp their scroll',async()=>{
    const {app}=convoUiHarness(),sheets={scrollTop:129,scrollLeft:5},npcs={scrollTop:0,scrollLeft:0},convo={scrollTop:0,scrollLeft:0},table={scrollTop:0,scrollLeft:0,clientHeight:100,scrollHeight:100};
    Object.assign(app.$refs,{ctSheetList:sheets,ctNpcList:npcs,ctConvoList:convo,ctFileTableRegion:table});
    // Simulate hidden panels losing overflow as another view's snapshot
    // restores its own filter and expansion fields.
    app.$nextTick=async()=>{for(const [mode,list] of [['sheets',sheets],['npcs',npcs],['convo',convo]])if(mode!==app.ctBrowseMode){list.scrollTop=0;list.scrollLeft=0;}};
    await app.ctSetBrowseMode('npcs');npcs.scrollTop=321;npcs.scrollLeft=2;
    await app.ctSetBrowseMode('convo');convo.scrollTop=777;convo.scrollLeft=8;
    await app.ctSetBrowseMode('sheets');assert.deepEqual([sheets.scrollTop,sheets.scrollLeft],[129,5]);assert.equal(convo.scrollTop,0);
    await app.ctSetBrowseMode('npcs');assert.deepEqual([npcs.scrollTop,npcs.scrollLeft],[321,2]);
    await app.ctSetBrowseMode('convo');assert.deepEqual([convo.scrollTop,convo.scrollLeft],[777,8]);assert.deepEqual([table.scrollTop,table.scrollLeft],[0,0]);
    assert.deepEqual(clone(app._ctBrowseViews.convo.scroll.navigation),{top:777,left:8});
});

test('Convo selection failures and delayed focus or navigation cannot alter a replacement family or scope',async()=>{
    const {app,intro,farewell,a,missing}=convoUiHarness({ctDraftDirty:true}),values=app.ctValues;await app.ctSetBrowseMode('convo');await app.ctSetConvo('family',intro.key);
    app.ctFlushDraft=async()=>false;assert.equal(await app.ctSetConvo('family',farewell.key),false);assert.equal(app.ctConvoSelection,app.ctConvoNodeKey('family',intro.key));assert.equal(app.ctValues,values);
    app.ctFlushDraft=async()=>true;app.ctEditor=true;app.ctSelectedFilters=['missing'];app.ctValues[fieldId]='Correction';app.ctSave=async()=>true;
    const selections=[];app.ctSelect=async unit=>{selections.push(unit.id);app.ctSelection=unit.id;return true;};
    assert.equal(await app.ctSaveAndNavigate(),true);assert.deepEqual(selections,[missing.id],'the filtered anchor navigates only within the selected family');
    app.ctSelection=a.id;const pending=deferred();app.ctSave=()=>pending.promise;const moving=app.ctSaveAndNavigate();await settle();await app.ctSetConvo('family',farewell.key);pending.resolve(true);
    assert.equal(await moving,false);assert.equal(app.ctSelection,a.id);assert.equal(selections.length,1);
    app.ctEditor=false;const callbacks=[];app.$nextTick=callback=>{if(callback)callbacks.push(callback);};app.$refs.ctConvoTree={querySelectorAll:()=>[]};
    const row={key:app.ctConvoNodeKey('parent','renly')};app.ctConvoFocus(row);let focus=0;
    app.$refs.ctConvoTree={querySelectorAll:()=>[{dataset:{convoKey:row.key},focus(){focus++;}}]};app.ctWorkspace={scope:{...scope,groupId:'new-convo-scope'}};
    callbacks.forEach(callback=>callback());assert.equal(focus,0);assert.equal(app.ctValues[fieldId],'Correction');
});

test('Convo parent and child severities include all committed members and never ordinary NPC name or audio rows',async()=>{
    const {app,intro,farewell,a,missing,names,dialogue,bye}=convoUiHarness();await app.ctSetBrowseMode('convo');await app.ctSetConvo('family',farewell.key);
    const before=clone(app.ctUnits),parent=app.ctConvoNodeKey('parent','renly'),child=app.ctConvoNodeKey('family',intro.key),other=app.ctConvoNodeKey('family',farewell.key);
    app.ctSearch='Hidden';app.ctApplySearch();app.ctSelectedFilters=['unchanged'];assert.equal(app.ctConvoSeverities.get(parent),'error');assert.equal(app.ctConvoSeverities.get(child),'error');assert.equal(app.ctConvoSeverities.get(other),'');
    app.ctSaved={[missing.id]:{values:{[fieldId]:'Complete reply'},reviewed:{},revision:1}};app.ctRevision++;
    app.ctDiagnostics={[a.id]:[{severity:'warning'}],[bye.id]:[{severity:'error'}],[names.id]:[{severity:'error'}],[dialogue.id]:[{severity:'error'}]};
    assert.equal(app.ctConvoSeverities.get(child),'warning');assert.equal(app.ctConvoSeverities.get(other),'error');assert.equal(app.ctConvoSeverities.get(parent),'error');
    app.ctDiagnostics={[names.id]:[{severity:'error'}],[dialogue.id]:[{severity:'error'}]};assert.equal(app.ctConvoSeverities.get(parent),'');
    assert.equal(app.ctNpcSeverities.get('renly'),'error','ordinary NPC severity remains independently derived');assert.deepEqual(app.ctUnits,before);
});

test('NPC sidebar severity uses red before yellow and clears only after its committed work or findings resolve',()=>{
    const {app,topic,dialogue,reply,gender,una}=npcUiHarness();topic.fields[0].outdated=true;
    const before=clone(app.ctUnits);app.ctDiagnostics={[dialogue.id]:[{severity:'warning'}],[gender.id]:[{severity:'error'}],[una.id]:[{severity:'warning'}]};
    assert.equal(app.ctNpcSeverities.get('renly'),'error');assert.equal(app.ctNpcSeverities.get('una'),'warning');
    app.ctSaved={[reply.id]:{values:{[fieldId]:'Completed reply'},reviewed:{},revision:1}};app.ctRevision++;
    assert.equal(app.ctStatus(reply).missing,false);assert.equal(app.ctNpcSeverities.get('renly'),'error','a retained error still outranks Outdated and Warning');
    app.ctDiagnostics={[dialogue.id]:[{severity:'warning'}],[una.id]:[{severity:'warning'}]};
    assert.equal(app.ctNpcSeverities.get('renly'),'warning');
    app.ctSaved={...app.ctSaved,[topic.id]:{values:S.valuesFor(topic),reviewed:{[fieldId]:S.sourceHash(topic.fields[0].source)},revision:1}};app.ctRevision++;
    assert.equal(app.ctStatus(topic).outdated,false);assert.equal(app.ctNpcSeverities.get('renly'),'warning','a retained warning survives an unrelated save or reviewed field');
    app.ctDiagnostics={[una.id]:[{severity:'warning'}]};assert.equal(app.ctNpcSeverities.get('renly'),'');assert.equal(app.ctNpcSeverities.get('una'),'warning');
    app.ctSaved={...app.ctSaved,[dialogue.id]:{values:{[fieldId]:'A saved correction'},reviewed:{},revision:1}};app.ctRevision++;
    assert.equal(app.ctStatus(reply).saved,true);assert.equal(app.ctStatus(dialogue).revised,true);assert.equal(app.ctNpcSeverities.get('renly'),'','Saved and Revised are neutral');
    app.ctDiagnostics={};assert.equal(app.ctNpcSeverities.get('una'),'');assert.deepEqual(app.ctUnits,before);
});

test('NPC sidebar severity includes related records hidden by every browsing filter and excludes draft-only changes',()=>{
    const {app,dialogue,reply}=npcUiHarness({ctBrowseMode:'npcs',ctNpcSelection:'renly',ctNpcKind:'names',ctNpcFilter:'No matching NPC',
        ctSearch:'No matching text',ctAppliedSearch:'No matching text',ctSelectedFilters:['unchanged']});
    const before=clone(app.ctUnits);assert.equal(app.ctRows.length,0);assert.equal(app.ctNpcFilteredGroups.length,0);
    assert.equal(app.ctNpcSeverities.get('renly'),'error','hidden missing conversation text still colors the NPC');
    app.ctSelection=reply.id;app.ctValues={[fieldId]:'Unsaved complete reply'};app.ctDraftDirty=true;
    assert.equal(app.ctNpcSeverities.get('renly'),'error','an unsaved completion does not resolve committed Missing');
    app.ctSaved={[reply.id]:{values:{[fieldId]:'Committed complete reply'},reviewed:{},revision:1}};app.ctRevision++;
    assert.equal(app.ctNpcSeverities.get('renly'),'');app.ctSelection=dialogue.id;app.ctValues={[fieldId]:''};
    assert.equal(app.ctNpcSeverities.get('renly'),'','a blank draft does not manufacture committed Missing');
    app.ctDiagnostics={[dialogue.id]:[{severity:'error'}]};assert.equal(app.ctNpcSeverities.get('renly'),'error','hidden scan errors also contribute');
    assert.deepEqual(app.ctUnits,before);
});

test('NPC sidebar severity preserves full cross-sheet identities and contributes shared records to every related group',()=>{
    const {app,index,topic,dialogue,reply,gender}=npcUiHarness();
    app.ctSaved={[reply.id]:{values:{[fieldId]:'Complete'},reviewed:{},revision:1}};
    index.groups[0].units=index.groups[0].units.filter(unit=>unit!==gender);index.groups[1].units.push(gender);
    index.memberships.set(gender.id,new Map([['una',{kind:'dialogue',aliases:['Una']}]]));
    const before=clone(app.ctUnits);assert.equal(dialogue.recordId,gender.recordId);assert.notEqual(dialogue.id,gender.id);
    app.ctDiagnostics={[dialogue.id]:[{severity:'error'}]};assert.equal(app.ctNpcSeverities.get('renly'),'error');assert.equal(app.ctNpcSeverities.get('una'),'');
    app.ctDiagnostics={[gender.id]:[{severity:'warning'}]};assert.equal(app.ctNpcSeverities.get('renly'),'');assert.equal(app.ctNpcSeverities.get('una'),'warning');
    index.groups[1].units.push(topic);index.memberships.get(topic.id).set('una',{kind:'topics',aliases:[]});app.ctRevision++;
    app.ctDiagnostics={[topic.id]:[{severity:'error'}]};assert.equal(app.ctNpcSeverities.get('renly'),'error');assert.equal(app.ctNpcSeverities.get('una'),'error');
    app.ctDiagnostics={[topic.id]:[{severity:'warning'}]};assert.equal(app.ctNpcSeverities.get('renly'),'warning');assert.equal(app.ctNpcSeverities.get('una'),'warning');
    assert.deepEqual(app.ctUnits,before);
});

test('NPC sidebar severity is discarded with its scoped index before another workspace reuses record IDs',()=>{
    const {app,dialogue}=npcUiHarness();app.ctDiagnostics={[dialogue.id]:[{severity:'error'}]};assert.equal(app.ctNpcSeverities.get('renly'),'error');
    app.ctFence();assert.equal(app.ctNpcSeverities.size,0);
    const replacement={...dialogue,fields:dialogue.fields.map(field=>({...field,target:'',originalMissing:true}))},group={key:'new-npc',label:'New NPC',paths:[],npcUnits:[],units:[replacement]};
    app.ctWorkspace={scope:{...scope,accountId:'other-account',game:'poe1',groupId:'other-group',language:'German'}};app.ctActive=true;
    app.ctUnits=[replacement];app._ctUnitIndex=new Map([[replacement.id,replacement]]);app._ctNpcIndex={groups:[group],groupByKey:new Map([[group.key,group]]),
        units:[replacement],unassigned:[],memberships:new Map([[replacement.id,new Map([[group.key,{kind:'dialogue',aliases:[]}]])]])};app.ctRevision++;
    assert.equal(app.ctNpcSeverities.has('renly'),false);assert.equal(app.ctNpcSeverities.get('new-npc'),'error');assert.equal(Object.keys(app.ctDiagnostics).length,0);
    assert.equal(Object.keys(app.ctSaved).length,0);
});

test('NPC browse preserves full record identity, all-status context, classifications and workspace counts',async()=>{
    const {app,index,names,topic,dialogue,reply,gender,una,unassigned,other}=npcUiHarness(),before=clone(app.ctUnits),counts=clone(app.ctCounts);
    app.ctSelectedFilters=['missing'];assert.equal(await app.ctSetBrowseMode('npcs'),true);
    assert.ok(app.ctSelectedFilters.includes('unchanged'));assert.equal(app.ctNpcTotal,7);assert.equal(app.ctNpcBrowseTitle,'All NPC text');
    assert.deepEqual(Array.from(app.ctRows,unit=>unit.id),index.units.map(unit=>unit.id));assert.equal(app.ctRows.includes(other),false);
    assert.equal(await app.ctSetNpc('renly'),true);assert.equal(app.ctNpcTotal,5);assert.equal(app.ctNpcBrowseTitle,'Renly');
    assert.deepEqual(Array.from(app.ctNpcKindOptions,option=>[option.key,option.count]),[['',5],['names',1],['topics',1],['dialogue',2],['conversations',1]]);
    assert.equal(app.ctRows.find(unit=>unit.id===gender.id),gender);assert.equal(app.ctRows.find(unit=>unit.id===dialogue.id),dialogue);
    assert.equal(dialogue.recordId,reply.recordId);assert.notEqual(dialogue.id,reply.id);assert.notEqual(dialogue.id,gender.id);
    app.ctSelectedFilters=['missing'];assert.deepEqual(Array.from(app.ctRows),[reply]);
    app.ctSelectedFilters=['unchanged','missing'];app.ctSearch='RenlyIntro';app.ctApplySearch();assert.equal(app.ctRows.length,3);
    assert.equal(await app.ctSetNpcKind('conversations'),true);assert.deepEqual(Array.from(app.ctRows),[reply]);
    assert.equal(app.ctNpcTotal,5,'category/search/status filters do not change the total context count');
    assert.equal(app.ctSortValue(reply,'row'),5);assert.deepEqual(clone(app.ctCounts),counts);assert.deepEqual(app.ctUnits,before);
    assert.equal(app.ctNpcRelation(names).label,'Exact link');assert.equal(app.ctNpcRelation(topic).label,'Exact link');
    assert.equal(app.ctNpcRelation(dialogue).label,'ID match');assert.match(app.ctNpcRelation(reply).tooltip,/does not identify the speaker or conversation order/);
    app.ctNpcFilter='  meTADATA/npc/uNA  ';assert.deepEqual(Array.from(app.ctNpcFilteredGroups),[index.groups[1]]);
    assert.equal(await app.ctSetNpc('unassigned'),true);assert.equal(app.ctNpcBrowseTitle,'Unassigned dialogue');
    assert.equal(await app.ctSetNpcKind(''),true);app.ctSearch='';app.ctApplySearch();assert.deepEqual(Array.from(app.ctRows),[unassigned]);
    assert.equal(app.ctNpcRelation(unassigned).label,'Unassigned');assert.equal(app.ctNpcKindLabel(una),'Dialogue');
    assert.ok(app.ctNpcGroupTooltip(index.groups[0]).includes('Metadata/NPC/Renly'));
});

test('Sheets and NPCs restore independent session queries, filters, sorting, pages and selected context',async()=>{
    const {app,dialogue}=npcUiHarness({ctSheet:'sheet-selection',ctSheetFilter:'sheet query',ctSearch:'sheet text',ctAppliedSearch:'sheet text',
        ctFilter:'saved',ctSelectedFilters:['saved'],ctSort:'filename',ctSortDir:'desc',ctPage:3,ctTool:'history',ctHistory:[{key:'retained'}],ctDraftDirty:true}),
        values=app.ctValues,selection=app.ctSelection;
    assert.equal(await app.ctSetBrowseMode('npcs'),true);assert.equal(app.ctSearch,'');assert.equal(app.ctPage,1);assert.equal(app.ctSort,'row');
    assert.equal(await app.ctSetNpc('renly'),true);assert.equal(await app.ctSetNpcKind('dialogue'),true);
    Object.assign(app,{ctNpcFilter:'Ren',ctSearch:'npc text',ctAppliedSearch:'npc text',ctFilter:'',ctSelectedFilters:['unchanged'],ctSort:'english',ctSortDir:'asc',ctPage:2});
    assert.equal(await app.ctSetBrowseMode('sheets'),true);
    assert.equal(app.ctSheet,'sheet-selection');assert.equal(app.ctSheetFilter,'sheet query');assert.equal(app.ctSearch,'sheet text');assert.equal(app.ctFilter,'saved');
    assert.deepEqual(Array.from(app.ctSelectedFilters),['saved']);assert.equal(app.ctSort,'filename');assert.equal(app.ctSortDir,'desc');assert.equal(app.ctPage,3);
    assert.equal(await app.ctSetBrowseMode('npcs'),true);assert.equal(app.ctNpcSelection,'renly');assert.equal(app.ctNpcKind,'dialogue');assert.equal(app.ctNpcFilter,'Ren');
    assert.equal(app.ctSearch,'npc text');assert.equal(app.ctSort,'english');assert.equal(app.ctPage,2);
    assert.equal(app.ctSelection,selection);assert.equal(app.ctCurrentUnit,dialogue);assert.equal(app.ctValues,values);assert.equal(app.ctDraftDirty,true);
    assert.equal(app.ctTool,'history');assert.equal(app.ctHistory[0].key,'retained');
    assert.equal(await app.ctShowAllLoaded(),true);assert.equal(app.ctBrowseMode,'sheets');assert.equal(app.ctSheet,'');assert.equal(app.ctSearch,'');
    assert.equal(app.ctRows.length,app.ctUnits.length);assert.equal(await app.ctSetBrowseMode('npcs'),true);assert.equal(app.ctNpcSelection,'renly');
    app.ctFence();assert.equal(app.ctBrowseMode,'sheets');assert.equal(app._ctNpcIndex,null);assert.equal(app._ctBrowseViews,null);assert.equal(app.ctNpcFilter,'');
});

test('Sheets and NPCs restore independent table and page scrolling without copying auxiliary keys into state',async()=>{
    const {app,window}=npcUiHarness(),region={scrollTop:0,scrollLeft:37,clientHeight:100,scrollHeight:100},scrolls=[];
    app.$refs.ctFileTableRegion=region;window.scrollX=0;window.scrollY=240;
    window.scrollTo=(left,top)=>{window.scrollX=left;window.scrollY=top;scrolls.push([left,top]);};
    assert.equal(await app.ctSetBrowseMode('npcs'),true);assert.deepEqual([region.scrollTop,region.scrollLeft,window.scrollY],[0,0,0]);
    region.scrollLeft=81;window.scrollY=430;app.ctPage=2;
    assert.equal(await app.ctSetBrowseMode('sheets'),true);assert.deepEqual([region.scrollTop,region.scrollLeft,window.scrollY],[0,37,240]);
    assert.equal(await app.ctSetBrowseMode('npcs'),true);assert.deepEqual([region.scrollTop,region.scrollLeft,window.scrollY],[0,81,430]);assert.equal(app.ctPage,2);
    assert.equal(Object.hasOwn(app,'state'),false);assert.equal(Object.hasOwn(app,'scroll'),false);
    assert.deepEqual(clone(app._ctBrowseViews.sheets.scroll),{top:0,left:37,windowTop:240});
    const count=scrolls.length;assert.equal(await app.ctSetNpc('renly'),true);assert.equal(await app.ctSetNpcKind('dialogue'),true);
    assert.deepEqual([region.scrollLeft,window.scrollY],[81,430]);assert.equal(scrolls.length,count,'NPC/category choices do not restore an unrelated view scroll');
    region.scrollHeight=300;region.scrollTop=64;const snapshot=app.ctCaptureBrowseScroll();
    assert.deepEqual(clone(snapshot),{top:64,left:81},'a vertically scrolling table does not capture window scroll');
    await app.ctSetBrowseMode('sheets');region.scrollTop=12;window.scrollY=19;
    await app.ctSetBrowseMode('npcs');assert.equal(region.scrollTop,64);assert.equal(region.scrollLeft,81);assert.equal(window.scrollY,19);
});

test('late browse rendering cannot restore table or page scroll into a replacement scope or behind an overlay',async()=>{
    for(const changed of ['scope','overlay','generation']) {
        const {app,window}=npcUiHarness(),gate=deferred(),started=deferred(),region={scrollTop:8,scrollLeft:15,clientHeight:100,scrollHeight:100},scrolls=[];
        app.$refs.ctFileTableRegion=region;app.$refs.ctSheetList={scrollTop:60,scrollLeft:3};app.$refs.ctNpcList={scrollTop:77,scrollLeft:9};window.scrollY=120;window.scrollTo=(...args)=>scrolls.push(args);
        app.$nextTick=()=>{started.resolve();return gate.promise;};
        const switching=app.ctSetBrowseMode('npcs');await started.promise;
        const replacement={scrollTop:23,scrollLeft:42,clientHeight:100,scrollHeight:100};app.$refs.ctFileTableRegion=replacement;
        if(changed==='scope')app.ctWorkspace={scope:{...scope,groupId:'replacement-scope'}};
        if(changed==='overlay')app.settingsDialogVisible=true;
        if(changed==='generation')app._ctBrowseGeneration++;
        gate.resolve();assert.equal(await switching,false,changed);assert.deepEqual([replacement.scrollTop,replacement.scrollLeft],[23,42]);
        assert.deepEqual([app.$refs.ctNpcList.scrollTop,app.$refs.ctNpcList.scrollLeft],[77,9]);
        assert.deepEqual(scrolls,[]);assert.equal(app.ctBrowseBusy,false);
    }
});

test('browse checkpoint failures, duplicate clicks, overlays and scope changes preserve the previous view and draft',async()=>{
    for(const failure of ['draft','comment','comment-result','scope','overlay']) {
        const {app}=npcUiHarness({ctDraftDirty:true}),values=app.ctValues,gate=deferred();
        app.ctFlushDraft=failure==='draft'?async()=>false:failure.startsWith('comment')?async()=>true:()=>gate.promise;
        if(failure==='comment')app.ctFlushCommentDraft=async()=>{throw new Error('checkpoint failed');};
        if(failure==='comment-result')app.ctFlushCommentDraft=async()=>false;
        const changing=app.ctSetBrowseMode('npcs');
        assert.equal(await app.ctSetBrowseMode('npcs'),false,'duplicate transitions are blocked');
        if(failure==='scope')app.ctWorkspace={scope:{...scope,groupId:'replacement'}};
        if(failure==='overlay')app.settingsDialogVisible=true;
        gate.resolve(true);assert.equal(await changing,false,failure);assert.equal(app.ctBrowseMode,'sheets');
        assert.equal(app.ctValues,values);assert.equal(app.ctDraftDirty,true);assert.equal(app.ctBrowseBusy,false);
    }
});

test('NPC navigation searches committed translated names and arrow keys focus tabs without activating them',async()=>{
    const {app,names,index}=npcUiHarness();app.ctSaved={[names.id]:{values:{[fieldId]:'เรนลี'},revision:1,reviewed:{}}};app.ctRevision++;
    app.ctNpcFilter='เรน';assert.deepEqual(Array.from(app.ctNpcFilteredGroups),[index.groups[0]]);
    app.ctValues={[fieldId]:'Only a draft name'};app.ctNpcFilter='Only a draft name';assert.equal(app.ctNpcFilteredGroups.length,0);
    const focused=[],tabs=[{id:'ctSheetsTab',focus(){focused.push(this.id);}},{id:'ctNpcsTab',focus(){focused.push(this.id);}}];
    app.$refs.ctBrowseTabs={querySelectorAll(){return tabs;}};
    const event={...rowEvent('ArrowRight'),target:tabs[0]};assert.equal(app.ctBrowseTabKeydown(event),true);assert.equal(event.defaultPrevented,true);
    assert.deepEqual(focused,['ctNpcsTab']);assert.equal(app.ctBrowseMode,'sheets');assert.equal(app.ctBrowseBusy,false);
    assert.equal(await app.ctSetBrowseMode('npcs'),true);assert.equal(app.ctBrowseMode,'npcs');
});

test('opening a diagnostic or lookup record outside the selected NPC reports its actual relation',async()=>{
    const {app,una,unassigned}=npcUiHarness();await app.ctSetBrowseMode('npcs');await app.ctSetNpc('renly');
    app._ctStore={getDraft:async()=>null};app.ctLoadCommentDraft=()=>{};
    assert.equal(await app.ctSelect(una,true),true);assert.equal(app.ctNpcSelection,'renly');assert.equal(app.ctNpcBrowseTitle,'Renly');
    assert.equal(app.ctCurrentUnit,una);assert.equal(app.ctRows.includes(una),false);
    const relation=app.ctNpcRelation(una);assert.equal(relation.label,'ID match');assert.match(relation.tooltip,/Related to Una/);
    assert.doesNotMatch(relation.tooltip,/Related to Renly|Linked to\s+by/);assert.equal(app.ctNpcRelation(unassigned).label,'Unassigned');
});

test('list navigation enters the visible NPC rows at the proper edge when its retained selection is hidden',async()=>{
    for(const [key,expectedIndex] of [['ArrowDown',0],['ArrowUp',4],['Home',0],['End',4],['PageDown',2],['ArrowRight',2],['PageUp',0],['ArrowLeft',0]]){
        const {app,una,index}=npcUiHarness();await app.ctSetBrowseMode('npcs');await app.ctSetNpc('renly');
        app.ctSelection=una.id;app.ctValues=S.valuesFor(una);const visible=index.groups[0].units,calls=[];
        app.ctSelect=async(target,full,options)=>{assert.equal(full,false);assert.equal(options.focus,false);calls.push(target.id);app.ctSelection=target.id;return true;};
        app.ctFocusRow=id=>calls.push('focus:'+id);
        assert.equal(await app.ctRowKeydown(null,rowEvent(key)),true,key);assert.equal(app.ctSelection,visible[expectedIndex].id,key);
        assert.deepEqual(calls,[visible[expectedIndex].id,'focus:'+visible[expectedIndex].id]);assert.equal(app.ctPage,Math.floor(expectedIndex/2)+1);
    }
    const {app,una,index}=npcUiHarness();await app.ctSetBrowseMode('npcs');await app.ctSetNpc('renly');app.ctSelection=una.id;app.ctPage=3;
    app.ctSelect=async target=>{app.ctSelection=target.id;return true;};app.ctFocusRow=()=>{};
    assert.equal(await app.ctRowKeydown(null,rowEvent('PageUp')),true);assert.equal(app.ctSelection,index.groups[0].units[2].id,'page movement anchors to the current visible page');
});

test('queued pages and record navigation cannot complete in a replacement NPC browsing generation',async()=>{
    const {app,dialogue,reply}=npcUiHarness(),gate=deferred();let calls=0;
    app.ctFlushDraft=()=>++calls===1?gate.promise:Promise.resolve(true);
    const paging=app.ctSetPage(3);assert.equal(await app.ctSetBrowseMode('npcs'),true);gate.resolve(true);
    assert.equal(await paging,false);assert.equal(app.ctPage,1);
    await app.ctSetNpc('renly');app.ctEditor=true;app.ctSelectedFilters=['missing'];app.ctValues[fieldId]='Changed draft';
    const pending=deferred();app.ctSave=()=>pending.promise;let selections=0;app.ctSelect=async()=>{selections++;return true;};
    const navigating=app.ctSaveAndNavigate();await settle();assert.equal(await app.ctSetNpc('una'),true);pending.resolve(true);
    assert.equal(await navigating,false);assert.equal(selections,0);assert.equal(app.ctSelection,dialogue.id);assert.equal(app.ctValues[fieldId],'Changed draft');
    app.ctNpcSelection='renly';app.ctEditor=true;app.ctSave=async()=>true;
    app.ctSelect=async unit=>{app.ctSelection=unit.id;return true;};
    assert.equal(await app.ctSaveAndNavigate(),true);assert.equal(app.ctSelection,reply.id,'hidden active anchor stays inside the selected NPC candidate order');
});

test('a scoped save acknowledgement remains applied while obsolete browsing close and focus are suppressed',async()=>{
    const {app,dialogue}=npcUiHarness({ctEditor:true}),pending=deferred();let focus=0;
    app.ctValues[fieldId]='Accepted exact raw@text\\n';app.ctDraftDirty=true;
    app._ctStore={save:()=>pending.promise};app.ctSync=()=>{};app.ctLoadMemory=()=>{};app.ctRefreshDraftSummaries=()=>{};app.ctFocusRow=()=>focus++;
    const saving=app.ctSave(true);await settle();assert.equal(app.ctBusy,true);
    app._ctBrowseGeneration=(app._ctBrowseGeneration || 0)+1;app.ctBrowseMode='npcs';app.ctNpcSelection='una';
    const saved={values:{[fieldId]:'Accepted exact raw@text\\n'},reviewed:{},revision:1};pending.resolve({saved});
    assert.equal(await saving,true);assert.equal(app.ctSaved[dialogue.id],saved);assert.equal(app.ctDraftDirty,false);
    assert.equal(app.ctEditor,true);assert.equal(focus,0);assert.equal(app.ctSelection,dialogue.id);
});

test('ClientText exposes selected record reference metadata separately from developer notes',()=>{
    const {app,original}=harness(),raw='Metadata/Characters/Dex/DexFourb\r\n raw\\n ';
    original.metadata={Character:raw,'Character Class':'Metadata/Characters/Str/StrFourb',Tags:'Retained privately'};
    original.developerNotes='Actual note';const before=clone(original);
    assert.deepEqual(clone(app.ctReferenceMetadata()),[
        {name:'Character',value:raw,parts:[{text:raw}]},
        {name:'Character Class',value:original.metadata['Character Class'],parts:[{text:original.metadata['Character Class']}]},
        {name:'Tags',value:'Retained privately',parts:[{text:'Retained privately'}]}
    ]);
    assert.deepEqual(Array.from(app.ctNotes()),['Actual note']);assert.deepEqual(original,before);
    app.ctSelection='another record';assert.deepEqual(clone(app.ctReferenceMetadata()),[]);
});

test('context reference labels read a prepared scoped index without scanning originals during rendering',async()=>{
    const {app,original,window}=harness(),path='Metadata/Characters/Dex/DexFourb',
        character={...namedUnit(path),sheet:'Characters',recordId:path,fields:[{id:'Name',name:'Name',kind:'text',source:'Huntress',target:'Local translation',sourceCell:'B10'}]};
    original.metadata={Character:path};app.ctUnits=[original,character];const before=clone(original);
    const adapter=window.ContentAdapters.clienttext;
    assert.equal(app.ctReferenceMetadata()[0].display,undefined,'unprepared rendering retains the raw reference');
    await adapter.contextReferenceIndex(app.ctUnits);
    const first=app.ctReferenceMetadata();assert.equal(first[0].display,'Huntress');assert.ok(first[0].parts[0].tooltip.includes(path));assert.ok(first[0].parts[0].tooltip.includes('Characters!B10'));
    const cached=app._ctReferenceIndexCache;app.ctReferenceMetadata();assert.equal(app._ctReferenceIndexCache,cached);
    app.ctUnits=[original,{...character,fields:[{...character.fields[0],source:'Different original'}]}];
    await adapter.contextReferenceIndex(app.ctUnits);
    assert.equal(app.ctReferenceMetadata()[0].display,'Different original');assert.notEqual(app._ctReferenceIndexCache,cached);
    const newCache=app._ctReferenceIndexCache;app.ctWorkspace={...app.ctWorkspace};app.ctReferenceMetadata();assert.notEqual(app._ctReferenceIndexCache,newCache);
    app.ctUnits=[original];assert.deepEqual(clone(app.ctReferenceMetadata()),[{name:'Character',value:path,parts:[{text:path}]}]);assert.deepEqual(original,before);
    const calls=[],component={host:{showTooltip(event,text){calls.push([event,text]);},hideTooltip(){calls.push('hide');}}},event={clientX:4};
    window.ClientTextUI.contextComponent.methods.showTooltip.call(component,event,'Character details');window.ClientTextUI.contextComponent.methods.hideTooltip.call(component);
    assert.deepEqual(calls,[[event,'Character details'],'hide']);
    await adapter.contextReferenceIndex(app.ctUnits);
    let preparedReads=0;window.ContentAdapters={...window.ContentAdapters,clienttext:{...adapter,
        cachedContextReferenceIndex(units){preparedReads++;return adapter.cachedContextReferenceIndex(units);},
        contextReferenceIndex(){assert.fail('Render must not scan originals');}}};
    app._ctReferenceIndexCache=null;app.ctReferenceMetadata();app.ctReferenceMetadata();assert.equal(preparedReads,1);
});

test('context shares one component under identity and leaves fields and inline keyboard blocks separate',async()=>{
    const {app,window,original}=listHarness({inlineEditor:true}),context=window.ClientTextUI.contextComponent,
        html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
    assert.match(context.template,/class="ctReferenceContext"[^>]*:tabindex="rowBounded \? 0 : -1"/);
    assert.match(context.template,/@click\.stop @dblclick\.stop/);
    assert.match(context.template,/v-tooltip="part\.tooltip"/);assert.match(context.template,/\{\{ part\.text \}\}/);
    assert.doesNotMatch(context.template,/v-html|data-inline-block|data-ct-target/);
    assert.doesNotMatch(window.ClientTextUI.fieldsComponent.template,/ctReferenceMetadata|ctReferenceContext/);
    assert.match(window.ClientTextUI.fieldsComponent.template,/ctDeveloperNotes/);
    const identity=html.slice(html.indexOf('<td class="fileIdentityCell"><button class="fileOpenButton ctID"'),html.indexOf('<td data-label="English"',html.indexOf('<td class="fileIdentityCell"><button class="fileOpenButton ctID"')));
    assert.match(identity,/<small class="ctFilePath">.*<ct-context :host="\$root" :items="ctReferenceMetadata\(unit\)" compact row-bounded><\/ct-context>/);
    const full=html.slice(html.indexOf('<editor-full-shell v-if="ctEditor"'),html.indexOf('</editor-full-shell>',html.indexOf('<editor-full-shell v-if="ctEditor"')));
    assert.ok(full.indexOf('editorFileIdentity')<full.indexOf('<ct-context'));
    assert.ok(full.indexOf('<ct-context')<full.indexOf('ctEditorNavigation'));
    let selections=0;app.ctSelect=()=>{selections++;return true;};
    const target={closest(selector){return selector.includes('.ctReferenceContext')?{}:null;}};
    assert.equal(app.ctRowClick(original,{target}),false);assert.equal(app.ctRowDoubleClick(original,{target}),false);
    for(const key of ['Enter','ArrowDown','Home'])assert.equal(await app.ctRowKeydown(original,{key,target,preventDefault(){assert.fail('Context text keeps native selection keys');}}),false);
    app.$refs.ctFileTableRegion={contains:()=>true};assert.equal(app.ctInlineNavigationTarget(target),false);assert.equal(selections,0);
});

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
test('blank-first-field preview, Lookup and TM fall back to real English while hidden authored text stays intact',async()=>{
    const original=blankEnglishUnit(),reference=blankEnglishUnit('Reference'),{app,window}=visibleFieldsHarness(original,{ctUnits:[original,reference],
        _ctUnitIndex:new Map([[original.id,original],[reference.id,reference]]),ctFocusedField:original.fields[0].id});
    reference.fields[1].target='Reference translation';const seen=[];
    window.ContentAdapters={clienttext:{findMemory(memory,unit,field){seen.push(field);return[{target:'TM@literal\\n\ntranslation'}];}}};
    assert.equal(app.ctPreviewField,original.fields[1]);assert.equal(app.ctMemoryResults.length,1);assert.equal(seen[0],original.fields[1]);
    assert.deepEqual(Array.from(app.ctLookupResults,match=>match.name),['Text']);assert.equal(app.ctLookupResults[0].target,'Reference translation');
    app.ctEdited=field=>{assert.equal(field,original.fields[1]);app.ctDraftDirty=true;};await app.ctApplyMemory({target:'TM@literal\\n\ntranslation'});
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

test('TM replacement cancellation and late confirmation preserve changed draft, field and scope',async()=>{
    for(const change of ['cancel','draft','field','account','group','unit','selection','history']){
        const {app,original}=harness(),held=deferred(),match={id:'memory-id',target:'Raw TM@literal\\n\r\ntranslation'};
        const second={...original.fields[0],id:JSON.stringify(['Other',null]),name:'Other',target:'Other draft'};
        original.fields.push(second);app.ctValues= S.valuesFor(original);app.ctFocusedField=fieldId;app.ctMemoryResults=[match];
        const values=app.ctValues,baseline=clone(original);let edits=0,focus=0;
        app.appConfirm=()=>held.promise;app.ctEdited=()=>edits++;app.ctFocusTarget=()=>focus++;
        const applying=app.ctApplyMemory(match);await settle();
        if(change==='draft')app.ctValues[fieldId]='New typing';
        else if(change==='field')app.ctFocusedField=second.id;
        else if(change==='unit')app.ctSelection='replacement';
        else if(change==='selection')app._ctSelectRun={unitId:original.id};
        else if(change==='history')app.ctHistoryViewer=true;
        else if(['account','group'].includes(change))app.ctWorkspace={scope:{...scope,[change==='account'?'accountId':'groupId']:'replacement'}};
        held.resolve(change!=='cancel');assert.equal(await applying,false,change);
        assert.equal(app.ctValues,values);assert.equal(app.ctValues[fieldId],change==='draft'?'New typing':baseline.fields[0].target);
        assert.equal(app.ctValues[second.id],'Other draft');assert.equal(edits,0);assert.equal(focus,0);assert.deepEqual(original,baseline);
    }
});

test('TM confirmation rejects changed and removed background matches but accepts an equivalent refreshed match',async()=>{
    for(const change of ['mutated','removed','replaced','equivalent']){
        const {app,original}=harness(),held=deferred(),match={id:'memory-id',target:'Raw TM@literal\\n\r\ntranslation'};
        app.ctFocusedField=fieldId;app.ctMemoryResults=[match];app.appConfirm=()=>held.promise;let edits=0,focus=0;
        app.ctEdited=field=>{assert.equal(field,original.fields[0]);edits++;};app.ctFocusTarget=(full,id)=>{assert.equal(id,fieldId);focus++;};
        const applying=app.ctApplyMemory(match);await settle();
        if(change==='mutated')match.target='Changed after confirmation';
        else if(change==='removed')app.ctMemoryResults=[];
        else app.ctMemoryResults=[{...match,target:change==='replaced'?'Replacement target':match.target}];
        held.resolve(true);assert.equal(await applying,change==='equivalent',change);
        assert.equal(app.ctValues[fieldId],change==='equivalent'?'Raw TM@literal\\n\r\ntranslation':original.fields[0].target);
        assert.equal(edits,change==='equivalent'?1:0);assert.equal(focus,change==='equivalent'?1:0);
    }
});

test('TM refuses stale match IDs and modal or busy editor before requesting replacement confirmation',async()=>{
    for(const state of ['stale','history','busy']){
        const {app,original}=harness(),match={id:'memory-id',target:'TM translation'};
        app.ctMemoryResults=state==='stale'?[]:[match];app.ctHistoryViewer=state==='history';app.ctBusy=state==='busy';
        app.appConfirm=()=>assert.fail('Ineligible TM insertion cannot ask to replace a draft');app.ctEdited=()=>assert.fail('Ineligible TM insertion cannot mutate');
        assert.equal(await app.ctApplyMemory(match),false);assert.equal(app.ctValues[fieldId],original.fields[0].target);
    }
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

test('sheet filtering matches names without changing workbook identities, selection or record filters',()=>{
    const sheets=[{key:JSON.stringify(['normal','Shared']),role:'normal',name:'Shared'},
        {key:JSON.stringify(['gender','Shared']),role:'gender',name:'Shared'},
        {key:JSON.stringify(['normal','Quest Text']),role:'normal',name:'Quest Text'},
        {key:JSON.stringify(['gender','NPCDialogue']),role:'gender',name:'NPCDialogue'}],
        {app,mixin}=harness({_ctSheets:sheets,ctSheet:sheets[2].key,ctSearch:'retained record query',ctAppliedSearch:'retained record query',
            ctSelectedFilters:['missing','warning']});
    Object.defineProperty(app,'ctSheets',{get:()=>mixin.computed.ctSheets.call(app)});
    Object.defineProperty(app,'ctFilteredSheets',{get:()=>mixin.computed.ctFilteredSheets.call(app)});
    assert.equal(app.ctSheetFilter,'');assert.deepEqual(Array.from(app.ctFilteredSheets),sheets);
    app.ctSheetFilter='  sHaR  ';assert.deepEqual(Array.from(app.ctFilteredSheets),sheets.slice(0,2));
    assert.equal(app.ctFilteredSheets[0],sheets[0]);assert.equal(app.ctFilteredSheets[1],sheets[1]);
    assert.notEqual(app.ctFilteredSheets[0].key,app.ctFilteredSheets[1].key,'same-named workbook roles remain separate selectable sheets');
    app.ctSheetFilter='quest';assert.deepEqual(Array.from(app.ctFilteredSheets),[sheets[2]]);
    app.ctSheetFilter='gender';assert.equal(app.ctFilteredSheets.length,0,'role labels are not sheet names');
    app.ctSheetFilter=' \t ';assert.deepEqual(Array.from(app.ctFilteredSheets),sheets);
    assert.equal(app.ctSheet,sheets[2].key);assert.equal(app.ctSearch,'retained record query');assert.equal(app.ctAppliedSearch,'retained record query');
    assert.deepEqual(app.ctSelectedFilters,['missing','warning']);
    app.ctSheetFilter='stale sheet query';app.ctFence();assert.equal(app.ctSheetFilter,'');
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

test('ClientText internal draft tracking includes scoped durable and current drafts without exposing a status filter',async()=>{
    const first=namedUnit('DraftOne'),second=namedUnit('DraftTwo'),third=namedUnit('Clean'),
        {app}=listHarness({ctUnits:[first,second,third],_ctUnitIndex:new Map([first,second,third].map(unit=>[unit.id,unit])),ctSelection:second.id});
    app._ctStore={async getDraftSummaries(captured){assert.equal(captured.groupId,scope.groupId);return[{unitId:first.id,revision:3,updatedAt:1}];}};
    await app.ctRefreshDraftSummaries();app.ctDraftDirty=true;app.ctSelectedFilters=['draft'];
    assert.deepEqual(Array.from(app.ctRows,row=>row.id),[first.id,second.id]);assert.equal(app.ctDraftCount,2);
    assert.equal(app.ctStatusFilterOptions.some(option=>option.key==='draft'),false);
    assert.equal(app.ctStatus(first).saved,false);assert.equal(app.ctStatus(first).unchanged,true);
    app.ctSelection=first.id;assert.equal(app.ctDraftCount,1,'the selected private draft is not double-counted');
    const pending=deferred();app._ctStore.getDraftSummaries=()=>pending.promise;const loading=app.ctRefreshDraftSummaries();
    app.ctWorkspace={scope:{...scope,groupId:'replacement'}};const current=[{unitId:third.id,revision:1,updatedAt:2}];app.ctDraftSummaries=current;
    pending.resolve([{unitId:first.id,revision:9,updatedAt:3}]);await loading;assert.equal(app.ctDraftSummaries,current,'late old-group draft summaries cannot publish into the replacement group');
});
test('ClientText draft controls stay hidden for untouched rows, ordinary typing and unrelated errors',()=>{
    const {app,original}=listHarness();assert.equal(app.ctDraftBlocked,false);
    app.ctValues[fieldId]='Ordinary typing';app.ctDraftDirty=true;
    app.ctDraftSummaries=[{unitId:original.id,revision:2}];app.ctError='Could not load Dictionary';
    assert.equal(app.ctDraftBlocked,false);assert.equal(app.ctDraftCount,1);
    assert.equal(app.ctStatus(original).saved,false,'control visibility cannot stage a draft or change status');
    app.ctChoices=[{fieldId,local:'Ordinary typing',remote:'Incoming'}];assert.equal(app.ctDraftBlocked,true);
    app.ctQueueDraft=()=>{};app.ctChooseAlternative(app.ctChoices[0],'local');assert.equal(app.ctDraftBlocked,false);
    app.ctChoices=[{fieldId,local:'Older',remote:'Incoming'}];app.ctDraftDirty=false;
    assert.equal(app.ctDraftBlocked,false,'saved alternatives alone do not constitute a private draft');
});

test('ClientText checkpoint failures expose Discard only for the captured draft and clear after a successful retry',async()=>{
    const {app}=listHarness({ctDraftDirty:true}),pending=deferred();let failing=true;
    app._ctStore={async putDraft(){if(failing)throw Error('Draft storage unavailable');return{revision:3};}};
    assert.equal(await app.ctFlushDraft(),false);assert.equal(app.ctDraftBlocked,true);
    failing=false;assert.equal(await app.ctFlushDraft(),true);assert.equal(app.ctDraftBlocked,false);assert.equal(app.ctDraftStageFailure,null);
    app.ctValues[fieldId]='Pending old text';app._ctStore.putDraft=()=>pending.promise;
    const flushing=app.ctFlushDraft();await settle();app.ctValues[fieldId]='Newer typing';pending.reject(Error('Late checkpoint failure'));
    assert.equal(await flushing,false);assert.equal(app.ctDraftBlocked,false);assert.equal(app.ctDraftStageFailure,null);
});

test('ClientText save failures expose only the current failed draft and survive successful checkpoint writes until saved',async()=>{
    const {app}=listHarness({ctDraftDirty:true}),signature=JSON.stringify([app.ctValues,app.ctReviewed]);let failSave=true;
    app._ctStore={async putDraft(){return{revision:3};},async save(_scope,_unitId,command){if(failSave)throw Error('Save storage unavailable');return{saved:{values:command.values,reviewed:command.reviewed,revision:1}};}};
    app.ctSync=()=>{};app.ctLoadMemory=()=>{};
    assert.equal(await app.ctSave(),false);assert.equal(app.ctDraftBlocked,true);assert.equal(app.ctDraftStageFailure.signature,signature);
    assert.equal(await app.ctFlushDraft(),true);assert.equal(app.ctDraftBlocked,true,'a private checkpoint does not resolve a failed staging attempt');
    failSave=false;assert.equal(await app.ctSave(),true);assert.equal(app.ctDraftBlocked,false);assert.equal(app.ctDraftStageFailure,null);
    app.ctDraftDirty=true;app.ctValues[fieldId]='Another draft';app.ctRememberDraftStageFailure(app.ctContext(),app.ctSelection,JSON.stringify([app.ctValues,app.ctReviewed]),'save');
    app.ctQueueDraft=()=>{};app.ctEdited(app.ctCurrentUnit.fields[0]);assert.equal(app.ctDraftBlocked,false);assert.equal(app.ctDraftStageFailure,null);
});

test('late ClientText save failures cannot expose draft controls after typing, unit or scope changes',async()=>{
    for(const changed of ['typing','review','unit','account','group','language','epoch']){
        const {app}=listHarness({ctDraftDirty:true}),pending=deferred();app.ctFlushDraft=async()=>true;app._ctStore={save:()=>pending.promise};
        const saving=app.ctSave();await settle();
        if(changed==='typing')app.ctValues[fieldId]='Newer typing';
        else if(changed==='review')app.ctReviewed[fieldId]='Newer review';
        else if(changed==='unit')app.ctSelection='other-unit';
        else if(changed==='epoch')app._ctEpoch=1;
        else app.ctWorkspace={scope:{...scope,[changed==='account'?'accountId':changed==='group'?'groupId':'language']:'other'}};
        pending.reject(Error('Late failed save'));assert.equal(await saving,false);assert.equal(app.ctDraftBlocked,false,changed);assert.equal(app.ctDraftStageFailure,null,changed);
    }
});

test('ClientText table sorting and search preserve raw @, literal escapes, newlines and committed values',()=>{
    const first=namedUnit('ID10','A@literal\\nactual\nline','Z'),second=namedUnit('ID2','B','A'),
        {app}=listHarness({ctUnits:[first,second],ctSelectedFilters:['unchanged','saved','revised']});
    first.fields[0].sourceCell='B2';first.fields[0].targetCell='C2';
    second.fields[0].sourceCell='B10';second.fields[0].targetCell='C10';
    assert.equal(app.ctSort,'row');assert.equal(app.ctSortDir,'asc');
    assert.deepEqual(Array.from(app.ctRows,row=>row.recordId),['ID10','ID2'],'default row sort uses numeric worksheet positions');
    app.ctSortBy('row');assert.deepEqual(Array.from(app.ctRows,row=>row.recordId),['ID2','ID10']);
    app.pageSize=1;app.ctPage=2;assert.equal(app.ctSortValue(app.ctPageRows[0],'row'),2,'pagination retains the original row number');
    app.ctAppliedSearch='B';assert.equal(app.ctSortValue(app.ctRows[0],'row'),10,'filtering retains the original row number');app.ctAppliedSearch='';
    app.ctSortBy('filename');
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

test('leaving a ClientText inline row stages changed work through its save owner and closes only after success',async()=>{
    const {app,window}=listHarness({inlineEditor:true,ctDraftDirty:true}),calls=[];
    window.document={activeElement:{closest:()=>null},hidden:false,hasFocus:()=>true};
    app.ctHasEditorChanges=()=>true;app.ctSave=async()=>{calls.push('save');return true;};app.ctFlushDraft=async()=>{calls.push('checkpoint');return true;};app.ctRefreshLayout=()=>calls.push('layout');
    app.ctInlineFocusOut({target:{},relatedTarget:null});await new Promise(resolve=>setTimeout(resolve,10));
    assert.deepEqual(calls,['save','checkpoint','layout']);assert.equal(app.ctInlineClosed,true);
});

test('failed inline promotion and a replaced scope preserve the recoverable editor without a late close',async()=>{
    for(const replace of [false,true]){
        const {app,window}=listHarness({inlineEditor:true,ctDraftDirty:true}),held=deferred(),entered=deferred(),text=app.ctValues;
        window.document={activeElement:{closest:()=>null},hidden:false,hasFocus:()=>true};app.ctHasEditorChanges=()=>true;
        app.ctSave=async()=>{entered.resolve();return held.promise;};app.ctFlushDraft=()=>assert.fail('Failed or stale promotion cannot checkpoint another scope');app.ctRefreshLayout=()=>assert.fail('Failed or stale promotion cannot change layout');
        app.ctInlineFocusOut({target:{},relatedTarget:null});await entered.promise;
        if(replace)app.ctWorkspace={scope:{...scope,groupId:'replacement'}};
        held.resolve(replace);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(app.ctInlineClosed,false);assert.equal(app.ctValues,text);assert.equal(app.ctDraftDirty,true);
    }
});

test('moving focus inside the selected row, shared tools or modal preserves ClientText inline editing',async()=>{
    const {app,window}=listHarness({inlineEditor:true});let saves=0;app.ctSave=async()=>{saves++;return true;};app.ctHasEditorChanges=()=>true;
    window.document={activeElement:null,hidden:false,hasFocus:()=>true};
    for(const surface of ['row','tools','dialog']){
        const target={closest:selector=>surface==='row'&&selector==='tr[data-unit-id]'?{dataset:{unitId:app.ctSelection}}
            :surface!=='row'&&selector.includes('data-inline-focus-surface')?{}:null};
        app.ctInlineFocusOut({target:{},relatedTarget:target});
    }
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(saves,0);assert.equal(app.ctInlineClosed,false);
});
test('Discard draft is revision-checked, preserves saved work and retains typing that arrived during deletion',async()=>{
    const f=fixture();await f.store.import(scope,{units:[unit()],assets:[asset]});
    const {app,original}=listHarness({ctDraftDirty:true,ctValues:{[fieldId]:'discard me'}});app._ctStore=f.store;
    const saved=await f.store.save(scope,original.id,{jobId:'accepted',values:{[fieldId]:'Saved exact@\\n'},reviewed:{}});
    app.ctSaved={[original.id]:saved.saved};app._ctEditRevision=saved.saved.revision;
    app.ctRememberDraftStageFailure(app.ctContext(),original.id,JSON.stringify([app.ctValues,app.ctReviewed]),'save');assert.equal(app.ctDraftBlocked,true);
    assert.equal(await app.ctDiscardDraft(),true);assert.ok(!await f.store.getDraft(scope,original.id));
    assert.equal(app.ctDraftBlocked,false);assert.equal(app.ctDraftStageFailure,null);
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
    let scanned=false;app.ctScan=()=>scanned=true;app.ctStartScan();assert.equal(scanned,true);assert.equal(app.$refs.ctDiagnosticDialog.open,true,'scan progress stays in the shared modal');
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
    for(const name of ['ctDictionaryMatches','ctDictionaryReady','ctDictionaryScopeKey','ctDictionaryMatchedDefinitions','ctDictionaryFiltered',
        'ctDictionaryPageSize','ctDictionaryPageCount','ctDictionaryVisible','ctDictionaryRangeLabel','ctDictionaryController'])
        Object.defineProperty(h.app,name,{get:()=>h.mixin.computed[name].call(h.app)});
    field.source=source;field.kind=kind;h.app.ctValues[field.id]=text;h.app.ctFocusedField=field.id;
    let edits=0;h.app.ctEdited=()=>edits++;
    const input={value:text,selectionStart:text.length,selectionEnd:text.length,isConnected:true,dataset:{ctTarget:field.id},tagName:'TEXTAREA',
        focus(){this.focused=true;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
        setRangeText(value,start,end){this.value=this.value.slice(0,start)+value+this.value.slice(end);this.setSelectionRange(start+value.length,start+value.length);},
        closest(selector){return selector==='tr[data-unit-id]'?{dataset:{unitId:h.original.id}}:null;}};
    h.app.$refs.ctEditorRegion={contains:target=>target===input,querySelectorAll:selector=>selector==='[data-ct-target]'?[input]:[]};
    const event=(key,modifiers={})=>({...rowEvent(key),target:input,...modifiers});
    return {...h,field,input,event,edits:()=>edits};
}

function activeSourceText(controller){
    return Array.from(controller.highlight.matchAll(/<span\b(?=[^>]*class="[^"]*\bhlPopupActive\b)[^>]*>([\s\S]*?)<\/span>/g),match=>match[1]);
}

function completionDictionaryHarness(source,text='[',dictionary=[],options={}){
    const callbacks=[],h=completionHarness(source,text,'text',{dictionary,dictionaryDefaultGameScope:'poe2',...options,$nextTick:fn=>{if(fn)callbacks.push(fn);return Promise.resolve();}}),{app,window,input}=h;
    window.DictionaryScope=require('../public/dictionaryScope.js');
    const code=fs.readFileSync(path.join(__dirname,'../public/index.js'),'utf8'),section=(first,last)=>{
        const start=code.indexOf('    '+first),end=code.indexOf('    '+last,start);assert.ok(start>=0 && end>start);return code.slice(start,end);};
    const context=vm.createContext({window,Vue:window.Vue,setTimeout,clearTimeout});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/regexEngine.js'),'utf8'),context);
    const shared=vm.runInContext('({'+[
        section('getDictionaryDefinitionPairs(entry)','addDictionaryAltRow(word)'),section('addDictionaryAltPair(word','computeTextStats(text)'),
        section('createDictionaryEntry(fields','setDictionaryEntryScope(word'),section('ensureDictionaryKeywordTag(tagName','canCreateDictionaryEntryFromHlPopupItem(item)'),
        section('getDictionaryEntryById(dictId)','createDictionaryEntry(fields'),section('getActiveDictionaryEntries()','getPreparedEditorDictionaryIndex()'),
        section('findActiveDictionaryKeywordEntry(tagName)','isDictionaryHighlightActive(highlight)'),
        section('getDictionaryAssistanceEntry(dictId','resetDictionaryAssistanceScope()'),
    ].join('\n')+'})',context);
    for(const [name,method]of Object.entries(shared))if(name!=='getDictionaryAssistanceEntry')app[name]=method.bind(app);
    window.getKeywordPopupLookupName=vm.runInContext('getKeywordPopupLookupName',context);
    const scopeView=vm.runInContext('({'+section('dictionaryScopeView()','editorConsistencyDiagnostics()')+'})',context);
    for(const [name,compute]of Object.entries(scopeView))Object.defineProperty(app,name,{get:()=>compute.call(app)});
    const changes=[],focuses=[],body={};window.document={body,documentElement:{},activeElement:input};
    app.dictionaryEntryInput=word=>changes.push({kind:'input',id:word._id});app.markDictionarySnapshotDirty=id=>changes.push({kind:'dirty',id});
    app.invalidateEditorDictionaryIndex=(id,options)=>changes.push({kind:'invalidate',id,options});app.syncEditorHlterWithDictionaryNow=id=>changes.push({kind:'matches',id});
    app.beginDictionaryEdit=(id,options)=>app.ctDictionaryBeginEdit(id,options);
    const nativeFocus=input.focus.bind(input);input.focus=()=>{nativeFocus();focuses.push({kind:'target'});window.document.activeElement=input;};
    let replace;
    window.document.querySelectorAll=()=>app.ctDictionaryVisible.flatMap(word=>[word,...(word.alts || [])].map(pair=>{
        const alt=pair===word?null:pair,row={getAttribute:name=>name==='data-dict-id'?String(word._id):name==='data-dict-alt-id'?String(alt?._id || ''):null};
        const control={value:String(pair.replace || '').replace(/[\r\n]/g,''),isConnected:true,closest:()=>row,
            focus(){replace=this;window.document.activeElement=this;focuses.push({kind:'dictionary',id:word._id,altId:alt?._id});},select(){this.selected=true;}};
        row.querySelector=()=>control;return row;
    }));
    const flush=()=>{for(let guard=0;callbacks.length && guard<30;guard++)callbacks.shift()();clearTimeout(app._dictFlashTimer);assert.equal(callbacks.length,0);};
    const dictionaryEvent=(value,options={})=>{replace.value=value;return{key:'Enter',target:replace,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...options};};
    return {...h,changes,focuses,flush,dictionaryEvent,sharedDictionaryMethods:shared,replace:()=>replace};
}

test('ClientText autocomplete lights the selected source token across target arrows, popup selection, filtering and close',()=>{
    const h=completionHarness('Before [First] then [Second] and {0}','['),{app,field,input,event}=h,
        source=app.ctSourceFieldController({fields:[field]},{key:field.id,text:field.source});
    app.ctSuggest(field,{target:input});assert.deepEqual(activeSourceText(source),['[First]']);
    app.ctTargetKeydown(field,event('ArrowDown'));assert.deepEqual(activeSourceText(source),['[Second]']);
    app.ctTargetKeydown(field,event('ArrowUp'));assert.deepEqual(activeSourceText(source),['[First]']);
    const popup=app.clientTextPopupController();popup.hlPopup.selectedIndex=1;assert.deepEqual(activeSourceText(source),['[Second]'],'pointer/hover selection uses the same source activation');
    popup.hlPopup.filter='First';popup.applyHlPopupFilter();assert.deepEqual(activeSourceText(source),['[First]']);
    popup.hlPopup.filter='No matching source';popup.applyHlPopupFilter();assert.deepEqual(activeSourceText(source),[],'an empty filtered popup clears the source activation');
    app.ctCloseCompletion();assert.deepEqual(activeSourceText(source),[]);
    app.ctValues[field.id]='{';input.value='{';input.setSelectionRange(1,1);app.ctSuggest(field,{target:input});
    assert.deepEqual(activeSourceText(source),['{0}'],'variables use the exact same selection highlight');
});

test('translated and alternate completion rows light exact original keyword ranges without crossing field or scope',()=>{
    const dictionary=[{_id:'fire',find:'Fire',replace:'Feu',alts:[{_id:'burning',find:'Burning damage',replace:'Brûlure'}]}],
        h=completionHarness('[Fire<gemlevel={2}>|Burning damage] [Fire<gemlevel={3}>|Other]','[','text',{dictionary}),{app,field,input}=h;
    const other={...field,id:JSON.stringify(['Other',null]),name:'Other',source:'[Fire<gemlevel={2}>|Burning damage]'};h.original.fields.push(other);
    const source=app.ctSourceFieldController({fields:[field]},{key:field.id,text:field.source}),otherSource=app.ctSourceFieldController({fields:[other]},{key:other.id,text:other.source});
    app.ctSuggest(field,{target:input});assert.match(app.ctCompletion.items[0].value,/Brûlure/);
    assert.deepEqual(activeSourceText(source),['[Fire&lt;gemlevel={2}&gt;|Burning damage]']);assert.deepEqual(activeSourceText(otherSource),[]);
    const selected=app.ctCompletion.items.findIndex(item=>item.value==='[Fire<gemlevel={3}>|Feu]');assert.ok(selected>=0);
    app.clientTextPopupController().hlPopup.selectedIndex=selected;
    assert.deepEqual(activeSourceText(source),['[Fire&lt;gemlevel={3}&gt;|Other]'],'metadata distinguishes source tokens sharing a Dictionary Find name');
    app.ctWorkspace={scope:{...scope,groupId:'replacement'}};assert.deepEqual(activeSourceText(source),[],'stale popup selection cannot light a replacement group');
});

test('one ClientText completion lights every duplicate original token without merging different tokens',()=>{
    const h=completionHarness('[Fire] then [Fire] and [Cold] {0} then {0}','['),{app,field,input}=h,
        source=app.ctSourceFieldController({fields:[field]},{key:field.id,text:field.source});
    app.ctSuggest(field,{target:input});assert.deepEqual(activeSourceText(source),['[Fire]','[Fire]']);
    assert.equal(app.ctCompletion.items.filter(item=>item.value==='[Fire]').length,1);
    app.ctValues[field.id]='{';input.value='{';input.setSelectionRange(1,1);app.ctSuggest(field,{target:input});
    assert.deepEqual(activeSourceText(source),['{0}','{0}']);assert.equal(app.ctCompletion.items.length,1);
});

test('ClientText variable selection lights its containing source keyword and other exact occurrences',()=>{
    const h=completionHarness('[Fire|Damage {0}] then {0} and {1}','{'),{app,field,input,event}=h,
        source=app.ctSourceFieldController({fields:[field]},{key:field.id,text:field.source});
    app.ctSuggest(field,{target:input});assert.deepEqual(activeSourceText(source),['[Fire|Damage {0}]','{0}']);
    app.ctTargetKeydown(field,event('ArrowDown'));assert.deepEqual(activeSourceText(source),['{1}']);
    app.ctCloseCompletion();assert.deepEqual(activeSourceText(source),[]);
});

test('a stale ClientText popup cannot light or insert into a same-ID replacement record or field',()=>{
    for(const change of ['record','field','composing']){
        const h=completionHarness('[Fire]','['),{app,field,input}=h,
            source=app.ctSourceFieldController({fields:[field]},{key:field.id,text:field.source});
        app.ctSuggest(field,{target:input});const item=app.ctCompletion.items[0];assert.deepEqual(activeSourceText(source),['[Fire]']);
        if(change==='record'){const replacement=clone(h.original);app._ctUnitIndex=new Map([[replacement.id,replacement]]);app.ctUnits=[replacement];}
        else if(change==='field')h.original.fields[0]={...field};
        else input.composing=true;
        assert.deepEqual(activeSourceText(source),[],change);assert.equal(app.ctApplyCompletion(field,item,input),false,change);
        assert.equal(app.ctValues[field.id],'[',change);assert.equal(h.edits(),0,change);assert.equal(input.focused,undefined,change);
    }
});

test('ClientText popup identity survives Vue proxy reads while retaining the exact source and target',()=>{
    const h=completionHarness('[Fire]','['),{app,window,field,input}=h,
        source=app.ctSourceFieldController({fields:[field]},{key:field.id,text:field.source}),rawValues=app.ctValues;
    app.ctSuggest(field,{target:input});const completion=app.ctCompletion,fieldProxy=new Proxy(field,{}),unitProxy=new Proxy(h.original,{}),
        rawObjects=new WeakMap([[fieldProxy,field],[unitProxy,h.original]]);
    window.Vue.toRaw=value=>rawObjects.get(value) || value;
    app.ctCompletion=new Proxy(completion,{get(target,name){return name==='field'?fieldProxy:name==='unit'?unitProxy:Reflect.get(target,name);}});
    assert.deepEqual(activeSourceText(source),['[Fire]'],'a reactive completion references the same raw source field');
    assert.equal(app.ctApplyCompletion(field,completion.items[0],input),true);assert.equal(app.ctValues,rawValues);
    assert.equal(app.ctValues[field.id],'[Fire]');assert.equal(h.edits(),1);assert.equal(input.focused,true);
});

test('missing ClientText keyword Enter creates the SD main/alternate rows, then Replace Enter inserts exact raw text and returns its caret',()=>{
    const prefix='head@literal\\n\r\n',initial=prefix+'[TAIL',h=completionDictionaryHarness('[Fire<gemlevel={2}>|Burning damage]',initial),{app,field,input,event}=h;
    input.value=initial.replace(/\r\n/g,'\n');input.setSelectionRange((prefix+'[').replace(/\r\n/g,'\n').length,(prefix+'[').replace(/\r\n/g,'\n').length);
    const retained=clone(h.original),saved=app.ctSaved;assert.equal(app.ctSuggest(field,{target:input}),true);assert.equal(app.ctCompletion.items[0].mustCreate,true);
    const enter=event('Enter');app.ctTargetKeydown(field,enter);assert.equal(enter.defaultPrevented,true);h.flush();
    const word=app.dictionary[0],alt=word?.alts?.[0];assert.equal(app.dictionary.length,1);assert.equal(word.find,'Fire');assert.equal(word.gameScope,'poe2');
    assert.equal(alt.find,'Burning damage');assert.equal(app.ctCompletion,null);assert.equal(app.ctValues[field.id],initial,'creation leaves the typed bracket and suffix in place');assert.equal(h.edits(),0);
    assert.equal(h.focuses.at(-1).kind,'dictionary');assert.equal(h.focuses.at(-1).altId,alt._id);assert.equal(app.ctDictionaryEditingId,word._id);
    const replacement='Feu@literal\\n exact',replacementEvent=h.dictionaryEvent(replacement);alt.replace=replacement;
    app.ctDictionaryController.onDictionaryReplaceEnter(replacementEvent,word,alt);h.flush();
    const inserted='[Fire<gemlevel={2}>|'+replacement+']',expected=prefix+inserted+'TAIL',caret=(prefix+inserted).replace(/\r\n/g,'\n').length;
    assert.equal(replacementEvent.defaultPrevented,true);assert.equal(app.ctValues[field.id],expected);assert.equal(input.value,expected.replace(/\r\n/g,'\n'));
    assert.deepEqual([input.selectionStart,input.selectionEnd],[caret,caret]);assert.equal(h.window.document.activeElement,input);assert.equal(h.edits(),1);
    app.ctDictionaryController.onDictionaryReplaceEnter(h.dictionaryEvent('Duplicate'),word,alt);h.flush();assert.equal(app.ctValues[field.id],expected,'return intent is consumed once');
    assert.equal(h.edits(),1);assert.equal(app.ctSaved,saved);assert.deepEqual(h.original,retained,'Dictionary creation and insertion leave immutable source metadata intact');
});

test('ClientText popup Enter adds a missing dynamic alternate and Ctrl+Enter edits an existing alternate without duplicate Dictionary rows',()=>{
    for(const existing of [false,true]){
        const word={_id:'fire',find:'Fire',replace:'Feu',alts:existing?[{_id:'burning',find:'Burning damage',replace:'Brûlure'}]:[]},
            h=completionDictionaryHarness('[Fire|Burning damage]','[',[word]),{app,field,input}=h;
        app.ctSuggest(field,{target:input});const popup=app.clientTextPopupController();
        const item=app.ctCompletion.items.find(item=>existing?item.dictAltId==='burning':item.mustCreate);assert.ok(item);
        popup.hlPopup.selectedIndex=app.ctCompletion.items.indexOf(item);
        const enter={key:'Enter',ctrlKey:existing,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
        popup.hlPopupFilterKeydown(enter);h.flush();assert.equal(enter.defaultPrevented,true);assert.equal(app.ctValues[field.id],'[');assert.equal(app.dictionary.length,1);assert.equal(word.alts.length,1);
        const alt=word.alts[0];assert.equal(alt.find,'Burning damage');assert.equal(h.focuses.at(-1).altId,alt._id);
        alt.replace='Edited flame';app.ctDictionaryController.onDictionaryReplaceEnter(h.dictionaryEvent(alt.replace),word,alt);h.flush();
        assert.equal(app.ctValues[field.id],'[Fire|Edited flame]');assert.equal(h.window.document.activeElement,input);assert.equal(word.alts.length,1);assert.equal(h.edits(),1);
    }
});

test('an existing ClientText main keyword inserts on Enter and edits that same main row on Ctrl+Enter',()=>{
    for(const edit of [false,true]){
        const word={_id:'fire',find:'Fire',replace:'Feu',alts:[]},h=completionDictionaryHarness('[Fire]','[',[word]),{app,field,input,event}=h;
        app.ctSuggest(field,{target:input});assert.equal(app.ctCompletion.items[0].mustCreate,undefined);
        app.ctTargetKeydown(field,event('Enter',{ctrlKey:edit}));h.flush();
        if(edit){assert.equal(app.ctValues[field.id],'[');assert.equal(h.focuses.at(-1).id,'fire');assert.equal(h.focuses.at(-1).altId,undefined);
            app.ctDictionaryController.onDictionaryReplaceEnter(h.dictionaryEvent('Edited fire'),word);h.flush();}
        assert.equal(app.ctValues[field.id],edit?'[Fire|Edited fire]':'[Fire|Feu]');assert.equal(h.window.document.activeElement,input);
        assert.equal(h.edits(),1);assert.equal(app.dictionary.length,1);assert.equal(word.alts.length,0);
    }
});

test('ClientText direct Dictionary completion rejects removed or inactive parents but retains its pinned translation text',()=>{
    for(const change of ['removed','foreign','shadowed','replacement-text']){
        const word={_id:'fire',find:'Fire',replace:'Captured flame',alts:[]},h=completionDictionaryHarness('[Fire]','[',[word]),{app,field,input}=h;
        app.ctSuggest(field,{target:input});const item=app.ctCompletion.items[0];assert.equal(item.value,'[Fire|Captured flame]');
        if(change==='removed')app.dictionary.splice(0,1);
        else if(change==='foreign')word.gameScope='poe1';
        else if(change==='shadowed')app.dictionary.push({_id:'poe2-fire',gameScope:'poe2',find:'Fire',replace:'Override flame',alts:[]});
        else word.replace='New shared flame';
        const accepted=change==='replacement-text';assert.equal(app.ctApplyCompletion(field,item,input),accepted,change);h.flush();
        assert.equal(app.ctValues[field.id],accepted?'[Fire|Captured flame]':'[',change);assert.equal(h.edits(),accepted?1:0,change);
        if(!accepted)assert.equal(input.focused,undefined,change);assert.equal(app.ctCompletion,null);
    }
});

test('ClientText Dictionary completion works on the shared app when its SD-only assistance cache is empty',()=>{
    const word={_id:'fire',find:'Fire',replace:'Captured flame',alts:[]},h=completionDictionaryHarness('[Fire]','[',[word]),{app,field,input,event}=h;
    app.getEditorDictionaryMatchPack=()=>null;app.getDictionaryAssistanceEntry=h.sharedDictionaryMethods.getDictionaryAssistanceEntry.bind(app);
    assert.equal(app.getDictionaryAssistanceEntry('fire',true),undefined,'the actual SD accessor has no ClientText entry');
    app.ctDictionaryPack={units:[{key:field.id,english:field.source,HLs:[]}],entriesById:{fire:clone(word)}};
    app.ctSuggest(field,{target:input});word.replace='New shared flame';app.ctTargetKeydown(field,event('Enter'));h.flush();
    assert.equal(app.ctValues[field.id],'[Fire|Captured flame]');assert.equal(h.edits(),1);assert.equal(h.window.document.activeElement,input);
});

test('ClientText keeps separate main and alternate Dictionary actions when their displayed translation is identical',()=>{
    for(const editAlt of [false,true]){
        const word={_id:'fire',find:'Fire',replace:'Feu',alts:[{_id:'burning',find:'Burning damage',replace:'Feu'}]},
            h=completionDictionaryHarness('[Fire|Burning damage] then [Fire|Burning damage]','[',[word]),{app,field,input,event}=h;
        app.ctSuggest(field,{target:input});const candidates=app.ctCompletion.items.filter(item=>item.value==='[Fire|Feu]');
        assert.equal(candidates.length,2);assert.equal(candidates.every(item=>item.sourceRanges.length===2),true,'each definition retains every original occurrence');
        const selected=candidates.find(item=>editAlt?item.dictAltId==='burning':!item.dictAltId);assert.ok(selected);
        app.clientTextPopupController().hlPopup.selectedIndex=app.ctCompletion.items.indexOf(selected);
        app.ctTargetKeydown(field,event('Enter',{ctrlKey:true}));h.flush();assert.equal(h.focuses.at(-1).altId,editAlt?'burning':undefined);
        const alt=editAlt?word.alts[0]:undefined;app.ctDictionaryController.onDictionaryReplaceEnter(h.dictionaryEvent('Edited flame'),word,alt);h.flush();
        assert.equal(app.ctValues[field.id],'[Fire|Edited flame]');assert.equal(app.dictionary.length,1);assert.equal(word.alts.length,1);assert.equal(h.edits(),1);
    }
});

test('ClientText explicit keyword creation uses the configured foreign-game SD row without allowing its automatic translation',()=>{
    for(const dynamic of ['', '|Burning damage']){
        const foreign={_id:'foreign-fire',find:'Fire',replace:'PoE1 flame',gameScope:'poe1',alts:[]},
            h=completionDictionaryHarness('[Fire<gemlevel={2}>'+dynamic+']','[',[foreign],{dictionaryDefaultGameScope:'poe1'}),{app,field,input,event}=h;
        app.ctSuggest(field,{target:input});assert.equal(app.ctCompletion.items.length,1);assert.equal(app.ctCompletion.items[0].mustCreate,true);
        assert.equal(app.ctCompletion.items.some(item=>item.value.includes('PoE1 flame')),false,'foreign definitions stay outside automatic completion');
        app.ctTargetKeydown(field,event('Enter'));h.flush();assert.equal(app.dictionary.length,1);assert.equal(app.dictionary[0],foreign);
        assert.equal(foreign.alts.length,dynamic?1:0);assert.equal(h.focuses.at(-1).id,'foreign-fire');assert.equal(foreign.gameScope,'poe1');
        const alt=dynamic?foreign.alts[0]:undefined;if(alt)assert.equal(alt.find,'Burning damage');
        const replace=h.dictionaryEvent('Foreign edited flame');app.ctDictionaryController.onDictionaryReplaceEnter(replace,foreign,alt);h.flush();
        assert.equal(app.ctValues[field.id],'[','SD allows explicit foreign-game editing but refuses translation insertion');
        assert.equal(replace.defaultPrevented,undefined);assert.equal(h.edits(),0);
    }
    for(const defaultScope of ['poe2','all']){
        const foreign={_id:'foreign-fire',find:'Fire',replace:'PoE1 flame',gameScope:'poe1',alts:[]},before=clone(foreign),
            h=completionDictionaryHarness('[Fire]','[',[foreign],{dictionaryDefaultGameScope:defaultScope}),{app,field,input,event}=h;
        app.ctSuggest(field,{target:input});app.ctTargetKeydown(field,event('Enter'));h.flush();
        assert.equal(app.dictionary.length,2);const created=app.dictionary[0];assert.notEqual(created,foreign);
        assert.equal(h.window.DictionaryScope.normalize(created),defaultScope);assert.deepEqual(foreign,before);
        app.ctDictionaryController.onDictionaryReplaceEnter(h.dictionaryEvent('Current flame'),created);h.flush();
        assert.equal(app.ctValues[field.id],'[Fire|Current flame]');assert.equal(h.edits(),1);
    }
});

test('ClientText keyword Add/Edit prefers the current active SD definition over its configured foreign-game fallback',()=>{
    const foreign={_id:'foreign-fire',find:'Fire',replace:'PoE1 flame',gameScope:'poe1',alts:[]},
        active={_id:'current-fire',find:'Fire',replace:'PoE2 flame',gameScope:'poe2',alts:[]},before=clone(foreign),
        h=completionDictionaryHarness('[Fire]','[',[foreign,active],{dictionaryDefaultGameScope:'poe1'}),{app,field,input,event}=h;
    app.ctSuggest(field,{target:input});assert.equal(app.ctCompletion.items[0].value,'[Fire|PoE2 flame]');
    app.ctTargetKeydown(field,event('Enter',{ctrlKey:true}));h.flush();assert.equal(h.focuses.at(-1).id,'current-fire');
    assert.equal(app.dictionary.length,2);app.ctDictionaryController.onDictionaryReplaceEnter(h.dictionaryEvent('Edited PoE2 flame'),active);h.flush();
    assert.equal(app.ctValues[field.id],'[Fire|Edited PoE2 flame]');assert.deepEqual(foreign,before);assert.equal(h.edits(),1);
});

test('ClientText keyword creation follows SD markup display handling without changing the original token',()=>{
    const source='[Fire|<i>Fire</i>]',h=completionDictionaryHarness(source),{app,field,input,event}=h;
    app.ctSuggest(field,{target:input});assert.equal(app.ctCompletion.items[0].value,source);
    const controller=app.ctSourceFieldController({fields:[field]},{key:field.id,text:field.source});
    assert.deepEqual(activeSourceText(controller),['[Fire|&lt;i&gt;Fire&lt;/i&gt;]']);
    app.ctTargetKeydown(field,event('Enter'));h.flush();const word=app.dictionary[0];
    assert.equal(word.find,'Fire');assert.equal(word.alts.length,0,'SD does not turn markup display content into an alternate Find');
    assert.equal(h.focuses.at(-1).altId,undefined);assert.equal(field.source,source);assert.equal(app.ctValues[field.id],'[');
    app.ctDictionaryController.onDictionaryReplaceEnter(h.dictionaryEvent('Feu'),word);h.flush();assert.equal(app.ctValues[field.id],'[Fire|Feu]');
});

test('manual ClientText keyword creation seeds selected translation and replaces only its captured raw range',()=>{
    const prefix='before\r\n',selected='  selected@literal\\n  ',suffix='\r\nafter',h=completionDictionaryHarness('[Fire]',prefix+selected+suffix),{app,field,input,event}=h;
    input.value=app.ctValues[field.id].replace(/\r\n/g,'\n');input.setSelectionRange(prefix.replace(/\r\n/g,'\n').length,(prefix+selected).replace(/\r\n/g,'\n').length);
    assert.equal(app.ctSuggest(field,{target:input},{manual:true}),true);app.ctTargetKeydown(field,event('Enter'));h.flush();
    const word=app.dictionary[0];assert.equal(word.replace,selected,'SD creation starts from the selected translation');assert.equal(app.ctValues[field.id],prefix+selected+suffix);
    const replacement=h.dictionaryEvent('Feu');app.ctDictionaryController.onDictionaryReplaceEnter(replacement,word);h.flush();
    assert.equal(app.ctValues[field.id],prefix+'[Fire|Feu]'+suffix);assert.deepEqual([input.selectionStart,input.selectionEnd],[(prefix+'[Fire|Feu]').replace(/\r\n/g,'\n').length,(prefix+'[Fire|Feu]').replace(/\r\n/g,'\n').length]);
});

test('ClientText Dictionary completion return rejects stale field, caret, native input, scope and removed entry callbacks',()=>{
    for(const change of ['text','caret','native-text','field','unit','same-id-unit','source','account','group','branch','language','dictionary','removed','entry-scope','alternate','detached','composing','busy']){
        const h=completionDictionaryHarness('[Fire|Burning damage]'),{app,field,input,event}=h;
        app.ctSuggest(field,{target:input});app.ctTargetKeydown(field,event('Enter'));h.flush();
        const word=app.dictionary[0],alt=word.alts[0],controller=app.ctDictionaryController,replaceEvent=h.dictionaryEvent('Edited flame'),values=app.ctValues;
        const focus=h.focuses.length,changes=h.changes.length;
        if(change==='text'){app.ctValues[field.id]='New target';input.value='New target';}
        else if(change==='caret')input.setSelectionRange(0,0);
        else if(change==='native-text')input.value='Unsynchronized input';
        else if(change==='field')app.ctFocusedField='another-field';
        else if(change==='unit')app.ctSelection='another-unit';
        else if(change==='same-id-unit'){const replacement=clone(h.original);app._ctUnitIndex=new Map([[replacement.id,replacement]]);app.ctUnits=[replacement];}
        else if(change==='source')field.source='[Changed source]';
        else if(change==='account')app.managedCatalogScope='other-account:poe2';
        else if(['group','branch','language'].includes(change))app.ctWorkspace={scope:{...scope,[{group:'groupId',branch:'branchId',language:'language'}[change]]:'replacement'}};
        else if(change==='dictionary')app.dictionary=[...app.dictionary];
        else if(change==='removed')app.dictionary.splice(0,1);
        else if(change==='entry-scope')word.gameScope='poe1';
        else if(change==='alternate')word.alts=[];
        else if(change==='detached')input.isConnected=false;
        else if(change==='composing')input.composing=true;
        else if(change==='busy')app.ctBusy=true;
        controller.onDictionaryReplaceEnter(replaceEvent,word,alt);h.flush();
        assert.equal(app.ctValues,values,change);assert.equal(app.ctValues[field.id],change==='text'?'New target':'[',change);
        assert.equal(h.edits(),0,change);assert.equal(h.focuses.length,focus,change);assert.equal(h.changes.length,changes,change);
    }
});

test('ClientText Dictionary return stays with its captured row until another explicit insertion consumes it',()=>{
    const other={_id:'cold',find:'Cold',replace:'Froid',alts:[]},h=completionDictionaryHarness('[Fire]','[',[other]),{app,field,input,event}=h;
    app.ctSuggest(field,{target:input});app.ctTargetKeydown(field,event('Enter'));h.flush();const created=app.dictionary[0],info=app._ctDictionaryReturn;
    const otherRow=h.window.document.querySelectorAll().find(row=>row.getAttribute('data-dict-id')==='cold'),otherInput=otherRow.querySelector();otherInput.focus();
    const keydown=modifiers=>({key:'Enter',target:otherInput,preventDefault(){this.defaultPrevented=true;},...modifiers});
    app.ctDictionaryController.onDictionaryReplaceEnter(keydown({}),other);h.flush();
    assert.equal(app._ctDictionaryReturn,info,'plain Enter in another Dictionary row cannot consume the pending return');assert.equal(app.ctValues[field.id],'[');assert.equal(h.edits(),0);
    app.ctDictionaryController.onDictionaryReplaceEnter(keydown({ctrlKey:true,isComposing:true}),other);h.flush();
    assert.equal(app._ctDictionaryReturn,info);assert.equal(h.edits(),0);
    const use=keydown({ctrlKey:true});app.ctDictionaryController.onDictionaryReplaceEnter(use,other);h.flush();
    assert.equal(use.defaultPrevented,true);assert.equal(app._ctDictionaryReturn,null);assert.equal(app.ctValues[field.id],'[Froid');assert.equal(h.edits(),1);
    app.ctDictionaryController.onDictionaryReplaceEnter(h.dictionaryEvent('Fire replacement'),created);h.flush();
    assert.equal(app.ctValues[field.id],'[Froid','the older keyword return cannot replace the later explicit insertion');assert.equal(h.edits(),1);
});

test('ClientText completion and Dictionary return ignore IME Enter while preserving the later committed action',()=>{
    for(const ime of [{isComposing:true},{keyCode:229}]){
        const h=completionDictionaryHarness('[Fire]'),{app,field,input,event}=h;
        assert.equal(app.ctSuggest(field,{target:input,...ime}),false);assert.equal(app.dictionary.length,0);
        app.ctSuggest(field,{target:input});const completion=app.ctCompletion;
        const composing=event('Enter',ime);app.ctTargetKeydown(field,composing);
        assert.equal(composing.defaultPrevented,undefined);assert.equal(app.ctCompletion,completion);assert.equal(app.dictionary.length,0);
        const popupEvent={key:'Enter',...ime,preventDefault(){this.defaultPrevented=true;}};app.clientTextPopupController().hlPopupFilterKeydown(popupEvent);
        assert.equal(popupEvent.defaultPrevented,undefined);assert.equal(app.ctCompletion,completion);assert.equal(app.dictionary.length,0);
        app.ctTargetKeydown(field,event('Enter'));h.flush();const word=app.dictionary[0];
        const replacement=h.dictionaryEvent('Feu',ime);app.ctDictionaryController.onDictionaryReplaceEnter(replacement,word);h.flush();
        assert.equal(replacement.defaultPrevented,undefined);assert.equal(app.ctValues[field.id],'[');assert.equal(h.edits(),0);
        const committed=h.dictionaryEvent('Feu');app.ctDictionaryController.onDictionaryReplaceEnter(committed,word);h.flush();
        assert.equal(committed.defaultPrevented,true);assert.equal(app.ctValues[field.id],'[Fire|Feu]');assert.equal(h.edits(),1);
    }
});

test('queued ClientText Dictionary focus and translation-caret callbacks cannot steal focus after a scope change',()=>{
    for(const change of ['group','entry-scope','disabled','removed','field','target']){
        const creating=completionDictionaryHarness('[Fire]');creating.app.ctSuggest(creating.field,{target:creating.input});creating.app.ctTargetKeydown(creating.field,creating.event('Enter'));
        const focusedBeforeCreation=creating.focuses.length;
        if(change==='group')creating.app.ctWorkspace={scope:{...scope,groupId:'replacement'}};
        else if(change==='entry-scope')creating.app.dictionary[0].gameScope='poe1';
        else if(change==='disabled')creating.app.dictionary[0].disabled=true;
        else if(change==='removed')creating.app.dictionary.splice(0,1);
        else if(change==='field')creating.app.ctFocusedField='another-field';
        else creating.app.ctValues[creating.field.id]='New typing';
        creating.flush();assert.equal(creating.focuses.length,focusedBeforeCreation,'queued Replace focus is fenced after '+change);
    }
    const returning=completionDictionaryHarness('[Fire]');returning.app.ctSuggest(returning.field,{target:returning.input});returning.app.ctTargetKeydown(returning.field,returning.event('Enter'));returning.flush();
    const word=returning.app.dictionary[0];returning.app.ctDictionaryController.onDictionaryReplaceEnter(returning.dictionaryEvent('Feu'),word);
    assert.equal(returning.app.ctValues[returning.field.id],'[Fire|Feu]');const focusedBeforeReturn=returning.focuses.length;
    returning.app.managedCatalogScope='replacement-account:poe2';returning.window.document.activeElement={replacement:true};returning.flush();
    assert.equal(returning.focuses.length,focusedBeforeReturn,'a completed insertion cannot restore a caret into a different account');
    assert.deepEqual(returning.window.document.activeElement,{replacement:true});
});
test('ClientText completion arrows choose a source token and preserve raw workbook text',()=>{
    const prefix='@literal\\nactual\n',h=completionHarness('{0} {1}',prefix+'{'),{app,field,input,event}=h;
    assert.equal(app.ctSuggest(field,{target:input}),true);assert.equal(app.ctCompletion.selectedIndex,0);
    const down=event('ArrowDown');app.ctTargetKeydown(field,down);assert.equal(down.defaultPrevented,true);assert.equal(app.ctCompletion.selectedIndex,1);
    const enter=event('Enter');app.ctTargetKeydown(field,enter);assert.equal(enter.defaultPrevented,true);
    assert.equal(app.ctValues[field.id],prefix+'{1}');assert.equal(h.edits(),1);assert.equal(app.ctCompletion,null);assert.equal(input.focused,true);
    app.ctValues[field.id]='{';input.value='{';input.selectionStart=input.selectionEnd=1;app.ctSuggest(field,{target:input});
    app.ctTargetKeydown(field,event('ArrowUp'));assert.equal(app.ctCompletion.selectedIndex,1,'up wraps to the final source variable');
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
test('ClientText Shift+Tab traverses fields and variable-popup Ctrl+Enter closes before a later editor handoff',async()=>{
    const {app,field,input,event}=completionHarness('{0}','{');let opened=0;const moves=[];
    app.ctSaveAndNavigate=async(...args)=>{moves.push(args);return false;};
    app.ctSuggest(field,{target:input});const previous=event('Tab',{shiftKey:true});await app.ctTargetKeydown(field,previous);
    assert.equal(previous.defaultPrevented,true);assert.equal(moves[0][0],true);assert.equal(moves[0][1].inline,true);
    assert.equal(app.ctValues[field.id],'{');assert.equal(app.ctCompletion,null);
    app.ctSuggest(field,{target:input});app.ctSelect=(unit,full)=>{assert.equal(unit,app.ctCurrentUnit);assert.equal(full,true);opened++;};
    const popupEnter=event('Enter',{ctrlKey:true});await app.ctTargetKeydown(field,popupEnter);assert.equal(opened,0);assert.equal(app.ctCompletion,null);assert.equal(app.ctValues[field.id],'{');
    const full=event('Enter',{ctrlKey:true});await app.ctTargetKeydown(field,full);assert.equal(opened,1);assert.equal(app.ctValues[field.id],'{');
    app.ctSuggest(field,{target:input});const composing=event('Enter',{isComposing:true});app.ctTargetKeydown(field,composing);
    assert.equal(composing.defaultPrevented,undefined);assert.equal(app.ctValues[field.id],'{');
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
    const held=completionHarness('[FireDamage|Burning damage]','[','text',{dictionary:clone(dictionary)});
    held.app.ctSuggest(held.field,{target:held.input});const item=held.app.ctCompletion.items[0],selected=item.value;
    held.app.dictionary[0].alts[0].replace='New shared display';
    assert.equal(held.app.ctApplyCompletion(held.field,item,held.input),true);assert.equal(held.app.ctValues[held.field.id],selected,'an open popup inserts its captured exact result');
    held.app.ctValues[held.field.id]='[';held.input.value='[';held.input.selectionStart=held.input.selectionEnd=1;
    held.app.ctSuggest(held.field,{target:held.input});assert.ok(held.app.ctCompletion.items.some(item=>item.value==='[FireDamage|New shared display]'),'the next popup uses the updated Dictionary');
});

test('Dictionary background preparation pins open completion and highlights until close, then applies the newest scoped pack',async()=>{
    const h=completionHarness('[Fire|Burning]','[','text',{dictionary:[{_id:'fire',find:'Fire',replace:'Captured flame'}],highlightDict:true}),{app,field,input}=h;
    const first={units:[{key:field.id,HLs:[]}],entriesById:{fire:{find:'Fire',replace:'Captured flame'}}},
        next={units:[{key:field.id,HLs:[{rawStart:0,rawEnd:14,dictId:'fire',replace:'New flame'}]}],entriesById:{fire:{find:'Fire',replace:'New flame'}}};
    app.ctDictionaryPack=first;app.ctSuggest(field,{target:input});const popup=app.ctCompletion,values=app.ctValues,caret=[input.selectionStart,input.selectionEnd],
        captured=popup.items.find(item=>item.value==='[Fire|Captured flame]');assert.ok(captured);
    popup.selectedIndex=popup.items.indexOf(captured);
    app.ensureDictionarySnapshot=async()=>{};app.ensureDictionaryWorker=()=>({match(fields,options){assert.equal(fields[0].english,field.source);assert.equal(options.contentMode,'clienttext');return Promise.resolve(next);}});
    app.dictionary[0].replace='New flame';await app.scheduleClientTextDictionaryMatches();
    assert.equal(app.ctCompletion,popup);assert.equal(app.ctDictionaryPack,first);assert.equal(app._ctPendingDictionaryPack,next);
    assert.equal(app.ctValues,values);assert.deepEqual([input.selectionStart,input.selectionEnd],caret);assert.equal(h.edits(),0);
    assert.equal(app.ctApplyCompletion(field,captured,input),true);assert.equal(app.ctValues[field.id],'[Fire|Captured flame]');assert.equal(app.ctDictionaryPack,next);
    const held=deferred();app.ensureDictionaryWorker=()=>({match:()=>held.promise});const preparing=app.scheduleClientTextDictionaryMatches();await settle();
    app.ctWorkspace={scope:{...scope,groupId:'new-group'}};const replacement={units:[],entriesById:{}};app.ctDictionaryPack=replacement;
    held.resolve(first);await preparing;assert.equal(app.ctDictionaryPack,replacement,'late same-ID match preparation is scope fenced');
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
    const {window}=harness(),template=window.EditorComponents.Autocomplete.template,native=window.EditorComponents.NativeField.template;
    assert.match(template,/role="listbox"/);assert.match(template,/role="option"/);assert.match(template,/:aria-selected=/);
    assert.match(template,/:aria-activedescendant=/);
    assert.match(template,/\{\{ item.label \}\}/);assert.doesNotMatch(template,/v-html/);
    assert.match(native,/v-bind="field.dataAttrs"/,'both native modes expose the field controller accessibility attributes');
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

function namedFormUnit(id='NamedForms',row=2){
    const original=namedUnit(id),base=original.fields[0];
    original.sheet='BaseItemTypes';original.id=JSON.stringify(['normal',original.sheet,id]);
    original.fields=['Normal Translation','Possessive Translation'].map((form,index)=>({...base,id:JSON.stringify(['Display Name',form]),name:'Display Name',kind:'form',form,
        group:'Display Name',source:'Exalted Orb {0}',target:index?'Yüce Küresi {0}':'Yüce Küre {0}',sourceCell:'B'+row,targetCell:(index?'D':'C')+row,required:true}));
    return original;
}

for(const full of [false,true])test(`named Normal/Possessive forms retain worksheet navigation and literal NONEXISTENT in ${full?'full':'inline'} mode`,async()=>{
    const original=namedFormUnit(),{app,inputFor,event,focuses,window}=keyboardHarness(original,{ctEditor:full}),[normal,possessive]=original.fields;
    assert.deepEqual(Array.from(app.ctNamedForms(app.ctFieldGroups[0]),field=>app.ctNamedFormLabel(field)),['Normal','Possessive']);
    assert.equal(app.ctDefaultForms(app.ctFieldGroups[0]).length,0);assert.equal(app.ctGroupSources(app.ctFieldGroups[0]).length,1);
    assert.match(window.ClientTextUI.fieldsComponent.template,/ctNamedFormGrid/);assert.match(window.ClientTextUI.fieldsComponent.template,/<th>Form<\/th><th>Translation<\/th>/);
    app.ctValues[normal.id]='NON';const input=inputFor(original,normal);input.focus();input.setSelectionRange(3,3);
    assert.equal(app.ctSuggest(normal,{target:input}),false);assert.equal(app.ctSuggest(normal,{target:input},{manual:true}),true);
    assert.equal(app.ctCompletion.items.some(item=>item.replaceWholeField),false);
    const injected={value:'NONEXISTENT',replaceWholeField:true};app.ctCompletion.items.push(injected);app.ctCompletion.start=0;app.ctCompletion.end=3;
    assert.equal(app.ctApplyCompletion(normal,injected,input),false,'stale/manual whole-field sentinel items cannot expand named forms');assert.equal(app.ctValues[normal.id],'NON');
    app.ctCloseCompletion();
    await app.ctTargetKeydown(normal,event(normal,'Tab'));assert.equal(focuses.at(-1).fieldId,possessive.id);assert.equal(app.ctValues[normal.id],'NON');
    await app.ctTargetKeydown(possessive,event(possessive,'Tab',{shiftKey:true}));assert.equal(focuses.at(-1).fieldId,normal.id);
    app.ctValues[normal.id]='NONEXISTENT';app.ctSaved={[original.id]:{values:{...app.ctValues}}};
    assert.ok(app.ctAnalyzeScanUnit(original,{variables:true}).some(issue=>issue.fieldId===normal.id),'named forms still compare required variables in committed values');
});

test('possessive preview parameters survive editor handoff, reset on entry selection and clear on scope fencing',async()=>{
    const original=namedFormUnit(),emerald=namedFormUnit('Emerald',3);
    for(const field of emerald.fields)field.source='Emerald';
    const {app}=keyboardHarness(original,{ctWorkspace:{scope:{...scope,language:'Turkish'}}});
    app._ctUnitIndex.set(emerald.id,emerald);app.ctUnits.push(emerald);
    app.ctPreviewAffixes.prefix='Custom prefix';app.ctPreviewAffixes.suffix='Custom suffix';app.ctPreviewGggVars={'0':'37'};
    const parameters=app.ctPreviewAffixes;
    await app.ctSelect(original,true);assert.equal(app.ctPreviewAffixes,parameters);assert.equal(app.ctPreviewGggVars['0'],'37');
    await app.ctSelect(original,false);assert.equal(app.ctPreviewAffixes,parameters);
    await app.ctSelect(emerald,false);
    assert.deepEqual(clone(app.ctPreviewAffixes),{example:'emerald',prefix:'Korkusuz',suffix:'Ölümsüzlük'});
    assert.deepEqual(clone(app.ctPreviewGggVars),{});
    app.ctFence();assert.deepEqual(clone(app.ctPreviewAffixes),{example:'sword',prefix:'Dayanıklı',suffix:'Alev'});
});

test('named forms save independently without changing immutable originals and learn separate Translation Memory contexts',async()=>{
    const original=namedFormUnit(),before=clone(original),[normal,possessive]=original.fields,f=fixture();
    await f.store.import(scope,{units:[original],assets:[asset]});const retainedBefore=await f.store.getUnit(scope,original.id);
    const {app}=visibleFieldsHarness(original,{ctDraftDirty:true});app._ctStore=f.store;app.ctSync=()=>{};app.ctLoadMemory=()=>{};
    app.ctValues[normal.id]='Authored normal {0}';assert.equal(await app.ctSave(),true);
    const saved=(await f.store.getSaved(scope))[original.id],history=await f.store.listHistory(scope,original.id);
    assert.equal(saved.values[normal.id],'Authored normal {0}');assert.equal(saved.values[possessive.id],before.fields[1].target);
    assert.equal(history.at(-1).after.values[possessive.id],before.fields[1].target);assert.deepEqual(await f.store.getUnit(scope,original.id),retainedBefore);assert.deepEqual(original,before);
    const adapter=require('../public/contentAdapters.js'),memory=adapter.clienttext.memoryUnits(original,saved.values,scope.language,{game:scope.game,saved});
    assert.deepEqual(memory.map(match=>match.context.form),['Normal Translation','Possessive Translation']);assert.notEqual(memory[0].id,memory[1].id);
    assert.deepEqual(adapter.clienttext.findMemory(memory,original,normal,{game:scope.game}).map(match=>match.target),['Authored normal {0}']);
    assert.deepEqual(adapter.clienttext.findMemory(memory,original,possessive,{game:scope.game}).map(match=>match.target),[before.fields[1].target]);
});

test('Russian Gender suggestions use observed codes and retain raw custom originals in both editor modes',()=>{
    for(const full of [false,true])for(const value of ['M','MS','F','  custom\tvalue  ',' ',' first\r\nsecond\n ']){
        const original=worksheetUnit(),gender=original.fields.find(field=>field.kind==='gender');gender.target=value;
        const {app}=keyboardHarness(original,{ctEditor:full,lang:'Thai',ctWorkspace:{scope:{...scope,language:'Russian'}}});
        const suggestions=Array.from(app.ctGenderSuggestions(gender));assert.deepEqual(suggestions.slice(0,7),['MS','FS','NS','MP','FP','NP','M']);
        assert.equal(app.ctValues[gender.id],value);if(!/[\r\n]/.test(value))assert.ok(suggestions.includes(value));
        if(value===' ')assert.equal(app.ctGenderSuggestionLabel(value,gender),'Original value (1 space)');
        if(value==='F')assert.equal(app.ctGenderSuggestionLabel(value,gender),'Original value: F');
    }
});

test('named literal NONEXISTENT participates in Lookup and consistency while legacy text sentinels stay excluded',async()=>{
    const first=namedFormUnit('First'),second=namedFormUnit('Second');
    for(const original of [first,second])for(const field of original.fields)field.source='Exalted Orb';
    second.fields[0].target='NONEXISTENT';
    const {app}=visibleFieldsHarness(first,{ctUnits:[first,second],_ctUnitIndex:new Map([[first.id,first],[second.id,second]]),ctLookup:'Exalted',ctFocusedField:first.fields[0].id});
    assert.deepEqual(Array.from(app.ctLookupResults,result=>result.target),['NONEXISTENT']);
    assert.equal(await app.ctScan({consistency:true,variables:false,whitespace:false,dash:false,tagSyntax:false,keywords:false,decorations:false,substitutions:false,controls:false,terminology:false}),true);
    assert.ok(app.ctDiagnostics[first.id].some(issue=>issue.code==='clienttext-consistency' && issue.fieldId===first.fields[0].id));
    assert.ok(app.ctDiagnostics[second.id].some(issue=>issue.code==='clienttext-consistency' && issue.fieldId===second.fields[0].id));
    for(const original of [first,second])for(const field of original.fields){field.kind='text';field.form=null;}
    app._ctVisibleFields=null;assert.equal(app.ctLookupResults.some(result=>result.target==='NONEXISTENT'),false);
});

const CLASS_VARIANT_FORMS=['StrFour','IntFour','DexFour','StrDexFour','DexIntFour','StrIntFour',
    'StrFourb','IntFourb','DexFourb','StrDexFourb','DexIntFourb','StrIntFourb'];
function classVariantUnit(id='ClassVariants',row=2){
    const original=namedUnit(id),base=original.fields[0],source='English [Keyword] {0}\nraw@literal\\n';
    original.role='gender';original.id=JSON.stringify(['gender','NPCTextAudio_Gender',id]);original.sheet='NPCTextAudio_Gender';
    original.fields=['MS','FS',...CLASS_VARIANT_FORMS].map((form,index)=>({...base,id:JSON.stringify(['Text',form]),name:'Text',kind:'form',form,group:'Text',
        source,target:form==='MS'?'Default [Keyword] {0}':form==='FS'?'Default feminine [Keyword] {0}':form==='StrFourb'?'Populated [Keyword] {0}':form==='DexFourb'?'Other [Keyword] {0}':'',
        required:form==='MS'||form==='FS'||form==='IntFourb',originalMissing:form==='IntFourb',outdated:form==='StrFourb',sourceCell:'C'+row,
        targetCell:String.fromCharCode(68+index)+row}));return original;
}

function characterNameUnit(form,source,options={}){
    const role=options.role || 'normal',sheet=options.sheet || 'Characters',attribute=form.replace(/Fourb?$/,''),
        recordId=options.recordId || 'Metadata/Characters/'+attribute+'/'+form,
        original=namedUnit(recordId,source,'Localized class text');
    original.role=role;original.sheet=sheet;original.recordId=recordId;original.id=JSON.stringify([role,sheet,recordId]);
    original.fields=[{...original.fields[0],id:JSON.stringify(['Name',role==='gender'?'MS':null]),name:'Name',
        kind:role==='gender'?'form':'text',form:role==='gender'?'MS':undefined,group:'Name',source}];
    return original;
}

test('class variant names default to English Characters Name source and preserve every raw worksheet identity',()=>{
    const original=classVariantUnit(),ranger=characterNameUnit('DexFour','Ranger'),huntress=characterNameUnit('DexFourb','Huntress'),
        {app}=keyboardHarness(original,{ctUnits:[original,ranger,huntress]});app.ctInitializeVariants();
    const group=app.ctFieldGroups[0],dex=group.fields.find(field=>field.form==='DexFour'),dexb=group.fields.find(field=>field.form==='DexFourb');
    assert.notEqual(app.mapClientTextClassNames,false,'an absent legacy setting keeps class name mapping enabled');
    assert.equal(app.ctClassVariantName(dex),'Ranger');assert.equal(app.ctClassVariantName(dexb),'Huntress');
    assert.equal(app.ctClassVariantLabel(dex),'Ranger (DexFour)');assert.equal(app.ctVariantLabel(dex),'Ranger (DexFour) (blank)');
    assert.equal(app.ctVariantLabel(dexb),'Huntress (DexFourb)');
    assert.equal(app.ctHistoryFieldLabel(dex),'Text · Ranger (DexFour)');
    assert.equal(app.ctHistoryFieldLabel(dexb),'Text · Huntress (DexFourb)');
    assert.equal(app.ctFieldController(dex).field.dataAttrs['aria-label'],'Text Ranger (DexFour)');
    assert.equal(app.ctScanIssueLocation({fieldName:'Text',form:'DexFour',line:0}),'Text · Ranger (DexFour) · line 1');
    assert.ok(app.ctGroupSources(group)[0].names.includes('Ranger (DexFour)'));
    assert.notEqual(dex.id,dexb.id);assert.equal(app.ctSelectVariant(group,dex.id,{focus:false}),true);
    assert.equal(app.ctSelectedVariant(group),dex);assert.equal(app.ctSelectVariant(group,dexb.id,{focus:false}),true);
    assert.equal(app.ctSelectedVariant(group),dexb,'mapped names never coalesce Four and Fourb worksheet fields');
});

test('class name display setting toggles without changing immutable originals, saved values, drafts, diagnostics or selection',()=>{
    const original=classVariantUnit(),ranger=characterNameUnit('DexFour','Ranger'),units=[original,ranger],snapshot=clone(units),
        {app,inputFor}=keyboardHarness(original,{ctUnits:units,mapClientTextClassNames:true});app.ctInitializeVariants();
    const group=app.ctFieldGroups[0],dex=group.fields.find(field=>field.form==='DexFour');app.ctSelectVariant(group,dex.id,{focus:false});
    app.ctValues[dex.id]='Draft @ raw\\n\nvalue';app.ctDraftDirty=true;
    app.ctSaved={[original.id]:{values:{[dex.id]:'Committed raw text'},revision:4},[ranger.id]:{values:{[ranger.fields[0].id]:'Edited class label'},revision:3}};
    app.ctDiagnostics={[original.id]:[{fieldId:dex.id,severity:'warning',message:'Preserved finding'}]};
    const input=inputFor(original,dex);input.focus();input.setSelectionRange(3,8,'backward');
    const saved=app.ctSaved,values=app.ctValues,diagnostics=app.ctDiagnostics,selections=app.ctVariantSelections,
        before=clone({saved,values,diagnostics,selections,focused:app.ctFocusedField,selected:app.ctSelection,dirty:app.ctDraftDirty});
    assert.equal(app.ctVariantLabel(dex),'Ranger (DexFour) · Warning');
    app.mapClientTextClassNames=false;assert.equal(app.ctClassVariantName(dex),'DexFour');
    assert.equal(app.ctVariantLabel(dex),'DexFour · Warning');assert.equal(app.ctHistoryFieldLabel(dex),'Text · DexFour');
    assert.equal(app.ctFieldController(dex).field.dataAttrs['aria-label'],'Text DexFour');
    app.mapClientTextClassNames=true;assert.equal(app.ctVariantLabel(dex),'Ranger (DexFour) · Warning');
    assert.deepEqual(units,snapshot);assert.equal(app.ctSaved,saved);assert.equal(app.ctValues,values);
    assert.equal(app.ctDiagnostics,diagnostics);assert.equal(app.ctVariantSelections,selections);
    assert.deepEqual(clone({saved:app.ctSaved,values:app.ctValues,diagnostics:app.ctDiagnostics,selections:app.ctVariantSelections,
        focused:app.ctFocusedField,selected:app.ctSelection,dirty:app.ctDraftDirty}),before);
    assert.deepEqual({start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection},{start:3,end:8,direction:'backward'});
});

test('class name mapping safely falls back for unavailable, blank and unrelated Characters records',()=>{
    const original=classVariantUnit(),dex=original.fields.find(field=>field.form==='DexFour'),blank=characterNameUnit('DexFour',' \t\n'),
        otherSheet=characterNameUnit('DexFour','Wrong sheet',{sheet:'CharacterNames'}),
        otherPath=characterNameUnit('DexFour','Wrong metadata',{recordId:'Metadata/Other/DexFour'}),
        {app}=keyboardHarness(original,{ctUnits:[original,blank,otherSheet,otherPath]});
    assert.equal(app.ctClassVariantName(dex),'DexFour');assert.equal(app.ctClassVariantLabel(dex),'DexFour');
    const wrongField=characterNameUnit('DexFour','Wrong field');wrongField.fields[0].name='Description';
    app.ctUnits=[original,otherSheet,otherPath,wrongField];assert.equal(app.ctClassVariantName(dex),'DexFour');
    app.ctUnits=[original,characterNameUnit('DexFour','Wrong attribute',{recordId:'Metadata/Characters/Int/DexFour'})];
    assert.equal(app.ctClassVariantName(dex),'DexFour');
    app.ctUnits=[original,characterNameUnit('DexFour','NONEXISTENT')];assert.equal(app.ctClassVariantName(dex),'DexFour');
    const duplicate=characterNameUnit('DexFour','Duplicate field');duplicate.fields.push({...duplicate.fields[0],source:'Other class'});
    app.ctUnits=[original,duplicate];assert.equal(app.ctClassVariantName(dex),'DexFour');
    app.ctUnits=[original];assert.equal(app.ctClassVariantName(dex),'DexFour');
    assert.equal(app.ctClassVariantName(original.fields[0]),'MS','ordinary gender forms keep their raw label');
});

test('class name mapping prefers normal Characters names and can use an explicit gender MS source',()=>{
    const original=classVariantUnit(),dex=original.fields.find(field=>field.form==='DexFour'),normal=characterNameUnit('DexFour','Ranger'),
        gender=characterNameUnit('DexFour','Gender Ranger',{role:'gender'}),{app}=keyboardHarness(original,{ctUnits:[original,gender,normal]});
    assert.equal(app.ctClassVariantName(dex),'Ranger');app.ctUnits=[original,gender];assert.equal(app.ctClassVariantName(dex),'Gender Ranger');
    app.ctUnits=[original,characterNameUnit('DexFour',''),gender];
    assert.equal(app.ctClassVariantName(dex),'DexFour','a present normal Characters row with no name cannot borrow the gender fallback');
    const feminine=characterNameUnit('DexFour','Feminine only',{role:'gender'});feminine.fields[0].form='FS';
    app.ctUnits=[original,feminine];assert.equal(app.ctClassVariantName(dex),'DexFour','there is no inferred class name without Name MS');
});

test('class name mapping rejects conflicting Characters names and rebuilds for replacement units and workspace scope',()=>{
    const original=classVariantUnit(),dex=original.fields.find(field=>field.form==='DexFour'),ranger=characterNameUnit('DexFour','Ranger'),
        conflict=characterNameUnit('DexFour','Conflicting class'),{app}=keyboardHarness(original,{ctUnits:[original,ranger,conflict]});
    assert.equal(app.ctClassVariantName(dex),'DexFour','an ambiguous class name retains the raw code');
    app.ctUnits=[original,ranger];assert.equal(app.ctClassVariantName(dex),'Ranger');
    const units=app.ctUnits;units[1]=characterNameUnit('DexFour','Next source class');
    app.ctWorkspace={scope:{...scope,versionId:'next-version'}};
    assert.equal(app.ctClassVariantName(dex),'Next source class','a new workspace rebuilds its class lookup even when units retain their array identity');
    app.ctFence();app.ctActive=true;app.ctUnits=[original,characterNameUnit('DexFour','Reopened class')];
    assert.equal(app.ctClassVariantName(dex),'Reopened class');
});

test('class variants use one raw English group, populated tabs and always-visible defaults without changing standard forms',async()=>{
    const original=classVariantUnit(),snapshot=clone(original),{app}=keyboardHarness(original,{ctSelection:'',ctValues:{}});
    assert.equal(await app.ctSelect(original,false,{focus:false}),true);const group=app.ctFieldGroups[0];
    assert.equal(app.ctGroupSources(group).length,1);assert.equal(app.ctGroupSources(group)[0].text,original.fields[0].source);
    assert.deepEqual(Array.from(app.ctClassFields(group),field=>field.form),CLASS_VARIANT_FORMS);
    assert.deepEqual(Array.from(app.ctDefaultForms(group),field=>field.form),['MS','FS']);
    assert.deepEqual(Array.from(app.ctPopulatedVariants(group),field=>field.form),['StrFourb','DexFourb']);
    assert.equal(app.ctSelectedVariant(group).form,'StrFourb');assert.equal(app.ctFocusedField,original.fields[0].id);
    assert.deepEqual(Array.from(app.ctTargetInputs(),input=>input.dataset.ctTarget),[original.fields[0].id,original.fields[1].id,app.ctSelectedVariant(group).id]);
    assert.equal(app.ctDraftDirty,false);assert.deepEqual(original,snapshot);
    const standard=keyboardHarness();
    assert.equal(standard.app.ctDisplayedFields().length,standard.app.ctFieldsFor().length);
});

for(const opening of ['inline click','full click','row Enter','double-click'])for(const reopening of [false,true])
test(`${opening} ${reopening?'reopens':'opens'} visible defaults at the first worksheet form`,async()=>{
    const original=classVariantUnit(),snapshot=clone(original),full=opening!=='inline click',
        {app,focuses,inputFor}=keyboardHarness(original,{inlineEditor:opening!=='full click'});
    app.ctInitializeVariants(original);
    const group=app.ctFieldGroups[0],selected=app.ctSelectedVariant(group),first=original.fields[0];
    if(reopening){inputFor(original,selected).focus();app.ctInlineClosed=true;}
    else app.ctSelection='';
    if(reopening)assert.equal(app.ctDisplayedFields().includes(first),true);
    const values=app.ctValues,reviewed=app.ctReviewed,choices=app.ctChoices,saved=app.ctSaved;
    const opened=opening==='row Enter'?await app.ctRowKeydown(original,rowEvent('Enter'))
        :await app[opening==='double-click'?'ctRowDoubleClick':'ctRowClick'](original,rowEvent(''));
    assert.equal(opened,true);assert.equal(app.ctEditor,full);assert.equal(app.ctInlineClosed,false);
    assert.equal(app.ctDisplayedFields().includes(first),true);assert.equal(app.ctFocusedField,first.id);
    assert.equal(focuses.at(-1).fieldId,first.id);assert.equal(app.ctSelectedVariant(app.ctFieldGroups[0]),selected);
    assert.equal(app.ctTargetInputs()[0].dataset.ctTarget,first.id);assert.equal(app.ctDraftDirty,false);
    if(reopening){assert.equal(app.ctValues,values);assert.equal(app.ctReviewed,reviewed);assert.equal(app.ctChoices,choices);}
    assert.equal(app.ctSaved,saved);assert.deepEqual(original,snapshot);
});

test('per-ID variant selections retain exact blank choices and visible defaults across full/inline and revisit, then fence by scope',async()=>{
    const first=classVariantUnit('First'),second=classVariantUnit('Second',3),{app}=keyboardHarness(first,{ctUnits:[first,second],
        _ctUnitIndex:new Map([[first.id,first],[second.id,second]])});app.ctInitializeVariants();
    const group=app.ctFieldGroups[0],blank=group.fields.find(field=>field.form==='IntFour');
    assert.equal(app.ctSelectVariant(group,blank.id,{focus:false}),true);assert.equal(app.ctSelectedVariant(group),blank);
    assert.equal(app.ctDefaultForms(group).every(field=>app.ctDisplayedFields().includes(field)),true);
    assert.equal(await app.ctSelect(first,true,{focus:false}),true);assert.equal(app.ctSelectedVariant(app.ctFieldGroups[0]),blank);
    assert.equal(await app.ctSelect(second,false,{focus:false}),true);
    assert.equal(app.ctDefaultForms(app.ctFieldGroups[0]).every(field=>app.ctDisplayedFields().includes(field)),true);
    assert.equal(app.ctSelectedVariant(app.ctFieldGroups[0]).form,'StrFourb');
    assert.equal(await app.ctSelect(first,false,{focus:false}),true);assert.equal(app.ctSelectedVariant(app.ctFieldGroups[0]),blank);
    assert.equal(app.ctDefaultForms(app.ctFieldGroups[0]).every(field=>app.ctDisplayedFields().includes(field)),true);app.ctValues[blank.id]='\tcustom@literal\\n\n';app.ctValues[blank.id]='';
    assert.equal(app.ctSelectedVariant(app.ctFieldGroups[0]),blank,'clearing the selected cell never silently changes its variant');
    const obsolete=app.ctFieldGroups[0];app.ctFence();assert.equal(Object.keys(app.ctVariantSelections).length,0);
    assert.equal(app.ctSelectVariant(obsolete,blank.id),false);
});

test('hidden blank variants expose committed workload, missing/outdated facts and manual diagnostics through picker labels and summaries',()=>{
    const {app}=keyboardHarness(classVariantUnit());app.ctInitializeVariants();const group=app.ctFieldGroups[0],
        missing=group.fields.find(field=>field.form==='IntFourb'),optional=group.fields.find(field=>field.form==='IntFour'),
        outdated=group.fields.find(field=>field.form==='StrFourb');
    app.ctDiagnostics={[app.ctSelection]:[{fieldId:optional.id,severity:'warning',message:'Preserved manual finding'}]};
    assert.equal(app.ctVariantLabel(missing),'IntFourb (blank) · Missing');
    assert.equal(app.ctVariantLabel(optional),'IntFour (blank) · Warning');assert.equal(app.ctVariantFacts(optional).missing,false);
    assert.equal(app.ctVariantLabel(outdated),'StrFourb · Outdated');
    assert.equal(app.ctVariantSummary(app.ctClassFields(group)),'2 Workload · 1 Missing · 1 Outdated · 1 Warning');
    const diagnostics=app.ctDiagnostics;app.ctSelectVariant(group,optional.id,{focus:false});
    assert.equal(app.ctDiagnostics,diagnostics,'display changes do not rerun or clear completed diagnostics');
    app.ctFocusSource(group,app.ctGroupSources(group)[0]);
    assert.equal(app.ctPreviewField,optional,'English focus preserves the current class variant');
    app.ctFocusedField=group.fields[0].id;app.ctFocusSource(group,app.ctGroupSources(group)[0]);
    assert.equal(app.ctPreviewField,group.fields[0],'English focus preserves the current visible default form');
});

test('class-field translation choices identify the exact form instead of repeating only the English heading',()=>{
    const {app,window}=keyboardHarness(classVariantUnit()),group=app.ctFieldGroups[0],str=group.fields.find(field=>field.form==='StrFourb'),
        dex=group.fields.find(field=>field.form==='DexFourb');
    assert.equal(app.ctHistoryFieldLabel(str),'Text · StrFourb');assert.equal(app.ctHistoryFieldLabel(dex),'Text · DexFourb');
    assert.match(window.ClientTextUI.fieldsComponent.template,/Translation choice · \{\{ host\.ctHistoryFieldLabel\(/);
});

for(const full of [false,true])test(`class variant ${full?'full':'inline'} Tab reveals every worksheet field in order and never focuses a hidden target`,async()=>{
    const original=classVariantUnit(),{app,inputFor,event,focuses}=keyboardHarness(original,{ctEditor:full});app.ctInitializeVariants();
    const group=app.ctFieldGroups[0],firstClass=app.ctClassFields(group)[0];let saves=0;app.ctSaveAndNavigate=()=>saves++;
    app.ctSelectVariant(group,firstClass.id,{focus:false});inputFor(original,firstClass).focus();
    const back=event(firstClass,'Tab',{shiftKey:true});await app.ctTargetKeydown(firstClass,back);
    assert.equal(app.ctDisplayedFields().includes(original.fields[1]),true);assert.equal(focuses.at(-1).fieldId,original.fields[1].id);
    for(let index=1;index<original.fields.length-1;index++){
        const field=original.fields[index],next=original.fields[index+1];inputFor(original,field).focus();
        const key=event(field,'Tab');await app.ctTargetKeydown(field,key);assert.equal(key.defaultPrevented,true);
        assert.equal(focuses.at(-1).fieldId,next.id);assert.equal(app.ctDisplayedFields().includes(next),true);
        assert.equal(app.ctTargetInputs().includes(inputFor(original,next)),true);
        if(CLASS_VARIANT_FORMS.includes(next.form))assert.equal(app.ctSelectedVariant(group),next);
    }
    const hidden=firstClass,key=event(hidden,'Tab'),count=focuses.length;app.ctTargetKeydown(hidden,key);
    assert.equal(key.defaultPrevented,undefined);assert.equal(focuses.length,count,'an obsolete hidden input cannot navigate the current editor');
    assert.equal(saves,0);assert.equal(app.ctSelection,original.id);
});

test('delayed hidden-variant focus is fenced by scope, unit, selection run, overlay and newer focus',async()=>{
    for(const changed of ['account','group','unit','run','overlay','focus']){
        const original=classVariantUnit(),{app,window,inputFor,focuses}=keyboardHarness(original);app.ctInitializeVariants();
        const callbacks=[];app.$nextTick=callback=>{callbacks.push(callback);return Promise.resolve();};
        const group=app.ctFieldGroups[0],field=app.ctClassFields(group)[0],source=inputFor(original,app.ctSelectedVariant(group));source.focus();
        assert.equal(app.ctSelectVariant(group,field.id),true);const before=focuses.length;
        if(changed==='account')app.ctWorkspace={scope:{...scope,accountId:'other'}};
        if(changed==='group')app.ctWorkspace={scope:{...scope,groupId:'other'}};
        if(changed==='unit'){const next=classVariantUnit();app._ctUnitIndex=new Map([[next.id,next]]);}
        if(changed==='run')app._ctSelectRun={};if(changed==='overlay')app.cloudHistoryVisible=true;
        if(changed==='focus')window.document.activeElement={dataset:{},focus(){}};
        for(const callback of callbacks)callback?.();assert.equal(focuses.length,before,changed);
    }
});

test('class variant inline/full handoff keeps the selected raw field and exact caret while hidden values save atomically',async()=>{
    const original=classVariantUnit(),f=fixture();await f.store.import(scope,{units:[original],assets:[{...asset,role:'gender'}]});
    const {app,inputFor,event,focuses}=keyboardHarness(original);app._ctStore=f.store;app.ctInitializeVariants();app.ctSync=()=>{};app.ctLoadMemory=()=>{};
    const group=app.ctFieldGroups[0],selected=group.fields.find(field=>field.form==='DexFourb'),hidden=group.fields.find(field=>field.form==='IntFour');
    app.ctSelectVariant(group,selected.id,{focus:false});app.ctValues[selected.id]='raw@literal\\n\n[Keyword] {0}';
    app.ctValues[hidden.id]='hidden@literal\\n\n[Keyword] {0}';app.ctDraftDirty=true;
    const input=inputFor(original,selected);input.focus();input.setSelectionRange(2,6,'backward');
    await app.ctTargetKeydown(selected,event(selected,'Enter',{ctrlKey:true}));assert.equal(app.ctEditor,true);
    assert.equal(app.ctSelectedVariant(app.ctFieldGroups[0]),selected);assert.equal(focuses.at(-1).fieldId,selected.id);
    assert.equal(await app.ctCloseEditor(),true);assert.equal(app.ctEditor,false);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,6);
    assert.equal(await app.ctSave(),true);const saved=(await f.store.getSaved(scope))[original.id],history=await f.store.listHistory(scope,original.id);
    assert.equal(saved.values[selected.id],'raw@literal\\n\n[Keyword] {0}');assert.equal(saved.values[hidden.id],'hidden@literal\\n\n[Keyword] {0}');
    assert.equal(Object.keys(saved.values).length,14);assert.deepEqual(history.at(-1).after.values,saved.values);
    assert.equal((await f.store.getUnit(scope,original.id)).fields.find(field=>field.id===hidden.id).target,'');
});

test('selected class variants keep the existing keyword/variable completion, NONEXISTENT and preview context',async()=>{
    const {app,inputFor,event}=keyboardHarness(classVariantUnit());app.ctInitializeVariants();
    const group=app.ctFieldGroups[0],field=group.fields.find(field=>field.form==='IntFour');app.ctSelectVariant(group,field.id,{focus:false});
    const input=inputFor(app.ctCurrentUnit,field);input.focus();app.ctQueueDraft=()=>{};
    app.ctValues[field.id]='@literal\\n\n[';input.setSelectionRange(app.ctValues[field.id].length,app.ctValues[field.id].length);
    assert.equal(app.ctSuggest(field,{target:input}),true);app.ctTargetKeydown(field,event(field,'Tab'));
    assert.equal(app.ctValues[field.id],'@literal\\n\n[Keyword]');assert.equal(app.ctPreviewField,field);
    assert.equal(app.ctReviewed[field.id],S.sourceHash(field.source));
    app.ctValues[field.id]='NON';input.setSelectionRange(3,3);app.ctTargetKeydown(field,event(field,'Tab'));
    assert.equal(app.ctValues[field.id],'NONEXISTENT');assert.equal(app.ctSelectedVariant(group),field);
    assert.equal(app.ctPreviewField,field);assert.equal(app.ctDraftDirty,true);
});
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
    const controller=app.ctDictionaryController;assert.equal(controller.dictionaryCanUse,true);
    const plainEnter=rowEvent('Enter');controller.onDictionaryReplaceEnter(plainEnter,word);
    assert.equal(plainEnter.defaultPrevented,undefined);assert.equal(app.ctValues[field.id],input.value,'plain Enter in Replace does not insert a translation');
    for(const composing of [{isComposing:true},{keyCode:229}]){
        const event={...rowEvent('Enter'),ctrlKey:true,...composing};assert.equal(controller.onDictionaryReplaceEnter(event,word),false);
        assert.equal(event.defaultPrevented,undefined);assert.equal(app.ctValues[field.id],input.value);
    }
    assert.equal(controller.useDictionaryTranslation(word),true);assert.equal(app.ctValues[field.id],'Before '+word.replace+' after');assert.equal(input.focused,true);assert.equal(app.ctDraftDirty,true);
    input.value=app.ctValues[field.id];input.selectionStart=0;input.selectionEnd=input.value.length;
    const controlEnter={...rowEvent('Enter'),ctrlKey:true};
    assert.equal(controller.onDictionaryReplaceEnter(controlEnter,word,word.alts[0]),true);assert.equal(controlEnter.defaultPrevented,true);assert.equal(app.ctValues[field.id],'Autre\ntexte');
    input.value=app.ctValues[field.id];input.selectionStart=0;input.selectionEnd=input.value.length;
    const commandEnter={...rowEvent('Enter'),metaKey:true};
    assert.equal(controller.onDictionaryReplaceEnter(commandEnter,word),true);assert.equal(commandEnter.defaultPrevented,true);assert.equal(app.ctValues[field.id],word.replace);
    input.value=app.ctValues[field.id];input.selectionStart=input.selectionEnd=0;
    app.ctWorkspace.scope.groupId='replacement-group';assert.equal(controller.onDictionaryReplaceEnter(controlEnter,word),false);assert.equal(app.ctValues[field.id],word.replace);
    const gender=app.ctDictionaryController;field.kind='gender';assert.equal(gender.dictionaryCanUse,false);assert.equal(gender.useDictionaryTranslation(word),false);
});
test('SD and ClientText share single-line Dictionary inputs and retain multiline TL notes',()=>{
    const {window}=harness(),shared=window.EditorComponents.DictionaryEntries.template,tools=window.ClientTextUI.toolsComponent,
        html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
    assert.equal(tools,window.EditorComponents.Tools,'both content modes use the same tools component');
    assert.match(tools.template,/<editor-dictionary-entries v-if="sideTab === 'dictionary'" :controller="\$props.controller">/);
    assert.match(html,/<editor-tools v-if="sharedEditorToolsMounted" :target="sharedEditorToolsTarget" :controller="sharedEditorController">/);
    for(const feature of ['dictRow','dictScopeSelect','dictHistoryBtn','dictAltRow','dictTlnote','dictDeleteBtn'])assert.equal(shared.includes(feature),true);
    for(const value of ['word.find','word.replace','alt.find','alt.replace'])assert.ok(shared.includes('<input type="text" v-model="'+value+'"'),'both modes share input geometry for '+value);
    assert.match(shared,/@keydown.enter="controller.onDictionaryReplaceEnter\(\$event,word\)"/);
    assert.match(shared,/@keydown.enter="controller.onDictionaryReplaceEnter\(\$event,word,alt\)"/);
    assert.match(shared,/<textarea rows="3" v-model="word.tlnote"/);
    assert.equal((shared.match(/<textarea\b/g) || []).length,1,'only TL note remains a textarea');
    assert.doesNotMatch(shared,/dictionaryMultiline|v-html/);
    for(const feature of ['Search dictionary entries','Add entry','Previous dictionary page','Next dictionary page','Matches in this file first'])assert.equal(tools.template.includes(feature),true);
});
test('shared field components preserve distinct form sources and autosizing changes layout only',()=>{
    const {app,window}=listHarness(),rawText='@literal\\nactual\nไทย',field={value:rawText,scrollHeight:96,scrollTop:15,selectionStart:3,selectionEnd:7,style:{}};
    app.ctResizeField(field);assert.equal(field.style.height,'98px');assert.equal(field.value,rawText);assert.equal(field.selectionStart,3);assert.equal(field.selectionEnd,7);assert.equal(field.scrollTop,15);
    const groups=app.ctGroupSources({name:'Text',fields:[{id:'m',form:'MS',source:'Masculine'},{id:'f',form:'FS',source:'Feminine'}]});
    assert.deepEqual(Array.from(groups,entry=>entry.text),['Masculine','Feminine']);assert.deepEqual(Array.from(groups,entry=>entry.label),['MS','FS']);
    const fields=window.ClientTextUI.fieldsComponent,target=window.ClientTextUI.targetComponent,tools=window.ClientTextUI.toolsComponent;
    assert.equal(fields.props.side.default,'both');assert.match(fields.template,/side !== 'translation'/);assert.match(fields.template,/side !== 'source'/);
    assert.match(fields.template,/<editor-native-field :controller="host.ctSourceFieldController\(group,source\)" kind="english"/);
    assert.match(fields.template,/field.kind !== 'gender' \|\| field.source/,'blank enum metadata has no fake English textarea');
    assert.match(target.template,/<editor-native-field v-else :controller="host.ctFieldController\(field\)" kind="translation"/);
    const raw='Masculine@literal\\n\r\nraw',rawField={...app.ctCurrentUnit.fields[0],source:raw};app.ctCurrentUnit.fields=[rawField];app.ctValues=S.valuesFor(app.ctCurrentUnit);app.ctDisplayedFields=()=>[rawField];
    const controller=app.ctSourceFieldController({fields:[rawField]},{key:rawField.id,text:raw});assert.equal(controller.field.english,raw);assert.equal(controller.field.readonly,true);
    assert.match(window.EditorComponents.NativeField.template,/:value="nativeValue"[^>]* readonly/);
    assert.match(window.EditorComponents.NativeField.template,/class="HLter"/);
    assert.match(tools.template,/side sharedEditorSidebar/);assert.match(tools.template,/ctTools: historyClientText/);assert.match(tools.template,/sideHeader/);assert.match(tools.template,/sideTabs/);assert.match(tools.template,/aria-controls="tmResultsPanel"/);
    assert.match(tools.template,/<editor-lookup-panel :controller="\$props.controller"/);assert.match(window.EditorComponents.Lookup.template,/class="lookupResults"/,'Lookup follows the shared scroll layout');
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

for(const full of [false,true])test('ClientText attention navigation skips complete context and occupied rows across pages '+(full?'full':'inline'),async()=>{
    const rows=Array.from({length:6},(_,index)=>worksheetUnit('Attention'+index,index+2));
    rows[1].fields[0].target='';rows[1].fields[0].required=true;rows[3].fields[0].outdated=true;
    const {app,focuses}=keyboardHarness(rows[0],{ctUnits:rows,ctEditor:full,pageSize:2,
        _ctUnitIndex:new Map(rows.map(unit=>[unit.id,unit])),ctPeers:[{unitId:rows[1].id,sessionId:'other'}],
        ctDiagnostics:{[rows[4].id]:[{severity:'warning'}],[rows[5].id]:[{severity:'error'}]}}),filters=app.ctSelectedFilters;
    app.ctSave=async()=>true;
    assert.equal(await app.ctSaveAndNavigate(false,{attentionOnly:true,inline:!full}),true);
    assert.equal(app.ctSelection,rows[3].id);assert.equal(app.ctPage,2);assert.equal(app.ctEditor,full);
    assert.equal(app.ctNavigationBusy,false);
    assert.equal(focuses.at(-1).unitId,rows[3].id);assert.equal(app.ctSelectedFilters,filters);
    assert.equal(await app.ctSaveAndNavigate(false,{attentionOnly:true,inline:!full}),true);assert.equal(app.ctSelection,rows[4].id);
    assert.equal(await app.ctSaveAndNavigate(false,{attentionOnly:true,inline:!full}),true);assert.equal(app.ctSelection,rows[5].id);
    let saves=0;app.ctSave=async()=>{saves++;return true;};app.ctValues[rows[5].fields[0].id]='unsaved at boundary';
    assert.equal(await app.ctSaveAndNavigate(false,{attentionOnly:true,inline:!full}),false);assert.equal(saves,0);assert.equal(app.ctNavigationBusy,false);
    assert.equal(await app.ctSaveAndNavigate(true,{attentionOnly:true,inline:!full}),true);assert.equal(app.ctSelection,rows[4].id);
});

test('ClientText attention navigation stays inside NPC and Convo groups with unchanged context selected',async()=>{
    for(const mode of ['npcs','convo']){
        const h=mode==='npcs'?npcUiHarness():convoUiHarness(),{app,window}=h;
        app.ctBrowseMode=mode;app.ctSelection='';app.inlineEditor=false;app.ctPage=1;
        const candidates=window.EditorSession.attentionCandidates(app,1);
        assert.ok(candidates.length);assert.ok(candidates.every(unit=>app.ctBrowseOrderedUnits().includes(unit) && app.ctNeedsAttention(unit)));
        if(mode==='npcs')app.ctNpcSelection='renly';else app.ctConvoSelection=app.ctConvoNodeKey('family','RenlyP1_Intro');
        const grouped=window.EditorSession.attentionCandidates(app,1);
        assert.ok(grouped.length);assert.ok(grouped.every(unit=>app.ctBrowseOrderedUnits().includes(unit)));
        assert.ok(app.ctSelectedFilters.includes('unchanged'));
    }
});

test('ClientText attention hotkeys work in either editor and retain IME, tool and overlay isolation',async()=>{
    const {app}=listHarness(),calls=[];app.navigateAttention=async direction=>calls.push(direction);
    for(const code of ['Comma','Period']){
        const press=overrides=>app.ctKey({...rowEvent(code==='Comma'?'<':'>'),code,ctrlKey:true,shiftKey:true,...overrides});
        await press();assert.equal(calls.pop(),code==='Comma'?-1:1);
        await press({isComposing:true});app.settingsDialogVisible=true;await press();app.settingsDialogVisible=false;
        await press({target:{closest:()=>({})}});assert.equal(calls.length,0);
    }
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

test('manager role exposes every ClientText language with or without an account assignment',()=>{
    for(const assigned of [null,'Thai']){
        const {app}=cloudAccessHarness(assignmentHarness(),assigned),languages=Array.from(app.ctTeamOptions);
        app.managedSelectedDetails.contentGroups=languages.map(language=>({id:'ct-'+language,versionId:'v1',contentMode:'clienttext',language,
            teams:[{language,counts:{}}]}));
        assert.equal(app.cloudCanAccessAllLanguages,true);assert.equal(app.managedManagerAccess,true);
        assert.deepEqual(Array.from(app.ctAssignmentRows,row=>row.team.language).sort(),languages.sort());
        assert.equal(app.ctAssignmentRows.every(row=>row.group.language===row.team.language),true);
        app.cloudUser={...app.cloudUser,role:'translator',language:'Thai'};
        assert.equal(app.managedManagerAccess,false);
        assert.deepEqual(Array.from(app.ctAssignmentRows,row=>row.label),['Thai — ClientText']);
        app.cloudUser={...app.cloudUser,language:null};assert.equal(app.ctAssignmentRows.length,0);
    }
});

test('a Manager catalog restores assignments hidden by a cached translator details snapshot',()=>{
    const {app}=cloudAccessHarness(assignmentHarness(),'Thai'),languages=Array.from(app.ctTeamOptions),
        groups=languages.map(language=>({id:'ct-'+language,versionId:'v1',contentMode:'clienttext',language,teams:[{language,counts:{}}]}));
    app.managedVersions=[{id:'v1',game:'poe2',branchId:'default',membershipRevision:12,contentGroups:groups}];
    app.managedSelectedDetails={version:{id:'v1',membershipRevision:12},teams:[],contentGroups:groups.filter(group=>group.language==='Thai')};
    assert.equal(app.cloudCanAccessAllLanguages,true);
    assert.deepEqual(Array.from(app.ctAssignmentRows,row=>row.team.language).sort(),languages.sort(),
        'the full catalog must remain visible while the previously assigned team details are cached');
    app.cloudUser={...app.cloudUser,role:'translator'};
    assert.deepEqual(Array.from(app.ctAssignmentRows,row=>row.team.language),['Thai']);
});

test('Manager assignments reconcile legacy team details and respect newer membership removals',()=>{
    const {app}=cloudAccessHarness(assignmentHarness(),'Thai'),thai={language:'Thai',counts:{saved:2}},french={language:'French',counts:{saved:1}},
        legacy={id:'legacy',versionId:'v1',legacyVersionId:'v1',contentMode:'statdescription',teams:[thai,french]},
        ct={id:'ct-French',versionId:'v1',contentMode:'clienttext',language:'French',teams:[french]};
    app.managedVersions=[{id:'v1',game:'poe2',branchId:'default',membershipRevision:2,contentGroups:[legacy,ct]}];
    app.managedSelectedDetails={version:{id:'v1',membershipRevision:2},teams:[thai],contentGroups:[{...legacy,teams:[thai]}]};
    assert.deepEqual(Array.from(app.ctAssignmentRows,row=>row.label),['French — ClientText','French — StatDescription','Thai — StatDescription']);
    assert.equal(app.ctAssignmentRows.find(row=>row.label==='Thai — StatDescription').team,thai,'rich details for the previously assigned team remain intact');
    app.managedSelectedDetails={version:{id:'v1',membershipRevision:3},teams:[],contentGroups:[]};
    assert.equal(app.ctAssignmentRows.length,0,'newer detail membership removes old catalog groups');
    app.managedSelectedDetails={version:{id:'v1',membershipRevision:1},teams:[thai],contentGroups:[ct]};
    app.managedVersions[0]={...app.managedVersions[0],contentGroups:[]};
    assert.equal(app.ctAssignmentRows.length,0,'newer catalog membership removes old cached groups');
    app.managedVersions=[{id:'v1',game:'poe1',branchId:'default',membershipRevision:2,contentGroups:[legacy]}];
    assert.deepEqual(Array.from(app.ctAssignmentRows,row=>row.label),['French — ClientText'],'another game cannot supplement the selected assignments');
});

test('manager opens every ClientText language under its own workspace scope and translator access stays assigned',async()=>{
    for(const assigned of [null,'Thai']){
        const {app}=cloudAccessHarness(harness(),assigned),opened=[],reads=[],version={id:scope.versionId,game:scope.game,branchId:scope.branchId};
        app.ctFlushDraft=async()=>true;app.ctFlushCommentDraft=async()=>{};
        app._ctStore={async getMetadata(selected){reads.push(clone(selected));return{state:'ready'};}};
        app.ctActivate=async selected=>{opened.push(clone(selected));return true;};
        for(const language of app.ctTeamOptions){
            const group={id:'ct-'+language,versionId:version.id,contentMode:'clienttext',language,teams:[{language}]};
            assert.equal(await app.ctOpenGroup(version,group,language),true);
        }
        assert.equal(opened.length,12);assert.deepEqual(reads,opened);
        assert.equal(opened.every(selected=>selected.accountId===scope.accountId && selected.versionId===version.id
            && selected.groupId==='ct-'+selected.language && selected.game===scope.game && selected.branchId===scope.branchId),true);
        app.cloudUser={...app.cloudUser,role:'translator',language:'Thai'};
        await app.ctOpenGroup(version,{id:'ct-German',contentMode:'clienttext',language:'German'},'German');
        assert.equal(reads.length,12,'a translator cannot open another language even when it is cached');
    }
});

test('manager upload offers every ClientText language independently of assignment and selected editor language',async()=>{
    for(const assigned of [null,'Thai']){
        const {app}=cloudAccessHarness(harness(),assigned),requests=[],policy={clientTextStorageProtocols:[S.STORAGE_PROTOCOL],clientTextParserVersions:S.PARSER_VERSIONS,
            clientTextRoles:{default:['normal'],French:['normal','gender'],German:['normal','gender']}};
        app._cloud={async request(route){requests.push(route);return policy;}};
        await app.ctOpenUpload({id:'v1',name:'All language release'});
        assert.equal(app.ctUploadVisible,true);assert.equal(app.ctUploadError,'');
        assert.equal(app.ctTeamOptions.length,12);assert.deepEqual(Array.from(app.ctUploadAssignments).sort(),Array.from(app.ctTeamOptions).sort());
        app.ctChooseFiles({target:{files:app.ctTeamOptions.map(language=>new File(['original'],language+'.xlsx'))}});
        assert.deepEqual(Array.from(app.ctUploadFiles,candidate=>candidate.language),Array.from(app.ctTeamOptions));
        assert.equal(app.ctPolicy.clientTextRoles.French.length,2);assert.equal(app.ctPolicy.clientTextRoles.German.length,2);
        app.ctUploadVisible=false;app.cloudUser={...app.cloudUser,role:'translator',language:'Thai'};
        await app.ctOpenUpload({id:'v1',name:'Forbidden upload'});
        assert.equal(app.ctUploadVisible,false);assert.deepEqual(requests,['/v1/content-policy']);
    }
});
test('the shared assignment sort compares SD file progress against CT progress excluding Missing-only fields',()=>{
    const thai={language:'Thai',counts:{saved:2,missing:2,revised:1}},ctThai={language:'Thai',counts:{saved:200,missing:100,workloadFields:40,resolvedFields:3,outdatedFields:1}},
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
test('ClientText meters exclude Missing-only fields while retaining Outdated overlap and resolved work',()=>{
    const {app}=assignmentHarness(),row={contentMode:'clienttext',label:'French — ClientText',team:{language:'French',counts:{
        loaded:100,fields:400,workloadFields:10,resolvedFields:4,outdatedFields:3,missingFields:8,
        saved:30,revised:2,missing:5,outdated:3,savedFields:120,revisedFields:12}}},progress=app.ctAssignmentProgress(row);
    assert.equal(progress.total,7);assert.equal(progress.saved,4);assert.equal(progress.percent,57);
    assert.equal(progress.missing,0);assert.equal(progress.outdated,3);assert.equal(progress.excludedMissing,3);
    assert.equal(progress.savedWidth,100*4/7+'%');
    assert.equal(progress.missingWidth,'0%');assert.equal(progress.outdatedWidth,100*3/7+'%');assert.equal(progress.revisedWidth,'0%');
    assert.equal(progress.saved+progress.missing+progress.outdated,progress.total);assert.equal(progress.savedIds,30);assert.equal(progress.revisedFields,12);
    const tooltip=app.ctAssignmentProgressTooltip(row);
    assert.match(tooltip,/Resolved workload fields: 4 \/ 7 \(57%\)/);assert.match(tooltip,/Saved: 30 · Revised: 2/);
    assert.match(tooltip,/Revised corrections: 12 · Missing: 8 · Outdated: 3/);
    assert.match(tooltip,/Missing-only fields excluded: 3/);assert.match(tooltip,/blank ClientText values can intentionally use English/);
    assert.match(tooltip,/Outdated fields still require review, including fields that are also Missing/);
    assert.match(tooltip,/outside the initial workload and are excluded from the progress bar/);
    assert.match(tooltip,/unsaved drafts and pending offline saves are excluded/);
    row.team.counts.outdatedFields=100;row.team.counts.resolvedFields=100;
    assert.equal(app.ctAssignmentProgress(row).savedWidth,'100%');assert.equal(app.ctAssignmentProgress(row).outdatedWidth,'0%');
});
test('ClientText Missing-only and unavailable workloads remain neutral without using loaded IDs or Saved counts',()=>{
    const {app}=assignmentHarness(),row={contentMode:'clienttext',label:'Thai — ClientText',team:{language:'Thai',counts:{loaded:149550,saved:1000,missing:100,workloadFields:100,resolvedFields:0,outdatedFields:0}}},
        progress=app.ctAssignmentProgress(row);
    assert.equal(progress.total,0);assert.equal(progress.saved,0);assert.equal(progress.percent,0);assert.equal(progress.empty,true);assert.equal(progress.known,true);
    for(const name of ['savedWidth','revisedWidth','missingWidth','outdatedWidth'])assert.equal(progress[name],'0%');
    assert.equal(progress.excludedMissing,100);assert.match(app.ctAssignmentProgressTooltip(row),/No counted workload fields; the bar is neutral/);
    row.team.counts.workloadFields=0;assert.equal(app.ctAssignmentProgress(row).empty,true);
    delete row.team.counts.workloadFields;assert.equal(app.ctAssignmentProgress(row).known,false);
    assert.match(app.ctAssignmentProgressTooltip(row),/workload counts are unavailable/);
});

test('ClientText editor progress excludes blank fields, keeps review work and reflects committed values only',()=>{
    const blank=namedUnit('fallback','English',''),whitespace=namedUnit('whitespace','English',' \t\n'),
        outdated=namedUnit('review','English','Old translation',true),overlap=namedUnit('blank-review','English','',true),
        correction=namedUnit('correction','English','Complete'),carried=namedUnit('carried','Changed English','Carried translation');
    whitespace.fields[0].originalMissing=true;
    const originals=[blank,whitespace,outdated,overlap,correction,carried],before=clone(originals),
        {app,mixin}=harness({ctUnits:originals,_ctWorkUnits:new Map(originals.map(unit=>[unit.id,unit])),
            ctSaved:{[carried.id]:{values:S.valuesFor(carried),outdated:[fieldId],saved:false}}}),
        progress=()=>clone(mixin.computed.ctWorkProgress.call(app));
    assert.deepEqual(progress(),{total:3,resolved:0,percent:0},'Only Outdated fields count before any saves');
    app.ctValues={[fieldId]:'Unsaved fallback translation'};app.ctReviewed={[fieldId]:S.sourceHash('English')};
    assert.deepEqual(progress(),{total:3,resolved:0,percent:0},'Private drafts cannot change committed progress');
    app.ctSaved[blank.id]={values:{[fieldId]:'Saved translation'}};
    app.ctSaved[whitespace.id]={values:S.valuesFor(whitespace)};
    app.ctSaved[correction.id]={values:{[fieldId]:'Correction'}};
    assert.deepEqual(progress(),{total:4,resolved:1,percent:25},'Filled Missing work counts as resolved; blank saves and Revised corrections add no work');
    app.ctSaved[overlap.id]={values:S.valuesFor(overlap),reviewed:{[fieldId]:S.sourceHash('English')}};
    assert.deepEqual(progress(),{total:3,resolved:1,percent:33},'Reviewed blank Outdated fields leave the denominator');
    app.ctSaved[outdated.id]={values:S.valuesFor(outdated),reviewed:{[fieldId]:S.sourceHash('English')}};
    app.ctSaved[carried.id]={...app.ctSaved[carried.id],reviewed:{[fieldId]:S.sourceHash('Changed English')}};
    assert.deepEqual(progress(),{total:3,resolved:3,percent:100});
    app.ctSaved[blank.id]={values:{[fieldId]:' \t\n'}};
    assert.deepEqual(progress(),{total:2,resolved:2,percent:100},'Intentionally blank saved work does not reduce completion');
    app._ctWorkUnits=new Map([[blank.id,blank],[whitespace.id,whitespace],[overlap.id,overlap]]);
    assert.deepEqual(progress(),{total:0,resolved:0,percent:100});
    assert.equal(app.ctStatus(blank).missing,true);assert.equal(app.ctStatus(blank).saved,true);
    assert.deepEqual(originals,before,'Progress never mutates original field facts');
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
    const template=window.EditorComponents.History.template,ctHistory=template.slice(template.indexOf('class="ctHistoryPanel historyPanel"'),template.indexOf("sideTab === 'history' && editorReady && !historyClientText"));
    assert.ok(ctHistory.includes('{{ ctHistoryDisplay(part.value) }}'));assert.equal(ctHistory.includes('v-html'),false,'CT history uses Vue text interpolation to escape source, notes and target HTML');
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
test('confirmed history restore creates an exact durable saved revision and retains only current field review hashes',async()=>{
    const f=fixture(),{app,original}=enableHistory(harness());await f.store.import(scope,{units:[original],assets:[asset]});
    const saved=await f.store.save(scope,original.id,{jobId:'saved',values:{[fieldId]:'Committed'},reviewed:{}});
    app.ctSaved={[original.id]:saved.saved};app.ctValues={...saved.saved.values};app._ctEditRevision=saved.saved.revision;app._ctStore=f.store;app.ctSync=()=>{};app.ctLoadMemory=()=>{};
    const confirmations=[];app.appConfirm=async(message,options)=>{confirmations.push({message,options});return true;};
    const raw='Restored @literal\\nreal\n<script>x</script>';
    app._ctStore={...f.store,async listHistory(){return[{id:'valid',unitId:original.id,createdAt:1,after:{values:{[fieldId]:raw,removed:'Do not restore'},reviewed:{[fieldId]:S.sourceHash(original.fields[0].source),removed:'hash'}}},
        {id:'stale',unitId:original.id,createdAt:2,after:{values:{[fieldId]:'Older'},reviewed:{[fieldId]:'f'.repeat(64)}}}];}};
    await app.ctLoadHistory();const valid=app.ctHistory.find(entry=>entry.id==='valid');
    assert.equal(await app.ctRestoreHistory(valid),true);
    assert.equal(app.ctValues[fieldId],raw);assert.equal(app.ctValues.removed,undefined);
    assert.equal(app.ctReviewed[fieldId],S.sourceHash(original.fields[0].source));assert.equal(app.ctReviewed.removed,undefined);
    assert.match(confirmations[0].message,/new saved revision/);assert.equal(confirmations[0].options.confirmLabel,'Restore revision');
    assert.equal(await f.store.getDraft(scope,original.id),undefined,'confirmed successful restore consumes its own checkpoint');
    const restored=(await f.store.getSaved(scope))[original.id],history=await f.store.listHistory(scope,original.id),outbox=await f.store.getOutbox(scope);
    assert.equal(restored.values[fieldId],raw);assert.equal(restored.origin,'restore');assert.equal(restored.revision,saved.saved.revision+1);
    const restoreEvent=history.find(entry=>entry.origin==='restore');assert.ok(restoreEvent);assert.equal(restoreEvent.before.values[fieldId],'Committed');assert.equal(restoreEvent.after.values[fieldId],raw);
    assert.equal(outbox.at(-1).origin,'restore');assert.equal((await f.store.getUnit(scope,original.id)).fields[0].target,original.fields[0].target,'restore keeps the workbook baseline immutable');
    await settle();
    assert.equal(await app.ctRestoreHistory(app.ctHistory.find(entry=>entry.id==='stale')),true);
    assert.deepEqual(clone(app.ctReviewed),{});
});

test('confirmed history restores hidden class variants in one saved revision without changing display selections',async()=>{
    const original=classVariantUnit(),hidden=original.fields.find(field=>field.form==='IntFour'),f=fixture(),
        {app,mixin}=enableHistory(keyboardHarness(original));await f.store.import(scope,{units:[original],assets:[{...asset,role:'gender'}]});
    const oldValues={...S.valuesFor(original),[hidden.id]:'Old@literal\\n\n[Keyword] {0}'},newValues={...oldValues,[hidden.id]:'New@literal\\n\n[Keyword] {0}'};
    await f.store.save(scope,original.id,{jobId:'old',values:oldValues,reviewed:{[hidden.id]:S.sourceHash(hidden.source)}});
    const saved=await f.store.save(scope,original.id,{jobId:'new',values:newValues,reviewed:{}});
    app._ctStore=f.store;
    // keyboardHarness substitutes a no-op checkpoint for navigation tests;
    // restore exercises the actual durable command instead.
    app.ctFlushDraft=mixin.methods.ctFlushDraft.bind(app);
    app.ctSaved={[original.id]:saved.saved};app._ctEditRevision=saved.saved.revision;app.ctValues=newValues;app.ctSync=()=>{};app.ctLoadMemory=()=>{};app.ctInitializeVariants();
    const group=app.ctFieldGroups[0];app.ctSelectVariant(group,group.fields.find(field=>field.form==='StrFourb').id,{focus:false});
    const selected=app.ctSelectedVariant(group);assert.notEqual(selected.id,hidden.id);
    const outbox=clone(await f.store.getOutbox(scope)),history=clone(await f.store.listHistory(scope,original.id));
    await app.ctLoadHistory();const entry=app.ctHistory.find(entry=>entry.after.values[hidden.id]===oldValues[hidden.id]);assert.ok(entry);
    assert.equal(await app.ctRestoreHistory(entry),true);const restored=(await f.store.getSaved(scope))[original.id];
    assert.equal(restored.values[hidden.id],oldValues[hidden.id]);assert.equal(restored.reviewed[hidden.id],S.sourceHash(hidden.source));
    assert.equal(Object.keys(restored.values).length,original.fields.length);assert.equal(app.ctSelectedVariant(group).id,selected.id);
    assert.equal(app.ctDefaultForms(group).every(field=>app.ctDisplayedFields().includes(field)),true);assert.equal(app.ctDisplayedFields().includes(hidden),false);
    assert.equal(await f.store.getDraft(scope,original.id),undefined);assert.equal(restored.origin,'restore');
    const queued=await f.store.getOutbox(scope);assert.equal(queued.length,outbox.length,'unclaimed sparse work coalesces per ID');assert.equal(queued[0].origin,'restore');
    assert.equal(queued[0].values[hidden.id],oldValues[hidden.id]);assert.equal((await f.store.listHistory(scope,original.id)).length,history.length+1);
});
test('history restore cancellation and late confirmation cannot replace a newer draft or scoped editor',async()=>{
    for(const change of ['cancel','text','account','group','unit']){
        const {app,original}=enableHistory(harness()),held=deferred();
        app._ctStore={async listHistory(){return[{id:'entry',unitId:original.id,after:{values:{[fieldId]:'Historical'}}}];}};
        await app.ctLoadHistory();const entry=app.ctHistory[0],before=app.ctValues;let checkpoints=0,saves=0;
        app.appConfirm=()=>held.promise;app.ctFlushDraft=async()=>{checkpoints++;return true;};app.ctSave=async()=>{saves++;return true;};
        const restoring=app.ctRestoreHistory(entry);await settle();
        if(change==='text')app.ctValues[fieldId]='New typing';
        else if(change==='unit')app.ctSelection='other';
        else if(['account','group'].includes(change))app.ctWorkspace={scope:{...scope,[change==='account'?'accountId':'groupId']:'replacement'}};
        held.resolve(change!=='cancel');assert.equal(await restoring,false,change);assert.equal(app.ctValues,before);assert.equal(checkpoints,0);assert.equal(saves,0);
        assert.equal(app.ctValues[fieldId],change==='text'?'New typing':original.fields[0].target);
    }
});

test('history restore requires the shared API capability but local restore uses the same confirmed save command',async()=>{
    for(const policy of [{}, {clientTextSaveOrigins:['save']}]){
        const {app,original}=enableHistory(harness({ctPolicy:policy}));
        app._ctStore={async listHistory(){return[{id:'entry',unitId:original.id,after:{values:{[fieldId]:'Historical'}}}];}};
        await app.ctLoadHistory();let confirmed=0;app.appConfirm=async()=>{confirmed++;return true;};
        const values=app.ctValues;assert.equal(await app.ctRestoreHistory(app.ctHistory[0]),false);assert.equal(app.ctValues,values);
        assert.equal(confirmed,0);assert.match(app.ctHistoryError,/API.*support.*restore/);
    }
    const {app,original}=enableHistory(harness({ctPolicy:{},ctWorkspace:{scope:{...scope,groupId:'local:group'}}}));
    app._ctStore={async listHistory(){return[{id:'entry',unitId:original.id,after:{values:{[fieldId]:'Local raw@value\\n\r\nrestored'}}}];}};
    await app.ctLoadHistory();app.ctFlushDraft=async()=>true;const calls=[];
    app.ctSave=async(close,options)=>{calls.push({close,options,values:clone(app.ctValues)});return true;};
    assert.equal(await app.ctRestoreHistory(app.ctHistory[0]),true);assert.deepEqual(clone(calls[0].options),{origin:'restore'});
    assert.equal(calls[0].close,false);assert.equal(calls[0].values[fieldId],'Local raw@value\\n\r\nrestored');
});

test('a failed confirmed restore retains its exact recoverable checkpoint and retry command',async()=>{
    const f=fixture(),{app,original}=enableHistory(harness());await f.store.import(scope,{units:[original],assets:[asset]});
    const raw='Recoverable@raw\\n\r\nrestore';app.ctSync=()=>{};app.ctLoadMemory=()=>{};
    app._ctStore={...f.store,async listHistory(){return[{id:'entry',unitId:original.id,after:{values:{[fieldId]:raw}}}];},async save(){throw Error('Storage unavailable');}};
    await app.ctLoadHistory();assert.equal(await app.ctRestoreHistory(app.ctHistory[0]),false);
    assert.equal(app.ctValues[fieldId],raw);assert.equal(app.ctDraftDirty,true);assert.equal((await f.store.getDraft(scope,original.id)).values[fieldId],raw);
    assert.equal(app._ctSaveJob.command.origin,'restore');assert.match(app.ctError,/Storage unavailable/);
    const command=clone(app._ctSaveJob.command);app._ctStore.save=async(captured,id,input)=>{assert.deepEqual(clone(input),command);return f.store.save(captured,id,input);};
    assert.equal(await app.ctSave(),true,'retry resolves the captured restore command even when ordinary Save is chosen');
    assert.equal((await f.store.getSaved(scope))[original.id].values[fieldId],raw);assert.equal((await f.store.listHistory(scope,original.id)).at(-1).origin,'restore');
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

function scanHarness(rows=[namedUnit('Scan','English','Translation')],changes={}) {
    const h=harness({ctUnits:rows,_ctUnitIndex:new Map(rows.map(row=>[row.id,row])),ctSelection:rows[0]?.id || '',lang:scope.language,
        $refs:{},$nextTick:async()=>{},dictionary:[],editorDictionaryRevision:0,...changes});
    h.app.ctRefreshDiagnostics=h.mixin.methods.ctRefreshDiagnostics.bind(h.app);
    return h;
}
function onlyScanChecks(app,...keys) {app.ctScanChecks=Object.fromEntries(app.ctScanTypes.map(type=>[type.key,keys.includes(type.key)]));}

test('ClientText scanner forwards the SD dialog contract and exposes supported CT checks without saving drafts',async()=>{
    const {app,window}=scanHarness(),refs={},unrefs={},controller=app.ctDiagnosticScanController;
    app.sharedEditorController={registerRefs:refs,unregisterRefs:unrefs};
    assert.equal(controller.registerRefs,refs);assert.equal(controller.unregisterRefs,unrefs);
    assert.equal(controller,app.ctDiagnosticScanController);assert.equal(controller.diagnosticScanTypes,app.ctScanTypes);
    assert.deepEqual(Array.from(app.ctScanTypes,type=>type.key),['whitespace','dash','tagSyntax','variables','keywords','decorations','consistency','terminology','substitutions','controls']);
    assert.equal(controller.diagnosticScanChecks.terminology,false);assert.equal(controller.diagnosticScanChecks.consistency,true);
    assert.match(controller.diagnosticScanDescription,/all loaded records.*Local drafts are excluded/);assert.equal(controller.openDiagnosticResultLabel,'Open record');
    assert.equal(controller.diagnosticScanProgressLabel,'Records scanned');assert.equal('diagnosticScanProgressLabel' in controller,true);
    assert.equal(controller.diagnosticScanUnitLabel(1),'record');assert.equal(controller.diagnosticScanUnitLabel(0),'records');
    controller.diagnosticScanResultsPage=3;assert.equal(app.ctScanResultsPage,3);
    app.ctSave=()=>assert.fail('a diagnostic scan cannot save');app.ctFlushDraft=()=>assert.fail('a diagnostic scan cannot stage drafts');
    app.ctValues[fieldId]='unsaved [Broken';app.ctDraftDirty=true;const before=clone(app.ctUnits);
    assert.equal(await controller.startDiagnosticScan(),true);assert.equal(app.ctBusy,false);assert.equal(app.ctScanDone,true);
    assert.deepEqual(app.ctUnits,before);assert.equal(app.ctValues[fieldId],'unsaved [Broken');assert.equal(app.ctDraftDirty,true);
    assert.equal(controller.diagnosticScanResultFiles.length,0);assert.equal(controller.diagnosticScanPercent,100);
    assert.match(window.EditorComponents.DiagnosticScan.template,/entry.label \|\| entry.filepath/);
});
test('ClientText scan categories reuse SD whitespace and dash checks and select precise CT token kinds',async()=>{
    const row=namedUnit('Categories','[Power] {0} <red> <<button_x>> <continue>','  Incorrect -text  '),{app}=scanHarness([row]);
    for(const [key,kind] of [['variables','variable'],['keywords','keyword'],['decorations','format'],['substitutions','substitution'],['controls','control']]) {
        onlyScanChecks(app,key);assert.equal(await app.ctStartScan(),true);
        assert.deepEqual(Array.from(app.ctDiagnostics[row.id],issue=>issue.kind),[kind],key+' excludes every other token identity category');
        assert.equal(app.ctDiagnostics[row.id][0].severity,'error');
    }
    onlyScanChecks(app,'whitespace');await app.ctStartScan();assert.ok(app.ctDiagnostics[row.id].length);assert.ok(app.ctDiagnostics[row.id].every(issue=>!issue.kind && /space/.test(issue.code)));
    onlyScanChecks(app,'dash');await app.ctStartScan();assert.ok(app.ctDiagnostics[row.id].some(issue=>/dash/.test(issue.code)));assert.ok(app.ctDiagnostics[row.id].every(issue=>!issue.kind));
    row.fields[0].target='[Broken';onlyScanChecks(app,'tagSyntax');await app.ctStartScan();assert.ok(app.ctDiagnostics[row.id].some(issue=>issue.code==='missing-closing-tag'));
    onlyScanChecks(app);assert.equal(app.ctHasScanSelection,false);assert.equal(await app.ctStartScan(),undefined);
});
test('ClientText scans ignore optional audio metadata while checking real keywords, variables and Dictionary terms',async()=>{
    const markers=['[NOAUDIO]','[NO AUDIO]','[OLD AUDIO]','[AUDIOTEST]'];
    const rows=markers.flatMap((marker,index)=>[
        namedUnit('Prefix'+index,marker+' Dialogue [Power] {0}','Dialogue [Power|Force] {0}'),
        namedUnit('Embedded'+index,'Dialogue '+marker+' [Power] {0}','Dialogue [Power|Force] {0}'),
        namedUnit('Retained'+index,marker+' Dialogue [Power] {0}',marker+' Dialogue [Power|Force] {0}')]);
    const broken=namedUnit('ActualMismatch','[AUDIOTEST] Dialogue [Power] {0}','Dialogue [Wrong] {1}'),
        ordinary=namedUnit('OrdinaryAudioWord','[OLD AUDIO] Audio [Power]','Audio [Power|Force]'),
        lookalike=namedUnit('RealKeyword','[AUDIOTEST|Visible] Dialogue','Dialogue');
    rows.push(broken,ordinary,lookalike);
    const {app}=scanHarness(rows),before=clone(rows);
    app.getActiveDictionaryEntries=()=>[...markers.map(marker=>({find:marker.slice(1,-1),replace:'Should never be required'})),
        {find:'Power',replace:'Force'},{find:'Audio',replace:'Son'}];
    onlyScanChecks(app,'tagSyntax','keywords','variables','terminology');
    assert.equal(await app.ctStartScan(),true);
    for(const row of rows.slice(0,markers.length*3))assert.equal(app.ctDiagnostics[row.id].length,0,row.recordId);
    assert.deepEqual(Array.from(app.ctDiagnostics[broken.id].filter(issue=>issue.code==='clienttext-token-identity'),issue=>issue.kind).sort(),['keyword','variable']);
    assert.ok(app.ctDiagnostics[ordinary.id].some(issue=>issue.code==='dictionary-terminology' && issue.sourceTerm==='Audio'));
    assert.ok(app.ctDiagnostics[lookalike.id].some(issue=>issue.code==='clienttext-token-identity' && issue.kind==='keyword'));
    assert.deepEqual(rows,before,'diagnostic exclusions never rewrite raw workbook source or translation');
    const raw='🦁 [AUDIOTEST] Dialogue\r\n[Power|Force] {0}',masked=S.maskAudioMarkers(raw);
    assert.equal(masked.length,raw.length);assert.equal(masked.indexOf('[Power|Force]'),raw.indexOf('[Power|Force]'));
    assert.equal(masked,'🦁 '+ ' '.repeat('[AUDIOTEST]'.length)+' Dialogue\r\n[Power|Force] {0}');
});

test('ClientText consistency compares dialogue independently of one exact audio prefix',async()=>{
    const rows=['','[NOAUDIO] ','[NO AUDIO] ','[OLD AUDIO] ','[AUDIOTEST] '].map((prefix,index)=>namedUnit('Equivalent'+index,prefix+'Dialogue','Same translation')),
        different=namedUnit('Different','[AUDIOTEST] Changed dialogue','Other translation'),
        strict=namedUnit('Repeated','[AUDIOTEST] [NOAUDIO] Dialogue','Other translation');
    const {app}=scanHarness([...rows,different,strict]);onlyScanChecks(app,'consistency');
    await app.ctStartScan();assert.equal(app.ctScanIssueCounts.warnings,0);
    rows[0].fields[0].target='Conflicting translation';await app.ctStartScan();
    for(const row of rows)assert.ok(app.ctDiagnostics[row.id].some(issue=>issue.code==='clienttext-consistency'));
    assert.equal(app.ctDiagnostics[different.id].length,0);assert.equal(app.ctDiagnostics[strict.id].length,0);
});

test('scanner reads exact committed raw values across hidden worklist records and excludes hidden English, audio, Gender and NONEXISTENT forms',async()=>{
    const first=namedUnit('First','[Power]@literal\\n\r\n{0}','original [Power] {0}'),hidden=namedUnit('Hidden','[Power] {0}','saved without tags'),
        excluded=blankEnglishUnit('Excluded','[Power] {0}'),{app,window}=scanHarness([first,hidden,excluded],{ctSearch:'no matching records',ctSheet:'not a sheet',ctSelectedFilters:[],ctFilter:'missing'});
    excluded.fields[1].kind='form';excluded.fields[1].target='NONEXISTENT';excluded.fields[1].form='M';
    excluded.fields.push({...excluded.fields[0],id:'audio',source:'[NOAUDIO]',target:'[Broken',kind:'text'},
        {...excluded.fields[0],id:'gender',source:'[Power]',target:'[Broken',kind:'gender'});
    const accepted=' raw@literal\\n\r\n[Power|คำ] {0} ',draft='unsaved [Broken';app.ctSaved={[first.id]:{values:{[fieldId]:accepted}}};app.ctValues={[fieldId]:draft};app.ctDraftDirty=true;
    let inputs=[];const analyze=window.TranslationDiagnostics.analyze;window.TranslationDiagnostics={...window.TranslationDiagnostics,analyze(text,options){inputs.push(text);return analyze(text,options);}};
    onlyScanChecks(app,'whitespace','tagSyntax','variables','keywords');const original=clone(app.ctUnits),saved=clone(app.ctSaved);
    assert.equal(await app.ctStartScan(),true);assert.equal(app.ctScanTotal,3);assert.deepEqual(inputs,[accepted,hidden.fields[0].target]);
    assert.equal(app.ctDiagnostics[excluded.id].length,0);assert.ok(app.ctDiagnostics[hidden.id].some(issue=>issue.code==='clienttext-token-identity'));
    assert.deepEqual(app.ctUnits,original);assert.deepEqual(app.ctSaved,saved);assert.equal(app.ctValues[fieldId],draft);
});
test('optional ClientText consistency and terminology stay manual and scan only saved values',async()=>{
    const first=namedUnit('One','Power','Incorrect'),second=namedUnit('Two','Power','Force'),{app,mixin}=scanHarness([first,second]);
    app.getActiveDictionaryEntries=()=>[{find:'Power',replace:'Force'}];let runs=0;const scan=app.ctScan;app.ctScan=(...args)=>{runs++;return scan(...args);};
    onlyScanChecks(app,'keywords');await app.ctStartScan();assert.equal(app.ctScanIssueCounts.warnings,0);
    app.ctScanChecks.consistency=true;app.ctScanChecks.terminology=true;assert.equal(runs,1,'checking optional boxes does not run them');
    await app.ctStartScan();assert.equal(runs,2);assert.ok(app.ctDiagnostics[first.id].some(issue=>issue.code==='clienttext-consistency'));
    assert.ok(app.ctDiagnostics[first.id].some(issue=>issue.code==='dictionary-terminology'));assert.ok(!app.ctDiagnostics[second.id].some(issue=>issue.code==='dictionary-terminology'));
    app.ctScanResultsPage=2;mixin.watch.editorDictionaryRevision.call(app);assert.equal(runs,2);assert.equal(app.ctScanDone,false);assert.equal(Object.keys(app.ctDiagnostics).length,0);
});
test('ClientText consistency results identify grammatical forms and exclude other forms from the comparison',async()=>{
    const first=namedUnit('MasculineOne','Power','Force'),second=namedUnit('MasculineTwo','Power','Strength'),other=namedUnit('Feminine','Power','Different'),
        rows=[first,second,other];
    for(const row of rows){row.fields[0].kind='form';row.fields[0].form=row===other ? 'FS' : 'MS';}
    const {app}=scanHarness(rows);onlyScanChecks(app,'consistency');
    assert.equal(await app.ctStartScan(),true);
    for(const row of [first,second]){
        const issue=app.ctDiagnostics[row.id].find(item=>item.code==='clienttext-consistency');
        assert.equal(issue.form,'MS');assert.equal(app.ctScanIssueLocation(issue),issue.fieldName+' · MS');
    }
    assert.equal(app.ctDiagnostics[other.id].length,0,'A different grammatical form is an independent consistency group');
});

test('ClientText scanner keeps shared modal progress and completed results when closed and reopened',async()=>{
    const pending=deferred(),returnFocus={isConnected:true,focusCalls:[],focus(options){this.focusCalls.push(options);}},
        dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}},heading={count:0,focus(){this.count++;}},
        {app,window}=scanHarness(undefined,{$nextTick:callback=>pending.promise.then(()=>callback?.())});
    window.document={activeElement:returnFocus};app.getEditorComponentRef=name=>name==='diagnosticScanDialog'?dialog:heading;
    app.$refs.ctDiagnosticDialog={open:false,showModal:()=>assert.fail('shared ref should win')};
    assert.equal(app.ctOpenScanDialog(),true);assert.equal(dialog.open,true);const scanning=app.ctStartScan();assert.equal(app.ctScanRunning,true);assert.equal(app.ctBusy,false);
    app.ctCloseScanDialog();app.ctScanDialogClosed();assert.equal(dialog.open,false);assert.equal(app.ctScanRunning,true);assert.equal(returnFocus.focusCalls.length,1);
    assert.equal(app.ctOpenScanDialog(),true);pending.resolve();assert.equal(await scanning,true);assert.equal(app.ctScanDone,true);assert.ok(heading.count);
    app.ctCloseScanDialog();app.ctOpenScanDialog();assert.equal(app.ctScanDone,true);assert.equal(app.ctScanProcessed,1);
    const event={ctrlKey:true,code:'KeyS',preventDefault(){this.prevented=true;}};app.ctScanDialogKeydown(event);assert.equal(event.prevented,true);
    app.ctCloseScanDialog(false);app.ctScanDialogClosed();assert.equal(returnFocus.focusCalls.length,1,'Open record does not restore the old focus');
});
test('ClientText Stop discards partial output without aborting workspace requests and a second scan can complete',async()=>{
    const rows=Array.from({length:75},(_,i)=>namedUnit('Row'+i,'{0}','Wrong')),{app}=scanHarness(rows),abort=new AbortController();app._ctAbort=abort;
    const analyze=app.ctAnalyzeScanUnit;app.ctAnalyzeScanUnit=(...args)=>{const result=analyze(...args);if(app.ctScanProcessed===24)app.ctStopScan();return result;};
    assert.equal(await app.ctStartScan(),false);assert.equal(app.ctScanRunning,false);assert.equal(app.ctScanStopped,true);assert.equal(app.ctScanDone,false);
    assert.equal(Object.keys(app.ctDiagnostics).length,0);assert.equal(app.ctScanErrorFileCount,0);assert.equal(app._ctScanCache,null);assert.equal(abort.signal.aborted,false);
    app.ctAnalyzeScanUnit=analyze;assert.equal(await app.ctStartScan(),true);assert.equal(app.ctScanProcessed,75);assert.equal(app.ctScanErrorFileCount,75);
});
test('shared ClientText scanner scope transitions close the modal and stale focus cannot enter a replacement account',async()=>{
    const pending=deferred(),focus={isConnected:true,count:0,focus(){this.count++;}},heading={count:0,focus(){this.count++;}},
        dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}},{app,mixin,window}=scanHarness(undefined,{$nextTick:callback=>pending.promise.then(()=>callback?.())});
    window.document={activeElement:focus};app.getEditorComponentRef=name=>name==='diagnosticScanDialog'?dialog:heading;
    const scopeKey=app.ctScanScopeKey;app.ctWorkspace={scope:clone(scope)};assert.equal(app.ctScanScopeKey,scopeKey,'equivalent scope refresh keeps settled results');
    app.ctOpenScanDialog();app.cloudProfileId='other';pending.resolve();await settle();assert.equal(heading.count,0);
    app.ctCloseScanDialog();app.ctScanDialogClosed();assert.equal(focus.count,0);
    app.ctOpenScanDialog();app.ctActive=false;mixin.watch.ctScanScopeKey.call(app);assert.equal(dialog.open,false);assert.equal(app.ctScanDone,false);
});
for(const change of ['Stop','account change'])test('ClientText consistency phase yields for '+change+' without publishing partial findings',async()=>{
    const rows=Array.from({length:60},(_,i)=>namedUnit('Peer'+i,'English '+Math.floor(i/2),i%2?'First translation':'Second translation')),
        {app}=scanHarness(rows),abort=new AbortController();app._ctAbort=abort;onlyScanChecks(app,'consistency');
    let groups=0,seenPhase='',liveWarnings=0;const add=app.ctAddConsistency;
    app.ctAddConsistency=(...args)=>{
        const output=add(...args);groups++;
        if(groups===1)setTimeout(()=>{seenPhase=app.ctScanPhase;liveWarnings=app.ctScanWarningFileCount;if(change==='Stop')app.ctStopScan();else app.cloudProfileId='other';},0);
        return output;
    };
    assert.equal(await app.ctStartScan(),false);assert.equal(seenPhase,'Checking consistency…');assert.equal(groups,25);assert.equal(liveWarnings,50);
    assert.equal(app.ctScanRunning,false);assert.equal(app.ctScanDone,false);assert.equal(Object.keys(app.ctDiagnostics).length,0);assert.equal(app.ctScanWarningFileCount,0);
    assert.equal(abort.signal.aborted,false);assert.equal(app._ctScanCache,null);
});
for(const changed of ['account','game','branch','language','group','version','mode','units','saved','dictionary','dictionary-revision','hideDNT'])
test('ClientText scanner rejects a late '+changed+' scope without publishing partial results',async()=>{
    const pending=deferred(),{app}=scanHarness(undefined,{$nextTick:()=>pending.promise});const scanning=app.ctStartScan();
    if(changed==='account')app.cloudProfileId='other';else if(changed==='game')app.gameVersion='poe1';else if(changed==='branch')app.branchId='other';
    else if(changed==='language')app.lang='German';else if(changed==='group')app.ctWorkspace={scope:{...scope,groupId:'other'}};
    else if(changed==='version')app.ctWorkspace={scope:{...scope,versionId:'other'}};else if(changed==='mode')app.ctActive=false;
    else if(changed==='units')app.ctUnits=app.ctUnits.slice();else if(changed==='saved')app.ctSaved={};else if(changed==='dictionary')app.dictionary=[];
    else if(changed==='dictionary-revision')app.editorDictionaryRevision++;else app.hideDNT=true;
    pending.resolve();assert.equal(await scanning,false);assert.equal(app.ctScanRunning,false);assert.equal(app.ctScanDone,false);assert.equal(Object.keys(app.ctDiagnostics).length,0);
});
test('ClientText result cards keep exact issue counts, bounded details, pages and guarded record identities',async()=>{
    const rows=Array.from({length:23},(_,i)=>namedUnit('Row'+i,'{0}','Wrong')),{app}=scanHarness(rows);
    onlyScanChecks(app,'variables');await app.ctStartScan();const controller=app.ctDiagnosticScanController;
    assert.equal(controller.diagnosticScanIssueCounts.errors,23);assert.equal(controller.diagnosticScanResultPageCount,2);assert.equal(controller.diagnosticScanVisibleResults.length,20);
    controller.diagnosticScanResultsPage=2;assert.equal(controller.diagnosticScanResultRangeLabel,'21–23 of 23');assert.equal(controller.diagnosticScanVisibleResults.length,3);
    const card=controller.diagnosticScanVisibleResults[0];assert.equal(card.filepath,rows.find(row=>[row.role,row.sheet,row.recordId].join(' / ')===card.label).id);
    let opened;app.ctSelect=async(row,full)=>{opened={row,full};return true;};assert.equal(await controller.openDiagnosticResult(card.filepath),true);assert.equal(opened.full,true);assert.equal(opened.row.id,card.filepath);
    app.ctWorkspace={scope:{...scope,groupId:'other'}};opened=null;assert.equal(await controller.openDiagnosticResult(card.filepath),false);assert.equal(opened,null);
    const diagnostic={severity:'warning',fieldId:fieldId,fieldName:'Text',message:'Finding'};app.ctDiagnostics={[rows[0].id]:Array.from({length:61},()=>diagnostic)};
    const result=app.ctScanResultFiles[0].result;assert.equal(result.warningCount,61);assert.equal(result.diagnostics.length,40);assert.equal(result.diagnosticsTruncated,21);
});
test('completed ClientText scans retain applied checks and page while refreshing one saved record',async()=>{
    const rows=Array.from({length:24},(_,i)=>namedUnit('Row'+i,'{0}','Wrong')),{app}=scanHarness(rows);onlyScanChecks(app,'variables');await app.ctStartScan();
    app.ctScanResultsPage=2;const unrelated=app.ctDiagnostics[rows[1].id];onlyScanChecks(app,'whitespace');
    app.ctSaved={[rows[0].id]:{values:{[fieldId]:'{0}'}}};app.ctRefreshDiagnostics([rows[0].id]);
    assert.equal(app.ctScanDone,true);assert.equal(app.ctScanAppliedChecks.variables,true);assert.equal(app.ctDiagnostics[rows[0].id].length,0);
    assert.equal(app.ctDiagnostics[rows[1].id],unrelated);assert.equal(app.ctScanResultsPage,2);assert.equal(app.ctScanErrorFileCount,23);
});
test('a saved update cancels an unfinished ClientText scan and fencing closes the shared dialog',async()=>{
    const pending=deferred(),dialog={open:true,close(){this.open=false;}},{app}=scanHarness(undefined,{$nextTick:()=>pending.promise});
    app.getEditorComponentRef=()=>dialog;const scanning=app.ctStartScan();app.ctRefreshDiagnostics([app.ctUnits[0].id]);
    pending.resolve();assert.equal(await scanning,false);assert.equal(app.ctScanRunning,false);assert.equal(app.ctScanDone,false);
    app.ctFence();assert.equal(dialog.open,false);assert.equal(app.ctScanTotal,0);assert.equal(app.ctScanAppliedChecks,null);
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

test('cached publication resume reuses small accepted descriptors without compact reads or proof trees',async()=>{
    const {app,window,original}=harness(),compact=S.compactUnit(original),metadata={descriptors:[{...asset,baselineId:'accepted',root:'accepted-root'}]},tree={ids:[original.id],levels:[['leaf']]};let compactReads=0;
    const payload={kind:'publication',name:'Release',groups:[{contentMode:'clienttext',language:scope.language,cacheScope:scope,carry:[]}]};
    window.ClientTextState={...S,compactUnit(){throw new Error('Resume must not rehash originals on the UI thread.');}};
    app._ctStore={async getRequest(){return{payload};},async getUnits(captured,options){assert.equal(options.guard(),true);assert.equal(captured.groupId,scope.groupId);return[original];},
        async getMetadata(){return metadata;},async getAsset(){return{...asset,name:'Thai_PoE2.xlsm',blob:new Blob(['original bytes']),parsed:{sheets:[]},descriptor:metadata.descriptors[0],tree};},
        async getCompactUnits(captured,options){assert.equal(options.guard(),true);assert.equal(captured.groupId,scope.groupId);compactReads++;return[compact];}};
    app.ctOpenUpload=async()=>{};
    await app.ctResumePublication({requestId:'publication-id',payload:{kind:'publication'}});
    assert.equal(compactReads,0);assert.equal(app.ctPrepared[0].originals.descriptors[0].baselineId,'accepted');
    assert.equal(app.ctPrepared[0].originals.units,undefined);assert.equal(app.ctPrepared[0].originals.trees,undefined);
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

test('published originals replay each accepted parser version instead of reinterpreting legacy manifests as class fields',async()=>{
    for(const parserVersion of [undefined,'clienttext-v1','clienttext-v2']){
        const {app,original}=harness(),version={id:scope.versionId,game:scope.game,branchId:scope.branchId},parsedWith=[],imports=[];
        const descriptor={role:'normal',baselineId:'accepted-baseline',artifactHash:'verified',...(parserVersion?{parserVersion}:{})},
            group={id:scope.groupId,versionId:scope.versionId,contentMode:'clienttext',language:scope.language,
                assets:[{filename:'Thai_PoE2.xlsx',descriptor}]};
        app.cloudCanAccessAllLanguages=true;app._ctStore={async getMetadata(){return null;},async import(captured,payload){imports.push({captured,payload});}};
        app._cloud={async request(route){return route==='/v1/content-policy'?{clientTextStorageProtocols:[S.STORAGE_PROTOCOL],clientTextParserVersions:S.PARSER_VERSIONS}:route.endsWith('/original')?new Blob(['original bytes']):{group};}};
        app._ctWorker={async parseWorkbook(bytes,options){parsedWith.push(options.parserVersion);return{units:[original],artifactHash:'verified',
            filename:'Thai_PoE2.xlsx',parserVersion:options.parserVersion,sheets:[]};},async buildManifest(units,assets){return{descriptors:[descriptor]};}};
        await app.ctOpenGroup(version,group,scope.language,false);
        assert.deepEqual(parsedWith,[parserVersion || 'clienttext-v1']);assert.equal(imports.length,1);
        assert.equal(imports[0].payload.assets[0].parsed.parserVersion,parserVersion || 'clienttext-v1');assert.equal(app.ctError,'');
        assert.equal(app.ctWorkspace.scope.groupId,scope.groupId,'verification without activation keeps the current workspace');
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
    app.ctUploadLocal=true;app.ctUploadName='Local release';app.ctPrepared=['Thai','French'].map(language=>({language,units:[],assets:[{role:'normal'}],originals:{descriptors:[],summaries:{}}}));
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
            const original={...unit(),role:options.role,id:JSON.stringify([options.role,'ClientStrings','ID/1'])},artifactHash=S.sha256(bytes);
            return{units:[original],artifactHash,assetHash:artifactHash,sheets:[{name:'ClientStrings',headers:[]}],warnings:[]};
        },
        async buildDescriptors(units,assets,options){
            manifestCalls.push({units:units.slice(),assets:assets.slice(),signal:options.signal});return S.buildDescriptors(units,assets);
        }
    };
    h.app._ctStore=new Proxy({}, {get(_target,name){return async()=>{if(name==='getCachedOriginal')return null;storeCalls.push(String(name));throw Error('Preparation must not write to storage: '+String(name));};}});
    h.app._cloud={async request(url,options){if(url==='/v1/content-policy')return{...h.app.ctPolicy,clientTextStorageProtocols:[S.STORAGE_PROTOCOL],clientTextParserVersions:S.PARSER_VERSIONS};requests.push({url,options});assert.match(url,/^\/v1\/content-predecessor\?/);
        assert.equal(options?.method,undefined,'preparation only reads predecessor metadata');return{version:null,group:null};}};
    h.app.ctChooseFiles({target:{files}});return{...h,files,parseCalls,manifestCalls,requests,storeCalls};
}

test('new ClientText v3 preparation stops before parsing on an older trusted API with an actionable error',async()=>{
    for(const names of [['Thai.xlsx'],['Polish.xlsx','Polish_Gender.xlsx']]){
        const {app,parseCalls,manifestCalls,requests,storeCalls}=uploadPreparationHarness(names);
        app._cloud={async request(route){assert.equal(route,'/v1/content-policy');return{clientTextStorageProtocols:[S.STORAGE_PROTOCOL]};}};
        await app.ctPrepareUpload();assert.match(app.ctUploadError,/ClientText v3 API update/);assert.match(app.ctUploadError,/Update the API first, then retry/);
        assert.equal(app.ctPrepared.length,0);assert.equal(app.ctUploading,false);assert.equal(parseCalls.length,0);assert.equal(manifestCalls.length,0);assert.equal(requests.length,0);assert.equal(storeCalls.length,0);
    }
});

test('new ClientText v3 publication stops before journaling or requests on an older trusted API',async()=>{
    const {app}=harness(),calls=[];app.ctPrepared=[{contentMode:'clienttext',originals:{descriptors:[{parserVersion:'clienttext-v3'}]}}];
    app._cloud={async request(route){calls.push(route);return{clientTextStorageProtocols:[S.STORAGE_PROTOCOL]};}};
    app.ctRememberPublication=()=>assert.fail('Unsupported v3 must not write a publication request');
    await app.ctPublishPrepared();assert.match(app.ctUploadError,/ClientText v3 API update/);assert.deepEqual(calls,['/v1/content-policy']);assert.equal(app.ctUploading,false);
});

test('parser capability checks retain v1/v2 replay and only require the new contract for v3',async()=>{
    const {app}=harness();app._cloud={async request(){return{clientTextStorageProtocols:[S.STORAGE_PROTOCOL]};}};
    assert.ok(await app.ctRequireTrustedProtocol(undefined,['clienttext-v1','clienttext-v2']));
    await assert.rejects(app.ctRequireTrustedProtocol(undefined,['clienttext-v2','clienttext-v3']),/ClientText v3 API update/);
    app._cloud={async request(){return{clientTextStorageProtocols:[S.STORAGE_PROTOCOL],clientTextParserVersions:['clienttext-v1','clienttext-v2','clienttext-v3']};}};
    assert.ok(await app.ctRequireTrustedProtocol(undefined,['clienttext-v3']));
});

test('local ClientText defaults require normal and Gender roles for all six observed paired languages',async()=>{
    const {app,window}=harness();window.ManagedVersions={defaults:()=>({name:'Local ClientText'}),deadlineInput:()=>''};
    await app.ctOpenUpload(null,true);
    for(const language of ['French','German','Polish','Portuguese','Russian','Spanish'])assert.deepEqual(Array.from(app.ctPolicy.clientTextRoles[language]),['normal','gender']);
    assert.deepEqual(Array.from(app.ctPolicy.clientTextRoles.default),['normal']);
});

for(const game of ['poe1','poe2'])test('neutral German normal/Gender filenames prepare in the explicitly selected '+game+' version',async()=>{
    const {app,files,parseCalls,manifestCalls,requests,storeCalls}=uploadPreparationHarness(['German_Gender.xlsm','German.xlsm'],game);
    assert.deepEqual(Array.from(app.ctUploadFiles,candidate=>[candidate.file.name,candidate.language,candidate.role]),
        [['German_Gender.xlsm','German','gender'],['German.xlsm','German','normal']]);
    await app.ctPrepareUpload();assert.equal(app.ctUploadError,'');assert.equal(app.ctPrepared.length,1);assert.equal(app.ctUploading,false);
    const group=app.ctPrepared[0];assert.equal(group.contentMode,'clienttext');assert.equal(group.language,'German');assert.deepEqual(Array.from(group.assignments),['German']);
    assert.deepEqual(Array.from(group.assets,asset=>[asset.role,asset.name]),[['normal','German.xlsm'],['gender','German_Gender.xlsm']]);
    assert.deepEqual(parseCalls.map(call=>[call.filename,call.role,call.language]),[['German.xlsm','normal','German'],['German_Gender.xlsm','gender','German']]);
    for(const asset of group.assets){const original=files.find(file=>file.name===asset.name);assert.equal(asset.blob,original);assert.equal(await asset.blob.text(),'Exact original bytes: '+asset.name);}
    assert.equal(manifestCalls.length,1);assert.equal(group.originals.descriptors.length,2);assert.equal(storeCalls.length,0);assert.equal(requests.length,1);
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


function initializationHarness(changes={}){
    const initialization=require('../public/workspaceInitialization.js').mixin,h=harness({managedOnlineAvailable:false,$nextTick:async()=>{},...changes});
    Object.assign(h.app,initialization.data());
    for(const[name,method]of Object.entries(initialization.methods))h.app[name]=method.bind(h.app);
    for(const[name,getter]of Object.entries(initialization.computed))Object.defineProperty(h.app,name,{get:()=>getter.call(h.app)});
    h.app.ctFlushDraft=async()=>true;h.app.ctFlushCommentDraft=async()=>{};h.app.ctRefreshLayout=()=>{};h.app.ctLoadMemory=async()=>{};
    return h;
}
test('cached ClientText opening uses the shared initialization owner and skips workbook parsing and downloads',async()=>{
    const f=fixture(),original=unit();await f.store.import(scope,{units:[original],assets:[asset]});
    const {app}=initializationHarness({_ctStore:f.store,ctSheetFilter:'previous workspace sheet query'}),dictionary=[];
    app.ensureDictionarySnapshot=async()=>dictionary.push('ready');
    app._ctWorker={parseWorkbook(){throw Error('Cache hit must not parse');}};
    assert.equal(await app.ctActivate(scope,await f.store.getMetadata(scope)),true);
    assert.equal(dictionary.length,1);assert.equal(app.workspaceInitializationActive,false);assert.equal(app.ctInitializing,false);assert.equal(app.ctSheetFilter,'');
    assert.deepEqual(app.workspaceInitializationRows.map(row=>row.label),['Preserving unsaved edits','Loading cached translations','Preparing context references','Preparing Dictionary matches','Opening ClientText workspace']);
    assert.equal(app.workspaceInitializationRows.every(row=>row.status==='done'),true);assert.equal(app.ctUnits[0].id,original.id);
});
test('late context reference preparation cannot publish an index into a replacement workspace',async()=>{
    const f=fixture(),original=unit();await f.store.import(scope,{units:[original],assets:[asset]});
    const {app,window}=initializationHarness({_ctStore:f.store}),adapter=window.ContentAdapters.clienttext,
        started=deferred(),pending=deferred();
    window.ContentAdapters={...window.ContentAdapters,clienttext:{...adapter,async contextReferenceIndex(units,options){
        started.resolve();await pending.promise;return adapter.contextReferenceIndex(units,options);
    }}};
    const opening=app.ctActivate(scope,await f.store.getMetadata(scope));await started.promise;
    app.ctFence();const replacement=namedUnit('Replacement');app.ctUnits=[replacement];
    app.ctWorkspace={scope:{...scope,groupId:'another-group'}};
    const cache=app._ctReferenceIndexCache={units:app.ctUnits,workspace:app.ctWorkspace,index:new Map()};
    pending.resolve();assert.equal(await opening,false);assert.equal(app.ctActive,false);
    assert.equal(app.ctUnits[0],replacement);assert.equal(app._ctReferenceIndexCache,cache);assert.equal(app.ctError,'');
});
test('late shared NPC index preparation cannot replace the index or units of a new workspace',async()=>{
    const f=fixture(),original=unit();await f.store.import(scope,{units:[original],assets:[asset]});
    const {app,window}=initializationHarness({_ctStore:f.store}),actual=window.ClientTextNpcIndex,started=deferred(),pending=deferred();
    window.ClientTextNpcIndex={...actual,async buildNpcIndex(units,options){started.resolve();await pending.promise;return actual.buildNpcIndex(units,options);}};
    const opening=app.ctActivate(scope,await f.store.getMetadata(scope));await started.promise;
    const oldUnits=app.ctUnits;app.ctFence();const replacement=namedUnit('Replacement');app.ctUnits=[replacement];app.ctWorkspace={scope:{...scope,groupId:'new-index-scope'}};
    const index=app._ctNpcIndex={groups:[],groupByKey:new Map(),units:[],unassigned:[],memberships:new Map()};
    pending.resolve();assert.equal(await opening,false);assert.equal(app._ctNpcIndex,index);assert.equal(app.ctUnits[0],replacement);assert.notEqual(app.ctUnits,oldUnits);
    assert.equal(app.ctError,'');
});
test('late conversation preparation publishes neither derived index into a replacement workspace',async()=>{
    const f=fixture(),original=unit();await f.store.import(scope,{units:[original],assets:[asset]});
    const {app,window}=initializationHarness({_ctStore:f.store}),actual=window.ClientTextConvoIndex,started=deferred(),pending=deferred();
    window.ClientTextConvoIndex={...actual,async buildConvoIndex(units,npcIndex,options){started.resolve();await pending.promise;return actual.buildConvoIndex(units,npcIndex,options);}};
    const opening=app.ctActivate(scope,await f.store.getMetadata(scope));await started.promise;assert.equal(app._ctNpcIndex,null);assert.equal(app._ctConvoIndex,null);
    app.ctFence();app.ctWorkspace={scope:{...scope,groupId:'replacement-index-scope'}};
    const npc=app._ctNpcIndex={groups:[]},convo=app._ctConvoIndex={parents:[]};pending.resolve();
    assert.equal(await opening,false);assert.equal(app._ctNpcIndex,npc);assert.equal(app._ctConvoIndex,convo);assert.equal(app.ctError,'');
});
test('a nested cached ClientText owner cannot release the shared foreground preparation gate',async()=>{
    const f=fixture();await f.store.import(scope,{units:[unit()],assets:[asset]});const {app}=initializationHarness({_ctStore:f.store});
    const outer=app.beginWorkspaceInitialization({label:'Outer selected workspace',plan:['Outer preparation']});
    assert.equal(await app.ctActivate(scope,await f.store.getMetadata(scope),outer),true);assert.equal(app.workspaceInitializationActive,true);
    assert.deepEqual(Array.from(app.workspaceInitializationPlan,step=>step.label),['Outer preparation']);app.finishWorkspaceInitialization(outer);
    assert.equal(app.workspaceInitializationActive,false);
});
function coldOpeningHarness({cache=false}={}){
    const {app,original}=initializationHarness({cloudCanAccessAllLanguages:true}),f=fixture(),calls=[],parse=[];
    const descriptor={format:S.TRUSTED_FORMAT,role:'normal',assetHash:asset.hash,parserVersion:S.PARSER_VERSION,unitCount:1,baselineId:S.hash('small')},
        version={id:scope.versionId,game:scope.game,branchId:scope.branchId,name:'Cold version'},group={id:scope.groupId,versionId:scope.versionId,contentMode:'clienttext',language:scope.language,assets:[{role:'normal',filename:'Thai.xlsx',artifactHash:asset.hash,descriptor}]};
    const originalAsset={...asset,parserVersion:S.PARSER_VERSION,parsed:{parserVersion:S.PARSER_VERSION,sheets:[]}};
    app._ctStore={...f.store,async getCachedOriginal(...args){return cache?{units:[original],asset:originalAsset,summary:S.emptySummary()}:null;}};
    app._cloud={async request(route,options){calls.push(route);if(route==='/v1/content-policy')return{clientTextStorageProtocols:[S.STORAGE_PROTOCOL],clientTextParserVersions:S.PARSER_VERSIONS};if(route.endsWith('/original')){options.onDownloadProgress(8,8);return asset.blob;}return{group};}};
    app._ctWorker={async parseWorkbook(bytes,options){parse.push(options);options.onProgress({phase:'Parsing sheet',processed:1,total:1,sheet:'ClientStrings'});return{...originalAsset.parsed,artifactHash:asset.hash,filename:'Thai.xlsx',units:[original]};},buildManifest(){throw Error('Trusted openings must not build manifests');}};
    return{app,original,f,calls,parse,version,group};
}
test('cold ClientText preparation reports real workbook/sheet context and imports small accepted descriptors',async()=>{
    const {app,calls,parse,version,group}=coldOpeningHarness();assert.equal(await app.ctOpenGroup(version,group,scope.language),true);
    assert.equal(parse.length,1);assert.equal(app.ctActive,true);assert.equal(app.workspaceInitializationActive,false);
    assert.match(app.workspaceInitializationLogText,/Parsing sheet · Thai.xlsx · ClientStrings/);
    assert.equal(app.workspaceInitializationRows.some(row=>row.label==='Downloading original: Thai.xlsx'),true);
    assert.equal(calls.some(route=>route.includes('/manifests/')),false);
});
test('reusable originals skip cold parse/download phases while keeping selected group descriptor authority',async()=>{
    const {app,calls,parse,version,group}=coldOpeningHarness({cache:true});assert.equal(await app.ctOpenGroup(version,group,scope.language),true);
    assert.equal(parse.length,0);assert.equal(calls.some(route=>route.endsWith('/original')),false);
    assert.equal(app.workspaceInitializationRows.some(row=>/^Downloading original|^Parsing original/.test(row.label)),false);
    assert.equal((await app._ctStore.getMetadata(scope)).descriptors[0].baselineId,group.assets[0].descriptor.baselineId);
});
test('cancelled cold parsing keeps a stopped shared log and never activates or commits a partial workspace',async()=>{
    const {app,version,group}=coldOpeningHarness(),pending=deferred(),started=deferred();
    app._ctWorker.parseWorkbook=async()=>{started.resolve();await pending.promise;return{artifactHash:asset.hash,filename:'Thai.xlsx',units:[unit()],parserVersion:S.PARSER_VERSION};};
    const opening=app.ctOpenGroup(version,group,scope.language);await started.promise;
    assert.equal(app.workspaceInitializationActive,true);app.ctCancel();pending.resolve();assert.equal(await opening,false);
    assert.equal(app.workspaceInitializationActive,false);assert.equal(app.workspaceInitializationRows.at(-1).status,'cancelled');assert.equal(await app._ctStore.getMetadata(scope),undefined);
});
test('old API capability blocks a cold ClientText import before original download and leaves cached work readable',async()=>{
    const {app,version,group}=coldOpeningHarness();let requests=0;
    app._cloud={async request(route){requests++;assert.equal(route,'/v1/content-policy');return{};}};
    assert.equal(await app.ctOpenGroup(version,group,scope.language),false);assert.match(app.ctError,/trusted ClientText API update/);assert.equal(requests,1);
    assert.equal(await app._ctStore.getMetadata(scope),undefined);
});
test('trusted publication sends only original assets, small descriptors and sparse work without manifest endpoints',async()=>{
    const f=fixture(),original=unit(),originalAsset={...asset,parsed:{parserVersion:S.PARSER_VERSION,sheets:[]}},originals=await S.buildDescriptors([original],[originalAsset]),
        {app}=harness({_ctStore:f.store,ctUploadVersion:{id:'v1',game:'poe2',branchId:'default',membershipRevision:0},ctUploadName:'Trusted release'}),requests=[];
    app.ctPrepared=[{contentMode:'clienttext',storageProtocol:S.STORAGE_PROTOCOL,language:'Thai',assignments:['Thai'],units:[original],assets:[originalAsset],originals,
        candidates:[{file:new File(['original'],'Thai.xlsx'),role:'normal',language:'Thai'}],carry:[],warnings:[]}];
    app._cloud={async request(route,options){requests.push({route,body:clone(options?.body)});if(route==='/v1/content-policy')return{clientTextStorageProtocols:[S.STORAGE_PROTOCOL],clientTextParserVersions:S.PARSER_VERSIONS};
        if(route==='/v1/content-uploads' || route==='/v1/content-uploads/upload')return{upload:{id:'upload',status:'awaiting_assets'}};
        if(route.endsWith('/finalize'))return{version:{...app.ctUploadVersion,membershipRevision:1},group:{id:'published-group',contentMode:'clienttext',language:'Thai'}};return{};}};
    app.refreshManagedVersions=async()=>{};app.managedReadDetails=async()=>{};await app.ctPublishPrepared();assert.equal(app.ctUploadError,'');
    assert.equal(requests.some(request=>request.route.includes('/manifests/')),false);
    const create=requests.find(request=>request.route==='/v1/content-uploads'),finalize=requests.find(request=>request.route.endsWith('/finalize'));
    assert.equal(create.body.storageProtocol,S.STORAGE_PROTOCOL);assert.deepEqual(finalize.body.descriptors,originals.descriptors);
    assert.deepEqual(finalize.body.summaries,originals.summaries);assert.equal(finalize.body.storageProtocol,S.STORAGE_PROTOCOL);
    assert.equal(finalize.body.descriptors[0].root,undefined);assert.equal(await f.store.getRequest(app.ctRequestScope(),app._ctPublicationRequest || 'unused'),undefined);
});
test('unfinished legacy publication conversion retains exact old bodies and creates new trusted request identities',async()=>{
    const {app}=harness(),createBody={idempotencyKey:'old-group-command',contentMode:'clienttext'},finalizeBody={idempotencyKey:'old-group-command',descriptors:[{root:'retained-root'}]},
        prepared={contentMode:'clienttext',language:'Thai',assignments:['Thai'],units:[unit()],assets:[{...asset,parsed:{parserVersion:'clienttext-v1'}}],candidates:[{role:'normal'}],requestId:'old-group-command',createBody:clone(createBody),finalizeBody:clone(finalizeBody)},writes=[];
    app._ctPublicationRequest='old-publication';app._ctAbort=new AbortController();app._ctStore={async getRequest(){return{payload:{kind:'publication',groups:[{createBody,finalizeBody}]}};},async putRequest(scope,id,payload){writes.push({id,payload:clone(payload)});}};
    app.ctPrepareCarry=async group=>{group.carry=[];};app.ctRememberPublication=async()=>{};
    await app.ctConvertLegacyPublication(prepared,{id:'v1',membershipRevision:2});
    assert.equal(writes[0].id,'old-publication');assert.equal(writes[0].payload.kind,'publication-recovery');assert.deepEqual(writes[0].payload.groups[0],{createBody,finalizeBody});
    assert.notEqual(prepared.requestId,'old-group-command');assert.notEqual(app._ctPublicationRequest,'old-publication');assert.equal(prepared.createBody.storageProtocol,S.STORAGE_PROTOCOL);
    assert.equal(prepared.finalizeBody,null);assert.equal(prepared.originals.descriptors[0].parserVersion,'clienttext-v1');
});


test('opening another language preserves the current translator draft before changing selected language',async()=>{
    const {app,version,group}=coldOpeningHarness({cache:true}),order=[];app.lang='German';app.ctWorkspace.scope.language='German';app.ctDraftDirty=true;
    app.ctFlushDraft=async()=>{order.push(app.lang);app.ctDraftDirty=false;return true;};app.ctFlushCommentDraft=async()=>order.push('comment:'+app.lang);app.ensureDictionarySnapshot=async()=>{assert.equal(app.lang,'Thai');};
    assert.equal(await app.ctOpenGroup(version,group,'Thai'),true);
    assert.equal(order[0],'German');assert.equal(order[1],'comment:German');assert.equal(app.lang,'Thai');assert.equal(app.ctWorkspace.scope.language,'Thai');
});
test('uncertain legacy finalization uses live accepted upload state before any conversion or original reupload',async()=>{
    const {app}=harness(),calls=[],create={contentMode:'clienttext',idempotencyKey:'old-command'},version={id:'accepted-version',membershipRevision:1};
    app.ctPrepared=[{contentMode:'clienttext',language:'Thai',assignments:['Thai'],requestId:'old-command',createBody:clone(create),published:false}];
    app.ctUploadVersion={id:'accepted-version',membershipRevision:0};app._ctPublicationRequest='old-journal';app.ctRememberPublication=async()=>{};app._ctStore={async deleteRequest(){}};
    app._cloud={async request(route,options){calls.push({route,body:clone(options?.body)});if(route==='/v1/content-policy')return{clientTextStorageProtocols:[S.STORAGE_PROTOCOL]};
        if(route==='/v1/content-uploads')return{upload:{id:'old-upload',status:'uploading'}};
        if(route==='/v1/content-uploads/old-upload')return{upload:{id:'old-upload',status:'accepted',groupId:'accepted-group'}};
        if(route==='/v1/content-groups/accepted-group')return{group:{id:'accepted-group',version}};throw Error('Must not convert or reupload');}};
    app.ctConvertLegacyPublication=()=>{throw Error('Already accepted');};app.refreshManagedVersions=async()=>{};app.managedReadDetails=async()=>{};
    await app.ctPublishPrepared();assert.equal(app.ctUploadError,'');assert.deepEqual(calls.find(call=>call.route==='/v1/content-uploads').body,create);
    assert.equal(calls.some(call=>/assets|finalize|manifest/.test(call.route)),false);assert.equal(app.ctUploadVersion.id,version.id);
});


test('ClientText history comparison teleports outside the sticky editor sidebar stacking context',()=>{
    const {window}=harness(),template=window.EditorComponents.History.template;
    assert.equal(window.ClientTextUI.toolsComponent,window.EditorComponents.Tools);
    assert.match(template,/<Teleport to="body"><div v-if="ctHistoryViewer"/);assert.match(template,/<\/div><\/Teleport>\s*<\/section>/);
    assert.match(fs.readFileSync(path.join(__dirname,'../public/client-text.css'),'utf8'),/\.ctHistoryBackdrop[^}]*z-index:16000/);
});

test('offline sheet testing is available to every role including guests and does not request publication policy',async()=>{
    for(const role of ['manager','admin','translator','guest']){
        const {app}=cloudAccessHarness(harness(), 'Thai');
        app.cloudUser.role=role;app.ctActive=false;
        if(role==='guest'){app.cloudSignedIn=false;app.cloudProfileId='guest';app.cloudUser=null;}
        app._cloud={request(){assert.fail('Opening a test must stay local');}};
        assert.equal(await app.ctOpenOfflineTest(),true);
        assert.equal(app.ctUploadVisible,true);
        assert.equal(app.ctUploadTest,true);assert.equal(app.ctUploadLocal,true);app.ctCloseUpload();
    }
});

test('offline test preparation accepts individual paired-language roles without cache reads or requests',async()=>{
    for(const name of ['French.xlsm','French_Gender.xlsm']){
        const {app,parseCalls,requests,storeCalls}=uploadPreparationHarness([name]);
        Object.assign(app,{ctUploadTest:true,ctUploadLocal:true,managedManagerAccess:true});
        app._ctStore=new Proxy({}, {get(){assert.fail('Test preparation must not use durable caches');}});
        await app.ctPrepareUpload();assert.equal(app.ctUploadError,'');assert.equal(app.ctPrepared.length,1);
        assert.equal(parseCalls.length,1);assert.deepEqual(requests,[]);assert.deepEqual(storeCalls,[]);
    }
    const h=uploadPreparationHarness(['French.xlsm','Thai.xlsm']);
    Object.assign(h.app,{ctUploadTest:true,ctUploadLocal:true,managedManagerAccess:true});
    await h.app.ctPrepareUpload();assert.match(h.app.ctUploadError,/one language at a time/);assert.equal(h.parseCalls.length,0);
});

test('offline test activation, drafts, save/history and exit use memory and restore normal filters',async()=>{
    const Memory=require('../public/clientTextMemoryStore.js'),store=Memory.create(),original=unit(),
        testScope={...scope,versionId:'local:test:version',groupId:'local:test:group',language:'French'},
        metadata={version:{id:testScope.versionId,name:'Test Sheet Offline'},group:{id:testScope.groupId,contentMode:'clienttext',language:'French'}};
    await store.import(testScope,{units:[original],assets:[asset],metadata});
    const h=initializationHarness({lang:'Thai',managedManagerAccess:true,ctTool:'history',ctSelectedFilters:['saved'],
        _ctTestStores:new Map([[testScope.groupId,store]]),_ctStore:new Proxy({}, {get(){assert.fail('Test operation must not access durable storage');}})}),{app,mixin}=h;
    app.ensureDictionarySnapshot=()=>assert.fail('Test activation must not load/sync Dictionary');
    app.managedOnlineAvailable=true;app.cloudCanAccessAllLanguages=true;app._cloud={request(){assert.fail('Test operation must not request cloud data');}};
    assert.equal(await app.ctActivate(testScope,metadata),true);assert.equal(app.lang,'Thai');assert.equal(app.ctOfflineTest,true);assert.ok(app._ctNpcIndex);assert.ok(app._ctConvoIndex);
    assert.ok(app.ctSelectedFilters.includes('unchanged'));assert.equal(mixin.computed.ctDictionaryReady.call(app),false);
    for(const method of ['ctFlushDraft','ctLoadHistory','ctLoadMemory','ctFlushCommentDraft'])app[method]=mixin.methods[method].bind(app);
    await app.ctSelect(app.ctUnits[0],true);app.ctValues[fieldId]='Exact @ text\\n\r\n';app.ctDraftDirty=true;
    assert.equal(await app.ctSave(),true);await settle();
    assert.equal(app.ctSaved[original.id].values[fieldId],'Exact @ text\\n\r\n');assert.equal(app.ctHistory.length,1);
    app.ctCommentText='Private test text';assert.equal(await app.ctPostComment(),false);
    assert.equal(await app.ctLoadReplyCommentDraft(original.id),null);await app.ctFlushCommentDraft();
    const oldScope=clone(testScope);assert.equal(await app.ctShowVersionChooser(),true);
    assert.equal(app.ctActive,false);assert.equal(app._ctTestStores.size,0);assert.deepEqual(clone(app.ctValues),{});assert.deepEqual(clone(app.ctReviewed),{});
    assert.deepEqual(Array.from(app.ctSelectedFilters),['saved']);assert.equal(app.ctTool,'history');assert.equal(app._ctDraftHeads.size,0);
    assert.throws(()=>app.ctStorage(oldScope),/session has ended/);await assert.rejects(store.getSaved(oldScope),{code:'LOCAL_TEST_DISPOSED'});
});

test('late test draft work cannot fall back to durable storage after disposal',async()=>{
    const pending=deferred(),started=deferred(),testScope={...scope,versionId:'local:test:v',groupId:'local:test:g'},
        {app}=harness({ctWorkspace:{scope:testScope},ctDraftDirty:true});
    let disposed=false;
    const memory={async putDraft(){started.resolve();await pending.promise;if(disposed)throw Object.assign(new Error('closed'),{stale:true});return{revision:1};},dispose(){disposed=true;}};
    app._ctTestStores=new Map([[testScope.groupId,memory]]);
    app._ctStore=new Proxy({}, {get(){assert.fail('A stale test must never use durable storage');}});
    const saving=app.ctFlushDraft();await started.promise;app.ctFence();pending.resolve();assert.equal(await saving,false);
    assert.equal(app.ctActive,false);assert.deepEqual(clone(app.ctValues),{});assert.equal(app._ctTestStores.size,0);
});

test('changing Settings to the test language still ends the temporary session',()=>{
    const {app,mixin}=harness({lang:'French',ctWorkspace:{scope:{...scope,versionId:'local:test:v',groupId:'local:test:g',language:'French'}}});
    app._ctStore={};mixin.watch.lang.call(app);
    assert.equal(app.ctActive,false);assert.equal(app.ctWorkspace,null);assert.deepEqual(clone(app.ctValues),{});
});

test('combined offline Open waits for validation, rejects duplicate clicks and leaves normal uploads alone',async()=>{
    const {app}=harness({ctUploadTest:true,ctUploadVisible:true,managedManagerAccess:true,ctUploadFiles:[{}]}),gate=deferred(),calls=[];
    app.ctPrepareUpload=async()=>{calls.push('prepare');app._ctAbort=new AbortController();await gate.promise;app.ctPrepared=[{}];};
    app.ctPublishPrepared=async()=>{calls.push('open');return true;};
    const opening=app.ctOpenTestSheet();assert.deepEqual(calls,['prepare']);
    assert.equal(await app.ctOpenTestSheet(),false,'duplicate click cannot prepare or open twice');
    gate.resolve();assert.equal(await opening,true);assert.deepEqual(calls,['prepare','open']);
    assert.equal(app._ctTestOpenRun,null);
    app.ctUploadTest=false;assert.equal(await app.ctOpenTestSheet(),false);assert.deepEqual(calls,['prepare','open']);
});

test('combined offline Open never opens failed, cancelled or superseded preparation',async()=>{
    for(const change of [app=>{app.ctUploadError='Invalid workbook';},app=>{app._ctAbort.abort();},
        app=>{app.managedCatalogScope='another-account';},app=>{app._ctEpoch=1;},app=>{app.ctUploadVisible=false;},app=>{app.ctUploadTest=false;}]){
        const {app}=harness({ctUploadTest:true,ctUploadVisible:true,managedManagerAccess:true,ctUploadFiles:[{}],ctPrepared:[{old:true}]}),gate=deferred();
        app.ctPrepareUpload=async()=>{app._ctAbort=new AbortController();await gate.promise;};
        app.ctPublishPrepared=()=>assert.fail('A failed or stale preparation cannot open old prepared work');
        const opening=app.ctOpenTestSheet();change(app);gate.resolve();
        assert.equal(await opening,false);assert.equal(app._ctTestOpenRun,null);
    }
});
