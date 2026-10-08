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
          put(row) { tx.writes = (tx.writes || 0) + 1; pending.push({ store: name, row: structuredClone(row) }); },
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
  for (const file of ['workspaceState.js', 'offlineStore.js', 'helper.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8'), context);
  }
  return { store: context.window.OfflineStore, helpers: context, kv, revisions, transactions };
}
const queued = () => new Promise(resolve => setImmediate(resolve));

test('loading a legacy workspace preserves language-scoped dropped work before pruning persisted flags', async () => {
  const { store, kv, transactions } = fixture();
  kv.set('workspace_poe1', { descs: [{ filepath: 'a.txt', hasChanges: true,
    translations: { English: ['One'], Thai: ['one'], German: ['eins'] } }], status: { 'a.txt': { needsReview: true } } });
  const initial = store.getWorkspace('poe1', 'Thai');
  await queued();
  assert.equal(kv.get('workspace_poe1').languageStatusVersion, undefined, 'Migration waits for a durable commit.');
  transactions[0].complete();
  const loaded = await initial;
  assert.equal(loaded.languageStatusVersion, 1);
  assert.equal(loaded.statusMetadataVersion, 1);
  assert.deepEqual(Array.from(loaded.dropped.Thai['a.txt'].snapshot.translations), ['one']);
  assert.equal(loaded.staged.Thai?.['a.txt'], undefined);
  assert.equal(loaded.descs[0].hasChanges, undefined); assert.equal(loaded.status['a.txt'].needsReview, undefined);
  const reload = store.getWorkspace('poe1', 'German');
  await queued(); transactions[1].complete();
  const german = await reload;
  assert.equal(german.descs[0].languageStatus, undefined);
  assert.equal(german.status['a.txt'].languageStatus, undefined);
  assert.equal(german.dropped.German, undefined);
  assert.deepEqual(Array.from(german.dropped.Thai['a.txt'].snapshot.translations), ['one']);
});

test('modern workspace cleanup commits once and preserves staged work, dropped snapshots and language timestamps', async () => {
  const { store, kv, transactions } = fixture();
  const original = { stagedVersion: 1, sourceHash: 'current',
    descs: [{ filepath: 'a.txt', translations: { English: ['One'], Thai: ['one'], German: ['eins'] },
      hasChanges: true, isMissing: true, languageStatus: { Thai: { hasChanges: true }, German: { isMissing: false } } }],
    status: { 'a.txt': { needsReview: true, trackedForExport: false, deleted: false, lastSourceAt: 5,
      languageStatus: { Thai: { needsReview: true, lastEditedAt: 11 }, German: { needsReview: false, lastExportedAt: 22 } } } },
    staged: { German: { 'a.txt': { translations: ['eins'], beforeTranslations: ['alt'] } } },
    dropped: { Thai: { 'a.txt': { id: 'drop', status: 'dropped', snapshot: { english: ['Old'], translations: ['old one'] } } } },
    droppedArchive: { previous: { status: 'discarded', snapshot: { translations: ['older'] } } } };
  kv.set('workspace_poe1', structuredClone(original));
  const loading = store.getWorkspace('poe1', 'German');
  await queued();
  assert.equal(kv.get('workspace_poe1').descs[0].hasChanges, true, 'Cleanup cannot claim durability before commit.');
  transactions[0].complete();
  const cleaned = await loading;
  assert.equal(cleaned.statusMetadataVersion, 1);
  assert.equal(cleaned.descs[0].hasChanges, undefined); assert.equal(cleaned.descs[0].isMissing, undefined);
  assert.equal(cleaned.descs[0].languageStatus, undefined);
  assert.equal(cleaned.status['a.txt'].needsReview, undefined); assert.equal(cleaned.status['a.txt'].trackedForExport, undefined);
  assert.equal(cleaned.status['a.txt'].deleted, false); assert.equal(cleaned.status['a.txt'].lastSourceAt, 5);
  assert.deepEqual(cleaned.status['a.txt'].languageStatus, { Thai: { lastEditedAt: 11 }, German: { lastExportedAt: 22 } });
  assert.deepEqual(cleaned.staged, original.staged); assert.deepEqual(cleaned.dropped, original.dropped);
  assert.deepEqual(cleaned.droppedArchive, original.droppedArchive);
  const reload = store.getWorkspace('poe1', 'Thai');
  await queued(); assert.equal(transactions[1].writes || 0, 0, 'A settled load does not rewrite the workspace.');
  transactions[1].complete(); assert.deepEqual(await reload, cleaned);
});

