const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const settleFocus = () => new Promise(resolve => setTimeout(resolve, 10));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function description(name = 'first', translation = 'translation') {
  return { filepath: `test/${name}.txt`, filedir: 'test', filename: `${name}.txt`,
    translations: { English: ['Source'], Thai: [translation] }, hasChanges: false, isMissing: false, needsReview: false };
}

test('an ended-version warning cannot activate a file in a switched source or language', async () => {
  for (const change of [editor => { editor.sourceIdentity = 'another-version'; }, editor => { editor.lang = 'German'; }, editor => { editor.branchId = 'another-branch'; }]) {
    const { editor, desc } = harness(), gate = deferred();
    editor.managedWarnBeforeEdit = () => gate.promise;
    let activations = 0; editor.runInlineRowActivation = async () => { activations++; return true; };
    const opening = editor.activateInlineRow(desc.filepath); await tick();
    change(editor); gate.resolve(true);
    assert.equal(await opening, false); assert.equal(activations, 0);
  }
});

function harness({ records = new Map() } = {}) {
  let config, nextId = 0;
  const calls = { writes: [], discards: [], promotions: [], confirms: [], alerts: [], focused: 0 };
  const store = {
    translationDraftKey(scope) { return 'draft:' + JSON.stringify([scope.profile, scope.game, scope.sourceHash, scope.language, scope.filepath]); },
    async listTranslationDrafts(scope) { return [...records.values()].filter(r => r.profile === scope.profile && r.game === scope.game && r.language === scope.language && (r.state === 'active' || r.conflicts?.length)).map(copy); },
    async getTranslationDraft(key) { return records.has(key) ? copy(records.get(key)) : null; },
    async putTranslationDraft(record, options) {
      calls.writes.push({ record: copy(record), options: copy(options) });
      const old = records.get(record.key);
      if ((old?.revision || null) !== options.expectedRevision) throw new Error('Unexpected test draft revision');
      records.set(record.key, copy(record)); return { status: 'saved', record: copy(record) };
    },
    async discardTranslationDraft(key, expectedRevision) {
      calls.discards.push({ key, expectedRevision });
      const old = records.get(key);
      if (old?.state === 'discarded' && old.consumedRevision === expectedRevision)
        return { status: 'discarded', record: copy(old), duplicate: true };
      if (!old || old.revision !== expectedRevision) return { status: 'conflict', record: old ? copy(old) : null };
      const record = { ...old, state: 'discarded', consumedRevision: expectedRevision,
        revision: expectedRevision + ':discarded', translations: [], base: null, source: null, conflicts: [] };
      records.set(key, record); return { status: 'discarded', record: copy(record) };
    },
  };
  const window = { location: { search: '?lang=Thai' }, CloudUI: { mixin: {} }, OfflineStore: store,
    crypto: { randomUUID: () => 'test-id-' + (++nextId) }, addEventListener() {}, removeEventListener() {} };
  const document = { hidden: false, activeElement: null, querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {}, removeEventListener() {}, createElement() { return { set innerHTML(html) {
      this.value = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
    } }; } };
  const context = vm.createContext({ window, document, URLSearchParams, console, setTimeout, clearTimeout, performance,
    Vue: { defineComponent(value) { config = value; return value; }, createApp() { return { component() {}, directive() {}, mount() {} }; },
      nextTick(callback) { return Promise.resolve().then(callback); }, markRaw(value) { return value; }, toRaw(value) { return value; } } });
  for (const name of ['workspaceState.js', 'dictionaryScope.js', 'helper.js', 'regexEngine.js', 'translationDiagnostics.js',
    'terminologyDiagnostics.js', 'editorDictionaryIndex.js', 'collaborationIntegration.js', 'inlineEditor.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', name), 'utf8'), context, { filename: name });
  }
  const editor = Object.assign({}, ...config.mixins.map(mixin => mixin.data?.() || {}), config.data(),
    ...config.mixins.map(mixin => mixin.methods || {}), config.methods, {
      lang: 'Thai', gameVersion: 'poe1', sourceIdentity: 'source-a', sourceLoaded: true, startupReady: true,
      dictionary: [], highlightDict: true, sideTab: 'dictionary', cloudUser: null, cloudProfileId: 'guest',
      filterDesc() { this.filteredDescs = this.descs; }, saveSettings() {}, scheduleEditorHLterRefresh() {},
      scheduleDictionaryDiagnosticScan() {}, autosizeEditorMultilineFields() {}, refreshGamePreview() {},
      syncHlScroll() {}, yieldEditorPaint() { return Promise.resolve(); }, restoreFileTableFocusAfterEditor() {},
      getEditorRef() { return { focus() { calls.focused++; } }; },
      appAlert(message) { calls.alerts.push(message); return Promise.resolve(); },
      appConfirm(message) { calls.confirms.push(message); return Promise.resolve(false); },
      $nextTick(callback) { return Promise.resolve().then(callback); },
      $refs: { editorSide: { scrollTop: 0 }, fileTableRegion: { contains() { return true; }, getClientRects() { return [{}]; } } },
    });
  const computed = Object.assign({}, ...config.mixins.map(mixin => mixin.computed || {}), config.computed);
  for (const [name, value] of Object.entries(computed)) {
    Object.defineProperty(editor, name, typeof value === 'function' ? { configurable: true, get: () => value.call(editor) }
      : { configurable: true, get: () => value.get.call(editor), set: next => value.set.call(editor, next) });
  }
  const desc = description(); editor.descs = [desc, description('second')]; editor.filteredDescs = editor.descs;
  editor._workspaceSourceBaseline = copy(editor.descs); editor.localDescs = { sourceHash: 'source-a', descs: [], status: {} };
  window.WorkspaceState.initializeWorkspace(editor.localDescs, { source: editor._workspaceSourceBaseline,
    sourceHash: 'source-a', game: 'poe1', language: 'Thai' });
  editor.persistTranslationBatch = async (updates, origin, options) => {
    calls.promotions.push({ updates: copy(updates), origin, options });
    for (const { desc, lines } of updates) {
      window.WorkspaceState.stageTranslation(editor.localDescs, { filepath: desc.filepath, translations: [...lines] }, editor.lang,
        { source: editor.workspaceSourceFile(desc.filepath), sourceHash: editor.sourceIdentity, game: editor.gameVersion });
      desc.translations[editor.lang] = [...lines];
    }
    if (options.draft) {
      const record = records.get(options.draft.key);
      if (record?.revision === options.draft.revision) records.set(record.key, { ...record, state: 'promoted', revision: record.revision + ':promoted', translations: [] });
    }
    return { status: 'local', draftConsumed: true };
  };
  editor.rebaseEditorAfterCommit = accepted => {
    editor.editorOriginalTranslations = [...accepted.translations];
    return { typedDuringSave: false };
  };
  return { editor, config, calls, window, store, records, desc, document, context };
}

async function stagedDeletionFixture({ inline = false } = {}) {
  const h = harness(), { editor, desc, window, calls } = h;
  window.WorkspaceState.stageTranslation(editor.localDescs,
    { filepath: desc.filepath, translations: ['staged translation'] }, 'Thai',
    { source: editor.workspaceSourceFile(desc.filepath), sourceHash: editor.sourceIdentity, game: editor.gameVersion });
  editor.applyWorkspaceOverlay();
  assert.equal(await (inline ? editor.activateInlineRow(desc.filepath) : editor.editFile(desc.filepath)), true);
  calls.deletions = [];
  editor.persistStagedDeletion = async (selected, base, context) => {
    calls.deletions.push({ filepath: selected.filepath, base: copy(base), context });
    delete editor.localDescs.staged[context.language][selected.filepath];
    editor.applyWorkspaceOverlay();
    return { status: 'local', durable: true };
  };
  editor.rebaseEditorAfterCommit = window.CollaborationIntegration.mixin.methods.rebaseEditorAfterCommit;
  return h;
}

function enableDeletionWorker(h) {
  const { editor, window, context, calls, records } = h;
  calls.storage = [];
  context.crypto = require('node:crypto').webcrypto;
  window.PendingSaves = require('../public/pendingSaves.js');
  window.SaveWorkerClient = { create: () => ({
    save: batch => new Promise((resolve, reject) => calls.storage.push({ batch, resolve, reject })),
  }) };
  editor.persistStagedDeletion = window.CollaborationIntegration.mixin.methods.persistStagedDeletion;
  editor.persistTranslationBatch = window.CollaborationIntegration.mixin.methods.persistTranslationBatch;
  h.acknowledge = call => {
    if (call.batch.draft) {
      const record = records.get(call.batch.draft.key);
      if (record?.revision === call.batch.draft.revision) records.set(record.key,
        { ...record, revision: record.revision + ':promoted', state: 'promoted', translations: [] });
    }
    call.resolve({ jobId: call.batch.jobId, status: 'local', files: call.batch.files, draftConsumed: !!call.batch.draft });
  };
  return h;
}

async function waitForDeletionWrite(h, count = 1) {
  for (let attempt = 0; attempt < 25 && h.calls.storage.length < count; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.calls.storage.length, count);
  return h.calls.storage[count - 1];
}

test('staged deletion is available only for the current language and source, including intentionally blank staged saves', async () => {
  const h = harness(), { editor, desc, window } = h;
  await editor.editFile(desc.filepath);
  assert.equal(editor.editorHasStagedTranslation, false);
  window.WorkspaceState.stageTranslation(editor.localDescs,
    { filepath: desc.filepath, translations: ['other language'] }, 'German', { source: desc });
  assert.equal(editor.editorHasStagedTranslation, false);
  const staged = window.WorkspaceState.stageTranslation(editor.localDescs,
    { filepath: desc.filepath, translations: [''] }, 'Thai', { source: desc });
  assert.equal(editor.editorHasStagedTranslation, true);
  staged.sourceHash = 'older-source';
  assert.equal(editor.editorHasStagedTranslation, false);
  staged.sourceHash = editor.sourceIdentity;
  editor.localDescs.sourceHash = 'another-workspace';
  assert.equal(editor.editorHasStagedTranslation, false);
});

test('staged deletion requires a danger confirmation and declining retains staged text and local drafts', async () => {
  const { editor, calls, desc, records } = await stagedDeletionFixture();
  editor.editorBlocks[0].translation = 'keep my unsaved draft';
  await editor.flushEditorDraft();
  const before = copy(editor.localDescs), drafts = copy([...records.entries()]), writes = calls.writes.length;
  let options;
  editor.appConfirm = async (message, config) => { calls.confirms.push(message); options = config; return false; };
  assert.equal(await editor.deleteEditorStagedTranslation(), false);
  assert.equal(options.danger, true);
  assert.match(options.title, /Delete staged translation/);
  assert.equal(options.confirmLabel, 'Delete staged translation');
  assert.equal(calls.confirms.length, 1); assert.equal(calls.deletions.length, 0);
  assert.equal(calls.writes.length, writes);
  assert.deepEqual(copy(editor.localDescs), before); assert.deepEqual(copy([...records.entries()]), drafts);
  assert.equal(desc.translations.Thai[0], 'staged translation');
  assert.equal(editor.editorBlocks[0].translation, 'keep my unsaved draft');
  assert.equal(editor.editorVisible, true);
});

test('confirmed staged deletion bypasses translation validation and resets a clean editor to its ZIP translation', async t => {
  for (const inline of [false, true]) await t.test(inline ? 'inline editor' : 'full editor', async () => {
    const { editor, calls, desc } = await stagedDeletionFixture({ inline });
    editor.appConfirm = async () => true;
    editor.validateEditor = () => assert.fail('Deleting a stage must not validate the translation');
    editor.editorSaveFindings = () => assert.fail('Deleting a stage must not run ordinary Save diagnostics');
    assert.equal(await editor.deleteEditorStagedTranslation(), true);
    assert.equal(calls.deletions.length, 1); assert.equal(calls.promotions.length, 0);
    assert.equal(editor.editorHasStagedTranslation, false);
    assert.equal(desc.translations.Thai[0], 'translation'); assert.equal(desc.hasChanges, false);
    assert.equal(editor.editorBlocks[0].translation, 'translation');
    assert.equal(editor.editorOriginalTranslations[0], 'translation');
    assert.equal(editor.editorSessionActive, true);
    assert.equal(editor.inlineActive, inline); assert.equal(editor.editorVisible, !inline);
    assert.equal(editor.editorCurrentEditingDesc.filepath, desc.filepath);
  });
});

test('clean staged deletion rebuilds every original ZIP entry including extra translation entries', async t => {
  for (const inline of [false, true]) await t.test(inline ? 'inline editor' : 'full editor', async () => {
    const h = await stagedDeletionFixture({ inline }), { editor, desc } = h;
    const baseline = editor.workspaceSourceFile(desc.filepath);
    baseline.translations.Thai = ['ZIP first', 'ZIP extra\\nline', 'ZIP third'];
    assert.equal(editor.editorBlocks.length, 1);
    editor.appConfirm = async () => true;
    assert.equal(await editor.deleteEditorStagedTranslation(), true);
    assert.deepEqual(copy(desc.translations.Thai), baseline.translations.Thai);
    assert.equal(editor.editorBlocks.length, 3);
    assert.deepEqual(copy(editor.serializeEditorTranslations()), baseline.translations.Thai);
    assert.deepEqual(copy(editor.editorOriginalTranslations), ['ZIP first', 'ZIP extra\nline', 'ZIP third']);
    assert.equal(editor.editorBlocks[1].english, ''); assert.equal(editor.editorBlocks[1].isMultiline, true);
    assert.equal(editor.editorHaveChanges(), false); assert.equal(editor.editorSessionActive, true);
    assert.deepEqual(copy(editor._draftSession.base.translations), baseline.translations.Thai);
  });
});

test('retrying an uncertain staged deletion rebases the retained same-editor draft before its next save', async () => {
  const h = enableDeletionWorker(await stagedDeletionFixture()), { editor, desc, calls, records, acknowledge } = h;
  editor.editorBlocks[0].translation = 'retained local draft'; await editor.flushEditorDraft();
  const session = editor._draftSession;
  editor.appConfirm = async () => true;
  const deleting = editor.deleteEditorStagedTranslation(), original = await waitForDeletionWrite(h);
  const payload = JSON.stringify(original.batch);
  original.reject(Object.assign(new Error('Worker acknowledgement was lost'), { durableUnknown: true }));
  assert.equal(await deleting, false);
  assert.equal(editor.editorBlocks[0].translation, 'retained local draft');
  assert.equal(editor.editorOriginalTranslations[0], 'staged translation');
  assert.equal(editor.pendingLocalSaves, 1); assert.equal(editor.editorHasStagedTranslation, true);
  const retrying = editor.retryPendingSaves(), retried = await waitForDeletionWrite(h, 2);
  assert.equal(JSON.stringify(retried.batch), payload);
  acknowledge(retried); await retrying;
  assert.equal(editor.pendingLocalSaves, 0); assert.equal(editor.editorHasStagedTranslation, false);
  assert.equal(editor._draftSession, session); assert.equal(editor.editorVisible, true);
  assert.equal(editor.editorBlocks[0].translation, 'retained local draft');
  assert.deepEqual(copy(editor.editorOriginalTranslations), ['translation']);
  assert.deepEqual(copy(session.base.translations), ['translation']);
  assert.deepEqual(records.get(session.key).base.translations, ['translation']);
  assert.equal(records.get(session.key).translations[0], 'retained local draft');
  assert.equal(desc.translations.Thai[0], 'translation');
  const saving = editor.editorSave({ close: false }), nextSave = await waitForDeletionWrite(h, 3);
  assert.deepEqual(copy(nextSave.batch.draft.base.translations), ['translation']);
  assert.deepEqual(copy(nextSave.batch.files[0].translations), ['retained local draft']);
  acknowledge(nextSave); assert.equal(await saving, true);
  assert.equal(desc.translations.Thai[0], 'retained local draft'); assert.equal(editor.editorVisible, true);
  assert.equal(calls.storage.length, 3);
});

