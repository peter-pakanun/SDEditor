const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  let config;
  const writes = [], alerts = [];
  const window = { location: { search: '?testMode=1&lang=Thai' }, CloudUI: { mixin: {} },
    CollaborationProtocol: require('../public/collaborationProtocol.js'),
    OfflineStore: { async saveWorkspaceWithRevisions(workspace, revisions, game) { writes.push(JSON.parse(JSON.stringify({ workspace, revisions, game }))); } } };
  const context = vm.createContext({ window, URLSearchParams, console, setTimeout, clearTimeout,
    alert: () => assert.fail('Native alerts must not be used'), confirm: () => assert.fail('Native confirmations must not be used'),
    document: { activeElement: null, body: {}, querySelector: () => null },
    Vue: { nextTick(fn) { fn?.(); return Promise.resolve(); }, defineComponent(value) { config = value; return value; },
      createApp: () => ({ component() {}, directive() {}, mount() {} }) } });
  for (const file of ['helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'collaborationIntegration.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context, { filename: file });
  }
  const mixin = window.CollaborationIntegration.mixin;
  const editor = Object.assign(mixin.data(), config.data(), mixin.methods, config.methods, {
    lang: 'Thai', gameVersion: 'poe1', sourceIdentity: 'source-one', sourceLoaded: true,
    dictionary: [], $refs: {}, $nextTick: fn => { fn?.(); return Promise.resolve(); },
    appAlert: async message => { alerts.push(message); }, appConfirm: async () => true,
    saveSettings() {}, closeHlPopup() {}, restoreFileTableFocusAfterEditor() {},
  });
  for (const [name, getter] of Object.entries(config.computed)) Object.defineProperty(editor, name, { get: () => getter.call(editor) });
  return { editor, window, writes, alerts, context };
}
function description(index, translations = ['เดิม', 'สอง']) {
  const name = String(index).padStart(3, '0');
  return { filepath: `source/${name}.txt`, filedir: 'source', filename: `${name}.txt`, name: '',
    stats: ['stat_' + index], variables: ['#', '#'], remarks: ['', ''],
    translations: { English: ['Original', 'Second'], Thai: translations }, hasChanges: true, needsReview: false };
}
function navigationFixture(count = 45) {
  const h = harness(), e = h.editor;
  e.descs = Array.from({ length: count }, (_, i) => description(i + 1)); e.filterDesc();
  const opened = [];
  e.editFile = async filepath => { opened.push(filepath); e.editorVisible = true; e.editorCurrentEditingDesc = e.getDescByFilepath(filepath); return true; };
  return { ...h, opened };
}
function saveFixture() {
  const h = harness(), e = h.editor, desc = description(1);
  e.descs = [desc]; e.editorVisible = true; e.editorCurrentEditingDesc = desc;
  e.editorOriginalTranslations = [...desc.translations.Thai];
  e.editorBlocks = [{ english: 'Original', translation: 'ใหม่' }, { english: 'Second', translation: 'สอง' }];
  e.testMode = false;
  return { ...h, desc };
}
test('F2 opens first available visible row, F1 opens last available visible row', async () => {
  const { editor: e, opened } = navigationFixture();
  e._collaboration = { isEditing: p => /001|020/.test(p) };
  await e.saveAndSkipFile(); assert.equal(opened[0], 'source/002.txt');
  e.editorVisible = false; e.currentPage = 1;
  await e.saveAndSkipFile(true); assert.equal(opened[1], 'source/019.txt');
});
test('automatic navigation skips occupied pages without wrapping', async () => {
  const { editor: e, opened } = navigationFixture();
  e.editorVisible = true; e.editorCurrentEditingDesc = e.descs[0]; e.editorHaveChanges = () => false;
  e._collaboration = { isEditing: p => p !== 'source/041.txt' };
  assert.equal(await e.saveAndSkipFile(), true); assert.equal(opened[0], 'source/041.txt'); assert.equal(e.currentPage, 3);
  assert.equal(await e.saveAndSkipFile(), false); assert.equal(opened.length, 1); assert.match(e.collaborationNotice, /No available files/);
});
test('availability race continues to the next candidate and ignores selections without editing', async () => {
  const { editor: e, opened } = navigationFixture(4);
  e._collaboration = { isEditing: () => false };
  const open = e.editFile;
  e.editFile = async (filepath, focus, options) => { assert.equal(options.automatic, true); return filepath.endsWith('001.txt') ? false : open(filepath); };
  await e.saveAndSkipFile(); assert.deepEqual(opened, ['source/002.txt']);
});
test('save-and-next captures its anchor before save removes the file from the filter', async () => {
  const { editor: e, opened } = navigationFixture(4);
  e.editorVisible = true; e.editorCurrentEditingDesc = e.descs[1]; e.editorHaveChanges = () => true;
  e.editorSave = async options => { assert.equal(options.close, false); e.filteredDescs = e.filteredDescs.filter(d => d !== e.descs[1]); return true; };
  await e.saveAndSkipFile(); assert.deepEqual(opened, ['source/003.txt']);
});
test('failed/conflicting saves prevent navigation; repeated keypresses do not submit again', async () => {
  const { editor: e, opened } = navigationFixture(3);
  e.editorVisible = true; e.editorCurrentEditingDesc = e.descs[0]; e.editorHaveChanges = () => true;
  let finish, calls = 0;
  e.editorSave = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = e.saveAndSkipFile(); assert.equal(await e.saveAndSkipFile(), false);
  finish(false); await first; assert.equal(calls, 1); assert.deepEqual(opened, []);
});
test('durable save failure retains draft and does not mutate saved translations or close', async () => {
  const { editor: e, window, desc } = saveFixture();
  window.OfflineStore.saveWorkspaceWithRevisions = async () => { throw new Error('Disk full'); };
  assert.equal(await e.editorSave(), false);
  assert.deepEqual(desc.translations.Thai, ['เดิม', 'สอง']); assert.equal(e.editorVisible, true);
  assert.equal(e.editorBlocks[0].translation, 'ใหม่'); assert.match(e.collaborationNotice, /Disk full/);
});
test('a pending save warning prevents duplicate submissions and cancellation preserves the draft', async () => {
  const { editor: e, writes, desc } = saveFixture();
  let answer, warnings = 0;
  e.collectEditorDiagnostics = level => level === 'warning' ? [{ level, message: 'Review this translation.' }] : [];
  e.appConfirm = () => { warnings++; return new Promise(resolve => { answer = resolve; }); };
  const saving = e.editorSave();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(warnings, 1); assert.equal(e.editorSaving, true);
  assert.equal(await e.editorSave(), false); assert.equal(warnings, 1); assert.equal(writes.length, 0);
  answer(false);
  assert.equal(await saving, false); assert.equal(e.editorSaving, false); assert.equal(writes.length, 0);
  assert.equal(e.editorVisible, true); assert.equal(e.editorBlocks[0].translation, 'ใหม่');
  assert.deepEqual(desc.translations.Thai, ['เดิม', 'สอง']);
});
test('a save warning cannot authorize a different workspace opened during the dialog', async () => {
  const { editor: e, writes, desc } = saveFixture();
  let answer;
  e.collectEditorDiagnostics = level => level === 'warning' ? [{ level, message: 'Review this translation.' }] : [];
  e.appConfirm = () => new Promise(resolve => { answer = resolve; });
  const saving = e.editorSave();
  await new Promise(resolve => setImmediate(resolve));
  e.gameVersion = 'poe2'; e.sourceIdentity = 'source-two';
  answer(true);
  assert.equal(await saving, false); assert.equal(writes.length, 0); assert.equal(e.editorSaving, false);
  assert.deepEqual(desc.translations.Thai, ['เดิม', 'สอง']);
});
test('mark reviewed locks duplicate submissions while confirming and cancellation changes nothing', async () => {
  const { editor: e, writes, desc } = saveFixture(); let answer, confirmations = 0;
  desc.needsReview = true;
  e.appConfirm = () => { confirmations++; return new Promise(resolve => { answer = resolve; }); };
  const reviewing = e.confirmTranslationUnchanged();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.editorSaving, true); await e.confirmTranslationUnchanged();
  assert.equal(confirmations, 1); assert.equal(writes.length, 0);
  answer(false); await reviewing;
  assert.equal(desc.needsReview, true); assert.equal(writes.length, 0); assert.equal(e.editorSaving, false);
});
test('history restore confirmation cannot write into a workspace selected while it was pending', async () => {
  const { editor: e, writes, desc } = saveFixture(); let answer;
  e.appConfirm = () => new Promise(resolve => { answer = resolve; });
  const restoring = e.restoreHistoryRevision({ filepath: desc.filepath, lang: 'Thai', sourceHash: e.sourceIdentity,
    translations: ['คืนค่า', 'สอง'] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.editorSaving, true); assert.equal(writes.length, 0);
  e.gameVersion = 'poe2'; e.sourceIdentity = 'source-two'; answer(true); await restoring;
  assert.equal(writes.length, 0); assert.equal(e.editorSaving, false); assert.deepEqual(desc.translations.Thai, ['เดิม', 'สอง']);
});
test('save writes workspace and history together before closing and preserves intentional blanks', async () => {
  const { editor: e, writes } = saveFixture();
  e.editorBlocks[1].translation = '';
  assert.equal(await e.editorSave(), true); assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].workspace.descs[0].translations.Thai, ['ใหม่', '']);
  assert.deepEqual(writes[0].revisions[0].translations, ['ใหม่', '']); assert.equal(e.editorVisible, false);
});
test('typing while storage is committing remains an unsaved open draft', async () => {
  const { editor: e, window, desc } = saveFixture();
  let finish;
  window.OfflineStore.saveWorkspaceWithRevisions = () => new Promise(resolve => { finish = resolve; });
  const saving = e.editorSave(); e.editorBlocks[0].translation = 'พิมพ์ต่อ'; finish();
  assert.equal(await saving, false); assert.equal(e.editorVisible, true);
  assert.equal(desc.translations.Thai[0], 'ใหม่'); assert.equal(e.editorBlocks[0].translation, 'พิมพ์ต่อ'); assert.equal(e.editorHaveChanges(), true);
});

