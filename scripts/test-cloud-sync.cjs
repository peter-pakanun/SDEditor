const assert = require('node:assert/strict');
const { test } = require('node:test');
const Cloud = require('../public/cloudSync.js');
const Dictionary = require('../public/dictionarySync.js');

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const word = (_id = 'fire', fields = {}) => ({ _id, find: 'Fire', replace: 'ไฟ', alts: [], tlnote: '', ...fields });
const dictionary = (entries = [], revision = 1, tombstones = []) => ({ revision, entries: clone(entries), tombstones });
const settings = (fields = {}) => ({ lang: 'Thai', theme: 'grey', editorRegexes: [], ...fields });
const user = (id = 'alice', language = 'Thai') => ({ id, email: id + '@example.test', name: id, language, isAdmin: false });
const payload = (entries = [], fields = {}) => ({ ...settings(), dictionary: clone(entries), editorClipboard: 'local clipboard', ...fields });
const reply = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => clone(body) });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Transactions clone their input and publish only at commit, like structured
// cloning and atomic read/modify/write in the real IndexedDB adapter.
class MemoryStore {
  constructor(state = null) { this.state = clone(state); this.tail = Promise.resolve(); this.events = []; this.updates = 0; this.nextError = null; this.nextGate = null; }
  updateHybridState(updater) {
    this.updates++;
    const operation = this.tail.then(async () => {
      const next = updater(clone(this.state));
      const error = this.nextError;
      const gate = this.nextGate;
      this.nextError = null;
      this.nextGate = null;
      if (gate) { gate.entered.resolve(); await gate.release.promise; }
      if (error) throw error;
      this.state = clone(next);
      this.events.push({ type: 'commit', state: clone(this.state) });
      return clone(this.state);
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  async getHybridState() { await this.tail; return clone(this.state); }
  pauseNextCommit() {
    const gate = { entered: deferred(), release: deferred() };
    this.nextGate = gate;
    return gate;
  }
}

class MemoryAPI {
  constructor() {
    this.users = { 'token-alice': user(), 'token-bob': user('bob'), 'token-unassigned': user('unassigned', null) };
    this.settings = new Map();
    this.dictionaries = new Map();
    this.mutations = new Map();
    this.calls = [];
    this.online = true;
    this.intercept = null;
    this.after = null;
  }
  async fetch(url, options) {
    const request = {
      path: new URL(url).pathname,
      method: options.method,
      token: (options.headers.Authorization || '').replace(/^Bearer /, ''),
      body: options.body ? JSON.parse(options.body) : null,
      options
    };
    this.calls.push(request);
    if (!this.online) throw new Error('Network unavailable');
    if (this.intercept) {
      const intercepted = await this.intercept(request);
      if (intercepted !== undefined) return intercepted;
    }
    const identity = this.users[request.token];
    if (!identity) return reply({ error: { code: 'UNAUTHORIZED', message: 'Session expired' } }, 401);
    const me = { user: clone(identity), expiresAt: Date.now() + 30 * 86400000 };
    let response;
    if (request.path === '/v1/me' || request.path === '/auth/session/refresh') response = me;
    else if (request.path === '/auth/logout') return reply(null, 204);
    else if (request.path === '/v1/settings') {
      if (!identity.language) return reply({ error: { message: 'Not configured' } }, 403);
      const current = this.settings.get(identity.id) || { revision: 0, settings: null };
      if (request.method === 'GET') response = clone(current);
      else {
        const mutationKey = 'settings:' + identity.id + ':' + request.body.mutationId;
        if (this.mutations.has(mutationKey)) response = { ...clone(current), appliedRevision: this.mutations.get(mutationKey) };
        else {
          if (request.body.baseRevision !== current.revision) return reply({ error: { code: 'REVISION_CONFLICT', message: 'Newer settings' }, current }, 409);
          const changed = { revision: current.revision + 1, settings: clone(request.body.settings) };
          this.settings.set(identity.id, clone(changed));
          this.mutations.set(mutationKey, changed.revision);
          response = { ...changed, appliedRevision: changed.revision };
        }
      }
    } else if (request.path.startsWith('/v1/dictionaries/')) {
      const language = decodeURIComponent(request.path.slice('/v1/dictionaries/'.length));
      if (language !== identity.language) return reply({ error: { message: 'Language access denied' } }, 403);
      const current = this.dictionaries.get(language) || dictionary([], 0);
      if (request.method === 'GET') response = clone(current);
      else {
        const mutationKey = language + ':' + request.body.mutationId;
        if (this.mutations.has(mutationKey)) response = { ...clone(current), appliedRevision: this.mutations.get(mutationKey) };
        else {
          if (request.body.baseRevision !== current.revision) return reply({ error: { code: 'REVISION_CONFLICT', message: 'Newer dictionary' }, current }, 409);
          const changed = Cloud.acceptedSnapshot(current, request.body.upserts, request.body.deletedIds, current.revision + 1);
          this.dictionaries.set(language, clone(changed));
          this.mutations.set(mutationKey, changed.revision);
          response = { ...clone(changed), appliedRevision: changed.revision };
        }
      }
    } else throw new Error('Unexpected API request: ' + request.method + ' ' + request.path);
    if (this.after) {
      const modified = await this.after(request, clone(response));
      if (modified !== undefined) return modified;
    }
    return reply(response);
  }
  writes(path) { return this.calls.filter(call => ['PATCH', 'PUT'].includes(call.method) && (!path || call.path === path)); }
  pause(method, path) {
    const entered = deferred();
    const release = deferred();
    let intercepted = false;
    this.intercept = async request => {
      if (!intercepted && request.method === method && request.path === path) {
        intercepted = true;
        entered.resolve(request);
        return release.promise;
      }
    };
    return { entered, release };
  }
}

function authenticatedState({ local = [word()], base = dictionary([word()]), localSettings = settings(), settingsBase = { revision: 1, settings: settings() }, id = 'alice', language = 'Thai' } = {}) {
  const state = Cloud.initializeState(payload(local, localSettings));
  state.profiles[id] = clone(state.profiles.guest);
  state.profiles[id].settingsBase = clone(settingsBase);
  state.profiles[id].dictionaries[localSettings.lang] = { entries: clone(local), base: clone(base), conflicts: [], pendingResolution: null, revision: base?.revision || 0 };
  state.activeProfile = id;
  state.auth = { token: 'token-' + id, user: user(id, language), expiresAt: Date.now() + 86400000 };
  return state;
}

let clientNumber = 0;
async function harness(t, { state = null, legacy = payload([word()]), store = new MemoryStore(state), api = new MemoryAPI() } = {}) {
  const changes = [];
  const statuses = [];
  let uuid = 0;
  const namespace = ++clientNumber;
  const client = new Cloud.Client({ store, merge: Dictionary, fetch: api.fetch.bind(api), apiBase: 'https://api.example.test', uuid: () => 'client-' + namespace + '-mutation-' + ++uuid,
    onChange: value => changes.push(clone(value)), onStatus: value => statuses.push(clone(value)) });
  // Advance polls explicitly; tests do not leave timer-driven background work.
  client.scheduled = [];
  client.schedule = delay => client.scheduled.push(delay ?? 1000);
  t.after(() => client.destroy());
  await client.initialize(legacy);
  return { client, store, api, changes, statuses };
}

function seedAPI(api, { remote = dictionary([word()]), remoteSettings = settings(), settingsRevision = 1, id = 'alice' } = {}) {
  api.settings.set(id, { revision: settingsRevision, settings: clone(remoteSettings) });
  api.dictionaries.set('Thai', clone(remote));
}

test('preferences and exported recovery exclude dictionary, clipboard, and bearer tokens', async t => {
  const legacy = payload([word()], { token: 'must-not-export', editorClipboard: 'private clipboard' });
  assert.equal(Object.hasOwn(Cloud.preferences(legacy), 'dictionary'), false);
  assert.equal(Object.hasOwn(Cloud.preferences(legacy), 'editorClipboard'), false);
  assert.equal(Object.hasOwn(Cloud.preferences(legacy), 'token'), false);
  const h = await harness(t, { legacy });
  seedAPI(h.api, { remoteSettings: settings({ theme: 'dark' }) });
  await h.client.acceptLogin({ token: 'token-alice', user: user(), expiresAt: 1 });
  assert.equal(JSON.stringify(h.client.snapshot()).includes('token-alice'), false);
  assert.equal(JSON.stringify(h.client.recoveryExport()).includes('token-alice'), false);
  assert.equal(h.client.snapshot().editorClipboard, 'private clipboard');
});

test('local dictionary is durable before a concurrent sync may upload it', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api);
  const changed = word('fire', { replace: 'saved first' });
  const gate = h.store.pauseNextCommit();
  const saving = h.client.saveLocal(payload([changed]));
  await gate.entered.promise;
  const syncing = h.client.sync();
  await Promise.resolve();
  assert.equal(h.api.writes().length, 0);
  h.api.intercept = request => {
    if (request.method === 'PATCH') assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'saved first');
  };
  gate.release.resolve();
  await saving;
  await syncing;
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'saved first');
});

