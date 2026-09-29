const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CHECKS = ['whitespace', 'dash', 'tagSyntax', 'variables', 'keywords', 'decorations', 'consistency', 'terminology'];
const only = (...selected) => Object.fromEntries(CHECKS.map(key => [key, selected.includes(key)]));

function loadEditor() {
  let config;
  const calls = { terminology: 0, consistencyIndex: 0, consistency: 0 };
  const timers = [];
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const window = { location: { search: '?testMode=1&lang=Thai' }, CloudUI: { mixin: {} } };
  const context = vm.createContext({
    window, URLSearchParams, console, clearTimeout,
    setTimeout(callback, delay) { timers.push(delay); return setTimeout(callback, delay); },
    document: { querySelectorAll() { return []; } },
    alert(message) { throw new Error(`Unexpected alert: ${message}`); },
    confirm(message) { throw new Error(`Unexpected confirmation: ${message}`); },
    Vue: {
      defineComponent(value) { config = value; return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; },
      nextTick() { return Promise.resolve(); },
    },
  });
  for (const name of ['helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'), context, { filename: name });
  }
  for (const [api, name, counter] of [
    [window.TerminologyDiagnostics, 'analyze', 'terminology'],
    [window.TranslationDiagnostics, 'createConsistencyIndex', 'consistencyIndex'],
    [window.TranslationDiagnostics, 'getConsistencyDiagnostic', 'consistency'],
  ]) {
    const original = api[name];
    api[name] = function (...args) { calls[counter]++; return original.apply(this, args); };
  }
  const editor = Object.assign(config.data(), config.methods, {
    lang: 'Thai', gameVersion: 'poe1',
    dictionary: [{ find: 'Fire', replace: 'ไฟ' }],
    // Exercise opening, scanning, and validation without DOM layout or persistence.
    filterDesc() {}, saveSettings() {}, scheduleEditorHLterRefresh() {},
    buildEnglishHLter(english) { return { englishHLter: english, HLs: [] }; },
    $nextTick() { return Promise.resolve(); }, $refs: { diagnosticScanDialog: dialog },
  });
  for (const [name, getter] of Object.entries(config.computed)) {
    Object.defineProperty(editor, name, { get: () => getter.call(editor) });
  }
  return { editor, config, calls, timers, dialog };
}

function description(name, english, translation) {
  return {
    filepath: `test/${name}.txt`, filedir: 'test', filename: `${name}.txt`,
    translations: { English: [english], Thai: [translation] },
    hasChanges: false, isMissing: false, needsReview: false,
  };
}

function conflictingEntries(editor) {
  const first = description('first', 'Fire damage', 'ความเสียหายผิด');
  const second = description('second', 'Fire damage', 'ความเสียหายไฟ');
  editor.descs = [first, second];
  return { first, second };
}

test('manual scan defaults select every category except dictionary terminology', () => {
  const { editor } = loadEditor();
  assert.deepEqual(Object.keys(editor.diagnosticScanChecks).sort(), [...CHECKS].sort());
  for (const key of CHECKS) assert.equal(editor.diagnosticScanChecks[key], key !== 'terminology', key);
});

test('selector waits for Start scan and resets defaults each time it opens', async () => {
  const { editor, calls, dialog } = loadEditor();
  conflictingEntries(editor);
  editor.diagnosticScanChecks = only('terminology');
  editor.openDiagnosticScanDialog();
  assert.equal(dialog.open, true);
  assert.equal(editor.diagnosticScanChecks.terminology, false);
  assert.equal(editor.diagnosticScanChecks.consistency, true);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.deepEqual(calls, { terminology: 0, consistencyIndex: 0, consistency: 0 });
  editor.closeDiagnosticScanDialog();
  assert.equal(dialog.open, false);
  assert.deepEqual(calls, { terminology: 0, consistencyIndex: 0, consistency: 0 });
  editor.openDiagnosticScanDialog();
  editor.diagnosticScanChecks = only();
  assert.equal(editor.hasDiagnosticScanSelection, false);
  await editor.startDiagnosticScan();
  assert.equal(dialog.open, true, 'An empty selection must stay in the selector.');
  assert.equal(editor.diagnosticScanCompleted, false);
  editor.diagnosticScanChecks = only('consistency');
  await editor.startDiagnosticScan();
  assert.equal(dialog.open, false);
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
});

test('each basic scan category can be selected independently', () => {
  const { editor, calls } = loadEditor();
  const fixtures = [
    ['whitespace', 'Fire', ' ผิด', 'leading-whitespace'],
    ['dash', 'Fire', '-ผิด', 'dash-boundary'],
    ['tagSyntax', 'Fire', 'ผิด]', 'extra-closing-tag'],
    ['variables', 'Fire {1}%', 'ผิด {1}', 'variable-tag-identity-mismatch'],
    ['keywords', '[Fire|Fire]', '[Cold|ผิด]', 'keyword-popup-tag-name-mismatch'],
    ['decorations', '<white>{{Fire}}', '<red>{{ผิด}}', 'text-decoration-tag-name-mismatch'],
  ];
  for (const [key, english, translation, code] of fixtures) {
    const selected = editor.analyzeTranslationDiagnostics(translation, english, 'Thai', only(key));
    assert.deepEqual(Array.from(selected.diagnostics, item => item.code), [code], key);
    const excluded = editor.analyzeTranslationDiagnostics(translation, english, 'Thai', only());
    assert.equal(excluded.diagnostics.length, 0, `Excluded ${key} must not contribute to scan results.`);
  }
  assert.deepEqual(calls, { terminology: 0, consistencyIndex: 0, consistency: 0 });
});

