const assert = require('node:assert/strict');
const { test } = require('node:test');
const Cloud = require('../public/cloudSync.js');
const Dictionary = require('../public/dictionarySync.js');

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const word = (id = 'fire', fields = {}) => ({ _id: id, find: 'Fire', replace: 'ไฟ', alts: [], tlnote: '', ...fields });
const dictionary = (entries = [], revision = 1, tombstones = []) => ({ entries: clone(entries), revision, tombstones: clone(tombstones) });
const preferences = (fields = {}) => ({ lang: 'Thai', theme: 'grey', editorRegexes: [], ...fields });
const payload = (entries, fields = {}) => ({ ...preferences(fields), dictionary: clone(entries), editorClipboard: '' });
const user = (id = 'alice', language = 'Thai') => ({ id, email: id + '@example.test', name: id, language, isAdmin: false });
const reply = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => clone(body) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

class MemoryStore {
  constructor(state) { this.state = clone(state); this.tail = Promise.resolve(); this.nextError = null; }
  updateHybridState(updater) {
    const operation = this.tail.then(() => {
      const next = updater(clone(this.state));
      if (this.nextError) { const error = this.nextError; this.nextError = null; throw error; }
      this.state = clone(next);
      return clone(next);
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  async getHybridState() { await this.tail; return clone(this.state); }
}

// The fake server models revision checks and mutation receipts rather than
// returning canned success: a replay must have no second database effect.
class MemoryAPI {
  constructor(remote) {
    this.remote = clone(remote);
    this.calls = [];
    this.events = new Map();
    this.receipts = new Map();
    this.historyWrites = 0;
    this.before = null;
    this.after = null;
    this.users = { 'token-alice': user(), 'token-bob': user('bob') };
    this.settings = { revision: 1, settings: preferences() };
  }
  event(id, entryId, before, after) {
    this.events.set(String(id), { id, entryId, before: clone(before), after: clone(after), actor: user('bob'), action: after ? before ? 'update' : 'add' : 'delete', origin: 'edit', revision: this.remote.revision });
    return id;
  }
  async fetch(url, options) {
    const parsed = new URL(url);
    const request = { path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), method: options.method, token: options.headers.Authorization?.replace(/^Bearer /, ''), body: options.body ? JSON.parse(options.body) : null };
    this.calls.push(request);
    if (this.before) await this.before(request);
    const identity = this.users[request.token];
    if (!identity) return reply({ error: { message: 'Session expired' } }, 401);
    let response;
    if (request.path === '/v1/me') response = { user: identity, expiresAt: Date.now() + 86400000 };
    else if (request.path === '/v1/settings') {
      if (request.method !== 'GET') this.settings = { revision: this.settings.revision + 1, settings: request.body.settings };
      response = this.settings;
    } else {
      const match = request.path.match(/^\/v1\/dictionaries\/([^/]+)(?:\/history(?:\/([^/]+)(\/restore)?)?)?$/);
      assert.ok(match, 'Unexpected API path: ' + request.path);
      if (decodeURIComponent(match[1]) !== identity.language) return reply({ error: { message: 'Language access denied' } }, 403);
      if (request.path.endsWith('/history')) response = { items: [...this.events.values()], nextCursor: null, revision: this.remote.revision, actors: [user('bob')], coverage: { complete: true } };
      else if (match[2]) {
        const event = this.events.get(decodeURIComponent(match[2]));
        if (!event) return reply({ error: { message: 'History event not found' } }, 404);
        if (!match[3]) response = { ...event, current: this.remote.entries.find(entry => entry._id === event.entryId) || null, currentRevision: this.remote.revision };
        else {
          const key = identity.id + ':' + request.body.mutationId;
          if (this.receipts.has(key)) response = { ...this.remote, appliedRevision: this.receipts.get(key) };
          else {
            if (request.body.baseRevision !== this.remote.revision) return reply({ error: { code: 'REVISION_CONFLICT', message: 'Newer dictionary' }, current: this.remote }, 409);
            const target = event[request.body.version];
            this.remote = Cloud.acceptedSnapshot(this.remote, target ? [target] : [], target ? [] : [event.entryId], this.remote.revision + 1);
            this.receipts.set(key, this.remote.revision);
            this.historyWrites++;
            response = { ...this.remote, appliedRevision: this.remote.revision };
          }
        }
      } else if (request.method === 'GET') response = this.remote;
      else {
        const key = identity.id + ':' + request.body.mutationId;
        if (this.receipts.has(key)) response = { ...this.remote, appliedRevision: this.receipts.get(key) };
        else {
          if (request.body.baseRevision !== this.remote.revision) return reply({ error: { code: 'REVISION_CONFLICT', message: 'Newer dictionary' }, current: this.remote }, 409);
          this.remote = Cloud.acceptedSnapshot(this.remote, request.body.upserts, request.body.deletedIds, this.remote.revision + 1);
          this.receipts.set(key, this.remote.revision);
          response = { ...this.remote, appliedRevision: this.remote.revision };
        }
      }
    }
    if (this.after) await this.after(request, clone(response));
    return reply(response);
  }
  restores() { return this.calls.filter(call => call.path.endsWith('/restore')); }
  patches() { return this.calls.filter(call => call.method === 'PATCH'); }
}

function stateFor(local, base) {
  const state = Cloud.initializeState(payload(local));
  state.activeProfile = 'alice';
  state.profiles.alice = clone(state.profiles.guest);
  state.profiles.alice.settingsBase = { revision: 1, settings: preferences() };
  state.profiles.alice.dictionaries.Thai = { entries: clone(local), base: clone(base), revision: base.revision, conflicts: [], pendingResolution: null };
  state.auth = { token: 'token-alice', user: user(), expiresAt: Date.now() + 86400000 };
  return state;
}

let sequence = 0;
async function harness(t, { local = [word()], base = dictionary([word()]), remote = base, state = stateFor(local, base), store = new MemoryStore(state), api = new MemoryAPI(remote) } = {}) {
  let count = 0;
  const namespace = ++sequence;
  const statuses = [];
  const client = new Cloud.Client({ store, merge: Dictionary, fetch: api.fetch.bind(api), apiBase: 'https://api.example.test', uuid: () => 'history-' + namespace + '-' + ++count, onStatus: value => statuses.push(value) });
  client.schedule = () => {};
  t.after(() => client.destroy());
  await client.initialize(payload(local));
  return { client, store, api, statuses };
}

test('history filters are URL encoded and history reads do not modify local dictionary state', async t => {
  const h = await harness(t);
  h.api.event(1, 'fire', null, word());
  const before = clone(h.store.state);
  const filters = { entryId: 'fire/?&=', q: 'Fire & Ice', actor: 'alice', action: 'delete', origin: 'auto_merge', from: '2026-09-01', to: '2026-09-29', cursor: '123', limit: 25 };
  const result = await h.client.getDictionaryHistory(filters);
  assert.equal(result.items.length, 1);
  assert.deepEqual(h.api.calls.at(-1).query, Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, String(value)])));
  assert.deepEqual(h.store.state, before);
  const detail = await h.client.getDictionaryHistoryEvent(1);
  assert.equal(detail.entryId, 'fire');
  assert.deepEqual(h.store.state, before);
  assert.equal(h.api.calls.every(call => call.method === 'GET'), true);
});

