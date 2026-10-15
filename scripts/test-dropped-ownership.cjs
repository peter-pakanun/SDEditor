const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../public/workspaceState.js');
const N = require('../public/normalizedStore.js');
const copy = structuredClone;
const currentHash = 'c'.repeat(64), oldHash = 'a'.repeat(64), nextHash = 'd'.repeat(64);
const source = { filepath: 'source/test.txt', name: 'Current name', stats: ['stat'], variables: ['#'], remarks: [''],
  translations: { English: ['Current English'], Thai: ['Current original'] } };
const previous = { ...copy(source), translations: { English: ['Previous English'], Thai: ['Preserved text'] } };
function workspace(origin = 'local', patch = {}) {
  return W.initializeWorkspace({ game: 'poe2', accountId: 'alice', collaborationAccountId: 'alice', branchId: 'default',
    sourceHash: currentHash, workspaceOrigin: origin, descs: [], status: {}, ...copy(patch) },
  { game: 'poe2', sourceHash: currentHash, language: 'Thai', source: [source] });
}
function localDrop(value, patch = {}) {
  return W.dropTranslation(value, previous, 'Thai', { id: 'local-copy', originSourceHash: oldHash,
    targetSourceHash: currentHash, createdAt: 1, ...patch });
}
function shared(patch = {}) {
  return { id: 'dropped_managed', ownership: 'online', game: 'poe2', language: 'Thai', filepath: source.filepath,
    originSourceHash: oldHash, targetSourceHash: currentHash, targetSourceHashes: [currentHash],
    status: 'dropped', revision: 3, createdAt: 2,
    snapshot: { english: ['Previous English'], translations: ['Preserved text'], name: previous.name,
      stats: copy(previous.stats), variables: copy(previous.variables), remarks: copy(previous.remarks) }, ...copy(patch) };
}
const choice = candidate => ({ id: candidate.id, ownership: W.droppedOwnership(candidate), revision: candidate.revision || 0,
  targetSourceHash: currentHash });
const candidates = value => W.droppedCandidatesForFile(value, source.filepath, 'Thai');

test('identical local and online Dropped text retains two owners and independent ancestry', () => {
  const value = workspace('online'), local = localDrop(value), online = shared();
  W.acceptDropped(value, [online], { game: 'poe2', language: 'Thai' });
  assert.deepEqual(candidates(value).map(candidate => candidate.ownership), ['online', 'local']);
  assert.equal(W.droppedForFile(value, source.filepath, 'Thai', 'local').id, local.id);
  assert.equal(W.droppedForFile(value, source.filepath, 'Thai', 'online').id, online.id);
  assert.deepEqual(value.droppedArchive[local.id].snapshot, local.snapshot);
  assert.deepEqual(value.droppedArchive[online.id].targetSourceHashes, [currentHash]);
  assert.deepEqual(value.droppedAliases, {}, 'Matching text cannot alias one owner into the other.');
  assert.deepEqual(value.droppedOutbox, [], 'A local import creates no server candidate upload.');
});

test('discarding either owner leaves the other owner unresolved', async t => {
  for (const ownership of ['local', 'online']) await t.test(ownership, () => {
    const value = workspace('online'), local = localDrop(value), online = shared();
    W.acceptDropped(value, [online]);
    const selected = ownership === 'local' ? local : online;
    W.discardDropped(value, source.filepath, 'Thai', choice(selected));
    assert.equal(candidates(value).length, 1);
    assert.equal(candidates(value)[0].ownership, ownership === 'local' ? 'online' : 'local');
    assert.equal(value.droppedArchive[selected.id].status, 'discarded');
    assert.deepEqual(value.droppedOutbox.map(operation => operation.kind), ownership === 'online' ? ['discard'] : []);
  });
});