test('a retried staged deletion cannot rebase another editor after its session or scope changes', async t => {
  const changes = {
    session: editor => { editor._draftSession = { ...editor._draftSession }; },
    openRun: editor => { editor._editorOpenRun++; },
    profile: editor => { editor.cloudProfileId = 'other-profile'; },
    language: editor => { editor.lang = 'German'; },
    source: editor => { editor.sourceIdentity = 'other-source'; },
    file: editor => { editor.editorCurrentEditingDesc = editor.descs[1]; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    const h = enableDeletionWorker(await stagedDeletionFixture()), { editor, acknowledge, records } = h;
    editor.editorBlocks[0].translation = 'retained first draft'; await editor.flushEditorDraft();
    editor.appConfirm = async () => true;
    const deleting = editor.deleteEditorStagedTranslation(), original = await waitForDeletionWrite(h);
    original.reject(Object.assign(new Error('Uncertain worker completion'), { durableUnknown: true }));
    assert.equal(await deleting, false);
    change(editor);
    editor.editorBlocks[0].translation = 'new editor draft';
    editor.editorOriginalTranslations = ['new editor committed'];
    const blocks = editor.editorBlocks, session = editor._draftSession, stored = copy([...records.entries()]);
    const retrying = editor.retryPendingSaves(), retried = await waitForDeletionWrite(h, 2);
    acknowledge(retried); await retrying;
    assert.equal(editor.editorBlocks, blocks); assert.equal(editor._draftSession, session);
    assert.equal(editor.editorBlocks[0].translation, 'new editor draft');
    assert.deepEqual(copy(editor.editorOriginalTranslations), ['new editor committed']);
    assert.deepEqual(copy([...records.entries()]), stored);
    assert.equal(editor.editorVisible, true);
  });
});

test('confirmed staged deletion preserves a durable local draft and new typing during the storage acknowledgement', async () => {
  const { editor, calls, desc, records } = await stagedDeletionFixture();
  editor.editorBlocks[0].translation = 'preserved draft'; await editor.flushEditorDraft();
  const session = editor._draftSession, record = copy(records.get(session.key)), gate = deferred(), persist = editor.persistStagedDeletion;
  editor.persistStagedDeletion = async (...args) => { await gate.promise; return persist(...args); };
  editor.appConfirm = async () => true;
  const deleting = editor.deleteEditorStagedTranslation(); await tick();
  assert.equal(editor.editorHasStagedTranslation, true); assert.equal(desc.translations.Thai[0], 'staged translation');
  assert.equal(editor.editorBlocks[0].translation, 'preserved draft');
  editor.editorBlocks[0].translation = 'typed while deleting'; gate.resolve();
  assert.equal(await deleting, true);
  assert.equal(calls.deletions.length, 1); assert.equal(editor._draftSession, session);
  assert.equal(editor.editorBlocks[0].translation, 'typed while deleting'); assert.equal(editor.editorVisible, true);
  assert.equal(desc.translations.Thai[0], 'translation'); assert.equal(editor.editorHasStagedTranslation, false);
  const retained = records.get(session.key);
  assert.equal(retained.state, 'active');
  assert.ok([record.translations[0], 'typed while deleting'].includes(retained.translations[0]));
  assert.equal(calls.promotions.length, 0);
});

test('a failed staged deletion retains the stage, draft and open editor without reporting success', async () => {
  const { editor, calls, desc, records } = await stagedDeletionFixture();
  editor.editorBlocks[0].translation = 'keep this draft'; await editor.flushEditorDraft();
  const workspace = copy(editor.localDescs), before = copy([...records.entries()]);
  editor.appConfirm = async () => true;
  editor.persistStagedDeletion = async () => { throw new Error('Storage quota exhausted'); };
  assert.equal(await editor.deleteEditorStagedTranslation(), false);
  assert.deepEqual(copy(editor.localDescs), workspace);
  assert.deepEqual(copy([...records.entries()]), before);
  assert.equal(desc.translations.Thai[0], 'staged translation'); assert.equal(editor.editorHasStagedTranslation, true);
  assert.equal(editor.editorBlocks[0].translation, 'keep this draft'); assert.equal(editor.editorVisible, true);
  assert.match(editor.collaborationNotice || editor.inlineDraftError || calls.alerts.join(' '), /Storage quota exhausted/);
  assert.equal(calls.promotions.length, 0); assert.equal(editor.editorSaving, false);
});

test('staged deletion confirmations expire after any editor, access, scope or committed-stage change', async t => {
  const changes = {
    profile: h => { h.editor.cloudProfileId = 'other-profile'; },
    game: h => { h.editor.gameVersion = 'poe2'; },
    language: h => { h.editor.lang = 'German'; },
    source: h => { h.editor.sourceIdentity = 'other-source'; },
    account: h => { h.editor.cloudUser.id = 'other-account'; },
    role: h => { h.editor.cloudUser.role = 'manager'; },
    assignment: h => { h.editor.cloudUser.assignmentVersion++; },
    access: h => { h.editor.cloudCanAccessAllLanguages = true; },
    session: h => { h.editor._draftSession = { ...h.editor._draftSession }; },
    openRun: h => { h.editor._editorOpenRun++; },
    file: h => { h.editor.editorCurrentEditingDesc = h.editor.descs[1]; },
    stage: h => { h.editor.localDescs.staged.Thai[h.desc.filepath].translations[0] = 'new peer stage'; },
    base: h => { h.currentBase.revision++; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    const h = await stagedDeletionFixture(), { editor, calls, desc } = h, gate = deferred();
    editor.cloudUser = { id: 'first-account', role: 'translator', assignmentVersion: 1 };
    editor.cloudCanAccessAllLanguages = false;
    if (name === 'base') {
      h.currentBase = { ...copy(editor.collaborationFile(desc)), revision: 1 };
      editor._collaboration = { fileBase: () => copy(h.currentBase) };
    }
    editor.appConfirm = () => gate.promise;
    const deleting = editor.deleteEditorStagedTranslation(); await tick();
    change(h); gate.resolve(true);
    assert.equal(await deleting, false);
    assert.equal(calls.deletions.length, 0); assert.equal(calls.promotions.length, 0);
    assert.equal(editor.localDescs.staged.Thai[desc.filepath] != null, true);
  });
});

test('row lookups index the raw corpus and only read the selected reactive description', () => {
  const { editor, context } = harness();
  const source = Array.from({ length: 20520 }, (_, index) => description(String(index)));
  let reads = 0;
  const proxies = source.map(desc => new Proxy(desc, { get(target, property) { reads++; return target[property]; } }));
  const corpus = new Proxy(proxies, { get(target, property) { reads++; return target[property]; } });
  context.Vue.toRaw = value => value === corpus ? source : value;
  editor.descs = corpus;
  const row = { filepath: source.at(-1).filepath };
  for (let i = 0; i < 100; i++) assert.equal(editor.getDescByFilepath(row.filepath), proxies.at(-1));
  assert.ok(reads <= 100, 'repeated rendering must not walk or subscribe to the reactive corpus: ' + reads);
  assert.equal(editor.getDescByFilepath('absent.txt'), undefined);
  source.at(-1).translations.Thai[0] = 'peer update';
  assert.equal(editor.getDescByFilepath(row.filepath).translations.Thai[0], 'peer update');
});

test('filepath index follows source replacement, additions, reordering and duplicate first-match semantics', () => {
  const { editor } = harness();
  const first = editor.descs[0], second = editor.descs[1];
  assert.equal(editor.getDescByFilepath(first.filepath), first);
  editor.descs.reverse();
  assert.equal(editor.getDescByFilepath(first.filepath), first);
  const added = description('added'); editor.descs.push(added);
  assert.equal(editor.getDescByFilepath(added.filepath), added);
  const replacement = description('first', 'new source');
  editor.descs = [replacement, second, first];
  assert.equal(editor.getDescByFilepath(first.filepath), replacement);
  editor.descs = [];
  assert.equal(editor.getDescByFilepath(first.filepath), undefined);
});

test('paired inline blocks reuse decoded text while tracking drafts, peer repairs and language/source changes', () => {
  const { editor, desc } = harness();
  desc.translations.English = ['Source\\nline', 'source-only'];
  desc.translations.Thai = ['translation\\nline'];
  let decodes = 0;
  const decode = editor.decodeEscapedNewlines.bind(editor);
  editor.decodeEscapedNewlines = text => { decodes++; return decode(text); };
  const first = editor.inlineRowBlocks(desc);
  assert.equal(first.length, 2); assert.equal(first[0].english, 'Source\nline'); assert.equal(first[1].translation, '');
  assert.equal(decodes, 4);
  for (let i = 0; i < 100; i++) assert.equal(editor.inlineRowBlocks(desc), first);
  assert.equal(decodes, 4, 'popup rerenders reuse decoded blocks in both columns');
  desc.translations.Thai[0] = 'peer update';
  const peer = editor.inlineRowBlocks(desc);
  assert.equal(peer[0].translation, 'peer update'); assert.equal(decodes, 5);
  editor.inlineDraftRows[desc.filepath] = { translations: ['draft', '', 'translation-only'] };
  const draft = editor.inlineRowBlocks(desc);
  assert.equal(draft.length, 3); assert.equal(draft[2].english, ''); assert.equal(draft[2].translation, 'translation-only');
  editor.inlineDraftRows[desc.filepath].translations[0] = 'new draft';
  assert.equal(editor.inlineRowBlocks(desc)[0].translation, 'new draft');
  delete editor.inlineDraftRows[desc.filepath];
  assert.equal(editor.inlineRowBlocks(desc)[0].translation, 'peer update');
  editor.lang = 'German'; desc.translations.German = ['Deutsch'];
  assert.equal(editor.inlineRowBlocks(desc)[0].translation, 'Deutsch');
  editor.descs = [{ ...desc, translations: { English: ['new source'], German: ['neu'] } }];
  assert.equal(editor.inlineRowBlocks(desc)[0].english, 'new source');
  assert.equal(editor.inlineRowBlocks(desc)[0].translation, 'neu');
});

test('inline row activation prepares the shared editing session without showing the full editor', async () => {
  const h = harness(), { editor, desc } = h;
  assert.equal(editor.inlineEditor, true);
  assert.equal(await editor.activateInlineRow(desc.filepath), true, editor.editorLoadError);
  assert.equal(editor.inlineActive, true); assert.equal(editor.editorVisible, false); assert.equal(editor.editorSessionActive, true);
  assert.equal(editor.editorBlocks[0].english, 'Source'); assert.equal(editor.editorBlocks[0].translation, 'translation');
  assert.equal(h.calls.focused, 0); assert.equal(editor._draftSession.scope.filepath, desc.filepath);
});

test('row Enter opens the full surface, while Enter inside a translation input stays with input handling', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  const row = { matches: selector => selector === 'tr[data-filepath]', closest(selector) { return selector === 'tr[data-filepath]' ? row : null; } };
  const event = target => ({ key: 'Enter', target, preventDefault() { this.prevented = true; }, stopPropagation() {} });
  editor.fileTableKeydown(event({ closest: () => row, matches: () => false, tagName: 'INPUT' }));
  await tick(); assert.equal(editor.editorVisible, false);
  editor.fileTableKeydown(event(row)); await tick();
  assert.equal(editor.editorVisible, true); assert.equal(editor.inlineActive, false);
  assert.equal(h.calls.promotions.length, 0);
});

test('row double-click opens the same draft in the full editor and interactive descendants retain their own behavior', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'continue this draft';
  const session = editor._draftSession;
  for (const control of ['input', 'textarea', 'button', 'a', 'select', '[contenteditable="true"]', '.HLter']) {
    await editor.inlineRowDoubleClick({ target: { closest: selector => selector.split(', ').includes(control) ? { control } : null } }, desc.filepath);
    assert.equal(editor.editorVisible, false, control);
  }
  assert.equal(await editor.inlineRowDoubleClick({ target: { closest: () => null } }, desc.filepath), true);
  assert.equal(editor.editorVisible, true); assert.equal(editor.inlineActive, false);
  assert.equal(editor._draftSession, session); assert.equal(editor.editorBlocks[0].translation, 'continue this draft');
  assert.equal(h.records.get(session.key).translations[0], 'continue this draft');
  assert.equal(h.calls.promotions.length, 0);
});

test('double-click during inline hydration switches the pending session to the full editor without restarting it', async () => {
  const h = harness(), { editor, desc } = h, gate = deferred();
  let reads = 0;
  h.store.getTranslationDraft = async () => { reads++; await gate.promise; return null; };
  const opening = editor.activateInlineRow(desc.filepath); await tick();
  assert.equal(editor.inlineActive, true); assert.equal(editor.editorLoading, true);
  assert.equal(await editor.inlineRowDoubleClick({ target: { closest: () => null } }, desc.filepath), true);
  assert.equal(editor.editorVisible, true); assert.equal(editor.inlineActive, false);
  gate.resolve(); assert.equal(await opening, true);
  assert.equal(reads, 1); assert.equal(editor.editorLoading, false); assert.equal(editor.editorVisible, true);
  assert.equal(h.calls.promotions.length, 0);
});

test('double-clicking another row while the outgoing draft is saving leaves the requested full editor open', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'preserve the outgoing draft';
  const gate = deferred(), put = h.store.putTranslationDraft;
  h.store.putTranslationDraft = async (...args) => { await gate.promise; return put(...args); };
  const filepath = editor.descs[1].filepath;
  const selection = editor.inlineRowClick({ target: { closest: () => null } }, filepath); await tick();
  const opening = editor.inlineRowDoubleClick({ target: { closest: () => null } }, filepath); await tick();
  gate.resolve(); await selection;
  assert.equal(await opening, true);
  assert.equal(editor.editorVisible, true); assert.equal(editor.inlineActive, false);
  assert.equal(editor.editorCurrentEditingDesc.filepath, filepath);
  assert.equal(desc.translations.Thai[0], 'preserve the outgoing draft');
});

test('a different-row full-editor request waits for a pending collaboration claim and keeps its full intent', async () => {
  const h = harness(), { editor, desc } = h, gate = deferred(), claims = [];
  editor._collaboration = { leaveEdit() {}, fileBase() { return null; } };
  editor.claimCollaborationFile = async filepath => { claims.push(filepath); if (filepath === desc.filepath) await gate.promise; return true; };
  const selecting = editor.activateInlineRow(desc.filepath); await tick();
  assert.equal(editor.editorLoading, true); assert.equal(editor.inlineTransitionBusy, true);
  const filepath = editor.descs[1].filepath;
  await editor.inlineRowClick({ target: { closest: () => null } }, filepath);
  const opening = editor.inlineRowDoubleClick({ target: { closest: () => null } }, filepath); await tick();
  gate.resolve(); await selecting;
  assert.equal(await opening, true);
  assert.deepEqual(claims, [desc.filepath, filepath]);
  assert.equal(editor.editorVisible, true); assert.equal(editor.inlineActive, false);
  assert.equal(editor.editorCurrentEditingDesc.filepath, filepath);
});

