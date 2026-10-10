const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const N = require('../public/normalizedStore.js');
const W = require('../public/workspaceState.js');
const TM = require('../public/translationMemory.js');
const copy = value => value === undefined ? undefined : structuredClone(value);

// Transactional IDB adapter: writes are private until completion and roll back
// together on failure. Real browser storage is exercised by the normal fixture.
function fixture(options={}) {
  const tables = new Map([...N.names, 'kv', 'revisions', 'revisions_poe1', 'revisions_poe2'].map(name => [name, new Map()]));
  let failStore = '';
  const operations = [];
  const db = { objectStoreNames: { contains: name => tables.has(name) }, close() {}, transaction(names, mode) {
    names = Array.isArray(names) ? names : [names];
    const snapshots = new Map(names.map(name => [name, new Map([...tables.get(name)].map(([key,value]) => [key,copy(value)]))]));
    let pending = 0, finished = false, timer;
    const tx = { mode, error: null, abort() {
      if (finished) return; finished = true; clearImmediate(timer); queueMicrotask(() => tx.onabort?.());
    }, objectStore(name) {
      assert.ok(names.includes(name), name);
      const rows = snapshots.get(name);
      const run = callback => {
        const req = {}; pending++; clearImmediate(timer);
        queueMicrotask(() => {
          if (finished) { pending--; return; }
          try { req.result = copy(callback()); req.onsuccess?.(); }
          catch (error) { req.error = error; tx.error = error; req.onerror?.(); tx.abort(); }
          pending--; schedule();
        });
        return req;
      };
      const select = (field, value) => [...rows.values()].filter(row => value == null || row[field] === value).sort((a,b) => a.key.localeCompare(b.key));
      return {
        get: key => run(() => rows.get(key)),
        getAll: () => run(() => [...rows.values()]),
        put: value => run(() => {
          assert.equal(mode, 'readwrite'); if (failStore === name) throw new Error('Simulated ' + name + ' failure');
          rows.set(value.key, copy(value)); return value.key;
        }),
        add: value => run(() => {
          assert.equal(mode, 'readwrite'); if (failStore === name) throw new Error('Simulated ' + name + ' failure');
          const id = Math.max(0, ...rows.keys()) + 1; rows.set(id, { ...copy(value), id }); return id;
        }),
        delete: key => run(() => { assert.equal(mode, 'readwrite'); rows.delete(key); }),
        index(index) {
          const field = { by_scope: 'scope', by_identity: 'identityScope', by_kind: 'kindScope', by_path:'pathKey' }[index];
          return {
            get: value => run(() => select(field, value)[0]),
            getAll: (value, count) => run(() => { operations.push({ name, index, count }); return select(field, value).slice(0, count ?? Infinity); }),
            count: value => run(() => select(field,value).length),
          };
        },
      };
    } };
    function schedule() { if (!pending && !finished) timer = setImmediate(() => {
      if (pending || finished) return; finished = true;
      if (mode === 'readwrite') for (const [name, rows] of snapshots) tables.set(name, rows);
      tx.oncomplete?.();
    }); }
    schedule(); return tx;
  } };
  const root = { WorkspaceState: W, NormalizedStore: N, TranslationMemory: TM };
  if(options.BroadcastChannel) root.BroadcastChannel=options.BroadcastChannel;
  const indexedDB = { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/offlineStore.js'),'utf8'), { ...(options.worker?{self:root}:{window:root}), indexedDB,
    console, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto });
  return { store: root.OfflineStore, tables, operations, fail: name => { failStore = name; } };
}
const scope = { profile: 'alice', language: 'Thai' };
const unit = (target = 'เพิ่มความเสียหาย {0}', index = 0) => ({ source: 'Gain {0} damage', target, gameScope: 'poe1',
  context: { filepath: 'stats.txt', stats: ['damage'], condition: '#', remarks: '', entryIndex: index } });
async function snapshot(f, selected = scope) { return copy(await f.store.getTranslationMemory(selected)); }
async function bootstrap(f, units = [], revision = 0) {
  await f.store.applyTranslationMemoryRemote(scope, { units, revision, tombstones: [] }, { bootstrap: true, complete: true, cursorRevision: revision });
}
async function accept(f, request, revision, unitRevision = 1) {
  const units = request.upserts.map(value => { const result = { ...value, revision: unitRevision }; delete result.baseRevision; delete result.restore; return result; });
  const tombstones = request.deletions.map(value => ({ ...unit(), id: value.id, revision: unitRevision, deleted: true }));
  await f.store.acknowledgeTranslationMemoryWrite(scope, request.mutationId, { mutationId: request.mutationId, revision, appliedRevision: revision,
    units, tombstones, accepted: [...units,...tombstones] });
}