test('a reviewed local recovery saves current text without resolving the managed Dropped copy', () => {
  const value = workspace('online'), local = localDrop(value), online = shared();
  W.acceptDropped(value, [online]);
  W.stageTranslation(value, { filepath: source.filepath, translations: ['Reviewed local text'] }, 'Thai',
    { source, sourceHash: currentHash, savedAt: 10, promoteDropped: choice(local) });
  assert.equal(value.droppedArchive[local.id].status, 'promoted');
  assert.equal(W.droppedForFile(value, source.filepath, 'Thai', 'online').id, online.id);
  assert.deepEqual(W.workspaceFile(value, source, 'Thai').translations, ['Reviewed local text']);
  assert.equal(W.workspaceFile(value, source, 'Thai').isDropped, true);
  assert.deepEqual(value.droppedOutbox, []);
});

test('a reviewed managed promotion leaves local recovery and its disposition independent', () => {
  const value = workspace('online'), local = localDrop(value), online = shared();
  W.acceptDropped(value, [online]);
  W.stageTranslation(value, { filepath: source.filepath, translations: ['Reviewed shared text'] }, 'Thai',
    { source, sourceHash: currentHash, promoteDropped: choice(online) });
  const state = W.workspaceFile(value, source, 'Thai');
  assert.equal(state.isDropped, false);
  assert.equal(state.hasLocalRecovery, true);
  assert.equal(W.droppedForFile(value, source.filepath, 'Thai', 'local').id, local.id);
  assert.equal(value.droppedArchive[online.id].status, 'promoted');
  W.acceptDropped(value, [{ ...online, status: 'promoted', revision: 4 }]);
  assert.equal(W.droppedForFile(value, source.filepath, 'Thai', 'local').id, local.id);
});

test('a local-only recovery does not assign managed Dropped workload or suppress Revised', () => {
  const value = workspace('online');
  localDrop(value);
  W.stageTranslation(value, { filepath: source.filepath, translations: ['Current correction'] }, 'Thai', { source });
  const state = W.workspaceFile(value, source, 'Thai');
  assert.equal(state.isDropped, false);
  assert.equal(state.hasLocalRecovery, true);
  assert.equal(state.isRevised, true);
  assert.deepEqual(state.translations, ['Current correction']);
});

test('changing workspace ownership recalculates assignment eligibility without stale caches', () => {
  const value = workspace('local'), local = localDrop(value);
  W.discardDropped(value, source.filepath, 'Thai', choice(local));
  W.stageTranslation(value, { filepath: source.filepath, translations: ['Current correction'] }, 'Thai', { source });
  assert.equal(W.workspaceFile(value, source, 'Thai').isRevised, false);
  value.workspaceOrigin = 'online';
  assert.equal(W.workspaceFile(value, source, 'Thai').isRevised, true,
    'The local assignment must not persist in the cache when opening the managed workspace.');
});

test('same-ID local and online records survive independent resolution and reattachment', () => {
  const value = workspace('online'), local = localDrop(value, { id: 'same-id' }), online = shared({ id: 'same-id' });
  W.acceptDropped(value, [online]);
  assert.equal(candidates(value).length, 2);
  W.discardDropped(value, source.filepath, 'Thai', choice(local));
  assert.equal(candidates(value).length, 1);
  assert.equal(candidates(value)[0].ownership, 'online');
  W.attachLocalDroppedCandidates(value, [local]);
  assert.equal(candidates(value).length, 1, 'Reloading the original local source cannot resurrect its discarded copy.');
  assert.ok(Object.values(value.droppedArchive).some(candidate => candidate.id === local.id && candidate.ownership === 'local'
    && candidate.status === 'discarded'));
});

test('local source advancement never extends online candidate assignments or queues automatic server writes', () => {
  const value = workspace('online'), online = shared();
  W.acceptDropped(value, [online]);
  const frozenOnline = copy(value.droppedArchive[online.id]);
  W.upgradeSource(value, { game: 'poe2', previousSource: [source], source: [{ ...copy(source),
    translations: { English: ['User imported a different successor'], Thai: ['Incoming original'] } }],
  previousSourceHash: currentHash, sourceHash: nextHash });
  assert.deepEqual(value.droppedArchive[online.id], frozenOnline);
  assert.deepEqual(value.droppedOutbox, []);
  const local = candidates(value).find(candidate => candidate.ownership === 'local');
  assert.ok(local);
  assert.notEqual(local.id, online.id);
  assert.deepEqual(local.targetSourceHashes, [nextHash]);
  assert.deepEqual(local.snapshot.translations, online.snapshot.translations);
});

