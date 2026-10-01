const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/collaborationProtocol.js');
const { Client, PresenceClient } = require('../public/collaborationSync.js');
const copy = structuredClone;
const source = [
  { filepath: 'a.txt', name: '', stats: ['a'], variables: ['#', '#'], remarks: ['', ''], translations: { English: ['One {0}', 'Two {0}'], Thai: ['one', 'two'] } },
  { filepath: 'b.txt', name: '', stats: ['b'], variables: ['#'], remarks: [''], translations: { English: ['Three {0}'], Thai: ['three'] } },
];
const initial = source.map(desc => ({ filepath: desc.filepath, translations: desc.translations.Thai, needsReview: false, trackedForExport: false, revision: 1 }));
function storeFixture() {
  return { state: null, workspace: null, revisions: [], fail: false,
    async updateCollaborationState(fn, options = {}) {
      if (this.fail) throw new Error('Storage quota exceeded');
      const next = fn(copy(this.state));
      let workspace = Object.hasOwn(options, 'workspace') ? copy(options.workspace) : copy(this.workspace);
      if (options.projectWorkspace) workspace = options.projectWorkspace(workspace, next);
      const revisions = this.revisions.concat(copy(options.revisions || []));
      this.state = copy(next); this.workspace = copy(workspace); this.revisions = revisions;
      return copy(this.state);
    },
  };
}
function coordinatedStoreFixture() {
  return { state: null, workspace: { descs: copy(source), status: {} }, generation: 0, revision: 0, revisions: [], receipts: new Set(),
    async getCollaborationState() { return copy(this.state); },
    async updateCollaborationState(fn, options = {}) {
      if (options.generation !== undefined && options.generation !== this.generation) throw Object.assign(new Error('Source changed'), { code: 'SOURCE_GENERATION_CHANGED' });
      const snapshot = { workspace: copy(this.workspace), source: copy(source), generation: this.generation, revision: this.revision };
      if (!options.requestId || !this.receipts.has(options.requestId)) {
        const state = fn(copy(this.state), snapshot);
        const workspace = options.projectWorkspace ? options.projectWorkspace(snapshot.workspace, state, snapshot) : snapshot.workspace;
        this.state = copy(state); this.workspace = copy(workspace); this.revision++;
        this.revisions.push(...copy(options.revisions || []));
        if (options.requestId) this.receipts.add(options.requestId);
      }
      return options.returnSnapshot ? { state: copy(this.state), workspace: copy(this.workspace), generation: this.generation, revision: this.revision } : copy(this.state);
    },
  };
}
async function localFixture(store = coordinatedStoreFixture(), language = 'Thai') {
  const client = new Client({ store, request: async () => { throw new Error('Local-only client must not call the server'); }, WebSocket: null });
  await client.connect({ localOnly: true, accountId: 'guest', game: 'poe1', language, generation: store.generation,
    source, files: initial, workspace: store.workspace });
  return { client, store };
}
function serverFixture() {
  const server = { files: copy(initial), sequence: 1, events: [], receipts: new Map(), requests: [], offline: false, exists: true,
    snapshot() { return { roomId: 'room', game: 'poe1', language: 'Thai', sequence: this.sequence, files: copy(this.files) }; },
    change(filepath, translations) {
      const file = this.files.find(row => row.filepath === filepath); file.translations = copy(translations); file.revision++;
      this.events.push({ sequence: ++this.sequence, files: [copy(file)] });
    },
    async request(path, options = {}) {
      this.requests.push({ path, options: copy(options) });
      if (this.offline) throw new Error('Network unavailable');
      const body = options.body;
      if (path.endsWith('/join')) {
        if (!this.exists) throw Object.assign(new Error('Room missing'), { status: 404 });
        return this.snapshot();
      }
      if (path.endsWith('/uploads') && !path.includes('/rooms/')) { this.upload = []; return { uploadId: 'upload' }; }
      if (path.endsWith('/uploads/upload') && !options.method) return { uploadId: 'upload', receivedChunks: [] };
      if (path.includes('/chunks/')) {
        assert.ok(body.files.every(file => !Object.hasOwn(file, 'revision')), 'seed does not include unsupported revision');
        this.upload.push(...copy(body.files)); return {};
      }
      if (path.endsWith('/finalize')) {
        this.files = this.upload.map(file => P.fileState({ ...file, revision: 1 })); this.exists = true;
        return { ...this.snapshot(), created: true };
      }
      if (path.endsWith('/snapshot')) return this.snapshot();
      if (path.includes('/changes?')) return { roomId: 'room', sequence: this.sequence, events: copy(this.events.filter(event => event.sequence > Number(path.split('after=')[1]))), hasMore: false };
      if (path.endsWith('/mutations')) {
        if (this.receipts.has(body.mutationId)) {
          assert.deepEqual(body, this.receipts.get(body.mutationId).body, 'uncertain mutation retries must retain exact request');
          return copy(this.receipts.get(body.mutationId).result);
        }
        if (body.files.some(file => this.files.find(row => row.filepath === file.filepath).revision !== file.baseRevision)) {
          throw Object.assign(new Error('Revision conflict'), { status: 409, current: this.snapshot() });
        }
        const files = body.files.map(file => {
          const next = P.fileState({ ...file, revision: file.baseRevision + 1, trackedForExport: true });
          this.files[this.files.findIndex(row => row.filepath === file.filepath)] = next; return copy(next);
        });
        const result = { roomId: 'room', sequence: ++this.sequence, files };
        this.events.push(copy(result)); this.receipts.set(body.mutationId, { body: copy(body), result });
        if (this.loseReply) { this.loseReply = false; throw new Error('Connection closed after commit'); }
        return copy(result);
      }
      throw new Error('Unexpected endpoint ' + path);
    },
  };
  return server;
}
let nextId = 0;
async function fixture(options = {}) {
  const store = options.store || storeFixture(); const server = options.server || serverFixture();
  const remote = [];
  const client = new Client({ store, request: server.request.bind(server), WebSocket: null, uuid: () => 'mutation-' + ++nextId,
    onRemote: files => remote.push(copy(files)) });
  await client.connect({ accountId: options.accountId || 'user', game: 'poe1', language: 'Thai', source, files: options.files || initial,
    workspace: { descs: copy(source), status: {}, unrelated: 'preserve' } });
  return { client, store, server, remote };
}

