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
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/clientTextUi.js'),'utf8'),context);
    const mixin=window.ClientTextUI.mixin,original=unit(),app={...mixin.data(),managedCatalogScope:'alice:poe2',cloudProfileId:scope.accountId,gameVersion:scope.game,branchId:scope.branchId,
        ctWorkspace:{scope:clone(scope)},ctActive:true,ctSelection:original.id,ctUnits:[original],ctSaved:{},ctValues:S.valuesFor(original),ctReviewed:{},
        _ctUnitIndex:new Map([[original.id,original]]),_ctWorkUnits:new Map(),_ctEditRevision:0,_ctDraftRevision:null,...changes};
    for(const[name,method]of Object.entries(mixin.methods))app[name]=method.bind(app);
    Object.defineProperty(app,'ctCurrentUnit',{get:()=>app._ctUnitIndex.get(app.ctSelection)||null});
    app.ctLoadHistory=()=>{};app.ctPresence=async()=>{};app.ctRefreshDiagnostics=()=>{};
    return {app,mixin,window,original};
}
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
    const {app,original}=harness(),pending=deferred();let reads=0;
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
