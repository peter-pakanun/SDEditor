const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/collaborationProtocol.js');
const W = require('../public/workspaceState.js');
const { Client } = require('../public/collaborationSync.js');
const copy = structuredClone;
const source = [
  { filepath: 'a.txt', name: '', stats: ['a'], variables: ['#', '#'], remarks: ['', ''], translations: { English: ['One', 'Two'], Thai: ['one', 'two'], French: ['un', 'deux'] } },
  { filepath: 'b.txt', name: '', stats: ['b'], variables: ['#'], remarks: [''], translations: { English: ['Three'], Thai: ['three'] } },
];
const initial = source.map(desc => ({ filepath: desc.filepath, translations: [...desc.translations.Thai], needsReview: false, trackedForExport: false }));
function storeFixture(sourceFiles = source) {
  return { state: null, workspace: { descs: copy(sourceFiles), status: {} }, revisions: [], writes: 0, reads: 0,
    async getCollaborationState() { this.reads++; return copy(this.state); },
    async updateCollaborationState(fn, options = {}) {
      const next = fn(copy(this.state));
      let workspace = copy(this.workspace);
      if (options.projectWorkspace) workspace = options.projectWorkspace(workspace, next);
      this.state = copy(next); this.workspace = copy(workspace); this.revisions.push(...copy(options.revisions || [])); this.writes++;
      return copy(this.state);
    },
  };
}
function serverFixture(archive) {
  return { archive, requests: [], files: [], events: [], sequence: 0, receipts: new Map(), offline: false,
    snapshot() { return { mode: 'sparse', roomId: 'sparse', archive: copy(this.archive), sequence: this.sequence, files: copy(this.files) }; },
    change(filepath, translations) {
      const previous = this.files.find(file => file.filepath === filepath);
      const next = P.fileState({ filepath, translations, trackedForExport: true, revision: (previous?.revision || 0) + 1 });
      this.files = this.files.filter(file => file.filepath !== filepath).concat(next);
      this.events.push({ sequence: ++this.sequence, files: [copy(next)] });
    },
    async request(path, options = {}) {
      this.requests.push({ path, options: copy(options) });
      if (this.offline) throw new Error('Offline');
      const body = options.body;
      if (path.endsWith('/archives/resolve')) return { archive: copy(this.archive) };
      if (path.endsWith('/join') || path.endsWith('/snapshot')) return this.snapshot();
      if (path.includes('/changes?')) return { events: copy(this.events.filter(event => event.sequence > Number(path.split('after=')[1]))), hasMore: false };
      if (path.includes('/history?')) return { items: [], nextCursor: null };
      if (path.endsWith('/placeholder-repairs')) {
        if (this.repairGate) await this.repairGate;
        if (this.failRepairs) { this.failRepairs--; throw new Error('Repair connection interrupted'); }
        if (this.receipts.has(body.mutationId)) return copy(this.receipts.get(body.mutationId));
        const files = [];
        for (const file of body.files) {
          assert.ok(await P.verifyBaselineProof(file.baseline, file.proof, this.archive.treeRoot, this.archive.descriptionCount));
          const current = this.files.find(row => row.filepath === file.filepath);
          if (!current || current.revision !== file.baseRevision || current.revision !== 1 || !current.trackedForExport
            || current.translations.some(text => text !== '') || current.needsReview) {
            throw Object.assign(new Error('Repair changed'), { status: 409, code: 'PLACEHOLDER_REPAIR_CONFLICT' });
          }
          files.push(P.fileState({ ...current, trackedForExport: false, stagingReset: true, revision: 2 }));
        }
        for (const file of files) this.files = this.files.filter(row => row.filepath !== file.filepath).concat(copy(file));
        const result = { roomId: 'sparse', sequence: ++this.sequence, files };
        this.events.push(copy(result)); this.receipts.set(body.mutationId, result);
        if (this.loseRepairReply) { this.loseRepairReply--; throw new Error('Repair reply was lost'); }
        return copy(result);
      }
      if (path.endsWith('/staged-deletions')) {
        if (this.receipts.has(body.mutationId)) return copy(this.receipts.get(body.mutationId));
        if (this.raceDeletion) { this.raceDeletion = false; this.change(body.files[0].filepath, ['raced peer edit', 'two']); }
        if (body.files.some(file => file.baseRevision !== (this.files.find(row => row.filepath === file.filepath)?.revision || 0))) {
          throw Object.assign(new Error('Delete conflict'), { status: 409, code: 'REVISION_CONFLICT', current: this.snapshot() });
        }
        const files = [];
        for (const file of body.files) {
          assert.ok(await P.verifyBaselineProof(file.baseline, file.proof, this.archive.treeRoot, this.archive.descriptionCount));
          const translations = [...(file.baseline.translations.Thai || [])];
          while (translations.length < file.baseline.translations.English.length) translations.push('');
          assert.deepEqual(file.translations, translations);
          files.push(P.fileState({ filepath: file.filepath, translations, trackedForExport: false, stagingReset: true, revision: file.baseRevision + 1 }));
        }
        for (const file of files) this.files = this.files.filter(row => row.filepath !== file.filepath).concat(copy(file));
        const result = { roomId: 'sparse', sequence: ++this.sequence, files };
        this.events.push(copy(result)); this.receipts.set(body.mutationId, result);
        if (this.loseDeletionReply) { this.loseDeletionReply--; throw new Error('Delete reply was lost'); }
        return copy(result);
      }
      if (path.endsWith('/mutations')) {
        if (this.failMutations) { this.failMutations--; throw new Error('Mutation connection interrupted'); }
        if (this.receipts.has(body.mutationId)) return { ...copy(this.receipts.get(body.mutationId)),
          files: body.files.map(file => copy(this.files.find(row => row.filepath === file.filepath))) };
        if (body.files.some(file => file.baseRevision !== (this.files.find(row => row.filepath === file.filepath)?.revision || 0))) throw Object.assign(new Error('Conflict'), { status: 409, current: this.snapshot() });
        for (const file of body.files) if (!file.baseRevision) {
          assert.ok(await P.verifyBaselineProof(file.baseline, file.proof, this.archive.treeRoot, this.archive.descriptionCount));
        }
        const files = body.files.map(file => P.fileState({ ...file, revision: file.baseRevision + 1 }));
        for (const file of files) this.files = this.files.filter(row => row.filepath !== file.filepath).concat(copy(file));
        const result = { roomId: 'sparse', sequence: ++this.sequence, files };
        this.events.push(copy(result)); this.receipts.set(body.mutationId, result);
        if (this.loseMutationReply) { this.loseMutationReply--; throw new Error('Mutation reply was lost'); }
        return copy(result);
      }
      throw new Error('Unexpected sparse endpoint: ' + path);
    },
  };
}
let id = 0;
async function fixture(options = {}) {
  const baselineSource = options.source || source;
  const tree = await P.buildBaselineTree(baselineSource);
  const archive = await P.finalizeArchive({ version: 1, zipHash: await P.zipHash(new Uint8Array([1, 2, 3])), zipSize: 3,
    fileCount: baselineSource.length, descriptionCount: baselineSource.length, parserVersion: 1, decisions: [], treeRoot: tree.root });
  const store = options.store || storeFixture(baselineSource), server = options.server || serverFixture(archive), remote = [];
  const client = new Client({ store, request: server.request.bind(server), WebSocket: null, uuid: () => 'sparse-' + ++id,
    onRemote: files => { options.onRemote?.(files, store); remote.push(copy(files)); } });
  const baselineInitial = options.files || (options.source ? baselineSource.map(desc => P.fileState({ filepath: desc.filepath,
    translations: desc.translations.Thai || [], needsReview: false, trackedForExport: false }, desc.translations.English.length)) : initial);
  const connection = { accountId: options.accountId || 'user', game: 'poe1', language: 'Thai', source: baselineSource, files: baselineInitial,
    workspace: store.workspace, archive, baselineSource, baselineTree: tree };
  await options.beforeConnect?.({ client, store, server, remote, connection, archive, tree });
  await client.connect(connection);
  return { client, store, server, remote, connection, archive, tree };
}
async function queueDeletion(value, filepath = 'a.txt') {
  const { client } = value, base = client.fileBase(filepath), original = client.baselineFiles.get(filepath);
  const translations = [...(original.translations.Thai || [])];
  while (translations.length < original.translations.English.length) translations.push('');
  const yours = P.fileState({ filepath, translations, trackedForExport: false, stagingReset: true, revision: base?.revision || 0 });
  const id = 'delete-' + ++idSequence;
  await client.update((state, room) => {
    room.outbox.push({ id, origin: 'delete_staged', resetStaging: true, status: 'pending', files: [{ base: copy(base), yours: copy(yours) }] });
    room.local[filepath] = copy(yours);
  }, { projectWorkspace: client.projection([yours], client.epoch) });
  return id;
}
let idSequence = 0;