test('a queued full-editor request cannot open after its account, source, language, game or access context changes', async () => {
  const changes = [editor => { editor.cloudProfileId = 'other-profile'; }, editor => { editor.sourceIdentity = 'other-source'; },
    editor => { editor.lang = 'German'; }, editor => { editor.gameVersion = 'poe2'; },
    editor => { editor.cloudUser = { id: 'other-account', role: 'translator', assignmentVersion: 2 }; },
    editor => { editor.cloudUser.role = 'manager'; }, editor => { editor.cloudUser.assignmentVersion++; },
    editor => { editor._collaboration = null; }];
  for (const change of changes) {
    const h = harness(), { editor, desc } = h, gate = deferred(), claims = [];
    editor.cloudUser = { id: 'first-account', role: 'translator', assignmentVersion: 1 };
    editor._collaboration = { leaveEdit() {}, fileBase() { return null; } };
    editor.claimCollaborationFile = async filepath => { claims.push(filepath); await gate.promise; return true; };
    const selecting = editor.activateInlineRow(desc.filepath); await tick();
    const opening = editor.openInlineFullEditor(editor.descs[1].filepath); await tick();
    change(editor); await editor.draftScopeChanged();
    gate.resolve(); await selecting;
    assert.equal(await opening, false); assert.equal(editor.editorVisible, false);
    assert.deepEqual(claims, [desc.filepath]);
  }
});

test('focusing and leaving unchanged inline text creates neither draft nor staged save', async () => {
  const h = harness(); await h.editor.activateInlineRow(h.desc.filepath);
  assert.equal(await h.editor.finishInlineSession(), true);
  assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.promotions.length, 0); assert.equal(h.records.size, 0);
  assert.equal(h.editor.inlineActive, false); assert.deepEqual(h.desc.translations.Thai, ['translation']);
});

test('inline stage link stays hidden for untouched ZIP text and follows live edits, reverts and clears', async () => {
  const { editor, desc } = harness(); await editor.activateInlineRow(desc.filepath);
  assert.equal(editor.inlineDraftHasChanges, false, 'opening a translated row is not an edit');
  editor.editorBlocks[0].translation = 'new draft';
  assert.equal(editor.inlineDraftHasChanges, true, 'show Stage draft before the draft debounce writes');
  editor.editorBlocks[0].translation = 'translation';
  assert.equal(editor.inlineDraftHasChanges, false, 'reverting to ZIP text removes the action');
  editor.editorBlocks[0].translation = '';
  assert.equal(editor.inlineDraftHasChanges, true, 'clearing an existing translation is a real edit');
});

test('inline stage link stays hidden when opening empty or incomplete ZIP translations', async t => {
  for (const translations of [undefined, [], [''], ['kept first entry']]) {
    await t.test(JSON.stringify(translations) || 'missing language', async () => {
      const { editor, desc, calls, records } = harness();
      desc.translations.English = ['First source', 'Second source', 'Third source'];
      if (translations) desc.translations.Thai = translations;
      else delete desc.translations.Thai;
      editor._workspaceSourceBaseline = copy(editor.descs);
      await editor.activateInlineRow(desc.filepath);
      assert.equal(editor.editorBlocks.length, 3);
      assert.equal(editor.inlineDraftHasChanges, false, 'missing entries display as blanks without becoming edits');
      assert.equal(calls.writes.length, 0); assert.equal(records.size, 0);
      editor.editorBlocks[2].translation = 'new last entry';
      assert.equal(editor.inlineDraftHasChanges, true);
      editor.editorBlocks[2].translation = '';
      assert.equal(editor.inlineDraftHasChanges, false);
    });
  }
});

test('inline stage link follows live edits, reverts and peer changes to the current staged translation', async () => {
  const { editor, desc, window } = harness(); await editor.activateInlineRow(desc.filepath);
  const staged = window.WorkspaceState.stageTranslation(editor.localDescs,
    { filepath: desc.filepath, translations: ['translation'] }, 'Thai', { source: desc });
  assert.equal(editor.inlineDraftHasChanges, false);
  editor.editorBlocks[0].translation = 'new draft';
  assert.equal(editor.inlineDraftHasChanges, true, 'new input must show Stage draft before the draft debounce writes');
  editor.editorBlocks[0].translation = 'translation';
  assert.equal(editor.inlineDraftHasChanges, false);
  staged.translations[0] = 'peer saved text';
  assert.equal(editor.inlineDraftHasChanges, true, 'compare with the current stage, not the session merge base');
  editor.editorBlocks[0].translation = 'peer saved text';
  assert.equal(editor.inlineDraftHasChanges, false);
  editor.editorBlocks[0].translation = '';
  assert.equal(editor.inlineDraftHasChanges, true, 'clearing staged text can be staged');
});

test('inline stage link treats intentionally blank stages as committed text and preserves whitespace and entry-count edits', async () => {
  const { editor, desc, window } = harness(); await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = '';
  window.WorkspaceState.stageTranslation(editor.localDescs,
    { filepath: desc.filepath, translations: [''] }, 'Thai', { source: desc });
  assert.equal(editor.inlineDraftHasChanges, false);
  editor.editorBlocks[0].translation = ' ';
  assert.equal(editor.inlineDraftHasChanges, true, 'whitespace is part of the saved text');
  editor.editorBlocks[0].translation = '';
  editor.editorBlocks.push({ translation: '' });
  assert.equal(editor.inlineDraftHasChanges, true, 'an extra translation entry is a real edit');
});

test('inline stage comparison uses the selected language and current workspace source', async () => {
  const { editor, desc, window } = harness();
  desc.translations.German = ['ZIP German']; editor.lang = 'German';
  editor._workspaceSourceBaseline = copy(editor.descs);
  window.WorkspaceState.stageTranslation(editor.localDescs,
    { filepath: desc.filepath, translations: ['German draft'] }, 'Thai', { source: desc });
  await editor.activateInlineRow(desc.filepath);
  assert.equal(editor.inlineDraftHasChanges, false, 'another language stage does not make untouched ZIP text dirty');
  editor.editorBlocks[0].translation = 'German draft';
  assert.equal(editor.inlineDraftHasChanges, true, 'matching another language stage does not hide the link');
  const staged = window.WorkspaceState.stageTranslation(editor.localDescs,
    { filepath: desc.filepath, translations: ['German draft'] }, 'German', { source: desc });
  assert.equal(editor.inlineDraftHasChanges, false);
  staged.sourceHash = 'older-source';
  assert.equal(editor.inlineDraftHasChanges, true, 'another source stage is ignored in favor of current ZIP text');
  editor.editorBlocks[0].translation = 'ZIP German';
  assert.equal(editor.inlineDraftHasChanges, false);
  editor.editorBlocks[0].translation = 'outgoing draft';
  staged.sourceHash = 'source-a'; editor.sourceIdentity = 'source-b';
  assert.equal(editor.inlineDraftHasChanges, false, 'do not offer staging outgoing text during a source switch');
  editor.sourceIdentity = 'source-a'; editor.localDescs.sourceHash = 'another-workspace';
  assert.equal(editor.inlineDraftHasChanges, false, 'do not offer staging against an outgoing workspace');
  editor.localDescs.sourceHash = 'source-a'; editor.inlineActive = false;
  assert.equal(editor.inlineDraftHasChanges, false, 'an inactive inline session cannot offer staging');
});

test('inline stage comparison serializes table columns, placeholders and multiline text against ZIP and staged content', async () => {
  const { editor, desc, window } = harness();
  desc.translations.English = ['First@Second@{0}', 'Source\\nline'];
  desc.translations.Thai = ['first@second@{0}', 'line one\\nline two'];
  editor._workspaceSourceBaseline = copy(editor.descs);
  await editor.activateInlineRow(desc.filepath);
  assert.equal(editor.inlineDraftHasChanges, false, 'opening serialized ZIP entries does not create an edit');
  editor.editorBlocks = [
    { isTable: true, translation: 'stale table cache', tableColumns: [
      { translation: 'first', englishExists: true }, { translation: 'second', englishExists: true },
      { translation: '{0}', englishExists: true },
      { translation: '', englishExists: false } ] },
    { isMultiline: true, translation: 'line one\r\nline two' },
  ];
  assert.equal(editor.inlineDraftHasChanges, false, 'use serialized columns and normalize displayed newlines');
  window.WorkspaceState.stageTranslation(editor.localDescs,
    { filepath: desc.filepath, translations: ['first@second@{0}', 'line one\\nline two'] }, 'Thai', { source: desc });
  assert.equal(editor.inlineDraftHasChanges, false);
  editor.editorBlocks[0].tableColumns[1].translation = 'changed column';
  assert.equal(editor.inlineDraftHasChanges, true);
  editor.editorBlocks[0].tableColumns[1].translation = 'second';
  editor.editorBlocks[1].translation = 'line one\\nline two';
  assert.equal(editor.inlineDraftHasChanges, false, 'literal escaped and displayed multiline values serialize identically');
  editor.editorBlocks[0].tableColumns[2].translation = '{1}';
  assert.equal(editor.inlineDraftHasChanges, true, 'a changed placeholder is still an edit');
});

test('inline stage link stays hidden for untouched table padding, empty separators and displayed newlines', async t => {
  const fixtures = [
    { name: 'partial table', english: 'First@Second', translation: 'first', serialized: 'first@' },
    { name: 'empty table separators', english: 'First@Second', translation: '@', serialized: '' },
    { name: 'literal escaped newlines', english: 'Source\\nline', translation: 'one\\ntwo', serialized: 'one\\ntwo' },
    { name: 'CRLF newlines', english: 'Source\\nline', translation: 'one\r\ntwo', serialized: 'one\\ntwo' },
  ];
  for (const fixture of fixtures) await t.test(fixture.name, async () => {
    const { editor, desc, window } = harness();
    desc.translations.English = [fixture.english]; desc.translations.Thai = [fixture.translation];
    editor._workspaceSourceBaseline = copy(editor.descs);
    await editor.activateInlineRow(desc.filepath);
    assert.deepEqual(copy(editor.serializeEditorTranslations()), [fixture.serialized]);
    assert.equal(editor.inlineDraftHasChanges, false, 'editor display normalization does not make a ZIP translation dirty');
    window.WorkspaceState.stageTranslation(editor.localDescs,
      { filepath: desc.filepath, translations: [fixture.translation] }, 'Thai', { source: desc });
    assert.equal(editor.inlineDraftHasChanges, false, 'the same normalization applies to staged translations');
    const field = editor.editorBlocks[0].isTable ? editor.editorBlocks[0].tableColumns[0] : editor.editorBlocks[0];
    const before = field.translation;
    field.translation = 'actual edit';
    assert.equal(editor.inlineDraftHasChanges, true);
    field.translation = before;
    assert.equal(editor.inlineDraftHasChanges, false);
  });
});

test('inline stage link does not appear for loading, failed or outgoing scoped editor sessions', async () => {
  const { editor, desc } = harness(); await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'edited text';
  assert.equal(editor.inlineDraftHasChanges, true);
  editor.editorLoading = true;
  assert.equal(editor.inlineDraftHasChanges, false);
  editor.editorLoading = false; editor.editorLoadError = 'Draft storage unavailable';
  assert.equal(editor.inlineDraftHasChanges, false);
  editor.editorLoadError = ''; editor.cloudProfileId = 'another-account';
  assert.equal(editor.inlineDraftHasChanges, false, 'do not offer staging under another account');
  editor.cloudProfileId = 'guest'; editor.lang = 'German';
  assert.equal(editor.inlineDraftHasChanges, false, 'do not compare outgoing Thai text with German committed text');
});

test('a resumed durable inline draft is compared with current committed text rather than its saved merge base', async () => {
  const h = harness(); await h.editor.activateInlineRow(h.desc.filepath);
  h.editor.editorBlocks[0].translation = 'resumed draft'; await h.editor.flushEditorDraft();
  await h.editor.finishInlineSession({ promote: false });
  const { editor, desc, window } = harness({ records: h.records });
  await editor.loadEditorDrafts(); await editor.activateInlineRow(desc.filepath);
  assert.equal(editor.editorBlocks[0].translation, 'resumed draft');
  assert.equal(editor.inlineDraftHasChanges, true);
  const staged = window.WorkspaceState.stageTranslation(editor.localDescs,
    { filepath: desc.filepath, translations: ['resumed draft'] }, 'Thai', { source: desc });
  assert.equal(editor.inlineDraftHasChanges, false, 'a peer stage matching the resumed draft removes the action');
  staged.translations[0] = 'peer changed again';
  assert.equal(editor.inlineDraftHasChanges, true);
  editor.editorBlocks[0].translation = 'peer changed again';
  assert.equal(editor.inlineDraftHasChanges, false);
});

function assertNoActiveEditorDraft(h, session) {
  const { editor, records, desc } = h;
  assert.notEqual(records.get(session.key)?.state, 'active', 'reverting must not retain an active durable draft');
  assert.equal(editor.inlineDraftFor(desc.filepath), null, 'the row must not display Local draft');
  assert.equal(editor.draftRecords.some(record => record.key === session.key && record.state === 'active'), false);
  assert.equal(editor.draftRecoveryItems.some(record => record.key === session.key), false);
  assert.equal(session.record, null); assert.equal(session.pendingRecord, null);
  assert.equal(!!session.writeError, false); assert.equal(editor.inlineDraftError, '');
}

for (const inline of [true, false]) for (const original of ['', 'translation']) {
  const surface = inline ? 'inline' : 'full', originalName = original ? 'nonempty' : 'empty';
  test(`${surface} editing and reverting ${originalName} text before debounce creates no draft or stage`, async () => {
    const h = harness(), { editor, desc, calls } = h;
    desc.translations.Thai = [original]; editor._workspaceSourceBaseline = copy(editor.descs);
    await (inline ? editor.activateInlineRow(desc.filepath) : editor.editFile(desc.filepath));
    const session = editor._draftSession;
    editor.editorBlocks[0].translation = 'temporary typing'; editor.scheduleEditorDraft();
    editor.editorBlocks[0].translation = original; editor.scheduleEditorDraft();
    assert.equal(await editor.flushEditorDraft(), true);
    assertNoActiveEditorDraft(h, session);
    assert.equal(calls.writes.length, 0); assert.equal(calls.discards.length, 0);
    if (inline) assert.equal(await editor.finishInlineSession(), true);
    else await editor.editorExit();
    assert.equal(calls.promotions.length, 0); assert.deepEqual(desc.translations.Thai, [original]);
  });

  test(`${surface} reverting ${originalName} text removes a durable draft and leaves without staging`, async () => {
    const h = harness(), { editor, desc, calls, records } = h;
    desc.translations.Thai = [original]; editor._workspaceSourceBaseline = copy(editor.descs);
    await (inline ? editor.activateInlineRow(desc.filepath) : editor.editFile(desc.filepath));
    const session = editor._draftSession;
    editor.editorBlocks[0].translation = 'durable temporary text'; editor.scheduleEditorDraft();
    assert.equal(await editor.flushEditorDraft(), true);
    const revision = records.get(session.key).revision;
    assert.equal(records.get(session.key).state, 'active');
    editor.editorBlocks[0].translation = original; editor.scheduleEditorDraft();
    assert.equal(await editor.flushEditorDraft(), true);
    assertNoActiveEditorDraft(h, session);
    assert.deepEqual(calls.discards, [{ key: session.key, expectedRevision: revision }]);
    assert.equal(session.expectedRevision, records.get(session.key).revision);
    if (inline) assert.equal(await editor.finishInlineSession(), true);
    else await editor.editorExit();
    assert.equal(calls.promotions.length, 0); assert.deepEqual(desc.translations.Thai, [original]);
    editor.editorBlocks = [];
    await (inline ? editor.activateInlineRow(desc.filepath) : editor.editFile(desc.filepath));
    assert.equal(editor.editorBlocks[0].translation, original);
    assert.equal(editor._draftSession.record, null);
  });
}

