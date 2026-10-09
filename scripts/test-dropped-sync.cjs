const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../public/workspaceState.js');
const P = require('../public/collaborationProtocol.js');
const { Client } = require('../public/collaborationSync.js');
const copy = structuredClone;
const hash = 'a'.repeat(64), oldHash = 'b'.repeat(64);
const source = { filepath: 'a.txt', name: 'stat', stats: ['stat'], variables: ['#'], remarks: [''], translations: { English: ['Current English'], Thai: [''] } };

test('unchanged empty Dropped polling performs no persistence or replacement notification', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  let writes = 0, notifications = 0;
  const update = store.updateWorkspace.bind(store);
  store.updateWorkspace = (...args) => { writes++; return update(...args); };
  client.onRemoteDropped = () => { notifications++; };
  await client.syncDropped(client.epoch, { force: true });
  await client.syncDropped(client.epoch, { force: true });
  assert.equal(server.requests.filter(request => request.path.includes('/dropped?')).length, 2);
  assert.equal(writes, 0);
  assert.equal(notifications, 0);
  assert.ok(client.lastDroppedSync > 0);
});
function fixture() {
  const identity = { accountId: 'user', game: 'poe1', language: 'Thai', sourceHash: hash }, key = P.scopeKey(identity);
  const base = P.fileState({ filepath: 'a.txt', translations: [''], revision: 1 });
  const room = { identity, roomId: 'room', local: { 'a.txt': copy(base) }, shared: { 'a.txt': copy(base) }, outbox: [], conflicts: [], recovery: [], sequence: 0 };
  const workspace = W.initializeWorkspace({ sourceHash: hash, collaborationAccountId: 'user', descs: [], status: {} }, { source: [source], game: 'poe1', language: 'Thai' });
  const store = { workspace, state: { version: 1, rooms: { [key]: room } }, revisions: [],
    async getWorkspace() { return copy(this.workspace); },
    async updateWorkspace(fn, game, options = {}) { this.workspace = copy(fn(copy(this.workspace))); this.revisions.push(...copy(options.revisions || [])); return copy(this.workspace); },
    async updateCollaborationState(fn, options = {}) {
      const state = fn(copy(this.state));
      if (options.projectWorkspace) this.workspace = copy(options.projectWorkspace(copy(this.workspace), state));
      this.state = copy(state); this.revisions.push(...copy(options.revisions || [])); return copy(state);
    } };
  const server = { records: [], requests: [], offline: false, file: copy(base), recoveryReceipts: new Map(), recoveryGenerations: 0,
    async request(path, options = {}) {
      this.requests.push({ path, options: copy(options) }); if (this.offline) throw new Error('Offline');
      if (path.includes('/dropped?')) return { candidates: copy(this.records) };
      if (path.endsWith('/dropped') && options.method === 'PUT') {
        const prior = this.records.find(item => item.filepath === options.body.filepath);
        const recoveryId = options.body.recoveryId;
        if (recoveryId && this.recoveryReceipts.has(recoveryId)) return { candidate: copy(this.recoveryReceipts.get(recoveryId)), replayed: true };
        if (recoveryId && prior?.status === 'dropped' && prior.originSourceHash === options.body.originSourceHash
          && P.equal(prior.snapshot, options.body.snapshot)) {
          this.recoveryReceipts.set(recoveryId, prior);
          return { candidate: copy(prior), deduplicated: true };
        }
        if (recoveryId && prior?.status === 'dropped') throw candidateConflict(prior);
        if (!recoveryId && prior?.status === 'dropped' && prior?.originSourceHash === options.body.originSourceHash
          && P.equal(prior.snapshot, options.body.snapshot)) {
          prior.targetSourceHashes = [...new Set([...(prior.targetSourceHashes || []), ...(options.body.targetSourceHashes || [])])];
          return { candidate: copy(prior), deduplicated: true };
        }
        if (!recoveryId && prior?.status !== 'dropped' && prior?.originSourceHash === options.body.originSourceHash
          && P.equal(prior.snapshot, options.body.snapshot)) return { candidate: copy(prior), deduplicated: true };
        const candidate = { ...copy(options.body), id: recoveryId ? 'server-recovery-' + (++this.recoveryGenerations)
          : options.body.filepath === 'a.txt' ? 'server-id' : 'server-' + options.body.filepath,
          revision: (prior?.revision || 0) + 1, status: 'dropped', createdAt: 1 };
        delete candidate.baseRevision;
        if (recoveryId) this.recoveryReceipts.set(recoveryId, candidate);
        this.records = this.records.filter(item => item.filepath !== candidate.filepath).concat(candidate); return { candidate: copy(candidate) };
      }
      if (path.endsWith('/discard')) {
        assert.equal(options.body.revision, this.records[0].revision);
        this.records[0].status = 'discarded'; this.records[0].revision++;
        return { candidate: copy(this.records[0]) };
      }
      if (path.includes('/changes?')) return { events: [], hasMore: false };
      if (path.endsWith('/mutations')) {
        const promotion = options.body.promoteDropped;
        let candidate;
        if (promotion) {
          candidate = this.records.find(item => item.id === promotion.id); assert.ok(candidate);
          assert.equal(promotion.revision, candidate.revision);
          assert.equal(promotion.targetSourceHash, hash); candidate.status = 'promoted'; candidate.revision++;
        }
        const file = options.body.files[0];
        this.file = P.fileState({ ...file, revision: this.file.revision + 1, beforeTranslations: this.file.translations });
        return { files: [copy(this.file)], ...(promotion ? { candidate: copy(candidate) } : {}) };
      }
      throw new Error('Unexpected endpoint: ' + path);
    } };
  const received = [], client = new Client({ store, request: server.request.bind(server), WebSocket: null,
    onRemoteDropped: (records, snapshot) => received.push(copy({ records, snapshot })) });
  client.key = key; client.state = copy(store.state); client.source = [source]; client.sourceFiles = new Map(P.manifest([source]).files.map(file => [file.filepath, file]));
  return { client, store, server, received, identity, key };
}
function drop(store, options = {}) {
  const old = { ...source, translations: { English: ['Old English'], Thai: ['preserved'] } };
  return W.dropTranslation(store.workspace, old, 'Thai', { id: 'local-id', game: 'poe1', originSourceHash: oldHash,
    targetSourceHash: hash, reason: 'English changed', ...options });
}
function addFile(f, filepath) {
  const desc = { ...copy(source), filepath }, file = P.fileState({ filepath, translations: [''], revision: 1 });
  f.client.source.push(desc); f.client.sourceFiles.set(filepath, P.manifest([desc]).files[0]);
  f.store.state.rooms[f.key].local[filepath] = copy(file); f.store.state.rooms[f.key].shared[filepath] = copy(file);
  f.client.state = copy(f.store.state); return desc;
}
const candidateConflict = current => Object.assign(new Error('The dropped copy changed.'), { status: 409, code: 'CANDIDATE_CONFLICT', current: copy(current) });

