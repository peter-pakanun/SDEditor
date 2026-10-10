const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const copy = value => structuredClone(value);
const queued = () => new Promise(resolve => setImmediate(resolve));
const source = [{ filepath: 'a.txt', filename: 'a.txt', filedir: '', name: '', stats: ['stat'],
  variables: ['#'], remarks: [''], translations: { English: ['Source'], Thai: ['ZIP translation'] } }];
const workspace = { sourceHash: 'current', descs: [{ ...copy(source[0]), hasChanges: true,
  translations: { English: ['Source'], Thai: ['Local translation'] } }], status: { 'a.txt': { needsReview: false, lastEditedAt: 1 } } };

// Controlled IndexedDB lifecycle fixture. Real engine behavior is checked in
// the browser separately; this verifies requested versions and app callbacks.
function versionedStorage(version = 4) {
  const tables = new Map([
    ['kv', new Map([
      ['settings', { key: 'settings', value: { lang: 'Thai', dictionary: [{ find: 'one', replace: 'หนึ่ง' }] } }],
      ['source_poe1', { key: 'source_poe1', value: copy(source) }],
      ['workspace_poe1', { key: 'workspace_poe1', value: copy(workspace) }],
      ['hybrid_v1', { key: 'hybrid_v1', value: { dictionaries: { Thai: ['thai'], German: ['german'] }, auth: { token: 'test-token' } } }],
      ['collaboration_v1', { key: 'collaboration_v1', value: { version: 1, rooms: {} } }],
      ['translation_save_receipts_poe1', { key: 'translation_save_receipts_poe1', value: [{ jobId: 'prior', signature: 'kept' }] }],
    ])],
    ['revisions', new Map([[1, { id: 1, lang: 'Thai', translations: ['Legacy history'] }]])],
    ['revisions_poe1', new Map([[1, { id: 1, filepath: 'a.txt', lang: 'Thai', sourceHash: 'current', savedAt: 1, translations: ['Local translation'] }]])],
    ['revisions_poe2', new Map([[1, { id: 1, lang: 'German', translations: ['German history'] }]])],
  ]);
  const connections = new Set(), waiting = [], requests = [], events = [], createdStores = [], operations = [], commits = [];
  const features = { getAllKeys: true }; let nextTransaction = 0;
  let storedVersion = version;
  const fail = name => new DOMException(name === 'VersionError' ? 'The requested version is lower than the existing version.' : 'The connection is closing.', name);
  const drain = () => { for (const request of [...waiting]) advance(request); };
  function connection(connectionVersion) {
    const active = new Set();
    const db = { version: connectionVersion, closed: false, closing: false,
      objectStoreNames: { contains: name => tables.has(name) },
      createObjectStore(name) {
        createdStores.push(name); tables.set(name, new Map());
        const indices = new Set();
        return { indexNames:{contains: name => indices.has(name)},createIndex(name) { indices.add(name); } };
      },
      close() {
        db.closing = true;
        if (!active.size && !db.closed) {
          db.closed = true; connections.delete(db); events.push('closed:' + db.version); queueMicrotask(drain);
        }
      },
      transaction(names, mode) {
        if (db.closing || db.closed) throw fail('InvalidStateError');
        names = Array.isArray(names) ? names : [names];
        for (const name of names) assert.ok(tables.has(name), name);
        const writes = [], transactionId = ++nextTransaction; let pending = 0, completed = false, finishing = false;
        const tx = { held: false,
          objectStore(name) {
            assert.ok(names.includes(name));
            const request = run => {
              const result = {}; pending++;
              queueMicrotask(() => { result.result = run(); result.onsuccess?.(); pending--; finish(); });
              return result;
            };
            const observed = (method, key, run) => { operations.push({ transactionId, mode, store: name, method, key: copy(key) }); return request(run); };
            const matching = range => [...tables.get(name)].filter(([key]) => !range || (key >= range.lower && key <= range.upper));
            return {
              get(key) { return observed('get', key, () => copy(tables.get(name).get(key))); },
              getKey(key) { return observed('getKey', key, () => tables.get(name).has(key) ? key : undefined); },
              getAll(range) { return observed('getAll', range, () => matching(range).map(([, row]) => copy(row))); },
              getAllKeys: features.getAllKeys ? range => observed('getAllKeys', range, () => matching(range).map(([key]) => key)) : undefined,
              count(key) { return observed('count', key, () => key === undefined ? tables.get(name).size : Number(tables.get(name).has(key))); },
              put(row) { assert.equal(mode, 'readwrite'); writes.push({ name, row: copy(row), key: row.key }); return request(() => row.key); },
              delete(key) { assert.equal(mode, 'readwrite'); writes.push({ name, key, deleted: true }); return request(() => undefined); },
              add(row) {
                assert.equal(mode, 'readwrite');
                const key = Math.max(0, ...tables.get(name).keys(), ...writes.filter(write => write.name === name).map(write => write.key)) + 1;
                writes.push({ name, key, row: { ...copy(row), id: key } }); return request(() => key);
              },
              openCursor(range) {
                operations.push({ transactionId, mode, store: name, method: 'openCursor', key: copy(range) });
                const rows = matching(range); let index = 0;
                const result = {};
                const next = () => {
                  pending++;
                  queueMicrotask(() => {
                    const row = rows[index++];
                    result.result = row ? { key: row[0], value: copy(row[1]), continue: next } : null;
                    result.onsuccess?.(); pending--; finish();
                  });
                };
                next(); return result;
              },
              openKeyCursor(range) {
                operations.push({ transactionId, mode, store: name, method: 'openKeyCursor', key: copy(range) });
                const keys = matching(range).map(([key]) => key); let index = 0;
                const result = {}, next = () => {
                  pending++; queueMicrotask(() => {
                    const key = keys[index++]; result.result = key === undefined ? null : { key, continue: next };
                    result.onsuccess?.(); pending--; finish();
                  });
                };
                next(); return result;
              },
              index() {
                return { openCursor(range, direction) {
                  const rows = [...tables.get(name).entries()].filter(([, row]) => row.filepath === range.lower[0] && row.lang === range.lower[1])
                    .sort((a, b) => direction === 'prev' ? b[1].savedAt - a[1].savedAt : a[1].savedAt - b[1].savedAt);
                  let index = 0; const result = {};
                  const next = () => {
                    pending++; queueMicrotask(() => {
                      const row = rows[index++]; result.result = row ? { key: row[0], value: copy(row[1]), continue: next } : null;
                      result.onsuccess?.(); pending--; finish();
                    });
                  };
                  next(); return result;
                } };
              },
            };
          },
          release() { tx.held = false; finish(); },
          abort() { completed = true; active.delete(tx); queueMicrotask(() => tx.onabort?.()); if (db.closing) db.close(); },
        };
        function finish() {
          if (completed || finishing || pending || tx.held) return;
          finishing = true;
          setImmediate(() => {
            finishing = false;
            if (completed || pending || tx.held) return;
            completed = true;
            for (const write of writes) {
              if (write.deleted) tables.get(write.name).delete(write.key);
              else tables.get(write.name).set(write.key, write.row);
            }
            commits.push({ transactionId, mode, writes: copy(writes) });
            events.push('commit:' + db.version); active.delete(tx); tx.oncomplete?.();
            if (db.closing) db.close();
          });
        }
        active.add(tx); finish(); return tx;
      },
    };
    connections.add(db); return db;
  }
  function advance(request) {
    if (request.finished) return;
    if (request.version < storedVersion) {
      request.finished = true; request.error = fail('VersionError'); request.onerror?.(); return;
    }
    if (request.version > storedVersion) {
      if (!request.notified) {
        request.notified = true;
        for (const db of [...connections]) db.onversionchange?.({ oldVersion: storedVersion, newVersion: request.version });
      }
      if (connections.size) {
        if (!request.blocked) { request.blocked = true; request.onblocked?.({ oldVersion: storedVersion, newVersion: request.version }); }
        return;
      }
      const oldVersion = storedVersion; storedVersion = request.version;
      request.result = connection(storedVersion); events.push('upgrade:' + oldVersion + ':' + storedVersion);
      request.onupgradeneeded?.({ oldVersion, newVersion: storedVersion });
    } else request.result = connection(storedVersion);
    request.finished = true; waiting.splice(waiting.indexOf(request), 1); request.onsuccess?.();
  }
  const indexedDB = { open(name, requestedVersion) {
    assert.equal(name, 'sdeditor');
    const request = { version: requestedVersion }; requests.push(request); waiting.push(request);
    queueMicrotask(() => advance(request)); return request;
  } };
  return { indexedDB, tables, connections, requests, events, createdStores, operations, commits, features,
    get version() { return storedVersion; },
    snapshot: () => [...tables].filter(([name]) => !name.startsWith('clienttext_')).map(([name, rows]) => [name, copy([...rows])]),
  };
}
function loadStore(fixture, worker = false) {
  const root = {}, messages = [];
  const context = vm.createContext({ ...(worker ? { self: root } : { window: root }), indexedDB: fixture.indexedDB,
    console: { log() {} }, setTimeout, clearTimeout, IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) } });
  const load = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8'), context, { filename: file });
  if (worker) {
    root.postMessage = message => messages.push(copy(message));
    // The controlled lifecycle mock intentionally exercises compatibility
    // logic; normalized record semantics use real IndexedDB in their fixture.
    context.importScripts = (...files) => files.filter(file => file !== 'normalizedStore.js').forEach(load);
    load('saveWorker.js');
  } else { load('workspaceState.js'); load('offlineStore.js'); }
  return { store: root.OfflineStore, root, messages };
}

