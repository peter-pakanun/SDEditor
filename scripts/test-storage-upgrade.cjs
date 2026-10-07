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
  const connections = new Set(), waiting = [], requests = [], events = [], createdStores = [];
  let storedVersion = version;
  const fail = name => new DOMException(name === 'VersionError' ? 'The requested version is lower than the existing version.' : 'The connection is closing.', name);
  const drain = () => { for (const request of [...waiting]) advance(request); };
  function connection(connectionVersion) {
    const active = new Set();
    const db = { version: connectionVersion, closed: false, closing: false,
      objectStoreNames: { contains: name => tables.has(name) },
      createObjectStore(name) {
        createdStores.push(name); tables.set(name, new Map());
        return { createIndex() {} };
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
        const writes = []; let pending = 0, completed = false, finishing = false;
        const tx = { held: false,
          objectStore(name) {
            assert.ok(names.includes(name));
            const request = run => {
              const result = {}; pending++;
              queueMicrotask(() => { result.result = run(); result.onsuccess?.(); pending--; finish(); });
              return result;
            };
            return {
              get(key) { return request(() => copy(tables.get(name).get(key))); },
              put(row) { assert.equal(mode, 'readwrite'); writes.push({ name, row: copy(row), key: row.key }); return request(() => row.key); },
              add(row) {
                assert.equal(mode, 'readwrite');
                const key = Math.max(0, ...tables.get(name).keys(), ...writes.filter(write => write.name === name).map(write => write.key)) + 1;
                writes.push({ name, key, row: { ...copy(row), id: key } }); return request(() => key);
              },
              openCursor() {
                const rows = [...tables.get(name).entries()]; let index = 0;
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
            for (const write of writes) tables.get(write.name).set(write.key, write.row);
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
  return { indexedDB, tables, connections, requests, events, createdStores,
    get version() { return storedVersion; },
    snapshot: () => [...tables].map(([name, rows]) => [name, copy([...rows])]),
  };
}
function loadStore(fixture, worker = false) {
  const root = {}, messages = [];
  const context = vm.createContext({ ...(worker ? { self: root } : { window: root }), indexedDB: fixture.indexedDB,
    console: { log() {} }, setTimeout, clearTimeout });
  const load = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8'), context, { filename: file });
  if (worker) {
    root.postMessage = message => messages.push(copy(message));
    context.importScripts = (...files) => files.forEach(load);
    load('saveWorker.js');
  } else { load('workspaceState.js'); load('offlineStore.js'); }
  return { store: root.OfflineStore, root, messages };
}
function openVersion(fixture, version) {
  return new Promise((resolve, reject) => {
    const request = fixture.indexedDB.open('sdeditor', version);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

test('v4 to v5 storage upgrade preserves every KV record and revision store without recreating stores', async () => {
  const fixture = versionedStorage(), before = fixture.snapshot();
  const { store } = loadStore(fixture);
  assert.deepEqual(await store.getSettings(), before[0][1].find(([key]) => key === 'settings')[1].value);
  assert.equal(fixture.version, 5); assert.equal(fixture.requests[0].version, 5);
  assert.deepEqual(fixture.createdStores, []); assert.deepEqual(fixture.snapshot(), before);
});

test('the existing v4 versionchange handler closes its connection and later legacy opens cannot write', async () => {
  const fixture = versionedStorage(), legacy = await openVersion(fixture, 4);
  let changed;
  legacy.onversionchange = event => { changed = event; legacy.close(); };
  const { store } = loadStore(fixture); await store.getSettings();
  assert.deepEqual(changed, { oldVersion: 4, newVersion: 5 }); assert.equal(legacy.closed, true);
  const before = fixture.snapshot();
  assert.throws(() => legacy.transaction('kv', 'readwrite'), { name: 'InvalidStateError' });
  await assert.rejects(openVersion(fixture, 4), { name: 'VersionError' });
  assert.deepEqual(fixture.snapshot(), before);
});

test('a final pending v4 transaction commits before v5 workspace migration reads saved text', async () => {
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
  assert.equal(legacy.closed, true); assert.equal(fixture.version, 5);
  assert.ok(fixture.events.indexOf('commit:4') < fixture.events.indexOf('upgrade:4:5'));
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
  assert.equal(fixture.version, 5); assert.deepEqual(fixture.snapshot(), before);
  assert.deepEqual(await loadStore(fixture).store.getSettings(), before[0][1].find(([key]) => key === 'settings')[1].value);
});

test('a cached frontend facing newer storage reports VersionError with upgrade guidance and performs no transaction', async () => {
  const fixture = versionedStorage(6), before = fixture.snapshot();
  const { store } = loadStore(fixture);
  await assert.rejects(store.getSettings(), error => error.name === 'VersionError' && error.code === 'STORAGE_VERSION_OUTDATED'
    && error.cause.name === 'VersionError' && /latest editor/.test(error.message) && /reload this tab/.test(error.message)
    && /saved translations have been kept/.test(error.message));
  assert.deepEqual(fixture.snapshot(), before); assert.equal(fixture.events.length, 0);
});

test('the save worker and page use the same v5 storage version and preserve existing work while saving', async () => {
  const fixture = versionedStorage();
  await loadStore(fixture).store.getSettings();
  const worker = loadStore(fixture, true);
  assert.deepEqual(worker.messages, [{ type: 'ready', version: 1 }]);
  worker.root.onmessage({ data: { type: 'saveTranslations', id: 'worker-save', batch: { jobId: 'worker-save', game: 'poe1',
    language: 'Thai', sourceHash: 'current', files: [{ filepath: 'a.txt', translations: ['Worker translation'] }],
    descriptions: copy(source), revisions: [{ filepath: 'a.txt', lang: 'Thai', savedAt: 2, translations: ['Worker translation'] }] } } });
  for (let attempt = 0; attempt < 10 && !worker.messages.some(message => message.type === 'saved'); attempt++) await queued();
  assert.equal(worker.messages.at(-1).type, 'saved');
  assert.ok(fixture.requests.every(request => request.version === 5));
  assert.deepEqual(fixture.tables.get('kv').get('workspace_poe1').value.staged.Thai['a.txt'].translations, ['Worker translation']);
  assert.deepEqual(fixture.tables.get('revisions_poe2').get(1).translations, ['German history']);
  assert.deepEqual(fixture.tables.get('kv').get('settings').value.dictionary, [{ find: 'one', replace: 'หนึ่ง' }]);
});
