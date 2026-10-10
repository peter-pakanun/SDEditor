const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('../public/tmCloudSync.js');

const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const unit = (id, revision = 1, target = id) => ({ id, source: id, target, gameScope: 'poe1', context: {}, note: '', revision });
function fixture() {
  const context = { epoch: 1, profile: 'alice', token: 'fixture-token', language: 'Thai' };
  const calls = [], changes = [], issues = [], work = [], scheduled = [], resets = [], notifications = [], remote = new Map(), pending = [];
  let bootstrapped = false, revision = 0, localVersion = 0, fullReads = 0, stateReads = 0;
  const cloud = {
    state: { profiles: { alice: { settings: { lang: 'Thai' } } } },
    context: () => copy(context), hints: () => ({ tmRevision: revision }),
    permissionsCurrent: ctx => ctx.epoch === context.epoch && ctx.profile === context.profile && ctx.token === context.token && ctx.language === context.language,
    schedule: delay => scheduled.push(delay),
    async updateShared(fn) { fn(this.state, this.state.profiles[context.profile]); },
    async request(path, options) { calls.push({ path, options }); return response(path, options); },
  };
  let response = async path => path.includes('/changes?') ? { revision, changes: [], nextAfter: revision, hasMore: false }
    : { revision, units: [], tombstones: [], nextCursor: null };
  const store = {
    async getTranslationMemory() { fullReads++; return { revision, bootstrapped, localVersion, units: [...remote.values()], conflicts: this.conflicts || [] }; },
    async getTranslationMemoryState() { stateReads++; return { revision, bootstrapped, localVersion, pending: pending.length, conflicts: (this.conflicts || []).length }; },
    async applyTranslationMemoryRemote(scope, payload, options) {
      if (!options.guard()) throw Object.assign(new Error('stale'), { stale: true });
      for (const row of payload.units || []) remote.set(row.id, copy(row));
      for (const row of payload.tombstones || []) remote.delete(row.id);
      if ((payload.units || []).length || (payload.tombstones || []).length || options.complete && !bootstrapped) localVersion++;
      revision = payload.revision;
      if (options.complete) bootstrapped = true;
      changes.push({ scope, payload, options });
    },
    async getTranslationMemoryPending() { return copy(pending); },
    async acknowledgeTranslationMemoryWrite(scope, id, value, options) {
      if (!options.guard()) throw Object.assign(new Error('stale'), { stale: true });
      assert.equal(options.notify, false, 'the coordinator publishes the completed run once');
      assert.equal(id, value.mutationId); pending.shift();
      for (const row of value.accepted || []) remote.set(row.id, copy(row));
      localVersion++;
    },
    async rejectTranslationMemoryWrite(scope, id, conflicts, options) {
      if (!options.guard()) throw Object.assign(new Error('stale'), { stale: true });
      assert.equal(options.notify, false, 'conflict publication is batched with the completed run');
      pending.shift(); this.conflicts = conflicts;
      localVersion++;
    },
    async adoptTranslationMemoryProfile() { this.adopted = true; },
    async resetTranslationMemoryBootstrap(scope, options) {
      if (!options.guard()) throw Object.assign(new Error('stale'), { stale: true });
      assert.equal(options.notify, false, 'cursor reset must not publish a partial bootstrap');
      resets.push(copy(scope)); bootstrapped = false; revision = 0; localVersion++;
    },
    notifyTranslationMemoryChange(scope) { notifications.push(copy(scope)); },
  };
  const client = new Client({ cloud, store, onChange: (scope, state) => changes.push({ notification: true, scope, state }),
    onIssue: issue => issues.push(issue), onWork: item => work.push(item) });
  return { client, cloud, store, context, calls, changes, issues, work, scheduled, resets, notifications, remote, pending,
    setResponse(fn) { response = fn; }, setBootstrapped(value, cursor = 0) { bootstrapped = value; revision = cursor; },
    reads() { return { fullReads, stateReads }; } };
}

