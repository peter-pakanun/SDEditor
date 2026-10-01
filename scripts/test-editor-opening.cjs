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
  const calls = { asyncIndexes: 0, syncIndexes: 0, definitions: 0, focused: 0, selected: 0, settings: 0 };
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
  const getPairs = editor.getDictionaryDefinitionPairs;
  editor.getDictionaryDefinitionPairs = function (...args) { calls.definitions++; return getPairs.apply(this, args); };
  for (const [name, getter] of Object.entries(config.computed)) {
    Object.defineProperty(editor, name, { get: () => getter.call(editor) });
  }
  return { editor, config, calls, document, window };
}

test('opening publishes a disabled shell before dictionary work and blocks Save', async () => {
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
  assert.equal(editor.editorBlocks.length, 0);
  assert.equal(calls.asyncIndexes, 0, 'Dictionary work must wait until the shell can paint.');
  assert.equal(calls.definitions, 0);
  assert.equal(await editor.editorSave(), false);
  assert.equal(calls.settings, 0);
  paint.resolve();
  assert.equal(await opening, true, editor.editorLoadError);
  assert.equal(editor.editorLoading, false);
  assert.equal(editor.editorTranslationReadOnly, false);
  assert.equal(editor.editorBlocks[0].HLs[0].dictId, 'word-119');
  assert.equal(calls.syncIndexes, 0, 'Opening must use the cooperative index builder.');
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

test('preparation errors leave a closeable error shell and a later open can recover', async () => {
  const { editor, window } = loadEditor();
  editor.descs = [description('failure', 'Term 119')];
  const createAsync = window.EditorDictionaryIndex.createAsync;
  window.EditorDictionaryIndex.createAsync = async () => { throw new Error('Fixture indexing failure'); };
  assert.equal(await editor.editFile(editor.descs[0].filepath), false);
  assert.equal(editor.editorVisible, true);
  assert.equal(editor.editorLoading, false);
  assert.match(editor.editorLoadError, /Fixture indexing failure/);
  assert.equal(editor.editorTranslationReadOnly, true);
  assert.equal(await editor.editorSave(), false);
  editor.editorExit();
  assert.equal(editor.editorVisible, false);
  window.EditorDictionaryIndex.createAsync = createAsync;
  assert.equal(await editor.editFile(editor.descs[0].filepath), true, editor.editorLoadError);
  assert.equal(editor.editorLoadError, '');
});

test('collaboration claims wait behind the shell and closing cancels their pending open', async () => {
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
  assert.equal(claims, 0, 'The shell must be published before requesting a claim.');
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
  assert.equal(events.filter(event => event.startsWith('claim:')).length, 1, 'The newer shell may show while its claim waits.');
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
  assert.equal(await editor.editFile(editor.descs[0].filepath), true, editor.editorLoadError);
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
  editor.syncEditorHlterWithDictionaryNow();
  assert.equal(editor.foundDictionarySet.has(entry._id), true);
  assert.equal(editor.filteredDictionary[0], entry);
  assert.equal(editor.dictionaryPage, 1);
  assert.equal(editor.visibleDictionary.includes(entry), true, 'The refresh must adjust the page in the same update as the match reorder.');
});
