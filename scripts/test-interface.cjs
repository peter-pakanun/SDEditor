const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fakeTimers() {
  const pending = new Map();
  let now = 0, nextId = 1;
  return {
    setTimeout(callback, delay = 0, ...args) {
      const id = nextId++;
      pending.set(id, { at: now + Math.max(0, Number(delay) || 0), callback, args });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    advance(milliseconds) {
      const until = now + milliseconds;
      while (true) {
        const next = [...pending].filter(([, timer]) => timer.at <= until)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!next) break;
        const [id, timer] = next;
        pending.delete(id); now = timer.at;
        timer.callback(...timer.args);
      }
      now = until;
    },
    get pendingCount() { return pending.size; },
  };
}

function loadEditor() {
  let config;
  const directives = {};
  let searchFocusCount = 0;
  const timers = fakeTimers();
  const context = vm.createContext({
    window: { location: { search: '?testMode=1&lang=Thai' }, CloudUI: { mixin: {} } },
    URLSearchParams, console, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    document: { activeElement: null, body: { tagName: 'BODY' } },
    Vue: {
      defineComponent(value) { config = value; return value; },
      createApp() { return { component() {}, directive(name, value) { directives[name] = value; }, mount() {} }; },
      nextTick(callback) { callback?.(); return Promise.resolve(); },
    },
  });
  for (const name of ['workspaceState.js', 'helper.js', 'regexEngine.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'), context, { filename: name });
  }
  const editor = Object.assign(config.data(), config.methods, {
    lang: 'Thai', hideDNT: false, gameVersionSelected: true,
    loadingProgress: 100, needsInitialSettings: false,
    $nextTick(callback) { callback?.(); return Promise.resolve(); },
    $refs: { searchInput: { focus() { searchFocusCount++; } } },
  });
  for (const [name, getter] of Object.entries(config.computed)) {
    Object.defineProperty(editor, name, { get: () => getter.call(editor) });
  }
  return { editor, config, context, directives, timers, searchFocusCount: () => searchFocusCount };
}

function description(name, flags = {}, english = `English ${name}`, thai = `ภาษาไทย ${name}`) {
  return {
    filepath: `test/${name}.txt`, filedir: 'test', filename: `${name}.txt`,
    translations: { English: [english], Thai: [thai] },
    isMissing: false, hasChanges: false, isDropped: false, isDNT: false,
    ...flags,
  };
}

const names = rows => Array.from(rows, row => row.filename.replace(/\.txt$/, ''));
const defaultStatuses = ['missing', 'saved', 'revised', 'dropped', 'diagnosticError', 'diagnosticWarning'];

test('Revised filters changed existing translations separately from initial fills and saved baseline files', () => {
  const { editor } = loadEditor();
  editor.descs = [
    description('missing', { isMissing: true }),
    description('baseline-saved', { hasChanges: true }),
    description('initial-fill', { hasChanges: true, isRevised: false }),
    description('changed-existing', { hasChanges: true, isRevised: true }),
    description('dropped', { isDropped: true, isMissing: true }),
  ];
  assert.ok(editor.fileFilterOptions.some(option => option.key === 'revised'));
  editor.selectedFileFilters = ['revised']; editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['changed-existing']);
  assert.equal(editor.statistic.hasChanges, 3);
  assert.equal(editor.statistic.isRevised, 1);
  assert.equal(editor.statistic.isMissing, 2);
  assert.equal(editor.statistic.isDropped, 1);
  editor.selectedFileFilters = ['saved']; editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['baseline-saved', 'initial-fill', 'changed-existing']);
  editor.selectedFileFilters = ['dropped']; editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['dropped']);
});

test('Dropped counts unresolved copies beside complete ZIP translations and ignores stale projected status flags', () => {
  const { editor, context } = loadEditor();
  const W = context.window.WorkspaceState;
  const baseline = description('complete-with-copy', {}, 'Current English', 'Current ZIP translation');
  baseline.translations.German = ['Aktuelle ZIP Übersetzung'];
  const previous = JSON.parse(JSON.stringify(baseline));
  previous.translations.English = ['Old English']; previous.translations.Thai = ['Old dropped translation'];
  editor.gameVersion = 'poe1'; editor.sourceIdentity = 'source-current';
  editor.workspaceSource = () => [baseline];
  editor.workspaceSourceFile = filepath => filepath === baseline.filepath ? baseline : null;
  editor.localDescs = { sourceHash: editor.sourceIdentity, descs: [], status: {} };
  W.initializeWorkspace(editor.localDescs, { source: [baseline], sourceHash: editor.sourceIdentity, game: 'poe1', language: 'Thai' });
  W.dropTranslation(editor.localDescs, previous, 'Thai', {
    game: 'poe1', originSourceHash: 'source-old', targetSourceHash: editor.sourceIdentity,
  });
  editor.descs = [{ ...JSON.parse(JSON.stringify(baseline)), hasChanges: true, isRevised: true, isMissing: true, isDropped: false }];
  editor.selectedFileFilters = ['dropped']; editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['complete-with-copy']);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.statistic)), { hasChanges: 0, isRevised: 0, isMissing: 0, isDropped: 1 });
  assert.equal(editor.filteredDescs[0].isDropped, true);
  assert.equal(editor.filteredDescs[0].hasChanges, false); assert.equal(editor.filteredDescs[0].isRevised, false); assert.equal(editor.filteredDescs[0].isMissing, false);
  editor.lang = 'German'; editor.filterDesc();
  assert.equal(editor.filteredDescs.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.statistic)), { hasChanges: 0, isRevised: 0, isMissing: 0, isDropped: 0 });
  editor.lang = 'Thai'; editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['complete-with-copy']);
  assert.equal(editor.statistic.isDropped, 1);
});

test('Revised filtering derives original Missing and resolved Dropped exclusions per language after workspace reload', () => {
  const { editor, context } = loadEditor();
  const W = context.window.WorkspaceState;
  const missing = description('original-missing', {}, 'English Missing', '');
  const correction = description('original-complete', {}, 'English Complete', 'Original complete translation');
  const dropped = description('resolved-dropped', {}, 'English Dropped', 'Complete current ZIP translation');
  const source = [missing, correction, dropped];
  for (const file of source) file.translations.German = ['Original German translation'];
  editor.gameVersion = 'poe1'; editor.sourceIdentity = 'revised-current';
  editor.workspaceSource = () => source;
  editor.workspaceSourceFile = filepath => source.find(file => file.filepath === filepath) || null;
  editor.localDescs = { sourceHash: editor.sourceIdentity, descs: [], status: {} };
  W.initializeWorkspace(editor.localDescs, { source, sourceHash: editor.sourceIdentity, game: 'poe1', language: 'Thai' });
  const candidate = W.dropTranslation(editor.localDescs, dropped, 'Thai', {
    game: 'poe1', originSourceHash: 'revised-previous', targetSourceHash: editor.sourceIdentity,
    translations: ['Preserved previous translation'],
  });
  for (const [file, translation] of [[missing, 'First complete translation'], [correction, 'First correction'], [dropped, 'Accepted preserved translation']]) {
    W.stageTranslation(editor.localDescs, { filepath: file.filepath, translations: [translation] }, 'Thai', {
      source: file, sourceHash: editor.sourceIdentity, game: 'poe1',
      ...(file === dropped ? { promoteDropped: { id: candidate.id, revision: candidate.revision, targetSourceHash: editor.sourceIdentity } } : {}),
    });
    W.stageTranslation(editor.localDescs, { filepath: file.filepath, translations: ['Later correction for ' + file.filename] }, 'Thai', {
      source: file, sourceHash: editor.sourceIdentity, game: 'poe1',
    });
  }
  editor.localDescs = JSON.parse(JSON.stringify(editor.localDescs));
  editor.descs = source.map(file => ({ ...JSON.parse(JSON.stringify(file)), hasChanges: false,
    isRevised: file !== correction, isMissing: true, isDropped: true }));
  editor.selectedFileFilters = ['revised']; editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['original-complete']);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.statistic)), { hasChanges: 3, isRevised: 1, isMissing: 0, isDropped: 0 });
  editor.selectedFileFilters = ['saved']; editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['original-missing', 'original-complete', 'resolved-dropped']);
  editor.lang = 'German'; editor.filterDesc();
  assert.equal(editor.filteredDescs.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.statistic)), { hasChanges: 0, isRevised: 0, isMissing: 0, isDropped: 0 });
  editor.lang = 'Thai'; editor.selectedFileFilters = ['revised']; editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['original-complete']);
});

test('an older Review filter selection migrates to Dropped without hiding unresolved copies', () => {
  const { editor } = loadEditor();
  statusFixtures(editor);
  editor.selectedFileFilters = ['review']; editor.filterDesc();
  assert.deepEqual(Array.from(editor.selectedFileFilters), ['dropped']);
  assert.deepEqual(names(editor.filteredDescs), ['dropped', 'overlap']);
  assert.equal(editor.fileFilterOptions.some(option => option.key === 'review'), false);
});