test('source hash ignores order and translations, includes every canonical source field', async () => {
  const hash = await P.sourceHash(source);
  const translated = copy(source).reverse(); translated[0].translations.Thai = ['different']; translated[0].hasChanges = true;
  assert.equal(await P.sourceHash(translated), hash);
  assert.match(hash, /^[a-f0-9]{64}$/);
  for (const field of ['filepath', 'name', 'stats', 'variables', 'remarks']) {
    const changed = copy(source);
    if (Array.isArray(changed[0][field])) changed[0][field][0] += 'x'; else changed[0][field] += 'x';
    assert.notEqual(await P.sourceHash(changed), hash, field);
  }
  const changed = copy(source); changed[0].translations.English[0] += '!';
  assert.notEqual(await P.sourceHash(changed), hash);
  assert.notEqual(await P.sourceHash(source.slice(1)), hash);
  assert.notEqual(P.scopeKey({ accountId: 'u', game: 'poe1', sourceHash: hash, language: 'Thai' }), P.scopeKey({ accountId: 'u', game: 'poe2', sourceHash: hash, language: 'Thai' }));
});

test('malformed source is rejected before creating a workspace', async () => {
  for (const bad of [[], [false], [source[0], source[0]], [{ ...source[0], variables: [] }], [{ ...source[0], filepath: '../bad.txt' }]]) {
    await assert.rejects(P.sourceHash(bad), /source/i);
  }
});

test('merge uses entire entries, preserves deliberate blanks, and merges disjoint edits', () => {
  const base = initial[0];
  const yours = { ...base, translations: ['', 'two'] };
  const shared = { ...base, translations: ['one', 'remote\nwhole@table'] };
  assert.deepEqual(P.mergeFile(base, yours, shared).file.translations, ['', 'remote\nwhole@table']);
  assert.equal(P.mergeFile(base, yours, shared).conflict, false);
  const conflict = P.mergeFile(base, yours, { ...shared, translations: ['remote', 'two'] });
  assert.deepEqual(conflict.indexes, [0]);
});

test('first translator seeds a new workspace with bounded upload files', async () => {
  const server = serverFixture(); server.exists = false;
  const { client } = await fixture({ server });
  assert.equal(client.snapshot().roomId, 'room');
  assert.equal(client.snapshot().conflicts.length, 0);
  assert.deepEqual(server.upload.map(file => file.filepath), ['a.txt', 'b.txt']);
  assert.deepEqual(server.requests.find(request => request.path.endsWith('/uploads')).options.body,
    { game: 'poe1', sourceHash: await P.sourceHash(source), language: 'Thai' });
  client.destroy();
});