test('first login restores cloud settings and keeps local recovery and clipboard', async t => {
  const h = await harness(t, { legacy: payload([word()], { theme: 'light', editorRegexes: [{ find: 'local', replace: 'l' }], editorClipboard: 'private' }) });
  const cloudSettings = settings({ theme: 'dark', editorRegexes: [{ find: 'remote', replace: 'r' }] });
  seedAPI(h.api, { remoteSettings: cloudSettings });
  await h.client.acceptLogin({ token: 'token-alice', user: user(), expiresAt: 1 });
  assert.deepEqual(h.client.snapshot().settings, cloudSettings);
  assert.equal(h.client.snapshot().editorClipboard, 'private');
  const recovery = h.client.recoveryExport().copies.find(item => item.reason === 'Before first cloud restore');
  assert.equal(recovery.settings.theme, 'light');
  assert.deepEqual(recovery.settings.editorRegexes, [{ find: 'local', replace: 'l' }]);
  assert.deepEqual(recovery.dictionaries.Thai, [word()]);
  assert.deepEqual(h.api.writes('/v1/settings'), []);
});

test('signed out and unassigned users stay local and make no backup calls', async t => {
  const h = await harness(t);
  await h.client.saveLocal(payload([word('fire', { replace: 'guest edit' })]));
  await h.client.sync();
  assert.equal(h.api.calls.length, 0);
  await h.client.acceptLogin({ token: 'token-unassigned', user: user('unassigned', null), expiresAt: 1 });
  await h.client.saveLocal(payload([word('fire', { replace: 'unassigned edit' })]));
  await h.client.sync();
  assert.equal(h.api.calls.some(call => call.path === '/v1/settings' || call.path.startsWith('/v1/dictionaries/')), false);
  assert.equal(h.client.snapshot().dictionary[0].replace, 'unassigned edit');
  assert.match(h.statuses.at(-1).message, /Not configured/);
});