test('bootstrap anchors its first page and catches deltas using the bounded API cursor', async () => {
  const f = fixture();
  f.setResponse(async path => {
    const url = new URL(path, 'http://fixture');
    if (path.includes('/changes?')) {
      assert.ok(Number(url.searchParams.get('limit')) <= 100, 'the API limits change-event pages to100');
      assert.equal(url.searchParams.get('after'), '1');
      return { revision: 3, changes: [{ revision: 2, units: [unit('a', 2, 'updated')], tombstones: [] },
        { revision: 3, units: [], tombstones: [{ ...unit('b'), deleted: true }] }], nextAfter: 3, hasMore: false };
    }
    if (url.searchParams.has('cursor')) return { revision: 3, units: [unit('b')], tombstones: [], nextCursor: null };
    return { revision: 1, units: [unit('a')], tombstones: [], nextCursor: 'a' };
  });
  await f.client.sync(f.cloud.context(), {});
  assert.equal(f.remote.get('a').target, 'updated'); assert.equal(f.remote.has('b'), false);
  assert.equal((await f.store.getTranslationMemory()).bootstrapped, true);
  assert.equal((await f.store.getTranslationMemory()).revision, 3);
  assert.ok(f.changes.filter(change => change.payload).every(change => change.options.notify === false));
  assert.deepEqual(f.notifications, [{ profile: 'alice', language: 'Thai' }]);
  assert.deepEqual(f.issues, ['']);
});

test('TM uploads retain durable mutation IDs and exact returned per-unit revisions', async () => {
  const f = fixture(); f.setBootstrapped(true, 5);
  f.pending.push({ mutationId: 'stable-id', upserts: [{ ...unit('new', 0), baseRevision: 0 }], deletions: [] });
  f.setResponse(async (path, options) => {
    assert.equal(options.method, 'PATCH'); assert.equal(options.body.mutationId, 'stable-id');
    return { mutationId: 'stable-id', revision: 6, appliedRevision: 6, accepted: [unit('new', 1)] };
  });
  await f.client.sync(f.cloud.context(), { tmRevision: 5 });
  assert.equal(f.pending.length, 0); assert.equal(f.remote.get('new').revision, 1);
  assert.equal(f.notifications.length, 1);
  assert.deepEqual(f.work.map(item => item.active), [true, false]);
});

test('multiple bootstrap pages and upload acknowledgements publish one settled snapshot and notification', async () => {
  const f = fixture();
  for (const id of ['local-a', 'local-b']) f.pending.push({ mutationId: 'write-' + id,
    upserts: [{ ...unit(id, 0), baseRevision: 0 }], deletions: [] });
  let acknowledgements = 0;
  f.setResponse(async (path, options) => {
    assert.equal(f.notifications.length, 0, 'intermediate pages and accepted uploads must stay silent');
    assert.equal(f.changes.filter(change => change.notification).length, 0);
    if (options.method === 'PATCH') {
      acknowledgements++;
      return { mutationId: options.body.mutationId, revision: 2 + acknowledgements, appliedRevision: 2 + acknowledgements,
        accepted: options.body.upserts.map(row => unit(row.id, 1)) };
    }
    if (path.includes('/changes?')) return { revision: 2, changes: [], nextAfter: 2, hasMore: false };
    const last = new URL(path, 'http://fixture').searchParams.has('cursor');
    return { revision: 2, units: [unit(last ? 'shared-b' : 'shared-a')], tombstones: [], nextCursor: last ? null : 'shared-a' };
  });
  await f.client.sync(f.cloud.context(), {});
  assert.equal(acknowledgements, 2); assert.equal(f.pending.length, 0);
  const snapshots = f.changes.filter(change => change.notification);
  assert.equal(snapshots.length, 1); assert.equal(snapshots[0].state.units.length, 4);
  assert.equal(f.notifications.length, 1); assert.equal(f.reads().fullReads, 1);
  assert.ok(f.changes.filter(change => change.payload).every(change => change.options.notify === false));
});

