const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ failRevision = false } = {}) {
  const kv = new Map([['workspace_poe1', { descs: ['before'], unrelated: true }], ['source_poe1', ['old source']]]);
  const revisions = []; const transactions = [];
  const db = { transaction(names) {
    const pending = []; let finished = false;
    const tx = {
      objectStore(name) {
        assert.ok(names.includes(name));
        return {
          get(key) {
            const req = {};
            queueMicrotask(() => {
              const written = pending.filter(item => item.store === 'kv' && item.row.key === key).at(-1);
              const value = written ? written.row.value : kv.get(key);
              req.result = value === undefined ? undefined : { key, value: structuredClone(value) };
              req.onsuccess?.();
            });
            return req;
          },
          put(row) { pending.push({ store: name, row: structuredClone(row) }); },
          add(row) { if (failRevision) throw new Error('Cannot store history'); pending.push({ store: name, row: structuredClone(row) }); },
        };
      },
      abort(error) { assert.equal(finished, false); finished = true; this.error = error; queueMicrotask(() => this.onabort?.()); },
      complete() {
        assert.equal(finished, false); finished = true;
        for (const item of pending) if (item.store === 'kv') kv.set(item.row.key, item.row.value); else revisions.push(item.row);
        this.oncomplete?.();
      },
    };
    transactions.push(tx); return tx;
  } };
  const indexedDB = { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req; } };
  const context = vm.createContext({ window: {}, indexedDB, console: { log() {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'offlineStore.js'), 'utf8'), context);
  return { store: context.window.OfflineStore, kv, revisions, transactions };
}
const queued = () => new Promise(resolve => setImmediate(resolve));

test('source import persists source, workspace and recovery revisions in one transaction', async () => {
  const { store, kv, revisions, transactions } = fixture();
  const operation = store.saveSourceWorkspaceWithRevisions(['new source'], { descs: ['new workspace'] }, [{ translations: ['history'] }], 'poe1');
  await queued(); assert.deepEqual(kv.get('source_poe1'), ['old source']);
  assert.deepEqual(kv.get('workspace_poe1').descs, ['before']);
  transactions[0].complete(); await operation;
  assert.deepEqual(kv.get('source_poe1'), ['new source']);
  assert.deepEqual(kv.get('workspace_poe1').descs, ['new workspace']);
  assert.equal(revisions.length, 1);
});

test('a source import history error rolls back source and workspace', async () => {
  const { store, kv } = fixture({ failRevision: true });
  await assert.rejects(store.saveSourceWorkspaceWithRevisions(['new'], {}, [{}], 'poe1'), /Cannot store history/);
  assert.deepEqual(kv.get('source_poe1'), ['old source']);
  assert.deepEqual(kv.get('workspace_poe1').descs, ['before']);
});

test('collaboration data, cursor, local history and workspace projection commit together', async () => {
  const { store, kv, revisions, transactions } = fixture();
  const operation = store.updateCollaborationState(() => ({ cursor: 3, queue: ['operation'] }), {
    version: 'poe1', revisions: [{ translations: ['before'] }],
    projectWorkspace: (workspace, state) => ({ ...workspace, descs: ['new'], cursor: state.cursor }),
  });
  await queued(); assert.equal(kv.get('collaboration_v1'), undefined); assert.equal(revisions.length, 0);
  transactions[0].complete(); const result = await operation;
  assert.equal(result.cursor, 3); assert.equal(kv.get('collaboration_v1').cursor, 3);
  assert.deepEqual(kv.get('workspace_poe1'), { descs: ['new'], unrelated: true, cursor: 3 });
  assert.equal(revisions.length, 1);
});

test('projection sees workspace queued in the same transaction', async () => {
  const { store, kv, transactions } = fixture();
  const operation = store.updateCollaborationState(() => ({ queue: [] }), {
    version: 'poe1', workspace: { descs: ['new draft'], newProperty: 1 },
    projectWorkspace: workspace => ({ ...workspace, remote: true }),
  });
  await queued(); transactions[0].complete(); await operation;
  assert.deepEqual(kv.get('workspace_poe1'), { descs: ['new draft'], newProperty: 1, remote: true });
});

test('projection failures roll back already queued cursor and local history', async () => {
  const { store, kv, revisions } = fixture();
  await assert.rejects(store.updateCollaborationState(() => ({ cursor: 9 }), {
    version: 'poe1', revisions: [{}], projectWorkspace: () => { throw new Error('Cannot project'); },
  }), /Cannot project/);
  assert.equal(kv.get('collaboration_v1'), undefined); assert.equal(revisions.length, 0);
  assert.deepEqual(kv.get('workspace_poe1').descs, ['before']);
});

test('async callbacks cannot silently split a collaboration transaction', async () => {
  const { store, kv } = fixture();
  await assert.rejects(store.updateCollaborationState(async () => ({ cursor: 2 })), /synchronous/);
  assert.equal(kv.get('collaboration_v1'), undefined);
});

test('storage abort rejects rather than claiming a durable save', async () => {
  const { store, kv, transactions } = fixture();
  const operation = store.updateCollaborationState(() => ({ cursor: 5 }), { workspace: { descs: ['after'] }, version: 'poe1' });
  const rejected = assert.rejects(operation, /Quota exceeded/);
  await queued(); transactions[0].abort(new Error('Quota exceeded')); await rejected;
  assert.equal(kv.get('collaboration_v1'), undefined); assert.deepEqual(kv.get('workspace_poe1').descs, ['before']);
});