test('schema migration activity includes in-progress subscriptions and stays silent after upgrade', async () => {
  const fixture = versionedStorage(8), { store } = loadStore(fixture);
  const events = [], joined = [];
  let unsubscribeJoined;
  const unsubscribe = store.onMigration(event => {
    events.push(copy(event));
    if (event.state === 'started') unsubscribeJoined = store.onMigration(value => joined.push(copy(value)));
  });
  const unsubscribeBroken = store.onMigration(() => { throw new Error('Presentation listener failed'); });
  await store.getSettings();
  assert.deepEqual(events.map(event => event.state), ['started', 'completed']);
  assert.deepEqual(joined, events, 'A late subscription sees current activity once and its completion');
  assert.equal(events[0].kind, 'schema');
  assert.equal(events[0].id, events[1].id);
  assert.ok(events[1].durationMs >= 0);
  unsubscribe(); unsubscribeJoined(); unsubscribeBroken();
  await store.getSettings();
  assert.equal(events.length, 2);
  const warmEvents = [], reloaded = loadStore(fixture).store;
  reloaded.onMigration(event => warmEvents.push(event));
  await reloaded.getSettings();
  assert.deepEqual(warmEvents, [], 'Persisted schema version prevents repeated upgrade activity after reload');
});
function openVersion(fixture, version) {
  return new Promise((resolve, reject) => {
    const request = fixture.indexedDB.open('sdeditor', version);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

test('v4 to v11 storage upgrade preserves every KV record and revision store and adds ClientText stores', async () => {
  const fixture = versionedStorage(), before = fixture.snapshot();
  const { store } = loadStore(fixture);
  assert.deepEqual(await store.getSettings(), before[0][1].find(([key]) => key === 'settings')[1].value);
  assert.equal(fixture.version, 11); assert.equal(fixture.requests[0].version, 11);
  assert.deepEqual(fixture.createdStores, require('../public/clientTextStore.js').names); assert.deepEqual(fixture.snapshot(), before);
});

test('the existing v4 versionchange handler closes its connection and later legacy opens cannot write', async () => {
  const fixture = versionedStorage(), legacy = await openVersion(fixture, 4);
  let changed;
  legacy.onversionchange = event => { changed = event; legacy.close(); };
  const { store } = loadStore(fixture); await store.getSettings();
  assert.deepEqual(changed, { oldVersion: 4, newVersion: 11 }); assert.equal(legacy.closed, true);
  const before = fixture.snapshot();
  assert.throws(() => legacy.transaction('kv', 'readwrite'), { name: 'InvalidStateError' });
  await assert.rejects(openVersion(fixture, 4), { name: 'VersionError' });
  assert.deepEqual(fixture.snapshot(), before);
});

test('v5 editors close before the repair upgrade and cannot restage a reset through old storage', async () => {
  const fixture = versionedStorage(5), older = await openVersion(fixture, 5), before = fixture.snapshot();
  older.onversionchange = () => older.close();
  await loadStore(fixture).store.getSettings();
  assert.equal(fixture.version, 11); assert.equal(older.closed, true);
  await assert.rejects(openVersion(fixture, 5), { name: 'VersionError' });
  assert.deepEqual(fixture.snapshot(), before);
});

test('v6 writers are excluded without rewriting dictionary scopes or pending mutation receipts', async () => {
  const fixture = versionedStorage(6), older = await openVersion(fixture, 6);
  const request = { baseRevision: 2, mutationId: 'lost-ack', upserts: [{ _id: 'legacy', find: 'Fire', replace: 'Original', alts: [], tlnote: '' }], deletedIds: [] };
  fixture.tables.get('kv').set('hybrid_v1', { key: 'hybrid_v1', value: { version: 1, activeProfile: 'alice', profiles: {
    alice: { settings: { lang: 'Thai' }, dictionaries: { Thai: { entries: [{ _id: 'scoped', find: 'Fire', replace: 'PoE2', gameScope: 'poe2' }],
      pendingWrite: { request, remote: { revision: 2, entries: request.upserts }, localVersion: 3 } } }, recovery: [{ entries: request.upserts }] }
  } } });
  const before = fixture.snapshot();
  older.onversionchange = () => older.close();
  const { store } = loadStore(fixture);
  await store.getHybridState();
  assert.equal(fixture.version, 11); assert.equal(older.closed, true);
  await assert.rejects(openVersion(fixture, 6), { name: 'VersionError' });
  assert.deepEqual(fixture.snapshot(), before, 'The upgrade must not change pending requests, tokens, dictionaries, or recovery copies.');
});

test('a final pending v4 transaction commits before v11 workspace migration reads saved text', async () => {
  const fixture = versionedStorage(), legacy = await openVersion(fixture, 4);
  legacy.onversionchange = () => legacy.close();
  const pending = legacy.transaction(['kv', 'revisions_poe1'], 'readwrite'); pending.held = true;
  const finalWorkspace = copy(workspace); finalWorkspace.descs[0].translations.Thai = ['Final v4 save'];
  pending.objectStore('kv').put({ key: 'workspace_poe1', value: finalWorkspace });
  pending.objectStore('revisions_poe1').add({ filepath: 'a.txt', lang: 'Thai', savedAt: 2, translations: ['Final v4 save'] });
  const first = loadStore(fixture);
  await assert.rejects(first.store.getWorkspace('poe1', 'Thai'), /storage upgrade/);
  assert.equal(fixture.version, 4); assert.equal(legacy.closed, false);
  assert.equal(fixture.tables.get('kv').get('workspace_poe1').value.stagedVersion, undefined);
  pending.release(); await queued(); await queued();
  assert.equal(legacy.closed, true); assert.equal(fixture.version, 11);
  assert.ok(fixture.events.indexOf('commit:4') < fixture.events.indexOf('upgrade:4:11'));
  const reloaded = loadStore(fixture), migrated = await reloaded.store.getWorkspace('poe1', 'Thai');
  assert.equal(migrated.stagedVersion, 1);
  assert.deepEqual(Array.from(migrated.staged.Thai['a.txt'].translations), ['Final v4 save']);
  assert.deepEqual(fixture.tables.get('revisions_poe1').get(2).translations, ['Final v4 save']);
});

test('a blocked upgrade gives reload guidance and never clears saved data', async () => {
  const fixture = versionedStorage(), blocker = await openVersion(fixture, 4), before = fixture.snapshot();
  const { store } = loadStore(fixture);
  await assert.rejects(store.getSettings(), error => /Close every other SDEditor tab/.test(error.message)
    && /reload this tab/.test(error.message) && /storage upgrade/.test(error.message) && /saved translations have been kept/.test(error.message));
  assert.equal(fixture.version, 4); assert.deepEqual(fixture.snapshot(), before);
  blocker.close(); await queued();
  assert.equal(fixture.version, 11); assert.deepEqual(fixture.snapshot(), before);
  assert.deepEqual(await loadStore(fixture).store.getSettings(), before[0][1].find(([key]) => key === 'settings')[1].value);
});

test('a cached frontend facing newer storage reports VersionError with upgrade guidance and performs no transaction', async () => {
  const fixture = versionedStorage(12), before = fixture.snapshot();
  const { store } = loadStore(fixture);
  await assert.rejects(store.getSettings(), error => error.name === 'VersionError' && error.code === 'STORAGE_VERSION_OUTDATED'
    && error.cause.name === 'VersionError' && /latest editor/.test(error.message) && /reload this tab/.test(error.message)
    && /saved translations have been kept/.test(error.message));
  assert.deepEqual(fixture.snapshot(), before); assert.equal(fixture.events.length, 0);
});

test('the save worker and page use the same v11 storage version and preserve existing work while saving', async () => {
  const fixture = versionedStorage();
  await loadStore(fixture).store.getSettings();
  const worker = loadStore(fixture, true);
  assert.deepEqual(worker.messages, [{ type: 'ready', version: 1 }]);
  worker.root.onmessage({ data: { type: 'saveTranslations', id: 'worker-save', batch: { jobId: 'worker-save', game: 'poe1',
    language: 'Thai', sourceHash: 'current', files: [{ filepath: 'a.txt', translations: ['Worker translation'] }],
    descriptions: copy(source), revisions: [{ filepath: 'a.txt', lang: 'Thai', savedAt: 2, translations: ['Worker translation'] }] } } });
  for (let attempt = 0; attempt < 10 && !worker.messages.some(message => message.type === 'saved'); attempt++) await queued();
  assert.equal(worker.messages.at(-1).type, 'saved');
  assert.ok(fixture.requests.every(request => request.version === 11));
  assert.deepEqual(fixture.tables.get('kv').get('workspace_poe1').value.staged.Thai['a.txt'].translations, ['Worker translation']);
  assert.deepEqual(fixture.tables.get('revisions_poe2').get(1).translations, ['German history']);
  assert.deepEqual(fixture.tables.get('kv').get('settings').value.dictionary, [{ find: 'one', replace: 'หนึ่ง' }]);
});

function storedPlaceholder({ shared = false } = {}) {
  const fixture = versionedStorage(5), kv = fixture.tables.get('kv');
  const original = { ...copy(source[0]), translations: { English: ['[DNT] Source'] } };
  const file = { filepath: 'a.txt', translations: [''], revision: 0, needsReview: false, trackedForExport: true };
  const saved = { sourceHash: 'current', game: 'poe1', collaborationAccountId: 'owner', stagedVersion: 1,
    statusMetadataVersion: 1, sourceBaseline: { sourceHash: 'current' }, status: {},
    descs: [{ ...copy(original), translations: { English: ['[DNT] Source'], Thai: [''] } }],
    staged: { Thai: { 'a.txt': { sourceHash: 'current', translations: [''], before: [], savedAt: 5 } } } };
  const identity = { game: 'poe1', sourceHash: 'current', language: 'Thai', accountId: 'owner' };
  const room = { mode: 'sparse', identity, roomId: 'room', shared: shared ? { 'a.txt': { ...copy(file), revision: 1 } } : {},
    local: { 'a.txt': copy(file) }, conflicts: [],
    outbox: shared ? [] : [{ id: 'ghost-join', origin: 'merge', kind: 'join', status: 'pending',
      files: [{ base: { ...copy(file), trackedForExport: false }, yours: copy(file) }] }],
    recovery: [{ reason: 'Local edited translation before joining', files: [copy(file)] }] };
  kv.set('source_poe1', { key: 'source_poe1', value: [original] });
  kv.set('workspace_poe1', { key: 'workspace_poe1', value: saved });
  kv.set('collaboration_v1', { key: 'collaboration_v1', value: { version: 1, rooms: { own: room } } });
  kv.set('translation_save_receipts_poe1', { key: 'translation_save_receipts_poe1', value: [] });
  fixture.tables.get('revisions_poe1').clear();
  return { fixture, kv, saved, room };
}

test('loading repairs placeholders, retry state and recovery archive in the same durable transaction once', async () => {
  const { fixture, kv } = storedPlaceholder();
  const { store } = loadStore(fixture), loaded = await store.getWorkspace('poe1', 'Thai');
  const room = kv.get('collaboration_v1').value.rooms.own;
  assert.equal(loaded.staged.Thai['a.txt'], undefined); assert.equal(room.outbox.length, 0);
  assert.equal(room.placeholderRepairs.length, 1); assert.equal(loaded.placeholderRepairVersion, 1);
  assert.equal(Object.values(loaded.placeholderRepairArchive).length, 1);
  const before = fixture.snapshot();
  assert.deepEqual(copy(await store.getWorkspace('poe1', 'Thai')), copy(loaded));
  assert.deepEqual(fixture.snapshot(), before, 'Reload must not queue another repair or rewrite settled records.');
});

test('loading leaves already shared placeholders staged until the guarded API repair completes', async () => {
  const { fixture, kv } = storedPlaceholder({ shared: true });
  const loaded = await loadStore(fixture).store.getWorkspace('poe1', 'Thai');
  assert.deepEqual(Array.from(loaded.staged.Thai['a.txt'].translations), ['']);
  assert.equal(kv.get('collaboration_v1').value.rooms.own.placeholderRepairs.length, 1);
});

test('legacy workspace bundles preserve selected-language migration, placeholder repair and settled reload behavior', async t => {
  for (const language of ['Thai', 'German', 'English']) for (const shared of [false, true]) await t.test(language + (shared ? ' shared' : ' local'), async () => {
    const { fixture, kv } = storedPlaceholder({ shared }), { store } = loadStore(fixture);
    const original = copy(kv.get('source_poe1').value);
    const bundled = await store.getWorkspaceSnapshot('poe1', language);
    assert.equal(bundled.scope, null);
    assert.equal(bundled.baseline, null);
    assert.deepEqual(copy(bundled.source), original);
    assert.deepEqual(copy(bundled.workspace), copy(await store.getWorkspace('poe1', language)), 'The ordinary workspace adapter and bundle agree');
    if (language !== 'English') {
      assert.equal(bundled.workspace.placeholderRepairVersion, 1);
      assert.equal(kv.get('collaboration_v1').value.rooms.own.placeholderRepairs.length, 1);
      assert.equal(!!bundled.workspace.staged.Thai['a.txt'], shared, 'Shared placeholders stay staged until the guarded repair is acknowledged');
    }
    const settled = fixture.snapshot();
    assert.deepEqual(copy((await store.getWorkspaceSnapshot('poe1', language)).workspace), copy(bundled.workspace));
    assert.deepEqual(fixture.snapshot(), settled, 'Settled bundled reload cannot recreate repairs or rewrite migration evidence');
  });
});

test('an unscoped legacy bundle keeps captured storage keys when a different account is selected during the read', async () => {
  const fixture = versionedStorage(), { store } = loadStore(fixture), kv = fixture.tables.get('kv');
  const selected = { accountId: 'another', game: 'poe2', branchId: 'release', sourceHash: 'new-source' };
  const suffix = JSON.stringify([selected.accountId, selected.game, selected.branchId, selected.sourceHash]);
  kv.set('workspace_version_v1:' + suffix, { key: 'workspace_version_v1:' + suffix, value: { untouched: true, sourceHash: selected.sourceHash } });
  kv.set('source_version_v1:' + suffix, { key: 'source_version_v1:' + suffix, value: [{ filepath: 'another-source.txt' }] });
  const loading = store.getWorkspaceSnapshot('poe1', 'Thai');
  store.setWorkspaceContext(selected);
  const bundled = await loading;
  assert.equal(bundled.scope, null);
  assert.equal(bundled.workspace.sourceHash, 'current');
  assert.deepEqual(copy(bundled.source), source);
  assert.deepEqual(kv.get('workspace_version_v1:' + suffix).value, { untouched: true, sourceHash: selected.sourceHash });
});

test('English legacy bundle cleanup commits into its captured slot after an account switch', async () => {
  const fixture = versionedStorage(), { store } = loadStore(fixture), kv = fixture.tables.get('kv');
  const legacy = copy(workspace);
  legacy.stagedVersion = 1; legacy.statusMetadataVersion = 0; legacy.staged = {};
  kv.set('workspace_poe1', { key: 'workspace_poe1', value: legacy });
  const selected = { accountId: 'another', game: 'poe1', branchId: 'default', sourceHash: 'new-source' };
  const key = 'workspace_version_v1:' + JSON.stringify([selected.accountId, selected.game, selected.branchId, selected.sourceHash]);
  kv.set(key, { key, value: { untouched: true, sourceHash: selected.sourceHash } });
  const loading = store.getWorkspaceSnapshot('poe1', 'English');
  store.setWorkspaceContext(selected);
  const bundled = await loading;
  assert.equal(bundled.workspace.statusMetadataVersion, 1);
  assert.equal(bundled.workspace.descs[0].hasChanges, undefined);
  assert.deepEqual(copy(bundled.source), source);
  assert.equal(kv.get('workspace_poe1').value.statusMetadataVersion, 1);
  assert.deepEqual(kv.get(key).value, { untouched: true, sourceHash: selected.sourceHash });
});

test('authored blank save history and receipts prevent automatic placeholder cleanup on load', async () => {
  for (const evidence of ['history', 'receipt']) {
    const { fixture, kv } = storedPlaceholder({ shared: true });
    if (evidence === 'history') fixture.tables.get('revisions_poe1').set(1, { id: 1, filepath: 'a.txt', lang: 'Thai', translations: [''] });
    else kv.set('translation_save_receipts_poe1', { key: 'translation_save_receipts_poe1', value: [{
      signature: JSON.stringify({ scope: ['poe1', 'Thai', 'current', 'owner'], files: [{ filepath: 'a.txt', translations: [''] }] }),
    }] });
    const loaded = await loadStore(fixture).store.getWorkspace('poe1', 'Thai');
    assert.ok(loaded.staged.Thai['a.txt'], evidence);
    assert.equal(kv.get('collaboration_v1').value.rooms.own.placeholderRepairs, undefined, evidence);
    assert.equal(loaded.placeholderRepairArchive, undefined, evidence);
  }
});

test('a failed placeholder repair transaction preserves both the saved record and its pending upload', async () => {
  const { fixture } = storedPlaceholder(), before = fixture.snapshot();
  const loaded = loadStore(fixture), repair = loaded.root.WorkspaceState.repairLegacyPlaceholders;
  loaded.root.WorkspaceState.repairLegacyPlaceholders = (...args) => { repair(...args); throw new Error('Repair storage failed'); };
  await assert.rejects(loaded.store.getWorkspace('poe1', 'Thai'), /Repair storage failed/);
  assert.deepEqual(fixture.snapshot(), before);
});

const localScope = (sourceHash = 'current', accountId = 'guest', branchId = 'default') => ({ accountId, game: 'poe1', branchId, sourceHash });
function versionWorkspace(store, hash, text) {
  const result = { sourceHash: hash, game: 'poe1', branchId: 'default', descs: copy(source), status: {} };
  store.root.WorkspaceState.initializeWorkspace(result, { source, sourceHash: hash, game: 'poe1', language: 'Thai' });
  if (text !== undefined) store.root.WorkspaceState.stageTranslation(result, { filepath: 'a.txt', translations: [text] }, 'Thai', { source: source[0] });
  return result;
}

test('v9 copies the current legacy slot once into its owner scope and preserves legacy stores and receipt IDs', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture), before = copy(fixture.tables.get('kv').get('workspace_poe1'));
  loaded.store.setWorkspaceContext(localScope(''));
  const current = await loaded.store.getWorkspace('poe1', 'Thai');
  assert.equal(current.sourceHash, 'current'); assert.equal(current.accountId, 'guest');
  assert.deepEqual(Array.from(current.staged.Thai['a.txt'].translations), ['Local translation']);
  assert.deepEqual(fixture.tables.get('kv').get('workspace_poe1'), before);
  const versions = await loaded.store.listLocalVersions(localScope(''));
  assert.equal(versions.length, 1); assert.equal(versions[0].hasSource, true); assert.equal(versions[0].current, true);
  const receipts = [...fixture.tables.get('kv')].find(([key]) => key.startsWith('translation_save_receipts_v2:'))[1].value;
  assert.deepEqual(receipts, [{ jobId: 'prior', signature: 'kept' }]);
  loaded.store.setWorkspaceContext(localScope('', 'other-account'));
  assert.equal(await loaded.store.getVersionWorkspace(localScope('current', 'other-account'), 'Thai'), null);
  assert.equal(await loaded.store.getSource('poe1'), undefined);
});

test('named versions activate their exact snapshots without source advancement or dropped assignment writes', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture);
  loaded.store.setWorkspaceContext(localScope('')); await loaded.store.getWorkspace('poe1', 'Thai');
  await loaded.store.setVersionMetadata(localScope(), { name: 'Old version' });
  const next = versionWorkspace(loaded, 'next', 'New version work');
  await loaded.store.saveSourceWorkspaceWithRevisions(source, next, [{ filepath: 'a.txt', lang: 'Thai', savedAt: 2, translations: ['New version work'] }], 'poe1');
  await loaded.store.setVersionMetadata(localScope('next'), { name: 'Next version', catalogVersionId: 'published-next' });
  const before = copy(await loaded.store.getVersionWorkspace(localScope(), 'Thai'));
  const activation = await loaded.store.activateVersion(localScope());
  assert.deepEqual(activation.workspace, before); assert.equal(activation.metadata.name, 'Old version');
  assert.deepEqual(copy(await loaded.store.getWorkspace('poe1', 'Thai')), before);
  assert.deepEqual(Array.from((await loaded.store.getVersionWorkspace(localScope('next'), 'Thai')).staged.Thai['a.txt'].translations), ['New version work']);
  assert.equal((await loaded.store.listLocalVersions(localScope(''))).find(row => row.sourceHash === 'next').online, true);
  await loaded.store.setVersionMetadata(localScope('not-cached'), { name: 'Details only', catalogVersionId: 'details' });
  assert.equal((await loaded.store.listLocalVersions(localScope(''))).find(row => row.sourceHash === 'not-cached').hasSource, false);
});