test('contextual corrections are one unit with retained history and independent profiles/languages', async () => {
  const f = fixture();
  await f.store.putTranslationMemoryUnits(scope, [unit()], { origin: 'learn', mutationId: 'save-1' });
  const first = (await snapshot(f)).units[0];
  await f.store.putTranslationMemoryUnits(scope, [unit('แก้ไข {0}')], { origin: 'learn', mutationId: 'save-2' });
  const state = await snapshot(f);
  assert.equal(state.units.length,1); assert.equal(state.units[0].id,first.id); assert.equal(state.units[0].target,'แก้ไข {0}');
  assert.equal(state.units[0].localRevision,2);
  const history = copy(await f.store.listTranslationMemoryHistory(scope,first.id));
  assert.equal(history.length,2); assert.ok(history.some(event => event.before?.target === first.target));
  await f.store.putTranslationMemoryUnits(scope,[unit('ต่างบริบท {0}',1),{...unit('ทั่วไป {0}'),gameScope:'all'}]);
  assert.equal((await snapshot(f)).units.length,3);
  assert.equal((await snapshot(f,{profile:'alice',language:'German'})).units.length,0);
  assert.equal((await snapshot(f,{profile:'bob',language:'Thai'})).units.length,0);
});

test('reviewed edits reject changed local revisions even before a cloud revision exists',async()=>{
  const f=fixture();await f.store.putTranslationMemoryUnits(scope,[unit()]); const old=(await snapshot(f)).units[0];
  await f.store.putTranslationMemoryUnits(scope,[unit('ใหม่ {0}')]);
  await assert.rejects(f.store.putTranslationMemoryUnits(scope,[{...old,target:'ล้าสมัย {0}'}],
    {expectedRevision:old.revision,expectedLocalRevision:old.localRevision}),/changed after this review/);
  assert.equal((await snapshot(f)).units[0].target,'ใหม่ {0}');
});

test('frozen uploads retry unchanged and acknowledgements keep newer local corrections',async()=>{
  const f=fixture();await bootstrap(f);await f.store.putTranslationMemoryUnits(scope,[unit()]);
  const first=copy((await f.store.getTranslationMemoryPending(scope))[0]);
  assert.equal(Object.hasOwn(first.upserts[0],'language'),false);
  await f.store.putTranslationMemoryUnits(scope,[unit('ใหม่ {0}')]);
  assert.deepEqual(copy((await f.store.getTranslationMemoryPending(scope))[0]),first);
  await accept(f,first,7,1);
  const state=await snapshot(f);assert.equal(state.units[0].target,'ใหม่ {0}');assert.equal(state.units[0].revision,1);
  assert.equal(state.revision,0,'A mutation acknowledgement cannot skip remote replay events.');
  const next=copy((await f.store.getTranslationMemoryPending(scope))[0]);
  assert.equal(next.upserts[0].baseRevision,1);assert.equal(next.upserts[0].target,'ใหม่ {0}');
});

test('first synchronization unions identities and preserves conflicting corrections for a choice',async()=>{
  const f=fixture();await f.store.putTranslationMemoryUnits(scope,[unit()]); const local=(await snapshot(f)).units[0];
  await bootstrap(f,[{...local,id:'shared-id',target:'ส่วนกลาง {0}',revision:2}],3);
  let state=await snapshot(f);assert.equal(state.units.length,1);assert.equal(state.units[0].id,'shared-id');
  assert.equal(state.units[0].target,'ส่วนกลาง {0}');assert.equal(state.conflicts[0].local.target,local.target);
  assert.deepEqual(copy(await f.store.getTranslationMemoryPending(scope)),[]);
  await f.store.resolveTranslationMemoryConflict(scope,'shared-id','local',{expectedRevision:2});
  state=await snapshot(f);assert.equal(state.conflicts.length,0);assert.equal(state.units[0].target,local.target);
  assert.equal((await f.store.getTranslationMemoryPending(scope))[0].upserts[0].baseRevision,2);
});

