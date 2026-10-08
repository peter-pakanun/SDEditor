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

function harness({ records = new Map() } = {}) {
  let config, nextId = 0;
  const calls = { writes: [], promotions: [], confirms: [], alerts: [], focused: 0 };
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
    for (const { desc, lines } of updates) desc.translations[editor.lang] = [...lines];
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