test('explicit staged deletion queues a verified reset, propagates to peers and keeps other languages staged', async t => {
  const value = await fixture(), { client, store, server } = value; t.after(() => client.destroy());
  await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['authored edit', 'two'], trackedForExport: true }] });
  const peerStore = storeFixture(), peer = await fixture({ server, store: peerStore, accountId: 'peer' }); t.after(() => peer.client.destroy());
  W.stageTranslation(store.workspace, { filepath: 'a.txt', translations: ['French edit', 'deux'] }, 'French');
  const deletionId = await queueDeletion(value);
  assert.equal(store.workspace.staged.Thai['a.txt'], undefined);
  await client.retry(); await peer.client.retry();
  const request = server.requests.find(request => request.path.endsWith('/staged-deletions'));
  assert.equal(request.options.body.mutationId, deletionId); assert.equal(request.options.body.files[0].baseRevision, 1);
  assert.deepEqual(request.options.body.files[0].translations, ['one', 'two']);
  assert.equal(request.options.body.files[0].trackedForExport, undefined);
  assert.equal(server.files[0].trackedForExport, false); assert.equal(server.files[0].stagingReset, true);
  assert.equal(store.workspace.staged.Thai['a.txt'], undefined); assert.equal(peerStore.workspace.staged.Thai['a.txt'], undefined);
  assert.deepEqual(store.workspace.staged.French['a.txt'].translations, ['French edit', 'deux']);
  assert.deepEqual(client.fileBase('a.txt').translations, ['one', 'two']);
  assert.deepEqual(peer.client.fileBase('a.txt').translations, ['one', 'two']);
});

test('staged deletion conflicts on any concurrent change and choosing shared cancels the deletion', async t => {
  const value = await fixture(), { client, store, server } = value; t.after(() => client.destroy());
  await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['local', 'two'], trackedForExport: true }] });
  await queueDeletion(value);
  server.change('a.txt', ['local', 'peer second entry']);
  await client.retry();
  const conflict = client.snapshot().conflicts[0];
  assert.equal(conflict.kind, 'delete_staged'); assert.deepEqual(conflict.yours.translations, ['one', 'two']);
  assert.deepEqual(conflict.metadata, ['trackedForExport']);
  assert.equal(server.requests.filter(request => request.path.endsWith('/staged-deletions')).length, 0);
  assert.equal((await client.resolve(conflict.id, conflict.shared, { sharedRevision: conflict.shared.revision })).status, 'synced');
  assert.deepEqual(client.fileBase('a.txt').translations, ['local', 'peer second entry']);
  assert.equal(store.workspace.staged.Thai['a.txt'].translations[1], 'peer second entry');
  assert.equal(server.requests.filter(request => request.path.endsWith('/staged-deletions')).length, 0);
});

test('fresh deletion approval removes the entire staged file after a CAS race without partially merging peer text', async t => {
  const value = await fixture(), { client, store, server } = value; t.after(() => client.destroy());
  await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['local', 'two'], trackedForExport: true }] });
  await queueDeletion(value); server.raceDeletion = true;
  await client.retry();
  const conflict = client.snapshot().conflicts[0];
  assert.equal(conflict.kind, 'delete_staged'); assert.equal(conflict.shared.translations[0], 'raced peer edit');
  assert.deepEqual(conflict.yours.translations, ['one', 'two']);
  assert.equal((await client.resolve(conflict.id, conflict.yours, { sharedRevision: conflict.shared.revision })).status, 'synced');
  const requests = server.requests.filter(request => request.path.endsWith('/staged-deletions'));
  assert.equal(requests.length, 2); assert.equal(requests[1].options.body.files[0].baseRevision, conflict.shared.revision);
  assert.deepEqual(server.files[0].translations, ['one', 'two']); assert.equal(server.files[0].trackedForExport, false);
  assert.equal(store.workspace.staged.Thai['a.txt'], undefined);
});

test('lost deletion replies retry the original mutation and retain the durable reset', async t => {
  const value = await fixture(), { client, store, server } = value; t.after(() => client.destroy());
  await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['local', 'two'], trackedForExport: true }] });
  const deletionId = await queueDeletion(value); server.loseDeletionReply = 1;
  await client.retry(); assert.equal(client.snapshot().pending, 1);
  assert.equal(store.workspace.staged.Thai['a.txt'], undefined);
  await client.retry(); assert.equal(client.snapshot().pending, 0);
  const requests = server.requests.filter(request => request.path.endsWith('/staged-deletions'));
  assert.deepEqual(requests.map(request => request.options.body.mutationId), [deletionId, deletionId]);
  assert.deepEqual(requests[0].options.body, requests[1].options.body);
  assert.equal(server.sequence, 2); assert.equal(server.events.length, 2);
});

test('deletion queued behind a known local save follows that save without a false conflict', async t => {
  const value = await fixture(), { client, store, server } = value; t.after(() => client.destroy());
  server.offline = true;
  await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['offline edit', 'two'], trackedForExport: true }], waitForSync: false });
  await queueDeletion(value); server.offline = false;
  await client.retry();
  assert.equal(client.snapshot().pending, 0); assert.equal(client.snapshot().conflicts.length, 0);
  assert.equal(server.files[0].trackedForExport, false); assert.equal(server.files[0].stagingReset, true);
  assert.deepEqual(server.files[0].translations, ['one', 'two']);
});

