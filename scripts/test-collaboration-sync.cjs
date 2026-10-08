const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/collaborationProtocol.js');
const { Client } = require('../public/collaborationSync.js');
const { create: createPendingSaves } = require('../public/pendingSaves.js');
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

test('source hashing publishes pending progress before the digest and clears it when the hash completes', async t => {
  const store = storeFixture(), server = serverFixture(), release = gate(), entered = gate(), notifications = [];
  const originalHash = P.sourceHashAsync;
  const client = new Client({ store, request: server.request.bind(server), WebSocket: null,
    onChange: state => notifications.push(state) });
  t.after(() => { release.resolve(); P.sourceHashAsync = originalHash; client.destroy(); });
  P.sourceHashAsync = async (...args) => {
    assert.equal(client.snapshot().hashing, true, 'The footer can show progress before digest computation begins.');
    assert.equal(notifications.at(-1).hashing, true);
    entered.resolve(); await release.promise;
    return originalHash(...args);
  };
  assert.equal(client.snapshot().hashing, false);
  const connection = client.connect({ accountId: 'user', game: 'poe1', language: 'Thai', source, files: initial });
  await entered.promise;
  assert.equal(client.snapshot().hashing, true);
  assert.equal(client.snapshot().identity, null, 'A pending hash cannot be presented as a completed export version.');
  assert.equal(server.requests.length, 0, 'Joining a room waits for the completed hash.');
  release.resolve(); await connection;
  assert.equal(client.snapshot().hashing, false);
  assert.equal(client.snapshot().identity.sourceHash, await originalHash(source));
  assert.ok(notifications.some(state => state.hashing === false && state.identity?.sourceHash));
});

test('a rejected source digest clears hashing progress without creating a room', async t => {
  const store = storeFixture(), server = serverFixture(), release = gate(), entered = gate(), notifications = [], work = [];
  const originalHash = P.sourceHashAsync;
  const client = new Client({ store, request: server.request.bind(server), WebSocket: null,
    onChange: state => notifications.push(state), onWork: value => work.push(value) });
  t.after(() => { release.resolve(); P.sourceHashAsync = originalHash; client.destroy(); });
  P.sourceHashAsync = async () => { entered.resolve(); await release.promise; throw new Error('Digest unavailable'); };
  const connection = client.connect({ accountId: 'user', game: 'poe1', language: 'Thai', source, files: initial });
  const rejected = assert.rejects(connection, /Digest unavailable/);
  await entered.promise; assert.equal(client.snapshot().hashing, true);
  assert.equal(work.at(-1).active, true);
  release.resolve(); await rejected;
  assert.equal(client.snapshot().hashing, false);
  assert.equal(notifications.at(-1).hashing, false);
  assert.equal(store.state, null);
  assert.equal(server.requests.length, 0);
  assert.deepEqual(work.at(-1), { key: 'source', active: false });
});

test('disconnect clears hashing progress and ignores a digest that completes afterward', async t => {
  const store = storeFixture(), server = serverFixture(), release = gate(), entered = gate();
  const originalHash = P.sourceHashAsync;
  const client = new Client({ store, request: server.request.bind(server), WebSocket: null });
  t.after(() => { release.resolve(); P.sourceHashAsync = originalHash; client.destroy(); });
  P.sourceHashAsync = async (...args) => { entered.resolve(); await release.promise; return originalHash(...args); };
  const connection = client.connect({ accountId: 'user', game: 'poe1', language: 'Thai', source, files: initial });
  const rejected = assert.rejects(connection, error => error.stale === true);
  await entered.promise; assert.equal(client.snapshot().hashing, true);
  client.disconnect(); assert.equal(client.snapshot().hashing, false);
  release.resolve(); await rejected;
  assert.equal(client.snapshot().hashing, false);
  assert.equal(client.snapshot().identity, null);
  assert.equal(store.state, null);
  assert.equal(server.requests.length, 0);
});

test('an older digest cannot clear progress for a newer connection on the same client', async t => {
  const store = storeFixture(), server = serverFixture(), first = gate(), second = gate(), firstEntered = gate(), secondEntered = gate();
  const originalHash = P.sourceHashAsync;
  const client = new Client({ store, request: server.request.bind(server), WebSocket: null });
  t.after(() => { first.resolve(); second.resolve(); P.sourceHashAsync = originalHash; client.destroy(); });
  let calls = 0;
  P.sourceHashAsync = async (...args) => {
    const firstCall = ++calls === 1;
    (firstCall ? firstEntered : secondEntered).resolve();
    await (firstCall ? first : second).promise;
    return originalHash(...args);
  };
  const options = { accountId: 'user', game: 'poe1', language: 'Thai', source, files: initial };
  const oldConnection = client.connect(options);
  const oldRejected = assert.rejects(oldConnection, error => error.stale === true);
  await firstEntered.promise;
  const newConnection = client.connect(options);
  await secondEntered.promise;
  first.resolve(); await oldRejected;
  assert.equal(client.snapshot().hashing, true, 'Stale digest cleanup must leave the active connection pending.');
  assert.equal(client.snapshot().identity, null);
  second.resolve(); await newConnection;
  assert.equal(client.snapshot().hashing, false);
  assert.equal(client.snapshot().identity.sourceHash, await originalHash(source));
});