test('shared tombstones suppress automatic relearning until explicit restoration',async()=>{
  const f=fixture();await bootstrap(f);await f.store.putTranslationMemoryUnits(scope,[unit()],{origin:'learn'});
  const wire=copy((await f.store.getTranslationMemoryPending(scope))[0]);await accept(f,wire,1);
  const active=(await snapshot(f)).units[0];
  await f.store.applyTranslationMemoryRemote(scope,{revision:2,units:[],tombstones:[{...active,revision:2,deleted:true}]});
  await f.store.putTranslationMemoryUnits(scope,[unit('ใหม่ {0}')],{origin:'learn'});
  assert.equal((await snapshot(f)).units.length,0);assert.deepEqual(copy(await f.store.getTranslationMemoryPending(scope)),[]);
  await f.store.putTranslationMemoryUnits(scope,[{...active,target:'คืนค่า {0}'}],{restore:true,expectedRevision:2});
  const next=(await f.store.getTranslationMemoryPending(scope))[0];assert.equal(next.upserts[0].restore,true);assert.equal(next.upserts[0].baseRevision,2);
});

test('deleting an unshared local unit cancels creation and retains local suppression',async()=>{
  const f=fixture();await bootstrap(f);await f.store.putTranslationMemoryUnits(scope,[unit()]);const active=(await snapshot(f)).units[0];
  await f.store.deleteTranslationMemoryUnit(scope,active.id,{expectedLocalRevision:active.localRevision});
  const state=await snapshot(f);assert.equal(state.units.length,0);assert.equal(state.tombstones.length,1);
  assert.deepEqual(copy(await f.store.getTranslationMemoryPending(scope)),[]);
});

test('bootstrap staging preserves its first watermark and rejects older unit generations',async()=>{
  const f=fixture(),raw={...unit(),id:'u',revision:3};
  await f.store.applyTranslationMemoryRemote(scope,{revision:10,units:[raw]},{bootstrap:true});
  await f.store.applyTranslationMemoryRemote(scope,{revision:12,units:[{...raw,target:'เก่า {0}',revision:2}]},{bootstrap:true});
  assert.equal((await snapshot(f)).bootstrapAnchor,10);
  await f.store.applyTranslationMemoryRemote(scope,{revision:13,units:[],tombstones:[{...raw,revision:4,deleted:true}]},{bootstrap:true});
  await f.store.applyTranslationMemoryRemote(scope,{revision:13,units:[]},{bootstrap:true,complete:true,cursorRevision:13});
  const state=await snapshot(f);assert.equal(state.revision,13);assert.equal(state.units.length,0);assert.equal(state.tombstones[0].revision,4);
});

test('a restored server can rebootstrap lower revisions without discarding local work or missing shared units',async()=>{
  const f=fixture(),shared={...unit(),id:'shared',revision:5},missing={...unit('หายจากสำรอง {0}',1),id:'missing',revision:2};
  await bootstrap(f,[shared,missing],7);const before=(await snapshot(f)).units.find(value=>value.id===shared.id);
  await f.store.putTranslationMemoryUnits(scope,[{...before,target:'ของฉัน {0}'}],{origin:'edit',expectedUnits:{[before.id]:before}});
  const staleWire=(await f.store.getTranslationMemoryPending(scope))[0];assert.equal(staleWire.upserts[0].baseRevision,5);
  await f.store.resetTranslationMemoryBootstrap(scope);
  const reset=await f.store.getTranslationMemoryState(scope);assert.equal(reset.revision,0);assert.equal(reset.bootstrapped,false);
  await bootstrap(f,[{...shared,target:'จากสำรอง {0}',revision:1}],1);
  let state=await snapshot(f);assert.equal(state.revision,1);assert.equal(state.conflicts.length,2);
  assert.equal(state.units[0].revision,1);assert.equal(state.conflicts.find(row=>row.id===shared.id).local.target,'ของฉัน {0}');
  assert.equal(state.conflicts.find(row=>row.id===missing.id).local.target,missing.target);
  assert.equal(state.conflicts.find(row=>row.id===missing.id).shared,null);
  assert.deepEqual(copy(await f.store.getTranslationMemoryPending(scope)),[]);
  await f.store.resolveTranslationMemoryConflict(scope,shared.id,'local',{expectedRevision:1});
  state=await snapshot(f);assert.equal(state.units[0].target,'ของฉัน {0}');
  const wire=(await f.store.getTranslationMemoryPending(scope))[0];assert.notEqual(wire.mutationId,staleWire.mutationId);assert.equal(wire.upserts[0].baseRevision,1);
});