test('a replayed predecessor save cannot authorize deletion of a newer matching peer revision', async t => {
  const value = await fixture(), { client, store, server } = value; t.after(() => client.destroy());
  server.offline = true;
  await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['offline edit', 'two'], trackedForExport: true }], waitForSync: false });
  await queueDeletion(value); server.offline = false; server.loseMutationReply = 1;
  await client.retry(); assert.equal(client.snapshot().pending, 2);
  server.change('a.txt', ['new peer work', 'two']); server.change('a.txt', ['offline edit', 'two']);
  await client.retry();
  assert.equal(client.snapshot().pending, 1);
  const conflict = client.snapshot().conflicts[0];
  assert.equal(conflict.kind, 'delete_staged'); assert.equal(conflict.shared.revision, 3);
  assert.equal(server.files[0].trackedForExport, true);
  assert.equal(server.requests.filter(request => request.path.endsWith('/staged-deletions')).length, 0);
});

test('a newer shared revision requires deletion review even when translation text is unchanged', async t => {
  const value = await fixture(), { client, store, server } = value; t.after(() => client.destroy());
  await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['local', 'two'], trackedForExport: true }] });
  await queueDeletion(value); server.change('a.txt', ['local', 'two']);
  await client.retry();
  const conflict = client.snapshot().conflicts[0];
  assert.equal(conflict.kind, 'delete_staged'); assert.deepEqual(conflict.metadata, ['trackedForExport']);
  assert.equal(server.requests.filter(request => request.path.endsWith('/staged-deletions')).length, 0);
});

test('choosing a stale shared copy refreshes the deletion comparison without losing its original target', async t => {
  const value = await fixture(), { client, store, server } = value; t.after(() => client.destroy());
  await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['local', 'two'], trackedForExport: true }] });
  await queueDeletion(value); server.change('a.txt', ['first peer', 'two']); await client.retry();
  const observed = client.snapshot().conflicts[0];
  server.change('a.txt', ['newer peer', 'two']);
  assert.equal((await client.resolve(observed.id, observed.shared, { sharedRevision: observed.shared.revision })).status, 'conflict');
  const current = client.snapshot().conflicts[0];
  assert.deepEqual(current.yours.translations, ['one', 'two']); assert.deepEqual(current.shared.translations, ['newer peer', 'two']);
  assert.equal((await client.resolve(current.id, current.shared, { sharedRevision: current.shared.revision })).status, 'synced');
  assert.deepEqual(client.fileBase('a.txt').translations, ['newer peer', 'two']);
  assert.equal(server.requests.filter(request => request.path.endsWith('/staged-deletions')).length, 0);
});

test('staged deletion preserves extra original ZIP entries across sync and reconnect', async t => {
  const baselineSource = [copy(source[0])]; baselineSource[0].translations.Thai.push('extra original ZIP entry');
  const validStaged = P.fileState({ filepath: 'a.txt', translations: ['authored', 'two'], trackedForExport: true });
  const value = await fixture({ source: baselineSource, files: [validStaged], beforeConnect({ store, archive }) {
    W.initializeWorkspace(store.workspace, { source: baselineSource, sourceHash: archive.baselineId, game: 'poe1', language: 'Thai' });
    W.stageTranslation(store.workspace, validStaged, 'Thai');
  } }), { client, store, server } = value; t.after(() => client.destroy());
  await queueDeletion(value); await client.retry();
  assert.deepEqual(server.files[0].translations, ['one', 'two', 'extra original ZIP entry']);
  assert.equal(store.workspace.staged.Thai['a.txt'], undefined);
  const reset = P.fileState({ filepath: 'a.txt', translations: ['one', 'two', 'extra original ZIP entry'], trackedForExport: false, stagingReset: true });
  client.destroy();
  const reconnected = await fixture({ source: baselineSource, files: [reset], store, server }); t.after(() => reconnected.client.destroy());
  assert.deepEqual(reconnected.client.fileBase('a.txt').translations, reset.translations);
  assert.equal(store.workspace.staged.Thai['a.txt'], undefined);
});

test('sparse join shares only the cached descriptor and retains immutable local bases without full-room storage', async t => {
  const { client, server, store, remote } = await fixture(); t.after(() => client.destroy());
  assert.equal(server.files.length, 0);
  assert.ok(server.requests.every(request => !request.path.includes('/uploads')));
  const join = server.requests.find(request => request.path.endsWith('/join'));
  assert.equal(join.options.body.source, undefined);
  assert.equal(join.options.body.files, undefined);
  assert.deepEqual(remote.flat(), []);
  assert.deepEqual(client.fileBase('a.txt').translations, ['one', 'two']);
  assert.equal(client.fileBase('a.txt').revision, 0);
  const room = Object.values(store.state.rooms)[0];
  assert.deepEqual(room.local, {});
  assert.deepEqual(room.manifest.files, [{ filepath: 'a.txt', entryCount: 2 }, { filepath: 'b.txt', entryCount: 1 }]);
});

test('sparse first save sends one edited witness; later saves omit it and intentional blanks remain edits', async t => {
  const { client, server, store } = await fixture(); t.after(() => client.destroy());
  await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['new', 'two'], trackedForExport: true }] });
  let mutations = server.requests.filter(request => request.path.endsWith('/mutations'));
  assert.equal(mutations.length, 1); assert.equal(mutations[0].options.body.files.length, 1);
  assert.equal(mutations[0].options.body.files[0].baseRevision, 0);
  assert.deepEqual(mutations[0].options.body.files[0].baseline.translations.French, ['un', 'deux']);
  assert.equal(server.files.length, 1);
  await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['', ''], trackedForExport: true }] });
  mutations = server.requests.filter(request => request.path.endsWith('/mutations'));
  assert.equal(mutations[1].options.body.files[0].baseline, undefined);
  assert.equal(mutations[1].options.body.files[0].proof, undefined);
  assert.deepEqual(server.files[0].translations, ['', '']); assert.equal(server.files[0].trackedForExport, true);
});

test('joining with a legacy carried translation does not author it; committed text preserves recovery before callbacks', async t => {
  const carry = { ...initial[0], translations: ['old local carry', 'two'], needsReview: true };
  let recoveryObserved = false;
  const fixtureValue = await fixture({ files: [carry, initial[1]], onRemote(files, store) {
    if (files.some(file => file.translations[0] === 'peer reviewed')) {
      const room = Object.values(store.state.rooms)[0];
      recoveryObserved = room.recovery.some(entry => entry.files.some(file => file.translations[0] === 'old local carry'));
    }
  } });
  const { client, server, store } = fixtureValue; t.after(() => client.destroy());
  assert.equal(server.files.length, 0);
  assert.equal(client.snapshot().pending, 0);
  assert.deepEqual(client.fileBase('a.txt').translations, ['one', 'two'], 'Unreviewed carry never becomes the authored merge base.');
  const dropped = W.droppedForFile(store.workspace, 'a.txt', 'Thai');
  assert.equal(dropped.originSourceHash, ''); assert.equal(dropped.originSourceAvailable, false);
  assert.equal(dropped.targetSourceHash, fixtureValue.archive.baselineId);
  assert.deepEqual(dropped.snapshot.translations, carry.translations);
  server.change('a.txt', ['peer reviewed', 'two']); await client.sync();
  assert.ok(recoveryObserved);
  assert.deepEqual(store.workspace.descs[0].translations.Thai, ['peer reviewed', 'two']);
  assert.equal(client.recoveryFiles('a.txt')[0].translations[0], 'old local carry');
  assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 0);
});