test('failed partial bootstrap retains staging without publishing or rereading the active corpus', async () => {
  const f = fixture();
  f.setResponse(async path => {
    if (new URL(path, 'http://fixture').searchParams.has('cursor')) throw Object.assign(new Error('snapshot unavailable'), { status: 503 });
    return { revision: 1, units: [unit('staged')], tombstones: [], nextCursor: 'staged' };
  });
  await f.client.sync(f.cloud.context(), {});
  assert.equal((await f.store.getTranslationMemoryState()).bootstrapped, false);
  assert.equal(f.reads().fullReads, 0);
  assert.equal(f.notifications.length, 0);
  assert.equal(f.changes.filter(change => change.notification).length, 0);
  assert.match(f.issues.at(-1), /snapshot unavailable/);
  assert.deepEqual(f.scheduled, [2000]);
});

test('failure after an accepted upload publishes that durable state once and keeps the next mutation pending', async () => {
  const f = fixture(); f.setBootstrapped(true, 0);
  for (const id of ['accepted', 'retry-later']) f.pending.push({ mutationId: 'write-' + id,
    upserts: [{ ...unit(id, 0), baseRevision: 0 }], deletions: [] });
  f.setResponse(async (path, options) => {
    assert.equal(f.notifications.length, 0);
    if (options.body.mutationId === 'write-retry-later') throw Object.assign(new Error('second upload unavailable'), { status: 503 });
    return { mutationId: options.body.mutationId, revision: 1, appliedRevision: 1, accepted: [unit('accepted', 1)] };
  });
  await f.client.sync(f.cloud.context(), { tmRevision: 0 });
  const snapshots = f.changes.filter(change => change.notification);
  assert.equal(snapshots.length, 1); assert.equal(snapshots[0].state.units[0].revision, 1);
  assert.equal(snapshots[0].state.units[0].id, 'accepted'); assert.equal(f.notifications.length, 1);
  assert.equal(f.pending.length, 1); assert.equal(f.pending[0].mutationId, 'write-retry-later');
  assert.match(f.issues.at(-1), /second upload unavailable/); assert.deepEqual(f.scheduled, [2000]);
  assert.equal(f.work.at(-1).active, false);
});

test('per-unit CAS conflicts go to durable resolution without dropping pending work silently', async () => {
  const f = fixture(); f.setBootstrapped(true, 1);
  f.pending.push({ mutationId: 'conflicting', upserts: [{ ...unit('a'), baseRevision: 1 }], deletions: [] });
  f.setResponse(async () => { throw Object.assign(new Error('changed'), { status: 409, details: { conflicts: [{ id: 'a', current: unit('a', 2) }] } }); });
  await f.client.sync(f.cloud.context(), { tmRevision: 1 });
  assert.equal(f.store.conflicts[0].current.revision, 2); assert.equal(f.pending.length, 0);
  assert.match(f.issues.at(-1), /conflict/);
  assert.deepEqual(f.work.map(item => item.active), [true, false]);
});

test('a delayed response never applies into another account or selected language', async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  f.setResponse(async () => { entered.resolve(); await gate.promise; return { revision: 1, units: [unit('old')], tombstones: [], nextCursor: null }; });
  const operation = f.client.sync(); await entered.promise;
  f.context.epoch++; f.context.language = 'German'; f.cloud.state.profiles.alice.settings.lang = 'German';
  gate.resolve(); await operation;
  assert.equal(f.remote.size, 0); assert.equal(f.changes.length, 0); assert.equal(f.issues.length, 0);
});

test('a translator selected outside the assigned shared language sends no TM requests', async () => {
  const f = fixture(); f.cloud.state.profiles.alice.settings.lang = 'German';
  await f.client.sync(); assert.equal(f.calls.length, 0);
});

