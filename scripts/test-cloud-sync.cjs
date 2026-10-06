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
    this.hints = false;
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
    const me = { user: clone(identity), expiresAt: Date.now() + 30 * 86400000,
      ...(this.hints ? { sync: { language: identity.language, settingsRevision: this.settings.get(identity.id)?.revision || 0,
        dictionaryRevision: this.dictionaries.get(identity.language)?.revision || 0 } } : {}) };
    let response;
    if (request.path === '/v1/me' || request.path === '/auth/session/refresh') response = me;
    else if (request.path === '/auth/logout') return reply(null, 204);
    else if (request.path === '/v1/settings') {
      if (!identity.language && !Cloud.canAccessAllLanguages(identity)) return reply({ error: { message: 'Not configured' } }, 403);
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
      if (language !== identity.language && !Cloud.canAccessAllLanguages(identity)) return reply({ error: { message: 'Language access denied' } }, 403);
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
async function harness(t, { state = null, legacy = payload([word()]), store = new MemoryStore(state), api = new MemoryAPI(), WebSocket } = {}) {
  const changes = [];
  const statuses = [];
  let uuid = 0;
  const namespace = ++clientNumber;
  const client = new Cloud.Client({ store, merge: Dictionary, fetch: api.fetch.bind(api), apiBase: 'https://api.example.test', uuid: () => 'client-' + namespace + '-mutation-' + ++uuid,
    onChange: value => changes.push(clone(value)), onStatus: value => statuses.push(clone(value)), WebSocket });
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

test('automatic cloud retries retain failures during local saves and in-flight polls until full recovery', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api);
  await h.client.sync();
  assert.deepEqual(h.statuses.at(-1), { message: '', error: false, warning: false });
  h.api.online = false;
  await h.client.sync();
  const failure = clone(h.statuses.at(-1));
  assert.equal(failure.error, true);
  const beforeSave = h.statuses.length;
  await h.client.saveLocal(payload([word('fire', { replace: 'saved while offline' })]));
  assert.equal(h.statuses.length, beforeSave, 'A local save cannot dismiss the cloud outage.');
  h.api.online = true;
  const gate = h.api.pause('GET', '/v1/dictionaries/Thai');
  const retry = h.client.sync();
  await gate.entered.promise;
  assert.deepEqual(h.statuses.at(-1), failure, 'A successful session/settings request is not a completed dictionary sync.');
  gate.release.resolve();
  await retry;
  assert.deepEqual(h.statuses.at(-1), { message: '', error: false, warning: false });
  assert.equal(h.statuses.some(status => /Syncing|Backed up|waiting to sync/.test(status.message)), false);
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'saved while offline');
});

test('unassigned accounts, local-only languages, and dictionary conflicts remain explicit warnings', async t => {
  const h = await harness(t);
  await h.client.acceptLogin({ token: 'token-unassigned', user: user('unassigned', null), expiresAt: 1 });
  assert.equal(h.statuses.at(-1).warning, true);
  assert.match(h.statuses.at(-1).message, /assignment/);
  const other = await harness(t, { state: authenticatedState({ localSettings: settings({ lang: 'French' }) }) });
  seedAPI(other.api);
  await other.client.sync();
  assert.deepEqual(other.statuses.at(-1), { message: 'Selected dictionary language is local only', error: false, warning: true });
  const conflict = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'mine' })] }) });
  seedAPI(conflict.api, { remote: dictionary([word('fire', { replace: 'theirs' })], 2) });
  await conflict.client.sync();
  assert.equal(conflict.statuses.at(-1).warning, true);
  assert.match(conflict.statuses.at(-1).message, /conflicts need your choice/);
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

test('all-language access recognizes manager/admin roles and ignores stale admin flags after demotion', () => {
  assert.equal(Cloud.canAccessAllLanguages({ role: 'manager', language: null }), true);
  assert.equal(Cloud.canAccessAllLanguages({ role: 'admin', language: null }), true);
  assert.equal(Cloud.canAccessAllLanguages({ isAdmin: true }), true);
  assert.equal(Cloud.canAccessAllLanguages({ role: 'translator', isAdmin: true }), false);
  assert.equal(Cloud.canAccessAllLanguages(user()), false);
  assert.equal(Cloud.canAccessAllLanguages(null), false);
});