test('rebootstrap accepts lower shared revisions for identical content without a needless conflict',async()=>{
  const f=fixture(),shared={...unit(),id:'same',revision:4};await bootstrap(f,[shared],7);
  await f.store.resetTranslationMemoryBootstrap(scope);await bootstrap(f,[{...shared,revision:1}],1);
  const state=await snapshot(f);assert.equal(state.units[0].revision,1);assert.equal(state.conflicts.length,0);
});

test('guard failures roll back unit, outbox and history together',async()=>{
  const f=fixture();let calls=0;
  await assert.rejects(f.store.putTranslationMemoryUnits(scope,[unit()],{guard:()=>++calls<3}),/account or language changed/);
  const state=await snapshot(f);assert.equal(state.units.length,0);assert.equal(state.pending,0);assert.equal((await f.store.listTranslationMemoryHistory(scope)).length,0);
});

test('guest adoption is durable, retains guest data and never overwrites destination corrections',async()=>{
  const f=fixture(),guest={profile:'guest',language:'Thai'};await f.store.putTranslationMemoryUnits(guest,[unit(),unit('อีกบริบท {0}',1)]);
  await f.store.putTranslationMemoryUnits(scope,[unit('ของบัญชี {0}')]);
  await f.store.adoptTranslationMemoryProfile('guest','alice');
  let state=await snapshot(f);assert.equal(state.units.length,2);assert.ok(state.units.some(value=>value.target==='ของบัญชี {0}'));
  assert.equal((await snapshot(f,guest)).units.length,2);
  await f.store.putTranslationMemoryUnits(guest,[unit('ภายหลัง {0}',2)]);await f.store.adoptTranslationMemoryProfile('guest','alice');
  assert.equal((await snapshot(f)).units.length,2);
});

test('guest adoption retains suppression and safely separates repurposed destination IDs',async()=>{
  const f=fixture(),guest={profile:'guest',language:'Thai'};await f.store.putTranslationMemoryUnits(guest,[unit(),unit('ลบ {0}',1)]);
  const guestState=await snapshot(f,guest),removed=guestState.units.find(value=>value.context.entryIndex===1);
  await f.store.deleteTranslationMemoryUnit(guest,removed.id);
  await f.store.putTranslationMemoryUnits(scope,[unit()]);const destination=(await snapshot(f)).units[0];
  await f.store.putTranslationMemoryUnits(scope,[{...destination,source:'Grant {0} damage'}],{origin:'edit',expectedUnits:{[destination.id]:destination}});
  await f.store.adoptTranslationMemoryProfile('guest','alice');
  const state=await snapshot(f);assert.equal(state.units.length,2);assert.equal(state.tombstones.length,1);
  assert.equal(new Set([...state.units,...state.tombstones].map(value=>value.id)).size,3);
  await bootstrap(f);const wire=(await f.store.getTranslationMemoryPending(scope))[0];
  assert.equal(wire.deletions[0].source,removed.source);
  assert.equal((await snapshot(f,guest)).tombstones.length,1);
});

test('ordinary save atomically learns with staged work, history and receipt; failures retain all prior state',async()=>{
  const f=fixture(),desc={filepath:'stats.txt',stats:['damage'],variables:['#'],remarks:[''],translations:{English:['Gain {0} damage'],Thai:['old']}};
  const workspace={sourceHash:'source',descs:[copy(desc)],status:{}};W.initializeWorkspace(workspace,{source:[desc],sourceHash:'source',game:'poe1',language:'Thai'});
  f.tables.get('kv').set('workspace_poe1',{key:'workspace_poe1',value:workspace});
  const batch={jobId:'save-job',game:'poe1',accountId:'alice',sourceHash:'source',language:'Thai',origin:'save',
    files:[{filepath:'stats.txt',translations:['ใหม่ {0}'],trackedForExport:true}],descriptions:[desc],
    revisions:[{filepath:'stats.txt',lang:'Thai',translations:['ใหม่ {0}']}],tmCapture:TM.unitsFromDescription(desc,['ใหม่ {0}'],'Thai',{game:'poe1',jobId:'save-job'})};
  f.fail('tm_units');await assert.rejects(f.store.saveTranslationBatch(batch),/Simulated tm_units failure/);
  assert.equal((await snapshot(f)).units.length,0);assert.equal(f.tables.get('revisions_poe1').size,0);
  assert.equal(f.tables.get('kv').get('workspace_poe1').value.descs[0].translations.Thai[0],'old');
  f.fail('');const ack=await f.store.saveTranslationBatch(batch);assert.equal(ack.tmChanged,true);
  assert.equal((await snapshot(f)).units[0].target,'ใหม่ {0}');assert.equal(f.tables.get('revisions_poe1').size,1);
  const replay=await f.store.saveTranslationBatch(batch);assert.equal(replay.duplicate,true);
  assert.equal((await f.store.listTranslationMemoryHistory(scope)).length,1);assert.equal(f.tables.get('revisions_poe1').size,1);
});

