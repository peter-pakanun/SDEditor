const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  let config;
  const writes = [], alerts = [];
  const window = { location: { search: '?testMode=1&lang=Thai' }, CloudUI: { mixin: {} },
    setTimeout, clearTimeout, performance: require('node:perf_hooks').performance,
    CollaborationProtocol: require('../public/collaborationProtocol.js'),
    OfflineStore: { async saveWorkspaceWithRevisions(workspace, revisions, game) { writes.push(structuredClone({ workspace, revisions, game })); } } };
  const context = vm.createContext({ window, URLSearchParams, console, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto,
    alert: () => assert.fail('Native alerts must not be used'), confirm: () => assert.fail('Native confirmations must not be used'),
    document: { activeElement: null, body: {}, querySelector: () => null,
      createElement(tag) {
        assert.equal(tag, 'textarea');
        return { set innerHTML(value) { this.value = String(value).replace(/&(lt|gt|quot|#039|amp);/g,
          (_, entity) => ({ lt: '<', gt: '>', quot: '"', '#039': "'", amp: '&' })[entity]); } };
      },
    },
    Vue: { nextTick(fn) { fn?.(); return Promise.resolve(); }, defineComponent(value) { config = value; return value; },
      createApp: () => ({ component() {}, directive() {}, mount() {} }) } });
  for (const file of ['workspaceState.js', 'statDescCodec.js', 'dictionaryScope.js', 'dictionaryMatching.js', 'dictionaryWorkerClient.js', 'dictionaryWorkerUi.js', 'helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'collaborationIntegration.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context, { filename: file });
  }
  const editor = Object.assign({}, ...config.mixins.map(mixin => mixin.data?.() || {}), config.data(),
    ...config.mixins.map(mixin => mixin.methods || {}), config.methods, {
    lang: 'Thai', gameVersion: 'poe1', sourceIdentity: 'source-one', sourceLoaded: true,
    dictionary: [], $refs: {}, $nextTick: fn => { fn?.(); return Promise.resolve(); },
    appAlert: async message => { alerts.push(message); }, appConfirm: async () => true,
    saveSettings() {}, closeHlPopup() {}, restoreFileTableFocusAfterEditor() {},
  });
  const computed = Object.assign({}, ...config.mixins.map(mixin => mixin.computed || {}), config.computed);
  for (const [name, getter] of Object.entries(computed)) Object.defineProperty(editor, name, { get: () => getter.call(editor) });
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
  const calls = [], downloads = [], listeners = new Map(), submissions = new Map(), journals = [];
  window.OfflineStore.putSaveSubmission = async batch => {
    const record = { batch: structuredClone(batch), state: 'pending', createdAt: Date.now() };
    submissions.set(batch.jobId, record); journals.push(record); return structuredClone(record);
  };
  window.OfflineStore.listSaveSubmissions = async scope => [...submissions.values()].filter(record =>
    window.PendingSaves.scopeKey(record.batch) === window.PendingSaves.scopeKey(scope)).map(structuredClone);
  window.OfflineStore.updateSaveSubmission = async (batch, patch) => {
    const record = { ...submissions.get(batch.jobId), ...structuredClone(patch) }; submissions.set(batch.jobId, record); return record;
  };
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
    submissions.delete(call.batch.jobId);
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
  return { ...h, calls, downloads, acknowledge, warnsBeforeUnload, submissions, journals };
}
const pendingTick = () => new Promise(resolve => setTimeout(resolve, 5));

test('confirmed Save, promotion, restore and consistency paths submit detached TM captures through the durable command',async t=>{
  for(const origin of ['save','confirm','restore','consistency']) await t.test(origin,async()=>{
    const h=enablePending(saveFixture()),{editor:e,window,desc}=h;
    window.TranslationMemory=require('../public/translationMemory.js');
    window.OfflineStore.getTranslationMemory=async()=>({units:[]});
    const notifications=[];window.OfflineStore.notifyTranslationMemoryChange=scope=>notifications.push(scope);
    const revisions=[{filepath:desc.filepath,lang:'Thai',translations:['ยืนยัน','สอง'],note:origin}];
    const pending=e.persistTranslationBatch([{desc,lines:['ยืนยัน','สอง']}],origin,{revisions});
    await pendingTick();await pendingTick();
    assert.equal(h.calls.length,1);const batch=h.calls[0].batch;
    assert.equal(batch.origin,origin);assert.equal(batch.tmCapture.length,2);
    assert.equal(batch.tmCapture[0].source,'Original');assert.equal(batch.tmCapture[0].target,'ยืนยัน');
    assert.equal(batch.tmCapture[0].provenance.jobId,batch.jobId);
    assert.deepEqual(JSON.parse(JSON.stringify(batch.revisions)),revisions);
    assert.equal(notifications.length,0,'Only a committed receipt can announce TM learning.');
    h.acknowledge(h.calls[0],{tmChanged:true});await pending;
    assert.equal(notifications.length,1);assert.equal(notifications[0].language,'Thai');
  });
});

test('translated imports and received cloud translations do not automatically author TM captures',async()=>{
  const h=enablePending(saveFixture()),{editor:e,window,desc}=h;
  window.TranslationMemory=require('../public/translationMemory.js');window.OfflineStore.getTranslationMemory=async()=>({units:[]});
  await e.persistTranslationBatch([{desc,lines:['นำเข้า','สอง']}],'import');
  assert.equal(h.calls.length,0);assert.equal(h.writes.length,1);
  await e.receiveCollaborationFiles([{filepath:desc.filepath,translations:['ส่วนกลาง','สอง'],trackedForExport:true,needsReview:false}],'Thai');
  assert.equal(h.calls.length,0);
});

async function pendingDraftFixture() {
  const h = enablePending(saveFixture()), { editor: e, window, context } = h;
  const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const records = new Map(), draftWrites = [], opened = [];
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/inlineEditor.js'), 'utf8'), context);
  const mixin = window.InlineEditor.mixin;
  Object.assign(e, mixin.data(), mixin.methods);
  for (const [name, getter] of Object.entries(mixin.computed)) {
    if (!Object.hasOwn(e, name)) Object.defineProperty(e, name, { get: () => getter.call(e) });
  }
  window.crypto = context.crypto;
  window.OfflineStore.getTranslationDraft = async key => plain(records.get(key) || null);
  window.OfflineStore.listTranslationDrafts = async scope => [...records.values()]
    .filter(record => record.profile === scope.profile && record.game === scope.game && record.language === scope.language
      && (record.branchId || 'default') === scope.branchId && (record.state === 'active' || record.conflicts?.length)).map(plain);
  window.OfflineStore.putTranslationDraft = async (record, options) => {
    assert.equal(records.get(record.key)?.revision || null, options.expectedRevision);
    draftWrites.push(plain(record)); records.set(record.key, plain(record));
    return { status: 'saved', record: plain(record) };
  };
  e.descs = [h.desc, description(2), description(3)];
  for (const desc of e.descs) desc.hasChanges = false;
  e._workspaceSourceBaseline = plain(e.descs);
  e.localDescs = { descs: [], status: {}, sourceHash: e.sourceIdentity };
  window.WorkspaceState.initializeWorkspace(e.localDescs, {
    source: e._workspaceSourceBaseline, sourceHash: e.sourceIdentity, game: e.gameVersion, language: e.lang,
  });
  e.selectedFileFilters = ['unchanged', 'saved', 'localDraft']; e.filterDesc();
  e.refreshGamePreview = () => {};
  e.observeInlineBlocks = () => {};
  e.openEditorFile = async filepath => {
    const desc = e.getDescByFilepath(filepath);
    opened.push(filepath); e.inlineActive = e._nextEditorSurface === 'inline'; e.editorVisible = !e.inlineActive; e.editorLoading = false;
    e._editorOpenRun = (e._editorOpenRun || 0) + 1;
    e.editorCurrentEditingDesc = desc; e.editorBlocks = []; e._editorCollabBase = undefined;
    await e.hydrateEditorDraft({ desc, isCurrent: () => e.editorCurrentEditingDesc === desc });
    return true;
  };
  await e.editFile(h.desc.filepath);
  e.editorBlocks[0].translation = 'Submitted first draft';
  await e.flushEditorDraft();
  const acknowledge = (call, extra = {}) => {
    const draft = call.batch.draft, record = draft && records.get(draft.key);
    const draftConsumed = !!draft && record?.revision === draft.revision;
    if (draftConsumed) records.set(record.key, {
      ...record, state: 'promoted', consumedRevision: record.revision,
      revision: record.revision + ':promoted:' + call.batch.jobId,
      translations: [], base: null, source: null,
    });
    h.acknowledge(call, { draftConsumed, ...extra });
  };
  return { ...h, records, draftWrites, opened, acknowledge };
}

async function assertSaveReleased(h, action) {
  let finished = false;
  const saving = action().then(result => { finished = true; return result; });
  await pendingTick();
  if (!finished) {
    // Finish the held request before failing so a regression leaves no hanging test queue.
    const released = new Set();
    for (let attempt = 0; attempt < 4 && !finished; attempt++) {
      for (const call of h.calls) if (!released.has(call)) { released.add(call); h.acknowledge(call); }
      await pendingTick();
    }
    assert.fail('Editor navigation waited for the held durable save.');
  }
  assert.equal(await saving, true);
}

function pendingStagedDeletionFixture() {
  const h = enablePending(saveFixture()), { editor: e, window, desc } = h;
  const baseline = JSON.parse(JSON.stringify(desc));
  baseline.hasChanges = false; baseline.translations.Thai = ['ZIP original', 'ZIP second'];
  baseline.translations.German = ['ZIP German', 'ZIP German second'];
  e._workspaceSourceBaseline = [baseline];
  e.localDescs = { sourceHash: e.sourceIdentity, descs: [], status: {} };
  window.WorkspaceState.initializeWorkspace(e.localDescs,
    { source: [baseline], sourceHash: e.sourceIdentity, game: e.gameVersion, language: e.lang });
  window.WorkspaceState.dropTranslation(e.localDescs, baseline, 'Thai',
    { translations: ['Preserved dropped', 'Preserved second'], originSourceHash: 'older-source', targetSourceHash: e.sourceIdentity });
  window.WorkspaceState.stageTranslation(e.localDescs,
    { filepath: desc.filepath, translations: ['Staged first', 'Staged second'] }, 'Thai', { source: baseline });
  window.WorkspaceState.stageTranslation(e.localDescs,
    { filepath: desc.filepath, translations: ['Staged German', 'Staged German second'] }, 'German', { source: baseline });
  e.applyWorkspaceOverlay();
  e.editorBlocks = [{ english: 'Original', translation: 'Keep local typing' }, { english: 'Second', translation: 'Staged second' }];
  return { ...h, baseline, base: JSON.parse(JSON.stringify(e.collaborationFile(desc))) };
}