test('reverting while the earlier draft write is in flight discards its acknowledged revision', async () => {
  const h = harness(), { editor, desc, calls, store, records } = h;
  await editor.activateInlineRow(desc.filepath);
  const session = editor._draftSession, gate = deferred(), put = store.putTranslationDraft;
  store.putTranslationDraft = async (...args) => { await gate.promise; return put(...args); };
  editor.editorBlocks[0].translation = 'pending temporary text';
  const writing = editor.flushEditorDraft(); await tick();
  assert.equal(editor.draftWritePending, 1);
  editor.editorBlocks[0].translation = 'translation';
  const reverting = editor.flushEditorDraft(); await tick();
  gate.resolve(); assert.equal(await writing, true); assert.equal(await reverting, true);
  assertNoActiveEditorDraft(h, session);
  assert.equal(calls.writes.length, 1, 'the revert should discard, not write another active draft');
  assert.equal(calls.discards[0].expectedRevision, calls.writes[0].record.revision);
  assert.equal(session.expectedRevision, records.get(session.key).revision);
  assert.equal(await editor.finishInlineSession(), true); assert.equal(calls.promotions.length, 0);
});

test('reverting a resumed draft to the committed text removes its saved copy and permits a fresh edit', async () => {
  const previous = harness(); await previous.editor.activateInlineRow(previous.desc.filepath);
  previous.editor.editorBlocks[0].translation = 'resumed local draft'; await previous.editor.flushEditorDraft();
  await previous.editor.finishInlineSession({ promote: false });
  const h = harness({ records: previous.records }), { editor, desc, calls } = h;
  await editor.loadEditorDrafts(); await editor.editFile(desc.filepath);
  const session = editor._draftSession;
  assert.equal(editor.editorBlocks[0].translation, 'resumed local draft');
  editor.editorBlocks[0].translation = 'translation'; assert.equal(await editor.flushEditorDraft(), true);
  assertNoActiveEditorDraft(h, session);
  const discardedRevision = session.expectedRevision;
  editor.editorBlocks[0].translation = 'new edit after revert'; assert.equal(await editor.flushEditorDraft(), true);
  assert.equal(calls.writes[0].options.expectedRevision, discardedRevision);
  assert.equal(h.records.get(session.key).translations[0], 'new edit after revert');
  assert.equal(editor.inlineDraftFor(desc.filepath).translations[0], 'new edit after revert');
});

test('reverting to the current staged translation clears the draft even when ZIP text differs', async t => {
  for (const stagedText of ['', 'current staged text']) await t.test(stagedText || 'intentionally blank stage', async () => {
    const h = harness(), { editor, desc, window, calls } = h;
    window.WorkspaceState.stageTranslation(editor.localDescs,
      { filepath: desc.filepath, translations: [stagedText] }, 'Thai', { source: desc });
    editor.applyWorkspaceOverlay(); await editor.activateInlineRow(desc.filepath);
    const session = editor._draftSession;
    editor.editorBlocks[0].translation = 'temporary staged correction'; await editor.flushEditorDraft();
    editor.editorBlocks[0].translation = stagedText; assert.equal(await editor.flushEditorDraft(), true);
    assertNoActiveEditorDraft(h, session);
    assert.equal(editor.editorHasStagedTranslation, true, 'draft cleanup must retain the existing stage');
    assert.equal(await editor.finishInlineSession(), true); assert.equal(calls.promotions.length, 0);
    assert.deepEqual(copy(desc.translations.Thai), [stagedText]);
  });
});

test('typing while reverted draft cleanup is in flight preserves the newer edit behind its discarded revision', async () => {
  const h = harness(), { editor, desc, store, calls } = h;
  await editor.activateInlineRow(desc.filepath);
  const session = editor._draftSession;
  editor.editorBlocks[0].translation = 'first durable edit'; await editor.flushEditorDraft();
  const gate = deferred(), discard = store.discardTranslationDraft;
  store.discardTranslationDraft = async (...args) => { await gate.promise; return discard(...args); };
  editor.editorBlocks[0].translation = 'translation'; const reverting = editor.flushEditorDraft(); await tick();
  editor.editorBlocks[0].translation = 'new typing during cleanup'; const writing = editor.flushEditorDraft(); await tick();
  gate.resolve(); assert.equal(await reverting, true); assert.equal(await writing, true);
  assert.equal(calls.discards.length, 1);
  assert.equal(calls.writes.length, 2);
  assert.equal(calls.writes[1].options.expectedRevision, calls.discards[0].expectedRevision + ':discarded');
  assert.equal(h.records.get(session.key).translations[0], 'new typing during cleanup');
  assert.equal(session.record.translations[0], 'new typing during cleanup');
  assert.equal(editor.inlineDraftFor(desc.filepath).translations[0], 'new typing during cleanup');
  assert.equal(editor.editorBlocks[0].translation, 'new typing during cleanup');
});

for (const phase of ['read', 'discard']) test(`a peer commit during reverted draft ${phase} preserves the visible text as a new draft`, async () => {
  const h = harness(), { editor, desc, store, window, calls, records } = h;
  await editor.activateInlineRow(desc.filepath);
  const session = editor._draftSession;
  editor.editorBlocks[0].translation = 'first local draft'; await editor.flushEditorDraft();
  const gate = deferred(); let reachedGate = false;
  if (phase === 'read') {
    const get = store.getTranslationDraft;
    store.getTranslationDraft = async key => {
      const record = await get(key); reachedGate = true; await gate.promise; return record;
    };
  } else {
    const discard = store.discardTranslationDraft;
    store.discardTranslationDraft = async (...args) => { reachedGate = true; await gate.promise; return discard(...args); };
  }
  editor.editorBlocks[0].translation = 'translation'; const reverting = editor.flushEditorDraft(); await tick();
  assert.equal(reachedGate, true);
  window.WorkspaceState.stageTranslation(editor.localDescs,
    { filepath: desc.filepath, translations: ['peer committed change'] }, 'Thai', { source: desc });
  editor.applyWorkspaceOverlay();
  gate.resolve(); assert.equal(await reverting, true);
  assert.equal(records.get(session.key).state, 'active');
  assert.deepEqual(records.get(session.key).translations, ['translation'], 'reverted text now differs from the peer commit and must remain recoverable');
  assert.equal(session.record.translations[0], 'translation'); assert.equal(editor.editorBlocks[0].translation, 'translation');
  assert.equal(editor.inlineDraftFor(desc.filepath).translations[0], 'translation');
  assert.equal(editor.inlineDraftHasChanges, true); assert.equal(calls.promotions.length, 0);
  assert.equal(calls.discards.length, phase === 'read' ? 0 : 1);
});

test('reopening a detached session during reverted draft cleanup retains its queue and newer typing', async () => {
  const h = harness(), { editor, desc, store, calls, records } = h;
  await editor.activateInlineRow(desc.filepath);
  const session = editor._draftSession;
  editor.editorBlocks[0].translation = 'durable before revert'; await editor.flushEditorDraft();
  const gate = deferred(), discard = store.discardTranslationDraft;
  store.discardTranslationDraft = async (...args) => { await gate.promise; return discard(...args); };
  editor.editorBlocks[0].translation = 'translation'; const reverting = editor.flushEditorDraft(); await tick();
  const detached = editor.detachEditorSessionForScopeChange();
  assert.equal(await editor.activateInlineRow(desc.filepath), true);
  assert.equal(editor._draftSession, session); assert.equal(session.detached, false);
  assert.equal(editor.editorBlocks[0].translation, 'translation');
  editor.editorBlocks[0].translation = 'new edit after reopening'; const writing = editor.flushEditorDraft();
  gate.resolve(); assert.equal(await reverting, true); assert.equal(await detached, true); assert.equal(await writing, true);
  assert.equal(calls.discards.length, 1); assert.equal(calls.writes.length, 2);
  assert.equal(calls.writes[1].options.expectedRevision, calls.writes[0].record.revision + ':discarded');
  assert.equal(records.get(session.key).translations[0], 'new edit after reopening');
  assert.equal(editor._draftSession, session); assert.equal(editor.inlineDraftFor(desc.filepath).translations[0], 'new edit after reopening');
});

test('reverted draft cleanup preserves a different revision written by another tab during discard', async () => {
  const h = harness(), { editor, desc, store, records, calls } = h;
  await editor.activateInlineRow(desc.filepath);
  const session = editor._draftSession;
  editor.editorBlocks[0].translation = 'this tab draft'; await editor.flushEditorDraft();
  const authored = copy(records.get(session.key)), peer = { ...authored, id: 'peer-tab', revision: 'peer-revision', translations: ['peer draft'] };
  const discard = store.discardTranslationDraft;
  store.discardTranslationDraft = async (...args) => { records.set(session.key, copy(peer)); return discard(...args); };
  editor.editorBlocks[0].translation = 'translation'; await editor.flushEditorDraft();
  assert.deepEqual(records.get(session.key), peer, 'cleanup must not delete a newer peer draft');
  assert.equal(calls.discards.length, 1); assert.equal(calls.discards[0].expectedRevision, authored.revision);
  assert.equal(calls.writes.length, 1, 'do not overwrite the conflicting draft with reverted local text');
  assert.equal(calls.promotions.length, 0); assert.equal(session.conflict, true);
  assert.equal(editor.editorBlocks[0].translation, 'translation');
  assert.equal(editor.inlineFindingsFor(desc.filepath).some(finding => finding.level === 'error'), true);
});

test('reverted draft cleanup does not discard an already-known conflict aggregate', async () => {
  const h = harness(), { editor, desc, records, calls } = h;
  await editor.activateInlineRow(desc.filepath);
  const session = editor._draftSession;
  editor.editorBlocks[0].translation = 'authored local draft'; await editor.flushEditorDraft();
  const authored = copy(records.get(session.key)), preserved = { ...authored, id: 'other-tab', revision: 'other-tab-revision', translations: ['other preserved draft'] };
  const aggregate = { ...authored, revision: 'known-conflict', conflicts: [preserved] };
  records.set(session.key, copy(aggregate)); session.expectedRevision = aggregate.revision; session.conflict = true;
  editor.editorBlocks[0].translation = 'translation'; await editor.flushEditorDraft();
  assert.deepEqual(records.get(session.key), aggregate);
  assert.equal(calls.discards.length, 0, 'resolving a conflict requires explicit review');
  assert.equal(calls.writes.length, 1); assert.equal(calls.promotions.length, 0);
  assert.equal(session.conflict, true);
  await editor.loadEditorDrafts();
  assert.deepEqual(copy(editor.draftRecoveryItems.map(record => record.translations[0])), ['authored local draft', 'other preserved draft']);
});

test('failed reverted draft cleanup stays actionable and retries the same stored revision', async () => {
  const h = harness(), { editor, desc, store, records, calls } = h;
  await editor.activateInlineRow(desc.filepath);
  const session = editor._draftSession;
  editor.editorBlocks[0].translation = 'persisted temporary edit'; await editor.flushEditorDraft();
  const authored = copy(records.get(session.key)), discard = store.discardTranslationDraft;
  store.discardTranslationDraft = async () => { throw new Error('draft cleanup unavailable'); };
  editor.editorBlocks[0].translation = 'translation'; assert.equal(await editor.flushEditorDraft(), false);
  assert.deepEqual(records.get(session.key), authored); assert.equal(editor.inlineActive, true);
  assert.equal(editor.editorBlocks[0].translation, 'translation'); assert.match(editor.inlineDraftError, /draft cleanup unavailable/);
  assert.equal(calls.promotions.length, 0);
  store.discardTranslationDraft = discard; assert.equal(await editor.flushEditorDraft(), true);
  assertNoActiveEditorDraft(h, session);
  assert.deepEqual(calls.discards, [{ key: session.key, expectedRevision: authored.revision }]);
});

test('fresh typing after an uncertain cleanup acknowledgement adopts its tombstone revision without a false conflict', async () => {
  const h = harness(), { editor, desc, store, records, calls } = h;
  await editor.activateInlineRow(desc.filepath);
  const session = editor._draftSession;
  editor.editorBlocks[0].translation = 'durable temporary edit'; await editor.flushEditorDraft();
  const authored = copy(records.get(session.key)), discard = store.discardTranslationDraft;
  store.discardTranslationDraft = async (...args) => { await discard(...args); throw new Error('cleanup acknowledgement was lost'); };
  editor.editorBlocks[0].translation = 'translation'; assert.equal(await editor.flushEditorDraft(), false);
  const tombstone = copy(records.get(session.key));
  assert.equal(tombstone.state, 'discarded'); assert.equal(tombstone.consumedRevision, authored.revision);
  assert.equal(session.expectedRevision, authored.revision);
  assert.match(editor.inlineDraftError, /cleanup acknowledgement was lost/);
  editor.editorBlocks[0].translation = 'fresh typing after uncertain cleanup';
  assert.equal(await editor.flushEditorDraft(), true);
  assert.equal(calls.discards.length, 1); assert.equal(calls.writes.length, 2);
  assert.equal(calls.writes[1].options.expectedRevision, tombstone.revision);
  assert.equal(records.get(session.key).state, 'active');
  assert.deepEqual(records.get(session.key).translations, ['fresh typing after uncertain cleanup']);
  assert.equal(session.record.translations[0], 'fresh typing after uncertain cleanup');
  assert.equal(!!session.conflict, false); assert.equal(session.pendingRecord, null); assert.equal(session.writeError, null);
  assert.equal(editor.inlineDraftFor(desc.filepath).translations[0], 'fresh typing after uncertain cleanup');
  assert.equal(editor.inlineDraftError, ''); assert.deepEqual(copy(editor.inlineFindingsFor(desc.filepath)), []);
  assert.equal(calls.promotions.length, 0);
});

test('reverting after an uncertain draft-write acknowledgement removes the authored durable revision without replaying it', async () => {
  const h = harness(), { editor, desc, store, records, calls } = h;
  await editor.activateInlineRow(desc.filepath);
  const session = editor._draftSession, put = store.putTranslationDraft;
  store.putTranslationDraft = async (...args) => { await put(...args); throw new Error('draft acknowledgement was lost'); };
  editor.editorBlocks[0].translation = 'durable but unacknowledged edit'; assert.equal(await editor.flushEditorDraft(), false);
  const authored = copy(records.get(session.key));
  assert.equal(session.expectedRevision, null); assert.equal(session.pendingRecord.revision, authored.revision);
  editor.editorBlocks[0].translation = 'translation'; assert.equal(await editor.flushEditorDraft(), true);
  assertNoActiveEditorDraft(h, session);
  assert.equal(calls.writes.length, 1, 'reverting should inspect the uncertain revision instead of replaying a new draft');
  assert.deepEqual(calls.discards, [{ key: session.key, expectedRevision: authored.revision }]);
  assert.equal(await editor.finishInlineSession(), true); assert.equal(calls.promotions.length, 0);
});

