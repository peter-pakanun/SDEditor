const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function description(name = 'first', translation = 'translation') {
  return { filepath: `test/${name}.txt`, filedir: 'test', filename: `${name}.txt`,
    translations: { English: ['Source'], Thai: [translation] }, hasChanges: false, isMissing: false, needsReview: false };
}
function harness({ records = new Map(), tm = false } = {}) {
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
    crypto: { randomUUID: () => 'test-id-' + (++nextId) }, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, performance };
  const document = { hidden: false, activeElement: null, querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {}, removeEventListener() {}, createElement() { return { set innerHTML(html) {
      this.value = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
    } }; } };
  const context = vm.createContext({ window, document, URLSearchParams, console, setTimeout, clearTimeout, performance,
    Vue: { defineComponent(value) { config = value; return value; }, createApp() { return { component() {}, directive() {}, mount() {} }; },
      nextTick(callback) { return Promise.resolve().then(callback); }, markRaw(value) { return value; }, toRaw(value) { return value; } } });
  for (const name of ['workspaceState.js', 'dictionaryScope.js', 'statDescCodec.js', 'helper.js', 'regexEngine.js', 'translationDiagnostics.js',
    ...(tm ? ['translationMemory.js', 'tmWorkerClient.js', 'tmUi.js'] : []),
    'terminologyDiagnostics.js', 'editorDictionaryIndex.js', 'dictionaryMatching.js', 'dictionaryWorkerClient.js', 'dictionaryWorkerUi.js', 'collaborationIntegration.js', 'inlineEditor.js', 'entryAlignment.js', 'entryAlignmentUi.js', 'index.js']) {
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

async function fixture(t, { english = ['One', 'Three'], translations = ['one', 'obsolete', 'three'] } = {}) {
  const h = harness(), { editor, desc, window } = h;
  desc.translations = { English: [...english], Thai: [...translations] };
  editor._workspaceSourceBaseline = copy(editor.descs);
  window.WorkspaceState.initializeWorkspace(editor.localDescs, { source: editor._workspaceSourceBaseline,
    sourceHash: editor.sourceIdentity, game: editor.gameVersion, language: editor.lang });
  assert.equal(await editor.editFile(desc.filepath), true);
  t.after(() => { clearTimeout(editor._draftTimer); editor._dictionaryWorkerClient?.dispose(); });
  return h;
}

function resolveMiddleRemoval(editor) {
  if (!editor.entryAlignment) assert.equal(editor.startEntryAlignment(), true);
  assert.equal(editor.mutateEntryAlignment('assign', 0, 0), true);
  assert.equal(editor.mutateEntryAlignment('assign', 2, 1), true);
  assert.equal(editor.mutateEntryAlignment('setObsolete', 1, true), true);
  assert.equal(editor.entryAlignmentReady, true);
}

test('alignment applies a scoped local draft while preserving committed text, baseline and every original block', async t => {
  const { editor, desc, records, calls, window } = await fixture(t);
  const original = copy(desc), baseline = copy(editor._workspaceSourceBaseline), session = editor._draftSession;
  resolveMiddleRemoval(editor);
  assert.equal(await editor.applyEntryAlignment(), true);
  assert.deepEqual(copy(editor.serializeEditorTranslations()), ['one', 'three']);
  assert.deepEqual(desc, original);
  assert.deepEqual(editor._workspaceSourceBaseline, baseline);
  assert.equal(!!window.WorkspaceState.workspaceFile(editor.localDescs, editor.workspaceSourceFile(desc.filepath), 'Thai').staged, false);
  assert.equal(calls.promotions.length, 0);
  assert.equal(editor.entryAlignment, null);
  assert.equal(session.alignmentRecovery.length, 1);
  assert.deepEqual(copy(session.alignmentRecovery[0].translations), ['one', 'obsolete', 'three']);
  const record = records.get(session.key);
  assert.deepEqual(record.translations, ['one', 'three']);
  assert.deepEqual(record.alignmentRecovery[0].translations, ['one', 'obsolete', 'three']);
  assert.deepEqual([record.profile, record.game, record.branchId, record.sourceHash, record.language, record.filepath],
    ['guest', 'poe1', 'default', 'source-a', 'Thai', desc.filepath]);
  const revisions = copy(editor.entryAlignmentSaveRevisions(['one', 'three']));
  assert.deepEqual(revisions.map(item => item.translations), [['one', 'obsolete', 'three'], ['one', 'three']]);
  assert.equal(revisions[0].note, 'Before entry alignment');
});

test('cancelling alignment does not change blocks, committed text or recovery state', async t => {
  const { editor, desc, records, calls } = await fixture(t);
  const original = copy(desc), blocks = copy(editor.editorBlocks), session = editor._draftSession;
  if (!editor.entryAlignment) assert.equal(editor.startEntryAlignment(), true);
  editor.mutateEntryAlignment('assign', 2, 0);
  editor.mutateEntryAlignment('setObsolete', 1, true);
  editor.clearEntryAlignment();
  assert.equal(editor.entryAlignment, null);
  assert.deepEqual(copy(editor.editorBlocks), blocks);
  assert.deepEqual(desc, original);
  assert.deepEqual(copy(session.alignmentRecovery), []);
  assert.equal(records.size, 0);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.promotions.length, 0);
  assert.equal(editor.startEntryAlignment(), true);
  assert.deepEqual(copy(editor.entryAlignment.slots), [null, null]);
});

