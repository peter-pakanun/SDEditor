/* Real HTTP contract check; requires the sibling SDEditor-API dependencies. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const Cloud = require('../public/cloudSync.js');
const Dictionary = require('../public/dictionarySync.js');

const apiRoot = path.resolve(__dirname, '../../SDEditor-API');
const load = file => import(pathToFileURL(path.join(apiRoot, file)).href);
const copy = structuredClone;
const word = (_id, gameScope, fields = {}) => ({ _id, find: 'Fire', replace: 'Translation ' + _id, alts: [], tlnote: '',
  ...(gameScope === undefined ? {} : { gameScope }), ...fields });
const payload = entries => ({ lang: 'Thai', theme: 'grey', editorRegexes: [], dictionary: copy(entries), editorClipboard: '' });

function memoryStore() {
  return { state: null, tail: Promise.resolve(), async getHybridState() { await this.tail; return copy(this.state); },
    updateHybridState(updater) {
      const operation = this.tail.then(() => { const next = updater(copy(this.state)); this.state = copy(next); return copy(next); });
      this.tail = operation.catch(() => {});
      return operation;
    },
  };
}

async function fixture(t, initial, local = initial) {
  const [{ openDatabase, CloudStore }, { loadConfig }, { createApp }] = await Promise.all([
    load('src/database.js'), load('src/config.js'), load('src/app.js'),
  ]);
  const config = loadConfig({ ADMIN_GOOGLE_SUB: 'admin' });
  const db = openDatabase(':memory:'), apiStore = new CloudStore(db, config);
  const account = id => {
    apiStore.registerIdentity({ sub: id, email: id + '@example.test', name: id });
    apiStore.assignLanguage('admin', id, 'Thai');
    return apiStore.createSession(id);
  };
  const session = account('first'); account('second');
  apiStore.patchDictionary('first', 'Thai', { baseRevision: 0, mutationId: 'seed', upserts: initial, deletedIds: [] });
  const app = createApp({ config, store: apiStore, oauthProvider: null, logger: { warn() {}, error() {} } });
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiBase = 'http://127.0.0.1:' + server.address().port, clients = [], requests = [], statuses = [];
  const durable = memoryStore();
  let uuid = 0, loseNextDictionaryReply = false;
  const fetcher = async (url, options) => {
    const response = await fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://sdeditor.pages.dev' } });
    const parsed = new URL(url);
    const record = { path: parsed.pathname, query: parsed.search, method: options.method,
      version: options.headers['X-SDEditor-Dictionary-Version'], body: options.body ? JSON.parse(options.body) : null,
      status: response.status, response: response.status === 204 ? null : await response.clone().json() };
    requests.push(record);
    if (loseNextDictionaryReply && record.method === 'PATCH' && record.path.startsWith('/v1/dictionaries/') && response.ok) {
      loseNextDictionaryReply = false;
      throw new Error('Lost reply after the real API committed the mutation');
    }
    return response;
  };
  async function makeClient(login = false) {
    const client = new Cloud.Client({ store: durable, merge: Dictionary, fetch: fetcher, apiBase,
      uuid: () => 'scope-api-' + ++uuid, onStatus: status => statuses.push(status) });
    client.schedule = () => {};
    clients.push(client);
    await client.initialize(payload(local));
    if (login) await client.acceptLogin(session);
    return client;
  }
  t.after(async () => { clients.forEach(client => client.destroy()); await new Promise(resolve => server.close(resolve)); db.close(); });
  const client = await makeClient(true);
  return { client, durable, apiStore, db, requests, statuses, makeClient,
    loseReply() { loseNextDictionaryReply = true; },
    patchRemote(upserts) { return apiStore.patchDictionary('second', 'Thai', { baseRevision: apiStore.dictionary('Thai').revision,
      mutationId: 'remote-' + ++uuid, upserts, deletedIds: [] }); },
    writes() { return requests.filter(request => request.method === 'PATCH' && request.path === '/v1/dictionaries/Thai'); },
  };
}

test('real API and browser sync engine retain game variants, compact receipts, scope resets, and history restores', async t => {
  const one = word('poe1-entry', 'poe1'), two = word('poe2-entry', 'poe2'), fallback = word('fallback');
  const initial = [one, two, fallback];
  const local = initial.map(entry => ({ ...entry, _id: 'local-' + entry._id }));
  const f = await fixture(t, initial, local);
  assert.deepEqual(f.client.snapshot().dictionary, initial, 'First attachment aligns duplicate Finds by scope.');
  assert.equal(f.writes().length, 0);

  const scoped = f.client.snapshot().dictionary.map(entry => entry._id === 'fallback' ? { ...entry, gameScope: 'poe2' } : entry);
  await f.client.saveLocal(payload(scoped));
  assert.equal(f.durable.state.profiles.first.dictionaries.Thai.entries.find(entry => entry._id === 'fallback').gameScope, 'poe2');
  await f.client.sync();
  const scopeWrite = f.writes().at(-1);
  assert.equal(scopeWrite.status, 200);
  assert.equal(scopeWrite.query, '?return=ack');
  assert.equal(scopeWrite.body.upserts.length, 1);
  assert.equal(scopeWrite.body.upserts[0].gameScope, 'poe2');
  assert.deepEqual(scopeWrite.response, { revision: 2, mutationId: scopeWrite.body.mutationId, appliedRevision: 2 });
  assert.equal(f.apiStore.dictionary('Thai').entries.find(entry => entry._id === 'fallback').gameScope, 'poe2');

  const history = await f.client.getDictionaryHistory({ entryId: 'fallback' });
  const scopeEvent = history.items.find(event => event.revision === 2);
  assert.deepEqual(scopeEvent.changes, ['gameScope']);
  const scopeDetail = await f.client.getDictionaryHistoryEvent(scopeEvent.id);
  assert.equal(scopeDetail.before.gameScope, undefined);
  assert.equal(scopeDetail.after.gameScope, 'poe2');

  const all = f.client.snapshot().dictionary.map(entry => entry._id === 'fallback' ? { ...entry, gameScope: 'all' } : entry);
  await f.client.saveLocal(payload(all)); await f.client.sync();
  assert.equal(f.writes().at(-1).body.upserts[0].gameScope, 'all');
  assert.equal(f.apiStore.dictionary('Thai').entries.find(entry => entry._id === 'fallback').gameScope, 'all');
  assert.deepEqual(f.apiStore.dictionary('Thai').entries.filter(entry => entry._id !== 'fallback'), [one, two]);

  const restricted = f.client.snapshot().dictionary.map(entry => entry._id === 'fallback' ? { ...entry, gameScope: 'poe1' } : entry);
  await f.client.saveLocal(payload(restricted)); f.loseReply(); await f.client.sync();
  const pending = copy(f.durable.state.profiles.first.dictionaries.Thai.pendingWrite);
  assert.equal(pending.request.upserts[0].gameScope, 'poe1');
  assert.match(f.statuses.at(-1).message, /Lost reply/);
  assert.equal(f.apiStore.dictionary('Thai').revision, 4, 'The lost reply follows a committed scope change.');
  await f.client.saveLocal(payload(restricted.map(entry => entry._id === 'fallback' ? { ...entry, tlnote: 'Local note after lost reply' } : entry)));
  f.patchRemote([{ ...two, tlnote: 'Other translator note' }]);
  f.client.destroy();
  const resumed = await f.makeClient();
  await resumed.sync();
  const replays = f.writes().filter(request => request.body.mutationId === pending.request.mutationId);
  assert.equal(replays.length, 2);
  assert.deepEqual(replays[0].body, replays[1].body);
  assert.equal(replays[1].response.appliedRevision, 4);
  assert.equal(replays[1].response.revision, 5);
  assert.equal(Array.isArray(replays[1].response.entries), true, 'A replay after newer changes returns the full current snapshot.');
  assert.equal(resumed.snapshot().dictionary.find(entry => entry._id === 'fallback').tlnote, 'Local note after lost reply');
  assert.equal(resumed.snapshot().dictionary.find(entry => entry._id === 'poe2-entry').tlnote, 'Other translator note');
  assert.equal(f.durable.state.profiles.first.dictionaries.Thai.pendingWrite, null);
  const afterRetry = await resumed.getDictionaryHistory({ entryId: 'fallback' });
  assert.equal(afterRetry.items.filter(event => event.revision === 4 && event.changes.includes('gameScope')).length, 1, 'Receipt replay does not duplicate history.');

  await resumed.restoreDictionaryHistory(scopeEvent.id, 'before', f.apiStore.dictionary('Thai').revision);
  assert.equal(resumed.snapshot().dictionary.find(entry => entry._id === 'fallback').gameScope, 'all');
  assert.equal(f.apiStore.dictionary('Thai').entries.find(entry => entry._id === 'fallback').gameScope, undefined, 'A legacy history version restores All.');
  await resumed.restoreDictionaryHistory(scopeEvent.id, 'after', f.apiStore.dictionary('Thai').revision);
  assert.equal(resumed.snapshot().dictionary.find(entry => entry._id === 'fallback').gameScope, 'poe2');
  assert.equal(f.apiStore.dictionary('Thai').entries.find(entry => entry._id === 'poe2-entry').tlnote, 'Other translator note');
  assert.equal(f.requests.filter(request => request.path.startsWith('/v1/dictionaries/')).every(request => request.version === '2'), true);
});

test('a durable legacy mutation replays unchanged after another translator makes that row game-specific', async t => {
  const legacy = word('legacy');
  const f = await fixture(t, [legacy]);
  await f.client.saveLocal(payload([{ ...legacy, replace: 'Accepted legacy edit' }]));
  f.loseReply(); await f.client.sync();
  const pending = copy(f.durable.state.profiles.first.dictionaries.Thai.pendingWrite);
  assert.equal(Object.hasOwn(pending.request.upserts[0], 'gameScope'), false);
  f.patchRemote([{ ...legacy, replace: 'Accepted legacy edit', gameScope: 'poe2' }]);
  f.client.destroy();
  const resumed = await f.makeClient(); await resumed.sync();
  const replay = f.writes().at(-1);
  assert.deepEqual(replay.body, pending.request);
  assert.equal(replay.status, 200);
  assert.equal(replay.response.entries[0].gameScope, 'poe2');
  assert.equal(resumed.snapshot().dictionary[0].gameScope, 'poe2');
  assert.equal(f.apiStore.dictionary('Thai').revision, 3, 'Legacy receipt replay never widens the newer scope or creates another mutation.');
  assert.equal(f.durable.state.profiles.first.dictionaries.Thai.pendingWrite, null);
});