test('offline edits persist and merge independent remote changes on reconnect', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api);
  h.api.online = false;
  await h.client.saveLocal(payload([word('fire', { replace: 'offline local' })]));
  await h.client.sync();
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'offline local');
  assert.match(h.statuses.at(-1).message, /cloud unavailable/);
  h.api.online = true;
  h.api.dictionaries.set('Thai', dictionary([word('fire', { tlnote: 'remote note' })], 2));
  await h.client.sync();
  assert.equal(h.client.snapshot().dictionary[0].replace, 'offline local');
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'remote note');
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'offline local');
  assert.deepEqual(h.client.snapshot().conflicts, []);
});

test('content conflicts survive another poll and a client reload without uploading the conflicted entry', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'local' })] }) });
  seedAPI(h.api, { remote: dictionary([word('fire', { replace: 'remote' })], 2) });
  await h.client.sync();
  assert.equal(h.client.snapshot().conflicts.length, 1);
  await h.client.sync();
  assert.equal(h.client.snapshot().conflicts.length, 1);
  h.client.destroy();
  const next = await harness(t, { store: h.store, api: h.api });
  await next.client.sync();
  assert.equal(next.client.snapshot().conflicts.length, 1);
  assert.equal(next.client.snapshot().dictionary[0].replace, 'local');
  assert.equal(h.api.writes('/v1/dictionaries/Thai').length, 0);
});

test('a first-attachment tombstone conflict survives later polls and reload', async t => {
  const h = await harness(t, { state: authenticatedState({ base: null }) });
  seedAPI(h.api, { remote: dictionary([], 3, ['fire']) });
  await h.client.sync();
  assert.equal(h.client.snapshot().conflicts[0].reason, 'remote-deletion');
  await h.client.sync();
  assert.equal(h.client.snapshot().conflicts[0].reason, 'remote-deletion');
  h.client.destroy();
  const next = await harness(t, { store: h.store, api: h.api });
  await next.client.sync();
  assert.equal(next.client.snapshot().conflicts[0].reason, 'remote-deletion');
  assert.deepEqual(h.api.dictionaries.get('Thai').entries, []);
  assert.equal(h.api.writes('/v1/dictionaries/Thai').length, 0);
});

test('unaffected entries sync without clearing another entry conflict', async t => {
  const old = [word('a'), word('b', { find: 'Ice' })];
  const local = [word('a', { replace: 'own' }), word('b', { find: 'Ice', tlnote: 'local B' })];
  const h = await harness(t, { state: authenticatedState({ local, base: dictionary(old) }) });
  seedAPI(h.api, { remote: dictionary([word('a', { replace: 'other' }), old[1]], 2) });
  await h.client.sync();
  const requests = h.api.writes('/v1/dictionaries/Thai');
  assert.deepEqual(requests.map(call => call.body.upserts.map(entry => entry._id)), [['b']]);
  assert.equal(h.api.dictionaries.get('Thai').entries.find(entry => entry._id === 'b').tlnote, 'local B');
  assert.deepEqual(h.client.snapshot().conflicts.map(conflict => conflict.id), ['a']);
  await h.client.sync();
  assert.deepEqual(h.client.snapshot().conflicts.map(conflict => conflict.id), ['a']);
});

test('settings changed while a settings PUT is pending remain local and upload on the next poll', async t => {
  const h = await harness(t, { state: authenticatedState({ localSettings: settings({ theme: 'dark' }) }) });
  seedAPI(h.api);
  const gate = h.api.pause('PUT', '/v1/settings');
  const running = h.client.sync();
  const request = await gate.entered.promise;
  assert.equal(request.body.settings.theme, 'dark');
  await h.client.saveLocal(payload([word()], { theme: 'light' }));
  gate.release.resolve();
  await running;
  assert.equal(h.client.snapshot().settings.theme, 'light');
  assert.equal(h.api.settings.get('alice').settings.theme, 'dark');
  await h.client.sync();
  assert.equal(h.api.settings.get('alice').settings.theme, 'light');
});