test('dropped alignment uses exact preserved old English and requires an explicit removed-block decision', async t => {
  const { editor, desc, calls } = await fixture(t, { translations: ['', ''] });
  editor.editorDroppedCandidate = { id: 'old-copy', revision: 3, originSourceAvailable: true,
    snapshot: { english: ['One', 'Removed', 'Three'], translations: ['old one', 'removed translation', 'old three'] } };
  const candidate = copy(editor.editorDroppedCandidate);
  assert.equal(editor.startEntryAlignment('dropped'), true);
  assert.deepEqual(copy(editor.entryAlignment.slots), [0, 2]);
  assert.deepEqual(copy(editor.entryAlignmentPending), { unresolved: 0, unassigned: 1 });
  assert.equal(await editor.applyEntryAlignment(), false);
  editor.mutateEntryAlignment('setObsolete', 1, true);
  assert.equal(await editor.applyEntryAlignment(), true);
  assert.deepEqual(copy(editor.serializeEditorTranslations()), ['old one', 'old three']);
  assert.deepEqual(copy(editor._draftSession.alignmentRecovery[0].english), ['One', 'Removed', 'Three']);
  assert.deepEqual(copy(editor.editorDroppedCandidate), candidate, 'Continue does not resolve the Dropped copy before Save.');
  assert.deepEqual(desc.translations.Thai, ['', '']);
  assert.equal(calls.promotions.length, 0);
});

test('unavailable old English and a different draft never borrow a dropped snapshot as matching evidence', async t => {
  const { editor } = await fixture(t);
  editor.clearEntryAlignment();
  editor.editorDroppedCandidate = { id: 'old-copy', revision: 1, originSourceAvailable: false,
    snapshot: { english: ['One', 'Removed', 'Three'], translations: ['one', 'obsolete', 'three'] } };
  assert.equal(editor.startEntryAlignment('dropped'), true);
  assert.deepEqual(copy(editor.entryAlignment.slots), [null, null]);
  assert.deepEqual(copy(editor.entryAlignment.items.map(item => item.english)), [null, null, null]);
  editor.clearEntryAlignment(); editor.editorDroppedCandidate.originSourceAvailable = true;
  editor.editorBlocks[0].translation = 'different local draft';
  assert.equal(editor.startEntryAlignment(), true);
  assert.deepEqual(copy(editor.entryAlignment.slots), [null, null]);
  assert.deepEqual(copy(editor.entryAlignment.items.map(item => item.english)), [null, null, null]);
});