test('a captured worker save and receipt replay target the old indexed version after another version becomes active', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture);
  loaded.store.setWorkspaceContext(localScope('')); await loaded.store.getWorkspace('poe1', 'Thai');
  const batch = { jobId: 'captured-old', game: 'poe1', accountId: 'guest', language: 'Thai', sourceHash: 'current',
    workspaceScope: copy(localScope()), files: [{ filepath: 'a.txt', translations: ['Saved in old version'] }], descriptions: copy(source),
    revisions: [{ filepath: 'a.txt', lang: 'Thai', savedAt: 3, translations: ['Saved in old version'] }] };
  await loaded.store.saveSourceWorkspaceWithRevisions(source, versionWorkspace(loaded, 'next', 'Next work'), [], 'poe1');
  const worker = loadStore(fixture, true);
  const saved = await worker.store.saveTranslationBatch(batch);
  assert.equal(saved.status, 'local'); assert.equal(saved.jobId, 'captured-old');
  assert.deepEqual(Array.from((await loaded.store.getVersionWorkspace(localScope(), 'Thai')).staged.Thai['a.txt'].translations), ['Saved in old version']);
  assert.deepEqual(Array.from((await loaded.store.getWorkspace('poe1', 'Thai')).staged.Thai['a.txt'].translations), ['Next work']);
  const retry = await worker.store.saveTranslationBatch(batch); assert.equal(retry.duplicate, true);
  assert.equal([...fixture.tables.get('revisions_poe1').values()].filter(row => row.translations?.[0] === 'Saved in old version').length, 1);
});