test('separating legacy cross-owner conflicts retains exact recovery evidence without blocking either copy', () => {
  const value = workspace('online'), local = localDrop(value), online = shared({ snapshot: { english: ['Different English'], translations: ['Different target'] } });
  const conflict = { kind: 'upload', game: 'poe2', language: 'Thai', filepath: source.filepath,
    targetSourceHash: currentHash, yours: copy(local), shared: copy(online), originalRequest: { id: 'retry-original', bytes: 'unchanged' } };
  value.droppedConflicts = { Thai: { [source.filepath]: copy(conflict) } };
  const history = [{ id: 41, lang: 'Thai', translations: ['Prior authored text'], actor: 'alice' }];
  value.localHistory = copy(history);
  W.separateDroppedCopies(value);
  assert.equal(value.droppedConflicts.Thai[source.filepath], undefined);
  assert.deepEqual(Object.values(value.droppedConflictArchive), [conflict]);
  assert.equal(candidates(value).length, 2);
  assert.deepEqual(value.localHistory, history);
  const archive = copy(value.droppedConflictArchive);
  W.separateDroppedCopies(value);
  assert.deepEqual(value.droppedConflictArchive, archive, 'Repeated hydration cannot replace the original recovery evidence.');
});

test('reattached local recoveries respect source, game, branch and account guards', () => {
  const local = localDrop(workspace());
  for (const patch of [{ targetSourceHash: nextHash, targetSourceHashes: [nextHash] }, { game: 'poe1' },
    { branchId: 'other' }, { collaborationAccountId: 'bob' }]) {
    const value = workspace('online');
    W.attachLocalDroppedCandidates(value, [{ ...copy(local), ...patch }]);
    assert.deepEqual(candidates(value), []);
  }
});

test('a disposition made in the standalone workspace refreshes an attached local copy without resolving shared work', () => {
  const standalone = workspace(), local = localDrop(standalone), managed = workspace('online'), online = shared();
  W.acceptDropped(managed, [online]);
  W.attachLocalDroppedCandidates(managed, [copy(local)]);
  W.discardDropped(standalone, source.filepath, 'Thai', choice(local));
  W.attachLocalDroppedCandidates(managed, [copy(standalone.droppedArchive[local.id])]);
  assert.equal(W.droppedForFile(managed, source.filepath, 'Thai', 'local'), null);
  assert.equal(W.droppedForFile(managed, source.filepath, 'Thai', 'online').id, online.id);
  assert.equal(managed.droppedArchive[local.id].status, 'discarded');
  W.attachLocalDroppedCandidates(managed, [copy(local)]);
  assert.equal(W.droppedForFile(managed, source.filepath, 'Thai', 'local'), null, 'A stale source view cannot revive the local copy.');
});

test('local source advancement detaches a recovery link from the predecessor baseline while retaining its provenance', async () => {
  const origin = { accountId: 'alice', game: 'poe2', branchId: 'default', sourceHash: currentHash };
  const value = workspace('online'), local = localDrop(workspace()), original = { ...copy(local), localRecoveryScope: origin };
  W.attachLocalDroppedCandidates(value, [original]);
  W.upgradeSource(value, { previousSource: [source], source: [source], previousSourceHash: currentHash,
    sourceHash: nextHash, game: 'poe2' });
  value.workspaceOrigin = 'local';
  const carried = W.droppedForFile(value, source.filepath, 'Thai', 'local');
  assert.equal(carried.localRecoveryScope, undefined);
  assert.deepEqual(carried.localRecoveryOriginScope, origin);
  assert.deepEqual(carried.snapshot, original.snapshot);
  assert.equal(original.localRecoveryScope.sourceHash, currentHash);
  const f = normalizedFixture(), target = { ...f.scope, sourceHash: nextHash };
  const baseline = f.n.row(N.baselineKey(target), source.filepath, source, { order: 0 });
  f.tables.get(N.stores.baseline).set(baseline.key, baseline);
  await f.n.transaction(f.selected, 'readwrite', tx => f.n.writeWorkspace(tx, target, value));
  W.discardDropped(value, source.filepath, 'Thai', { ...choice(carried), targetSourceHash: nextHash });
  await f.n.transaction(f.selected, 'readwrite', tx => f.n.writeWorkspace(tx, target, value, [source.filepath]));
  const restored = await f.n.transaction(f.selected, 'readonly', tx => f.n.readWorkspace(tx, target));
  assert.equal(W.droppedForFile(restored, source.filepath, 'Thai', 'local'), null);
  assert.equal(restored.droppedArchive[carried.id].status, 'discarded');
  assert.deepEqual(restored.droppedArchive[carried.id].localRecoveryOriginScope, origin);
});

