const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const CloudSync = require('../public/cloudSync.js');
const copy = value => JSON.parse(JSON.stringify(value));
function harness() {
  const window = { CloudSync };
  const context = vm.createContext({ window, console, sessionStorage: { setItem() {}, getItem() { return null; } },
    location: { hostname: '127.0.0.1', search: '', reload() {} }, URL, URLSearchParams });
  for (const name of ['cloudUi.js', 'instanceUi.js']) vm.runInContext(fs.readFileSync(require.resolve('../public/' + name), 'utf8'), context);
  const e = Object.assign({}, window.CloudUI.mixin.data(), window.InstanceUI.mixin.data(), window.CloudUI.mixin.methods, window.InstanceUI.mixin.methods,
    CloudSync.completeSettings({ lang: 'Thai' }), { dictionary: [], editorClipboard: '', _instances: {}, gameVersion: 'poe1',
      _cloud: { context: () => ({ epoch: 1 }) }, $nextTick: () => Promise.resolve(), toPlainForStorage: copy,
      importSettings(settings) { Object.assign(this, copy(settings)); }, editorHaveChanges() { return !!this.dirty; } });
  const snapshot = (fields = {}) => ({ profileId: 'guest', user: null, signedIn: false, conflicts: [], revision: 0,
    settings: CloudSync.completeSettings({ lang: 'Thai' }), dictionary: [], editorClipboard: '', ...fields });
  return { e, snapshot };
}
test('peer settings updates preserve authored dictionary and preference drafts', async () => {
  const { e, snapshot } = harness();
  await e.cloudApply(snapshot());
  e.dictionary = [{ _id: 'a', find: 'Fire', replace: 'draft' }]; e.uiDensity = 'spacious';
  await e.cloudApply(snapshot({ settings: CloudSync.completeSettings({ lang: 'Thai', theme: 'dark' }),
    dictionary: [{ _id: 'b', find: 'Cold', replace: 'peer' }] }));
  assert.equal(e.dictionary[0]._id, 'a'); assert.equal(e.theme, 'dark'); assert.equal(e.uiDensity, 'spacious');
  assert.equal(e._cloudAuthoredBase.dictionary.length, 0); assert.equal(e._cloudAuthoredBase.uiDensity, 'compact');
});
test('persist submits the tab authored baseline rather than the latest worker snapshot', async () => {
  const { e, snapshot } = harness();
  await e.cloudApply(snapshot());
  const authored = copy(e._cloudAuthoredBase);
  e.dictionary = [{ _id: 'a', find: 'Fire', replace: 'draft' }];
  let captured;
  e._cloud.saveLocal = async (payload, options) => { captured = copy(options); };
  e._cloud.snapshot = () => snapshot({ dictionary: e.dictionary });
  assert.equal(await e.cloudPersist(e.cloudPayload()), true);
  assert.deepEqual(captured.base, authored); assert.equal(captured.language, 'Thai');
});
test('ordinary peer defaults never switch an active tab language', async () => {
  const { e, snapshot } = harness();
  await e.cloudApply(snapshot());
  await e.cloudApply(snapshot({ settings: CloudSync.completeSettings({ lang: 'French' }) }));
  assert.equal(e.lang, 'Thai');
});