test('managers without assignments read and edit the selected dictionary while preserving other language drafts', async t => {
  const french = word('fire', { replace: 'Feu' });
  const state = authenticatedState({ language: null, localSettings: settings({ lang: 'French' }),
    settingsBase: { revision: 1, settings: settings({ lang: 'French' }) }, base: dictionary([french]),
    local: [{ ...french, tlnote: 'Manager French edit' }] });
  state.auth.user = { ...state.auth.user, role: 'manager', canAccessAllLanguages: true };
  state.profiles.alice.dictionaries.Thai = { entries: [word('fire', { replace: 'Thai manager draft' })], base: dictionary([word()]), conflicts: [], revision: 1 };
  const h = await harness(t, { state });
  h.api.users['token-alice'] = clone(state.auth.user);
  seedAPI(h.api, { remoteSettings: settings({ lang: 'French' }) });
  h.api.dictionaries.set('French', dictionary([french]));
  await h.client.sync();
  assert.equal(h.api.dictionaries.get('French').entries[0].tlnote, 'Manager French edit');
  assert.equal(h.api.calls.some(call => call.path === '/v1/dictionaries/Thai'), false);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'Thai manager draft');
  await h.client.selectLanguage('Thai', payload(h.client.snapshot().dictionary, { lang: 'French' }), 'French');
  await h.client.sync();
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'Thai manager draft');
  assert.equal(h.store.state.profiles.alice.dictionaries.French.entries[0].tlnote, 'Manager French edit');
  assert.equal(h.statuses.at(-1).message, '');
});

test('manager settings restoration selects its language before reading shared dictionary data', async t => {
  const state = authenticatedState({ language: null, settingsBase: null, local: [word('fire', { replace: 'Private Thai draft' })] });
  state.auth.user = { ...state.auth.user, role: 'admin', canAccessAllLanguages: true };
  const h = await harness(t, { state });
  h.api.users['token-alice'] = clone(state.auth.user);
  seedAPI(h.api, { remoteSettings: settings({ lang: 'French' }) });
  h.api.dictionaries.set('French', dictionary([word('fire', { replace: 'Feu partagé' })]));
  await h.client.sync();
  assert.equal(h.client.snapshot().settings.lang, 'French');
  assert.equal(h.client.snapshot().dictionary[0].replace, 'Feu partagé');
  assert.equal(h.api.calls.some(call => call.path === '/v1/dictionaries/Thai'), false);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'Private Thai draft');
});

test('a cloud-selected manager language checks its own revisions instead of the previous language hints', async t => {
  const french = word('fire', { replace: 'Feu' });
  const state = authenticatedState();
  state.auth.user = { ...state.auth.user, role: 'manager', canAccessAllLanguages: true };
  state.profiles.alice.dictionaries.French = { entries: [french], base: dictionary([french]), revision: 1,
    localVersion: 0, syncedLocalVersion: 0, conflicts: [], pendingResolution: null };
  const h = await harness(t, { state });
  h.api.users['token-alice'] = clone(state.auth.user);
  seedAPI(h.api, { remoteSettings: settings({ lang: 'French' }), settingsRevision: 2 }); h.api.hints = true;
  h.api.dictionaries.set('French', dictionary([{ ...french, tlnote: 'New French revision' }], 2));
  await h.client.sync();
  assert.equal(h.client.snapshot().settings.lang, 'French');
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'New French revision');
  assert.equal(h.client.snapshot().revision, 2);
});

test('manager language switching discards pending results and keeps each draft with its original language', async t => {
  const state = authenticatedState({ language: null });
  state.auth.user = { ...state.auth.user, role: 'manager', canAccessAllLanguages: true };
  const h = await harness(t, { state });
  h.api.users['token-alice'] = clone(state.auth.user);
  seedAPI(h.api);
  h.api.dictionaries.set('French', dictionary([word('fire', { replace: 'Feu partagé' })]));
  const gate = h.api.pause('GET', '/v1/dictionaries/Thai');
  const syncing = h.client.sync();
  await gate.entered.promise;
  await h.client.selectLanguage('French', payload([word('fire', { replace: 'Thai saved draft' })]), 'Thai');
  gate.release.resolve(reply(dictionary([word('fire', { replace: 'Late Thai response' })], 2)));
  await syncing;
  assert.deepEqual(h.client.snapshot().dictionary, []);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'Thai saved draft');
  await h.client.sync();
  assert.equal(h.client.snapshot().dictionary[0].replace, 'Feu partagé');
  assert.equal(h.api.writes('/v1/dictionaries/Thai').length, 0);
});

test('manager role revocation cancels pending cross-language work even without an assignment version', async t => {
  const state = authenticatedState({ localSettings: settings({ lang: 'French' }),
    settingsBase: { revision: 1, settings: settings({ lang: 'French' }) }, local: [word('fire', { replace: 'Private French draft' })] });
  state.auth.user = { ...state.auth.user, role: 'manager', canAccessAllLanguages: true };
  const h = await harness(t, { state });
  h.api.users['token-alice'] = clone(state.auth.user);
  seedAPI(h.api, { remoteSettings: settings({ lang: 'French' }) });
  const gate = h.api.pause('GET', '/v1/dictionaries/French');
  const syncing = h.client.sync();
  await gate.entered.promise;
  h.api.users['token-alice'] = { ...user(), role: 'translator', canAccessAllLanguages: false };
  await h.client.refreshSession(true);
  gate.release.resolve(reply(dictionary([word('fire', { replace: 'Late French response' })], 2)));
  await syncing;
  assert.equal(h.client.snapshot().user.role, 'translator');
  assert.equal(h.client.snapshot().user.language, 'Thai');
  assert.equal(h.client.snapshot().dictionary[0].replace, 'Private French draft');
  assert.equal(h.api.writes('/v1/dictionaries/French').length, 0);
});