test('candidate upload and reviewed promotion map temporary IDs before the guarded authored mutation', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const candidate = drop(store);
  await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed'], trackedForExport: true }],
    promoteDropped: { id: candidate.id, revision: 0, targetSourceHash: hash } });
  assert.equal(server.records[0].status, 'promoted'); assert.equal(server.records[0].revision, 2);
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null);
  assert.deepEqual(store.workspace.staged.Thai['a.txt'].translations, ['reviewed']);
  assert.deepEqual(store.workspace.droppedArchive['server-id'].snapshot.english, ['Old English']);
  assert.equal(store.workspace.droppedArchive['server-id'].status, 'promoted');
  assert.equal(store.workspace.droppedOutbox.length, 0); assert.equal(client.room().outbox.length, 0);
  const uploadIndex = server.requests.findIndex(request => request.options.method === 'PUT');
  const mutationIndex = server.requests.findIndex(request => request.path.endsWith('/mutations'));
  assert.ok(uploadIndex >= 0 && uploadIndex < mutationIndex);
});

test('offline promotion keeps both staged text and candidate upload durable until reconnect', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const candidate = drop(store); server.offline = true;
  await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed'], trackedForExport: true }],
    promoteDropped: { id: candidate.id, revision: 0, targetSourceHash: hash }, waitForSync: false });
  await client.retry();
  assert.deepEqual(store.workspace.staged.Thai['a.txt'].translations, ['reviewed']);
  assert.equal(store.workspace.droppedOutbox.length, 1); assert.equal(client.room().outbox.length, 1);
  assert.equal(server.file.translations[0], ''); server.offline = false; client.lastDroppedSync = 0; await client.retry();
  assert.equal(server.file.translations[0], 'reviewed'); assert.equal(server.records[0].status, 'promoted');
  assert.equal(store.workspace.droppedOutbox.length, 0); assert.equal(client.room().outbox.length, 0);
});

test('an unknown legacy origin uploads honest unavailable-source provenance and retains original text', async t => {
  const { client, store, server, received } = fixture(); t.after(() => client.destroy());
  drop(store, { originSourceHash: '', originSourceAvailable: false, reason: 'Older source history is unavailable' });
  await client.syncDropped(client.epoch, { force: true });
  const request = server.requests.find(request => request.options.method === 'PUT');
  assert.equal(request.options.body.originSourceHash, ''); assert.equal(request.options.body.originSourceAvailable, false);
  assert.equal(request.options.body.reason, 'Older source history is unavailable');
  const candidate = W.droppedForFile(store.workspace, 'a.txt', 'Thai');
  assert.equal(candidate.originSourceAvailable, false); assert.equal(candidate.id, 'server-id');
  assert.deepEqual(candidate.snapshot.translations, ['preserved']);
  assert.equal(received.at(-1).snapshot.dropped.Thai['a.txt'].originSourceAvailable, false);
});

test('discard uploads the original candidate before its tombstone and removes its durable retry operation', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const candidate = drop(store);
  await client.discardDropped('a.txt', { id: candidate.id, revision: 0, targetSourceHash: hash });
  assert.equal(server.records[0].status, 'discarded'); assert.equal(server.records[0].revision, 2);
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null); assert.equal(store.workspace.droppedOutbox.length, 0);
  assert.deepEqual(store.workspace.droppedArchive['server-id'].snapshot.translations, ['preserved']);
});

test('candidate recovery uses the independent store and history without adding authored room files or carries', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  await client.registerDroppedCandidate({ game: 'poe1', language: 'Thai', filepath: 'a.txt', originSourceHash: oldHash,
    targetSourceHash: hash, snapshot: { english: ['Older English'], variables: ['#'], remarks: [''], stats: ['stat'], name: 'stat', translations: ['older'] } },
  { revisions: [{ filepath: 'a.txt', lang: 'Thai', translations: ['older'] }] });
  assert.equal(client.room().carries, undefined); assert.equal(client.room().outbox.length, 0);
  assert.equal(server.file.translations[0], ''); assert.equal(store.revisions.length, 1);
  assert.deepEqual(W.droppedForFile(store.workspace, 'a.txt', 'Thai').snapshot.english, ['Older English']);
});

function recoveryCandidate(recoveryId) {
  return { id: recoveryId, recoveryId, game: 'poe1', language: 'Thai', filepath: 'a.txt', originSourceHash: oldHash,
    targetSourceHash: hash, snapshot: { english: ['Older English'], variables: ['#'], remarks: [''], stats: ['stat'],
      name: 'stat', translations: ['Recovered translation'] } };
}

test('explicit same-history recovery creates a new cloud generation after discard or promotion while preserving staged text', async t => {
  for (const decision of ['discard', 'promote']) await t.test(decision, async t => {
    const { client, store, server } = fixture(); t.after(() => client.destroy());
    await client.registerDroppedCandidate(recoveryCandidate('recovery-first-' + decision));
    const first = copy(W.droppedForFile(store.workspace, 'a.txt', 'Thai'));
    assert.ok(first); assert.equal(first.id, 'server-recovery-1');
    if (decision === 'discard') await client.discardDropped('a.txt', { id: first.id, revision: first.revision, targetSourceHash: hash });
    else await client.save({ files: [{ filepath: 'a.txt', translations: ['Reviewed translation'], trackedForExport: true }],
      promoteDropped: { id: first.id, revision: first.revision, targetSourceHash: hash } });
    assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null);
    const staged = copy(store.workspace.staged), file = copy(server.file);
    const authoredMutations = server.requests.filter(request => request.path.endsWith('/mutations')).length;

    await client.registerDroppedCandidate(recoveryCandidate('recovery-second-' + decision));
    const second = W.droppedForFile(store.workspace, 'a.txt', 'Thai');
    assert.ok(second); assert.equal(second.id, 'server-recovery-2'); assert.notEqual(second.id, first.id);
    assert.deepEqual(second.snapshot.translations, ['Recovered translation']);
    assert.equal(store.workspace.droppedArchive[first.id].status, decision === 'discard' ? 'discarded' : 'promoted');
    assert.deepEqual(store.workspace.staged, staged); assert.deepEqual(server.file, file);
    assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, authoredMutations);
    assert.equal(client.room().outbox.length, 0); assert.equal(store.workspace.droppedOutbox.length, 0);
    const recoveryUploads = server.requests.filter(request => request.options.method === 'PUT');
    assert.deepEqual(recoveryUploads.map(request => request.options.body.recoveryId), ['recovery-first-' + decision, 'recovery-second-' + decision]);
    assert.equal(server.recoveryGenerations, 2);
  });
});