test('reverting canonical table, newline and missing-entry display values removes the durable draft', async t => {
  const fixtures = [
    { name: 'partial table', english: ['First@Second'], translations: ['first'] },
    { name: 'empty table separators', english: ['First@Second'], translations: ['@'] },
    { name: 'CRLF text', english: ['Source\\nline'], translations: ['one\r\ntwo'] },
    { name: 'missing entries', english: ['First', 'Second', 'Third'], translations: ['kept first'] },
    { name: 'missing language', english: ['First', 'Second'] },
  ];
  for (const fixture of fixtures) await t.test(fixture.name, async () => {
    const h = harness(), { editor, desc, calls } = h;
    desc.translations.English = fixture.english;
    if (fixture.translations) desc.translations.Thai = fixture.translations;
    else delete desc.translations.Thai;
    editor._workspaceSourceBaseline = copy(editor.descs);
    await editor.activateInlineRow(desc.filepath);
    const session = editor._draftSession, block = editor.editorBlocks.at(-1);
    const field = block.isTable ? block.tableColumns[0] : block, original = field.translation;
    field.translation = 'not yet persisted'; editor.scheduleEditorDraft();
    field.translation = original; editor.scheduleEditorDraft();
    assert.equal(await editor.flushEditorDraft(), true);
    assertNoActiveEditorDraft(h, session);
    assert.equal(calls.writes.length, 0, 'canonical display values must not create a draft when returned before debounce');
    field.translation = 'temporary text'; assert.equal(await editor.flushEditorDraft(), true);
    field.translation = original; assert.equal(await editor.flushEditorDraft(), true);
    assertNoActiveEditorDraft(h, session);
    assert.equal(await editor.finishInlineSession(), true); assert.equal(calls.promotions.length, 0);
    assert.deepEqual(desc.translations.Thai, fixture.translations);
  });
});

test('inline and full editors share one durable draft; closing full editor keeps it without staging', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'local draft';
  await editor.flushEditorDraft(); const session = editor._draftSession;
  assert.equal(await editor.openInlineFullEditor(), true); assert.equal(editor._draftSession, session);
  editor.editorBlocks[0].translation = 'continued in full editor'; await editor.editorExit();
  assert.equal(editor.editorVisible, false); assert.equal(h.calls.promotions.length, 0);
  assert.deepEqual(desc.translations.Thai, ['translation']);
  const restored = harness({ records: h.records }); await restored.editor.loadEditorDrafts(); await restored.editor.activateInlineRow(desc.filepath);
  assert.equal(restored.editor.editorBlocks[0].translation, 'continued in full editor');
  assert.equal(restored.editor.inlineRowBlocks(desc)[0].translation, 'continued in full editor');
});

test('automatic errors remain below the filepath and keep the persisted draft without opening an alert', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'invalid draft';
  editor.editorSaveFindings = () => ({ errors: [{ message: 'Broken tag' }], warnings: [], confirmations: [] });
  assert.equal(await editor.finishInlineSession(), true);
  assert.equal(h.calls.alerts.length, 0); assert.equal(h.calls.promotions.length, 0);
  assert.equal(editor.inlineDraftRows[desc.filepath].translations[0], 'invalid draft');
  assert.equal(editor.inlineFindingsFor(desc.filepath)[0].level, 'error'); assert.equal(editor.inlineActive, false);
});

test('declined automatic warning keeps the draft and does not repeat for unchanged text within the session', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'warning draft';
  editor.editorSaveFindings = () => ({ errors: [], warnings: [{ message: 'Check this wording' }], confirmations: ['Check this wording'] });
  assert.equal(await editor.editorSave({ close: false, automatic: true }), false);
  assert.equal(await editor.editorSave({ close: false, automatic: true }), false);
  assert.equal(h.calls.confirms.length, 1); assert.equal(h.calls.promotions.length, 0);
  assert.equal(editor.inlineDraftRows[desc.filepath].translations[0], 'warning draft');
  assert.equal(await editor.finishInlineSession(), true); assert.equal(h.calls.confirms.length, 1);
});

test('a declined warning is asked again after the draft text changes', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorSaveFindings = () => ({ errors: [], warnings: [{ message: 'Warning' }], confirmations: ['Warning'] });
  editor.editorBlocks[0].translation = 'first draft'; await editor.editorSave({ close: false, automatic: true });
  editor.editorBlocks[0].translation = 'second draft'; await editor.editorSave({ close: false, automatic: true });
  assert.equal(h.calls.confirms.length, 2); assert.equal(h.calls.promotions.length, 0);
});

test('scope changes preserve outgoing drafts under their original profile, language and source', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'outgoing draft';
  editor.lang = 'German'; editor.cloudProfileId = 'other-profile'; editor.sourceIdentity = 'source-b';
  await editor.draftScopeChanged();
  assert.equal(editor.inlineActive, false); assert.equal(editor.editorVisible, false);
  assert.equal(h.calls.writes[0].record.profile, 'guest'); assert.equal(h.calls.writes[0].record.language, 'Thai');
  assert.equal(h.calls.writes[0].record.sourceHash, 'source-a'); assert.equal(h.calls.writes[0].record.translations[0], 'outgoing draft');
  assert.deepEqual(Object.keys(editor.inlineDraftRows), []); assert.equal(h.calls.promotions.length, 0);
});

test('stale warning approval cannot promote a draft into a different language or profile', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'guarded draft';
  editor.editorSaveFindings = () => ({ errors: [], warnings: [{ message: 'Warning' }], confirmations: ['Warning'] });
  const prompt = deferred(); editor.appConfirm = () => prompt.promise;
  const saving = editor.editorSave({ close: false, automatic: true }); await tick();
  editor.lang = 'German'; editor.cloudUser = { id: 'other', role: 'translator' }; prompt.resolve(true);
  assert.equal(await saving, false); assert.equal(h.calls.promotions.length, 0);
  assert.equal([...h.records.values()][0].language, 'Thai');
});

test('resuming a draft retains its original merge base after background committed data changes', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'my pending text'; await editor.flushEditorDraft();
  await editor.finishInlineSession({ promote: false });
  desc.translations.Thai = ['new remote text']; await editor.activateInlineRow(desc.filepath);
  assert.equal(editor.editorBlocks[0].translation, 'my pending text');
  assert.deepEqual(copy(editor._draftSession.base.translations), ['translation']);
  assert.deepEqual(copy(editor._editorCollabBase.translations), ['translation']);
  assert.deepEqual(desc.translations.Thai, ['new remote text']);
});

test('failed local draft persistence keeps editing open and leaves committed data alone', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'must not lose';
  h.store.putTranslationDraft = async () => { throw new Error('Quota exceeded'); };
  assert.equal(await editor.finishInlineSession(), false);
  assert.equal(editor.inlineActive, true); assert.match(editor.inlineDraftError, /Quota exceeded/);
  assert.equal(editor.inlineDraftRows[desc.filepath].translations[0], 'must not lose');
  assert.deepEqual(desc.translations.Thai, ['translation']); assert.equal(h.calls.promotions.length, 0);
});

test('focus within the active row, sidebar or confirmation belongs to the same session', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  const target = kind => ({ closest(selector) {
    if (selector === 'tr[data-filepath]') return kind === 'same' ? { dataset: { filepath: desc.filepath } } : kind === 'other' ? { dataset: { filepath: 'elsewhere' } } : null;
    return kind === 'side' || kind === 'dialog' ? {} : null;
  } });
  for (const kind of ['same', 'side', 'dialog']) assert.equal(editor.inlineFocusContains(target(kind)), true);
  assert.equal(editor.inlineFocusContains(target('other')), false);
});

test('clicking nonfocusable sidebar content focuses its surface and retains inline editing', async () => {
  const h = harness(), { editor, desc, document } = h;
  h.window.InlineEditor.mixin.mounted.call(editor); await tick(); await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'keep editing while using the sidebar';
  document.body = { closest: () => null }; document.activeElement = document.body;
  let focused = 0;
  const surface = { closest: selector => selector.includes('data-inline-focus-surface') ? surface : null,
    focus(options) { focused++; assert.equal(options.preventScroll, true); document.activeElement = surface; } };
  const background = { closest: selector => selector.includes('[tabindex]') ? surface : null };
  editor.inlineFocusSurfacePointerDown({ button: 0, target: background, currentTarget: surface });
  editor.inlineRowFocusOut({ relatedTarget: null });
  editor._inlineFocusIn({ target: surface });
  await settleFocus();
  assert.equal(editor.inlineActive, true); assert.equal(h.calls.promotions.length, 0);
  assert.equal(editor.editorBlocks[0].translation, 'keep editing while using the sidebar');
  assert.equal(focused, 1);
  const control = { closest: () => control };
  editor.inlineFocusSurfacePointerDown({ button: 0, target: control, currentTarget: surface });
  assert.equal(focused, 1, 'Inputs and buttons must retain their native focus behavior.');
  const disabled = { closest: () => disabled, matches: selector => selector === ':disabled' };
  editor.inlineFocusSurfacePointerDown({ button: 0, target: disabled, currentTarget: surface });
  assert.equal(focused, 2, 'A disabled sidebar control still belongs to the current file.');
  document.activeElement = document.body;
  editor.inlineRowFocusOut({ relatedTarget: null }); await settleFocus();
  assert.equal(editor.inlineActive, false); assert.equal(h.calls.promotions.length, 1);
  assert.equal(desc.translations.Thai[0], 'keep editing while using the sidebar');
});

test('sidebar background retention does not suppress an outside focus or another file selection', async () => {
  const h = harness(), { editor, desc, document } = h;
  h.window.InlineEditor.mixin.mounted.call(editor); await tick(); await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'stage when leaving';
  document.body = { closest: () => null }; document.activeElement = document.body;
  const surface = { closest: selector => selector.includes('data-inline-focus-surface') ? surface : null,
    focus() { document.activeElement = surface; } };
  editor.inlineFocusSurfacePointerDown({ button: 0, target: { closest: () => null }, currentTarget: surface });
  editor.inlineRowFocusOut({ relatedTarget: null });
  const outside = { closest: () => null }; document.activeElement = outside;
  editor._inlineFocusIn({ target: outside }); await settleFocus();
  assert.equal(editor.inlineActive, false); assert.equal(h.calls.promotions.length, 1);
  await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'stage before switching rows';
  await editor.inlineRowClick({ target: { closest: () => null } }, editor.descs[1].filepath);
  assert.equal(editor.editorCurrentEditingDesc.filepath, editor.descs[1].filepath);
  assert.equal(editor.inlineActive, true); assert.equal(h.calls.promotions.length, 2);
});

test('workspace chrome measurements follow header/footer resize and workspace recreation', () => {
  const h = harness(), { editor, context, document } = h;
  let observed = [], disconnected = 0, observer;
  context.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(target) { observed.push(target); }
    disconnect() { disconnected++; observed = []; }
  };
  let headerHeight = 61.2, footerHeight = 47.1;
  const header = { getBoundingClientRect: () => ({ height: headerHeight }) };
  const footer = { getBoundingClientRect: () => ({ height: footerHeight }) };
  const block = {};
  const workspace = () => { const values = new Map(); return { values, style: {
    getPropertyValue: name => values.get(name), setProperty: (name, value) => values.set(name, value),
  } }; };
  let currentWorkspace = workspace();
  document.querySelector = selector => selector === '.workspace' ? currentWorkspace : selector === '.workspaceHeader' ? header : selector === '.workspaceFooter' ? footer : null;
  document.querySelectorAll = () => [block, header, footer];
  editor.observeInlineBlocks();
  assert.equal(currentWorkspace.values.get('--workspace-header-height'), '62px');
  assert.equal(currentWorkspace.values.get('--workspace-footer-height'), '48px');
  assert.deepEqual(observed, [block, header, footer]);
  headerHeight = 90; footerHeight = 66; observer.callback();
  assert.equal(currentWorkspace.values.get('--workspace-header-height'), '90px');
  assert.equal(currentWorkspace.values.get('--workspace-footer-height'), '66px');
  currentWorkspace = workspace(); editor.observeInlineBlocks();
  assert.equal(currentWorkspace.values.get('--workspace-header-height'), '90px');
  assert.equal(currentWorkspace.values.get('--workspace-footer-height'), '66px');
  assert.equal(disconnected, 2); assert.deepEqual(observed, [block, header, footer]);
});

test('a clean automatic promotion submits the durable draft identity and consumes only after save', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'ready translation';
  assert.equal(await editor.finishInlineSession(), true);
  assert.equal(h.calls.promotions.length, 1); assert.equal(h.calls.confirms.length, 0);
  const submitted = h.calls.promotions[0];
  assert.equal(submitted.options.awaitDurable, true); assert.equal(submitted.options.inline, true);
  assert.equal(submitted.options.draft.id, h.calls.writes[0].record.id);
  assert.equal(submitted.options.draft.revision, h.calls.writes[0].record.revision);
  assert.deepEqual(copy(submitted.options.draft.base.translations), ['translation']);
  assert.deepEqual(copy(desc.translations.Thai), ['ready translation']);
  assert.equal(editor.inlineDraftRows[desc.filepath], undefined);
});

test('opening unchanged display-only placeholders does not create intentional blank saves', async () => {
  const h = harness(), { editor, desc } = h;
  desc.translations.Thai = []; editor._workspaceSourceBaseline = copy(editor.descs);
  await editor.activateInlineRow(desc.filepath); assert.equal(editor.editorBlocks[0].translation, '');
  await editor.finishInlineSession();
  assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.promotions.length, 0);
});

test('Dropped files keep inline edits local and request full-editor review', async () => {
  const h = harness(), { editor, desc, window } = h;
  const old = copy(desc); old.translations.English = ['Older English']; old.translations.Thai = ['Preserved translation'];
  window.WorkspaceState.dropTranslation(editor.localDescs, old, 'Thai', {
    game: 'poe1', originSourceHash: 'old-source', targetSourceHash: 'source-a',
  });
  await editor.activateInlineRow(desc.filepath); editor.editorBlocks[0].translation = 'draft correction';
  await editor.finishInlineSession();
  assert.equal(h.calls.promotions.length, 0); assert.equal(h.calls.writes.length, 1);
  assert.match(editor.inlineFindingsFor(desc.filepath)[0].message, /full editor/);
  assert.ok(window.WorkspaceState.droppedForFile(editor.localDescs, desc.filepath, 'Thai'));
});

test('a failed draft read ends loading and presents a recoverable editor error', async () => {
  const h = harness(); h.store.getTranslationDraft = async () => { throw new Error('Storage unavailable'); };
  assert.equal(await h.editor.activateInlineRow(h.desc.filepath), false);
  assert.equal(h.editor.editorLoading, false); assert.match(h.editor.editorLoadError, /Storage unavailable/);
  assert.equal(h.calls.promotions.length, 0);
});

test('late stored draft reads cannot hydrate an editor after its scope changes', async () => {
  const h = harness(), pending = deferred(); h.store.getTranslationDraft = () => pending.promise;
  const opening = h.editor.activateInlineRow(h.desc.filepath); await tick();
  h.editor.lang = 'German'; await h.editor.detachEditorSessionForScopeChange(); pending.resolve(null);
  assert.equal(await opening, false); assert.equal(h.editor.editorVisible, false); assert.equal(h.editor.inlineActive, false);
  assert.equal(h.editor._draftSession, null);
});

