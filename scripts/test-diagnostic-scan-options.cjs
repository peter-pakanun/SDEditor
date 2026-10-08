const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Terminology = require('../public/terminologyDiagnostics.js');

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
  for (const name of ['workspaceState.js', 'dictionaryScope.js', 'helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'editorDictionaryIndex.js', 'index.js']) {
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

test('selector waits for Start scan and retains choices and results when reopened', async () => {
  const { editor, calls, dialog } = loadEditor();
  conflictingEntries(editor);
  editor.diagnosticScanChecks = only('terminology');
  editor.openDiagnosticScanDialog();
  assert.equal(dialog.open, true);
  assert.equal(editor.diagnosticScanChecks.terminology, true);
  assert.equal(editor.diagnosticScanChecks.consistency, false);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.deepEqual(calls, { terminology: 0, consistencyIndex: 0, consistency: 0 });
  editor.closeDiagnosticScanDialog();
  assert.equal(dialog.open, false);
  assert.deepEqual(calls, { terminology: 0, consistencyIndex: 0, consistency: 0 });
  editor.openDiagnosticScanDialog();
  assert.equal(editor.diagnosticScanChecks.terminology, true, 'Reopening must retain the chosen checks.');
  editor.diagnosticScanChecks = only();
  assert.equal(editor.hasDiagnosticScanSelection, false);
  await editor.startDiagnosticScan();
  assert.equal(dialog.open, true, 'An empty selection must stay in the selector.');
  assert.equal(editor.diagnosticScanCompleted, false);
  editor.diagnosticScanChecks = only('consistency');
  await editor.startDiagnosticScan();
  assert.equal(dialog.open, true, 'Progress and results stay in the modal.');
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
  assert.equal(editor.diagnosticScanResultFiles.length, 2);
  assert.equal(editor.diagnosticScanVisibleResults[0].result.diagnostics[0].code, 'inconsistent-translation');
  editor.closeDiagnosticScanDialog();
  editor.openDiagnosticScanDialog();
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanChecks.consistency, true);
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

test('opening and editing a file never run either manual-only analyzer', async () => {
  const { editor, calls } = loadEditor();
  const { first } = conflictingEntries(editor);
  await editor.editFile(first.filepath);
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
  await editor.editFile(first.filepath);
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

test('inline save checks retain cached manual warnings without starting another scan', async () => {
  const { editor, calls } = loadEditor();
  const { first } = conflictingEntries(editor);
  editor.diagnosticScanChecks = only('consistency', 'terminology');
  await editor.scanAllDiagnostics();
  await editor.editFile(first.filepath);
  editor.editorVisible = false;
  editor.inlineActive = true;
  const before = { ...calls };
  assert.equal(editor.editorConsistencyDiagnostics[0]?.code, 'inconsistent-translation');
  assert.equal(editor.blockTerminologyDiagnostics(editor.editorBlocks[0]).length, 1);
  const findings = editor.editorSaveFindings(first.translations.Thai);
  assert.ok(findings.warnings.some(item => item.code === 'inconsistent-translation'));
  assert.ok(findings.warnings.some(item => item.code !== 'inconsistent-translation'));
  assert.ok(findings.confirmations.some(message => message.startsWith('Translation warnings found:')));
  editor.editorBlocks[0].translation += ' draft';
  assert.equal(editor.editorConsistencyDiagnostics.some(Boolean), false);
  assert.equal(editor.blockTerminologyDiagnostics(editor.editorBlocks[0]).length, 0);
  assert.deepEqual(calls, before, 'Rendering and validating inline drafts reuse the completed scan only.');
});

test('Hide DNT excludes files from every selected check and from consistency peers', async () => {
  const { editor, calls } = loadEditor();
  const visible = description('visible', 'Fire damage {1}%', 'ไฟ {1}%');
  const hidden = description('hidden', 'Fire damage {1}%', ' ผิด {1}');
  hidden.isDNT = true;
  const error = description('error', 'Duration {2}', 'ระยะเวลา');
  editor.descs = [visible, hidden, error];
  editor.diagnosticScanChecks = only('whitespace', 'variables', 'consistency', 'terminology');
  editor.hideDNT = true;
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanTotal, 2);
  assert.equal(editor.diagnosticScanProcessed, 2);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), [visible.filepath, error.filepath]);
  assert.equal(editor.diagnosticScanWarningFileCount, 0);
  assert.equal(editor.diagnosticScanErrorFileCount, 1);
  assert.equal(editor.diagnosticScanResults[visible.filepath].consistencyDiagnostics.length, 0,
    'A hidden DNT translation must not create a conflict on a scanned file.');
  assert.deepEqual(calls, { terminology: 2, consistencyIndex: 1, consistency: 2 });

  editor.hideDNT = false;
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanTotal, 3);
  assert.equal(editor.diagnosticScanProcessed, 3);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), [visible.filepath, hidden.filepath, error.filepath]);
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
  assert.equal(editor.diagnosticScanErrorFileCount, 2);
  assert.equal(editor.diagnosticScanResults[visible.filepath].consistencyDiagnostics[0].code, 'inconsistent-translation');
  assert.ok(editor.diagnosticScanResults[hidden.filepath].diagnostics.some(item => item.code === 'leading-whitespace'));
  assert.ok(editor.diagnosticScanResults[hidden.filepath].terminologyDiagnostics.length);
  assert.deepEqual(calls, { terminology: 5, consistencyIndex: 2, consistency: 5 });
});

