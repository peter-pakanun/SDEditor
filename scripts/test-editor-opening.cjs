const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function description(name, english, translation = english) {
  return {
    filepath: `test/${name}.txt`, filedir: 'test', filename: `${name}.txt`,
    translations: { English: [].concat(english), Thai: [].concat(translation) },
    hasChanges: false, isMissing: false, needsReview: false,
  };
}

function dictionary(size = 120) {
  return Array.from({ length: size }, (_, i) => ({
    _id: `word-${i}`, find: `Term ${i}`, replace: `คำ ${i}`, alts: [], tlnote: '',
  }));
}

function dictionaryField(dictId) {
  return {
    closest(selector) {
      if (!selector.includes('data-dict-id')) return null;
      return { getAttribute(name) { return name === 'data-dict-id' ? dictId : null; } };
    },
  };
}

function dictionaryIds(entries) {
  return Array.from(entries, entry => entry._id);
}

function trackedDictionary(entries) {
  const proxies = new WeakMap(), originals = new WeakMap();
  const counts = { reads: 0, writes: 0 };
  const toRaw = value => originals.get(value) || value;
  const wrap = value => {
    if (!value || typeof value !== 'object') return value;
    if (originals.has(value)) return value;
    if (!proxies.has(value)) {
      const proxy = new Proxy(value, {
        get(target, key, receiver) { counts.reads++; return wrap(Reflect.get(target, key, receiver)); },
        set(target, key, next) { counts.writes++; return Reflect.set(target, key, toRaw(next)); },
      });
      proxies.set(value, proxy); originals.set(proxy, value);
    }
    return proxies.get(value);
  };
  return { entries, dictionary: wrap(entries), toRaw, wrap, counts };
}