test('version history and catalog caches isolate account, branch and source while preserving legacy history', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture);
  loaded.store.setWorkspaceContext(localScope('')); await loaded.store.getWorkspace('poe1', 'Thai');
  for (const [scope, text] of [[localScope(), 'default current'], [localScope('next'), 'next source'],
    [localScope('current', 'guest', 'release'), 'release branch'], [localScope('current', 'signed-account'), 'other account']]) {
    await loaded.store.addRevision({ filepath: 'a.txt', lang: 'Thai', savedAt: 10, translations: [text] }, scope);
  }
  const current = await loaded.store.listRevisions('a.txt', 'Thai', 100, localScope());
  assert.deepEqual(Array.from(current, row => row.translations[0]).sort(), ['Local translation', 'default current']);
  assert.equal((await loaded.store.listRevisions('a.txt', 'Thai', 100, localScope('current', 'guest', 'release')))[0].translations[0], 'release branch');
  assert.equal((await loaded.store.listLegacyRevisions('a.txt', 'Thai', 100, 'poe1')).length, 3);
  assert.equal(fixture.tables.get('revisions_poe1').size, 5, 'All branches and accounts retain their original rows.');
  await loaded.store.setVersionCatalog(localScope('', 'signed-account'), [{ id: 'private-catalog' }]);
  assert.equal(await loaded.store.getVersionCatalog(localScope('', 'guest')), undefined);
  assert.deepEqual(copy(await loaded.store.getVersionCatalog(localScope('', 'signed-account'))), [{ id: 'private-catalog' }]);
});
test('same ZIP content groups isolate durable saves, receipt replay, history and activation',async()=>{
  const fixture=versionedStorage(7),loaded=loadStore(fixture),first={...localScope(),versionId:'version',groupId:'first'},second={...first,groupId:'second'};
  loaded.store.setWorkspaceContext(localScope(''));await loaded.store.getWorkspace('poe1','Thai');
  for(const [scope,text] of [[first,'First group'],[second,'Second group']]){
    await loaded.store.saveSourceWorkspaceWithRevisions(source,versionWorkspace(loaded,scope.sourceHash),[],scope);
    const batch={jobId:'same-job-id',game:'poe1',accountId:'guest',language:'Thai',sourceHash:'current',workspaceScope:scope,
      files:[{filepath:'a.txt',translations:[text]}],revisions:[{filepath:'a.txt',lang:'Thai',savedAt:10,translations:[text]}]};
    assert.equal((await loaded.store.saveTranslationBatch(batch)).status,'local');
    assert.equal((await loaded.store.saveTranslationBatch(batch)).duplicate,true);
    assert.deepEqual(Array.from((await loaded.store.listRevisions('a.txt','Thai',100,scope)),row=>row.translations[0]),[text]);
  }
  assert.deepEqual(Array.from((await loaded.store.getVersionWorkspace(first,'Thai')).staged.Thai['a.txt'].translations),['First group']);
  assert.deepEqual(Array.from((await loaded.store.getVersionWorkspace(second,'Thai')).staged.Thai['a.txt'].translations),['Second group']);
  assert.deepEqual(Array.from((await loaded.store.getVersionWorkspace(localScope(),'Thai')).staged.Thai['a.txt'].translations),['Local translation']);
  await loaded.store.activateVersion(first);
  assert.deepEqual(Array.from((await loaded.store.getWorkspace('poe1','Thai')).staged.Thai['a.txt'].translations),['First group']);
  const rows=await loaded.store.listLocalVersions(localScope(''),{metadataOnly:true});
  assert.equal(rows.length,3);assert.equal(rows.filter(row=>row.current).length,1);assert.equal(rows.find(row=>row.current).groupId,'first');
  assert.equal((await loaded.store.listLocalVersions({...second,sourceHash:''},{metadataOnly:true})).length,1);
});