test('restoring a deleted entry preserves its ID and clears only that tombstone', async t => {
  const base = dictionary([], 2, ['fire', 'ice']);
  const h = await harness(t, { local: [], base });
  h.api.event(1, 'fire', word(), null);
  await h.client.restoreDictionaryHistory(1, 'before', 2);
  assert.deepEqual(h.api.remote.entries, [word()]);
  assert.deepEqual(h.api.remote.tombstones, ['ice']);
  assert.deepEqual(h.client.snapshot().dictionary, [word()]);
  assert.equal(h.api.historyWrites, 1);
});

test('restoring a deletion version keeps other dictionary entries', async t => {
  const ice = word('ice', { find: 'Ice', replace: 'น้ำแข็ง' });
  const h = await harness(t, { local: [word(), ice], base: dictionary([word(), ice], 3) });
  h.api.event(1, 'fire', word(), null);
  await h.client.restoreDictionaryHistory(1, 'after', 3);
  assert.deepEqual(h.client.snapshot().dictionary, [ice]);
  assert.deepEqual(h.api.remote.tombstones, ['fire']);
});

test('restore preserves unrelated unsynced edits and saves the replaced draft for recovery', async t => {
  const original = word('fire', { replace: 'earlier version' });
  const current = word('fire', { replace: 'current remote' });
  const local = word('fire', { replace: 'private draft' });
  const ice = word('ice', { find: 'Ice', replace: 'remote ice' });
  const editedIce = { ...ice, tlnote: 'offline ice note' };
  const h = await harness(t, { local: [local, editedIce], base: dictionary([current, ice], 3) });
  h.api.event(1, 'fire', original, current);
  await h.client.restoreDictionaryHistory(1, 'before', 3);
  assert.equal(h.client.snapshot().dictionary.find(entry => entry._id === 'fire').replace, 'earlier version');
  assert.equal(h.client.snapshot().dictionary.find(entry => entry._id === 'ice').tlnote, 'offline ice note');
  assert.ok(JSON.stringify(h.client.recoveryExport()).includes('private draft'));
  await h.client.sync();
  assert.equal(h.api.remote.entries.find(entry => entry._id === 'ice').tlnote, 'offline ice note');
});

