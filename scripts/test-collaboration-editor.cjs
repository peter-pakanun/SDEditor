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
    OfflineStore: { async saveWorkspaceWithRevisions(workspace, revisions, game) { writes.push(structuredClone({ workspace, revisions, game })); } } };
  const context = vm.createContext({ window, URLSearchParams, console, setTimeout, clearTimeout,
    alert: () => assert.fail('Native alerts must not be used'), confirm: () => assert.fail('Native confirmations must not be used'),
    document: { activeElement: null, body: {}, querySelector: () => null },
    Vue: { nextTick(fn) { fn?.(); return Promise.resolve(); }, defineComponent(value) { config = value; return value; },
      createApp: () => ({ component() {}, directive() {}, mount() {} }) } });
  for (const file of ['workspaceState.js', 'helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'collaborationIntegration.js', 'index.js']) {
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
  return { editor, window, writes, alerts, context, config };
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
function droppedReviewFixture() {
  const h = harness(), e = h.editor;
  const previous = description(1, ['Translation approved for the original source', 'Second translation']);
  previous.hasChanges = false;
  const current = JSON.parse(JSON.stringify(previous));
  current.translations.English = ['Changed source', 'Second'];
  current.translations.Thai = ['', ''];
  const workspace = { sourceHash: 'previous-source', descs: [], status: {} };
  h.window.WorkspaceState.initializeWorkspace(workspace, {
    source: [previous], sourceHash: 'previous-source', game: 'poe1', language: 'Thai',
  });
  h.window.WorkspaceState.stageTranslation(workspace, { filepath: previous.filepath,
    translations: previous.translations.Thai }, 'Thai', { source: [previous], sourceHash: 'previous-source', game: 'poe1' });
  h.window.WorkspaceState.upgradeSource(workspace, { previousSource: [previous], source: [current],
    previousSourceHash: 'previous-source', sourceHash: e.sourceIdentity, game: 'poe1' });
  e.localDescs = workspace; e.descs = [current]; e.testMode = false;
  e._workspaceSourceBaseline = [JSON.parse(JSON.stringify(current))];
  e.applyWorkspaceOverlay(); e.filterDesc();
  e.editorVisible = true; e.editorCurrentEditingDesc = current;
  e.editorOriginalTranslations = [...current.translations.Thai];
  e.editorBlocks = current.translations.English.map((english, index) => ({ english,
    translation: current.translations.Thai[index], isTable: false }));
  return { ...h, previous, desc: current };
}
function droppedConflictFixture() {
  const h = droppedReviewFixture(), e = h.editor;
  const candidate = JSON.parse(JSON.stringify(h.window.WorkspaceState.droppedForFile(e.localDescs, h.desc.filepath, 'Thai')));
  const conflict = { game: e.gameVersion, language: e.lang, filepath: h.desc.filepath, targetSourceHash: e.sourceIdentity, kind: 'put', yours: candidate,
    shared: { ...candidate, id: 'shared-copy', revision: 2,
      snapshot: { ...candidate.snapshot, translations: ['Shared preserved translation', 'Second shared translation'] } } };
  h.window.WorkspaceState.recordDroppedConflict(e.localDescs, conflict);
  e.editorDroppedCandidate = candidate;
  e.editorBlocks = h.desc.translations.English.map((english, index) => ({ english,
    translation: candidate.snapshot.translations[index], isTable: false }));
  e.editorOriginalTranslations = [...candidate.snapshot.translations];
  const calls = [], opened = [];
  e._collaboration = { async resolveDroppedConflict(filepath, choice) {
    calls.push({ filepath, choice }); h.window.WorkspaceState.resolveDroppedConflict(e.localDescs, filepath, e.lang, choice);
  } };
  e.openEditorFile = async filepath => { opened.push(filepath); e.seedEditorOpenSource({ desc: h.desc }); };
  return { ...h, candidate, conflict, calls, opened };
}
function removedDroppedConflictFixture() {
  const h = droppedConflictFixture(), e = h.editor;
  e.descs = []; e._workspaceSourceBaseline = [];
  e.editorVisible = false; e.editorCurrentEditingDesc = null;
  e.editorDroppedCandidate = null; e.editorBlocks = [];
  return h;
}
function historyRecoveryFixture() {
  const h = saveFixture(), e = h.editor, desc = h.desc;
  h.context.crypto = require('node:crypto').webcrypto;
  desc.hasChanges = false;
  const baseline = JSON.parse(JSON.stringify(desc));
  e._workspaceSourceBaseline = [baseline];
  e.localDescs = { sourceHash: e.sourceIdentity, descs: [], status: {} };
  h.window.WorkspaceState.initializeWorkspace(e.localDescs, {
    source: [baseline], sourceHash: e.sourceIdentity, game: e.gameVersion, language: e.lang,
  });
  let durable = JSON.parse(JSON.stringify(e.localDescs));
  h.window.OfflineStore.updateWorkspace = async (update, game, options = {}) => {
    const next = update(JSON.parse(JSON.stringify(durable)));
    durable = JSON.parse(JSON.stringify(next));
    h.writes.push(structuredClone({ workspace: durable, revisions: options.revisions || [], game }));
    return JSON.parse(JSON.stringify(durable));
  };
  h.window.OfflineStore.saveWorkspaceWithRevisions = async (workspace, revisions, game) => {
    durable = JSON.parse(JSON.stringify(workspace));
    h.writes.push(structuredClone({ workspace: durable, revisions, game }));
  };
  const opened = [];
  e.openEditorFile = async filepath => {
    opened.push(filepath); e.editorVisible = true; e.editorCurrentEditingDesc = desc;
    e.seedEditorOpenSource({ desc }); return true;
  };
  e.refreshHistory = async () => {};
  e.applyWorkspaceOverlay(); e.seedEditorOpenSource({ desc });
  const revision = { id: 'legacy-review-entry', filepath: desc.filepath, lang: e.lang,
    sourceHash: e.sourceIdentity, needsReview: true, translations: ['Recovered original translation', 'Recovered second translation'] };
  return { ...h, baseline, revision, opened };
}
function diagnosticSaveFixture() {
  const h = saveFixture(), e = h.editor, first = h.desc;
  h.context.document.createElement = () => ({ get value() { return this.innerHTML; } });
  const remaining = description(2, ['ยังขาดตัวแปร', 'สอง']);
  const clean = description(3, ['ครบ {0}', 'สอง']);
  first.translations.English[0] = 'First {0}';
  remaining.translations.English[0] = 'Remaining {0}';
  clean.translations.English[0] = 'Clean {0}';
  e.descs = [first, remaining, clean];
  e.editorBlocks[0] = { english: first.translations.English[0], translation: 'แก้แล้ว {0}' };
  e.diagnosticScanChecks = Object.fromEntries(e.diagnosticScanTypes.map(type => [type.key, type.key === 'variables']));
  e.selectedFileFilters = ['diagnosticError'];
  return { ...h, remaining, clean };
}

function enablePending(h) {
  const { editor: e, window, context } = h;
  const calls = [], downloads = [], listeners = new Map();
  context.crypto = require('node:crypto').webcrypto;
  context.Blob = Blob;
  context.saveAs = (blob, filename) => downloads.push({ blob, filename });
  window.PendingSaves = require('../public/pendingSaves.js');
  window.SaveWorkerClient = { create: () => ({
    save: batch => new Promise((resolve, reject) => calls.push({ batch, resolve, reject })),
  }) };
  window.addEventListener = (name, handler) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(handler);
  };
  window.removeEventListener = (name, handler) => listeners.get(name)?.delete(handler);
  e.localDescs = { descs: JSON.parse(JSON.stringify(e.descs)), status: {}, sourceHash: e.sourceIdentity };
  function acknowledge(call, extra = {}) {
    call.resolve({ jobId: call.batch.jobId, status: call.batch.collaboration ? 'pending' : 'local', files: call.batch.files,
      ...(call.batch.collaboration ? { operation: { id: call.batch.jobId, origin: 'save', status: 'pending',
        files: call.batch.files.map(file => ({ base: call.batch.collaboration.bases[file.filepath] || null, yours: file })) } } : {}), ...extra });
  }
  function warnsBeforeUnload() {
    let prevented = false;
    const event = { preventDefault() { prevented = true; }, returnValue: undefined };
    for (const listener of listeners.get('beforeunload') || []) listener(event);
    return prevented;
  }
  return { ...h, calls, downloads, acknowledge, warnsBeforeUnload };
}
const pendingTick = () => new Promise(resolve => setTimeout(resolve, 5));
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

test('saving a diagnostic correction preserves the completed scan and remaining error filter', async () => {
  for (const close of [true, false]) {
    const { editor: e, desc, remaining, clean, writes, alerts } = diagnosticSaveFixture();
    await e.scanAllDiagnostics();
    assert.equal(e.diagnosticScanErrorFileCount, 2);
    const untouchedResult = e.diagnosticScanResults[remaining.filepath];
    const cleanResult = e.diagnosticScanResults[clean.filepath];
    const scanId = e.diagnosticScanRunId, appliedChecks = e.diagnosticScanAppliedChecks;
    assert.equal(await e.editorSave({ close }), true, JSON.stringify({ alerts, notice: e.collaborationNotice }));
    assert.equal(writes.length, 1);
    assert.equal(e.diagnosticScanCompleted, true);
    assert.equal(e.diagnosticScanRunId, scanId);
    assert.equal(e.diagnosticScanAppliedChecks, appliedChecks);
    assert.equal(e.diagnosticScanProcessed, 3); assert.equal(e.diagnosticScanTotal, 3);
    assert.equal(e.diagnosticScanResults[desc.filepath].hasDiagnosticError, false);
    assert.equal(e.diagnosticScanResults[remaining.filepath], untouchedResult);
    assert.equal(e.diagnosticScanResults[clean.filepath], cleanResult);
    assert.equal(e.diagnosticScanErrorFileCount, 1);
    assert.deepEqual(Array.from(e.diagnosticScanResultFiles, result => result.filepath), [remaining.filepath]);
    assert.deepEqual(Array.from(e.selectedFileFilters), ['diagnosticError']);
    assert.deepEqual(Array.from(e.filteredDescs, item => item.filepath), [remaining.filepath]);
    assert.equal(e.editorVisible, !close);
  }
});

test('optimistic worker Save & close retains remaining diagnostics before and after acknowledgment', async () => {
  const { editor: e, desc, remaining, calls, acknowledge } = enablePending(diagnosticSaveFixture());
  await e.scanAllDiagnostics();
  const untouchedResult = e.diagnosticScanResults[remaining.filepath];
  const scanId = e.diagnosticScanRunId, appliedChecks = e.diagnosticScanAppliedChecks;
  assert.equal(await e.editorSave(), true);
  assert.equal(e.editorVisible, false); assert.equal(e.pendingLocalSaves, 1);
  const correctedResult = e.diagnosticScanResults[desc.filepath];
  const assertRemainingDiagnostics = () => {
    assert.equal(e.diagnosticScanCompleted, true);
    assert.equal(e.diagnosticScanRunId, scanId);
    assert.equal(e.diagnosticScanAppliedChecks, appliedChecks);
    assert.equal(e.diagnosticScanResults[desc.filepath], correctedResult);
    assert.equal(correctedResult.hasDiagnosticError, false);
    assert.equal(e.diagnosticScanResults[remaining.filepath], untouchedResult);
    assert.equal(e.diagnosticScanErrorFileCount, 1);
    assert.deepEqual(Array.from(e.diagnosticScanResultFiles, result => result.filepath), [remaining.filepath]);
    assert.deepEqual(Array.from(e.selectedFileFilters), ['diagnosticError']);
    assert.deepEqual(Array.from(e.filteredDescs, item => item.filepath), [remaining.filepath]);
  };
  assertRemainingDiagnostics();
  await pendingTick(); assert.equal(calls.length, 1);
  acknowledge(calls[0]); await e._pendingSaves.drain();
  assert.equal(e.pendingLocalSaves, 0); assert.equal(e.editorVisible, false);
  assertRemainingDiagnostics();
});

test('save-and-next advances to the remaining diagnostic file after removing the corrected error', async () => {
  const { editor: e, remaining } = diagnosticSaveFixture(), opened = [];
  await e.scanAllDiagnostics();
  e.editFile = async filepath => {
    opened.push(filepath); e.editorCurrentEditingDesc = e.getDescByFilepath(filepath); return true;
  };
  assert.equal(await e.saveAndSkipFile(), true);
  assert.equal(e.diagnosticScanCompleted, true);
  assert.equal(e.diagnosticScanErrorFileCount, 1);
  assert.deepEqual(opened, [remaining.filepath]);
  assert.deepEqual(Array.from(e.filteredDescs, item => item.filepath), [remaining.filepath]);
});

test('remote corrections refresh completed diagnostic results while metadata-only updates preserve them', async () => {
  const { editor: e, window, desc, remaining } = diagnosticSaveFixture();
  await e.scanAllDiagnostics();
  const scanId = e.diagnosticScanRunId;
  const firstResult = e.diagnosticScanResults[desc.filepath];
  const remainingResult = e.diagnosticScanResults[remaining.filepath];
  e.applyCollaborationFiles([{ filepath: desc.filepath, translations: [...desc.translations.Thai], needsReview: true, trackedForExport: false }]);
  assert.equal(desc.needsReview, false); assert.equal(desc.hasChanges, false);
  assert.deepEqual(Array.from(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai').snapshot.translations), Array.from(desc.translations.Thai));
  assert.equal(e.diagnosticScanResults[desc.filepath], firstResult);
  assert.equal(e.diagnosticScanCompleted, true);
  e.applyCollaborationFiles([{ filepath: remaining.filepath, translations: ['ทีมแก้แล้ว {0}', 'สอง'], needsReview: false, trackedForExport: true }]);
  assert.equal(e.diagnosticScanCompleted, true);
  assert.equal(e.diagnosticScanRunId, scanId);
  assert.equal(e.diagnosticScanResults[desc.filepath], firstResult);
  assert.notEqual(e.diagnosticScanResults[remaining.filepath], remainingResult);
  assert.equal(e.diagnosticScanResults[remaining.filepath].hasDiagnosticError, false);
  assert.equal(e.diagnosticScanErrorFileCount, 1);
  assert.deepEqual(Array.from(e.filteredDescs, item => item.filepath), [desc.filepath]);
  assert.equal(e.editorBlocks[0].translation, 'แก้แล้ว {0}', 'Remote updates leave the current unsaved draft intact.');
});
test('typing while storage is committing remains an unsaved open draft', async () => {
  const { editor: e, window, desc } = saveFixture();
  let finish;
  window.OfflineStore.saveWorkspaceWithRevisions = () => new Promise(resolve => { finish = resolve; });
  const saving = e.editorSave(); e.editorBlocks[0].translation = 'พิมพ์ต่อ'; finish();
  assert.equal(await saving, false); assert.equal(e.editorVisible, true);
  assert.equal(desc.translations.Thai[0], 'ใหม่'); assert.equal(e.editorBlocks[0].translation, 'พิมพ์ต่อ'); assert.equal(e.editorHaveChanges(), true);
});

test('closing a saved editor skips settings and highlights while save-and-stay refreshes them', async () => {
  for (const close of [true, false]) {
    const { editor: e } = saveFixture();
    let settings = 0, highlights = 0, previews = 0;
    e.saveSettings = () => { settings++; };
    e.refreshEditorHLter = () => { highlights++; };
    e.refreshGamePreview = () => { previews++; };
    assert.equal(await e.editorSave({ close }), true);
    assert.equal(e.editorHaveChanges(), false);
    assert.equal(settings, 0, 'Preference watchers already persist settings independently of translations.');
    assert.equal(highlights, close ? 0 : 1); assert.equal(previews, close ? 0 : 1);
  }
});

test('typing during a closing save retains an open draft with refreshed highlights', async () => {
  const { editor: e, window } = saveFixture();
  let finish, highlights = 0, previews = 0;
  window.OfflineStore.saveWorkspaceWithRevisions = () => new Promise(resolve => { finish = resolve; });
  e.refreshEditorHLter = () => { highlights++; }; e.refreshGamePreview = () => { previews++; };
  const saving = e.editorSave(); e.editorBlocks[0].translation = 'ร่างที่พิมพ์ต่อ'; finish();
  assert.equal(await saving, false); assert.equal(e.editorVisible, true);
  assert.equal(e.editorHaveChanges(), true); assert.equal(highlights, 1); assert.equal(previews, 1);
});

test('a collaboration save stages only its file and retains unrelated remote updates during commit', async () => {
  const { editor: e, desc } = saveFixture(), other = description(2);
  e.descs.push(other);
  e.localDescs = { descs: JSON.parse(JSON.stringify(e.descs)), status: { [desc.filepath]: { custom: 'kept' } } };
  const workspace = e.localDescs, untouched = workspace.descs[1];
  let finish, payload;
  const plain = e.toPlainForStorage;
  e.toPlainForStorage = value => {
    assert.notEqual(value, workspace, 'Do not clone the whole archive for an ordinary collaboration save.');
    return plain.call(e, value);
  };
  e._collaboration = {
    save: options => { payload = options; return new Promise(resolve => { finish = resolve; }); },
    snapshot() { assert.fail('A one-file save must not request every collaboration file.'); },
    fileBase: () => ({ ...e.collaborationFile(desc), translations: ['ใหม่', 'สอง'], revision: 2 }),
    leaveEdit() {},
  };
  const saving = e.editorSave();
  assert.equal(payload.workspace.descs.length, 1); assert.equal(payload.workspace.status[desc.filepath].custom, 'kept');
  e.applyCollaborationFiles([{ filepath: other.filepath, translations: ['ทีมแก้ระหว่างบันทึก', 'สอง'], trackedForExport: true, needsReview: false }]);
  let applied;
  const apply = e.applyCollaborationFiles;
  e.applyCollaborationFiles = files => { applied = files.map(file => file.filepath); apply.call(e, files); };
  finish({ status: 'pending' });
  assert.equal(await saving, true); assert.deepEqual(Array.from(applied), [desc.filepath]);
  assert.equal(e.localDescs, workspace); assert.equal(workspace.descs[1], untouched);
  assert.equal(other.translations.Thai[0], 'ทีมแก้ระหว่างบันทึก');
  assert.equal(untouched.translations.Thai[0], 'ทีมแก้ระหว่างบันทึก');
  assert.equal(workspace.status[desc.filepath].custom, 'kept');
});

test('Save & close and save-and-next finish after local commit while online sync is still waiting', async t => {
  for (const navigate of [false, true]) await t.test(navigate ? 'save-and-next' : 'Save & close', async t => {
    const { editor: e, desc, window, writes } = saveFixture();
    const { Client } = require('../public/collaborationSync.js');
    const next = description(2, ['', '']); next.isMissing = true;
    e.descs.push(next); e.filterDesc();
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

test('startup shared data preserves the ancestor of a draft opened before collaboration was ready', () => {
  const { editor: e, window } = saveFixture();
  const shared = { filepath: e.descs[0].filepath, translations: ['ทีม', 'สอง'], trackedForExport: true, needsReview: false, revision: 2 };
  e._editorCollabBase = undefined; e._collaboration = { fileBase: () => shared };
  e.applyCollaborationFiles([shared]);
  assert.deepEqual([...e._editorCollabBase.translations], ['เดิม', 'สอง']);
  assert.equal(e.editorBlocks[0].translation, 'ใหม่');
  const merged = window.CollaborationProtocol.mergeFile(e._editorCollabBase,
    { ...e._editorCollabBase, translations: ['ใหม่', 'สอง'] }, shared);
  assert.deepEqual(merged.indexes, [0], 'An unseen startup edit must conflict with the older typing draft.');
});

test('empty and equivalent shared data preserve display snapshots and Lookup caches', () => {
  const { editor: e } = saveFixture(); let filters = 0;
  e.filterDesc = () => { filters++; };
  e.applyCollaborationFiles([]); assert.equal(filters, 0);
  const files = [{ filepath: e.descs[0].filepath, translations: ['เดิม', 'สอง'], trackedForExport: true, needsReview: false }];
  e.applyCollaborationFiles(files);
  filters = 0; const translation = e.descs[0].translations.Thai, saved = e.localDescs.descs[0].translations.Thai;
  e.applyCollaborationFiles(files);
  assert.equal(filters, 0); assert.equal(e.descs[0].translations.Thai, translation);
  assert.equal(e.localDescs.descs[0].translations.Thai, saved);
});

test('large shared batches refresh the list and diagnostics once while preserving the current draft', async () => {
  const { editor: e } = saveFixture(); const draft = e.editorBlocks, base = { revision: 1 };
  e._editorCollabBase = base;
  e.descs = Array.from({ length: 130 }, (_, index) => description(index + 1));
  const files = e.descs.map(desc => ({ filepath: desc.filepath, translations: ['ทีมแก้แล้ว', 'สอง'], trackedForExport: true, needsReview: false }));
  let filters = 0; const refreshed = [], work = [];
  e.filterDesc = () => { filters++; };
  e.updateScannedDescDiagnostics = paths => refreshed.push([...paths]);
  e.setBrowserWork = (scope, value) => work.push({ scope, ...value });
  await e.receiveCollaborationFiles(files);
  assert.equal(filters, 1); assert.equal(refreshed.length, 1); assert.equal(refreshed[0].length, 130);
  assert.ok(e.descs.every(desc => desc.translations.Thai[0] === 'ทีมแก้แล้ว'));
  assert.equal(e.editorBlocks, draft); assert.equal(e._editorCollabBase, base);
  assert.equal(work[0].active, true); assert.equal(work.at(-1).active, false);
});

test('a large pending shared batch cannot touch a workspace selected before its first paint', async () => {
  const { editor: e } = saveFixture(); const original = e.descs[0].translations.Thai;
  const files = Array.from({ length: 100 }, () => ({ filepath: e.descs[0].filepath, translations: ['obsolete', 'สอง'], trackedForExport: true }));
  const pending = e.receiveCollaborationFiles(files);
  e.sourceIdentity = 'new-source';
  await pending;
  assert.equal(e.descs[0].translations.Thai, original);
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
test('Next Version commits source, separate dropped translations and source history before activation', async () => {
  const { editor: e, window, context } = harness();
  vm.runInContext('offlineStoreReady = true', context);
  e.scheduleCollaboration = () => {};
  const old = description(1); e.descs = [old]; e.localDescs = { descs: [JSON.parse(JSON.stringify(old))], status: {} };
  const next = description(1, ['', '']); next.translations.English[0] = 'Changed source';
  let writes = 0;
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async (source, workspace, revisions, game) => {
    writes++; assert.equal(e.descs[0], old, 'Activation waits for the durable transaction');
    assert.equal(game, 'poe1'); assert.equal(source[0].translations.English[0], 'Changed source');
    assert.deepEqual(Array.from(workspace.descs[0].translations.Thai), ['', '']);
    const candidate = window.WorkspaceState.droppedForFile(workspace, old.filepath, 'Thai');
    assert.deepEqual(Array.from(candidate.snapshot.translations), ['เดิม', 'สอง']);
    assert.deepEqual(Array.from(candidate.snapshot.english), ['Original', 'Second']);
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
test('translated import resolves every replaced dropped copy in one atomic workspace save', async () => {
  const { editor: e, window, context, writes, desc } = droppedReviewFixture();
  vm.runInContext('offlineStoreReady = true', context);
  const second = description(2, ['', '']); second.hasChanges = false;
  second.translations.English[0] = 'Second changed English';
  const previous = JSON.parse(JSON.stringify(second));
  previous.translations.English[0] = 'Second original English'; previous.translations.Thai = ['Second old candidate', 'Second old line'];
  e._workspaceSourceBaseline.push(JSON.parse(JSON.stringify(second))); e.descs.push(second);
  window.WorkspaceState.dropTranslation(e.localDescs, previous, 'Thai', {
    game: e.gameVersion, originSourceHash: 'second-previous-source', targetSourceHash: e.sourceIdentity,
  });
  e.applyWorkspaceOverlay();
  const candidates = e.descs.map(file => window.WorkspaceState.droppedForFile(e.localDescs, file.filepath, 'Thai'));
  assert.equal(candidates.filter(Boolean).length, 2);
  const imported = JSON.parse(JSON.stringify(e.descs));
  imported[0].translations.Thai = ['First imported replacement', 'First second line'];
  imported[1].translations.Thai = ['Second imported replacement', 'Second second line'];
  const before = JSON.parse(JSON.stringify(e.localDescs));
  const persist = window.OfflineStore.saveWorkspaceWithRevisions;
  window.OfflineStore.saveWorkspaceWithRevisions = async () => { throw new Error('Quota exceeded'); };
  await e.importTranslatedZipFile({ name: 'StatDescriptions_Translated.zip' }, imported);
  assert.equal(writes.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(e.localDescs)), before);
  assert.ok(e.descs.every(file => file.needsReview && !file.hasChanges && file.translations.Thai.every(text => !text)));
  window.OfflineStore.saveWorkspaceWithRevisions = persist;
  await e.importTranslatedZipFile({ name: 'StatDescriptions_Translated.zip' }, imported);
  assert.equal(writes.length, 1, e.collaborationNotice);
  assert.equal(writes[0].revisions.length, 2);
  for (const [index, file] of [desc, second].entries()) {
    assert.equal(window.WorkspaceState.droppedForFile(e.localDescs, file.filepath, 'Thai'), null);
    assert.equal(writes[0].workspace.droppedArchive[candidates[index].id].status, 'promoted');
    assert.deepEqual(Array.from(writes[0].workspace.staged.Thai[file.filepath].translations), imported[index].translations.Thai);
    assert.equal(file.hasChanges, true); assert.equal(file.needsReview, false);
  }
});
test('an older review confirmation stages unchanged text without persisting authoritative status flags', async () => {
  const { editor: e, writes, window, desc } = saveFixture(); desc.needsReview = true;
  await e.confirmTranslationUnchanged();
  assert.equal(writes.length, 1); assert.equal(writes[0].workspace.status[desc.filepath].needsReview, undefined);
  assert.equal(writes[0].workspace.descs[0].hasChanges, undefined);
  assert.equal(window.WorkspaceState.workspaceFile(writes[0].workspace, desc, 'Thai').hasChanges, true);
  assert.deepEqual(Array.from(writes[0].workspace.staged.Thai[desc.filepath].translations), ['เดิม', 'สอง']);
  assert.equal(writes[0].revisions[0].note, 'confirm');
});

test('confirm dropped translation stages the candidate text instead of the missing current translation', async () => {
  const { editor: e, window, writes, desc, previous } = droppedReviewFixture();
  assert.deepEqual(Array.from(desc.translations.Thai), ['', '']);
  assert.equal(desc.isMissing, true); assert.equal(desc.hasChanges, false);
  await e.confirmTranslationUnchanged();
  assert.equal(writes.length, 1, e.collaborationNotice);
  assert.deepEqual(Array.from(desc.translations.Thai), previous.translations.Thai);
  assert.equal(desc.isMissing, false); assert.equal(desc.hasChanges, true);
  assert.equal(desc.needsReview, false);
  assert.equal(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai'), null);
  assert.deepEqual(Array.from(writes[0].workspace.staged.Thai[desc.filepath].translations), previous.translations.Thai);
});

test('Confirm unchanged can promote a Dropped copy beside complete current ZIP text after showing its source diff', async () => {
  const { editor: e, window, writes, desc, previous } = droppedReviewFixture();
  e._workspaceSourceBaseline[0].translations.Thai = ['Complete current ZIP text', 'Second current ZIP line'];
  e.applyWorkspaceOverlay(); e.seedEditorOpenSource({ desc });
  assert.equal(desc.isDropped, true); assert.equal(desc.isMissing, false); assert.equal(desc.hasChanges, false);
  assert.equal(e.editorBlocks[0].translation, 'Complete current ZIP text');
  const comparisons = [];
  e.renderInlineDiffHtml = (oldText, newText) => { comparisons.push([oldText, newText]); return ''; };
  await e.prepareEditorEnglishDiff();
  assert.deepEqual(comparisons, previous.translations.English.map((oldText, index) => [oldText, desc.translations.English[index]]));
  await e.confirmTranslationUnchanged();
  assert.equal(writes.length, 1, e.collaborationNotice);
  assert.deepEqual(Array.from(desc.translations.Thai), previous.translations.Thai);
  assert.equal(desc.hasChanges, true); assert.equal(desc.isDropped, false);
  assert.equal(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai'), null);
});

test('a valid current ZIP draft cannot authorize promotion of a different Dropped copy with invalid tags', async () => {
  const { editor: e, window, writes, alerts, desc } = droppedReviewFixture();
  const baseline = e._workspaceSourceBaseline[0];
  baseline.translations.English[0] = 'Current source {0}'; desc.translations.English[0] = baseline.translations.English[0];
  baseline.translations.Thai = ['Valid current ZIP translation {0}', 'Second current ZIP line'];
  window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai').snapshot.translations[0] = 'Malformed dropped variable {0';
  e.applyWorkspaceOverlay(); e.seedEditorOpenSource({ desc }); e.refreshEditorDiagnostics();
  assert.equal(e.collectEditorDiagnostics('error').length, 0);
  assert.equal(e.editorBlocks[0].translation, 'Valid current ZIP translation {0}');
  const before = JSON.parse(JSON.stringify(e.localDescs));
  await e.confirmTranslationUnchanged();
  assert.equal(writes.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(e.localDescs)), before);
  assert.deepEqual(Array.from(desc.translations.Thai), ['Valid current ZIP translation {0}', 'Second current ZIP line']);
  assert.equal(desc.isDropped, true); assert.equal(desc.hasChanges, false);
  assert.match(alerts.at(-1), /dropped translation has errors/);
});

test('modern Dropped state is never sent as an authored legacy collaboration review flag', () => {
  const { editor: e, window, desc, previous } = droppedReviewFixture();
  assert.equal(desc.isDropped, true);
  const file = e.collaborationFile(desc);
  assert.equal(file.needsReview, false);
  assert.equal(file.trackedForExport, false);
  assert.deepEqual(Array.from(file.translations), ['', '']);
  assert.deepEqual(Array.from(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai').snapshot.translations),
    previous.translations.Thai);
});

test('an older shared Needs Review flag does not replace an existing dropped snapshot with current source context', () => {
  const { editor: e, window, desc } = droppedReviewFixture();
  const before = JSON.parse(JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai')));
  e.applyCollaborationFiles([{ filepath: desc.filepath, translations: ['', ''], needsReview: true,
    trackedForExport: false, revision: 0 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai'))), before);
  assert.equal(Object.keys(e.localDescs.droppedArchive).length, 1);
  assert.deepEqual(Array.from(desc.translations.Thai), ['', '']);
});

test('a failed dropped promotion preserves its candidate and leaves current text unstaged', async () => {
  const { editor: e, window, writes, desc } = droppedReviewFixture();
  const before = JSON.parse(JSON.stringify(e.localDescs));
  window.OfflineStore.saveWorkspaceWithRevisions = async () => { throw new Error('Quota exceeded'); };
  await e.confirmTranslationUnchanged();
  assert.equal(writes.length, 0);
  assert.deepEqual(Array.from(desc.translations.Thai), ['', '']);
  assert.equal(desc.hasChanges, false); assert.equal(desc.needsReview, true);
  assert.deepEqual(JSON.parse(JSON.stringify(e.localDescs)), before);
  assert.match(e.collaborationNotice, /Could not save the dropped translation: Quota exceeded/);
});

test('a dropped candidate updated while confirmation is open cannot promote the stale snapshot', async () => {
  const { editor: e, window, writes, desc } = droppedReviewFixture();
  const captured = JSON.parse(JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai')));
  e.editorDroppedCandidate = captured;
  let finish;
  e.appConfirm = () => new Promise(resolve => { finish = resolve; });
  const confirming = e.confirmTranslationUnchanged();
  const replacement = { ...captured, revision: captured.revision + 1,
    snapshot: { ...captured.snapshot, translations: ['Peer updated candidate', 'Second translation'] } };
  e.localDescs.dropped.Thai[desc.filepath] = replacement;
  finish(true); await confirming;
  assert.equal(writes.length, 0);
  assert.deepEqual(Array.from(desc.translations.Thai), ['', '']);
  assert.equal(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai').revision, replacement.revision);
  assert.deepEqual(Array.from(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai').snapshot.translations), replacement.snapshot.translations);
});

test('source availability changing during confirmation requires fresh dropped review without replacing the captured draft', async () => {
  const { editor: e, window, writes, desc } = droppedReviewFixture();
  const captured = JSON.parse(JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai')));
  e.editorDroppedCandidate = captured;
  const blocks = e.editorBlocks;
  let finish;
  e.appConfirm = () => new Promise(resolve => { finish = resolve; });
  const confirming = e.confirmTranslationUnchanged();
  e.localDescs.dropped.Thai[desc.filepath] = { ...captured, revision: captured.revision + 1,
    originSourceAvailable: false };
  finish(true); await confirming;
  assert.equal(writes.length, 0); assert.equal(e.editorDroppedCandidate, captured);
  assert.equal(e.editorBlocks, blocks);
  assert.deepEqual(Array.from(desc.translations.Thai), ['', '']);
  assert.match(e.collaborationNotice, /dropped translation changed.*Reopen this file/);
});

test('saving a replacement resolves the dropped candidate while a failed save preserves it', async () => {
  const { editor: e, window, writes, desc, previous } = droppedReviewFixture();
  const candidate = JSON.parse(JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai')));
  e.editorBlocks[0].translation = 'Reviewed replacement'; e.editorBlocks[1].translation = 'Second replacement';
  const persist = window.OfflineStore.saveWorkspaceWithRevisions;
  window.OfflineStore.saveWorkspaceWithRevisions = async () => { throw new Error('Disk full'); };
  assert.equal(await e.editorSave(), false);
  assert.equal(e.editorVisible, true);
  assert.deepEqual(Array.from(desc.translations.Thai), ['', '']);
  assert.deepEqual(JSON.parse(JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai'))), candidate);
  assert.deepEqual(Array.from(candidate.snapshot.translations), previous.translations.Thai);
  window.OfflineStore.saveWorkspaceWithRevisions = persist;
  assert.equal(await e.editorSave(), true, e.collaborationNotice);
  assert.equal(writes.length, 1);
  assert.deepEqual(Array.from(desc.translations.Thai), ['Reviewed replacement', 'Second replacement']);
  assert.equal(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai'), null);
  assert.deepEqual(Array.from(writes[0].workspace.staged.Thai[desc.filepath].translations), ['Reviewed replacement', 'Second replacement']);
});

test('dropped review diffs use the captured original English when source history is unavailable', async () => {
  const { editor: e, window, previous } = droppedReviewFixture();
  let historyReads = 0;
  window.OfflineStore.listRevisions = async () => { historyReads++; throw new Error('Source history unavailable'); };
  const comparisons = [];
  e.renderInlineDiffHtml = (oldText, newText) => { comparisons.push([oldText, newText]); return ''; };
  await e.prepareEditorEnglishDiff();
  assert.deepEqual(comparisons, previous.translations.English.map((oldText, index) => [oldText, e.descs[0].translations.English[index]]));
  assert.equal(historyReads, 0, 'A stored dropped snapshot already identifies its original English.');
});

test('legacy dropped candidates without original English do not invent a source diff', async () => {
  const { editor: e, window, desc } = droppedReviewFixture();
  const candidate = window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai');
  candidate.originSourceAvailable = false; candidate.snapshot.english = [];
  let comparisons = 0, historyReads = 0;
  e.renderInlineDiffHtml = () => { comparisons++; return ''; };
  window.OfflineStore.listRevisions = async () => { historyReads++; return [{ translations: ['Unrelated earlier source'] }]; };
  await e.prepareEditorEnglishDiff();
  assert.equal(comparisons, 0); assert.equal(historyReads, 0);
});

test('dropped comparison HTML is registered as computed values and renders escaped source and translation diffs', () => {
  const { editor: e, window, config, desc, previous } = droppedReviewFixture();
  assert.equal(typeof config.computed.editorDroppedSourceDiff, 'function');
  assert.equal(typeof config.computed.editorDroppedTranslationDiff, 'function');
  assert.equal(Object.hasOwn(config.methods, 'editorDroppedSourceDiff'), false);
  assert.equal(Object.hasOwn(config.methods, 'editorDroppedTranslationDiff'), false);
  window.Diff = { diffWordsWithSpace(oldText, newText) {
    return [{ value: oldText, removed: true }, { value: newText, added: true }];
  } };
  e.editorDroppedCandidate = JSON.parse(JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai')));
  e.editorDroppedCandidate.snapshot.english[0] = 'Original <tag> & source';
  assert.equal(typeof e.editorDroppedSourceDiff, 'string');
  assert.match(e.editorDroppedSourceDiff, /diffInlineDel[^>]*>Original &lt;tag&gt; &amp; source/);
  assert.match(e.editorDroppedSourceDiff, /diffInlineAdd[^>]*>Changed source/);
  assert.equal(typeof e.editorDroppedTranslationDiff, 'string');
  assert.ok(e.editorDroppedTranslationDiff.includes(previous.translations.Thai[0]));
  e.editorDroppedCandidate.originSourceAvailable = false;
  assert.equal(e.editorDroppedSourceDiff, '');
});

test('Save unchanged stages a complete current ZIP translation as Saved without marking it Revised', async () => {
  const { editor: e, window, writes, desc } = saveFixture();
  desc.hasChanges = false;
  e._workspaceSourceBaseline = [JSON.parse(JSON.stringify(desc))];
  e.localDescs = { sourceHash: e.sourceIdentity, descs: [], status: {} };
  window.WorkspaceState.initializeWorkspace(e.localDescs, {
    source: e._workspaceSourceBaseline, sourceHash: e.sourceIdentity, game: e.gameVersion, language: e.lang,
  });
  e.editorBlocks = desc.translations.English.map((english, index) => ({ english, translation: desc.translations.Thai[index] }));
  assert.equal(e.editorHaveChanges(), false);
  assert.equal(await e.editorSave(), true, e.collaborationNotice);
  assert.equal(writes.length, 1);
  assert.equal(desc.hasChanges, true); assert.equal(desc.isRevised, false);
  assert.deepEqual(Array.from(e.localDescs.staged.Thai[desc.filepath].translations), ['เดิม', 'สอง']);
});

test('a competing dropped copy blocks Save and Confirm until the comparison is resolved', async () => {
  const { editor: e, writes, calls } = droppedConflictFixture();
  assert.ok(e.editorDroppedConflict);
  assert.equal(e.editorDroppedCanPromote, false);
  assert.equal(await e.editorSave(), false);
  await e.confirmTranslationUnchanged();
  assert.equal(writes.length, 0); assert.equal(calls.length, 0);
  assert.match(e.collaborationNotice, /competing dropped copies/);
});

test('dropped comparison explains matching text with different entry details without changing the captured review', () => {
  for (const field of ['name', 'variables', 'remarks', 'stats']) {
    const { editor: e } = droppedConflictFixture();
    const conflict = e.editorDroppedConflict;
    conflict.shared.snapshot = JSON.parse(JSON.stringify(conflict.yours.snapshot));
    conflict.shared.snapshot[field] = field === 'name' ? 'Different entry name' : ['Different preserved detail'];
    const captured = JSON.stringify(e.editorDroppedCandidate);
    assert.match(e.droppedConflictExplanation(conflict), /text matches.*preserved entry details differ/);
    assert.equal(JSON.stringify(e.editorDroppedCandidate), captured);
  }
});

test('dropped comparison distinguishes whitespace differences and historical promotion review from differing translations', () => {
  const { editor: e } = droppedConflictFixture();
  const conflict = e.editorDroppedConflict;
  assert.equal(e.droppedConflictExplanation(conflict), '', 'Different visible text already appears in the comparison.');
  conflict.shared.snapshot = JSON.parse(JSON.stringify(conflict.yours.snapshot));
  assert.equal(e.droppedConflictExplanation(conflict), '');
  conflict.shared.snapshot.translations[0] += ' ';
  assert.match(e.droppedConflictExplanation(conflict), /Spacing or line breaks differ/);
  conflict.shared.snapshot.translations = [...conflict.yours.snapshot.translations];
  conflict.shared.originSourceHash = 'different-source';
  assert.equal(e.droppedConflictExplanation(conflict), '', 'Source-only upload differences can consolidate automatically.');
  const sharedId = conflict.shared.id;
  conflict.shared.id = conflict.yours.id;
  assert.match(e.droppedConflictExplanation(conflict), /original source information differs/,
    'A same-generation source mismatch cannot silently replace historical information.');
  conflict.shared.id = sharedId;
  conflict.kind = 'promotion';
  assert.match(e.droppedConflictExplanation(conflict), /original source information differs/);
  conflict.shared.originSourceHash = conflict.yours.originSourceHash;
  conflict.shared.originSourceAvailable = false;
  assert.match(e.droppedConflictExplanation(conflict), /original source information differs/);
  delete conflict.shared.snapshot;
  assert.equal(e.droppedConflictExplanation(conflict), '', 'Resolved copy guidance is displayed separately.');
});

test('resolving competing dropped copies reopens a clean editor but preserves an existing dirty draft', async () => {
  for (const dirty of [false, true]) {
    const { editor: e, calls, opened, desc } = droppedConflictFixture();
    if (dirty) e.editorBlocks[0].translation = 'My pending manual draft';
    const blocks = e.editorBlocks;
    await e.resolveDroppedTranslationConflict('shared');
    assert.deepEqual(calls, [{ filepath: desc.filepath, choice: 'shared' }]);
    assert.equal(e.editorDroppedConflict, null);
    assert.equal(e.editorDroppedCandidate.id, 'shared-copy');
    if (dirty) {
      assert.equal(opened.length, 0); assert.equal(e.editorBlocks, blocks);
      assert.equal(e.editorBlocks[0].translation, 'My pending manual draft');
      assert.equal(e.editorHaveChanges(), true);
    } else {
      assert.deepEqual(opened, [desc.filepath]);
      assert.equal(e.editorBlocks[0].translation, 'Shared preserved translation');
    }
  }
});

test('a source change or newer conflict while confirmation is open cannot resolve the captured copies', async () => {
  for (const change of ['source', 'conflict']) {
    const { editor: e, calls, opened } = droppedConflictFixture();
    let finish;
    e.appConfirm = () => new Promise(resolve => { finish = resolve; });
    const resolving = e.resolveDroppedTranslationConflict('shared');
    if (change === 'source') e.sourceIdentity = 'different-source';
    else e.editorDroppedConflict.shared.revision++;
    finish(true); await resolving;
    assert.equal(calls.length, 0); assert.equal(opened.length, 0);
    assert.ok(e.editorDroppedConflict);
    if (change === 'conflict') assert.match(e.collaborationNotice, /competing copies changed/);
  }
});

test('a removed source file can resolve its preserved dropped copies without opening or staging an editor', async () => {
  for (const choice of ['local', 'shared']) {
    const { editor: e, window, desc, conflict, calls, opened, writes } = removedDroppedConflictFixture();
    const stages = JSON.stringify(e.localDescs.staged);
    e._collaboration.resolveDroppedConflict = async (filepath, decision, expected) => {
      calls.push({ filepath, choice: decision, expected });
      window.WorkspaceState.resolveDroppedConflict(e.localDescs, filepath, e.lang, decision, expected);
    };
    await e.resolveDroppedTranslationConflict(choice, desc.filepath);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ filepath: desc.filepath, choice,
      expected: { id: conflict.shared.id, revision: conflict.shared.revision } }]);
    assert.equal(e.localDescs.droppedConflicts.Thai[desc.filepath], undefined);
    assert.equal(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai').id,
      choice === 'local' ? conflict.yours.id : conflict.shared.id);
    assert.equal(e.editorVisible, false); assert.equal(e.editorCurrentEditingDesc, null);
    assert.equal(e.editorDroppedCandidate, null); assert.deepEqual(e.editorBlocks, []);
    assert.equal(opened.length, 0); assert.equal(writes.length, 0);
    assert.equal(JSON.stringify(e.localDescs.staged), stages);
  }
});

test('removed-file decisions cannot cross account, game, language, source, or client changes during confirmation', async () => {
  for (const change of ['account', 'game', 'language', 'source', 'client']) {
    const { editor: e, desc, calls, opened } = removedDroppedConflictFixture();
    let finish;
    e.appConfirm = () => new Promise(resolve => { finish = resolve; });
    const resolving = e.resolveDroppedTranslationConflict('shared', desc.filepath);
    if (change === 'account') e.cloudUser = { id: 'other-account' };
    if (change === 'game') e.gameVersion = 'poe2';
    if (change === 'language') e.lang = 'German';
    if (change === 'source') e.sourceIdentity = 'different-source';
    if (change === 'client') e._collaboration = {};
    finish(true); await resolving;
    assert.equal(calls.length, 0, change); assert.equal(opened.length, 0, change);
    assert.ok(e.localDescs.droppedConflicts.Thai[desc.filepath], change);
    assert.equal(e.editorSaving, false); assert.equal(e.editorVisible, false);
  }
});

test('removed-file decisions retain a changed comparison and pass the displayed shared revision to storage', async () => {
  for (const phase of ['confirmation', 'durable read']) {
    const { editor: e, window, desc, conflict, calls, opened } = removedDroppedConflictFixture();
    const displayed = { id: conflict.shared.id, revision: conflict.shared.revision };
    if (phase === 'confirmation') {
      e.appConfirm = async () => { e.localDescs.droppedConflicts.Thai[desc.filepath].shared.revision++; return true; };
    } else {
      e._collaboration.resolveDroppedConflict = async (filepath, decision, expected) => {
        calls.push({ filepath, decision, expected });
        e.localDescs.droppedConflicts.Thai[desc.filepath].shared.revision++;
        window.WorkspaceState.resolveDroppedConflict(e.localDescs, filepath, e.lang, decision, expected);
      };
    }
    await e.resolveDroppedTranslationConflict('shared', desc.filepath);
    assert.equal(calls.length, phase === 'confirmation' ? 0 : 1);
    if (calls.length) assert.deepEqual(JSON.parse(JSON.stringify(calls[0].expected)), displayed);
    assert.ok(e.localDescs.droppedConflicts.Thai[desc.filepath]);
    assert.match(e.collaborationNotice, /changed/);
    assert.equal(opened.length, 0); assert.equal(e.editorVisible, false);
  }
});

test('typing during a dropped comparison confirmation or durable resolution never reopens over that new draft', async () => {
  for (const phase of ['confirmation', 'resolution']) {
    const { editor: e, calls, opened } = droppedConflictFixture();
    let finish;
    if (phase === 'confirmation') e.appConfirm = () => new Promise(resolve => { finish = resolve; });
    else {
      const resolveConflict = e._collaboration.resolveDroppedConflict;
      e._collaboration.resolveDroppedConflict = (...args) => new Promise(resolve => { finish = async () => {
        await resolveConflict(...args); resolve();
      }; });
    }
    const resolving = e.resolveDroppedTranslationConflict('shared');
    if (phase === 'resolution') await new Promise(resolve => setImmediate(resolve));
    e.editorBlocks[0].translation = 'Typed while waiting for ' + phase;
    const blocks = e.editorBlocks;
    await finish(true); await resolving;
    assert.equal(calls.length, 1); assert.equal(opened.length, 0, phase);
    assert.equal(e.editorBlocks, blocks);
    assert.equal(e.editorBlocks[0].translation, 'Typed while waiting for ' + phase);
    assert.equal(e.editorHaveChanges(), true);
  }
});

test('a file originally Missing stays ordinary Saved after filling and correcting its complete text', async () => {
  const { editor: e, window, desc } = saveFixture();
  desc.translations.Thai = ['', '']; desc.hasChanges = false; desc.needsReview = false;
  const source = JSON.parse(JSON.stringify(desc));
  e._workspaceSourceBaseline = [source];
  e.localDescs = { sourceHash: e.sourceIdentity, descs: [], status: {} };
  window.WorkspaceState.initializeWorkspace(e.localDescs, {
    source: [source], sourceHash: e.sourceIdentity, game: e.gameVersion, language: e.lang,
  });
  e.editorOriginalTranslations = ['', ''];
  e.editorBlocks = [{ english: 'Original', translation: 'First complete translation' },
    { english: 'Second', translation: 'Second complete translation' }];
  assert.equal(await e.editorSave(), true, e.collaborationNotice);
  assert.equal(desc.hasChanges, true); assert.equal(desc.isRevised, false);
  assert.equal(desc.isMissing, false);
  e.editorVisible = true; e.editorCurrentEditingDesc = desc;
  e.editorOriginalTranslations = [...desc.translations.Thai];
  e.editorBlocks = [{ english: 'Original', translation: 'Changed complete translation' },
    { english: 'Second', translation: 'Second complete translation' }];
  assert.equal(await e.editorSave(), true, e.collaborationNotice);
  assert.equal(desc.hasChanges, true); assert.equal(desc.isRevised, false);
  assert.deepEqual(Array.from(e.localDescs.staged.Thai[desc.filepath].before), ['First complete translation', 'Second complete translation']);
});

test('an outside-assignment correction stays Revised on another save and clears on reverting to ZIP text', async () => {
  const { editor: e, window, desc } = saveFixture();
  desc.hasChanges = false;
  const source = JSON.parse(JSON.stringify(desc));
  e._workspaceSourceBaseline = [source];
  e.localDescs = { sourceHash: e.sourceIdentity, descs: [], status: {} };
  window.WorkspaceState.initializeWorkspace(e.localDescs, {
    source: [source], sourceHash: e.sourceIdentity, game: e.gameVersion, language: e.lang,
  });
  assert.equal(await e.editorSave(), true, e.collaborationNotice);
  assert.equal(desc.isRevised, true); assert.equal(desc.hasChanges, true);
  for (const lines of [desc.translations.Thai, source.translations.Thai]) {
    e.editorVisible = true; e.editorCurrentEditingDesc = desc;
    e.editorOriginalTranslations = [...desc.translations.Thai];
    e.editorBlocks = desc.translations.English.map((english, index) => ({ english, translation: lines[index] }));
    assert.equal(await e.editorSave(), true, e.collaborationNotice);
    assert.equal(desc.isRevised, lines === source.translations.Thai ? false : true);
    assert.equal(desc.hasChanges, true);
  }
  assert.deepEqual(Array.from(desc.translations.Thai), source.translations.Thai);
  assert.equal(e.localDescs.descs[0].isRevised, undefined, 'Revised is derived, never persisted.');
});

test('real test-mode dummy data retains an immutable source through correction, repeated save and ZIP-text restore', async () => {
  const { editor: e, context, writes } = harness();
  for (const file of ['statDescParser.js', 'dummyFiles.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context, { filename: file });
  }
  context.document.createElement = () => ({ get value() { return this.innerHTML; } });
  e.sourceLoaded = false;
  e._workspaceBaselineIndex = { source: [], files: new Map([['test/dummy1.txt', { stale: true }]]) };
  e.loadDummyData();
  const desc = e.getDescByFilepath('test/dummy1.txt');
  const baseline = e.workspaceSourceFile(desc.filepath);
  const zipTranslations = [...baseline.translations.Thai];
  assert.equal(e.sourceLoaded, true); assert.equal(e.localDescs.stagedVersion, 1);
  assert.notEqual(desc, baseline); assert.notEqual(desc.translations.Thai, baseline.translations.Thai);
  assert.equal(desc.hasChanges, false); assert.equal(desc.isRevised, false);
  const correction = zipTranslations.map((text, index) => index ? text + ' correction' : text);
  for (const lines of [correction, correction, zipTranslations]) {
    e.editorVisible = true; e.editorCurrentEditingDesc = desc;
    e.editorOriginalTranslations = [...desc.translations.Thai];
    e.editorBlocks = desc.translations.English.map((english, index) => ({ english, translation: lines[index] }));
    assert.equal(await e.editorSave({ close: false }), true, e.collaborationNotice);
    assert.equal(desc.hasChanges, true); assert.equal(desc.isRevised, lines !== zipTranslations);
    assert.equal(e.statistic.hasChanges, 1); assert.equal(e.statistic.isRevised, lines !== zipTranslations ? 1 : 0);
    assert.deepEqual(Array.from(baseline.translations.Thai), zipTranslations);
  }
  assert.equal(writes.length, 0, 'Test mode continues to bypass IndexedDB.');
});

test('a complete original ZIP file assigned Dropped stays ordinary Saved after resolving and correcting it, including reload', async () => {
  for (const decision of ['confirm', 'discard']) {
    const { editor: e, window, writes, desc, previous } = droppedReviewFixture();
    const baseline = e._workspaceSourceBaseline[0];
    baseline.translations.Thai = ['Complete current ZIP text', 'Second current ZIP line'];
    const zipTranslations = [...baseline.translations.Thai];
    e.applyWorkspaceOverlay(); e.seedEditorOpenSource({ desc });
    assert.equal(desc.isMissing, false); assert.equal(desc.isDropped, true);
    const candidate = window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai');
    if (decision === 'confirm') await e.confirmTranslationUnchanged();
    else await e.discardDroppedTranslation();
    assert.equal(writes.length, 1, decision + ': ' + e.collaborationNotice);
    assert.equal(desc.isDropped, false); assert.equal(desc.isRevised, false);
    assert.equal(e.localDescs.droppedArchive[candidate.id].status, decision === 'confirm' ? 'promoted' : 'discarded');
    assert.deepEqual(Array.from(desc.translations.Thai), decision === 'confirm' ? previous.translations.Thai : zipTranslations);

    for (const translation of ['First correction after ' + decision, 'Second correction after ' + decision]) {
      e.editorVisible = true; e.editorCurrentEditingDesc = desc;
      e.editorOriginalTranslations = [...desc.translations.Thai];
      e.editorBlocks = desc.translations.English.map((english, index) => ({ english,
        translation: index ? 'Second corrected line' : translation }));
      assert.equal(await e.editorSave({ close: false }), true, decision + ': ' + e.collaborationNotice);
      assert.equal(desc.hasChanges, true); assert.equal(desc.isRevised, false);
      assert.equal(desc.isMissing, false); assert.equal(desc.isDropped, false);
      assert.deepEqual(Array.from(baseline.translations.Thai), zipTranslations, 'Saving must preserve the original ZIP baseline.');
    }

    const reloaded = harness().editor;
    reloaded.testMode = false;
    reloaded._workspaceSourceBaseline = [JSON.parse(JSON.stringify(baseline))];
    reloaded.descs = [JSON.parse(JSON.stringify(baseline))];
    reloaded.localDescs = JSON.parse(JSON.stringify(writes.at(-1).workspace));
    reloaded.applyWorkspaceOverlay(); reloaded.filterDesc();
    assert.equal(reloaded.descs[0].hasChanges, true); assert.equal(reloaded.descs[0].isRevised, false);
    assert.equal(reloaded.statistic.hasChanges, 1); assert.equal(reloaded.statistic.isRevised, 0);
    assert.equal(reloaded.descs[0].translations.Thai[0], 'Second correction after ' + decision);
  }
});

test('explicitly recovering the same history entry after discard or promotion creates a fresh dropped copy without staging recovery', async t => {
  for (const decision of ['discard', 'confirm']) await t.test(decision, async () => {
    const { editor: e, window, desc, baseline, revision, writes } = historyRecoveryFixture();
    await e.restoreHistoryRevision(revision);
    const first = JSON.parse(JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, e.lang)));
    assert.ok(first, e.collaborationNotice); assert.equal(first.recoveryId, first.id);
    assert.deepEqual(Array.from(desc.translations.Thai), baseline.translations.Thai);
    assert.equal(desc.hasChanges, false); assert.equal(desc.isDropped, true);
    if (decision === 'discard') await e.discardDroppedTranslation();
    else await e.confirmTranslationUnchanged();
    assert.equal(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, e.lang), null, e.collaborationNotice);
    const resolvedStatus = decision === 'discard' ? 'discarded' : 'promoted';
    assert.equal(e.localDescs.droppedArchive[first.id].status, resolvedStatus);
    const committedBeforeRecovery = JSON.parse(JSON.stringify(e.localDescs.staged));
    const translationBeforeRecovery = [...desc.translations.Thai];

    await e.restoreHistoryRevision(revision);
    const second = window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, e.lang);
    assert.ok(second, e.collaborationNotice); assert.notEqual(second.id, first.id);
    assert.equal(second.recoveryId, second.id); assert.equal(second.status, 'dropped');
    assert.deepEqual(Array.from(second.snapshot.translations), revision.translations);
    assert.deepEqual(Array.from(second.snapshot.english), baseline.translations.English);
    assert.deepEqual(Array.from(desc.translations.Thai), translationBeforeRecovery);
    assert.deepEqual(JSON.parse(JSON.stringify(e.localDescs.staged)), committedBeforeRecovery);
    assert.equal(e.localDescs.droppedArchive[first.id].status, resolvedStatus);
    assert.equal(desc.hasChanges, decision === 'confirm'); assert.equal(desc.isDropped, true); assert.equal(desc.isRevised, false);
    assert.deepEqual(Array.from(baseline.translations.Thai), ['เดิม', 'สอง']);
    assert.equal(writes.at(-1).revisions.length, 1); assert.equal(writes.at(-1).revisions[0].needsReview, true);
    assert.deepEqual(writes.at(-1).revisions[0].translations, revision.translations);
  });
});

test('a failed explicit re-recovery keeps its resolved archive, committed text and editor draft unchanged', async () => {
  const { editor: e, window, desc, revision, opened } = historyRecoveryFixture();
  await e.restoreHistoryRevision(revision);
  await e.discardDroppedTranslation();
  const before = JSON.parse(JSON.stringify(e.localDescs)), translations = [...desc.translations.Thai];
  const blocks = e.editorBlocks, opens = opened.length;
  e.editorBlocks[0].translation = 'Typing before failed recovery';
  window.OfflineStore.updateWorkspace = async update => {
    const next = update(JSON.parse(JSON.stringify(before)));
    assert.ok(window.WorkspaceState.droppedForFile(next, desc.filepath, e.lang));
    throw new Error('Recovery storage full');
  };
  await e.restoreHistoryRevision(revision);
  assert.match(e.collaborationNotice, /Could not restore the translation: Recovery storage full/);
  assert.deepEqual(JSON.parse(JSON.stringify(e.localDescs)), before);
  assert.deepEqual(Array.from(desc.translations.Thai), translations);
  assert.equal(e.editorBlocks, blocks); assert.equal(e.editorBlocks[0].translation, 'Typing before failed recovery');
  assert.equal(opened.length, opens); assert.equal(desc.isDropped, false);
});

test('normal export includes staged files while full export uses current complete ZIP text beside an unresolved Dropped copy', async () => {
  const { editor: e, window, context, desc } = droppedReviewFixture();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/statDescParser.js'), 'utf8'), context,
    { filename: 'statDescParser.js' });
  const saved = description(2, ['', '']); saved.hasChanges = false;
  const complete = description(3, ['Current ZIP translation', 'Second current ZIP translation']); complete.hasChanges = false;
  const previous = JSON.parse(JSON.stringify(complete));
  previous.translations.English[0] = 'Earlier English'; previous.translations.Thai[0] = 'Old hidden dropped text';
  e._workspaceSourceBaseline.push(JSON.parse(JSON.stringify(saved)), JSON.parse(JSON.stringify(complete)));
  e.descs.push(saved, complete);
  window.WorkspaceState.stageTranslation(e.localDescs, { filepath: saved.filepath,
    translations: ['Explicit saved translation', 'Second saved translation'] }, 'Thai',
  { source: saved, sourceHash: e.sourceIdentity });
  window.WorkspaceState.dropTranslation(e.localDescs, previous, 'Thai', {
    game: e.gameVersion, originSourceHash: 'older-source', targetSourceHash: e.sourceIdentity,
  });
  e.applyWorkspaceOverlay();
  assert.equal(desc.needsReview, true);
  assert.equal(complete.needsReview, false);
  assert.equal(complete.isDropped, true);
  const exports = [];
  context.JSZip = class {
    constructor() { this.files = []; exports.push(this.files); }
    file(filepath, data) { this.files.push({ filepath, text: new TextDecoder('utf-16le').decode(data) }); }
    async generateAsync() { return {}; }
  };
  context.saveAs = () => {};
  await e.exportZip(false);
  assert.deepEqual(exports[0].map(file => file.filepath), [saved.filepath]);
  assert.match(exports[0][0].text, /Explicit saved translation/);
  await e.exportZip(true);
  assert.deepEqual(exports[1].map(file => file.filepath), [saved.filepath, complete.filepath]);
  assert.match(exports[1][1].text, /Current ZIP translation/);
  assert.ok(exports.flat().every(file => !file.text.includes('Old hidden dropped text')
    && !file.text.includes('Translation approved for the original source')));
});

// Vue wraps nested objects and arrays lazily. Keep the same shape here without
// loading Vue, so the storage stub enforces IndexedDB's structured-clone rules.
function reactiveFixture(value, cache = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (!cache.has(value)) cache.set(value, new Proxy(value, {
    get(target, key, receiver) { return reactiveFixture(Reflect.get(target, key, receiver), cache); },
  }));
  return cache.get(value);
}
function unchangedReviewFixture(existingLocal) {
  const h = harness(), e = h.editor;
  const plain = {
    filepath: 'stat_descriptions/crossbow_bolt_additional_number_of_targets_to_pierce.txt',
    filedir: 'stat_descriptions', filename: 'crossbow_bolt_additional_number_of_targets_to_pierce.txt', name: null,
    stats: ['crossbow_bolt_additional_number_of_targets_to_pierce'], variables: ['1', '2|#'], remarks: ['', ''],
    translations: { English: ['Bolts [Pierce] an additional target', 'Bolts [Pierce] {0} additional targets'],
      Japanese: ['ボルトは対象を追加で1体[Pierce|貫通]する', ''], French: ['Autre langue', 'Deuxième ligne'] },
    hasChanges: false, needsReview: true, isMissing: true,
  };
  const desc = reactiveFixture(plain), unrelated = description(2);
  unrelated.translations.French = ['Bonjour', 'Deuxième'];
  const originalWorkspace = { sourceHash: e.sourceIdentity,
    descs: [...(existingLocal ? [structuredClone(plain)] : []), unrelated],
    status: { [plain.filepath]: { needsReview: true, lastExportedAt: 17, marker: 'keep review metadata' },
      [unrelated.filepath]: { needsReview: true, marker: 'keep unrelated status' } } };
  e.lang = 'Japanese'; e.testMode = false; e.descs = [desc, unrelated];
  e.localDescs = structuredClone(originalWorkspace);
  e.editorVisible = true; e.editorCurrentEditingDesc = desc;
  e.editorOriginalTranslations = [...desc.translations.Japanese];
  e.editorBlocks = desc.translations.English.map((english, index) => ({ english, translation: desc.translations.Japanese[index] }));
  return { ...h, desc, originalWorkspace };
}

for (const existingLocal of [false, true]) {
  test(`confirm unchanged persists nested reactive source arrays with ${existingLocal ? 'an existing' : 'a new'} local row`, async () => {
    const { editor: e, writes, window, desc, originalWorkspace } = unchangedReviewFixture(existingLocal);
    const translations = [...desc.translations.Japanese];
    assert.throws(() => structuredClone(desc.translations.English), { name: 'DataCloneError' });
    await e.confirmTranslationUnchanged();
    assert.equal(writes.length, 1, e.collaborationNotice);
    const saved = writes[0], local = saved.workspace.descs.find(item => item.filepath === desc.filepath);
    assert.deepEqual(local.translations.Japanese, translations, 'The unchanged review retains the intentional blank.');
    assert.deepEqual(local.translations.English, [...desc.translations.English]);
    for (const key of ['stats', 'variables', 'remarks']) assert.deepEqual(local[key], [...desc[key]]);
    if (existingLocal) assert.deepEqual(local.translations.French, originalWorkspace.descs[0].translations.French);
    const { languageStatus: unrelatedDescriptionStatus, statusLanguage: unrelatedDescriptionLanguage, ...unrelatedDescription }
      = saved.workspace.descs.find(item => item.filepath === 'source/002.txt');
    const { hasChanges, isMissing, isRevised, isDropped, needsReview, trackedForExport, ...originalDescription } = originalWorkspace.descs.at(-1);
    assert.deepEqual(unrelatedDescription, originalDescription);
    assert.equal(unrelatedDescriptionStatus?.[unrelatedDescriptionLanguage]?.hasChanges, undefined);
    const { languageStatus: unrelatedFileStatus, statusLanguage: unrelatedFileLanguage, ...unrelatedStatus }
      = saved.workspace.status['source/002.txt'];
    const { needsReview: historicalNeedsReview, ...originalStatus } = originalWorkspace.status['source/002.txt'];
    assert.deepEqual(unrelatedStatus, originalStatus);
    assert.equal(unrelatedFileStatus?.[unrelatedFileLanguage]?.needsReview, undefined);
    assert.equal(saved.workspace.status[desc.filepath].needsReview, undefined);
    assert.equal(saved.workspace.status[desc.filepath].lastExportedAt, 17);
    assert.equal(saved.workspace.status[desc.filepath].marker, 'keep review metadata');
    assert.equal(local.hasChanges, undefined); assert.equal(local.isMissing, undefined);
    const state = window.WorkspaceState.workspaceFile(saved.workspace, desc, 'Japanese');
    assert.equal(state.hasChanges, true); assert.equal(state.isMissing, true);
    assert.equal(saved.revisions.length, 1); assert.equal(saved.revisions[0].note, 'confirm');
    assert.equal(saved.revisions[0].lang, 'Japanese'); assert.equal(saved.revisions[0].sourceHash, e.sourceIdentity);
    assert.deepEqual(saved.revisions[0].translations, translations);
    assert.equal(desc.needsReview, false); assert.equal(desc.hasChanges, true);
    assert.equal(e.localDescs.status[desc.filepath].needsReview, undefined); assert.equal(e.editorSaving, false);
  });
}

test('a failed reactive confirmation preserves staged work and legacy recovery metadata', async () => {
  const { editor: e, window, writes, desc } = unchangedReviewFixture(true);
  const secondTranslation = 'ボルトは対象を追加で{0}体[Pierce|貫通]する';
  desc.translations.Japanese[1] = secondTranslation; desc.isMissing = false;
  e.localDescs.descs[0].translations.Japanese[1] = secondTranslation; e.localDescs.descs[0].isMissing = false;
  e.editorBlocks[1].translation = secondTranslation; e.editorOriginalTranslations[1] = secondTranslation;
  window.WorkspaceState.initializeWorkspace(e.localDescs, { source: e.descs, sourceHash: e.sourceIdentity,
    game: e.gameVersion, language: e.lang });
  const beforeSave = JSON.parse(JSON.stringify(e.localDescs));
  window.OfflineStore.saveWorkspaceWithRevisions = async (workspace, revisions) => {
    structuredClone({ workspace, revisions });
    throw new Error('Quota exceeded');
  };
  await e.confirmTranslationUnchanged();
  assert.equal(writes.length, 0); assert.equal(desc.needsReview, true); assert.equal(desc.hasChanges, false);
  assert.deepEqual(JSON.parse(JSON.stringify(e.localDescs)), beforeSave);
  assert.deepEqual([...desc.translations.Japanese], beforeSave.descs[0].translations.Japanese);
  assert.equal(e.editorVisible, true); assert.equal(e.editorSaving, false);
  assert.match(e.collaborationNotice, /Could not save the dropped translation: Quota exceeded/);
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
  assert.equal(e.editorHaveChanges(), true); assert.equal(e.diagnosticScanCompleted, true);
  assert.deepEqual(Array.from(e.diagnosticScanResults[first.filepath].translationLines), accepted.translations);
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

test('worker saves close the editor and navigate before the local transaction acknowledges', async t => {
  for (const navigate of [false, true]) await t.test(navigate ? 'save-and-next' : 'Save & close', async () => {
    const h = enablePending(saveFixture()), { editor: e, desc, calls, acknowledge, warnsBeforeUnload } = h;
    const next = description(2, ['', '']); next.isMissing = true;
    e.descs.push(next); e.filterDesc();
    const opened = [];
    e.editFile = async filepath => { opened.push(filepath); e.editorVisible = true; e.editorCurrentEditingDesc = e.getDescByFilepath(filepath); return true; };
    assert.equal(await (navigate ? e.saveAndSkipFile() : e.editorSave()), true);
    assert.equal(e.editorSaving, false); assert.equal(e.pendingLocalSaves, 1);
    assert.equal(desc.translations.Thai[0], 'ใหม่'); assert.equal(calls.length, 0);
    assert.equal(warnsBeforeUnload(), true);
    if (navigate) assert.deepEqual(opened, ['source/002.txt']);
    else assert.equal(e.editorVisible, false);
    await pendingTick(); assert.equal(calls.length, 1);
    acknowledge(calls[0]); await e._pendingSaves.drain(); assert.equal(e.pendingLocalSaves, 0);
  });
});

test('optimistic worker saving still prevents duplicate submissions during a diagnostic confirmation', async () => {
  const { editor: e, calls, acknowledge } = enablePending(saveFixture());
  let answer, confirmations = 0;
  e.collectEditorDiagnostics = level => level === 'warning' ? [{ level, message: 'Review this translation.' }] : [];
  e.appConfirm = () => { confirmations++; return new Promise(resolve => { answer = resolve; }); };
  const saving = e.editorSave(); await pendingTick();
  assert.equal(await e.editorSave(), false); assert.equal(confirmations, 1);
  assert.equal(e.pendingLocalSaves, 0); assert.equal(calls.length, 0);
  answer(true); assert.equal(await saving, true); assert.equal(e.pendingLocalSaves, 1);
  await pendingTick(); assert.equal(calls.length, 1); acknowledge(calls[0]); await e._pendingSaves.drain();
});

test('a failed background local save retains closed edits, downloadable recovery and an identical retry', async () => {
  const { editor: e, calls, acknowledge, downloads, warnsBeforeUnload, desc } = enablePending(saveFixture());
  assert.equal(await e.editorSave(), true); assert.equal(e.editorVisible, false);
  const drained = e._pendingSaves.drain(); await pendingTick();
  const originalPayload = JSON.stringify(calls[0].batch);
  calls[0].reject(new Error('Disk full')); await assert.rejects(drained, /Disk full/);
  assert.equal(e.pendingLocalSaves, 1); assert.match(e.localSaveError, /Disk full/);
  assert.equal(desc.translations.Thai[0], 'ใหม่'); assert.equal(warnsBeforeUnload(), true);
  e.downloadPendingSaves();
  assert.equal(downloads[0].filename, 'SDEditor_pending_edits.json');
  const recovery = JSON.parse(await downloads[0].blob.text());
  assert.equal(recovery.saves[0].jobId, calls[0].batch.jobId);
  assert.equal(recovery.saves[0].files[0].translations[0], 'ใหม่');
  const retry = e.retryPendingSaves(); await pendingTick();
  assert.equal(calls.length, 2); assert.equal(JSON.stringify(calls[1].batch), originalPayload);
  assert.match(e.localSaveError, /Disk full/, 'Starting a retry must not clear its warning.');
  acknowledge(calls[1]); await retry;
  assert.equal(e.localSaveError, ''); assert.equal(e.pendingLocalSaves, 0);
  assert.equal(e.editorVisible, false); assert.equal(warnsBeforeUnload(), false);
});

test('beforeunload protects pending local writes and dirty drafts while durable online outboxes stay silent', async () => {
  const { editor: e, calls, acknowledge, warnsBeforeUnload, desc } = enablePending(saveFixture());
  e.initializePendingSaves(); e.updateLeaveProtection(); assert.equal(warnsBeforeUnload(), true);
  e.editorBlocks.forEach((block, index) => { block.translation = desc.translations.Thai[index]; });
  e.updateLeaveProtection(); assert.equal(warnsBeforeUnload(), false);
  e.collaborationState = { pending: 7, pendingCount: 7, connected: false };
  e.editorVisible = false; e.updateLeaveProtection(); assert.equal(warnsBeforeUnload(), false);
  e.editorVisible = true; e.editorBlocks[0].translation = 'ใหม่';
  assert.equal(await e.editorSave(), true); assert.equal(warnsBeforeUnload(), true);
  await pendingTick(); acknowledge(calls[0]); await e._pendingSaves.drain();
  assert.equal(warnsBeforeUnload(), false);
  e.editorVisible = true; e.editorBlocks[0].translation = 'ร่างใหม่'; e.updateLeaveProtection();
  assert.equal(warnsBeforeUnload(), true);
});

test('older worker and remote acknowledgements preserve a newer pending same-file save and a different typing draft', async () => {
  const { editor: e, window, desc, calls, acknowledge } = enablePending(saveFixture());
  const { Client } = require('../public/collaborationSync.js');
  const identity = { accountId: 'translator', game: 'poe1', language: 'Thai', sourceHash: e.sourceIdentity };
  const client = new Client({ WebSocket: null, locks: null, store: {}, request: async () => ({}) });
  client.key = window.CollaborationProtocol.scopeKey(identity);
  const initial = { ...e.collaborationFile(desc), revision: 1 };
  client.state = { version: 1, rooms: { [client.key]: { identity, roomId: 'room', manifest: window.CollaborationProtocol.manifest(e.descs),
    local: { [desc.filepath]: initial }, shared: { [desc.filepath]: initial }, outbox: [], conflicts: [], recovery: [] } } };
  let retries = 0; client.retry = async () => { retries++; return {}; };
  e.cloudUser = { id: 'translator' }; e._collaboration = client; e._editorCollabBase = client.fileBase(desc.filepath);
  assert.equal(await e.editorSave(), true);
  e.editorVisible = true; e.editorBlocks[0].translation = 'ใหม่กว่า';
  assert.equal(await e.editorSave(), true); assert.equal(e.pendingLocalSaves, 2);
  e.applyCollaborationFiles([{ ...initial, translations: ['ตอบกลับเก่า', 'สอง'] }]);
  assert.equal(desc.translations.Thai[0], 'ใหม่กว่า');
  await pendingTick(); acknowledge(calls[0]); await pendingTick();
  assert.equal(desc.translations.Thai[0], 'ใหม่กว่า'); assert.equal(client.fileBase(desc.filepath).translations[0], 'ใหม่กว่า');
  assert.equal(calls.length, 2); assert.equal(calls[1].batch.collaboration.bases[desc.filepath].translations[0], 'ใหม่');
  const other = description(2); e.descs.push(other);
  e.editorCurrentEditingDesc = other; e.editorVisible = true;
  e.editorBlocks = [{ english: 'Original', translation: 'ร่างไฟล์ใหม่' }, { english: 'Second', translation: 'สอง' }];
  e.editorOriginalTranslations = ['เดิม', 'สอง'];
  acknowledge(calls[1]); await e._pendingSaves.drain();
  assert.equal(desc.translations.Thai[0], 'ใหม่กว่า'); assert.equal(e.editorBlocks[0].translation, 'ร่างไฟล์ใหม่');
  assert.equal(e.editorCurrentEditingDesc, other); assert.equal(e.editorVisible, true); assert.equal(e.editorHaveChanges(), true);
  assert.equal(retries, 2); client.destroy();
});

test('game switching waits for queued storage and a failed queue blocks source replacement and reset', async () => {
  const first = enablePending(saveFixture()), { editor: e, calls, acknowledge } = first;
  await e.editorSave();
  let loads = 0; e.loadVersionedStorage = async () => { loads++; };
  const switching = e.activateGameVersion('poe2', { checkMigration: false });
  await pendingTick(); assert.equal(e.gameVersion, 'poe1'); assert.equal(loads, 0);
  acknowledge(calls[0]); await switching; assert.equal(e.gameVersion, 'poe2'); assert.equal(loads, 1);

  const second = enablePending(saveFixture()), s = second.editor;
  await s.editorSave(); const drained = s._pendingSaves.drain(); await pendingTick();
  second.calls[0].reject(new Error('Cannot write locally')); await assert.rejects(drained, /Cannot write locally/);
  let imports = 0, clears = 0, reloads = 0;
  second.window.OfflineStore.saveSourceWorkspaceWithRevisions = async () => { imports++; };
  second.window.OfflineStore.clearWorkspace = async () => { clears++; };
  second.context.location = { reload: () => { reloads++; } };
  s.confirmProceedByTypingYes = async () => true;
  await s.activateGameVersion('poe2', { checkMigration: false });
  assert.equal(s.gameVersion, 'poe1');
  await s.importUpdateZipFile({ name: 'StatDescriptions.zip', size: 1, lastModified: 1 }, [description(2)]);
  await s.startFromScratch();
  assert.equal(imports, 0); assert.equal(clears, 0); assert.equal(reloads, 0); assert.equal(s.pendingLocalSaves, 1);
});

test('a source import blocks new editor saves and waits for an in-flight save queued during hashing', async () => {
  const { editor: e, window, context, desc, calls, acknowledge } = enablePending(saveFixture());
  vm.runInContext('offlineStoreReady = true', context);
  let releaseHash, hashes = 0, imports = 0;
  window.CollaborationProtocol = { ...window.CollaborationProtocol, sourceHash: () => {
    hashes++; return new Promise(resolve => { releaseHash = resolve; });
  } };
  e.scheduleCollaboration = () => {};
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async (source, workspace) => {
    imports++; assert.equal(workspace.descs[0].translations.Thai[0], '');
    assert.equal(window.WorkspaceState.droppedForFile(workspace, desc.filepath, 'Thai').snapshot.translations[0], 'ใหม่');
  };
  const next = description(1, ['', '']); next.translations.English[0] = 'New source';
  const importing = e.importUpdateZipFile({ name: 'StatDescriptions.zip', size: 1, lastModified: 1 }, [next]);
  await pendingTick(); assert.equal(hashes, 1);
  assert.equal(await e.editorSave(), false);
  assert.equal(e.editorVisible, true); assert.equal(e.editorBlocks[0].translation, 'ใหม่');
  assert.deepEqual(e.editorOriginalTranslations, ['เดิม', 'สอง']); assert.equal(calls.length, 0);
  // A save already in flight may hand its batch to the queue after import preparation starts.
  const queued = await e.persistTranslationBatch([{ desc, lines: ['ใหม่', 'สอง'] }], 'save');
  assert.equal(queued.status, 'queued'); releaseHash('new-source-hash'); await pendingTick();
  assert.equal(calls.length, 1); assert.equal(imports, 0, 'Source replacement must wait for saves queued during its hash await.');
  acknowledge(calls[0]); await importing;
  assert.equal(imports, 1); assert.equal(e.pendingLocalSaves, 0); assert.equal(e.sourceIdentity, 'new-source-hash');
});