test('status notifications omit file contents without enumerating the archive', async () => {
  const { client } = await fixture();
  const room = client.room();
  let enumerations = 0;
  room.local = new Proxy(room.local, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
  const notifications = [];
  client.onChange = value => notifications.push(value);
  client.peers = [{ sessionId: 'other', selected: 'a.txt' }];
  const compact = client.snapshot({ includeFiles: false });
  client.notify();
  assert.equal(enumerations, 0, 'Presence and save-status changes cannot scan every saved translation.');
  assert.equal(Object.hasOwn(compact, 'files'), false);
  assert.equal(Object.hasOwn(notifications[0], 'files'), false);
  client.notify();
  assert.equal(notifications.length, 1, 'Identical compact state does not restart Vue rendering.');
  assert.equal(compact.roomId, 'room');
  assert.deepEqual(compact.identity, client.snapshot().identity);
  const complete = client.snapshot();
  assert.equal(complete.files.length, source.length, 'Explicit public snapshots still include all files.');
  complete.files[0].translations[0] = 'snapshot-only edit';
  assert.equal(client.fileBase('a.txt').translations[0], 'one');
  client.destroy();
});

test('unchanged collaboration passes avoid full file snapshots, storage writes and repeated healthy notices', async t => {
  const { client, store, remote } = await fixture(); t.after(() => client.destroy());
  let enumerations = 0, writes = 0, statuses = 0, notifications = 0;
  client.room().local = new Proxy(client.room().local, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
  const update = store.updateCollaborationState.bind(store);
  store.updateCollaborationState = (...args) => { writes++; return update(...args); };
  client.onStatus = () => { statuses++; }; client.onChange = () => { notifications++; }; remote.length = 0;
  for (let index = 0; index < 4; index++) assert.equal(Object.hasOwn(await client.sync(), 'files'), false);
  assert.deepEqual({ enumerations, writes, statuses, notifications, remote: remote.length },
    { enumerations: 0, writes: 0, statuses: 0, notifications: 0, remote: 0 });
});

test('healthy room sockets announce changes while background checks stay idle and disconnected fallback still catches up', async t => {
  const { client, server, sockets, connect } = presenceFixture(); t.after(() => client.destroy());
  await connect(); sockets[0].open(); await client.running;
  server.requests.length = 0;
  await client.sync({ background: true }); await client.sync({ background: true });
  assert.equal(server.requests.length, 0, 'A healthy websocket removes unchanged /changes polling.');
  server.change('a.txt', ['changed remotely', 'two']);
  sockets[0].receive({ type: 'changed', sequence: server.sequence }); await client.running;
  assert.deepEqual(client.fileBase('a.txt').translations, ['changed remotely', 'two']);
  const requests = server.requests.length;
  sockets[0].receive({ type: 'changed', sequence: server.sequence });
  assert.equal(server.requests.length, requests, 'A change hint already caught up does not repeat the request.');
  await client.sync(); assert.equal(server.requests.length, requests + 1, 'Focus/manual recovery still verifies the cursor.');
  sockets[0].drop(); server.change('a.txt', ['changed while disconnected', 'two']);
  await client.sync({ background: true });
  assert.deepEqual(client.fileBase('a.txt').translations, ['changed while disconnected', 'two']);
});

test('background recovery flushes queued saves even while the room websocket remains healthy', async t => {
  const { client, server, sockets, connect } = presenceFixture(); t.after(() => client.destroy());
  await connect(); sockets[0].open(); await client.running;
  server.offline = true;
  await client.save({ files: [{ ...client.fileBase('a.txt'), translations: ['queued save', 'two'] }], waitForSync: false });
  await client.running;
  assert.equal(client.connected, true); assert.equal(client.room().outbox.length, 1);
  server.offline = false;
  await client.sync({ background: true });
  assert.equal(client.room().outbox.length, 0);
  assert.deepEqual(server.files[0].translations, ['queued save', 'two']);
});

test('equivalent presence packets and healthy status reports retain observer state', async t => {
  const { client, sockets, connect } = presenceFixture(); t.after(() => client.destroy());
  await connect(); sockets[0].open(); await client.running;
  let notifications = 0; client.onChange = () => { notifications++; };
  const message = { type: 'presence', selfId: 'self', peers: [{ sessionId: 'self', userId: 'user', selected: 'a.txt' }] };
  sockets[0].receive(message); const peers = client.peers;
  sockets[0].receive(copy(message));
  assert.equal(client.peers, peers); assert.equal(notifications, 1);
  sockets[0].receive({ type: 'heartbeat' }); assert.equal(notifications, 1);
});

test('transaction projections preserve unrelated rows without traversing their contents', async () => {
  const { client, store } = await fixture();
  const storedBefore = copy(store.workspace);
  const owned = copy(store.workspace);
  const untouched = owned.descs.find(desc => desc.filepath === 'b.txt');
  Object.defineProperty(untouched, 'unreadPayload', { enumerable: true, get() { throw new Error('Unedited row was serialized'); } });
  const staged = { status: { 'a.txt': { lastEditedAt: 123, nested: { saved: true } } } };
  const project = client.projection([client.fileBase('a.txt')], client.epoch, staged);
  staged.status['a.txt'].lastEditedAt = 456;
  staged.status['a.txt'].nested.saved = false;
  const result = project(owned, client.state);
  assert.equal(result, owned, 'The transaction already owns a separate IndexedDB snapshot.');
  assert.equal(result.descs.find(desc => desc.filepath === 'b.txt'), untouched);
  assert.equal(result.status['a.txt'].lastEditedAt, 123);
  assert.equal(result.status['a.txt'].nested.saved, true, 'Saved status is captured before asynchronous storage work.');
  result.descs[0].translations.Thai[0] = 'transaction-only edit';
  assert.deepEqual(store.workspace, storedBefore, 'Mutating the transaction copy cannot publish before commit.');
  assert.equal(client.fileBase('a.txt').translations[0], 'one');
  client.destroy();
});

test('a missing workspace projection copies its caller-owned fallback', async () => {
  const { client } = await fixture();
  const staged = { descs: copy(source), status: { 'a.txt': { lastEditedAt: 123 } }, unrelated: { preserve: true } };
  const before = copy(staged);
  const result = client.projection([client.fileBase('a.txt')], client.epoch, staged)(undefined, client.state);
  assert.notEqual(result, staged);
  assert.deepEqual(result.descs.find(desc => desc.filepath === 'b.txt').translations.Thai, ['three']);
  result.descs[0].translations.Thai[0] = 'projected-only edit';
  result.unrelated.preserve = false;
  assert.deepEqual(staged, before);
  client.destroy();
});

test('saving projects only edited data from a staged workspace', async () => {
  const { client, store, server } = await fixture();
  server.offline = true;
  const staged = { status: { 'a.txt': { lastEditedAt: 123 } } };
  Object.defineProperty(staged, 'descs', { enumerable: true, get() { throw new Error('Full staged archive was serialized'); } });
  const result = await client.save({ workspace: staged, waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['local save', 'two'] }] });
  assert.equal(result.status, 'pending');
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'local save');
  assert.equal(store.workspace.status['a.txt'].lastEditedAt, 123);
  assert.deepEqual(store.workspace.descs[1].translations.Thai, ['three']);
  client.destroy();
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
    { game: 'poe1', branchId: 'default', sourceHash: await P.sourceHash(source), language: 'Thai' });
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

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function presenceFixture(options = {}) {
  const store = storeFixture(), server = serverFixture(), sockets = [], tickets = [];
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    open() { this.readyState = 1; this.onopen?.(); }
    close() { this.readyState = 3; }
    drop() { this.readyState = 3; this.onclose?.(); }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  }
  const client = new Client({ store, WebSocket: Socket, apiBase: 'http://127.0.0.1:3333',
    locks: options.locks, onStatus: options.onStatus, uuid: () => 'mutation-' + ++nextId,
    request: async (path, requestOptions) => {
      if (path.endsWith('/ticket')) {
        tickets.push({ path, options: copy(requestOptions) });
        assert.ok(client.room()?.roomId, 'Presence requires a confirmed room identity.');
        assert.equal(store.state.rooms[client.key].roomId, client.room().roomId, 'Presence subscribes only to a durably confirmed room.');
        return options.ticket ? options.ticket(tickets.length) : { ticket: 'ticket-' + tickets.length };
      }
      return server.request(path, requestOptions);
    },
  });
  const connect = (overrides = {}) => client.connect({ accountId: 'user', game: 'poe1', language: 'Thai',
    source, files: initial, workspace: { descs: copy(source), status: {} }, ...overrides });
  return { client, store, server, sockets, tickets, connect };
}

