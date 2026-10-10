const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const location = { hash: '', hostname: '127.0.0.1', search: '', pathname: '/', origin: 'http://127.0.0.1' };
  const window = { OfflineStore: {}, CloudSync: {}, fetch() {}, addEventListener() {} };
  const context = vm.createContext({ window, location, navigator: {}, URL, URLSearchParams,
    Vue: { toRaw: value => value },
    sessionStorage: { getItem() { return null; } }, history: { replaceState() {} },
    document: { hidden: false, addEventListener() {} }, setInterval() { return 1; },
    setTimeout, clearTimeout, clearInterval });
  for (const name of ['cloudUi.js', 'collaborationIntegration.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', name), 'utf8'), context, { filename: name });
  }
  const editor = Object.assign({}, window.CloudUI.mixin.data(), window.CollaborationIntegration.mixin.data(),
    window.CloudUI.mixin.methods, window.CollaborationIntegration.mixin.methods, {
      testMode: false, lang: 'Thai', gameVersion: 'poe1', $nextTick: async () => {},
      cloudPayload: () => ({ lang: 'Thai' }), cloudApply: async () => {}, finishStartup: async () => {},
    });
  const phases = [], background = new Map();
  editor.queueWorkspaceBackground = (key, callback) => { background.set(key, callback); return true; };
  editor.beginWorkspaceInitializationTask = label => {
    if (!editor.initializing) return null;
    const task = { label }; phases.push(task); return task;
  };
  editor.finishWorkspaceInitializationTask = (task, result = {}) => { if (task) task.result = result; };
  editor.updateWorkspaceInitializationTaskProgress = (task, progress) => { if (task) (task.progress ||= []).push(progress); };
  editor.runWorkspaceInitializationTask = async (label, callback) => {
    const task = editor.beginWorkspaceInitializationTask(label);
    try { const value = await callback(progress => editor.updateWorkspaceInitializationTaskProgress(task, progress)); editor.finishWorkspaceInitializationTask(task); return value; }
    catch (error) { editor.finishWorkspaceInitializationTask(task, { error }); throw error; }
  };
  return { editor, window, phases, background };
}

test('initial cloud startup reports local restoration before remote access and keeps local UI available on cloud failure', async () => {
  const { editor, window, phases, background } = harness();
  editor.initializing = true;
  let localVisible = false;
  editor.finishStartup = async () => { localVisible = true; };
  window.CloudSync.Client = class {
    constructor(options) { this.options = options; }
    async initialize() {}
    snapshot() { return {}; }
    async refreshSession() {
      assert.equal(localVisible, true, 'The terminal and restored local state can render before remote authentication.');
      this.options.onStatus({ message: 'Cloud unavailable', error: true });
    }
  };
  await editor.initializeCloud();
  assert.deepEqual(phases.map(task => task.label), [
    'Restoring local profile, settings and Dictionary',
    'Applying local settings and restoring editor drafts',
  ]);
  assert.equal(editor.cloudError, false, 'A network check is not required before local startup finishes.');
  await background.get('cloud-session')();
  assert.equal(editor.cloudError, true); assert.equal(editor._cloudInitializing, false);
  editor.initializing = false;
  await editor._cloud.refreshSession(true);
  assert.equal(phases.length, 2, 'Remote session requests do not append local initialization work.');
});

test('slow session checks and obsolete queued checks cannot hold or change local initialization', async () => {
  const { editor, window, background } = harness();
  let resolve, requested = 0;
  const response = new Promise(done => { resolve = done; });
  window.CloudSync.Client = class {
    async initialize() {}
    snapshot() { return {}; }
    async refreshSession() { requested++; await response; }
  };
  await editor.initializeCloud();
  assert.equal(requested, 0);
  const start = background.get('cloud-session');
  const pending = start();
  assert.equal(requested, 1);
  assert.equal(editor._cloudInitializing, false);
  resolve(); await pending;
  editor._cloud = {};
  await start();
  assert.equal(requested, 1, 'A replaced local account client cannot start an old session request.');
});

