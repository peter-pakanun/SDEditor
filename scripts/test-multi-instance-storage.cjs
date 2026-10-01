// Direct storage checks: no browser, build step, or test dependency required.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'offlineStore.js'), 'utf8');

// Serialize transactions, as IndexedDB does for intersecting readwrite scopes.
// Each transaction sees committed data plus its own writes; abort discards all.
function database(initial = {}) {
  const stores = new Map(['kv', 'revisions', 'revisions_poe1', 'revisions_poe2'].map(name => [name, new Map()]));
  for (const [key, value] of Object.entries(initial)) stores.get('kv').set(key, { key, value: structuredClone(value) });
  const queued = [];
  let failHistory = false;
  const db = {
    close() {},
    transaction(names) {
      const actions = [];
      let active = false;
      let finished = false;
      let pending = 0;
      let completion;
      let local;
      const release = () => { queued.shift(); queued[0]?.(); };
      const maybeComplete = () => {
        clearImmediate(completion);
        if (!active || finished || pending) return;
        completion = setImmediate(() => {
          if (finished || pending) return;
          finished = true;
          for (const name of names) stores.set(name, local.get(name));
          tx.oncomplete?.(); release();
        });
      };
      const enqueue = action => {
        const req = {};
        pending++;
        const run = () => {
          if (finished) return;
          try { req.result = action(); req.onsuccess?.(); }
          catch (error) { req.error = error; req.onerror?.(); tx.abort(error); }
          pending--; maybeComplete();
        };
        if (active) queueMicrotask(run); else actions.push(run);
        return req;
      };
      const tx = {
        objectStore(name) {
          assert.ok(names.includes(name));
          return {
            get(key) { return enqueue(() => structuredClone(local.get(name).get(key))); },
            put(row) { return enqueue(() => { const value = structuredClone(row); local.get(name).set(value.key ?? value.id, value); }); },
            delete(key) { return enqueue(() => local.get(name).delete(key)); },
            clear() { return enqueue(() => local.get(name).clear()); },
            count() { return enqueue(() => local.get(name).size); },
            add(row) {
              if (failHistory) throw new Error('History quota exceeded');
              return enqueue(() => {
                const records = local.get(name); const value = structuredClone(row);
                value.id ??= Math.max(0, ...records.keys()) + 1;
                records.set(value.id, value); return value.id;
              });
            },
            openCursor() {
              const req = {}; let entries; let index = 0;
              const next = () => enqueue(() => {
                entries ||= [...local.get(name).values()];
                req.result = index < entries.length ? { value: structuredClone(entries[index++]), continue: next } : null;
                req.onsuccess?.();
              });
              next(); return req;
            },
          };
        },
        abort(error) {
          if (finished) return;
          finished = true; clearImmediate(completion); this.error = error;
          queueMicrotask(() => { this.onabort?.(); release(); });
        },
      };
      queued.push(() => {
        active = true;
        local = new Map(names.map(name => [name, new Map([...stores.get(name)].map(([key, value]) => [key, structuredClone(value)]))]));
        for (const action of actions) queueMicrotask(action);
        maybeComplete();
      });
      if (queued.length === 1) queueMicrotask(queued[0]);
      return tx;
    },
  };
  const indexedDB = { open(_name, version) { assert.equal(version, 3); const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req; } };
  return {
    db, indexedDB,
    get: key => structuredClone(stores.get('kv').get(key)?.value),
    put: (key, value) => stores.get('kv').set(key, { key, value: structuredClone(value) }),
    history: (game = 'poe1') => [...stores.get('revisions_' + game).values()],
    failHistory: () => { failHistory = true; },
  };
}

function client(db, now = () => Date.now()) {
  class Clock extends Date { static now() { return now(); } }
  const context = vm.createContext({ indexedDB: db.indexedDB, Date: Clock, console });
  vm.runInContext(source, context);
  return context.OfflineStore;
}
const seed = () => ({ workspace_poe1: { descs: [{ filepath: 'one', text: 'first' }, { filepath: 'two', text: 'second' }], keep: true }, source_poe1: ['source'] });

test('worker global export and explicit game snapshot preserve version-2 data', async () => {
  const db = database(seed()); const store = client(db);
  const current = await store.getWorkspaceSnapshot('poe1');
  assert.equal(current.generation, 0); assert.equal(current.revision, 0);
  assert.equal(current.workspace.keep, true); assert.deepEqual(current.source, ['source']);
  assert.equal((await store.getWorkspaceSnapshot('poe2')).workspace, undefined);
});

