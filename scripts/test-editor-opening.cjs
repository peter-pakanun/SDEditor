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
      markRaw(value) { return value; }, toRaw(value) { return value; },
    },
  });
  for (const name of ['helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'editorDictionaryIndex.js', 'collaborationIntegration.js', 'index.js']) {
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
  for (const [name, getter] of Object.entries(config.computed)) {
    Object.defineProperty(editor, name, { get: () => getter.call(editor) });
  }
  return { editor, config, calls, document, window };
}

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

test('highlight refresh keeps a focused dictionary entry visible when matching moves it to an earlier page', async () => {
  const { editor, document } = loadEditor();
  editor.descs = [description('new-term', 'New term')];
  assert.equal(await editor.editFile(editor.descs[0].filepath), true, editor.editorLoadError);
  editor.dictionaryPage = 3;
  const entry = editor.dictionary[119];
  assert.equal(editor.visibleDictionary.includes(entry), true);
  document.activeElement = { closest() { return { getAttribute() { return entry._id; } }; } };
  entry.find = 'New term';
  await editor.syncEditorHlterWithDictionaryNow();
  assert.equal(editor.foundDictionarySet.has(entry._id), true);
  assert.equal(editor.filteredDictionary[0], entry);
  assert.equal(editor.dictionaryPage, 1);
  assert.equal(editor.visibleDictionary.includes(entry), true, 'The refresh must adjust the page in the same update as the match reorder.');
});

test('Dictionary creation paints and focuses its row before preparing matches, keeping translation fields editable', async () => {
  const { editor, document, calls } = loadEditor({ dictionary: dictionary(20000) });
  editor.descs = [description('keyword', '[FreshTerm]')];
  await editor.editFile(editor.descs[0].filepath);
  const pause = deferred();
  editor.yieldEditorWork = () => pause.promise;
  document.querySelector = () => ({ querySelector() { return { focus() { calls.focused++; }, select() { calls.selected++; } }; } });
  const prior = { sync: calls.syncIndexes, async: calls.asyncIndexes, focus: calls.focused };
  const entry = editor.ensureDictionaryKeywordTag('FreshTerm', '', 'ใหม่');
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
