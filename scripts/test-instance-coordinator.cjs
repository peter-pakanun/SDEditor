const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageChannel } = require('node:worker_threads');
const { Coordinator, PROTOCOL } = require('../public/instanceCoordinator.js');
const { Bridge } = require('../public/instanceClient.js');
const copy = value => value == null ? value : structuredClone(value);

function fixture({ signedIn = false, leaseAvailable = true, deferredJoin = false } = {}) {
  let assignedLanguage = 'Thai', assignmentVersion = 1;
  let collaborationState = { rooms: {} };
  const stats = { cloud: 0, clients: [], presences: [], writes: 0, exchanges: 0 };
  const source = [{ filepath: 'a.txt', translations: { English: ['One', 'Two'], Thai: ['old', 'two'] } }];
  let snapshot = { source, workspace: { sourceHash: 'source-one', descs: copy(source), status: {} }, generation: 1, revision: 1 };
  const receipts = new Map();
  const store = {
    async acquireOwnership(ownerId) { return leaseAvailable ? { ownerId, generation: 1, expiresAt: Date.now() + 30000 } : null; },
    configureOwnership(lease) { this.lease = lease; }, async renewOwnership(lease) { return lease; }, async releaseOwnership() { return true; },
    setStorageStatusHandler(callback) { this.onStatus = callback; }, async migrateFromLocalStorageIfNeeded() {},
    async getSettings() { return {}; }, async getCollaborationState() { return copy(collaborationState); },
    async getWorkspaceSnapshot() { return copy(snapshot); },
    async replaceWorkspace(command) {
      if (receipts.has(command.requestId)) return copy(snapshot);
      assert.equal(command.generation, snapshot.generation);
      receipts.set(command.requestId, true); stats.writes++;
      snapshot = { source: copy(command.source), workspace: copy(command.workspace), generation: snapshot.generation + 1, revision: snapshot.revision + 1 };
      return copy(snapshot);
    },
  };
  class Cloud {
    constructor(options) { stats.cloud++; this.options = options; this.epoch = 0; this.state = null; }
    async initialize() { this.state = {}; this.options.onChange(); return this.snapshot(); }
    snapshot(language = 'Thai') { return { settings: { lang: language }, dictionary: [], conflicts: [], signedIn, profileId: signedIn ? 'account:u1' : 'guest', user: signedIn ? { id: 'u1', language: assignedLanguage, assignmentVersion } : null }; }
    context() { return { epoch: this.epoch, profile: this.snapshot().profileId, token: 'secret-token', language: 'Thai' }; }
    async request(path) { if (path === '/auth/exchange') { stats.exchanges++; return { token: 'new-secret' }; } return { ok: true }; }
    async acceptLogin() { signedIn = true; this.epoch++; this.options.onChange(); }
    async selectLanguage() {} async saveLocal() {} async sync() {} async refreshSession() {}
    recoveryExport() { return { legacySettings: null, copies: [] }; }
    destroy() { this.destroyed = true; }
  }
  class Client {
    constructor(options) { this.options = options; stats.clients.push(this); this.destroyed = false; }
    async connect(args) {
      this.args = copy(args); this.saved = { identity: { accountId: args.accountId, game: args.game, sourceHash: 'source-one', language: args.language },
        files: copy(args.files), roomId: args.localOnly || deferredJoin ? null : 'room-1', generation: args.generation, localOnly: args.localOnly, conflicts: [], peers: [] };
      this.options.onChange(this.snapshot()); return this.snapshot();
    }
    snapshot() { return copy(this.saved); }
    async save(command) {
      if (!receipts.has(command.requestId)) {
        receipts.set(command.requestId, true); stats.writes++;
        this.saved.files = copy(command.files); snapshot.workspace.descs[0].translations.Thai = copy(command.files[0].translations); snapshot.revision++;
      }
      this.options.onChange(this.snapshot());
      return { status: 'local', files: copy(this.saved.files), workspace: copy(snapshot.workspace), generation: snapshot.generation, revision: snapshot.revision };
    }
    async retry() { return this.snapshot(); } async sync() { return this.snapshot(); }
    destroy() { this.destroyed = true; }
  }
  class Presence {
    constructor(options) { this.options = options; stats.presences.push(this); }
    async connect(args) { this.args = args; this.state = { connected: true, peers: [], sessionId: 'presence-' + stats.presences.indexOf(this) }; this.options.onChange(); return this.snapshot(); }
    snapshot() { return copy(this.state || { connected: false, peers: [] }); }
    select(value) { this.selected = value; } setAway(value) { this.away = value; }
    async claim(filepath) { this.editing = filepath; return { granted: true, peers: [] }; }
    leaveEdit() { this.editing = null; } destroy() { this.destroyed = true; }
  }
  const coordinator = new Coordinator({ store, CloudSync: { Client: Cloud }, CollaborationSync: { Client, PresenceClient: Presence },
    DictionarySync: {}, CollaborationProtocol: { sourceHash: async rows => rows?.[0]?.filepath === 'a.txt' ? 'source-one' : 'source-two' },
    apiBase: 'https://api.example.test', fetch: async () => {}, setInterval: () => 1, clearInterval() {} });
  let request = 0;
  async function peer(id) {
    const messages = [];
    const port = { postMessage(message) { messages.push(copy(message)); }, close() {}, start() {} };
    const client = coordinator.attach(port);
    async function rpc(op, method, args = [], extra = {}) {
      const message = { protocol: PROTOCOL, id: 'request-' + (++request), op, method, args, context: client.context, ...extra };
      await coordinator.receive(client, message);
      const result = messages.findLast(item => item.type === 'reply' && item.id === message.id);
      if (result?.error) throw Object.assign(new Error(result.error.message), result.error);
      return result?.result;
    }
    await rpc('hello', undefined, [], { tabId: id, apiBase: coordinator.apiBase });
    return { client, messages, rpc, context: () => messages.findLast(item => item.event?.type === 'cloud').event.context };
  }
  return { coordinator, stats, store, source, peer, snapshot: () => copy(snapshot),
    recoveryState(state) { collaborationState = copy(state); },
    dependencies: { InstanceCoordinator: { Coordinator }, CloudSync: { Client: Cloud }, CollaborationSync: { Client, PresenceClient: Presence },
      DictionarySync: {}, CollaborationProtocol: coordinator.protocol, MessageChannel },
    reassign(language) { assignedLanguage = language; assignmentVersion++; coordinator.cloud.options.onChange(); } };
}