test('pending lookup uses bounded index reads rather than materializing the TM corpus',async()=>{
  const f=fixture();await bootstrap(f);await f.store.putTranslationMemoryUnits(scope,Array.from({length:130},(_,index)=>unit('แปล {0}',index)));
  const outgoing=await f.store.getTranslationMemoryPending(scope);assert.equal(outgoing[0].upserts.length,100);
  assert.ok(f.operations.some(value=>value.name==='tm_outbox'&&value.index==='by_kind'&&value.count===100));
});

test('large multiline TM units split immutable batches by encoded bytes and retain the remaining work',async()=>{
  const f=fixture();await bootstrap(f);const target='ก'.repeat(32760)+' {0}';
  await f.store.putTranslationMemoryUnits(scope,Array.from({length:12},(_,index)=>unit(target,index)));
  const first=copy((await f.store.getTranslationMemoryPending(scope))[0]);
  assert.ok(first.upserts.length<12);assert.ok(first.upserts.length>1);
  assert.ok(Buffer.byteLength(JSON.stringify(first))<=900*1024);
  assert.deepEqual(copy((await f.store.getTranslationMemoryPending(scope))[0]),first);
  await accept(f,first,first.upserts.length,1);
  const remaining=copy((await f.store.getTranslationMemoryPending(scope))[0]);
  assert.equal(first.upserts.length+remaining.upserts.length,12);
  assert.ok(Buffer.byteLength(JSON.stringify(remaining))<=900*1024);
});

test('oversized encoded context rejects reviewed writes and automatic learning skips it without blocking a save',async()=>{
  const f=fixture(),large={...unit(),context:{...unit().context,stats:Array(128).fill('\u0000'.repeat(1024))},source:'\u0000'.repeat(32768),target:'\u0000'.repeat(32768)};
  await assert.rejects(f.store.putTranslationMemoryUnits(scope,[large],{origin:'seed'}),/too large to synchronize/);
  assert.equal((await snapshot(f)).units.length,0);
  await f.store.putTranslationMemoryUnits(scope,[large,unit()],{origin:'learn'});
  assert.equal((await snapshot(f)).units.length,1);
});

test('reviewed source/scope edits keep identity history while later learning recreates the old context separately',async()=>{
  const f=fixture();await f.store.putTranslationMemoryUnits(scope,[unit()]);const old=(await snapshot(f)).units[0];
  await f.store.putTranslationMemoryUnits(scope,[{...old,source:'Grant {0} damage',gameScope:'all'}],
    {origin:'edit',expectedUnits:{[old.id]:old},expectedLocalRevision:old.localRevision});
  const edited=(await snapshot(f)).units[0];assert.equal(edited.id,old.id);assert.equal(edited.gameScope,'all');
  await f.store.putTranslationMemoryUnits(scope,[unit('ใหม่ {0}')],{origin:'learn'});
  const state=await snapshot(f);assert.equal(state.units.length,2);assert.equal(new Set(state.units.map(value=>value.id)).size,2);
  assert.ok((await f.store.listTranslationMemoryHistory(scope,old.id)).some(event=>event.before?.source===old.source&&event.after?.source===edited.source));
});