async function localSaveResult(save) {
  const waitingForNetwork = Symbol('waiting for network');
  const result = await Promise.race([save, new Promise(resolve => setImmediate(() => resolve(waitingForNetwork)))]);
  assert.notEqual(result, waitingForNetwork, 'A durable local save must finish while its network request is still held.');
  return result;
}

test('background save waits for local durability but finishes before a held network request', async t => {
  const { client, store, server } = await fixture();
  const localEntered = gate(), localRelease = gate(), networkEntered = gate(), networkRelease = gate();
  t.after(() => { localRelease.resolve(); networkRelease.resolve(); client.destroy(); });
  const update = store.updateCollaborationState.bind(store), request = client.request;
  let firstUpdate = true;
  store.updateCollaborationState = async (...args) => {
    if (firstUpdate) { firstUpdate = false; localEntered.resolve(); await localRelease.promise; }
    return update(...args);
  };
  client.request = async (path, options) => {
    if (path.includes('/changes?')) { networkEntered.resolve(); await networkRelease.promise; }
    return request(path, options);
  };
  const requestCount = server.requests.length;
  let settled = false;
  const save = client.save({ waitForSync: false, workspace: store.workspace,
    files: [{ ...client.fileBase('a.txt'), translations: ['durable local save', 'two'] }],
    revisions: [{ filepath: 'a.txt', lang: 'Thai', translations: ['durable local save', 'two'] }],
  }).then(result => { settled = true; return result; });
  await localEntered.promise;
  assert.equal(settled, false);
  assert.equal(server.requests.length, requestCount, 'Synchronization starts only after local persistence.');
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'one');
  localRelease.resolve();
  await networkEntered.promise;
  const result = await localSaveResult(save);
  assert.equal(result.status, 'pending');
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'durable local save');
  assert.equal(store.revisions.length, 1);
  assert.equal(store.revisions[0].translations[0], 'durable local save');
  assert.equal(Object.values(store.state.rooms)[0].outbox[0].id, result.mutationId);
  assert.equal(server.receipts.size, 0);
  networkRelease.resolve();
  await client.sync();
  assert.equal(client.snapshot().pending, 0);
  assert.equal(server.files[0].translations[0], 'durable local save');
});

test('background save rejects local storage failure without changing state or starting sync', async t => {
  const { client, store, server } = await fixture();
  t.after(() => client.destroy());
  const state = copy(store.state), workspace = copy(store.workspace), requestCount = server.requests.length;
  store.fail = true;
  await assert.rejects(client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['must remain an unsaved draft', 'two'] }],
    revisions: [{ filepath: 'a.txt', lang: 'Thai', translations: ['must remain an unsaved draft', 'two'] }],
  }), /Storage quota exceeded/);
  assert.deepEqual(store.state, state);
  assert.deepEqual(store.workspace, workspace);
  assert.equal(store.revisions.length, 0);
  assert.equal(client.fileBase('a.txt').translations[0], 'one');
  assert.equal(server.requests.length, requestCount);
  assert.equal(client.snapshot().pending, 0);
});

test('quick background saves of the same file queue and synchronize in order', async t => {
  const { client, store, server } = await fixture();
  const firstMutation = gate(), release = gate();
  t.after(() => { release.resolve(); client.destroy(); });
  const request = client.request;
  let mutationCount = 0;
  client.request = async (path, options) => {
    if (path.endsWith('/mutations')) {
      if (++mutationCount === 1) { firstMutation.resolve(); await release.promise; }
      else {
        assert.equal(client.fileBase('a.txt').translations[0], 'second save');
        assert.equal(store.workspace.descs[0].translations.Thai[0], 'second save', 'The first acknowledgment cannot overwrite the newer local save.');
      }
    }
    return request(path, options);
  };
  const first = await localSaveResult(client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['first save', 'two'] }],
    revisions: [{ filepath: 'a.txt', lang: 'Thai', translations: ['first save', 'two'] }],
  }));
  await firstMutation.promise;
  const second = await localSaveResult(client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['second save', 'two'] }],
    revisions: [{ filepath: 'a.txt', lang: 'Thai', translations: ['second save', 'two'] }],
  }));
  assert.equal(first.status, 'pending'); assert.equal(second.status, 'pending');
  assert.deepEqual(Object.values(store.state.rooms)[0].outbox.map(op => op.id), [first.mutationId, second.mutationId]);
  assert.deepEqual(store.revisions.map(revision => revision.translations[0]), ['first save', 'second save']);
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'second save');
  release.resolve();
  await client.sync();
  assert.equal(client.snapshot().pending, 0);
  assert.deepEqual(server.requests.filter(entry => entry.path.endsWith('/mutations')).map(entry => entry.options.body.files[0].translations[0]), ['first save', 'second save']);
  assert.equal(server.files[0].translations[0], 'second save');
});

test('a conflict discovered after background save retains both copies and the durable operation', async t => {
  const { client, store, server } = await fixture();
  const entered = gate(), release = gate();
  t.after(() => { release.resolve(); client.destroy(); });
  const request = client.request, base = client.fileBase('a.txt');
  const snapshots = []; client.onChange = state => snapshots.push(state);
  client.request = async (path, options) => {
    if (path.includes('/changes?')) { entered.resolve(); await release.promise; }
    return request(path, options);
  };
  server.change('a.txt', ['remote edit', 'two']);
  const save = client.save({ waitForSync: false, bases: { 'a.txt': base },
    files: [{ ...base, translations: ['local edit', 'two'] }],
  });
  await entered.promise;
  const result = await localSaveResult(save);
  assert.equal(result.status, 'pending');
  release.resolve();
  await client.sync();
  const conflict = client.snapshot().conflicts[0];
  assert.equal(conflict.mutationId, result.mutationId);
  assert.deepEqual(conflict.yours.translations, ['local edit', 'two']);
  assert.deepEqual(conflict.shared.translations, ['remote edit', 'two']);
  assert.equal(Object.values(store.state.rooms)[0].outbox[0].status, 'conflict');
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'local edit');
  assert.equal(server.receipts.size, 0);
  assert.equal(snapshots.at(-1).conflicts.length, 1, 'The existing attention UI receives the later conflict.');
});