test('guest adoption copies current committed work only into an empty account and retains guest recovery evidence', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture), before = copy(fixture.tables.get('revisions_poe1'));
  loaded.store.setWorkspaceContext(localScope('', 'signed-account'));
  const adopted = await loaded.store.adoptGuestVersion(localScope('current', 'signed-account'));
  assert.equal(adopted.accountId, 'signed-account');
  assert.deepEqual(Array.from((await loaded.store.getVersionWorkspace(adopted, 'Thai')).staged.Thai['a.txt'].translations), ['Local translation']);
  assert.deepEqual(Array.from((await loaded.store.getVersionWorkspace(localScope(), 'Thai')).staged.Thai['a.txt'].translations), ['Local translation']);
  assert.deepEqual(fixture.tables.get('revisions_poe1'), before);
  assert.equal(await loaded.store.adoptGuestVersion(localScope('current', 'signed-account')), null);
  const other = fixture.tables.get('kv').get('workspace_poe1'); other.value.collaborationAccountId = 'another-account';
  assert.equal(await loaded.store.adoptGuestVersion(localScope('unavailable', 'signed-account')), null);
});

test('source-version persistence aborts baseline mismatches without moving the active pointer or losing the predecessor', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture);
  loaded.store.setWorkspaceContext(localScope('')); await loaded.store.getWorkspace('poe1', 'Thai');
  const before = fixture.snapshot();
  await assert.rejects(loaded.store.saveSourceWorkspaceWithRevisions(source, versionWorkspace(loaded, 'next'), [], 'poe1',
    { archive: { baselineId: 'a'.repeat(64) } }), /identity differ/);
  assert.deepEqual(fixture.snapshot(), before);
  assert.equal((await loaded.store.getWorkspace('poe1', 'Thai')).sourceHash, 'current');
});