test('manager identity edits reject an existing contextual unit without overwriting either correction',async()=>{
  const f=fixture();await f.store.putTranslationMemoryUnits(scope,[unit(),{...unit('ทางเลือก {0}'),gameScope:'all'}]);
  const before=await snapshot(f),old=before.units.find(value=>value.gameScope==='poe1');
  await assert.rejects(f.store.putTranslationMemoryUnits(scope,[{...old,gameScope:'all'}],{origin:'edit',expectedUnits:{[old.id]:old}}),/already uses this source/);
  assert.deepEqual((await snapshot(f)).units,before.units);
});

test('reviewed new IDs cannot bypass contextual collisions or overwrite an existing correction',async()=>{
  const f=fixture();await f.store.putTranslationMemoryUnits(scope,[unit()]);const before=(await snapshot(f)).units[0];
  await assert.rejects(f.store.putTranslationMemoryUnits(scope,[{...unit('แทนที่ {0}'),id:'manual-new'}],
    {origin:'edit',expectedUnits:{'manual-new':null}}),/changed after this review/);
  assert.equal((await snapshot(f)).units[0].target,before.target);
});

test('reviewed history can restore an earlier source identity with the same stable ID',async()=>{
  const f=fixture();await f.store.putTranslationMemoryUnits(scope,[unit()]);const before=(await snapshot(f)).units[0];
  await f.store.putTranslationMemoryUnits(scope,[{...before,source:'Grant {0} damage'}],{origin:'edit',expectedUnits:{[before.id]:before}});
  const edited=(await snapshot(f)).units[0];
  await f.store.putTranslationMemoryUnits(scope,[before],{origin:'restore',restore:true,expectedUnits:{[edited.id]:edited}});
  const restored=(await snapshot(f)).units[0];assert.equal(restored.id,before.id);assert.equal(restored.source,before.source);
});

test('choosing a conflicting local deletion preserves suppression instead of reviving its old target',async()=>{
  const f=fixture(),shared={...unit(),id:'original',revision:1};await bootstrap(f,[shared],1);
  await f.store.deleteTranslationMemoryUnit(scope,shared.id);
  await f.store.applyTranslationMemoryRemote(scope,{revision:2,units:[{...shared,target:'ส่วนกลาง {0}',revision:2}]});
  const conflict=(await snapshot(f)).conflicts[0];assert.equal(conflict.local.deleted,true);
  await f.store.resolveTranslationMemoryConflict(scope,conflict.id,'local',{expectedRevision:conflict.revision});
  const state=await snapshot(f);assert.equal(state.units.length,0);assert.equal(state.tombstones.length,1);
  assert.equal((await f.store.getTranslationMemoryPending(scope))[0].deletions[0].baseRevision,2);
});

test('shared identity changes reconcile independently learned identities with one active row and recoverable history',async()=>{
  const f=fixture(),shared={...unit(),id:'original',revision:1};await bootstrap(f,[shared],1);
  await f.store.putTranslationMemoryUnits(scope,[{...unit('ทางเลือก {0}'),source:'Grant {0} damage'}],{origin:'learn'});
  await f.store.applyTranslationMemoryRemote(scope,{revision:2,units:[{...shared,source:'Grant {0} damage',target:'ส่วนกลาง {0}',revision:2}]});
  const state=await snapshot(f);assert.equal(state.units.length,1);assert.equal(state.units[0].id,shared.id);
  assert.equal(state.conflicts[0].local.target,'ทางเลือก {0}');
  assert.ok((await f.store.listTranslationMemoryHistory(scope,shared.id)).some(event=>event.before?.source===shared.source));
});

test('a competing correction to a locally moved source retains its edit and independently relearned target',async()=>{
  const f=fixture(),shared={...unit(),id:'original',revision:1};await bootstrap(f,[shared],1);const before=(await snapshot(f)).units[0];
  await f.store.putTranslationMemoryUnits(scope,[{...before,source:'Grant {0} damage'}],{origin:'edit',expectedUnits:{[before.id]:before}});
  await f.store.putTranslationMemoryUnits(scope,[unit('เรียนอีกครั้ง {0}')],{origin:'learn'});
  await f.store.applyTranslationMemoryRemote(scope,{revision:1,units:[shared]});
  assert.equal((await snapshot(f)).units.length,2,'An unchanged shared poll must retain a pending identity edit.');
  await f.store.applyTranslationMemoryRemote(scope,{revision:2,units:[{...shared,target:'ส่วนกลาง {0}',revision:2}]});
  const state=await snapshot(f);assert.equal(state.units.length,1);assert.equal(state.units[0].target,'ส่วนกลาง {0}');
  assert.equal(state.conflicts[0].local.source,'Grant {0} damage');
  assert.ok((await f.store.listTranslationMemoryHistory(scope,shared.id)).some(event=>event.before?.target==='เรียนอีกครั้ง {0}'));
  const conflict=state.conflicts[0];
  await f.store.resolveTranslationMemoryConflict(scope,shared.id,'local',{expectedRevision:conflict.revision,expectedConflict:conflict});
  const resolved=(await snapshot(f)).units[0];assert.equal(resolved.source,'Grant {0} damage');assert.equal(resolved.id,shared.id);
});