test('one atomic ownership lease wins simultaneous acquisition and every writer is fenced', async () => {
  let now = 1000; const db = database(seed()); const first = client(db, () => now); const second = client(db, () => now);
  const [a, b] = await Promise.all([first.acquireOwnership('worker', now), second.acquireOwnership('fallback', now)]);
  assert.equal(a.ownerId, 'worker'); assert.equal(b, null); first.configureOwnership(a);
  now = a.expiresAt;
  const takeover = await second.acquireOwnership('fallback', now); second.configureOwnership(takeover);
  assert.equal(takeover.generation, a.generation + 1);
  const writers = [
    () => first.setSettings({ stale: true }),
    () => first.setWorkspace({}, 'poe1'),
    () => first.setSource([], 'poe1'),
    () => first.clearWorkspace('poe1'),
    () => first.clearSource('poe1'),
    () => first.addRevision({}, 'poe1'),
    () => first.clearRevisions('poe1'),
    () => first.saveWorkspaceWithRevisions({}, [{}], 'poe1'),
    () => first.saveSourceWorkspaceWithRevisions([], {}, [{}], 'poe1'),
    () => first.updateHybridState(() => ({})),
    () => first.updateCollaborationState(() => ({})),
    () => first.replaceWorkspace({ game: 'poe1', workspace: {}, source: [] }),
    () => first.migrateFromLocalStorageIfNeeded({ settings: {} }),
    () => first.copyLegacyToVersion('poe2'),
  ];
  for (const write of writers) await assert.rejects(write(), error => error.code === 'OWNERSHIP_LOST');
  await second.setSettings({ good: true }); assert.deepEqual(db.get('settings'), { good: true });
  assert.equal(db.history().length, 0); assert.equal(db.get('workspace_poe1').keep, true);
});

test('lease renewal extends ownership and release retains monotonic fencing', async () => {
  let now = 1000; const db = database(); const store = client(db, () => now);
  const lease = await store.acquireOwnership('worker', now); store.configureOwnership(lease);
  now += 5000; const renewed = await store.renewOwnership(undefined, now);
  assert.equal(renewed.expiresAt, now + 30000); assert.equal(renewed.generation, lease.generation);
  assert.equal(await store.releaseOwnership(), true);
  await assert.rejects(store.setSettings({}), error => error.code === 'OWNERSHIP_LOST');
  const next = await store.acquireOwnership('worker', now); assert.equal(next.generation, lease.generation + 1);
  assert.equal(await store.releaseOwnership(lease), false);
  now = next.expiresAt;
  await assert.rejects(store.renewOwnership(next, now), error => error.code === 'OWNERSHIP_LOST');
});

test('a delayed renewal checks time after acquiring the transaction lock', async () => {
  let now = 1000; const db = database(); const store = client(db, () => now);
  const lease = await store.acquireOwnership('worker'); store.configureOwnership(lease);
  const renewal = store.renewOwnership();
  now = lease.expiresAt;
  await assert.rejects(renewal, error => error.code === 'OWNERSHIP_LOST');
  assert.equal(db.get('coordinator_owner_v1').expiresAt, lease.expiresAt);
});

test('parallel translation patches read latest workspace and preserve independent edits', async () => {
  const db = database(seed()); const a = client(db); const b = client(db);
  const patch = (store, filepath, text, id) => store.updateCollaborationState((state, snapshot) => {
    assert.equal(snapshot.generation, 0); return { ...state, last: id };
  }, { version: 'poe1', generation: 0, requestId: id, returnSnapshot: true, revisions: [{ filepath, text }],
    projectWorkspace: workspace => ({ ...workspace, descs: workspace.descs.map(file => file.filepath === filepath ? { ...file, text } : file) }),
  });
  const results = await Promise.all([patch(a, 'one', 'A', 'a'), patch(b, 'two', 'B', 'b')]);
  assert.deepEqual(db.get('workspace_poe1').descs.map(file => file.text), ['A', 'B']);
  assert.equal(results[1].revision, 2); assert.equal(db.history().length, 2);
});

test('lost acknowledgement retry does not duplicate history and returns authoritative current state', async () => {
  const db = database(seed()); const store = client(db);
  const save = (id, text) => store.updateCollaborationState(state => ({ ...state, text }), {
    version: 'poe1', requestId: id, returnSnapshot: true, revisions: [{ text }],
    projectWorkspace: workspace => ({ ...workspace, text }),
  });
  await save('first', 'A'); await save('second', 'B'); const replay = await save('first', 'C');
  assert.equal(replay.duplicate, true); assert.equal(replay.workspace.text, 'B'); assert.equal(replay.state.text, 'B');
  assert.equal(replay.revision, 2); assert.equal(db.history().length, 2);
});