test('switching games with an empty source scope loads each persisted active version without retaining another game hash', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture), kv = fixture.tables.get('kv');
  const poe2Workspace = { ...copy(workspace), sourceHash: 'poe2-current' };
  poe2Workspace.descs[0].translations.Thai = ['PoE2 local work'];
  kv.set('workspace_poe2', { key: 'workspace_poe2', value: poe2Workspace });
  kv.set('source_poe2', { key: 'source_poe2', value: copy(source) });
  loaded.store.setWorkspaceContext(localScope(''));
  assert.equal((await loaded.store.getWorkspace('poe1', 'Thai')).sourceHash, 'current');
  loaded.store.setWorkspaceContext({ ...localScope(''), game: 'poe2' });
  assert.equal((await loaded.store.getWorkspace('poe2', 'Thai')).sourceHash, 'poe2-current');
  // An old UI callback may briefly provide the previous game's identity before
  // the new loader clears its source; the empty context must discard that cache.
  loaded.store.setWorkspaceContext({ ...localScope('current'), game: 'poe2' });
  loaded.store.setWorkspaceContext({ ...localScope(''), game: 'poe2' });
  const loadedPoe2 = await loaded.store.getWorkspace('poe2', 'Thai');
  assert.equal(loadedPoe2.sourceHash, 'poe2-current');
  assert.deepEqual(Array.from(loadedPoe2.staged.Thai['a.txt'].translations), ['PoE2 local work']);
  loaded.store.setWorkspaceContext(localScope(''));
  assert.equal((await loaded.store.getWorkspace('poe1', 'Thai')).sourceHash, 'current');
});

test('upload and collection recovery identifiers survive a new store instance and isolate owner, branch and team', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture);
  const scope = localScope('', 'manager'), upload = { id: 'durable-upload', name: 'Weekly version', state: 'preparing' };
  await loaded.store.setVersionUpload(scope, upload);
  await loaded.store.setVersionCollectionRequest(scope, 'version-one', 'Thai', 'collect-one');
  await loaded.store.setVersionCollectionRequest(scope, 'version-one', 'Thai', 'download-one', false);
  const reloaded = loadStore(fixture);
  assert.deepEqual(copy(await reloaded.store.getVersionUpload(scope)), upload);
  assert.equal(await reloaded.store.getVersionCollectionRequest(scope, 'version-one', 'Thai'), 'collect-one');
  assert.equal(await reloaded.store.getVersionCollectionRequest(scope, 'version-one', 'Thai', false), 'download-one');
  assert.equal(await reloaded.store.getVersionUpload(localScope('', 'other-manager')), undefined);
  assert.equal(await reloaded.store.getVersionUpload(localScope('', 'manager', 'release')), undefined);
  assert.equal(await reloaded.store.getVersionCollectionRequest(scope, 'version-one', 'German'), undefined);
  assert.equal(await reloaded.store.getVersionCollectionRequest(scope, 'version-two', 'Thai'), undefined);
  await reloaded.store.setVersionUpload(scope, null);
  await reloaded.store.setVersionCollectionRequest(scope, 'version-one', 'Thai', null);
  assert.equal(await loaded.store.getVersionUpload(scope), undefined);
  assert.equal(await loaded.store.getVersionCollectionRequest(scope, 'version-one', 'Thai'), undefined);
  assert.equal(await loaded.store.getVersionCollectionRequest(scope, 'version-one', 'Thai', false), 'download-one');
  await reloaded.store.setVersionCollectionRequest(scope, 'version-one', 'Thai', null, false);
  assert.equal(await loaded.store.getVersionCollectionRequest(scope, 'version-one', 'Thai', false), undefined);
});