test('a scan with only hidden DNT files completes with no eligible files or issues', async () => {
  const { editor, calls } = loadEditor();
  editor.descs = [description('hidden', 'Fire {1}%', ' ผิด {1}')];
  editor.descs[0].isDNT = true;
  editor.hideDNT = true;
  editor.diagnosticScanChecks = only('whitespace', 'variables', 'consistency', 'terminology');
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanRunning, false);
  assert.equal(editor.diagnosticScanTotal, 0);
  assert.equal(editor.diagnosticScanProcessed, 0);
  assert.equal(editor.diagnosticScanPercent, 100);
  assert.equal(editor.diagnosticScanWarningFileCount, 0);
  assert.equal(editor.diagnosticScanErrorFileCount, 0);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
  assert.equal(calls.terminology, 0);
  assert.equal(calls.consistency, 0);
});

test('toggling Hide DNT in either direction invalidates a completed scan without rescanning', async () => {
  const { editor, config, calls, timers } = loadEditor();
  const { second } = conflictingEntries(editor);
  second.isDNT = true;
  editor.diagnosticScanChecks = only('consistency');
  editor.hideDNT = false;
  for (const hideDNT of [true, false]) {
    await editor.scanAllDiagnostics();
    assert.equal(editor.diagnosticScanCompleted, true);
    const beforeToggle = { ...calls };
    const timerCount = timers.length;
    editor.hideDNT = hideDNT;
    config.watch.hideDNT.call(editor);
    assert.equal(editor.diagnosticScanCompleted, false);
    assert.equal(editor.diagnosticScanRunning, false);
    assert.equal(editor.diagnosticScanTotal, 0);
    assert.equal(editor.diagnosticScanWarningFileCount, 0);
    assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
    assert.deepEqual(calls, beforeToggle);
    assert.equal(timers.length, timerCount, 'Changing Hide DNT must not schedule an automatic scan.');
  }
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
  await editor.editFile(table.filepath);
  const block = editor.editorBlocks[0];
  assert.equal(editor.blockTerminologyDiagnostics(block).length, 1);
  block.tableColumns[0].translation = 'ไฟ';
  editor.refreshEditorDiagnostics();
  assert.equal(editor.blockTerminologyDiagnostics(block).length, 0, 'Edited table cells must not retain stale terminology warnings.');
  assert.deepEqual(calls, scannedCalls);
});

