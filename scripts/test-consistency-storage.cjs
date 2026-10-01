const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A controlled transaction fixture: writes are staged until completion and
// discarded on abort. Tests exercise the real OfflineStore adapter's boundary.
function loadStore({ throwOnRevision = false, unavailable = false } = {}) {
  const transactions = [];
  const data = {
    kv: new Map([['settings', { lang: 'Thai' }], ['workspace_poe1', { descs: ['before'] }]]),
    revisions_poe1: [],
    revisions_poe2: [],
  };
  const db = {
    transaction(names, mode) {
      const pending = [];
      let finished = false;
      const tx = {
        names: [...names], mode,
        objectStore(name) {
          assert.ok(names.includes(name), 'only stores in this transaction are accessible');
          return {
            get(key) {
              const request = {};
              queueMicrotask(() => {
                if (finished) return;
                // Reads in a transaction see its staged writes before the
                // previously committed value, just like IndexedDB.
                const staged = pending.filter(item => item.name === name
                  && (name === 'kv' ? item.value.key : item.value.id) === key).at(-1);
                let value;
                if (staged) value = staged.value;
                else if (name === 'kv') {
                  if (data.kv.has(key)) value = { key, value: data.kv.get(key) };
                } else value = data[name].find(row => row.id === key);
                request.result = structuredClone(value);
                request.onsuccess?.();
              });
              return request;
            },
            put(row) { pending.push({ name, value: structuredClone(row) }); },
            add(row) {
              if (throwOnRevision) throw new Error('Cannot clone revision');
              pending.push({ name, value: structuredClone(row) });
            },
          };
        },
        complete() {
          assert.equal(finished, false);
          finished = true;
          for (const { name, value } of pending) {
            if (name === 'kv') data.kv.set(value.key, value.value);
            else data[name].push({ ...value, id: data[name].length + 1 });
          }
          this.oncomplete?.();
        },
        abort(error) {
          assert.equal(finished, false);
          finished = true;
          this.error = error || null;
          queueMicrotask(() => this.onabort?.());
        },
      };
      transactions.push(tx);
      return tx;
    },
  };
  const indexedDB = unavailable ? undefined : {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  };
  const context = vm.createContext({ window: {}, indexedDB, console: { log() {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'offlineStore.js'), 'utf8'), context);
  return { store: context.window.OfflineStore, transactions, data };
}

const queued = () => new Promise(resolve => setImmediate(resolve));
const revisions = [
  { filepath: 'test.txt', lang: 'Thai', savedAt: 1, note: 'Before consistency resolution', translations: ['old'] },
  { filepath: 'test.txt', lang: 'Thai', savedAt: 2, note: 'Resolve inconsistent translations', translations: ['new'] },
];

test('workspace and recovery revisions become visible together only after transaction completion', async () => {
  const { store, transactions, data } = loadStore();
  const workspace = { descs: ['after'] };
  let resolved = false;
  const save = store.saveWorkspaceWithRevisions(workspace, revisions, 'poe1').then(() => { resolved = true; });
  await queued();
  assert.equal(resolved, false);
  assert.equal(transactions.length, 1);
  assert.deepEqual(transactions[0].names, ['kv', 'revisions_poe1']);
  assert.equal(transactions[0].mode, 'readwrite');
  assert.deepEqual(data.kv.get('workspace_poe1'), { descs: ['before'] });
  assert.equal(data.revisions_poe1.length, 0);
  transactions[0].complete();
  await save;
  assert.equal(resolved, true);
  assert.deepEqual(data.kv.get('workspace_poe1'), workspace);
  assert.deepEqual(data.revisions_poe1.map(({ id, ...revision }) => revision), revisions);
  assert.deepEqual(data.kv.get('settings'), { lang: 'Thai' });
});

test('an asynchronous transaction abort rejects without publishing workspace or history', async () => {
  const { store, transactions, data } = loadStore();
  const save = store.saveWorkspaceWithRevisions({ descs: ['after'] }, revisions, 'poe1');
  const rejected = assert.rejects(save, /Storage quota exceeded/);
  await queued();
  transactions[0].abort(new Error('Storage quota exceeded'));
  await rejected;
  assert.deepEqual(data.kv.get('workspace_poe1'), { descs: ['before'] });
  assert.equal(data.revisions_poe1.length, 0);
});

test('a synchronous revision write failure aborts the already queued workspace write', async () => {
  const { store, data } = loadStore({ throwOnRevision: true });
  await assert.rejects(store.saveWorkspaceWithRevisions({ descs: ['after'] }, revisions, 'poe1'), /Cannot clone revision/);
  assert.deepEqual(data.kv.get('workspace_poe1'), { descs: ['before'] });
  assert.equal(data.revisions_poe1.length, 0);
});

test('version selection uses existing normalization and is captured before opening storage', async () => {
  for (const [version, current, expected] of [['POE2', 'poe1', 'poe2'], ['unknown', 'poe2', 'poe1'], [undefined, 'poe2', 'poe2']]) {
    const { store, transactions, data } = loadStore();
    store.setGameVersion(current);
    const save = store.saveWorkspaceWithRevisions({ descs: ['saved'] }, [], version);
    store.setGameVersion(expected === 'poe2' ? 'poe1' : 'poe2');
    await queued();
    assert.deepEqual(transactions[0].names, ['kv', `revisions_${expected}`]);
    transactions[0].complete();
    await save;
    assert.deepEqual(data.kv.get(`workspace_${expected}`), { descs: ['saved'] });
  }
});

test('unavailable storage and invalid revision batches reject', async () => {
  const { store } = loadStore({ unavailable: true });
  await assert.rejects(store.saveWorkspaceWithRevisions({}, [], 'poe1'), /IndexedDB unavailable/);
  const { store: available, transactions } = loadStore();
  await assert.rejects(available.saveWorkspaceWithRevisions({}, null, 'poe1'), /Revisions must be an array/);
  assert.equal(transactions.length, 0);
});