test('an older Edited filter selection maps to the Revised category without retaining the old UI name', () => {
  const { editor } = loadEditor();
  editor.descs = [description('correction', { hasChanges: true, isRevised: true }),
    description('fill', { hasChanges: true, isRevised: false })];
  editor.selectedFileFilters = ['edited']; editor.filterDesc();
  assert.deepEqual(Array.from(editor.selectedFileFilters), ['revised']);
  assert.deepEqual(names(editor.filteredDescs), ['correction']);
  assert.equal(editor.fileFilterOptions.some(option => option.key === 'edited'), false);
});

test('the status bar includes Revised and shares red, orange, purple, and green status colors across themes', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/interface.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  for (const tone of ['missing', 'dropped', 'revised', 'saved', 'error', 'warning']) {
    assert.match(css, new RegExp('\\.statusPill\\.' + tone + '\\s+\\.statusDot\\s*\\{[^}]*color:\\s*var\\(--ui-' + tone + '\\)'));
    assert.match(html, new RegExp('class="statusPill ' + tone + '"'));
  }
  assert.match(html, /class="statusPill revised"[^>]*>[\s\S]*?Revised <strong>\{\{ statistic\.isRevised \}\}/);
  assert.match(html, /class="statusPill dropped"[^>]*>[\s\S]*?Dropped <strong>\{\{ statistic\.isDropped \}\}/);
  assert.doesNotMatch(html, /class="statusPill review"/);
  const declarations = block => Object.fromEntries(Array.from(block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), match => [match[1], match[2].trim()]));
  const root = declarations(css.match(/:root\s*\{([^}]*)\}/)[1]);
  function hue(value) {
    const normalized = value.replace('#', '');
    assert.match(normalized, /^[a-f\d]{6}$/i, value);
    const [r, g, b] = [0, 2, 4].map(index => parseInt(normalized.slice(index, index + 2), 16) / 255);
    const maximum = Math.max(r, g, b), delta = maximum - Math.min(r, g, b);
    assert.ok(delta > 0.05, 'Status colors must remain distinguishable from neutral grey.');
    let result = maximum === r ? (g - b) / delta : maximum === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return ((result * 60) + 360) % 360;
  }
  for (const theme of ['grey', 'dark', 'modern-dark']) {
    const block = css.match(new RegExp('\\[data-theme="' + theme + '"\\]\\s*\\{([^}]*)\\}'))?.[1] || '';
    const palette = { ...root, ...declarations(block) };
    const resolve = name => palette[name].startsWith('var(') ? resolve(palette[name].slice(4, -1)) : palette[name];
    const red = hue(resolve('--ui-missing')), orange = hue(resolve('--ui-dropped'));
    const purple = hue(resolve('--ui-revised')), green = hue(resolve('--ui-saved'));
    assert.ok(red < 15 || red > 340, theme + ' Missing/Error red');
    assert.ok(orange >= 15 && orange < 55, theme + ' Dropped/Warning orange');
    assert.ok(purple >= 250 && purple <= 310, theme + ' Revised purple');
    assert.ok(green >= 90 && green <= 165, theme + ' Saved green');
    assert.equal(resolve('--ui-error'), resolve('--ui-missing'));
    assert.equal(resolve('--ui-warning'), resolve('--ui-dropped'));
  }
});

test('changing game in Settings waits for the selected dictionary and durable preferences', async () => {
  const { editor } = loadEditor();
  let finishLanguage;
  editor.showSetting = true; editor.gameVersion = 'poe1'; editor.settingsGameVersion = 'poe2';
  editor._cloudLanguageSwitch = new Promise(resolve => { finishLanguage = resolve; });
  const events = [];
  editor.saveSettings = async () => { events.push('saved'); return true; };
  editor.selectGameVersion = async game => { events.push(game); editor.gameVersion = game; };
  const closing = editor.settingsSaveClose();
  await Promise.resolve();
  assert.equal(events.length, 0);
  assert.equal(editor.showSetting, true);
  finishLanguage(true);
  await closing;
  assert.deepEqual(events, ['saved', 'poe2']);
  assert.equal(editor.showSetting, false);
  assert.equal(editor.settingsSaving, false);
});

test('failed dictionary selection or preferences keeps Settings open and the original game', async () => {
  for (const failure of ['language', 'preferences', 'pending translations']) {
    const { editor } = loadEditor();
    editor.showSetting = true; editor.gameVersion = 'poe1'; editor.settingsGameVersion = 'poe2';
    editor.cloudStorageError = 'Could not switch language: storage unavailable';
    editor._cloudLanguageSwitch = Promise.resolve(failure !== 'language');
    editor.saveSettings = async () => failure !== 'preferences';
    editor.selectGameVersion = async () => {
      assert.equal(failure, 'pending translations');
      editor.localSaveError = 'Translations still need saving';
    };
    await editor.settingsSaveClose();
    assert.equal(editor.gameVersion, 'poe1', failure);
    assert.equal(editor.showSetting, true, failure);
    assert.ok(editor.settingsMessage, failure);
    assert.equal(editor.settingsSaving, false, failure);
  }
});

test('navbar shortcuts focus the matching controls in General Settings', () => {
  const { editor, config, context } = loadEditor();
  context.document.body.style = {};
  const focuses = [];
  editor.$refs.settingsGameVersion = { focus: () => focuses.push('game') };
  editor.$refs.settingsLanguage = { focus: () => focuses.push('language') };
  editor.openSettings('general', 'settingsGameVersion');
  config.watch.settingsDialogVisible.call(editor, true);
  assert.deepEqual(focuses, ['game']);
  editor.openSettings('general', 'settingsLanguage');
  assert.deepEqual(focuses, ['game', 'language']);
  assert.equal(editor.settingsTab, 'general');
});

test('opening file comments preserves a dirty translation when saving fails', async () => {
  const { editor } = loadEditor();
  editor.descs = [description('one')];
  editor.editorVisible = true;
  editor.commentsAllVisible = true;
  editor.captureCollaborationContext = () => ({});
  editor.editorHaveChanges = () => true;
  editor.editorSave = async () => false;
  editor.editFile = () => assert.fail('A failed save must not replace the current editor');
  await editor.commentsOpenFile('test/one.txt');
  assert.equal(editor.commentsAllVisible, true);
  assert.equal(editor.navigationBusy, false);
});

test('opening file comments stops if the workspace changes while saving', async () => {
  const { editor } = loadEditor();
  editor.descs = [description('one')];
  editor.editorVisible = true;
  editor.captureCollaborationContext = () => ({});
  editor.editorHaveChanges = () => true;
  editor.editorSave = async () => true;
  editor.collaborationContextCurrent = () => false;
  editor.editFile = () => assert.fail('An old workspace request must not open a file');
  await editor.commentsOpenFile('test/one.txt');
  assert.equal(editor.navigationBusy, false);
});

test('opening comments from the workspace uses file claiming and focuses the comments panel', async () => {
  const { editor } = loadEditor();
  editor.descs = [description('one')];
  editor.commentsAllVisible = true;
  editor.captureCollaborationContext = () => ({});
  editor.collaborationContextCurrent = () => true;
  let focused = false;
  editor.$refs.commentsFileList = { focus() { focused = true; } };
  editor.editFile = async (filepath, returnToList) => {
    assert.equal(filepath, 'test/one.txt'); assert.equal(returnToList, true); return true;
  };
  await editor.commentsOpenFile('test/one.txt');
  assert.equal(editor.commentsAllVisible, false);
  assert.equal(editor.sideTab, 'comments');
  assert.equal(focused, true);
  assert.equal(editor.navigationBusy, false);
});

function element(tagName, properties = {}, parentElement = null) {
  return {
    tagName, parentElement,
    matches(selector) {
      return selector.split(',').some(part => {
        const token = part.trim().toLowerCase();
        if (token.includes('contenteditable')) return !!this.isContentEditable || this.contentEditable === 'true';
        const role = /^\[role="([^"]+)"\]$/.exec(token);
        if (role) return this.role === role[1];
        if (token.startsWith('.')) return String(this.className || '').toLowerCase().split(/\s+/).includes(token.slice(1));
        if (token.startsWith('tr')) return this.tagName === 'TR' && !!this.dataset?.filepath;
        return token === this.tagName.toLowerCase();
      });
    },
    closest(selector) {
      let candidate = this;
      while (candidate) {
        if (candidate.matches?.(selector)) return candidate;
        candidate = candidate.parentElement;
      }
      return null;
    },
    ...properties,
  };
}

function statusFixtures(editor) {
  editor.descs = [
    description('missing', { isMissing: true }),
    description('saved', { hasChanges: true }),
    description('dropped', { isDropped: true }),
    description('overlap', { isMissing: true, hasChanges: true, isDropped: true }),
    description('unchanged'),
  ];
}

function paginatedFixtures(editor) {
  // Input order deliberately differs from the displayed ascending sort.
  editor.descs = Array.from({ length: 45 }, (_, index) => {
    const number = String(45 - index).padStart(2, '0');
    return description(`entry-${number}`, { hasChanges: true }, `Source ${number}`);
  });
  editor.filterDesc();
}

