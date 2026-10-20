const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const template = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
  + fs.readFileSync(path.join(publicDir, 'editorComponents.js'), 'utf8');
const panelStart = template.indexOf('<section v-show="sideTab === \'lookup\'');
const panelEnd = template.indexOf('<section v-if="sideTab === \'comments\'', panelStart);
const lookupPanel = template.slice(panelStart, panelEnd);

function loadEditor() {
  let config;
  const calls = { focus: 0, select: 0, save: 0, navigate: 0, exit: 0, shiftEnter: 0 };
  const document = { activeElement: null, body: { tagName: 'BODY' } };
  const window = { location: { search: '?testMode=1&lang=Thai' }, CloudUI: { mixin: {} } };
  const context = vm.createContext({
    window, document, URLSearchParams, console, setTimeout, clearTimeout, AbortController,
    Vue: {
      defineComponent(value) { config = value; return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; },
      nextTick(callback) { callback?.(); return Promise.resolve(); },
    },
  });
  for (const name of ['workspaceState.js', 'statDescCodec.js', 'helper.js', 'regexEngine.js', 'editorLookup.js', 'editorSession.js', 'collaborationIntegration.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(publicDir, name), 'utf8'), context, { filename: name });
  }
  const editor = Object.assign({}, ...config.mixins.map(mixin => mixin.data?.() || {}), config.data(),
    ...config.mixins.map(mixin => mixin.methods || {}), config.methods, {
      lang: 'Thai', editorVisible: true, editorLoading: false,
      hideDNT: true, gameVersionSelected: true, loadingProgress: 100, needsInitialSettings: false,
      $nextTick(callback) { callback?.(); return Promise.resolve(); },
      $refs: { lookupSearchInput: {
        focus() { calls.focus++; document.activeElement = this; },
        select() { calls.select++; },
      } },
    });
  for (const [name, getter] of Object.entries(Object.assign({}, ...config.mixins.map(mixin => mixin.computed || {}), config.computed))) {
    Object.defineProperty(editor, name, { get: () => getter.call(editor) });
  }
  editor.editorSave = () => { calls.save++; };
  editor.saveAndSkipFile = () => { calls.navigate++; };
  editor.editorEsc = () => { calls.exit++; };
  editor.editorShiftEnter = () => { calls.shiftEnter++; };
  return { editor, config, calls, document, window };
}

function description(name, translations = {}) {
  return {
    filepath: `test/${name}.txt`, filedir: 'test', filename: `${name}.txt`,
    translations: { English: ['Blade damage'], Thai: ['คำแปลที่บันทึกไว้'], French: ['Dégâts de lame'], ...translations },
    stats: ['blade_damage'], hasChanges: true, isMissing: false, needsReview: false,
  };
}

function event(key, overrides = {}) {
  return {
    key, code: key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...overrides,
  };
}

function dispatchLookupKey(editor, keyEvent) {
  assert.match(lookupPanel, /@keydown\.stop="lookupPanelKeydown"/);
  keyEvent.stopPropagation();
  editor.lookupPanelKeydown(keyEvent);
  if (!keyEvent.propagationStopped) {
    if (keyEvent.key === 'Escape') editor.editorEsc(keyEvent);
    if (keyEvent.shiftKey && keyEvent.key === 'Enter') editor.editorShiftEnter(keyEvent);
    editor.handleKeydown(keyEvent);
  }
}

test('Lookup opens and focuses search without saving or replacing the draft', () => {
  const { editor, calls } = loadEditor();
  const current = description('current');
  const blocks = [{ english: 'Blade damage', translation: 'Unsaved translation' }];
  editor.editorCurrentEditingDesc = current;
  editor.editorBlocks = blocks;
  editor.commentsFileDraft = 'Comment draft';
  editor.openEditorLookup();
  assert.equal(editor.sideTab, 'lookup');
  assert.equal(calls.focus, 1);
  assert.equal(editor.editorCurrentEditingDesc, current);
  assert.equal(editor.editorBlocks, blocks);
  assert.equal(editor.commentsFileDraft, 'Comment draft');
  assert.equal(calls.save, 0);
  assert.equal(calls.navigate, 0);
});

test('configured global search shortcut focuses Lookup rather than dictionary', () => {
  const { editor, calls, document } = loadEditor();
  editor.sideTab = 'lookup';
  editor.$refs.dictionaryFilterInput = { focus() { assert.fail('Dictionary must not receive focus'); } };
  for (const [filterShortcutCtrlD, code] of [[false, 'KeyF'], [true, 'KeyD']]) {
    editor.filterShortcutCtrlD = filterShortcutCtrlD;
    document.activeElement = null;
    const keyEvent = event(code.slice(3).toLowerCase(), { code, ctrlKey: true });
    editor.handleKeydown(keyEvent);
    assert.equal(keyEvent.defaultPrevented, true);
  }
  assert.equal(calls.focus, 2);
  assert.equal(calls.select, 2);
});

test('inline global search shortcuts retain the file session and target its active helper filter', () => {
  const { editor, calls, document } = loadEditor();
  editor.editorVisible = false;
  editor.inlineActive = true;
  editor.sideTab = 'lookup';
  editor.$refs.searchInput = { focus() { assert.fail('Workspace search would leave the inline editing context'); } };
  for (const [filterShortcutCtrlD, code] of [[false, 'KeyF'], [true, 'KeyD']]) {
    editor.filterShortcutCtrlD = filterShortcutCtrlD;
    document.activeElement = { tagName: 'TEXTAREA' };
    const key = event(code === 'KeyF' ? 'f' : 'd', { code, ctrlKey: true });
    editor.handleKeydown(key);
    assert.equal(key.defaultPrevented, true);
    assert.equal(document.activeElement, editor.$refs.lookupSearchInput);
    assert.equal(editor.inlineActive, true);
  }
  assert.equal(calls.focus, 2);
  assert.equal(calls.save, 0);
  assert.equal(calls.exit, 0);
});

test('Lookup search is recognized as a search box and panel shortcut retains focus', () => {
  const { editor, calls, document } = loadEditor();
  editor.sideTab = 'lookup';
  document.activeElement = editor.$refs.lookupSearchInput;
  assert.equal(editor.isActiveElementInSearchBox(), true);
  const keyEvent = event('f', { code: 'KeyF', ctrlKey: true });
  dispatchLookupKey(editor, keyEvent);
  assert.equal(keyEvent.defaultPrevented, true);
  assert.equal(calls.focus, 1);
});

test('Lookup keyboard controls cannot save, discard, or navigate the translation draft', () => {
  const { editor, calls } = loadEditor();
  editor.sideTab = 'lookup';
  for (const keyEvent of [
    event('s', { code: 'KeyS', ctrlKey: true }), event('s', { code: 'KeyS', metaKey: true }),
    event('F1'), event('F2'), event('<', { code: 'Comma', ctrlKey: true }),
    event('>', { code: 'Period', ctrlKey: true }), event('Enter', { shiftKey: true }),
    event(' ', { code: 'Space', ctrlKey: true }), event('i', { code: 'KeyI', ctrlKey: true }),
    event('Escape'),
  ]) {
    dispatchLookupKey(editor, keyEvent);
    assert.equal(keyEvent.propagationStopped, true);
  }
  assert.equal(calls.save, 0);
  assert.equal(calls.navigate, 0);
  assert.equal(calls.exit, 0);
  assert.equal(calls.shiftEnter, 0);
});

test('Escape clears only Lookup search and IME Escape leaves it intact', () => {
  const { editor, calls } = loadEditor();
  editor.sideTab = 'lookup';
  editor.searchText = 'Workspace filter';
  editor.lookupQuery = 'Blade';
  editor.lookupAppliedQuery = 'Blade';
  const composingEscape = event('Escape', { isComposing: true });
  dispatchLookupKey(editor, composingEscape);
  assert.equal(editor.lookupQuery, 'Blade');
  assert.equal(composingEscape.defaultPrevented, false);
  const escape = event('Escape');
  dispatchLookupKey(editor, escape);
  assert.equal(editor.lookupQuery, '');
  assert.equal(editor.lookupAppliedQuery, '');
  assert.equal(editor.searchText, 'Workspace filter');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(calls.exit, 0);
});

test('native selection, copying, and ordinary control keys remain available in Lookup', () => {
  const { editor } = loadEditor();
  for (const keyEvent of [
    event('c', { code: 'KeyC', ctrlKey: true }), event('a', { code: 'KeyA', ctrlKey: true }),
    event('Tab'), event('ArrowDown'), event('Enter'),
  ]) {
    dispatchLookupKey(editor, keyEvent);
    assert.equal(keyEvent.defaultPrevented, false);
  }
});

test('Lookup filters close with Escape, restore focus and retain query, choices, selection and draft', () => {
  const { editor, document, calls } = loadEditor();
  const opener = { isConnected: true, focus() { document.activeElement = this; } };
  editor.$refs.lookupFiltersButton = opener;
  editor.sideTab = 'lookup'; editor.lookupQuery = 'Retained query'; editor.lookupSelectedFilepath = 'reference.txt';
  editor.lookupFiltersVisible = true; editor.lookupScope = 'english'; editor.lookupTranslatedOnly = true;
  editor.editorBlocks = [{ translation: 'Unsaved draft' }]; document.activeElement = opener;
  dispatchLookupKey(editor, event('Escape', { isComposing: true }));
  assert.equal(editor.lookupFiltersVisible, true, 'IME Escape must not close filters');
  dispatchLookupKey(editor, event('Escape'));
  assert.equal(editor.lookupFiltersVisible, false);
  assert.equal(document.activeElement, opener);
  assert.equal(editor.lookupQuery, 'Retained query'); assert.equal(editor.lookupSelectedFilepath, 'reference.txt');
  assert.equal(editor.lookupScope, 'english'); assert.equal(editor.lookupTranslatedOnly, true);
  assert.equal(editor.editorBlocks[0].translation, 'Unsaved draft');
  assert.equal(calls.save + calls.exit + calls.navigate, 0);
});

test('inactive Lookup and scope changes close filters without restoring focus to another session', () => {
  const { editor, config } = loadEditor();
  editor.$refs.lookupFiltersButton = { focus() { assert.fail('Do not focus a previous session'); } };
  editor.sideTab = 'lookup'; editor.lookupFiltersVisible = true;
  config.mixins.find(mixin => mixin.watch?.lookupPanelActive).watch.lookupPanelActive.call(editor, false);
  assert.equal(editor.lookupFiltersVisible, false);
  editor.lookupFiltersVisible = true;
  config.mixins.find(mixin => mixin.watch?.lookupSessionKey).watch.lookupSessionKey.call(editor);
  assert.equal(editor.lookupFiltersVisible, false);
});

test('Lookup uses the main-search filter pattern and removes expansion without duplicating panel ownership', () => {
  assert.doesNotMatch(lookupPanel, /Expand Lookup|lookupDialog|lookupExpanded|<teleport/);
  assert.match(lookupPanel, /ref="lookupFiltersButton" class="filterToggle"/);
  assert.match(lookupPanel, /:aria-expanded="lookupFiltersVisible" aria-controls="editorLookupFilters"/);
  assert.match(lookupPanel, /v-tooltip="'Lookup filters'"/);
  assert.match(lookupPanel, /<fieldset v-show="lookupFiltersVisible" id="editorLookupFilters"/);
  assert.ok(lookupPanel.indexOf('</fieldset>') < lookupPanel.indexOf('class="lookupPagination'));
  assert.match(lookupPanel, /class="clearSearch" @click="lookupClearSearch" :disabled="!lookupQuery"/);
  assert.match(lookupPanel, /aria-label="Previous reference results" v-tooltip="'Previous reference results'"/);
});

test('copy preserves exact literal text, reports clipboard failure and ignores stale completion', async () => {
  const { editor, window } = loadEditor();
  editor.sideTab = 'lookup'; editor.lookupSelectedFilepath = 'reference.txt';
  const literal = 'Raw \\n\r\n@<img> ภาษาไทย ' + 'long '.repeat(1000);
  let copied;
  window.navigator = { clipboard: { async writeText(text) { copied = text; } } };
  await editor.lookupCopyText(literal, 'English text');
  assert.equal(copied, literal); assert.equal(editor.lookupCopyStatus, 'Copied English text.');
  window.navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); };
  await editor.lookupCopyText(literal, 'English text');
  assert.match(editor.lookupCopyStatus, /Select the text/);
  let finish;
  window.navigator.clipboard.writeText = () => new Promise(done => { finish = done; });
  const copy = editor.lookupCopyText(literal, 'English text');
  editor.lookupSelectedFilepath = 'another-reference.txt'; finish(); await copy;
  assert.equal(editor.lookupCopyStatus, '', 'An old copy must not announce success for another reference');
});