test('unassignment after manager revocation refreshes the role and keeps all local work', async t => {
  const state = authenticatedState({ language: null, local: [word('fire', { replace: 'Manager draft' })] });
  state.auth.user = { ...state.auth.user, role: 'manager', canAccessAllLanguages: true };
  const h = await harness(t, { state });
  h.api.users['token-alice'] = { ...user('alice', null), role: 'translator', canAccessAllLanguages: false };
  h.api.intercept = request => request.path === '/v1/comments'
    ? reply({ error: { code: 'LANGUAGE_UNASSIGNED', message: 'An assigned language is required.' } }, 403) : undefined;
  await assert.rejects(h.client.request('/v1/comments'), error => error.code === 'LANGUAGE_UNASSIGNED');
  assert.equal(h.client.snapshot().user.role, 'translator');
  assert.equal(Cloud.canAccessAllLanguages(h.client.snapshot().user), false);
  assert.equal(h.client.snapshot().signedIn, true);
  assert.equal(h.client.snapshot().dictionary[0].replace, 'Manager draft');
  assert.deepEqual(h.api.calls.map(call => call.path), ['/v1/comments', '/v1/me']);
});

test('a durable role revocation rejects manager merges before the storage transaction commits', async t => {
  const state = authenticatedState();
  state.auth.user = { ...state.auth.user, role: 'manager', canAccessAllLanguages: true };
  const h = await harness(t, { state });
  const demoting = h.store.updateHybridState(stored => {
    stored.auth.user = { ...stored.auth.user, role: 'translator', canAccessAllLanguages: false }; return stored;
  });
  const merging = h.client.mergeRemote(h.client.context(), 'Thai', dictionary([word('fire', { replace: 'Unauthorized result' })], 2));
  await demoting;
  await assert.rejects(merging, error => error.stale === true);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'ไฟ');
});

test('assigning a role refreshes the current profile and its access immediately', async t => {
  const h = await harness(t, { state: authenticatedState() });
  h.api.intercept = request => {
    if (request.path !== '/v1/admin/users/alice/role') return undefined;
    assert.deepEqual(request.body, { role: 'manager' });
    h.api.users['token-alice'] = { ...user(), role: 'manager', canAccessAllLanguages: true, assignmentVersion: 2 };
    return reply({ user: h.api.users['token-alice'] });
  };
  const assigned = await h.client.assignRole('alice', 'manager');
  assert.equal(assigned.role, 'manager');
  assert.equal(h.client.snapshot().user.role, 'manager');
  assert.equal(h.client.snapshot().user.assignmentVersion, 2);
  assert.deepEqual(h.api.calls.map(call => call.path), ['/v1/admin/users/alice/role', '/auth/session/refresh']);
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

test('unassignment closes cloud access without losing the login or queued local drafts', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'private draft' })] }) });
  const queued = deferred();
  h.client.localQueue = queued.promise;
  const saving = h.client.saveLocal(payload([word('fire', { replace: 'queued local edit' })]));
  h.api.intercept = request => request.path === '/v1/comments'
    ? reply({ error: { code: 'LANGUAGE_UNASSIGNED', message: 'An assigned language is required.' } }, 403) : undefined;
  await assert.rejects(h.client.request('/v1/comments'), error => error.code === 'LANGUAGE_UNASSIGNED');
  assert.equal(h.client.snapshot().signedIn, true);
  assert.equal(h.client.snapshot().user.language, null);
  assert.equal(h.client.snapshot().profileId, 'alice');
  assert.equal(h.store.state.auth.token, 'token-alice');
  assert.equal(h.client.snapshot().dictionary[0].replace, 'private draft');
  assert.equal(h.client.snapshot().editorClipboard, 'local clipboard');
  queued.resolve(); await saving;
  assert.equal(h.client.snapshot().dictionary[0].replace, 'queued local edit');
  assert.equal(h.client.snapshot().user.language, null);
  assert.match(h.statuses.at(-1).message, /Cloud access unavailable/);
});