test('restore refuses a stale displayed revision without replacing newer shared content', async t => {
  const h = await harness(t, { base: dictionary([word()], 2) });
  h.api.event(1, 'fire', word('fire', { replace: 'old' }), word());
  h.api.remote = dictionary([word('fire', { replace: 'newer translator edit' })], 3);
  await assert.rejects(h.client.restoreDictionaryHistory(1, 'before', 2));
  assert.equal(h.api.historyWrites, 0);
  assert.equal(h.api.remote.entries[0].replace, 'newer translator edit');
  assert.ok(!h.store.state.profiles.alice.dictionaries.Thai.pendingHistoryRestore);
});

test('a revision changing after preview triggers 409 and does not overwrite the update', async t => {
  const h = await harness(t, { base: dictionary([word()], 2) });
  h.api.event(1, 'fire', word('fire', { replace: 'old' }), word());
  h.api.before = request => {
    if (request.path.endsWith('/restore')) h.api.remote = dictionary([word('fire', { replace: 'newer translator edit' })], 3);
  };
  await assert.rejects(h.client.restoreDictionaryHistory(1, 'before', 2));
  assert.equal(h.api.historyWrites, 0);
  assert.equal(h.api.remote.entries[0].replace, 'newer translator edit');
  assert.ok(!h.store.state.profiles.alice.dictionaries.Thai.pendingHistoryRestore);
});

test('a restore request is durable before POST and a lost acknowledgement reuses its mutation ID after reload', async t => {
  const h = await harness(t);
  h.api.event(1, 'fire', word('fire', { replace: 'restored' }), word());
  let lost = false;
  h.api.before = request => {
    if (request.path.endsWith('/restore')) {
      const pending = h.store.state.profiles.alice.dictionaries.Thai.pendingHistoryRestore;
      assert.ok(pending, 'persist the restore request before sending it');
      assert.ok(JSON.stringify(pending).includes(request.body.mutationId));
    }
  };
  h.api.after = request => {
    if (request.path.endsWith('/restore') && !lost) { lost = true; throw new Error('Response lost after commit'); }
  };
  await assert.rejects(h.client.restoreDictionaryHistory(1, 'before', 1), /Response lost/);
  assert.equal(h.api.historyWrites, 1);
  const mutationId = h.api.restores()[0].body.mutationId;
  h.client.destroy();
  const next = await harness(t, { store: h.store, api: h.api });
  await next.client.sync();
  assert.equal(h.api.restores().at(-1).body.mutationId, mutationId);
  assert.equal(h.api.historyWrites, 1);
  assert.equal(next.client.snapshot().dictionary[0].replace, 'restored');
  assert.ok(!h.store.state.profiles.alice.dictionaries.Thai.pendingHistoryRestore);
});