test('Lookup boundary paging moves focus before disabling its arrow and never saves a draft', () => {
  const { editor, calls, document } = loadEditor();
  editor.sideTab = 'lookup'; editor.descs = Array.from({ length: 23 }, (_, i) => description(String(i)));
  editor.lookupQuery = 'Blade'; editor.lookupApplySearch();
  const arrow = { matches: selector => selector === ':focus' };
  const list = editor.$refs.lookupResultsList = { focus() { document.activeElement = this; } };
  document.activeElement = arrow;
  editor.lookupGoToPage(2, { currentTarget: arrow });
  assert.equal(editor.lookupCurrentPage, 2); assert.equal(document.activeElement, list);
  document.activeElement = arrow;
  editor.lookupGoToPage(1, { currentTarget: arrow });
  assert.equal(editor.lookupCurrentPage, 1); assert.equal(document.activeElement, list);
  assert.equal(calls.save + calls.navigate + calls.exit, 0);
});

test('cancelling preparation retains focus before its control disappears, while background cancellation leaves focus alone', () => {
  const { editor, document } = loadEditor();
  editor.sideTab = 'lookup'; editor.lookupPreparing = true;
  const aborter = editor._lookupPreparationAbort = new AbortController();
  const toggle = editor.$refs.lookupFiltersButton = { focus() { assert.equal(editor.lookupPreparing, true); document.activeElement = this; } };
  editor.lookupCancelPreparation({ currentTarget: { matches: () => true } });
  assert.equal(document.activeElement, toggle); assert.equal(aborter.signal.aborted, true); assert.equal(editor.lookupPreparing, false);
  document.activeElement = null; editor.lookupCancelPreparation(); assert.equal(document.activeElement, null);
});