test('legacy local migration preserves candidate text without creating an automatic upload', () => {
  const value = workspace(), local = localDrop(value);
  delete value.sourceBaseline;
  value.droppedOutbox = [];
  W.initializeWorkspace(value, { source: [source], game: 'poe2', sourceHash: currentHash });
  assert.equal(W.droppedForFile(value, source.filepath, 'Thai', 'local').id, local.id);
  assert.deepEqual(value.droppedOutbox, []);
});

test('explicit online history recovery retains its stable action ID and retry body', () => {
  const value = workspace('online');
  const candidate = localDrop(value, { id: 'recover-action', recoveryId: 'recover-action', ownership: 'online' });
  assert.equal(candidate.ownership, 'online');
  assert.equal(value.droppedOutbox.length, 1);
  const pending = copy(value.droppedOutbox[0]);
  const retried = localDrop(value, { id: 'recover-action', recoveryId: 'recover-action', ownership: 'online' });
  assert.equal(retried.id, candidate.id);
  assert.equal(value.droppedOutbox.length, 1);
  assert.deepEqual(value.droppedOutbox[0], pending);
});

// A narrow record adapter exercises the real normalized split/materialization
// path; browser fixtures separately cover native IndexedDB transaction behavior.
function normalizedFixture() {
  const tables = new Map([...N.names, 'revisions_poe2'].map(name => [name, new Map()]));
  const request = value => { const result = {}; queueMicrotask(() => { result.result = copy(value); result.onsuccess?.(); }); return result; };
  const db = { objectStoreNames: { contains: name => tables.has(name) }, transaction(names, mode) {
    const before = mode === 'readwrite' ? new Map(names.map(name => [name, new Map([...tables.get(name)].map(([id, row]) => [id, copy(row)]))])) : null;
    let aborted = false;
    const tx = { objectStore(name) {
      assert.ok(names.includes(name));
      const rows = tables.get(name), select = (field, value) => [...rows.values()].filter(row => value === undefined || row[field] === value);
      return { get: id => request(rows.get(id)), put(row) { assert.equal(mode, 'readwrite'); rows.set(row.key, copy(row)); },
        delete(id) { assert.equal(mode, 'readwrite'); rows.delete(id); },
        index(index) { const field = { by_scope: 'scope', by_kind: 'kindScope', by_path: 'pathKey' }[index];
          return { getAll: value => request(select(field, value)), getAllKeys: value => request(select(field, value).map(row => row.key)) }; } };
    }, abort() { aborted = true; for (const [name, rows] of before || []) tables.set(name, rows); tx.onabort?.(); } };
    setImmediate(() => { if (!aborted) tx.oncomplete?.(); }); return tx;
  } };
  const n = N.create({ W, openDb: async () => db, normalizeScope: scope => scope });
  const scope = { accountId: 'alice', game: 'poe2', branchId: 'default', sourceHash: currentHash, language: 'Thai' };
  const baseline = n.row(N.baselineKey(scope), source.filepath, source, { order: 0 });
  tables.get(N.stores.baseline).set(baseline.key, baseline);
  const selected = [N.stores.meta, N.stores.files, N.stores.records, N.stores.baseline, N.stores.assets];
  return { n, scope, tables, selected };
}