test('first join differences require comparison and preserve a recovery copy without publishing', async () => {
  const files = copy(initial); files[0].translations[0] = 'my old workspace';
  const { client, server, store } = await fixture({ files });
  const conflict = client.snapshot().conflicts[0];
  assert.equal(conflict.kind, 'join'); assert.equal(conflict.base, null);
  assert.equal(server.receipts.size, 0);
  assert.equal(Object.values(store.state.rooms)[0].recovery[0].files[0].translations[0], 'my old workspace');
  const result = await client.resolve(conflict.id, conflict.shared.translations);
  assert.equal(result.status, 'synced');
  assert.deepEqual(client.fileBase('a.txt').translations, initial[0].translations);
  assert.equal(server.receipts.size, 0, 'adopting the shared copy never changes its export status or creates a server mutation');
  client.destroy();
});

test('save atomically persists working data, recovery history and an offline retry operation', async () => {
  const { client, store, server } = await fixture(); server.offline = true;
  const file = { ...client.fileBase('a.txt'), translations: ['local', 'two'] };
  const result = await client.save({ workspace: store.workspace, revisions: [{ filepath: 'a.txt', lang: 'Thai', translations: ['local', 'two'] }], files: [file] });
  assert.equal(result.status, 'pending'); assert.equal(store.revisions.length, 1);
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'local');
  assert.equal(Object.values(store.state.rooms)[0].outbox.length, 1);
  store.fail = true;
  await assert.rejects(client.save({ files: [{ ...file, translations: ['lost?', 'two'] }], revisions: [{}] }), /quota/);
  assert.equal(client.fileBase('a.txt').translations[0], 'local'); assert.equal(store.revisions.length, 1);
  client.destroy();
});

test('captured editor base merges independent remote edits and detects overlapping edits', async () => {
  const { client, server } = await fixture(); const base = client.fileBase('a.txt');
  server.change('a.txt', ['one', 'remote second']); await client.sync();
  const result = await client.save({ bases: { 'a.txt': base }, files: [{ ...base, translations: ['my first', 'two'] }] });
  assert.equal(result.status, 'synced'); assert.deepEqual(server.files[0].translations, ['my first', 'remote second']);
  assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).at(-1).options.body.origin, 'merge');
  const before = client.fileBase('a.txt'); server.change('a.txt', ['theirs', 'remote second']);
  const conflict = await client.save({ bases: { 'a.txt': before }, files: [{ ...before, translations: ['mine', 'remote second'] }] });
  assert.equal(conflict.status, 'conflict'); assert.deepEqual(client.snapshot().conflicts[0].indexes, [0]);
  client.destroy();
});

test('origin labels distinguish plain saves and bulk imports from ordinary automatic entry merges', async () => {
  const { client, server } = await fixture();
  await client.save({ files: [{ ...client.fileBase('a.txt'), translations: ['plain save', 'two'] }] });
  assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).at(-1).options.body.origin, 'save');
  const base = client.fileBase('a.txt'); server.change('a.txt', ['plain save', 'independent remote']);
  await client.save({ origin: 'import', bases: { 'a.txt': base }, files: [{ ...base, translations: ['imported first', 'two'] }] });
  assert.deepEqual(server.files[0].translations, ['imported first', 'independent remote']);
  assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).at(-1).options.body.origin, 'import');
  client.destroy();
});

test('a conflicted file does not block unrelated files while a bulk operation stays atomic', async () => {
  const { client, server } = await fixture(); const base = client.fileBase('a.txt');
  server.change('a.txt', ['remote', 'two']);
  await client.save({ bases: { 'a.txt': base }, files: [{ ...base, translations: ['local', 'two'] }] });
  const other = client.fileBase('b.txt');
  assert.equal((await client.save({ files: [{ ...other, translations: ['other change'] }] })).status, 'synced');
  assert.equal(server.files[1].translations[0], 'other change');
  const bulk = await client.save({ files: [{ ...client.fileBase('a.txt'), translations: ['later local', 'two'] }, { ...client.fileBase('b.txt'), translations: ['bulk pending'] }] });
  assert.equal(bulk.status, 'conflict'); assert.equal(server.files[1].translations[0], 'other change');
  client.destroy();
});

test('lost mutation replies retry the exact durable payload once and retain incoming cursor integrity', async () => {
  const { client, server } = await fixture(); server.loseReply = true;
  const result = await client.save({ files: [{ ...client.fileBase('a.txt'), translations: ['changed', 'two'] }] });
  assert.equal(result.status, 'pending'); assert.equal(server.receipts.size, 1);
  server.change('b.txt', ['external change']);
  await client.sync();
  assert.equal(client.snapshot().pending, 0); assert.equal(server.receipts.size, 1);
  assert.equal(client.fileBase('b.txt').translations[0], 'external change');
  assert.equal(client.snapshot().sequence, server.sequence);
  client.destroy();
});