test('typing already persisted during an older save rebases the durable draft for the next local save', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'submitted text'; await editor.flushEditorDraft();
  const session = editor._draftSession;
  editor.editorBlocks[0].translation = 'typing continues'; await editor.flushEditorDraft();
  desc.translations.Thai = ['submitted text'];
  await editor.editorDraftCommitted(session, ['submitted text'], { draftConsumed: false });
  const stored = h.records.get(session.key);
  assert.equal(stored.translations[0], 'typing continues');
  assert.deepEqual(copy(stored.base.translations), ['submitted text']);
  assert.equal(editor.editorBlocks[0].translation, 'typing continues');
});

for (const change of [
  { name: 'source', apply(editor) { editor.sourceIdentity = 'source-b'; } },
  { name: 'account', apply(editor) { editor.cloudProfileId = 'account-b'; editor.cloudUser = { id: 'account-b' }; } },
  { name: 'language', apply(editor) { editor.lang = 'German'; } },
]) {
  test(`pending inline finish preserves its old draft and cannot close the next ${change.name} session`, async () => {
    const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
    editor.editorBlocks[0].translation = 'outgoing unsaved text';
    const gate = deferred(), put = h.store.putTranslationDraft;
    h.store.putTranslationDraft = async (...args) => { await gate.promise; return put(...args); };
    const finishing = editor.finishInlineSession(); await tick();
    change.apply(editor);
    const switching = editor.draftScopeChanged();
    assert.equal(editor._draftSession, null);
    await editor.editFile(editor.descs[1].filepath);
    const nextSession = editor._draftSession;
    assert.ok(nextSession); assert.equal(editor.editorVisible, true);
    gate.resolve(); assert.equal(await finishing, false); await switching;
    assert.equal(editor._draftSession, nextSession); assert.equal(editor.editorVisible, true);
    assert.equal(h.calls.promotions.length, 0);
    const preserved = [...h.records.values()].find(record => record.filepath === desc.filepath);
    assert.equal(preserved.profile, 'guest'); assert.equal(preserved.sourceHash, 'source-a'); assert.equal(preserved.language, 'Thai');
    assert.equal(preserved.translations[0], 'outgoing unsaved text');
  });
}

test('scope changes do not display another language draft diagnostics under matching filepaths', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'bad Thai draft';
  editor.editorSaveFindings = () => ({ errors: [{ message: 'Thai error' }], warnings: [], confirmations: [] });
  await editor.finishInlineSession(); assert.equal(editor.inlineFindingsFor(desc.filepath).length, 1);
  editor.lang = 'German'; await editor.draftScopeChanged();
  assert.equal(editor.inlineDraftRows[desc.filepath], undefined);
  assert.equal(editor.inlineFindingsFor(desc.filepath).length, 0);
});

test('a late outgoing-scope draft conflict cannot add findings to the newly selected language', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'outgoing draft';
  const gate = deferred();
  h.store.putTranslationDraft = async record => {
    await gate.promise;
    return { status: 'conflict', record: { ...record, revision: 'other-tab-revision', translations: ['other tab'], conflicts: [record] } };
  };
  const writing = editor.flushEditorDraft(); await tick();
  editor.lang = 'German'; const switching = editor.draftScopeChanged(); gate.resolve();
  await writing; await switching;
  assert.equal(editor.inlineFindingsFor(desc.filepath).length, 0);
  assert.equal(editor.inlineDraftRows[desc.filepath], undefined);
});

test('failed new draft survives scope detachment and reopening when no durable draft exists', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  const put = h.store.putTranslationDraft;
  h.store.putTranslationDraft = async () => { throw new Error('Quota exhausted'); };
  editor.editorBlocks[0].translation = 'only recoverable copy';
  assert.equal(await editor.flushEditorDraft(), false);
  const retained = editor._draftSession, pendingId = retained.pendingRecord.id;
  editor.sourceIdentity = 'source-b'; await editor.draftScopeChanged();
  editor.sourceIdentity = 'source-a'; await editor.draftScopeChanged();
  assert.equal(editor.inlineDraftRows[desc.filepath].translations[0], 'only recoverable copy');
  assert.equal(await editor.activateInlineRow(desc.filepath), true);
  assert.equal(editor._draftSession, retained); assert.equal(retained.detached, false);
  assert.equal(editor.editorBlocks[0].translation, 'only recoverable copy');
  assert.equal(retained.expectedRevision, null); assert.equal(retained.pendingRecord.id, pendingId);
  h.store.putTranslationDraft = put;
  assert.equal(await editor.flushEditorDraft(), true);
  assert.equal(h.records.get(retained.key).translations[0], 'only recoverable copy');
});

test('reopening retained failed text preserves its original expected revision even if storage changed elsewhere', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'durable older draft'; await editor.flushEditorDraft();
  const durable = copy(editor._draftSession.record);
  h.store.putTranslationDraft = async () => { throw new Error('Write failed'); };
  editor.editorBlocks[0].translation = 'newer failed draft'; await editor.flushEditorDraft();
  const retained = editor._draftSession;
  await editor.detachEditorSessionForScopeChange();
  h.records.set(durable.key, { ...durable, revision: 'another-tab', translations: ['another tab saved'] });
  await editor.activateInlineRow(desc.filepath);
  assert.equal(editor._draftSession, retained); assert.equal(editor.editorBlocks[0].translation, 'newer failed draft');
  assert.equal(retained.expectedRevision, durable.revision);
  assert.deepEqual(copy(retained.base.translations), ['translation']);
  assert.deepEqual(copy(retained.source.translations.English), ['Source']);
});

test('failed draft listing still publishes retained pending recovery rows in their own scope', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  h.store.putTranslationDraft = async () => { throw new Error('Write unavailable'); };
  editor.editorBlocks[0].translation = 'retained pending copy'; await editor.flushEditorDraft();
  await editor.detachEditorSessionForScopeChange(); editor.inlineDraftRows = {}; editor.draftRecords = [];
  h.store.listTranslationDrafts = async () => { throw new Error('Read unavailable'); };
  await editor.loadEditorDrafts();
  assert.equal(editor.inlineDraftRows[desc.filepath].translations[0], 'retained pending copy');
  assert.equal(editor.draftRecoveryItems[0].translations[0], 'retained pending copy');
  editor.lang = 'German'; await editor.loadEditorDrafts();
  assert.equal(editor.inlineDraftRows[desc.filepath], undefined); assert.equal(editor.draftRecoveryItems.length, 0);
});

test('reopening an in-flight detached session preserves write ordering for further typing', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  const gate = deferred(), put = h.store.putTranslationDraft;
  h.store.putTranslationDraft = async (...args) => { await gate.promise; return put(...args); };
  editor.editorBlocks[0].translation = 'first pending text'; const writing = editor.flushEditorDraft(); await tick();
  const retained = editor._draftSession, detached = editor.detachEditorSessionForScopeChange();
  assert.equal(await editor.activateInlineRow(desc.filepath), true);
  assert.equal(editor._draftSession, retained); assert.equal(editor.editorBlocks[0].translation, 'first pending text');
  editor.editorBlocks[0].translation = 'typed after reopen'; const nextWrite = editor.flushEditorDraft();
  gate.resolve(); await writing; await detached; assert.equal(await nextWrite, true);
  assert.equal(h.calls.writes.length, 2); assert.equal(h.calls.writes[1].options.expectedRevision, h.calls.writes[0].record.revision);
  assert.equal(h.records.get(retained.key).translations[0], 'typed after reopen');
});

test('closed durable sessions reread current storage instead of reviving discarded text', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'later discarded'; await editor.flushEditorDraft();
  const record = copy(editor._draftSession.record); await editor.finishInlineSession({ promote: false });
  h.records.set(record.key, { ...record, state: 'discarded', revision: record.revision + ':discarded', translations: [] });
  await editor.activateInlineRow(desc.filepath);
  assert.equal(editor.editorBlocks[0].translation, 'translation');
  assert.equal(editor._draftSession.record, null); assert.equal(editor._draftSession.expectedRevision, record.revision + ':discarded');
});

test('beforeunload still protects detached failed drafts after the active error display is cleared', async () => {
  const h = harness(), { editor, desc } = h; h.window.InlineEditor.mixin.mounted.call(editor); await tick();
  await editor.activateInlineRow(desc.filepath);
  h.store.putTranslationDraft = async () => { throw new Error('Quota exhausted'); };
  editor.editorBlocks[0].translation = 'still only in memory'; await editor.flushEditorDraft();
  await editor.detachEditorSessionForScopeChange(); editor.inlineDraftError = '';
  let prevented = false; editor._draftBeforeUnload({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('declined warning is retained across closing and reopening the same draft session', async () => {
  const h = harness(), { editor, desc } = h;
  editor.editorSaveFindings = () => ({ errors: [], warnings: [{ message: 'Review warning' }], confirmations: ['Review warning'] });
  await editor.activateInlineRow(desc.filepath); editor.editorBlocks[0].translation = 'warning draft';
  await editor.finishInlineSession(); assert.equal(h.calls.confirms.length, 1);
  await editor.activateInlineRow(desc.filepath); await editor.finishInlineSession();
  assert.equal(h.calls.confirms.length, 1); assert.equal(h.calls.promotions.length, 0);
});

test('explicit Save and next promotes before navigating, while ordinary navigation only keeps a draft', async () => {
  const h = harness(), { editor, desc } = h; await editor.editFile(desc.filepath);
  editor.editorBlocks[0].translation = 'save this before next';
  assert.equal(await editor.saveAndSkipFile(), true);
  assert.equal(h.calls.promotions.length, 1); assert.equal(editor.editorCurrentEditingDesc.filepath, editor.descs[1].filepath);
  assert.deepEqual(copy(desc.translations.Thai), ['save this before next']);
  editor.editorBlocks[0].translation = 'keep this as draft';
  assert.equal(await editor.editFile(desc.filepath), true);
  assert.equal(h.calls.promotions.length, 1);
  assert.equal(editor.inlineDraftRows[editor.descs[1].filepath].translations[0], 'keep this as draft');
  assert.deepEqual(copy(editor.descs[1].translations.Thai), ['translation']);
});

test('conflict retries keep the authored variant and never replace another tab primary draft', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  const session = editor._draftSession;
  const primary = { ...session.scope, key: session.key, id: 'tab-a', revision: 'a1', state: 'active',
    translations: ['draft A'], base: copy(session.base), source: copy(session.source), updatedAt: 1, conflicts: [] };
  h.records.set(primary.key, copy(primary));
  h.store.putTranslationDraft = async (record, options) => {
    h.calls.writes.push({ record: copy(record), options: copy(options) });
    const current = h.records.get(primary.key);
    const aggregate = { ...current, revision: record.revision + ':conflict', conflicts: [...current.conflicts, copy(record)] };
    h.records.set(primary.key, aggregate);
    return { status: 'conflict', record: copy(aggregate), preserved: copy(record) };
  };
  editor.editorBlocks[0].translation = 'draft B'; assert.equal(await editor.flushEditorDraft(), true);
  assert.equal(session.record.translations[0], 'draft B'); assert.equal(session.conflict, true);
  assert.equal(editor.editorBlocks[0].translation, 'draft B');
  assert.equal(await editor.editorSave({ close: false }), false);
  assert.equal(await editor.editorSave({ close: false }), false);
  assert.equal(h.calls.writes.length, 1, 'Repeated Stage must not mint identical conflicting variants.');
  assert.equal(h.calls.promotions.length, 0);
  editor.editorBlocks[0].translation = 'draft B continued'; await editor.flushEditorDraft();
  assert.equal(h.calls.writes.length, 2);
  assert.equal(await editor.editFile(editor.descs[1].filepath), true);
  assert.equal(h.calls.writes.length, 2, 'Navigation preserves the same authored variant without a duplicate write.');
  const stored = h.records.get(primary.key);
  assert.equal(stored.translations[0], 'draft A');
  assert.deepEqual(stored.conflicts.map(record => record.translations[0]), ['draft B', 'draft B continued']);
  await editor.openDraftRecovery();
  assert.deepEqual(copy(editor.draftRecoveryItems.map(record => record.translations[0])), ['draft A', 'draft B', 'draft B continued']);
});

test('recovery compares committed text with the preserved draft and cancel keeps the existing draft unchanged', async () => {
  const h = harness(), { editor, desc } = h;
  await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'already editing this'; await editor.flushEditorDraft();
  const stored = copy(h.records.get(editor._draftSession.key)), writes = h.calls.writes.length;
  editor.renderInlineDiffHtml = (oldText, newText) => JSON.stringify([oldText, newText]);
  editor.draftRecoverySelected = { ...stored, translations: ['preserved choice'] };
  await editor.recoverSelectedDraft();
  assert.equal(editor.editorCompareActive, true); assert.equal(editor.editorVisible, true);
  assert.equal(editor.editorBlocks[0].translationDiffHtml, JSON.stringify(['translation', 'preserved choice']));
  assert.equal(editor.draftRecoveryCandidate.originalBlocks[0].translation, 'already editing this');
  await editor.flushEditorDraft(); assert.equal(h.calls.writes.length, writes, 'Preview content must never be autosaved.');
  editor.exitEditorCompareMode(); await tick(); await editor.flushEditorDraft();
  assert.equal(editor.editorCompareActive, false); assert.equal(editor.draftRecoveryCandidate, null);
  assert.equal(editor.editorBlocks[0].translation, 'already editing this');
  assert.deepEqual(h.records.get(stored.key), stored); assert.equal(h.calls.writes.length, writes);
  assert.equal(h.calls.promotions.length, 0);
});

test('recovery includes unmatched source and translation blocks and preserves source/table comparisons', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  const scope = editor.editorDraftScope(desc.filepath);
  editor.renderInlineDiffHtml = (oldText, newText) => JSON.stringify([oldText, newText]);
  editor.draftRecoverySelected = { ...scope, sourceHash: 'older-source', translations: ['preserved@extra column', 'unmatched translation'],
    source: { translations: { English: ['Older@source column', 'Old second block', 'Old third block'] } } };
  await editor.recoverSelectedDraft();
  assert.equal(editor.editorBlocks.length, 3); assert.equal(editor.editorShowEnglishDiff, true);
  assert.equal(editor.editorBlocks[0].translationDiffHtml, JSON.stringify(['translation', 'preserved@extra column']));
  assert.equal(editor.editorBlocks[0].englishDiffHtml, JSON.stringify(['Older@source column', 'Source']));
  assert.equal(editor.editorBlocks[0].translationCompareColumns.length, 2);
  assert.equal(editor.editorBlocks[0].translationCompareColumns[1].translationDiffHtml, JSON.stringify(['', 'extra column']));
  assert.equal(editor.editorBlocks[1].translationDiffHtml, JSON.stringify(['', 'unmatched translation']));
  assert.equal(editor.editorBlocks[2].englishDiffHtml, JSON.stringify(['Old third block', '']));
  assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.promotions.length, 0);
  editor.exitEditorCompareMode(); await tick();
  assert.equal(editor.editorBlocks.length, 1); assert.equal(editor.editorBlocks[0].translation, 'translation');
});

test('recovery rejects a committed base changed during review and leaves current draft plus comparison intact', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'existing local draft'; await editor.flushEditorDraft();
  const stored = copy(h.records.get(editor._draftSession.key));
  editor.draftRecoverySelected = { ...stored, translations: ['selected recovery'] };
  await editor.recoverSelectedDraft(); const candidate = editor.draftRecoveryCandidate;
  editor.localDescs.staged.Thai = { [desc.filepath]: { translations: ['peer changed committed'], sourceHash: editor.sourceIdentity } };
  await editor.applyRecoveredDraft();
  assert.equal(editor.editorCompareActive, true); assert.equal(editor.draftRecoveryCandidate, candidate);
  assert.match(editor.collaborationNotice, /committed translation changed/);
  assert.deepEqual(h.records.get(stored.key), stored); assert.equal(h.calls.promotions.length, 0);
  editor.exitEditorCompareMode(); await tick();
  assert.equal(editor.editorBlocks[0].translation, 'existing local draft');
});