function attachFileList(harness) {
  const { editor, context } = harness;
  const rowElements = new Map();
  const focusedRows = [];
  const revealedRows = [];
  const openedFiles = [];
  const openedWithReturnFocus = [];
  const document = context.document;
  const region = element('DIV', {
    getClientRects() { return [{}]; },
    focus() { document.activeElement = this; },
    querySelectorAll() { return editor.descsDisplay.map(row => rowElement(row.filepath)); },
    contains(target) {
      if (target === this) return true;
      let ancestor = target;
      while (ancestor) {
        if (editor.descsDisplay.some(row => rowElement(row.filepath) === ancestor)) return true;
        ancestor = ancestor.parentElement;
      }
      return false;
    },
  });
  function rowElement(filepath) {
    if (!rowElements.has(filepath)) {
      rowElements.set(filepath, element('TR', {
        dataset: { filepath },
        getAttribute(name) { return name === 'data-filepath' ? filepath : null; },
        focus() { document.activeElement = this; focusedRows.push(filepath); },
        scrollIntoView() { revealedRows.push(filepath); },
      }, region));
    }
    return rowElements.get(filepath);
  }
  region.querySelector = selector => region.querySelectorAll().find(row => selector.includes(row.dataset.filepath)) || null;
  editor.$refs.fileTableRegion = region;
  Object.assign(editor.$refs.searchInput, element('INPUT'));
  document.body = element('BODY');
  editor.editFile = (filepath, returnToFileList) => {
    openedFiles.push(filepath);
    openedWithReturnFocus.push({ filepath, returnToFileList });
  };
  return { region, rowElement, focusedRows, revealedRows, openedFiles, openedWithReturnFocus, document };
}

function keyboardEvent(key, target, overrides = {}) {
  return {
    key, target, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
    isComposing: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    ...overrides,
  };
}

test('default status choices include work needing translation or diagnostics and leave Unchanged last', () => {
  const { editor } = loadEditor();
  statusFixtures(editor);
  assert.deepEqual(Array.from(editor.selectedFileFilters), defaultStatuses);
  assert.deepEqual(Array.from(editor.fileFilterOptions, option => option.key), [...defaultStatuses, 'unchanged']);
  editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['missing', 'saved', 'dropped', 'overlap']);
  editor.descs.push(description('warning-only'), description('error-only'));
  editor.diagnosticScanResults = {
    'test/warning-only.txt': { hasDiagnosticWarning: true, warningCount: 1 },
    'test/error-only.txt': { hasDiagnosticError: true, errorCount: 1 },
  };
  editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['missing', 'saved', 'dropped', 'overlap', 'warning-only', 'error-only']);
});

test('status choices combine with OR and overlapping files appear once', () => {
  const { editor } = loadEditor();
  statusFixtures(editor);
  editor.selectedFileFilters = ['missing', 'dropped'];
  editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['missing', 'dropped', 'overlap']);
  editor.selectedFileFilters = ['saved'];
  editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['saved', 'overlap']);
});

test('Unchanged excludes missing translations, saved work, and unresolved dropped copies', () => {
  const { editor } = loadEditor();
  statusFixtures(editor);
  editor.selectedFileFilters = ['unchanged'];
  editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['unchanged']);
});

test('diagnostic status choices use scan results and combine with ordinary statuses', () => {
  const { editor } = loadEditor();
  statusFixtures(editor);
  editor.diagnosticScanResults = {
    'test/saved.txt': { hasDiagnosticError: true, errorCount: 2 },
    'test/unchanged.txt': { hasDiagnosticWarning: true, warningCount: 1 },
  };
  editor.selectedFileFilters = ['missing', 'diagnosticError', 'diagnosticWarning'];
  editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['missing', 'saved', 'overlap', 'unchanged']);
  assert.equal(editor.filteredDescs.find(row => row.filename === 'saved.txt').diagnosticErrorCount, 2);
  editor.selectedFileFilters = ['diagnosticWarning'];
  editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['unchanged']);
});

test('clearing all statuses gives a stable empty page; Select all restores every status', () => {
  const { editor, config } = loadEditor();
  statusFixtures(editor);
  editor.currentPage = 9;
  editor.selectedFileFilters = [];
  config.watch.selectedFileFilters.handler.call(editor);
  assert.equal(editor.filteredDescs.length, 0);
  assert.equal(editor.descsDisplay.length, 0);
  assert.equal(editor.currentPage, 1);
  assert.equal(editor.pageCount, 1);
  assert.equal(editor.fileRangeLabel, '0–0 of 0');
  assert.equal(editor.allFileFiltersSelected, false);
  editor.selectAllFileFilters();
  config.watch.selectedFileFilters.handler.call(editor);
  assert.equal(editor.allFileFiltersSelected, true);
  assert.deepEqual(names(editor.filteredDescs), ['missing', 'saved', 'dropped', 'overlap', 'unchanged']);
});

test('search matches filename, English, and Thai while respecting selected statuses', () => {
  const { editor } = loadEditor();
  editor.descs = [
    description('Fire-file', { isMissing: true }, 'Cold source', 'เย็น'),
    description('source-match', { hasChanges: true }, 'Fire damage', 'ไฟ'),
    description('translation-match', { hasChanges: true }, 'Cold source', 'FIRE translation'),
    description('hidden-status', {}, 'Fire damage', 'ไฟ'),
  ];
  editor.searchText = 'fIrE';
  editor.applyFileSearch();
  assert.deepEqual(names(editor.filteredDescs), ['Fire-file', 'source-match', 'translation-match']);
  editor.selectedFileFilters = ['saved'];
  editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['source-match', 'translation-match']);
  editor.searchText = 'ไฟ';
  editor.applyFileSearch();
  assert.deepEqual(names(editor.filteredDescs), ['source-match']);
  editor.searchText = '   ';
  editor.applyFileSearch();
  assert.deepEqual(names(editor.filteredDescs), ['source-match', 'translation-match']);
});

test('typing batches file searches after 250 ms and preserves results, page, and selection meanwhile', () => {
  const { editor, timers } = loadEditor();
  paginatedFixtures(editor);
  editor.gotoPage(3);
  editor.selectedFilepath = 'test/entry-45.txt';
  const originalResults = editor.filteredDescs;
  let searches = 0;
  const filter = editor.filterDesc;
  editor.filterDesc = function (...args) { searches++; return filter.apply(this, args); };
  editor.searchText = 'S'; editor.fileSearchChanged();
  timers.advance(249);
  assert.equal(searches, 0);
  assert.equal(editor.filteredDescs, originalResults);
  assert.equal(editor.currentPage, 3);
  assert.equal(editor.selectedFilepath, 'test/entry-45.txt');
  editor.searchText = 'Source 05'; editor.fileSearchChanged();
  timers.advance(249);
  assert.equal(searches, 0, 'Each keystroke restarts the debounce delay.');
  assert.equal(editor.filteredDescs, originalResults);
  assert.equal(editor.currentPage, 3);
  timers.advance(1);
  assert.equal(searches, 1);
  assert.deepEqual(names(editor.filteredDescs), ['entry-05']);
  assert.equal(editor.currentPage, 1);
  assert.equal(timers.pendingCount, 0);
});

test('clearing or resetting search applies immediately and cancels a pending query', () => {
  for (const action of ['clearFileSearch', 'resetFileSearch']) {
    const { editor, timers, searchFocusCount } = loadEditor();
    paginatedFixtures(editor);
    editor.searchText = 'Source 05'; editor.applyFileSearch();
    editor.searchText = 'nothing matches'; editor.fileSearchChanged();
    assert.equal(timers.pendingCount, 1);
    editor[action]();
    assert.equal(editor.searchText, '');
    assert.equal(editor.filteredDescs.length, 45, action);
    assert.equal(editor.currentPage, 1);
    assert.equal(timers.pendingCount, 0);
    timers.advance(1000);
    assert.equal(editor.filteredDescs.length, 45, 'Canceled input cannot replace the cleared results.');
    if (action === 'clearFileSearch') assert.equal(searchFocusCount(), 1);
    else assert.deepEqual(Array.from(editor.selectedFileFilters), defaultStatuses);
  }
});

test('blank input restores file results immediately and cancels the preceding query', () => {
  const { editor, timers } = loadEditor();
  paginatedFixtures(editor);
  editor.searchText = 'Source 05'; editor.applyFileSearch();
  editor.searchText = 'nothing'; editor.fileSearchChanged();
  editor.searchText = '   '; editor.fileSearchChanged();
  assert.equal(editor.filteredDescs.length, 45);
  assert.equal(timers.pendingCount, 0);
  timers.advance(250);
  assert.equal(editor.filteredDescs.length, 45);
});

test('unmounting cancels a pending file search without publishing it', () => {
  const { editor, config, context, timers } = loadEditor();
  paginatedFixtures(editor);
  const originalResults = editor.filteredDescs;
  context.window.removeEventListener = () => {};
  editor.searchText = 'Source 05'; editor.fileSearchChanged();
  config.beforeUnmount.call(editor);
  assert.equal(timers.pendingCount, 0);
  timers.advance(1000);
  assert.equal(editor.filteredDescs, originalResults);
});

