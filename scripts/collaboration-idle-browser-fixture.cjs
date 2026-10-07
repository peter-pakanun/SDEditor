// Disposable loopback-only fixture for real IndexedDB placeholder-repair costs.
// It does not load the editor, contact the API, or read any production profile.
const express = require('express');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

function browserFixture(settings) {
  'use strict';
  const P = window.CollaborationProtocol, W = window.WorkspaceState, store = window.OfflineStore;
  const report = document.getElementById('report'), status = document.getElementById('status');
  const controls = [...document.querySelectorAll('button[data-case]')];
  const results = [];
  let measurement = null;
  const identity = { accountId: 'fixture-idle', game: 'poe1', language: 'Thai', sourceHash: 'a'.repeat(64) };
  const key = P.scopeKey(identity);
  const copy = value => structuredClone(value);
  const instrument = (owner, name, metric) => {
    const original = owner[name];
    owner[name] = function (...args) {
      if (measurement) measurement[metric]++;
      return original.apply(this, args);
    };
  };
  instrument(store, 'getCollaborationState', 'getCollaborationStateCalls');
  instrument(store, 'updateCollaborationState', 'updateCollaborationStateCalls');
  const nativeGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (recordKey) {
    if (measurement && this.name === 'kv' && recordKey === 'collaboration_v1') measurement.idbCollaborationGets++;
    return nativeGet.call(this, recordKey);
  };
  const nativePut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const start = performance.now(), observed = measurement;
    try { return nativePut.apply(this, args); }
    finally {
      if (observed) {
        const elapsed = performance.now() - start;
        observed.idbPuts++;
        observed.putSynchronousMs += elapsed;
        observed.maxPutSynchronousMs = Math.max(observed.maxPutSynchronousMs, elapsed);
        if (this.name === 'kv' && args[0]?.key === 'collaboration_v1') observed.idbCollaborationPuts++;
        if (this.name === 'kv' && args[0]?.key === 'workspace_poe1') observed.idbWorkspacePuts++;
      }
    }
  };
  let longTaskSupported = false;
  if (window.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
    longTaskSupported = true;
    new PerformanceObserver(list => {
      if (!measurement) return;
      for (const entry of list.getEntries()) {
        measurement.longTasks++;
        measurement.longTaskMs += entry.duration;
        measurement.maxLongTaskMs = Math.max(measurement.maxLongTaskMs, entry.duration);
      }
    }).observe({ type: 'longtask', buffered: false });
  }
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now(), delay = Math.max(0, now - lastTick - 16);
    lastTick = now;
    if (measurement) {
      measurement.heartbeatTicks++;
      measurement.maxHeartbeatDelayMs = Math.max(measurement.maxHeartbeatDelayMs, delay);
      if (delay > 50) measurement.heartbeatDelaysOver50Ms++;
    }
  }, 16);
  const textHash = value => JSON.stringify(value);
  async function seed(mode, Client) {
    const source = [], baselineStates = {}, shared = {}, local = {}, outbox = [], placeholderRepairs = [];
    const workspace = { descs: [], status: {}, sourceHash: identity.sourceHash, collaborationAccountId: identity.accountId,
      game: identity.game, stagedVersion: 1, staged: { Thai: {} }, placeholderRepairVersion: 1, placeholderRepairArchive: {} };
    const filler = 'untouched translation '.repeat(Math.ceil(settings.payloadChars / 22)).slice(0, settings.payloadChars);
    for (let index = 0; index < settings.files; index++) {
      const filepath = 'cache/untouched_' + index + '.txt';
      const file = P.fileState({ filepath, translations: Array.from({ length: settings.entries }, (_, line) => filler + ' ' + index + ':' + line),
        trackedForExport: true, revision: 1 });
      shared[filepath] = file;
      local[filepath] = copy(file);
    }
    for (let index = 0; index < settings.repairs; index++) {
      const filepath = 'repair/blank_' + index + '.txt', id = 'fixture-repair-' + index;
      const desc = { filepath, name: '', stats: ['fixture_blank_' + index], variables: ['#'], remarks: [''],
        translations: { English: ['English baseline ' + index] } };
      const baseline = P.fileState({ filepath, translations: [''], trackedForExport: false, revision: 0 });
      const stage = { sourceHash: identity.sourceHash, translations: [''], before: [], saveOrigin: 'legacy_inferred' };
      source.push(desc); workspace.descs.push(copy(desc)); baselineStates[filepath] = baseline;
      workspace.staged.Thai[filepath] = copy(stage);
      workspace.placeholderRepairArchive[id] = { id, filepath, language: 'Thai', sourceHash: identity.sourceHash,
        status: 'pending', staged: copy(stage) };
      local[filepath] = { ...copy(baseline), trackedForExport: true };
      placeholderRepairs.push({ id, filepath, baseRevision: 0 });
      if (mode === 'blocked') outbox.push({ id: 'fixture-save-' + index, kind: 'save', origin: 'save',
        files: [{ base: copy(baseline), yours: { ...copy(baseline), trackedForExport: true } }] });
    }
    const room = { identity: copy(identity), mode: 'sparse', roomId: 'fixture-room', initialized: true, shared, local,
      outbox, placeholderRepairs, conflicts: [], recovery: [], sequence: 0 };
    const state = { version: 1, rooms: { [key]: room } };
    const stateBytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
    await store.saveSourceWorkspaceWithRevisions(source, workspace, [], identity.game);
    await store.updateCollaborationState(() => state, { version: identity.game });
    const client = new Client({ store, WebSocket: null, locks: null, request: async () => {
      throw new Error('This local-only fixture must never request a server.');
    }, onRemote: files => {
      if (measurement) { measurement.remoteCallbacks++; measurement.remoteFiles += files.length; }
    } });
    client.epoch = 1; client.key = key; client.state = await store.getCollaborationState();
    client.connected = true; client.source = source;
    client.sourceFiles = new Map(P.manifest(source).files.map(file => [file.filepath, file]));
    client.baselineFiles = new Map(source.map(desc => [desc.filepath, desc]));
    client.baselineStates = baselineStates;
    const originalRebuild = client.rebuild;
    client.rebuild = function (...args) {
      if (measurement) measurement.rebuildCalls++;
      return originalRebuild.apply(this, args);
    };
    return { client, source, stateBytes, outboxBefore: textHash(outbox), untouchedBefore: textHash(shared) };
  }
  function formatResults() {
    report.textContent = results.map(result => JSON.stringify(result, null, 2)).join('\n\n');
    window.__collaborationIdleResults = copy(results);
  }
  async function runCase(implementation, mode) {
    const Client = (implementation === 'baseline' ? window.CollabIdleBaseline : window.CollabIdleCurrent)?.Client;
    if (!Client) throw new Error('Start the fixture with --baseline PATH to compare the saved original source.');
    status.textContent = 'Seeding real IndexedDB: ' + implementation + ' / ' + mode + '…';
    const seeded = await seed(mode, Client);
    await new Promise(resolve => setTimeout(resolve, 100));
    const counters = { implementation, scenario: mode, files: settings.files, repairs: settings.repairs,
      passes: mode === 'blocked' ? settings.passes : 1, stateBytes: seeded.stateBytes,
      getCollaborationStateCalls: 0, updateCollaborationStateCalls: 0, idbCollaborationGets: 0,
      idbPuts: 0, idbCollaborationPuts: 0, idbWorkspacePuts: 0, putSynchronousMs: 0, maxPutSynchronousMs: 0,
      rebuildCalls: 0, remoteCallbacks: 0, remoteFiles: 0, heartbeatTicks: 0, maxHeartbeatDelayMs: 0,
      heartbeatDelaysOver50Ms: 0, longTaskSupported, longTasks: 0, longTaskMs: 0, maxLongTaskMs: 0 };
    status.textContent = 'Measuring ' + implementation + ' / ' + mode + ' (' + counters.passes + ' pass)…';
    await new Promise(resolve => requestAnimationFrame(resolve));
    lastTick = performance.now(); measurement = counters;
    const start = performance.now();
    try {
      for (let pass = 0; pass < counters.passes; pass++) await seeded.client.flushPlaceholderRepairs(seeded.client.epoch);
      counters.totalMs = performance.now() - start;
      // Allow the heartbeat/long-task observer to deliver the final blocked interval.
      await new Promise(resolve => setTimeout(resolve, 35));
    } finally { measurement = null; }
    const durable = await store.getCollaborationState(), workspace = await store.getWorkspace(identity.game, identity.language);
    const room = durable.rooms[key];
    counters.remainingRepairs = room.placeholderRepairs.length;
    counters.remainingOutbox = room.outbox.length;
    counters.archiveLocal = Object.values(workspace.placeholderRepairArchive).filter(row => row.status === 'local').length;
    counters.stagedRemaining = Object.keys(workspace.staged.Thai || {}).length;
    counters.untouchedCachePreserved = textHash(room.shared) === seeded.untouchedBefore;
    counters.outboxPreserved = textHash(room.outbox) === seeded.outboxBefore;
    counters.correct = counters.untouchedCachePreserved && counters.outboxPreserved && (mode === 'blocked'
      ? counters.remainingRepairs === settings.repairs && counters.archiveLocal === 0 && counters.stagedRemaining === settings.repairs
      : counters.remainingRepairs === 0 && counters.archiveLocal === settings.repairs && counters.stagedRemaining === 0);
    for (const name of ['totalMs', 'putSynchronousMs', 'maxPutSynchronousMs', 'maxHeartbeatDelayMs', 'longTaskMs', 'maxLongTaskMs']) {
      counters[name] = Number(counters[name].toFixed(1));
    }
    seeded.client.destroy(); results.push(counters); formatResults();
    status.textContent = (counters.correct ? 'PASS' : 'FAIL') + ' · ' + implementation + ' / ' + mode + ' · '
      + counters.totalMs + ' ms · collaboration puts ' + counters.idbCollaborationPuts + ' · remaining repairs ' + counters.remainingRepairs;
    return counters;
  }
  async function run(implementation, mode) {
    controls.forEach(button => { button.disabled = true; });
    try { return await runCase(implementation, mode); }
    catch (error) { status.textContent = 'FAIL · ' + error.message; throw error; }
    finally { controls.forEach(button => { button.disabled = button.dataset.case.startsWith('baseline') && !settings.hasBaseline; }); }
  }
  window.__collaborationIdleFixture = { settings, run, results };
  for (const button of controls) {
    button.disabled = button.dataset.case.startsWith('baseline') && !settings.hasBaseline;
    button.onclick = () => run(...button.dataset.case.split(':')).catch(error => console.error(error));
  }
  document.getElementById('settings').textContent = settings.files.toLocaleString() + ' untouched shared/local files · '
    + settings.repairs + ' pending repairs · ' + settings.entries + ' lines per untouched file · ' + settings.payloadChars + ' text chars per line · '
    + settings.passes + ' blocked passes. All data stays on this disposable loopback origin.';
  status.textContent = 'Ready. Each button reseeds only this fixture origin before measuring real IndexedDB reads and writes.';
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/collaboration-idle-browser-fixture.cjs [--port 3340] [--files 5000] [--repairs 20] [--entries 2] [--payload-chars 80] [--passes 1] [--baseline PATH]');
  console.log('Stress example: --files 20000 --repairs 100. Baseline runs may take several minutes.');
  process.exit(0);
}
function argument(name) {
  const index = args.indexOf('--' + name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Missing value for --' + name);
  return args[index + 1];
}
function bounded(name, fallback, maximum) {
  const value = Number(argument(name) ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('Invalid --' + name + ' (1–' + maximum + ').');
  return value;
}
const baseline = argument('baseline');
const settings = { files: bounded('files', 5000, 50000), repairs: bounded('repairs', 20, 1000),
  entries: bounded('entries', 2, 100), payloadChars: bounded('payload-chars', 80, 10000),
  passes: bounded('passes', 1, 20), hasBaseline: !!baseline };
const port = bounded('port', 3340, 65535);
const publicRoot = resolve(__dirname, '../public');
const app = express();
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
for (const name of ['workspaceState.js', 'offlineStore.js', 'collaborationProtocol.js', 'collaborationSync.js']) {
  app.get('/' + name, (req, res) => res.type('js').send(readFileSync(resolve(publicRoot, name), 'utf8')));
}
if (baseline) {
  const baselineSource = readFileSync(resolve(baseline), 'utf8');
  app.get('/baseline.js', (req, res) => res.type('js').send(baselineSource));
}
app.get('/', (req, res) => res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Collaboration idle IndexedDB fixture</title>
<style>body{max-width:1100px;margin:28px auto;padding:0 20px;background:#18212b;color:#e8edf2;font:16px system-ui}button{padding:10px 16px;margin:4px;border:1px solid #8cabba;border-radius:5px;background:#304554;color:inherit}button:hover{background:#48718c}button:disabled{opacity:.45}pre{padding:18px;background:#101820;border-radius:6px;white-space:pre-wrap;font:13px monospace}p{line-height:1.5}#status{padding:14px;background:#253643}h1{font-size:24px}</style></head><body>
<h1>Collaboration idle · real IndexedDB</h1><p id="settings"></p><p>This isolated fixture loads the actual storage and collaboration modules. Blocked repairs stay queued behind deliberate local saves. Local repairs resolve together with their workspace archive. The measured put durations include the browser’s synchronous structured clone.</p>
<div><button data-case="current:blocked">Current blocked</button><button data-case="current:local">Current local</button><button data-case="baseline:blocked">Baseline blocked</button><button data-case="baseline:local">Baseline local</button></div>
<p id="status" role="status">Loading…</p><pre id="report" aria-label="Fixture results">No measurements yet.</pre>
<script src="/workspaceState.js"></script><script src="/offlineStore.js"></script><script src="/collaborationProtocol.js"></script>
${baseline ? '<script src="/baseline.js"></script><script>window.CollabIdleBaseline=window.CollaborationSync;</script>' : ''}
<script src="/collaborationSync.js"></script><script>window.CollabIdleCurrent=window.CollaborationSync;</script>
<script>(${browserFixture.toString()})(${JSON.stringify(settings)});</script></body></html>`));
const server = app.listen(port, '127.0.0.1', () => console.log('Disposable real-IndexedDB fixture: http://127.0.0.1:' + port));
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