test('an interrupted explicit recovery upload retries the same durable recovery ID without creating another generation', async t => {
  for (const interruption of ['offline', 'lost acknowledgement']) await t.test(interruption, async t => {
    const { client, store, server } = fixture(); t.after(() => client.destroy());
    const original = server.request.bind(server); let interrupted = false;
    if (interruption === 'offline') server.offline = true;
    else client.request = async (path, options) => {
      const result = await original(path, options);
      if (options.method === 'PUT' && !interrupted) { interrupted = true; throw new Error('Lost recovery acknowledgement'); }
      return result;
    };
    const recoveryId = 'stable-recovery-' + interruption.replaceAll(' ', '-');
    const pending = await client.registerDroppedCandidate(recoveryCandidate(recoveryId));
    assert.equal(pending.status, 'pending'); assert.equal(store.workspace.droppedOutbox.length, 1);
    assert.equal(store.workspace.droppedOutbox[0].candidate.recoveryId, recoveryId);
    const reloaded = copy(store.workspace);
    assert.equal(W.droppedForFile(reloaded, 'a.txt', 'Thai').recoveryId, recoveryId);
    server.offline = false; client.lastDroppedSync = 0; await client.retry();
    assert.equal(server.recoveryGenerations, 1); assert.equal(server.recoveryReceipts.size, 1);
    assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai').id, 'server-recovery-1');
    assert.equal(store.workspace.droppedOutbox.length, 0); assert.equal(client.room().outbox.length, 0);
    const uploads = server.requests.filter(request => request.options.method === 'PUT');
    assert.equal(uploads.length, 2); assert.ok(uploads.every(request => request.options.body.recoveryId === recoveryId));

    const active = W.droppedForFile(store.workspace, 'a.txt', 'Thai');
    await client.discardDropped('a.txt', { id: active.id, revision: active.revision, targetSourceHash: hash });
    await client.registerDroppedCandidate(recoveryCandidate(recoveryId));
    assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null, 'Replaying a resolved recovery action must not resurrect its snapshot.');
    assert.equal(server.recoveryGenerations, 1);
  });
});

test('explicit recovery of another generation preserves a competing unresolved cloud copy for comparison', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  await client.registerDroppedCandidate(recoveryCandidate('first-unresolved-recovery'));
  const shared = copy(server.records[0]);
  const competing = recoveryCandidate('competing-explicit-recovery');
  competing.snapshot.translations = ['Different recovered translation'];
  await client.registerDroppedCandidate(competing);
  assert.equal(server.recoveryGenerations, 1); assert.deepEqual(server.records[0], shared);
  const conflict = store.workspace.droppedConflicts.Thai['a.txt'];
  assert.equal(conflict.shared.id, shared.id); assert.equal(conflict.yours.recoveryId, 'competing-explicit-recovery');
  assert.deepEqual(conflict.yours.snapshot.translations, ['Different recovered translation']);
  assert.equal(client.room().outbox.length, 0); assert.equal(store.workspace.staged.Thai, undefined);
});

test('an explicit recovery can alias an identical active shared copy and replay after its resolution without resurrection', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  await client.registerDroppedCandidate(recoveryCandidate('existing-active-action'));
  const first = copy(W.droppedForFile(store.workspace, 'a.txt', 'Thai'));
  await client.registerDroppedCandidate(recoveryCandidate('same-content-action'));
  assert.equal(server.recoveryGenerations, 1); assert.equal(server.recoveryReceipts.size, 2);
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai').id, first.id);
  assert.equal(store.workspace.droppedAliases['same-content-action'].id, first.id);
  const active = W.droppedForFile(store.workspace, 'a.txt', 'Thai');
  await client.discardDropped('a.txt', { id: active.id, revision: active.revision, targetSourceHash: hash });
  await client.registerDroppedCandidate(recoveryCandidate('same-content-action'));
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null);
  assert.equal(server.recoveryGenerations, 1); assert.equal(store.workspace.droppedArchive[first.id].status, 'discarded');
  assert.equal(store.workspace.droppedOutbox.length, 0);
});

test('automatic provenance upload of a peer recovery uses ordinary dedup when the peer resolves before the PUT', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const peer = { ...recoveryCandidate('peer-explicit-action'), id: 'peer-server-copy', targetSourceHash: oldHash,
    targetSourceHashes: [oldHash], revision: 4, status: 'dropped', createdAt: 1 };
  store.workspace.sourceHash = oldHash;
  W.acceptDropped(store.workspace, [peer], { game: 'poe1', language: 'Thai' });
  W.upgradeSource(store.workspace, { previousSource: [source], previousSourceHash: oldHash,
    source: [source], sourceHash: hash, game: 'poe1', language: 'Thai' });
  server.records = [copy(peer)];
  const original = server.request.bind(server); let provenanceUpload;
  client.request = async (path, options = {}) => {
    if (path.endsWith('/dropped') && options.method === 'PUT') {
      server.requests.push({ path, options: copy(options) }); provenanceUpload = copy(options.body);
      assert.equal(options.body.recoveryId, undefined, 'A downloaded peer action is not a new explicit recovery by this user.');
      assert.deepEqual(options.body.snapshot, peer.snapshot);
      assert.ok(options.body.targetSourceHashes.includes(hash));
      server.records[0].targetSourceHashes = [...new Set([...server.records[0].targetSourceHashes, ...options.body.targetSourceHashes])];
      return { candidate: copy(server.records[0]), deduplicated: true };
    }
    return original(path, options);
  };
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai').id, peer.id);
  assert.equal(store.workspace.droppedOutbox.length, 1, 'Explicit source advancement queues its established assignment provenance.');
  assert.equal(store.workspace.droppedOutbox[0].candidate.recoveryId, 'peer-explicit-action');
  server.records[0] = { ...server.records[0], revision: 5, status: 'discarded', snapshot: null };
  client.lastDroppedSync = 0; await client.retry();
  assert.ok(provenanceUpload); assert.equal(server.recoveryGenerations, 0);
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null);
  assert.equal(store.workspace.droppedOutbox.length, 0);
  const archived = store.workspace.droppedArchive[peer.id];
  assert.equal(archived.status, 'discarded'); assert.deepEqual(archived.snapshot, peer.snapshot);
  assert.ok(archived.targetSourceHashes.includes(hash));
  assert.equal(server.records[0].snapshot, null);
});

test('reading a dropped copy assigned to another named version does not assign it or upload provenance', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const peer = { ...recoveryCandidate('old-version-action'), id: 'old-version-copy', targetSourceHash: oldHash,
    targetSourceHashes: [oldHash], revision: 4, status: 'dropped', createdAt: 1 };
  server.records = [copy(peer)];
  await client.syncDropped(client.epoch, { force: true });
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null);
  assert.equal(store.workspace.droppedOutbox.length, 0);
  assert.deepEqual(store.workspace.droppedArchive[peer.id].targetSourceHashes, [oldHash]);
  assert.equal(server.requests.some(request => request.options.method === 'PUT'), false);
});