test('IME composition cannot publish unfinished file search text or flush it with Enter', () => {
  const { editor, timers } = loadEditor();
  paginatedFixtures(editor);
  const originalResults = editor.filteredDescs;
  editor.searchText = 'Source'; editor.fileSearchChanged();
  editor.searchText = '仮'; editor.fileSearchChanged({ isComposing: true });
  timers.advance(1000);
  assert.equal(editor.filteredDescs, originalResults);
  assert.equal(timers.pendingCount, 0, 'Composition cancels an earlier ordinary-input timer.');
  editor.applyFileSearch({ isComposing: true });
  editor.applyFileSearch({ keyCode: 229 });
  assert.equal(editor.filteredDescs, originalResults);
  editor.searchText = 'Source 05'; editor.fileSearchChanged({ isComposing: false });
  editor.applyFileSearch({ keyCode: 229 });
  assert.equal(editor.filteredDescs, originalResults, 'The legacy IME key code also blocks Enter after the input flag clears.');
  assert.equal(timers.pendingCount, 1);
  timers.advance(250);
  assert.deepEqual(names(editor.filteredDescs), ['entry-05']);
});

test('Enter and search arrow navigation flush the latest query before using file results', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /<input\b[^>]*\bid="searchInp"[^>]*@keydown\.enter\.stop\.prevent="applyFileSearch"/);
  for (const key of ['Enter', 'ArrowDown', 'ArrowUp']) {
    const harness = loadEditor();
    const { editor, timers } = harness;
    paginatedFixtures(editor);
    const table = attachFileList(harness);
    editor.gotoPage(3);
    table.document.activeElement = editor.$refs.searchInput;
    editor.searchText = 'Source 05'; editor.fileSearchChanged();
    const event = keyboardEvent(key, editor.$refs.searchInput);
    if (key === 'Enter') editor.applyFileSearch(event);
    else editor.handleFileListKeydown(event);
    assert.deepEqual(names(editor.filteredDescs), ['entry-05'], key);
    assert.equal(editor.currentPage, 1, key);
    assert.equal(timers.pendingCount, 0, key);
    if (key !== 'Enter') {
      assert.equal(event.defaultPrevented, true);
      assert.equal(editor.selectedFilepath, 'test/entry-05.txt');
      assert.equal(table.document.activeElement, table.rowElement('test/entry-05.txt'));
    }
  }
});

test('save-and-next or previous from the workspace flushes pending search before choosing a file', async () => {
  for (const key of ['F2', 'F1']) {
    const harness = loadEditor();
    const { editor, timers } = harness;
    paginatedFixtures(editor);
    const table = attachFileList(harness);
    editor.gotoPage(3);
    editor.searchText = 'Source 05'; editor.fileSearchChanged();
    let navigation;
    const saveAndSkip = editor.saveAndSkipFile;
    editor.saveAndSkipFile = function (...args) { navigation = saveAndSkip.apply(this, args); return navigation; };
    const event = keyboardEvent(key, editor.$refs.searchInput, { code: key });
    editor.handleKeydown(event);
    assert.equal(event.defaultPrevented, true, key);
    assert.equal(await navigation, true, key);
    assert.deepEqual(table.openedFiles, ['test/entry-05.txt']);
    assert.equal(editor.currentPage, 1);
    assert.equal(timers.pendingCount, 0);
  }
  const harness = loadEditor();
  paginatedFixtures(harness.editor);
  const table = attachFileList(harness);
  harness.editor.searchText = 'absent'; harness.editor.fileSearchChanged();
  assert.equal(await harness.editor.saveAndSkipFile(false, true), false);
  assert.deepEqual(table.openedFiles, [], 'A no-result query must never open a stale result.');
});

test('repeated file queries reuse prepared statuses, text, and rows without invalidating Lookup', () => {
  const { editor, context, timers } = loadEditor();
  editor.descs = [description('one', {}, 'Fire source', 'ไฟ'), description('two', {}, 'Cold source', 'เย็น')];
  editor.localDescs = {
    stagedVersion: 1, sourceHash: 'source', staged: { Thai: {
      'test/one.txt': { sourceHash: 'source', translations: ['ไฟ'] },
      'test/two.txt': { sourceHash: 'source', translations: ['เย็น'] },
    } },
  };
  const source = new Map(editor.descs.map(desc => [desc.filepath, desc]));
  editor.workspaceSourceFile = filepath => source.get(filepath);
  const calls = { statuses: 0, rows: 0, lookup: 0 };
  const workspaceFile = context.window.WorkspaceState.workspaceFile;
  context.window.WorkspaceState.workspaceFile = (...args) => { calls.statuses++; return workspaceFile(...args); };
  const render = editor.renderFileListLines;
  editor.renderFileListLines = function (...args) { calls.rows++; return render.apply(this, args); };
  editor.invalidateEditorLookupIndex = () => { calls.lookup++; };
  editor.filterDesc();
  assert.equal(calls.statuses, 2);
  assert.ok(calls.rows >= 2);
  const originalCounts = JSON.parse(JSON.stringify(editor.statistic));
  calls.statuses = calls.rows = calls.lookup = 0;
  for (const [query, expected] of [['fire', ['one']], ['ไฟ', ['one']], ['cold', ['two']], ['absent', []]]) {
    editor.searchText = query; editor.fileSearchChanged(); timers.advance(250);
    assert.deepEqual(names(editor.filteredDescs), expected, query);
    assert.deepEqual(JSON.parse(JSON.stringify(editor.statistic)), originalCounts);
  }
  assert.deepEqual(calls, { statuses: 0, rows: 0, lookup: 0 }, 'Typing only searches the prepared snapshot.');
});

test('refreshing in-place source and translation edits keeps the applied query until pending input settles', () => {
  const { editor, timers } = loadEditor();
  const first = description('one', { hasChanges: true }, 'Needle original', 'เก่า');
  const second = description('two', { hasChanges: true }, 'Other', 'อื่น');
  editor.descs = [first, second]; editor.filterDesc();
  editor.searchText = 'needle'; editor.applyFileSearch();
  editor.searchText = 'needle new'; editor.fileSearchChanged();
  second.translations.English[0] = 'Needle new';
  second.translations.Thai.push('ไฟใหม่');
  editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['one', 'two'], 'A refresh uses the last applied query.');
  timers.advance(250);
  assert.deepEqual(names(editor.filteredDescs), ['two']);
  editor.searchText = 'ไฟใหม่'; editor.applyFileSearch();
  assert.deepEqual(names(editor.filteredDescs), ['two'], 'The refreshed translation text is searchable.');
  assert.match(editor.filteredDescs[0].translation, /ไฟใหม่/);
});

test('switching selected language refreshes pending file search against that language only', () => {
  const { editor, timers } = loadEditor();
  const first = description('one', { hasChanges: true }, 'First source', 'Shared Thai');
  const second = description('two', { hasChanges: true }, 'Second source', 'Other Thai');
  first.translations.German = ['New Deutsch']; second.translations.German = ['Shared Deutsch'];
  editor.descs = [first, second]; editor.filterDesc();
  editor.searchText = 'shared'; editor.applyFileSearch();
  assert.deepEqual(names(editor.filteredDescs), ['one']);
  editor.searchText = 'new deutsch'; editor.fileSearchChanged();
  editor.lang = 'German'; editor.filterDesc();
  assert.deepEqual(names(editor.filteredDescs), ['two'], 'The applied query refreshes for the selected language.');
  timers.advance(250);
  assert.deepEqual(names(editor.filteredDescs), ['one']);
  assert.equal(editor.filteredDescs[0].translation, 'New Deutsch');
  editor.searchText = 'shared thai'; editor.applyFileSearch();
  assert.equal(editor.filteredDescs.length, 0, 'An inactive language does not leak into search.');
});

test('status totals respect Hide DNT and remain independent of search and status choices', () => {
  const { editor } = loadEditor();
  statusFixtures(editor);
  editor.descs.push(description('hidden-dnt', { isMissing: true, hasChanges: true, isDropped: true, isDNT: true }));
  editor.hideDNT = true;
  editor.searchText = 'does not match';
  editor.selectedFileFilters = ['unchanged'];
  editor.filterDesc();
  assert.equal(editor.filteredDescs.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.statistic)), { hasChanges: 2, isRevised: 0, isMissing: 2, isDropped: 2 });
  editor.hideDNT = false;
  editor.filterDesc();
  assert.deepEqual(JSON.parse(JSON.stringify(editor.statistic)), { hasChanges: 3, isRevised: 0, isMissing: 3, isDropped: 3 });
});

test('45 files render correctly sorted pages, ranges, and a shorter final page', () => {
  const { editor, context } = loadEditor();
  paginatedFixtures(editor);
  assert.equal(editor.pageCount, 3);
  const originalOrder = names(editor.filteredDescs);
  assert.deepEqual(names(editor.descsDisplay), Array.from({ length: 20 }, (_, index) => `entry-${String(index + 1).padStart(2, '0')}`));
  assert.equal(editor.fileRangeLabel, '1–20 of 45');
  assert.deepEqual(names(editor.filteredDescs), originalOrder, 'Rendering sorted pages must preserve the underlying filtered order.');
  assert.equal(Object.hasOwn(context, 'descsToDisplay'), false, 'Rendering pages must not leak a global variable.');
  editor.nextPage();
  assert.deepEqual(names(editor.descsDisplay), Array.from({ length: 20 }, (_, index) => `entry-${String(index + 21).padStart(2, '0')}`));
  assert.equal(editor.fileRangeLabel, '21–40 of 45');
  editor.nextPage();
  assert.deepEqual(names(editor.descsDisplay), ['entry-41', 'entry-42', 'entry-43', 'entry-44', 'entry-45']);
  assert.equal(editor.fileRangeLabel, '41–45 of 45');
  editor.nextPage();
  assert.equal(editor.currentPage, 3);
  editor.gotoPage(1);
  editor.prevPage();
  assert.equal(editor.currentPage, 1);
  editor.sort('english');
  assert.deepEqual(names(editor.descsDisplay), Array.from({ length: 20 }, (_, index) => `entry-${String(45 - index).padStart(2, '0')}`));
  assert.equal(editor.currentSortIcon, '▼');
});