test('a comments response from before confirmed unassignment is discarded', async t => {
  const h = await harness(t, { state: authenticatedState() });
  const pending = h.api.pause('GET', '/v1/comments');
  const reading = h.client.request('/v1/comments');
  await pending.entered.promise;
  h.api.intercept = request => request.path === '/v1/comments/unread'
    ? reply({ error: { code: 'LANGUAGE_UNASSIGNED', message: 'An assigned language is required.' } }, 403) : undefined;
  await assert.rejects(h.client.request('/v1/comments/unread'), error => error.status === 403);
  pending.release.resolve(reply({ items: [{ id: 1, body: 'Earlier authorized content' }] }));
  await assert.rejects(reading, error => error.stale === true);
  assert.equal(h.client.snapshot().signedIn, true);
  assert.equal(h.client.snapshot().user.language, null);
});

test('forbidden language refreshes current assignment and leaves local drafts intact', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'Thai draft' })] }) });
  h.api.users['token-alice'] = { ...user('alice', 'French'), assignmentVersion: 2 };
  h.api.intercept = request => request.path === '/v1/dictionaries/Thai'
    ? reply({ error: { code: 'LANGUAGE_FORBIDDEN', message: 'This is no longer your assigned language.' } }, 403) : undefined;
  await assert.rejects(h.client.request('/v1/dictionaries/Thai'), error => error.code === 'LANGUAGE_FORBIDDEN');
  assert.equal(h.client.snapshot().signedIn, true);
  assert.equal(h.client.snapshot().user.language, 'French');
  assert.equal(h.client.snapshot().user.assignmentVersion, 2);
  assert.equal(h.client.snapshot().dictionary[0].replace, 'Thai draft');
  assert.deepEqual(h.api.calls.map(call => call.path), ['/v1/dictionaries/Thai', '/v1/me']);
});

test('an old denial cannot remove a newer assignment to the same language', async t => {
  const state = authenticatedState(); state.auth.user.assignmentVersion = 1;
  const h = await harness(t, { state });
  h.api.users['token-alice'].assignmentVersion = 2;
  const pending = h.api.pause('GET', '/v1/comments');
  const reading = h.client.request('/v1/comments');
  await pending.entered.promise;
  await h.client.refreshSession(true);
  pending.release.resolve(reply({ error: { code: 'LANGUAGE_UNASSIGNED', message: 'Old assignment was removed.' } }, 403));
  await assert.rejects(reading, error => error.stale === true);
  assert.equal(h.client.snapshot().user.language, 'Thai');
  assert.equal(h.client.snapshot().user.assignmentVersion, 2);
  assert.equal(h.client.snapshot().signedIn, true);
});

test('the first sync after assignment uses its fresh permissions in the same pass', async t => {
  const h = await harness(t, { state: authenticatedState({ language: null, local: [word('fire', { replace: 'Waiting local edit' })] }) });
  seedAPI(h.api);
  h.api.users['token-alice'].assignmentVersion = 2;
  await h.client.sync();
  assert.equal(h.client.snapshot().user.language, 'Thai');
  assert.equal(h.client.snapshot().user.assignmentVersion, 2);
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'Waiting local edit');
  assert.equal(h.api.writes('/v1/dictionaries/Thai').length, 1);
  assert.equal(h.changes.some(snapshot => snapshot.user?.assignmentVersion === 2), true);
});

test('sync reloads a newer same-account assignment stored by another tab', async t => {
  const state = authenticatedState(); state.auth.user.assignmentVersion = 1;
  const h = await harness(t, { state });
  seedAPI(h.api, { remote: dictionary([word('fire', { tlnote: 'New shared note' })], 2) });
  h.api.users['token-alice'].assignmentVersion = 2;
  await h.store.updateHybridState(stored => { stored.auth.user.assignmentVersion = 2; return stored; });
  assert.equal(h.client.snapshot().user.assignmentVersion, 1);
  await h.client.sync();
  assert.equal(h.client.snapshot().user.assignmentVersion, 2);
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'New shared note');
  assert.equal(h.api.calls.some(call => call.path === '/v1/dictionaries/Thai'), true);
});

test('account switching during the profile commit prevents outgoing-account cloud sync', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api);
  h.api.users['token-alice'].name = 'Updated profile';
  let gate;
  const profileReceived = deferred();
  h.api.after = request => {
    if (request.path === '/v1/me' && request.token === 'token-alice') {
      gate = h.store.pauseNextCommit(); profileReceived.resolve();
    }
  };
  const syncing = h.client.sync();
  await profileReceived.promise; await gate.entered.promise;
  const switching = h.client.acceptLogin({ token: 'token-bob', user: user('bob'), expiresAt: 1 });
  gate.release.resolve(); await Promise.all([syncing, switching]);
  assert.equal(h.client.snapshot().profileId, 'bob');
  assert.deepEqual(h.api.calls.filter(call => call.token === 'token-alice').map(call => call.path), ['/v1/me']);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'ไฟ');
});

