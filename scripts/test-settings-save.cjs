const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness() {
  let config; const timers = new Map(), listeners = new Map(), writes = []; let nextTimer = 0;
  const window = { location: { search: '' }, addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); }, OfflineStore: { async setSettings(value) { writes.push(plain(value)); } } };
  const context = vm.createContext({ window, document: {}, URLSearchParams, console,
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
    Vue: { defineComponent(value) { config = value; return value; }, toRaw(value) { return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; } } });
  for (const file of ['workspaceState.js', 'cloudUi.js', 'index.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context);
  vm.runInContext('offlineStoreReady = true', context);
  const e = Object.assign({}, ...config.mixins.map(m => m.data?.() || {}), config.data(),
    ...config.mixins.map(m => m.methods || {}), config.methods, {
      lang: 'Thai', dictionary: [{ _id: 'one', find: 'Fire', replace: 'ไฟ', alts: [], tlnote: '' }],
      yieldEditorWork: async () => {}, $nextTick: async () => {},
    });
  return { e, writes, timers, listeners, context, window, config };
}

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