function loadEditor(options = {}) {
  let config;
  let clock = 0;
  const calls = { asyncIndexes: 0, syncIndexes: 0, definitions: 0, highlights: 0, diagnostics: 0, focused: 0, selected: 0, settings: 0 };
  const window = { location: { search: '?testMode=1&lang=Thai' }, CloudUI: { mixin: {} } };
  const document = {
    hidden: false,
    activeElement: null,
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() {
      return {
        set innerHTML(html) {
          this.value = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'").replace(/&amp;/g, '&');
        },
      };
    },
  };
  const context = vm.createContext({
    window, document, URLSearchParams, console, clearTimeout, setTimeout,
    performance: options.controlledClock ? { now() { clock += 4; return clock; } } : performance,
    alert(message) { throw new Error(`Unexpected alert: ${message}`); },
    confirm(message) { throw new Error(`Unexpected confirmation: ${message}`); },
    Vue: {
      defineComponent(value) { config = value; return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; },
      nextTick(callback) { return Promise.resolve().then(callback); },
      markRaw(value) { return value; }, toRaw(value) { return options.toRaw ? options.toRaw(value) : value; },
    },
  });
  for (const name of ['workspaceState.js', 'dictionaryScope.js', 'statDescCodec.js', 'helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'editorDictionaryIndex.js', 'collaborationIntegration.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'), context, { filename: name });
  }
  for (const [method, counter] of [['create', 'syncIndexes'], ['createAsync', 'asyncIndexes']]) {
    const original = window.EditorDictionaryIndex[method];
    window.EditorDictionaryIndex[method] = (...args) => { calls[counter]++; return original(...args); };
  }
  const editor = Object.assign({}, ...config.mixins.map(mixin => mixin.data?.() || {}), config.data(),
    ...config.mixins.map(mixin => mixin.methods || {}), config.methods, {
    lang: 'Thai', gameVersion: 'poe1', highlightDict: true, sideTab: 'dictionary',
    dictionary: options.dictionary || dictionary(),
    filterDesc() {}, saveSettings() { calls.settings++; }, scheduleEditorHLterRefresh() {},
    scheduleDictionaryDiagnosticScan() {}, autosizeEditorMultilineFields() {}, refreshGamePreview() {},
    $nextTick(callback) { return Promise.resolve().then(callback); },
    $refs: { editorSide: { scrollTop: 500 } },
  });
  for (const [method, counter] of [['getDictionaryDefinitionPairs', 'definitions'], ['buildEnglishHLter', 'highlights'], ['analyzeTranslationDiagnostics', 'diagnostics']]) {
    const original = editor[method];
    editor[method] = function (...args) { calls[counter]++; return original.apply(this, args); };
  }
  let dictionaryViewCache;
  for (const [name, getter] of Object.entries(config.computed)) {
    Object.defineProperty(editor, name, { get: () => {
      if (name !== 'dictionaryScopeView' || !options.cacheDictionaryScope) return getter.call(editor);
      // Model Vue's computed caching for tests that measure reactive array reads.
      const key = [editor.dictionary, editor.gameVersion, editor.editorDictionaryRevision];
      if (!dictionaryViewCache || key.some((value, index) => value !== dictionaryViewCache.key[index])) {
        dictionaryViewCache = { key, value: getter.call(editor) };
      }
      return dictionaryViewCache.value;
    } });
  }
  return { editor, config, calls, document, window };
}

test('opening a missing translation with a Dropped copy seeds its candidate draft without changing current text', async () => {
  const { editor, window } = loadEditor({ dictionary: [] });
  const previous = description('dropped', 'Original source', 'Translation for the original source');
  const current = description('dropped', 'Changed source', '');
  editor.sourceIdentity = 'changed-source'; editor.sourceLoaded = true;
  editor._workspaceSourceBaseline = [JSON.parse(JSON.stringify(current))];
  editor.descs = [current]; editor.localDescs = { sourceHash: 'original-source', descs: [], status: {} };
  window.WorkspaceState.initializeWorkspace(editor.localDescs, { source: [previous], sourceHash: 'original-source',
    game: editor.gameVersion, language: editor.lang });
  window.WorkspaceState.upgradeSource(editor.localDescs, { previousSource: [previous], source: [current],
    previousSourceHash: 'original-source', sourceHash: editor.sourceIdentity, game: editor.gameVersion, language: editor.lang });
  editor.applyWorkspaceOverlay();
  const paint = deferred(); editor.yieldEditorPaint = () => paint.promise;
  const opening = editor.editFile(current.filepath);
  assert.equal(editor.editorVisible, true); assert.equal(editor.editorLoading, true);
  assert.equal(editor.editorTranslationReadOnly, true);
  assert.equal(editor.editorBlocks[0].english, 'Changed source');
  assert.equal(editor.editorBlocks[0].translation, 'Translation for the original source');
  assert.equal(editor.editorDroppedCandidate.snapshot.english[0], 'Original source');
  assert.deepEqual(Array.from(current.translations.Thai), ['']);
  assert.equal(current.hasChanges, false); assert.equal(current.isMissing, true);
  assert.equal(current.isDropped, true);
  paint.resolve();
  assert.equal(await opening, true, editor.editorLoadError);
  assert.deepEqual(Array.from(current.translations.Thai), ['']);
  assert.equal(editor.editorBlocks[0].translation, 'Translation for the original source');
  assert.equal(current.hasChanges, false); assert.equal(current.needsReview, true);
});

test('opening a complete ZIP translation still offers its Dropped copy while retaining current text in the draft', async () => {
  const { editor, window } = loadEditor({ dictionary: [] });
  const current = description('complete-with-dropped', 'Current source', 'Current ZIP translation');
  current.translations.German = ['Aktuelle ZIP Übersetzung'];
  const previous = description('complete-with-dropped', 'Original source', 'Old preserved translation');
  editor.sourceIdentity = 'current-source'; editor.sourceLoaded = true;
  editor._workspaceSourceBaseline = [JSON.parse(JSON.stringify(current))];
  editor.descs = [current]; editor.localDescs = { sourceHash: editor.sourceIdentity, descs: [], status: {} };
  window.WorkspaceState.initializeWorkspace(editor.localDescs, { source: [current], sourceHash: editor.sourceIdentity,
    game: editor.gameVersion, language: editor.lang });
  window.WorkspaceState.dropTranslation(editor.localDescs, previous, 'Thai', {
    game: editor.gameVersion, originSourceHash: 'original-source', targetSourceHash: editor.sourceIdentity,
  });
  editor.applyWorkspaceOverlay();
  assert.equal(current.isDropped, true); assert.equal(current.isMissing, false); assert.equal(current.hasChanges, false);
  assert.equal(await editor.editFile(current.filepath), true, editor.editorLoadError);
  assert.equal(editor.editorBlocks[0].translation, 'Current ZIP translation');
  assert.equal(editor.editorDroppedCandidate.snapshot.translations[0], 'Old preserved translation');
  assert.equal(editor.editorDroppedCandidate.snapshot.english[0], 'Original source');
  assert.equal(editor.editorHaveChanges(), false);
  editor.lang = 'German'; editor.applyWorkspaceOverlay();
  assert.equal(current.isDropped, false);
  assert.equal(await editor.editFile(current.filepath), true, editor.editorLoadError);
  assert.equal(editor.editorDroppedCandidate, null);
  assert.equal(editor.editorBlocks[0].translation, 'Aktuelle ZIP Übersetzung');
});

test('opening publishes real read-only text before dictionary work and blocks Save', async () => {
  const { editor, calls } = loadEditor();
  const desc = description('first', 'Term 119');
  editor.descs = [desc];
  const paint = deferred();
  editor.yieldEditorPaint = () => paint.promise;
  const opening = editor.editFile(desc.filepath);
  assert.equal(editor.editorVisible, true);
  assert.equal(editor.editorLoading, true);
  assert.equal(editor.editorTranslationReadOnly, true);
  assert.equal(editor.editorCurrentEditingDesc, desc);
  assert.equal(editor.editorBlocks.length, 1);
  assert.equal(editor.editorBlocks[0].english, 'Term 119');
  assert.equal(editor.editorBlocks[0].translation, 'Term 119');
  assert.equal(editor.editorBlocks[0].englishHLter, '');
  assert.equal(editor.editorBlocks[0].translationHLter, '');
  assert.equal(editor.editorBlocks[0].HLs.length, 0);
  assert.equal(editor.editorOriginalTranslations[0], 'Term 119');
  assert.equal(editor.editorReady, false);
  assert.equal(calls.asyncIndexes, 0, 'Dictionary work must wait until source and translation can paint.');
  assert.equal(calls.definitions, 0);
  assert.equal(calls.highlights, 0);
  assert.equal(calls.diagnostics, 0);
  assert.equal(await editor.editorSave(), false);
  assert.equal(calls.settings, 0);
  paint.resolve();
  assert.equal(await opening, true, editor.editorLoadError);
  assert.equal(editor.editorLoading, false);
  assert.equal(editor.editorReady, true);
  assert.equal(editor.editorTranslationReadOnly, false);
  assert.equal(editor.editorBlocks[0].HLs[0].dictId, 'word-119');
  assert.equal(calls.syncIndexes, 0, 'Opening must use the cooperative index builder.');
});

test('plain, multiline and table text retain their structure and identity while hydrating', async () => {
  const { editor, calls } = loadEditor();
  editor.descs = [description('shapes',
    ['Term 1', 'Term 2\\nTerm 3', 'Term 4@Term 5\\nTerm 6@Term 7'],
    ['คำ 1', 'คำ 2\\nคำ 3', 'คำ 4@คำ 5\\nคำ 6'])];
  const paint = deferred();
  editor.yieldEditorPaint = () => paint.promise;
  const opening = editor.editFile(editor.descs[0].filepath);
  const blocks = [...editor.editorBlocks];
  const tableColumns = [...blocks[2].tableColumns];
  const shape = block => ({
    english: block.english, translation: block.translation,
    isTable: block.isTable, isMultiline: block.isMultiline,
    metaLinesEn: block.metaLinesEn, metaLinesTr: block.metaLinesTr,
    metaColsEn: block.metaColsEn, metaColsTr: block.metaColsTr,
    tableColumns: Array.from(block.tableColumns, column => ({
      english: column.english, translation: column.translation,
      isMultiline: column.isMultiline,
      englishExists: column.englishExists, translationExists: column.translationExists,
    })),
  });
  const initialShapes = blocks.map(shape);
  assert.deepEqual(blocks.map(block => [block.isTable, block.isMultiline]), [[false, false], [false, true], [true, true]]);
  assert.equal(blocks[1].english, 'Term 2\nTerm 3');
  assert.equal(blocks[1].translation, 'คำ 2\nคำ 3');
  assert.equal(tableColumns.length, 3);
  assert.equal(tableColumns[1].english, 'Term 5\nTerm 6');
  assert.equal(tableColumns[1].translation, 'คำ 5\nคำ 6');
  assert.equal(tableColumns[2].translation, '');
  assert.equal(tableColumns[2].translationExists, false);
  assert.equal(calls.highlights, 0, 'Even table cells must defer highlighting.');
  assert.equal(calls.diagnostics, 0, 'Even table cells must defer diagnostic analysis.');
  paint.resolve();
  assert.equal(await opening, true, editor.editorLoadError);
  assert.deepEqual(Array.from(editor.editorBlocks, shape), initialShapes);
  for (let i = 0; i < blocks.length; i++) assert.equal(editor.editorBlocks[i], blocks[i]);
  for (let i = 0; i < tableColumns.length; i++) assert.equal(editor.editorBlocks[2].tableColumns[i], tableColumns[i]);
  assert.equal(blocks[0].HLs[0].dictId, 'word-1');
  assert.equal(tableColumns[1].HLs.length, 2);
  assert.ok(calls.highlights > 0);
  assert.ok(calls.diagnostics > 0);
});

test('pending text rejects insertion, regex, diagnostics and autocomplete interactions', async () => {
  const { editor, calls, document } = loadEditor();
  editor.descs = [description('readonly', ['Term 1', 'Term 2\\nTerm 3', 'Term 4@Term 5'], ['หนึ่ง', 'สอง\\nสาม', 'สี่@ห้า'])];
  const paint = deferred();
  editor.yieldEditorPaint = () => paint.promise;
  const opening = editor.editFile(editor.descs[0].filepath);
  const before = editor.editorBlocks.map(block => block.translation);
  const input = { value: '[', selectionStart: 1, selectionEnd: 1 };
  editor.getEditorRef = () => input;
  document.activeElement = input;
  let nativeEdits = 0, popupBuilds = 0;
  document.execCommand = () => { nativeEdits++; return true; };
  editor.buildHlPopupItems = () => { popupBuilds++; return []; };
  editor.insertTranslationText(0, 'changed');
  editor.useRegex(editor.editorBlocks[0]);
  assert.equal(editor.sideTab, 'dictionary');
  editor.editorBlocks[0].translationReplace = 'changed';
  editor.doTranslationReplace(editor.editorBlocks[0]);
  editor.translationInput(editor.editorBlocks[0], 0);
  editor.normalizeMultilineEditorBlock(editor.editorBlocks[1], 1);
  editor.tableColumnInput(editor.editorBlocks[2], 2, 0);
  editor.openHlPopup(0);
  editor.translationKeydown({ key: '[', target: input }, 0);
  editor.queueCommittedAutocompleteTrigger({ type: 'input', inputType: 'insertText', data: '[', target: input }, 0);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(editor.editorBlocks.map(block => block.translation), before);
  assert.equal(nativeEdits, 0);
  assert.equal(popupBuilds, 0);
  assert.equal(editor.hlPopup.visible, false);
  assert.equal(calls.highlights, 0);
  assert.equal(calls.diagnostics, 0);
  assert.equal(calls.asyncIndexes, 0);
  editor.getEditorRef = () => null;
  paint.resolve();
  assert.equal(await opening, true, editor.editorLoadError);
  assert.equal(editor.editorTranslationReadOnly, false);
  assert.deepEqual(editor.editorBlocks.map(block => block.translation), before);
});

test('cached manual warnings remain visible during hydration without rescanning or opening the resolver', async () => {
  const { editor, calls } = loadEditor();
  const desc = description('cached-warnings', 'Term 119', 'คำที่หนึ่ง');
  editor.descs = [desc, description('different-translation', 'Term 119', 'คำที่สอง')];
  const consistency = { blockIndex: 0, level: 'warning', code: 'inconsistent-translation', message: 'Cached inconsistent translation' };
  const terminology = { blockIndex: 0, level: 'warning', code: 'dictionary-terminology', message: 'Cached Dictionary terminology warning' };
  const result = {
    lang: 'Thai', englishLines: [...desc.translations.English], translationLines: [...desc.translations.Thai],
    consistencyDiagnostics: [consistency], terminologyDiagnostics: [terminology],
    warningCount: 2, errorCount: 0, hasDiagnosticWarning: true, hasDiagnosticError: false,
  };
  editor.diagnosticScanCompleted = true;
  editor.diagnosticScanResults = { [desc.filepath]: result };
  let manualScans = 0;
  editor.scanAllDiagnostics = async () => { manualScans++; };
  editor.analyzeDescDiagnostics = () => { manualScans++; return result; };
  const paint = deferred();
  editor.yieldEditorPaint = () => paint.promise;
  const opening = editor.editFile(desc.filepath);
  const block = editor.editorBlocks[0];
  assert.equal(editor.editorTranslationReadOnly, true);
  assert.equal(editor.getEditorDiagnosticScanResult(block, 0), result);
  assert.equal(editor.editorConsistencyDiagnostics[0], consistency);
  assert.equal(editor.blockTerminologyDiagnostics(block, 0)[0], terminology);
  assert.equal(editor.blockDiagnosticWarningCount(block, 0), 2);
  assert.match(editor.blockDiagnosticTitle(block, 'warning', 0), /Cached inconsistent translation/);
  assert.match(editor.blockDiagnosticTitle(block, 'warning', 0), /Cached Dictionary terminology warning/);
  await editor.openConsistencyResolver(0);
  assert.equal(editor.consistencyResolver, null, 'Compare & resolve must wait until the editor is ready.');
  assert.equal(calls.diagnostics, 0);
  assert.equal(manualScans, 0);
  paint.resolve();
  assert.equal(await opening, true, editor.editorLoadError);
  assert.equal(editor.getEditorDiagnosticScanResult(block, 0), result);
  assert.equal(editor.blockDiagnosticWarningCount(block, 0), 2);
  assert.equal(manualScans, 0, 'Hydrating normal diagnostics must preserve the manual scan snapshot.');
  await editor.openConsistencyResolver(0);
  assert.equal(editor.consistencyResolver.versions.length, 2, 'The same action is available once hydration finishes.');
});

test('closing during index construction prevents publication and allows reopening', async () => {
  const { editor } = loadEditor({ controlledClock: true });
  editor.descs = [description('close', 'Term 119')];
  const reachedSlice = deferred(), resume = deferred();
  editor.yieldEditorPaint = async () => {};
  editor.yieldEditorWork = () => { reachedSlice.resolve(); return resume.promise; };
  const opening = editor.editFile(editor.descs[0].filepath);
  await reachedSlice.promise;
  assert.equal(editor.editorLoading, true);
  editor.editorExit();
  resume.resolve();
  assert.equal(await opening, false);
  assert.equal(editor.editorVisible, false);
  assert.equal(editor.editorBlocks.length, 0);
  assert.equal(editor._editorDictionaryIndex, undefined, 'A cancelled partial index cannot be cached.');
  editor.yieldEditorWork = async () => {};
  assert.equal(await editor.editFile(editor.descs[0].filepath), true, editor.editorLoadError);
  assert.equal(editor.editorBlocks[0].HLs[0].dictId, 'word-119');
});

test('rapid file selections only publish the latest requested file', async () => {
  const { editor } = loadEditor();
  editor.descs = [description('old', 'Term 1'), description('latest', 'Term 119')];
  const paints = [];
  editor.yieldEditorPaint = () => { const paint = deferred(); paints.push(paint); return paint.promise; };
  const old = editor.editFile(editor.descs[0].filepath);
  const latest = editor.editFile(editor.descs[1].filepath);
  paints[1].resolve();
  assert.equal(await latest, true, editor.editorLoadError);
  paints[0].resolve();
  assert.equal(await old, false);
  assert.equal(editor.editorCurrentEditingDesc, editor.descs[1]);
  assert.equal(editor.editorBlocks[0].english, 'Term 119');
});

test('preparation errors retain read-only text and a later open can recover', async () => {
  const { editor, window } = loadEditor();
  editor.descs = [description('failure', 'Term 119')];
  const createAsync = window.EditorDictionaryIndex.createAsync;
  window.EditorDictionaryIndex.createAsync = async () => { throw new Error('Fixture indexing failure'); };
  assert.equal(await editor.editFile(editor.descs[0].filepath), false);
  assert.equal(editor.editorVisible, true);
  assert.equal(editor.editorLoading, false);
  assert.match(editor.editorLoadError, /Fixture indexing failure/);
  assert.equal(editor.editorTranslationReadOnly, true);
  assert.equal(editor.editorReady, false);
  assert.equal(editor.editorBlocks[0].english, 'Term 119');
  assert.equal(editor.editorBlocks[0].translation, 'Term 119');
  assert.equal(await editor.editorSave(), false);
  editor.editorExit();
  assert.equal(editor.editorVisible, false);
  window.EditorDictionaryIndex.createAsync = createAsync;
  assert.equal(await editor.editFile(editor.descs[0].filepath), true, editor.editorLoadError);
  assert.equal(editor.editorLoadError, '');
});

test('collaboration claims wait until text can paint and closing cancels their pending open', async () => {
  const { editor, calls } = loadEditor();
  editor.descs = [description('claimed', 'Term 119')];
  const paint = deferred(), claiming = deferred(), claimResult = deferred();
  let claims = 0, leaves = 0;
  editor.yieldEditorPaint = () => paint.promise;
  editor._collaboration = { leaveEdit() { leaves++; }, fileBase() { return {}; } };
  editor.captureCollaborationContext = () => ({});
  editor.collaborationContextCurrent = () => true;
  editor.claimCollaborationFile = async () => { claims++; claiming.resolve(); return claimResult.promise; };
  const opening = editor.editFile(editor.descs[0].filepath);
  assert.equal(editor.editorVisible, true);
  assert.equal(editor.editorLoading, true);
  assert.equal(editor.editorBlocks[0].english, 'Term 119');
  assert.equal(claims, 0, 'Text must be published before requesting a claim.');
  paint.resolve();
  await claiming.promise;
  assert.equal(claims, 1);
  assert.equal(calls.asyncIndexes, 0, 'Dictionary preparation waits for a successful claim.');
  editor.editorExit();
  claimResult.resolve(true);
  assert.equal(await opening, false);
  assert.equal(editor.editorVisible, false);
  assert.equal(editor.editorBlocks.length, 0);
  assert.equal(calls.asyncIndexes, 0);
  assert.equal(editor._openingFile, false);
  assert.ok(leaves >= 1);
});

test('a closed pending claim serializes the next claim without releasing the newly opened file', async () => {
  const { editor } = loadEditor();
  editor.descs = [description('old-claim', 'Term 1'), description('new-claim', 'Term 119')];
  const oldResult = deferred(), nextResult = deferred(), oldStarted = deferred(), nextStarted = deferred();
  const events = [];
  let editing = null;
  editor.yieldEditorPaint = async () => {};
  editor._collaboration = {
    isEditing() { return false; },
    async claim(filepath) {
      events.push(`claim:${filepath}`);
      const old = filepath === editor.descs[0].filepath;
      (old ? oldStarted : nextStarted).resolve();
      const result = await (old ? oldResult : nextResult).promise;
      if (result.granted) editing = filepath;
      return result;
    },
    leaveEdit() { events.push(`leave:${editing}`); editing = null; },
    fileBase(filepath) { return { filepath, translations: [...editor.getDescByFilepath(filepath).translations.Thai] }; },
  };
  const old = editor.editFile(editor.descs[0].filepath);
  await oldStarted.promise;
  editor.editorExit();
  const latest = editor.editFile(editor.descs[1].filepath);
  assert.equal(editor.editorVisible, true);
  assert.equal(editor.editorLoading, true);
  assert.equal(editor.editorCurrentEditingDesc, editor.descs[1]);
  await editor.$nextTick();
  assert.equal(events.filter(event => event.startsWith('claim:')).length, 1, 'The newer text may show while its claim waits.');
  oldResult.resolve({ granted: true });
  assert.equal(await old, false);
  await nextStarted.promise;
  assert.equal(editor._openingFile, editor._editorOpenRun, 'Old cleanup must retain the new request ownership.');
  const beforeNewResponse = events.length;
  nextResult.resolve({ granted: true });
  assert.equal(await latest, true, editor.editorLoadError);
  assert.equal(editing, editor.descs[1].filepath);
  assert.equal(events.slice(beforeNewResponse).some(event => event.startsWith('leave:')), false);
  assert.equal(editor.editorBlocks[0].english, 'Term 119');
  assert.equal(editor._openingFile, false);
});

test('opening during room preparation retains the saved draft ancestor', async () => {
  const { editor } = loadEditor();
  const desc = description('starting-room', 'Term 1', 'ก่อน');
  editor.descs = [desc];
  editor.yieldEditorPaint = async () => {};
  editor._collaboration = {
    isEditing() { return false; },
    async claim() { return { granted: true }; },
    fileBase() { return null; },
    leaveEdit() {},
  };
  assert.equal(await editor.editFile(desc.filepath), true, editor.editorLoadError);
  desc.translations.Thai[0] = 'ใหม่';
  assert.equal(editor._editorCollabBase.filepath, desc.filepath);
  assert.equal(editor._editorCollabBase.translations[0], 'ก่อน');
  assert.equal(editor.editorOriginalTranslations[0], 'ก่อน');
});

test('translation snapshots keep all deferred blocks aligned with the captured collaboration base', async () => {
  const { editor } = loadEditor();
  const desc = description('snapshot', ['Term 1', 'Term 119'], ['ก่อน 1', 'ก่อน 119']);
  editor.descs = [desc];
  const preparing = deferred(), resume = deferred();
  let paints = 0;
  editor.yieldEditorPaint = async () => {
    if (++paints === 2) { preparing.resolve(); await resume.promise; }
  };
  editor._collaboration = {
    isEditing() { return false; },
    async claim() { return { granted: true }; },
    leaveEdit() {},
    fileBase() { return { translations: [...desc.translations.Thai] }; },
  };
  const opening = editor.editFile(desc.filepath);
  await preparing.promise;
  desc.translations.Thai[0] = 'หลัง 1';
  desc.translations.Thai[1] = 'หลัง 119';
  desc.translations.English[1] = 'Term 118';
  resume.resolve();
  assert.equal(await opening, true, editor.editorLoadError);
  assert.deepEqual(Array.from(editor.editorBlocks, block => block.translation), ['ก่อน 1', 'ก่อน 119']);
  assert.deepEqual(Array.from(editor.editorOriginalTranslations), ['ก่อน 1', 'ก่อน 119']);
  assert.deepEqual(Array.from(editor._editorCollabBase.translations), ['ก่อน 1', 'ก่อน 119']);
  assert.equal(editor.editorBlocks[1].english, 'Term 119');
});

test('a successful claim refreshes the visible text and freezes the matching collaboration base before hydration', async () => {
  const { editor, calls } = loadEditor();
  const desc = description('claim-refresh', 'Term 1', 'local translation');
  editor.descs = [desc];
  const firstPaint = deferred(), claimStarted = deferred(), claimResult = deferred();
  const refreshedPaint = deferred(), resume = deferred();
  let paints = 0;
  editor.yieldEditorPaint = async () => {
    if (++paints === 1) await firstPaint.promise;
    else { refreshedPaint.resolve(); await resume.promise; }
  };
  editor._collaboration = {
    isEditing() { return false; },
    async claim() { claimStarted.resolve(); return claimResult.promise; },
    leaveEdit() {},
    fileBase() { return { translations: [...desc.translations.Thai] }; },
  };
  const opening = editor.editFile(desc.filepath);
  assert.equal(editor.editorBlocks[0].translation, 'local translation');
  assert.equal(calls.highlights, 0);
  firstPaint.resolve();
  await claimStarted.promise;
  desc.translations.English = ['Term 119', 'Term 118@Term 117'];
  desc.translations.Thai = ['remote translation', 'remote left@remote right'];
  claimResult.resolve({ granted: true });
  await refreshedPaint.promise;
  assert.equal(editor.editorReady, false);
  assert.deepEqual(Array.from(editor.editorBlocks, block => block.translation), ['remote translation', 'remote left@remote right']);
  assert.deepEqual(Array.from(editor.editorOriginalTranslations), ['remote translation', 'remote left@remote right']);
  assert.deepEqual(Array.from(editor._editorCollabBase.translations), ['remote translation', 'remote left@remote right']);
  assert.equal(editor.editorBlocks[1].tableColumns[1].translation, 'remote right');
  assert.equal(calls.highlights, 0);
  assert.equal(calls.diagnostics, 0);
  const claimedBlocks = [...editor.editorBlocks];
  const claimedColumn = editor.editorBlocks[1].tableColumns[1];
  desc.translations.English[0] = 'Term 116';
  desc.translations.Thai[0] = 'later remote translation';
  resume.resolve();
  assert.equal(await opening, true, editor.editorLoadError);
  assert.equal(editor.editorBlocks[0], claimedBlocks[0]);
  assert.equal(editor.editorBlocks[1], claimedBlocks[1]);
  assert.equal(editor.editorBlocks[1].tableColumns[1], claimedColumn);
  assert.equal(editor.editorBlocks[0].english, 'Term 119');
  assert.equal(editor.editorBlocks[0].translation, 'remote translation');
  assert.equal(editor.editorBlocks[0].HLs[0].dictId, 'word-119');
});

test('changing language or source during preparation dismisses the still-owned loading view', async () => {
  for (const [property, value] of [['lang', 'French'], ['sourceIdentity', 'replacement-source']]) {
    const { editor } = loadEditor({ controlledClock: true });
    editor.descs = [description('context', 'Term 119')];
    const preparing = deferred(), resume = deferred();
    editor.yieldEditorPaint = async () => {};
    editor.yieldEditorWork = () => { preparing.resolve(); return resume.promise; };
    const opening = editor.editFile(editor.descs[0].filepath);
    await preparing.promise;
    editor[property] = value;
    resume.resolve();
    assert.equal(await opening, false, property);
    assert.equal(editor.editorVisible, false, property);
    assert.equal(editor.editorLoading, false, property);
    assert.equal(editor.editorLoadError, '', property);
    assert.equal(editor.editorBlocks.length, 0, property);
  }
});

test('dictionary edits and replacements invalidate cached definitions', async () => {
  const { editor, config, calls } = loadEditor();
  editor.descs = [description('first', 'Term 119')];
  assert.equal(await editor.editFile(editor.descs[0].filepath), true, editor.editorLoadError);
  const firstIndex = editor._editorDictionaryIndex;
  editor.dictionary[119].replace = 'แก้ไข';
  config.watch.dictionary.handler.call(editor);
  assert.equal(editor._editorDictionaryIndex, null);
  assert.equal(await editor.editFile(editor.descs[0].filepath), true, editor.editorLoadError);
  assert.notEqual(editor._editorDictionaryIndex, firstIndex);
  assert.equal(editor.editorBlocks[0].HLs[0].replace, 'แก้ไข');
  editor.dictionary = [{ _id: 'imported', find: 'Term 119', replace: 'นำเข้า', alts: [] }];
  assert.equal(await editor.editFile(editor.descs[0].filepath), true, editor.editorLoadError);
  assert.equal(editor.editorBlocks[0].HLs[0].dictId, 'imported');
  assert.equal(calls.asyncIndexes, 3);
  assert.equal(calls.syncIndexes, 0);
});

test('dictionary mutations during a yielded build restart before publishing matches', async () => {
  const { editor, config, calls } = loadEditor({ controlledClock: true });
  editor.descs = [description('changing', 'Term 119')];
  editor.yieldEditorPaint = async () => {};
  let changed = false;
  editor.yieldEditorWork = async () => {
    if (changed) return;
    changed = true;
    editor.dictionary[119].replace = 'ล่าสุด';
    config.watch.dictionary.handler.call(editor);
  };
  assert.equal(await editor.editFile(editor.descs[0].filepath), true, editor.editorLoadError);
  assert.equal(calls.asyncIndexes, 2);
  assert.equal(editor.editorBlocks[0].HLs[0].replace, 'ล่าสุด');
});

test('large dictionaries match all blocks and table cells while reusing the prepared index', async () => {
  const { editor, calls } = loadEditor({ dictionary: dictionary(20000) });
  const blocks = Array.from({ length: 45 }, (_, i) => `Term ${19950 + i}`);
  blocks.push('Term 19998@Term 19999');
  editor.descs = [description('large', blocks)];
  const started = performance.now();
  const opening = editor.editFile(editor.descs[0].filepath);
  assert.equal(editor.editorBlocks.length, 46, 'All initial text is available before a 20,000-entry index starts.');
  assert.equal(editor.editorBlocks[45].tableColumns[1].translation, 'Term 19999');
  assert.equal(calls.definitions, 0);
  assert.equal(calls.highlights, 0);
  assert.equal(calls.diagnostics, 0);
  assert.equal(await opening, true, editor.editorLoadError);
  assert.equal(editor.editorBlocks.length, 46);
  assert.equal(editor.editorBlocks[0].HLs[0].dictId, 'word-19950');
  const table = editor.editorBlocks[45];
  assert.equal(table.isTable, true);
  assert.equal(table.tableColumns[1].HLs[0].dictId, 'word-19999');
  assert.equal(editor.foundDictionarySet.has('word-19999'), true);
  assert.equal(editor.foundDictionaryDefMap.get('word-19999').has('term 19999'), true);
  assert.equal(editor.visibleDictionary.length, 40);
  assert.equal(editor.dictionaryPageCount, 500);
  assert.equal(editor.filteredDictionary[0]._id, 'word-19950');
  const definitions = calls.definitions;
  assert.equal(definitions, 20000, 'Each entry is normalized once, not once per block.');
  assert.equal(await editor.editFile(editor.descs[0].filepath), true, editor.editorLoadError);
  assert.equal(calls.definitions, definitions, 'A second open reuses the same index.');
  assert.equal(calls.asyncIndexes, 1);
  assert.equal(calls.syncIndexes, 0);
  console.log(`20,000-entry dictionary with 46 blocks, including a table: ${Math.round(performance.now() - started)} ms for two opens (VM fixture).`);
});

test('dictionary pagination preserves complete search and jump-to-entry behavior', async () => {
  const { editor, config, document, calls } = loadEditor();
  editor.editorVisible = true;
  editor.dictionary[119].alts = [{ _id: 'alt-last', find: 'Search alternative', replace: 'Found replacement' }];
  editor.dictionary[119].tlnote = 'Special note';
  assert.equal(editor.visibleDictionary.length, 40);
  editor.setDictionaryPage(3);
  await editor.$nextTick();
  assert.equal(editor.visibleDictionary[39]._id, 'word-119');
  assert.equal(editor.$refs.editorSide.scrollTop, 0);
  for (const query of ['Term 119', 'คำ 119', 'Search alternative', 'Found replacement', 'Special note']) {
    editor.dictionaryFilter = query;
    config.watch.dictionaryFilter.call(editor);
    assert.equal(editor.dictionaryPage, 1);
    assert.equal(editor.filteredDictionary.length, 1, query);
    assert.equal(editor.visibleDictionary[0]._id, 'word-119', query);
  }
  editor.dictionaryFilter = '';
  config.watch.dictionaryFilter.call(editor);
  const selectors = [];
  document.querySelector = selector => {
    selectors.push(selector);
    assert.equal(editor.dictionaryPage, 3, 'Select the target page before looking for its DOM row.');
    return { querySelector() { return { focus() { calls.focused++; }, select() { calls.selected++; } }; } };
  };
  editor.focusDictionaryEntryReplaceInput('word-119', { altId: 'alt-last' });
  await editor.$nextTick();
  await editor.$nextTick();
  assert.equal(editor.dictionaryPage, 3);
  assert.equal(calls.focused, 1);
  assert.equal(calls.selected, 1);
  assert.match(selectors[0], /data-dict-alt-id="alt-last"/);
});

test('adding a dictionary entry from a later page reveals and focuses its row', async () => {
  const { editor, document, calls } = loadEditor();
  editor.editorVisible = true;
  editor.dictionaryPage = 3;
  document.querySelector = selector => {
    const entry = editor.dictionary[0];
    assert.match(selector, new RegExp(entry._id));
    assert.equal(editor.visibleDictionary.includes(entry), true, 'The new row must be on the rendered page when focused.');
    return { querySelector() { return { focus() { calls.focused++; }, select() { calls.selected++; } }; } };
  };
  editor.sideAddClicked();
  await editor.$nextTick();
  await editor.$nextTick();
  assert.equal(editor.dictionary.length, 121);
  assert.equal(editor.dictionaryPage, 1);
  assert.equal(calls.focused, 1);
  assert.equal(calls.selected, 1);
});

test('typing a dictionary Find keeps its row, page and scroll stable while source matches update', async () => {
  const { editor, document } = loadEditor();
  editor.descs = [description('new-term', 'New term')];
  assert.equal(await editor.editFile(editor.descs[0].filepath), true, editor.editorLoadError);
  editor.dictionaryPage = 3;
  const entry = editor.dictionary[119];
  assert.equal(editor.visibleDictionary.includes(entry), true);
  const field = document.activeElement = dictionaryField(entry._id);
  editor.dictionaryEntryFocusIn({ target: field });
  const order = dictionaryIds(editor.filteredDictionary);
  editor.$refs.editorSide.scrollTop = 275;
  for (const find of ['New term', 'Unmatched term', 'New term']) {
    entry.find = find;
    await editor.syncEditorHlterWithDictionaryNow();
    assert.equal(editor.foundDictionarySet.has(entry._id), find === 'New term', 'Highlight matches must remain live while ordering is held.');
    assert.deepEqual(dictionaryIds(editor.filteredDictionary), order);
    assert.equal(editor.dictionaryPage, 3);
    assert.equal(editor.visibleDictionary[39], entry);
    assert.equal(editor.$refs.editorSide.scrollTop, 275);
    assert.equal(document.activeElement, field);
  }
  document.activeElement = null;
  editor.dictionaryEntryFocusOut();
  await editor.$nextTick();
  assert.equal(editor.filteredDictionary[0], entry, 'Matches-first ranking resumes once dictionary editing ends.');
});

test('a new blank dictionary entry stays first while typing despite existing source matches', async () => {
  const { editor, document } = loadEditor();
  editor.descs = [description('new-term', 'Term 119 and New term')];
  await editor.editFile(editor.descs[0].filepath);
  assert.equal(editor.filteredDictionary[0]._id, 'word-119');
  document.querySelector = () => ({
    querySelector() {
      return {
        focus() { document.activeElement = dictionaryField(editor.dictionary[0]._id); },
        select() {},
      };
    },
  });
  editor.sideAddClicked();
  const entry = editor.dictionary[0];
  assert.equal(editor.filteredDictionary[0], entry, 'The insertion must establish its position before the asynchronous focus callback.');
  await editor.$nextTick(); await editor.$nextTick();
  const order = dictionaryIds(editor.filteredDictionary);
  for (const find of ['New term', 'Not in this file']) {
    entry.find = find;
    entry.replace = 'Typed replacement';
    await editor.syncEditorHlterWithDictionaryNow();
    assert.equal(editor.foundDictionarySet.has(entry._id), find === 'New term');
    assert.deepEqual(dictionaryIds(editor.filteredDictionary), order);
    assert.equal(editor.visibleDictionary[0], entry);
    assert.equal(editor.dictionaryPage, 1);
  }
});

test('other rows gaining matches cannot push the edited row across a dictionary page boundary', async () => {
  const { editor, document } = loadEditor();
  editor.descs = [description('new-term', 'New term')];
  await editor.editFile(editor.descs[0].filepath);
  editor.setDictionaryPage(2);
  const entry = editor.dictionary[79];
  const field = document.activeElement = dictionaryField(entry._id);
  editor.dictionaryEntryFocusIn({ target: field });
  assert.equal(editor.visibleDictionary[39], entry);
  const order = dictionaryIds(editor.filteredDictionary);
  editor.dictionary[119].find = 'New term';
  await editor.syncEditorHlterWithDictionaryNow();
  assert.equal(editor.foundDictionarySet.has('word-119'), true);
  assert.deepEqual(dictionaryIds(editor.filteredDictionary), order);
  assert.equal(editor.dictionaryPage, 2);
  assert.equal(editor.visibleDictionary[39], entry);
});

test('dictionary focus transitions retain editing order through fields and rows, then release it on exit', async () => {
  const { editor, document } = loadEditor();
  editor.editorVisible = true;
  const entry = editor.dictionary[119];
  const fields = Array.from({ length: 4 }, () => dictionaryField(entry._id));
  document.activeElement = fields[0];
  editor.dictionaryEntryFocusIn({ target: fields[0] });
  const order = Array.from(editor.dictionaryEditOrder);
  for (const field of fields.slice(1)) {
    editor.dictionaryEntryFocusOut();
    document.activeElement = field;
    editor.dictionaryEntryFocusIn({ target: field });
    await editor.$nextTick();
    assert.equal(editor.dictionaryEditingId, entry._id);
    assert.deepEqual(Array.from(editor.dictionaryEditOrder), order);
  }
  const nextField = dictionaryField('word-118');
  document.activeElement = null;
  editor.dictionaryEntryFocusOut({ relatedTarget: nextField });
  assert.equal(editor.dictionaryEditingId, 'word-118', 'Native relatedTarget must preserve the incoming row before focus settles.');
  await editor.$nextTick();
  assert.equal(editor.dictionaryEditingId, 'word-118', 'Transient body focus must not release a known dictionary transition.');
  assert.deepEqual(Array.from(editor.dictionaryEditOrder), order);
  document.activeElement = nextField;
  editor.dictionaryEntryFocusIn({ target: nextField });
  editor.dictionaryEntryFocusOut();
  document.activeElement = { closest() { return null; } };
  await editor.$nextTick();
  assert.equal(editor.dictionaryEditingId, '');
  assert.equal(editor.dictionaryEditOrder.length, 0);
});

test('inline Dictionary focus fallback preserves row order when relatedTarget is unavailable', async () => {
  const { editor, document } = loadEditor();
  editor.editorVisible = false;
  editor.inlineActive = true;
  editor.sideTab = 'dictionary';
  const entry = editor.dictionary[119];
  const first = dictionaryField(entry._id), replacement = dictionaryField(entry._id);
  document.activeElement = first;
  editor.dictionaryEntryFocusIn({ target: first });
  const order = Array.from(editor.dictionaryEditOrder);
  editor.dictionaryEntryFocusOut({ relatedTarget: null });
  document.activeElement = replacement;
  await editor.$nextTick();
  assert.equal(editor.dictionaryEditingId, entry._id);
  assert.deepEqual(Array.from(editor.dictionaryEditOrder), order);
});

test('editing a filtered dictionary result keeps its row visible when its text stops matching the filter', async () => {
  const { editor, config, document } = loadEditor();
  editor.editorVisible = true;
  editor.dictionaryFilter = 'Term 119';
  config.watch.dictionaryFilter.call(editor);
  const entry = editor.filteredDictionary[0];
  const field = document.activeElement = dictionaryField(entry._id);
  editor.dictionaryEntryFocusIn({ target: field });
  entry.find = 'New spelling';
  entry.replace = 'New replacement';
  assert.deepEqual(dictionaryIds(editor.filteredDictionary), [entry._id]);
  assert.equal(editor.visibleDictionary[0], entry);
  document.activeElement = null;
  editor.dictionaryEntryFocusOut();
  await editor.$nextTick();
  assert.equal(editor.filteredDictionary.length, 0, 'Normal filtering resumes after leaving the edited row.');
});

test('shared dictionary replacement preserves editing order while rendering current objects and appended entries', async () => {
  const { editor, document } = loadEditor();
  editor.descs = [description('new-term', 'New term')];
  await editor.editFile(editor.descs[0].filepath);
  const oldEntry = editor.dictionary[39];
  const field = document.activeElement = dictionaryField(oldEntry._id);
  editor.dictionaryEntryFocusIn({ target: field });
  const order = dictionaryIds(editor.filteredDictionary);
  const replacement = Array.from(editor.dictionary, entry => ({ ...entry, alts: [] })).reverse();
  const liveEntry = replacement.find(entry => entry._id === oldEntry._id);
  liveEntry.replace = 'Updated shared translation';
  replacement.find(entry => entry._id === 'word-119').find = 'New term';
  const remoteEntry = { _id: 'remote-new', find: 'Another shared term', replace: 'Shared translation', alts: [], tlnote: '' };
  editor.dictionary = [remoteEntry, ...replacement];
  await editor.syncEditorHlterWithDictionaryNow();
  assert.deepEqual(dictionaryIds(editor.filteredDictionary), [...order, remoteEntry._id]);
  assert.equal(editor.visibleDictionary[39], liveEntry, 'Ordering must resolve IDs against current objects instead of retaining detached snapshots.');
  assert.equal(editor.visibleDictionary[39].replace, 'Updated shared translation');
  editor.visibleDictionary[39].replace = 'Typed after shared update';
  assert.equal(liveEntry.replace, 'Typed after shared update');
  assert.notEqual(oldEntry.replace, liveEntry.replace);
  assert.equal(document.activeElement, field);
});

test('explicit dictionary search, page, tab and editor navigation release held editing order', async () => {
  const { editor, config, document } = loadEditor();
  editor.descs = [description('first', 'Term 119'), description('second', 'Term 0')];
  await editor.editFile(editor.descs[0].filepath);
  const begin = () => editor.beginDictionaryEdit('word-119');
  const released = () => {
    assert.equal(editor.dictionaryEditingId, '');
    assert.equal(editor.dictionaryEditOrder.length, 0);
  };
  begin();
  editor.dictionaryEntryFocusOut();
  document.activeElement = { closest() { return null; } };
  await editor.$nextTick();
  editor.dictionaryFilter = 'Term';
  config.watch.dictionaryFilter.call(editor);
  released();
  begin();
  editor.setDictionaryPage(2);
  released();
  begin();
  editor.sideTab = 'regex';
  config.watch.sideTab.call(editor);
  released();
  editor.sideTab = 'dictionary';
  begin();
  await editor.editFile(editor.descs[1].filepath);
  released();
  begin();
  await editor.editorExit();
  config.watch.editorVisible.call(editor, editor.editorVisible);
  released();
  assert.equal(editor.editorVisible, false);
});

test('Dictionary creation paints and focuses its row before preparing matches, keeping translation fields editable', async () => {
  const { editor, document, calls } = loadEditor({ dictionary: dictionary(20000) });
  editor.descs = [description('keyword', '[FreshTerm] Term 19999')];
  await editor.editFile(editor.descs[0].filepath);
  assert.equal(editor.filteredDictionary[0]._id, 'word-19999');
  const pause = deferred();
  editor.yieldEditorWork = () => pause.promise;
  document.querySelector = () => ({ querySelector() { return { focus() { calls.focused++; }, select() { calls.selected++; } }; } });
  const prior = { sync: calls.syncIndexes, async: calls.asyncIndexes, focus: calls.focused };
  const entry = editor.ensureDictionaryKeywordTag('FreshTerm', '', 'ใหม่');
  assert.equal(editor.filteredDictionary[0]._id, entry.dictId, 'Keyword creation must pin its new row ahead of existing source matches before focus.');
  await editor.$nextTick(); await editor.$nextTick();
  assert.equal(entry.created, true);
  assert.equal(calls.focused, prior.focus + 1);
  assert.equal(calls.syncIndexes, prior.sync, 'Adding must not expand the index in the click handler.');
  assert.equal(calls.asyncIndexes, prior.async, 'The new row gets a paint opportunity before index preparation.');
  assert.equal(editor.editorLoading, false);
  assert.equal(editor.editorTranslationReadOnly, false);
  pause.resolve();
  assert.equal(await editor._dictionaryRefreshPending, true);
  assert.equal(calls.syncIndexes, prior.sync);
  assert.equal(calls.asyncIndexes, prior.async + 1);
  assert.equal(editor.editorBlocks[0].HLs[0].dictId, entry.dictId);
  assert.equal(editor.filteredDictionary[0]._id, entry.dictId);
  assert.equal(editor.browserWorkTooltip, '');
});

test('Dictionary refresh cancels when the file closes without publishing highlights into another editor', async () => {
  const { editor, calls } = loadEditor({ controlledClock: true });
  editor.descs = [description('original', 'Term 119'), description('next', 'Term 0')];
  await editor.editFile(editor.descs[0].filepath);
  const pause = deferred();
  editor.yieldEditorWork = () => pause.promise;
  const highlights = calls.highlights;
  const pending = editor.syncEditorHlterWithDictionaryNow();
  await editor.$nextTick();
  editor.editorVisible = false;
  editor.editorBlocks = [];
  pause.resolve();
  assert.equal(await pending, false);
  assert.equal(calls.highlights, highlights);
  assert.equal(editor.browserWorkTooltip, '');
});

test('Dictionary refresh yields between blocks, reads newer translation input, and replaces only the matches', async () => {
  const { editor } = loadEditor({ controlledClock: true });
  editor.descs = [description('many', Array.from({ length: 8 }, () => 'Term 119'))];
  await editor.editFile(editor.descs[0].filepath);
  const blocks = editor.editorBlocks, last = blocks.at(-1);
  let yields = 0;
  editor.yieldEditorWork = async () => {
    if (++yields === 3) last.translation = 'Typed during match refresh';
  };
  await editor.syncEditorHlterWithDictionaryNow();
  assert.ok(yields > 3, 'Both index preparation and block refresh should give other input work a turn.');
  assert.equal(editor.editorBlocks, blocks);
  assert.equal(editor.editorBlocks.at(-1), last);
  assert.equal(last.translation, 'Typed during match refresh');
  assert.match(last.translationHLter, /Typed during match refresh/);
  assert.equal(editor.editorTranslationReadOnly, false);
});

test('game-scoped entries and All fallback control indexed and fallback highlights, autocomplete and ranking', () => {
  const entries = [
    { _id: 'foreign', find: 'Fire', replace: 'PoE1 fire', gameScope: 'poe1', alts: [] },
    { _id: 'fallback', find: ' Fire ', replace: 'All fire', alts: [{ find: 'SharedFlame', replace: 'All alternate' }] },
    { _id: 'cold', find: 'Cold', replace: 'All cold', alts: [] },
    { _id: 'specific', find: 'Fire', replace: 'PoE2 fire', gameScope: 'poe2', alts: [{ find: 'Burning', replace: 'PoE2 alternate' }] },
    { _id: 'foreign-only', find: 'PoE1Only', replace: 'Foreign', gameScope: 'poe1', alts: [] },
  ];
  const { editor, window } = loadEditor({ dictionary: entries });
  editor.gameVersion = 'poe2'; editor.editorVisible = true;
  for (const indexed of [true, false]) {
    if (!indexed) window.EditorDictionaryIndex = null;
    const plain = editor.buildEnglishHLter('Fire SharedFlame Burning PoE1Only Cold');
    assert.deepEqual(Array.from(plain.HLs, hl => [hl.dictId, hl.replace]), [
      ['specific', 'PoE2 fire'], ['specific', 'PoE2 alternate'], ['cold', 'All cold'],
    ], indexed ? 'Indexed' : 'Fallback');
    const keyword = editor.buildEnglishHLter('[Fire]');
    assert.equal(keyword.HLs[0].replace, '[Fire|PoE2 fire]');
    assert.deepEqual(Array.from(keyword.HLs[0].dictIds), ['specific']);
    editor.editorBlocks = [{ HLs: plain.HLs.concat(keyword.HLs) }];
    assert.deepEqual(Array.from(new Set(editor.buildHlPopupItems(0).map(item => item.dictEntryId))), ['specific', 'cold']);
    assert.deepEqual(dictionaryIds(editor.visibleDictionary), ['cold', 'specific', 'foreign', 'fallback', 'foreign-only']);
    assert.equal(editor.isDictionaryEntryFound(entries[0]), false);
    assert.equal(editor.isDictionaryEntryFound(entries[1]), false);
    assert.match(editor.dictionaryEntryScopeWarning(entries[0]), /PoE1.*Excluded from PoE2/);
    assert.equal(editor.dictionaryEntryScopeWarning(entries[1]), '');
    editor.dictionaryFilter = 'PoE1Only';
    assert.deepEqual(dictionaryIds(editor.filteredDictionary), ['foreign-only'], 'Other-game entries remain searchable.');
    editor.dictionaryFilter = '';
  }
});

test('changing games rebuilds a cached index and cancels an asynchronously built old-game index', async () => {
  const entries = [
    { _id: 'one', find: 'Fire', replace: 'one', gameScope: 'poe1', alts: [] },
    { _id: 'two', find: 'Fire', replace: 'two', gameScope: 'poe2', alts: [] },
    ...dictionary(30),
  ];
  const { editor, calls, config } = loadEditor({ dictionary: entries, controlledClock: true });
  assert.equal(editor.buildEnglishHLter('Fire').HLs[0].dictId, 'one');
  const firstIndex = editor._editorDictionaryIndex;
  editor.gameVersion = 'poe2';
  assert.equal(editor.buildEnglishHLter('Fire').HLs[0].dictId, 'two');
  assert.notEqual(editor._editorDictionaryIndex, firstIndex, 'The game belongs in cache identity even if no watcher ran.');
  editor.gameVersion = 'poe1'; config.watch.gameVersion.call(editor);
  let switched = false;
  editor.yieldEditorWork = async () => {
    if (!switched) { switched = true; editor.gameVersion = 'poe2'; }
  };
  assert.equal(await editor.prepareEditorDictionaryIndex(() => true), true);
  assert.ok(calls.asyncIndexes >= 2, 'Discard the old game snapshot after a yield.');
  assert.equal(editor._editorDictionaryGame, 'poe2');
  assert.equal(editor.buildEnglishHLter('Fire').HLs[0].dictId, 'two');
});

test('changing an entry scope holds its row and excludes stale suggestions and paste actions immediately', () => {
  const { editor, document } = loadEditor({ dictionary: [
    { _id: 'cold', find: 'Cold', replace: 'cold', alts: [] },
    { _id: 'fire', find: 'Fire', replace: 'fire', alts: [] },
  ] });
  editor.editorVisible = true;
  const result = editor.buildEnglishHLter('Fire');
  editor.editorBlocks = [{ HLs: result.HLs }];
  const entry = editor.dictionary[1];
  document.activeElement = dictionaryField(entry._id);
  editor.dictionaryEntryFocusIn({ target: document.activeElement });
  const order = dictionaryIds(editor.filteredDictionary);
  const oldSuggestion = editor.buildHlPopupItems(0)[0];
  editor.setDictionaryEntryScope(entry, 'poe2');
  assert.deepEqual(dictionaryIds(editor.filteredDictionary), order, 'A selector change keeps the current editing order.');
  assert.equal(editor.isDictionaryEntryFound(entry), false);
  assert.equal(editor.buildHlPopupItems(0).length, 0, 'Old highlights cannot reintroduce a foreign suggestion.');
  let inserts = 0;
  editor.insertTranslationText = () => { inserts++; };
  editor.insertHlPopupItem(oldSuggestion);
  editor.copySpanToTranslation({ target: { getAttribute(name) { return name === 'data-hl-id' ? result.HLs[0]._hlId : 'fire'; } } }, editor.editorBlocks[0], 0);
  editor.hotkeyPasteHL({ code: 'Digit1' }, editor.editorBlocks[0], 0);
  assert.equal(inserts, 0);
  editor.endDictionaryEdit();
  assert.deepEqual(dictionaryIds(editor.filteredDictionary), ['cold', 'fire']);
  editor.setDictionaryEntryScope(entry, 'all');
  assert.equal(editor.dictionaryEntryScope(entry), 'all');
  assert.equal(Object.hasOwn(entry, 'gameScope'), false, 'All remains compatible with the legacy representation.');
});

test('new entries use the current game and keyword creation does not modify the other game entry', () => {
  const { editor } = loadEditor({ dictionary: [
    { _id: 'foreign', find: 'Fire', replace: 'one', gameScope: 'poe1', alts: [] },
  ] });
  editor.gameVersion = 'poe2';
  editor.syncEditorHlterWithDictionaryNow = () => {};
  editor.focusDictionaryEntryReplaceInput = () => {};
  const item = { kwTagName: 'Fire', kwDynamicContent: 'Burning', value: '[Fire|Burning]' };
  assert.equal(editor.canCreateDictionaryEntryFromHlPopupItem(item), true);
  assert.equal(editor.hlPopupCtrlEnterPillText(item), 'Ctrl+Enter Add');
  const created = editor.ensureDictionaryKeywordTag('Fire', 'Burning', 'two');
  assert.equal(created.created, true);
  assert.equal(editor.dictionary[0].gameScope, 'poe2');
  assert.notEqual(created.dictId, 'foreign');
  assert.equal(editor.dictionary[1].alts.length, 0);
  assert.equal(editor.canCreateDictionaryEntryFromHlPopupItem(item), false);
  editor.addVocab();
  assert.equal(editor.dictionary[0].gameScope, 'poe2');
});

test('imported duplicate IDs are repaired without losing either Find or overwriting a reserved identity', () => {
  const { editor } = loadEditor({ dictionary: [
    { _id: 'shared', find: 'Fire', replace: 'one', gameScope: 'poe1' },
    { _id: 'shared', find: 'Fire', replace: 'two', gameScope: 'poe2' },
    { _id: 'shared~2', find: 'Cold', replace: 'cold' },
  ] });
  editor.ensureDictionaryIds();
  assert.deepEqual(dictionaryIds(editor.dictionary), ['shared', 'shared~3', 'shared~2']);
  editor.ensureDictionaryIds();
  assert.deepEqual(dictionaryIds(editor.dictionary), ['shared', 'shared~3', 'shared~2'], 'Assigned IDs stay stable on repeated normalization.');
  assert.equal(editor.dictionary[2].gameScope, undefined, 'Legacy entries retain their All representation.');
  editor.beginDictionaryEdit('shared~3');
  assert.equal(editor.visibleDictionary.length, 3);
});

test('autocomplete reuses the prepared Dictionary index without scans and keeps live TL notes', async () => {
  const entries = dictionary(20000);
  const { editor, calls } = loadEditor({ dictionary: entries, cacheDictionaryScope: true });
  await editor.prepareEditorDictionaryIndex(() => true);
  const indexes = calls.asyncIndexes + calls.syncIndexes;
  let scans = 0;
  entries.find = () => { scans++; assert.fail('Autocomplete must not scan the full Dictionary.'); };
  editor.getActiveDictionaryEntries = () => { scans++; assert.fail('Keyword selection must reuse the prepared index.'); };
  editor.hlPopup.visible = true;
  editor.hlPopup.filtered = [
    { dictEntryId: 'word-19999', kwTagName: 'Term 19999', value: '[Term 19999]' },
    { dictEntryId: 'word-19998', kwTagName: 'Term 19998', value: '[Term 19998]' },
  ];
  entries[19999].tlnote = 'Live selected note';
  const started = performance.now();
  for (let index = 0; index < 200; index++) {
    editor.moveHlPopupSelection(1);
    const item = editor.hlPopupSelectedItem;
    assert.equal(editor.getDictionaryEntryById(item.dictEntryId), entries[19999 - editor.hlPopup.selectedIndex]);
    assert.equal(editor.findActiveDictionaryKeywordEntry(item.kwTagName), editor.getDictionaryEntryById(item.dictEntryId));
    assert.equal(editor.canCreateDictionaryEntryFromHlPopupItem(item), false);
    assert.equal(editor.hlPopupTlnote, editor.hlPopup.selectedIndex ? '' : 'Live selected note');
  }
  console.log(`20,000-entry Dictionary: 200 cached autocomplete selections in ${Math.round(performance.now() - started)} ms (VM fixture).`);
  entries[19999].tlnote = 'Changed note';
  editor.hlPopup.selectedIndex = 0;
  assert.equal(editor.hlPopupTlnote, 'Changed note');
  assert.equal(scans, 0);
  assert.equal(calls.asyncIndexes + calls.syncIndexes, indexes, 'Arrow navigation must not rebuild the Dictionary index.');
});

test('autocomplete lookup rejects replaced, invalidated, and other-game prepared indexes', () => {
  const { editor } = loadEditor({ dictionary: [
    { _id: 'one', find: 'Fire', replace: 'one', gameScope: 'poe1', alts: [] },
    { _id: 'two', find: 'Fire', replace: 'two', gameScope: 'poe2', alts: [] },
  ] });
  editor.getEditorDictionaryIndex();
  assert.equal(editor.findActiveDictionaryKeywordEntry('Fire')._id, 'one');
  editor.gameVersion = 'poe2';
  assert.equal(editor.getPreparedEditorDictionaryIndex(), null);
  assert.equal(editor.findActiveDictionaryKeywordEntry('Fire')._id, 'two');
  editor.getEditorDictionaryIndex();
  editor.dictionary = [{ _id: 'replacement', find: 'Fire', replace: 'new', alts: [] }];
  assert.equal(editor.getPreparedEditorDictionaryIndex(), null);
  assert.equal(editor.getDictionaryEntryById('two'), undefined);
  assert.equal(editor.findActiveDictionaryKeywordEntry('Fire')._id, 'replacement');
  editor.getEditorDictionaryIndex();
  editor.dictionary[0].find = 'Cold';
  editor.invalidateEditorDictionaryIndex();
  assert.equal(editor.getPreparedEditorDictionaryIndex(), null);
  assert.equal(editor.findActiveDictionaryKeywordEntry('Fire'), undefined);
  assert.equal(editor.findActiveDictionaryKeywordEntry('Cold')._id, 'replacement');
});

test('rendering autocomplete action hints does not create a Dictionary return action', () => {
  const { editor } = loadEditor({ dictionary: [] });
  const item = { kwTagName: 'Fire', value: '[Fire]', mustCreate: true };
  const previous = { dictEntryId: 'earlier-action' };
  editor.hlPopupReturnInfo = previous;
  assert.equal(editor.hlPopupCtrlEnterPillText(item), 'Ctrl+Enter Add');
  assert.equal(editor.hlPopupReturnInfo, previous, 'Rendering a hint must not mutate state or schedule a second render.');
  editor.hlPopup.visible = true;
  editor.hlPopup.filtered = [item];
  editor.ensureDictionaryKeywordTag = () => ({ created: true });
  assert.equal(editor.createDictionaryEntryFromHlPopupSelection(), true);
  assert.equal(editor.hlPopupReturnInfo, item, 'An explicit create action still remembers its insertion target.');
});

test('autocomplete Dictionary page lookup reuses positions and refreshes on ordering changes', () => {
  const { editor } = loadEditor();
  const first = dictionary(120);
  const second = first.slice().reverse();
  // Exercise the method with a stable computed-view result, as Vue supplies it.
  const view = { filteredDictionary: first, dictionaryPageSize: 40, dictionaryPage: 1 };
  editor.revealDictionaryEntry.call(view, 'word-119');
  assert.equal(view.dictionaryPage, 3);
  const positions = view._popupDictionaryPositions;
  editor.revealDictionaryEntry.call(view, 'word-1');
  assert.equal(view.dictionaryPage, 1);
  assert.equal(view._popupDictionaryPositions, positions);
  view.filteredDictionary = second;
  editor.revealDictionaryEntry.call(view, 'word-119');
  assert.equal(view.dictionaryPage, 1);
  assert.notEqual(view._popupDictionaryPositions, positions);
  editor.revealDictionaryEntry.call(view, 'unknown');
  assert.equal(view.dictionaryPage, 1);
});

test('Dictionary scope, matches-first ordering and filtering scan raw entries while visible edits stay reactive', () => {
  const fixture = trackedDictionary(dictionary(20000));
  const { editor } = loadEditor({ dictionary: fixture.dictionary, toRaw: fixture.toRaw, cacheDictionaryScope: true });
  editor.editorVisible = true;
  editor.editorBlocks = [{ HLs: [{ dictId: 'word-19999' }, { dictId: 'word-19998' }] }];
  const view = editor.dictionaryScopeView;
  assert.equal(editor.getActiveDictionaryEntries()[0], fixture.entries[0]);
  assert.equal(editor.activeDictionaryIds.has('word-19999'), true);
  assert.equal(editor.orderedDictionary[0], fixture.entries[19998]);
  editor.dictionaryFilter = 'Term 19999';
  assert.equal(editor.filteredDictionary[0], fixture.entries[19999]);
  const visible = editor.visibleDictionary[0];
  assert.equal(visible, fixture.dictionary[19999]);
  assert.notEqual(visible, fixture.entries[19999], 'Only the visible row is resolved through the reactive array.');
  visible.replace = 'Edited through v-model';
  visible.alts.push({ find: 'New alternate', replace: 'Live alternate' });
  assert.equal(fixture.entries[19999].replace, 'Edited through v-model');
  assert.equal(fixture.entries[19999].alts[0].replace, 'Live alternate');
  assert.ok(fixture.counts.writes >= 2);
  assert.ok(fixture.counts.reads < 200, `Ordering/filtering must not traverse 20,000 proxies (${fixture.counts.reads} reads).`);
  assert.equal(editor.dictionaryScopeView, view);
});

test('raw Dictionary view refreshes after in-place edits, source replacement and game changes without losing held order', () => {
  const fixture = trackedDictionary([
    { _id: 'shared', find: 'Fire', replace: 'fallback', alts: [], tlnote: '' },
    { _id: 'one', find: 'Fire', replace: 'one', gameScope: 'poe1', alts: [], tlnote: '' },
    { _id: 'two', find: 'Fire', replace: 'two', gameScope: 'poe2', alts: [], tlnote: '' },
  ]);
  const { editor, config } = loadEditor({ dictionary: fixture.dictionary, toRaw: fixture.toRaw, cacheDictionaryScope: true });
  editor.scheduleSettingsSave = () => {};
  editor.editorVisible = true;
  const firstView = editor.dictionaryScopeView;
  const entry = editor.findActiveDictionaryKeywordEntry('Fire');
  assert.equal(entry, fixture.dictionary[1]);
  assert.notEqual(entry, fixture.entries[1], 'Keyword actions must receive a reactive entry.');
  editor.beginDictionaryEdit('one');
  const order = dictionaryIds(editor.filteredDictionary);
  entry.find = 'Cold'; entry.tlnote = 'Updated note';
  config.watch.dictionary.handler.call(editor);
  assert.notEqual(editor.dictionaryScopeView, firstView);
  assert.equal(editor.findActiveDictionaryKeywordEntry('Fire'), fixture.dictionary[0]);
  assert.equal(editor.findActiveDictionaryKeywordEntry('Cold'), entry);
  assert.deepEqual(dictionaryIds(editor.filteredDictionary), order);
  const replacement = fixture.wrap([
    { ...fixture.entries[0], replace: 'remote fallback' },
    { ...fixture.entries[1], replace: 'remote replacement' },
    fixture.entries[2],
    { _id: 'new', find: 'Added remotely', replace: 'new', alts: [] },
  ]);
  editor.dictionary = replacement;
  assert.deepEqual(dictionaryIds(editor.filteredDictionary), [...order, 'new']);
  assert.equal(editor.visibleDictionary.find(word => word._id === 'one'), replacement[1]);
  editor.gameVersion = 'poe2';
  assert.equal(editor.findActiveDictionaryKeywordEntry('Fire'), replacement[2]);
  assert.equal(editor.activeDictionaryIds.has('one'), false);
  editor.setDictionaryEntryScope(replacement[2], 'poe1');
  assert.equal(editor.findActiveDictionaryKeywordEntry('Fire'), replacement[0], 'Explicit scope changes exclude suggestions immediately.');
});

test('visible and keyword Dictionary rows preserve exact identity before imported IDs are normalized', () => {
  const fixture = trackedDictionary([
    { find: 'Fire', replace: 'first', alts: [] },
    { find: 'Cold', replace: 'second', alts: [] },
    { _id: 'duplicate', find: 'Ice', replace: 'third', alts: [] },
    { _id: 'duplicate', find: 'Flame', replace: 'fourth', alts: [] },
  ]);
  const { editor } = loadEditor({ dictionary: fixture.dictionary, toRaw: fixture.toRaw, cacheDictionaryScope: true });
  assert.deepEqual(Array.from(editor.visibleDictionary), Array.from(fixture.dictionary));
  assert.equal(editor.findActiveDictionaryKeywordEntry('Cold'), fixture.dictionary[1]);
  assert.equal(editor.findActiveDictionaryKeywordEntry('Flame'), fixture.dictionary[3]);
});

test('gemlevel links reuse base Dictionary Find and autocomplete preserves every level', () => {
  for (const indexed of [false, true]) {
    const entries = [{ _id: 'cry', find: 'BattlemagesCry', replace: 'คำรามนักรบเวท', alts: [
      { _id: 'cry-alt', find: "Battlemage's Cry", replace: "คำรามนักรบเวท (Battlemage's Cry)" },
    ] }];
    const { editor } = loadEditor({ dictionary: entries });
    if (!indexed) {
      editor.getEditorDictionaryIndex = () => null;
      editor.getPreparedEditorDictionaryIndex = () => null;
    } else {
      editor.getEditorDictionaryIndex();
    }
    for (const level of ['{0}', '{1}', '20']) {
      const identity = `BattlemagesCry<gemlevel=${level}>`;
      assert.equal(editor.findActiveDictionaryKeywordEntry(identity), entries[0]);
      const english = `[${identity}|Battlemage's Cry]`;
      const { HLs, englishHLter } = editor.buildEnglishHLter(english);
      assert.equal(HLs.length, 1);
      assert.equal(HLs[0].dictId, 'cry');
      assert.deepEqual(Array.from(HLs[0].dictIds), ['cry']);
      assert.equal(HLs[0].replace, `[${identity}|คำรามนักรบเวท (Battlemage's Cry)]`);
      assert.ok(englishHLter.includes('&lt;gemlevel='));
      assert.equal(englishHLter.includes('<gemlevel='), false, 'Metadata must be rendered as text.');
      editor.editorBlocks = [{ english, translation: '', HLs }];
      const items = editor.buildHlPopupItems(0);
      assert.equal(items.length, 2);
      assert.equal(items[0].value, `[${identity}|คำรามนักรบเวท (Battlemage's Cry)]`);
      assert.equal(items[0].dictEntryId, 'cry');
      assert.equal(items[0].kwTagName, identity);
      assert.equal(items.some(item => item.mustCreate), false);
      assert.equal(items.every(item => item.value.startsWith(`[${identity}|`)), true);
      assert.equal(editor.canCreateDictionaryEntryFromHlPopupItem(items[0]), false);

      const noDisplay = editor.buildEnglishHLter(`[${identity}]`);
      editor.editorBlocks = [{ english: `[${identity}]`, translation: '', HLs: noDisplay.HLs }];
      const noDisplayItems = editor.buildHlPopupItems(0);
      assert.equal(noDisplayItems[0].value, `[${identity}|คำรามนักรบเวท]`);
      assert.equal(noDisplayItems.some(item => item.mustCreate), false);
    }
    assert.equal(editor.findActiveDictionaryKeywordEntry('BattlemagesCry<other={0}>'), undefined);
    assert.equal(editor.findActiveDictionaryKeywordEntry('BattlemagesCry<gemlevel={x}>'), undefined);
  }
});

test('creating or adding Dictionary alternatives strips gemlevel only from Find', () => {
  const { editor } = loadEditor({ dictionary: [] });
  editor.syncEditorHlterWithDictionaryNow = () => {};
  editor.focusDictionaryEntryReplaceInput = () => {};
  const identity = 'BattlemagesCry<gemlevel={0}>';
  const item = { value: `[${identity}|Battlemage's Cry]`, kwTagName: identity, kwDynamicContent: "Battlemage's Cry" };
  assert.equal(editor.canCreateDictionaryEntryFromHlPopupItem(item), true);
  const created = editor.ensureDictionaryKeywordTag(identity, item.kwDynamicContent, 'คำรามนักรบเวท');
  assert.equal(created.created, true);
  assert.equal(editor.dictionary.length, 1);
  assert.equal(editor.dictionary[0].find, 'BattlemagesCry');
  assert.equal(editor.dictionary[0].alts[0].find, "Battlemage's Cry");
  assert.equal(editor.canCreateDictionaryEntryFromHlPopupItem(item), false);
  const existing = editor.ensureDictionaryKeywordTag('BattlemagesCry<gemlevel=20>', 'War Cry', 'คำราม');
  assert.equal(existing.created, false);
  assert.equal(existing.addedAlt, true);
  assert.equal(editor.dictionary.length, 1);
  assert.ok(editor.dictionary[0].alts.some(alt => alt.find === 'War Cry'));
  const parsed = editor.parseKeywordPopupTagText(item.value);
  assert.equal(parsed.tagName, identity, 'Dictionary return insertion must retain the complete identity.');
});