test('Save & close and save-and-next finish after local commit while online sync is still waiting', async t => {
  for (const navigate of [false, true]) await t.test(navigate ? 'save-and-next' : 'Save & close', async t => {
    const { editor: e, desc, window, writes } = saveFixture();
    const { Client } = require('../public/collaborationSync.js');
    e.descs.push(description(2)); e.filterDesc();
    const copy = value => JSON.parse(JSON.stringify(value));
    const initial = e.descs.map(item => ({ ...e.collaborationFile(item), revision: 1 }));
    let state = null, workspace = copy(e.localDescs), hold = false, releaseLocal, releaseNetwork, requests = 0;
    const localGate = new Promise(resolve => { releaseLocal = resolve; });
    const networkGate = new Promise(resolve => { releaseNetwork = resolve; });
    const client = new Client({ WebSocket: null, locks: null,
      store: { async updateCollaborationState(update, options) {
        const next = update(copy(state));
        const nextWorkspace = options.projectWorkspace ? options.projectWorkspace(copy(workspace), next) : workspace;
        if (hold && options.revisions?.length) {
          await localGate;
          await window.OfflineStore.saveWorkspaceWithRevisions(nextWorkspace, options.revisions, 'poe1');
        }
        state = copy(next); workspace = copy(nextWorkspace); return copy(state);
      } },
      request: async path => {
        if (hold) { requests++; await networkGate; }
        if (path.endsWith('/join')) return { roomId: 'room', files: initial, sequence: 1 };
        if (path.includes('/changes?')) return { events: [], hasMore: false };
        throw new Error('Unexpected request: ' + path);
      },
    });
    t.after(async () => { const syncing = client.running; client.destroy(); releaseLocal(); releaseNetwork(); await syncing; });
    await client.connect({ accountId: 'translator', game: 'poe1', language: 'Thai', source: e.descs, files: initial, workspace });
    e._collaboration = client; e._editorCollabBase = client.fileBase(desc.filepath);
    const opened = [];
    e.editFile = async filepath => { opened.push(filepath); return true; };
    hold = true;
    const saving = navigate ? e.saveAndSkipFile() : e.editorSave();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(e.editorVisible, true, 'Keep the editor open until local storage commits.');
    assert.equal(e.editorSaving, true); assert.equal(requests, 0); assert.equal(writes.length, 0);
    assert.deepEqual(desc.translations.Thai, ['เดิม', 'สอง']);
    releaseLocal();
    assert.equal(await Promise.race([saving, new Promise(resolve => setImmediate(() => resolve('blocked by network')))]), true);
    assert.equal(e.editorSaving, false); assert.equal(requests, 1);
    assert.equal(client.snapshot().pending, 1); assert.equal(writes.length, 1);
    assert.equal(writes[0].workspace.descs[0].translations.Thai[0], 'ใหม่');
    assert.equal(writes[0].revisions[0].translations[0], 'ใหม่');
    assert.equal(e.editorHaveChanges(), false);
    if (navigate) assert.deepEqual(opened, ['source/002.txt']);
    else assert.equal(e.editorVisible, false);
  });
});
test('remote updates do not change a typing draft or its captured save base', () => {
  const { editor: e } = saveFixture();
  e._editorCollabBase = { translations: ['เดิม', 'สอง'], revision: 1 };
  e.applyCollaborationFiles([{ filepath: e.descs[0].filepath, translations: ['ทีม', 'สอง'], trackedForExport: true, needsReview: false }]);
  assert.equal(e.descs[0].translations.Thai[0], 'ทีม'); assert.equal(e.editorBlocks[0].translation, 'ใหม่');
  assert.equal(e._editorCollabBase.revision, 1); assert.equal(e._editorCollabBase.translations[0], 'เดิม');
});
test('account or source change during save never closes or replaces the new editor', async () => {
  const { editor: e, window } = saveFixture(); let finish;
  window.OfflineStore.saveWorkspaceWithRevisions = () => new Promise(resolve => { finish = resolve; });
  const saving = e.editorSave(); e.sourceIdentity = 'other-source'; const workspace = { descs: [], status: {} }; e.localDescs = workspace;
  finish(); assert.equal(await saving, false); assert.equal(e.localDescs, workspace); assert.equal(e.editorVisible, true);
});
test('collaboration modal and IME own their keys instead of triggering save-and-next', () => {
  const { editor: e } = harness(); let navigation = 0;
  e.saveAndSkipFile = () => navigation++;
  e.collaborationConflictVisible = true;
  e.handleKeydown({ code: 'F2', key: 'F2', preventDefault() {} });
  e.collaborationConflictVisible = false;
  e.handleKeydown({ code: 'F2', key: 'F2', isComposing: true, preventDefault() {} });
  assert.equal(navigation, 0);
});
test('Next Version commits source, carried translations and source history together before activation', async () => {
  const { editor: e, window, context } = harness();
  vm.runInContext('offlineStoreReady = true', context);
  e.scheduleCollaboration = () => {};
  const old = description(1); e.descs = [old]; e.localDescs = { descs: [JSON.parse(JSON.stringify(old))], status: {} };
  const next = description(1, ['', '']); next.translations.English[0] = 'Changed source';
  let writes = 0;
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async (source, workspace, revisions, game) => {
    writes++; assert.equal(e.descs[0], old, 'Activation waits for the durable transaction');
    assert.equal(game, 'poe1'); assert.equal(source[0].translations.English[0], 'Changed source');
    assert.deepEqual(Array.from(workspace.descs[0].translations.Thai), ['เดิม', 'สอง']);
    assert.equal(workspace.status[old.filepath].needsReview, true);
    assert.equal(revisions.length, 1); assert.equal(revisions[0].sourceHash, workspace.sourceHash);
  };
  await e.importUpdateZipFile({ name: 'StatDescriptions.zip', size: 123, lastModified: 1 }, [next]);
  assert.equal(writes, 1); assert.equal(e.descs[0].translations.English[0], 'Changed source'); assert.match(e.sourceIdentity, /^[a-f0-9]{64}$/);
});
test('failed source import preserves the current source, translations and version identity', async () => {
  const { editor: e, window, context, alerts } = harness();
  vm.runInContext('offlineStoreReady = true', context); e.scheduleCollaboration = () => {};
  const old = description(1); e.descs = [old]; const workspace = { descs: [old], status: {} }; e.localDescs = workspace;
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async () => { throw new Error('Quota exceeded'); };
  await e.importUpdateZipFile({ size: 123, lastModified: 1 }, [description(2)]);
  assert.equal(e.descs[0], old); assert.equal(e.localDescs, workspace); assert.equal(e.sourceIdentity, 'source-one');
  assert.match(alerts.at(-1), /Existing work is unchanged/);
});
test('translated import stages every file in one durable save and failure changes none', async () => {
  const { editor: e, window, context, writes } = harness();
  vm.runInContext('offlineStoreReady = true', context); e.testMode = false;
  e.descs = [description(1), description(2)];
  await e.importTranslatedZipFile({ name: 'StatDescriptions_Translated.zip' }, [description(1, ['หนึ่ง', 'สอง']), description(2, ['สาม', 'สี่'])]);
  assert.equal(writes.length, 1); assert.equal(writes[0].revisions.length, 2);
  const saved = JSON.stringify(e.localDescs);
  window.OfflineStore.saveWorkspaceWithRevisions = async () => { throw new Error('Quota exceeded'); };
  await e.importTranslatedZipFile({ name: 'StatDescriptions_Translated.zip' }, [description(1, ['สูญหาย', 'สอง'])]);
  assert.equal(JSON.stringify(e.localDescs), saved); assert.equal(e.descs[0].translations.Thai[0], 'หนึ่ง');
});
test('confirm unchanged saves review and export tracking even without a text change', async () => {
  const { editor: e, writes, desc } = saveFixture(); desc.needsReview = true;
  await e.confirmTranslationUnchanged();
  assert.equal(writes.length, 1); assert.equal(writes[0].workspace.status[desc.filepath].needsReview, false);
  assert.equal(writes[0].workspace.descs[0].hasChanges, true); assert.equal(writes[0].revisions[0].note, 'confirm');
});