test('a conflicting dropped upload preserves both copies without retry loops or blocking unrelated saves', async t => {
  const f = fixture(), { client, store, server, received } = f; t.after(() => client.destroy()); addFile(f, 'b.txt');
  const yours = drop(store), shared = { ...copy(yours), id: 'shared-id', revision: 2, createdAt: new Date().toISOString(),
    snapshot: { ...copy(yours.snapshot), translations: ['shared old text'] } };
  server.records = [shared]; const original = server.request.bind(server);
  client.request = async (path, options) => {
    if (path.endsWith('/dropped') && options.method === 'PUT') { server.requests.push({ path, options: copy(options) }); throw candidateConflict(shared); }
    return original(path, options);
  };
  const saved = await client.save({ files: [{ filepath: 'b.txt', translations: ['unrelated'], trackedForExport: true }] });
  assert.equal(saved.status, 'synced'); assert.equal(client.room().outbox.length, 0);
  assert.deepEqual(store.workspace.droppedConflicts.Thai['a.txt'].yours.snapshot.translations, ['preserved']);
  assert.deepEqual(store.workspace.droppedConflicts.Thai['a.txt'].shared.snapshot.translations, ['shared old text']);
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai').id, 'local-id');
  assert.ok(received.at(-1).snapshot.droppedConflicts.Thai['a.txt']);
  await client.retry(); assert.equal(server.requests.filter(item => item.options.method === 'PUT').length, 1);
  assert.ok(server.requests.some(item => item.path.includes('/dropped?')));
  const resolved = await client.resolveDroppedConflict('a.txt', 'shared');
  assert.equal(resolved.status, 'resolved'); assert.equal(store.workspace.droppedOutbox.length, 0);
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai').id, 'shared-id');
  assert.equal(Object.keys(client.snapshot().droppedConflicts).length, 0);
});

test('explicit keep-local replaces only the reviewed shared candidate revision', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const yours = drop(store), shared = { ...copy(yours), id: 'shared-id', revision: 2,
    snapshot: { ...copy(yours.snapshot), translations: ['shared old text'] } };
  server.records = [shared]; const original = server.request.bind(server);
  client.request = async (path, options) => {
    if (path.endsWith('/dropped') && options.method === 'PUT' && !options.body.replace) throw candidateConflict(shared);
    return original(path, options);
  };
  await client.retry(); await client.resolveDroppedConflict('a.txt', 'local');
  const replacement = server.requests.find(item => item.options.body?.replace);
  assert.equal(replacement.options.body.baseRevision, 2); assert.deepEqual(replacement.options.body.snapshot.translations, ['preserved']);
  assert.equal(store.workspace.droppedOutbox.length, 0); assert.equal(Object.keys(store.workspace.droppedConflicts.Thai).length, 0);
  assert.deepEqual(W.droppedForFile(store.workspace, 'a.txt', 'Thai').snapshot.translations, ['preserved']);
});

test('a peer changing the shared copy while a conflict is open requires reviewing the new revision', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const yours = drop(store), shared = { ...copy(yours), id: 'shared-id', revision: 2,
    snapshot: { ...copy(yours.snapshot), translations: ['shared old text'] } };
  W.recordDroppedConflict(store.workspace, { kind: 'upload', filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours, shared });
  server.records = [{ ...shared, revision: 3, snapshot: { ...shared.snapshot, translations: ['new shared old text'] } }];
  await assert.rejects(client.resolveDroppedConflict('a.txt', 'local'), error => error.stale);
  assert.equal(store.workspace.droppedConflicts.Thai['a.txt'].shared.revision, 3);
  assert.deepEqual(store.workspace.droppedConflicts.Thai['a.txt'].yours.snapshot.translations, ['preserved']);
  assert.equal(server.requests.filter(item => item.options.method === 'PUT').length, 0);
});

test('promotion conflict retains saved work, lets other files sync, and requires a fresh save after copy resolution', async t => {
  const f = fixture(), { client, store, server } = f; t.after(() => client.destroy()); addFile(f, 'b.txt');
  const yours = drop(store); await client.syncDropped(client.epoch, { force: true });
  const shared = { ...copy(server.records[0]), id: 'replacement', revision: 3, status: 'discarded' };
  server.records = [shared]; const original = server.request.bind(server); let reject = true;
  client.request = async (path, options) => {
    if (path.endsWith('/mutations') && options.body.promoteDropped && reject) { server.requests.push({ path, options: copy(options) }); throw candidateConflict(shared); }
    return original(path, options);
  };
  const promoted = await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed'], trackedForExport: true }],
    promoteDropped: { id: 'server-id', revision: 1, targetSourceHash: hash } });
  assert.equal(promoted.status, 'conflict'); assert.equal(client.room().outbox[0].status, 'candidate_conflict');
  assert.deepEqual(store.workspace.staged.Thai['a.txt'].translations, ['reviewed']);
  assert.equal((await client.save({ files: [{ filepath: 'b.txt', translations: ['other'], trackedForExport: true }] })).status, 'synced');
  const before = server.requests.filter(item => item.path.endsWith('/mutations')).length;
  await client.resolveDroppedConflict('a.txt', 'shared');
  assert.equal(server.requests.filter(item => item.path.endsWith('/mutations')).length, before);
  assert.equal(client.room().outbox[0].status, 'needs_candidate_review'); reject = false;
  const saved = await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed again'], trackedForExport: true }] });
  assert.equal(saved.status, 'synced'); assert.equal(client.room().outbox.length, 0);
  assert.ok(client.room().recovery.some(entry => entry.files[0].translations[0] === 'reviewed'));
});

test('bulk accepted replacements queue one guarded mutation per dropped file and one ordinary batch', async t => {
  const f = fixture(), { client, store, server } = f; t.after(() => client.destroy());
  const b = addFile(f, 'b.txt'); addFile(f, 'c.txt'); const aDrop = drop(store);
  const bDrop = W.dropTranslation(store.workspace, { ...b, translations: { English: ['Old B'], Thai: ['old b'] } }, 'Thai',
    { id: 'local-b', game: 'poe1', originSourceHash: oldHash, targetSourceHash: hash });
  const saved = await client.save({ origin: 'import', files: ['a.txt', 'b.txt', 'c.txt'].map(filepath => ({ filepath, translations: ['accepted ' + filepath], trackedForExport: true })),
    promoteDroppedByPath: { 'a.txt': { id: aDrop.id, revision: 0, targetSourceHash: hash }, 'b.txt': { id: bDrop.id, revision: 0, targetSourceHash: hash } } });
  assert.equal(saved.status, 'synced'); assert.equal(saved.mutationIds.length, 3);
  const requests = server.requests.filter(item => item.path.endsWith('/mutations'));
  assert.equal(requests.length, 3); assert.equal(requests.filter(item => item.options.body.promoteDropped).length, 2);
  assert.ok(requests.every(item => item.options.body.files.length === 1));
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null); assert.equal(W.droppedForFile(store.workspace, 'b.txt', 'Thai'), null);
});