test('late prepared alignment cannot publish into a changed account, profile, game, language, source, branch or content group', async t => {
  const changes = {
    account: editor => { editor.cloudUser = { id: 'another-account', role: 'translator', language: 'Thai' }; },
    profile: editor => { editor.cloudProfileId = 'another-profile'; },
    game: editor => { editor.gameVersion = 'poe2'; },
    language: editor => { editor.lang = 'German'; },
    source: editor => { editor.sourceIdentity = 'another-source'; },
    branch: editor => { editor.branchId = 'another-branch'; },
    group: editor => { editor.activeContentGroup = { id: 'group-b', versionId: 'version-a', contentMode: 'statdescription' }; },
    version: editor => { editor.activeContentGroup = { id: 'group-a', versionId: 'version-b', contentMode: 'statdescription' }; },
    access: editor => { editor.cloudUser = { id: 'account-a', role: 'translator', language: 'German', assignmentVersion: 2 }; },
    mode: editor => { editor.ctActive = true; },
    source_comparison: editor => { editor.editorCompareActive = true; editor.editorCompareMode = 'source'; },
    translation_comparison: editor => { editor.editorCompareActive = true; editor.editorCompareMode = 'translation'; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async t => {
    const { editor, calls, records } = await fixture(t), gate = deferred();
    editor.cloudUser = { id: 'account-a', role: 'translator', language: 'Thai', assignmentVersion: 1 };
    editor.activeContentGroup = { id: 'group-a', versionId: 'version-a', contentMode: 'statdescription' };
    editor._draftSession.scope = editor.editorDraftScope(editor.editorCurrentEditingDesc.filepath);
    editor.clearEntryAlignment(); resolveMiddleRemoval(editor);
    const oldBlocks = editor.editorBlocks, original = copy(oldBlocks), session = editor._draftSession;
    editor.prepareMatchedEditorBlocks = () => gate.promise;
    const applying = editor.applyEntryAlignment();
    assert.equal(editor.entryAlignmentApplying, true);
    change(editor);
    gate.resolve([editor.makeEditorBlock('One', 'one'), editor.makeEditorBlock('Three', 'three')]);
    assert.equal(await applying, false);
    assert.equal(editor.editorBlocks, oldBlocks);
    assert.deepEqual(copy(editor.editorBlocks), original);
    assert.deepEqual(copy(session.alignmentRecovery), []);
    assert.equal(calls.writes.length, 0);
    assert.equal(calls.promotions.length, 0);
    assert.equal(records.size, 0);
  });
});

test('main Save guards reject excess translations and any active alignment before persisting or confirming', async t => {
  const { editor, calls } = await fixture(t);
  editor.clearEntryAlignment();
  assert.equal(editor.editorEntryAlignmentRequired, true);
  assert.equal(editor.editorTranslationReadOnly, true);
  assert.equal(await editor.editorSave({ close: false, defer: false }), false);
  resolveMiddleRemoval(editor);
  assert.equal(editor.entryAlignmentReady, true);
  assert.equal(await editor.editorSave({ close: false, defer: false }), false);
  assert.equal(calls.promotions.length, 0);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.confirms.length, 0);
  assert.equal(calls.alerts.length, 0);
  assert.deepEqual(copy(editor.serializeEditorTranslations()), ['one', 'obsolete', 'three']);
});

test('preparation failure preserves mapping decisions, original draft and recoverable translation blocks', async t => {
  const { editor, calls, records } = await fixture(t);
  resolveMiddleRemoval(editor);
  const state = editor.entryAlignment, mapped = copy(state), blocks = copy(editor.editorBlocks), session = editor._draftSession;
  editor.prepareMatchedEditorBlocks = async () => { throw new Error('Worker unavailable'); };
  assert.equal(await editor.applyEntryAlignment(), false);
  assert.equal(editor.entryAlignment, state);
  assert.deepEqual(copy(editor.entryAlignment), mapped);
  assert.deepEqual(copy(editor.editorBlocks), blocks);
  assert.equal(editor.entryAlignmentApplying, false);
  assert.match(editor.entryAlignmentError, /Could not prepare.*Worker unavailable/);
  assert.deepEqual(copy(session.alignmentRecovery), []);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.promotions.length, 0);
  assert.equal(records.size, 0);
});

test('failed draft retention preserves the aligned draft and every original block for retry', async t => {
  const { editor, desc, store, records, calls } = await fixture(t);
  const original = copy(desc), session = editor._draftSession;
  resolveMiddleRemoval(editor);
  const write = store.putTranslationDraft;
  store.putTranslationDraft = async () => { throw new Error('Disk quota reached'); };
  assert.equal(await editor.applyEntryAlignment(), false);
  assert.deepEqual(copy(editor.serializeEditorTranslations()), ['one', 'three']);
  assert.deepEqual(desc, original);
  assert.deepEqual(copy(session.alignmentRecovery[0].translations), ['one', 'obsolete', 'three']);
  assert.deepEqual(copy(session.pendingRecord.translations), ['one', 'three']);
  assert.deepEqual(copy(session.pendingRecord.alignmentRecovery[0].translations), ['one', 'obsolete', 'three']);
  assert.match(editor.inlineDraftError, /Could not keep.*Disk quota reached/);
  assert.equal(calls.promotions.length, 0);
  assert.equal(records.size, 0);
  store.putTranslationDraft = write;
  assert.equal(await editor.flushEditorDraft({ force: true }), true);
  assert.deepEqual(records.get(session.key).translations, ['one', 'three']);
  assert.deepEqual(records.get(session.key).alignmentRecovery[0].translations, ['one', 'obsolete', 'three']);
});