test('conflict resolutions refresh the shared revision and require comparison again after overlap', async () => {
  const { client, server } = await fixture(); const base = client.fileBase('a.txt');
  server.change('a.txt', ['first remote', 'two']);
  await client.save({ bases: { 'a.txt': base }, files: [{ ...base, translations: ['mine', 'two'] }] });
  const conflict = client.snapshot().conflicts[0];
  server.change('a.txt', ['second remote', 'two']);
  assert.equal((await client.resolve(conflict.id, ['resolution', 'two'])).status, 'conflict');
  assert.equal(client.snapshot().conflicts[0].shared.translations[0], 'second remote');
  assert.equal((await client.resolve(conflict.id, ['agreed result', 'two'])).status, 'synced');
  assert.equal(server.files[0].translations[0], 'agreed result');
  assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).at(-1).options.body.origin, 'conflict_resolution');
  client.destroy();
});

test('review confirmation requires the exact translation the reviewer saw', async () => {
  const { client, server } = await fixture(); const base = client.fileBase('a.txt');
  server.change('a.txt', ['one', 'remote changed']);
  const result = await client.save({ origin: 'confirm', bases: { 'a.txt': base }, files: [{ ...base, needsReview: false }] });
  assert.equal(result.status, 'conflict'); assert.equal(server.receipts.size, 0);
  client.destroy();
});

test('reconnecting recovers account-scoped pending saves and preserves previous room queues', async () => {
  const { client, store, server } = await fixture(); server.offline = true;
  await client.save({ files: [{ ...client.fileBase('a.txt'), translations: ['pending for first user', 'two'] }] });
  const savedFiles = client.snapshot().files;
  client.destroy();
  const other = await fixture({ store, server, accountId: 'other-user' });
  assert.equal(other.client.snapshot().pending, 0); assert.equal(Object.keys(store.state.rooms).length, 2);
  other.client.destroy(); server.offline = false;
  const resumed = await fixture({ store, server, files: savedFiles });
  assert.equal(resumed.client.snapshot().pending, 0); assert.equal(server.files[0].translations[0], 'pending for first user');
  resumed.client.destroy();
});

test('disconnect invalidates in-flight replies and offline editing claims remain available', async () => {
  const { client, server } = await fixture();
  assert.equal((await client.claim('a.txt')).granted, true);
  let release; const previous = server.request.bind(server);
  client.request = async (path, options) => { await new Promise(resolve => { release = resolve; }); return previous(path, options); };
  const syncing = client.sync(); await new Promise(setImmediate); client.disconnect(); release(); await syncing;
  assert.equal(client.snapshot().roomId, null); assert.equal(client.snapshot().files.length, 0);
  client.destroy();
});

test('returning to the same source after signed-out edits preserves both versions for comparison', async () => {
  const { client, store, server } = await fixture();
  const baseline = client.snapshot().files; client.destroy();
  const changed = copy(baseline); changed[0].translations[0] = 'saved while signed out';
  const resumed = await fixture({ store, server, files: changed });
  assert.equal(resumed.client.snapshot().conflicts.length, 1);
  assert.equal(resumed.client.snapshot().conflicts[0].yours.translations[0], 'saved while signed out');
  assert.equal(server.files[0].translations[0], 'one');
  assert.equal(Object.values(store.state.rooms)[0].recovery.at(-1).reason, 'Local workspace changed while disconnected');
  resumed.client.destroy();
});

test('revoked access leaves durable local work queued and rejects save success', async () => {
  const { client, store } = await fixture();
  client.request = async () => { throw Object.assign(new Error('Language access revoked'), { status: 403 }); };
  await assert.rejects(client.save({ files: [{ ...client.fileBase('a.txt'), translations: ['local safe', 'two'] }] }), /revoked/);
  assert.equal(client.snapshot().pending, 1); assert.equal(store.workspace.descs[0].translations.Thai[0], 'local safe');
  client.destroy();
});

test('a save queued during catch-up waits for conflict detection before reporting navigation success', async () => {
  const { client, server } = await fixture(); const base = client.fileBase('a.txt');
  server.change('a.txt', ['shared changed', 'two']);
  const original = client.request; let release; let delayed = false;
  client.request = async (...args) => {
    if (!delayed && args[0].includes('/changes?')) { delayed = true; await new Promise(resolve => { release = resolve; }); }
    return original(...args);
  };
  const running = client.sync(); await new Promise(setImmediate);
  const saving = client.save({ bases: { 'a.txt': base }, files: [{ ...base, translations: ['local changed', 'two'] }] });
  await Promise.resolve(); release();
  await running; assert.equal((await saving).status, 'conflict');
  client.destroy();
});