test('v7 single-slot writers close for v9 and cannot overwrite indexed version state afterward', async () => {
  const fixture = versionedStorage(7), old = await openVersion(fixture, 7);
  old.onversionchange = () => old.close();
  const loaded = loadStore(fixture);
  loaded.store.setWorkspaceContext(localScope(''));
  await loaded.store.getWorkspace('poe1', 'Thai');
  assert.equal(old.closed, true);
  assert.throws(() => old.transaction(['kv'], 'readwrite'), error => error.name === 'InvalidStateError');
  await assert.rejects(openVersion(fixture, 7), error => error.name === 'VersionError');
  assert.equal((await loaded.store.getWorkspace('poe1', 'Thai')).sourceHash, 'current');
});

test('v8 aggregate writers close before v9 and cannot overwrite normalized data or recovery evidence', async () => {
  const fixture = versionedStorage(8), older = await openVersion(fixture, 8), before = fixture.snapshot();
  older.onversionchange = () => older.close();
  await loadStore(fixture).store.getSettings();
  assert.equal(fixture.version, 11); assert.equal(older.closed, true);
  assert.throws(() => older.transaction(['kv'], 'readwrite'), error => error.name === 'InvalidStateError');
  await assert.rejects(openVersion(fixture, 8), error => error.name === 'VersionError');
  assert.deepEqual(fixture.snapshot(), before);
});

test('an unhashed legacy workspace is indexed under the real canonical source identity before its first save', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture), kv = fixture.tables.get('kv');
  delete kv.get('workspace_poe1').value.sourceHash;
  loaded.root.CollaborationProtocol = require('../public/collaborationProtocol.js');
  const expected = await loaded.root.CollaborationProtocol.sourceHash(copy(source));
  loaded.store.setWorkspaceContext(localScope(''));
  const [migrated, original] = await Promise.all([loaded.store.getWorkspace('poe1', 'Thai'), loaded.store.getSource('poe1')]);
  assert.equal(migrated.sourceHash, expected); assert.deepEqual(copy(original), source);
  assert.equal(kv.get('workspace_poe1').value.sourceHash, undefined, 'The original legacy recovery slot stays intact.');
  assert.equal((await loaded.store.listLocalVersions(localScope('')))[0].sourceHash, expected);
  const scope = localScope(expected);
  await loaded.store.saveTranslationBatch({ jobId: 'first-unhashed-save', game: 'poe1', accountId: 'guest', sourceHash: expected,
    branchId: 'default', workspaceScope: scope, language: 'Thai', files: [{ filepath: 'a.txt', translations: ['First scoped save'] }] });
  assert.deepEqual(Array.from((await loaded.store.getVersionWorkspace(scope, 'Thai')).staged.Thai['a.txt'].translations), ['First scoped save']);
});

function namedVersionKey(prefix, scope) {
  return prefix + JSON.stringify([scope.accountId, scope.game, scope.branchId, scope.sourceHash]);
}
function putFixtureValue(fixture, key, value) { fixture.tables.get('kv').set(key, { key, value: copy(value) }); }
function assertMetadataOnlyReads(fixture) {
  assert.ok(fixture.operations.every(operation => operation.store === 'kv'), 'Catalog discovery must not visit revision stores.');
  for (const operation of fixture.operations) {
    if (operation.method === 'get') assert.ok(operation.key.startsWith('workspace_active_v1:'), 'Only the small active pointer may be read directly: ' + operation.key);
    if (operation.method === 'getAll') assert.ok(operation.key?.lower?.startsWith('version_index_v1:'), 'Only the small version index may be read in bulk.');
    assert.notEqual(operation.method, 'openCursor', 'Metadata discovery must use a key-only cursor.');
  }
}

test('metadata-only version listing reads small scoped index values and legacy keys without loading stored files or details', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture), scope = localScope('', 'alice');
  const current = { ...scope, sourceHash: 'indexed' }, older = { ...scope, sourceHash: 'old-metadata' };
  putFixtureValue(fixture, namedVersionKey('version_index_v1:', current), { ...current, accountId: 'wrong-account', game: 'poe2', branchId: 'wrong-branch', sourceHash: 'wrong-source', name: 'Indexed name', createdAt: 20 });
  putFixtureValue(fixture, namedVersionKey('version_metadata_v1:', older), { ...older, name: 'Heavy old metadata', details: { teams: [{ language: 'Thai', recoveries: [{ snapshot: { translations: ['Private retained translation'] } }] }] } });
  for (const version of [current, older]) {
    putFixtureValue(fixture, namedVersionKey('source_version_v1:', version), source);
    putFixtureValue(fixture, namedVersionKey('workspace_version_v1:', version), workspace);
  }
  for (const excluded of [{ ...scope, accountId: 'alice-other', sourceHash: 'other-profile' }, { ...scope, game: 'poe2', sourceHash: 'other-game' }, { ...scope, branchId: 'release', sourceHash: 'other-branch' }]) {
    putFixtureValue(fixture, namedVersionKey('version_index_v1:', excluded), { ...excluded, name: 'Excluded' });
    putFixtureValue(fixture, namedVersionKey('version_metadata_v1:', excluded), { ...excluded, name: 'Excluded metadata' });
  }
  const activeKey = 'workspace_active_v1:' + JSON.stringify([scope.accountId, scope.game, scope.branchId]);
  putFixtureValue(fixture, activeKey, { ...current, accountId: 'another-owner' });
  loaded.store.setWorkspaceContext(scope); const before = fixture.snapshot();
  const listed = copy(await loaded.store.listLocalVersions(scope, { metadataOnly: true }));
  assert.deepEqual(listed.map(version => version.sourceHash), ['indexed', 'old-metadata']);
  assert.ok(listed.every(version => version.accountId === 'alice' && version.game === 'poe1' && version.branchId === 'default' && version.hasSource));
  assert.equal(listed[0].name, 'Indexed name'); assert.equal(listed[1].metadataPending, true); assert.equal(listed[1].name, '');
  assert.ok(listed.every(version => !version.current)); assert.ok(!JSON.stringify(listed).includes('Private retained translation'));
  assert.deepEqual(fixture.snapshot(), before); assertMetadataOnlyReads(fixture);
  const expectedPrefix = 'version_metadata_v1:' + JSON.stringify(['alice','poe1','default']).slice(0, -1) + ',';
  assert.ok(fixture.operations.filter(operation => operation.method === 'getAllKeys').every(operation => operation.key.lower === expectedPrefix));
  putFixtureValue(fixture, activeKey, current); fixture.operations.length = 0;
  assert.equal((await loaded.store.listLocalVersions(scope, { metadataOnly: true }))[0].current, true); assertMetadataOnlyReads(fixture);
});