test('language selection exposes its durable pending result and restores the old language on failure', async () => {
  const { e, snapshot } = harness(); await e.cloudApply(snapshot());
  let reject;
  e._cloud.selectLanguage = () => new Promise((resolve, fail) => { reject = fail; });
  e.lang = 'French';
  const operation = e.cloudSelectLanguage('French', 'Thai');
  assert.equal(e.cloudLanguageBusy, true); assert.equal(e._cloudLanguageTask, operation);
  reject(new Error('Storage unavailable'));
  assert.equal(await operation, false); assert.equal(e.cloudLanguageBusy, false); assert.equal(e.lang, 'Thai');
});
test('changing profile preserves dirty work and blocks publishing it under the new account', async () => {
  const { e, snapshot } = harness();
  await e.cloudApply(snapshot());
  e.editorVisible = true; e.dirty = true; e.editorBlocks = [{ translation: 'unfinished' }];
  e.dictionary = [{ _id: 'unsaved', find: 'Fire', replace: 'dictionary draft' }];
  e.editorCurrentEditingDesc = { filepath: 'x' };
  await e.cloudApply(snapshot({ profileId: 'account:b', user: { id: 'b' }, signedIn: true }));
  assert.equal(e.instanceDraftRecovery.translations[0], 'unfinished');
  assert.equal(e.instanceSourceChanged, true);
  e.rememberInstanceDraft('Downloaded draft');
  assert.equal(e.instanceDraftRecovery.settings.dictionary[0].replace, 'dictionary draft');
  assert.equal(e.instanceDraftRecovery.profile, 'guest');
});
test('peer workspace refresh leaves editor text, base and focus untouched', () => {
  const { e } = harness();
  e.sourceGeneration = 2; e.workspaceRevision = 3; e.sourceLoaded = true;
  e.descs = [{ filepath: 'x', translations: { Thai: ['old'] } }];
  e.editorBlocks = [{ translation: 'draft' }]; e._editorCollabBase = { translations: ['old'] };
  e.ensureLocalDescsReady = () => {};
  e.applyWorkspaceOverlay = () => { e.descs[0].translations.Thai = e.localDescs.descs[0].translations.Thai; };
  let invalidated = 0; e.updateScannedDescDiagnostics = () => invalidated++; e.filterDesc = () => {};
  e.instanceWorkspaceChanged({ game: 'poe1', generation: 2, revision: 4, workspace: { descs: [{ translations: { Thai: ['peer'] } }] } });
  assert.equal(e.editorBlocks[0].translation, 'draft'); assert.equal(e._editorCollabBase.translations[0], 'old');
  assert.equal(e.descs[0].translations.Thai[0], 'peer'); assert.equal(invalidated, 1);
  e.instanceWorkspaceChanged({ game: 'poe1', generation: 2, revision: 3, workspace: { descs: [] } });
  assert.equal(e.workspaceRevision, 4);
});
test('source replacement fences a stale tab and retains its dirty draft', () => {
  const { e } = harness(); e.sourceGeneration = 2; e.workspaceRevision = 3;
  e.editorVisible = true; e.dirty = true; e.editorBlocks = [{ translation: 'recover me' }];
  e.editorCurrentEditingDesc = { filepath: 'x' };
  e.instanceWorkspaceChanged({ game: 'poe1', generation: 3, revision: 4, workspace: { descs: [] } });
  assert.equal(e.instanceSourceChanged, true); assert.equal(e.sourceGeneration, 2);
  assert.equal(e.instanceDraftRecovery.translations[0], 'recover me');
});

test('source notifications received during a load are applied after the snapshot', () => {
  const { e } = harness(); e.sourceGeneration = 2; e.workspaceRevision = 3; e.versionStorageLoading = true;
  e.instanceWorkspaceChanged({ game: 'poe1', generation: 3, revision: 4 });
  assert.equal(e.instanceSourceChanged, false);
  e.versionStorageLoading = false;
  e.applyDeferredInstanceWorkspace();
  assert.equal(e.instanceSourceChanged, true);
});

test('explicit settings import adopts its language and matching dictionary', async () => {
  const { e, snapshot } = harness();
  await e.cloudApply(snapshot());
  e.dictionary = [{ _id: 'old', find: 'Fire', replace: 'old draft' }];
  const imported = snapshot({ settings: CloudSync.completeSettings({ lang: 'French' }), dictionary: [{ _id: 'new', find: 'Fire', replace: 'Feu' }] });
  e._cloud.importLocal = async () => {}; e._cloud.snapshot = () => imported;
  assert.equal(await e.cloudImport(imported.settings), true);
  assert.equal(e.lang, 'French'); assert.equal(e.dictionary[0].replace, 'Feu');
});