test('permission changes before a shared merge transaction leave the local draft unchanged', async t => {
  const state = authenticatedState(); state.auth.user.assignmentVersion = 1;
  const h = await harness(t, { state });
  // The storage transaction ahead of the cloud merge publishes another tab's
  // assignment change before that merge's callback can read the durable state.
  const reassignment = h.store.updateHybridState(stored => { stored.auth.user.assignmentVersion = 2; return stored; });
  const merging = h.client.mergeRemote(h.client.context(), 'Thai', dictionary([word('fire', { replace: 'Stale shared result' })], 2));
  await reassignment;
  await assert.rejects(merging, error => error.stale === true);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'ไฟ');
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.revision, 1);
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

test('unchanged revision checks perform no data fetches, merges, writes or dictionary snapshots', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api); h.api.hints = true;
  await h.client.sync(); // Legacy dictionaries establish a durable processed version once.
  const updates = h.store.updates, changes = h.changes.length;
  h.api.calls.length = 0;
  let merges = 0, snapshots = 0;
  h.client.merge = { ...Dictionary, merge() { merges++; throw new Error('An unchanged dictionary must not merge'); } };
  const snapshot = h.client.snapshot.bind(h.client);
  h.client.snapshot = options => { snapshots++; return snapshot(options); };
  await h.client.sync();
  assert.deepEqual(h.api.calls.map(call => call.path), ['/v1/me']);
  assert.equal(h.store.updates, updates);
  assert.equal(h.changes.length, changes);
  assert.equal(merges, 0); assert.equal(snapshots, 0);
});

test('settings-only changes never fetch or notify the complete dictionary', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api); h.api.hints = true; await h.client.sync();
  h.api.calls.length = 0; h.changes.length = 0;
  h.api.settings.set('alice', { revision: 2, settings: settings({ theme: 'dark' }) });
  await h.client.sync();
  assert.deepEqual(h.api.calls.map(call => call.path), ['/v1/me', '/v1/settings']);
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0].settings.theme, 'dark');
  assert.equal(Object.hasOwn(h.changes[0], 'dictionary'), false);
});

test('a local edit uploads despite unchanged remote revision hints', async t => {
  const h = await harness(t, { state: authenticatedState() });
  seedAPI(h.api); h.api.hints = true; await h.client.sync();
  await h.client.saveLocal(payload([word('fire', { replace: 'New local translation' })]));
  await h.client.sync();
  assert.equal(h.api.dictionaries.get('Thai').entries[0].replace, 'New local translation');
  assert.equal(h.api.writes('/v1/dictionaries/Thai').length, 1);
  const dictionaryState = h.store.state.profiles.alice.dictionaries.Thai;
  assert.equal(dictionaryState.syncedLocalVersion, dictionaryState.localVersion);
});

test('unchanged hints still upload a durable edit made by another tab', async t => {
  const store = new MemoryStore(authenticatedState()), api = new MemoryAPI();
  seedAPI(api); api.hints = true;
  const first = await harness(t, { store, api }); await first.client.sync();
  const second = await harness(t, { store, api });
  await second.client.saveLocal(payload([word('fire', { tlnote: 'Other tab note' })]));
  await first.client.sync();
  assert.equal(api.dictionaries.get('Thai').entries[0].tlnote, 'Other tab note');
  assert.equal(api.writes('/v1/dictionaries/Thai').length, 1);
});

test('unchanged revisions retain unresolved conflicts without rebuilding them', async t => {
  const h = await harness(t, { state: authenticatedState({ local: [word('fire', { replace: 'Local choice' })] }) });
  seedAPI(h.api, { remote: dictionary([word('fire', { replace: 'Remote choice' })], 2) });
  h.api.hints = true; await h.client.sync();
  assert.equal(h.client.snapshot().conflicts.length, 1);
  const updates = h.store.updates;
  h.client.merge = { ...Dictionary, merge() { throw new Error('Unchanged conflicts must remain settled'); } };
  await h.client.sync();
  assert.equal(h.store.updates, updates);
  assert.equal(h.client.snapshot().conflicts.length, 1);
  assert.equal(h.statuses.at(-1).warning, true);
});

class SyncSocket {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; SyncSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.onclose?.(); }
}