test('history restore forwards the same guarded promotion to the atomic restore endpoint', async t => {
  const { client } = fixture(); t.after(() => client.destroy()); let request;
  client.request = async (path, options) => { request = { path, options }; return {}; };
  const promotion = { id: 'candidate', revision: 4, targetSourceHash: hash };
  await client.sendMutation({ id: 'operation', restore: { eventId: 42, version: 'before' }, wire: { files: [{ baseRevision: 3 }], promoteDropped: promotion } }, client.epoch);
  assert.ok(request.path.endsWith('/history/42/restore')); assert.deepEqual(request.options.body.promoteDropped, promotion);
});

test('identical dropped upload conflicts adopt the shared receipt without staging or losing assignment provenance', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const yours = drop(store, { targetSourceHashes: [hash, 'c'.repeat(64)] });
  const shared = { ...copy(yours), id: 'shared-id', revision: 2, targetSourceHash: oldHash,
    targetSourceHashes: [oldHash], snapshot: Object.fromEntries(Object.entries(yours.snapshot).reverse()) };
  server.records = [shared]; const original = server.request.bind(server);
  let rejected = false;
  client.request = async (path, options) => {
    if (path.endsWith('/dropped') && options.method === 'PUT') {
      server.requests.push({ path, options: copy(options) });
      if (!rejected) { rejected = true; throw candidateConflict(shared); }
      assert.equal(options.body.replace, undefined);
      assert.equal(options.body.recoveryId, undefined);
      server.records[0].targetSourceHashes = copy(options.body.targetSourceHashes);
      return { candidate: copy(server.records[0]), deduplicated: true };
    }
    return original(path, options);
  };
  let followups = 0;
  client.schedule = () => { followups++; };
  await client.retry();
  assert.deepEqual(client.snapshot().droppedReviewPaths, []);
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai').id, shared.id);
  assert.deepEqual(store.workspace.staged, {});
  assert.equal(client.room().outbox.length, 0);
  assert.equal(store.workspace.droppedAliases[yours.id].id, shared.id);
  assert.deepEqual(new Set(store.workspace.droppedArchive[shared.id].targetSourceHashes), new Set([hash, oldHash, 'c'.repeat(64)]));
  assert.ok(followups > 0, 'A newly queued provenance upload schedules its automatic follow-up.');
  client.connected = true; client.socket = { readyState: 1, close() {} };
  await client.sync({ background: true });
  assert.equal(store.workspace.droppedOutbox.length, 0);
  assert.equal(server.records[0].status, 'dropped');
  assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 0);
});

test('persisted identical dropped conflicts reconcile on retry without requesting another recovery generation', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const yours = drop(store, { id: 'recovery-id', recoveryId: 'recovery-id' });
  const shared = { ...copy(yours), id: 'shared-id', recoveryId: 'other-recovery', revision: 2 };
  W.recordDroppedConflict(store.workspace, { kind: 'upload', filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours, shared });
  server.records = [shared];
  await client.retry();
  assert.deepEqual(client.snapshot().droppedReviewPaths, []);
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai').id, shared.id);
  assert.equal(store.workspace.droppedAliases[yours.id].id, shared.id);
  assert.equal(store.workspace.droppedOutbox.length, 0);
  assert.equal(server.requests.filter(request => request.options.method === 'PUT').length, 0);
  const desc = { ...source, translations: { English: ['Old English'], Thai: ['preserved'] } };
  W.discardDropped(store.workspace, 'a.txt', 'Thai', { id: shared.id, revision: shared.revision });
  const replay = W.dropTranslation(store.workspace, desc, 'Thai', { ...copy(yours), recoveryId: yours.recoveryId });
  assert.equal(replay.id, shared.id); assert.equal(replay.status, 'discarded');
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null);
});

test('identical legacy file content consolidates across source histories while preserving both origins', async t => {
  for (const difference of ['archive', 'availability', 'both']) await t.test(difference, async t => {
    const { client, store, server } = fixture(); t.after(() => client.destroy());
    const yours = drop(store, { originSourceAvailable: false, reason: 'Preserved legacy review translation',
      targetSourceHashes: [hash, oldHash], baseline: { original: true }, proof: ['original'], originArchive: { original: true } });
    const originalSnapshot = copy(yours);
    const shared = { ...copy(yours), id: 'shared-id', revision: 2, targetSourceHash: 'c'.repeat(64), targetSourceHashes: ['c'.repeat(64)] };
    delete shared.baseline; delete shared.proof; delete shared.originArchive;
    if (difference !== 'availability') shared.originSourceHash = 'd'.repeat(64);
    if (difference !== 'archive') shared.originSourceAvailable = true;
    assert.equal(W.sameDroppedContent(yours, shared), true);
    assert.equal(W.sameDroppedCopy(yours, shared), false);
    W.recordDroppedConflict(store.workspace, { kind: 'upload', filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours, shared });
    server.records = [shared];
    await client.retry();
    const active = W.droppedForFile(store.workspace, 'a.txt', 'Thai'), preserved = store.workspace.droppedArchive[yours.id];
    assert.deepEqual(client.snapshot().droppedReviewPaths, []);
    assert.equal(active.id, shared.id); assert.equal(active.originSourceHash, shared.originSourceHash);
    assert.equal(active.originSourceAvailable, shared.originSourceAvailable);
    assert.equal(active.baseline, undefined); assert.equal(active.proof, undefined); assert.equal(active.originArchive, undefined);
    assert.equal(preserved.status, 'replaced'); assert.equal(preserved.originSourceHash, originalSnapshot.originSourceHash);
    assert.equal(preserved.originSourceAvailable, false); assert.deepEqual(preserved.snapshot, originalSnapshot.snapshot);
    assert.deepEqual(preserved.baseline, originalSnapshot.baseline);
    assert.equal(store.workspace.droppedAliases[yours.id].requiresReview, true);
    assert.deepEqual(new Set(active.targetSourceHashes), new Set([hash, oldHash, 'c'.repeat(64)]));
    assert.deepEqual(store.workspace.staged, {}); assert.equal(client.room().outbox.length, 0);
    assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 0);
    await client.discardDropped('a.txt', { ...active, targetSourceHash: hash });
    assert.equal(store.workspace.droppedArchive[yours.id].status, 'replaced');
    assert.ok(store.workspace.droppedArchive[yours.id].targetSourceHashes.includes(hash));
  });
});