test('recovery application is guarded by draft revision, source, account, language and editor session', async () => {
  const changes = [editor => { editor._draftSession.expectedRevision = 'another draft revision'; },
    editor => { editor.sourceIdentity = 'other-source'; }, editor => { editor.cloudProfileId = 'other-account'; },
    editor => { editor.lang = 'German'; }, editor => { editor._editorOpenRun++; }];
  for (const change of changes) {
    const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
    editor.editorBlocks[0].translation = 'original local draft'; await editor.flushEditorDraft();
    const stored = copy(h.records.get(editor._draftSession.key));
    editor.draftRecoverySelected = { ...stored, translations: ['selected recovery'] }; await editor.recoverSelectedDraft();
    const candidate = editor.draftRecoveryCandidate; change(editor);
    await editor.applyRecoveredDraft();
    assert.equal(editor.draftRecoveryCandidate, candidate); assert.equal(editor.editorCompareActive, true);
    assert.deepEqual(h.records.get(stored.key), stored); assert.equal(h.calls.writes.length, 1); assert.equal(h.calls.promotions.length, 0);
  }
});

test('reviewed recovery creates a new local draft against the reviewed current base without staging or retargeting the old source copy', async () => {
  const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
  editor.editorBlocks[0].translation = 'existing local draft'; await editor.flushEditorDraft();
  const currentKey = editor._draftSession.key, priorRevision = editor._draftSession.expectedRevision;
  editor.localDescs.staged.Thai = { [desc.filepath]: { translations: ['current committed'], sourceHash: editor.sourceIdentity } };
  const old = { ...copy(h.records.get(currentKey)), sourceHash: 'older-source', id: 'old-source-draft', revision: 'old-source-revision',
    translations: ['recovered draft', 'unmatched block'], source: { translations: { English: ['Old source', 'Second old source'] } } };
  old.key = editor.editorDraftKey(old); h.records.set(old.key, copy(old));
  editor.draftRecoverySelected = old; await editor.recoverSelectedDraft(); await editor.applyRecoveredDraft();
  assert.equal(editor.editorCompareActive, false); assert.equal(editor.draftRecoveryCandidate, null);
  assert.deepEqual(copy(editor.serializeEditorTranslations()), ['recovered draft', 'unmatched block']);
  const recovered = h.records.get(currentKey);
  assert.deepEqual(recovered.translations, ['recovered draft', 'unmatched block']);
  assert.deepEqual(recovered.base.translations, ['current committed']);
  assert.equal(recovered.sourceHash, 'source-a'); assert.notEqual(recovered.revision, priorRevision);
  assert.equal(h.calls.writes.at(-1).options.resolveConflicts, true);
  assert.deepEqual(h.records.get(old.key), old); assert.equal(h.calls.promotions.length, 0);
  assert.deepEqual(copy(editor.localDescs.staged.Thai[desc.filepath].translations), ['current committed']);
});

test('Settings and Local drafts wait for an in-flight blur warning decision before opening and retain declined drafts', async () => {
  for (const dialog of ['settings', 'recovery']) {
    const h = harness(), { editor, desc } = h; await editor.activateInlineRow(desc.filepath);
    editor.editorBlocks[0].translation = 'keep this warning draft';
    editor.editorSaveFindings = () => ({ errors: [], warnings: [{ message: 'Review wording' }], confirmations: ['Review wording'] });
    const confirmation = deferred(); let prompts = 0, recoveryOpened = 0;
    editor.appConfirm = () => { prompts++; return confirmation.promise; };
    editor.$refs.draftRecoveryDialog = { showModal() { recoveryOpened++; } };
    const leaving = editor.finishInlineSession(); await tick();
    assert.equal(prompts, 1); assert.equal(editor.inlineActive, true);
    const opening = dialog === 'settings' ? editor.openSettings('general', 'settingsLanguage') : editor.openDraftRecovery();
    await tick();
    assert.equal(!!editor.showSetting, false); assert.equal(editor.draftRecoveryVisible, false); assert.equal(recoveryOpened, 0);
    assert.equal(prompts, 1, 'Opening the second dialog must reuse the pending blur decision.');
    confirmation.resolve(false); assert.equal(await leaving, true); await opening; await tick();
    assert.equal(editor.inlineActive, false); assert.equal(h.calls.promotions.length, 0);
    assert.equal(editor.inlineDraftRows[desc.filepath].translations[0], 'keep this warning draft');
    assert.equal([...h.records.values()][0].state, 'active');
    if (dialog === 'settings') {
      assert.equal(editor.showSetting, true); assert.equal(editor._settingsFocusControl, 'settingsLanguage');
    } else {
      assert.equal(editor.draftRecoveryVisible, true); assert.equal(recoveryOpened, 1);
      assert.equal(editor.draftRecoveryItems[0].translations[0], 'keep this warning draft');
    }
  }
});

function inlineArrowEvent(filepath, changes = {}) {
  return { key: 'ArrowDown', ctrlKey: true,
    target: { tagName: 'INPUT', closest: selector => selector === 'tr[data-filepath]' ? { dataset: { filepath } } : null },
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...changes };
}

async function inlineNavigationHarness({ current = 'first', table = false } = {}) {
  const h = harness(), { editor, calls } = h;
  h.rows = [description('first'), description('second'), description('third')];
  if (table) {
    h.rows[1].translations.English = ['Source@Second source'];
    h.rows[1].translations.Thai = ['Translation@Second translation'];
  }
  editor.descs = [h.rows[2], h.rows[0], h.rows[1]];
  editor.filteredDescs = editor.descs;
  editor._workspaceSourceBaseline = copy(editor.descs);
  editor.currentSort = 'filename'; editor.currentSortDir = 'asc'; editor.pageSize = 1;
  editor.currentPage = h.rows.findIndex(row => row.filename === current + '.txt') + 1;
  calls.translationFocus = []; calls.reveals = [];
  editor.getEditorRef = (...args) => ({ focus(options) { calls.translationFocus.push({ args, options }); } });
  editor.focusSelectedFileRow = moveFocus => { calls.reveals.push({ moveFocus, filepath: editor.selectedFilepath }); };
  assert.equal(await editor.activateInlineRow(h.rows.find(row => row.filename === current + '.txt').filepath), true);
  return h;
}

test('Ctrl+Up and Ctrl+Down from inline translation text consume the shortcut before autocomplete handling', async () => {
  const { editor, desc } = harness(); await editor.activateInlineRow(desc.filepath);
  const directions = []; editor.moveInlineFile = async direction => { directions.push(direction); return true; };
  editor.hlPopup.visible = true; editor.hlPopup.filter = 'keep';
  for (const [key, direction] of [['ArrowUp', -1], ['ArrowDown', 1]]) {
    const event = inlineArrowEvent(desc.filepath, { key });
    editor.translationKeydown(event, 0);
    assert.equal(event.defaultPrevented, true); assert.equal(event.propagationStopped, true);
    assert.equal(directions.at(-1), direction);
    assert.equal(editor.hlPopup.filter, 'keep');
  }
  assert.deepEqual(directions, [-1, 1]);
});

test('inline row shortcuts leave ordinary arrows, IME, other modifiers, popup filters and full-editor text alone', async () => {
  const { editor, desc } = harness(); await editor.activateInlineRow(desc.filepath);
  editor.moveInlineFile = () => assert.fail('A native or unrelated key must not navigate files');
  for (const changes of [{ ctrlKey: false }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    { isComposing: true }, { keyCode: 229 }, { key: 'ArrowLeft' },
    { target: { tagName: 'INPUT', closest: () => null } },
    { target: { tagName: 'INPUT', closest: () => ({ dataset: { filepath: 'test/other.txt' } }) } }]) {
    const event = inlineArrowEvent(desc.filepath, changes);
    assert.equal(editor.inlineTranslationKeydown(event), false);
    assert.equal(!!event.defaultPrevented, false); assert.equal(!!event.propagationStopped, false);
  }
  const prevented = inlineArrowEvent(desc.filepath, { defaultPrevented: true });
  assert.equal(editor.inlineTranslationKeydown(prevented), false); assert.equal(!!prevented.propagationStopped, false);
  editor.inlineActive = false; editor.editorVisible = true;
  const full = inlineArrowEvent(desc.filepath); editor.translationKeydown(full, 0);
  assert.equal(!!full.defaultPrevented, false); assert.equal(!!full.propagationStopped, false);
});

test('inline Ctrl+Arrow navigation follows sorted rows across pages and focuses the first translation', async () => {
  const { editor, rows, calls } = await inlineNavigationHarness();
  assert.equal(await editor.moveInlineFile(1), true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[1].filepath);
  assert.equal(editor.inlineActive, true); assert.equal(editor.editorVisible, false);
  assert.equal(editor.currentPage, 2); assert.equal(editor.selectedFilepath, rows[1].filepath);
  assert.deepEqual(calls.translationFocus.at(-1).args, ['translation', 0, null]);
  assert.equal(calls.reveals.at(-1).moveFocus, false);
  assert.equal(calls.reveals.at(-1).filepath, rows[1].filepath);
  assert.equal(await editor.moveInlineFile(-1), true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[0].filepath); assert.equal(editor.currentPage, 1);
  editor.currentSortDir = 'desc';
  assert.equal(await editor.moveInlineFile(-1), true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[1].filepath); assert.equal(editor.currentPage, 2);
});

test('inline keyboard navigation focuses column zero for table entries', async () => {
  const { editor, calls } = await inlineNavigationHarness({ table: true });
  assert.equal(await editor.moveInlineFile(1), true);
  assert.equal(editor.editorBlocks[0].isTable, true);
  assert.deepEqual(calls.translationFocus.at(-1).args, ['translation', 0, 0]);
});

test('inline keyboard navigation stops at both bounds without staging the current draft or wrapping', async () => {
  for (const [current, direction] of [['first', -1], ['third', 1]]) {
    const { editor, calls } = await inlineNavigationHarness({ current });
    editor.editorBlocks[0].translation = 'retain draft at list boundary';
    const desc = editor.editorCurrentEditingDesc, session = editor._draftSession;
    assert.equal(await editor.moveInlineFile(direction), false);
    assert.equal(editor.editorCurrentEditingDesc, desc); assert.equal(editor._draftSession, session);
    assert.equal(editor.inlineActive, true); assert.equal(calls.promotions.length, 0);
    assert.equal(calls.translationFocus.length, 0);
  }
});

test('a filtered-out active row keeps its sorted anchor when navigating in either direction', async () => {
  for (const direction of [-1, 1]) {
    const { editor, rows } = await inlineNavigationHarness({ current: 'second' });
    editor.filteredDescs = [rows[2], rows[0]];
    editor.filterDesc = () => { editor.filteredDescs = [rows[2], rows[0]]; };
    assert.equal(await editor.moveInlineFile(direction), true);
    assert.equal(editor.editorCurrentEditingDesc.filepath, rows[direction < 0 ? 0 : 2].filepath);
  }
});

test('navigation snapshots the outgoing anchor before draft promotion removes it from the filter', async () => {
  const { editor, rows, calls } = await inlineNavigationHarness();
  editor.editorBlocks[0].translation = 'newly saved translation';
  editor.filterDesc = () => { editor.filteredDescs = editor.descs.filter(row => row.translations.Thai[0] !== 'newly saved translation'); };
  assert.equal(await editor.moveInlineFile(1), true);
  assert.equal(calls.promotions.length, 1); assert.equal(rows[0].translations.Thai[0], 'newly saved translation');
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[1].filepath);
  assert.equal(editor.currentPage, 1, 'The remaining first result moves onto the first page');
});

test('inline keyboard navigation skips occupied files and requests claims without interrupting prompts', async () => {
  const { editor, rows } = await inlineNavigationHarness();
  const claims = [];
  editor._collaboration = { leaveEdit() {}, fileBase() { return null; }, isEditing(filepath) { return filepath === rows[1].filepath; } };
  editor.claimCollaborationFile = async (filepath, automatic) => { claims.push({ filepath, automatic }); return true; };
  assert.equal(await editor.moveInlineFile(1), true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[2].filepath);
  assert.deepEqual(claims, [{ filepath: rows[2].filepath, automatic: true }]);
});

test('automatic claim rejection advances to the next available inline row', async () => {
  const { editor, rows } = await inlineNavigationHarness();
  const claims = [];
  editor._collaboration = { leaveEdit() {}, fileBase() { return null; }, isEditing() { return false; } };
  editor.claimCollaborationFile = async (filepath, automatic) => { claims.push({ filepath, automatic }); return filepath !== rows[1].filepath; };
  assert.equal(await editor.moveInlineFile(1), true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[2].filepath);
  assert.deepEqual(claims, [{ filepath: rows[1].filepath, automatic: true }, { filepath: rows[2].filepath, automatic: true }]);
});

test('inline keyboard navigation preserves an invalid outgoing draft and its findings', async () => {
  const { editor, rows, calls, records } = await inlineNavigationHarness();
  editor.editorBlocks[0].translation = 'invalid outgoing draft';
  editor.editorSaveFindings = () => ({ errors: [{ message: 'Broken tag' }], warnings: [], confirmations: [] });
  assert.equal(await editor.moveInlineFile(1), true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[1].filepath);
  assert.equal(editor.inlineDraftRows[rows[0].filepath].translations[0], 'invalid outgoing draft');
  assert.equal([...records.values()][0].state, 'active'); assert.equal(editor.inlineFindingsFor(rows[0].filepath)[0].level, 'error');
  assert.equal(calls.promotions.length, 0); assert.equal(calls.alerts.length, 0);
});

test('inline keyboard navigation retains focus and text on the current row after draft persistence fails', async () => {
  const { editor, rows, calls, store } = await inlineNavigationHarness();
  editor.editorBlocks[0].translation = 'keep this pending draft';
  store.putTranslationDraft = async () => { throw new Error('Quota exceeded'); };
  assert.equal(await editor.moveInlineFile(1), false);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[0].filepath); assert.equal(editor.inlineActive, true);
  assert.equal(editor.editorBlocks[0].translation, 'keep this pending draft');
  assert.match(editor.inlineDraftError, /Quota exceeded/);
  assert.equal(calls.translationFocus.length, 0); assert.equal(calls.promotions.length, 0);
});