test('queue-only changes and unchanged projections do not invalidate source import revision', async () => {
  const db = database(seed()); const store = client(db);
  const queued = await store.updateCollaborationState(() => ({ outbox: ['pending'] }), { version: 'poe1', returnSnapshot: true });
  assert.equal(queued.revision, 0);
  const unchanged = await store.updateCollaborationState(() => ({ outbox: [] }), { version: 'poe1', returnSnapshot: true,
    projectWorkspace: workspace => ({ keep: workspace.keep, descs: workspace.descs.map(desc => ({ text: desc.text, filepath: desc.filepath })) }),
  });
  assert.equal(unchanged.revision, 0);
  const imported = await store.replaceWorkspace({ game: 'poe1', source: ['next'], workspace: {}, generation: 0, revision: 0 });
  assert.equal(imported.revision, 1);
});

test('source replacement CAS fences stale import and preserves queued recovery', async () => {
  const db = database({ ...seed(), collaboration_v1: { rooms: {
    old: { identity: { game: 'poe1' }, local: { one: { text: 'draft' } }, outbox: [{ id: 'pending' }], conflicts: [{ id: 'conflict' }] },
    other: { identity: { game: 'poe2' }, outbox: [{ id: 'keep' }] },
  } } });
  const store = client(db);
  await store.setWorkspace({ changed: true }, 'poe1');
  await assert.rejects(store.replaceWorkspace({ game: 'poe1', generation: 0, revision: 0, workspace: {}, source: [] }), error => error.code === 'WORKSPACE_REVISION_CHANGED');
  const replaced = await store.replaceWorkspace({ game: 'poe1', generation: 0, revision: 1, requestId: 'import', workspace: { next: true }, source: ['next'], revisions: [{ before: true }] });
  assert.equal(replaced.generation, 1); assert.equal(replaced.revision, 2);
  await assert.rejects(store.updateCollaborationState(() => { throw new Error('Callback should not run'); }, { version: 'poe1', generation: 0 }), error => error.code === 'SOURCE_GENERATION_CHANGED');
  const rooms = db.get('collaboration_v1').rooms;
  assert.equal(rooms.old.recoveryOnly, true); assert.deepEqual(rooms.old.outbox, []);
  assert.equal(rooms.old.recovery[0].outbox[0].id, 'pending'); assert.equal(rooms.old.recovery[0].conflicts[0].id, 'conflict');
  assert.equal(rooms.other.outbox[0].id, 'keep');
  const replay = await store.replaceWorkspace({ game: 'poe1', generation: 0, revision: 1, requestId: 'import', workspace: {}, source: [] });
  assert.equal(replay.duplicate, true); assert.equal(replay.generation, 1); assert.equal(db.history().length, 1);
});

test('source replacement quota failure rolls back generation, workspace and queue', async () => {
  const db = database(seed()); const store = client(db); db.failHistory();
  await assert.rejects(store.replaceWorkspace({ game: 'poe1', generation: 0, source: [], workspace: {}, revisions: [{}] }), /History quota/);
  assert.equal((await store.getWorkspaceSnapshot('poe1')).generation, 0);
  assert.equal(db.get('workspace_poe1').keep, true);
});

test('source replacement fences account changes queued before its transaction', async () => {
  const original = { activeProfile: 'translator-a', auth: { token: 'token-a', user: { language: 'Thai', assignmentVersion: 1 } } };
  const expectedAuth = { profile: 'translator-a', token: 'token-a', language: 'Thai', assignmentVersion: 1 };
  for (const change of [
    state => ({ ...state, activeProfile: 'translator-b' }),
    state => ({ ...state, auth: { ...state.auth, user: { language: 'German', assignmentVersion: 2 } } }),
    state => ({ ...state, auth: { ...state.auth, user: { language: 'Thai', assignmentVersion: 2 } } }),
    state => ({ ...state, auth: { ...state.auth, token: 'replacement-token' } }),
    state => ({ ...state, auth: { ...state.auth, token: null } }),
  ]) {
    const db = database({ ...seed(), hybrid_v1: original }); const store = client(db);
    const changed = store.updateHybridState(change);
    const replacement = store.replaceWorkspace({ game: 'poe1', generation: 0, revision: 0, expectedAuth,
      source: ['replacement'], workspace: { replacement: true }, revisions: [{ replacement: true }], requestId: 'queued-import' });
    await assert.rejects(replacement, error => error.code === 'CONTEXT_CHANGED' && error.stale === true);
    await changed;
    const snapshot = await store.getWorkspaceSnapshot('poe1');
    assert.equal(snapshot.generation, 0); assert.equal(snapshot.revision, 0); assert.equal(snapshot.workspace.keep, true);
    assert.deepEqual(snapshot.source, ['source']); assert.equal(db.history().length, 0);
    assert.equal(db.get('workspace_receipt_poe1_queued-import'), undefined);
  }
});