test('gem level keywords retain dictionary ownership, alternatives and plain terminology', () => {
  const compiled = Terminology.compileDictionary([
    { _id: 'skill', find: 'BattlemagesCry', replace: 'คำรามนักรบเวท', alts: [
      { find: "Battlemage's Cry", replace: "คำรามนักรบเวท (Battlemage's Cry)" },
    ] },
    { _id: 'cry', find: 'Cry', replace: 'ร้อง' },
  ]);
  for (const identity of ['BattlemagesCry', 'BattlemagesCry<gemlevel=20>', 'BattlemagesCry<gemlevel={0}>']) {
    const english = `[${identity}|Battlemage's Cry]`;
    for (const display of ['คำรามนักรบเวท', "คำรามนักรบเวท (Battlemage's Cry)"]) {
      assert.deepEqual(Terminology.analyze(english, `[${identity}|${display}]`, compiled), [], identity);
    }
    const translation = `[${identity}|ผิด]`;
    const findings = Terminology.analyze(english, translation, compiled);
    assert.equal(findings.length, 1, 'The keyword owns its display; Cry must not add a second warning.');
    assert.equal(findings[0].sourceTerm, `[${identity}]`);
    assert.deepEqual(findings[0].dictionaryIds, ['skill']);
    assert.equal(translation.slice(findings[0].start, findings[0].end), translation);
  }
  assert.deepEqual(Terminology.analyze('Cry', 'ร้อง', compiled), []);
  assert.equal(Terminology.analyze('Cry', 'ผิด', compiled)[0].sourceTerm, 'Cry');
});

test('different gem levels compare their own display and target range independently', () => {
  const compiled = Terminology.compileDictionary([{ _id: 'skill', find: 'BattlemagesCry', replace: 'คำรามนักรบเวท' }]);
  const first = 'BattlemagesCry<gemlevel={0}>', second = 'BattlemagesCry<gemlevel={1}>';
  const english = `[${first}|Battlemage's Cry] and [${second}|Battlemage's Cry]`;
  const wrongTag = `[${second}|ผิด]`;
  const translation = `ก่อน ${wrongTag} แล้ว [${first}|คำรามนักรบเวท]`;
  const findings = Terminology.analyze(english, translation, compiled);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].sourceTerm, `[${second}]`);
  assert.equal(findings[0].start, translation.indexOf(wrongTag));
  assert.equal(translation.slice(findings[0].start, findings[0].end), wrongTag);
});

test('a changed gem level remains a missing full terminology identity and a keyword error', () => {
  const compiled = Terminology.compileDictionary([{ find: 'BattlemagesCry', replace: 'คำรามนักรบเวท' }]);
  const english = '[BattlemagesCry<gemlevel={0}>|Battlemage\'s Cry]';
  const translation = '[BattlemagesCry<gemlevel={1}>|คำรามนักรบเวท]';
  const findings = Terminology.analyze(english, translation, compiled);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].sourceTerm, '[BattlemagesCry<gemlevel={0}>]');
  assert.match(findings[0].message, /No corresponding \[BattlemagesCry<gemlevel=\{0\}>\]/);
  const { editor } = loadEditor();
  const result = editor.analyzeTranslationDiagnostics(translation, english, 'Thai', only('keywords'));
  assert.equal(result.errorCount, 1);
  assert.equal(result.diagnostics[0].code, 'keyword-popup-tag-name-mismatch');
});

test('gem level metadata preserves placeholder display handling', () => {
  const compiled = Terminology.compileDictionary([{ find: 'BattlemagesCry', replace: 'คำรามนักรบเวท' }]);
  const identity = 'BattlemagesCry<gemlevel={0}>';
  assert.deepEqual(Terminology.analyze(`[${identity}]`, `[${identity}|คำรามนักรบเวท]`, compiled), []);
  assert.deepEqual(Terminology.analyze(`[${identity}|Battlemage's Cry {1}]`, `[${identity}|คำรามนักรบเวท {1}]`, compiled), []);
  assert.deepEqual(Terminology.analyze(`[${identity}|Battlemage's Cry]`, `[${identity}|<skill_name>]`, compiled), []);
});

