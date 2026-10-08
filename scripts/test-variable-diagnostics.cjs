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
    document: { activeElement: null, body: {}, querySelector: () => null,
      createElement(tag) {
        assert.equal(tag, 'textarea');
        return { set innerHTML(value) { this.value = String(value).replace(/&(lt|gt|quot|#039|amp);/g,
          (_, entity) => ({ lt: '<', gt: '>', quot: '"', '#039': "'", amp: '&' })[entity]); } };
      },
    },
    alert() { assert.fail('Native alerts must not be used'); },
    confirm() { assert.fail('Native confirmations must not be used'); },
    Vue: {
      defineComponent(value) { config = value; return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; },
      nextTick(callback) { callback?.(); return Promise.resolve(); },
    },
  });
  for (const name of ['workspaceState.js', 'dictionaryScope.js', 'helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'collaborationIntegration.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'), context, { filename: name });
  }
  const integration = window.CollaborationIntegration.mixin;
  const editor = Object.assign(integration.data(), config.data(), integration.methods, config.methods, {
    lang: 'Thai', dictionary: [],
    appAlert: async message => { alerts.push(message); },
    appConfirm: async message => { confirmations.push(message); return false; },
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

test('numeric keyword ID suffixes are allowed without allowing arbitrary nesting', () => {
  const { context } = loadEditor();
  const analyze = text => context.window.TranslationDiagnostics.analyze(text);
  for (const text of [
    '[TentacleSmash::{0}|Tentacle Whip]',
    '[Skill_2::{12}|Translated skill]',
    '[TentacleSmash::{0}]',
    '[TentacleSmash::10|Tentacle Whip]',
    '[Damage|Damage {0}%]',
    '<white>{{[TentacleSmash::{0}|Tentacle Whip]}}',
  ]) {
    assert.equal(analyze(text).errorCount, 0, text);
  }
  for (const text of [
    '[TentacleSmash{0}|Tentacle Whip]',
    '[TentacleSmash:{0}|Tentacle Whip]',
    '[TentacleSmash:::{0}|Tentacle Whip]',
    '[::{0}|Tentacle Whip]',
    '[TentacleSmash::{name}|Tentacle Whip]',
    '[TentacleSmash::{0:d}|Tentacle Whip]',
    '[TentacleSmash::{0}%|Tentacle Whip]',
    '[TentacleSmash::{0}suffix|Tentacle Whip]',
    '[TentacleSmash::{0}{1}|Tentacle Whip]',
    '[TentacleSmash::{{0}}|Tentacle Whip]',
    '[TentacleSmash::{0|Tentacle Whip]',
    '[TentacleSmash::{0}\n|Tentacle Whip]',
    '[TentacleSmash::{0}|[Cold]]',
    '[Fire [Cold]]',
    '{0 {1}}',
  ]) {
    assert.ok(analyze(text).diagnostics.some(diagnostic => diagnostic.code === 'nested-tags'), text);
  }
  for (const text of [
    '[TentacleSmash::{0}|Tentacle Whip',
    '[TentacleSmash::{0}|Tentacle Whip]}',
  ]) {
    assert.ok(analyze(text).errorCount > 0, `Unbalanced delimiters must remain errors: ${text}`);
  }
});

test('numeric keyword ID suffixes retain keyword identity without creating variable requirements', () => {
  const { editor } = loadEditor();
  const english = '[TentacleSmash::{0}|Tentacle Whip]';
  assert.equal(editor.analyzeTranslationDiagnostics('[TentacleSmash::{0}|หนวดอสูร]', english).errorCount, 0);
  const changedId = editor.analyzeTranslationDiagnostics('[TentacleSmash::{1}|หนวดอสูร]', english);
  assert.equal(changedId.diagnostics.some(diagnostic => diagnostic.code === 'variable-tag-identity-mismatch'), false);
  assert.ok(changedId.diagnostics.some(diagnostic => diagnostic.code === 'keyword-popup-tag-name-mismatch'));
  const changedKeyword = editor.analyzeTranslationDiagnostics('[OtherSkill::{0}|หนวดอสูร]', english);
  assert.ok(changedKeyword.diagnostics.some(diagnostic => diagnostic.code === 'keyword-popup-tag-name-mismatch'));
});

test('keyword IDs are excluded from variable counts while ordinary and display variables remain counted', () => {
  const { editor, context } = loadEditor();
  for (const [text, vars, keywords] of [
    ['[TentacleSmash::{1}|Tentacle Whip]', 0, 1],
    ['{2}% chance to use [TentacleSmash::{1}|Tentacle Whip]', 1, 1],
    ['[TentacleSmash::{12}|Tentacle Whip {2}%]', 1, 1],
    ['[TentacleSmash::{12}]', 0, 1],
    ['[TentacleSmash::{1}] and [OtherSkill::{12}|{3}]', 1, 2],
  ]) {
    assert.equal(context.countGGGVarTag(text), vars, text);
    assert.equal(editor.computeTextStats(text).vars, vars, text);
    assert.equal(editor.computeTextStats(text).kw, keywords, text);
    assert.equal(editor.extractGggVarIdentityTags(text).length, vars, text);
  }
});

test('excluding keyword IDs preserves exact external and display variable offsets and formatting', () => {
  const { editor, context } = loadEditor();
  const text = 'Start [TentacleSmash::{12}|Whip {4}%] +{2:d}% and -{3:+d}';
  const expected = ['{4}%', '+{2:d}%', '-{3:+d}'].map(full => ({
    full, start: text.indexOf(full), end: text.indexOf(full) + full.length,
  }));
  assert.deepEqual(Array.from(context.extractGGGVarTags(text), tag => ({ ...tag })), expected);
  const offset = 37;
  assert.deepEqual(Array.from(editor.extractGggVarIdentityTags(text, offset), tag => ({ ...tag })),
    expected.map((tag, index) => ({
      ...tag, key: ['{4}%', '{2:d}%', '{3:+d}'][index], start: tag.start + offset, end: tag.end + offset,
    })));

  const english = 'EN [TentacleSmash::{12}|Whip] +{2:d}% and -{3:+d}';
  const translation = 'TH [TentacleSmash::{12}|Whip] +{2:d}% and -{3:+d}%';
  const errors = variableErrors(editor, english, translation);
  assert.equal(errors.length, 1);
  assert.equal(translation.slice(errors[0].start, errors[0].end), '-{3:+d}%');
  assert.match(errors[0].message, /\{3:\+d\}%/);
  assert.doesNotMatch(errors[0].message, /\{12\}/);

  const display = '[TentacleSmash::{12}|ความเสียหาย {2}]';
  const displayErrors = variableErrors(editor, '[TentacleSmash::{12}|Damage {2}%]', display);
  assert.equal(displayErrors.length, 1);
  assert.equal(display.slice(displayErrors[0].start, displayErrors[0].end), '{2}');
});

test('keyword ID braces cannot substitute for missing ordinary variables or hide extra variables', () => {
  const { editor } = loadEditor();
  const keyword = '[TentacleSmash::{1}|Tentacle Whip]';
  for (const [english, translation] of [
    [`{1} ${keyword}`, keyword],
    [keyword, `${keyword} {1}`],
    ['[TentacleSmash::{1}|Damage {2}]', '[TentacleSmash::{1}|Damage]'],
    ['[TentacleSmash::{1}|Damage]', '[TentacleSmash::{1}|Damage {2}]'],
  ]) {
    const errors = variableErrors(editor, english, translation);
    assert.equal(errors.length, 1, `${english} -> ${translation}`);
    assert.equal(errors[0].level, 'error');
  }
});

test('autocomplete, preview and generated Regex preserve the complete numeric keyword ID', () => {
  const { editor, context } = loadEditor();
  for (const index of [1, 12]) {
    const keyword = `[TentacleSmash::{${index}}|Tentacle Whip]`;
    const english = `Trigger ${keyword}`;
    const { HLs } = editor.buildEnglishHLter(english);
    assert.equal(HLs.length, 1);
    assert.equal(HLs[0].isKeywordPopup, true);
    assert.equal(HLs[0].tagName, `TentacleSmash::{${index}}`);
    assert.equal(HLs[0].find, keyword);
    editor.editorBlocks = [{ english, translation: '', HLs }];
    const items = editor.buildHlPopupItems(0);
    assert.equal(items.length, 1);
    assert.equal(items[0].value, keyword);
    assert.equal(items[0].kwTagName, `TentacleSmash::{${index}}`);
    assert.equal(items.some(item => item.value === `{${index}}`), false);
    assert.deepEqual(Array.from(editor.buildGamePreviewSegments(english).keysOrder), []);
    assert.deepEqual(Array.from(editor.buildGamePreviewSegments(`[TentacleSmash::{${index}}]`).keysOrder), []);
    assert.deepEqual(Array.from(editor.buildGamePreviewSegments(`{2}% ${keyword}`).keysOrder), ['2']);
    const generated = context.regexEngineCreate(english, []);
    assert.equal(generated.find, 'Trigger (.+)');
    assert.equal(generated.replace, 'Trigger $1');
    const lookedUp = context.regexEngineLookup(english, [generated]);
    assert.equal(lookedUp.failed, false);
    assert.equal(lookedUp.replace, `Trigger [TentacleSmash::{${index}}|🔖]`);
    assert.deepEqual(Array.from(lookedUp.words), ['Tentacle Whip']);
  }
});

test('editorSave accepts numeric keyword IDs without a variable count confirmation', async () => {
  for (const index of [1, 12]) {
    const { editor, alerts, confirmations } = loadEditor();
    const english = `Trigger [TentacleSmash::{${index}}|Tentacle Whip]`;
    const translation = `ทริกเกอร์ [TentacleSmash::{${index}}|หนวดอสูร]`;
    const desc = fixtureDescription(`keyword-${index}`, english, `[TentacleSmash::{${index}}|เดิม]`);
    editor.descs = [desc];
    editor.editorCurrentEditingDesc = desc;
    editor.editorVisible = true;
    editor.editorOriginalTranslations = [...desc.translations.Thai];
    editor.editorBlocks = [{ english, translation }];
    assert.equal(editor.computeTextStats(english).vars, 0);
    assert.equal(editor.computeTextStats(translation).vars, 0);
    assert.equal(await editor.editorSave(), true);
    assert.equal(desc.translations.Thai[0], translation);
    assert.equal(editor.localDescs.descs[0].translations.Thai[0], translation);
    assert.deepEqual(alerts, []);
    assert.deepEqual(confirmations, []);
  }
});

test('reported two-entry Tentacle Whip translation saves and retains unrelated scan errors', async () => {
  const { editor, alerts, confirmations } = loadEditor();
  const english = [
    '{0}% chance to Trigger Level 20 [TentacleSmash::{0}|Tentacle Whip] on Kill',
    'Trigger Level 20 [TentacleSmash::{0}|Tentacle Whip] on Kill',
  ];
  const translation = [
    'มีโอกาสทริกเกอร์ [TentacleSmash::{0}|หนวดอสูรร่ายฟาด (Tentacle Whip)] เลเวล 20 {0}% เมื่อสังหาร',
    'ทริกเกอร์ [TentacleSmash::{0}|หนวดอสูรร่ายฟาด (Tentacle Whip)] เลเวล 20 เมื่อสังหาร',
  ];
  assert.deepEqual(english.map(text => editor.computeTextStats(text).vars), [1, 0]);
  assert.deepEqual(translation.map(text => editor.computeTextStats(text).vars), [1, 0]);
  const desc = fixtureDescription('tentacle-whip', english[0], '[TentacleSmash::{0}|เดิม] {0}%');
  desc.translations.English = english;
  desc.translations.Thai.push('[TentacleSmash::{0}|เดิม]');
  const unrelated = fixtureDescription('nested', '[Fire]', '[Fire [Cold]]');
  editor.descs = [desc, unrelated];
  await editor.scanAllDiagnostics();
  const unrelatedResult = editor.diagnosticScanResults[unrelated.filepath];
  editor.editorCurrentEditingDesc = desc;
  editor.editorVisible = true;
  editor.editorOriginalTranslations = [...desc.translations.Thai];
  editor.editorBlocks = english.map((source, index) => ({ english: source, translation: translation[index] }));
  let persisted = 0;
  const persist = editor.persistTranslationBatch;
  editor.persistTranslationBatch = async (...args) => { persisted++; return persist.call(editor, ...args); };

  assert.equal(await editor.editorSave(), true);
  assert.deepEqual(Array.from(desc.translations.Thai), translation);
  assert.deepEqual(Array.from(editor.localDescs.descs.find(row => row.filepath === desc.filepath).translations.Thai), translation);
  assert.equal(persisted, 1);
  assert.equal(editor.editorVisible, false);
  assert.deepEqual(alerts, []);
  assert.deepEqual(confirmations, []);
  assert.equal(editor.diagnosticScanResults[desc.filepath].errorCount, 0);
  assert.equal(editor.diagnosticScanResults[unrelated.filepath], unrelatedResult);
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanErrorFileCount, 1);
});

test('editorSave still blocks genuine nested tags after a numeric keyword ID suffix', async () => {
  const { editor, alerts } = loadEditor();
  const english = '[TentacleSmash::{0}|Tentacle Whip]';
  const original = '[TentacleSmash::{0}|หนวดอสูร]';
  const desc = fixtureDescription('nested-save', english, original);
  editor.descs = [desc];
  editor.editorCurrentEditingDesc = desc;
  editor.editorVisible = true;
  editor.editorOriginalTranslations = [original];
  editor.editorBlocks = [{ english, translation: '[TentacleSmash::{0}|[Cold]]' }];
  editor.persistTranslationBatch = async () => assert.fail('Invalid nesting must not be persisted.');
  assert.equal(await editor.editorSave(), false);
  assert.equal(desc.translations.Thai[0], original);
  assert.equal(editor.editorVisible, true);
  assert.match(alerts[0], /Nested tag/);
});

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

test('editorSave blocks a suffix mismatch and refreshes the retained scan after a valid save', async () => {
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
  const persist = editor.persistTranslationBatch;
  editor.persistTranslationBatch = async (...args) => { persisted++; return persist.call(editor, ...args); };
  assert.equal(await editor.editorSave(), false);
  assert.equal(desc.translations.Thai[0], 'ความเสียหายเดิม {1}');
  assert.equal(persisted, 0);
  assert.equal(editor.editorVisible, true);
  assert.match(alerts[0], /Translation errors found/);
  assert.match(alerts[0], /\{1\}%/);
  assert.deepEqual(confirmations, [], 'An error must not offer a save-anyway confirmation.');

  editor.editorBlocks[0].translation += '%';
  assert.equal(await editor.editorSave(), true);
  assert.equal(desc.translations.Thai[0], 'ความเสียหายใหม่ {1}%');
  assert.equal(editor.localDescs.descs[0].translations.Thai[0], 'ความเสียหายใหม่ {1}%');
  assert.equal(persisted, 1);
  assert.equal(editor.editorVisible, false);
  assert.equal(editor.editorBlocks[0].diagnosticErrorCount, 0);
  assert.equal(editor.diagnosticScanCompleted, true);
  const result = editor.diagnosticScanResults[desc.filepath];
  assert.equal(result.errorCount, 0);
  assert.equal(result.warningCount, 0);
  assert.deepEqual(Array.from(result.diagnostics), []);
  assert.equal(result.hasDiagnosticError, false);
  assert.equal(result.hasDiagnosticWarning, false);
  assert.equal(editor.diagnosticScanErrorFileCount, 0);
  assert.equal(editor.diagnosticScanWarningFileCount, 0);
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