test('background permission failures remain visible while subsequent local saves retry', async t => {
  const { client, store, server } = await fixture();
  const firstEntered = gate(), firstRelease = gate(), retryEntered = gate(), retryRelease = gate();
  t.after(() => { firstRelease.resolve(); retryRelease.resolve(); client.destroy(); });
  const request = client.request, statuses = [];
  client.onStatus = status => statuses.push(status);
  let attempt = 0;
  client.request = async (path, options) => {
    if (path.includes('/changes?')) {
      if (++attempt === 1) {
        firstEntered.resolve(); await firstRelease.promise;
        throw Object.assign(new Error('Translation access was removed.'), { status: 403 });
      }
      retryEntered.resolve(); await retryRelease.promise;
    }
    return request(path, options);
  };
  const firstSave = client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['saved before permission failure', 'two'] }],
  });
  await firstEntered.promise;
  assert.equal((await localSaveResult(firstSave)).status, 'pending');
  firstRelease.resolve();
  await client.sync();
  assert.deepEqual(statuses.at(-1), { message: 'Translation access was removed.', error: true });
  assert.equal(client.snapshot().pending, 1);
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'saved before permission failure');
  const statusCount = statuses.length;
  const secondSave = client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['saved while permission retry waits', 'two'] }],
  });
  await retryEntered.promise;
  assert.equal((await localSaveResult(secondSave)).status, 'pending');
  assert.equal(statuses.length, statusCount, 'Another local commit and retry start must not clear the failure.');
  assert.equal(client.snapshot().pending, 2);
  retryRelease.resolve();
  await client.sync();
  assert.equal(client.snapshot().pending, 0);
  assert.equal(server.files[0].translations[0], 'saved while permission retry waits');
  assert.deepEqual(statuses.at(-1), { message: '', error: false });
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
  const syncing = client.sync(); await Promise.resolve(); client.disconnect(); release(); await syncing;
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
  const running = client.sync(); await Promise.resolve();
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

test('late reconnect claim replies cannot revive a released row or replace its newer claim', async t => {
  for (const granted of [true, false]) for (const newer of [false, true]) await t.test(`${granted ? 'granted' : 'denied'} after ${newer ? 'new row' : 'blur'}`, async t => {
    const { client } = await fixture();
    t.after(() => client.destroy());
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
    let conflicts = 0; client.onEditingConflict = () => conflicts++;
    await client.claim('a.txt');
    await client.openSocket(client.epoch); sockets[0].open(); await client.running;
    const socket = sockets[0], reconnect = socket.sent.find(message => message.type === 'claim');
    assert.equal(reconnect.filepath, 'a.txt');
    if (newer) {
      const claiming = client.claim('b.txt');
      const current = socket.sent.at(-1);
      socket.receive({ type: 'claim-result', requestId: current.requestId, granted: true });
      assert.equal((await claiming).granted, true);
    } else client.leaveEdit();
    socket.receive({ type: 'claim-result', requestId: reconnect.requestId, granted, peers: [{ name: 'Peer' }] });
    await Promise.resolve();
    assert.equal(client.editing, newer ? 'b.txt' : null);
    assert.equal(conflicts, 0, 'An obsolete reconnect denial must not ask to override the current row.');
  });
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

test('joining publishes websocket presence while translation catch-up is still held', async t => {
  const { client, store, server, sockets, tickets, connect } = presenceFixture();
  const entered = gate(), release = gate(), request = client.request;
  client.request = async (path, options) => {
    if (path.includes('/changes?')) { entered.resolve(); await release.promise; }
    return request(path, options);
  };
  const connection = connect(); connection.catch(() => {});
  t.after(async () => { release.resolve(); client.destroy(); await connection.catch(() => {}); });
  await entered.promise; await nextTurn();
  assert.equal(tickets.length, 1, 'Joining starts the presence subscription before catch-up completes.');
  assert.equal(sockets.length, 1);
  assert.equal(store.state.rooms[client.key].roomId, 'room');
  sockets[0].open();
  sockets[0].receive({ type: 'presence', selfId: 'self', peers: [{ sessionId: 'other', name: 'Other translator' }] });
  assert.equal(client.snapshot().connected, true);
  assert.equal(client.snapshot().peers[0].name, 'Other translator');
  assert.equal(server.receipts.size, 0);
  release.resolve(); await connection;
});

test('a slow presence ticket does not block translation catch-up or queued uploads', async t => {
  const ticketEntered = gate(), ticketRelease = gate();
  const { client, server, sockets, connect } = presenceFixture({ ticket: async () => {
    ticketEntered.resolve(); await ticketRelease.promise; return { ticket: 'held-ticket' };
  } });
  const connection = connect(); connection.catch(() => {});
  t.after(async () => { ticketRelease.resolve(); client.destroy(); await connection.catch(() => {}); });
  await ticketEntered.promise; await nextTurn();
  assert.ok(server.requests.some(request => request.path.includes('/changes?')), 'HTTP catch-up progresses while the ticket is pending.');
  assert.equal(sockets.length, 0);
  const save = client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['saved during ticket request', 'two'] }] });
  await localSaveResult(save); await nextTurn();
  assert.equal(server.files[0].translations[0], 'saved during ticket request', 'Durable translation uploads progress independently of presence.');
  ticketRelease.resolve(); await connection; await nextTurn();
  assert.equal(sockets.length, 1);
});

test('presence subscribes while another tab holds the translation synchronization lock', async t => {
  const entered = gate(), release = gate();
  const { client, server, sockets, tickets, connect } = presenceFixture({ locks: {
    async request(name, action) { entered.resolve(name); await release.promise; return action(); },
  } });
  const connection = connect(); connection.catch(() => {});
  t.after(async () => { release.resolve(); client.destroy(); await connection.catch(() => {}); });
  const lockName = await entered.promise; await nextTurn();
  assert.match(lockName, /^sdeditor-collaboration:/);
  assert.equal(server.requests.some(request => request.path.includes('/changes?')), false, 'Translation catch-up is still waiting for its lock.');
  assert.equal(tickets.length, 1, 'Presence does not wait for the translation synchronization lock.');
  assert.equal(sockets.length, 1);
  sockets[0].open(); sockets[0].receive({ type: 'presence', peers: [{ sessionId: 'other' }] });
  assert.equal(client.snapshot().peers.length, 1);
  release.resolve(); await connection;
});