test('terminology ignores only valid trailing gem level metadata during dictionary lookup', () => {
  const compiled = Terminology.compileDictionary([{ find: 'BattlemagesCry', replace: 'คำรามนักรบเวท' }]);
  for (const suffix of ['<other=20>', '<gemlevel=-1>', '<gemlevel={name}>', '<gemlevel={0}>tail']) {
    const identity = 'BattlemagesCry' + suffix;
    assert.deepEqual(Terminology.analyze(`[${identity}|Unknown wording]`, `[${identity}|ผิด]`, compiled), [], suffix);
  }
});

test('saving a partial correction preserves remaining file issues, unrelated results, and list state', async () => {
  const { editor, config, calls, timers } = loadEditor();
  const first = description('first', 'Fire {1}', 'ไฟ');
  first.translations.English.push('Duration {2}');
  first.translations.Thai.push('ระยะเวลา');
  const second = description('second', 'Cold {3}', 'เย็น');
  const third = description('third', 'Lightning {4}', 'สายฟ้า');
  editor.descs = [first, second, third];
  editor.diagnosticScanChecks = only('variables');
  editor.selectedFileFilters = ['diagnosticError'];
  editor.diagnosticScanResultsPageSize = 1;
  editor.filterDesc = config.methods.filterDesc;
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanIssueCounts.errors, 4);
  editor.diagnosticScanResultsPage = 2;
  const otherResults = [second, third].map(desc => editor.diagnosticScanResults[desc.filepath]);
  const appliedChecks = editor.diagnosticScanAppliedChecks;
  const runId = editor.diagnosticScanRunId;
  const timerCount = timers.length;
  editor.scanAllDiagnostics = async () => { throw new Error('A correction must not restart the full scan.'); };

  first.translations.Thai[0] = 'ไฟ {1}';
  editor.updateScannedDescDiagnostics(first);
  editor.filterDesc();
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanRunning, false);
  assert.equal(editor.diagnosticScanAppliedChecks, appliedChecks);
  assert.equal(editor.diagnosticScanRunId, runId);
  assert.equal(editor.diagnosticScanProcessed, 3);
  assert.equal(editor.diagnosticScanTotal, 3);
  assert.equal(editor.diagnosticScanErrorFileCount, 3);
  assert.equal(editor.diagnosticScanIssueCounts.errors, 3);
  assert.deepEqual(Array.from(editor.diagnosticScanResults[first.filepath].diagnostics, item => item.blockIndex), [1]);
  assert.equal(editor.diagnosticScanResultsPage, 2);
  assert.equal(editor.diagnosticScanResultPageCount, 3);
  assert.equal(editor.diagnosticScanVisibleResults[0].filepath, second.filepath);
  assert.deepEqual(Array.from(editor.selectedFileFilters), ['diagnosticError']);
  assert.deepEqual(Array.from(editor.filteredDescs, desc => desc.filepath), [first.filepath, second.filepath, third.filepath]);
  assert.equal(editor.diagnosticScanResults[second.filepath], otherResults[0]);
  assert.equal(editor.diagnosticScanResults[third.filepath], otherResults[1]);

  first.translations.Thai[1] = 'ระยะเวลา {2}';
  editor.updateScannedDescDiagnostics(first.filepath);
  editor.filterDesc();
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanResults[first.filepath].hasDiagnosticError, false);
  assert.equal(editor.diagnosticScanErrorFileCount, 2);
  assert.equal(editor.diagnosticScanIssueCounts.errors, 2);
  assert.deepEqual(Array.from(editor.filteredDescs, desc => desc.filepath), [second.filepath, third.filepath]);
  assert.equal(editor.diagnosticScanResultsPage, 2);
  assert.equal(editor.diagnosticScanResultPageCount, 2);
  assert.equal(editor.diagnosticScanResults[second.filepath], otherResults[0]);
  assert.equal(editor.diagnosticScanResults[third.filepath], otherResults[1]);
  assert.deepEqual(calls, { terminology: 0, consistencyIndex: 0, consistency: 0 });
  assert.equal(timers.length, timerCount, 'Updating completed results must not schedule a full scan.');
});

