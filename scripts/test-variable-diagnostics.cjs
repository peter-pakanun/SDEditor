const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEditor() {
  let config;
  const alerts = [];
  const confirmations = [];
  const window = { location: { search: '?testMode=1&lang=Thai' }, CloudUI: { mixin: {} } };
  const context = vm.createContext({
    window, URLSearchParams, console, setTimeout, clearTimeout,
    alert(message) { alerts.push(message); },
    confirm(message) { confirmations.push(message); return false; },
    Vue: {
      defineComponent(value) { config = value; return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; },
      nextTick(callback) { callback?.(); return Promise.resolve(); },
    },
  });
  for (const name of ['helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'), context, { filename: name });
  }
  const editor = Object.assign(config.data(), config.methods, {
    lang: 'Thai', dictionary: [],
    // List rendering is unrelated to the diagnostic scan and save guard.
    filterDesc() {},
  });
  for (const [name, getter] of Object.entries(config.computed)) {
    Object.defineProperty(editor, name, { get: () => getter.call(editor) });
  }
  return { editor, alerts, confirmations, context };
}

function fixtureDescription(name, english, translation) {
  return {
    filepath: `test/${name}.txt`, filedir: 'test', filename: `${name}.txt`,
    translations: { English: [english], Thai: [translation] },
    hasChanges: false, isMissing: false, needsReview: false,
  };
}

function variableErrors(editor, english, translation) {
  return editor.analyzeTranslationDiagnostics(translation, english).diagnostics
    .filter(diagnostic => diagnostic.code === 'variable-tag-identity-mismatch');
}

test('missing and extra percentage suffixes are errors with readable expected and actual tags', () => {
  const { editor } = loadEditor();
  for (const [english, translation] of [['Damage {1}%', 'ความเสียหาย {1}'], ['Damage {1}', 'ความเสียหาย {1}%']]) {
    const errors = variableErrors(editor, english, translation);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].level, 'error');
    assert.match(errors[0].message, /\{1\}%/);
    assert.match(errors[0].message, /\{1\}(?!%)/);
    assert.equal(translation.slice(errors[0].start, errors[0].end), translation.match(/\{1\}%?/)[0]);
  }
});

test('percentage suffixes belong to each variable even when total percentage count matches', () => {
  const { editor } = loadEditor();
  assert.equal(variableErrors(editor, 'Damage {1}% for {2}', 'ความเสียหาย {1} เป็นเวลา {2}%').length, 1);
  assert.equal(variableErrors(editor, '{1}% and {1}', '{1}% และ {1}%').length, 1);
});

test('valid reordered and repeated variable occurrences retain their suffixes', () => {
  const { editor } = loadEditor();
  for (const [english, translation] of [
    ['{1}% damage for {2}', '{2} เป็นเวลา ความเสียหาย {1}%'],
    ['{1}% and {1} and {1}%', '{1}% และ {1}% และ {1}'],
    ['{1}% damage\nfor {2}', '{2} เป็นเวลา\nความเสียหาย {1}%'],
    ['{1:+d}% damage', '+{1:+d}% ความเสียหาย'],
  ]) {
    assert.equal(variableErrors(editor, english, translation).length, 0, `${english} -> ${translation}`);
  }
});

test('multiline and keyword display text also compare percentage suffixes', () => {
  const { editor } = loadEditor();
  for (const [english, translation] of [
    ['Damage {1}%\nDuration {2}', 'ความเสียหาย {1}\nระยะเวลา {2}'],
    ['[Damage|{1}% damage]', '[Damage|ความเสียหาย {1}]'],
    ['<white>{{Damage {1}%}}', '<white>{{ความเสียหาย {1}}}'],
  ]) {
    assert.equal(variableErrors(editor, english, translation).length, 1);
  }
});

test('scan checks table columns independently and decodes escaped multiline entries', () => {
  const { editor } = loadEditor();
  const table = fixtureDescription('table', '{1}%@{1}', '{1}@{1}%');
  const multiline = fixtureDescription('multiline', 'Damage {1}%\\nDuration {2}', 'ความเสียหาย {1}\\nระยะเวลา {2}');
  assert.equal(editor.analyzeDescDiagnostics(table).errorCount, 2, 'Moving the suffix across columns must not cancel out.');
  assert.equal(editor.analyzeDescDiagnostics(multiline).errorCount, 1);
});

