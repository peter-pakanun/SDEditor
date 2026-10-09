const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const publicDir = path.join(__dirname, '../public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(options = {}) {
  const attributes = new Map();
  for (const match of html.match(/<html\b[^>]*>/i)[0].matchAll(/([\w-]+)(?:\s*=\s*["']([^"']*)["'])?/g)) {
    if (match[1] !== 'html') attributes.set(match[1], match[2] || '');
  }
  const themeChanges = [], writes = [], alerts = [], storage = new Map();
  if (options.cache !== undefined) storage.set('sdeditor-theme', options.cache);
  if (options.legacyRaw !== undefined) storage.set('settings', options.legacyRaw);
  const localStorage = {
    getItem(key) { if (options.denyRead) throw new Error('Storage denied'); return storage.get(key) ?? null; },
    setItem(key, value) { if (options.denyWrite) throw new Error('Storage denied'); storage.set(key, value); writes.push([key, value]); },
  };
  const root = {
    getAttribute(name) { return attributes.get(name) ?? null; },
    hasAttribute(name) { return attributes.has(name); },
    setAttribute(name, value) { attributes.set(name, String(value)); if (name === 'data-theme') themeChanges.push(String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    style: { setProperty() {}, removeProperty() {} },
  };
  const document = { documentElement: root, body: { style: {} }, addEventListener() {}, removeEventListener() {} };
  const location = { search: options.testMode ? '?testMode=1&lang=Thai' : '', hash: '', hostname: '127.0.0.1', pathname: '/', origin: 'http://127.0.0.1:3333' };
  const window = { location, document, localStorage, fetch: async () => { throw new Error('Unexpected network request'); }, addEventListener() {}, setTimeout, clearTimeout, performance };
  let config;
  const context = vm.createContext({ window, document, location, localStorage, navigator: {},
    sessionStorage: { getItem() { return null; } }, history: { replaceState() {} },
    URLSearchParams, URL, console, setTimeout, clearTimeout, setInterval() { return 1; }, clearInterval() {},
    Vue: { defineComponent(value) { config = value; return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; },
      nextTick(callback) { return Promise.resolve().then(callback); }, markRaw(value) { return value; }, toRaw(value) { return value; } },
  });
  const head = html.match(/<head>[\s\S]*?<\/head>/i)[0];
  for (const match of head.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(match[1])) vm.runInContext(match[2], context, { filename: 'startup-bootstrap' });
  }
  for (const name of ['workspaceState.js', 'dictionaryScope.js', 'statDescCodec.js', 'helper.js', 'dictionarySync.js', 'dictionaryMatching.js', 'dictionaryWorkerClient.js', 'dictionaryWorkerUi.js', 'cloudSync.js', 'cloudUi.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(publicDir, name), 'utf8'), context, { filename: name });
    if (name === 'dictionarySync.js') window.DictionarySync = context.DictionarySync;
  }
  const editor = Object.assign({}, ...config.mixins.map(mixin => mixin.data?.() || {}), config.data(),
    ...config.mixins.map(mixin => mixin.methods || {}), config.methods, {
      $nextTick(callback) { return Promise.resolve().then(callback); }, $refs: {},
      ensureDictionaryIds() {}, updateDocumentTitle() {}, checkMultipleInstances() {}, startMultiInstanceCheck() {},
      loadDummyData() { this.dummyLoaded = true; },
      async saveSettings() { return true; },
      appAlert(message) { alerts.push(message); return Promise.resolve(); },
    });
  for (const [name, getter] of Object.entries(Object.assign({}, ...config.mixins.map(mixin => mixin.computed || {}), config.computed))) {
    Object.defineProperty(editor, name, { get: getter.bind(editor) });
  }
  let currentTheme = editor.theme;
  Object.defineProperty(editor, 'theme', {
    get() { return currentTheme; },
    set(value) { const previous = currentTheme; currentTheme = value; if (value !== previous) config.watch.theme.call(editor, value, previous); },
  });
  window.OfflineStore = {
    isAvailable() { return options.available !== false; },
    async migrateFromLocalStorageIfNeeded() { if (options.migrationError) throw new Error('Migration failed'); },
    async getSettings() { if (options.settingsError) throw new Error('Settings failed'); return options.settings || null; },
  };
  return { editor, config, context, window, root, attributes, themeChanges, writes, alerts, storage };
}

test('the head hides raw templates through both dependency loading and local startup', () => {
  const head = html.match(/<head>[\s\S]*?<\/head>/i)[0];
  assert.match(html, /<html\b[^>]*\bdata-theme="dark"[^>]*\bdata-app-booting/);
  assert.match(html, /<div\b[^>]*\bid="app"[^>]*\bv-cloak/);
  assert.match(head, /#app\[v-cloak\]/);
  assert.match(head, /html\[data-app-booting\]\s+#app/);
  assert.match(head, /display:\s*none\s*!important/);
  assert.ok(head.indexOf('<style') < head.indexOf('<link'), 'Critical canvas and cloak must precede external styles');
  assert.ok(head.indexOf('<script') < head.indexOf('<link'), 'Theme must be restored before external styles');
  for (const theme of ['light', 'grey', 'modern-dark']) {
    assert.ok(head.includes(`[data-theme="${theme}"]`), `Critical canvas must cover ${theme}`);
  }
  assert.match(head, /:root\s*\{[^}]*--color-bg:\s*#202225/i);
  assert.match(head, /color-scheme:\s*dark/);
});

test('every cached theme is applied before Vue starts', () => {
  for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
    const h = harness({ cache: theme });
    assert.equal(h.root.getAttribute('data-theme'), theme);
    assert.equal(h.root.hasAttribute('data-app-booting'), true);
    assert.equal(h.editor.startupReady, false);
  }
});

test('stale legacy preferences cannot brighten the first upgrade and missing or denied storage stays dim', () => {
  assert.equal(harness({ legacyRaw: '{"theme":"light"}' }).root.getAttribute('data-theme'), 'dark');
  assert.equal(harness({ cache: 'dark', legacyRaw: '{"theme":"light"}' }).root.getAttribute('data-theme'), 'dark');
  for (const options of [{}, { cache: 'unknown' }, { legacyRaw: '{broken' }, { legacyRaw: '{"theme":"unknown"}' }, { denyRead: true }]) {
    assert.equal(harness(options).root.getAttribute('data-theme'), 'dark');
  }
});

test('stale legacy light preferences cannot brighten the canvas while the active dark profile loads', async () => {
  const h = harness({ cache: 'dark', settings: { lang: 'Thai', theme: 'light' } });
  const local = deferred(), network = deferred(), networkStart = deferred();
  let networkStarted = false;
  h.window.CloudSync.Client = class {
    constructor({ onChange }) { this.onChange = onChange; }
    async initialize() { await local.promise; this.onChange(this.snapshot()); }
    snapshot() { return { settings: { lang: 'Thai', theme: 'dark' }, dictionary: [], editorClipboard: '', conflicts: [], revision: 0, user: null, signedIn: false }; }
    async refreshSession() {
      networkStarted = true;
      assert.equal(h.root.hasAttribute('data-app-booting'), false, 'Remote work must start after local UI is revealed');
      networkStart.resolve();
      await network.promise;
    }
  };
  const mounting = h.config.mounted.call(h.editor);
  await tick();
  assert.equal(h.editor.theme, 'light', 'The legacy settings were read before hybrid profile restoration');
  assert.equal(h.root.getAttribute('data-theme'), 'dark');
  assert.equal(h.root.hasAttribute('data-app-booting'), true);
  assert.equal(networkStarted, false);
  assert.equal(h.writes.some(([key, value]) => key === 'sdeditor-theme' && value === 'light'), false);
  local.resolve();
  await networkStart.promise;
  assert.equal(h.editor.theme, 'dark');
  assert.equal(h.editor.startupReady, true);
  assert.equal(h.root.hasAttribute('data-app-booting'), false);
  assert.equal(networkStarted, true);
  assert.equal(h.themeChanges.includes('light'), false);
  network.resolve();
  await mounting;
});

test('startup reveals only after Vue has rendered the resolved theme and state', async () => {
  const h = harness({ cache: 'dark' });
  const rendering = deferred();
  h.editor.theme = 'grey';
  h.editor.$nextTick = () => rendering.promise;
  const finishing = h.editor.finishStartup();
  await tick();
  assert.equal(h.root.getAttribute('data-theme'), 'grey');
  assert.equal(h.root.hasAttribute('data-app-booting'), true);
  rendering.resolve();
  await finishing;
  assert.equal(h.root.hasAttribute('data-app-booting'), false);
});

test('Initialization waits for the first local Dictionary snapshot without starting a network request', async () => {
  const h = harness({ cache: 'dark' }), snapshot = deferred();
  h.editor.lang = 'Thai'; h.editor.gameVersion = 'poe1';
  let started = false;
  h.editor.ensureDictionarySnapshot = () => { started = true; return snapshot.promise; };
  const finishing = h.editor.finishStartup();
  await tick();
  assert.equal(started, true);
  assert.equal(h.editor.startupReady, false);
  assert.equal(h.root.hasAttribute('data-app-booting'), true);
  snapshot.resolve({ generation: 1 });
  await finishing;
  assert.equal(h.editor.startupReady, true);
  assert.equal(h.root.hasAttribute('data-app-booting'), false);
});

test('the initial game selector paints without awaiting an irrelevant Dictionary snapshot', async () => {
  const h = harness({ cache: 'dark' });
  h.editor.lang = 'Thai'; h.editor.gameVersion = '';
  h.editor.ensureDictionarySnapshot = () => { assert.fail('No selected game means there is no Dictionary scope to prepare.'); };
  await h.editor.finishStartup(true);
  assert.equal(h.editor.startupReady, true);
  assert.equal(h.root.hasAttribute('data-app-booting'), false);
  assert.equal(h.editor.gameVersion, '');
});

test('workspace loading starts Dictionary prewarming before its IndexedDB reads settle', async () => {
  const h = harness({ cache: 'dark' }), workspace = deferred(), source = deferred(), snapshot = deferred();
  const events = [];
  h.editor.lang = 'Thai'; h.editor.cloudProfileId = 'local-profile'; h.editor.gameVersion = 'poe1';
  h.editor.resetVersionedState = () => {};
  h.window.OfflineStore.getWorkspace = () => { events.push('workspace read'); return workspace.promise; };
  h.window.OfflineStore.getSource = () => { events.push('source read'); return source.promise; };
  h.editor.prepareStoredWorkspaceSource = async rows => rows;
  const ensure = h.editor.ensureDictionaryWorker;
  h.editor.ensureDictionaryWorker = function () {
    events.push('Dictionary prewarm');
    assert.equal(this.cloudProfileId, 'local-profile'); assert.equal(this.lang, 'Thai');
    return ensure.call(this);
  };
  h.editor.ensureDictionarySnapshot = () => snapshot.promise;
  const loading = h.editor.loadVersionedStorage();
  await tick();
  assert.equal(events[0], 'Dictionary prewarm');
  assert.ok(events.includes('workspace read')); assert.ok(events.includes('source read'));
  workspace.resolve({ descs: [], status: {} });
  source.resolve([{ filepath: 'test/local.txt', translations: { English: ['Local source'], Thai: ['คำแปล'] } }]);
  await tick();
  assert.equal(h.editor.sourceLoaded, false, 'Cold workspace publication awaits the first prepared local snapshot.');
  snapshot.resolve({ generation: 1 });
  await loading;
  assert.equal(h.editor.sourceLoaded, true);
  assert.equal(h.editor.descs[0].filepath, 'test/local.txt');
  assert.equal(h.editor.cloudStorageError, '');
});

test('a failed first Dictionary snapshot reveals an actionable startup error', async () => {
  const h = harness({ cache: 'dark' });
  h.editor.lang = 'Thai'; h.editor.gameVersion = 'poe1';
  h.editor.ensureDictionarySnapshot = async () => { throw new Error('Fixture local cache failure'); };
  await h.editor.finishStartup(true);
  assert.equal(h.editor.startupReady, true);
  assert.equal(h.root.hasAttribute('data-app-booting'), false);
  assert.match(h.editor.cloudStorageError, /Dictionary matches.*Fixture local cache failure/);
});

test('runtime changes and restored profile themes become the next startup theme', async () => {
  const h = harness({ cache: 'dark' });
  h.editor.theme = 'dark';
  await h.editor.finishStartup();
  h.editor.theme = 'modern-dark';
  assert.equal(h.root.getAttribute('data-theme'), 'modern-dark');
  assert.equal(h.storage.get('sdeditor-theme'), 'modern-dark');
  await h.editor.cloudApply({ settings: { lang: 'Thai', theme: 'grey' }, dictionary: [], editorClipboard: '',
    conflicts: [], revision: 1, user: { name: 'Another profile' }, signedIn: true });
  assert.equal(h.root.getAttribute('data-theme'), 'grey');
  assert.equal(h.storage.get('sdeditor-theme'), 'grey');
  h.editor.importSettings({ lang: 'Thai', theme: 'invalid-theme' });
  assert.equal(h.editor.theme, 'grey');
  assert.equal(h.root.getAttribute('data-theme'), 'grey');
});

test('denied cache writes do not prevent showing the app or changing its theme', async () => {
  const h = harness({ cache: 'dark', denyWrite: true });
  h.editor.theme = 'dark';
  await h.editor.finishStartup();
  h.editor.theme = 'modern-dark';
  assert.equal(h.root.hasAttribute('data-app-booting'), false);
  assert.equal(h.root.getAttribute('data-theme'), 'modern-dark');
});

test('a new installation keeps the ordinary Light default after local startup finishes', async () => {
  const h = harness();
  h.window.CloudSync.Client = class {
    async initialize(settings) { this.settings = settings; }
    snapshot() { return { settings: this.settings, dictionary: [], editorClipboard: '', conflicts: [], revision: 0, user: null, signedIn: false }; }
    async refreshSession() {}
  };
  assert.equal(h.root.getAttribute('data-theme'), 'dark', 'The unknown initial canvas stays dim');
  await h.config.mounted.call(h.editor);
  assert.equal(h.root.hasAttribute('data-app-booting'), false);
  assert.equal(h.editor.theme, 'light');
  assert.equal(h.root.getAttribute('data-theme'), 'light');
  assert.equal(h.storage.get('sdeditor-theme'), 'light');
});

test('storage startup failures reveal actionable UI and retain the known dim appearance', async () => {
  for (const options of [{ available: false }, { migrationError: true }, { settingsError: true }]) {
    const h = harness({ cache: 'dark', ...options });
    const alert = h.editor.appAlert;
    h.editor.appAlert = message => {
      assert.equal(h.root.hasAttribute('data-app-booting'), false, 'Show the app before focusing a storage warning dialog');
      return alert(message);
    };
    await h.config.mounted.call(h.editor);
    assert.equal(h.root.hasAttribute('data-app-booting'), false);
    assert.equal(h.editor.startupReady, true);
    assert.equal(h.root.getAttribute('data-theme'), 'dark');
    assert.ok(h.alerts.length || h.editor.cloudStorageError, 'An existing actionable storage error must remain available');
  }
});

test('hybrid storage startup failure reveals its error without applying stale legacy Light settings', async () => {
  const h = harness({ cache: 'modern-dark', settings: { lang: 'Thai', theme: 'light' } });
  h.editor.initializeCloud = async () => { throw new Error('Hybrid settings unavailable'); };
  await h.config.mounted.call(h.editor);
  assert.equal(h.root.hasAttribute('data-app-booting'), false);
  assert.equal(h.root.getAttribute('data-theme'), 'modern-dark');
  assert.match(h.editor.cloudStorageError, /Hybrid settings unavailable/);
});

test('test mode reveals dummy data and keeps the saved startup theme without accessing IndexedDB', async () => {
  const h = harness({ testMode: true, cache: 'modern-dark', available: false });
  h.window.OfflineStore.isAvailable = () => { assert.fail('Test mode must not access IndexedDB'); };
  await h.config.mounted.call(h.editor);
  assert.equal(h.root.hasAttribute('data-app-booting'), false);
  assert.equal(h.root.getAttribute('data-theme'), 'modern-dark');
  assert.equal(h.editor.theme, 'modern-dark');
  assert.equal(h.editor.dummyLoaded, true);
  assert.equal(h.editor.lang, 'Thai');
  assert.equal(h.editor.needsInitialSettings, false);
});