test('two tabs share one storage and cloud owner and one durable client, with tokenless snapshots', async () => {
  const f = fixture(), a = await f.peer('a'), b = await f.peer('b');
  const args = { game: 'poe1', language: 'Thai', source: f.source, generation: 1 };
  await a.rpc('collaboration', 'connect', [args], { clientId: 'editor-a' });
  await b.rpc('collaboration', 'connect', [args], { clientId: 'editor-b' });
  assert.equal(f.stats.cloud, 1); assert.equal(f.stats.clients.length, 1);
  assert.equal(f.stats.clients[0].options.WebSocket, null);
  assert.equal(f.stats.clients[0].args.localOnly, true);
  assert.ok(!JSON.stringify(a.messages).includes('secret-token'));
  assert.ok(!JSON.stringify(b.messages).includes('secret-token'));
  await f.coordinator.destroy();
});

test('save retries reuse command IDs and broadcast only committed workspace snapshots to both tabs', async () => {
  const f = fixture(), a = await f.peer('a'), b = await f.peer('b');
  await a.rpc('collaboration', 'connect', [{ game: 'poe1', language: 'Thai', source: f.source, generation: 1 }], { clientId: 'editor' });
  const message = { protocol: PROTOCOL, op: 'collaboration', method: 'save', id: 'same-command', clientId: 'editor',
    context: a.context(),
    args: [{ files: [{ filepath: 'a.txt', translations: ['saved', 'two'] }] }] };
  await f.coordinator.receive(a.client, message); await f.coordinator.receive(a.client, message);
  assert.equal(f.stats.writes, 1);
  for (const tab of [a, b]) {
    const event = tab.messages.findLast(item => item.event?.type === 'workspace').event;
    assert.equal(event.revision, 2); assert.deepEqual(event.workspace.descs[0].translations.Thai, ['saved', 'two']);
    assert.equal(event.source, undefined);
  }
  await f.coordinator.destroy();
});