test('an opened conflict revision cannot overwrite a newer conflict preview', async () => {
  const { client, server } = await fixture(); const base = client.fileBase('a.txt');
  server.change('a.txt', ['remote old', 'two']);
  await client.save({ files: [{ ...base, translations: ['mine', 'two'] }], bases: { 'a.txt': base } });
  const old = copy(client.snapshot().conflicts[0]); server.change('a.txt', ['remote new', 'two']); await client.sync();
  assert.equal(client.snapshot().conflicts[0].shared.translations[0], 'remote new');
  assert.equal((await client.resolve(old.id, ['stale resolution', 'two'], { sharedRevision: old.shared.revision })).status, 'conflict');
  assert.equal(server.files[0].translations[0], 'remote new'); client.destroy();
});

test('late old-source updates retain their room cache without changing a newly imported workspace', async () => {
  const { client, store, server } = await fixture();
  store.workspace = { sourceHash: 'new-source-hash', descs: [{ filepath: 'new.txt', translations: { Thai: ['new archive'] } }], status: {} };
  const expected = copy(store.workspace);
  server.change('a.txt', ['late old room', 'two']); await client.sync();
  assert.deepEqual(store.workspace, expected);
  await client.save({ workspace: { sourceHash: client.snapshot().identity.sourceHash, descs: copy(source), status: {} },
    files: [{ ...client.fileBase('a.txt'), translations: ['old local work', 'two'] }] });
  assert.deepEqual(store.workspace, expected); assert.equal(client.fileBase('a.txt').translations[0], 'old local work');
  client.destroy();
});

test('late old-account updates cannot replace the new account working workspace', async () => {
  const { client, store, server } = await fixture();
  store.workspace.collaborationAccountId = 'different-user';
  const expected = copy(store.workspace); server.change('a.txt', ['old account update', 'two']); await client.sync();
  assert.deepEqual(store.workspace, expected); assert.equal(client.fileBase('a.txt').translations[0], 'old account update');
  client.destroy();
});

test('stale save snapshots preserve another tab unrelated working data', async () => {
  const { client, store } = await fixture(); const staleWorkspace = copy(store.workspace);
  store.workspace.descs.find(file => file.filepath === 'b.txt').translations.Thai = ['other tab'];
  store.workspace.status['b.txt'] = { needsReview: true, preserved: true };
  await client.save({ workspace: staleWorkspace, files: [{ ...client.fileBase('a.txt'), translations: ['own edit', 'two'] }] });
  assert.deepEqual(store.workspace.descs.find(file => file.filepath === 'b.txt').translations.Thai, ['other tab']);
  assert.equal(store.workspace.status['b.txt'].preserved, true); client.destroy();
});

test('restoring a server backup compares locally cached newer content before accepting the older snapshot', async () => {
  const { client, server } = await fixture();
  await client.save({ files: [{ ...client.fileBase('a.txt'), translations: ['newer saved text', 'two'] }] });
  await client.sync();
  server.files = copy(initial); server.sequence = 1; server.events = [];
  const original = client.request;
  client.request = async (path, options) => {
    if (path.includes('/changes?') && Number(path.split('after=')[1]) > 1) throw Object.assign(new Error('Cursor is newer than backup'), { status: 409, code: 'CURSOR_INVALID' });
    return original(path, options);
  };
  await client.sync();
  assert.equal(client.snapshot().sequence, 1); assert.equal(client.snapshot().conflicts.length, 1);
  assert.equal(client.snapshot().conflicts[0].yours.translations[0], 'newer saved text');
  assert.equal(server.files[0].translations[0], 'one'); client.destroy();
});