function mergedSaveFixture() {
  const h = saveFixture(), e = h.editor, P = h.window.CollaborationProtocol;
  const initial = { filepath: h.desc.filepath, translations: ['เดิม', 'สอง'], needsReview: false, trackedForExport: true, revision: 1 };
  let shared = { ...initial, translations: ['ทีมแก้รายการแรก', 'สอง'], revision: 2 };
  let conflict = null;
  e._editorCollabBase = JSON.parse(JSON.stringify(initial));
  e.editorBlocks[0].translation = 'เดิม'; e.editorBlocks[1].translation = 'เราแก้รายการสอง';
  e._collaboration = { fileBase: () => JSON.parse(JSON.stringify(shared)), snapshot: () => ({ files: [shared] }), leaveEdit() {} };
  const persist = async (updates, origin, options = {}) => {
    const yours = { ...shared, translations: [...updates[0].lines] };
    const merged = P.mergeFile(options.bases?.[shared.filepath] || initial, yours, shared);
    if (merged.conflict) { conflict = merged; return { status: 'conflict' }; }
    shared = { ...merged.file, revision: shared.revision + 1 };
    e.applyCollaborationFiles([shared]);
    return { status: 'synced' };
  };
  e.persistTranslationBatch = persist;
  return { ...h, persist, shared: () => shared, conflict: () => conflict };
}