test('a queued translation lock released after disconnect cannot report a stale sync failure', async t => {
  const entered = gate(), release = gate(), statuses = [];
  const { client, server, sockets, tickets, connect } = presenceFixture({ onStatus: status => statuses.push(status), locks: {
    async request(name, action) { entered.resolve(); await release.promise; return action(); },
  } });
  const connection = connect(); connection.catch(() => {});
  t.after(async () => { release.resolve(); client.destroy(); await connection.catch(() => {}); });
  await entered.promise; await nextTurn();
  assert.equal(sockets.length, 1);
  sockets[0].open(); client.disconnect();
  const count = statuses.length;
  release.resolve(); await connection; await nextTurn();
  assert.equal(statuses.length, count, 'An obsolete lock callback cannot show a failure in the disconnected workspace.');
  assert.equal(server.requests.some(request => request.path.includes('/changes?')), false);
  assert.equal(tickets.length, 1);
  assert.equal(client.snapshot().connected, false);
  assert.equal(client.snapshot().roomId, null);
  assert.deepEqual(client.snapshot().peers, []);
});

test('presence reconnects during a held sync without clearing the durable save failure', async t => {
  const statuses = [], entered = gate(), release = gate();
  const { client, store, server, sockets, connect } = presenceFixture({ onStatus: status => statuses.push(status) });
  t.after(() => { release.resolve(); client.destroy(); });
  await connect(); sockets[0].open(); await client.running;
  server.offline = true;
  await localSaveResult(client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['durable pending translation', 'two'] }] }));
  await client.running;
  assert.equal(statuses.at(-1).error, true);
  assert.equal(client.snapshot().pending, 1);
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'durable pending translation');
  server.offline = false;
  const request = client.request;
  client.request = async (path, options) => {
    if (path.includes('/changes?')) { entered.resolve(); await release.promise; }
    return request(path, options);
  };
  const syncing = client.sync(); await entered.promise;
  sockets[0].drop(); const reconnecting = client.sync(); await nextTurn();
  assert.equal(sockets.length, 2, 'A running HTTP sync cannot delay presence reconnection.');
  const count = statuses.length;
  sockets[1].open(); sockets[1].receive({ type: 'presence', peers: [{ sessionId: 'other', name: 'Back online' }] });
  assert.equal(client.snapshot().connected, true);
  assert.equal(client.snapshot().peers[0].name, 'Back online');
  assert.equal(client.snapshot().pending, 1);
  assert.equal(server.receipts.size, 0);
  assert.equal(statuses.length, count, 'Presence recovery cannot dismiss an outstanding translation failure.');
  release.resolve(); await syncing; await reconnecting;
  assert.equal(server.files[0].translations[0], 'durable pending translation');
  assert.equal(client.snapshot().pending, 0);
  assert.deepEqual(statuses.at(-1), { message: '', error: false });
});

test('presence reconnects before a queued translation mutation finishes uploading', async t => {
  const entered = gate(), release = gate();
  const { client, store, server, sockets, connect } = presenceFixture();
  t.after(() => { release.resolve(); client.destroy(); });
  await connect(); sockets[0].open(); await client.running;
  const request = client.request;
  client.request = async (path, options) => {
    if (path.endsWith('/mutations')) { entered.resolve(); await release.promise; }
    return request(path, options);
  };
  await localSaveResult(client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['held upload', 'two'] }] }));
  await entered.promise;
  sockets[0].drop(); const reconnecting = client.sync(); await nextTurn();
  assert.equal(sockets.length, 2, 'A held mutation request cannot delay the replacement presence socket.');
  sockets[1].open(); sockets[1].receive({ type: 'presence', peers: [{ sessionId: 'other' }] });
  assert.equal(client.snapshot().connected, true);
  assert.equal(client.snapshot().peers.length, 1);
  assert.equal(client.snapshot().pending, 1);
  assert.equal(store.workspace.descs[0].translations.Thai[0], 'held upload');
  assert.equal(server.receipts.size, 0);
  release.resolve(); await reconnecting;
  assert.equal(client.snapshot().pending, 0);
  assert.equal(server.files[0].translations[0], 'held upload');
});

test('concurrent presence retries share one pending ticket and create one socket', async t => {
  const entered = gate(), release = gate(); let held = false;
  const { client, sockets, tickets, connect } = presenceFixture({ ticket: async count => {
    if (held) { entered.resolve(); await release.promise; }
    return { ticket: 'ticket-' + count };
  } });
  t.after(() => { release.resolve(); client.destroy(); });
  await connect(); client.closeSocket(); held = true;
  const openings = [client.openSocket(client.epoch), client.openSocket(client.epoch), client.openSocket(client.epoch)];
  const retries = [client.sync(), client.sync()];
  await entered.promise; await nextTurn();
  assert.equal(tickets.length, 2, 'All retries reuse the one replacement ticket request.');
  assert.equal(sockets.length, 1);
  release.resolve(); await Promise.all([...openings, ...retries]); await nextTurn();
  assert.equal(sockets.length, 2, 'Only one replacement socket is constructed.');
});

test('closing or switching scope invalidates a late websocket ticket', async t => {
  for (const action of ['close', 'disconnect', 'account', 'source']) await t.test(action, async t => {
    const entered = gate(), release = gate();
    const { client, sockets, tickets, connect } = presenceFixture({ ticket: async count => {
      if (count === 1) { entered.resolve(); await release.promise; }
      return { ticket: 'ticket-' + count };
    } });
    const connections = [connect()]; connections[0].catch(() => {});
    t.after(async () => { release.resolve(); client.destroy(); await Promise.allSettled(connections); });
    await entered.promise;
    if (action === 'close') { client.closeSocket(); connections.push(client.openSocket(client.epoch)); }
    else if (action === 'disconnect') client.disconnect();
    else {
      const changedSource = copy(source); changedSource[0].translations.English[0] += '!';
      connections.push(connect(action === 'account' ? { accountId: 'new-user' } : { source: changedSource }));
    }
    if (connections.length > 1) await connections[1];
    const count = action === 'disconnect' ? 0 : 1;
    assert.equal(sockets.length, count);
    if (count) {
      sockets[0].open(); sockets[0].receive({ type: 'presence', peers: [{ sessionId: 'current' }] });
    }
    release.resolve(); await Promise.allSettled(connections); await nextTurn();
    assert.equal(sockets.length, count, 'The obsolete ticket cannot construct or replace a socket.');
    assert.equal(tickets.length, action === 'disconnect' ? 1 : 2);
    assert.equal(client.snapshot().connected, count === 1);
    assert.deepEqual(client.snapshot().peers.map(peer => peer.sessionId), count ? ['current'] : []);
  });
});

