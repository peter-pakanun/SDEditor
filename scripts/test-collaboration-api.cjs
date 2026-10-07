/* Cross-repository integration check. Run with SDEditor-API installed beside this repository. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createRequire } = require('node:module');
const { Client } = require('../public/collaborationSync.js');
const P = require('../public/collaborationProtocol.js');
const W = require('../public/workspaceState.js');
const apiRoot = path.resolve(__dirname, '../../SDEditor-API');
const load = file => import(pathToFileURL(path.join(apiRoot, file)).href);
const ORIGIN = 'https://sdeditor.pages.dev';
const copy = structuredClone;
function memoryStore() {
  return { state: null, workspace: null, async updateCollaborationState(fn, options = {}) {
    this.state = fn(copy(this.state));
    if (Object.hasOwn(options, 'workspace')) this.workspace = copy(options.workspace);
    if (options.projectWorkspace) this.workspace = options.projectWorkspace(this.workspace, this.state);
    return copy(this.state);
  } };
}
async function until(condition) {
  const deadline = Date.now() + 4000;
  while (!condition()) { if (Date.now() > deadline) throw new Error('Collaboration integration condition timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('browser engine interoperates with API seed, presence claims, entry merges, staged batches, and history', async t => {
  const [{ openDatabase, CloudStore }, { loadConfig }, { createApp }] = await Promise.all([
    load('src/database.js'), load('src/config.js'), load('src/app.js'),
  ]);
  const { WebSocket } = createRequire(path.join(apiRoot, 'package.json'))('ws');
  class OriginSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
  const config = loadConfig({ ADMIN_GOOGLE_SUB: 'admin' });
  const db = openDatabase(':memory:'); const store = new CloudStore(db, config);
  function account(id) {
    store.registerIdentity({ sub: id, email: id + '@example.com', name: 'Translator ' + id });
    store.assignLanguage('admin', id, 'Thai'); return store.createSession(id);
  }
  const users = [account('first'), account('second')];
  const app = createApp({ config, store, logger: { warn() {}, error() {} } });
  const server = createServer(app); const realtime = app.locals.collaborationRealtime.attach(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiBase = 'http://127.0.0.1:' + server.address().port;
  const clients = users.map(user => new Client({ store: memoryStore(), apiBase, WebSocket: OriginSocket,
    request: async (pathname, options = {}) => {
      const response = await fetch(apiBase + pathname, { method: options.method || 'GET', headers: {
        Origin: ORIGIN, Authorization: 'Bearer ' + user.token,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
      const body = response.status === 204 ? null : await response.json();
      if (!response.ok) throw Object.assign(new Error(body.error?.message), { status: response.status, code: body.error?.code, current: body.current });
      return body;
    },
  }));
  t.after(async () => { clients.forEach(client => client.destroy()); await realtime.close(); await new Promise(resolve => server.close(resolve)); db.close(); });
  const source = Array.from({ length: 105 }, (_, index) => ({ filepath: `source/file-${index}.txt`, name: '', stats: ['stat'],
    variables: ['#', '#'], remarks: ['', ''], translations: { English: ['One', 'Two'], Thai: ['หนึ่ง', 'สอง'] } }));
  const files = source.map(file => ({ filepath: file.filepath, translations: file.translations.Thai, needsReview: false, trackedForExport: false }));
  const connect = index => clients[index].connect({ accountId: users[index].user.id,
    game: 'poe1', language: 'Thai', source, files, workspace: { descs: copy(source), status: {} } });
  const [a, b] = clients;
  await connect(0);
  let releaseCatchUp, enteredCatchUp;
  const catchUpGate = new Promise(resolve => { releaseCatchUp = resolve; });
  const catchUpEntered = new Promise(resolve => { enteredCatchUp = resolve; });
  const originalRequest = b.request;
  b.request = async (pathname, options) => {
    if (pathname.includes('/changes?')) { enteredCatchUp(); await catchUpGate; }
    return originalRequest(pathname, options);
  };
  let joined = false;
  const joining = connect(1).then(result => { joined = true; return result; });
  try {
    await catchUpEntered;
    await until(() => a.connected && b.connected && a.peers.length === 2 && b.peers.length === 2);
    assert.equal(joined, false, 'Real WebSocket presence reaches both browsers while translation catch-up is still pending.');
  } finally {
    releaseCatchUp();
    await joining;
    b.request = originalRequest;
  }
  const filepath = source[0].filepath;
  a.select(filepath); assert.equal((await a.claim(filepath)).granted, true);
  await until(() => b.isEditing(filepath));
  const denied = await b.claim(filepath); assert.equal(denied.granted, false); assert.equal(denied.peers[0].name, 'Translator first');
  assert.equal((await b.claim(filepath, { force: true })).granted, true);
  const secondBase = b.fileBase(filepath);
  assert.equal((await a.save({ files: [{ ...a.fileBase(filepath), translations: ['first entry', 'สอง'] }] })).status, 'synced');
  await until(() => b.fileBase(filepath).translations[0] === 'first entry');
  assert.equal((await b.save({ bases: { [filepath]: secondBase }, files: [{ ...secondBase, translations: ['หนึ่ง', 'second entry'] }] })).status, 'synced');
  await until(() => a.fileBase(filepath).translations[1] === 'second entry');
  assert.deepEqual(a.fileBase(filepath).translations, ['first entry', 'second entry']);
  assert.equal((await b.history(filepath)).items[0].origin, 'merge');
  const conflictBase = a.fileBase(filepath);
  await b.save({ files: [{ ...b.fileBase(filepath), translations: ['remote overlap', 'second entry'] }] });
  assert.equal((await a.save({ bases: { [filepath]: conflictBase }, files: [{ ...conflictBase, translations: ['local overlap', 'second entry'] }] })).status, 'conflict');
  const conflict = a.snapshot().conflicts.find(item => item.filepath === filepath);
  assert.equal((await a.resolve(conflict.id, ['agreed overlap', 'second entry'])).status, 'synced');
  assert.equal((await a.history(filepath)).items[0].origin, 'conflict_resolution');
  await until(() => b.fileBase(filepath).translations[0] === 'agreed overlap');
  const stagedBases = Object.fromEntries(a.snapshot().files.map(file => [file.filepath, copy(file)]));
  await b.save({ files: [{ ...b.fileBase(filepath), translations: ['remote before staged merge', 'second entry'] }] });
  await until(() => a.fileBase(filepath).translations[0] === 'remote before staged merge');
  const request = a.request; let loseFinalizeReply = true;
  a.request = async (...args) => {
    const response = await request(...args);
    if (loseFinalizeReply && args[0].endsWith('/finalize')) { loseFinalizeReply = false; throw new Error('Lost reply after atomic finalize'); }
    return response;
  };
  const stagedMerge = await a.save({ bases: stagedBases, files: Object.values(stagedBases).map(file => ({ ...file, translations: [file.translations[0], 'staged independent entry'] })) });
  assert.equal(stagedMerge.status, 'pending'); await a.sync(); assert.equal(a.snapshot().pending, 0);
  assert.equal((await a.history(filepath)).items[0].origin, 'merge', 'Staged metadata and retries retain the computed wire origin.');
  assert.deepEqual(a.fileBase(filepath).translations, ['remote before staged merge', 'staged independent entry']);
  const result = await a.save({ origin: 'import', files: a.snapshot().files.map(file => ({ ...file, translations: ['bulk', 'atomic'] })) });
  assert.equal(result.status, 'synced'); await a.sync(); assert.equal(a.snapshot().pending, 0);
  await until(() => b.snapshot().files.every(file => file.translations[0] === 'bulk'));
  const history = await b.history(filepath); assert.ok(history.items.some(item => item.origin === 'import'));
  const details = await b.historyEntry(history.items[0].id);
  assert.deepEqual(details.after.translations, ['bulk', 'atomic']);
  const restored = await b.save({ origin: 'restore', files: [{ ...b.fileBase(filepath), translations: details.before.translations }],
    restore: { eventId: details.id, version: 'before' } });
  assert.equal(restored.status, 'synced');
  const restoreHistory = (await b.history(filepath)).items[0];
  assert.equal(restoreHistory.sourceEventId, details.id); assert.equal(restoreHistory.sourceVersion, 'before');
  b.leaveEdit(); const oldSession = a.sessionId;
  a.closeSocket(); await until(() => !b.isEditing(filepath));
  await a.sync(); await until(() => a.connected && a.sessionId !== oldSession && b.isEditing(filepath));
  a.leaveEdit(); await until(() => !b.isEditing(filepath));
});

test('sparse browser clients share a canonical ZIP baseline with proofed edits, untouched presence, conflicts, and incremental history', async t => {
  const [{ openDatabase, CloudStore }, { loadConfig }, { createApp }] = await Promise.all([
    load('src/database.js'), load('src/config.js'), load('src/app.js'),
  ]);
  const { WebSocket } = createRequire(path.join(apiRoot, 'package.json'))('ws');
  class OriginSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
  const config = loadConfig({ ADMIN_GOOGLE_SUB: 'admin' });
  const db = openDatabase(':memory:'), store = new CloudStore(db, config);
  const users = ['first', 'second'].map(id => {
    store.registerIdentity({ sub: id, email: id + '@example.com', name: 'Translator ' + id });
    store.assignLanguage('admin', id, 'Thai'); return store.createSession(id);
  });
  const app = createApp({ config, store, logger: { warn() {}, error() {} } });
  const server = createServer(app), realtime = app.locals.collaborationRealtime.attach(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiBase = 'http://127.0.0.1:' + server.address().port, requests = [];
  const clients = users.map(user => new Client({ store: memoryStore(), apiBase, WebSocket: OriginSocket,
    request: async (pathname, options = {}) => {
      requests.push({ pathname, options: copy(options) });
      const response = await fetch(apiBase + pathname, { method: options.method || 'GET', headers: {
        Origin: ORIGIN, Authorization: 'Bearer ' + user.token, ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
      const body = response.status === 204 ? null : await response.json();
      if (!response.ok) throw Object.assign(new Error(body.error?.message), { status: response.status, code: body.error?.code, current: body.current, archive: body.archive });
      return body;
    },
  }));
  t.after(async () => { clients.forEach(client => client.destroy()); await realtime.close(); await new Promise(resolve => server.close(resolve)); db.close(); });
  const source = Array.from({ length: 4 }, (_, index) => ({ filepath: `source/file-${index}.txt`, name: '', stats: ['stat-' + index],
    variables: ['#', '#'], remarks: ['', ''], translations: { English: ['One', 'Two'], Thai: ['หนึ่ง', 'สอง'], French: ['un', 'deux'] } }));
  const tree = await P.buildBaselineTree(source);
  const decision = { filepath: source[0].filepath, language: 'Thai', occurrence: 2,
    blockHash: await P.blockHash({ content: source[0].translations.Thai, variables: ['#', '#'], remarks: ['', ''] }) };
  const archive = await P.finalizeArchive({ version: 1, zipHash: await P.zipHash(new Uint8Array([9, 8, 7])), zipSize: 3,
    fileCount: source.length, descriptionCount: source.length, parserVersion: 1, decisions: [decision], treeRoot: tree.root });
  const files = source.map(file => ({ filepath: file.filepath, translations: [...file.translations.Thai], needsReview: false, trackedForExport: false }));
  const connection = (index, selectedArchive = archive) => ({ accountId: users[index].user.id, game: 'poe1', language: 'Thai', source, files,
    workspace: { descs: copy(source), status: {}, sourceHash: selectedArchive.baselineId }, archive: selectedArchive, baselineSource: source, baselineTree: tree });
  const [a, b] = clients;
  await a.connect(connection(0));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collaboration_files').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collaboration_source_files').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collaboration_history').get().n, 0);
  const different = await P.finalizeArchive({ ...archive, configHash: undefined, baselineId: undefined, decisions: [{ ...decision, occurrence: 1 }] });
  await assert.rejects(b.connect(connection(1, different)), error => error.code === 'ARCHIVE_CONFIG_MISMATCH' && error.archive.baselineId === archive.baselineId);
  assert.equal(b.store.state, null, 'Different interpretation cannot write a second local room before agreed choices are applied.');
  await b.connect(connection(1));
  await until(() => a.connected && b.connected && a.peers.length === 2 && b.peers.length === 2);
  const untouched = source[3].filepath;
  a.select(untouched); assert.equal((await a.claim(untouched)).granted, true);
  await until(() => b.isEditing(untouched));
  assert.equal((await b.claim(untouched)).granted, false);
  a.leaveEdit(); await until(() => !b.isEditing(untouched));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collaboration_files').get().n, 0, 'Presence does not materialize baseline translations.');
  const filepath = source[0].filepath, baseA = a.fileBase(filepath), baseB = b.fileBase(filepath);
  assert.equal(baseA.revision, 0);
  const first = await Promise.all([
    a.save({ bases: { [filepath]: baseA }, files: [{ ...baseA, translations: ['first changed', 'สอง'], trackedForExport: true }] }),
    b.save({ bases: { [filepath]: baseB }, files: [{ ...baseB, translations: ['หนึ่ง', 'second changed'], trackedForExport: true }] }),
  ]);
  assert.ok(first.every(result => result.status === 'synced'));
  await Promise.all([a.sync(), b.sync()]);
  assert.deepEqual(a.fileBase(filepath).translations, ['first changed', 'second changed']);
  assert.deepEqual(b.fileBase(filepath).translations, ['first changed', 'second changed']);
  const firstWires = requests.filter(request => request.pathname.endsWith('/mutations')).flatMap(request => request.options.body.files);
  assert.ok(firstWires.some(file => file.baseRevision === 0 && file.baseline && file.proof));
  assert.ok(firstWires.every(file => file.filepath === filepath));
  assert.ok(requests.every(request => !request.pathname.includes('/uploads')), 'No initial baseline upload or archive contents are sent.');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collaboration_files').get().n, 1);
  const overlapPath = source[1].filepath, overlapA = a.fileBase(overlapPath), overlapB = b.fileBase(overlapPath);
  const overlapping = await Promise.all([
    a.save({ bases: { [overlapPath]: overlapA }, files: [{ ...overlapA, translations: ['first overlapping', 'สอง'], trackedForExport: true }] }),
    b.save({ bases: { [overlapPath]: overlapB }, files: [{ ...overlapB, translations: ['second overlapping', 'สอง'], trackedForExport: true }] }),
  ]);
  assert.equal(overlapping.filter(result => result.status === 'synced').length, 1);
  assert.equal(overlapping.filter(result => result.status === 'conflict').length, 1);
  const conflicted = overlapping[0].status === 'conflict' ? a : b;
  const conflict = conflicted.snapshot().conflicts.find(file => file.filepath === overlapPath);
  assert.deepEqual(conflict.base.translations, ['หนึ่ง', 'สอง']);
  assert.equal((await conflicted.resolve(conflict.id, ['agreed reviewed', 'สอง'])).status, 'synced');
  await Promise.all([a.sync(), b.sync()]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collaboration_files').get().n, 2);
  const history = await a.history(filepath);
  const localBaseline = history.items.find(item => item.origin === 'imported_baseline');
  assert.ok(localBaseline); assert.equal(localBaseline.local, true);
  assert.ok(history.items.filter(item => !item.local).length >= 2);
  assert.ok(history.items.filter(item => !item.local).every(item => !['seed', 'baseline'].includes(item.origin)));
  const savedEvent = history.items.find(item => item.origin === 'save' && item.revision === 1);
  assert.ok(savedEvent); assert.equal(typeof savedEvent.id, 'number');
  const savedEntry = await a.historyEntry(savedEvent.id);
  assert.deepEqual(savedEntry.before.translations, ['หนึ่ง', 'สอง']);
  assert.ok([['first changed', 'สอง'], ['หนึ่ง', 'second changed']].some(translations => P.equal(savedEntry.after.translations, translations)));
  assert.deepEqual(await a.historyEntry(String(savedEvent.id)), savedEntry);
  const savedRestore = await a.save({ origin: 'restore', bases: { [filepath]: a.fileBase(filepath) },
    files: [{ ...savedEntry.after, trackedForExport: true }], restore: { eventId: savedEvent.id, version: 'after' } });
  assert.equal(savedRestore.status, 'synced');
  await b.sync(); assert.deepEqual(b.fileBase(filepath).translations, savedEntry.after.translations);
  const savedRestoreHistory = (await a.history(filepath)).items[0];
  assert.equal(savedRestoreHistory.sourceEventId, savedEvent.id); assert.equal(savedRestoreHistory.sourceVersion, 'after');
  assert.ok(requests.some(request => request.pathname.endsWith('/history/' + savedEvent.id + '/restore')
    && request.options.method === 'POST'));
  const entry = await a.historyEntry(localBaseline.id);
  assert.deepEqual(entry.after.translations, ['หนึ่ง', 'สอง']);
  const restored = await a.save({ origin: 'restore', bases: { [filepath]: a.fileBase(filepath) },
    files: [{ ...entry.after, trackedForExport: true }], restore: { eventId: entry.id, version: 'after' } });
  assert.equal(restored.status, 'synced');
  await b.sync(); assert.deepEqual(b.fileBase(filepath).translations, ['หนึ่ง', 'สอง']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collaboration_source_files').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collaboration_files').get().n, 2);
  const untouchedHistory = await b.history(untouched);
  assert.equal(untouchedHistory.items.length, 1); assert.equal(untouchedHistory.items[0].local, true);
});

test('real API and client recover identical resolved history as a new generation without reviving retries', async t => {
  const [{ openDatabase, CloudStore }, { loadConfig }, { createApp }] = await Promise.all([
    load('src/database.js'), load('src/config.js'), load('src/app.js'),
  ]);
  const config = loadConfig({ ADMIN_GOOGLE_SUB: 'admin' }), db = openDatabase(':memory:');
  const cloud = new CloudStore(db, config);
  cloud.registerIdentity({ sub: 'translator', email: 'translator@example.test', name: 'Translator' });
  cloud.assignLanguage('admin', 'translator', 'Thai');
  const user = cloud.createSession('translator');
  const app = createApp({ config, store: cloud, logger: { warn() {}, error() {} } });
  const server = createServer(app), realtime = app.locals.collaborationRealtime.attach(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiBase = 'http://127.0.0.1:' + server.address().port;
  const source = [{ filepath: 'source/fixture.txt', name: '', stats: ['fixture'], variables: ['#'], remarks: [''],
    translations: { English: ['One'], Thai: ['ZIP translation'] } }];
  const tree = await P.buildBaselineTree(source);
  const archive = await P.finalizeArchive({ version: 1, zipHash: await P.zipHash(new Uint8Array([6, 7, 8])), zipSize: 3,
    fileCount: 1, descriptionCount: 1, parserVersion: 1, decisions: [], treeRoot: tree.root });
  const store = memoryStore();
  store.getWorkspace = async () => copy(store.workspace);
  store.updateWorkspace = async fn => { store.workspace = fn(copy(store.workspace)); return copy(store.workspace); };
  const workspace = { game: 'poe1', sourceHash: archive.baselineId, descs: copy(source), status: {} };
  W.initializeWorkspace(workspace, { source, sourceHash: archive.baselineId, game: 'poe1', language: 'Thai' });
  const client = new Client({ store, apiBase, WebSocket: null, request: async (pathname, options = {}) => {
    const response = await fetch(apiBase + pathname, { method: options.method || 'GET', headers: {
      Origin: ORIGIN, Authorization: 'Bearer ' + user.token, ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error?.message), { status: response.status, code: body.error?.code, current: body.current });
    return body;
  } });
  t.after(async () => { client.destroy(); await realtime.close(); await new Promise(resolve => server.close(resolve)); db.close(); });
  await client.connect({ accountId: user.user.id, game: 'poe1', language: 'Thai', source,
    files: [{ filepath: source[0].filepath, translations: ['ZIP translation'], needsReview: false, trackedForExport: false }],
    workspace, archive, baselineSource: source, baselineTree: tree });
  const input = { id: 'recover-first', recoveryId: 'recover-first', game: 'poe1', language: 'Thai', filepath: source[0].filepath,
    originSourceHash: archive.baselineId, targetSourceHash: archive.baselineId, reason: 'Recovered translation', originSourceAvailable: true,
    snapshot: { name: '', english: ['One'], stats: ['fixture'], variables: ['#'], remarks: [''], translations: ['Historical Thai'] } };
  assert.equal((await client.registerDroppedCandidate(input)).status, 'synced');
  const first = W.droppedForFile(store.workspace, input.filepath, 'Thai');
  assert.ok(first && first.id !== input.id);
  assert.deepEqual(W.workspaceFile(store.workspace, source[0], 'Thai').translations, ['ZIP translation']);
  await client.discardDropped(input.filepath, { ...first, targetSourceHash: archive.baselineId });
  assert.equal(W.droppedForFile(store.workspace, input.filepath, 'Thai'), null);
  const secondResult = await client.registerDroppedCandidate({ ...input, id: 'recover-second', recoveryId: 'recover-second' });
  assert.equal(secondResult.status, 'synced');
  const second = W.droppedForFile(store.workspace, input.filepath, 'Thai');
  assert.ok(second && second.id !== first.id);
  assert.equal(store.workspace.droppedArchive[first.id].status, 'discarded');
  const replay = await client.registerDroppedCandidate(input);
  assert.equal(replay.candidate.id, first.id); assert.equal(replay.candidate.status, 'discarded');
  assert.equal(W.droppedForFile(store.workspace, input.filepath, 'Thai').id, second.id);
  const candidates = await client.api('/dropped?' + new URLSearchParams({ game: 'poe1', language: 'Thai', includeResolved: '1' }), {}, client.epoch);
  assert.equal(candidates.items.filter(candidate => candidate.status === 'dropped').length, 1);
  assert.equal(candidates.items.filter(candidate => candidate.status === 'discarded').length, 1);
  assert.equal(store.workspace.droppedOutbox.length, 0);
});