test('modern derived display flags never replace a dropped snapshot with current blank source text on join', async t => {
  const store = storeFixture();
  W.initializeWorkspace(store.workspace, { source, language: 'Thai', game: 'poe1' });
  const old = { ...source[0], translations: { English: ['Older English', 'Older second'], Thai: ['old authored', 'old second'] } };
  const candidate = W.dropTranslation(store.workspace, old, 'Thai', { id: 'original-candidate', game: 'poe1', originSourceHash: 'b'.repeat(64) });
  const { client, server } = await fixture({ store, files: [{ ...initial[0], translations: ['', ''], needsReview: true }, initial[1]] });
  t.after(() => client.destroy());
  const preserved = W.droppedForFile(store.workspace, 'a.txt', 'Thai');
  assert.equal(preserved.id, candidate.id);
  assert.equal(preserved.originSourceHash, 'b'.repeat(64)); assert.equal(preserved.originSourceAvailable, true);
  assert.deepEqual(preserved.snapshot.english, ['Older English', 'Older second']);
  assert.deepEqual(preserved.snapshot.translations, ['old authored', 'old second']);
  assert.equal(Object.keys(store.workspace.droppedArchive).length, 1);
  assert.equal(Object.keys(client.room().carries).length, 0);
  assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 0);
});

test('pre-existing local Saved records are uploaded without including untouched export files', async t => {
  const { client, server } = await fixture({ files: [{ ...initial[0], translations: ['edited', 'two'], trackedForExport: true }, initial[1]] });
  t.after(() => client.destroy());
  assert.deepEqual(server.files.map(file => file.filepath), ['a.txt']);
  assert.equal(client.snapshot().pending, 0);
  assert.deepEqual(client.fileBase('b.txt').translations, ['three']);
});

test('an initial Saved record already identical to shared text does not create a redundant authored history event', async t => {
  const first = await fixture(); first.client.destroy();
  first.server.change('a.txt', ['already shared', 'two']);
  const { client, server } = await fixture({ server: first.server, files: [{ ...initial[0], translations: ['already shared', 'two'], trackedForExport: true }, initial[1]] });
  t.after(() => client.destroy());
  assert.equal(client.snapshot().pending, 0);
  assert.equal(server.files[0].revision, 1);
  assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 0);
});

test('recovering a private dropped copy preserves staged peer text through unchanged and newer snapshots', async t => {
  const { client, server, store, remote } = await fixture(); t.after(() => client.destroy());
  server.change('a.txt', ['peer', 'two']); await client.sync();
  const candidate = { filepath: 'a.txt', translations: ['recovered carry', 'two'], needsReview: true, trackedForExport: false };
  const beforeWrites = store.writes;
  await client.registerLocalCandidate(candidate, { status: { needsReview: true, restoredAt: 123 }, revisions: [{ filepath: 'a.txt', translations: candidate.translations }] });
  assert.equal(store.writes, beforeWrites + 1);
  assert.deepEqual(store.workspace.descs[0].translations.Thai, ['peer', 'two']);
  assert.deepEqual(W.droppedForFile(store.workspace, 'a.txt', 'Thai').snapshot.translations, candidate.translations);
  assert.equal(W.workspaceFile(store.workspace, source[0], 'Thai').hasChanges, true);
  assert.equal(W.workspaceFile(store.workspace, source[0], 'Thai').isDropped, true);
  assert.equal(store.workspace.status['a.txt'].restoredAt, 123);
  assert.deepEqual(store.revisions.at(-1).translations, candidate.translations);
  const room = Object.values(store.state.rooms)[0];
  assert.equal(room.carryRevisions['a.txt'], 1); assert.deepEqual(room.carries['a.txt'].translations, candidate.translations);
  const remoteCount = remote.flat().length;
  await client.acceptSnapshot(server.snapshot(), client.epoch);
  assert.equal(remote.flat().length, remoteCount);
  assert.deepEqual(store.workspace.descs[0].translations.Thai, ['peer', 'two']);
  assert.deepEqual(W.workspaceFile(store.workspace, source[0], 'Thai').translations, ['peer', 'two']);
  assert.deepEqual(W.droppedForFile(store.workspace, 'a.txt', 'Thai').snapshot.translations, candidate.translations);
  assert.deepEqual(client.fileBase('a.txt').translations, ['peer', 'two']);
  server.change('a.txt', ['new reviewed peer', 'two']); await client.sync();
  assert.deepEqual(store.workspace.descs[0].translations.Thai, ['new reviewed peer', 'two']);
  assert.equal(W.workspaceFile(store.workspace, source[0], 'Thai').isDropped, true, 'Only explicit promotion or discard resolves the separate dropped copy.');
  assert.ok(client.recoveryFiles('a.txt').some(file => file.translations[0] === 'recovered carry'));
  assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 0);
});

test('a canonical configuration mismatch stops before any local room writes', async t => {
  const initialFixture = await fixture(); initialFixture.client.destroy();
  const changed = await P.finalizeArchive({ ...initialFixture.archive, configHash: undefined, baselineId: undefined,
    decisions: [{ filepath: 'a.txt', language: 'Thai', occurrence: 1, blockHash: 'a'.repeat(64) }] });
  const server = serverFixture(changed), store = storeFixture();
  const client = new Client({ store, request: server.request.bind(server), WebSocket: null }); t.after(() => client.destroy());
  await assert.rejects(client.connect(initialFixture.connection), error => error.code === 'ARCHIVE_CONFIG_MISMATCH' && error.archive.baselineId === changed.baselineId);
  assert.equal(store.writes, 0); assert.equal(store.state, null);
  assert.equal(server.requests.length, 1);
});

test('simultaneous first saves merge different entries against the original baseline', async t => {
  const { client, server, store } = await fixture(); t.after(() => client.destroy());
  const base = client.fileBase('a.txt');
  server.change('a.txt', ['one', 'peer']);
  await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['mine', 'two'], trackedForExport: true }], bases: { 'a.txt': base } });
  assert.deepEqual(server.files[0].translations, ['mine', 'peer']);
  assert.equal(client.snapshot().conflicts.length, 0);
});

test('simultaneous first saves preserve overlapping edits as a conflict', async t => {
  const { client, server, store } = await fixture(); t.after(() => client.destroy());
  const base = client.fileBase('a.txt'); server.change('a.txt', ['peer', 'two']);
  const result = await client.save({ workspace: store.workspace, files: [{ filepath: 'a.txt', translations: ['mine', 'two'], trackedForExport: true }], bases: { 'a.txt': base } });
  assert.equal(result.status, 'conflict');
  assert.deepEqual(client.snapshot().conflicts[0].yours.translations, ['mine', 'two']);
  assert.deepEqual(client.snapshot().conflicts[0].shared.translations, ['peer', 'two']);
});