test('normalized storage round-trips both lifecycles, legacy conflict archives and authored history', async () => {
  const value = workspace('online'), local = localDrop(value), online = shared();
  value.descs = [copy(source)];
  value.droppedConflicts = { Thai: { [source.filepath]: { kind: 'upload', language: 'Thai', filepath: source.filepath,
    yours: copy(local), shared: copy(online), originalRequest: { mutationId: 'preserved-request', snapshot: copy(local.snapshot) } } } };
  value.localHistory = [{ eventId: 'authored', actor: 'alice', translations: ['Authored history target'] }];
  W.separateDroppedCopies(value);
  const f = normalizedFixture();
  const revision = { id: 41, filepath: source.filepath, lang: 'Thai', sourceHash: currentHash,
    savedAt: 1, translations: ['Durable authored history'], collaborationAccountId: 'alice' };
  const room = { key: 'retained-room', value: { roomId: 'existing-room', sequence: 8, identity: copy(f.scope) } };
  const event = { key: 'retained-event', scope: room.key, value: { eventId: 'authored-event', kind: 'history',
    actor: { id: 'alice', displayName: 'Original editor' }, beforeTranslations: ['Before'], translations: ['After'] } };
  f.tables.get('revisions_poe2').set(revision.id, copy(revision));
  f.tables.get(N.stores.rooms).set(room.key, copy(room));
  f.tables.get(N.stores.roomRecords).set(event.key, copy(event));
  await f.n.transaction(f.selected, 'readwrite', tx => f.n.writeWorkspace(tx, f.scope, value));
  let restored = await f.n.transaction(f.selected, 'readonly', tx => f.n.readWorkspace(tx, f.scope));
  assert.equal(restored.workspaceOrigin, 'online');
  assert.deepEqual(restored.droppedArchive, value.droppedArchive);
  assert.deepEqual(restored.droppedConflictArchive, value.droppedConflictArchive);
  assert.deepEqual(restored.localHistory, value.localHistory);
  W.discardDropped(restored, source.filepath, 'Thai', choice(local));
  await f.n.transaction(f.selected, 'readwrite', tx => f.n.writeWorkspace(tx, f.scope, restored, [source.filepath]));
  restored = await f.n.transaction(f.selected, 'readonly', tx => f.n.readWorkspace(tx, f.scope));
  assert.equal(candidates(restored).length, 1);
  assert.equal(candidates(restored)[0].ownership, 'online');
  assert.deepEqual(restored.droppedConflictArchive, value.droppedConflictArchive);
  assert.deepEqual(restored.localHistory, value.localHistory);
  assert.deepEqual([...f.tables.get('revisions_poe2').values()], [revision]);
  assert.deepEqual([...f.tables.get(N.stores.rooms).values()], [room]);
  assert.deepEqual([...f.tables.get(N.stores.roomRecords).values()], [event]);
});

async function linkedFixture() {
  const f = normalizedFixture(), managedScope = { ...f.scope, versionId: 'managed-version', groupId: 'managed-group' };
  const original = workspace(), local = localDrop(original);
  original.descs = [copy(source)];
  W.stageTranslation(original, { filepath: source.filepath, translations: ['Existing local save'] }, 'Thai', { source, savedAt: 41 });
  const managed = workspace('online', { workspaceGroupId: managedScope.groupId, workspaceVersionId: managedScope.versionId });
  managed.descs = [copy(source)];
  W.attachLocalDroppedCandidates(managed, [{ ...copy(local), localRecoveryScope: copy(f.scope) }]);
  W.acceptDropped(managed, [shared({ groupId: managedScope.groupId, versionId: managedScope.versionId })]);
  const revision = { id: 1, filepath: source.filepath, lang: 'Thai', sourceHash: currentHash, translations: ['Existing local save'], savedAt: 41 };
  const room = { key: 'shared-room', value: { roomId: 'stable-room', sequence: 9 } };
  const event = { key: 'shared-event', scope: room.key, value: { eventId: 'stable-event', actor: { id: 'alice' }, translations: ['Online authored text'] } };
  f.tables.get('revisions_poe2').set(revision.id, copy(revision));
  f.tables.get(N.stores.rooms).set(room.key, copy(room));
  f.tables.get(N.stores.roomRecords).set(event.key, copy(event));
  await f.n.transaction(f.selected, 'readwrite', async tx => {
    await f.n.writeWorkspace(tx, f.scope, original);
    await f.n.writeWorkspace(tx, managedScope, managed);
  });
  const read = scope => f.n.transaction(f.selected, 'readonly', tx => f.n.readWorkspace(tx, scope));
  return { ...f, managedScope, local, original, managed, revision, room, event, read };
}