test('IndexedDB failure prevents sending the restore request', async t => {
  const h = await harness(t);
  h.api.event(1, 'fire', word('fire', { replace: 'old' }), word());
  h.store.nextError = new Error('IndexedDB quota exceeded');
  await assert.rejects(h.client.restoreDictionaryHistory(1, 'before', 1), /quota exceeded/);
  assert.equal(h.api.restores().length, 0);
  assert.equal(h.api.historyWrites, 0);
  assert.deepEqual(h.client.snapshot().dictionary, [word()]);
});

test('local edits made while restore is in flight remain available after the response', async t => {
  const h = await harness(t);
  h.api.event(1, 'fire', word('fire', { replace: 'historical replacement' }), word());
  const entered = deferred();
  const release = deferred();
  h.api.before = async request => {
    if (request.path.endsWith('/restore')) { entered.resolve(); await release.promise; }
  };
  const restore = h.client.restoreDictionaryHistory(1, 'before', 1);
  await entered.promise;
  await h.client.saveLocal(payload([word('fire', { tlnote: 'note typed during restore' })]));
  release.resolve();
  await restore;
  assert.equal(h.client.snapshot().dictionary[0].replace, 'historical replacement');
  assert.equal(h.client.snapshot().dictionary[0].tlnote, 'note typed during restore');
});

test('one tab switching language leaves the shared assigned-language history request valid', async t => {
  const h = await harness(t);
  h.api.event(1, 'fire', null, word());
  const entered = deferred();
  const release = deferred();
  h.api.before = async request => {
    if (request.path.endsWith('/history')) { entered.resolve(); await release.promise; }
  };
  const reading = h.client.getDictionaryHistory({ entryId: 'fire' });
  await entered.promise;
  await h.client.selectLanguage('French', payload([word()], { lang: 'French' }), 'Thai');
  release.resolve();
  const result = await reading;
  assert.equal(result.items[0].entryId, 'fire');
  assert.equal(h.api.calls.find(call => call.path.endsWith('/history')).path, '/v1/dictionaries/Thai/history');
  // A tab that navigated away discards this result in CloudHistoryUI using its
  // own language/request context. Other tabs may still be reading Thai history.
  assert.equal(h.client.snapshot().settings.lang, 'French');
  assert.deepEqual(h.client.snapshot().dictionary, []);
});

test('switching accounts during restore does not copy the outgoing account draft', async t => {
  const h = await harness(t);
  h.api.event(1, 'fire', word('fire', { replace: 'restored Alice version' }), word());
  const entered = deferred();
  const release = deferred();
  h.api.before = async request => {
    if (request.path.endsWith('/restore')) { entered.resolve(); await release.promise; }
  };
  const restoring = h.client.restoreDictionaryHistory(1, 'before', 1);
  await entered.promise;
  const switching = h.client.acceptLogin({ token: 'token-bob', user: user('bob'), expiresAt: Date.now() + 86400000 });
  await h.store.tail;
  release.resolve();
  await assert.rejects(restoring, error => error.stale === true);
  await switching;
  assert.equal(h.client.snapshot().profileId, 'bob');
  assert.equal(h.api.restores().every(call => call.token === 'token-alice'), true);
  assert.equal(h.store.state.profiles.alice.dictionaries.Thai.entries[0].replace, 'ไฟ');
});

test('ordinary local edits are not falsely attributed as an automatic merge', async t => {
  const h = await harness(t);
  await h.client.saveLocal(payload([word('fire', { replace: 'ordinary edit' })]));
  await h.client.sync();
  assert.equal(h.api.patches().length, 1);
  assert.notEqual(h.api.patches()[0].body.origins?.fire, 'auto_merge');
});

test('independent concurrent field edits are recorded as an automatic merge', async t => {
  const h = await harness(t, { remote: dictionary([word('fire', { tlnote: 'remote note' })], 2) });
  await h.client.saveLocal(payload([word('fire', { replace: 'local replacement' })]));
  await h.client.sync();
  assert.equal(h.api.patches().length, 1);
  assert.equal(h.api.patches()[0].body.origins?.fire, 'auto_merge');
  assert.equal(h.api.remote.entries[0].replace, 'local replacement');
  assert.equal(h.api.remote.entries[0].tlnote, 'remote note');
});