test('explicit recovery retries across source-history aliases stay attached to their resolved shared generation', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const yours = drop(store, { id: 'legacy-recovery', recoveryId: 'legacy-recovery', originSourceAvailable: false });
  const shared = { ...copy(yours), id: 'shared-id', revision: 2, recoveryId: 'shared-recovery', originSourceHash: 'c'.repeat(64) };
  W.recordDroppedConflict(store.workspace, { kind: 'upload', filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours, shared });
  server.records = [shared]; await client.retry();
  const desc = { ...source, translations: { English: ['Old English'], Thai: ['preserved'] } };
  const replay = () => W.dropTranslation(store.workspace, desc, 'Thai', copy(yours));
  assert.equal(replay().id, shared.id);
  await client.discardDropped('a.txt', { ...shared, targetSourceHash: hash });
  assert.equal(replay().id, shared.id); assert.equal(replay().status, 'discarded');
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null);
  assert.equal(store.workspace.droppedArchive[yours.id].originSourceHash, oldHash);
  assert.equal(store.workspace.droppedArchive[yours.id].recoveryId, yours.recoveryId);
  assert.equal(store.workspace.droppedOutbox.length, 0);
});

test('an original recovery keeps its request identity across successive receipts and a later source-history consolidation', async t => {
  for (const legacyArchive of [false, true]) await t.test('older-deleted-archive:' + legacyArchive, async t => {
    const { client, store, server } = fixture(); t.after(() => client.destroy());
    const recovered = recoveryCandidate('original-recovery');
    recovered.originSourceAvailable = false;
    await client.registerDroppedCandidate(recovered);
    if (legacyArchive) delete store.workspace.droppedArchive[recovered.id];
    const first = copy(W.droppedForFile(store.workspace, 'a.txt', 'Thai'));
    // A prior API receipt can contain preserved English the local legacy copy
    // did not have provenance for, without changing its deduplication fingerprint.
    first.originSourceAvailable = true;
    store.workspace.dropped.Thai['a.txt'] = copy(first); store.workspace.droppedArchive[first.id] = copy(first);
    const shared = { ...copy(first), id: 'latest-shared', revision: 3, originSourceHash: 'c'.repeat(64), recoveryId: 'peer-recovery' };
    W.recordDroppedConflict(store.workspace, { kind: 'upload', filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours: first, shared });
    server.records = [shared]; client.lastDroppedSync = 0; await client.retry();
    const replay = () => client.registerDroppedCandidate(copy(recovered));
    assert.equal((await replay()).candidate.id, shared.id);
    assert.throws(() => W.dropTranslation(store.workspace, source, 'Thai', { ...recovered, originSourceHash: shared.originSourceHash }), /different translation/);
    await client.discardDropped('a.txt', { ...shared, targetSourceHash: hash });
    const uploads = server.requests.filter(request => request.options.method === 'PUT').length;
    const result = await replay();
    assert.equal(result.candidate.id, shared.id); assert.equal(result.candidate.status, 'discarded');
    assert.equal(server.requests.filter(request => request.options.method === 'PUT').length, uploads);
    assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null);
  });
});

test('same-ID exact copies reconcile newer candidate revisions including previously overwritten archives', async t => {
  for (const overwritten of [false, true]) await t.test(String(overwritten), async t => {
    const { client, store, server } = fixture(); t.after(() => client.destroy());
    const yours = drop(store, { id: 'shared-id', revision: 1 });
    const shared = { ...copy(yours), revision: 2 };
    W.recordDroppedConflict(store.workspace, { kind: 'upload', filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours, shared });
    if (overwritten) store.workspace.droppedArchive[shared.id] = copy(shared);
    else assert.equal(store.workspace.droppedArchive[yours.id].revision, 1);
    server.records = [shared]; await client.retry();
    assert.deepEqual(client.snapshot().droppedReviewPaths, []);
    assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai').revision, 2);
    assert.deepEqual(store.workspace.staged, {});
  });
});

test('choosing a same-ID shared resolution preserves its durable receipt even before synchronization', async t => {
  for (const status of ['promoted', 'discarded', 'dropped']) await t.test(status, async t => {
    const { client, store } = fixture(); t.after(() => client.destroy());
    const yours = drop(store, { id: 'same-recovery', recoveryId: 'same-recovery', revision: 1 });
    const shared = { ...copy(yours), revision: 2, status, targetSourceHashes: [oldHash], ...(status !== 'dropped' ? { snapshot: null } : {}) };
    W.recordDroppedConflict(store.workspace, { kind: 'upload', filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours, shared });
    W.resolveDroppedConflict(store.workspace, 'a.txt', 'Thai', 'shared', shared);
    assert.equal(store.workspace.droppedArchive[shared.id].status, status);
    assert.equal(store.workspace.droppedArchive[shared.id].revision, 2);
    assert.deepEqual(store.workspace.droppedArchive[shared.id].snapshot, yours.snapshot);
    assert.deepEqual(new Set(store.workspace.droppedArchive[shared.id].targetSourceHashes), new Set([hash, oldHash]));
    const desc = { ...source, translations: { English: ['Old English'], Thai: ['preserved'] } };
    const replay = W.dropTranslation(store.workspace, desc, 'Thai', copy(yours));
    assert.equal(replay.status, status);
    assert.equal(!!W.droppedForFile(store.workspace, 'a.txt', 'Thai'), status === 'dropped');
  });
});

test('automatic dropped equality checks every exact snapshot field and source scope', async t => {
  const mutations = {
    translation: record => { record.snapshot.translations[0] += ' '; },
    English: record => { record.snapshot.english[0] += ' '; },
    variables: record => { record.snapshot.variables[0] = 'changed'; },
    stats: record => { record.snapshot.stats[0] = 'changed'; },
    remarks: record => { record.snapshot.remarks[0] = 'changed'; },
    name: record => { record.snapshot.name = 'changed'; },
    game: record => { record.game = 'poe2'; },
    language: record => { record.language = 'German'; },
    filepath: record => { record.filepath = 'other.txt'; },
    omitted: record => { delete record.snapshot.remarks; },
    resolved: record => { record.status = 'discarded'; },
  };
  for (const [label, mutate] of Object.entries(mutations)) await t.test(label, async t => {
    const { client, store, server } = fixture(); t.after(() => client.destroy());
    const yours = drop(store), shared = { ...copy(yours), id: 'shared-id', revision: 2 }; mutate(shared);
    W.recordDroppedConflict(store.workspace, { kind: 'upload', filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours, shared });
    server.records = [shared];
    await client.retry();
    assert.deepEqual(client.snapshot().droppedReviewPaths, ['a.txt']);
    assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai').id, yours.id);
    assert.equal(server.requests.filter(request => request.options.method === 'PUT').length, 0);
    assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 0);
  });
});

