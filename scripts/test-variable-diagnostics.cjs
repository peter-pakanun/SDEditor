const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEditor() {
  let config;
  const alerts = [];
  const confirmations = [];
  const window = { location: { search: '?testMode=1&lang=Thai' }, CloudUI: { mixin: {} }, OfflineStore: {},
    ClientTextState: require('../public/clientTextState.js'),
    setTimeout, clearTimeout, performance: require('node:perf_hooks').performance };
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
  for (const name of ['workspaceState.js', 'dictionaryScope.js', 'dictionaryMatching.js', 'dictionaryWorkerClient.js', 'dictionaryWorkerUi.js', 'helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'collaborationIntegration.js', 'editorComponents.js', 'clientTextUi.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'), context, { filename: name });
  }
  const editor = Object.assign({}, ...config.mixins.map(mixin => mixin.data?.() || {}), config.data(),
    ...config.mixins.map(mixin => mixin.methods || {}), config.methods, {
    lang: 'Thai', gameVersion: 'poe1', dictionary: [],
    appAlert: async message => { alerts.push(message); },
    appConfirm: async message => { confirmations.push(message); return false; },
    // List rendering is unrelated to the diagnostic scan and save guard.
    filterDesc() {},
    $nextTick(callback) { callback?.(); return Promise.resolve(); },
  });
  const computed = Object.assign({}, ...config.mixins.map(mixin => mixin.computed || {}), config.computed);
  for (const [name, getter] of Object.entries(computed)) {
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

test('numeric gemlevel metadata is allowed without allowing arbitrary nested or malformed tags', () => {
  const { context } = loadEditor();
  const analyze = text => context.window.TranslationDiagnostics.analyze(text);
  for (const text of [
    '[BattlemagesCry<gemlevel={0}>|Battlemage\'s Cry]',
    '[Skill_2<gemlevel={12}>|Translated skill]',
    '[BattlemagesCry<gemlevel={0}>]',
    '[BattlemagesCry<gemlevel=20>|Battlemage\'s Cry]',
    '[BattlemagesCry<gemlevel=0>]',
    '[BattlemagesCry<gemlevel={0}>|Level {1} skill]',
    '<white>{{[BattlemagesCry<gemlevel={0}>|Battlemage\'s Cry]}}',
  ]) {
    assert.equal(analyze(text).errorCount, 0, text);
  }
  for (const text of [
    '[<gemlevel={0}>|Battlemage\'s Cry]',
    '[BattlemagesCry<other={0}>|Battlemage\'s Cry]',
    '[BattlemagesCry<gemlevel={name}>|Battlemage\'s Cry]',
    '[BattlemagesCry<gemlevel={0:d}>|Battlemage\'s Cry]',
    '[BattlemagesCry<gemlevel={0}%>|Battlemage\'s Cry]',
    '[BattlemagesCry<gemlevel={0}suffix>|Battlemage\'s Cry]',
    '[BattlemagesCry<gemlevel={0}{1}>|Battlemage\'s Cry]',
    '[BattlemagesCry<gemlevel={{0}}>|Battlemage\'s Cry]',
    '[BattlemagesCry<gemlevel={0}|Battlemage\'s Cry]',
    '[BattlemagesCry<gemlevel={0}>suffix|Battlemage\'s Cry]',
    '[BattlemagesCry<gemlevel={0}>\n|Battlemage\'s Cry]',
    '[BattlemagesCry<gemlevel={0}>|[Cold]]',
  ]) {
    assert.ok(analyze(text).diagnostics.some(diagnostic => diagnostic.code === 'nested-tags'), text);
  }
  for (const text of [
    '[BattlemagesCry<gemlevel={0}>|Battlemage\'s Cry',
    '[BattlemagesCry<gemlevel={0}>|Battlemage\'s Cry]}',
  ]) {
    assert.ok(analyze(text).errorCount > 0, `Unbalanced delimiters must remain errors: ${text}`);
  }
});

test('gemlevel metadata remains part of exact keyword diagnostic identity', () => {
  const { editor } = loadEditor();
  const english = 'Grants Level {0} [BattlemagesCry<gemlevel={0}>|Battlemage\'s Cry] Skill';
  const translation = 'ได้รับสกิล [BattlemagesCry<gemlevel={0}>|คำรามนักรบเวท (Battlemage\'s Cry)] เลเวล {0}';
  assert.equal(editor.analyzeTranslationDiagnostics(translation, english).errorCount, 0);
  for (const sourceMetadata of ['{0}', '20']) {
    const source = `[BattlemagesCry<gemlevel=${sourceMetadata}>|Battlemage\'s Cry]`;
    for (const targetMetadata of ['{1}', '21']) {
      const target = `[BattlemagesCry<gemlevel=${targetMetadata}>|คำรามนักรบเวท]`;
      const diagnostics = editor.analyzeTranslationDiagnostics(target, source).diagnostics;
      assert.equal(diagnostics.some(diagnostic => diagnostic.code === 'variable-tag-identity-mismatch'), false);
      const mismatch = diagnostics.find(diagnostic => diagnostic.code === 'keyword-popup-tag-name-mismatch');
      assert.equal(mismatch?.level, 'error', `${source} -> ${target}`);
      assert.equal(target.slice(mismatch.start, mismatch.end), target);
    }
    const missingMetadata = editor.analyzeTranslationDiagnostics('[BattlemagesCry|คำรามนักรบเวท]', source);
    assert.ok(missingMetadata.diagnostics.some(diagnostic => diagnostic.code === 'keyword-popup-tag-name-mismatch'));
  }
});

test('gemlevel placeholders are excluded from variable counts while display and external variables remain checked', () => {
  const { editor, context } = loadEditor();
  for (const [text, vars, keywords] of [
    ['[BattlemagesCry<gemlevel={0}>|Battlemage\'s Cry]', 0, 1],
    ['{0} [BattlemagesCry<gemlevel={0}>|Battlemage\'s Cry]', 1, 1],
    ['[BattlemagesCry<gemlevel={12}>|Level {2} skill]', 1, 1],
    ['[BattlemagesCry<gemlevel={0}>]', 0, 1],
    ['[BattlemagesCry<gemlevel={0}>] and [OtherSkill<gemlevel={12}>|{3}]', 1, 2],
  ]) {
    assert.equal(context.countGGGVarTag(text), vars, text);
    assert.equal(editor.computeTextStats(text).vars, vars, text);
    assert.equal(editor.computeTextStats(text).kw, keywords, text);
    assert.equal(editor.extractGggVarIdentityTags(text).length, vars, text);
  }
  const keyword = '[BattlemagesCry<gemlevel={0}>|Battlemage\'s Cry]';
  for (const [english, translation] of [
    [`{0} ${keyword}`, keyword],
    [keyword, `${keyword} {0}`],
    ['[BattlemagesCry<gemlevel={0}>|Level {2} skill]', '[BattlemagesCry<gemlevel={0}>|Skill]'],
    ['[BattlemagesCry<gemlevel={0}>|Skill]', '[BattlemagesCry<gemlevel={0}>|Level {2} skill]'],
  ]) {
    assert.equal(variableErrors(editor, english, translation).length, 1, `${english} -> ${translation}`);
  }
});

test('reported Battlemage\'s Cry translation saves without a variable count confirmation', async () => {
  const { editor, alerts, confirmations } = loadEditor();
  const english = 'Grants Level {0} [BattlemagesCry<gemlevel={0}>|Battlemage\'s Cry] Skill';
  const translation = 'ได้รับสกิล [BattlemagesCry<gemlevel={0}>|คำรามนักรบเวท (Battlemage\'s Cry)] เลเวล {0}';
  const desc = fixtureDescription('battlemages-cry', english, '[BattlemagesCry<gemlevel={0}>|เดิม] {0}');
  editor.descs = [desc];
  editor.editorCurrentEditingDesc = desc;
  editor.editorVisible = true;
  editor.editorOriginalTranslations = [...desc.translations.Thai];
  editor.editorBlocks = [{ english, translation }];
  assert.equal(editor.computeTextStats(english).vars, 1);
  assert.equal(editor.computeTextStats(translation).vars, 1);
  assert.equal(await editor.editorSave(), true);
  assert.equal(desc.translations.Thai[0], translation);
  assert.equal(editor.localDescs.descs[0].translations.Thai[0], translation);
  assert.deepEqual(alerts, []);
  assert.deepEqual(confirmations, []);
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

test('autocomplete, preview and generated Regex preserve the complete numeric keyword ID', async () => {
  const { editor, context } = loadEditor();
  for (const index of [1, 12]) {
    const keyword = `[TentacleSmash::{${index}}|Tentacle Whip]`;
    const english = `Trigger ${keyword}`;
    const pack = await editor.prepareEditorDictionaryMatches([{ english }]);
    assert.equal(editor.adoptEditorDictionaryMatchPack(pack), true);
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

test('ClientText uses shared variables and keyword display without SD text decoding', () => {
  const {editor}=loadEditor(),raw='@CharacterName literal\\n actual\n{} {d} +{0:+d}% {2:0.1f} [Skill::{7}|Deal {0}% damage]';
  const preview=editor.buildGamePreviewSegments(raw,{contentMode:'clienttext'});
  assert.deepEqual(Array.from(preview.keysOrder),['','d','0:+d','2:0.1f','0']);
  assert.equal(preview.segments.filter(segment=>segment.type==='rightAlign').length,0);
  assert.equal(preview.segments.filter(segment=>segment.type==='break').length,1);
  assert.equal(preview.segments[0].text,'@CharacterName literal\\n actual');
  assert.equal(preview.segments.find(segment=>segment.key==='0:+d').prefix,'+');
  assert.equal(preview.segments.find(segment=>segment.key==='0:+d').trailingPercent,true);
  editor.ctActive=true;editor.ctPreviewGggVars={'0':'37'};
  const keyword=preview.segments.find(segment=>segment.type==='kw');
  assert.equal(editor.gamePreviewKeywordText(keyword),'Deal 37% damage');
  assert.equal(keyword.full,'[Skill::{7}|Deal {0}% damage]');
  assert.ok(!preview.keysOrder.includes('7'),'keyword identity metadata is not a display variable');
  assert.equal(raw,'@CharacterName literal\\n actual\n{} {d} +{0:+d}% {2:0.1f} [Skill::{7}|Deal {0}% damage]');
});

test('ClientText preview balances formatting wrappers and preserves unsupported syntax safely',()=>{
  const {editor}=loadEditor();
  const preview=editor.buildGamePreviewSegments('<unique>{{{0}}} <smaller>{Small {1}} <fg:rgb(255,0,0)>{<glow:rgb(227,125,1)>{Nested {2}}} <<xbox_button_a>> <unknown>{literal}',{contentMode:'clienttext'});
  assert.deepEqual(Array.from(preview.keysOrder),['0','1','2']);
  assert.equal(preview.segments.find(segment=>segment.key==='0').decorTag,'unique');
  assert.equal(preview.segments.find(segment=>segment.key==='1').decorTag,'smaller');
  assert.equal(preview.segments.find(segment=>segment.key==='2').decorTag,'glow');
  assert.ok(preview.segments.some(segment=>segment.text?.includes('<<xbox_button_a>> <unknown>{literal}')));
  const incomplete=editor.buildGamePreviewSegments('<smaller>{incomplete',{contentMode:'clienttext'});
  assert.equal(incomplete.segments[0].text,'<smaller>{incomplete');
});

test('both previews compose nested typography and colors on text and variables', () => {
  const { editor } = loadEditor();
  const style = { fontStyle: 'italic', fontWeight: 'bold', textDecorationLine: 'underline', color: 'rgb(12, 34, 56)' };
  for (const contentMode of ['statdescription', 'clienttext']) {
    const wrap = (tag, text) => contentMode === 'clienttext' ? `<${tag}>{${text}}` : `<${tag}>{{${text}}}`;
    const raw = wrap('i', wrap('bold', wrap('underline', wrap('rgb(12,34,56)', 'Styled {0}%')))) + ' plain';
    const preview = editor.buildGamePreviewSegments(raw, { contentMode });
    assert.deepEqual(Array.from(preview.keysOrder), ['0'], contentMode);
    for (const segment of preview.segments.filter(segment => segment.text === 'Styled ' || segment.type === 'var')) {
      assert.deepEqual({ ...segment.decorStyle }, style, contentMode);
      assert.equal(segment.decorTag, 'rgb');
    }
    const plain = preview.segments.find(segment => segment.text === ' plain');
    assert.ok(plain && !plain.decorStyle?.fontStyle && !plain.decorStyle?.color, 'styles end at their closing braces');
    assert.equal(preview.segments.find(segment => segment.type === 'var').trailingPercent, true);
  }
  for (const tag of ['i', 'italic']) {
    const preview = editor.buildGamePreviewSegments(`<${tag}>{{Word}}`);
    assert.equal(preview.segments[0].text, 'Word');
    assert.equal(preview.segments[0].decorStyle.fontStyle, 'italic');
  }
});

test('double wrappers preserve first-position variables and nested SD keyword identity', () => {
  const { editor } = loadEditor();
  for (const contentMode of ['statdescription', 'clienttext']) {
    const raw = '<enchanted>{{{0}% [Skill::{7}|<i>{{Strike {1}}}]}}';
    const preview = editor.buildGamePreviewSegments(raw, { contentMode });
    assert.deepEqual(Array.from(preview.keysOrder), ['0', '1']);
    const variable = preview.segments.find(segment => segment.type === 'var');
    assert.equal(variable.key, '0');
    assert.equal(variable.decorStyle.color, '#c8f7ff');
    const keyword = preview.segments.find(segment => segment.type === 'kw');
    assert.equal(keyword.full, '[Skill::{7}|<i>{{Strike {1}}}]');
    assert.ok(!preview.keysOrder.includes('7'), 'identity metadata is never a display variable');
    for (const part of keyword.parts) {
      assert.equal(part.decorStyle.fontStyle, 'italic');
      assert.equal(part.decorStyle.color, '#c8f7ff');
    }
    editor.ctActive = contentMode === 'clienttext';
    editor.previewGggVars = { '1': '23' }; editor.ctPreviewGggVars = { '1': '23' };
    assert.equal(editor.gamePreviewKeywordText(keyword), 'Strike 23');
  }
});

test('known palette styles compose with typography and inner color takes precedence', () => {
  const { editor } = loadEditor();
  const preview = editor.buildGamePreviewSegments('<fg:rgb(12,34,56)>{<italic>{<unique>{{Unique {0}}}}}', { contentMode: 'clienttext' });
  const variable = preview.segments.find(segment => segment.type === 'var');
  assert.equal(variable.decorStyle.color, '#af6025');
  assert.equal(variable.decorStyle.fontStyle, 'italic');
  assert.equal(variable.decorTag, 'unique');
});

test('ClientText distinguishes a single wrapper around a variable from double delimiters', () => {
  const { editor } = loadEditor();
  for (const raw of ['<i>{{0}}', '<italic>{{Text {0}}}', '<rgb(12,34,56)>{{{0}}}']) {
    const preview = editor.buildGamePreviewSegments(raw, { contentMode: 'clienttext' });
    assert.deepEqual(Array.from(preview.keysOrder), ['0'], raw);
    assert.equal(preview.segments.filter(segment => segment.type === 'var').length, 1, raw);
    assert.ok(preview.segments.filter(segment => segment.type === 'text').every(segment => !/[{}]/.test(segment.text)), raw);
  }
  const nested = editor.buildGamePreviewSegments('<i>{Outer <b>{Inner} outer}', { contentMode: 'clienttext' });
  assert.equal(nested.segments.find(segment => segment.text === 'Inner').decorStyle.fontWeight, 'bold');
  const restored = nested.segments.find(segment => segment.text === ' outer');
  assert.equal(restored.decorStyle.fontStyle, 'italic');
  assert.ok(!restored.decorStyle.fontWeight, 'closing the inner wrapper restores the outer typography');
});

test('SD table delimiters before variables stay separate while ClientText keeps the @ prefix', () => {
  const { editor } = loadEditor();
  for (const raw of ['A@{0}', '<i>{{Limit@{0}}}']) {
    const preview = editor.buildGamePreviewSegments(raw);
    assert.deepEqual(Array.from(preview.segments, segment => segment.type), ['text', 'rightAlign', 'var'], raw);
    const variable = preview.segments.at(-1);
    assert.equal(variable.full, '{0}', raw); assert.equal(variable.prefix, '', raw);
    if (raw.startsWith('<i>')) {
      assert.equal(preview.segments[0].decorStyle.fontStyle, 'italic');
      assert.equal(variable.decorStyle.fontStyle, 'italic');
    }
  }
  const client = editor.buildGamePreviewSegments('A@{0}', { contentMode: 'clienttext' });
  assert.deepEqual(Array.from(client.segments, segment => segment.type), ['text', 'var']);
  assert.equal(client.segments[1].full, '@{0}'); assert.equal(client.segments[1].prefix, '@');
});

test('ClientText single and double wrappers preserve variable ranges and their typography', () => {
  const { editor } = loadEditor();
  for (const [tag, separator, property, value] of [['i', ' to ', 'fontStyle', 'italic'], ['bold', '–', 'fontWeight', 'bold']]) {
    for (const raw of [`<${tag}>{{0}${separator}{1}}`, `<${tag}>{{{0}${separator}{1}}}`]) {
      const preview = editor.buildGamePreviewSegments(raw, { contentMode: 'clienttext' });
      assert.deepEqual(Array.from(preview.keysOrder), ['0', '1'], raw);
      assert.equal(preview.segments.map(segment => segment.type === 'var' ? `{${segment.key}}` : segment.text).join(''), `{0}${separator}{1}`, raw);
      assert.ok(preview.segments.every(segment => segment.decorStyle[property] === value), raw);
    }
  }
});

test('ClientText single wrappers retain literal braced words and subsequent variables', () => {
  const { editor } = loadEditor();
  const preview = editor.buildGamePreviewSegments('<i>{{Fire Rune} {0}}', { contentMode: 'clienttext' });
  assert.deepEqual(Array.from(preview.keysOrder), ['0']);
  assert.equal(preview.segments[0].text, '{Fire Rune} ');
  assert.ok(preview.segments.every(segment => segment.decorStyle.fontStyle === 'italic'));
});

test('SD multiline table wrappers retain styling, row order and displayed variable order', () => {
  const { editor } = loadEditor();
  const preview = editor.buildGamePreviewSegments('<i>{{left {0}\nnext {1}@right {2}\nlast}}');
  assert.deepEqual(Array.from(preview.keysOrder), ['0', '2', '1']);
  assert.deepEqual(Array.from(preview.segments, segment => segment.type === 'text' ? segment.text : segment.type === 'var' ? `{${segment.key}}` : segment.type),
    ['left ', '{0}', 'rightAlign', 'right ', '{2}', 'break', 'next ', '{1}', 'rightAlign', 'last']);
  assert.ok(preview.segments.filter(segment => ['text', 'var'].includes(segment.type)).every(segment => segment.decorStyle.fontStyle === 'italic'));
});

test('preview retains consecutive actual LF, CRLF and CR breaks inside styles and keyword labels', () => {
  const { editor } = loadEditor();
  for (const contentMode of ['statdescription', 'clienttext']) for (const newline of ['\n', '\r\n', '\r']) {
    const wrap = (tag, text) => contentMode === 'clienttext' ? `<${tag}>{${text}}` : `<${tag}>{{${text}}}`;
    const raw = wrap('i', wrap('bold', 'Start' + newline.repeat(2) + 'Double' + newline.repeat(3) + 'Triple'))
      + newline + '[Skill|KeyStart' + newline.repeat(2) + 'KeyEnd]';
    const preview = editor.buildGamePreviewSegments(raw, { contentMode });
    assert.deepEqual(Array.from(preview.segments, segment => segment.type === 'text' ? segment.text : segment.type),
      ['Start', 'break', 'break', 'Double', 'break', 'break', 'break', 'Triple', 'break', 'kw'], contentMode + ': ' + JSON.stringify(newline));
    assert.deepEqual(Array.from(preview.segments.at(-1).parts, part => part.type === 'text' ? part.text : part.type),
      ['KeyStart', 'break', 'break', 'KeyEnd']);
    const keywordNewline = contentMode === 'clienttext' ? newline : '\n';
    assert.equal(preview.segments.at(-1).full, '[Skill|KeyStart' + keywordNewline.repeat(2) + 'KeyEnd]', 'ClientText retains raw newline characters; SD normalizes display newlines');
    assert.ok(preview.segments.filter(segment => segment.type === 'text').every(segment => segment.decorStyle.fontStyle === 'italic' && segment.decorStyle.fontWeight === 'bold'));
  }
  const literal = editor.buildGamePreviewSegments('Literal\\ntext\n\nNext', { contentMode: 'clienttext' });
  assert.deepEqual(Array.from(literal.segments, segment => segment.type === 'text' ? segment.text : segment.type),
    ['Literal\\ntext', 'break', 'break', 'Next'], 'ClientText retains literal backslash-n');
});

test('SD preview keeps empty leading and intermediate rows when arranging table columns', () => {
  const { editor } = loadEditor();
  const preview = editor.buildGamePreviewSegments('\n\nLeft\n\nAfter@\n\nRight\n\nAfter');
  assert.deepEqual(Array.from(preview.segments, segment => segment.type === 'text' ? segment.text : segment.type),
    ['rightAlign', 'break', 'rightAlign', 'break', 'Left', 'rightAlign', 'Right', 'break', 'rightAlign', 'break', 'After', 'rightAlign', 'After']);
});

test('preview leaves unknown, malformed, control and unsafe color syntax visible', () => {
  const { editor } = loadEditor();
  for (const contentMode of ['statdescription', 'clienttext']) {
    for (const raw of ['<unknown>{literal}', '<i>{{incomplete}', '<continue>{dialogue}', '<<itemvisual:CurrencyArmourQuality>>',
      '<rgb(256,0,0)>{invalid}', '<fg:rgb(1,2,3);position:absolute>{unsafe}']) {
      const preview = editor.buildGamePreviewSegments(raw, { contentMode });
      assert.equal(preview.segments.map(segment => segment.text || '').join(''), raw, `${contentMode}: ${raw}`);
      assert.ok(preview.segments.every(segment => !segment.decorStyle?.color), 'untrusted headers cannot create CSS');
    }
  }
});

test('SD preview formatting never changes the raw translation saved or UTF-16 exported', async () => {
  const { editor, alerts, confirmations } = loadEditor();
  const codec = require('../public/statDescCodec.js');
  const wrap = text => `<i>{{<bold>{{<underline>{{<rgb(12,34,56)>{{${text} {0}%}}}}}}}}`;
  const english = wrap('English'), translation = wrap('ไทย');
  assert.equal(editor.analyzeTranslationDiagnostics(translation, english).errorCount, 0);
  const desc = codec.parseText('test/decorations.txt', `description test\n1 damage\n1\n# "${english}"\nlang "Thai"\n1\n# "Original {0}%"`, 'Thai', { strict: true });
  editor.descs = [desc]; editor.editorCurrentEditingDesc = desc; editor.editorVisible = true;
  editor.editorOriginalTranslations = [...desc.translations.Thai]; editor.editorBlocks = [{ english, translation }];
  editor.editorFocusedIndex = 0;
  editor.refreshGamePreview();
  assert.deepEqual({ ...editor.gamePreviewSegments[0].decorStyle }, {
    fontStyle: 'italic', fontWeight: 'bold', textDecorationLine: 'underline', color: 'rgb(12, 34, 56)',
  });
  assert.equal(editor.editorBlocks[0].translation, translation);
  assert.equal(await editor.editorSave(), true);
  const saved = editor.localDescs.descs[0];
  assert.equal(saved.translations.Thai[0], translation);
  const exported = codec.parseText(saved.filepath, codec.decodeUTF16(codec.descEncode(saved)), 'Thai', { strict: true });
  assert.equal(exported.translations.Thai[0], translation);
  assert.equal(exported.translations.English[0], english);
  assert.deepEqual(alerts, []); assert.deepEqual(confirmations, []);
});

test('SD diagnostics balance nested wrappers and color headers without allowing ordinary nested tags', () => {
  const { context } = loadEditor(), analyze = text => context.window.TranslationDiagnostics.analyze(text);
  for (const raw of ['<rgb(12,34,56)>{{Color {0}%}}', '<fg:rgb(12,34,56)>{{<i>{{Color {0}%}}}}',
    '<colour:rare>{{<bold>{{[Skill::{7}|Display {0}%]}}}}']) {
    assert.equal(analyze(raw).errorCount, 0, raw);
    assert.equal(analyze(raw).warningCount, 0, raw);
  }
  for (const raw of ['<i>{single}', '<i>{{missing', '<i>{{<bold>{{Missing outer}}', '<rgb(12,34,56)>{{Color {0}%}']) {
    assert.ok(analyze(raw).diagnostics.some(item => item.code === 'malformed-text-decoration-tag'), raw);
  }
  for (const raw of ['<i>{{{0 {1}}}}', '<i>{{[Fire [Cold]]}}', '<rgb(12,34,56)>{{[Skill{0}|Display]}}']) {
    assert.ok(analyze(raw).diagnostics.some(item => item.code === 'nested-tags'), raw);
  }
  for (const raw of ['<bad{>{{Text}}', '<bad[>{{Text}}', '<bad{0}>{{Text}}', '[Skill<bad{0}>{{Text}}]']) {
    assert.ok(analyze(raw).errorCount > 0, 'malformed header delimiters remain visible to the ordinary scanner: ' + raw);
  }
  assert.ok(analyze('<i>{{Valid}}}').diagnostics.some(item => item.code === 'extra-closing-tag'));
});

test('nested wrappers in keyword display text support variables and exact keyword identities', () => {
  const { editor } = loadEditor();
  const english = '[Skill::{7}|<i>{{<bold>{{Damage {0}%}}}}]';
  const translation = '[Skill::{7}|<i>{{<bold>{{ความเสียหาย {0}%}}}}]';
  assert.equal(editor.analyzeTranslationDiagnostics(translation, english).errorCount, 0);
  assert.equal(editor.extractGggVarIdentityTags(translation).length, 1);
  const changed = translation.replace('{0}%', '{1}%');
  const variable = editor.analyzeTranslationDiagnostics(changed, english).diagnostics
    .find(item => item.code === 'variable-tag-identity-mismatch');
  assert.ok(variable);
  assert.equal(changed.slice(variable.start, variable.end), '{1}%');
});

test('decoration nesting cannot hide invalid tags in variable bodies or keyword identities and labels', () => {
  const { context } = loadEditor();
  for (const raw of ['{<i>{{Text}}}', '[Skill<i>{{Text}}|Display]', '[Skill|<i>{{[Other]}}]',
    '[Skill|<i>{{<bold>{{[Other]}}}}]']) {
    assert.ok(context.window.TranslationDiagnostics.analyze(raw).diagnostics
      .some(item => item.code === 'nested-tags'), raw);
  }
});

test('decoration identity diagnostics compare every nested modifier and repeated occurrence', () => {
  const { editor } = loadEditor();
  const wrap = (tag, body) => `<${tag}>{{${body}}}`;
  const english = wrap('i', wrap('bold', wrap('underline', 'Damage {0}%')));
  const faithful = wrap('i', wrap('bold', wrap('underline', 'ความเสียหาย {0}%')));
  assert.equal(editor.analyzeTranslationDiagnostics(faithful, english).errorCount, 0);
  assert.equal(editor.computeTextStats(english).decor, 3);
  assert.equal(editor.computeTextStats(faithful).decor, 3);
  editor.editorCurrentEditingDesc = fixtureDescription('nested-counts', english, faithful);
  editor.editorBlocks = [{ english, translation: faithful }];
  assert.deepEqual(Array.from(editor.editorSaveConfirmations([faithful], [])), []);
  for (const [label, source, target] of [
    ['missing inner', english, wrap('i', wrap('underline', 'ความเสียหาย {0}%'))],
    ['changed inner', english, wrap('i', wrap('b', wrap('underline', 'ความเสียหาย {0}%')))],
    ['extra inner', english, wrap('i', wrap('bold', wrap('underline', wrap('white', 'ความเสียหาย {0}%'))))],
    ['missing repeated inner', wrap('i', `${wrap('bold', 'One')} ${wrap('bold', 'Two')}`), wrap('i', wrap('bold', 'หนึ่ง'))],
    ['extra repeated inner', wrap('i', wrap('bold', 'One')), wrap('i', `${wrap('bold', 'หนึ่ง')} ${wrap('bold', 'สอง')}`)],
  ]) {
    const errors = editor.analyzeTranslationDiagnostics(target, source).diagnostics
      .filter(item => item.code === 'text-decoration-tag-name-mismatch');
    assert.equal(errors.length, 1, label);
    assert.equal(errors[0].level, 'error', label);
    assert.match(errors[0].message, /<bold>/, label);
    if (label.includes('repeated')) assert.match(errors[0].message, /<bold> x2/, label);
    editor.editorCurrentEditingDesc = fixtureDescription('nested-counts', source, target);
    editor.editorBlocks = [{ english: source, translation: target }];
    const confirmations = editor.editorSaveConfirmations([target], []);
    assert.equal(confirmations.includes('Number of text decoration tags mismatched!'), label !== 'changed inner', label);
  }
});

test('nested RGB decoration identities retain complete headers and exact diagnostic offsets', () => {
  const { editor } = loadEditor();
  const wrap = (tag, body) => `<${tag}>{{${body}}}`;
  const inner = wrap('fg:rgb(12,34,56)', wrap('bold', 'Value {0}%'));
  const outer = wrap('i', `First\n${inner}`);
  const sibling = wrap('underline', 'More {1}');
  const raw = `Prefix ${outer} tail ${sibling}`, offset = 37;
  const tags = Array.from(editor.extractTextDecorationIdentityTags(raw, offset), tag => ({ ...tag }));
  assert.deepEqual(tags.map(tag => tag.key), ['i', 'fg:rgb(12,34,56)', 'bold', 'underline']);
  assert.equal(editor.computeTextStats(raw).decor, 4, 'parameterized RGB headers and their inner modifiers count in metadata');
  assert.deepEqual(tags.map(tag => tag.full), [outer, inner, wrap('bold', 'Value {0}%'), sibling]);
  for (const tag of tags) {
    assert.equal(raw.slice(tag.start - offset, tag.end - offset), tag.full);
    assert.equal(raw.slice(tag.start - offset, tag.openerEnd - offset), `<${tag.key}>`);
  }
  for (const header of ['rgb(12,34,56)', 'fg:rgb(12,34,56)', 'color:rgb(12,34,56)', 'colour:rare']) {
    const english = wrap('italic', wrap(header, 'Damage {0}%\nnext'));
    const faithful = wrap('italic', wrap(header, 'ความเสียหาย {0}%\nถัดไป'));
    assert.equal(editor.analyzeTranslationDiagnostics(faithful, english).errorCount, 0, header);
    assert.equal(editor.computeTextStats(faithful).decor, 2, header);
    editor.editorCurrentEditingDesc = fixtureDescription('rgb-counts', english, faithful);
    editor.editorBlocks = [{ english, translation: faithful }];
    assert.deepEqual(Array.from(editor.editorSaveConfirmations([faithful], [])), [], header);
    const changed = faithful.replace(`<${header}>`, '<fg:rgb(1,2,3)>');
    const mismatch = editor.analyzeTranslationDiagnostics(changed, english).diagnostics
      .find(item => item.code === 'text-decoration-tag-name-mismatch');
    assert.ok(mismatch, header);
    assert.equal(changed.slice(mismatch.start, mismatch.end), '<fg:rgb(1,2,3)>', header);
  }
});

test('table diagnostics compare nested modifiers within each column', () => {
  const { editor } = loadEditor();
  const wrap = (tag, body) => `<${tag}>{{${body}}}`;
  const english = `${wrap('i', wrap('bold', 'Left {0}%'))}@${wrap('i', 'Right {1}')}`;
  const faithful = `${wrap('i', wrap('bold', 'ซ้าย {0}%'))}@${wrap('i', 'ขวา {1}')}`;
  assert.equal(editor.analyzeDescDiagnostics(fixtureDescription('nested-table-valid', english, faithful)).errorCount, 0);
  const moved = `${wrap('i', 'ซ้าย {0}%')}@${wrap('i', wrap('bold', 'ขวา {1}'))}`;
  const errors = editor.analyzeDescDiagnostics(fixtureDescription('nested-table-moved', english, moved)).diagnostics
    .filter(item => item.code === 'text-decoration-tag-name-mismatch');
  assert.equal(errors.length, 2, 'moving an inner modifier across columns cannot cancel out its missing/extra counts');
  assert.deepEqual(Array.from(errors, item => item.columnIndex), [0, 1]);
});

test('editorSave blocks changing an inner modifier and saves faithful nested tags verbatim', async () => {
  const { editor, alerts, confirmations } = loadEditor();
  const wrap = (tag, body) => `<${tag}>{{${body}}}`;
  const english = wrap('i', wrap('bold', 'Damage {0}%'));
  const original = wrap('i', wrap('bold', 'เดิม {0}%'));
  const changed = wrap('i', wrap('underline', 'ใหม่ {0}%'));
  const faithful = wrap('i', wrap('bold', 'ใหม่ {0}%'));
  const desc = fixtureDescription('nested-modifier-save', english, original);
  editor.descs = [desc]; editor.editorCurrentEditingDesc = desc; editor.editorVisible = true;
  editor.editorOriginalTranslations = [...desc.translations.Thai];
  editor.editorBlocks = [{ english, translation: changed }];
  let persisted = 0;
  const persist = editor.persistTranslationBatch;
  editor.persistTranslationBatch = async (...args) => { persisted++; return persist.call(editor, ...args); };
  assert.equal(await editor.editorSave(), false);
  assert.equal(persisted, 0);
  assert.equal(desc.translations.Thai[0], original);
  assert.equal(editor.editorVisible, true);
  assert.match(alerts[0], /Text decoration tagName mismatch/);
  assert.deepEqual(confirmations, []);
  editor.editorBlocks[0].translation = faithful;
  assert.equal(await editor.editorSave(), true);
  assert.equal(persisted, 1);
  assert.equal(desc.translations.Thai[0], faithful);
  assert.equal(editor.localDescs.descs[0].translations.Thai[0], faithful);
  assert.deepEqual(confirmations, []);
});

test('excessive SD decoration nesting returns a diagnostic without overflowing the call stack', () => {
  const { editor, context } = loadEditor(), raw = '<i>{{'.repeat(4000) + 'Text' + '}}'.repeat(4000);
  let result;
  assert.doesNotThrow(() => { result = context.window.TranslationDiagnostics.analyze(raw); });
  const diagnostic = result.diagnostics.find(item => item.level === 'error' && item.code === 'nested-tags');
  assert.ok(diagnostic); assert.match(diagnostic.message, /nesting.*64/);
  assert.equal(raw.slice(diagnostic.start, diagnostic.end), '<i>', 'the excessive wrapper header has an exact diagnostic range');
  let compared;
  assert.doesNotThrow(() => { compared = editor.analyzeTranslationDiagnostics(raw, raw); });
  assert.ok(compared.diagnostics.some(item => item.code === 'nested-tags'));
  assert.equal(compared.diagnostics.some(item => item.code === 'text-decoration-tag-name-mismatch'), false,
    'depth-limited identity extraction stays consistent for identical source and translation');
});

test('many unclosed wrappers skip their malformed line and retain a valid next-line decoration', () => {
  const { editor } = loadEditor();
  const full = '<b>{{Valid {0}}}', raw = '<i>{{'.repeat(10000) + `Text\n${full}`, offset = 17;
  const tags = Array.from(editor.extractTextDecorationIdentityTags(raw, offset), tag => ({ ...tag }));
  assert.deepEqual(tags.map(tag => tag.key), ['b']);
  assert.equal(tags[0].full, full);
  assert.equal(tags[0].start, offset + raw.indexOf(full));
  assert.equal(tags[0].end, offset + raw.length);
  let result;
  assert.doesNotThrow(() => { result = editor.analyzeTranslationDiagnostics(raw, raw); });
  assert.ok(result.diagnostics.some(item => item.code === 'malformed-text-decoration-tag' && item.level === 'warning'));
  assert.equal(result.diagnostics.some(item => item.code === 'text-decoration-tag-name-mismatch'), false);
});

test('ClientText shares preview hosts and settings while isolating field values from SD state',()=>{
  const {editor,context}=loadEditor();
  const text={id:'text',kind:'text',source:'English {}@literal\\n\nnext'},form={id:'MS',kind:'form',source:'Form {0}'},gender={id:'gender',kind:'gender',source:''};
  editor.ctActive=true;editor.ctEditor=true;editor.ctSelection='ID';editor.versionChooserVisible=false;
  editor._ctUnitIndex=new Map([['ID',{fields:[text,form,gender]}]]);
  editor.ctFocusedField='text';editor.ctValues={text:'French {}@literal\\n\nnext',MS:'Masculin {0}',gender:'M'};
  editor.gamePreviewSegments=[{type:'text',text:'Retained SD preview'}];editor.previewGggVars={'0':'SD'};
  assert.equal(editor.gamePreviewMounted,true);assert.equal(editor.gamePreviewTarget,'#ctFullEditorPreviewHost');
  assert.equal(editor.editorToolsMounted,false,'SD assistance must not mount into ClientText');
  assert.deepEqual(Array.from(editor.ctPreviewKeys),['']);
  const update=context.window.ClientTextUI.mixin.watch.ctPreviewKeys.handler;
  update.call(editor,editor.ctPreviewKeys);editor.gamePreviewVarValues['']='23';
  assert.equal(editor.ctPreviewGggVars[''],'23');assert.equal(editor.previewGggVars['0'],'SD');
  assert.equal(editor.gamePreviewDisplayTarget.at(-1).text,'next');
  editor.ctEditor=false;editor.inlineEditor=true;assert.equal(editor.gamePreviewTarget,'#ctInlineEditorPreviewHost');
  editor.ctFocusedField='MS';assert.deepEqual(Array.from(editor.ctPreviewKeys),['0']);
  editor.ctFocusedField='gender';assert.equal(editor.ctPreviewField,text,'enum metadata is not a text preview');
  editor.versionChooserVisible=true;assert.equal(editor.gamePreviewMounted,false);
  editor.ctActive=false;assert.equal(editor.gamePreviewDisplayTarget[0].text,'Retained SD preview');
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.ok(html.includes('preview-host-id="ctFullEditorPreviewHost"'));
  assert.equal(context.window.ClientTextUI.toolsComponent, context.window.EditorComponents.Tools);
  assert.ok(context.window.EditorComponents.Tools.template.includes('id="inlineEditorPreviewHost"'));
  assert.ok(context.window.EditorComponents.Preview.template.includes('v-model="gamePreviewVarValues[k]"'));
  assert.ok(!html.includes('aria-label="Content group"'),'group selection belongs in the Versions Assignment table');
});