test('Save submits aligned text together with original-block recovery revisions', async t => {
  const { editor, calls } = await fixture(t);
  resolveMiddleRemoval(editor);
  assert.equal(await editor.applyEntryAlignment(), true);
  assert.equal(await editor.editorSave({ close: false, defer: false }), true);
  assert.equal(calls.promotions.length, 1);
  const submitted = calls.promotions[0];
  assert.deepEqual(submitted.updates[0].lines, ['one', 'three']);
  assert.deepEqual(copy(submitted.options.revisions.map(item => item.translations)),
    [['one', 'obsolete', 'three'], ['one', 'three']]);
  assert.equal(submitted.options.revisions[0].note, 'Before entry alignment');
});

test('a failed Save retains the aligned draft, recovery revisions and committed original', async t => {
  const { editor, desc, records } = await fixture(t);
  const original = copy(desc);
  resolveMiddleRemoval(editor);
  assert.equal(await editor.applyEntryAlignment(), true);
  const session = editor._draftSession;
  editor.persistTranslationBatch = async () => { throw new Error('Durable save unavailable'); };
  assert.equal(await editor.editorSave({ close: false, defer: false }), false);
  assert.deepEqual(desc, original);
  assert.deepEqual(copy(editor.serializeEditorTranslations()), ['one', 'three']);
  assert.deepEqual(copy(session.alignmentRecovery[0].translations), ['one', 'obsolete', 'three']);
  assert.deepEqual(records.get(session.key).alignmentRecovery[0].translations, ['one', 'obsolete', 'three']);
});

test('reopening a retained aligned draft restores its original-block recovery for the eventual Save', async t => {
  const { editor, desc } = await fixture(t);
  resolveMiddleRemoval(editor);
  assert.equal(await editor.applyEntryAlignment(), true);
  editor._draftSession = null; editor.editorVisible = false; editor.editorBlocks = [];
  assert.equal(await editor.editFile(desc.filepath), true);
  assert.deepEqual(copy(editor.serializeEditorTranslations()), ['one', 'three']);
  assert.deepEqual(copy(editor._draftSession.alignmentRecovery[0].translations), ['one', 'obsolete', 'three']);
  assert.deepEqual(copy(editor.entryAlignmentSaveRevisions(['one', 'three'])[0].translations), ['one', 'obsolete', 'three']);
});

test('aligning a dropped candidate also preserves the authored draft it replaces', async t => {
  const { editor, records } = await fixture(t, { translations: ['committed one', 'committed three'] });
  editor.editorBlocks[0].translation = 'my authored one';
  editor.editorBlocks[1].translation = 'my authored three';
  editor.editorDroppedCandidate = { id: 'older-copy', revision: 2, originSourceAvailable: true,
    snapshot: { english: ['One', 'Removed', 'Three'], translations: ['old one', 'removed', 'old three'] } };
  assert.equal(editor.startEntryAlignment('dropped'), true);
  editor.mutateEntryAlignment('setObsolete', 1, true);
  assert.equal(await editor.applyEntryAlignment(), true);
  const recovery = copy(editor._draftSession.alignmentRecovery);
  assert.deepEqual(recovery.map(item => item.translations),
    [['old one', 'removed', 'old three'], ['my authored one', 'my authored three']]);
  assert.deepEqual(recovery[1].english, ['One', 'Three']);
  assert.deepEqual(records.get(editor._draftSession.key).alignmentRecovery, recovery);
});

test('draft retention writes newly added recovery even when translation output and committed base are unchanged', async t => {
  const { editor, records, calls } = await fixture(t, { translations: ['one', 'three'] });
  editor.editorBlocks[0].translation = 'local authored one';
  assert.equal(await editor.flushEditorDraft({ force: true }), true);
  const session = editor._draftSession, previous = copy(records.get(session.key)), writes = calls.writes.length;
  session.alignmentRecovery.push({ translations: ['earlier one', 'removed', 'earlier three'],
    english: ['One', 'Removed', 'Three'], savedAt: 123 });
  assert.equal(await editor.flushEditorDraft({ force: true }), true);
  const retained = records.get(session.key);
  assert.deepEqual(retained.translations, previous.translations);
  assert.deepEqual(retained.base, previous.base);
  assert.notEqual(retained.revision, previous.revision);
  assert.equal(calls.writes.length, writes + 1);
  assert.deepEqual(retained.alignmentRecovery, copy(session.alignmentRecovery));
  assert.equal(await editor.flushEditorDraft({ force: true }), true);
  assert.equal(calls.writes.length, writes + 1, 'Identical output, base and recovery do not create another checkpoint.');
});