test('save-and-stay adopts independent remote entries before advancing the next save base', async () => {
  const { editor: e, shared } = mergedSaveFixture();
  assert.equal(await e.editorSave({ close: false }), true);
  assert.deepEqual(Array.from(e.editorBlocks, block => block.translation), ['ทีมแก้รายการแรก', 'เราแก้รายการสอง']);
  assert.deepEqual(Array.from(e.editorOriginalTranslations), ['ทีมแก้รายการแรก', 'เราแก้รายการสอง']);
  assert.equal(e.editorHaveChanges(), false); assert.equal(e.editorVisible, true);
  e.editorBlocks[1].translation = 'แก้รายการสองอีกครั้ง';
  assert.equal(await e.editorSave({ close: false }), true);
  assert.deepEqual(Array.from(shared().translations), ['ทีมแก้รายการแรก', 'แก้รายการสองอีกครั้ง']);
});

test('typing on an unseen remotely merged entry retains its old ancestor and conflicts on the next save', async () => {
  const { editor: e, persist, shared, conflict } = mergedSaveFixture();
  let finish;
  e.persistTranslationBatch = (...args) => new Promise(resolve => { finish = async () => resolve(await persist(...args)); });
  const saving = e.editorSave();
  e.editorBlocks[0].translation = 'พิมพ์บนข้อความเดิมระหว่างบันทึก';
  await finish(); assert.equal(await saving, false);
  assert.equal(e.editorVisible, true); assert.equal(e.editorHaveChanges(), true);
  assert.equal(e.editorBlocks[0].translation, 'พิมพ์บนข้อความเดิมระหว่างบันทึก');
  assert.equal(e.editorOriginalTranslations[0], 'ทีมแก้รายการแรก');
  assert.equal(e._editorCollabBase.translations[0], 'เดิม', 'Keep the ancestor the new draft was actually based on.');
  e.persistTranslationBatch = persist;
  assert.equal(await e.editorSave({ close: false }), false);
  assert.deepEqual(conflict().indexes, [0]); assert.equal(shared().translations[0], 'ทีมแก้รายการแรก');
});