test('staged deletion waits for its durable transaction and records both sides without promoting dropped copies or consuming drafts', async () => {
  const { editor: e, desc, calls, acknowledge, window, baseline, base } = pendingStagedDeletionFixture();
  const candidate = JSON.parse(JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai')));
  const german = JSON.parse(JSON.stringify(e.localDescs.staged.German[desc.filepath]));
  let finished = false;
  const deleting = e.persistStagedDeletion(desc, base).then(result => { finished = true; return result; });
  await pendingTick();
  assert.equal(calls.length, 1); assert.equal(finished, false);
  const batch = calls[0].batch;
  assert.equal(batch.resetStaging, true); assert.equal(batch.origin, 'delete_staged'); assert.equal(batch.deferDisplay, true);
  assert.equal(batch.language, 'Thai'); assert.equal(batch.sourceHash, e.sourceIdentity); assert.equal(batch.game, e.gameVersion);
  assert.deepEqual(JSON.parse(JSON.stringify(batch.bases[desc.filepath])), base);
  assert.equal(batch.draft, undefined); assert.equal(batch.promoteDropped, undefined); assert.equal(batch.promoteDroppedByPath, undefined);
  assert.equal(batch.files[0].stagingReset, true); assert.equal(batch.files[0].trackedForExport, false);
  assert.deepEqual(Array.from(batch.files[0].translations), baseline.translations.Thai);
  assert.deepEqual(Array.from(batch.revisions[0].translations), base.translations);
  assert.deepEqual(Array.from(batch.revisions[1].translations), baseline.translations.Thai);
  assert.match(batch.revisions[0].note, /Before delete staged translation/); assert.equal(batch.revisions[1].note, 'Delete staged translation');
  assert.equal(e._pendingSaves.overlay(e.pendingSaveScope(), desc.filepath), null);
  assert.deepEqual(Array.from(desc.translations.Thai), base.translations);
  assert.ok(e.localDescs.staged.Thai[desc.filepath]); assert.equal(e.editorBlocks[0].translation, 'Keep local typing');
  acknowledge(calls[0]);
  const result = await deleting;
  assert.equal(result.durable, true); assert.equal(e.pendingLocalSaves, 0);
  assert.equal(e.localDescs.staged.Thai[desc.filepath], undefined); assert.equal(desc.hasChanges, false);
  assert.deepEqual(Array.from(desc.translations.Thai), baseline.translations.Thai);
  assert.deepEqual(JSON.parse(JSON.stringify(e.localDescs.staged.German[desc.filepath])), german);
  assert.deepEqual(JSON.parse(JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai'))), candidate);
  assert.equal(e.editorBlocks[0].translation, 'Keep local typing'); assert.equal(e.editorVisible, true);
});

test('staged deletion storage failure keeps the visible stage and retains the identical deletion for an explicit retry', async () => {
  const { editor: e, desc, calls, acknowledge, base } = pendingStagedDeletionFixture();
  const deleting = e.persistStagedDeletion(desc, base);
  const rejected = assert.rejects(deleting, /Disk full/);
  await pendingTick(); const original = JSON.stringify(calls[0].batch);
  calls[0].reject(new Error('Disk full')); await rejected;
  assert.deepEqual(Array.from(desc.translations.Thai), base.translations);
  assert.ok(e.localDescs.staged.Thai[desc.filepath]); assert.equal(e.pendingLocalSaves, 1);
  assert.match(e.localSaveError, /Disk full/); assert.equal(e.editorBlocks[0].translation, 'Keep local typing');
  const retrying = e.retryPendingSaves(); await pendingTick();
  assert.equal(calls.length, 2); assert.equal(JSON.stringify(calls[1].batch), original);
  assert.match(e.localSaveError, /Disk full/);
  acknowledge(calls[1]); await retrying;
  assert.equal(e.pendingLocalSaves, 0); assert.equal(e.localSaveError, '');
  assert.equal(e.localDescs.staged.Thai[desc.filepath], undefined);
});

test('a staged deletion acknowledgement awaits its captured editor hook before the queue finishes', async () => {
  const { editor: e, desc, calls, acknowledge, base } = pendingStagedDeletionFixture();
  let release, hookCalls = 0, finished = false;
  const hookGate = new Promise(resolve => { release = resolve; });
  const deleting = e.persistStagedDeletion(desc, base, e.captureCollaborationContext(), async () => {
    hookCalls++;
    assert.equal(e.localDescs.staged.Thai[desc.filepath], undefined);
    assert.equal(desc.translations.Thai[0], 'ZIP original');
    await hookGate;
  }).then(result => { finished = true; return result; });
  await pendingTick(); acknowledge(calls[0]); await pendingTick();
  assert.equal(hookCalls, 1); assert.equal(finished, false);
  assert.equal(e._pendingSaves.snapshot().jobs.length, 1);
  release(); assert.equal((await deleting).durable, true);
  assert.equal(hookCalls, 1); assert.equal(e._pendingSaves.snapshot().jobs.length, 0);
});

test('a transactionally rejected staged deletion leaves the stage intact and removes only that stale reset from the queue', async () => {
  const { editor: e, desc, calls, base, submissions } = pendingStagedDeletionFixture();
  let draftReads = 0; e.loadEditorDrafts = async () => { draftReads++; };
  const deleting = e.persistStagedDeletion(desc, base);
  const rejected = assert.rejects(deleting, error => error.code === 'DELETE_STAGED_BASE_CHANGED');
  await pendingTick();
  calls[0].reject(Object.assign(new Error('The saved translation changed'), { code: 'DELETE_STAGED_BASE_CHANGED' }));
  await rejected;
  assert.deepEqual(Array.from(desc.translations.Thai), base.translations);
  assert.ok(e.localDescs.staged.Thai[desc.filepath]); assert.equal(e._pendingSaves.snapshot().jobs.length, 0);
  assert.equal(submissions.get(calls[0].batch.jobId).state, 'review'); assert.equal(draftReads, 0);
  assert.match(e.inlineDraftFindings[desc.filepath][0].message, /confirm deletion again/);
});

test('a late staged deletion acknowledgement cannot update a replacement editor scope', async () => {
  const { editor: e, desc, calls, acknowledge, base } = pendingStagedDeletionFixture();
  const deleting = e.persistStagedDeletion(desc, base); await pendingTick();
  e.lang = 'German'; desc.translations.German = ['Current German typing', 'Second'];
  acknowledge(calls[0]);
  assert.equal((await deleting).stale, true);
  assert.deepEqual(Array.from(desc.translations.German), ['Current German typing', 'Second']);
  assert.ok(e.localDescs.staged.Thai[desc.filepath]); assert.ok(e.localDescs.staged.German[desc.filepath]);
  assert.equal(e.editorBlocks[0].translation, 'Keep local typing');
});

test('staged deletion refreshes its completed diagnostic findings and preserves unrelated results', async () => {
  const { editor: e, desc, remaining, clean, calls, acknowledge, window } = enablePending(diagnosticSaveFixture());
  const baseline = JSON.parse(JSON.stringify(e.descs));
  baseline.forEach(file => { file.hasChanges = false; });
  baseline[0].translations.Thai = ['ZIP translation {0}', 'สอง'];
  e._workspaceSourceBaseline = baseline;
  e.localDescs = { sourceHash: e.sourceIdentity, descs: [], status: {} };
  window.WorkspaceState.initializeWorkspace(e.localDescs,
    { source: baseline, sourceHash: e.sourceIdentity, game: e.gameVersion, language: e.lang });
  window.WorkspaceState.stageTranslation(e.localDescs,
    { filepath: desc.filepath, translations: ['Missing variable', 'สอง'] }, 'Thai', { source: baseline[0] });
  e.applyWorkspaceOverlay(); await e.scanAllDiagnostics();
  assert.equal(e.diagnosticScanErrorFileCount, 2);
  const prior = e.diagnosticScanResults[desc.filepath], unrelated = e.diagnosticScanResults[remaining.filepath], cleanResult = e.diagnosticScanResults[clean.filepath];
  const scanId = e.diagnosticScanRunId, checks = e.diagnosticScanAppliedChecks;
  const deleting = e.persistStagedDeletion(desc, e.collaborationFile(desc)); await pendingTick();
  assert.equal(e.diagnosticScanResults[desc.filepath], prior);
  acknowledge(calls[0]); await deleting;
  assert.equal(e.diagnosticScanCompleted, true); assert.equal(e.diagnosticScanRunId, scanId); assert.equal(e.diagnosticScanAppliedChecks, checks);
  assert.notEqual(e.diagnosticScanResults[desc.filepath], prior); assert.equal(e.diagnosticScanResults[desc.filepath].hasDiagnosticError, false);
  assert.equal(e.diagnosticScanResults[remaining.filepath], unrelated); assert.equal(e.diagnosticScanResults[clean.filepath], cleanResult);
  assert.equal(e.diagnosticScanErrorFileCount, 1);
  assert.deepEqual(Array.from(e.filteredDescs, file => file.filepath), [remaining.filepath]);
});

function deletionConflictFixture() {
  const h = saveFixture(), { editor: e, desc } = h;
  desc.translations.English = ['Left {0}@Right', 'Second'];
  const conflict = { id: 'delete-conflict', kind: 'delete_staged', filepath: desc.filepath,
    yours: { filepath: desc.filepath, translations: ['Malformed original ZIP translation'], needsReview: false, trackedForExport: false, stagingReset: true },
    shared: { filepath: desc.filepath, translations: ['Malformed existing shared translation'], needsReview: false, trackedForExport: true, revision: 3 } };
  const resolved = [], confirms = [];
  e.editorVisible = false;
  e._collaboration = { snapshot: () => ({ conflicts: [conflict] }),
    resolve: async (id, file) => { resolved.push({ id, file }); return { status: 'synced' }; } };
  e.appConfirm = async (message, options) => { confirms.push({ message, options }); return true; };
  return { ...h, conflict, resolved, confirms };
}

test('deletion conflicts preserve exact existing choices despite invalid ZIP text and reconfirm deletion as a danger action', async t => {
  for (const choice of ['yours', 'shared']) await t.test(choice === 'yours' ? 'confirm deletion' : 'keep shared translation', async () => {
    const { editor: e, conflict, resolved, confirms } = deletionConflictFixture();
    e.analyzeTranslationDiagnostics = () => assert.fail('Existing deletion-conflict choices must not run Save validation');
    assert.equal((await e.collabResolve(conflict.id, conflict[choice])).status, 'synced');
    assert.equal(resolved.length, 1); assert.equal(resolved[0].id, conflict.id); assert.equal(resolved[0].file, conflict[choice]);
    assert.equal(confirms.length, choice === 'yours' ? 1 : 0);
    if (choice === 'yours') {
      assert.equal(confirms[0].options.danger, true); assert.equal(confirms[0].options.confirmLabel, 'Delete staged translation');
    }
  });
});

test('declining or invalidating a deletion-conflict confirmation leaves both shared choices intact', async t => {
  for (const invalidate of [false, true]) await t.test(invalidate ? 'source changed' : 'declined', async () => {
    const { editor: e, conflict, resolved } = deletionConflictFixture();
    const before = JSON.parse(JSON.stringify(conflict));
    let answer;
    e.appConfirm = () => new Promise(resolve => { answer = resolve; });
    const resolving = e.collabResolve(conflict.id, conflict.yours); await pendingTick();
    if (invalidate) e.sourceIdentity = 'other-source';
    answer(invalidate);
    const result = await resolving;
    assert.equal(result.status, 'conflict'); assert.equal(!!result.stale, invalidate); assert.equal(resolved.length, 0);
    assert.deepEqual(conflict, before);
  });
});

test('arbitrary deletion-conflict edits still require normal translation validation', async () => {
  const { editor: e, conflict, resolved } = deletionConflictFixture();
  const edited = { ...conflict.yours, translations: ['Arbitrary edited translation', 'Second'] };
  await assert.rejects(e.collabResolve(conflict.id, edited), /table column count/);
  assert.equal(resolved.length, 0);
  await assert.rejects(e.collabResolve(conflict.id, conflict.yours.translations), /comparison no longer matches/);
  assert.equal(resolved.length, 0);
});

test('draft promotion publishes committed translations only after its durable acknowledgement', async () => {
  const { editor: e, desc, calls, acknowledge } = enablePending(saveFixture());
  const before = [...desc.translations.Thai];
  const draft = { key: 'draft-scope', id: 'draft-id', revision: 3, base: { translations: before } };
  let finished = false;
  const saving = e.persistTranslationBatch([{ desc, lines: ['Promoted', 'Second'] }], 'save',
    { draft, awaitDurable: true, inline: true }).then(result => { finished = true; return result; });
  await pendingTick();
  assert.equal(calls.length, 1);
  assert.equal(finished, false);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].batch.draft)), draft);
  assert.deepEqual(Array.from(desc.translations.Thai), before);
  assert.equal(e._pendingSaves.overlay(e.pendingSaveScope(), desc.filepath), null);
  acknowledge(calls[0], { draftConsumed: true });
  const result = await saving;
  assert.equal(result.durable, true); assert.equal(result.draftConsumed, true);
  assert.deepEqual(Array.from(desc.translations.Thai), ['Promoted', 'Second']);
  assert.ok(e.localDescs.status[desc.filepath]);
});

test('rejected stale draft promotion retains committed text and releases only its failed queue entry', async () => {
  const { editor: e, desc, calls } = enablePending(saveFixture());
  const before = [...desc.translations.Thai];
  const saving = e.persistTranslationBatch([{ desc, lines: ['Stale proposal', 'Second'] }], 'save',
    { draft: { key: 'draft-scope', id: 'draft-id', revision: 1 }, awaitDurable: true, inline: true });
  await pendingTick();
  const rejected = assert.rejects(saving, error => error.code === 'DRAFT_BASE_CHANGED');
  calls[0].reject(Object.assign(new Error('Committed base changed'), { code: 'DRAFT_BASE_CHANGED' }));
  await rejected;
  assert.deepEqual(Array.from(desc.translations.Thai), before);
  assert.equal(e._pendingSaves.snapshot().jobs.length, 0);
});