test('local original ZIP history can be restored as a new edited mutation without a server baseline event', async t => {
  const { client, server, store } = await fixture(); t.after(() => client.destroy());
  server.change('a.txt', ['edited', 'two']); await client.sync();
  const history = await client.history('a.txt'); assert.equal(history.items.length, 1);
  const event = await client.historyEntry(history.items[0].id);
  assert.equal(event.local, true); assert.equal(event.origin, 'imported_baseline');
  assert.equal(event.currentRevision, 1); assert.deepEqual(event.after.translations, ['one', 'two']);
  await client.save({ workspace: store.workspace, files: [{ ...event.after, trackedForExport: true }], origin: 'restore',
    bases: { 'a.txt': client.fileBase('a.txt') }, restore: { eventId: event.id, version: 'after' } });
  assert.deepEqual(server.files[0].translations, ['one', 'two']);
  assert.equal(server.files[0].revision, 2);
  assert.ok(server.requests.every(request => !request.path.endsWith('/restore')));
});

test('updated production clients may join existing legacy rooms but never seed a whole source when raw ZIP metadata is missing', async t => {
  const requests = [], store = storeFixture(); let exists = true;
  const client = new Client({ store, WebSocket: null, allowLegacySeed: false, request: async (path, options = {}) => {
    requests.push({ path, options });
    if (path.endsWith('/join')) {
      if (!exists) throw Object.assign(new Error('Missing legacy room'), { status: 404 });
      return { roomId: 'legacy', sequence: 0, files: initial.map(file => ({ ...file, revision: 1 })) };
    }
    if (path.includes('/changes?')) return { events: [], hasMore: false };
    throw new Error('Unexpected legacy operation: ' + path);
  } });
  t.after(() => client.destroy());
  await client.connect({ accountId: 'legacy-user', game: 'poe1', language: 'Thai', source, files: initial });
  assert.equal(client.snapshot().roomId, 'legacy');
  exists = false;
  await assert.rejects(client.connect({ accountId: 'new-user', game: 'poe1', language: 'Thai', source, files: initial }),
    error => error.code === 'UPSTREAM_ZIP_REQUIRED' && /local translations and history are preserved/.test(error.message));
  assert.ok(requests.every(request => !request.path.includes('/uploads')));
  assert.ok(Object.keys(store.state.rooms).length >= 2, 'Legacy local rooms remain durable and separately scoped.');
});

const placeholderSource = () => {
  const files = copy(source);
  delete files[0].translations.Thai;
  return files;
};
const currentFiles = (workspace, baselineSource) => baselineSource.map(desc => {
  const state = W.workspaceFile(workspace, desc, 'Thai');
  return { filepath: desc.filepath, translations: state.translations, needsReview: false, trackedForExport: state.hasChanges };
});
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function ghostFixture({ pending = false } = {}) {
  const baselineSource = placeholderSource();
  const files = baselineSource.map(desc => P.fileState({ filepath: desc.filepath, translations: desc.translations.Thai || [],
    trackedForExport: desc.filepath === 'a.txt' }, desc.translations.English.length));
  const result = await fixture({ source: baselineSource, files, beforeConnect({ store, server, archive }) {
    W.initializeWorkspace(store.workspace, { source: baselineSource, sourceHash: archive.baselineId, game: 'poe1', language: 'Thai' });
    store.workspace.collaborationAccountId = 'user';
    store.workspace.staged.Thai = { 'a.txt': { sourceHash: archive.baselineId, translations: ['', ''], before: [], savedAt: 7 } };
    if (pending) server.failMutations = 10;
  } });
  result.source = baselineSource;
  return result;
}
function queueGhostRepair(value) {
  const repaired = W.repairLegacyPlaceholders(value.store.workspace, { source: value.source, collaboration: value.store.state,
    game: 'poe1', revisions: value.store.revisions, receipts: [], evidenceComplete: true });
  assert.equal(repaired, true);
  const room = Object.values(value.store.state.rooms)[0];
  assert.equal(room.placeholderRepairs.length, 1);
  return room.placeholderRepairs[0].id;
}
async function reconnectGhost(value, options = {}) {
  return fixture({ source: value.source, store: value.store, server: value.server,
    files: currentFiles(value.store.workspace, value.source), ...options });
}

test('pending migration placeholder joins repair locally and never repost a mutation on reconnect', async t => {
  const value = await ghostFixture({ pending: true }); value.client.destroy();
  const mutationCount = value.server.requests.filter(request => request.path.endsWith('/mutations')).length;
  assert.equal(value.server.files.length, 0);
  const repairId = queueGhostRepair(value);
  const repaired = await reconnectGhost(value); t.after(() => repaired.client.destroy());
  assert.equal(repaired.client.snapshot().pending, 0);
  assert.equal(W.workspaceFile(repaired.store.workspace, value.source[0], 'Thai').hasChanges, false);
  assert.equal(W.workspaceFile(repaired.store.workspace, value.source[0], 'Thai').isMissing, true);
  assert.equal(value.store.workspace.placeholderRepairArchive[repairId].status, 'local');
  assert.equal(value.server.requests.filter(request => request.path.endsWith('/mutations')).length, mutationCount);
  assert.equal(value.server.requests.filter(request => request.path.endsWith('/placeholder-repairs')).length, 0);
  await repaired.client.sync();
  assert.equal(value.server.requests.filter(request => request.path.endsWith('/mutations')).length, mutationCount);
});

test('accepted ghost repair clears Saved for its owner and peers across reload and reconnect', async t => {
  const value = await ghostFixture(); value.client.destroy();
  const peer = await fixture({ source: value.source, server: value.server, accountId: 'peer' }); t.after(() => peer.client.destroy());
  assert.equal(W.workspaceFile(peer.store.workspace, value.source[0], 'Thai').hasChanges, true);
  const repairId = queueGhostRepair(value), mutationsBefore = value.server.requests.filter(request => request.path.endsWith('/mutations')).length;
  const owner = await reconnectGhost(value); t.after(() => owner.client.destroy());
  assert.equal(owner.client.snapshot().pending, 0);
  assert.equal(value.store.workspace.placeholderRepairArchive[repairId].status, 'repaired');
  assert.equal(W.workspaceFile(owner.store.workspace, value.source[0], 'Thai').hasChanges, false);
  await peer.client.sync();
  assert.equal(W.workspaceFile(peer.store.workspace, value.source[0], 'Thai').hasChanges, false);
  assert.equal(peer.remote.flat().at(-1).stagingReset, true, 'The reset reaches the live UI callback.');
  assert.equal(owner.remote.flat().at(-1).stagingReset, true);
  assert.equal(value.server.files.find(file => file.filepath === 'a.txt').revision, 2);
  assert.equal(value.server.requests.filter(request => request.path.endsWith('/mutations')).length, mutationsBefore);
  owner.client.destroy();
  const reloaded = await reconnectGhost(value); t.after(() => reloaded.client.destroy());
  assert.equal(W.workspaceFile(reloaded.store.workspace, value.source[0], 'Thai').hasChanges, false);
  assert.equal(reloaded.client.snapshot().pending, 0);
  assert.equal(value.server.requests.filter(request => request.path.endsWith('/placeholder-repairs')).length, 1);
  assert.equal(value.server.requests.filter(request => request.path.endsWith('/mutations')).length, mutationsBefore);
});