test('Confirm unchanged cannot promote a matching dropped translation while alignment is open', async t => {
  const { editor, calls } = await fixture(t, { translations: ['one', 'three'] });
  editor.editorDroppedCandidate = { id: 'matching-copy', revision: 1, originSourceAvailable: true,
    snapshot: { english: ['One', 'Three'], translations: ['one', 'three'] } };
  assert.equal(editor.editorDroppedCanPromote, true);
  assert.equal(editor.startEntryAlignment('dropped'), true);
  assert.equal(editor.editorDroppedCanPromote, false);
  editor.capturedDroppedPromotion = () => { assert.fail('Alignment must block the promotion before capturing it.'); };
  await editor.confirmTranslationUnchanged();
  assert.equal(calls.promotions.length, 0);
  assert.equal(calls.confirms.length, 0);
  assert.equal(calls.alerts.length, 0);
  assert.equal(editor.entryAlignmentReady, true);
});

test('reopening the same file clears an earlier alignment panel and binding before preparation', async t => {
  const { editor, desc } = await fixture(t);
  if (!editor.entryAlignment) assert.equal(editor.startEntryAlignment(), true);
  const state = editor.entryAlignment, binding = editor._entryAlignmentBinding;
  editor.mutateEntryAlignment('assign', 2, 0);
  const request = editor.beginEditorOpen(desc.filepath);
  assert.ok(request);
  assert.equal(editor.entryAlignment, null);
  assert.equal(editor._entryAlignmentBinding, null);
  assert.equal(editor.entryAlignmentCurrent(binding), false);
  assert.equal(await editor.openEditorFile(desc.filepath, false, request), true);
  assert.notEqual(editor.entryAlignment, state);
  assert.notEqual(editor._entryAlignmentBinding, binding);
});

test('comparison stays visible while excess translation blocks remain read-only', async t => {
  const { editor } = await fixture(t);
  editor.clearEntryAlignment();
  assert.equal(editor.editorEntryAlignmentRequired, true);
  editor.editorCompareActive = true; editor.editorCompareMode = 'source';
  assert.equal(editor.editorBlocks.length, 3);
  assert.equal(editor.editorCurrentEditingDesc.translations.English.length, 2);
  assert.equal(editor.editorEntryAlignmentRequired, false);
  assert.equal(editor.editorTranslationReadOnly, true, 'Source comparison must not enable editing or saving excess translations.');
  assert.equal(editor.startEntryAlignment(), false);
  editor.editorCompareMode = 'translation';
  assert.equal(editor.editorEntryAlignmentRequired, false);
  assert.equal(editor.editorTranslationReadOnly, true, 'Translation comparison keeps its existing independent read-only guard.');
});

test('a completed Save prunes acknowledged recovery so subsequent edits do not duplicate before-alignment history', async t => {
  const { editor, calls } = await fixture(t);
  resolveMiddleRemoval(editor);
  assert.equal(await editor.applyEntryAlignment(), true);
  assert.equal(await editor.editorSave({ close: false, defer: false }), true);
  assert.deepEqual(copy(editor._draftSession.alignmentRecovery), []);
  editor.editorBlocks[0].translation = 'later correction';
  assert.equal(await editor.editorSave({ close: false, defer: false }), true);
  assert.equal(calls.promotions.length, 2);
  assert.equal(calls.promotions[0].options.revisions[0].note, 'Before entry alignment');
  assert.equal(calls.promotions[1].options.revisions, undefined);
});