test('consistency commit adopts clean remote entries while preserving unrelated drafts and their merge ancestry', async () => {
  const { editor: e, window } = harness(), P = window.CollaborationProtocol;
  const first = description(1, ['เดิม', 'รายการสอง', 'รายการสาม']);
  first.translations.English = ['Original', 'Second', 'Third']; first.variables = ['#', '#', '#']; first.remarks = ['', '', ''];
  const peer = description(2, ['ทีมเลือก', 'อื่น']); peer.translations.English = ['Original', 'Different'];
  e.descs = [first, peer]; e.localDescs = { descs: JSON.parse(JSON.stringify(e.descs)), status: {} };
  e.editorVisible = true; e.editorCurrentEditingDesc = first;
  e.editorBlocks = first.translations.English.map((english, index) => ({ english, translation: first.translations.Thai[index] }));
  e.editorOriginalTranslations = [...first.translations.Thai]; e.editorBlocks[1].translation = 'ร่างส่วนตัว';
  const initial = { filepath: first.filepath, translations: [...first.translations.Thai], needsReview: false, trackedForExport: true, revision: 1 };
  let accepted = initial;
  e._editorCollabBase = JSON.parse(JSON.stringify(initial));
  e._collaboration = { fileBase: () => JSON.parse(JSON.stringify(accepted)), snapshot: () => ({ files: [accepted] }) };
  e.persistTranslationBatch = async updates => {
    const current = updates.find(update => update.desc.filepath === first.filepath);
    accepted = { ...initial, translations: [current.lines[0], 'ทีมแก้รายการสอง', 'ทีมแก้รายการสาม'], revision: 3 };
    e.applyCollaborationFiles([accepted]);
    return { status: 'synced' };
  };
  await e.scanAllDiagnostics(); await e.openConsistencyResolver(0);
  assert.equal(await e.applyConsistencyVersion('ทีมเลือก'), true);
  assert.deepEqual(Array.from(e.editorBlocks, block => block.translation), ['ทีมเลือก', 'ร่างส่วนตัว', 'ทีมแก้รายการสาม']);
  assert.deepEqual(Array.from(e.editorOriginalTranslations), ['ทีมเลือก', 'ทีมแก้รายการสอง', 'ทีมแก้รายการสาม']);
  assert.deepEqual(Array.from(e._editorCollabBase.translations), ['ทีมเลือก', 'รายการสอง', 'ทีมแก้รายการสาม']);
  assert.equal(e.editorHaveChanges(), true); assert.equal(e.diagnosticScanCompleted, false, 'Unrelated remote changes invalidate the completed scan.');
  const nextDraft = { ...accepted, translations: e.editorBlocks.map(block => e.encodeNewlines(block.translation)) };
  assert.deepEqual(P.mergeFile(e._editorCollabBase, nextDraft, accepted).indexes, [1]);
});