test('an explicit blank save after placeholder repair remains Saved and syncs as a new revision', async t => {
  const value = await ghostFixture(); value.client.destroy(); queueGhostRepair(value);
  const repaired = await reconnectGhost(value); t.after(() => repaired.client.destroy());
  await repaired.client.save({ workspace: repaired.store.workspace,
    files: [{ filepath: 'a.txt', translations: ['', ''], trackedForExport: true }], origin: 'save' });
  const file = value.server.files.find(row => row.filepath === 'a.txt');
  assert.equal(file.revision, 3); assert.equal(file.trackedForExport, true); assert.equal(file.stagingReset, undefined);
  const state = W.workspaceFile(repaired.store.workspace, value.source[0], 'Thai');
  assert.equal(state.hasChanges, true); assert.equal(state.isMissing, true);
  assert.equal(repaired.store.workspace.staged.Thai['a.txt'].saveOrigin, 'save');
  await repaired.client.sync();
  repaired.client.destroy();
  const reloaded = await reconnectGhost(value); t.after(() => reloaded.client.destroy());
  assert.equal(W.workspaceFile(reloaded.store.workspace, value.source[0], 'Thai').hasChanges, true);
  assert.equal(value.server.files.find(row => row.filepath === 'a.txt').revision, 3);
});

test('a held repair cannot erase an explicit blank save committed while its request is in flight', async t => {
  const value = await ghostFixture(); value.client.destroy(); queueGhostRepair(value);
  const gate = deferred(), started = deferred();
  value.server.repairGate = gate.promise;
  const originalRequest = value.server.request.bind(value.server);
  value.server.request = async (path, options) => {
    if (path.endsWith('/placeholder-repairs')) started.resolve();
    return originalRequest(path, options);
  };
  let client;
  const connection = reconnectGhost(value, { beforeConnect(active) { client = active.client; } });
  await started.promise; t.after(() => client.destroy());
  await client.save({ workspace: value.store.workspace,
    files: [{ filepath: 'a.txt', translations: ['', ''], trackedForExport: true }], origin: 'save', waitForSync: false });
  assert.equal(W.workspaceFile(value.store.workspace, value.source[0], 'Thai').hasChanges, true);
  assert.equal(client.room().outbox.length, 1);
  gate.resolve(); await connection; await client.retry();
  const file = value.server.files.find(row => row.filepath === 'a.txt');
  assert.equal(file.revision, 3); assert.equal(file.trackedForExport, true); assert.equal(file.stagingReset, undefined);
  assert.equal(W.workspaceFile(value.store.workspace, value.source[0], 'Thai').hasChanges, true);
  assert.equal(client.snapshot().pending, 0); assert.equal(client.snapshot().conflicts.length, 0);
});

test('failed repair attempts retain their stable id and replay uncertain completion without duplicate history', async t => {
  const value = await ghostFixture(); value.client.destroy();
  const repairId = queueGhostRepair(value);
  value.server.failRepairs = 1;
  const repaired = await reconnectGhost(value); t.after(() => repaired.client.destroy());
  assert.equal(repaired.client.snapshot().pending, 1);
  assert.equal(W.workspaceFile(value.store.workspace, value.source[0], 'Thai').hasChanges, true);
  value.server.loseRepairReply = 1;
  await repaired.client.flushPlaceholderRepairs(repaired.client.epoch);
  assert.equal(repaired.client.snapshot().pending, 1);
  assert.equal(value.server.files.find(file => file.filepath === 'a.txt').revision, 2);
  await repaired.client.flushPlaceholderRepairs(repaired.client.epoch);
  const attempts = value.server.requests.filter(request => request.path.endsWith('/placeholder-repairs'));
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts.map(request => request.options.body.mutationId), [repairId, repairId, repairId]);
  assert.deepEqual(attempts[0].options.body, attempts[2].options.body);
  assert.equal(value.server.events.length, 2, 'The ghost and one repair are the only authored events.');
  assert.equal(repaired.client.snapshot().pending, 0);
  assert.equal(W.workspaceFile(value.store.workspace, value.source[0], 'Thai').hasChanges, false);
});

test('a repair response from an old scope cannot change the new workspace after an account switch', async t => {
  const value = await ghostFixture(); value.client.destroy(); queueGhostRepair(value);
  const gate = deferred(), started = deferred(); value.server.repairGate = gate.promise;
  const originalRequest = value.server.request.bind(value.server);
  value.server.request = async (path, options) => {
    if (path.endsWith('/placeholder-repairs')) started.resolve();
    return originalRequest(path, options);
  };
  let client, remote;
  const connection = reconnectGhost(value, { beforeConnect(active) { client = active.client; remote = active.remote; } });
  await started.promise; client.disconnect(); t.after(() => client.destroy());
  value.store.workspace = W.initializeWorkspace({ descs: copy(value.source), status: {}, collaborationAccountId: 'other' },
    { source: value.source, sourceHash: 'next-source', game: 'poe1', language: 'Thai' });
  const nextWorkspace = copy(value.store.workspace), roomsBefore = copy(value.store.state), notificationsBefore = remote.length;
  gate.resolve();
  await connection;
  assert.deepEqual(value.store.workspace, nextWorkspace);
  assert.deepEqual(value.store.state, roomsBefore);
  assert.equal(remote.length, notificationsBefore, 'The late reset is not published in the new UI scope.');
});

async function queuedPlaceholderFixture(count) {
  const baselineSource = Array.from({ length: count }, (_, index) => ({ filepath: 'blank-' + index + '.txt', name: '',
    stats: ['blank-' + index], variables: ['#'], remarks: [''], translations: { English: ['English ' + index] } }));
  baselineSource.push({ filepath: 'keep.txt', name: '', stats: ['keep'], variables: ['#'], remarks: [''],
    translations: { English: ['Keep'], Thai: ['kept baseline'] } });
  const value = await fixture({ source: baselineSource, beforeConnect({ store, archive }) {
    W.initializeWorkspace(store.workspace, { source: baselineSource, sourceHash: archive.baselineId, game: 'poe1', language: 'Thai' });
    store.workspace.collaborationAccountId = 'user';
  } });
  const room = value.store.state.rooms[value.client.key];
  room.placeholderRepairs = [];
  value.store.workspace.placeholderRepairArchive = {};
  for (let index = 0; index < count; index++) {
    const filepath = baselineSource[index].filepath, id = 'queued-repair-' + index;
    const staged = { sourceHash: value.archive.baselineId, translations: [''], before: [], savedAt: 7 };
    room.placeholderRepairs.push({ id, filepath, baseRevision: 1 });
    room.local[filepath] = P.fileState({ filepath, translations: [''], trackedForExport: true });
    value.store.workspace.placeholderRepairArchive[id] = { filepath, language: 'Thai', sourceHash: value.archive.baselineId,
      staged, status: 'pending', reason: 'Recovered migration placeholder' };
  }
  value.client.state = copy(value.store.state);
  value.store.writes = 0; value.store.reads = 0; value.remote.length = 0; value.server.requests.length = 0;
  return value;
}