test('finishing preparation retains focus before a focused Cancel control disappears', async () => {
  const { window, document } = loadEditor(); window.document = document;
  let finish;
  const cancel = { matches: () => true };
  const model = { ...window.EditorLookup.mixin.data(), ...window.EditorLookup.mixin.methods,
    editorVisible: true, sideTab: 'lookup', lang: 'Thai', lookupPreparationAvailable: true,
    lookupLoadCatalog: () => new Promise(done => { finish = done; }), $refs: {} };
  const toggle = model.$refs.lookupFiltersButton = { focus() { assert.equal(model.lookupPreparing, true); document.activeElement = this; } };
  model.$refs.lookupPreparation = { contains: node => node === cancel };
  const work = model.lookupPrepareReferences();
  document.activeElement = cancel; finish(true); assert.equal(await work, true);
  assert.equal(model.lookupPreparing, false); assert.equal(document.activeElement, toggle);
});

test('reference language and selection leave saved text, editor language, and draft untouched', () => {
  const { editor, window } = loadEditor();
  const current = description('current');
  const reference = description('reference');
  editor.descs = [current, reference];
  editor.localDescs = { descs: [reference] };
  editor.editorCurrentEditingDesc = current;
  editor.editorBlocks = [{ english: 'Blade damage', translation: 'Unsaved translation' }];
  editor.sideTab = 'lookup';
  const before = JSON.stringify({ descs: editor.descs, localDescs: editor.localDescs, blocks: editor.editorBlocks });
  editor.lookupQuery = 'reference'; editor.lookupApplySearch();
  editor.lookupSelect(reference.filepath);
  editor.lookupLanguage = 'French';
  window.EditorLookup.mixin.watch.lookupLanguage.call(editor);
  assert.equal(editor.lookupSelectedReference.blocks[0].translation, 'Dégâts de lame');
  assert.equal(editor.lang, 'Thai');
  assert.equal(editor.editorCurrentEditingDesc, current);
  assert.equal(JSON.stringify({ descs: editor.descs, localDescs: editor.localDescs, blocks: editor.editorBlocks }), before);
});