test('late events from a previous websocket cannot replace current avatar presence', async t => {
  const { client, sockets, connect } = presenceFixture(); t.after(() => client.destroy());
  await connect(); const obsolete = sockets[0];
  const oldOpen = obsolete.onopen, oldClose = obsolete.onclose, oldMessage = obsolete.onmessage;
  await connect({ accountId: 'new-user' }); const current = sockets[1];
  current.open(); current.receive({ type: 'presence', selfId: 'new-self', peers: [{ sessionId: 'current' }] });
  oldOpen(); oldMessage({ data: JSON.stringify({ type: 'presence', selfId: 'old-self', peers: [{ sessionId: 'obsolete' }] }) }); oldClose();
  assert.equal(client.snapshot().connected, true);
  assert.equal(client.snapshot().sessionId, 'new-self');
  assert.deepEqual(client.snapshot().peers.map(peer => peer.sessionId), ['current']);
  assert.equal(client.socket, current);
  await client.running;
});

test('managed catalog hints observe only the currently joined game, branch and baseline', async t => {
  const { client, sockets, connect } = presenceFixture(); t.after(() => client.destroy());
  await connect(); const seen = []; client.onManagedVersionChanged = message => seen.push(message);
  const identity = client.room().identity;
  const hint = { type: 'managed_version_changed', versionId: 'weekly', game: identity.game, branchId: identity.branchId, sourceHash: identity.sourceHash };
  sockets[0].receive({ ...hint, branchId: 'different-branch' });
  sockets[0].receive({ ...hint, sourceHash: 'different-version' });
  sockets[0].receive(hint);
  assert.equal(seen.length, 1); assert.equal(seen[0].versionId, 'weekly');
  const oldHandler = sockets[0].onmessage; await connect({ accountId: 'other' });
  oldHandler({ data: JSON.stringify(hint) }); assert.equal(seen.length, 1);
});

test('successful translation sync cannot hide a presence ticket failure before the socket opens', async t => {
  const statuses = [], entered = gate(), release = gate(); let unavailable = true;
  const { client, sockets, server, connect } = presenceFixture({ onStatus: status => statuses.push(status), ticket: async () => {
    if (unavailable) throw Object.assign(new Error('Presence service unavailable'), { status: 503 });
    return { ticket: 'recovered-ticket' };
  } });
  t.after(() => { release.resolve(); client.destroy(); });
  await connect(); await nextTurn();
  assert.ok(server.requests.some(request => request.path.includes('/changes?')));
  assert.equal(statuses.at(-1).error, true, 'Successful translation requests leave the failed presence operation visible.');
  assert.ok(client.backoff > 1000, 'Successful HTTP requests do not reset the failed presence retry delay.');
  unavailable = false; await client.sync(); await nextTurn();
  assert.equal(sockets.length, 1);
  assert.equal(statuses.at(-1).error, true, 'A ticket alone does not confirm presence recovery.');
  assert.ok(client.backoff > 1000, 'A replacement ticket does not reset the delay before the socket connects.');
  const request = client.request;
  client.request = async (path, options) => {
    if (path.includes('/changes?')) { entered.resolve(); await release.promise; }
    return request(path, options);
  };
  sockets[0].open(); await entered.promise;
  assert.deepEqual(statuses.at(-1), { message: '', error: false }, 'The recovered socket clears its own failure independently of held translation requests.');
  assert.equal(client.backoff, 1000, 'Opening the recovered presence socket resets its retry delay.');
  release.resolve(); await client.running;
});

test('presence ticket denial stays actionable while allowed translation saves still synchronize', async t => {
  const statuses = [];
  const { client, server, connect } = presenceFixture({ onStatus: status => statuses.push(status), ticket: async () => {
    throw Object.assign(new Error('Presence access denied'), { status: 403 });
  } });
  t.after(() => client.destroy());
  await connect(); await nextTurn();
  assert.deepEqual(statuses.at(-1), { message: 'Presence access denied', error: true });
  await localSaveResult(client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['translation still allowed', 'two'] }] }));
  await client.running; await nextTurn();
  assert.equal(server.files[0].translations[0], 'translation still allowed');
  assert.equal(client.snapshot().pending, 0);
  assert.deepEqual(statuses.at(-1), { message: 'Presence access denied', error: true }, 'Completing a different operation cannot dismiss the presence denial.');
});

function workerBatch(client, jobId, translations) {
  const identity = copy(client.room().identity);
  return { jobId, game: identity.game, language: identity.language, sourceHash: identity.sourceHash, accountId: identity.accountId,
    files: [{ ...client.fileBase('a.txt'), translations, trackedForExport: true }],
    collaboration: { key: client.key, identity, bases: { 'a.txt': client.fileBase('a.txt') }, origin: 'save' } };
}
async function persistWorkerFixture(store, batch) {
  const operation = { id: batch.jobId, origin: 'save', status: 'pending', files: batch.files.map(yours => ({
    base: copy(batch.collaboration.bases[yours.filepath]), yours: copy(yours) })) };
  const state = await store.updateCollaborationState(state => {
    const room = state.rooms[batch.collaboration.key]; room.outbox.push(copy(operation));
    for (const file of batch.files) room.local[file.filepath] = copy(file);
    return state;
  }, { projectWorkspace: workspace => P.projectWorkspace(workspace, batch.files, batch.language, source, { mutate: true }) });
  return { jobId: batch.jobId, status: 'pending', mutationId: batch.jobId, operation, files: batch.files,
    pending: state.rooms[batch.collaboration.key].outbox.length };
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('held worker write delays concurrent remote projection and new mutation flush until durable ACK', async t => {
  const { client, store, server } = await fixture(); t.after(() => client.destroy());
  const batch = workerBatch(client, 'worker-held', ['worker saved', 'two']); client.stageLocalSave(batch);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { entered = resolve; });
  const oldSequence = client.room().sequence;
  const local = client.withLocalWrite(async () => {
    entered(); await gate;
    const ack = await persistWorkerFixture(store, batch); client.acceptLocalSave(batch, ack); return ack;
  });
  await started; server.requests.length = 0; server.change('b.txt', ['remote while saving']);
  const remote = client.sync(); await nextTurn();
  assert.equal(client.room().sequence, oldSequence, 'Remote cache updates wait for the local write barrier.');
  assert.equal(store.state.rooms[client.key].outbox.length, 0, 'An unacknowledged edit is not a durable network operation.');
  assert.equal(server.requests.filter(request => request.path.endsWith('/mutations')).length, 0);
  assert.deepEqual(client.fileBase('a.txt').translations, ['worker saved', 'two'], 'The staged edit remains visible while storage runs.');
  release(); await local; await remote;
  assert.deepEqual(server.files.find(file => file.filepath === 'a.txt').translations, ['worker saved', 'two']);
  assert.deepEqual(store.workspace.descs.find(desc => desc.filepath === 'b.txt').translations.Thai, ['remote while saving']);
  assert.equal(client.room().outbox.length, 0); assert.equal(client.room().sequence, oldSequence + 1);
  await client.sync(); assert.equal(client.room().sequence, server.sequence);
});