test('rebasing multiline and table entries keeps their display and serialization synchronized', () => {
  const { editor: e } = saveFixture();
  e._collaboration = {};
  e.editorBlocks = [{ english: 'Original', translation: 'เดิม', isTable: false, isMultiline: false }, { english: 'Second', translation: 'สอง', isTable: false, isMultiline: false }];
  e.rebaseEditorAfterCommit({ filepath: e.descs[0].filepath, translations: ['ซ้าย\\nต่อ@ขวา', ''], revision: 2, needsReview: false, trackedForExport: true }, {
    draftBefore: ['เดิม', 'สอง'], submittedTranslations: ['เดิม', 'สอง'],
  });
  assert.equal(e.editorBlocks[0].translation, 'ซ้าย\nต่อ@ขวา'); assert.equal(e.editorBlocks[0].isTable, true);
  assert.equal(e.editorBlocks[0].tableColumns.length, 2); assert.equal(e.editorBlocks[1].translation, '');
  e.syncEditorBlockFromTableColumns(e.editorBlocks[0]);
  assert.equal(e.encodeNewlines(e.editorBlocks[0].translation), 'ซ้าย\\nต่อ@ขวา');
  assert.equal(e.editorHaveChanges(), false);
});

test('the integrated consistency save preserves unrelated manual diagnostics and refreshes its resolved group', async () => {
  const { editor: e } = harness();
  const first = description(1, ['คำแรก', 'สอง']), peer = description(2, ['คำอื่น', 'สอง']);
  const unrelated = description(3, ['ขาดตัวแปร', 'อื่น']); unrelated.translations.English = ['Unrelated {0}', 'Other'];
  e.descs = [first, peer, unrelated]; e.localDescs = { descs: JSON.parse(JSON.stringify(e.descs)), status: {} };
  e.editorVisible = true; e.editorCurrentEditingDesc = first;
  e.editorBlocks = first.translations.English.map((english, index) => ({ english, translation: first.translations.Thai[index] }));
  e.editorOriginalTranslations = [...first.translations.Thai];
  await e.scanAllDiagnostics();
  assert.equal(e.diagnosticScanCompleted, true);
  const unrelatedResult = e.diagnosticScanResults[unrelated.filepath];
  await e.openConsistencyResolver(0); assert.equal(await e.applyConsistencyVersion('คำอื่น'), true);
  assert.equal(e.diagnosticScanCompleted, true);
  assert.equal(e.diagnosticScanResults[unrelated.filepath], unrelatedResult);
  assert.deepEqual(Array.from(e.diagnosticScanResults[first.filepath].translationLines), ['คำอื่น', 'สอง']);
  assert.equal(e.editorHaveChanges(), false);
});