test('each online tab owns distinct presence while sharing durable synchronization', async () => {
  const f = fixture({ signedIn: true }), a = await f.peer('a'), b = await f.peer('b');
  for (const [tab, clientId] of [[a, 'a'], [b, 'b']]) await tab.rpc('collaboration', 'connect', [{ game: 'poe1', language: 'Thai', source: f.source, generation: 1 }], { clientId });
  assert.equal(f.stats.clients.length, 1); assert.equal(f.stats.presences.length, 2);
  await a.rpc('collaboration', 'select', ['a.txt'], { clientId: 'a' });
  assert.equal(f.stats.presences[0].selected, 'a.txt'); assert.equal(f.stats.presences[1].selected, null);
  await a.rpc('collaboration', 'claim', ['a.txt', {}], { clientId: 'a' });
  const claim = await b.rpc('collaboration', 'claim', ['a.txt', {}], { clientId: 'b' });
  assert.equal(claim.granted, false); assert.equal(claim.peers[0].name, 'Another tab');
  await f.coordinator.destroy();
});

test('source replacement invalidates old clients and a stale tab cannot save into it', async () => {
  const f = fixture(), a = await f.peer('a'), b = await f.peer('b');
  const args = { game: 'poe1', language: 'Thai', source: f.source, generation: 1 };
  await a.rpc('collaboration', 'connect', [args], { clientId: 'editor' });
  await b.rpc('store', 'replaceWorkspace', [{ game: 'poe1', generation: 1, source: f.source, workspace: f.snapshot().workspace }]);
  await assert.rejects(a.rpc('collaboration', 'save', [{ files: [] }], { clientId: 'editor' }), { code: 'SCOPE_CHANGED' });
  await assert.rejects(a.rpc('collaboration', 'connect', [args], { clientId: 'editor-new' }), { code: 'WORKSPACE_CHANGED' });
  assert.equal(f.stats.writes, 1); await f.coordinator.destroy();
});

test('login exchange stays in the coordinator and old contexts cannot issue requests', async () => {
  const f = fixture(), a = await f.peer('a'); const old = a.context();
  await assert.rejects(a.rpc('cloud', 'request', ['/auth/exchange', { method: 'POST' }], { context: old }), { code: 'AUTH_EXCHANGE_PRIVATE' });
  await a.rpc('cloud', 'finishLogin', ['code', 'verifier'], { context: old });
  assert.equal(f.stats.exchanges, 1);
  assert.ok(!JSON.stringify(a.messages).includes('new-secret'));
  await assert.rejects(a.rpc('cloud', 'request', ['/v1/me'], { context: old }), { code: 'CONTEXT_CHANGED' });
  await f.coordinator.destroy();
});

test('assignment changes invalidate translation commands and source replacement captured under the previous access', async () => {
  const f = fixture({ signedIn: true }), a = await f.peer('a');
  const before = a.context();
  await a.rpc('collaboration', 'connect', [{ game: 'poe1', language: 'Thai', source: f.source, generation: 1 }], { clientId: 'editor' });
  f.reassign('French');
  assert.notEqual(a.context().id, before.id);
  assert.ok(f.stats.clients[0].destroyed);
  await assert.rejects(a.rpc('collaboration', 'save', [{ files: [] }], { clientId: 'editor', context: before }), { code: 'CONTEXT_CHANGED' });
  await assert.rejects(a.rpc('store', 'replaceWorkspace', [{ game: 'poe1', generation: 1 }], { context: before }), { code: 'CONTEXT_CHANGED' });
  assert.equal(f.stats.writes, 0); await f.coordinator.destroy();
});

test('translation recovery count and sanitized exports retain the original account ownership', async () => {
  const f = fixture({ signedIn: true });
  const file = { filepath: 'a.txt', translations: ['recover me'], revision: 3, token: 'secret-file-token' };
  const room = accountId => ({ identity: { accountId, game: 'poe1', sourceHash: 'source-one', language: 'Thai', token: 'secret-identity-token' },
    generation: 1, recoveryOnly: true, local: { 'a.txt': file }, outbox: [{ id: 'old-save', files: [{ base: null, yours: file }], token: 'secret-operation-token', wire: { token: 'secret-wire-token' } }],
    conflicts: [{ id: 'conflict', filepath: 'a.txt', yours: file, shared: file, auth: { token: 'secret-conflict-token' } }],
    recovery: [{ reason: 'Source workspace replaced', sourceGeneration: 1, at: 7, files: [file], token: 'secret-recovery-token' }] });
  f.recoveryState({ rooms: { own: room('u1'), anotherAccount: room('u2'), guest: room('guest') } });
  const a = await f.peer('a');
  const snapshot = a.messages.findLast(message => message.event?.type === 'cloud').event.snapshot;
  assert.equal(snapshot.recoveryCount, 1);
  const exported = await a.rpc('cloud', 'recoveryExport', [], { context: a.context() });
  assert.deepEqual(exported.copies, []); assert.equal(exported.translationRecoveries.length, 1);
  assert.equal(exported.translationRecoveries[0].identity.accountId, 'u1');
  assert.equal(exported.translationRecoveries[0].files[0].translations[0], 'recover me');
  assert.equal(exported.translationRecoveries[0].recovery[0].sourceGeneration, 1);
  assert.ok(!JSON.stringify(exported).includes('secret-')); assert.ok(!JSON.stringify(exported).includes('"u2"'));
  await f.coordinator.destroy();
});