test('older worker ACK and intervening remote cache updates cannot hide the newest staged base', async t => {
  const { client, store } = await fixture(); t.after(() => client.destroy());
  const first = workerBatch(client, 'worker-first', ['first submitted', 'two']); client.stageLocalSave(first);
  const latest = workerBatch(client, 'worker-latest', ['latest submitted', 'two']); client.stageLocalSave(latest);
  const ack = await persistWorkerFixture(store, first); client.acceptLocalSave(first, ack);
  assert.deepEqual(client.fileBase('a.txt').translations, ['latest submitted', 'two']);
  assert.deepEqual(latest.collaboration.bases['a.txt'].translations, ['first submitted', 'two'], 'The second draft retains its authored ancestry.');
  await client.update((state, room) => { room.local['a.txt'].translations = ['remote cache', 'two']; });
  const captured = client.fileBase('a.txt'); captured.translations[0] = 'external mutation';
  assert.deepEqual(client.fileBase('a.txt').translations, ['latest submitted', 'two'], 'fileBase returns an independent staged snapshot.');
  const latestAck = await persistWorkerFixture(store, latest); client.acceptLocalSave(latest, latestAck);
  assert.deepEqual(client.fileBase('a.txt').translations, ['latest submitted', 'two']); assert.equal(client.stagedSaves.size, 0);
});

test('queue starts synchronization only after the worker acknowledgment is adopted', async t => {
  const { client, store, server } = await fixture(); t.after(() => client.destroy());
  const batch = workerBatch(client, 'worker-queue', ['queued worker edit', 'two']); client.stageLocalSave(batch);
  let release, entered; const gate = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { entered = resolve; });
  let syncs = 0;
  const pending = createPendingSaves({
    save: request => client.withLocalWrite(async () => {
      entered(); await gate; const ack = await persistWorkerFixture(store, request); client.acceptLocalSave(request, ack); return ack;
    }),
    onCommit: (job, ack) => {
      assert.ok(client.room().outbox.some(operation => operation.id === ack.mutationId), 'Adoption precedes synchronization.');
      syncs++; return client.retry();
    },
  }); t.after(() => pending.dispose()); server.requests.length = 0;
  pending.enqueue(batch); const drained = pending.drain(); await started;
  assert.equal(syncs, 0); assert.equal(server.requests.length, 0); assert.equal(pending.snapshot().pending, 1);
  release(); await drained; assert.equal(syncs, 1); assert.equal(pending.snapshot().pending, 0);
  assert.deepEqual(server.files[0].translations, ['queued worker edit', 'two']); assert.equal(client.room().outbox.length, 0);
});

test('duplicate ACK with no current operation removes a stale memory outbox without resurrecting synced work', async t => {
  const { client, store } = await fixture(); t.after(() => client.destroy());
  const batch = workerBatch(client, 'worker-duplicate', ['submitted', 'two']);
  const ack = await persistWorkerFixture(store, batch); client.stageLocalSave(batch); client.acceptLocalSave(batch, ack);
  assert.equal(client.room().outbox.length, 1);
  client.stageLocalSave(batch); client.acceptLocalSave(batch, { ...ack, duplicate: true, operation: null, pending: 0, status: 'synced',
    files: [{ ...batch.files[0], translations: ['accepted shared', 'two'], revision: 3 }] });
  assert.equal(client.room().outbox.length, 0); assert.equal(client.stagedSaves.size, 0);
  assert.deepEqual(client.fileBase('a.txt').translations, ['accepted shared', 'two']);
});

test('old-scope worker ACK after disconnect leaves the newly selected room unchanged', async t => {
  const { client, store } = await fixture(); t.after(() => client.destroy());
  const batch = workerBatch(client, 'worker-old-scope', ['old room edit', 'two']); client.stageLocalSave(batch);
  const ack = await persistWorkerFixture(store, batch); const oldKey = client.key;
  client.disconnect();
  const identity = { ...batch.collaboration.identity, accountId: 'other user' }; const newKey = P.scopeKey(identity);
  client.state.rooms[newKey] = { ...copy(client.state.rooms[oldKey]), identity, outbox: [], local: { 'a.txt': { ...initial[0], translations: ['new room', 'two'] } } };
  client.key = newKey; const before = copy(client.room());
  client.acceptLocalSave(batch, ack);
  assert.deepEqual(client.room(), before); assert.deepEqual(client.fileBase('a.txt').translations, ['new room', 'two']);
  assert.equal(client.stagedSaves.has(batch.jobId), false, 'A completed old-scope receipt can release its retained staging record.');
});

test('saved translation upload stays active through the network reply and durable acknowledgment', async t => {
  const { client, store } = await fixture();
  const networkEntered = gate(), networkRelease = gate(), acknowledgmentEntered = gate(), acknowledgmentRelease = gate();
  t.after(() => { networkRelease.resolve(); acknowledgmentRelease.resolve(); client.destroy(); });
  const work = []; client.onWork = value => work.push(copy(value));
  const request = client.request, update = store.updateCollaborationState.bind(store);
  let acknowledging = false;
  client.request = async (path, options) => {
    if (!path.endsWith('/mutations')) return request(path, options);
    networkEntered.resolve(); await networkRelease.promise;
    const result = await request(path, options); acknowledging = true; return result;
  };
  store.updateCollaborationState = async (...args) => {
    if (acknowledging) {
      acknowledging = false; acknowledgmentEntered.resolve(); await acknowledgmentRelease.promise;
    }
    return update(...args);
  };
  const save = client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['upload in progress', 'two'] }] });
  await networkEntered.promise;
  assert.equal((await localSaveResult(save)).status, 'pending', 'A visible upload does not delay the durable local save.');
  assert.deepEqual(work.at(-1), { key: 'upload', label: 'Saving translations to shared workspace', active: true });
  networkRelease.resolve(); await acknowledgmentEntered.promise;
  assert.equal(work.at(-1).active, true, 'The server reply still needs to be durably adopted.');
  acknowledgmentRelease.resolve(); await client.sync();
  assert.deepEqual(work.at(-1), { key: 'upload', active: false });
  assert.equal(client.snapshot().pending, 0);
});