test('full diagnostic scan records suffix errors and clears them after correction', async () => {
  const { editor, alerts } = loadEditor();
  editor.descs = [
    fixtureDescription('missing', 'Damage {1}%', 'ความเสียหาย {1}'),
    fixtureDescription('extra', 'Duration {1}', 'ระยะเวลา {1}%'),
    fixtureDescription('table', '{1}%@{1}', '{1}@{1}%'),
    ...Array.from({ length: 23 }, (_, index) => fixtureDescription(`valid-${index}`, `Damage ${index}: {1}%`, `ความเสียหาย ${index}: {1}%`)),
  ];
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanRunning, false);
  assert.equal(editor.diagnosticScanProcessed, 26, 'The scan must finish after its asynchronous batch boundary.');
  assert.equal(editor.diagnosticScanErrorFileCount, 3);
  assert.equal(editor.diagnosticScanResults['test/table.txt'].errorCount, 2);
  assert.equal(editor.diagnosticScanResults['test/valid-0.txt'].hasDiagnosticError, false);
  assert.deepEqual(alerts, []);

  editor.descs[0].translations.Thai[0] += '%';
  editor.descs[1].translations.Thai[0] = 'ระยะเวลา {1}';
  editor.descs[2].translations.Thai[0] = '{1}%@{1}';
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanErrorFileCount, 0);
  assert.equal(Object.values(editor.diagnosticScanResults).some(result => result.hasDiagnosticError), false);
});

test('extra percentage is included in the diagnostic highlight and disappears after correction', () => {
  const { editor } = loadEditor();
  const block = { english: 'Damage {1}', translation: 'ความเสียหาย {1}%' };
  editor.refreshTranslationDiagnostics(block);
  assert.equal(block.diagnosticErrorCount, 1);
  const error = block.translationDiagnostics.find(diagnostic => diagnostic.code === 'variable-tag-identity-mismatch');
  assert.equal(block.translation.slice(error.start, error.end), '{1}%');
  assert.match(editor.buildTagHLter(block.translation, block.translationDiagnostics), /<span[^>]*class="[^"]*diagError[^>]*>\{1\}%<\/span>/);
  block.translation = 'ความเสียหาย {1}';
  editor.refreshTranslationDiagnostics(block);
  assert.equal(block.diagnosticErrorCount, 0);
  assert.doesNotMatch(editor.buildTagHLter(block.translation, block.translationDiagnostics), /diagError/);
});

test('editorSave blocks a suffix mismatch and clears completed scan results after a valid save', async () => {
  const { editor, alerts, confirmations } = loadEditor();
  const desc = fixtureDescription('save', 'Damage {1}%', 'ความเสียหายเดิม {1}');
  editor.descs = [desc];
  await editor.scanAllDiagnostics();
  editor.editorCurrentEditingDesc = desc;
  editor.editorVisible = true;
  editor.editorOriginalTranslations = [desc.translations.Thai[0]];
  editor.editorBlocks = [{ english: desc.translations.English[0], translation: 'ความเสียหายใหม่ {1}' }];
  let persisted = 0;
  // Persistence is outside this test; exercise the real save validation and model updates.
  editor.saveLocalDescs = () => { persisted++; };
  editor.commitRevision = () => {};
  assert.equal(editor.editorSave(), false);
  assert.equal(desc.translations.Thai[0], 'ความเสียหายเดิม {1}');
  assert.equal(persisted, 0);
  assert.equal(editor.editorVisible, true);
  assert.match(alerts[0], /Translation errors found/);
  assert.match(alerts[0], /\{1\}%/);
  assert.deepEqual(confirmations, [], 'An error must not offer a save-anyway confirmation.');

  editor.editorBlocks[0].translation += '%';
  assert.equal(editor.editorSave(), true);
  assert.equal(desc.translations.Thai[0], 'ความเสียหายใหม่ {1}%');
  assert.equal(editor.localDescs.descs[0].translations.Thai[0], 'ความเสียหายใหม่ {1}%');
  assert.equal(persisted, 1);
  assert.equal(editor.editorVisible, false);
  assert.equal(editor.editorBlocks[0].diagnosticErrorCount, 0);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.equal(editor.diagnosticScanResults[desc.filepath], undefined);
  assert.equal(editor.diagnosticScanErrorFileCount, 0);
  assert.deepEqual(confirmations, []);
});

test('preview value identity still shares the same variable across percentage formatting', () => {
  const { editor } = loadEditor();
  const preview = editor.buildGamePreviewSegments('{1} and {1}%');
  assert.deepEqual(Array.from(preview.keysOrder), ['1']);
  const variables = Array.from(preview.segments).filter(segment => segment.type === 'var');
  assert.deepEqual(variables.map(segment => segment.key), ['1', '1']);
  assert.deepEqual(variables.map(segment => segment.trailingPercent), [false, true]);
  editor.mergePreviewGggVars(preview.keysOrder);
  assert.deepEqual(Object.keys(editor.previewGggVars), ['1']);
});