test('programmatic page changes bound invalid, negative, decimal, and out-of-range values', () => {
  const { editor } = loadEditor();
  paginatedFixtures(editor);
  for (const [input, expected] of [
    ['invalid', 1], [undefined, 1], [NaN, 1], [Infinity, 1], [-Infinity, 1],
    ['', 1], [0, 1], [-10, 1], [-1.5, 1], ['2.9', 2], [3.9, 3], [999, 3], ['2', 2],
  ]) {
    editor.gotoPage(input);
    assert.equal(editor.currentPage, expected, `Page input ${String(input)} must stay in range.`);
    assert.ok(editor.descsDisplay.length > 0);
  }
  editor.filteredDescs = [];
  editor.gotoPage(999);
  assert.equal(editor.currentPage, 1);
  assert.equal(editor.pageCount, 1);
});

test('search and status changes return to page one even when later pages remain valid', () => {
  const { editor, config, searchFocusCount } = loadEditor();
  paginatedFixtures(editor);
  editor.gotoPage(3);
  editor.searchText = 'Source';
  editor.applyFileSearch();
  assert.equal(editor.currentPage, 1);
  assert.equal(editor.pageCount, 3);
  editor.gotoPage(3);
  editor.selectedFileFilters = ['saved'];
  config.watch.selectedFileFilters.handler.call(editor);
  assert.equal(editor.currentPage, 1);
  assert.equal(editor.pageCount, 3);
  editor.gotoPage(2);
  editor.searchText = 'nothing matches';
  editor.applyFileSearch();
  assert.equal(editor.currentPage, 1);
  assert.equal(editor.fileRangeLabel, '0–0 of 0');
  editor.clearFileSearch();
  assert.equal(editor.searchText, '');
  assert.equal(editor.currentPage, 1);
  assert.equal(editor.filteredDescs.length, 45);
  assert.equal(searchFocusCount(), 1);
});

test('Reset search clears the query and restores the default status choices', () => {
  const { editor } = loadEditor();
  statusFixtures(editor);
  editor.searchText = 'unchanged';
  editor.selectedFileFilters = ['unchanged'];
  editor.currentPage = 8;
  editor.resetFileSearch();
  assert.equal(editor.searchText, '');
  assert.equal(editor.currentPage, 1);
  assert.deepEqual(Array.from(editor.selectedFileFilters), defaultStatuses);
  assert.deepEqual(names(editor.filteredDescs), ['missing', 'saved', 'dropped', 'overlap']);
});

test('focusing the file list selects its first row and explicit row selection can move focus', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  table.region.focus();
  editor.fileTableFocused();
  assert.equal(editor.selectedFilepath, 'test/entry-01.txt');
  editor.selectFileRow('test/entry-08.txt', true);
  assert.equal(editor.selectedFilepath, 'test/entry-08.txt');
  assert.equal(table.document.activeElement, table.rowElement('test/entry-08.txt'));
  editor.fileTableFocused();
  assert.equal(editor.selectedFilepath, 'test/entry-08.txt', 'Returning to the list preserves its visible selected row.');
});

test('Up and Down move selection within a page and clamp without paging or returning to search', () => {
  const harness = loadEditor();
  const { editor, searchFocusCount } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  table.region.focus();
  editor.fileTableFocused();
  const firstUp = keyboardEvent('ArrowUp', table.region);
  editor.fileTableKeydown(firstUp);
  assert.equal(firstUp.defaultPrevented, true);
  assert.equal(editor.selectedFilepath, 'test/entry-01.txt');
  assert.equal(searchFocusCount(), 0);
  editor.fileTableKeydown(keyboardEvent('ArrowDown', table.document.activeElement));
  assert.equal(editor.selectedFilepath, 'test/entry-02.txt');
  for (let count = 0; count < 25; count++) {
    editor.fileTableKeydown(keyboardEvent('ArrowDown', table.document.activeElement));
  }
  assert.equal(editor.selectedFilepath, 'test/entry-20.txt');
  assert.equal(editor.currentPage, 1, 'Down must not switch pages at the last row.');
  for (let count = 0; count < 25; count++) {
    editor.fileTableKeydown(keyboardEvent('ArrowUp', table.document.activeElement));
  }
  assert.equal(editor.selectedFilepath, 'test/entry-01.txt');
  assert.equal(editor.currentPage, 1);
  assert.equal(searchFocusCount(), 0, 'Up at the first row must remain in the file list.');
});

test('Home and End select the page edges and Page Up or Down moves ten rows without changing pages', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.selectFileRow('test/entry-09.txt', true);
  for (const [key, expected] of [
    ['Home', '01'], ['End', '20'], ['PageUp', '10'], ['PageDown', '20'], ['PageDown', '20'],
    ['Home', '01'], ['PageUp', '01'], ['PageDown', '11'], ['PageDown', '20'],
  ]) {
    const event = keyboardEvent(key, table.document.activeElement);
    editor.handleKeydown(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(editor.selectedFilepath, `test/entry-${expected}.txt`, key);
    assert.equal(editor.currentPage, 1);
    assert.equal(table.document.activeElement, table.rowElement(editor.selectedFilepath));
  }
  editor.gotoPage(3);
  for (const [key, expected] of [['End', '45'], ['PageUp', '41'], ['PageDown', '45']]) {
    editor.handleKeydown(keyboardEvent(key, table.document.activeElement));
    assert.equal(editor.selectedFilepath, `test/entry-${expected}.txt`, key);
    assert.equal(editor.currentPage, 3, 'Navigation in the short last page must not switch pages.');
  }
});

test('Right selects the next page first row and Left selects the previous page last row', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.selectFileRow('test/entry-17.txt', true);
  editor.fileTableKeydown(keyboardEvent('ArrowRight', table.document.activeElement));
  assert.equal(editor.currentPage, 2);
  assert.equal(editor.selectedFilepath, 'test/entry-21.txt');
  editor.fileTableKeydown(keyboardEvent('ArrowRight', table.document.activeElement));
  assert.equal(editor.currentPage, 3);
  assert.equal(editor.selectedFilepath, 'test/entry-41.txt');
  editor.fileTableKeydown(keyboardEvent('ArrowRight', table.document.activeElement));
  assert.equal(editor.currentPage, 3);
  assert.equal(editor.selectedFilepath, 'test/entry-41.txt');
  editor.fileTableKeydown(keyboardEvent('ArrowLeft', table.document.activeElement));
  assert.equal(editor.currentPage, 2);
  assert.equal(editor.selectedFilepath, 'test/entry-40.txt');
  editor.fileTableKeydown(keyboardEvent('ArrowLeft', table.document.activeElement));
  assert.equal(editor.currentPage, 1);
  assert.equal(editor.selectedFilepath, 'test/entry-20.txt');
  editor.fileTableKeydown(keyboardEvent('ArrowLeft', table.document.activeElement));
  assert.equal(editor.currentPage, 1);
  assert.equal(editor.selectedFilepath, 'test/entry-20.txt');
});

test('Enter opens exactly the selected file from a row or the list region', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.selectFileRow('test/entry-09.txt', true);
  const rowEnter = keyboardEvent('Enter', table.document.activeElement);
  editor.fileTableKeydown(rowEnter);
  assert.equal(rowEnter.defaultPrevented, true);
  table.region.focus();
  editor.fileTableKeydown(keyboardEvent('Enter', table.region));
  assert.deepEqual(table.openedFiles, ['test/entry-09.txt', 'test/entry-09.txt']);
});

test('opening a clicked row selects and opens it with return focus to the file list', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.openFileRow('test/entry-09.txt');
  assert.equal(editor.selectedFilepath, 'test/entry-09.txt');
  assert.deepEqual(table.openedFiles, ['test/entry-09.txt']);
  assert.deepEqual(table.openedWithReturnFocus, [{ filepath: 'test/entry-09.txt', returnToFileList: true }]);
  editor.openFileRow('test/entry-30.txt');
  editor.openFileRow('test/does-not-exist.txt');
  assert.deepEqual(table.openedFiles, ['test/entry-09.txt'], 'Rows outside the visible page cannot be opened by a stale row click.');
});