test('dictionary changes made while PATCH is pending remain pending after acknowledgement', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'submitted' })] }) });
  seedAPI(h.api);
  const gate = h.api.pause('PATCH', '/v1/dictionaries/Thai');
  const running = h.client.sync();
  await gate.entered.promise;
  await h.client.saveLocal(payload([word('fire', { replace: 'typed later' })]));
  gate.release.resolve();
  await running;
  assert.equal(h.client.snapshot().dictionary[0].replace, 'typed later');
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'submitted');
  await h.client.sync();
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'typed later');
});

test('PATCH response can include remote changes newer than its appliedRevision', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'submitted' })] }) });
  seedAPI(h.api);
  let changed = false;
  h.api.after = (request, response) => {
    if (!changed && request.method === 'PATCH') {
      changed = true;
      const current = dictionary([word('fire', { replace: 'later remote', tlnote: 'newer note' })], response.revision + 1);
      h.api.dictionaries.set('Thai', clone(current));
      return reply({ ...current, appliedRevision: response.appliedRevision });
    }
  };
  await h.client.sync();
  assert.equal(h.client.snapshot().dictionary[0].replace, 'later remote');
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'newer note');
  assert.equal(h.client.snapshot().revision, 3);
  assert.deepEqual(h.client.snapshot().conflicts, []);
  await h.client.sync();
  assert.equal(h.api.writes('/v1/dictionaries/Thai').length, 1);
});

test('ordinary optimistic dictionary 409 rebases independent changes before retrying', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'own edit' })] }) });
  seedAPI(h.api);
  let raced = false;
  h.api.intercept = request => {
    if (request.method === 'PATCH' && !raced) {
      raced = true;
      const newer = dictionary([word('fire', { tlnote: 'concurrent note' })], 2);
      h.api.dictionaries.set('Thai', newer);
      return reply({ error: { message: 'Changed' }, current: newer }, 409);
    }
  };
  await h.client.sync();
  assert.equal(h.api.writes('/v1/dictionaries/Thai').length, 2);
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'own edit');
  assert.equal(h.api.dictionaries.get('Thai').entries[0].tlnote, 'concurrent note');
  assert.deepEqual(h.client.snapshot().conflicts, []);
});

test('ordinary settings 409 keeps local preference changes while accepting unrelated remote preferences', async t => {
  const h = await harness(t, { state: authenticatedState({ localSettings: settings({ theme: 'dark' }) }) });
  seedAPI(h.api);
  let raced = false;
  h.api.intercept = request => {
    if (request.method === 'PUT' && request.path === '/v1/settings' && !raced) {
      raced = true;
      const newer = { revision: 2, settings: settings({ uiDensity: 'spacious' }) };
      h.api.settings.set('alice', newer);
      return reply({ error: { message: 'Changed' }, current: newer }, 409);
    }
  };
  await h.client.sync();
  assert.equal(h.api.settings.get('alice').settings.theme, 'dark');
  assert.equal(h.api.settings.get('alice').settings.uiDensity, 'spacious');
  assert.equal(h.api.writes('/v1/settings').length, 2);
});

test('choosing remote applies the result even when independent remote changes were already merged', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'local' })] }) });
  seedAPI(h.api, { remote: dictionary([word('fire', { replace: 'remote', tlnote: 'independent note' })], 2) });
  await h.client.sync();
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'independent note');
  await h.client.resolveConflict('fire', { definitions: 'remote', note: 'remote' }, 2);
  assert.equal(h.client.snapshot().dictionary[0].replace, 'remote');
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'independent note');
  await h.client.sync();
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'remote');
  assert.deepEqual(h.client.snapshot().conflicts, []);
});

test('resolution acknowledgement preserves a note typed in flight and still applies the chosen replacement', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'local' })] }) });
  seedAPI(h.api, { remote: dictionary([word('fire', { replace: 'remote' })], 2) });
  await h.client.sync();
  const gate = h.api.pause('PATCH', '/v1/dictionaries/Thai');
  const resolving = h.client.resolveConflict('fire', { definitions: 'remote', note: 'remote' }, 2);
  await gate.entered.promise;
  await h.client.saveLocal(payload([word('fire', { replace: 'local', tlnote: 'typed during resolution' })]));
  gate.release.resolve();
  await resolving;
  assert.equal(h.client.snapshot().dictionary[0].replace, 'remote');
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'typed during resolution');
  await h.client.sync();
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'remote');
  assert.equal(h.api.dictionaries.get('Thai').entries[0].tlnote, 'typed during resolution');
});