function addDurableExplicitSave(value, filepath, id, translations) {
  const room = value.store.state.rooms[value.client.key];
  const base = value.client.sharedBase(filepath), yours = P.fileState({ filepath, translations, trackedForExport: true });
  room.outbox.push({ id, status: 'pending', origin: 'save', kind: 'edit', files: [{ base, yours }] });
  room.local[filepath] = copy(yours);
  W.stageTranslation(value.store.workspace, yours, 'Thai', { sourceHash: value.archive.baselineId, saveOrigin: 'save' });
  value.store.revisions.push({ filepath, lang: 'Thai', translations: copy(translations), savedAt: 12, origin: 'save' });
  return copy(room.outbox.at(-1));
}

async function sharedPlaceholderFixture(count) {
  const value = await queuedPlaceholderFixture(count), room = value.store.state.rooms[value.client.key];
  value.store.workspace.staged.Thai ||= {};
  for (const repair of room.placeholderRepairs) {
    const file = P.fileState({ filepath: repair.filepath, translations: [''], trackedForExport: true, revision: 1 });
    room.shared[repair.filepath] = copy(file); room.local[repair.filepath] = copy(file);
    value.server.files.push(copy(file));
    value.store.workspace.staged.Thai[repair.filepath] = copy(value.store.workspace.placeholderRepairArchive[repair.id].staged);
  }
  value.client.state = copy(value.store.state);
  return value;
}

test('65 shared placeholder repairs retain their original mutation ids and use three durable batches', async t => {
  const value = await sharedPlaceholderFixture(65); t.after(() => value.client.destroy());
  const ids = value.client.room().placeholderRepairs.map(repair => repair.id);
  await value.client.flushPlaceholderRepairs(value.client.epoch);
  const requests = value.server.requests.filter(request => request.path.endsWith('/placeholder-repairs'));
  assert.deepEqual(requests.map(request => request.options.body.mutationId), ids);
  assert.ok(requests.every(request => request.options.body.files.length === 1 && request.options.body.files[0].baseRevision === 1));
  assert.deepEqual({ reads: value.store.reads, writes: value.store.writes, requests: requests.length, callbacks: value.remote.length },
    { reads: 1, writes: 3, requests: 65, callbacks: 3 });
  assert.deepEqual(value.remote.map(files => files.length), [32, 32, 1]);
  assert.deepEqual(value.store.state.rooms[value.client.key].placeholderRepairs, []);
  for (const id of ids) assert.equal(value.store.workspace.placeholderRepairArchive[id].status, 'repaired');
  for (let index = 0; index < ids.length; index++) {
    const file = W.workspaceFile(value.store.workspace, value.connection.source[index], 'Thai');
    assert.equal(file.hasChanges, false); assert.equal(file.isMissing, true);
  }
  assert.equal(value.server.events.length, 65); assert.equal(value.server.receipts.size, 65);
});

test('a later lost repair reply persists earlier batches and retries the remaining original ids without duplicate events', async t => {
  const value = await sharedPlaceholderFixture(65); t.after(() => value.client.destroy());
  const ids = value.client.room().placeholderRepairs.map(repair => repair.id), request = value.client.request;
  let attempts = 0;
  value.client.request = async (path, options) => {
    if (path.endsWith('/placeholder-repairs') && ++attempts === 41) value.server.loseRepairReply = 1;
    return request(path, options);
  };
  await value.client.flushPlaceholderRepairs(value.client.epoch);
  assert.match(value.client.placeholderRepairError.message, /reply was lost/);
  assert.deepEqual({ reads: value.store.reads, writes: value.store.writes, requests: attempts, callbacks: value.remote.length },
    { reads: 1, writes: 2, requests: 41, callbacks: 2 });
  assert.deepEqual(value.remote.map(files => files.length), [32, 8]);
  assert.deepEqual(value.store.state.rooms[value.client.key].placeholderRepairs.map(repair => repair.id), ids.slice(40));
  for (const id of ids.slice(0, 40)) assert.equal(value.store.workspace.placeholderRepairArchive[id].status, 'repaired');
  for (const id of ids.slice(40)) assert.equal(value.store.workspace.placeholderRepairArchive[id].status, 'pending');
  assert.equal(value.server.events.length, 41, 'The uncertain reply includes an already committed server repair.');
  await value.client.flushPlaceholderRepairs(value.client.epoch);
  assert.equal(value.client.placeholderRepairError, null);
  assert.deepEqual(value.store.state.rooms[value.client.key].placeholderRepairs, []);
  assert.deepEqual(value.server.requests.filter(item => item.path.endsWith('/placeholder-repairs')).map(item => item.options.body.mutationId),
    [...ids.slice(0, 41), ...ids.slice(40)]);
  assert.equal(value.store.reads, 2); assert.equal(value.store.writes, 3);
  assert.equal(value.server.events.length, 65); assert.equal(value.server.receipts.size, 65);
  for (const id of ids) assert.equal(value.store.workspace.placeholderRepairArchive[id].status, 'repaired');
});

test('a repair conflict flushes buffered successes before accepting a peer snapshot and preserves peer text', async t => {
  const value = await sharedPlaceholderFixture(3); t.after(() => value.client.destroy());
  value.server.change('blank-1.txt', ['new peer translation']);
  await value.client.flushPlaceholderRepairs(value.client.epoch);
  assert.equal(value.client.placeholderRepairError, null);
  assert.deepEqual(value.store.state.rooms[value.client.key].placeholderRepairs, []);
  assert.equal(value.store.workspace.placeholderRepairArchive['queued-repair-0'].status, 'repaired');
  assert.equal(value.store.workspace.placeholderRepairArchive['queued-repair-1'].status, 'protected');
  assert.equal(value.store.workspace.placeholderRepairArchive['queued-repair-2'].status, 'repaired');
  assert.deepEqual(value.client.fileBase('blank-1.txt').translations, ['new peer translation']);
  assert.deepEqual(value.store.workspace.staged.Thai['blank-1.txt'].translations, ['new peer translation']);
  assert.equal(W.workspaceFile(value.store.workspace, value.connection.source[0], 'Thai').hasChanges, false);
  assert.equal(W.workspaceFile(value.store.workspace, value.connection.source[2], 'Thai').hasChanges, false);
  assert.equal(value.server.events.length, 3, 'Only the peer edit and the two eligible repairs author events.');
  assert.equal(value.server.receipts.size, 2);
});

for (const count of [100, 1000]) test(count + ' blocked placeholder repairs reload once without rewriting durable state', async t => {
  const value = await queuedPlaceholderFixture(count); t.after(() => value.client.destroy());
  for (let index = 0; index < count; index++) addDurableExplicitSave(value, 'blank-' + index + '.txt', 'explicit-' + index, ['authored ' + index]);
  value.client.state = copy(value.store.state);
  const stateBefore = copy(value.store.state), workspaceBefore = copy(value.store.workspace), historyBefore = copy(value.store.revisions);
  await value.client.flushPlaceholderRepairs(value.client.epoch);
  assert.deepEqual({ reads: value.store.reads, writes: value.store.writes, remote: value.remote.length, requests: value.server.requests.length },
    { reads: 1, writes: 0, remote: 0, requests: 0 });
  assert.deepEqual(value.store.state, stateBefore); assert.deepEqual(value.store.workspace, workspaceBefore);
  assert.deepEqual(value.store.revisions, historyBefore);
  assert.equal(value.client.room().placeholderRepairs.length, count);
});

