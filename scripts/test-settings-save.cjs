const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Cloud = require('../public/cloudSync.js');
const Dictionary = require('../public/dictionarySync.js');

const plain = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness() {
  let config; const timers = new Map(), listeners = new Map(), writes = [], downloads = []; let nextTimer = 0;
  const window = { location: { search: '' }, addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); }, OfflineStore: { async setSettings(value) { writes.push(plain(value)); } } };
  const context = vm.createContext({ window, document: {}, URLSearchParams, console, Blob,
    saveAs(blob, filename) { downloads.push({ blob, filename }); },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
    Vue: { defineComponent(value) { config = value; return value; }, toRaw(value) { return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; } } });
  for (const file of ['workspaceState.js', 'dictionaryScope.js', 'cloudUi.js', 'index.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context);
  vm.runInContext('offlineStoreReady = true', context);
  const e = Object.assign({}, ...config.mixins.map(m => m.data?.() || {}), config.data(),
    ...config.mixins.map(m => m.methods || {}), config.methods, {
      lang: 'Thai', dictionary: [{ _id: 'one', find: 'Fire', replace: 'ไฟ', alts: [], tlnote: '' }],
      yieldEditorWork: async () => {}, $nextTick: async () => {},
    });
  Object.defineProperty(e,'settingsVisibleTabs',{get:()=>config.computed.settingsVisibleTabs.call(e)});
  return { e, writes, downloads, timers, listeners, context, window, config };
}

function startupState() {
  const entries = [{ _id: 'fire', find: 'Fire', replace: 'Fire target', alts: [], tlnote: '' },
    { _id: 'ice', find: 'Ice', replace: 'Ice target', alts: [], tlnote: '' }];
  const dictionary = { entries, base: { revision: 2, entries: plain(entries), tombstones: ['removed'] },
    conflicts: [], revision: 2, localVersion: 1, syncedLocalVersion: 1, pendingResolution: null };
  const settings = Cloud.completeSettings({ lang: 'Thai', theme: 'grey' });
  const profile = { settings, clipboard: 'Clipboard', dictionaries: { Thai: dictionary }, settingsBase: { revision: 3, settings: plain(settings) },
    recovery: [{ reason: 'Keep recovery', dictionaries: { Thai: { entries: [{ find: 'Frozen', replace: 'Recovery target' }] } } }], unassignedDictionary: null };
  return { version: 1, activeProfile: 'guest', auth: null, profiles: { guest: profile, other: plain(profile) },
    legacyRecovery: { dictionary: [{ find: 'Legacy', replace: 'Legacy target' }] } };
}

function startupHarness(store, legacy) {
  const h = harness(), { e, context, window, config } = h;
  window.CloudSync = Cloud; window.DictionarySync = Dictionary;
  context.document.addEventListener = () => {};
  vm.runInContext('offlineStoreReady = false', context);
  const pendingWatchers = [];
  const importing = e.importSettings;
  e.importSettings = function (settings) {
    const previous = Object.fromEntries(Object.keys(config.watch).map(key => [key, this[key]]));
    importing.call(this, settings);
    for (const [key, watcher] of Object.entries(config.watch)) {
      if (this[key] !== previous[key]) pendingWatchers.push(() => (typeof watcher === 'function' ? watcher : watcher.handler).call(this, this[key], previous[key]));
    }
  };
  e.$nextTick = async callback => { while (pendingWatchers.length) pendingWatchers.shift()(); callback?.(); };
  e.scheduleDictionaryDiagnosticScan = () => {};
  e.checkMultipleInstances = e.startMultiInstanceCheck = e.updateDocumentTitle = () => {};
  e.finishStartup = async () => { e.startupReady = true; await e.$nextTick(); };
  window.OfflineStore = { isAvailable: () => true, migrateFromLocalStorageIfNeeded: async () => {},
    getSettings: async () => plain(legacy), setSettings: async value => h.writes.push(plain(value)),
    getHybridState: async () => plain(store.state), updateHybridState: async update => {
      const next = update(plain(store.state));
      if (store.nextError) { const error = store.nextError; store.nextError = null; throw error; }
      if (store.gate) { const gate = store.gate; store.gate = null; gate.entered.resolve(); await gate.release.promise; }
      store.state = plain(next); store.writes.push(plain(next)); return plain(next);
    } };
  e.initializeCloud = async () => {
    e._cloudApplying = true; e._cloudInitializing = true;
    try {
      e._cloud = new Cloud.Client({ store: window.OfflineStore, merge: Dictionary, apiBase: 'http://fixture.invalid', fetch() { throw new Error('Unexpected network request'); } });
      e._cloud.schedule = () => {};
      await e._cloud.initialize(legacy);
      await e.cloudApply(e._cloud.snapshot());
      await e.$nextTick();
    } finally { e._cloudApplying = false; e._cloudInitializing = false; }
  };
  h.start = () => config.mounted.call(e);
  return h;
}

function startupStore(state = startupState()) { return { state: plain(state), writes: [] }; }
function startupLegacy(state) { const profile = state.profiles[state.activeProfile]; return { ...plain(profile.settings),
  dictionary: plain(profile.dictionaries[profile.settings.lang]?.entries || []), editorClipboard: profile.clipboard }; }

test('unchanged startup hydration and the second reload write neither settings nor the hybrid profile', async () => {
  const store = startupStore(), original = plain(store.state), legacy = startupLegacy(store.state);
  for (let reload = 0; reload < 2; reload++) {
    const h = startupHarness(store, legacy); await h.start();
    assert.equal(h.e.startupReady, true); assert.equal(h.e.pendingSettingsSaves, 0);
    assert.equal(h.writes.length, 0, 'Hydration watchers must settle before persistence is enabled.');
    assert.equal(store.writes.length, 0, 'A durable matching profile must not be rewritten.');
    assert.deepEqual(store.state, original, 'Other profiles, merge bases and recovery copies survive unchanged.');
  }
});

test('startup normalizes missing defaults, duplicate IDs, notes and alternate IDs once and retains generated identities', async () => {
  const store = startupStore();
  store.state.profiles.guest.settings = { lang: 'Thai', theme: 'grey', editorRegexes: [] };
  store.state.profiles.guest.dictionaries.Thai.entries = [{ _id: 'duplicate', find: 'Fire', replace: 'Target', tlnote: 12,
    alts: [{ find: 'Flame' }], gameScope: 'all' }, { _id: 'duplicate', find: 'Ice', replace: 'Cold' }, { find: 'Light', replace: 'Bright' }];
  const original = plain(store.state), legacy = startupLegacy(store.state), h = startupHarness(store, legacy);
  await h.start();
  assert.equal(h.writes.length, 0); assert.equal(store.writes.length, 1);
  const normalized = plain(store.state.profiles.guest), entries = normalized.dictionaries.Thai.entries;
  assert.deepEqual(normalized.settings, Cloud.completeSettings(original.profiles.guest.settings));
  assert.equal(new Set(entries.map(entry => entry._id)).size, 3); assert.ok(entries.every(entry => entry._id));
  assert.equal(entries[0].tlnote, '12'); assert.ok(entries[0].alts[0]._id); assert.equal(entries[0].alts[0].replace, 'Target');
  assert.equal(Object.hasOwn(entries[0], 'gameScope'), false);
  assert.deepEqual(normalized.recovery, original.profiles.guest.recovery);
  assert.deepEqual(normalized.dictionaries.Thai.base, original.profiles.guest.dictionaries.Thai.base);
  assert.deepEqual(store.state.profiles.other, original.profiles.other); assert.deepEqual(store.state.legacyRecovery, original.legacyRecovery);
  const reload = startupHarness(store, legacy); await reload.start();
  assert.equal(reload.writes.length, 0); assert.equal(store.writes.length, 1);
  assert.deepEqual(store.state.profiles.guest, normalized); assert.deepEqual(plain(reload.e.dictionary), entries);
});

test('real restored preference, clipboard and Dictionary edits still commit through the normal queue', async () => {
  const store = startupStore(), h = startupHarness(store, startupLegacy(store.state)); await h.start();
  h.e.theme = 'dark'; h.e.editorClipboard = 'Edited clipboard'; h.e.dictionary[0].replace = 'Edited target';
  assert.equal(await h.e.saveRestoredSettings(), true); assert.equal(store.writes.length, 1);
  assert.equal(store.state.profiles.guest.settings.theme, 'dark'); assert.equal(store.state.profiles.guest.clipboard, 'Edited clipboard');
  assert.equal(store.state.profiles.guest.dictionaries.Thai.entries[0].replace, 'Edited target'); assert.equal(h.e.pendingSettingsSaves, 0);
});

test('explicit ordinary saves still await a local commit even when the settings match the restored profile', async () => {
  const store = startupStore(), h = startupHarness(store, startupLegacy(store.state)); await h.start();
  assert.equal(store.writes.length, 0);
  assert.equal(await h.e.saveSettings(), true); assert.equal(store.writes.length, 1); assert.equal(h.e.pendingSettingsSaves, 0);
});

test('restored settings use the normal durable save when the client has no comparison helper', async () => {
  const store = startupStore(), h = startupHarness(store, startupLegacy(store.state)); await h.start();
  h.e._cloud.matchesLocalSettings = undefined;
  h.e.editorClipboard = 'Fallback edit';
  assert.equal(await h.e.saveRestoredSettings(), true);
  assert.equal(store.writes.length, 1); assert.equal(store.state.profiles.guest.clipboard, 'Fallback edit');
  assert.equal(h.e.pendingSettingsSaves, 0);
});

test('failed startup normalization remains queued and protected until the same generated IDs become durable', async () => {
  const store = startupStore(); delete store.state.profiles.guest.dictionaries.Thai.entries[0]._id;
  const original = plain(store.state); store.nextError = new Error('Storage full');
  const h = startupHarness(store, startupLegacy(store.state)); await h.start();
  const generatedId = h.e.dictionary[0]._id;
  assert.ok(generatedId); assert.equal(store.writes.length, 0); assert.deepEqual(store.state, original);
  assert.equal(h.e.pendingSettingsSaves, 1); assert.match(h.e.cloudStorageError, /Storage full/); assert.ok(h.listeners.has('beforeunload'));
  assert.equal(await h.e.saveRestoredSettings(), true);
  assert.equal(store.writes.length, 1); assert.equal(store.state.profiles.guest.dictionaries.Thai.entries[0]._id, generatedId);
  assert.equal(h.e.pendingSettingsSaves, 0); assert.equal(h.e.cloudStorageError, ''); assert.equal(h.listeners.has('beforeunload'), false);
});

test('a matching restored UI still awaits an active save and a newer queued edit before reporting durability', async () => {
  const store = startupStore(), h = startupHarness(store, startupLegacy(store.state)); await h.start();
  const gate = store.gate = { entered: deferred(), release: deferred() };
  h.e.editorClipboard = 'First edit'; const active = h.e.saveSettings(); await gate.entered.promise;
  h.e.editorClipboard = 'Clipboard'; let completed = false;
  const restoring = h.e.saveRestoredSettings().then(result => { completed = true; return result; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(completed, false); assert.equal(h.e.pendingSettingsSaves, 2);
  gate.release.resolve(); assert.equal(await active, true); assert.equal(await restoring, true);
  assert.equal(store.writes.length, 2); assert.equal(store.state.profiles.guest.clipboard, 'Clipboard'); assert.equal(h.e.pendingSettingsSaves, 0);
});

test('skipping an unchanged restore preserves another tab\'s newer durable edits and genuine later edits still merge', async () => {
  const store = startupStore(), h = startupHarness(store, startupLegacy(store.state)); await h.start();
  store.state.profiles.guest.dictionaries.Thai.entries[1].tlnote = 'Other tab note';
  const remote = plain(store.state);
  assert.equal(await h.e.saveRestoredSettings(), true); assert.equal(store.writes.length, 0); assert.deepEqual(store.state, remote);
  h.e.dictionary[0].replace = 'This tab edit'; assert.equal(await h.e.saveRestoredSettings(), true);
  assert.equal(store.writes.length, 1);
  assert.equal(store.state.profiles.guest.dictionaries.Thai.entries.find(entry => entry._id === 'fire').replace, 'This tab edit');
  assert.equal(store.state.profiles.guest.dictionaries.Thai.entries.find(entry => entry._id === 'ice').tlnote, 'Other tab note');
  assert.deepEqual(store.state.profiles.guest.recovery, remote.profiles.guest.recovery);
});

test('an unchanged restored UI cannot skip a queued operation captured in another account epoch', async () => {
  const store = startupStore(), original = plain(store.state), h = startupHarness(store, startupLegacy(store.state)); await h.start();
  h.e.scheduleSettingsSave(); h.e._cloud.epoch++;
  assert.equal(await h.e.saveRestoredSettings(), false); assert.equal(store.writes.length, 0); assert.deepEqual(store.state, original);
  assert.ok(h.e.pendingSettingsSaves); assert.match(h.e.cloudStorageError, /account or language changed/);
});

test('clipboard defaults hidden and its visibility and text survive save, export, and import', async () => {
  const { e, writes, downloads, config } = harness();
  assert.equal(e.hideEditorClipboard, true);
  e.editorClipboard = 'Keep this clipboard text';
  for (const hideEditorClipboard of [false, true]) {
    e.hideEditorClipboard = hideEditorClipboard;
    await config.watch.hideEditorClipboard.call(e);
    await e.flushScheduledSettingsSave();
    assert.equal(writes.at(-1).hideEditorClipboard, hideEditorClipboard);
    assert.equal(writes.at(-1).editorClipboard, 'Keep this clipboard text');
    e.exportSettingsClicked();
    const imported = JSON.parse(await downloads.at(-1).blob.text());
    assert.equal(imported.hideEditorClipboard, hideEditorClipboard);
    const restored = harness().e;
    restored.importSettings(imported);
    assert.equal(restored.hideEditorClipboard, hideEditorClipboard);
    assert.equal(restored.editorClipboard, 'Keep this clipboard text');
  }
  const legacy = e.settingsSavePayload();
  delete legacy.hideEditorClipboard;
  e.hideEditorClipboard = false;
  e.importSettings(legacy);
  assert.equal(e.hideEditorClipboard, true);
  assert.equal(e.editorClipboard, 'Keep this clipboard text');
});

test('the MTL section preserves existing preferences and legacy Settings navigation targets', async () => {
  const { e, config, writes, downloads } = harness();
  assert.equal(e.mtlConsentVersion, '');assert.equal(e.mtlShortcut, 'disabled');
  e.mtlConsentVersion='mtl-v1';e.mtlShortcut='ctrl-alt-f8';
  e.ctMtlVisible=true;
  const draft={userDay:75};e.mtlLimitsDraft=draft;
  for(const id of ['mtl','general','editor','cloud','data','logs','mtl']){
    e.openSettings(id);assert.equal(e.settingsTab,id);assert.equal(e.mtlLimitsDraft,draft);
    assert.equal(e.mtlConsentVersion,'mtl-v1');assert.equal(e.mtlShortcut,'ctrl-alt-f8');
  }
  let focused=0;e.$refs={settingsDialog:{querySelector(){return{focus(){focused++;}};}}};e.$nextTick=async callback=>callback?.();
  let prevented=0;e.handleSettingsTabKeydown({key:'ArrowRight',preventDefault(){prevented++;}},e.settingsTabs.findIndex(tab=>tab.id==='editor'));
  assert.equal(e.settingsTab,'mtl');assert.equal(prevented,1);assert.equal(focused,1);
  for(const mtlConsentVersion of ['','mtl-v1','mtl-v2']){
    e.mtlConsentVersion=mtlConsentVersion;await config.watch.mtlConsentVersion.call(e);await e.flushScheduledSettingsSave();
    assert.equal(writes.at(-1).mtlConsentVersion,mtlConsentVersion);assert.equal(writes.at(-1).mtlShortcut,'ctrl-alt-f8');
    e.exportSettingsClicked();const imported=JSON.parse(await downloads.at(-1).blob.text()),restored=harness().e;
    restored.importSettings(imported);assert.equal(restored.mtlConsentVersion,mtlConsentVersion);assert.equal(restored.mtlShortcut,'ctrl-alt-f8');
  }
});

test('hidden MTL navigation falls back to General and keyboard navigation skips it without changing preferences',async()=>{
  const {e,config}=harness();e.ctMtlVisible=true;e.settingsTab='mtl';e.mtlConsentVersion='mtl-v2';e.mtlShortcut='f8';
  e.mtlLimitsDraft={userDay:77};const draft=e.mtlLimitsDraft;let focus=0;
  e.settingsDialogVisible=true;e.$nextTick=async callback=>callback?.();e.$refs={settingsDialog:{querySelector(){return{focus(){focus++;}};}}};
  e.ctMtlVisible=false;config.watch.settingsVisibleTabs.call(e,e.settingsVisibleTabs);
  assert.equal(e.settingsTab,'general');assert.equal(focus,1);assert.equal(e.mtlLimitsDraft,draft);
  e.openSettings('mtl');assert.equal(e.settingsTab,'general');
  e.handleSettingsTabKeydown({key:'ArrowRight',preventDefault(){}},e.settingsVisibleTabs.findIndex(tab=>tab.id==='editor'));
  assert.equal(e.settingsTab,'cloud');assert.equal(e.mtlConsentVersion,'mtl-v2');assert.equal(e.mtlShortcut,'f8');
});

test('ClientText class-name display defaults on and survives local save, export, and import', async () => {
  const { e, writes, downloads, config } = harness();
  assert.equal(e.mapClientTextClassNames, true);
  for (const mapClientTextClassNames of [false, true]) {
    e.mapClientTextClassNames = mapClientTextClassNames;
    await config.watch.mapClientTextClassNames.call(e);
    await e.flushScheduledSettingsSave();
    assert.equal(writes.at(-1).mapClientTextClassNames, mapClientTextClassNames);
    e.exportSettingsClicked();
    const imported = JSON.parse(await downloads.at(-1).blob.text());
    assert.equal(imported.mapClientTextClassNames, mapClientTextClassNames);
    const restored = harness().e;
    restored.importSettings(imported);
    assert.equal(restored.mapClientTextClassNames, mapClientTextClassNames);
  }
  const legacy = e.settingsSavePayload();
  delete legacy.mapClientTextClassNames;
  e.mapClientTextClassNames = false;
  e.importSettings(legacy);
  assert.equal(e.mapClientTextClassNames, true);
});

test('full editor preview height survives local save, export, and import with a legacy automatic default', async () => {
  const { e, writes, downloads, config } = harness();
  assert.equal(e.fullEditorPreviewHeight, null);
  for (const fullEditorPreviewHeight of [100, 275.5, 2000, null]) {
    e.fullEditorPreviewHeight = fullEditorPreviewHeight;
    await config.watch.fullEditorPreviewHeight.call(e);
    await e.flushScheduledSettingsSave();
    assert.equal(writes.at(-1).fullEditorPreviewHeight, fullEditorPreviewHeight);
    e.exportSettingsClicked();
    const imported = JSON.parse(await downloads.at(-1).blob.text());
    assert.equal(imported.fullEditorPreviewHeight, fullEditorPreviewHeight);
    const restored = harness().e;
    restored.importSettings(imported);
    assert.equal(restored.fullEditorPreviewHeight, fullEditorPreviewHeight);
  }
  const legacy = e.settingsSavePayload();
  delete legacy.fullEditorPreviewHeight;
  for (const value of [undefined, '275', true, 99, 2001, NaN, Infinity, -Infinity]) {
    e.fullEditorPreviewHeight = 275;
    e.importSettings({ ...legacy, ...(value === undefined ? {} : { fullEditorPreviewHeight: value }) });
    assert.equal(e.fullEditorPreviewHeight, null);
  }
});

test('new Dictionary game scope defaults to All and survives local save, export, and import', async () => {
  const { e, writes, downloads } = harness();
  assert.equal(e.dictionaryDefaultGameScope, 'all');
  e.dictionary[0].gameScope = 'poe1';
  for (const dictionaryDefaultGameScope of ['all', 'poe1', 'poe2']) {
    e.dictionaryDefaultGameScope = dictionaryDefaultGameScope;
    assert.equal(await e.saveSettings(), true);
    assert.equal(writes.at(-1).dictionaryDefaultGameScope, dictionaryDefaultGameScope);
    assert.equal(writes.at(-1).dictionary[0].gameScope, 'poe1');
    e.exportSettingsClicked();
    const download = downloads.at(-1);
    assert.equal(download.filename, 'sdeditor_settings.json');
    const imported = JSON.parse(await download.blob.text());
    assert.equal(imported.dictionaryDefaultGameScope, dictionaryDefaultGameScope);
    const restored = harness().e;
    restored.importSettings(imported);
    assert.equal(restored.dictionaryDefaultGameScope, dictionaryDefaultGameScope);
    assert.equal(restored.dictionary[0].gameScope, 'poe1');
  }
});

test('legacy or invalid new Dictionary defaults reset to All while existing entry scopes are retained', () => {
  const { e } = harness();
  e.dictionaryDefaultGameScope = 'poe2';
  e.dictionary[0].gameScope = 'poe1';
  const legacy = e.settingsSavePayload();
  delete legacy.dictionaryDefaultGameScope;
  e.importSettings(legacy);
  assert.equal(e.dictionaryDefaultGameScope, 'all');
  assert.equal(e.dictionary[0].gameScope, 'poe1');
  e.dictionaryDefaultGameScope = 'poe2';
  e.importSettings({ ...legacy, dictionaryDefaultGameScope: 'current' });
  assert.equal(e.dictionaryDefaultGameScope, 'all');
  assert.equal(e.dictionary[0].gameScope, 'poe1');
});

test('rapid Dictionary typing coalesces before copying and commits the latest note and alternates', async () => {
  const { e, writes, listeners } = harness(); let snapshots = 0;
  const prepare = e.prepareSettingsSaveSnapshot;
  e.prepareSettingsSaveSnapshot = function (settings) { snapshots++; return prepare.call(this, settings); };
  for (const replace of ['ก', 'กำ', 'กำลัง']) { e.dictionary[0].replace = replace; e.scheduleSettingsSave(); }
  e.dictionary[0].alts.push({ _id: 'alt', find: 'Burning', replace: 'เผาไหม้' });
  e.dictionary[0].tlnote = 'Latest note'; e.scheduleSettingsSave();
  assert.equal(snapshots, 0); assert.equal(writes.length, 0); assert.equal(e.pendingSettingsSaves, 1);
  let prevented = false; const event = { preventDefault() { prevented = true; } };
  listeners.get('beforeunload')(event); assert.equal(prevented, true);
  assert.equal(await e.flushScheduledSettingsSave(), true);
  assert.equal(snapshots, 1); assert.equal(writes.length, 1);
  assert.equal(writes[0].dictionary[0].replace, 'กำลัง');
  assert.equal(writes[0].dictionary[0].tlnote, 'Latest note'); assert.equal(writes[0].dictionary[0].alts[0].replace, 'เผาไหม้');
  assert.equal(e.pendingSettingsSaves, 0); assert.equal(listeners.has('beforeunload'), false);
});

test('adding a row can paint before snapshot preparation and explicit Save waits only for local durability', async () => {
  const { e, window, writes } = harness(); const paint = deferred(), commit = deferred(); let prepared = false, finished = false;
  e.yieldEditorWork = () => paint.promise;
  const prepare = e.prepareSettingsSaveSnapshot;
  e.prepareSettingsSaveSnapshot = function (settings) { prepared = true; return prepare.call(this, settings); };
  window.OfflineStore.setSettings = async value => { writes.push(plain(value)); await commit.promise; };
  const saving = e.saveSettings().then(value => { finished = true; return value; });
  assert.equal(prepared, false); assert.equal(finished, false);
  paint.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1); assert.equal(finished, false);
  commit.resolve(); assert.equal(await saving, true); assert.equal(finished, true);
});

test('typing during a local transaction retains the newer draft and saves it after acknowledgement', async () => {
  const { e, window, writes } = harness(); const commit = deferred();
  window.OfflineStore.setSettings = async value => { writes.push(plain(value)); if (writes.length === 1) await commit.promise; };
  const first = e.saveSettings(); await new Promise(resolve => setImmediate(resolve));
  e.dictionary[0].replace = 'ไฟใหม่'; e.scheduleSettingsSave(); e.dictionary[0].replace = 'ไฟล่าสุด'; e.scheduleSettingsSave();
  assert.equal(e.pendingSettingsSaves, 2); assert.equal(writes[0].dictionary[0].replace, 'ไฟ');
  commit.resolve(); assert.equal(await first, true);
  assert.equal(writes.length, 2); assert.equal(writes[1].dictionary[0].replace, 'ไฟล่าสุด'); assert.equal(e.pendingSettingsSaves, 0);
});

test('failed local saves retain the draft and leave protection until a successful retry', async () => {
  const { e, window, writes, listeners } = harness();
  window.OfflineStore.setSettings = async () => { throw new Error('Storage full'); };
  assert.equal(await e.saveSettings(), false);
  assert.match(e.cloudStorageError, /Storage full/); assert.equal(e.pendingSettingsSaves, 1);
  assert.equal(listeners.has('beforeunload'), true);
  e.dictionary[0].replace = 'ไฟที่เก็บไว้'; e.scheduleSettingsSave();
  window.OfflineStore.setSettings = async value => writes.push(plain(value));
  assert.equal(await e.flushScheduledSettingsSave(), true);
  assert.equal(writes[0].dictionary[0].replace, 'ไฟที่เก็บไว้'); assert.equal(e.cloudStorageError, '');
  assert.equal(e.pendingSettingsSaves, 0); assert.equal(listeners.has('beforeunload'), false);
});

test('a queued draft cannot cross account or assignment boundaries', async () => {
  const { e } = harness(); let allowed = true, persisted = 0;
  e._cloud = { context: () => ({ epoch: 1, profile: 'A', token: 'test', language: 'Thai', assignmentVersion: 1 }), permissionsCurrent: () => allowed };
  e.cloudPersist = async () => { persisted++; return true; };
  e.scheduleSettingsSave(); allowed = false;
  assert.equal(await e.flushScheduledSettingsSave(), false);
  assert.equal(persisted, 0); assert.equal(e.pendingSettingsSaves, 1); assert.match(e.cloudStorageError, /account or language changed/);
  allowed = true; assert.equal(await e.flushScheduledSettingsSave(), true); assert.equal(persisted, 1);
});

test('language selection flushes the old-language Dictionary before switching its profile', async () => {
  const { e } = harness(); const events = [];
  e._cloud = { context: () => ({ epoch: 1, profile: 'A', token: 'test', language: 'Thai', assignmentVersion: 1 }),
    permissionsCurrent: () => true, async selectLanguage(language) { events.push(language); }, snapshot: () => ({}) };
  e.cloudPersist = async settings => { assert.equal(e._cloudApplying, undefined); events.push(settings.lang); return true; };
  e.cloudPayload = () => ({}); e.cloudApply = async () => {};
  e.scheduleSettingsSave(); e.lang = 'French';
  assert.equal(await e.cloudSelectLanguage('French', 'Thai'), true);
  assert.deepEqual(events, ['Thai', 'French']); assert.equal(e.pendingSettingsSaves, 0);
});

test('large Dictionary snapshots yield without copying the whole Dictionary in one call', async () => {
  const { e, context } = harness(); let clock = 0, yields = 0;
  context.Date = { now() { clock += 2; return clock; } };
  e.yieldEditorWork = async () => { yields++; };
  e.dictionary = Array.from({ length: 1000 }, (_, index) => ({ _id: 'd-' + index, find: 'Term ' + index, replace: 'คำ ' + index }));
  const original = e.toPlainForStorage;
  e.toPlainForStorage = value => { assert.ok(!Array.isArray(value.dictionary) || value.dictionary.length === 0); return original(value); };
  const result = await e.prepareSettingsSaveSnapshot(e.settingsSavePayload());
  assert.ok(yields > 100); assert.equal(result.dictionary.length, 1000);
  result.dictionary[0].replace = 'Detached'; assert.equal(e.dictionary[0].replace, 'คำ 0');
});

test('an account change from another tab finishes the pending local draft before replacing the UI', async () => {
  const { e, window } = harness(); const events = [];
  e._cloud = { epoch: 1, context: () => ({ epoch: 1, profile: 'A', token: 'test', language: 'Thai' }),
    permissionsCurrent: () => true, closeSocket() { events.push('close'); }, snapshot: () => ({}), schedule() { events.push('sync'); } };
  e.cloudPersist = async settings => { events.push('save ' + settings.dictionary[0].replace); return true; };
  window.OfflineStore.getHybridState = async () => { events.push('read account'); return {}; };
  e.cloudApply = async () => { events.push('apply'); };
  e.dictionary[0].replace = 'Latest draft'; e.scheduleSettingsSave();
  assert.equal(await e.cloudReloadAccount(), true);
  assert.deepEqual(events, ['save Latest draft', 'close', 'read account', 'apply', 'sync']);
  assert.equal(e.pendingSettingsSaves, 0); assert.equal(e._cloud.epoch, 2);
});

test('an unsafe account change from another tab leaves the unsaved Dictionary visible for recovery', async () => {
  const { e, window } = harness(); let current = true;
  e._cloud = { epoch: 1, context: () => ({ epoch: 1, profile: 'A', token: 'test', language: 'Thai' }), permissionsCurrent: () => current,
    closeSocket() { assert.fail('The account must not change while local saving fails'); } };
  window.OfflineStore.getHybridState = async () => { assert.fail('Do not replace the draft'); };
  e.dictionary[0].replace = 'Keep this draft'; e.scheduleSettingsSave(); current = false;
  assert.equal(await e.cloudReloadAccount(), false);
  assert.equal(e.dictionary[0].replace, 'Keep this draft'); assert.equal(e.pendingSettingsSaves, 1);
  assert.equal(e._cloud.epoch, 1); assert.match(e.cloudStorageError, /export your settings/);
});