test('deferred acknowledgement prunes only captured recovery and retains newer alignment recovery', async t => {
  const { editor, desc, records, window, calls } = await fixture(t);
  resolveMiddleRemoval(editor);
  assert.equal(await editor.applyEntryAlignment(), true);
  const session = editor._draftSession, captured = copy(session.alignmentRecovery), persist = editor.persistTranslationBatch;
  let queuedOptions;
  editor.initializePendingSaves = () => true;
  editor.persistTranslationBatch = async (_updates, _origin, options) => {
    queuedOptions = options;
    return { status: 'queued', jobId: 'deferred-alignment-save' };
  };
  assert.equal(await editor.editorSave({ close: false, defer: true }), true);
  assert.equal(typeof queuedOptions.onCommitted, 'function');
  const newer = { translations: ['later old one', 'later removed', 'later old three'],
    english: ['One', 'Removed later', 'Three'], savedAt: 456 };
  session.alignmentRecovery.push(copy(newer));
  editor.editorBlocks[0].translation = 'newer aligned one';
  editor.editorBlocks[1].translation = 'newer aligned three';
  // The worker acknowledgement has committed the originally submitted file and consumed its checkpoint.
  const submitted = ['one', 'three'];
  window.WorkspaceState.stageTranslation(editor.localDescs, { filepath: desc.filepath, translations: submitted }, editor.lang,
    { source: editor.workspaceSourceFile(desc.filepath), sourceHash: editor.sourceIdentity, game: editor.gameVersion });
  desc.translations.Thai = submitted.slice();
  const record = records.get(session.key);
  records.set(session.key, { ...record, state: 'promoted', revision: record.revision + ':promoted', translations: [] });
  await queuedOptions.onCommitted({ status: 'local', draftConsumed: true });
  assert.equal(session.submission, null);
  assert.deepEqual(copy(session.alignmentRecovery), [newer]);
  assert.deepEqual(records.get(session.key).alignmentRecovery, [newer]);
  assert.deepEqual(records.get(session.key).translations, ['newer aligned one', 'newer aligned three']);
  assert.equal(session.alignmentRecovery.some(item => JSON.stringify(item) === JSON.stringify(captured[0])), false);
  editor.persistTranslationBatch = persist;
  assert.equal(await editor.editorSave({ close: false, defer: false }), true);
  assert.deepEqual(copy(calls.promotions.at(-1).options.revisions.map(item => item.translations)),
    [newer.translations, ['newer aligned one', 'newer aligned three']]);
  assert.deepEqual(copy(session.alignmentRecovery), []);
});

test('history comparison and restore calls cannot replace an active alignment session', async t => {
  const { editor, desc, calls } = await fixture(t);
  resolveMiddleRemoval(editor);
  const state = editor.entryAlignment, blocks = copy(editor.editorBlocks);
  const current = { id: 1, filepath: desc.filepath, lang: 'Thai', sourceHash: editor.sourceIdentity,
    savedAt: 10, translations: ['one', 'three'] };
  const older = { ...current, id: 2, savedAt: 5, translations: ['older one', 'older three'] };
  editor.historyItems = [current, older]; editor.historySelectedA = current; editor.historySelectedB = null;
  editor.buildHistoryDiffHtml = () => { assert.fail('An active alignment must block comparison before building a diff.'); };
  editor.pickHistoryRevision(older);
  assert.equal(editor.historySelectedB, null);
  assert.equal(editor.editorCompareActive, false);
  editor.historySelectedB = older;
  editor.enterEditorCompareModeFromHistory();
  assert.equal(editor.editorCompareActive, false);
  await editor.restoreHistoryRevision(older);
  assert.equal(editor.entryAlignment, state);
  assert.deepEqual(copy(editor.editorBlocks), blocks);
  assert.equal(calls.promotions.length, 0);
  assert.equal(calls.confirms.length, 0);
  assert.equal(calls.writes.length, 0);
});

test('a source or translation comparison activated before Continue cannot bypass durable draft retention', async t => {
  for (const mode of ['source', 'translation']) await t.test(mode, async t => {
    const { editor, calls, records } = await fixture(t);
    resolveMiddleRemoval(editor);
    const state = editor.entryAlignment, mapped = copy(state), blocks = copy(editor.editorBlocks);
    editor.editorCompareActive = true; editor.editorCompareMode = mode;
    assert.equal(await editor.applyEntryAlignment(), false);
    assert.equal(editor.entryAlignment, state);
    assert.deepEqual(copy(editor.entryAlignment), mapped);
    assert.deepEqual(copy(editor.editorBlocks), blocks);
    assert.deepEqual(copy(editor._draftSession.alignmentRecovery), []);
    assert.equal(calls.promotions.length, 0);
    assert.equal(calls.writes.length, 0);
    assert.equal(records.size, 0);
  });
});