test('conflict choices reject a changed local correction even when the shared revision has not changed',async()=>{
  const f=fixture();await f.store.putTranslationMemoryUnits(scope,[unit()],{origin:'learn'});const local=(await snapshot(f)).units[0];
  await bootstrap(f,[{...local,target:'ส่วนกลาง {0}',revision:2}],3);const conflict=(await snapshot(f)).conflicts[0];
  await f.store.putTranslationMemoryUnits(scope,[unit('แก้ล่าสุด {0}')],{origin:'learn'});
  await assert.rejects(f.store.resolveTranslationMemoryConflict(scope,local.id,'local',{expectedRevision:2,expectedConflict:conflict}),/conflict changed/);
  assert.equal((await snapshot(f)).conflicts[0].local.target,'แก้ล่าสุด {0}');
  assert.ok((await f.store.listTranslationMemoryHistory(scope,local.id)).some(event=>event.before?.target===local.target&&event.after?.target==='แก้ล่าสุด {0}'));
});

test('a replayed upload rebases its own correction before a newer remote correction and preserves newer local typing',async()=>{
  const f=fixture();await bootstrap(f);await f.store.putTranslationMemoryUnits(scope,[unit()]);const wire=copy((await f.store.getTranslationMemoryPending(scope))[0]);
  await f.store.putTranslationMemoryUnits(scope,[unit('ยังใหม่กว่า {0}')]);
  const latest={...wire.upserts[0],target:'แก้โดยผู้อื่น {0}',revision:2};delete latest.baseRevision;
  await f.store.acknowledgeTranslationMemoryWrite(scope,wire.mutationId,{mutationId:wire.mutationId,appliedRevision:9,revision:12,replayed:true,accepted:[latest]});
  const state=await snapshot(f);assert.equal(state.units[0].revision,2);assert.equal(state.units[0].target,latest.target);
  assert.equal(state.conflicts[0].local.target,'ยังใหม่กว่า {0}');assert.equal(state.revision,0);
});

test('record-backed worker saves learn in the same transaction without aggregate workspace writes',async()=>{
  const f=fixture(),ws={accountId:'alice',game:'poe1',branchId:'default',sourceHash:'source'};
  const id=N.scopeKey(ws),baseId=N.baselineKey(ws),path='stats.txt',desc={filepath:path,stats:['damage'],variables:['#'],remarks:[''],
    translations:{English:['Gain {0} damage'],Thai:['เดิม {0}']}};
  f.tables.get('storage_migrations').set(id,{key:id,scope:id,value:{state:'ready'}});
  f.tables.get('translation_workspaces').set(id,{key:id,scope:id,value:{...ws,stagedVersion:1}});
  f.tables.get('baseline_files').set(JSON.stringify([baseId,path]),{key:JSON.stringify([baseId,path]),scope:baseId,value:desc});
  f.tables.get('workspace_files').set(JSON.stringify([id,path]),{key:JSON.stringify([id,path]),scope:id,pathKey:JSON.stringify([id,path]),
    value:{filepath:path,overrides:{},languages:['English','Thai']}});
  const batch={...ws,jobId:'normalized-save',language:'Thai',origin:'save',files:[{filepath:path,translations:['ใหม่ {0}'],trackedForExport:true}],
    descriptions:[desc],revisions:[{filepath:path,lang:'Thai',translations:['ใหม่ {0}']}],
    tmCapture:TM.unitsFromDescription(desc,['ใหม่ {0}'],'Thai',{game:'poe1',jobId:'normalized-save'})};
  f.fail('tm_outbox');await assert.rejects(f.store.saveTranslationBatch(batch),/Simulated tm_outbox/);
  assert.equal((await snapshot(f)).units.length,0);assert.equal(f.tables.get('save_receipts').size,0);assert.equal(f.tables.get('workspace_records').size,0);
  f.fail('');await f.store.saveTranslationBatch(batch);
  assert.equal((await snapshot(f)).units.length,1);assert.equal(f.tables.get('save_receipts').size,1);
  assert.equal(f.tables.get('kv').size,0,'Normalized saves must not write aggregate KV records.');
});