test('pending resolution is durable before PATCH and retries after restart with the same mutation ID', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'local' })] }) });
  seedAPI(h.api, { remote: dictionary([word('fire', { replace: 'remote' })], 2) });
  await h.client.sync();
  h.api.intercept = request => {
    if (request.method === 'PATCH') {
      const pending = h.store.state.profiles.alice.dictionaries.Thai.pendingResolution;
      assert.equal(pending.mutationId, request.body.mutationId);
      throw new Error('Network lost before response');
    }
  };
  await assert.rejects(h.client.resolveConflict('fire', { definitions: 'local', note: 'local' }, 2), /Network lost/);
  const pending = clone(h.store.state.profiles.alice.dictionaries.Thai.pendingResolution);
  assert.ok(pending);
  h.client.destroy();
  h.api.intercept = null;
  const next = await harness(t, { store: h.store, api: h.api });
  await next.client.sync();
  assert.equal(h.api.writes('/v1/dictionaries/Thai').at(-1).body.mutationId, pending.mutationId);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.pendingResolution, null);
  assert.equal(next.client.snapshot().dictionary[0].replace, 'local');
  assert.deepEqual(next.client.snapshot().conflicts, []);
});

test('accepted resolution whose response was lost is idempotent after restart', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'local' })] }) });
  seedAPI(h.api, { remote: dictionary([word('fire', { replace: 'remote' })], 2) });
  await h.client.sync();
  let loseResponse = true;
  h.api.after = request => {
    if (request.method === 'PATCH' && loseResponse) { loseResponse = false; throw new Error('Response lost'); }
  };
  await assert.rejects(h.client.resolveConflict('fire', { definitions: 'local', note: 'local' }, 2), /Response lost/);
  assert.equal(h.api.dictionaries.get('Thai').revision, 3);
  h.client.destroy();
  const next = await harness(t, { store: h.store, api: h.api });
  await next.client.sync();
  assert.equal(h.api.dictionaries.get('Thai').revision, 3);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.pendingResolution, null);
  assert.deepEqual(next.client.snapshot().conflicts, []);
});

test('pending resolution rejected with 409 after restart refreshes the conflict instead of overwriting', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'local' })] }) });
  seedAPI(h.api, { remote: dictionary([word('fire', { replace: 'remote' })], 2) });
  await h.client.sync();
  h.api.online = false;
  await assert.rejects(h.client.resolveConflict('fire', { definitions: 'local', note: 'local' }, 2), /Network unavailable/);
  h.client.destroy();
  h.api.online = true;
  h.api.dictionaries.set('Thai', dictionary([word('fire', { replace: 'newer remote', tlnote: 'new note' })], 3));
  const next = await harness(t, { store: h.store, api: h.api });
  await next.client.sync();
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.pendingResolution, null);
  assert.equal(next.client.snapshot().conflicts.length, 1);
  assert.equal(next.client.snapshot().conflicts[0].remote.replace, 'newer remote');
  assert.equal(next.client.snapshot().dictionary[0].replace, 'local');
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'newer remote');
  assert.match(next.statuses.at(-1).message, /Review the refreshed/);
});

test('switching account cancels stale response application and never adopts the outgoing draft', async t => {
  const state = authenticatedState({ local: [word('fire', { replace: 'Alice private draft' })] });
  state.profiles.guest.dictionaries.Thai.entries = [word('guest', { find: 'Guest', replace: 'guest entry' })];
  const h = await harness(t, { state });
  seedAPI(h.api);
  h.api.settings.set('bob', { revision: 1, settings: settings({ theme: 'dark' }) });
  const gate = h.api.pause('GET', '/v1/settings');
  const running = h.client.sync();
  await gate.entered.promise;
  const switching = h.client.acceptLogin({ token: 'token-bob', user: user('bob'), expiresAt: 1 });
  // Wait for the account transaction, which is independent from the fetch.
  await h.store.tail;
  assert.equal(h.store.state.activeProfile, 'bob');
  gate.release.resolve(reply({ revision: 999, settings: settings({ theme: 'light' }) }));
  await running;
  await switching;
  assert.equal(h.client.snapshot().profileId, 'bob');
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'Alice private draft');
  assert.equal(h.store.state.profiles.bob.dictionaries.Thai.entries.some(entry => entry.replace === 'Alice private draft'), false);
  assert.equal(h.api.writes().some(request => request.token === 'token-alice'), false);
  await h.client.sync();
  assert.equal(h.client.snapshot().settings.theme, 'dark');
});

test('local language switching isolates dictionaries and stale save callbacks cannot overwrite another language', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api);
  await h.client.selectLanguage('French', payload([word('fire', { replace: 'Thai draft' })], { lang: 'French' }), 'Thai');
  assert.equal(h.client.snapshot().settings.lang, 'French');
  assert.deepEqual(h.client.snapshot().dictionary, []);
  await h.client.saveLocal(payload([word('wrong', { find: 'Wrong' })], { lang: 'Thai' }), 'Thai');
  assert.deepEqual(h.client.snapshot().dictionary, []);
  await h.client.saveLocal(payload([word('fr', { find: 'Fire', replace: 'Feu' })], { lang: 'French' }));
  await h.client.sync();
  assert.equal(h.api.calls.some(request => request.path.endsWith('/French')), false);
  assert.equal(h.client.snapshot().dictionary[0].replace, 'Feu');
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'Thai draft');
  await h.client.selectLanguage('Thai', payload([word('fr', { replace: 'Feu' })], { lang: 'Thai' }), 'French');
  assert.equal(h.client.snapshot().dictionary[0].replace, 'Thai draft');
  assert.equal(h.store.state.profiles.alice.dictionaries.French.entries[0].replace, 'Feu');
});