test('inline promotion cannot implicitly approve an unresolved dropped translation', async () => {
  const { editor: e, desc, writes, window } = droppedReviewFixture();
  const candidate = window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, e.lang);
  await assert.rejects(e.persistTranslationBatch([{ desc, lines: ['Replacement', 'Second'] }], 'save', { inline: true }), /full editor.*dropped translation/);
  assert.equal(writes.length, 0);
  assert.equal(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, e.lang).id, candidate.id);
});

test('known shared conflicts and committed-base changes retain drafts before either editor can enqueue staging', async t => {
  for (const inline of [false, true]) for (const conflict of [false, true]) await t.test(`${inline ? 'inline' : 'full'} ${conflict ? 'conflict' : 'changed base'}`, async () => {
    const { editor: e, desc, calls } = enablePending(saveFixture());
    const before = [...desc.translations.Thai];
    const draft = { key: 'draft-scope', id: 'draft-id', revision: 'draft-revision', base: { translations: before } };
    e._draftSession = { record: draft };
    e._collaboration = {
      snapshot: () => ({ conflicts: conflict ? [{ filepath: desc.filepath }] : [] }),
      fileBase: () => ({ filepath: desc.filepath, translations: conflict ? before : ['new committed peer text', before[1]] }),
    };
    await assert.rejects(e.persistTranslationBatch([{ desc, lines: ['My draft', 'Second'] }], 'save',
      { draft, awaitDurable: true, inline }), error => error.code === (conflict ? 'DRAFT_CONFLICT' : 'DRAFT_BASE_CHANGED') && /full editor/.test(error.message));
    assert.equal(calls.length, 0);
    assert.equal(e._draftSession.record, draft);
    assert.deepEqual(desc.translations.Thai, before);
  });
});

test('post-commit draft bookkeeping cannot close a replacement editor session', async () => {
  const { editor: e } = saveFixture();
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  e._draftSession = { record: null };
  e.editorDraftCommitted = async () => { started(); await gate; };
  const saving = e.editorSave();
  await waiting;
  const replacement = description(2);
  const blocks = [{ english: 'Other', translation: 'New session typing' }];
  const session = { record: null };
  e.editorCurrentEditingDesc = replacement; e.editorBlocks = blocks; e._draftSession = session;
  e.editorVisible = true; e.editorDroppedCandidate = { id: 'new-session-candidate' };
  release();
  assert.equal(await saving, false);
  assert.equal(e.editorVisible, true); assert.equal(e.editorBlocks, blocks); assert.equal(e._draftSession, session);
  assert.equal(e.editorDroppedCandidate.id, 'new-session-candidate');
});

test('a delayed inline blur cannot promote or clear a replacement scope session', async () => {
  const h = saveFixture(), e = h.editor;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/inlineEditor.js'), 'utf8'), h.context);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const original = { scope: { profile: 'first' }, record: { id: 'first' } };
  const replacement = { scope: { profile: 'second' }, record: { id: 'second' } };
  e.inlineActive = true; e.editorVisible = false; e._draftSession = original; e.inlineTransitionBusy = false;
  e.flushEditorDraft = () => gate;
  e.draftScopeCurrent = scope => scope.profile === e._draftSession.scope.profile;
  let promotions = 0; e.editorSave = async () => { promotions++; return true; };
  const finishing = h.window.InlineEditor.mixin.methods.finishInlineSession.call(e, { promote: true });
  e._draftSession = replacement; release(true);
  assert.equal(await finishing, false);
  assert.equal(promotions, 0); assert.equal(e._draftSession, replacement); assert.equal(e.inlineActive, true);
});

test('reconnect claims serialize with newer inline row claims before releasing a stale result', async () => {
  const { editor: e } = saveFixture();
  const events = [], waiters = [];
  const client = e._collaboration = {
    editing: null,
    claim(filepath) {
      events.push('claim:' + filepath);
      return new Promise(resolve => waiters.push(() => { client.editing = filepath; resolve({ granted: true }); }));
    },
    leaveEdit() { events.push('release:' + client.editing); client.editing = null; },
  };
  let originalCurrent = true;
  const original = e.claimCollaborationFile('old-row.txt', false, () => originalCurrent);
  originalCurrent = false;
  const current = e.claimCollaborationFile('new-row.txt', false, () => true);
  assert.deepEqual(events, ['claim:old-row.txt']);
  waiters[0](); assert.equal(await original, false);
  await Promise.resolve();
  assert.deepEqual(events, ['claim:old-row.txt', 'release:old-row.txt', 'claim:new-row.txt']);
  waiters[1](); assert.equal(await current, true);
  assert.equal(client.editing, 'new-row.txt');
  assert.equal(e._collaborationClaimPending, null);
});