test('same-ID source history changes and reviewed promotions still require a decision', async t => {
  for (const kind of ['upload', 'promotion']) for (const difference of ['origin', 'availability']) await t.test(kind + ':' + difference, async t => {
    const { client, store, server } = fixture(); t.after(() => client.destroy());
    drop(store); await client.syncDropped(client.epoch, { force: true });
    const yours = copy(store.workspace.droppedArchive['server-id']);
    const shared = { ...copy(yours), id: kind === 'upload' ? yours.id : 'replacement', revision: 3 };
    if (difference === 'origin') shared.originSourceHash = 'c'.repeat(64);
    else shared.originSourceAvailable = false;
    server.records = [shared];
    if (kind === 'upload') {
      W.recordDroppedConflict(store.workspace, { kind, filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours, shared });
      client.lastDroppedSync = 0; await client.retry();
    } else {
      const request = server.request.bind(server);
      client.request = async (path, options) => {
        if (path.endsWith('/mutations')) { server.requests.push({ path, options: copy(options) }); throw candidateConflict(shared); }
        return request(path, options);
      };
      await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed'], trackedForExport: true }],
        promoteDropped: { id: yours.id, revision: yours.revision, targetSourceHash: hash } });
    }
    assert.deepEqual(client.snapshot().droppedReviewPaths, ['a.txt']);
    assert.equal(server.records[0].status, 'dropped');
    assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, kind === 'promotion' ? 1 : 0);
  });
});

test('an alias across source histories cannot silently publish a queued reviewed save', async t => {
  for (const wire of [false, true]) await t.test('prepared:' + wire, async t => {
    const { client, store, server } = fixture(); t.after(() => client.destroy());
    const yours = drop(store), shared = { ...copy(yours), id: 'shared-id', revision: 2, originSourceHash: 'c'.repeat(64) };
    W.recordDroppedConflict(store.workspace, { kind: 'upload', filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours, shared });
    server.records = [shared]; await client.retry();
    const base = copy(client.room().shared['a.txt']);
    const saved = { ...copy(base), translations: ['reviewed'], trackedForExport: true };
    const op = { id: 'old-reviewed-save', origin: 'save', status: 'pending', files: [{ base, yours: saved }],
      promoteDropped: { id: yours.id, revision: yours.revision, targetSourceHash: hash } };
    if (wire) op.wire = { mutationId: op.id, origin: 'save', promoteDropped: copy(op.promoteDropped),
      files: [{ filepath: 'a.txt', baseRevision: base.revision, translations: ['reviewed'], needsReview: false }] };
    store.state.rooms[client.key].outbox.push(op); client.state = copy(store.state);
    await client.retry();
    assert.equal(client.room().outbox[0].status, 'needs_candidate_review');
    assert.deepEqual(client.snapshot().droppedReviewPaths, ['a.txt']);
    assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 0);
  });
});

test('identical active replacement candidates resume an already reviewed promotion with its original file guard', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  drop(store); await client.syncDropped(client.epoch, { force: true });
  const shared = { ...copy(server.records[0]), id: 'replacement', revision: 3 };
  server.records = [shared]; const original = server.request.bind(server);
  client.request = async (path, options) => {
    if (path.endsWith('/mutations') && options.body.promoteDropped?.id === 'server-id') {
      server.requests.push({ path, options: copy(options) }); throw candidateConflict(shared);
    }
    return original(path, options);
  };
  const saved = await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed'], trackedForExport: true }],
    promoteDropped: { id: 'server-id', revision: 1, targetSourceHash: hash } });
  assert.equal(saved.status, 'synced');
  const attempts = server.requests.filter(request => request.path.endsWith('/mutations'));
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every(request => request.options.body.files[0].baseRevision === 1));
  assert.deepEqual(attempts[1].options.body.promoteDropped, { id: shared.id, revision: 3, targetSourceHash: hash });
  assert.equal(server.records[0].status, 'promoted');
  assert.deepEqual(store.workspace.staged.Thai['a.txt'].translations, ['reviewed']);
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null);
  assert.deepEqual(client.snapshot().droppedReviewPaths, []);
});

test('identical candidate reconciliation still requires manual review when the shared translation revision changed', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  drop(store); await client.syncDropped(client.epoch, { force: true });
  const shared = { ...copy(server.records[0]), id: 'replacement', revision: 3 };
  server.records = [shared]; server.file = P.fileState({ filepath: 'a.txt', translations: ['peer saved'], revision: 2 });
  const original = server.request.bind(server);
  client.request = async (path, options) => {
    if (path.endsWith('/mutations')) {
      server.requests.push({ path, options: copy(options) });
      if (options.body.promoteDropped?.id === 'server-id') throw candidateConflict(shared);
      throw Object.assign(new Error('The shared file changed.'), { status: 409, code: 'REVISION_CONFLICT', current: { files: [copy(server.file)] } });
    }
    return original(path, options);
  };
  const saved = await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed'], trackedForExport: true }],
    promoteDropped: { id: 'server-id', revision: 1, targetSourceHash: hash } });
  assert.equal(saved.status, 'conflict');
  assert.equal(client.room().outbox[0].status, 'conflict');
  assert.equal(client.room().conflicts[0].filepath, 'a.txt');
  assert.deepEqual(store.workspace.staged.Thai['a.txt'].translations, ['reviewed']);
  assert.equal(server.records[0].status, 'dropped'); assert.deepEqual(server.file.translations, ['peer saved']);
});

test('a persisted equivalent promotion conflict resumes atomically on retry and retains the reviewed local result', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  drop(store); await client.syncDropped(client.epoch, { force: true });
  const originalCandidate = copy(store.workspace.droppedArchive['server-id']);
  server.offline = true;
  await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed'], trackedForExport: true }],
    promoteDropped: { id: originalCandidate.id, revision: originalCandidate.revision, targetSourceHash: hash } });
  const pending = store.state.rooms[client.key].outbox[0]; pending.status = 'candidate_conflict';
  client.state = copy(store.state);
  const shared = { ...copy(originalCandidate), id: 'replacement', revision: 3 };
  W.recordDroppedConflict(store.workspace, { kind: 'promotion', operationId: pending.id, filepath: 'a.txt', language: 'Thai',
    targetSourceHash: hash, yours: copy(store.workspace.droppedArchive[originalCandidate.id]), shared });
  server.records = [{ ...copy(originalCandidate), status: 'replaced', snapshot: null, revision: shared.revision }, shared];
  server.offline = false; client.lastDroppedSync = 0;
  let atomicResume = false;
  const update = store.updateCollaborationState.bind(store);
  store.updateCollaborationState = async (fn, options) => {
    const state = await update(fn, options);
    if (state.rooms[client.key].outbox[0]?.promoteDropped?.id === shared.id) {
      atomicResume = true;
      assert.equal(store.workspace.droppedConflicts.Thai['a.txt'], undefined);
      assert.equal(store.workspace.droppedArchive[shared.id].status, 'promoted');
      assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null);
      assert.deepEqual(store.workspace.staged.Thai['a.txt'].translations, ['reviewed']);
    }
    return state;
  };
  await client.retry();
  assert.ok(atomicResume); assert.equal(client.room().outbox.length, 0);
  assert.equal(server.records[1].status, 'promoted'); assert.deepEqual(server.file.translations, ['reviewed']);
});