test('saved corrections use the completed scan checks after dialog choices change', async () => {
  const { editor, calls } = loadEditor();
  const first = description('first', 'Fire damage', 'ผิด');
  const peer = description('peer', 'Fire damage', ' ไฟ');
  editor.descs = [first, peer];
  editor.diagnosticScanChecks = only('consistency', 'terminology');
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanResults[first.filepath].warningCount, 2);
  const checks = editor.diagnosticScanAppliedChecks;
  editor.diagnosticScanChecks = only('whitespace');
  first.translations.Thai[0] = ' ไฟ';
  editor.updateScannedDescDiagnostics([first]);
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanAppliedChecks, checks);
  assert.equal(editor.diagnosticScanResults[first.filepath].warningCount, 0,
    'The newly selected whitespace check must not alter the completed scan.');
  assert.equal(editor.diagnosticScanResults[peer.filepath].warningCount, 0,
    'Resolving the shared group must refresh its already-correct peer.');
  assert.equal(editor.diagnosticScanWarningFileCount, 0);
  assert.ok(calls.terminology > 2, 'Previously selected terminology remains part of saved-file analysis.');
});

test('saving refreshes normalized English peers when consistency resolves or newly appears', async () => {
  const { editor } = loadEditor();
  const first = description('first', 'Fire\\nDamage', 'หนึ่ง');
  first.translations.English.push('Cold damage');
  first.translations.Thai.push('เย็น');
  const peer = description('peer', 'Fire\r\nDamage', 'สอง');
  const unrelated = description('unrelated', 'Cold damage', 'เย็น');
  editor.descs = [first, peer, unrelated];
  editor.diagnosticScanChecks = only('consistency');
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
  const unrelatedResult = editor.diagnosticScanResults[unrelated.filepath];
  first.translations.Thai[0] = 'สอง';
  editor.updateScannedDescDiagnostics([first.filepath]);
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanWarningFileCount, 0);
  assert.equal(editor.diagnosticScanResults[peer.filepath].consistencyDiagnostics.length, 0);
  assert.equal(editor.diagnosticScanResults[unrelated.filepath], unrelatedResult,
    'Peers of unchanged entries in the saved file must retain their cached results.');

  first.translations.Thai[0] = 'สาม';
  editor.updateScannedDescDiagnostics(first);
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
  assert.equal(editor.diagnosticScanIssueCounts.warnings, 2);
  assert.equal(editor.diagnosticScanResults[first.filepath].consistencyDiagnostics.length, 1);
  assert.equal(editor.diagnosticScanResults[peer.filepath].consistencyDiagnostics.length, 1,
    'A previously clean peer must gain the newly created consistency warning.');
  assert.equal(editor.diagnosticScanResults[unrelated.filepath], unrelatedResult);
});

test('saved consistency updates reuse the index and analyze only changed files and affected peers', async () => {
  const { editor, calls } = loadEditor();
  const first = description('first', 'Fire damage', 'หนึ่ง');
  const peer = description('peer', 'Fire damage', 'สอง');
  const unrelated = Array.from({ length: 250 }, (_, i) => description(`other-${i}`, `Other ${i}`, `อื่น ${i}`));
  editor.descs = [first, peer, ...unrelated];
  editor.diagnosticScanChecks = only('consistency');
  await editor.scanAllDiagnostics();
  const index = editor._diagnosticScanCache.consistencyIndex;
  const results = editor.diagnosticScanResults;
  const untouched = results[unrelated[0].filepath];
  const analyzed = calls.consistency;
  first.translations.Thai[0] = 'สอง';
  const refreshed = editor.updateScannedDescDiagnostics(first);
  assert.deepEqual(Array.from(refreshed).sort(), [first.filepath, peer.filepath].sort());
  assert.equal(editor._diagnosticScanCache.consistencyIndex, index);
  assert.equal(calls.consistencyIndex, 1, 'A save must reuse the index created by the manual scan.');
  assert.equal(calls.consistency - analyzed, 2, 'Unrelated files must not be analyzed again.');
  assert.equal(editor.diagnosticScanResults, results, 'A one-file update must not copy the entire results map.');
  assert.equal(results[unrelated[0].filepath], untouched);
  assert.equal(editor.diagnosticScanWarningFileCount, 0);
  first.translations.Thai[0] = 'สาม';
  editor.updateScannedDescDiagnostics(first);
  assert.equal(calls.consistencyIndex, 1);
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
});