test('matching source replacement auth fence commits without exposing credentials', async () => {
  const db = database({ ...seed(), hybrid_v1: { activeProfile: 'translator-a', auth: { token: 'private-token', user: { language: 'Thai', assignmentVersion: 1 } } } });
  const store = client(db);
  const result = await store.replaceWorkspace({ game: 'poe1', generation: 0, revision: 0,
    expectedAuth: { profile: 'translator-a', token: 'private-token', language: 'Thai', assignmentVersion: 1 },
    source: ['new source'], workspace: { saved: true }, requestId: 'guarded-import' });
  assert.equal(result.generation, 1); assert.equal(result.workspace.saved, true);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
  assert.equal(JSON.stringify(db.get('workspace_receipt_poe1_guarded-import')).includes('private-token'), false);
});

test('reset isolates games and atomically clears selected history while advancing source generation', async () => {
  const db = database({ ...seed(), workspace_poe2: { keep: 'poe2' } }); const store = client(db);
  await store.addRevision({ recover: 'draft' }, 'poe1');
  await store.addRevision({ keep: 'poe2' }, 'poe2');
  const reset = await store.replaceWorkspace({ game: 'poe1', generation: 0, requestId: 'reset', reset: true });
  assert.equal(reset.generation, 1); assert.equal(reset.workspace, undefined); assert.equal(reset.source, undefined);
  assert.equal(db.get('workspace_poe2').keep, 'poe2'); assert.equal(db.history().length, 0);
  assert.equal(db.history('poe2').length, 1);
});

test('unconfigured raw storage cannot bypass an existing coordinator lease', async () => {
  const db = database(); const worker = client(db); const rawTab = client(db);
  const lease = await worker.acquireOwnership('worker'); worker.configureOwnership(lease);
  await assert.rejects(rawTab.setSettings({ bypass: true }), error => error.code === 'OWNERSHIP_REQUIRED');
  await worker.releaseOwnership();
  await assert.rejects(rawTab.setWorkspace({}, 'poe1'), error => error.code === 'OWNERSHIP_REQUIRED');
});

test('legacy migration is atomic, idempotent, and does not overwrite current data', async () => {
  const db = database({ settings: { current: true } }); const first = client(db); const second = client(db);
  await Promise.all([
    first.migrateFromLocalStorageIfNeeded({ settings: { old: true }, workspace: { first: true } }),
    second.migrateFromLocalStorageIfNeeded({ settings: { stale: true }, workspace: { second: true } }),
  ]);
  assert.deepEqual(db.get('settings'), { current: true }); assert.deepEqual(db.get('workspace'), { first: true });
  const copied = await first.copyLegacyToVersion('poe1'); assert.equal(copied.workspace.first, true);
  await first.setWorkspace({ authored: true }, 'poe1');
  const again = await second.copyLegacyToVersion('poe1'); assert.equal(again.workspace.authored, true);
});

test('hybrid receipts prevent repeated settings operation after a lost reply', async () => {
  const db = database(); const store = client(db);
  await store.updateHybridState(() => ({ count: 1 }), { requestId: 'settings-save' });
  const result = await store.updateHybridState(() => { throw new Error('Should not repeat'); }, { requestId: 'settings-save' });
  assert.equal(result.count, 1);
});

test('blocked database upgrades explain old tabs and version changes close the connection', async () => {
  const notices = []; let request; let closed = 0;
  const db = { close() { closed++; } };
  const store = client({ indexedDB: { open() { request = {}; return request; } } });
  store.setStorageStatusHandler(status => notices.push(status));
  const blocked = store.open(); request.onblocked();
  await assert.rejects(blocked, error => error.code === 'DB_UPGRADE_BLOCKED');
  request.result = db; request.onsuccess(); assert.equal(closed, 1);
  const connected = store.open(); request.result = db; request.onsuccess(); await connected;
  db.onversionchange(); assert.equal(closed, 2);
  assert.deepEqual(notices.map(item => item.code), ['DB_UPGRADE_BLOCKED', 'DB_VERSION_CHANGED']);
});