test('opening and editing a file never run either manual-only analyzer', () => {
  const { editor, calls } = loadEditor();
  const { first } = conflictingEntries(editor);
  editor.editFile(first.filepath);
  assert.equal(editor.editorConsistencyDiagnostics.some(Boolean), false);
  assert.equal(editor.blockTerminologyDiagnostics(editor.editorBlocks[0]).length, 0);
  editor.editorBlocks[0].translation = 'เปลี่ยนข้อความ';
  editor.refreshEditorDiagnostics();
  assert.equal(editor.collectEditorDiagnostics().length, 0);
  assert.deepEqual(calls, { terminology: 0, consistencyIndex: 0, consistency: 0 });
});

test('default manual scan finds consistency and reuses warnings only for unchanged entries', async () => {
  const { editor, calls } = loadEditor();
  const { first } = conflictingEntries(editor);
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
  assert.equal(calls.terminology, 0);
  assert.equal(calls.consistencyIndex, 1);
  const scannedCalls = { ...calls };
  editor.editFile(first.filepath);
  assert.equal(editor.editorConsistencyDiagnostics[0].code, 'inconsistent-translation');
  assert.equal(editor.blockTerminologyDiagnostics(editor.editorBlocks[0]).length, 0);
  editor.editorBlocks[0].translation += 'ฉบับร่าง';
  editor.refreshEditorDiagnostics();
  assert.equal(editor.editorConsistencyDiagnostics.some(Boolean), false, 'A changed draft must not show stale consistency results.');
  editor.editorBlocks[0].translation = first.translations.Thai[0];
  assert.equal(editor.editorConsistencyDiagnostics[0].code, 'inconsistent-translation');
  editor.editorBlocks[0].english = 'Changed source';
  assert.equal(editor.editorConsistencyDiagnostics.some(Boolean), false, 'A changed source must not show cached diagnostics.');
  assert.deepEqual(calls, scannedCalls, 'Rendering or editing cached results must not perform another analysis.');
});

test('terminology is opt-in and cached table warnings disappear after a draft change', async () => {
  const { editor, calls } = loadEditor();
  const table = description('table', 'Fire@Fire damage', 'ผิด@ไฟ');
  editor.descs = [table];
  editor.diagnosticScanChecks = only('terminology');
  await editor.scanAllDiagnostics();
  const result = editor.diagnosticScanResults[table.filepath];
  assert.equal(result.warningCount, 1);
  assert.equal(result.terminologyDiagnostics[0].columnIndex, 0);
  assert.equal(calls.terminology, 2, 'Each table column is checked independently.');
  assert.equal(calls.consistencyIndex, 0, 'A terminology-only scan must not build the consistency index.');
  assert.equal(calls.consistency, 0);
  const scannedCalls = { ...calls };
  editor.editFile(table.filepath);
  const block = editor.editorBlocks[0];
  assert.equal(editor.blockTerminologyDiagnostics(block).length, 1);
  block.tableColumns[0].translation = 'ไฟ';
  editor.refreshEditorDiagnostics();
  assert.equal(editor.blockTerminologyDiagnostics(block).length, 0, 'Edited table cells must not retain stale terminology warnings.');
  assert.deepEqual(calls, scannedCalls);
});

test('saving or changing the dictionary invalidates results without scheduling a rescan', async () => {
  const { editor, config, calls, timers } = loadEditor();
  const { first } = conflictingEntries(editor);
  editor.diagnosticScanChecks = only('consistency', 'terminology');
  await editor.scanAllDiagnostics();
  const beforeSave = { ...calls };
  first.translations.Thai[0] = 'ความเสียหายไฟ';
  editor.updateScannedDescDiagnostics(first);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
  assert.deepEqual(calls, beforeSave);
  await editor.scanAllDiagnostics();
  const beforeDictionaryChange = { ...calls };
  const timerCount = timers.length;
  editor.dictionary[0].replace = 'เปลวไฟ';
  config.watch.dictionary.handler.call(editor);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
  assert.deepEqual(calls, beforeDictionaryChange);
  assert.equal(timers.length, timerCount, 'Dictionary edits must not schedule an automatic scan.');
});

test('deselecting scan checks does not disable automatic editor errors', () => {
  const { editor, calls } = loadEditor();
  editor.diagnosticScanChecks = only();
  const desc = description('variable', 'Damage {1}%', 'ความเสียหาย {1}');
  editor.descs = [desc];
  editor.editFile(desc.filepath);
  editor.refreshEditorDiagnostics();
  assert.equal(editor.collectEditorDiagnostics('error')[0].code, 'variable-tag-identity-mismatch');
  assert.deepEqual(calls, { terminology: 0, consistencyIndex: 0, consistency: 0 });
});

test('a save during a yielded scan cancels it without publishing partial results or restarting', async () => {
  const { editor, calls } = loadEditor();
  editor.descs = Array.from({ length: 26 }, (_, index) => description(`entry-${index}`, 'Fire damage', `ผิด ${index}`));
  editor.diagnosticScanChecks = only('consistency', 'terminology');
  const scanning = editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanRunning, true);
  assert.equal(editor.diagnosticScanProcessed, 25);
  const interruptedCalls = { ...calls };
  editor.descs[0].translations.Thai[0] = 'ไฟ';
  editor.updateScannedDescDiagnostics(editor.descs[0]);
  await scanning;
  assert.equal(editor.diagnosticScanRunning, false);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
  assert.deepEqual(calls, interruptedCalls);
});