test('inline keyboard navigation ignores busy, read-only, import and overlay states', async () => {
  const changes = [editor => { editor.editorLoading = true; }, editor => { editor.editorSaving = true; },
    editor => { editor.navigationBusy = true; }, editor => { editor.inlineTransitionBusy = true; },
    editor => { editor._importingSource = true; }, editor => { editor.editorLoadError = 'Load failed'; },
    editor => { editor.collaborationConflictVisible = true; }, editor => { editor.importDialogVisible = true; },
    editor => { editor.$refs.diagnosticScanDialog = { open: true }; },
    editor => { Object.defineProperty(editor, 'editorTranslationReadOnly', { get: () => true }); }];
  for (const change of changes) {
    const { editor, rows, calls } = await inlineNavigationHarness(); change(editor);
    assert.equal(await editor.moveInlineFile(1), false);
    assert.equal(editor.editorCurrentEditingDesc.filepath, rows[0].filepath);
    assert.equal(calls.translationFocus.length, 0); assert.equal(calls.promotions.length, 0);
  }
});

test('a queued inline keyboard destination cannot steal focus after its language or source changes', async () => {
  for (const change of [editor => { editor.lang = 'German'; }, editor => { editor.sourceIdentity = 'another-source'; }]) {
    const { editor, rows, calls, store } = await inlineNavigationHarness();
    const gate = deferred(); store.getTranslationDraft = async () => { await gate.promise; return null; };
    const navigating = editor.moveInlineFile(1); await tick(); change(editor);
    gate.resolve(); assert.equal(await navigating, false); await tick();
    assert.equal(calls.translationFocus.length, 0);
    assert.equal(editor.navigationBusy, false);
    assert.notEqual(editor.editorCurrentEditingDesc?.filepath, rows[2].filepath);
  }
});

test('a manual row selection supersedes pending inline keyboard navigation without stealing text focus', async () => {
  const { editor, rows, calls, store } = await inlineNavigationHarness();
  const gate = deferred(); let reads = 0;
  store.getTranslationDraft = async () => { if (++reads === 1) await gate.promise; return null; };
  const navigating = editor.moveInlineFile(1); await tick();
  const selecting = editor.activateInlineRow(rows[2].filepath); await tick();
  gate.resolve(); assert.equal(await navigating, false); await selecting; await tick();
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[2].filepath);
  assert.equal(calls.translationFocus.length, 0); assert.equal(editor.navigationBusy, false);
});

test('a full-editor request supersedes pending inline keyboard navigation', async () => {
  const { editor, rows, calls, store } = await inlineNavigationHarness();
  const gate = deferred(); store.getTranslationDraft = async () => { await gate.promise; return null; };
  const navigating = editor.moveInlineFile(1); await tick();
  const opening = editor.openInlineFullEditor(rows[1].filepath); await tick();
  gate.resolve(); assert.equal(await navigating, false); assert.equal(await opening, true); await tick();
  assert.equal(editor.editorVisible, true); assert.equal(editor.inlineActive, false);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[1].filepath);
  assert.equal(calls.reveals.length, 0, 'The inline shortcut must not scroll the file table after a full-editor request');
});

test('denied automatic claims restore the original inline row and its table-field focus', async () => {
  const { editor, rows, calls } = await inlineNavigationHarness();
  await editor.finishInlineSession({ promote: false });
  rows[0].translations.English = ['Source', 'First column@Second column'];
  rows[0].translations.Thai = ['translation', 'left@right'];
  editor._workspaceSourceBaseline = copy(editor.descs);
  assert.equal(await editor.activateInlineRow(rows[0].filepath), true);
  editor.editorFocusedIndex = 1; editor.editorFocusedColumnIndex = 1;
  const claims = [];
  editor._collaboration = { leaveEdit() {}, fileBase() { return null; }, isEditing() { return false; } };
  editor.claimCollaborationFile = async (filepath, automatic) => { claims.push({ filepath, automatic }); return filepath === rows[0].filepath; };
  assert.equal(await editor.moveInlineFile(1), false);
  assert.equal(editor.inlineActive, true); assert.equal(editor.editorCurrentEditingDesc.filepath, rows[0].filepath);
  assert.equal(editor.currentPage, 1); assert.equal(editor.selectedFilepath, rows[0].filepath);
  assert.deepEqual(copy(editor.serializeEditorTranslations()), ['translation', 'left@right']);
  assert.deepEqual(claims, [{ filepath: rows[1].filepath, automatic: true },
    { filepath: rows[2].filepath, automatic: true }, { filepath: rows[0].filepath, automatic: true }]);
  assert.deepEqual(calls.translationFocus.at(-1).args, ['translation', 1, 1]);
  assert.equal(calls.reveals.at(-1).moveFocus, false); assert.equal(editor.navigationBusy, false);
});

test('a manual row click queued during keyboard draft persistence retains manual claim behavior', async () => {
  const { editor, rows, calls, store } = await inlineNavigationHarness();
  editor.editorBlocks[0].translation = 'save outgoing draft before manual selection';
  const gate = deferred(), put = store.putTranslationDraft, claims = [];
  store.putTranslationDraft = async (...args) => { await gate.promise; return put(...args); };
  editor._collaboration = { leaveEdit() {}, fileBase() { return null; }, isEditing() { return false; } };
  editor.claimCollaborationFile = async (filepath, automatic) => { claims.push({ filepath, automatic }); return true; };
  const navigating = editor.moveInlineFile(1); await tick();
  assert.equal(editor.draftWritePending, 1);
  await editor.inlineRowClick({ target: { closest: () => null } }, rows[2].filepath);
  gate.resolve(); assert.equal(await navigating, false); await tick();
  assert.equal(editor.inlineActive, true); assert.equal(editor.editorCurrentEditingDesc.filepath, rows[2].filepath);
  assert.deepEqual(claims, [{ filepath: rows[2].filepath, automatic: false }]);
  assert.equal(rows[0].translations.Thai[0], 'save outgoing draft before manual selection');
  assert.equal(calls.translationFocus.length, 0); assert.equal(editor.navigationBusy, false);
});

function fileTableArrowEvent(editor, filepath = editor.selectedFilepath, changes = {}) {
  const row = { tagName: 'TR', dataset: { filepath },
    matches: selector => selector === 'tr[data-filepath]',
    closest: selector => selector === 'tr[data-filepath]' ? row : null };
  return inlineArrowEvent(filepath, { target: filepath == null ? editor.$refs.fileTableRegion : row, ...changes });
}

async function dispatchInlineNavigationKey(editor, event, translation = false) {
  const navigate = editor.moveInlineFile;
  let pending;
  editor.moveInlineFile = function (...args) { return pending = navigate.apply(this, args); };
  try {
    if (translation) editor.translationKeydown(event, 0);
    else editor.fileTableKeydown(event);
    return pending ? await pending : undefined;
  } finally { editor.moveInlineFile = navigate; }
}

test('Ctrl+Arrow from the file table, rows and non-input row descendants uses inline navigation', () => {
  const { editor, desc } = harness(), requests = [];
  editor.selectedFilepath = desc.filepath;
  editor.moveInlineFile = (direction, filepath) => { requests.push({ direction, filepath }); return Promise.resolve(true); };
  for (const [filepath, key] of [[null, 'ArrowDown'], [desc.filepath, 'ArrowUp']]) {
    const event = fileTableArrowEvent(editor, filepath, { key });
    editor.fileTableKeydown(event);
    assert.equal(event.defaultPrevented, true); assert.equal(event.propagationStopped, true);
  }
  const row = fileTableArrowEvent(editor, desc.filepath).target;
  const descendant = fileTableArrowEvent(editor, desc.filepath,
    { target: { tagName: 'BUTTON', closest: selector => selector === 'tr[data-filepath]' ? row : null } });
  editor.fileTableKeydown(descendant);
  assert.equal(descendant.defaultPrevented, true); assert.equal(descendant.propagationStopped, true);
  assert.deepEqual(requests, [{ direction: 1, filepath: desc.filepath },
    { direction: -1, filepath: desc.filepath }, { direction: 1, filepath: desc.filepath }]);
});

test('table Ctrl+Arrow leaves editable controls, IME, modified shortcuts and unrelated surfaces alone', async () => {
  const { editor, desc } = harness(); await editor.activateInlineRow(desc.filepath);
  editor.moveInlineFile = () => assert.fail('An unrelated or native key must not navigate inline rows');
  const row = fileTableArrowEvent(editor, desc.filepath).target;
  const editable = tagName => ({ tagName, closest: selector => selector === 'tr[data-filepath]' ? row : null });
  for (const changes of [{ altKey: true }, { metaKey: true }, { shiftKey: true },
    { isComposing: true }, { keyCode: 229 }, { key: 'ArrowLeft' }, { key: 'Home' },
    { target: editable('INPUT') }, { target: editable('TEXTAREA') }, { target: editable('SELECT') },
    { target: { ...editable('DIV'), isContentEditable: true } },
    { target: { tagName: 'BUTTON', closest: () => null } }]) {
    const event = fileTableArrowEvent(editor, desc.filepath, changes);
    editor.fileTableKeydown(event);
    assert.equal(!!event.defaultPrevented, false); assert.equal(!!event.propagationStopped, false);
  }
  const prevented = fileTableArrowEvent(editor, desc.filepath, { defaultPrevented: true });
  editor.fileTableKeydown(prevented); assert.equal(!!prevented.propagationStopped, false);
  for (const [property, value] of [['inlineEditor', false], ['editorVisible', true], ['importDialogVisible', true]]) {
    const before = editor[property]; editor[property] = value;
    const event = fileTableArrowEvent(editor, desc.filepath);
    editor.fileTableKeydown(event);
    assert.equal(!!event.defaultPrevented, false, property); assert.equal(!!event.propagationStopped, false, property);
    editor[property] = before;
  }
});

test('a translation Ctrl+Arrow event cannot navigate twice when it reaches the file table handler', async () => {
  const { editor, desc } = harness(); await editor.activateInlineRow(desc.filepath);
  let requests = 0;
  editor.moveInlineFile = async () => { requests++; return true; };
  const event = inlineArrowEvent(desc.filepath);
  editor.translationKeydown(event, 0);
  editor.fileTableKeydown(event);
  assert.equal(requests, 1); assert.equal(event.defaultPrevented, true); assert.equal(event.propagationStopped, true);
});

test('Ctrl+Down starts from an inactive table selection and continues from translation and row focus', async () => {
  const { editor, rows, calls } = await inlineNavigationHarness();
  assert.equal(await editor.finishInlineSession({ promote: false }), true);
  assert.equal(editor.inlineActive, false);
  const fromTable = fileTableArrowEvent(editor, null);
  assert.equal(await dispatchInlineNavigationKey(editor, fromTable), true);
  assert.equal(fromTable.defaultPrevented, true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[1].filepath);
  assert.equal(editor.selectedFilepath, rows[1].filepath); assert.equal(editor.currentPage, 2);
  assert.deepEqual(calls.translationFocus.at(-1).args, ['translation', 0, null]);
  assert.equal(await dispatchInlineNavigationKey(editor, inlineArrowEvent(rows[1].filepath), true), true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[2].filepath);
  assert.equal(editor.selectedFilepath, rows[2].filepath); assert.equal(editor.currentPage, 3);
  const finalDown = fileTableArrowEvent(editor, rows[2].filepath);
  assert.equal(await dispatchInlineNavigationKey(editor, finalDown), false);
  assert.equal(finalDown.defaultPrevented, true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[2].filepath);
  assert.equal(calls.translationFocus.length, 2, 'The last row must not wrap or take focus again');
  assert.equal(await dispatchInlineNavigationKey(editor, fileTableArrowEvent(editor, rows[2].filepath, { key: 'ArrowUp' })), true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[1].filepath); assert.equal(editor.currentPage, 2);
});

test('a focused file row anchors Ctrl+Arrow even when selection and the active draft are on another row', async () => {
  const { editor, rows, calls } = await inlineNavigationHarness();
  editor.editorBlocks[0].translation = 'preserve the outgoing file';
  assert.equal(editor.selectedFilepath, rows[0].filepath);
  assert.equal(await dispatchInlineNavigationKey(editor, fileTableArrowEvent(editor, rows[1].filepath)), true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[2].filepath);
  assert.equal(editor.selectedFilepath, rows[2].filepath); assert.equal(editor.currentPage, 3);
  assert.equal(rows[0].translations.Thai[0], 'preserve the outgoing file'); assert.equal(calls.promotions.length, 1);
  assert.deepEqual(calls.translationFocus.at(-1).args, ['translation', 0, null]);
});

test('inactive table navigation skips occupied rows without reopening an outgoing editor after denied claims', async () => {
  for (const denyAll of [false, true]) {
    const { editor, rows, calls } = await inlineNavigationHarness();
    assert.equal(await editor.finishInlineSession({ promote: false }), true);
    const claims = [];
    editor._collaboration = { leaveEdit() {}, fileBase() { return null; }, isEditing(filepath) { return !denyAll && filepath === rows[1].filepath; } };
    editor.claimCollaborationFile = async (filepath, automatic) => { claims.push({ filepath, automatic }); return !denyAll; };
    assert.equal(await dispatchInlineNavigationKey(editor, fileTableArrowEvent(editor, null)), !denyAll);
    if (denyAll) {
      assert.equal(editor.inlineActive, false);
      assert.equal(calls.translationFocus.length, 0);
      assert.deepEqual(claims, [{ filepath: rows[1].filepath, automatic: true }, { filepath: rows[2].filepath, automatic: true }]);
    } else {
      assert.equal(editor.editorCurrentEditingDesc.filepath, rows[2].filepath);
      assert.deepEqual(claims, [{ filepath: rows[2].filepath, automatic: true }]);
    }
    assert.equal(editor.navigationBusy, false);
  }
});

test('table Ctrl+Arrow preserves an invalid outgoing draft through the normal inline workflow', async () => {
  const { editor, rows, calls, records } = await inlineNavigationHarness();
  editor.editorBlocks[0].translation = 'invalid table-origin draft';
  editor.editorSaveFindings = () => ({ errors: [{ message: 'Broken tag' }], warnings: [], confirmations: [] });
  assert.equal(await dispatchInlineNavigationKey(editor, fileTableArrowEvent(editor, null)), true);
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[1].filepath);
  assert.equal(editor.inlineDraftRows[rows[0].filepath].translations[0], 'invalid table-origin draft');
  assert.equal([...records.values()][0].state, 'active');
  assert.equal(editor.inlineFindingsFor(rows[0].filepath)[0].level, 'error');
  assert.equal(calls.promotions.length, 0); assert.equal(calls.alerts.length, 0);
});

test('pending table Ctrl+Arrow does not move again or steal focus from a newer manual row selection', async () => {
  const { editor, rows, calls, store } = await inlineNavigationHarness();
  assert.equal(await editor.finishInlineSession({ promote: false }), true);
  const gate = deferred(); let reads = 0;
  store.getTranslationDraft = async () => { if (++reads === 1) await gate.promise; return null; };
  const navigating = dispatchInlineNavigationKey(editor, fileTableArrowEvent(editor, null));
  await tick(); assert.equal(editor.navigationBusy, true);
  const repeated = fileTableArrowEvent(editor, rows[1].filepath);
  editor.fileTableKeydown(repeated); assert.equal(repeated.defaultPrevented, true);
  assert.equal(reads, 1, 'A repeat during hydration must not start another destination');
  const selecting = editor.activateInlineRow(rows[2].filepath); await tick();
  gate.resolve(); assert.equal(await navigating, false); await selecting; await tick();
  assert.equal(editor.editorCurrentEditingDesc.filepath, rows[2].filepath);
  assert.equal(calls.translationFocus.length, 0); assert.equal(editor.navigationBusy, false);
});