test('F2 opens first available visible row, F1 opens last available visible row', async () => {
  const { editor: e, opened } = navigationFixture();
  e._collaboration = { isEditing: p => /001|020/.test(p) };
  await e.saveAndSkipFile(); assert.equal(opened[0], 'source/002.txt');
  e.editorVisible = false; e.currentPage = 1;
  await e.saveAndSkipFile(true); assert.equal(opened[1], 'source/019.txt');
});
test('a claim superseded inside the client does not release or ask to override its newer claim', async () => {
  const { editor: e } = saveFixture();
  e._collaboration = {
    claim: async () => ({ granted: false, stale: true }),
    leaveEdit: () => assert.fail('The newer claim must remain active'),
  };
  e.appConfirm = () => assert.fail('An obsolete claim must not ask for an override');
  assert.equal(await e.claimCollaborationFile('old-row.txt', false, () => false), false);
  assert.equal(await e.claimCollaborationFile('old-row.txt'), false);
});
test('automatic navigation skips occupied pages without wrapping', async () => {
  const { editor: e, opened } = navigationFixture();
  e.editorVisible = true; e.editorCurrentEditingDesc = e.descs[0]; e.editorHaveChanges = () => false;
  e._collaboration = { isEditing: p => p !== 'source/041.txt' };
  assert.equal(await e.saveAndSkipFile(false, true), true); assert.equal(opened[0], 'source/041.txt'); assert.equal(e.currentPage, 3);
  assert.equal(await e.saveAndSkipFile(false, true), false); assert.equal(opened.length, 1); assert.match(e.collaborationNotice, /No available files/);
});
test('explicit save-and-next stages an unchanged file before navigation', async () => {
  const { editor: e, opened } = navigationFixture(3);
  e.editorVisible = true; e.editorCurrentEditingDesc = e.descs[0]; e.editorHaveChanges = () => false;
  let saves = 0;
  e.editorSave = async options => { assert.equal(options.close, false); saves++; return true; };
  assert.equal(await e.saveAndSkipFile(), true);
  assert.equal(saves, 1); assert.deepEqual(opened, ['source/002.txt']);
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

test('journaled worker Save & close preserves diagnostics until committed acknowledgment', async () => {
  const { editor: e, desc, remaining, calls, acknowledge } = enablePending(diagnosticSaveFixture());
  await e.scanAllDiagnostics();
  const untouchedResult = e.diagnosticScanResults[remaining.filepath];
  const scanId = e.diagnosticScanRunId, appliedChecks = e.diagnosticScanAppliedChecks;
  assert.equal(await e.editorSave(), true);
  assert.equal(e.editorVisible, false); assert.equal(e.pendingLocalSaves, 1);
  assert.equal(e.diagnosticScanResults[desc.filepath].hasDiagnosticError, true);
  assert.equal(e.diagnosticScanErrorFileCount, 2);
  await pendingTick(); assert.equal(calls.length, 1);
  acknowledge(calls[0]); await e._pendingSaves.drain();
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

test('peer updates preserve an inline draft and capture its ancestor before replacing committed text', () => {
  const { editor: e, window } = saveFixture();
  e.editorVisible = false; e.inlineActive = true;
  const record = { id: 'private-draft', revision: 'draft-one', translations: ['ใหม่', 'สอง'], base: { translations: ['เดิม', 'สอง'] } };
  e._draftSession = { record, base: record.base };
  const session = e._draftSession, blocks = e.editorBlocks;
  const shared = { filepath: e.descs[0].filepath, translations: ['ทีม', 'สอง'], trackedForExport: true, revision: 2 };
  e._editorCollabBase = undefined; e._collaboration = { fileBase: () => shared };
  e.applyCollaborationFiles([shared]);
  assert.equal(e.editorSessionActive, true);
  assert.equal(e.editorBlocks, blocks); assert.equal(e._draftSession, session); assert.equal(session.record, record);
  assert.deepEqual(record.translations, ['ใหม่', 'สอง']);
  assert.deepEqual([...e._editorCollabBase.translations], ['เดิม', 'สอง']);
  assert.equal(e.descs[0].translations.Thai[0], 'ทีม');
  const merged = window.CollaborationProtocol.mergeFile(e._editorCollabBase,
    { ...e._editorCollabBase, translations: record.translations }, shared);
  assert.deepEqual(merged.indexes, [0]);
});

test('empty and equivalent shared data preserve display snapshots and Lookup caches', () => {
  const { editor: e } = saveFixture(); let filters = 0;
  e.filterDesc = () => { filters++; };
  e.applyCollaborationFiles([]); assert.equal(filters, 0);
  const files = [{ filepath: e.descs[0].filepath, translations: ['เดิม', 'สอง'], trackedForExport: true, needsReview: false }];
  e.applyCollaborationFiles(files);
  e.localDescs.staged[e.lang][e.descs[0].filepath].savedAt = 12345;
  filters = 0; const translation = e.descs[0].translations.Thai, saved = e.localDescs.descs[0].translations.Thai;
  e.applyCollaborationFiles(files);
  assert.equal(filters, 0); assert.equal(e.descs[0].translations.Thai, translation);
  assert.equal(e.localDescs.descs[0].translations.Thai, saved);
  assert.equal(e.localDescs.staged[e.lang][e.descs[0].filepath].savedAt, 12345);
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
  for (const file of ['statDescCodec.js', 'statDescParser.js', 'dummyFiles.js']) {
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/statDescCodec.js'), 'utf8'), context, { filename: 'statDescCodec.js' });
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

test('reviewed shared conflict resolution advances and persists the clean draft base', async () => {
  const { editor: e, desc } = saveFixture();
  const yours = { filepath: desc.filepath, translations: e.editorBlocks.map(block => block.translation), trackedForExport: true, revision: 1 };
  const accepted = { ...yours, translations: ['Reviewed shared translation', 'Reviewed second entry'], revision: 4 };
  const conflict = { id: 'conflict-one', filepath: desc.filepath, yours };
  const session = e._draftSession = { base: { translations: ['old base', 'old second'] } };
  let flushed = 0;
  e.flushEditorDraft = async () => { flushed++; assert.deepEqual(Array.from(session.base.translations), accepted.translations); return true; };
  e._collaboration = {
    snapshot: () => ({ conflicts: [conflict] }), fileBase: () => JSON.parse(JSON.stringify(accepted)),
    resolve: async () => ({ status: 'synced' }),
  };
  assert.equal((await e.collabResolve('conflict-one', accepted.translations)).status, 'synced');
  assert.equal(flushed, 1); assert.equal(e._draftSession, session);
  assert.deepEqual(Array.from(e.editorBlocks, block => block.translation), accepted.translations);
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

test('draft-backed full saves close or navigate before acknowledgment without publishing Saved work', async t => {
  for (const navigate of [false, true]) await t.test(navigate ? 'save-and-next' : 'Save & close', async () => {
    const h = await pendingDraftFixture(), { editor: e, desc, calls, records, acknowledge, window } = h;
    const before = [...desc.translations.Thai], session = e._draftSession;
    await assertSaveReleased(h, () => navigate ? e.saveAndSkipFile() : e.editorSave());
    assert.equal(e.editorSaving, false); assert.equal(e.navigationBusy, false); assert.equal(e.pendingLocalSaves, 1);
    // F2 releases its dispatch hold after readiness; the worker starts on the
    // following timer turn rather than during the navigation promise.
    await pendingTick();
    assert.equal(calls.length, 1); assert.equal(calls[0].batch.deferDisplay, true);
    assert.equal(calls[0].batch.draft.id, session.record.id);
    assert.deepEqual(Array.from(desc.translations.Thai), before);
    assert.equal(window.WorkspaceState.workspaceFile(e.localDescs, e.workspaceSourceFile(desc.filepath), e.lang).staged, null);
    assert.equal(records.get(session.key).state, 'active');
    assert.equal(e.inlineDraftRows[desc.filepath].translations[0], 'Submitted first draft');
    assert.equal(h.warnsBeforeUnload(), true);
    if (navigate) {
      assert.equal(e.editorCurrentEditingDesc.filepath, 'source/002.txt'); assert.equal(e.editorVisible, true);
    } else assert.equal(e.editorVisible, false);
    acknowledge(calls[0]); await e._pendingSaves.drain();
    assert.equal(e.pendingLocalSaves, 0); assert.equal(desc.translations.Thai[0], 'Submitted first draft');
    assert.equal(records.get(session.key).state, 'promoted'); assert.equal(e.inlineDraftRows[desc.filepath], undefined);
    assert.equal(window.WorkspaceState.workspaceFile(e.localDescs, e.workspaceSourceFile(desc.filepath), e.lang).hasChanges, true);
    if (navigate) assert.equal(e.editorCurrentEditingDesc.filepath, 'source/002.txt');
    else assert.equal(e.editorVisible, false);
  });
});

for (const reverse of [false, true]) test(`${reverse ? 'F1' : 'F2'} prepares the destination draft and paints its editable fields before dispatching the old save`, async () => {
  const h = await pendingDraftFixture(), { editor: e, calls, window, acknowledge } = h;
  if (reverse) {
    assert.equal(await e.editFile('source/002.txt'), true);
    e.editorBlocks[0].translation = 'Submitted previous-file draft';
  }
  const nextPath = reverse ? 'source/001.txt' : 'source/002.txt', nextKey = e.editorDraftKey(e.editorDraftScope(nextPath));
  let releaseHydration, hydrationStarted, releasePaint, paintStarted;
  const hydrationGate = new Promise(resolve => { releaseHydration = resolve; });
  const hydrationReady = new Promise(resolve => { hydrationStarted = resolve; });
  const paintGate = new Promise(resolve => { releasePaint = resolve; });
  const paintReady = new Promise(resolve => { paintStarted = resolve; });
  const readDraft = window.OfflineStore.getTranslationDraft;
  window.OfflineStore.getTranslationDraft = async key => {
    if (key === nextKey) { hydrationStarted(); await hydrationGate; }
    return readDraft(key);
  };
  e.yieldEditorPaint = async () => { paintStarted(); await paintGate; };
  const navigating = e.saveAndSkipFile(reverse);
  await hydrationReady; await pendingTick();
  assert.equal(calls.length, 0, 'The old save must not take the draft store before next-file hydration.');
  assert.equal(e.pendingLocalSaves, 1);
  releaseHydration(); await paintReady; await pendingTick();
  assert.equal(e.editorCurrentEditingDesc.filepath, nextPath);
  assert.equal(e.editorLoading, false); assert.equal(e.editorBlocks.length, 2);
  assert.equal(calls.length, 0, 'The first editable paint has priority over dispatch.');
  releasePaint(); assert.equal(await navigating, true);
  assert.equal(e.navigationBusy, false);
  await pendingTick(); assert.equal(calls.length, 1);
  e.editorBlocks[0].translation = 'Typing in the ready next file';
  acknowledge(calls[0]); await e._pendingSaves.drain();
  assert.equal(e.editorCurrentEditingDesc.filepath, nextPath);
  assert.equal(e.editorBlocks[0].translation, 'Typing in the ready next file');
});

for (const reverse of [false, true]) test(`unsuccessful ${reverse ? 'F1' : 'F2'} transitions release queued saves on every exit path`, async t => {
  for (const outcome of ['save rejected', 'no candidate', 'open rejected', 'cancelled', 'open failed']) {
    await t.test(outcome, async () => {
      const { editor: e } = navigationFixture(outcome === 'no candidate' ? 1 : 3);
      const calls = [];
      e._pendingSaves = require('../public/pendingSaves.js').create({ save: async value => { calls.push(value.jobId); return {}; } });
      e._pendingSaves.enqueue({ jobId: outcome, game: 'poe1', language: 'Thai', sourceHash: 'source-one', accountId: 'account-one',
        files: [{ filepath: 'other.txt', translations: ['Existing queued work'] }], revisions: [] });
      e.editorVisible = true; e.editorCurrentEditingDesc = e.descs[reverse ? e.descs.length - 1 : 0];
      e.editorSave = async () => outcome !== 'save rejected';
      if (outcome === 'open rejected') e.editFile = async () => false;
      if (outcome === 'cancelled') e.editFile = async () => { e._editorOpenCancelRevision = (e._editorOpenCancelRevision || 0) + 1; return true; };
      if (outcome === 'open failed') e.editFile = async () => { throw new Error('Could not prepare next file'); };
      if (outcome === 'open failed') await assert.rejects(e.saveAndSkipFile(reverse), /Could not prepare/);
      else assert.equal(await e.saveAndSkipFile(reverse), false);
      await e._pendingSaves.drain();
      assert.deepEqual(calls, [outcome]); assert.equal(e.navigationBusy, false);
      e._pendingSaves.dispose();
    });
  }
});

for (const reverse of [false, true]) test(`${reverse ? 'F1' : 'F2'} releases its navigation hold before revisiting a draft with a queued save`, async () => {
  const h = await pendingDraftFixture(), { editor: e, calls, acknowledge } = h;
  const nextPath = reverse ? 'source/001.txt' : 'source/002.txt';
  const outgoingPath = reverse ? 'source/002.txt' : 'source/001.txt';
  assert.equal(await e.editFile(nextPath), true);
  e.editorBlocks[0].translation = 'Previously submitted next-file draft';
  assert.equal(await e.editorSave({ close: false, defer: true }), true);
  assert.equal(await e.editFile(outgoingPath), true);
  const navigating = e.saveAndSkipFile(reverse);
  await pendingTick();
  assert.equal(calls.length, 1, 'The pending-target barrier must be able to run its queued transaction.');
  assert.equal(calls[0].batch.files[0].filepath, nextPath);
  acknowledge(calls[0]); await pendingTick();
  assert.equal(calls.length, 2); assert.equal(calls[1].batch.files[0].filepath, outgoingPath);
  acknowledge(calls[1]);
  assert.equal(await navigating, true);
  assert.equal(e.editorCurrentEditingDesc.filepath, nextPath);
  assert.equal(e.editorBlocks[0].translation, 'Previously submitted next-file draft');
  assert.equal(e.pendingLocalSaves, 0);
});

test('another draft save can queue before acknowledgment while callbacks preserve the next editing session', async () => {
  const h = await pendingDraftFixture(), { editor: e, desc, calls, records, acknowledge } = h;
  const firstSession = e._draftSession;
  await assertSaveReleased(h, () => e.saveAndSkipFile());
  const second = e.editorCurrentEditingDesc, secondSession = e._draftSession;
  e.editorBlocks[0].translation = 'Submitted second draft';
  await e.flushEditorDraft();
  await assertSaveReleased(h, () => e.editorSave());
  assert.equal(e.pendingLocalSaves, 2); assert.equal(calls.length, 1);
  assert.equal(await e.editFile('source/003.txt'), true);
  const third = e.editorCurrentEditingDesc, thirdSession = e._draftSession, thirdBlocks = e.editorBlocks;
  e.editorBlocks[0].translation = 'Typing in the third file';
  assert.equal(await e.flushEditorDraft(), true);
  const thirdRecord = JSON.stringify(records.get(thirdSession.key));
  acknowledge(calls[0]); await pendingTick();
  assert.equal(calls.length, 2); assert.equal(desc.translations.Thai[0], 'Submitted first draft');
  assert.equal(second.translations.Thai[0], 'เดิม');
  assert.equal(e.editorCurrentEditingDesc, third); assert.equal(e._draftSession, thirdSession);
  assert.equal(e.editorBlocks, thirdBlocks); assert.equal(e.editorBlocks[0].translation, 'Typing in the third file');
  assert.equal(JSON.stringify(records.get(thirdSession.key)), thirdRecord);
  acknowledge(calls[1]); await e._pendingSaves.drain();
  assert.equal(second.translations.Thai[0], 'Submitted second draft');
  assert.equal(records.get(firstSession.key).state, 'promoted'); assert.equal(records.get(secondSession.key).state, 'promoted');
  assert.equal(e.editorCurrentEditingDesc, third); assert.equal(e._draftSession, thirdSession);
  assert.equal(e.editorBlocks, thirdBlocks); assert.equal(e.editorBlocks[0].translation, 'Typing in the third file');
  assert.equal(e.editorVisible, true); assert.equal(e.editorHaveChanges(), true);
  assert.equal(JSON.stringify(records.get(thirdSession.key)), thirdRecord);
});

test('explicit inline Stage draft releases navigation and preserves newer typing through acknowledgment', async t => {
  for (const leaveBeforeAck of [false, true]) await t.test(leaveBeforeAck ? 'leave the row before acknowledgment' : 'keep typing in the staged row', async () => {
    const h = await pendingDraftFixture(), { editor: e, desc, calls, records, acknowledge } = h;
    e.editorVisible = false; e.inlineActive = true; e._inlineHeldRows = e.descsDisplay.slice();
    const session = e._draftSession, blocks = e.editorBlocks, before = [...desc.translations.Thai];
    await assertSaveReleased(h, () => e.saveInlineDraft());
    assert.equal(e.editorSaving, false); assert.equal(e.inlineActive, true); assert.equal(e.pendingLocalSaves, 1);
    assert.equal(calls[0].batch.deferDisplay, true); assert.deepEqual(Array.from(desc.translations.Thai), before);
    assert.equal(e.localDescs.staged[e.lang]?.[desc.filepath], undefined);
    assert.equal(await e.saveInlineDraft(), false, 'A pending stage cannot resubmit the same draft.');
    e.editorBlocks[0].translation = 'Newer typing after Stage draft';
    assert.equal(await e.flushEditorDraft(), true);
    let nextSession, nextBlocks;
    if (leaveBeforeAck) {
      assert.equal(await e.activateInlineRow('source/002.txt'), true);
      nextSession = e._draftSession; nextBlocks = e.editorBlocks;
      e.editorBlocks[0].translation = 'Typing in the next inline row';
      assert.equal(e.editorSaving, false); assert.equal(e.pendingLocalSaves, 1); assert.equal(calls.length, 1);
    }
    acknowledge(calls[0]); await e._pendingSaves.drain();
    assert.equal(desc.translations.Thai[0], 'Submitted first draft'); assert.equal(e.pendingLocalSaves, 0);
    assert.equal(records.get(session.key).state, 'active');
    assert.equal(records.get(session.key).translations[0], 'Newer typing after Stage draft');
    assert.equal(records.get(session.key).base.translations[0], 'Submitted first draft');
    assert.equal(e.inlineDraftRows[desc.filepath].translations[0], 'Newer typing after Stage draft');
    if (leaveBeforeAck) {
      assert.equal(e.editorCurrentEditingDesc.filepath, 'source/002.txt'); assert.equal(e._draftSession, nextSession);
      assert.equal(e.editorBlocks, nextBlocks); assert.equal(e.editorBlocks[0].translation, 'Typing in the next inline row');
    } else {
      assert.equal(e._draftSession, session); assert.equal(e.editorBlocks, blocks);
      assert.equal(e.editorBlocks[0].translation, 'Newer typing after Stage draft');
      assert.equal(e.editorOriginalTranslations[0], 'Submitted first draft'); assert.equal(e.editorHaveChanges(), true);
    }
    assert.equal(e.inlineActive, true); assert.equal(e.editorVisible, false);
  });
});

test('a failed deferred draft save retains its durable draft and retries the original transaction', async () => {
  const h = await pendingDraftFixture(), { editor: e, desc, calls, records, acknowledge } = h;
  const session = e._draftSession, before = [...desc.translations.Thai];
  await assertSaveReleased(h, () => e.editorSave());
  const original = JSON.stringify(calls[0].batch), draftBefore = JSON.stringify(records.get(session.key));
  assert.equal(await e.editFile('source/002.txt'), true);
  const nextSession = e._draftSession, blocks = e.editorBlocks;
  e.editorBlocks[0].translation = 'Continue working after the failed save';
  const rejected = assert.rejects(e._pendingSaves.drain(), /Disk full/);
  calls[0].reject(new Error('Disk full')); await rejected;
  assert.equal(e.pendingLocalSaves, 1); assert.match(e.localSaveError, /Disk full/);
  assert.deepEqual(Array.from(desc.translations.Thai), before);
  assert.equal(JSON.stringify(records.get(session.key)), draftBefore);
  assert.equal(e.inlineDraftRows[desc.filepath].translations[0], 'Submitted first draft');
  const retrying = e.retryPendingSaves(); await pendingTick();
  assert.equal(calls.length, 2); assert.equal(JSON.stringify(calls[1].batch), original);
  assert.match(e.localSaveError, /Disk full/);
  acknowledge(calls[1]); await retrying;
  assert.equal(e.pendingLocalSaves, 0); assert.equal(e.localSaveError, '');
  assert.equal(records.get(session.key).state, 'promoted'); assert.equal(desc.translations.Thai[0], 'Submitted first draft');
  assert.equal(e._draftSession, nextSession); assert.equal(e.editorBlocks, blocks);
  assert.equal(e.editorBlocks[0].translation, 'Continue working after the failed save'); assert.equal(e.editorVisible, true);
});

test('a stale deferred draft is retained for scoped review and releases later queued file saves', async () => {
  const h = await pendingDraftFixture(), { editor: e, desc, calls, records, acknowledge } = h;
  const firstSession = e._draftSession, before = [...desc.translations.Thai];
  await assertSaveReleased(h, () => e.saveAndSkipFile());
  const second = e.editorCurrentEditingDesc;
  e.editorBlocks[0].translation = 'An independent second save';
  await assertSaveReleased(h, () => e.editorSave());
  assert.equal(e.pendingLocalSaves, 2);
  assert.equal(await e.editFile('source/003.txt'), true);
  const thirdSession = e._draftSession, blocks = e.editorBlocks;
  e.editorBlocks[0].translation = 'Keep typing while the first draft needs review';
  calls[0].reject(Object.assign(new Error('The committed translation changed. Review this draft.'), { code: 'DRAFT_BASE_CHANGED' }));
  await pendingTick(); await pendingTick();
  assert.equal(calls.length, 2, 'A rejected draft must not block an unrelated queued file.');
  assert.equal(e._pendingSaves.snapshot().jobs.length, 1); assert.equal(e.pendingLocalSaves, 1);
  assert.equal(e.localSaveError, '');
  assert.equal(e.inlineDraftError, '', 'A former file rejection must not become a global draft-write failure.');
  assert.deepEqual(Array.from(desc.translations.Thai), before);
  assert.equal(records.get(firstSession.key).state, 'active');
  assert.equal(e.inlineDraftRows[desc.filepath].translations[0], 'Submitted first draft');
  assert.ok(e.inlineDraftFindings[desc.filepath].some(item => item.level === 'error' && /changed|review/i.test(item.message)));
  assert.ok(e.inlineDraftFindings[desc.filepath].some(item => item.deferredSave));
  assert.ok(e.deferredDraftSaveError.includes(desc.filepath));
  assert.equal(e._draftSession, thirdSession); assert.equal(e.editorBlocks, blocks);
  assert.equal(e.editorBlocks[0].translation, 'Keep typing while the first draft needs review');
  acknowledge(calls[1]); await e._pendingSaves.drain();
  assert.equal(e.pendingLocalSaves, 0); assert.equal(second.translations.Thai[0], 'An independent second save');
  assert.equal(records.get(firstSession.key).state, 'active'); assert.equal(e._draftSession, thirdSession);
});

test('reopening a pending draft file waits for acknowledgment while another file opens immediately', async () => {
  const h = await pendingDraftFixture(), { editor: e, desc, calls, acknowledge } = h;
  await assertSaveReleased(h, () => e.editorSave());
  assert.equal(await e.editFile('source/002.txt'), true);
  const nextSession = e._draftSession;
  let reopened = false;
  const opening = e.editFile(desc.filepath).then(result => { reopened = true; return result; });
  await pendingTick();
  assert.equal(reopened, false); assert.equal(e.editorCurrentEditingDesc.filepath, 'source/002.txt');
  assert.equal(e._draftSession, nextSession);
  acknowledge(calls[0]); assert.equal(await opening, true);
  assert.equal(e.editorCurrentEditingDesc, desc); assert.equal(e.editorBlocks[0].translation, 'Submitted first draft');
  assert.equal(e._draftSession.record, null); assert.equal(e.inlineDraftRows[desc.filepath], undefined);
});

test('a failed pending-file reopen preserves the current editor until the original save is retried', async () => {
  const h = await pendingDraftFixture(), { editor: e, desc, calls, acknowledge, records } = h;
  const submittedSession = e._draftSession;
  await assertSaveReleased(h, () => e.editorSave());
  assert.equal(await e.editFile('source/002.txt'), true);
  const nextSession = e._draftSession, blocks = e.editorBlocks;
  e.editorBlocks[0].translation = 'Typing while a reopen is waiting';
  const opening = e.editFile(desc.filepath);
  await pendingTick(); calls[0].reject(new Error('Cannot write locally'));
  assert.equal(await opening, false);
  assert.equal(e._draftSession, nextSession); assert.equal(e.editorBlocks, blocks);
  assert.equal(e.editorBlocks[0].translation, 'Typing while a reopen is waiting');
  assert.equal(records.get(submittedSession.key).state, 'active');
  const retrying = e.retryPendingSaves(); await pendingTick(); acknowledge(calls[1]); await retrying;
  assert.equal(await e.editFile(desc.filepath), true);
  assert.equal(e.editorBlocks[0].translation, 'Submitted first draft'); assert.equal(e._draftSession.record, null);
  assert.equal(records.get(nextSession.key).state, 'active');
  assert.equal(records.get(nextSession.key).translations[0], 'Typing while a reopen is waiting');
});

test('opening another file supersedes a pending-file revisit without later stealing its editor', async () => {
  const h = await pendingDraftFixture(), { editor: e, desc, calls, acknowledge } = h;
  await assertSaveReleased(h, () => e.editorSave());
  const reopening = e.editFile(desc.filepath);
  await pendingTick();
  assert.equal(await e.editFile('source/002.txt'), true);
  const nextSession = e._draftSession, blocks = e.editorBlocks;
  e.editorBlocks[0].translation = 'Keep the newer file selection';
  acknowledge(calls[0]); assert.equal(await reopening, false);
  assert.equal(e.editorCurrentEditingDesc.filepath, 'source/002.txt'); assert.equal(e._draftSession, nextSession);
  assert.equal(e.editorBlocks, blocks); assert.equal(e.editorBlocks[0].translation, 'Keep the newer file selection');
  assert.equal(e.editorVisible, true);
});

test('a former deferred rejection lets an untouched inline row finish and its preserved draft open for recovery', async () => {
  const h = await pendingDraftFixture(), { editor: e, desc, calls, records } = h;
  const submittedSession = e._draftSession;
  await assertSaveReleased(h, () => e.editorSave());
  assert.equal(await e.activateInlineRow('source/002.txt'), true);
  assert.equal(e.inlineActive, true); assert.equal(e.editorHaveChanges(), false);
  calls[0].reject(Object.assign(new Error('Former file base changed'), { code: 'DRAFT_BASE_CHANGED' }));
  await pendingTick(); await pendingTick();
  assert.equal(e.inlineDraftError, ''); assert.ok(e.deferredDraftSaveError.includes(desc.filepath));
  assert.equal(await e.finishInlineSession(), true);
  assert.equal(e.inlineActive, false); assert.equal(records.get(submittedSession.key).state, 'active');
  assert.equal(await e.activateInlineRow('source/003.txt'), true);
  let opened = false; e.$refs.draftRecoveryDialog = { showModal() { opened = true; } };
  await e.openDraftRecovery();
  assert.equal(e.inlineActive, false); assert.equal(e.draftRecoveryVisible, true); assert.equal(opened, true);
  assert.ok(e.draftRecords.some(record => record.key === submittedSession.key && record.state === 'active'));
  assert.ok(e.deferredDraftSaveError.includes(desc.filepath), 'Review remains actionable while recovery opens.');
  assert.equal(calls.length, 1, 'Untouched inline rows must not create additional saved translations.');
});

test('a pending-file reopen does not cross a scope change or a cancelled navigation', async t => {
  for (const cancelled of [false, true]) await t.test(cancelled ? 'cancelled navigation' : 'source changed', async () => {
    const h = await pendingDraftFixture(), { editor: e, desc, calls, acknowledge } = h;
    await assertSaveReleased(h, () => e.editorSave());
    const opening = e.editFile(desc.filepath);
    await pendingTick();
    if (cancelled) e._editorOpenCancelRevision = (e._editorOpenCancelRevision || 0) + 1;
    else e.sourceIdentity = 'replacement-source';
    acknowledge(calls[0]); assert.equal(await opening, false);
    assert.equal(e.editorVisible, false);
  });
});

test('late deferred acknowledgments and rejected drafts cannot mutate another workspace scope', async t => {
  for (const [scope, change] of [
    ['account', e => { e.cloudUser = { id: 'another-account', language: 'Thai' }; }],
    ['game', e => { e.gameVersion = 'poe2'; }],
    ['branch', e => { e.branchId = 'another-branch'; }],
    ['language', e => { e.lang = 'German'; }],
    ['source', e => { e.sourceIdentity = 'another-source'; }],
  ]) for (const rejected of [false, true]) await t.test(`${scope}: ${rejected ? 'rejected' : 'committed'}`, async () => {
    const h = await pendingDraftFixture(), { editor: e, calls, acknowledge, window } = h;
    await assertSaveReleased(h, () => e.editorSave());
    change(e);
    const replacement = description(99, ['Current scope text', 'Second']);
    replacement.hasChanges = false; replacement.translations.German = ['German text', 'German second'];
    e.descs = [replacement]; e._workspaceSourceBaseline = JSON.parse(JSON.stringify(e.descs));
    e.localDescs = { descs: [], status: {}, sourceHash: e.sourceIdentity };
    window.WorkspaceState.initializeWorkspace(e.localDescs, {
      source: e._workspaceSourceBaseline, sourceHash: e.sourceIdentity, game: e.gameVersion, language: e.lang,
    });
    e.editorCurrentEditingDesc = replacement; e.editorVisible = true;
    const blocks = e.editorBlocks = [{ english: 'Original', translation: 'New scope typing' }, { english: 'Second', translation: 'Second' }];
    const session = e._draftSession = { scope: e.editorDraftScope(replacement.filepath), record: null };
    const candidate = e.editorDroppedCandidate = { id: 'new-scope-candidate' };
    e.inlineDraftRows = { [replacement.filepath]: { translations: ['New scope local draft'] } };
    e.inlineDraftFindings = { [replacement.filepath]: [{ level: 'warning', message: 'Current scope warning' }] };
    e.inlineDraftError = 'Current scope draft notice';
    const workspaceBefore = JSON.stringify(e.localDescs), rowsBefore = JSON.stringify(e.inlineDraftRows);
    const findingsBefore = JSON.stringify(e.inlineDraftFindings), descBefore = JSON.stringify(replacement);
    if (rejected) {
      calls[0].reject(Object.assign(new Error('Old scope draft changed'), { code: 'DRAFT_BASE_CHANGED' }));
      await pendingTick(); await pendingTick();
      assert.equal(e._pendingSaves.snapshot().jobs.length, 0);
    } else { acknowledge(calls[0]); await e._pendingSaves.drain(); }
    assert.equal(JSON.stringify(e.localDescs), workspaceBefore); assert.equal(JSON.stringify(replacement), descBefore);
    assert.equal(JSON.stringify(e.inlineDraftRows), rowsBefore); assert.equal(JSON.stringify(e.inlineDraftFindings), findingsBefore);
    assert.equal(e.inlineDraftError, 'Current scope draft notice');
    assert.equal(e.editorBlocks, blocks); assert.equal(e._draftSession, session); assert.equal(e.editorDroppedCandidate, candidate);
    assert.equal(e.editorVisible, true); assert.equal(e.editorBlocks[0].translation, 'New scope typing');
  });
});

test('scope change during deferred draft readback leaves the replacement draft and findings intact', async () => {
  const h = await pendingDraftFixture(), { editor: e, calls, acknowledge, window, records } = h;
  const submittedSession = e._draftSession;
  await assertSaveReleased(h, () => e.editorSave());
  const originalRead = window.OfflineStore.getTranslationDraft;
  let releaseRead, readStarted;
  const started = new Promise(resolve => { readStarted = resolve; });
  const gate = new Promise(resolve => { releaseRead = resolve; });
  window.OfflineStore.getTranslationDraft = async key => {
    if (key === submittedSession.key) { readStarted(); await gate; }
    return originalRead(key);
  };
  acknowledge(calls[0]); await started;
  e.lang = 'German';
  const next = description(2); next.translations.German = ['German committed text', 'Second'];
  e.editorCurrentEditingDesc = next; e.editorVisible = true;
  const blocks = e.editorBlocks = [{ english: 'Original', translation: 'German typing' }];
  const session = e._draftSession = { scope: e.editorDraftScope(next.filepath), record: null };
  e.inlineDraftRows = { [next.filepath]: { translations: ['German draft'] } };
  e.inlineDraftFindings = { [next.filepath]: [{ level: 'warning', message: 'German warning' }] };
  const rowsBefore = JSON.stringify(e.inlineDraftRows), findingsBefore = JSON.stringify(e.inlineDraftFindings);
  releaseRead(); await e._pendingSaves.drain();
  assert.equal(records.get(submittedSession.key).state, 'promoted');
  assert.equal(e.editorBlocks, blocks); assert.equal(e._draftSession, session); assert.equal(e.editorCurrentEditingDesc, next);
  assert.equal(e.editorBlocks[0].translation, 'German typing'); assert.equal(e.editorVisible, true);
  assert.equal(JSON.stringify(e.inlineDraftRows), rowsBefore); assert.equal(JSON.stringify(e.inlineDraftFindings), findingsBefore);
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
    assert.equal(desc.translations.Thai[0], 'เดิม'); assert.equal(calls.length, 0);
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
  assert.equal(desc.translations.Thai[0], 'เดิม'); assert.equal(warnsBeforeUnload(), true);
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

test('beforeunload stays silent for durable shared-runtime drafts and protects only new or failed writes', () => {
  const { editor: e, warnsBeforeUnload } = enablePending(saveFixture());
  e.initializePendingSaves();
  e.flushEditorDraft = async () => true;
  e.serializeEditorTranslations = () => e.editorBlocks.map(block => block.translation);
  e._draftSession = { record: { translations: e.serializeEditorTranslations() } };
  assert.equal(e.editorHaveChanges(), true, 'The local draft still differs from committed text.');
  e.updateLeaveProtection(); assert.equal(warnsBeforeUnload(), false);
  e.editorBlocks[0].translation = 'New typing before the debounce watcher';
  assert.equal(warnsBeforeUnload(), true);
  e._draftSession.record.translations = e.serializeEditorTranslations();
  e._draftTimer = 123; assert.equal(warnsBeforeUnload(), true);
  e._draftTimer = null; e.draftWritePending = 1; assert.equal(warnsBeforeUnload(), true);
  e.draftWritePending = 0; e._draftSession.pendingRecord = { translations: e.serializeEditorTranslations() };
  assert.equal(warnsBeforeUnload(), true);
  e._draftSession.pendingRecord = null; e._draftSession.writeError = new Error('Storage full');
  assert.equal(warnsBeforeUnload(), true);
  e._draftSession.writeError = null; assert.equal(warnsBeforeUnload(), false);
  e.editorBlocks[0].translation = 'Durably preserved conflict alternative';
  e._draftSession.record.conflicts = [{ translations: e.serializeEditorTranslations() }];
  assert.equal(warnsBeforeUnload(), false, 'A stored conflict alternative is recoverable without keeping this tab open.');
  e._retainedDraftSessions = new Map([['previous', { pendingRecord: { translations: ['Retained after a scope switch'] } }]]);
  e._draftSession = null; e.editorVisible = false; e.updateLeaveProtection();
  assert.equal(warnsBeforeUnload(), true);
  e._retainedDraftSessions.clear(); e.updateLeaveProtection(); assert.equal(warnsBeforeUnload(), false);
});

test('older acknowledgements preserve newer same-file typing without allowing duplicate pending submissions', async () => {
  const { editor: e, window, desc, calls, acknowledge } = enablePending(saveFixture());
  const { Client } = require('../public/collaborationSync.js');
  const identity = { accountId: 'translator', game: 'poe1', language: 'Thai', sourceHash: e.sourceIdentity };
  const client = new Client({ WebSocket: null, locks: null, store: {}, request: async () => ({}) });
  client.key = window.CollaborationProtocol.scopeKey(identity);
  const initial = { ...e.collaborationFile(desc), revision: 1 };
  client.state = { version: 1, rooms: { [client.key]: { identity, roomId: 'room', manifest: window.CollaborationProtocol.manifest(e.descs),
    local: { [desc.filepath]: initial }, shared: { [desc.filepath]: initial }, outbox: [], conflicts: [], recovery: [] } } };
  let retries = 0; client.retry = async () => { retries++; return {}; };
  e.cloudUser = { id: 'translator', language: 'Thai' }; e.cloudSignedIn = true;
  e._collaboration = client; e._editorCollabBase = client.fileBase(desc.filepath);
  assert.equal(await e.editorSave(), true);
  e.editorVisible = true; e.editorBlocks[0].translation = 'ใหม่กว่า';
  assert.equal(await e.editorSave(), false); assert.equal(e.pendingLocalSaves, 1);
  e.applyCollaborationFiles([{ ...initial, translations: ['ตอบกลับเก่า', 'สอง'] }]);
  assert.equal(e.editorBlocks[0].translation, 'ใหม่กว่า');
  await pendingTick(); acknowledge(calls[0]); await e._pendingSaves.drain();
  assert.equal(desc.translations.Thai[0], 'ใหม่'); assert.equal(client.fileBase(desc.filepath).translations[0], 'ใหม่');
  assert.equal(e.editorBlocks[0].translation, 'ใหม่กว่า');
  e._editorCollabBase = client.fileBase(desc.filepath);
  assert.equal(await e.editorSave(), true);
  await pendingTick(); assert.equal(calls.length, 2);
  assert.equal(calls[1].batch.collaboration.bases[desc.filepath].translations[0], 'ใหม่');
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
  const queued = await e.persistTranslationBatch([{ desc, lines: ['ใหม่', 'สอง'] }], 'save', { deferCommit: true });
  assert.equal(queued.status, 'queued'); releaseHash('new-source-hash'); await pendingTick();
  assert.equal(calls.length, 1); assert.equal(imports, 0, 'Source replacement must wait for saves queued during its hash await.');
  acknowledge(calls[0]); await importing;
  assert.equal(imports, 1); assert.equal(e.pendingLocalSaves, 0); assert.equal(e.sourceIdentity, 'new-source-hash');
});

test('valid Save journals its captured text before releasing navigation and never forces a checkpoint', async () => {
  const h = await pendingDraftFixture(), { editor: e, window, records, draftWrites, calls, acknowledge } = h;
  const session = e._draftSession;
  records.clear(); draftWrites.length = 0; session.record = null; session.expectedRevision = null;
  let releaseJournal;
  const put = window.OfflineStore.putSaveSubmission;
  window.OfflineStore.putSaveSubmission = batch => new Promise(resolve => { releaseJournal = () => put(batch).then(resolve); });
  let finished = false;
  const saving = e.editorSave().then(result => { finished = true; return result; });
  await pendingTick();
  assert.equal(finished, false); assert.equal(e.editorVisible, true); assert.equal(calls.length, 0);
  assert.equal(draftWrites.length, 0);
  await releaseJournal(); assert.equal(await saving, true);
  assert.equal(e.editorVisible, false); assert.equal(h.journals.length, 1);
  const batch = h.journals[0].batch;
  assert.equal(batch.draft, undefined); assert.equal(batch.checkpoint.key, session.key);
  assert.equal(batch.checkpoint.revision, null); assert.equal(batch.checkpoint.id, session.id);
  assert.equal(batch.bases[h.desc.filepath].translations[0], 'เดิม');
  assert.equal(batch.files[0].translations[0], 'Submitted first draft');
  assert.equal(batch.deferDisplay, true); assert.equal(batch.context, undefined);
  assert.equal(draftWrites.length, 0); assert.equal(h.desc.translations.Thai[0], 'เดิม');
  await pendingTick(); acknowledge(calls[0]); await e._pendingSaves.drain();
  assert.equal(h.desc.translations.Thai[0], 'Submitted first draft');
});

test('a journal failure keeps the editor open and retains typed text as a recovery checkpoint', async () => {
  const h = await pendingDraftFixture(), { editor: e, window, records, calls } = h;
  records.clear(); e._draftSession.record = null; e._draftSession.expectedRevision = null;
  window.OfflineStore.putSaveSubmission = async () => { throw new Error('Submission quota exceeded'); };
  assert.equal(await e.editorSave(), false); assert.equal(e.editorVisible, true);
  assert.equal(e.pendingLocalSaves, 0); assert.equal(calls.length, 0);
  assert.equal(records.get(e._draftSession.key).translations[0], 'Submitted first draft');
  assert.match(e.cloudStorageError, /Submission quota exceeded/);
  assert.equal(h.desc.translations.Thai[0], 'เดิม');
});

test('typing during the submission journal acknowledgment stays open and survives the older commit', async () => {
  const h = await pendingDraftFixture(), { editor: e, window, records, calls, acknowledge } = h;
  const session = e._draftSession;
  records.clear(); session.record = null; session.expectedRevision = null;
  const put = window.OfflineStore.putSaveSubmission;
  let release;
  window.OfflineStore.putSaveSubmission = batch => new Promise(resolve => { release = () => put(batch).then(resolve); });
  const saving = e.editorSave(); await pendingTick();
  e.editorBlocks[0].translation = 'New typing during journal'; await release();
  assert.equal(await saving, false); assert.equal(e.editorVisible, true);
  assert.equal(records.get(session.key).translations[0], 'New typing during journal');
  assert.equal(records.get(session.key).id, h.journals[0].batch.checkpoint.id);
  await pendingTick(); acknowledge(calls[0]); await e._pendingSaves.drain();
  assert.equal(e.editorBlocks[0].translation, 'New typing during journal');
  assert.equal(h.desc.translations.Thai[0], 'Submitted first draft');
  assert.equal(records.get(session.key).base.translations[0], 'Submitted first draft');
});

test('reload recovers durable submitted commands in original order with the original IDs and a fresh runtime context', async () => {
  const original = enablePending(saveFixture()), first = original.editor;
  await first.editorSave(); first._pendingSaves.dispose();
  const record = structuredClone(original.journals[0]);
  const h = enablePending(saveFixture()), { editor: e, window, calls, acknowledge } = h;
  e.editorVisible = false; e.offlineStoreReady = true;
  window.OfflineStore.listSaveSubmissions = async () => [structuredClone(record)];
  await e.recoverPendingSaves(); await e.recoverPendingSaves();
  assert.equal(e.pendingLocalSaves, 1); assert.equal(h.journals.length, 0);
  const job = e._pendingSaves.snapshot().jobs[0];
  assert.equal(job.id, record.batch.jobId); assert.equal(job.recovered, true);
  assert.equal(job.context.client, undefined); assert.equal(e.collaborationContextCurrent(job.context), true);
  await pendingTick(); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].batch, record.batch);
  acknowledge(calls[0]); await e._pendingSaves.drain();
  assert.equal(h.desc.translations.Thai[0], 'ใหม่'); assert.equal(e.pendingLocalSaves, 0);
});

test('a scoped submission listing cannot enqueue work after its account, version or language changes', async t => {
  for (const change of [e => { e.cloudUser = { id: 'other-account' }; }, e => { e.sourceIdentity = 'other-version'; }, e => { e.lang = 'German'; }]) {
    await t.test(String(change), async () => {
      const h = enablePending(saveFixture()), { editor: e, window } = h;
      e.offlineStoreReady = true;
      let finish;
      window.OfflineStore.listSaveSubmissions = () => new Promise(resolve => { finish = resolve; });
      const recovering = e.recoverPendingSaves(); await Promise.resolve();
      change(e);
      finish([{ state: 'pending', batch: { jobId: 'old-command', ...{ accountId: '', game: 'poe1', language: 'Thai', sourceHash: 'source-one' },
        files: [{ filepath: h.desc.filepath, translations: ['Old submitted text'] }] } }]);
      await recovering;
      assert.equal(e.pendingLocalSaves, 0); assert.equal(e._pendingSaves.snapshot().jobs.length, 0);
      assert.equal(e._recoveredSaveScope, undefined); e._pendingSaves.dispose();
    });
  }
});

test('a review submission stays actionable after reload and is not automatically resubmitted', async () => {
  const h = enablePending(saveFixture()), { editor: e, window, calls } = h;
  e.offlineStoreReady = true; e.inlineDraftFindings = {};
  window.OfflineStore.listSaveSubmissions = async () => [{ state: 'review', error: { code: 'DRAFT_BASE_CHANGED', message: 'Review a changed base.' },
    batch: { jobId: 'review-command', game: e.gameVersion, language: e.lang, sourceHash: e.sourceIdentity, accountId: '',
      files: [{ filepath: h.desc.filepath, translations: ['Preserved submitted text'] }] } }];
  await e.recoverPendingSaves(); await pendingTick();
  assert.equal(calls.length, 0); assert.equal(e.pendingLocalSaves, 0);
  assert.match(e.inlineDraftFindings[h.desc.filepath][0].message, /Review a changed base/);
  assert.equal(e.inlineDraftFindings[h.desc.filepath][0].deferredSave, true);
  e._pendingSaves.dispose();
});

test('post-commit synchronization rechecks the captured scope and current language access', async t => {
  const changes = {
    account: e => { e.cloudUser = { ...e.cloudUser, id: 'other-account' }; },
    version: e => { e.sourceIdentity = 'other-source'; },
    language: e => { e.lang = 'German'; },
    branch: e => { e.branchId = 'other-branch'; },
    assignment: e => { e.cloudUser.assignmentVersion++; },
    role: e => { e.cloudUser.role = 'manager'; },
    assignedLanguage: e => { e.cloudUser.language = 'German'; },
    signedOut: e => { e.cloudSignedIn = false; },
    access: e => { e.cloudCanAccessAllLanguages = false; e.cloudUser.language = 'German'; },
    commitCallback: e => { e.lang = 'German'; },
    unchanged: () => {},
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    const h = enablePending(saveFixture()), { editor: e, desc, window, calls, acknowledge } = h;
    e.cloudUser = { id: 'translator', language: 'Thai', role: 'translator', assignmentVersion: 1 };
    e.cloudSignedIn = true; e.cloudCanAccessAllLanguages = name === 'access';
    const identity = { accountId: e.cloudUser.id, game: e.gameVersion, language: e.lang, sourceHash: e.sourceIdentity };
    let retries = 0;
    e._collaboration = { key: window.CollaborationProtocol.scopeKey(identity), room: () => ({ identity }),
      fileBase: () => e.collaborationFile(desc), withLocalWrite: write => write(), acceptLocalSave() {},
      async retry() { retries++; } };
    await e.persistTranslationBatch([{ desc, lines: ['Captured submitted text', 'Second'] }], 'save', { deferCommit: true });
    await pendingTick();
    if (name === 'commitCallback') e._pendingSaves.snapshot().jobs[0].onCommitted = () => change(e);
    else change(e);
    acknowledge(calls[0]); await e._pendingSaves.drain();
    assert.equal(retries, name === 'unchanged' ? 1 : 0);
    e._pendingSaves.dispose();
  });
});

test('a changed save scope requires a fresh decision and preserves the direct submission for review', async () => {
  const h = enablePending(saveFixture()), { editor: e, calls, submissions, desc } = h;
  assert.equal(await e.editorSave(), true);
  const drained = e._pendingSaves.drain(); await pendingTick();
  const batch = calls[0].batch;
  calls[0].reject(Object.assign(new Error('The captured workspace changed.'), { code: 'SAVE_SCOPE_CHANGED' }));
  await assert.rejects(drained, error => error.code === 'SAVE_SCOPE_CHANGED'); await pendingTick();
  assert.equal(e.pendingLocalSaves, 0); assert.equal(submissions.get(batch.jobId).state, 'review');
  assert.equal(submissions.get(batch.jobId).batch.files[0].translations[0], 'ใหม่');
  assert.equal(desc.translations.Thai[0], 'เดิม');
  assert.match(e.inlineDraftFindings[desc.filepath][0].message, /Local drafts/);
  await e.retryPendingSaves(); assert.equal(calls.length, 1);
  e._pendingSaves.dispose();
});

test('a changed Dropped promotion preserves captured text for fresh review and releases unrelated queued saves', async () => {
  const h = await pendingDraftFixture(), { editor: e, window, desc, calls, records, submissions, acknowledge } = h;
  const firstSession = e._draftSession, committed = [...desc.translations.Thai];
  const dropped = window.WorkspaceState.dropTranslation(e.localDescs, desc, e.lang, {
    translations: ['Preserved older Dropped text', 'Preserved second'], originSourceHash: 'older-source', targetSourceHash: e.sourceIdentity,
  });
  await assertSaveReleased(h, () => e.saveAndSkipFile());
  const submitted = h.journals[0].batch;
  assert.equal(submitted.promoteDropped.id, dropped.id);
  const second = e.editorCurrentEditingDesc;
  e.editorBlocks[0].translation = 'Independent queued translation';
  await assertSaveReleased(h, () => e.editorSave());
  dropped.revision++;
  e.localDescs.droppedArchive[dropped.id] = JSON.parse(JSON.stringify(dropped));
  const latestDropped = JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, e.lang));
  let rejection;
  assert.throws(() => window.WorkspaceState.stageTranslation(JSON.parse(JSON.stringify(e.localDescs)), submitted.files[0], e.lang,
    { source: e.workspaceSourceFile(desc.filepath), sourceHash: e.sourceIdentity, promoteDropped: submitted.promoteDropped }), error => {
    rejection = error; return error.code === 'DROPPED_PROMOTION_CHANGED';
  });
  calls[0].reject(Object.assign(new Error(rejection.message), { code: rejection.code })); await pendingTick(); await pendingTick();
  assert.equal(calls.length, 2); assert.equal(e.pendingLocalSaves, 1);
  assert.equal(submissions.get(submitted.jobId).state, 'review');
  assert.equal(submissions.get(submitted.jobId).batch.files[0].translations[0], 'Submitted first draft');
  assert.equal(records.get(firstSession.key).state, 'active');
  assert.equal(records.get(firstSession.key).translations[0], 'Submitted first draft');
  assert.deepEqual(Array.from(desc.translations.Thai), committed);
  assert.equal(JSON.stringify(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, e.lang)), latestDropped);
  assert.match(e.inlineDraftFindings[desc.filepath][0].message, /full editor.*current Dropped/);
  acknowledge(calls[1]); await e._pendingSaves.drain();
  assert.equal(second.translations.Thai[0], 'Independent queued translation'); assert.equal(e.pendingLocalSaves, 0);
  assert.match(e.inlineDraftFindings[desc.filepath][0].message, /current Dropped/);
  e.showSaveSubmissionReview(submissions.get(submitted.jobId));
  assert.match(e.inlineDraftFindings[desc.filepath][0].message, /full editor.*current Dropped/);
  e._pendingSaves.dispose();
});

test('a recovered rejected deletion stays actionable without resubmitting or loading a translation draft', async () => {
  const h = enablePending(saveFixture()), { editor: e, window, calls } = h;
  e.offlineStoreReady = true; let draftReads = 0; e.loadEditorDrafts = async () => { draftReads++; };
  window.OfflineStore.listSaveSubmissions = async () => [{ state: 'review',
    error: { code: 'DELETE_STAGED_BASE_CHANGED', message: 'The saved translation changed.' },
    batch: { jobId: 'delete-review', resetStaging: true, game: e.gameVersion, language: e.lang,
      sourceHash: e.sourceIdentity, accountId: '', files: [{ filepath: h.desc.filepath, translations: ['ZIP original'] }] } }];
  await e.recoverPendingSaves(); await pendingTick();
  assert.equal(calls.length, 0); assert.equal(draftReads, 0); assert.equal(e.pendingLocalSaves, 0);
  assert.match(e.inlineDraftFindings[h.desc.filepath][0].message, /confirm deletion again/);
  assert.doesNotMatch(e.inlineDraftFindings[h.desc.filepath][0].message, /Local drafts/);
  e._pendingSaves.dispose();
});

test('a fresh acknowledged deletion clears only its earlier submitted-delete review warning', async () => {
  const h = pendingStagedDeletionFixture(), { editor: e, desc, base, calls, acknowledge } = h;
  e.showSaveSubmissionReview({ batch: { resetStaging: true, files: [{ filepath: desc.filepath }] },
    error: { message: 'The earlier saved translation changed.' } });
  e.inlineDraftFindings[desc.filepath].push({ level: 'warning', message: 'Separate recoverable draft warning', deferredSave: true });
  const deleting = e.persistStagedDeletion(desc, base); await pendingTick();
  assert.equal(e.inlineDraftFindings[desc.filepath].length, 2, 'Starting the new decision keeps the old warning visible.');
  acknowledge(calls[0]); assert.equal((await deleting).durable, true);
  assert.equal(e.inlineDraftFindings[desc.filepath].length, 1);
  assert.equal(e.inlineDraftFindings[desc.filepath][0].message, 'Separate recoverable draft warning');
  e._pendingSaves.dispose();
});

test('record-backed confirmation, restore and consistency saves preserve other tabs files and languages', async t => {
  for (const origin of ['confirm', 'restore', 'consistency']) await t.test(origin, async () => {
    const h = saveFixture(), { editor: e, window, desc } = h;
    const other = description(2, ['Other original', 'Other second']);
    e.descs.push(other);
    const source = JSON.parse(JSON.stringify(e.descs));
    source.forEach(file => { file.hasChanges = false; file.translations.German = ['German original', 'German second']; });
    e._workspaceSourceBaseline = source;
    e.localDescs = { sourceHash: e.sourceIdentity, descs: [], status: {} };
    window.WorkspaceState.initializeWorkspace(e.localDescs, { source, sourceHash: e.sourceIdentity, game: e.gameVersion, language: e.lang });
    window.WorkspaceState.stageTranslation(e.localDescs, { filepath: desc.filepath, translations: ['Previous saved text', 'Second'] }, e.lang,
      { source: source[0], sourceHash: e.sourceIdentity });
    window.WorkspaceState.stageTranslation(e.localDescs, { filepath: other.filepath, translations: ['Other old local view', 'Other second'] }, e.lang,
      { source: source[1], sourceHash: e.sourceIdentity });
    e.applyWorkspaceOverlay();
    const authoredWorkspace = JSON.parse(JSON.stringify(e.localDescs));
    let durable = JSON.parse(JSON.stringify(e.localDescs));
    window.WorkspaceState.stageTranslation(durable, { filepath: other.filepath, translations: ['Saved by another tab during authoring', 'Other second'] }, e.lang,
      { source: source[1], sourceHash: e.sourceIdentity });
    window.WorkspaceState.stageTranslation(durable, { filepath: desc.filepath, translations: ['Latest German saved by another tab', 'German second'] }, 'German',
      { source: source[0], sourceHash: e.sourceIdentity });
    durable.status[desc.filepath] = window.WorkspaceState.setFileMetadata({}, 'German', { lastEditedAt: 987654 });
    const normalized = require('../public/normalizedStore.js').create({ W: window.WorkspaceState, normalizeScope: value => value });
    const revisions = [{ filepath: desc.filepath, lang: e.lang, translations: ['Reviewed target text', 'Second'], note: origin }];
    const transactions = [];
    window.OfflineStore.getWorkspaceRecords = () => assert.fail('The atomic update must read selected records itself.');
    window.OfflineStore.mergeWorkspaceRecords = normalized.mergeWorkspaceRecords;
    window.OfflineStore.saveWorkspaceWithRevisions = () => assert.fail('A one-file factual update must not persist an aggregate workspace.');
    window.OfflineStore.updateWorkspace = async (update, game, options) => {
      transactions.push({ game, options });
      assert.deepEqual(Array.from(options.filepaths), [desc.filepath]);
      assert.deepEqual(JSON.parse(JSON.stringify(options.scope)), { accountId: 'guest', game: 'poe1', branchId: 'default', sourceHash: e.sourceIdentity });
      const selected = new Set(options.filepaths), view = JSON.parse(JSON.stringify(durable));
      view._storageSelection = { filepaths: options.filepaths };
      view.descs = view.descs.filter(file => selected.has(file.filepath));
      view.status = Object.fromEntries(Object.entries(view.status).filter(([path]) => selected.has(path)));
      for (const field of ['staged', 'dropped', 'droppedConflicts', 'droppedAssignments'])
        view[field] = Object.fromEntries(Object.entries(view[field] || {}).map(([lang, files]) => [lang,
          Object.fromEntries(Object.entries(files).filter(([path, file]) => selected.has(file?.filepath || path)))]));
      for (const field of ['droppedArchive', 'droppedAliases', 'placeholderRepairArchive']) view[field] = {};
      view.droppedOutbox = [];
      const committed = update(view);
      assert.equal(typeof committed?.then, 'undefined', 'The transaction mutation remains synchronous.');
      durable = normalized.mergeWorkspaceRecords(durable, committed);
      return committed;
    };
    const result = await e.persistTranslationBatch([{ desc, lines: ['Reviewed target text', 'Second'] }], origin,
      { revisions, ...(origin === 'consistency' ? { workspace: authoredWorkspace } : {}) });
    assert.equal(result.status, 'local'); assert.equal(transactions.length, 1);
    assert.equal(transactions[0].options.revisions, revisions);
    assert.equal(durable.staged.Thai[desc.filepath].translations[0], 'Reviewed target text');
    assert.equal(durable.staged.Thai[other.filepath].translations[0], 'Saved by another tab during authoring');
    assert.equal(durable.staged.German[desc.filepath].translations[0], 'Latest German saved by another tab');
    assert.equal(durable.status[desc.filepath].languageStatus.German.lastEditedAt, 987654);
    assert.equal(e.localDescs.staged.German[desc.filepath].translations[0], 'Latest German saved by another tab');
    assert.equal(e.localDescs.staged.Thai[other.filepath].translations[0], 'Other old local view');
    assert.equal(desc.translations.Thai[0], 'Reviewed target text');
  });
});

test('shared restore loads only its selected durable records and preserves newer unrelated UI work', async () => {
  const h = saveFixture(), { editor: e, window, desc } = h, other = description(2);
  e.descs.push(other); e._workspaceSourceBaseline = JSON.parse(JSON.stringify(e.descs));
  e.localDescs = { sourceHash: e.sourceIdentity, descs: [], status: {} };
  window.WorkspaceState.initializeWorkspace(e.localDescs, { source: e._workspaceSourceBaseline, sourceHash: e.sourceIdentity, game: e.gameVersion, language: e.lang });
  e.cloudUser = { id: 'translator', language: 'Thai' }; e.cloudSignedIn = true;
  const identity = { accountId: 'translator', game: e.gameVersion, language: e.lang, sourceHash: e.sourceIdentity };
  const accepted = { filepath: desc.filepath, translations: ['Accepted reviewed restoration', 'Second'], trackedForExport: true, needsReview: false };
  const records = require('../public/normalizedStore.js').create({ W: window.WorkspaceState, normalizeScope: value => value });
  window.OfflineStore.mergeWorkspaceRecords = records.mergeWorkspaceRecords;
  window.OfflineStore.getWorkspace = () => assert.fail('A one-file shared restore must not read an aggregate workspace.');
  let reads = 0;
  window.OfflineStore.getWorkspaceRecords = async (scope, options) => {
    reads++; assert.equal(scope.accountId, 'translator'); assert.equal(scope.sourceHash, e.sourceIdentity);
    assert.deepEqual(Array.from(options.filepaths), [desc.filepath]);
    return { sourceHash: e.sourceIdentity, stagedVersion: 1, statusMetadataVersion: 1, descs: [], status: {},
      staged: { Thai: { [desc.filepath]: { sourceHash: e.sourceIdentity, translations: accepted.translations } } },
      _storageSelection: { filepaths: [desc.filepath] } };
  };
  e._collaboration = { key: window.CollaborationProtocol.scopeKey(identity), room: () => ({ identity }),
    snapshot: () => ({ files: [accepted] }),
    async save(command) {
      assert.equal(command.origin, 'restore'); assert.equal(command.files.length, 1);
      e.applyCollaborationFiles([{ filepath: other.filepath, translations: ['New unrelated shared work', 'Second'], trackedForExport: true }], e.lang);
      return { status: 'local' };
    } };
  const result = await e.persistTranslationBatch([{ desc, lines: accepted.translations }], 'restore');
  assert.equal(result.status, 'local'); assert.equal(reads, 1);
  assert.equal(e.localDescs.staged.Thai[other.filepath].translations[0], 'New unrelated shared work');
  assert.equal(other.translations.Thai[0], 'New unrelated shared work');
  assert.equal(desc.translations.Thai[0], 'Accepted reviewed restoration');
});

test('record-backed Confirm and Restore reject a same-file change against the base captured before awaiting', async t => {
  for (const origin of ['confirm', 'restore']) await t.test(origin, async () => {
    const h = saveFixture(), { editor: e, window, desc } = h;
    const source = JSON.parse(JSON.stringify(desc)); source.hasChanges = false;
    e._workspaceSourceBaseline = [source];
    e.localDescs = { sourceHash: e.sourceIdentity, descs: [], status: {} };
    window.WorkspaceState.initializeWorkspace(e.localDescs, { source: [source], sourceHash: e.sourceIdentity, game: e.gameVersion, language: e.lang });
    window.WorkspaceState.stageTranslation(e.localDescs, { filepath: desc.filepath, translations: ['Captured original committed text', 'Second'] }, e.lang,
      { source, sourceHash: e.sourceIdentity });
    e.applyWorkspaceOverlay();
    const durable = JSON.parse(JSON.stringify(e.localDescs));
    window.WorkspaceState.stageTranslation(durable, { filepath: desc.filepath, translations: ['New same-file work from another tab', 'Second'] }, e.lang,
      { source, sourceHash: e.sourceIdentity });
    const before = JSON.stringify(durable);
    e._pendingSaves = { overlay: () => null, snapshot: () => ({ jobs: [] }) };
    e.waitForPendingSaves = async () => {
      e.applyCollaborationFiles([{ filepath: desc.filepath, translations: ['New same-file work from another tab', 'Second'], trackedForExport: true }], e.lang);
      return true;
    };
    window.OfflineStore.getWorkspaceRecords = () => assert.fail('The selected transaction supplies its own current records.');
    window.OfflineStore.saveWorkspaceWithRevisions = () => assert.fail('No aggregate fallback is permitted.');
    let writes = 0;
    window.OfflineStore.updateWorkspace = async update => {
      const current = JSON.parse(JSON.stringify(durable)), snapshot = JSON.stringify(current);
      try { const result = update(current); writes++; return result; }
      finally { assert.equal(JSON.stringify(current), snapshot, 'Every captured base is checked before factual mutation.'); }
    };
    await assert.rejects(e.persistTranslationBatch([{ desc, lines: ['Reviewed replacement text', 'Second'] }], origin), error => {
      assert.equal(error.code, 'DRAFT_BASE_CHANGED'); assert.equal(error.filepath, desc.filepath);
      assert.deepEqual(Array.from(error.currentTranslations), ['New same-file work from another tab', 'Second']); return true;
    });
    assert.equal(writes, 0); assert.equal(JSON.stringify(durable), before);
    assert.equal(desc.translations.Thai[0], 'New same-file work from another tab');
    assert.equal(e.editorBlocks[0].translation, 'ใหม่', 'Private typing remains available after the rejected replacement.');
  });
});

test('a local receipt replay preserves newer same-file committed text, metadata and private typing', async () => {
  const h = enablePending(saveFixture()), { editor: e, window, desc, calls, acknowledge } = h;
  e._workspaceSourceBaseline = JSON.parse(JSON.stringify(e.descs));
  assert.equal(await e.editorSave(), true); const failed = e._pendingSaves.drain(); await pendingTick();
  const original = JSON.stringify(calls[0].batch), jobId = calls[0].batch.jobId;
  calls[0].reject(Object.assign(new Error('The worker acknowledgment was lost.'), { durableUnknown: true }));
  await assert.rejects(failed, /acknowledgment was lost/);
  const current = { filepath: desc.filepath, translations: ['Newer same-file text committed by another tab', 'Second'], trackedForExport: true };
  e.applyCollaborationFiles([current]);
  const editedAt = calls[0].batch.statuses[desc.filepath].languageStatus.Thai.lastEditedAt + 500;
  e.localDescs.status[desc.filepath] = window.WorkspaceState.setFileMetadata(e.localDescs.status[desc.filepath] || {}, 'Thai',
    { lastEditedAt: editedAt, lastTranslatedAt: editedAt });
  window.WorkspaceState.setFileMetadata(e.localDescs.status[desc.filepath], 'German', { lastEditedAt: editedAt + 1000 });
  assert.equal(e.localDescs.status[desc.filepath].languageStatus.German.lastEditedAt, editedAt + 1000);
  const replayStatus = window.WorkspaceState.setFileMetadata({}, 'Thai', { lastEditedAt: editedAt, lastTranslatedAt: editedAt });
  window.WorkspaceState.setFileMetadata(replayStatus, 'German', { lastEditedAt: 1 });
  e.editorVisible = true; e.editorBlocks[0].translation = 'Private typing after the lost acknowledgment';
  const retry = e.retryPendingSaves(); await pendingTick();
  assert.equal(JSON.stringify(calls[1].batch), original); assert.equal(calls[1].batch.jobId, jobId);
  acknowledge(calls[1], { duplicate: true, files: [current], statuses: { [desc.filepath]: replayStatus } }); await retry;
  assert.equal(desc.translations.Thai[0], current.translations[0]);
  assert.equal(e.localDescs.staged.Thai[desc.filepath].translations[0], current.translations[0]);
  assert.equal(e.localDescs.status[desc.filepath].languageStatus.Thai.lastEditedAt, editedAt);
  assert.equal(e.localDescs.status[desc.filepath].languageStatus.Thai.lastTranslatedAt, editedAt);
  assert.equal(e.localDescs.status[desc.filepath].languageStatus.German.lastEditedAt, editedAt + 1000);
  assert.equal(e.editorBlocks[0].translation, 'Private typing after the lost acknowledgment');
  assert.equal(e.pendingLocalSaves, 0); e._pendingSaves.dispose();
});

test('a local receipt replay adopts a later staged deletion instead of restoring the original save', async () => {
  const h = enablePending(saveFixture()), { editor: e, window, desc, calls, acknowledge } = h;
  const baseline = JSON.parse(JSON.stringify(desc)); baseline.hasChanges = false;
  e._workspaceSourceBaseline = [baseline];
  assert.equal(await e.editorSave(), true); const failed = e._pendingSaves.drain(); await pendingTick();
  calls[0].reject(Object.assign(new Error('The worker acknowledgment was lost.'), { durableUnknown: true }));
  await assert.rejects(failed);
  e.applyCollaborationFiles(calls[0].batch.files);
  assert.ok(e.localDescs.staged.Thai[desc.filepath]);
  const retry = e.retryPendingSaves(); await pendingTick();
  acknowledge(calls[1], { duplicate: true, files: [{ filepath: desc.filepath, translations: baseline.translations.Thai,
    trackedForExport: false, stagingReset: true }], statuses: { [desc.filepath]: { lastEditedAt: 12345 } } }); await retry;
  assert.equal(e.localDescs.staged.Thai[desc.filepath], undefined); assert.equal(desc.hasChanges, false);
  assert.deepEqual(Array.from(desc.translations.Thai), baseline.translations.Thai);
  assert.equal(e.localDescs.status[desc.filepath].languageStatus.Thai.lastEditedAt, 12345);
  assert.equal(e.pendingLocalSaves, 0); e._pendingSaves.dispose();
});