test('successive identical candidate aliases keep the original explicit recovery retry resolved', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const recovered = recoveryCandidate('original-recovery');
  await client.registerDroppedCandidate(recovered);
  const originalCandidate = copy(W.droppedForFile(store.workspace, 'a.txt', 'Thai'));
  const shared = { ...copy(originalCandidate), id: 'replacement', recoveryId: 'peer-recovery', revision: 3 };
  server.records = [shared]; const original = server.request.bind(server);
  client.request = async (path, options) => {
    if (path.endsWith('/mutations') && options.body.promoteDropped?.id === originalCandidate.id) {
      server.requests.push({ path, options: copy(options) }); throw candidateConflict(shared);
    }
    return original(path, options);
  };
  const saved = await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed'], trackedForExport: true }],
    promoteDropped: { id: originalCandidate.id, revision: originalCandidate.revision, targetSourceHash: hash } });
  assert.equal(saved.status, 'synced');
  assert.equal(store.workspace.droppedAliases[recovered.id].id, shared.id);
  const uploads = server.requests.filter(request => request.options.method === 'PUT').length;
  await client.registerDroppedCandidate(recovered);
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai'), null);
  assert.equal(server.requests.filter(request => request.options.method === 'PUT').length, uploads);
  assert.equal(server.records[0].status, 'promoted');
});

test('automatic consolidation cannot bypass a previous manual review decision or a discarded local copy', async t => {
  for (const decision of ['needs_candidate_review', 'discard']) await t.test(decision, async t => {
    const { client, store, server } = fixture(); t.after(() => client.destroy());
    drop(store); await client.syncDropped(client.epoch, { force: true });
    const originalCandidate = copy(store.workspace.droppedArchive['server-id']);
    server.offline = true;
    if (decision === 'discard') W.discardDropped(store.workspace, 'a.txt', 'Thai', { id: originalCandidate.id, revision: originalCandidate.revision });
    else await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed'], trackedForExport: true }],
      promoteDropped: { id: originalCandidate.id, revision: originalCandidate.revision, targetSourceHash: hash } });
    const pending = store.state.rooms[client.key].outbox[0];
    if (pending) pending.status = decision;
    client.state = copy(store.state);
    const shared = { ...copy(originalCandidate), id: 'replacement', revision: 3 };
    W.recordDroppedConflict(store.workspace, { kind: decision === 'discard' ? 'discard' : 'promotion', operationId: pending?.id,
      filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours: copy(store.workspace.droppedArchive[originalCandidate.id]), shared });
    server.records = [shared]; server.offline = false; client.lastDroppedSync = 0;
    await client.retry();
    assert.deepEqual(client.snapshot().droppedReviewPaths, ['a.txt']);
    assert.equal(server.records[0].status, 'dropped');
    assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 0);
  });
});

test('failed atomic duplicate consolidation preserves the recoverable conflict and queued reviewed promotion', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  drop(store); await client.syncDropped(client.epoch, { force: true });
  const originalCandidate = copy(store.workspace.droppedArchive['server-id']);
  server.offline = true;
  await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed'], trackedForExport: true }],
    promoteDropped: { id: originalCandidate.id, revision: originalCandidate.revision, targetSourceHash: hash } });
  const pending = store.state.rooms[client.key].outbox[0]; pending.status = 'candidate_conflict'; client.state = copy(store.state);
  const shared = { ...copy(originalCandidate), id: 'replacement', revision: 3 };
  W.recordDroppedConflict(store.workspace, { kind: 'promotion', operationId: pending.id, filepath: 'a.txt', language: 'Thai',
    targetSourceHash: hash, yours: copy(store.workspace.droppedArchive[originalCandidate.id]), shared });
  server.records = [shared]; server.offline = false; client.lastDroppedSync = 0;
  const before = copy({ workspace: store.workspace, state: store.state });
  const update = store.updateCollaborationState.bind(store);
  store.updateCollaborationState = async (fn, options = {}) => {
    if (options.projectWorkspace) {
      const state = fn(copy(store.state)), workspace = options.projectWorkspace(copy(store.workspace), state);
      assert.equal(workspace.droppedConflicts.Thai['a.txt'], undefined);
      assert.equal(state.rooms[client.key].outbox[0].promoteDropped.id, shared.id);
      throw new Error('Durable write failed');
    }
    return update(fn, options);
  };
  await client.retry();
  assert.match(client.lastError.message, /Durable write failed/);
  assert.deepEqual(store.workspace, before.workspace); assert.deepEqual(store.state, before.state);
  assert.equal(server.records[0].status, 'dropped');
  assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 0);
});

test('a late candidate conflict response cannot overwrite another tab\'s manual review or fresh save', async t => {
  for (const decision of ['needs_candidate_review', 'conflict', 'replaced']) await t.test(decision, async t => {
    const { client, store, server } = fixture(); t.after(() => client.destroy());
    drop(store); await client.syncDropped(client.epoch, { force: true });
    const shared = { ...copy(server.records[0]), id: 'replacement', revision: 3 };
    server.records = [shared]; const original = server.request.bind(server);
    client.request = async (path, options) => {
      if (path.endsWith('/mutations')) {
        server.requests.push({ path, options: copy(options) });
        const room = store.state.rooms[client.key];
        if (decision === 'replaced') room.outbox = [];
        else room.outbox[0].status = decision;
        throw candidateConflict(shared);
      }
      return original(path, options);
    };
    await client.save({ files: [{ filepath: 'a.txt', translations: ['reviewed'], trackedForExport: true }],
      promoteDropped: { id: 'server-id', revision: 1, targetSourceHash: hash } });
    assert.equal(client.room().outbox[0]?.status, decision === 'replaced' ? undefined : decision);
    assert.equal(store.workspace.droppedConflicts.Thai?.['a.txt'], undefined);
    assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 1);
    assert.equal(server.records[0].status, 'dropped');
  });
});

test('manual dropped review selects the active candidate over a same-revision replaced tombstone', async t => {
  const { client, store, server } = fixture(); t.after(() => client.destroy());
  const yours = drop(store), shared = { ...copy(yours), id: 'shared-id', revision: 3,
    snapshot: { ...copy(yours.snapshot), translations: ['different shared copy'] } };
  W.recordDroppedConflict(store.workspace, { kind: 'upload', filepath: 'a.txt', language: 'Thai', targetSourceHash: hash, yours, shared });
  server.records = [{ ...copy(yours), status: 'replaced', snapshot: null, revision: shared.revision }, shared];
  assert.equal((await client.resolveDroppedConflict('a.txt', 'shared')).status, 'resolved');
  assert.equal(W.droppedForFile(store.workspace, 'a.txt', 'Thai').id, shared.id);
});