test('switching the local language cancels a delayed cloud response from the previous UI context', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api);
  const gate = h.api.pause('GET', '/v1/dictionaries/Thai');
  const syncing = h.client.sync();
  await gate.entered.promise;
  await h.client.selectLanguage('French', payload([word()], { lang: 'French' }), 'Thai');
  gate.release.resolve(reply(dictionary([word('fire', { replace: 'late Thai response' })], 2)));
  await syncing;
  assert.equal(h.client.snapshot().settings.lang, 'French');
  assert.deepEqual(h.client.snapshot().dictionary, []);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'ไฟ');
  assert.equal(h.api.writes('/v1/dictionaries/Thai').length, 0);
});

test('two stale clients saving the same account preserve each other\'s independent edits and additions', async t => {
  const original = [word('a'), word('b', { find: 'Ice' })];
  const first = await harness(t, { state: authenticatedState({ local: original, base: dictionary(original) }) });
  const second = await harness(t, { store: first.store, api: first.api });
  const added = word('c', { find: 'Lightning', replace: 'new item' });
  await first.client.saveLocal(payload([word('a', { replace: 'first client' }), original[1], added], { theme: 'dark', editorClipboard: 'first clipboard' }));
  await second.client.saveLocal(payload([original[0], word('b', { find: 'Ice', tlnote: 'second client' })]));
  const profile = first.store.state.profiles.alice;
  assert.equal(profile.dictionaries.Thai.entries.find(entry => entry._id === 'a').replace, 'first client');
  assert.equal(profile.dictionaries.Thai.entries.find(entry => entry._id === 'b').tlnote, 'second client');
  assert.deepEqual(profile.dictionaries.Thai.entries.find(entry => entry._id === 'c'), added);
  assert.equal(profile.settings.theme, 'dark');
  assert.equal(profile.clipboard, 'first clipboard');
  assert.equal(second.changes.at(-1).dictionary.find(entry => entry._id === 'a').replace, 'first client');
});

test('conflicting same-field saves from stale tabs reject atomically and preserve the durable first writer', async t => {
  const first = await harness(t, { state: authenticatedState() });
  const second = await harness(t, { store: first.store, api: first.api });
  await first.client.saveLocal(payload([word('fire', { replace: 'first' })], { theme: 'dark' }));
  const before = clone(first.store.state);
  await assert.rejects(second.client.saveLocal(payload([word('fire', { replace: 'second' })], { theme: 'light' })), /another tab/i);
  assert.deepEqual(first.store.state, before);
  assert.equal(first.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'first');
});

test('rejected IndexedDB save never mutates durable/client state or uploads the unsaved draft', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api);
  const before = clone(h.store.state);
  h.store.nextError = new Error('IndexedDB quota exceeded');
  await assert.rejects(h.client.saveLocal(payload([word('fire', { replace: 'not durable' })])), /quota exceeded/);
  assert.deepEqual(h.store.state, before);
  assert.deepEqual(h.client.state, before);
  await h.client.sync();
  assert.equal(h.api.writes('/v1/dictionaries/Thai').length, 0);
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'ไฟ');
});

test('failure to persist a merge prevents any cloud mutation', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'local' })] }) });
  seedAPI(h.api);
  h.api.intercept = request => {
    if (request.method === 'GET' && request.path === '/v1/dictionaries/Thai') h.store.nextError = new Error('Disk write failed');
  };
  await h.client.sync();
  assert.equal(h.api.writes('/v1/dictionaries/Thai').length, 0);
  assert.match(h.statuses.at(-1).message, /Disk write failed/);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'local');
});

test('session refresh keeps its credential outside snapshots, and 401 retains local account edits', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'pending' })] }) });
  seedAPI(h.api);
  await h.client.refreshSession(true);
  assert.equal(h.client.snapshot().signedIn, true);
  assert.equal(JSON.stringify(h.client.snapshot()).includes('token-alice'), false);
  delete h.api.users['token-alice'];
  await h.client.refreshSession(true);
  assert.equal(h.client.snapshot().signedIn, false);
  assert.equal(h.client.snapshot().profileId, 'alice');
  assert.equal(h.client.snapshot().dictionary[0].replace, 'pending');
  assert.match(h.statuses.at(-1).message, /Session expired/);
});