test('a closed editor restores selected row focus after the view updates', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.selectFileRow('test/entry-09.txt');
  const editorField = element('TEXTAREA');
  table.document.activeElement = editorField;
  const ticks = [];
  editor.$nextTick = callback => { ticks.push(callback); return Promise.resolve(); };
  editor._fileTableReturnFocus = true;
  editor.editorVisible = false;
  editor.restoreFileTableFocusAfterEditor();
  assert.equal(table.document.activeElement, editorField, 'Closing must wait for the list view to be available.');
  assert.equal(editor._fileTableReturnFocus, true);
  ticks.shift()();
  assert.equal(editor._fileTableReturnFocus, false);
  while (ticks.length) ticks.shift()();
  assert.equal(table.document.activeElement, table.rowElement('test/entry-09.txt'));
});

test('reopening the editor before its return tick preserves editor focus and restores it on the later close', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.selectFileRow('test/entry-09.txt');
  const ticks = [];
  editor.$nextTick = callback => { ticks.push(callback); return Promise.resolve(); };
  editor._fileTableReturnFocus = true;
  editor.editorVisible = false;
  editor.restoreFileTableFocusAfterEditor();
  // Save-and-next may reopen a different file before Vue applies the view change.
  editor.editorVisible = true;
  editor.selectFileRow('test/entry-10.txt');
  const nextEditorField = element('TEXTAREA');
  table.document.activeElement = nextEditorField;
  while (ticks.length) ticks.shift()();
  assert.equal(table.document.activeElement, nextEditorField);
  assert.equal(editor._fileTableReturnFocus, true, 'A reopened editor still needs to return to the list when it closes later.');
  assert.deepEqual(table.focusedRows, []);
  editor.editorVisible = false;
  editor.restoreFileTableFocusAfterEditor();
  while (ticks.length) ticks.shift()();
  assert.equal(editor._fileTableReturnFocus, false);
  assert.equal(table.document.activeElement, table.rowElement('test/entry-10.txt'));
});

test('arrow navigation leaves typing fields, page inputs, select boxes, and filter checkboxes untouched', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.selectFileRow('test/entry-09.txt', true);
  const row = table.document.activeElement;
  const targets = [
    element('INPUT', { type: 'text' }),
    element('INPUT', { type: 'number' }),
    element('INPUT', { type: 'checkbox' }),
    element('TEXTAREA', { className: 'translation' }),
    element('SELECT'),
    element('DIV', { isContentEditable: true }),
    element('SPAN', {}, element('DIV', { contentEditable: 'true' })),
    ...['textbox', 'combobox', 'spinbutton', 'slider'].map(role => element('DIV', { role })),
    element('INPUT', { type: 'text' }, row),
  ];
  for (const target of targets) {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter']) {
      table.document.activeElement = target;
      const event = keyboardEvent(key, target);
      editor.handleFileListKeydown(event);
      assert.equal(event.defaultPrevented, false, `${target.tagName} ${key} must keep its native behavior.`);
      assert.equal(editor.selectedFilepath, 'test/entry-09.txt');
      assert.equal(editor.currentPage, 1);
    }
  }
  assert.deepEqual(table.openedFiles, []);
});

test('Up and Down from body or a normal navigation button restore the selected row or fall back to first', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  for (const target of [table.document.body, element('BUTTON', { className: 'tableSort' })]) {
    for (const key of ['ArrowUp', 'ArrowDown']) {
      editor.gotoPage(3);
      editor.selectFileRow('test/entry-45.txt');
      table.document.activeElement = target;
      const event = keyboardEvent(key, target);
      editor.handleKeydown(event);
      assert.equal(event.defaultPrevented, true);
      assert.equal(editor.selectedFilepath, 'test/entry-45.txt');
      assert.equal(table.document.activeElement, table.rowElement('test/entry-45.txt'));
    }
    for (const key of ['ArrowLeft', 'ArrowRight', 'Enter']) {
      table.document.activeElement = target;
      const event = keyboardEvent(key, target);
      editor.handleFileListKeydown(event);
      assert.equal(event.defaultPrevented, false);
      assert.equal(editor.currentPage, 3);
      assert.equal(editor.selectedFilepath, 'test/entry-45.txt');
    }
    for (const [key, expected] of [['Home', '41'], ['End', '45'], ['PageUp', '41'], ['PageDown', '45']]) {
      table.document.activeElement = target;
      const event = keyboardEvent(key, target);
      editor.handleKeydown(event);
      assert.equal(event.defaultPrevented, true);
      assert.equal(editor.selectedFilepath, `test/entry-${expected}.txt`);
      assert.equal(editor.currentPage, 3);
      assert.equal(table.document.activeElement, table.rowElement(editor.selectedFilepath));
    }
    editor.selectedFilepath = 'test/no-visible-selection.txt';
    editor.handleKeydown(keyboardEvent('ArrowDown', target));
    assert.equal(editor.selectedFilepath, 'test/entry-41.txt');
    assert.equal(table.document.activeElement, table.rowElement('test/entry-41.txt'));
  }
  assert.deepEqual(table.openedFiles, []);
});

test('contextual arrows preserve filter, tab, menu, and listbox keyboard controls', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.selectFileRow('test/entry-09.txt');
  const containers = [element('FIELDSET', { className: 'fileFilters' }),
    ...['tablist', 'menu', 'listbox'].map(role => element('DIV', { role }))];
  for (const container of containers) {
    const button = element('BUTTON', {}, container);
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']) {
      const event = keyboardEvent(key, button);
      editor.handleFileListKeydown(event);
      assert.equal(event.defaultPrevented, false);
      assert.equal(editor.selectedFilepath, 'test/entry-09.txt');
      assert.equal(editor.currentPage, 1);
    }
  }
  assert.deepEqual(table.openedFiles, []);
});

test('arrows work on row buttons and cells while Enter on native row buttons is left alone', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.selectFileRow('test/entry-09.txt', true);
  const filenameButton = element('BUTTON', { className: 'fileOpen' }, table.rowElement('test/entry-09.txt'));
  const down = keyboardEvent('ArrowDown', filenameButton);
  editor.handleFileListKeydown(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(editor.selectedFilepath, 'test/entry-10.txt');
  const cell = element('TD', {}, table.rowElement('test/entry-10.txt'));
  editor.handleFileListKeydown(keyboardEvent('ArrowRight', cell));
  assert.equal(editor.currentPage, 2);
  assert.equal(editor.selectedFilepath, 'test/entry-21.txt');
  const currentButton = element('BUTTON', {}, table.rowElement('test/entry-21.txt'));
  const enter = keyboardEvent('Enter', currentButton);
  editor.fileTableKeydown(enter);
  assert.equal(enter.defaultPrevented, false);
  assert.deepEqual(table.openedFiles, []);
});

test('page changes select the appropriate edge and preserve selection at boundaries', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  attachFileList(harness);
  editor.selectFileRow('test/entry-17.txt');
  editor.nextPage();
  assert.equal(editor.selectedFilepath, 'test/entry-21.txt');
  editor.gotoPage(3);
  assert.equal(editor.selectedFilepath, 'test/entry-41.txt');
  editor.selectFileRow('test/entry-44.txt');
  editor.nextPage();
  assert.equal(editor.selectedFilepath, 'test/entry-44.txt');
  editor.prevPage();
  assert.equal(editor.selectedFilepath, 'test/entry-40.txt');
  editor.gotoPage(1);
  assert.equal(editor.selectedFilepath, 'test/entry-20.txt');
  editor.selectFileRow('test/entry-07.txt');
  editor.prevPage();
  assert.equal(editor.selectedFilepath, 'test/entry-07.txt');
});

test('previous and next page controls retain focus while revealing the newly selected file', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  const pageButton = element('BUTTON');
  table.document.activeElement = pageButton;
  editor.nextPage();
  assert.equal(editor.selectedFilepath, 'test/entry-21.txt');
  assert.equal(table.revealedRows.at(-1), 'test/entry-21.txt');
  assert.equal(table.document.activeElement, pageButton);
  editor.nextPage();
  assert.equal(editor.selectedFilepath, 'test/entry-41.txt');
  assert.equal(table.revealedRows.at(-1), 'test/entry-41.txt');
  assert.equal(table.document.activeElement, pageButton);
  editor.prevPage();
  editor.prevPage();
  assert.equal(editor.selectedFilepath, 'test/entry-20.txt');
  assert.equal(table.revealedRows.at(-1), 'test/entry-20.txt');
  assert.equal(table.document.activeElement, pageButton);
});

test('modifier and composing events never change list selection, pages, or open files', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.selectFileRow('test/entry-09.txt', true);
  for (const overrides of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter']) {
      editor.fileTableKeydown(keyboardEvent(key, table.document.activeElement, overrides));
      assert.equal(editor.selectedFilepath, 'test/entry-09.txt', `${key} with ${JSON.stringify(overrides)}`);
      assert.equal(editor.currentPage, 1);
    }
  }
  assert.deepEqual(table.openedFiles, []);
});

