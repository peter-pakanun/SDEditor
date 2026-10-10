const assert = require('node:assert/strict');
const { test } = require('node:test');
const { create, transferPackets } = require('../public/tmWorkerClient.js');
const TM = require('../public/translationMemory.js');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const snapshot = generation => ({ generation, game: 'poe1', units: [
  { id: 'a', source: 'Deals {0}% damage', target: 'สร้าง {0}% ความเสียหาย ' + generation, gameScope: 'poe1' },
] });

function harness({ unavailable = false, handshake = true } = {}) {
  const workers = [], runtimes = [], timers = [], publications = [], failures = [];
  class Worker {
    constructor() { this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    emit(message) { this.onmessage?.({ data: message }); }
    terminate() { this.terminated = true; }
  }
  const engine = { createRuntime({ postMessage }) {
    const runtime = { messages: [], handleMessage(message) { this.messages.push(message); },
      reply(message) { postMessage(message); },
      ready(generation, scopeEpoch) { postMessage({ type: 'ready', generation, scopeEpoch }); }, dispose() {} };
    runtimes.push(runtime); return runtime;
  } };
  const client = create({ Worker: unavailable ? null : Worker, engine,
    setTimeout(callback) { const timer = () => { if (!timer.cancelled) callback(); }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cancelled = true; }, onReady: message => publications.push(message.generation),
    onError: error => failures.push(error) });
  if (!unavailable && handshake) workers[0].emit({ type: 'started', version: 1 });
  const flush = () => { while (timers.length) timers.shift()(); };
  return { client, workers, runtimes, timers, publications, failures, flush };
}

test('worker client publishes completed generations, coalesces pending inputs and accepts pinned older replies', async () => {
  const { client, workers, publications, flush } = harness();
  const epoch = client.setScope('account/Thai/poe1'), worker = workers[0];
  client.submitSnapshot(snapshot(1)); client.submitSnapshot(snapshot(2)); client.submitSnapshot(snapshot(3)); flush();
  assert.deepEqual(worker.messages.filter(message => message.type === 'commitSnapshot').map(message => message.generation), [1]);
  const initial = client.waitReady(); worker.emit({ type: 'ready', scopeEpoch: epoch, generation: 1 }); await initial; flush();
  assert.deepEqual(worker.messages.filter(message => message.type === 'commitSnapshot').map(message => message.generation), [1, 3]);
  const query = client.query({ source: 'Deals {0}% damage' }), request = worker.messages.findLast(message => message.type === 'query');
  worker.emit({ type: 'ready', scopeEpoch: epoch, generation: 3 });
  worker.emit({ type: 'matches', scopeEpoch: epoch, requestId: request.requestId, generation: 1, matches: [{ id: 'old' }] });
  assert.equal((await query).generation, 1); assert.deepEqual(publications, [1, 3]); client.dispose();
});

test('scope switches reject old readiness and query work and ignore late publications', async () => {
  const { client, workers } = harness();
  const epoch = client.setScope('Thai'); client.submitSnapshot(snapshot(1));
  const ready = client.waitReady(), query = client.query({ source: 'damage' });
  const rejected = Promise.all([assert.rejects(ready, { name: 'AbortError' }), assert.rejects(query, { name: 'AbortError' })]);
  const next = client.setScope('German'); workers[0].emit({ type: 'ready', scopeEpoch: epoch, generation: 1 });
  assert.notEqual(next, epoch); assert.equal(client.readyGeneration, 0); await rejected; client.dispose();
});

test('query cancellation rejects immediately and sends scoped cancellation', async () => {
  const { client, workers } = harness(); const epoch = client.setScope('Thai');
  client.submitSnapshot(snapshot(1)); workers[0].emit({ type: 'ready', scopeEpoch: epoch, generation: 1 });
  const request = client.query({ source: 'damage' }), rejected = assert.rejects(request, { name: 'AbortError' });
  request.cancel(); await rejected;
  assert.ok(workers[0].messages.some(message => message.type === 'cancel' && message.scopeEpoch === epoch)); client.dispose();
});

test('worker failure restores published snapshot in cooperative fallback and replays queries before latest replacement', async () => {
  const { client, workers, runtimes, publications, failures } = harness(); const epoch = client.setScope('Thai');
  client.submitSnapshot(snapshot(1)); workers[0].emit({ type: 'ready', scopeEpoch: epoch, generation: 1 });
  const query = client.query({ source: 'damage' }); client.submitSnapshot(snapshot(2));
  workers[0].onerror({ preventDefault() {} });
  assert.equal(client.fallback, true); assert.equal(workers[0].terminated, true);
  assert.equal(runtimes[0].messages.find(message => message.type === 'setSnapshot').generation, 1);
  runtimes[0].ready(1, epoch);
  const request = runtimes[0].messages.find(message => message.type === 'query');
  assert.ok(request); assert.equal(runtimes[0].messages.findLast(message => message.type === 'setSnapshot').generation, 2);
  runtimes[0].reply({ type: 'matches', scopeEpoch: epoch, generation: 1, requestId: request.requestId, matches: [] });
  assert.equal((await query).generation, 1); assert.deepEqual(publications, [1]); assert.deepEqual(failures, []); client.dispose();
});

test('startup timeout falls back silently, while failure of fallback preparation is actionable', async () => {
  const { client, timers, runtimes, failures } = harness({ handshake: false });
  const epoch = client.setScope('Thai'); client.submitSnapshot(snapshot(1)); timers[0]();
  assert.equal(client.fallback, true); assert.deepEqual(failures, []);
  const ready = client.waitReady(), rejected = assert.rejects(ready, /broken fallback/);
  runtimes[0].reply({ type: 'error', scopeEpoch: epoch, generation: 1, error: { message: 'broken fallback' } });
  await rejected; assert.equal(failures.length, 1); client.dispose();
});

test('direct fallback uses the same matching engine and excludes disposed requests', async () => {
  const failures = [], client = create({ Worker: null, onError: error => failures.push(error) });
  client.setScope('Thai'); client.submitSnapshot(snapshot(1)); await client.waitReady();
  const result = await client.query({ source: 'Deals {0}% damage' });
  assert.equal(result.matches[0].score, 100); assert.equal(result.generation, 1); assert.equal(client.fallback, true);
  client.dispose(); await assert.rejects(client.query({ source: 'damage' }), { name: 'AbortError' }); assert.deepEqual(failures, []);
});

test('runtime builds large fragmented rows completely before publication and ignores foreign-scope packets', async () => {
  const messages = [], runtime = TM.createRuntime({ postMessage: message => messages.push(message) });
  runtime.handleMessage({ type: 'setScope', scopeEpoch: 2 });
  const big = 'Deals damage '.repeat(2500);
  const units = [{ id: 'a', source: 'Damage', target: 'first', gameScope: 'poe1' },
    { id: 'b', source: big, target: big, note: 'note'.repeat(1024), gameScope: 'poe1' },
    { id: 'c', source: 'Cold Damage', target: 'last', gameScope: 'poe1' }];
  for (const packet of transferPackets({ scopeEpoch: 2, generation: 1, game: 'poe1', units })) {
    if (packet) runtime.handleMessage(packet);
  }
  runtime.handleMessage({ type: 'appendText', scopeEpoch: 1, generation: 1, unitIndex: 0, field: 'source', text: 'bad' });
  await waitUntil(() => messages.some(message => message.type === 'ready'));
  runtime.handleMessage({ type: 'query', scopeEpoch: 2, requestId: 1, query: { source: big } });
  await waitUntil(() => messages.some(message => message.type === 'matches'));
  const result = messages.find(message => message.type === 'matches');
  assert.equal(result.matches[0].id, 'b'); assert.equal(result.matches[0].unit.note.length, 4096);
  assert.equal(result.matches[0].source, big); runtime.dispose();
});

test('runtime delays a third compiled generation until a pinned retired query releases its index', async () => {
  const messages = [], scheduled = [], settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
  const runtime = TM.createRuntime({ postMessage: message => messages.push(message), schedule: callback => scheduled.push(callback), sliceMs: 0 });
  runtime.handleMessage({ type: 'setScope', scopeEpoch: 1 });
  runtime.handleMessage({ type: 'setSnapshot', scopeEpoch: 1, generation: 1, game: 'poe1', units: Array.from({ length: 80 }, (_, index) => ({
    id: 'unit-' + index, source: 'Damage', target: 'Target ' + index, gameScope: 'poe1', context: { entryIndex: index } })) });
  while (!messages.some(message => message.type === 'ready' && message.generation === 1)) { assert.ok(scheduled.length); scheduled.shift()(); await settle(); }
  runtime.handleMessage({ type: 'query', scopeEpoch: 1, requestId: 1, query: { source: 'Damage' } });
  assert.ok(scheduled.length, 'The source variant query must yield while keeping generation 1 pinned.');
  runtime.handleMessage({ type: 'setSnapshot', scopeEpoch: 1, ...snapshot(2) }); await settle();
  assert.ok(messages.some(message => message.type === 'ready' && message.generation === 2));
  runtime.handleMessage({ type: 'setSnapshot', scopeEpoch: 1, ...snapshot(3) }); await settle();
  assert.equal(messages.some(message => message.type === 'ready' && message.generation === 3), false);
  while (!messages.some(message => message.type === 'ready' && message.generation === 3)) { assert.ok(scheduled.length); scheduled.shift()(); await settle(); }
  assert.equal(messages.find(message => message.type === 'matches' && message.requestId === 1).generation, 1);
  runtime.dispose();
});

test('classic worker entrypoint loads shared protected-tag helpers and posts its handshake', () => {
  const messages = [], sandbox = vm.createContext({ setTimeout, performance, postMessage: message => messages.push(message) });
  sandbox.self = sandbox;
  sandbox.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8'), sandbox, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'tmWorker.js'), 'utf8'), sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'started', version: 1 }]);
  assert.equal(typeof sandbox.extractGGGVarTags, 'function'); assert.equal(typeof sandbox.self.onmessage, 'function');
});

async function waitUntil(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 10000) throw new Error('Runtime test timed out.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