test('failed saved translation uploads clear progress and retain the queued save and actionable error', async t => {
  const { client } = await fixture(); t.after(() => client.destroy());
  const work = [], statuses = []; client.onWork = value => work.push(copy(value)); client.onStatus = value => statuses.push(copy(value));
  const request = client.request;
  client.request = (path, options) => path.endsWith('/mutations')
    ? Promise.reject(Object.assign(new Error('Shared workspace is unavailable'), { status: 503 })) : request(path, options);
  const result = await client.save({ files: [{ ...client.fileBase('a.txt'), translations: ['safe pending save', 'two'] }] });
  assert.equal(result.status, 'pending'); assert.equal(client.snapshot().pending, 1);
  assert.deepEqual(work, [
    { key: 'upload', label: 'Saving translations to shared workspace', active: true },
    { key: 'upload', active: false },
  ]);
  assert.equal(statuses.at(-1).error, true); assert.match(statuses.at(-1).message, /offline|pending sync/i);
  assert.deepEqual(client.fileBase('a.txt').translations, ['safe pending save', 'two']);
});

test('revision conflicts end saved upload progress while retaining both copies for comparison', async t => {
  const { client, server } = await fixture(); t.after(() => client.destroy());
  const work = []; client.onWork = value => work.push(copy(value));
  const request = client.request;
  client.request = async (path, options) => {
    if (path.endsWith('/mutations')) server.change('a.txt', ['overlapping peer edit', 'two']);
    return request(path, options);
  };
  const result = await client.save({ files: [{ ...client.fileBase('a.txt'), translations: ['overlapping local edit', 'two'] }] });
  assert.equal(result.status, 'conflict'); assert.equal(client.snapshot().pending, 1);
  assert.deepEqual(work.map(value => value.active), [true, false]);
  assert.deepEqual(client.snapshot().conflicts[0].yours.translations, ['overlapping local edit', 'two']);
  assert.deepEqual(client.snapshot().conflicts[0].shared.translations, ['overlapping peer edit', 'two']);
  const count = work.length; await client.sync();
  assert.equal(work.length, count, 'A save awaiting conflict resolution is not an active upload.');
});

test('staged saved translation upload remains active until finalization commits the whole batch', async t => {
  const { client } = await fixture(); const finalized = gate(), release = gate();
  t.after(() => { release.resolve(); client.destroy(); });
  const work = [], chunks = []; client.onWork = value => work.push(copy(value));
  const request = client.request; let metadata;
  client.request = async (path, options = {}) => {
    if (path.endsWith('/rooms/room/uploads')) { metadata = copy(options.body); return { uploadId: 'saved-upload' }; }
    if (path.endsWith('/uploads/saved-upload')) return { receivedChunks: [] };
    if (path.includes('/uploads/saved-upload/chunks/')) { chunks.push(...copy(options.body.files)); return {}; }
    if (path.endsWith('/uploads/saved-upload/finalize')) {
      finalized.resolve(); await release.promise;
      return request('/v1/collaboration/rooms/room/mutations', { method: 'POST',
        body: { mutationId: metadata.mutationId, origin: metadata.origin, files: chunks } });
    }
    return request(path, options);
  };
  const translations = ['ก'.repeat(90000), 'ข'.repeat(90000)];
  const saving = client.save({ waitForSync: false, files: [{ ...client.fileBase('a.txt'), translations }] });
  await finalized.promise;
  assert.equal((await localSaveResult(saving)).status, 'pending');
  assert.equal(chunks.length, 1); assert.deepEqual(chunks[0].translations, translations);
  assert.equal(work.at(-1).active, true, 'Sending all chunks has not committed the staged save.');
  assert.deepEqual(work.map(value => value.active), [true]);
  release.resolve(); await client.sync();
  assert.deepEqual(work.at(-1), { key: 'upload', active: false }); assert.equal(client.snapshot().pending, 0);
});

test('disconnect clears upload progress and an old reply cannot clear a newer account upload', async t => {
  const { client, server } = await fixture();
  const oldEntered = gate(), oldRelease = gate(), newEntered = gate(), newRelease = gate();
  t.after(() => { oldRelease.resolve(); newRelease.resolve(); client.destroy(); });
  const work = []; client.onWork = value => { if (value.key === 'upload') work.push(copy(value)); };
  const request = client.request; let mutations = 0;
  client.request = async (path, options) => {
    if (!path.endsWith('/mutations')) return request(path, options);
    if (++mutations === 1) {
      const result = await request(path, options); oldEntered.resolve(); await oldRelease.promise; return result;
    }
    newEntered.resolve(); await newRelease.promise; return request(path, options);
  };
  await localSaveResult(client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['old account save', 'two'] }] }));
  await oldEntered.promise; const oldRun = client.running;
  assert.equal(work.at(-1).active, true); client.disconnect();
  assert.deepEqual(work.at(-1), { key: 'upload', active: false });
  await client.connect({ accountId: 'new user', game: 'poe1', language: 'Thai', source, files: copy(server.files),
    workspace: { descs: copy(source), status: {} } });
  await localSaveResult(client.save({ waitForSync: false,
    files: [{ ...client.fileBase('a.txt'), translations: ['new account save', 'two'] }] }));
  await newEntered.promise; const count = work.length;
  assert.equal(work.at(-1).active, true); oldRelease.resolve(); await oldRun;
  assert.equal(work.length, count, 'An obsolete upload must not dismiss the current workspace progress.');
  assert.equal(work.at(-1).active, true);
  newRelease.resolve(); await client.sync();
  assert.deepEqual(work.at(-1), { key: 'upload', active: false }); assert.equal(client.snapshot().pending, 0);
});

test('idle synchronization and received peer changes do not publish saved upload progress', async t => {
  const { client, server } = await fixture(); t.after(() => client.destroy());
  const work = []; client.onWork = value => work.push(copy(value));
  await client.retry(); await client.sync({ background: true });
  server.change('b.txt', ['received peer translation']); await client.retry();
  assert.equal(work.some(value => value.key === 'upload' && value.active), false);
  assert.equal(client.snapshot().pending, 0);
});