test('rapid queued saves from one tab commit in order and the latest captured draft wins', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api);
  const gate = h.store.pauseNextCommit();
  const first = h.client.saveLocal(payload([word('fire', { replace: 'first' })], { theme: 'dark' }));
  const second = h.client.saveLocal(payload([word('fire', { replace: 'second' })], { theme: 'grey' }));
  const latestPayload = payload([word('fire', { replace: 'latest', tlnote: 'complete latest draft' })], { theme: 'light' });
  const latest = h.client.saveLocal(latestPayload);
  latestPayload.dictionary[0].replace = 'mutation after enqueue must not leak';
  await gate.entered.promise;
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'ไฟ');
  gate.release.resolve();
  await Promise.all([first, second, latest]);
  assert.equal(h.client.snapshot().dictionary[0].replace, 'latest');
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'complete latest draft');
  assert.equal(h.client.snapshot().settings.theme, 'light');
  await h.client.sync();
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'latest');
  assert.equal(h.api.writes('/v1/dictionaries/Thai').length, 1);
});

test('a rejected queued save does not prevent the next local draft from being saved', async t => {
  const h = await harness(t, { state: authenticatedState() });
  h.store.nextError = new Error('Temporary storage failure');
  const rejected = h.client.saveLocal(payload([word('fire', { replace: 'failed' })]));
  const retried = h.client.saveLocal(payload([word('fire', { replace: 'retry succeeds' })]));
  const result = await Promise.allSettled([rejected, retried]);
  assert.equal(result[0].status, 'rejected');
  assert.equal(result[1].status, 'fulfilled');
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'retry succeeds');
});

test('malformed imports reject before opening a transaction and leave all local data unchanged', async t => {
  const h = await harness(t, { state: authenticatedState() });
  const before = clone(h.store.state);
  const updatesBefore = h.store.updates;
  const invalid = [
    null,
    [],
    { lang: 'Not a language' },
    { theme: 'unknown' },
    { highlightDict: 'yes' },
    { editorClipboard: { secret: 'not text' } },
    { editorRegexes: [{ find: 'pattern', replace: 3 }] },
    { dictionary: {} },
    { dictionary: [{ find: 'Find', replace: 7 }] },
    { dictionary: [word('id', { tlnote: [] })] },
    { dictionary: [word(7)] },
    { dictionary: [word('id', { alts: [{ find: 'Alias', replace: {} }] })] },
    { gamePreviewFonts: { Thai: 3 } }
  ];
  for (const value of invalid) await assert.rejects(h.client.importLocal(value), /Invalid settings file/);
  assert.equal(h.store.updates, updatesBefore);
  assert.deepEqual(h.store.state, before);
  assert.deepEqual(h.client.state, before);
  assert.equal(h.api.calls.length, 0);
});

test('valid import normalizes legacy entry and alternate identities without mutating the file payload', async t => {
  const h = await harness(t);
  const imported = { lang: 'Thai', dictionary: [{ find: 'Fire', replace: 'ไฟ', alts: [{ find: 'Flame' }] }] };
  const original = clone(imported);
  await h.client.importLocal(imported);
  const entry = h.client.snapshot().dictionary[0];
  assert.equal(typeof entry._id, 'string');
  assert.ok(entry._id);
  assert.equal(typeof entry.alts[0]._id, 'string');
  assert.equal(entry.alts[0].replace, 'ไฟ');
  assert.equal(entry.tlnote, '');
  assert.deepEqual(imported, original);
  assert.equal(h.client.snapshot().recoveryCount, 1);
});

test('dictionary imported without a language belongs only to the active profile across logout and account switches', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api);
  const privateEntry = word('private-alice', { find: 'Private term', replace: 'Alice only' });
  await h.client.importLocal(payload([privateEntry], { lang: '', editorClipboard: 'Alice private clipboard' }));
  assert.equal(h.client.snapshot().needsDictionaryLanguage, true);
  assert.deepEqual(h.store.state.profiles.alice.unassignedDictionary, [privateEntry]);
  assert.equal(h.store.state.profiles.guest.unassignedDictionary, null);
  await h.client.logout();
  assert.equal(h.client.snapshot().profileId, 'guest');
  assert.equal(h.client.snapshot().needsDictionaryLanguage, false);
  assert.equal(h.client.snapshot().dictionary.some(entry => entry._id === privateEntry._id), false);
  await h.client.acceptLogin({ token: 'token-bob', user: user('bob'), expiresAt: 1 });
  assert.equal(h.client.snapshot().needsDictionaryLanguage, false);
  assert.equal(h.store.state.profiles.bob.unassignedDictionary, null);
  await h.client.selectLanguage('French', payload(h.client.snapshot().dictionary, { lang: 'French' }), 'Thai');
  assert.equal(h.client.snapshot().dictionary.some(entry => entry._id === privateEntry._id), false);
  await h.client.acceptLogin({ token: 'token-alice', user: user(), expiresAt: 1 });
  assert.equal(h.client.snapshot().needsDictionaryLanguage, true);
  await h.client.selectLanguage('French', payload([], { lang: 'French' }), '');
  assert.deepEqual(h.client.snapshot().dictionary, [privateEntry]);
  assert.equal(h.store.state.profiles.alice.unassignedDictionary, null);
  assert.equal(h.store.state.profiles.bob.dictionaries.French.entries.some(entry => entry._id === privateEntry._id), false);
  assert.equal(h.api.writes('/v1/dictionaries/Thai').some(request => request.body.upserts.some(entry => entry._id === privateEntry._id)), false);
});