test('resolving linked local recovery in a managed group resolves its standalone copy atomically and preserves shared work', async t => {
  for (const action of ['discarded', 'promoted']) await t.test(action, async () => {
    const f = await linkedFixture(), managed = await f.read(f.managedScope);
    const online = copy(managed.droppedArchive.dropped_managed);
    if (action === 'discarded') W.discardDropped(managed, source.filepath, 'Thai', choice(f.local));
    else W.stageTranslation(managed, { filepath: source.filepath, translations: ['Reviewed recovery'] }, 'Thai',
      { source, savedAt: 81, promoteDropped: choice(f.local) });
    await f.n.transaction(f.selected, 'readwrite', tx => f.n.writeWorkspace(tx, f.managedScope, managed, [source.filepath]));
    const standalone = await f.read(f.scope), restored = await f.read(f.managedScope);
    assert.equal(standalone.droppedArchive[f.local.id].status, action);
    assert.equal(restored.droppedArchive[f.local.id].status, action);
    assert.equal(W.droppedForFile(standalone, source.filepath, 'Thai', 'local'), null);
    assert.deepEqual(standalone.staged, f.original.staged, 'A linked disposition does not change the source workspace translation.');
    assert.deepEqual(restored.droppedArchive.dropped_managed, online);
    assert.equal(W.droppedForFile(restored, source.filepath, 'Thai', 'online').id, online.id);
    assert.deepEqual([...f.tables.get('revisions_poe2').values()], [f.revision]);
    assert.deepEqual([...f.tables.get(N.stores.rooms).values()], [f.room]);
    assert.deepEqual([...f.tables.get(N.stores.roomRecords).values()], [f.event]);
  });
});

test('linked local disposition rejects changed snapshots and rolls back the managed save with its recovery state', async () => {
  const f = await linkedFixture(), original = await f.read(f.scope), managed = await f.read(f.managedScope);
  localDrop(original, { translations: ['Changed local snapshot after attachment'] });
  await f.n.transaction(f.selected, 'readwrite', tx => f.n.writeWorkspace(tx, f.scope, original, [source.filepath]));
  const before = copy([...f.tables].map(([name, rows]) => [name, [...rows]]));
  W.stageTranslation(managed, { filepath: source.filepath, translations: ['Reviewed stale recovery'] }, 'Thai',
    { source, promoteDropped: choice(f.local) });
  await assert.rejects(f.n.transaction(f.selected, 'readwrite', tx => f.n.writeWorkspace(tx, f.managedScope, managed, [source.filepath])),
    error => error.code === 'DROPPED_PROMOTION_CHANGED' && error.stale === true);
  assert.deepEqual([...f.tables].map(([name, rows]) => [name, [...rows]]), before,
    'The transaction preserves both owners, staged values and history when the linked source changed.');
});

test('a conflicting disposition in the source workspace rejects a stale attached promotion atomically', async () => {
  const f = await linkedFixture(), original = await f.read(f.scope), managed = await f.read(f.managedScope);
  W.discardDropped(original, source.filepath, 'Thai', choice(f.local));
  await f.n.transaction(f.selected, 'readwrite', tx => f.n.writeWorkspace(tx, f.scope, original, [source.filepath]));
  const before = copy([...f.tables].map(([name, rows]) => [name, [...rows]]));
  W.stageTranslation(managed, { filepath: source.filepath, translations: ['Reviewed stale recovery'] }, 'Thai',
    { source, promoteDropped: choice(f.local) });
  await assert.rejects(f.n.transaction(f.selected, 'readwrite', tx => f.n.writeWorkspace(tx, f.managedScope, managed, [source.filepath])),
    error => error.code === 'DROPPED_PROMOTION_CHANGED' && error.stale === true);
  assert.deepEqual([...f.tables].map(([name, rows]) => [name, [...rows]]), before);
});