test('metadata-only legacy discovery uses a scoped key cursor when getAllKeys is unavailable', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture), scope = localScope('', 'alice', 'release');
  fixture.features.getAllKeys = false;
  const owned = { ...scope, sourceHash: 'retained' }, other = { ...owned, branchId: 'default' };
  putFixtureValue(fixture, namedVersionKey('version_metadata_v1:', owned), { ...owned, name: 'Old private metadata', details: { teams: ['Never read'] } });
  putFixtureValue(fixture, namedVersionKey('version_metadata_v1:', other), { ...other, name: 'Other branch' });
  putFixtureValue(fixture, namedVersionKey('source_version_v1:', owned), source);
  const before = fixture.snapshot(), listed = copy(await loaded.store.listLocalVersions(scope, { metadataOnly: true }));
  assert.equal(listed.length, 1); assert.equal(listed[0].sourceHash, 'retained'); assert.equal(listed[0].metadataPending, true); assert.equal(listed[0].hasSource, true);
  assert.deepEqual(fixture.snapshot(), before); assertMetadataOnlyReads(fixture);
  assert.equal(fixture.operations.filter(operation => operation.method === 'openKeyCursor').length, 1);
  assert.ok(fixture.operations.filter(operation => operation.method === 'openKeyCursor').every(operation => operation.key.lower.includes('["alice","poe1","release",')));
});

test('source imports and named metadata commit their small indexes atomically while keeping team recovery payloads out of the index', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture), scope = { ...localScope('imported', 'owner', 'release'), game: 'poe2' };
  loaded.store.setWorkspaceContext(scope);
  const imported = { sourceHash: scope.sourceHash, game: scope.game, branchId: scope.branchId, descs: copy(source), status: {} };
  await loaded.store.saveSourceWorkspaceWithRevisions(source, imported, [{ filepath: 'a.txt', lang: 'Thai', savedAt: 20, translations: ['Imported history'] }], scope);
  const indexKey = namedVersionKey('version_index_v1:', scope), metadataKey = namedVersionKey('version_metadata_v1:', scope);
  const importCommit = fixture.commits.find(commit => commit.writes.some(write => write.key === indexKey));
  assert.ok(importCommit);
  for (const key of [indexKey, metadataKey, namedVersionKey('source_version_v1:', scope), namedVersionKey('workspace_version_v1:', scope), 'workspace_active_v1:' + JSON.stringify([scope.accountId, scope.game, scope.branchId])]) {
    assert.ok(importCommit.writes.some(write => write.name === 'kv' && write.key === key), 'The source/index commit must include ' + key);
  }
  assert.ok(importCommit.writes.some(write => write.name === 'revisions_poe2'));
  const details = { version: { id: 'official', game: scope.game, branchId: scope.branchId, sourceHash: scope.sourceHash, name: 'Official name', assignedTeam: { language: 'Thai', ended: false }, archive: { files: source } },
    teams: [{ language: 'Thai', counts: { saved: 99 }, recoveries: [{ snapshot: { translations: ['Private recovered text'] } }] }] };
  await loaded.store.setVersionMetadata(scope, { name: 'Local name', officialName: 'Official name', catalogVersionId: 'official', details,
    accountId: 'injected', game: 'poe1', branchId: 'injected', sourceHash: 'injected', source, workspace: imported, history: ['Private history'], recoveries: ['Private recovery'] });
  const metadataCommit = fixture.commits.at(-1), kv = fixture.tables.get('kv'), index = kv.get(indexKey).value;
  assert.deepEqual(metadataCommit.writes.map(write => write.key).sort(), [indexKey, metadataKey].sort());
  assert.equal(index.accountId, 'owner'); assert.equal(index.game, 'poe2'); assert.equal(index.branchId, 'release'); assert.equal(index.sourceHash, 'imported');
  assert.equal(index.name, 'Local name'); assert.equal(index.officialName, 'Official name'); assert.equal(index.catalogVersionId, 'official');
  assert.equal(index.catalogVersion.id, 'official'); assert.deepEqual(index.catalogVersion.assignedTeam, { language: 'Thai', ended: false });
  for (const field of ['details','teams','source','workspace','history','recoveries']) assert.equal(index[field], undefined, field + ' must not enter the small index.');
  assert.equal(index.catalogVersion.archive, undefined); assert.ok(!JSON.stringify(index).includes('Private'));
  assert.deepEqual(kv.get(metadataKey).value.details, details, 'The full details remain preserved separately.');
  const before = fixture.snapshot(), invalidScope = { ...scope, sourceHash: 'invalid-import' };
  await assert.rejects(loaded.store.saveSourceWorkspaceWithRevisions(source, { ...imported, sourceHash: invalidScope.sourceHash }, [], invalidScope,
    { archive: { baselineId: 'a'.repeat(64) } }), /identity differ/);
  assert.deepEqual(fixture.snapshot(), before); assert.equal(kv.has(namedVersionKey('version_index_v1:', invalidScope)), false);
});

test('legacy game-slot placeholders disclose no owner or files and do not migrate work during catalog listing', async () => {
  const fixture = versionedStorage(7), loaded = loadStore(fixture), kv = fixture.tables.get('kv');
  kv.get('workspace_poe1').value.accountId = 'actual-owner'; kv.get('workspace_poe1').value.versionName = 'Owner private name';
  const scope = localScope('', 'another-account'), before = fixture.snapshot();
  const listed = copy(await loaded.store.listLocalVersions(scope, { metadataOnly: true }));
  assert.equal(listed.length, 1); assert.equal(listed[0].legacy, true); assert.equal(listed[0].ownershipUnknown, true); assert.equal(listed[0].sourceHash, '');
  assert.equal(listed[0].name, 'Stored offline workspace'); assert.equal(listed[0].hasSource, false); assert.equal(listed[0].hasLegacySource, true); assert.equal(listed[0].current, false);
  assert.ok(!JSON.stringify(listed).includes('Owner private name')); assert.deepEqual(fixture.snapshot(), before); assertMetadataOnlyReads(fixture);
  fixture.operations.length = 0;
  assert.deepEqual(copy(await loaded.store.listLocalVersions({ ...scope, branchId: 'release' }, { metadataOnly: true })), []);
  assert.deepEqual(fixture.snapshot(), before); assertMetadataOnlyReads(fixture);
});