test('restoring one entry preserves another entry with an unresolved conflict', async t => {
  const ice = word('ice', { find: 'Ice', replace: 'original ice' });
  const localIce = { ...ice, replace: 'local ice' };
  const remoteIce = { ...ice, replace: 'remote ice' };
  const h = await harness(t, { local: [word(), localIce], base: dictionary([word(), ice]), remote: dictionary([word(), remoteIce], 2) });
  h.api.event(1, 'fire', word('fire', { replace: 'older fire' }), word());
  await h.client.sync();
  assert.equal(h.client.snapshot().conflicts.length, 1);
  await h.client.restoreDictionaryHistory(1, 'before', 2);
  const conflict = h.client.snapshot().conflicts[0];
  assert.equal(conflict.id, 'ice');
  assert.equal(conflict.local.replace, 'local ice');
  assert.equal(conflict.remote.replace, 'remote ice');
  assert.equal(h.client.snapshot().dictionary.find(entry => entry._id === 'fire').replace, 'older fire');
  assert.equal(h.api.remote.entries.find(entry => entry._id === 'ice').replace, 'remote ice');
});

test('a lost restore acknowledgement followed by a newer shared edit keeps the newer version on retry', async t => {
  const h = await harness(t);
  h.api.event(1, 'fire', word('fire', { replace: 'restored value' }), word());
  let lost = false;
  h.api.after = request => {
    if (request.path.endsWith('/restore') && !lost) { lost = true; throw new Error('Acknowledgement lost'); }
  };
  await assert.rejects(h.client.restoreDictionaryHistory(1, 'before', 1), /Acknowledgement lost/);
  h.api.remote = dictionary([word('fire', { replace: 'newer shared value' })], 3);
  h.client.destroy();
  const next = await harness(t, { store: h.store, api: h.api });
  await next.client.sync();
  assert.equal(h.api.historyWrites, 1);
  assert.equal(h.api.remote.revision, 3);
  assert.equal(next.client.snapshot().dictionary[0].replace, 'newer shared value');
  assert.equal(next.client.snapshot().conflicts.length, 0);
});

test('history access requires a signed-in account with an assigned language', async t => {
  const state = stateFor([word()], dictionary([word()]));
  state.auth.user.language = null;
  const h = await harness(t, { state });
  await assert.rejects(h.client.getDictionaryHistory());
  await assert.rejects(h.client.getDictionaryHistoryEvent(1));
  await assert.rejects(h.client.restoreDictionaryHistory(1, 'before', 1));
  assert.equal(h.api.calls.length, 0);
});

test('a queued restore stays with its original language after reassignment', async t => {
  const h = await harness(t);
  h.api.event(1, 'fire', word('fire', { replace: 'queued value' }), word());
  h.api.before = request => {
    if (request.path.endsWith('/restore')) throw new Error('Offline');
  };
  await assert.rejects(h.client.restoreDictionaryHistory(1, 'before', 1), /Offline/);
  const pending = clone(h.store.state.profiles.alice.dictionaries.Thai.pendingHistoryRestore);
  h.api.before = null;
  h.api.users['token-alice'].language = 'French';
  const callsBefore = h.api.calls.length;
  await h.client.sync();
  assert.deepEqual(h.store.state.profiles.alice.dictionaries.Thai.pendingHistoryRestore, pending);
  assert.equal(h.api.calls.slice(callsBefore).some(call => call.path.endsWith('/restore')), false);
  assert.equal(h.api.historyWrites, 0);
});

test('manual resolution uploads are identified as conflict resolution', async t => {
  const h = await harness(t, { local: [word('fire', { replace: 'local version' })], remote: dictionary([word('fire', { replace: 'remote version' })], 2) });
  await h.client.sync();
  assert.equal(h.client.snapshot().conflicts.length, 1);
  await h.client.resolveConflict('fire', { definitions: 'local', note: 'local' }, 2);
  assert.equal(h.api.patches().at(-1).body.origins.fire, 'conflict_resolution');
});