test('account socket revision notifications retrieve only changed data and clean up on sign-out', async t => {
  const h = await harness(t, { state: authenticatedState(), WebSocket: SyncSocket });
  seedAPI(h.api); h.api.hints = true;
  h.api.intercept = request => request.path === '/v1/sync/ticket' ? reply({ ticket: 'sync-ticket', url: '/v1/collaboration/ws?ticket=sync-ticket' }) : undefined;
  await h.client.sync(); await h.client.openSocket();
  const socket = SyncSocket.instances.at(-1);
  assert.equal(h.api.calls.find(call => call.path === '/v1/sync/ticket').body, null);
  assert.equal(socket.url, 'wss://api.example.test/v1/collaboration/ws?ticket=sync-ticket');
  socket.open(); socket.message({ type: 'sync_ready', sync: { language: 'Thai', settingsRevision: 1, dictionaryRevision: 1 } });
  assert.equal(h.client.socketReady, true);
  h.api.calls.length = 0;
  await h.client.sync();
  assert.equal(h.api.calls.length, 0, 'A live socket and settled revisions need no HTTP requests');
  h.api.dictionaries.set('Thai', dictionary([word('fire', { tlnote: 'Live note' })], 2));
  socket.message({ type: 'sync_changed', sync: { language: 'Thai', settingsRevision: 1, dictionaryRevision: 2 } });
  await h.client.sync();
  assert.deepEqual(h.api.calls.map(call => call.path), ['/v1/dictionaries/Thai']);
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'Live note');
  await h.client.logout();
  assert.equal(socket.readyState, 3); assert.equal(h.client.socketReady, false);
  assert.equal(h.client.socketHeartbeat, null);
});

test('socket reconnect rechecks assignment and changed data missed while disconnected', async t => {
  const h = await harness(t, { state: authenticatedState(), WebSocket: SyncSocket });
  seedAPI(h.api); h.api.hints = true;
  h.api.intercept = request => request.path === '/v1/sync/ticket' ? reply({ ticket: 'sync-ticket', url: '/v1/collaboration/ws?ticket=sync-ticket' }) : undefined;
  await h.client.sync(); await h.client.openSocket();
  const socket = SyncSocket.instances.at(-1); socket.open();
  socket.message({ type: 'sync_ready', sync: { language: 'Thai', settingsRevision: 1, dictionaryRevision: 1 } });
  socket.close();
  h.api.users['token-alice'].language = null; h.api.users['token-alice'].assignmentVersion = 2;
  h.api.calls.length = 0; await h.client.sync();
  assert.deepEqual(h.api.calls.map(call => call.path), ['/v1/me']);
  assert.equal(h.client.snapshot().user.language, null);
  assert.equal(h.client.snapshot().dictionary[0].replace, 'ไฟ');
});

test('dictionary work reports its label before yielding and always clears on storage failure', async t => {
  const h = await harness(t, { state: authenticatedState() });
  const events = [];
  h.client.onWork = work => events.push(work);
  h.client.yieldWork = async () => { events.push('paint'); };
  h.store.nextError = new Error('Storage unavailable');
  await assert.rejects(h.client.mergeRemote(h.client.context(), 'Thai', dictionary([word()])), /Storage unavailable/);
  assert.equal(events[0].label, 'Updating Dictionary entries');
  assert.equal(events[0].active, true); assert.equal(events[1], 'paint');
  assert.equal(events.at(-1).active, false);
});

test('restoring an existing local profile reads it without rewriting or duplicating its snapshot', async t => {
  const state = authenticatedState(), store = new MemoryStore(state);
  const h = await harness(t, { store });
  assert.equal(store.updates, 0);
  assert.equal(h.changes.length, 1);
  assert.deepEqual(h.changes[0].dictionary, state.profiles.alice.dictionaries.Thai.entries);
});

test('switching the local dictionary language reconnects the account notification socket', async t => {
  const h = await harness(t, { state: authenticatedState(), WebSocket: SyncSocket });
  seedAPI(h.api); h.api.hints = true;
  h.api.intercept = request => request.path === '/v1/sync/ticket' ? reply({ ticket: 'sync-ticket', url: '/v1/collaboration/ws?ticket=sync-ticket' }) : undefined;
  await h.client.sync(); await h.client.openSocket();
  const first = SyncSocket.instances.at(-1); first.open();
  first.message({ type: 'sync_ready', sync: { language: 'Thai', settingsRevision: 1, dictionaryRevision: 1 } });
  await h.client.selectLanguage('French', payload([word()]), 'Thai');
  assert.equal(first.readyState, 3); assert.equal(h.client.socketReady, false);
  await h.client.sync(); await h.client.openSocket();
  const second = SyncSocket.instances.at(-1); assert.notEqual(second, first);
  second.open(); second.message({ type: 'sync_ready', sync: { language: 'Thai', settingsRevision: 2, dictionaryRevision: 1 } });
  assert.equal(h.client.socketReady, true);
});