test('workspace refresh invalidates saved lookup matches without consulting the current draft', () => {
  const { editor } = loadEditor();
  const current = description('current');
  editor.descs = [current];
  editor.sideTab = 'lookup';
  editor.editorCurrentEditingDesc = current;
  editor.editorBlocks = [{ english: 'Blade damage', translation: 'Draft only phrase' }];
  editor.lookupQuery = 'Draft only phrase';
  editor.lookupApplySearch();
  assert.equal(editor.lookupResultCount, 0);
  editor.localDescs.descs = [{ filepath: current.filepath, translations: { Thai: ['New saved phrase'] }, hasChanges: true }];
  editor.applyWorkspaceOverlay();
  editor.lookupQuery = 'New saved phrase';
  editor.lookupApplySearch();
  assert.equal(editor.lookupResultCount, 1);
  editor.lookupSelect(current.filepath);
  assert.equal(editor.lookupSelectedReference.blocks[0].translation, 'New saved phrase');
  assert.equal(editor.editorBlocks[0].translation, 'Draft only phrase');
});

test('workspace refresh updates another reference language while retaining identical selected-language inputs', () => {
  const { editor } = loadEditor();
  const current = description('current'); editor.descs = [current];
  editor.sideTab = 'lookup'; editor.lookupLanguage = 'French';
  editor.lookupQuery = 'New French reference'; editor.lookupApplySearch();
  assert.equal(editor.lookupResultCount, 0);
  const selectedText = current.translations.Thai;
  editor.localDescs.descs = [{ filepath: current.filepath,
    translations: { Thai: [...selectedText], French: ['New French reference'] } }];
  editor.applyWorkspaceOverlay();
  assert.equal(current.translations.Thai, selectedText);
  assert.equal(editor.lookupResultCount, 1);
  editor.lookupSelect(current.filepath);
  assert.equal(editor.lookupSelectedReference.blocks[0].translation, 'New French reference');
});