test('away presence is retained offline, sent once per transition, and restored after reconnect', async () => {
  const { client } = await fixture();
  const sockets = [];
  class Socket {
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    open() { this.readyState = 1; this.onopen(); }
    close() { this.readyState = 3; }
    receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  const request = client.request;
  client.request = (path, options) => path.endsWith('/ticket') ? Promise.resolve({ ticket: 'ticket', url: '/v1/collaboration/ws?ticket=ticket' }) : request(path, options);
  client.apiBase = 'http://127.0.0.1:3333'; client.WebSocket = Socket;
  client.setAway(true);
  assert.equal(client.snapshot().away, true); assert.equal(client.connected, false);
  await client.openSocket(client.epoch); sockets[0].open(); await client.running;
  assert.deepEqual(sockets[0].sent.filter(message => message.type === 'activity'), [{ type: 'activity', away: true }]);
  client.setAway(true);
  assert.equal(sockets[0].sent.filter(message => message.type === 'activity').length, 1);
  sockets[0].receive({ type: 'presence', selfId: 'self', peers: [
    { sessionId: 'self', name: 'Me', away: true }, { sessionId: 'other', name: 'Other', away: false },
  ] });
  assert.equal(client.snapshot().peers.find(peer => peer.sessionId === 'self').away, true);
  client.closeSocket(); await client.openSocket(client.epoch); sockets[1].open(); await client.running;
  assert.deepEqual(sockets[1].sent.filter(message => message.type === 'activity'), [{ type: 'activity', away: true }]);
  client.setAway(false); client.setAway(false);
  assert.equal(client.snapshot().away, false);
  assert.deepEqual(sockets[1].sent.filter(message => message.type === 'activity'), [{ type: 'activity', away: true }, { type: 'activity', away: false }]);
  client.destroy();
});

test('collaboration keeps failed sync visible while another durable save retries', async t => {
  const { client, server, store } = await fixture();
  t.after(() => client.destroy());
  const statuses = []; client.onStatus = status => statuses.push(status);
  server.offline = true;
  await client.sync();
  assert.equal(statuses.at(-1).error, true);
  const count = statuses.length;
  server.offline = false;
  let entered, release;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const request = client.request;
  client.request = async (path, options) => {
    if (path.includes('/changes?')) { entered(); await gate; }
    return request(path, options);
  };
  const save = client.save({ files: [{ ...client.fileBase('a.txt'), translations: ['quiet pending save', 'two'] }] });
  await waiting;
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'quiet pending save');
  assert.equal(statuses.length, count, 'Durable queue updates and retry starts do not hide the failure.');
  release();
  await save;
  assert.deepEqual(statuses.at(-1), { message: '', error: false });
  assert.equal(client.snapshot().pending, 0);
});

test('initial socket connection is quiet but a real disconnect persists until the socket reopens', async t => {
  const { client } = await fixture();
  t.after(() => client.destroy());
  const sockets = [];
  class Socket {
    constructor() { this.readyState = 0; sockets.push(this); }
    send() {}
    open() { this.readyState = 1; this.onopen(); }
    close() { this.readyState = 3; }
    drop() { this.readyState = 3; this.onclose(); }
  }
  const request = client.request;
  client.request = (path, options) => path.endsWith('/ticket') ? Promise.resolve({ ticket: 'ticket' }) : request(path, options);
  client.apiBase = 'http://127.0.0.1:3333'; client.WebSocket = Socket;
  await client.sync();
  assert.equal(client.snapshot().connected, false);
  assert.equal(client.snapshot().disconnected, false);
  sockets[0].open(); await client.running;
  sockets[0].drop();
  assert.equal(client.snapshot().disconnected, true);
  await client.sync();
  assert.equal(client.snapshot().disconnected, true, 'HTTP recovery cannot claim presence has reconnected.');
  sockets[1].open(); await client.running;
  assert.equal(client.snapshot().disconnected, false);
  assert.equal(client.snapshot().connected, true);
  client.disconnect();
  assert.equal(client.snapshot().disconnected, false, 'Leaving a workspace is not an unexpected disconnect.');
});

test('signed-out tabs merge authored entries and files against the transaction workspace', async t => {
  const { client, store } = await localFixture(); t.after(() => client.destroy());
  const firstBase = client.fileBase('a.txt'), otherBase = client.fileBase('b.txt');
  await client.save({ requestId: 'tab-one:1', bases: { 'a.txt': firstBase }, files: [{ ...firstBase, translations: ['first tab', 'two'] }] });
  const second = await client.save({ requestId: 'tab-two:1', bases: { 'a.txt': firstBase }, files: [{ ...firstBase, translations: ['one', 'second tab'] }] });
  await client.save({ bases: { 'b.txt': otherBase }, files: [{ ...otherBase, translations: ['another file'] }] });
  assert.deepEqual(second.workspace.descs[0].translations.Thai, ['first tab', 'second tab']);
  assert.deepEqual(store.workspace.descs.map(desc => desc.translations.Thai), [['first tab', 'second tab'], ['another file']]);
  assert.equal(client.snapshot().pending, 0);
});

test('overlapping local tab edits retain the saved text and both comparison candidates', async t => {
  const { client, store } = await localFixture(); t.after(() => client.destroy());
  const base = client.fileBase('a.txt');
  await client.save({ bases: { 'a.txt': base }, files: [{ ...base, translations: ['saved first', 'two'] }] });
  const result = await client.save({ requestId: 'second-save', bases: { 'a.txt': base }, files: [{ ...base, translations: ['second candidate', 'two'] }] });
  assert.equal(result.status, 'conflict');
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'saved first');
  const conflict = client.snapshot().conflicts[0];
  assert.equal(conflict.yours.translations[0], 'second candidate'); assert.equal(conflict.shared.translations[0], 'saved first');
  await client.resolve(conflict.id, ['combined result', 'two'], { requestId: 'resolve-once' });
  await client.resolve(conflict.id, ['combined result', 'two'], { requestId: 'resolve-once' });
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'combined result');
  assert.equal(store.revisions.length, 1, 'lost resolution acknowledgement does not duplicate history');
  assert.equal(client.snapshot().conflicts.length, 0);
});