test('incremental consistency updates refresh peers of removed and newly joined source groups', async () => {
  const { editor, calls } = loadEditor();
  const first = description('first', 'Fire damage', 'หนึ่ง');
  const oldPeer = description('old-peer', 'Fire damage', 'สอง');
  const newPeer = description('new-peer', 'Cold damage', 'เย็น');
  editor.descs = [first, oldPeer, newPeer];
  editor.diagnosticScanChecks = only('consistency');
  await editor.scanAllDiagnostics();
  first.translations.English[0] = 'Cold damage';
  const refreshed = editor.updateScannedDescDiagnostics(first);
  assert.deepEqual(Array.from(refreshed).sort(), [first.filepath, oldPeer.filepath, newPeer.filepath].sort());
  assert.equal(editor.diagnosticScanResults[oldPeer.filepath].consistencyDiagnostics.length, 0);
  assert.equal(editor.diagnosticScanResults[first.filepath].consistencyDiagnostics[0].entryCount, 2);
  assert.equal(editor.diagnosticScanResults[newPeer.filepath].consistencyDiagnostics[0].entryCount, 2);
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
  assert.equal(calls.consistencyIndex, 1);
});

test('batched consistency updates match a fresh index for repeated, removed, empty and added entries', () => {
  const diagnostics = require('../public/translationDiagnostics.js');
  const first = description('first', 'Fire damage', 'ไฟ');
  first.translations.English.push('Fire damage', 'Removed');
  first.translations.Thai.push('ผิด', 'เก่า');
  const second = description('second', 'Fire damage', 'ไฟ');
  const peer = description('peer', 'Cold damage', 'เย็น');
  const descs = [first, second, peer];
  const previous = Object.fromEntries(descs.map(desc => [desc.filepath, {
    englishLines: [...desc.translations.English], translationLines: [...desc.translations.Thai],
  }]));
  const index = diagnostics.createConsistencyIndex(descs, 'Thai');
  first.translations.English = ['Fire damage', 'Cold damage'];
  first.translations.Thai = ['', 'ใหม่'];
  second.translations.Thai = ['ต่าง'];
  const affected = diagnostics.updateConsistencyIndex(index, [first, second], 'Thai', previous);
  const canonical = map => [...map].map(([source, group]) => [source, group.entryCount,
    [...group.variants].map(([translation, locations]) => [translation,
      locations.map(location => JSON.stringify(location)).sort()]).sort((a, b) => a[0].localeCompare(b[0])),
  ]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(canonical(index), canonical(diagnostics.createConsistencyIndex(descs, 'Thai')));
  assert.deepEqual([...affected].sort(), descs.map(desc => desc.filepath).sort());
  assert.equal(index.has('Removed'), false);
});

test('completed diagnostic caches cannot survive changed workspace, language, game, source, account, branch or DNT scope', async () => {
  for (const change of [
    editor => { editor.descs = editor.descs.slice(); },
    editor => { editor.lang = 'German'; },
    editor => { editor.gameVersion = 'poe2'; },
    editor => { editor.sourceIdentity = 'new-source'; },
    editor => { editor.cloudUser = { id: 'another-account' }; },
    editor => { editor.branchId = 'another-branch'; },
    editor => { editor.hideDNT = !editor.hideDNT; },
  ]) {
    const { editor, calls } = loadEditor();
    const { first } = conflictingEntries(editor);
    editor.diagnosticScanChecks = only('consistency');
    await editor.scanAllDiagnostics();
    const before = { ...calls };
    change(editor);
    assert.equal(editor.updateScannedDescDiagnostics(first), null);
    assert.equal(editor.diagnosticScanCompleted, false);
    assert.equal(editor._diagnosticScanCache, null);
    assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
    assert.deepEqual(calls, before, 'Invalidating stale diagnostics must not start another scan.');
  }
});

test('saved-file updates retain Hide DNT exclusions from results and consistency groups', async () => {
  const { editor } = loadEditor();
  const first = description('first', 'Fire damage', 'ไฟ');
  const peer = description('peer', 'Fire damage', 'ไฟ');
  const hidden = description('hidden', 'Fire damage', 'เปลวไฟ');
  hidden.isDNT = true;
  editor.hideDNT = true;
  editor.descs = [first, peer, hidden];
  editor.diagnosticScanChecks = only('whitespace', 'consistency');
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanWarningFileCount, 0);
  const visibleResults = [first, peer].map(desc => editor.diagnosticScanResults[desc.filepath]);
  hidden.translations.Thai[0] = ' ซ่อน';
  editor.updateScannedDescDiagnostics(hidden);
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanWarningFileCount, 0);
  assert.equal(editor.diagnosticScanResults[hidden.filepath], undefined);
  assert.equal(editor.diagnosticScanResults[first.filepath], visibleResults[0]);
  assert.equal(editor.diagnosticScanResults[peer.filepath], visibleResults[1]);

  first.translations.Thai[0] = ' ไฟ';
  editor.updateScannedDescDiagnostics([hidden, first]);
  assert.equal(editor.diagnosticScanResults[hidden.filepath], undefined);
  assert.equal(editor.diagnosticScanTotal, 2);
  assert.equal(editor.diagnosticScanProcessed, 2);
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
  assert.equal(editor.diagnosticScanIssueCounts.warnings, 3);
  assert.equal(editor.diagnosticScanResults[first.filepath].consistencyDiagnostics[0].entryCount, 2);
});