test('list and search navigation stay inactive while an editor or blocking dialog is open', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.selectFileRow('test/entry-09.txt', true);
  const blockingStates = [
    ['editorVisible', true], ['importDialogVisible', true], ['cloudResolverVisible', true],
    ['cloudHistoryVisible', true], ['consistencyResolver', {}], ['duplicateLangImportWarning', {}],
    ['showMultiInstanceGate', true], ['settingsImportDraft', {}], ['pendingSingleVersionMigration', {}],
  ];
  function assertBlocked() {
    const listEvent = keyboardEvent('ArrowRight', table.rowElement('test/entry-09.txt'));
    editor.fileTableKeydown(listEvent);
    const searchEvent = keyboardEvent('ArrowDown', editor.$refs.searchInput);
    editor.handleFileListKeydown(searchEvent);
    assert.equal(listEvent.defaultPrevented, false);
    assert.equal(searchEvent.defaultPrevented, false);
    assert.equal(editor.selectedFilepath, 'test/entry-09.txt');
    assert.equal(editor.currentPage, 1);
  }
  for (const [key, value] of blockingStates) {
    const previous = editor[key];
    editor[key] = value;
    assertBlocked();
    editor[key] = previous;
  }
  editor.$refs.diagnosticScanDialog = { open: true };
  assertBlocked();
  editor.$refs.diagnosticScanDialog.open = false;
  editor.gameVersionSelected = true;
  editor.showSetting = true;
  assertBlocked();
  assert.deepEqual(table.openedFiles, []);
});

test('contextual navigation ignores a hidden or absent file list', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.selectFileRow('test/entry-09.txt');
  for (const region of [Object.assign(table.region, { getClientRects() { return []; } }), null]) {
    editor.$refs.fileTableRegion = region;
    for (const target of [table.document.body, editor.$refs.searchInput]) {
      for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']) {
        const event = keyboardEvent(key, target);
        editor.handleFileListKeydown(event);
        assert.equal(event.defaultPrevented, false);
        assert.equal(editor.selectedFilepath, 'test/entry-09.txt');
        assert.equal(editor.currentPage, 1);
      }
    }
  }
  assert.deepEqual(table.openedFiles, []);
});

test('search Down selects first and Up restores current while other navigation keys keep native behavior', () => {
  const harness = loadEditor();
  const { editor } = harness;
  paginatedFixtures(editor);
  const table = attachFileList(harness);
  editor.gotoPage(3);
  table.document.activeElement = editor.$refs.searchInput;
  const down = keyboardEvent('ArrowDown', editor.$refs.searchInput);
  editor.handleFileListKeydown(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(editor.selectedFilepath, 'test/entry-41.txt');
  assert.equal(table.document.activeElement, table.rowElement('test/entry-41.txt'));
  editor.selectFileRow('test/entry-45.txt');
  table.document.activeElement = editor.$refs.searchInput;
  const up = keyboardEvent('ArrowUp', editor.$refs.searchInput);
  editor.handleFileListKeydown(up);
  assert.equal(up.defaultPrevented, true);
  assert.equal(editor.selectedFilepath, 'test/entry-45.txt');
  assert.equal(table.document.activeElement, table.rowElement('test/entry-45.txt'));
  editor.selectFileRow('test/entry-45.txt', true);
  for (const overrides of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    table.document.activeElement = editor.$refs.searchInput;
    const event = keyboardEvent('ArrowDown', editor.$refs.searchInput, overrides);
    editor.handleFileListKeydown(event);
    assert.equal(event.defaultPrevented, !!overrides.defaultPrevented);
    assert.equal(editor.selectedFilepath, 'test/entry-45.txt');
    assert.equal(table.document.activeElement, editor.$refs.searchInput);
  }
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter']) {
    const event = keyboardEvent(key, editor.$refs.searchInput);
    editor.handleFileListKeydown(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(editor.currentPage, 3);
    assert.equal(editor.selectedFilepath, 'test/entry-45.txt');
  }
  editor.filteredDescs = [];
  editor.syncFileSelection();
  const emptyDown = keyboardEvent('ArrowDown', editor.$refs.searchInput);
  editor.handleFileListKeydown(emptyDown);
  assert.equal(emptyDown.defaultPrevented, false);
  assert.equal(editor.selectedFilepath, '');
  assert.equal(table.document.activeElement, editor.$refs.searchInput);
});

test('selection stays visible after sorting, page changes, or a search, and clears when there are no results', () => {
  const harness = loadEditor();
  const { editor, config } = harness;
  paginatedFixtures(editor);
  attachFileList(harness);
  editor.selectFileRow('test/entry-17.txt', true);
  editor.sort('english');
  config.watch.descsDisplay.call(editor);
  assert.ok(editor.descsDisplay.some(row => row.filepath === editor.selectedFilepath));
  editor.gotoPage(2);
  config.watch.descsDisplay.call(editor);
  assert.ok(editor.descsDisplay.some(row => row.filepath === editor.selectedFilepath));
  editor.searchText = 'Source 05';
  editor.applyFileSearch();
  config.watch.descsDisplay.call(editor);
  assert.equal(editor.selectedFilepath, 'test/entry-05.txt');
  editor.selectedFileFilters = [];
  config.watch.selectedFileFilters.handler.call(editor);
  config.watch.descsDisplay.call(editor);
  assert.equal(editor.selectedFilepath, '');
  editor.selectedFileFilters = ['saved'];
  config.watch.selectedFileFilters.handler.call(editor);
  config.watch.descsDisplay.call(editor);
  assert.equal(editor.selectedFilepath, 'test/entry-05.txt');
  editor.currentPage = 1;
  editor.filteredDescs = [];
  config.watch.descsDisplay.call(editor);
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter']) {
    editor.fileTableKeydown(keyboardEvent(key, editor.$refs.fileTableRegion));
    assert.equal(editor.currentPage, 1);
    assert.equal(editor.selectedFilepath, '');
  }
});

test('autocomplete TL notes follow the selected dictionary ID, including alternate translations', () => {
  const { editor } = loadEditor();
  editor.dictionary = [
    { _id: 'first', find: 'Evasion', tlnote: 'First definition note' },
    { _id: 'second', find: 'Evasion', tlnote: '  หลบหลีก\nKeep the second definition.  ', alts: [{ _id: 'alt-second', find: 'Evasion Rating' }] },
  ];
  const mainItem = { dictEntryId: 'first', label: 'Evasion', value: 'การหลบหลีก' };
  const alternateItem = { dictEntryId: 'second', dictAltId: 'alt-second', label: 'Evasion Rating', value: 'อัตราการหลบหลีก' };
  editor.hlPopup.filtered = [mainItem, alternateItem];
  editor.hlPopup.visible = true;
  editor.hlPopup.selectedIndex = 0;
  assert.equal(editor.hlPopupSelectedItem, mainItem);
  assert.equal(editor.hlPopupTlnote, 'First definition note');
  editor.hlPopup.selectedIndex = 1;
  assert.equal(editor.hlPopupSelectedItem, alternateItem);
  assert.equal(editor.hlPopupTlnote, 'หลบหลีก\nKeep the second definition.', 'Alternates inherit their own parent entry note, even when another entry has the same Find.');
  editor.dictionary[1].tlnote = 'Updated while the popup is open';
  assert.equal(editor.hlPopupTlnote, 'Updated while the popup is open', 'Notes must reflect current dictionary edits rather than the popup opening snapshot.');
});

test('autocomplete hides TL notes for missing entries, create-new items, blank notes, and a closed popup', () => {
  const { editor } = loadEditor();
  editor.dictionary = [{ _id: 'blank', find: 'Armour', tlnote: ' \n\t ' }];
  editor.hlPopup.visible = true;
  for (const item of [
    { dictEntryId: 'blank' },
    { dictEntryId: 'deleted-entry' },
    { mustCreate: true, kwTagName: 'Armour', label: 'Armour → create a new dictionary entry...' },
    { value: '{0}%' },
  ]) {
    editor.hlPopup.filtered = [item];
    editor.hlPopup.selectedIndex = 0;
    assert.equal(editor.hlPopupTlnote, '');
  }
  editor.dictionary.push({ _id: 'has-note', tlnote: 'A visible note' });
  editor.hlPopup.filtered = [{ dictEntryId: 'has-note' }];
  assert.equal(editor.hlPopupTlnote, 'A visible note');
  editor.hlPopup.visible = false;
  assert.equal(editor.hlPopupSelectedItem, null);
  assert.equal(editor.hlPopupTlnote, '');
  editor.hlPopup.visible = true;
  editor.hlPopup.filtered = [];
  assert.equal(editor.hlPopupTlnote, '');
});