test('normal dictionary write retries its lost acknowledgement before merging newer local and remote edits', async t => {
  const submitted = word('fire', { replace: 'first submitted edit' });
  const h = await harness(t, { state: authenticatedState({ local: [submitted] }) });
  seedAPI(h.api);
  let lose = true;
  h.api.after = (request) => {
    if (request.method === 'PATCH' && lose) {
      lose = false;
      const pending = h.store.state.profiles.alice.dictionaries.Thai.pendingWrite;
      assert.equal(pending.request.mutationId, request.body.mutationId);
      throw new Error('Accepted but acknowledgement lost');
    }
  };
  await h.client.sync();
  const pending = clone(h.store.state.profiles.alice.dictionaries.Thai.pendingWrite);
  assert.ok(pending);
  assert.equal(h.api.dictionaries.get('Thai').revision, 2);
  await h.client.saveLocal(payload([word('fire', { replace: 'latest local edit' })]));
  h.api.dictionaries.set('Thai', dictionary([word('fire', { replace: 'first submitted edit', tlnote: 'later remote note' })], 3));
  h.client.destroy();
  const next = await harness(t, { store: h.store, api: h.api });
  await next.client.sync();
  const requests = h.api.writes('/v1/dictionaries/Thai');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].body.mutationId, requests[1].body.mutationId);
  assert.equal(requests[1].body.mutationId, pending.request.mutationId);
  assert.notEqual(requests[2].body.mutationId, pending.request.mutationId);
  assert.equal(h.api.dictionaries.get('Thai').revision, 4);
  assert.equal(h.api.dictionaries.get('Thai').entries.length, 1);
  assert.equal(next.client.snapshot().dictionary[0].replace, 'latest local edit');
  assert.equal(next.client.snapshot().dictionary[0].tlnote, 'later remote note');
  assert.deepEqual(next.client.snapshot().conflicts, []);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.pendingWrite, null);
});

test('normal settings write replays a lost acknowledgement idempotently and retains edits made afterwards', async t => {
  const h = await harness(t, { state: authenticatedState({ localSettings: settings({ theme: 'dark' }) }) });
  seedAPI(h.api);
  let lose = true;
  h.api.after = request => {
    if (request.method === 'PUT' && request.path === '/v1/settings' && lose) {
      lose = false;
      assert.equal(h.store.state.profiles.alice.settingsWrite.mutationId, request.body.mutationId);
      throw new Error('Settings receipt lost');
    }
  };
  await h.client.sync();
  const pending = clone(h.store.state.profiles.alice.settingsWrite);
  assert.ok(pending);
  assert.equal(h.api.settings.get('alice').revision, 2);
  await h.client.saveLocal(payload([word()], { theme: 'light' }));
  h.api.settings.set('alice', { revision: 3, settings: settings({ theme: 'dark', uiDensity: 'spacious' }) });
  h.client.destroy();
  const next = await harness(t, { store: h.store, api: h.api });
  await next.client.sync();
  const requests = h.api.writes('/v1/settings');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].body.mutationId, requests[1].body.mutationId);
  assert.equal(requests[1].body.mutationId, pending.mutationId);
  assert.notEqual(requests[2].body.mutationId, pending.mutationId);
  assert.equal(h.api.settings.get('alice').revision, 4);
  assert.equal(next.client.snapshot().settings.theme, 'light');
  assert.equal(next.client.snapshot().settings.uiDensity, 'spacious');
  assert.equal(h.store.state.profiles.alice.settingsWrite, null);
});

test('offline logout clears local authentication while retaining isolated account drafts and clipboard', async t => {
  const privateEntry = word('private-alice', { find: 'Private', replace: 'kept locally' });
  const state = authenticatedState({ local: [privateEntry] });
  state.profiles.alice.clipboard = 'Alice private clipboard';
  state.profiles.guest.dictionaries.Thai.entries = [word('guest', { find: 'Guest', replace: 'guest data' })];
  state.profiles.guest.clipboard = 'Guest clipboard';
  const h = await harness(t, { state });
  h.api.online = false;
  await h.client.logout();
  assert.equal(h.store.state.auth, null);
  assert.equal(h.client.snapshot().signedIn, false);
  assert.equal(h.client.snapshot().profileId, 'guest');
  assert.deepEqual(h.store.state.profiles.alice.dictionaries.Thai.entries, [privateEntry]);
  assert.equal(h.store.state.profiles.alice.clipboard, 'Alice private clipboard');
  assert.equal(h.client.snapshot().editorClipboard, 'Guest clipboard');
  assert.equal(h.client.snapshot().dictionary.some(entry => entry._id === privateEntry._id), false);
  assert.match(h.statuses.at(-1).message, /Signed out in this browser/);
  assert.match(h.statuses.at(-1).message, /revocation could not be confirmed/);
});
