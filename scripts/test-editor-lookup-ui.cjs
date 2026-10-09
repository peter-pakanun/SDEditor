const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const template = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const panelStart = template.indexOf('<section v-show="sideTab === \'lookup\'');
const panelEnd = template.indexOf('<section v-if="sideTab === \'comments\'', panelStart);
const lookupPanel = template.slice(panelStart, panelEnd);

function loadEditor() {
  let config;
  const calls = { focus: 0, select: 0, save: 0, navigate: 0, exit: 0, shiftEnter: 0 };
  const document = { activeElement: null, body: { tagName: 'BODY' } };
  const window = { location: { search: '?testMode=1&lang=Thai' }, CloudUI: { mixin: {} } };
  const context = vm.createContext({
    window, document, URLSearchParams, console, setTimeout, clearTimeout,
    Vue: {
      defineComponent(value) { config = value; return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; },
      nextTick(callback) { callback?.(); return Promise.resolve(); },
    },
  });
  for (const name of ['workspaceState.js', 'statDescCodec.js', 'helper.js', 'regexEngine.js', 'editorLookup.js', 'collaborationIntegration.js', 'index.js']) {
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
  assert.doesNotMatch(lookupPanel, /Search all loaded files without leaving your draft\.|Loaded source and saved translations/);
  assert.doesNotMatch(lookupPanel, /v-model="(?:lang|editorBlocks[^" ]*)"/);
  assert.doesNotMatch(lookupPanel, /(?:editFile|editorSave|saveAndSkipFile|commentsOpenFile)\(/);
  const sidebar = template.slice(template.indexOf('<div class="sideTabs">'), template.indexOf('<div v-if="sideTab === \'dictionary\'">'));
  const orderedTabs = ['dictionary', 'lookup', 'regex', 'history', 'comments']
    .map(tab => sidebar.indexOf(`sideTab === '${tab}'`));
  assert.ok(orderedTabs.every((position, index) => position >= 0 && (!index || position > orderedTabs[index - 1])),
    'Sidebar tabs must remain Dictionary, Lookup, Regex, History, Comments');
  assert.ok(template.indexOf('src="editorLookup.js"') < template.indexOf('src="index.js"'));
});