test('conflict resolution preserves a newer typing draft and its prior ancestor for the next save', async () => {
  const { editor: e, desc, window } = saveFixture(), P = window.CollaborationProtocol;
  const yours = { filepath: desc.filepath, translations: ['เราเคยบันทึก', 'สอง'], needsReview: false, trackedForExport: true, revision: 1 };
  const accepted = { ...yours, translations: ['เลือกเวอร์ชันทีม', 'ทีมแก้รายการสอง'], revision: 4 };
  const conflict = { id: 'conflict-one', filepath: desc.filepath, yours };
  e.editorBlocks[0].translation = 'ร่างใหม่กว่าที่กำลังแก้ข้อขัดแย้ง'; e.editorBlocks[1].translation = 'สอง';
  e._collaboration = {
    snapshot: () => ({ conflicts: [conflict] }), fileBase: () => JSON.parse(JSON.stringify(accepted)),
    resolve: async () => ({ status: 'synced' }),
  };
  assert.equal((await e.collabResolve('conflict-one', accepted.translations)).status, 'synced');
  assert.deepEqual(Array.from(e.editorBlocks, block => block.translation), ['ร่างใหม่กว่าที่กำลังแก้ข้อขัดแย้ง', 'ทีมแก้รายการสอง']);
  assert.deepEqual(Array.from(e.editorOriginalTranslations), accepted.translations);
  assert.deepEqual(Array.from(e._editorCollabBase.translations), ['เราเคยบันทึก', 'ทีมแก้รายการสอง']);
  const nextDraft = { ...accepted, translations: e.editorBlocks.map(block => e.encodeNewlines(block.translation)) };
  assert.deepEqual(P.mergeFile(e._editorCollabBase, nextDraft, accepted).indexes, [0]);
});