test('source ZIP hashing and accepted baseline checks report their phases only during workspace initialization', async () => {
  const { editor, window, phases } = harness();
  editor.initializing = true;
  window.CollaborationProtocol = {
    zipHash: async () => 'zip-hash',
    buildBaselineTree: async (source, provider, options) => {
      assert.equal(provider, undefined, 'Initialization passes options separately from the crypto provider.');
      options.onProgress?.({ completed: 0, total: 3, unit: 'items' });
      options.onProgress?.({ completed: 3, total: 3, unit: 'items' });
      return { root: 'tree-root' };
    },
    finalizeArchive: async descriptor => descriptor,
  };
  editor.sourceWithImportDecisions = async source => source;
  const file = { size: 12, arrayBuffer: async () => new ArrayBuffer(12) };
  const identity = await editor.readImportZipIdentity(file, { files: { 'source.txt': { dir: false } } });
  await editor.buildImportedBaseline(identity, [{ filepath: 'source.txt' }]);
  assert.deepEqual(phases.map(task => task.label), [
    'Verifying original ZIP identity',
    'Applying agreed language choices',
    'Building original source baseline proofs',
    'Verifying accepted source baseline identity',
  ]);
  assert.ok(phases.every(task => task.result && !task.result.error));
  assert.deepEqual(phases[2].progress, [
    { completed: 0, total: 3, unit: 'items' },
    { completed: 3, total: 3, unit: 'items' },
  ]);
  editor.initializing = false;
  await editor.buildImportedBaseline(identity, [{ filepath: 'source.txt' }]);
  assert.equal(phases.length, 4, 'Ordinary work outside initialization leaves the terminal history unchanged.');
});

test('a baseline builder superseded during language decisions cannot append proof work to the replacement activity', async () => {
  const { editor, window } = harness();
  const initialization = require('../public/workspaceInitialization.js').mixin;
  Object.assign(editor, initialization.data(), initialization.methods);
  let releaseDecisions;
  const decisions = new Promise(resolve => { releaseDecisions = resolve; });
  editor.sourceWithImportDecisions = () => decisions;
  window.CollaborationProtocol = {
    buildBaselineTree: async () => ({ root: 'tree-root' }),
    finalizeArchive: async descriptor => descriptor,
  };
  editor.beginWorkspaceInitialization({ label: 'Importing previous source' });
  const building = editor.buildImportedBaseline({ zipHash: 'zip-hash' }, [{ filepath: 'previous.txt' }]);
  const replacement = editor.beginWorkspaceInitialization({ label: 'Opening replacement source', force: true });
  editor.beginWorkspaceInitializationTask('Loading replacement translations', replacement);
  try {
    releaseDecisions([{ filepath: 'previous.txt' }]); await building;
    assert.equal(editor.workspaceInitializationRows.length, 1);
    assert.equal(editor.workspaceInitializationRows[0].label, 'Loading replacement translations');
    assert.equal(editor.workspaceInitializationRows[0].status, 'running');
    assert.equal(editor.workspaceInitializationActive, true);
    assert.equal(editor._workspaceInitializationRun, replacement.run);
  } finally { editor.disposeWorkspaceInitialization(); }
});

test('cached collaboration progress combines file preparation and source verification with scope guards', async () => {
  const { editor, window, phases } = harness();
  Object.assign(editor, { initializing: true, offlineStoreReady: true, sourceLoaded: true, sourceIdentity: 'source-one',
    cloudSignedIn: true, cloudUser: { id: 'translator', role: 'translator', language: 'Thai', assignmentVersion: 1 },
    descs: Array.from({ length: 65 }, (_, index) => ({ filepath: `${index}.txt`, translations: { Thai: ['local'] } })),
    localDescs: { descs: [], status: {} }, _cloud: { apiBase: 'http://api.test', context: () => ({}), request() {} },
  });
  let report;
  window.CollaborationSync = { Client: class {
    async connect({ source, onProgress }) {
      report = onProgress;
      const total = source.length * 7 + 3;
      report({ completed: 0, total, unit: 'items' });
      report({ completed: total, total, unit: 'items' });
    }
    select() {} disconnect() {}
  } };
  await editor.initializeCollaboration();
  const task = phases[0], total = editor.descs.length * 8 + 3;
  assert.equal(task.label, 'Preparing cached shared translations');
  assert.deepEqual(task.progress.map(progress => progress.completed), [0, 64, 65, 65, total]);
  assert.ok(task.progress.every(progress => progress.total === total && progress.unit === 'items'));
  const reports = task.progress.length;
  editor.lang = 'German';
  report({ completed: 100, total: 100, unit: 'items' });
  assert.equal(task.progress.length, reports, 'Late callbacks cannot publish into another selected language.');
  editor.initializing = false;
  await editor.initializeCollaboration();
  assert.equal(phases.length, 1, 'Ordinary background collaboration cannot append initialization rows.');
});