test('modern description helpers detach translation arrays and omit derived flags while legacy helpers retain compatibility', () => {
  const { helpers } = fixture();
  const source = { filepath: 'a.txt', translations: { English: ['One'] }, variables: ['#'], remarks: ['remark'], stats: ['stat'] };
  const modern = helpers.makeLocalDesc(source, 'Thai', ['one'], { derivedStatus: true, hasChanges: true, isMissing: true });
  assert.equal(modern.hasChanges, undefined); assert.equal(modern.isMissing, undefined); assert.equal(modern.languageStatus, undefined);
  assert.notEqual(modern.translations.English, source.translations.English); assert.notEqual(modern.variables, source.variables);
  modern.hasChanges = true; modern.needsReview = true;
  modern.languageStatus = { Thai: { hasChanges: true, lastEditedAt: 11 } };
  helpers.updateLocalDesc(modern, source, 'German', ['eins'], { derivedStatus: true, hasChanges: true, isMissing: true });
  assert.equal(modern.hasChanges, undefined); assert.equal(modern.needsReview, undefined); assert.equal(modern.isMissing, undefined);
  assert.equal(modern.languageStatus.Thai.lastEditedAt, 11); assert.equal(modern.languageStatus.Thai.hasChanges, undefined);
  assert.deepEqual(Array.from(modern.translations.Thai), ['one']); assert.deepEqual(Array.from(modern.translations.German), ['eins']);
  const legacy = helpers.makeLocalDesc(source, 'Thai', [''], { hasChanges: true, isMissing: true });
  assert.equal(legacy.hasChanges, true); assert.equal(legacy.languageStatus.Thai.hasChanges, true); assert.equal(legacy.isMissing, true);
});

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

test('wire preparation uses the newest alias from the real atomic workspace transaction', async t => {
  const { Client } = require('../public/collaborationSync.js');
  const P = require('../public/collaborationProtocol.js');
  const f = fixture(), identity = { accountId: 'user', game: 'poe1', sourceHash: 'a'.repeat(64), language: 'Thai' }, key = P.scopeKey(identity);
  const base = P.fileState({ filepath: 'a.txt', translations: [''], revision: 1 });
  const op = { id: 'operation', status: 'pending', origin: 'save', promoteDropped: { id: 'local', revision: 0, targetSourceHash: identity.sourceHash },
    files: [{ base, yours: { ...base, translations: ['reviewed'], trackedForExport: true } }] };
  f.store.setWorkspaceContext({ ...identity, branchId: 'default' });
  const workspaceKey = 'workspace_version_v1:' + JSON.stringify(['user', 'poe1', 'default', identity.sourceHash]);
  f.kv.set(workspaceKey, { descs: [], sourceHash: identity.sourceHash, collaborationAccountId: 'user', stagedVersion: 1, statusMetadataVersion: 1,
    droppedAliases: { local: { id: 'server', fromRevision: 0, revision: 1 } } });
  const state = { version: 1, rooms: { [key]: { identity, outbox: [op], shared: { 'a.txt': base }, local: { 'a.txt': base }, conflicts: [] } } };
  f.kv.set('collaboration_v1', state);
  const client = new Client({ store: f.store, request: async () => ({}), WebSocket: null }); t.after(() => client.destroy());
  client.key = key; client.state = structuredClone(state);
  const prepared = client.prepare('operation', client.epoch);
  await queued(); f.transactions[0].complete();
  f.kv.get(workspaceKey).droppedAliases.local.revision = 3;
  await queued(); assert.equal(f.kv.get('collaboration_v1').rooms[key].outbox[0].wire, undefined);
  f.transactions[1].complete(); await prepared;
  const wire = f.kv.get('collaboration_v1').rooms[key].outbox[0].wire;
  assert.equal(wire.promoteDropped.id, 'server'); assert.equal(wire.promoteDropped.revision, 3);
  assert.equal(wire.promoteDropped.targetSourceHash, identity.sourceHash);
});