test('source replacement refreshes recovery availability in already open tabs', async () => {
  const f = fixture(), a = await f.peer('a');
  assert.equal(a.messages.findLast(message => message.event?.type === 'cloud').event.snapshot.recoveryCount, 0);
  f.recoveryState({ rooms: { old: { identity: { accountId: 'guest', game: 'poe1', language: 'Thai', sourceHash: 'source-one' },
    generation: 1, recoveryOnly: true, local: {}, recovery: [{ reason: 'Workspace reset', files: [] }] } } });
  await a.rpc('store', 'replaceWorkspace', [{ game: 'poe1', generation: 1, source: f.source, workspace: f.snapshot().workspace }]);
  assert.equal(a.messages.findLast(message => message.event?.type === 'cloud').event.snapshot.recoveryCount, 1);
  await f.coordinator.destroy();
});

test('an account assignment changed while source hashing cannot create a room with the new account context', async () => {
  const f = fixture({ signedIn: true }), a = await f.peer('a');
  let release, hashing;
  const started = new Promise(resolve => { hashing = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  f.coordinator.protocol.sourceHash = async () => { hashing(); await blocked; return 'source-one'; };
  const connecting = a.rpc('collaboration', 'connect', [{ game: 'poe1', language: 'Thai', source: f.source, generation: 1 }], { clientId: 'editor' });
  await started; f.reassign('French'); release();
  await assert.rejects(connecting, { code: 'CONTEXT_CHANGED' });
  assert.equal(f.stats.clients.length, 0); await f.coordinator.destroy();
});

test('presence starts after a deferred room join without creating a second durable client', async () => {
  const f = fixture({ signedIn: true, deferredJoin: true }), a = await f.peer('a');
  await a.rpc('collaboration', 'connect', [{ game: 'poe1', language: 'Thai', source: f.source, generation: 1 }], { clientId: 'editor' });
  assert.equal(f.stats.presences[0].args, undefined);
  f.stats.clients[0].saved.roomId = 'joined-later'; f.stats.clients[0].options.onChange();
  await Promise.resolve();
  assert.equal(f.stats.presences[0].args.roomId, 'joined-later');
  assert.equal(f.stats.clients.length, 1); await f.coordinator.destroy();
});

test('closing the final tab releases ownership, while closing only one retains shared synchronization', async () => {
  const f = fixture(), a = await f.peer('a'), b = await f.peer('b'); let released = 0;
  f.store.releaseOwnership = async () => { released++; return true; };
  f.coordinator.detach(a.client);
  assert.equal(f.coordinator.destroyed, false); assert.equal(released, 0);
  f.coordinator.detach(b.client); await Promise.resolve();
  assert.equal(f.coordinator.destroyed, true); assert.equal(released, 1);
});

test('a competing or lost owner is blocked before storage commands run', async () => {
  const busy = fixture({ leaseAvailable: false });
  await assert.rejects(busy.peer('blocked'), { code: 'INSTANCE_BUSY' });
  assert.equal(busy.stats.cloud, 0);
  const f = fixture(), a = await f.peer('a');
  f.store.onStatus({ code: 'DB_VERSION_CHANGED', message: 'Reload the editor.' });
  await assert.rejects(a.rpc('store', 'getWorkspaceSnapshot', ['poe1']), { code: 'DB_VERSION_CHANGED' });
  assert.ok(a.messages.some(item => item.event?.type === 'disconnected'));
  await f.coordinator.destroy(); await busy.coordinator.destroy();
});

test('browser RPC facade supports cached state, per-tab clients and awaited authoritative saves', async () => {
  const f = fixture();
  class FakeWorker {
    constructor() { const channel = new MessageChannel(); this.port = channel.port1; f.coordinator.attach(channel.port2); }
  }
  const events = [];
  const bridge = await new Bridge({ apiBase: f.coordinator.apiBase, SharedWorker: FakeWorker, workerUrl: 'https://editor.example.test/instanceWorker.js',
    onState: event => events.push(event) }).initialize();
  assert.equal(bridge.mode, 'shared'); assert.equal(bridge.cloud.snapshot().settings.lang, 'Thai');
  assert.equal(bridge.cloud.context().token, undefined);
  const client = bridge.createCollaboration({});
  client.setAway(true); client.select('a.txt'); // Mount watchers run before connect.
  await client.connect({ game: 'poe1', language: 'Thai', source: f.source, generation: 1 });
  const result = await client.save({ files: [{ filepath: 'a.txt', translations: ['bridge', 'two'] }] });
  assert.equal(result.workspace.descs[0].translations.Thai[0], 'bridge');
  assert.equal(client.fileBase('a.txt').translations[0], 'bridge');
  assert.ok(events.some(event => event.type === 'workspace'));
  bridge.destroy(); await f.coordinator.destroy();
});

test('unsupported SharedWorker uses a fenced single-tab owner and blocks the second tab', async () => {
  const f = fixture();
  const original = new Map(Object.keys(f.dependencies).map(key => [key, globalThis[key]]));
  let owner;
  f.store.acquireOwnership = async ownerId => {
    if (owner && owner !== ownerId) return null;
    owner = ownerId; return { ownerId, generation: 1, expiresAt: Date.now() + 30000 };
  };
  f.store.releaseOwnership = async lease => { if (owner === lease.ownerId) owner = null; return true; };
  Object.assign(globalThis, f.dependencies);
  let first, second;
  try {
    first = await new Bridge({ apiBase: f.coordinator.apiBase, SharedWorker: null, store: f.store }).initialize();
    assert.equal(first.mode, 'single'); assert.match(first.fallbackReason, /does not support/);
    second = new Bridge({ apiBase: f.coordinator.apiBase, SharedWorker: null, store: f.store });
    await assert.rejects(second.initialize(), { code: 'INSTANCE_BUSY' });
    assert.ok(owner); assert.equal(f.stats.cloud, 1);
  } finally {
    second?.destroy(); first?.destroy(); await first?.localCoordinator?.destroy();
    for (const [key, value] of original) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    await f.coordinator.destroy();
  }
});

test('an unacknowledged committed save reconnects with the same request ID without duplicating its write', async () => {
  const f = fixture(); const ids = [];
  let current = f.coordinator;
  const track = coordinator => {
    const receive = coordinator.receive.bind(coordinator);
    coordinator.receive = async (peer, message) => { if (message.method === 'save') ids.push(message.id); return receive(peer, message); };
  };
  track(current);
  class FakeWorker {
    constructor() { const channel = new MessageChannel(); this.port = channel.port1; current.attach(channel.port2); }
  }
  let committed;
  const commit = new Promise(resolve => { committed = resolve; });
  const bridge = await new Bridge({ apiBase: f.coordinator.apiBase, SharedWorker: FakeWorker, workerUrl: 'https://editor.example.test/instanceWorker.js',
    onState: event => { if (event.type === 'workspace' && event.revision === 2) committed(); } }).initialize();
  const client = bridge.createCollaboration({});
  await client.connect({ game: 'poe1', language: 'Thai', source: f.source, generation: 1 });
  const saving = client.save({ files: [{ filepath: 'a.txt', translations: ['recovered', 'two'] }] });
  await commit; bridge.lost(new Error('Simulated port loss before reply'));
  clearTimeout(bridge.reconnectTimer); await current.destroy();
  current = new Coordinator({ ...f.dependencies, store: f.store, apiBase: f.coordinator.apiBase, fetch: async () => {},
    setInterval: () => 1, clearInterval() {} });
  track(current); await bridge.reconnect();
  const result = await saving;
  assert.equal(result.workspace.descs[0].translations.Thai[0], 'recovered');
  assert.equal(f.stats.writes, 1); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); assert.equal(f.stats.cloud, 2);
  assert.equal(bridge.paused, false);
  bridge.destroy(); await current.destroy();
});
