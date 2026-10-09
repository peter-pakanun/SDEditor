const assert = require('node:assert/strict');
const { test } = require('node:test');
const { create } = require('../public/dictionaryWorkerClient.js');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness({ unavailable = false, handshake = true } = {}) {
  const workers = [], runtimes = [], publications = [], failures = [], scheduled = [];
  class Worker {
    constructor() { this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    emit(message) { this.onmessage?.({ data: message }); }
  }
  const engine = {
    createRuntime({ postMessage }) {
      const runtime = { messages: [], handleMessage(message) { this.messages.push(message); },
        finish(generation, scopeEpoch) { postMessage({ type: 'ready', generation, scopeEpoch }); },
        reply(message) { postMessage(message); }, dispose() { this.disposed = true; } };
      runtimes.push(runtime);
      return runtime;
    },
  };
  const client = create({ Worker: unavailable ? null : Worker, engine,
    setTimeout(callback) { const timer = () => { if (!timer.cancelled) callback(); }; scheduled.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cancelled = true; },
    onReady: message => publications.push(message.generation), onError: error => failures.push(error) });
  if (!unavailable && handshake) workers[0].emit({ type: 'started', version: 1 });
  const flush = () => { while (scheduled.length) scheduled.shift()(); };
  return { client, workers, runtimes, publications, failures, scheduled, flush };
}

const snapshot = generation => ({ generation, game: 'poe1', entries: [
  { _id: 'fire', find: 'Fire', replace: 'version ' + generation, alts: [], tlnote: 'note ' + generation },
] });

test('publishes atomically, completes the active build, and coalesces latest pending snapshot', async () => {
  const { client, workers, publications, flush } = harness();
  const worker = workers[0], epoch = client.setScope('guest/Thai/poe1');
  client.submitSnapshot(snapshot(1));
  client.submitSnapshot(snapshot(2));
  client.submitSnapshot(snapshot(3));
  flush();
  assert.deepEqual(worker.messages.filter(m => m.type === 'commitSnapshot').map(m => m.generation), [1]);
  const ready = client.waitReady();
  worker.emit({ type: 'ready', scopeEpoch: epoch, generation: 1 });
  assert.equal((await ready).generation, 1);
  assert.equal(client.readySnapshot.entries[0].replace, 'version 1');
  assert.equal(client.buildingGeneration, 3);
  assert.deepEqual(publications, [1]);
  const query = client.match([{ key: 'a', english: 'Fire' }]);
  const request = worker.messages.findLast(m => m.type === 'match');
  const latest = client.waitReady({ generation: 3 });
  worker.emit({ type: 'ready', scopeEpoch: epoch, generation: 3 });
  worker.emit({ type: 'matches', scopeEpoch: epoch, generation: 1, requestId: request.requestId,
    units: [{ key: 'a', english: 'Fire', HLs: [] }], entriesById: { fire: snapshot(1).entries[0] } });
  assert.equal((await query).generation, 1, 'same-scope stale query remains valid after publication');
  assert.equal((await latest).generation, 3);
  assert.deepEqual(publications, [1, 3]);
  client.dispose();
});

test('scope switch rejects pending readiness and queries, and ignores previous-scope replies', async () => {
  const { client, workers } = harness();
  const oldEpoch = client.setScope('Thai');
  client.submitSnapshot(snapshot(1));
  const ready = client.waitReady(), query = client.match([{ key: 'x', english: 'Fire' }]);
  const readyRejected = assert.rejects(ready, { name: 'AbortError' });
  const queryRejected = assert.rejects(query, { name: 'AbortError' });
  const nextEpoch = client.setScope('German');
  workers[0].emit({ type: 'ready', scopeEpoch: oldEpoch, generation: 1 });
  assert.notEqual(nextEpoch, oldEpoch);
  assert.equal(client.readyGeneration, 0);
  await Promise.all([readyRejected, queryRejected]);
  client.dispose();
});

test('worker crash restores the old plain snapshot before rebuilding and replays queued queries', async () => {
  const { client, workers, runtimes, publications, failures } = harness();
  const epoch = client.setScope('Thai');
  client.submitSnapshot(snapshot(1));
  workers[0].emit({ type: 'ready', scopeEpoch: epoch, generation: 1 });
  const query = client.match([{ key: 'x', english: 'Fire' }]);
  client.submitSnapshot(snapshot(2));
  workers[0].onerror({ preventDefault() {} });
  assert.equal(client.fallback, true);
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(runtimes[0].messages.map(m => m.type), ['setScope', 'setSnapshot']);
  assert.equal(runtimes[0].messages[1].generation, 1);
  runtimes[0].finish(1, epoch);
  assert.deepEqual(publications, [1], 'restoring the old version does not emit a second publication');
  const request = runtimes[0].messages.find(m => m.type === 'match');
  assert.ok(request);
  assert.equal(runtimes[0].messages.findLast(m => m.type === 'setSnapshot').generation, 2);
  runtimes[0].reply({ type: 'matches', requestId: request.requestId, scopeEpoch: epoch,
    generation: 1, units: [], entriesById: {} });
  assert.equal((await query).generation, 1);
  assert.deepEqual(failures, []);
  client.dispose();
});

test('worker startup timeout uses cooperative fallback and reports only fallback failure', async () => {
  const { client, runtimes, scheduled, failures } = harness({ handshake: false });
  const epoch = client.setScope('Thai');
  client.submitSnapshot(snapshot(1));
  const ready = client.waitReady();
  scheduled[0]();
  assert.equal(client.fallback, true);
  assert.equal(runtimes[0].messages.find(m => m.type === 'setSnapshot').generation, 1);
  assert.deepEqual(failures, []);
  const rejected = assert.rejects(ready, /broken fallback/);
  runtimes[0].reply({ type: 'error', scopeEpoch: epoch, generation: 1, error: { message: 'broken fallback' } });
  await rejected;
  assert.equal(failures.length, 1);
  client.dispose();
});

test('failed fallback bootstrap rejects new queries while retaining the last plain ready snapshot', async () => {
  const { client, workers, runtimes, failures } = harness();
  const epoch = client.setScope('Thai');
  client.submitSnapshot(snapshot(1));
  workers[0].emit({ type: 'ready', scopeEpoch: epoch, generation: 1 });
  workers[0].onerror({ preventDefault() {} });
  runtimes[0].reply({ type: 'error', scopeEpoch: epoch, generation: 1,
    error: { message: 'could not restore fallback snapshot' } });
  assert.equal(client.readySnapshot.entries[0].replace, 'version 1');
  await assert.rejects(client.match([{ key: 'x', english: 'Fire' }]), /could not restore fallback snapshot/);
  assert.equal(failures.length, 1);
  client.submitSnapshot(snapshot(2));
  runtimes[0].finish(2, epoch);
  const query = client.match([{ key: 'x', english: 'Fire' }]);
  const request = runtimes[0].messages.findLast(m => m.type === 'match');
  runtimes[0].reply({ type: 'matches', scopeEpoch: epoch, generation: 2,
    requestId: request.requestId, units: [], entriesById: {} });
  assert.equal((await query).generation, 2);
  client.dispose();
});

test('fallback replacement-build failure retains compiled ready queries and their pending results', async () => {
  const { client, runtimes, failures } = harness({ unavailable: true });
  const epoch = client.setScope('Thai');
  client.submitSnapshot(snapshot(1));
  runtimes[0].finish(1, epoch);
  assert.equal(client.compiledReadyGeneration, 1);
  const pending = client.match([{ key: 'pending', english: 'Fire' }]);
  const first = runtimes[0].messages.findLast(m => m.type === 'match');
  client.submitSnapshot(snapshot(2));
  runtimes[0].reply({ type: 'error', scopeEpoch: epoch, generation: 2,
    error: { message: 'replacement build failed' } });
  assert.equal(client.compiledReadyGeneration, 1);
  assert.equal((await client.waitReady()).generation, 1);
  await assert.rejects(client.waitReady({ generation: 2 }), /replacement build failed/);
  const next = client.match([{ key: 'next', english: 'Fire' }]);
  const second = runtimes[0].messages.findLast(m => m.type === 'match');
  for (const request of [first, second]) runtimes[0].reply({ type: 'matches', scopeEpoch: epoch,
    requestId: request.requestId, generation: 1, units: [], entriesById: { fire: snapshot(1).entries[0] } });
  assert.equal((await pending).generation, 1);
  assert.equal((await next).generation, 1);
  assert.equal(failures.length, 1);
  client.dispose();
});

test('a fresh submission retries fallback runtime initialization without changing its scope epoch', async () => {
  let initializationFails = true, runtime;
  const client = create({ Worker: null, onError() {}, engine: {
    createRuntime({ postMessage }) {
      if (initializationFails) throw new Error('fallback initialization failed');
      runtime = { messages: [], handleMessage(message) { this.messages.push(message); },
        finish(generation, scopeEpoch) { postMessage({ type: 'ready', generation, scopeEpoch }); }, dispose() {} };
      return runtime;
    },
  } });
  const epoch = client.setScope('Thai');
  await assert.rejects(client.match([{ key: 'x', english: 'Fire' }]), /fallback initialization failed|Cannot read/);
  assert.equal(client.compiledReadyGeneration, 0);
  initializationFails = false;
  client.submitSnapshot(snapshot(1));
  assert.equal(client.scopeEpoch, epoch);
  assert.deepEqual(runtime.messages.map(message => message.type), ['setScope', 'setSnapshot']);
  runtime.finish(1, epoch);
  assert.equal((await client.waitReady()).generation, 1);
  assert.equal(client.compiledReadyGeneration, 1);
  client.dispose();
});

test('worker query error retries against restored fallback snapshot before showing an error', async () => {
  const { client, workers, runtimes, failures, publications } = harness();
  const epoch = client.setScope('Thai');
  client.submitSnapshot(snapshot(1));
  workers[0].emit({ type: 'ready', scopeEpoch: epoch, generation: 1 });
  const query = client.match([{ key: 'x', english: 'Fire' }]);
  const request = workers[0].messages.findLast(m => m.type === 'match');
  workers[0].emit({ type: 'error', scopeEpoch: epoch, requestId: request.requestId,
    error: { message: 'worker query failed' } });
  assert.equal(client.fallback, true);
  assert.deepEqual(failures, []);
  runtimes[0].finish(1, epoch);
  const replay = runtimes[0].messages.findLast(m => m.type === 'match');
  assert.equal(replay.requestId, request.requestId);
  runtimes[0].reply({ type: 'matches', scopeEpoch: epoch, requestId: replay.requestId,
    generation: 1, units: [{ key: 'x', english: 'Fire', HLs: [] }],
    entriesById: { fire: snapshot(1).entries[0] } });
  const pack = await query;
  assert.equal(pack.generation, 1);
  assert.equal(pack.entriesById.fire.replace, 'version 1');
  assert.deepEqual(publications, [1]);
  assert.deepEqual(failures, []);
  client.dispose();
});

test('query failure becomes actionable only after the worker and fallback both fail', async () => {
  const { client, workers, runtimes, failures } = harness();
  const epoch = client.setScope('Thai');
  client.submitSnapshot(snapshot(1));
  workers[0].emit({ type: 'ready', scopeEpoch: epoch, generation: 1 });
  const query = client.match([{ key: 'x', english: 'Fire' }]);
  const rejected = assert.rejects(query, /fallback query failed/);
  const request = workers[0].messages.findLast(m => m.type === 'match');
  workers[0].emit({ type: 'error', scopeEpoch: epoch, requestId: request.requestId,
    error: { message: 'worker query failed' } });
  runtimes[0].finish(1, epoch);
  assert.deepEqual(failures, []);
  runtimes[0].reply({ type: 'error', scopeEpoch: epoch, requestId: request.requestId,
    error: { message: 'fallback query failed' } });
  await rejected;
  assert.equal(failures.length, 1);
  assert.equal(client.readySnapshot.entries[0].replace, 'version 1');
  client.dispose();
});

test('cancelling a query sends the scoped request ID and discards its late reply', async () => {
  const { client, workers } = harness();
  const epoch = client.setScope('Thai');
  client.submitSnapshot(snapshot(1));
  workers[0].emit({ type: 'ready', scopeEpoch: epoch, generation: 1 });
  const query = client.match([{ key: 'x', english: 'Fire' }]);
  const rejected = assert.rejects(query, { name: 'AbortError' });
  query.cancel();
  const cancellation = workers[0].messages.findLast(m => m.type === 'cancel');
  assert.equal(cancellation.scopeEpoch, epoch);
  workers[0].emit({ type: 'matches', scopeEpoch: epoch, requestId: cancellation.requestId, generation: 1 });
  await rejected;
  client.dispose();
});

function uiHarness() {
  let clock = 0, client;
  const context = vm.createContext({ setTimeout, clearTimeout,
    performance: { now() { return ++clock; } },
    Vue: { toRaw(value) { return value; } },
    DictionaryWorkerClient: {
      aborted() { const error = new Error('scope changed'); error.name = 'AbortError'; return error; },
      create(options) {
        const waiters = [];
        client = { scopeEpoch: 0, readyGeneration: 0,
          setScope() { this.readyGeneration = 0; return ++this.scopeEpoch; },
          submitSnapshot(value) { if (this.pausePublication) this.pendingSnapshot = value; else this.publish(value); },
          publish(value = this.pendingSnapshot) {
            this.snapshot = value; this.readyGeneration = value.generation;
            options.onReady({ scopeEpoch: this.scopeEpoch, generation: value.generation });
            for (let i = waiters.length - 1; i >= 0; i--) if (value.generation >= waiters[i].generation) {
              waiters[i].resolve({ scopeEpoch: this.scopeEpoch, generation: value.generation }); waiters.splice(i, 1);
            }
          },
          waitReady({ generation = 0 } = {}) {
            if (this.readyGeneration && this.readyGeneration >= generation) return Promise.resolve({ scopeEpoch: this.scopeEpoch, generation: this.readyGeneration });
            return new Promise(resolve => waiters.push({ resolve, generation }));
          },
          fail(error) { options.onError(error); },
          dispose() {},
        };
        return client;
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/dictionaryWorkerUi.js'), 'utf8'), context);
  const mixin = context.DictionaryWorkerUI.mixin;
  const app = { ...mixin.data(), dictionary: snapshot(1).entries, lang: 'Thai', gameVersion: 'poe1',
    cloudProfileId: 'guest', cloudUser: null, cloudSignedIn: false, scheduleEditorHLterRefresh() {} };
  for (const [key, method] of Object.entries(mixin.methods)) app[key] = method.bind(app);
  return { app, getClient: () => client, dispose: () => mixin.beforeUnmount.call(app) };
}

test('bounded raw capture replays entry edits and membership before sealing a detached snapshot', async () => {
  const { app, getClient, dispose } = uiHarness();
  app.dictionary[0].alts = Array.from({ length: 20 }, (_, i) => ({ _id: 'alt' + i, find: 'term' + i, replace: 'old' }));
  const prepared = app.ensureDictionarySnapshot();
  setTimeout(() => {
    app.dictionary[0].replace = 'new replacement';
    app.dictionary[0].tlnote = 'new note';
    app.dictionary[0].alts[0].replace = 'new alternative';
    app.markDictionarySnapshotDirty('fire');
    app.dictionary.push({ _id: 'cold', find: 'Cold', replace: 'cold', alts: [] });
    app.markDictionarySnapshotDirty('cold', { membership: true });
    app.markDictionarySnapshotDirty(null, { observed: true });
  }, 0);
  await prepared;
  const published = getClient().snapshot;
  assert.equal(published.entries[0].replace, 'new replacement');
  assert.equal(published.entries[0].tlnote, 'new note');
  assert.equal(published.entries[0].alts[0].replace, 'new alternative');
  assert.equal(published.entries[1]._id, 'cold');
  app.dictionary[0].replace = 'after seal';
  assert.equal(published.entries[0].replace, 'new replacement');
  assert.notEqual(published.entries[0], app.dictionary[0]);
  assert.notEqual(published.entries[0].alts, app.dictionary[0].alts);
  dispose();
});

test('whole dictionary replacement during capture restarts and excludes the old rows', async () => {
  const { app, getClient, dispose } = uiHarness();
  app.dictionary[0].alts = Array.from({ length: 20 }, (_, i) => ({ _id: 'a' + i, find: 'term' + i }));
  const prepared = app.ensureDictionarySnapshot();
  setTimeout(() => {
    app.dictionary = [{ _id: 'replaced', find: 'Latest', replace: 'latest', alts: [] }];
    app.markDictionarySnapshotDirty(null, { replace: true });
  }, 0);
  await prepared;
  assert.deepEqual(Array.from(getClient().snapshot.entries, row => row._id), ['replaced']);
  dispose();
});

test('scope change during initial raw capture fences the previous initialization promise', async () => {
  const { app, dispose } = uiHarness();
  app.dictionary[0].alts = Array.from({ length: 20 }, (_, i) => ({ _id: 'a' + i, find: 'term' + i }));
  const prepared = app.ensureDictionarySnapshot();
  const rejected = assert.rejects(prepared, { name: 'AbortError' });
  setTimeout(() => { app.lang = 'German'; app.ensureDictionaryWorker(); }, 0);
  await rejected;
  dispose();
});

test('default generic invalidation includes an unjournaled mutation mixed with a known entry edit', async () => {
  const { app, getClient, dispose } = uiHarness();
  app.dictionary[0].alts = Array.from({ length: 20 }, (_, i) => ({ _id: 'a' + i, find: 'term' + i }));
  app.dictionary.push({ _id: 'other', find: 'Other', replace: 'old', alts: [] });
  const prepared = app.ensureDictionarySnapshot();
  setTimeout(() => {
    app.dictionary[0].replace = 'known change';
    app.markDictionarySnapshotDirty('fire');
    app.dictionary[1].replace = 'unmarked programmatic change';
    app.markDictionarySnapshotDirty(null);
  }, 0);
  await prepared;
  assert.equal(getClient().snapshot.entries[0].replace, 'known change');
  assert.equal(getClient().snapshot.entries[1].replace, 'unmarked programmatic change');
  dispose();
});

test('instrumented watcher consumes specific mutation journals without restarting a full capture', () => {
  const { app, dispose } = uiHarness();
  app.ensureDictionaryWorker();
  app.markDictionarySnapshotDirty(null, { observed: true });
  const unknown = app._dictionaryWorkerState.unknownSerial;
  for (let i = 0; i < 20; i++) {
    app.dictionary[0].replace = 'typed ' + i;
    app.markDictionarySnapshotDirty('fire');
    app.markDictionarySnapshotDirty(null, { observed: true });
    assert.equal(app._dictionaryWorkerState.unknownSerial, unknown);
  }
  // A watcher without a fresh explicit mutation still invalidates unknown data.
  app.markDictionarySnapshotDirty(null, { observed: true });
  assert.ok(app._dictionaryWorkerState.unknownSerial > unknown);
  dispose();
});

test('a first unjournaled watcher update after initial readiness creates a new snapshot', async () => {
  const { app, getClient, dispose } = uiHarness();
  await app.ensureDictionarySnapshot();
  const previous = getClient().readyGeneration;
  const unknown = app._dictionaryWorkerState.unknownSerial;
  app.dictionary[0].replace = 'first unjournaled update';
  app.markDictionarySnapshotDirty(null, { observed: true });
  assert.ok(app._dictionaryWorkerState.unknownSerial > unknown);
  app.scheduleDictionarySnapshot({ immediate: true });
  for (let i = 0; i < 100 && getClient().readyGeneration === previous; i++) {
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.ok(getClient().readyGeneration > previous);
  assert.equal(getClient().snapshot.entries[0].replace, 'first unjournaled update');
  dispose();
});

test('explicit mutation callback keeps persistence active without duplicate observer notifications', () => {
  const { app, dispose } = uiHarness();
  const mutations = [];
  app.dictionaryMutationObserved = (id, options) => mutations.push({ id, options });
  app.ensureDictionaryWorker();
  app.markDictionarySnapshotDirty('fire');
  app.markDictionarySnapshotDirty(null, { observed: true });
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].id, 'fire');
  app.markDictionarySnapshotDirty(null, { replace: true });
  assert.equal(mutations.length, 2);
  assert.equal(mutations[1].options.replace, true);
  dispose();
});

test('language scope fences immediately but waits for its local dictionary replacement before capture', async () => {
  const { app, getClient, dispose } = uiHarness();
  await app.ensureDictionarySnapshot();
  const priorEpoch = getClient().scopeEpoch;
  let finishSwitch;
  app._cloudLanguageSwitch = new Promise(resolve => { finishSwitch = resolve; });
  app.lang = 'German';
  app.ensureDictionaryWorker();
  const prepared = app.ensureDictionarySnapshot();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.notEqual(getClient().scopeEpoch, priorEpoch);
  assert.equal(getClient().readyGeneration, 0, 'Old Thai rows must not publish under German scope.');
  app.dictionary = [{ _id: 'german', find: 'Fire', replace: 'Feuer', alts: [] }];
  app.markDictionarySnapshotDirty(null, { replace: true });
  finishSwitch(true);
  await prepared;
  assert.equal(getClient().snapshot.entries[0]._id, 'german');
  assert.equal(getClient().snapshot.entries[0].replace, 'Feuer');
  dispose();
});

test('no Dictionary snapshot starts before both game and language are selected', async () => {
  const { app, getClient, dispose } = uiHarness();
  app.gameVersion = '';
  app.lang = '';
  app.ensureDictionaryWorker();
  app.markDictionarySnapshotDirty('fire');
  app.scheduleDictionarySnapshot({ immediate: true });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(getClient().readyGeneration, 0);
  assert.equal(getClient().snapshot, undefined);
  await assert.rejects(app.ensureDictionarySnapshot(), { name: 'AbortError' });
  app.lang = 'Thai';
  app.ensureDictionaryWorker();
  app.scheduleDictionarySnapshot({ immediate: true });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(getClient().readyGeneration, 0, 'Language alone must not start the All-only index.');
  await assert.rejects(app.ensureDictionarySnapshot(), { name: 'AbortError' });
  app.gameVersion = 'poe1';
  app.ensureDictionaryWorker();
  await app.ensureDictionarySnapshot();
  assert.ok(getClient().readyGeneration > 0);
  assert.equal(getClient().snapshot.game, 'poe1');
  assert.equal(getClient().snapshot.entries[0]._id, 'fire');
  dispose();
});

test('worker transport batches normal entries and fragments huge strings and alternative lists', async () => {
  const engine = require('../public/dictionaryMatching.js');
  let worker;
  class BridgeWorker {
    constructor() {
      worker = this;
      this.messages = [];
      this.runtime = engine.createRuntime({ postMessage: message => {
        setTimeout(() => this.onmessage?.({ data: structuredClone(message) }), 0);
      } });
      setTimeout(() => this.onmessage?.({ data: { type: 'started', version: 1 } }), 0);
    }
    postMessage(message) { this.messages.push(message); this.runtime.handleMessage(structuredClone(message)); }
    terminate() { this.runtime.dispose(); }
  }
  const client = create({ Worker: BridgeWorker, engine });
  client.setScope('Thai/poe1');
  const huge = { _id: 'huge', find: 'Fire', replace: 'replacement'.repeat(10000),
    tlnote: 'n'.repeat(80000), gameScope: 'poe1',
    alts: Array.from({ length: 300 }, (_, i) => ({ _id: 'a' + i, find: 'Alternate ' + i, replace: 'r' })) };
  huge.alts[140] = { _id: 'a140', find: 'Burning', replace: 'x'.repeat(70000) };
  client.submitSnapshot({ generation: 1, game: 'poe1', entries: [huge,
    ...Array.from({ length: 300 }, (_, i) => ({ _id: 'small' + i, find: 'Term ' + i, replace: 't', alts: [] }))] });
  try {
    await client.waitReady();
    const result = await client.match([{ key: 'fire', english: 'Fire' }]);
    const received = result.entriesById.huge;
    assert.equal(received.replace, huge.replace);
    assert.equal(received.tlnote, huge.tlnote);
    assert.equal(received.alts.length, 300);
    assert.deepEqual(received.alts[140], huge.alts[140]);
    assert.equal(received.gameScope, 'poe1');
    assert.equal(worker.messages.filter(m => m.type === 'commitSnapshot').length, 1);
    assert.ok(worker.messages.some(m => m.type === 'appendAlternates'));
    assert.ok(worker.messages.filter(m => m.type === 'appendText').every(m => m.text.length <= 32768));
    assert.ok(worker.messages.filter(m => m.type === 'appendEntries').every(m => m.entries.length <= 128));
    assert.ok(client.transferMs >= client.serializationMs);
  } finally { client.dispose(); }
});

test('preparation failures are actionable and successful publication clears only owned UI errors', () => {
  const { app, getClient, dispose } = uiHarness();
  app.ensureDictionaryWorker();
  getClient().fail(new Error('fallback failed'));
  assert.match(app.cloudStorageError, /Could not prepare Dictionary matches: fallback failed/);
  assert.match(app.editorLoadError, /fallback failed/);
  app.editorLoadError = 'unrelated editor problem';
  app.dictionarySnapshotPublished(1);
  assert.equal(app.cloudStorageError, '');
  assert.equal(app.editorLoadError, 'unrelated editor problem');
  app.cloudStorageError = 'unrelated storage problem';
  getClient().fail(new Error('another fallback failed'));
  assert.equal(app.cloudStorageError, 'unrelated storage problem');
  app.dictionarySnapshotPublished(2);
  assert.equal(app.cloudStorageError, 'unrelated storage problem');
  assert.equal(app.editorLoadError, '');
  dispose();
});

test('background preparation failure retains a valid assistance pack and keeps translation editing available', () => {
  const { app, getClient, dispose } = uiHarness();
  const pack = { generation: 1, entriesById: { fire: snapshot(1).entries[0] }, byEnglish: new Map() };
  app.editorLoadError = '';
  app.editorDictionaryMatchPack = pack;
  app.getEditorDictionaryMatchPack = () => app.editorDictionaryMatchPack;
  app.ensureDictionaryWorker();
  getClient().fail(new Error('background worker and fallback failed'));
  assert.equal(app.editorLoadError, '', 'An available snapshot must keep translation fields editable.');
  assert.equal(app.editorDictionaryMatchPack, pack);
  assert.match(app.cloudStorageError, /background worker and fallback failed/);
  assert.match(app.dictionaryWorkerError, /background worker and fallback failed/);
  app.dictionarySnapshotPublished(2);
  assert.equal(app.cloudStorageError, '');
  assert.equal(app.dictionaryWorkerError, '');
  assert.equal(app.editorDictionaryMatchPack, pack);
  app.editorLoadError = 'unrelated draft failure';
  app.cloudStorageError = 'unrelated storage failure';
  getClient().fail(new Error('another background preparation failure'));
  assert.equal(app.editorLoadError, 'unrelated draft failure');
  assert.equal(app.cloudStorageError, 'unrelated storage failure');
  app.dictionarySnapshotPublished(3);
  assert.equal(app.editorLoadError, 'unrelated draft failure');
  assert.equal(app.cloudStorageError, 'unrelated storage failure');
  dispose();
});

test('explicit preparation retry retains assistance and owned warnings until a newer publication', async () => {
  const { app, getClient, dispose } = uiHarness();
  await app.ensureDictionarySnapshot();
  const client = getClient(), epoch = client.scopeEpoch;
  const pack = { generation: client.readyGeneration, entriesById: {}, byEnglish: new Map() };
  app.editorDictionaryMatchPack = pack;
  app.getEditorDictionaryMatchPack = () => pack;
  app.editorLoadError = '';
  let mutations = 0;
  app.dictionaryMutationObserved = () => { mutations++; };
  client.fail(new Error('retry preparation warning'));
  const warning = app.cloudStorageError;
  const owns = require('../public/dictionaryWorkerUi.js').mixin.computed.dictionaryPreparationOwnsStorageError;
  assert.equal(owns.call(app), true);
  client.pausePublication = true;
  const retry = app.retryDictionaryPreparation();
  assert.equal(app.dictionaryPreparationRetrying, true);
  assert.equal(await app.retryDictionaryPreparation(), false, 'A pending explicit retry cannot start a duplicate capture.');
  for (let i = 0; i < 100 && !client.pendingSnapshot; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(client.pendingSnapshot.generation > pack.generation);
  assert.equal(client.scopeEpoch, epoch);
  assert.equal(app.cloudStorageError, warning);
  assert.equal(app.dictionaryWorkerError, 'retry preparation warning');
  assert.equal(app.editorDictionaryMatchPack, pack);
  assert.equal(app.editorLoadError, '');
  assert.equal(mutations, 0, 'Retry does not save settings or invalidate completed diagnostics.');
  client.publish();
  assert.equal(await retry, true);
  assert.equal(app.dictionaryPreparationRetrying, false);
  assert.equal(app.cloudStorageError, '');
  assert.equal(app.dictionaryWorkerError, '');
  assert.equal(owns.call(app), false);
  assert.equal(app.editorDictionaryMatchPack, pack);
  dispose();
});

test('scope switch cancels partial transport before an old snapshot can commit', async () => {
  const { client, workers, flush } = harness();
  const oldEpoch = client.setScope('Thai');
  const oldSnapshot = snapshot(1);
  oldSnapshot.entries[0].tlnote = 'old'.repeat(200000);
  client.submitSnapshot(oldSnapshot);
  assert.ok(workers[0].messages.some(m => m.type === 'beginSnapshot'));
  assert.ok(!workers[0].messages.some(m => m.type === 'commitSnapshot'));
  const waiting = client.waitReady();
  const rejected = assert.rejects(waiting, { name: 'AbortError' });
  const nextEpoch = client.setScope('German');
  client.submitSnapshot(snapshot(2));
  flush();
  assert.ok(!workers[0].messages.some(m => m.type === 'commitSnapshot' && m.scopeEpoch === oldEpoch));
  assert.equal(workers[0].messages.findLast(m => m.type === 'commitSnapshot').scopeEpoch, nextEpoch);
  workers[0].emit({ type: 'ready', scopeEpoch: nextEpoch, generation: 2 });
  assert.equal((await client.waitReady()).generation, 2);
  await rejected;
  client.dispose();
});