test('API failures remain actionable through retry and automatic retry uses backoff', async () => {
  const f = fixture(); f.setBootstrapped(true, 0);
  f.setResponse(async () => { throw Object.assign(new Error('API not available'), { status: 404 }); });
  await f.client.sync(f.cloud.context(), {});
  assert.match(f.issues.at(-1), /updated API/); assert.deepEqual(f.scheduled, [2000]);
  const gate = deferred(); f.setResponse(async () => { await gate.promise; return { revision: 0, changes: [], nextAfter: 0, hasMore: false }; });
  const retry = f.client.sync(f.cloud.context(), {});
  assert.match(f.issues.at(-1), /updated API/); gate.resolve(); await retry;
  assert.equal(f.issues.at(-1), '');
});

test('invalid nonadvancing delta cursors stop safely and concurrent sync calls reuse one run', async () => {
  const f = fixture(); f.setBootstrapped(true, 2);
  const gate = deferred(); f.setResponse(async () => { await gate.promise; return { revision: 3, changes: [], nextAfter: 2, hasMore: true }; });
  const first = f.client.sync(f.cloud.context(), {}), second = f.client.sync(f.cloud.context(), {});
  gate.resolve(); await Promise.all([first, second]);
  assert.equal(f.calls.length, 1); assert.match(f.issues.at(-1), /Invalid TM change cursor/);
  assert.equal(f.changes.length, 0);
});

test('unchanged background polls read metadata and preserve the accepted snapshot', async () => {
  const f = fixture(); f.setBootstrapped(true, 4);
  await f.client.sync(f.cloud.context(), { tmRevision: 4 });
  const initial = f.reads(), notifications = f.changes.filter(change => change.notification).length;
  await f.client.sync(f.cloud.context(), { tmRevision: 4 });
  await f.client.sync(f.cloud.context(), { tmRevision: 4 });
  assert.equal(f.reads().fullReads, initial.fullReads, 'unchanged polling must not materialize every memory');
  assert.ok(f.reads().stateReads > initial.stateReads);
  assert.equal(f.changes.filter(change => change.notification).length, notifications);
  assert.equal(f.calls.length, 0);
  assert.equal(f.notifications.length, 0);
});

test('another tab can advance the IndexedDB cursor before this run and still publish its unseen snapshot', async () => {
  const f = fixture(); f.setBootstrapped(true, 4);
  await f.client.sync(f.cloud.context(), { tmRevision: 4 });
  const before = f.changes.filter(change => change.notification).length;
  await f.store.applyTranslationMemoryRemote({ profile: 'alice', language: 'Thai' },
    { revision: 5, units: [unit('peer-correction', 2, 'Shared through another local tab')], tombstones: [] }, { guard: () => true });
  await f.client.sync(f.cloud.context(), { tmRevision: 5 });
  const notifications = f.changes.filter(change => change.notification);
  assert.equal(notifications.length, before + 1);
  assert.equal(notifications.at(-1).state.units.find(unit => unit.id === 'peer-correction').target, 'Shared through another local tab');
  assert.equal(f.calls.length, 0);
  const reads = f.reads(); await f.client.sync(f.cloud.context(), { tmRevision: 5 });
  assert.equal(f.reads().fullReads, reads.fullReads);
});