test('large local-only repair queues complete in one transaction and preserve unrelated durable saves and history', async t => {
  const count = 300, value = await queuedPlaceholderFixture(count); t.after(() => value.client.destroy());
  const keep = addDurableExplicitSave(value, 'keep.txt', 'keep-unrelated-save', ['kept authored text']);
  const german = { sourceHash: value.archive.baselineId, translations: ['German authored'], before: ['old German'], savedAt: 9 };
  value.store.workspace.staged.German = { 'keep.txt': copy(german) };
  value.client.state = copy(value.store.state);
  const historyBefore = copy(value.store.revisions);
  await value.client.flushPlaceholderRepairs(value.client.epoch);
  assert.deepEqual({ reads: value.store.reads, writes: value.store.writes, requests: value.server.requests.length },
    { reads: 1, writes: 1, requests: 0 });
  const persisted = value.store.state.rooms[value.client.key];
  assert.deepEqual(persisted.placeholderRepairs, []); assert.deepEqual(persisted.outbox, [keep]);
  assert.deepEqual(value.store.revisions, historyBefore); assert.deepEqual(value.store.workspace.staged.German['keep.txt'], german);
  assert.deepEqual(value.store.workspace.staged.Thai['keep.txt'].translations, ['kept authored text']);
  for (let index = 0; index < count; index++) {
    assert.equal(value.store.workspace.placeholderRepairArchive['queued-repair-' + index].status, 'local');
    const file = W.workspaceFile(value.store.workspace, value.connection.source[index], 'Thai');
    assert.equal(file.hasChanges, false); assert.equal(file.isMissing, true);
  }
  assert.equal(value.remote.length, 1); assert.equal(value.remote[0].length, count);
  assert.ok(value.remote[0].every(file => file.stagingReset && !file.trackedForExport));
});

test('an explicit save committed while the readonly repair snapshot is pending survives local repair batching', async t => {
  const value = await queuedPlaceholderFixture(2); t.after(() => value.client.destroy());
  const entered = deferred(), release = deferred(), read = value.store.getCollaborationState.bind(value.store);
  value.store.getCollaborationState = async () => {
    const snapshot = await read(); entered.resolve(); await release.promise; return snapshot;
  };
  const repair = value.client.flushPlaceholderRepairs(value.client.epoch);
  await entered.promise;
  const authored = addDurableExplicitSave(value, 'blank-0.txt', 'worker-save-during-read', ['explicit authored text']);
  const historyBefore = copy(value.store.revisions);
  release.resolve(); await repair;
  const persisted = value.store.state.rooms[value.client.key];
  assert.deepEqual(persisted.outbox, [authored]); assert.equal(persisted.placeholderRepairs.length, 1);
  assert.equal(persisted.placeholderRepairs[0].filepath, 'blank-0.txt');
  assert.deepEqual(persisted.local['blank-0.txt'].translations, ['explicit authored text']);
  assert.deepEqual(value.store.workspace.staged.Thai['blank-0.txt'].translations, ['explicit authored text']);
  assert.deepEqual(value.store.revisions, historyBefore);
  assert.equal(value.store.workspace.placeholderRepairArchive['queued-repair-0'].status, 'pending');
  assert.equal(value.store.workspace.placeholderRepairArchive['queued-repair-1'].status, 'local');
  assert.deepEqual(value.remote.flat().map(file => file.filepath), ['blank-1.txt']);
});

test('worker saves serialize with a blocked repair reload and retain their acknowledged pending work', async t => {
  const value = await queuedPlaceholderFixture(1); t.after(() => value.client.destroy());
  const blocked = addDurableExplicitSave(value, 'blank-0.txt', 'existing-blocked-save', ['existing authored text']);
  value.client.state = copy(value.store.state);
  const entered = deferred(), release = deferred(), read = value.store.getCollaborationState.bind(value.store);
  t.after(() => release.resolve());
  value.store.getCollaborationState = async () => {
    const snapshot = await read();
    if (value.store.reads === 1) { entered.resolve(); await release.promise; }
    return snapshot;
  };
  const repair = value.client.flushPlaceholderRepairs(value.client.epoch);
  await entered.promise;
  let authored;
  // The editor queues the worker write and acknowledgment through this same
  // barrier, so an acknowledgment cannot be overwritten by an older reload.
  const write = value.client.withLocalWrite(async () => {
    authored = addDurableExplicitSave(value, 'keep.txt', 'worker-ack-after-read', ['worker authored text']);
    value.client.acceptLocalSave({ jobId: authored.id, collaboration: { key: value.client.key }, files: [authored.files[0].yours] },
      { operations: [authored], files: [authored.files[0].yours] });
  });
  await Promise.resolve(); assert.equal(authored, undefined, 'The worker save waits for the readonly reload.');
  release.resolve(); await Promise.all([repair, write]);
  assert.deepEqual(value.client.room().outbox, [blocked, authored]);
  assert.deepEqual(value.client.fileBase('keep.txt').translations, ['worker authored text']);
  assert.deepEqual(value.store.state.rooms[value.client.key].outbox, [blocked, authored]);
  assert.equal(value.store.workspace.placeholderRepairArchive['queued-repair-0'].status, 'pending');
  assert.equal(value.store.writes, 0); assert.equal(value.remote.length, 0); assert.equal(value.server.requests.length, 0);
});

test('a readonly repair reload from an old account cannot replace the new room or notify its editor', async t => {
  const value = await queuedPlaceholderFixture(1); t.after(() => value.client.destroy());
  const entered = deferred(), release = deferred(), read = value.store.getCollaborationState.bind(value.store);
  value.store.getCollaborationState = async () => {
    const snapshot = await read(); entered.resolve(); await release.promise; return snapshot;
  };
  const repair = value.client.flushPlaceholderRepairs(value.client.epoch);
  const rejection = assert.rejects(repair, error => error.stale === true);
  await entered.promise;
  const oldRoom = value.client.room(), identity = { ...oldRoom.identity, accountId: 'other-account' }, nextKey = P.scopeKey(identity);
  value.client.disconnect();
  const nextState = { version: 1, rooms: { [nextKey]: { ...copy(oldRoom), identity, placeholderRepairs: [], outbox: [] } } };
  value.client.state = copy(nextState); value.client.key = nextKey;
  value.store.state = copy(nextState); value.store.workspace.collaborationAccountId = identity.accountId;
  const workspaceBefore = copy(value.store.workspace), remoteBefore = value.remote.length;
  let notifications = 0; value.client.onChange = () => { notifications++; };
  release.resolve(); await rejection;
  assert.deepEqual(value.client.state, nextState); assert.deepEqual(value.store.state, nextState);
  assert.deepEqual(value.store.workspace, workspaceBefore);
  assert.equal(value.store.writes, 0); assert.equal(value.remote.length, remoteBefore); assert.equal(notifications, 0);
});