test('manager account notifications use the selected language and reconnect after switching it', async t => {
  const french = word('fire', { replace: 'Feu' });
  const state = authenticatedState({ localSettings: settings({ lang: 'French' }), local: [french], base: dictionary([french]),
    settingsBase: { revision: 1, settings: settings({ lang: 'French' }) } });
  state.auth.user = { ...state.auth.user, role: 'manager', canAccessAllLanguages: true };
  const h = await harness(t, { state, WebSocket: SyncSocket });
  h.api.users['token-alice'] = clone(state.auth.user);
  seedAPI(h.api, { remoteSettings: settings({ lang: 'French' }) }); h.api.hints = true;
  h.api.dictionaries.set('French', dictionary([french]));
  h.api.intercept = request => request.path === '/v1/sync/ticket' ? reply({ ticket: 'sync-ticket' }) : undefined;
  await h.client.sync(); await h.client.openSocket();
  assert.deepEqual(h.api.calls.find(call => call.path === '/v1/sync/ticket').body, { language: 'French' });
  const first = SyncSocket.instances.at(-1); first.open();
  first.message({ type: 'sync_ready', sync: { language: 'French', settingsRevision: 1, dictionaryRevision: 1 } });
  assert.equal(h.client.socketReady, true);
  h.api.dictionaries.set('French', dictionary([{ ...french, tlnote: 'French realtime edit' }], 2));
  h.api.calls.length = 0;
  first.message({ type: 'sync_changed', sync: { language: 'French', settingsRevision: 1, dictionaryRevision: 2 } });
  await h.client.sync();
  assert.deepEqual(h.api.calls.map(call => call.path), ['/v1/dictionaries/French']);
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'French realtime edit');
  await h.client.selectLanguage('Thai', payload(h.client.snapshot().dictionary, { lang: 'French' }), 'French');
  assert.equal(first.readyState, 3);
  await h.client.sync(); await h.client.openSocket();
  assert.deepEqual(h.api.calls.filter(call => call.path === '/v1/sync/ticket').at(-1).body, { language: 'Thai' });
  const second = SyncSocket.instances.at(-1); second.open();
  second.message({ type: 'sync_ready', sync: { language: 'Thai', settingsRevision: 2, dictionaryRevision: 1 } });
  assert.equal(h.client.socketReady, true);
  h.api.users['token-alice'] = { ...user(), role: 'translator', canAccessAllLanguages: false };
  await h.client.refreshSession(true);
  assert.equal(second.readyState, 3);
  assert.equal(h.client.socketReady, false);
});

test('applying settings-only cloud changes preserves dictionary and regex references', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const window = { CloudSync: Cloud, DictionarySync: Dictionary };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/cloudUi.js'), 'utf8'), { window });
  const dictionaryEntries = [word()], regexes = [];
  let imports = 0;
  const editor = { ...Cloud.completeSettings(settings()), dictionary: dictionaryEntries, editorRegexes: regexes, editorClipboard: 'clipboard',
    cloudUser: user(), cloudSignedIn: true, cloudConflicts: [], cloudRevision: 1, cloudConflictIndex: 0,
    importSettings(next) { imports++; Object.assign(this, next); }, $nextTick: async () => {},
    cloudPayload() { throw new Error('Partial updates must not serialize the full dictionary'); } };
  Object.defineProperty(editor, 'cloudConflict', { get() { return this.cloudConflicts[this.cloudConflictIndex] || null; } });
  await window.CloudUI.mixin.methods.cloudApply.call(editor, { settings: settings({ theme: 'dark' }), editorClipboard: 'clipboard',
    user: user(), signedIn: true, conflicts: [], revision: 1, needsDictionaryLanguage: false, recoveryCount: 0 });
  assert.equal(imports, 1); assert.equal(editor.theme, 'dark');
  assert.equal(editor.dictionary, dictionaryEntries); assert.equal(editor.editorRegexes, regexes);
});

function cloudUiEditor(client) {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const window = { CloudSync: Cloud, DictionarySync: Dictionary };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/cloudUi.js'), 'utf8'), { window });
  const mixin = window.CloudUI.mixin;
  const editor = { ...Cloud.completeSettings({}), ...mixin.data(), ...mixin.methods,
    _cloud: client, dictionary: [], editorClipboard: '', toPlainForStorage: clone,
    importSettings(next) { Object.assign(this, next); }, $nextTick: async () => {} };
  for (const [name, getter] of Object.entries(mixin.computed)) Object.defineProperty(editor, name, { get() { return getter.call(editor); } });
  return editor;
}