function attachDictionaryGeometry(harness, options = {}) {
  const { context } = harness;
  const nativeScrolls = [];
  const scrollAssignments = [];
  const sideTop = options.sideTop ?? 100;
  const sideHeight = options.sideHeight ?? 500;
  const headerHeight = options.headerHeight ?? 60;
  const cardContentTop = options.cardContentTop ?? 650;
  const cardHeight = options.cardHeight ?? 160;
  const rowOffset = options.rowOffset ?? 12;
  const rowHeight = options.rowHeight ?? 42;
  let scrollTop = options.scrollTop ?? 200;
  const rectangle = (top, height) => ({ top, bottom: top + height, height, left: 800, right: 1200, width: 400 });
  const side = element('DIV', {
    className: 'side fixed',
    clientHeight: sideHeight,
    clientTop: 0,
    scrollHeight: options.scrollHeight ?? 2400,
    getBoundingClientRect() { return rectangle(sideTop, sideHeight); },
    getClientRects() { return [this.getBoundingClientRect()]; },
    scrollTo(configuration) { this.scrollTop = typeof configuration === 'number' ? configuration : configuration.top; },
    scrollBy(configuration) { this.scrollTop += typeof configuration === 'number' ? configuration : configuration.top; },
  });
  Object.defineProperty(side, 'scrollTop', {
    get() { return scrollTop; },
    set(value) { scrollAssignments.push(value); scrollTop = value; },
  });
  const header = element('DIV', {
    className: 'sideHeader', offsetHeight: headerHeight,
    getBoundingClientRect() { return rectangle(sideTop, headerHeight); },
  }, side);
  side.querySelector = selector => selector === '.sideHeader' ? header : null;
  const card = element('DIV', {
    className: 'editBlock',
    getBoundingClientRect() { return rectangle(sideTop + cardContentTop - scrollTop, cardHeight); },
    getClientRects() { return [this.getBoundingClientRect()]; },
  }, side);
  const row = element('DIV', {
    className: 'dictRow', dataset: { dictId: 'selected-entry' },
    getBoundingClientRect() { return rectangle(card.getBoundingClientRect().top + rowOffset, rowHeight); },
    getClientRects() { return [this.getBoundingClientRect()]; },
    scrollIntoView(configuration) { nativeScrolls.push(configuration); },
  }, card);
  const focusedInput = element('INPUT', { type: 'text' });
  context.document.activeElement = focusedInput;
  context.window.innerHeight = 1000;
  context.document.documentElement = { clientHeight: 1000 };
  const getComputedStyle = target => ({
    overflowY: target === side ? (options.overflowY ?? 'auto') : 'visible',
    position: target === side ? (options.position ?? 'fixed') : target === header ? 'sticky' : 'static',
  });
  context.window.getComputedStyle = getComputedStyle;
  context.getComputedStyle = getComputedStyle;
  return { side, header, card, row, nativeScrolls, scrollAssignments, focusedInput };
}

test('autocomplete scrolling reveals a cutoff dictionary card inside its sidebar without moving focus or the page', () => {
  const harness = loadEditor();
  const geometry = attachDictionaryGeometry(harness);
  assert.ok(geometry.card.getBoundingClientRect().bottom > geometry.side.getBoundingClientRect().bottom);
  harness.editor.scrollDictionaryEntryIntoView(geometry.row);
  const cardRect = geometry.card.getBoundingClientRect();
  assert.ok(cardRect.top >= geometry.header.getBoundingClientRect().bottom, 'The full card should clear the sticky Dictionary tabs.');
  assert.ok(cardRect.bottom <= geometry.side.getBoundingClientRect().bottom, 'The card should be fully visible when it fits in the sidebar.');
  assert.ok(geometry.side.scrollTop > 200);
  assert.deepEqual(geometry.nativeScrolls, [], 'Automatic selection must scroll the sidebar rather than its page ancestors.');
  assert.equal(harness.context.document.activeElement, geometry.focusedInput);
});

test('dictionary scrolling reveals an entry hidden by the sticky sidebar header', () => {
  const harness = loadEditor();
  const geometry = attachDictionaryGeometry(harness, { cardContentTop: 235, cardHeight: 120 });
  assert.ok(geometry.card.getBoundingClientRect().top < geometry.header.getBoundingClientRect().bottom);
  harness.editor.scrollDictionaryEntryIntoView(geometry.row);
  assert.ok(geometry.side.scrollTop < 200, 'Scroll upward when sticky tabs obscure the selected entry.');
  assert.ok(geometry.card.getBoundingClientRect().top >= geometry.header.getBoundingClientRect().bottom);
  assert.ok(geometry.card.getBoundingClientRect().bottom <= geometry.side.getBoundingClientRect().bottom);
});

test('an oversized dictionary entry reveals its selected alternate rather than trying to show the entire card', () => {
  const harness = loadEditor();
  const geometry = attachDictionaryGeometry(harness, { cardContentTop: 200, cardHeight: 900, rowOffset: 700 });
  geometry.row.className = 'dictAltRow';
  geometry.row.dataset.dictAltId = 'selected-alt';
  harness.editor.scrollDictionaryEntryIntoView(geometry.row);
  const rowRect = geometry.row.getBoundingClientRect();
  assert.ok(rowRect.top >= geometry.header.getBoundingClientRect().bottom);
  assert.ok(rowRect.bottom <= geometry.side.getBoundingClientRect().bottom, 'The selected alternate must be visible even when its parent has many alternatives.');
  assert.ok(geometry.card.getBoundingClientRect().top < geometry.header.getBoundingClientRect().bottom, 'A large parent card may remain clipped when the selected row is visible.');
});

test('an already visible dictionary entry leaves sidebar scroll and focus unchanged', () => {
  const harness = loadEditor();
  const geometry = attachDictionaryGeometry(harness, { cardContentTop: 450, cardHeight: 120 });
  harness.editor.scrollDictionaryEntryIntoView(geometry.row);
  assert.equal(geometry.side.scrollTop, 200);
  assert.deepEqual(geometry.scrollAssignments, [], 'Selecting an already visible entry should not jitter the sidebar.');
  assert.equal(harness.context.document.activeElement, geometry.focusedInput);
});

test('mobile autocomplete preview leaves the page still while an explicit dictionary jump may reveal the row', () => {
  const harness = loadEditor();
  const geometry = attachDictionaryGeometry(harness, { overflowY: 'visible', position: 'static' });
  harness.editor.scrollDictionaryEntryIntoView(geometry.row);
  assert.equal(geometry.side.scrollTop, 200);
  assert.deepEqual(geometry.nativeScrolls, [], 'The mobile sidebar is part of the page, so preview must preserve the editor and popup position.');
  assert.equal(harness.context.document.activeElement, geometry.focusedInput);
  harness.editor.scrollDictionaryEntryIntoView(geometry.row, { allowPageScroll: true });
  assert.equal(geometry.nativeScrolls.length, 1, 'An explicit Ctrl+Enter edit may navigate to the mobile dictionary input.');
});

test('browser work indicator describes overlapping tasks and clears each scope independently', () => {
  const { editor: e } = loadEditor();
  e.setBrowserWork('cloud', { key: 'dictionary', label: 'Updating Dictionary entries', active: true, immediate: true });
  e.setBrowserWork('collaboration', { key: 'source', label: 'Preparing collaboration data', active: true, immediate: true });
  assert.match(e.browserWorkTooltip, /Updating Dictionary entries/);
  assert.match(e.browserWorkTooltip, /Preparing collaboration data/);
  e.clearBrowserWork('cloud');
  assert.doesNotMatch(e.browserWorkTooltip, /Updating Dictionary entries/);
  assert.match(e.browserWorkTooltip, /Preparing collaboration data/);
  e.clearBrowserWork('collaboration');
  assert.equal(e.browserWorkTooltip, '');
  e.editorLoading = true;
  assert.match(e.browserWorkTooltip, /Preparing translation fields/);
  e.editorLoading = false;
  assert.equal(e.browserWorkTooltip, '');
});

test('a short completed task cannot reveal a stale delayed browser work indicator', () => {
  const { editor: e, context } = loadEditor();
  let reveal;
  context.setTimeout = callback => { reveal = callback; return 1; };
  context.clearTimeout = () => {};
  e.setBrowserWork('workspace', { key: 'load', label: 'Preparing stored translation files', active: true });
  assert.equal(e.browserWorkTooltip, '');
  e.setBrowserWork('workspace', { key: 'load', active: false });
  reveal();
  assert.equal(e.browserWorkTooltip, '');
});

test('work details appear beside a keyboard-focused indicator and disappear when it finishes', () => {
  const { editor, directives } = loadEditor();
  const handlers = new Map();
  const el = {
    addEventListener(name, callback) { handlers.set(name, callback); },
    removeEventListener(name) { handlers.delete(name); }, removeAttribute() {},
    getBoundingClientRect() { return { left: 100, top: 200, width: 22, height: 22 }; },
  };
  let shown, hidden = 0;
  editor.showTooltip = (point, text) => { shown = { point, text }; };
  editor.hideTooltip = () => hidden++;
  directives.tooltip.mounted(el, { value: 'Updating Dictionary entries', instance: editor });
  handlers.get('focus')();
  assert.equal(shown.point.clientX, 111); assert.equal(shown.point.clientY, 211);
  assert.equal(shown.text, 'Updating Dictionary entries');
  directives.tooltip.unmounted(el);
  assert.equal(hidden, 1); assert.equal(handlers.size, 0);
});

test('settings-only cloud updates preserve Dictionary rows and do not normalize them again', () => {
  const { editor: e } = loadEditor();
  const dictionary = e.dictionary;
  let normalized = 0;
  e.ensureDictionaryIds = () => normalized++;
  e.importSettings({ dictionary, editorRegexes: e.editorRegexes, lang: 'Thai', theme: 'dark' });
  assert.equal(e.dictionary, dictionary); assert.equal(normalized, 0); assert.equal(e.theme, 'dark');
  const nextDictionary = [{ _id: 'remote', find: 'Fire', replace: 'ไฟ' }];
  e.importSettings({ dictionary: nextDictionary, lang: 'Thai' });
  assert.equal(e.dictionary, nextDictionary); assert.equal(normalized, 1);
});