test('different language scopes preserve each other within one shared workspace', async t => {
  const { client: thai, store } = await localFixture(); t.after(() => thai.destroy());
  const { client: french } = await localFixture(store, 'French'); t.after(() => french.destroy());
  const thaiBase = thai.fileBase('a.txt'), frenchBase = french.fileBase('a.txt');
  await thai.save({ bases: { 'a.txt': thaiBase }, files: [{ ...thaiBase, translations: ['ไทย', 'สอง'] }] });
  const result = await french.save({ bases: { 'a.txt': frenchBase }, files: [{ ...frenchBase, translations: ['Un', 'Deux'] }] });
  assert.deepEqual(result.workspace.descs[0].translations.Thai, ['ไทย', 'สอง']);
  assert.deepEqual(result.workspace.descs[0].translations.French, ['Un', 'Deux']);
});

test('a restarted coordinator replays save receipts without duplicating revisions', async t => {
  const { client, store } = await localFixture();
  const base = client.fileBase('a.txt');
  const request = { requestId: 'tab:request', generation: 0, bases: { 'a.txt': base }, files: [{ ...base, translations: ['durable', 'two'] }], revisions: [{ filepath: 'a.txt' }] };
  await client.save(request); client.destroy();
  const { client: reopened } = await localFixture(store); t.after(() => reopened.destroy());
  const result = await reopened.save(request);
  assert.equal(store.revisions.length, 1); assert.equal(result.status, 'synced');
  assert.equal(result.workspace.descs[0].translations.Thai[0], 'durable');
});

test('source replacement fences old clients and same-source reopen starts a new generation', async t => {
  const { client, store } = await localFixture(); t.after(() => client.destroy());
  const base = client.fileBase('a.txt');
  store.generation++;
  for (const room of Object.values(store.state.rooms)) room.recoveryOnly = true;
  await assert.rejects(client.save({ files: [{ ...base, translations: ['obsolete', 'two'] }] }), { code: 'SOURCE_GENERATION_CHANGED' });
  const { client: next } = await localFixture(store); t.after(() => next.destroy());
  assert.equal(next.room().generation, 1);
  assert.equal(Object.values(store.state.rooms).filter(room => room.recoveryOnly).length, 1);
  assert.equal(next.fileBase('a.txt').translations[0], 'one');
});

test('deferred worker saves acknowledge durable storage while the network is stalled', async t => {
  const store = coordinatedStoreFixture(), server = serverFixture();
  const { client } = await fixture({ store, server }); t.after(() => client.destroy());
  client.deferredSync = true;
  let release;
  client.request = async () => { await new Promise(resolve => { release = resolve; }); throw new Error('Offline'); };
  const base = client.fileBase('a.txt');
  const result = await client.save({ requestId: 'fast-save', bases: { 'a.txt': base }, files: [{ ...base, translations: ['already durable', 'two'] }] });
  assert.equal(result.status, 'pending'); assert.equal(result.workspace.descs[0].translations.Thai[0], 'already durable');
  await new Promise(setImmediate); release(); await client.running;
});

test('presence clients retain independent tab selections and editing claims', async t => {
  const sockets = [];
  class Socket {
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    open() { this.readyState = 1; this.onopen(); }
    close() { this.readyState = 3; }
  }
  let changed = 0;
  const options = { request: async () => ({ ticket: 'ticket' }), apiBase: 'https://example.test', WebSocket: Socket, onChanged: async () => { changed++; } };
  const first = new PresenceClient(options), second = new PresenceClient(options);
  t.after(() => { first.destroy(); second.destroy(); });
  const identity = { accountId: 'a', game: 'poe1', sourceHash: 'hash', language: 'Thai' };
  await first.connect({ roomId: 'room', identity }); await second.connect({ roomId: 'room', identity });
  first.select('a.txt'); second.select('b.txt'); first.setAway(true);
  sockets.forEach(socket => socket.open()); await new Promise(setImmediate);
  assert.equal(sockets[0].sent.find(message => message.type === 'select').filepath, 'a.txt');
  assert.equal(sockets[1].sent.find(message => message.type === 'select').filepath, 'b.txt');
  assert.equal(second.snapshot().away, false); assert.equal(changed, 2);
  const claim = first.claim('a.txt');
  const sent = sockets[0].sent.find(message => message.type === 'claim');
  sockets[0].onmessage({ data: JSON.stringify({ type: 'claim-result', requestId: sent.requestId, granted: true }) });
  assert.equal((await claim).granted, true); assert.equal(second.editing, null);
});