test('Lookup panel uses literal text, independent controls, and persistent accessible reference sections', () => {
  assert.ok(panelStart >= 0 && panelEnd > panelStart);
  assert.equal(lookupPanel.includes('v-html'), false, 'Source and translations must render through text interpolation');
  assert.match(lookupPanel, /v-for="\(part, pi\) in result\.filepathParts"/);
  assert.match(lookupPanel, /v-for="\(part, pi\) in result\.englishParts"/);
  assert.match(lookupPanel, /v-for="\(part, pi\) in result\.translationParts"/);
  assert.match(lookupPanel, /<mark v-if="part\.matched" class="lookupQueryMatch">\{\{ part\.text \}\}<\/mark>/);
  assert.match(lookupPanel, /\{\{ block\.english \|\|/);
  assert.match(lookupPanel, /\{\{ block\.translation \|\|/);
  assert.match(lookupPanel, /v-model="lookupLanguage"/);
  assert.match(lookupPanel, /v-model="lookupQuery"/);
  assert.match(lookupPanel, /aria-label="Reference search results"/);
  assert.match(lookupPanel, /aria-label="Selected reference"/);
  assert.match(lookupPanel, /<ct-context :host="\$props\.controller" :items="lookupSelectedReference\.referenceMetadata \|\| \[\]"><\/ct-context>/);
  assert.ok(lookupPanel.indexOf('<ct-context')>lookupPanel.indexOf('{{ lookupSelectedReference.filepath }}'));
  assert.ok(lookupPanel.indexOf('<ct-context')<lookupPanel.indexOf('lookupSelectedReference.developerNotes'));
  assert.doesNotMatch(lookupPanel,/v-for="item in lookupSelectedReference\.referenceMetadata/);
  assert.doesNotMatch(lookupPanel, /Search all loaded files without leaving your draft\.|Loaded source and saved translations/);
  assert.doesNotMatch(lookupPanel, /v-model="(?:lang|editorBlocks[^" ]*)"/);
  assert.doesNotMatch(lookupPanel, /(?:editFile|editorSave|saveAndSkipFile|commentsOpenFile)\(/);
  const sidebar = template.slice(template.indexOf('<div class="sideTabs">'), template.indexOf('<div v-if="sideTab === \'dictionary\'"'));
  const orderedTabs = ['dictionary', 'lookup', 'tm', 'history', 'comments']
    .map(tab => sidebar.indexOf(`sideTab === '${tab}'`));
  assert.ok(orderedTabs.every((position, index) => position >= 0 && (!index || position > orderedTabs[index - 1])),
    'Shared sidebar tabs must retain the SD Dictionary, Lookup, TM, History, Comments order');
  assert.ok(template.indexOf('src="editorLookup.js"') < template.indexOf('src="index.js"'));
});
