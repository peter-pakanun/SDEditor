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
function storeFixture() {
  return { state: null, workspace: { descs: copy(source), status: {} }, revisions: [], writes: 0,
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
      if (path.endsWith('/mutations')) {
        if (this.receipts.has(body.mutationId)) return copy(this.receipts.get(body.mutationId));
        if (body.files.some(file => file.baseRevision !== (this.files.find(row => row.filepath === file.filepath)?.revision || 0))) throw Object.assign(new Error('Conflict'), { status: 409, current: this.snapshot() });
        for (const file of body.files) if (!file.baseRevision) {
          assert.ok(await P.verifyBaselineProof(file.baseline, file.proof, this.archive.treeRoot, this.archive.descriptionCount));
        }
        const files = body.files.map(file => P.fileState({ ...file, revision: file.baseRevision + 1 }));
        for (const file of files) this.files = this.files.filter(row => row.filepath !== file.filepath).concat(copy(file));
        const result = { roomId: 'sparse', sequence: ++this.sequence, files };
        this.events.push(copy(result)); this.receipts.set(body.mutationId, result); return copy(result);
      }
      throw new Error('Unexpected sparse endpoint: ' + path);
    },
  };
}
let id = 0;
async function fixture(options = {}) {
  const tree = await P.buildBaselineTree(source);
  const archive = await P.finalizeArchive({ version: 1, zipHash: await P.zipHash(new Uint8Array([1, 2, 3])), zipSize: 3,
    fileCount: source.length, descriptionCount: source.length, parserVersion: 1, decisions: [], treeRoot: tree.root });
  const store = options.store || storeFixture(), server = options.server || serverFixture(archive), remote = [];
  const client = new Client({ store, request: server.request.bind(server), WebSocket: null, uuid: () => 'sparse-' + ++id,
    onRemote: files => { options.onRemote?.(files, store); remote.push(copy(files)); } });
  const connection = { accountId: 'user', game: 'poe1', language: 'Thai', source, files: options.files || initial,
    workspace: store.workspace, archive, baselineSource: source, baselineTree: tree };
  await client.connect(connection);
  return { client, store, server, remote, connection, archive, tree };
}

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