test('unchanged remote polling is silent and cheap state reads avoid unit snapshots',async()=>{
  const f=fixture();await bootstrap(f);const before=copy([...f.tables.get('tm_meta')]);let notifications=0;
  f.store.onTranslationMemoryChange(()=>notifications++);
  const result=await f.store.applyTranslationMemoryRemote(scope,{revision:0,units:[],tombstones:[]});
  assert.equal(result.changed,false);assert.equal(notifications,0);assert.deepEqual(copy([...f.tables.get('tm_meta')]),before);
  f.operations.length=0;const state=await f.store.getTranslationMemoryState(scope);
  assert.equal(state.bootstrapped,true);assert.ok(!f.operations.some(value=>value.name==='tm_units'));
});

test('page broadcasts propagate committed scope hints to other tabs once without leaking into unrelated scopes',async()=>{
  const channels=new Map();let messages=0;
  class BroadcastChannel {
    constructor(name) {this.name=name;const peers=channels.get(name)||[];peers.push(this);channels.set(name,peers);}
    postMessage(data) {messages++;for(const peer of channels.get(this.name)) if(peer!==this) queueMicrotask(()=>peer.onmessage?.({data:copy(data)}));}
  }
  const a=fixture({BroadcastChannel}),b=fixture({BroadcastChannel});let sameScope=0,unrelated=0;
  a.store.onTranslationMemoryChange(value=>{if(value.profile===scope.profile&&value.language===scope.language)sameScope++;});
  b.store.onTranslationMemoryChange(value=>{if(value.profile===scope.profile&&value.language===scope.language)sameScope++;else unrelated++;});
  await a.store.putTranslationMemoryUnits(scope,[unit()]);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sameScope,2);assert.equal(messages,1,'Receiving a scope hint must not broadcast it again.');assert.equal(unrelated,0);
  a.store.notifyTranslationMemoryChange({profile:'bob',language:'German'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sameScope,2);assert.equal(unrelated,1);assert.equal(messages,2);
  const worker=fixture({BroadcastChannel,worker:true});worker.store.notifyTranslationMemoryChange(scope);
  assert.equal(channels.get('sdeditor-tm-changes').length,2,'Workers must leave cross-tab publication to their acknowledged page.');
  assert.equal(messages,2);
  await a.store.putTranslationMemoryUnits(scope,[unit('เงียบ {0}',1)],{origin:'seed',notify:false});
  await a.store.applyTranslationMemoryRemote(scope,{revision:1,units:[],tombstones:[]},{notify:false});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(messages,2);assert.equal(sameScope,2);
  assert.equal((await snapshot(a)).units.length,2,'Batched notification suppression must still commit durable content.');
  a.store.notifyTranslationMemoryChange(scope);await new Promise(resolve=>setImmediate(resolve));assert.equal(messages,3);assert.equal(sameScope,4);
});

test('reviewed JSON tombstones preserve suppression and restore is selected per imported unit',async()=>{
  const f=fixture();await bootstrap(f);await f.store.putTranslationMemoryUnits(scope,[{...unit(),deleted:true}],{origin:'seed'});
  let state=await snapshot(f);assert.equal(state.units.length,0);assert.equal(state.tombstones.length,1);
  const outgoing=copy((await f.store.getTranslationMemoryPending(scope))[0]);
  assert.equal(outgoing.deletions[0].source,unit().source);assert.deepEqual(outgoing.deletions[0].context,unit().context);
  await accept(f,outgoing,1,1);const tombstone=(await snapshot(f)).tombstones[0];
  await f.store.putTranslationMemoryUnits(scope,[{...tombstone,target:'คืน {0}',deleted:false,restore:true}],{origin:'seed',expectedUnits:{[tombstone.id]:tombstone}});
  state=await snapshot(f);assert.equal(state.units.length,1);
  assert.equal((await f.store.getTranslationMemoryPending(scope))[0].upserts[0].restore,true);
});