test('only known pending-sync notices clear after reconnect fully synchronizes', async () => {
  const { editor: e, window } = harness(); let callbacks;
  e.testMode = false; e.offlineStoreReady = true; e.cloudSignedIn = true; e.cloudUser = { id: 'translator', language: 'Thai' };
  e.descs = [description(1)]; e.localDescs = { descs: [], status: {} };
  e._cloud = { apiBase: 'https://api.example', context() { return {}; }, request() {} };
  window.CollaborationSync = { Client: class {
    constructor(options) { callbacks = options; }
    async connect() {} select() {} snapshot() { return {}; }
  } };
  await e.initializeCollaboration();
  const synced = { connected: true, pending: 0, conflicts: [] };
  e.collaborationNotice = 'Saved locally · Pending sync'; callbacks.onChange(synced); assert.equal(e.collaborationNotice, '');
  e.collaborationNotice = 'Imported 12 translated files · Pending sync'; callbacks.onChange(synced); assert.equal(e.collaborationNotice, 'Imported 12 translated files.');
  e.collaborationNotice = 'No available files in this direction.'; callbacks.onChange(synced); assert.match(e.collaborationNotice, /No available/);
  e.collaborationNotice = 'Fix the variable error.'; callbacks.onChange(synced); assert.equal(e.collaborationNotice, 'Fix the variable error.');
});

test('same-language reassignment disconnects the old collaboration client before reconnecting', async () => {
  const { editor: e, window } = harness(); let disconnected = 0, clients = 0;
  e.testMode = false; e.offlineStoreReady = true; e.cloudSignedIn = true;
  e.cloudUser = { id: 'translator', language: 'Thai', assignmentVersion: 1 };
  e.descs = [description(1)]; e.localDescs = { descs: [], status: {} };
  e._cloud = { apiBase: 'https://api.example', context() { return {}; }, request() {} };
  window.CollaborationSync = { Client: class {
    constructor() { clients++; }
    async connect() {} select() {} setAway() {} snapshot() { return {}; }
    disconnect() { disconnected++; }
  } };
  await e.initializeCollaboration();
  const previous = e._collaboration;
  e.cloudUser.assignmentVersion = 2;
  e.scheduleCollaboration();
  assert.equal(disconnected, 1);
  assert.equal(e._collaboration, null);
  clearTimeout(e._collabStartTimer);
  await e.initializeCollaboration();
  assert.equal(clients, 2);
  assert.notEqual(e._collaboration, previous);
});

test('shared conflict resolution rejects missing source table columns before queueing a save', async () => {
  const { editor: e, desc } = saveFixture();
  desc.translations.English[0] = 'Left@Right';
  let submitted = false;
  e._collaboration = {
    snapshot: () => ({ conflicts: [{ id: 'table-conflict', filepath: desc.filepath }] }),
    resolve: async () => { submitted = true; return { status: 'synced' }; },
  };
  await assert.rejects(e.collabResolve('table-conflict', ['Left only', 'สอง']), /table column count/);
  assert.equal(submitted, false);
});

test('shared-history restore advances a clean editor base but retains a dirty draft ancestor', async () => {
  for (const dirty of [false, true]) {
    const { editor: e, desc } = saveFixture();
    const initial = { filepath: desc.filepath, translations: [...desc.translations.Thai], revision: 2, needsReview: false, trackedForExport: true };
    let current = initial, opened = false;
    e._editorCollabBase = JSON.parse(JSON.stringify(initial));
    if (!dirty) e.editorBlocks.forEach((block, index) => { block.translation = desc.translations.Thai[index]; });
    e._collaboration = { fileBase: () => JSON.parse(JSON.stringify(current)), historyEntry: async () => ({ filepath: desc.filepath, after: { ...initial, translations: ['ประวัติ', 'สอง'] } }) };
    e.persistTranslationBatch = async updates => { current = { ...initial, translations: [...updates[0].lines], revision: 3 }; return { status: 'synced' }; };
    e.openEditorFile = () => { opened = true; };
    await e.collabRestoreHistory(1, 'after', 2);
    assert.equal(opened, !dirty);
    assert.equal(e._editorCollabBase.revision, dirty ? 2 : 3);
    assert.equal(e._editorCollabBase.translations[0], dirty ? 'เดิม' : 'ประวัติ');
    if (dirty) assert.equal(e.editorBlocks[0].translation, 'ใหม่');
  }
});
