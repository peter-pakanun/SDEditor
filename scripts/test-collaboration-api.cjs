/* Cross-repository integration check. Run with SDEditor-API installed beside this repository. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createRequire } = require('node:module');
const { Client } = require('../public/collaborationSync.js');
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
  for (let index = 0; index < clients.length; index++) await clients[index].connect({ accountId: users[index].user.id,
    game: 'poe1', language: 'Thai', source, files, workspace: { descs: copy(source), status: {} } });
  const [a, b] = clients; await until(() => a.connected && b.connected && a.peers.length === 2 && b.peers.length === 2);
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