test('a server rollback reboots its snapshot once while retaining durable local work', async () => {
  const f = fixture(); f.setBootstrapped(true, 9);
  f.remote.set('private-local', unit('private-local', 0, 'Thai local correction'));
  f.pending.push({ mutationId: 'durable-local', upserts: [{ ...unit('private-local', 0, 'Thai local correction'), baseRevision: 0 }], deletions: [] });
  f.setResponse(async (path, options) => {
    const url = new URL(path, 'http://fixture');
    if (options.method === 'PATCH') return { mutationId: options.body.mutationId, appliedRevision: 3, revision: 3,
      accepted: [unit('private-local', 1, 'Thai local correction')] };
    if (path.includes('/changes?')) {
      if (url.searchParams.get('after') === '9') throw Object.assign(new Error('restored earlier backup'), { status: 409, code: 'TM_REVISION_INVALID' });
      assert.equal(url.searchParams.get('after'), '2');
      return { revision: 2, changes: [], nextAfter: 2, hasMore: false };
    }
    assert.equal(f.pending[0].mutationId, 'durable-local', 'cursor reset must preserve durable local authoring');
    assert.equal(f.remote.get('private-local').target, 'Thai local correction');
    return { revision: 2, units: [unit('restored-shared', 1, 'Earlier shared translation')], tombstones: [], nextCursor: null };
  });
  await f.client.sync(f.cloud.context(), {});
  assert.deepEqual(f.resets, [{ profile: 'alice', language: 'Thai' }]);
  assert.equal(f.remote.get('private-local').target, 'Thai local correction'); assert.equal(f.remote.get('private-local').revision, 1);
  assert.equal(f.remote.get('restored-shared').target, 'Earlier shared translation');
  assert.equal(f.pending.length, 0); assert.equal((await f.store.getTranslationMemoryState()).bootstrapped, true);
  assert.deepEqual(f.issues, ['']);
});

test('repeated rollback errors stop after one guarded reset and preserve local pending work', async () => {
  const f = fixture(); f.setBootstrapped(true, 9);
  f.pending.push({ mutationId: 'keep-local', upserts: [{ ...unit('local', 0), baseRevision: 0 }], deletions: [] });
  f.setResponse(async path => {
    if (path.includes('/changes?')) throw Object.assign(new Error('revision still invalid'), { status: 409, code: 'TM_REVISION_INVALID' });
    return { revision: 2, units: [], tombstones: [], nextCursor: null };
  });
  await f.client.sync(f.cloud.context(), {});
  assert.equal(f.resets.length, 1); assert.equal(f.calls.length, 3);
  assert.equal(f.pending[0].mutationId, 'keep-local');
  assert.match(f.issues.at(-1), /revision still invalid/); assert.deepEqual(f.scheduled, [2000]);
});

test('a rollback response from a stale account never resets or publishes its local store', async () => {
  const f = fixture(), entered = deferred(), gate = deferred(); f.setBootstrapped(true, 9);
  f.setResponse(async () => { entered.resolve(); await gate.promise;
    throw Object.assign(new Error('old account cursor'), { status: 409, code: 'TM_REVISION_INVALID' }); });
  const running = f.client.sync(f.cloud.context(), {}); await entered.promise;
  f.context.epoch++; f.context.profile = 'bob'; f.cloud.state.profiles.bob = { settings: { lang: 'Thai' } };
  gate.resolve(); await running;
  assert.equal(f.resets.length, 0); assert.equal(f.changes.length, 0); assert.equal(f.issues.length, 0);
});

test('an account switch during cursor reset cannot start bootstrap in the new profile', async () => {
  const f = fixture(), entered = deferred(), gate = deferred(); f.setBootstrapped(true, 9);
  f.setResponse(async () => { throw Object.assign(new Error('rollback'), { status: 409, code: 'TM_REVISION_INVALID' }); });
  const reset = f.store.resetTranslationMemoryBootstrap.bind(f.store);
  f.store.resetTranslationMemoryBootstrap = async (...args) => { entered.resolve(); await gate.promise; return reset(...args); };
  const running = f.client.sync(f.cloud.context(), {}); await entered.promise;
  f.context.epoch++; f.context.language = 'German'; f.cloud.state.profiles.alice.settings.lang = 'German';
  gate.resolve(); await running;
  assert.equal(f.resets.length, 0); assert.equal(f.calls.length, 1); assert.equal(f.issues.length, 0);
});