test('a conflicting bulk save applies no sibling files or accepted history until all comparisons resolve', async t => {
  const { client, store } = await localFixture(); t.after(() => client.destroy());
  const first = client.fileBase('a.txt'), second = client.fileBase('b.txt');
  await client.save({ files: [{ ...first, translations: ['peer first', 'two'] }], bases: { 'a.txt': first } });
  const batch = { requestId: 'bulk', origin: 'consistency', bases: { 'a.txt': first, 'b.txt': second },
    files: [{ ...first, translations: ['bulk first', 'two'] }, { ...second, translations: ['bulk second'] }],
    revisions: [{ filepath: 'a.txt', note: 'Before consistency resolution', translations: first.translations },
      { filepath: 'a.txt', note: 'Consistency resolution', translations: ['bulk first', 'two'] },
      { filepath: 'b.txt', note: 'Consistency resolution', translations: ['bulk second'] }] };
  const pending = await client.save(batch);
  assert.equal(pending.status, 'conflict'); assert.equal(store.workspace.descs[1].translations.Thai[0], 'three');
  assert.equal(store.revisions.length, 0); assert.equal(client.room().recovery.at(-1).files[1].translations[0], 'bulk second');
  // A file that initially merged cleanly changes while the first comparison is open.
  await client.save({ files: [{ ...second, translations: ['peer second'] }], bases: { 'b.txt': second } });
  const firstConflict = client.snapshot().conflicts.find(conflict => conflict.filepath === 'a.txt');
  const partial = await client.resolve(firstConflict.id, ['agreed first', 'two']);
  assert.equal(partial.status, 'conflict'); assert.equal(store.workspace.descs[0].translations.Thai[0], 'peer first');
  assert.equal(store.revisions.length, 0);
  const secondConflict = client.snapshot().conflicts.find(conflict => conflict.filepath === 'b.txt');
  await client.resolve(secondConflict.id, ['agreed second']);
  assert.deepEqual(store.workspace.descs.map(desc => desc.translations.Thai), [['agreed first', 'two'], ['agreed second']]);
  assert.deepEqual(store.revisions.map(revision => revision.translations), [first.translations, ['agreed first', 'two'], ['agreed second']]);
});

test('local history records the accepted merged text including independent peer entries', async t => {
  const { client, store } = await localFixture(); t.after(() => client.destroy());
  const base = client.fileBase('a.txt');
  await client.save({ files: [{ ...base, translations: ['peer', 'two'] }], bases: { 'a.txt': base } });
  await client.save({ files: [{ ...base, translations: ['one', 'own'] }], bases: { 'a.txt': base },
    revisions: [{ filepath: 'a.txt', translations: ['one', 'own'], note: 'Save translation' }] });
  assert.deepEqual(store.revisions[0].translations, ['peer', 'own']);
});

test('choosing the shared join copy records resolution identity for lost-ack replay', async t => {
  const store = coordinatedStoreFixture(); store.workspace.descs[0].translations.Thai[0] = 'preexisting local';
  const { client } = await fixture({ store }); t.after(() => client.destroy());
  const conflict = client.snapshot().conflicts[0];
  await client.resolve(conflict.id, conflict.shared.translations, { requestId: 'adopt-shared' });
  const result = await client.resolve(conflict.id, conflict.shared.translations, { requestId: 'adopt-shared' });
  assert.equal(result.status, 'synced'); assert.equal(store.revisions.length, 0);
});

test('a surviving sync client reloads and uploads another closed client durable queue', async t => {
  const store = coordinatedStoreFixture(), server = serverFixture();
  const first = await fixture({ store, server }), survivor = await fixture({ store, server });
  t.after(() => { first.client.destroy(); survivor.client.destroy(); });
  server.offline = true;
  const base = first.client.fileBase('a.txt');
  await first.client.save({ requestId: 'closed-tab-save', files: [{ ...base, translations: ['upload after close', 'two'] }], bases: { 'a.txt': base } });
  assert.equal(survivor.client.snapshot().pending, 0, 'surviving client initially holds a stale queue snapshot');
  first.client.destroy(); server.offline = false;
  await survivor.client.retry();
  assert.equal(server.files[0].translations[0], 'upload after close');
  assert.equal(server.receipts.size, 1); assert.equal(survivor.client.snapshot().pending, 0);
});