test('language selection waits for durable storage and UI application while preserving unrelated errors', async t => {
  const state = authenticatedState();
  state.profiles.alice.dictionaries.French = { entries: [word('fr', { replace: 'Feu' })], conflicts: [], revision: 0 };
  const h = await harness(t, { state });
  const editor = cloudUiEditor(h.client);
  await editor.cloudApply(h.client.snapshot());
  editor.cloudStorageError = 'Could not import settings: An unrelated import failed';
  editor.lang = 'French';
  const gate = h.store.pauseNextCommit();
  const applied = deferred(); const painted = deferred();
  editor.$nextTick = () => { applied.resolve(); return painted.promise; };
  let finished = false;
  const switching = editor.cloudSelectLanguage('French', 'Thai').then(result => { finished = true; return result; });
  await gate.entered.promise;
  assert.equal(finished, false);
  assert.equal(editor.cloudLanguageSwitching, true);
  assert.equal(editor._cloudApplying, true);
  assert.equal(h.store.state.profiles.alice.settings.lang, 'Thai');
  gate.release.resolve();
  await applied.promise;
  assert.equal(finished, false, 'Selection remains pending until the restored language is rendered');
  assert.equal(editor.cloudLanguageSwitching, true);
  painted.resolve();
  assert.equal(await switching, true);
  assert.equal(editor.lang, 'French');
  assert.equal(editor.dictionary[0].replace, 'Feu');
  assert.equal(h.store.state.profiles.alice.settings.lang, 'French');
  assert.equal(editor.cloudStorageError, 'Could not import settings: An unrelated import failed');
  assert.equal(editor.cloudLanguageSwitching, false);
  assert.equal(editor._cloudApplying, false);
});

test('a successful language switch clears its prior switch failure and releases its UI guards', async t => {
  const h = await harness(t, { state: authenticatedState() });
  const editor = cloudUiEditor(h.client);
  await editor.cloudApply(h.client.snapshot());
  editor.cloudStorageError = 'Could not switch language: Storage temporarily unavailable';
  editor.lang = 'French';
  assert.equal(await editor.cloudSelectLanguage('French', 'Thai'), true);
  assert.equal(editor.cloudStorageError, '');
  assert.equal(editor.lang, 'French');
  assert.deepEqual(editor.dictionary, []);
  assert.equal(editor.cloudLanguageSwitching, false);
  assert.equal(editor._cloudApplying, false);
});

test('failed language selection restores the saved language and dictionary and keeps an actionable error', async t => {
  const saved = word('fire', { replace: 'Saved Thai draft' });
  const h = await harness(t, { state: authenticatedState({ local: [saved] }) });
  const editor = cloudUiEditor(h.client);
  await editor.cloudApply(h.client.snapshot());
  editor.lang = 'French';
  h.store.nextError = new Error('Storage full');
  assert.equal(await editor.cloudSelectLanguage('French', 'Thai'), false);
  assert.equal(editor.lang, 'Thai');
  assert.deepEqual(editor.dictionary, [saved]);
  assert.equal(h.client.snapshot().settings.lang, 'Thai');
  assert.deepEqual(h.client.snapshot().dictionary, [saved]);
  assert.equal(h.store.state.profiles.alice.settings.lang, 'Thai');
  assert.equal(editor.cloudStorageError, 'Could not switch language: Storage full');
  assert.equal(editor.cloudLanguageSwitching, false);
  assert.equal(editor._cloudApplying, false);
  assert.equal(h.api.calls.length, 0);
});

test('manager UI access has no assignment warning while translator languages retain local-only guidance', () => {
  const editor = cloudUiEditor();
  editor.cloudSignedIn = true;
  editor.cloudUser = { ...user('alice', null), role: 'manager', canAccessAllLanguages: true };
  editor.lang = 'French';
  assert.equal(editor.cloudCanAccessAllLanguages, true);
  assert.equal(editor.cloudSyncIssue, '');
  editor.cloudError = true; editor.cloudStatus = 'A relevant sync failure';
  assert.equal(editor.cloudSyncIssue, 'A relevant sync failure');
  editor.cloudError = false;
  editor.cloudUser = { ...user(), role: 'translator', canAccessAllLanguages: false };
  assert.equal(editor.cloudCanAccessAllLanguages, false);
  assert.equal(editor.cloudSyncIssue, 'Selected dictionary language is local only');
  editor.cloudUser.language = null;
  assert.equal(editor.cloudSyncIssue, 'Not configured — awaiting admin language assignment');
  editor.cloudUser = { ...user('alice', null), role: 'manager', canAccessAllLanguages: true };
  editor.cloudSignedIn = false;
  assert.equal(editor.cloudCanAccessAllLanguages, false);
  assert.equal(editor.cloudSyncIssue, '');
});

test('fresh revision checks accept counters lowered by a restored server database', async t => {
  const h = await harness(t, { state: authenticatedState({ base: dictionary([word()], 10) }) });
  seedAPI(h.api, { remote: dictionary([word()], 10) }); h.api.hints = true;
  await h.client.sync();
  h.api.dictionaries.set('Thai', dictionary([word('fire', { tlnote: 'Restored database' })], 7));
  await h.client.sync();
  assert.equal(h.client.hints().dictionaryRevision, 7);
  assert.equal(h.client.snapshot().revision, 7);
  h.api.dictionaries.set('Thai', dictionary([word('fire', { tlnote: 'Edit after restore' })], 8));
  await h.client.sync();
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'Edit after restore');
  assert.equal(h.client.snapshot().revision, 8);
});