test('saved changes without a manual scan do not start either manual-only analyzer', () => {
  const { editor, calls, timers } = loadEditor();
  const { first } = conflictingEntries(editor);
  first.translations.Thai[0] = 'ไฟ';
  editor.updateScannedDescDiagnostics(first);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
  assert.deepEqual(calls, { terminology: 0, consistencyIndex: 0, consistency: 0 });
  assert.equal(timers.length, 0);
});

test('changing the dictionary invalidates results without scheduling a rescan', async () => {
  const { editor, config, calls, timers } = loadEditor();
  conflictingEntries(editor);
  editor.diagnosticScanChecks = only('consistency', 'terminology');
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

test('Dictionary edits without a diagnostic scan keep the file list and diagnostic state untouched', () => {
  const { editor, config, calls, timers } = loadEditor();
  conflictingEntries(editor);
  const results = editor.diagnosticScanResults;
  const run = editor.diagnosticScanRunId;
  let filtering = 0;
  editor.filterDesc = () => { filtering++; };
  for (let i = 0; i < 3; i++) {
    editor.dictionary[0].replace += 'x';
    config.watch.dictionary.handler.call(editor);
  }
  assert.equal(filtering, 0);
  assert.equal(editor.diagnosticScanResults, results);
  assert.equal(editor.diagnosticScanRunId, run);
  assert.deepEqual(calls, { terminology: 0, consistencyIndex: 0, consistency: 0 });
  assert.equal(timers.length, 0);
});

test('Dictionary edits remove existing diagnostic rows once and cancel a scan without unnecessary file filtering', () => {
  const { editor } = loadEditor();
  let filtering = 0;
  editor.filterDesc = () => { filtering++; };
  editor.diagnosticScanResults = { 'test/first.txt': { hasDiagnosticWarning: true } };
  editor.scheduleDictionaryDiagnosticScan();
  assert.equal(filtering, 1);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
  editor.diagnosticScanRunning = true;
  const run = editor.diagnosticScanRunId;
  editor.scheduleDictionaryDiagnosticScan();
  assert.equal(editor.diagnosticScanRunning, false);
  assert.equal(editor.diagnosticScanRunId, run + 1);
  assert.equal(filtering, 1, 'Cancelling a scan with no published results must not rebuild the file list.');
});

test('deselecting scan checks does not disable automatic editor errors', async () => {
  const { editor, calls } = loadEditor();
  editor.diagnosticScanChecks = only();
  const desc = description('variable', 'Damage {1}%', 'ความเสียหาย {1}');
  editor.descs = [desc];
  await editor.editFile(desc.filepath);
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
  assert.equal(editor.diagnosticScanProcessed, 0, 'The modal paints before analysis begins.');
  while (editor.diagnosticScanRunning && editor.diagnosticScanProcessed < 25) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
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

test('toggling Hide DNT during a yielded scan cancels its partial results without restarting', async () => {
  const { editor, config, calls, timers } = loadEditor();
  editor.descs = Array.from({ length: 26 }, (_, index) => description(`entry-${index}`, 'Fire damage', `ผิด ${index}`));
  editor.descs[25].isDNT = true;
  editor.hideDNT = false;
  editor.diagnosticScanChecks = only('consistency', 'terminology');
  const scanning = editor.scanAllDiagnostics();
  while (editor.diagnosticScanRunning && editor.diagnosticScanProcessed < 25) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal(editor.diagnosticScanProcessed, 25);
  const interruptedCalls = { ...calls };
  const timerCount = timers.length;
  editor.hideDNT = true;
  config.watch.hideDNT.call(editor);
  assert.equal(timers.length, timerCount, 'Changing Hide DNT must not schedule a replacement scan.');
  await scanning;
  assert.equal(editor.diagnosticScanRunning, false);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.equal(editor.diagnosticScanProcessed, 0);
  assert.equal(editor.diagnosticScanTotal, 0);
  assert.equal(editor.diagnosticScanWarningFileCount, 0);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
  assert.deepEqual(calls, interruptedCalls, 'The cancelled scan must not analyze its remaining file.');
});

test('closing a running scan keeps it available and Stop prevents partial results', async () => {
  const { editor, calls, dialog } = loadEditor();
  conflictingEntries(editor);
  editor.openDiagnosticScanDialog();
  const scanning = editor.startDiagnosticScan();
  assert.equal(editor.diagnosticScanRunning, true);
  editor.closeDiagnosticScanDialog();
  assert.equal(dialog.open, false);
  assert.equal(editor.diagnosticScanRunning, true);
  editor.openDiagnosticScanDialog();
  assert.equal(dialog.open, true);
  editor.stopDiagnosticScan();
  await scanning;
  assert.equal(editor.diagnosticScanRunning, false);
  assert.equal(editor.diagnosticScanStopped, true);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
  assert.deepEqual(calls, { terminology: 0, consistencyIndex: 0, consistency: 0 });
});

test('scan failures remain in the modal and can be retried', async () => {
  const { editor, dialog } = loadEditor();
  conflictingEntries(editor);
  editor.openDiagnosticScanDialog();
  const analyze = editor.analyzeDescDiagnostics;
  editor.analyzeDescDiagnostics = () => { throw new Error('Fixture failed'); };
  await editor.startDiagnosticScan();
  assert.equal(dialog.open, true);
  assert.equal(editor.diagnosticScanRunning, false);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.match(editor.diagnosticScanError, /Fixture failed/);
  editor.analyzeDescDiagnostics = analyze;
  await editor.startDiagnosticScan();
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanError, '');
});

test('large scan results bound file cards and preserve exact issue counts', async () => {
  const { editor } = loadEditor();
  editor.descs = Array.from({ length: 21 }, (_, index) => {
    const desc = description(`entry-${index}`, 'Fire', ' ผิด');
    desc.translations.English = Array(50).fill('Fire');
    desc.translations.Thai = Array(50).fill(' ผิด');
    return desc;
  });
  editor.diagnosticScanChecks = only('whitespace');
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanResultPageCount, 2);
  assert.equal(editor.diagnosticScanVisibleResults.length, 20);
  assert.equal(editor.diagnosticScanVisibleResults[0].result.diagnostics.length, 40);
  assert.equal(editor.diagnosticScanVisibleResults[0].result.diagnosticsTruncated, 10);
  assert.equal(editor.diagnosticScanIssueCounts.warnings, 1050);
  editor.diagnosticScanResultsPage = 2;
  assert.equal(editor.diagnosticScanVisibleResults.length, 1);
});
