const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const TM = require('../public/translationMemory.js');
const ClientTextState = require('../public/clientTextState.js');
const ContentAdapters = require('../public/contentAdapters.js');
const { unit: clientTextUnit } = require('./clienttext-storage-fixture.cjs');

const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function description(source = ['Damage'], target = source.map(() => ''), filepath = 'stats/current.txt') {
  return { filepath, stats: ['damage'], variables: source.map(() => '#'), remarks: source.map(() => ''), translations: { English: source, Thai: target } };
}
function row(id, source = 'Damage', target = 'ความเสียหาย', context = null, extra = {}) {
  return { id, source, target, gameScope: 'poe1', context, revision: 2, localRevision: 3, ...extra };
}
function editorBlock(source, target) {
  const english = source.replace(/\\n/g, '\n'), translation = target.replace(/\\n/g, '\n');
  const isTable = english.includes('@') || translation.includes('@');
  return { english, translation, isTable, isMultiline: english.includes('\n') || translation.includes('\n'),
    tableColumns: isTable ? translation.split('@').map(value => ({ translation: value })) : [], words: [], translationReplace: '' };
}

function harness({ desc = description(), units = [], testMode = true, store = {}, query } = {}) {
  const calls = { queries: [], saved: 0, drafts: 0, focus: 0, confirms: 0, publications: [], exported: [] };
  let app, currentSnapshot = { generation: 1, game: 'poe1', units };
  const worker = {
    setScope(key) { this.scope = key; },
    submitSnapshot(snapshot) { currentSnapshot = snapshot; calls.publications.push(snapshot.generation); },
    waitReady() { return Promise.resolve({ generation: currentSnapshot.generation }); },
    query(input, options) {
      calls.queries.push(copy(input));
      let promise = query ? query(input, options, app) : Promise.resolve({ generation: currentSnapshot.generation,
        matches: TM.searchSync(TM.createIndex(currentSnapshot.units, { game: currentSnapshot.game }), input, options) });
      promise.cancel ||= () => {};
      return promise;
    },
    dispose() {},
  };
  const window = {
    TranslationMemory: TM, TranslationMemoryWorkerClient: { create: () => worker }, OfflineStore: store,
    ClientTextState, ContentAdapters,
    WorkspaceState: { workspaceFile(workspace, baseline) { return workspace.states?.[baseline.filepath]
      || { staged: false, candidate: null, translations: baseline.translations.Thai || [] }; } },
  };
  const sandbox = vm.createContext({ window, Vue: { markRaw: value => value }, crypto: webcrypto, setTimeout, clearTimeout,
    Blob, URLSearchParams, console, saveAs(blob, filename) { calls.exported.push({ blob, filename }); } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'tmUi.js'), 'utf8'), sandbox, { filename: 'tmUi.js' });
  const mixin = window.TranslationMemoryUI.mixin;
  app = { ...mixin.data(),
    testMode, lang: 'Thai', gameVersion: 'poe1', cloudProfileId: 'guest', cloudSignedIn: false, cloudCanAccessAllLanguages: false,
    cloudUser: null, sourceIdentity: 'source-1', branchId: 'default', editorSessionActive: true, editorReady: true,
    editorFocusedIndex: 0, editorFocusedColumnIndex: 0, editorTranslationReadOnly: false, editorCompareActive: false,
    editorCurrentEditingDesc: desc, editorBlocks: desc.translations.English.map((source, index) => editorBlock(source, desc.translations.Thai[index] || '')),
    descs: [desc], localDescs: {}, editorRegexes: [], sideTab: 'tm', _tmLoadEpoch: 0, _tmQueryEpoch: 0,
    tmUnits: units, tmGeneration: 1, _tmWorker: worker,
    ctActive: false, ctUnits: [], ctSaved: {}, ctRevision: 0, ctBusy: false, ctOfflineTest: false, ctResourceSyncEnabled: false,
    ctContext() { return { key: 'catalog', epoch: this._ctEpoch || 0, scope: copy(this.ctWorkspace?.scope || {}) }; },
    makeEditorBlock: editorBlock,
    serializeEditorTranslations() {
      return this.editorBlocks.map(block => (block.isTable ? block.tableColumns.map(column => column.translation).join('@') : block.translation).replace(/\r\n?/g, '\n').replace(/\n/g, '\\n'));
    },
    refreshEditorBlockMeta() {}, refreshGamePreview() {}, scheduleEditorDraft() { calls.drafts++; },
    getEditorRef() { return { focus() { calls.focus++; } }; }, $nextTick: () => Promise.resolve(),
    setEditorFocus(index) { this.editorFocusedIndex = index; },
    appConfirm: async () => { calls.confirms++; return true; }, editorSave() { calls.saved++; },
    waitForPendingSaves: async () => true, workspaceSourceFile(filepath) { return this.descs.find(file => file.filepath === filepath); },
  };
  for (const [name, method] of Object.entries(mixin.methods)) app[name] = method.bind(app);
  for (const [name, getter] of Object.entries(mixin.computed)) Object.defineProperty(app, name, { configurable: true, get: () => getter.call(app) });
  const selectedMatch = index => {
    app.editorFocusedIndex = index || 0;
    const match = TM.searchSync(TM.createIndex(app.tmUnits, { game: app.gameVersion }), app.tmQuery())[0];
    app.tmMatches = [match]; app.tmLastMatchKey = app.tmEditorKey; return match;
  };
  return { app, calls, worker, mixin, selectedMatch, window };
}

test('TM insertion changes a whole table/multiline draft, preserves raw English and never commits workspace text', async () => {
  const source = 'Head\\nFoot@{0}', target = 'หัว\\nเท้า@{0}', desc = description([source]);
  const { app, calls, selectedMatch } = harness({ desc, units: [row('whole', source, target)] });
  const original = copy(desc.translations);
  assert.equal(app.tmQuery().source, source);
  await app.useTMMatch(selectedMatch());
  assert.equal(app.editorBlocks[0].tableColumns.length, 2);
  assert.equal(app.editorBlocks[0].tableColumns[0].translation, 'หัว\nเท้า');
  assert.deepEqual(app.serializeEditorTranslations(), [target]);
  assert.deepEqual(desc.translations, original); assert.equal(calls.saved, 0); assert.equal(calls.drafts, 1); assert.equal(calls.focus, 1);
});

test('manual insertion can produce an editable draft with validation findings', async () => {
  const { app, calls, selectedMatch } = harness({ desc: description(['Damage {0}']), units: [row('mismatch', 'Damage {0}', 'ความเสียหาย {1}')] });
  const match = selectedMatch(); assert.ok(match.warnings.some(warning => warning.code === 'variables'));
  await app.useTMMatch(match); assert.equal(app.editorBlocks[0].translation, 'ความเสียหาย {1}'); assert.equal(calls.saved, 0);
});

test('nextTick insertion focus cannot move into a replacement editor session', async () => {
  const { app, calls, selectedMatch } = harness({ units: [row('focus')] }), tick = deferred();
  app.$nextTick = () => tick.promise;
  const pending = app.useTMMatch(selectedMatch()); await settle();
  assert.equal(app.editorBlocks[0].translation, 'ความเสียหาย');
  app.editorCurrentEditingDesc = description(['Life']); app.editorBlocks = [editorBlock('Life', '')];
  tick.resolve(); await pending;
  assert.equal(calls.focus, 0); assert.equal(app.editorBlocks[0].translation, '');
});

test('insertion rejects a stale unit revision or local revision', async () => {
  for (const field of ['revision', 'localRevision']) {
    const { app, selectedMatch } = harness({ units: [row('a')] }), match = selectedMatch();
    app.tmUnits = [{ ...app.tmUnits[0], [field]: app.tmUnits[0][field] + 1 }];
    await app.useTMMatch(match); assert.equal(app.editorBlocks[0].translation, '', field);
  }
});

test('source/language/account changes while confirming replacement prevent insertion', async () => {
  for (const change of [app => { app.sourceIdentity = 'source-2'; }, app => { app.lang = 'German'; }, app => { app.cloudProfileId = 'different'; }]) {
    const { app, selectedMatch } = harness({ desc: description(['Damage'], ['old draft']), units: [row('a')] });
    const confirmation = deferred(); app.appConfirm = () => confirmation.promise;
    const pending = app.useTMMatch(selectedMatch()); await settle(); change(app); confirmation.resolve(true); await pending;
    assert.equal(app.editorBlocks[0].translation, 'old draft');
  }
});

test('new typing or a newer TM correction while confirming replacement is preserved', async () => {
  for (const change of [app => { app.editorBlocks[0].translation = 'newer typing'; },
    app => { app.tmUnits = [{ ...app.tmUnits[0], target: 'newer TM correction', localRevision: 4 }]; }]) {
    const { app, selectedMatch } = harness({ desc: description(['Damage'], ['old draft']), units: [row('a')] });
    const confirmation = deferred(); app.appConfirm = () => confirmation.promise;
    const pending = app.useTMMatch(selectedMatch()); await settle(); change(app); confirmation.resolve(true); await pending;
    assert.notEqual(app.editorBlocks[0].translation, 'ความเสียหาย');
  }
});

test('late query replies from another account/language/source never replace current suggestions', async () => {
  for (const change of [app => { app.sourceIdentity = 'source-2'; }, app => { app.lang = 'German'; }, app => { app.cloudProfileId = 'different'; }]) {
    const request = deferred(), { app } = harness({ units: [row('a')], query: () => request.promise });
    app.tmMatches = [{ id: 'current' }];
    const pending = app.queryTranslationMemory(); await settle(); change(app);
    request.resolve({ matches: [{ id: 'late' }] }); await pending; assert.equal(app.tmMatches[0].id, 'current');
  }
});

test('prefill selects a unique 101 context match over conflicting 100 matches', async () => {
  const desc = description(), current = TM.contextFor(desc, 0), other = { ...current, filepath: 'stats/other.txt' };
  const { app } = harness({ desc, units: [row('context', 'Damage', 'current translation', current), row('other', 'Damage', 'other translation', other)] });
  await app.previewTMPrefill(); assert.equal(app.tmPrefillRows.length, 1); assert.equal(app.tmPrefillRows[0].match.score, 101);
  await app.applyTMPrefill(); assert.equal(app.editorBlocks[0].translation, 'current translation');
});

test('prefill rejects ambiguous source-only matches even beyond the returned variant limit', async () => {
  const units = Array.from({ length: 101 }, (_, index) => row('row-' + String(index).padStart(3, '0'), 'Damage', index === 100 ? 'different' : 'same',
    { filepath: 'stats/other-' + index, stats: ['damage'], condition: '#', remarks: '', entryIndex: 0 }));
  const { app } = harness({ units }); await app.previewTMPrefill(); assert.equal(app.tmPrefillRows.length, 0);
});

test('prefill preserves typing after review and stops if context changes between rows', async () => {
  const desc = description(['Damage', 'Life']), units = desc.translations.English.map((source, index) => row('row-' + index, source, 'translation-' + index, TM.contextFor(desc, index)));
  const { app } = harness({ desc, units }); await app.previewTMPrefill();
  app.editorBlocks[0].translation = 'typed after preview'; await app.applyTMPrefill();
  assert.equal(app.editorBlocks[0].translation, 'typed after preview'); assert.equal(app.editorBlocks[1].translation, 'translation-1');
  app.editorBlocks = desc.translations.English.map(source => editorBlock(source, '')); await app.previewTMPrefill();
  const original = app.tmApplyTarget; let applied = 0;
  app.tmApplyTarget = async (...args) => {
    await original(...args);
    if (++applied === 1) {
      app.lang = 'German'; app.editorCurrentEditingDesc = description(['Other', 'New file'], ['', ''], 'stats/new.txt');
      app.editorBlocks = app.editorCurrentEditingDesc.translations.English.map(source => editorBlock(source, ''));
    }
  };
  await app.applyTMPrefill(); assert.equal(app.editorBlocks[1].translation, ''); assert.equal(applied, 1);
});

test('workspace seed is a reviewed selection; ZIP translations are opt-in and Dropped entries are excluded', async () => {
  const saved = description(['Damage', 'Life', 'Cold'], ['new correction', 'revived', 'addition']);
  const original = description(['Original'], ['ZIP translation'], 'stats/original.txt');
  const dropped = description(['Dropped'], ['recovered'], 'stats/dropped.txt');
  const existing = row('existing', 'Damage', 'old correction', TM.contextFor(saved, 0));
  const deleted = row('deleted', 'Life', 'deleted target', TM.contextFor(saved, 1), { deleted: true });
  const { app } = harness({ desc: saved, units: [existing] });
  app.editorReady = false; app.descs = [saved, original, dropped]; app.tmTombstones = [deleted];
  app.localDescs.states = { [saved.filepath]: { staged: true, candidate: null, translations: saved.translations.Thai },
    [original.filepath]: { staged: false, candidate: null, translations: original.translations.Thai },
    [dropped.filepath]: { staged: true, candidate: { id: 'dropped' }, translations: dropped.translations.Thai } };
  await app.previewTMSeed();
  assert.equal(app.tmSeedRows.length, 3); assert.deepEqual(copy(app.tmSeedRows.map(item => item.selected)), [false, false, true]);
  assert.equal(app.tmSeedRows[1].restore, true); assert.ok(app.tmSeedRows.every(item => item.unit.source !== 'Dropped'));
  app.tmSeedIncludeZip = true; await app.previewTMSeed(); assert.equal(app.tmSeedRows.length, 4);
  assert.ok(app.tmSeedRows.some(item => item.unit.source === 'Original')); assert.equal(saved.translations.Thai[0], 'new correction');
});

function workbookUnit(recordId, source = 'Sword', target = 'ดาบ', fieldChanges = {}) {
  const unit = clientTextUnit(source, target);
  unit.recordId = recordId; unit.id = JSON.stringify([unit.role, unit.sheet, recordId]);
  Object.assign(unit.fields[0], fieldChanges);
  return unit;
}
function workbookHarness(units, options = {}) {
  const result = harness(options), app = result.app;
  Object.assign(app, { descs: [], ctActive: true, ctOfflineTest: true, ctResourceSyncEnabled: true,
    ctUnits: units, ctSaved: {}, ctRevision: 1, gameVersion: 'poe2', editorReady: false,
    ctWorkspace: { scope: { accountId: 'guest', game: 'poe2', branchId: 'default', versionId: 'private-1',
      groupId: 'local:test:workbook-1', language: 'Thai' }, metadata: { syncResources: true } } });
  return result;
}

test('workbook seeding is available without SD files and original workbook translations require opt-in', async () => {
  const original = workbookUnit('original', 'Literal @ \\n {0}', 'ข้อความ @ \\n {0}');
  const { app } = workbookHarness([original]);
  assert.equal(app.tmCanBuildSeed, true); assert.equal(app.tmSeedIncludeZip, false);
  await app.previewTMSeed(); assert.equal(app.tmSeedVisible, true); assert.equal(app.tmSeedRows.length, 0);
  app.tmSeedIncludeZip = true; await app.previewTMSeed();
  assert.equal(app.tmSeedRows.length, 1);
  const candidate = app.tmSeedRows[0].unit;
  assert.equal(candidate.source, original.fields[0].source); assert.equal(candidate.target, original.fields[0].target);
  assert.equal(candidate.context.contentMode, 'clienttext'); assert.equal(candidate.context.recordId, 'original');
  assert.equal(candidate.context.fieldId, original.fields[0].id); assert.equal(candidate.gameScope, 'poe2');
  assert.equal(JSON.stringify(candidate).includes('local:test:'), false, 'private workbook identities never become TM provenance');
  await app.applyTMSeed(); assert.equal(app.tmUnits.length, 1);
  assert.deepEqual(app.ctSaved, {}); assert.equal(original.fields[0].target, 'ข้อความ @ \\n {0}');
});

test('workbook seeding reads committed saves while drafts and unsaved originals stay outside the default preview', async () => {
  const saved = workbookUnit('saved', 'Sword', 'Original sword'), untouched = workbookUnit('untouched', 'Shield', 'Original shield');
  const { app } = workbookHarness([saved, untouched]);
  const fieldId = saved.fields[0].id;
  app.ctSaved = { [saved.id]: { saved: true, values: { [fieldId]: 'Committed sword' }, reviewed: {}, jobId: 'confirmed-save' } };
  app.ctValues = { [fieldId]: 'Unsaved draft sword' }; app.ctSelection = saved.id; app.ctDraftDirty = true;
  const before = copy(app.ctSaved);
  await app.previewTMSeed();
  assert.equal(app.tmSeedRows.length, 1); assert.equal(app.tmSeedRows[0].unit.target, 'Committed sword');
  assert.equal(app.tmSeedRows[0].unit.provenance.origin, 'saved_seed');
  assert.equal(app.tmSeedRows[0].selected, true); assert.deepEqual(app.ctSaved, before);
  await app.applyTMSeed();
  assert.equal(app.ctValues[fieldId], 'Unsaved draft sword'); assert.equal(app.ctDraftDirty, true);
  assert.deepEqual(app.ctSaved, before); assert.equal(app.tmUnits[0].target, 'Committed sword');
});

test('workbook seed skips invalid, gender, outdated, unresolved and Use English fields', async () => {
  const eligible = workbookUnit('good', 'Sword', 'ดาบ');
  const fixtures = [eligible,
    workbookUnit('blank-target', 'Blank target', ''), workbookUnit('blank-source', '', 'Target'),
    workbookUnit('gender', 'M', 'F', { kind: 'gender' }),
    workbookUnit('audio', '[NOAUDIO]', 'Marker translation'),
    workbookUnit('invalid', 'Value {0}', 'Value {1}'),
    workbookUnit('nonexistent', 'Ordinary text', 'NONEXISTENT'),
    workbookUnit('dnt', 'lowercase dnt text', 'Excluded instruction'),
    workbookUnit('outdated-original', 'Changed source', 'Old target', { outdated: true }),
    workbookUnit('outdated-save', 'Changed saved source', 'Old saved target', { outdated: true }),
    workbookUnit('conflict', 'Conflicting source', 'Target'),
    workbookUnit('english', 'English decision source', '')];
  const { app } = workbookHarness(fixtures); app.tmSeedIncludeZip = true;
  const fieldId = fixtures[0].fields[0].id;
  for (const unit of fixtures.slice(-3)) app.ctSaved[unit.id] = { saved: true, values: ClientTextState.valuesFor(unit), reviewed: {} };
  app.ctSaved[fixtures.at(-2).id].conflicts = [{ fieldId, reason: 'unresolved' }];
  const english = fixtures.at(-1);
  app.ctSaved[english.id].englishIntent = { [fieldId]: { state: 'active', sourceHash: ClientTextState.sourceHash(english.fields[0].source), decisionId: 'local-decision' } };
  await app.previewTMSeed();
  assert.deepEqual(copy(app.tmSeedRows.map(row => row.unit.context.recordId)), ['good']);
  assert.equal(JSON.stringify(app.tmSeedRows).includes('local-decision'), false);
});

test('workbook additions are selected while corrections and suppressed entries need explicit review', async () => {
  const correction = workbookUnit('correction', 'Sword', 'Corrected sword'), restore = workbookUnit('restore', 'Shield', 'Restored shield');
  const addition = workbookUnit('addition', 'Helmet', 'New helmet');
  const entry = unit => ContentAdapters.clienttext.memoryUnits(unit, ClientTextState.valuesFor(unit), 'Thai', { game: 'poe2' })[0];
  const current = { ...entry(correction), id: 'existing', target: 'Previous sword', revision: 3, localRevision: 1 };
  const deleted = { ...entry(restore), id: 'deleted', target: 'Previous shield', deleted: true, revision: 4, localRevision: 2 };
  const { app } = workbookHarness([correction, restore, addition], { units: [current] });
  app.tmTombstones = [deleted]; app.tmSeedIncludeZip = true;
  await app.previewTMSeed();
  assert.deepEqual(copy(app.tmSeedRows.map(row => [row.unit.id, row.selected, row.restore])), [
    ['existing', false, false], ['deleted', false, true], [entry(addition).id, true, false] ]);
  await app.applyTMSeed();
  assert.equal(app.tmUnits.find(unit => unit.id === 'existing').target, 'Previous sword');
  assert.equal(app.tmTombstones[0].id, 'deleted');
  await app.previewTMSeed(); assert.equal(app.tmSeedRows.length, 2);
  app.tmSeedRows.forEach(row => { row.selected = true; }); await app.applyTMSeed();
  assert.equal(app.tmUnits.find(unit => unit.id === 'existing').target, 'Corrected sword');
  assert.equal(app.tmUnits.find(unit => unit.id === 'deleted').target, 'Restored shield');
});

test('workbook form pairs retain separate identities beside the existing StatDescription TM', async () => {
  const forms = workbookUnit('forms', 'Sword', 'ดาบ');
  forms.role = 'gender'; forms.id = JSON.stringify([forms.role, forms.sheet, forms.recordId]);
  forms.fields = ['Normal Translation', 'Possessive Translation'].map((form, index) => ({
    ...forms.fields[0], id: JSON.stringify(['Display Name', form]), name: 'Display Name', kind: 'form', form,
    target: index ? 'ของดาบ' : 'ดาบ' }));
  const sd = row('stat-entry', 'Sword', 'Existing stat translation', null, { gameScope: 'poe2' });
  const { app } = workbookHarness([forms], { units: [sd] }); app.tmSeedIncludeZip = true;
  await app.previewTMSeed(); assert.equal(app.tmSeedRows.length, 2);
  assert.equal(new Set(app.tmSeedRows.map(row => TM.identityFor(row.unit))).size, 2);
  assert.deepEqual(copy(app.tmSeedRows.map(row => row.unit.context.form)), ['Normal Translation', 'Possessive Translation']);
  assert.ok(app.tmSeedRows.every(row => row.selected && row.unit.context.role === 'gender'));
  await app.applyTMSeed(); assert.equal(app.tmUnits.length, 3);
  assert.equal(app.tmUnits.find(unit => unit.id === 'stat-entry').target, sd.target);
  assert.ok(app.tmUnits.filter(unit => unit.id !== 'stat-entry').every(unit => unit.context.contentMode === 'clienttext'));
});

test('workbook source marker changes remap a colliding generated ID without replacing active or deleted raw-source entries', async () => {
  const previous = workbookUnit('same-record', '[NOAUDIO] Hello', 'Previous translation');
  const incoming = workbookUnit('same-record', 'Hello', 'Current translation');
  const memory = unit => ContentAdapters.clienttext.memoryUnits(unit, ClientTextState.valuesFor(unit), 'Thai', { game: 'poe2' })[0];
  const oldEntry = { ...memory(previous), revision: 2, localRevision: 3 }, generated = memory(incoming);
  assert.equal(oldEntry.id, generated.id, 'canonical audio markers produce the same generated ID');
  assert.notEqual(TM.identityFor(oldEntry), TM.identityFor(generated), 'raw-source identities remain different');
  for (const deleted of [false, true]) {
    const retained = { ...oldEntry, ...(deleted ? { deleted: true } : {}) };
    const { app } = workbookHarness([incoming], { units: deleted ? [] : [retained] });
    if (deleted) app.tmTombstones = [retained];
    app.tmSeedIncludeZip = true; await app.previewTMSeed();
    assert.equal(app.tmSeedRows.length, 1);
    const candidate = app.tmSeedRows[0];
    assert.notEqual(candidate.unit.id, oldEntry.id); assert.equal(candidate.selected, true);
    assert.equal(candidate.existing, null); assert.equal(candidate.restore, false);
    await app.applyTMSeed();
    const added = app.tmUnits.find(unit => unit.source === incoming.fields[0].source);
    assert.ok(added); assert.equal(added.target, 'Current translation'); assert.equal(added.id, candidate.unit.id);
    if (deleted) {
      assert.equal(app.tmUnits.length, 1); assert.deepEqual(copy(app.tmTombstones), [retained]);
    } else {
      assert.equal(app.tmUnits.length, 2);
      assert.deepEqual(copy(app.tmUnits.find(unit => unit.id === oldEntry.id)), retained);
    }
  }
});

test('private workbook builds require resource authorization and a settled save', async () => {
  for (const change of [app => { app.ctResourceSyncEnabled = false; }, app => { app.ctBusy = true; }, app => { app._ctSaveJob = { jobId: 'pending' }; }]) {
    const { app } = workbookHarness([workbookUnit('private')]); app.tmSeedIncludeZip = true; change(app);
    assert.equal(app.tmCanBuildSeed, false); await app.previewTMSeed();
    assert.equal(app.tmSeedVisible, false); assert.equal(app.tmSeedRows.length, 0); assert.equal(app.tmUnits.length, 0);
  }
});

test('workbook preview and reviewed application stop after workspace, save, permission or account changes', async () => {
  const changes = [app => { app.ctWorkspace.scope.groupId = 'local:test:another'; },
    app => { app._ctEpoch = 1; }, app => { app.ctRevision++; }, app => { app.ctResourceSyncEnabled = false; },
    app => { app.cloudProfileId = 'another-account'; }, app => { app.lang = 'German'; }, app => { app.ctActive = false; }];
  for (const change of changes) {
    const first = workbookHarness([workbookUnit('source')]), wait = deferred();
    first.app.tmSeedIncludeZip = true; first.app.waitForPendingSaves = () => wait.promise;
    const pending = first.app.previewTMSeed(); change(first.app); wait.resolve(true); await pending;
    assert.equal(first.app.tmSeedVisible, false); assert.equal(first.app.tmSeedRows.length, 0);
    const second = workbookHarness([workbookUnit('source')]); second.app.tmSeedIncludeZip = true;
    await second.app.previewTMSeed(); assert.equal(second.app.tmSeedRows.length, 1);
    change(second.app); await second.app.applyTMSeed(); assert.equal(second.app.tmUnits.length, 0);
  }
});

test('durable workbook seed rechecks its captured workspace and permission before storage commit', async () => {
  const started = deferred(), release = deferred(); let committed = false;
  const store = { getTranslationMemory: async () => ({ units: [], tombstones: [], conflicts: [] }),
    async putTranslationMemoryUnits(scope, units, options) {
      assert.deepEqual(copy(scope), { profile: 'guest', language: 'Thai' });
      assert.equal(options.guard(), true); started.resolve(); await release.promise;
      if (!options.guard()) throw Object.assign(new Error('Scope changed'), { stale: true });
      committed = true;
    } };
  const { app } = workbookHarness([workbookUnit('source')], { testMode: false, store }); app.tmSeedIncludeZip = true;
  await app.previewTMSeed(); const pending = app.applyTMSeed(); await started.promise;
  app.ctResourceSyncEnabled = false; release.resolve(); await pending;
  assert.equal(committed, false); assert.equal(app.tmUnits.length, 0);
});

test('JSON import previews additions/corrections/restores, skips incompatible pairs and rejects duplicate identities', async () => {
  const existing = row('local', 'Damage', 'old'), deleted = row('deleted', 'Life', 'old life', null, { deleted: true });
  const { app, calls } = harness({ units: [existing] }); app.editorReady = false; app.tmTombstones = [deleted];
  const incoming = [row('foreign', 'Damage', 'new'), row('new', 'Cold', 'cold'), row('restore', 'Life', 'new life'), row('bad', '{0}', '{1}')];
  const event = body => ({ target: { value: 'backup.json', files: [{ text: async () => JSON.stringify(body) }] } });
  const data = { format: 'sdeditor-tm', version: 1, language: 'Thai', units: incoming };
  const input = event(data); await app.importTMFile(input);
  assert.equal(input.target.value, ''); assert.equal(app.tmSeedSkipped, 1); assert.equal(app.tmSeedRows.length, 3);
  assert.deepEqual(copy(app.tmSeedRows.map(item => [item.unit.id, item.selected, item.restore])), [['local', false, false], ['new', true, false], ['deleted', false, true]]);
  const prior = app.tmSeedRows;
  await app.importTMFile(event({ ...data, units: [incoming[0], incoming[0]] }));
  assert.match(app.tmLocalIssue, /duplicate source\/context/); assert.equal(app.tmSeedRows, prior);
  app.exportTM(); const exportData = JSON.parse(await calls.exported[0].blob.text());
  assert.equal(exportData.format, 'sdeditor-tm'); assert.equal(exportData.language, 'Thai');
  assert.equal(exportData.units[0].target, 'old'); assert.equal(exportData.tombstones[0].id, 'deleted');
});

test('a late JSON file read cannot publish an error or preview into a different language', async () => {
  const { app } = harness(); const file = deferred();
  const pending = app.importTMFile({ target: { value: 'backup.json', files: [{ text: () => file.promise }] } });
  app.lang = 'German'; file.resolve(JSON.stringify({ format: 'sdeditor-tm', version: 1, language: 'Thai', units: [row('a')] }));
  await pending; assert.equal(app.tmSeedVisible, false); assert.equal(app.tmLocalIssue, '');
});

test('JSON tombstones preserve suppression and require explicit selection before deleting an active local entry', async () => {
  const existing = row('local', 'Damage', 'old');
  const { app } = harness({ units: [existing] }); app.editorReady = false;
  const data = { format: 'sdeditor-tm', version: 1, language: 'Thai', units: [], tombstones: [
    row('remote-delete', 'Damage', 'old', null, { deleted: true }), row('suppressed', 'Cold', 'cold', null, { deleted: true })] };
  await app.importTMFile({ target: { value: 'tm.json', files: [{ text: async () => JSON.stringify(data) }] } });
  assert.deepEqual(copy(app.tmSeedRows.map(item => [item.unit.id, item.selected, item.deletion])), [['local', false, true], ['suppressed', true, true]]);
  await app.applyTMSeed();
  assert.equal(app.tmUnits[0].id, 'local'); assert.equal(app.tmTombstones[0].id, 'suppressed');
  const duplicate = { ...data, units: [row('duplicate', 'Damage', 'replacement')] };
  await app.importTMFile({ target: { value: 'tm.json', files: [{ text: async () => JSON.stringify(duplicate) }] } });
  assert.match(app.tmLocalIssue, /active and deleted copy/);
});

test('JSON import remaps a repurposed backup ID and duplicate imported IDs without changing local unit identity', async () => {
  const existing = row('reused', 'Life', 'life');
  const { app } = harness({ units: [existing] }); app.editorReady = false;
  const data = { format: 'sdeditor-tm', version: 1, language: 'Thai', units: [
    row('reused', 'Damage', 'damage'), row('reused', 'Cold', 'cold'), row('old-backup-id', 'Life', 'corrected life')] };
  await app.importTMFile({ target: { value: 'tm.json', files: [{ text: async () => JSON.stringify(data) }] } });
  assert.equal(app.tmSeedRows.length, 3);
  const [damage, cold, correction] = app.tmSeedRows;
  assert.notEqual(damage.unit.id, 'reused'); assert.notEqual(cold.unit.id, 'reused'); assert.notEqual(damage.unit.id, cold.unit.id);
  assert.equal(correction.unit.id, 'reused'); assert.equal(correction.selected, false);
  await app.applyTMSeed();
  assert.equal(app.tmUnits.find(unit => unit.id === 'reused').source, 'Life');
  assert.equal(app.tmUnits.find(unit => unit.id === 'reused').target, 'life');
  assert.deepEqual(new Set(app.tmUnits.map(unit => unit.source)), new Set(['Life', 'Damage', 'Cold']));
});

test('workspace seed stops when pending durable saves cannot finish', async () => {
  const { app } = harness(); app.waitForPendingSaves = async () => false;
  await app.previewTMSeed(); assert.equal(app.tmSeedVisible, false); assert.equal(app.tmBusy, false);
});

test('late history from an earlier unit cannot overwrite another unit or publish its error', async () => {
  const a = deferred(), b = deferred();
  const { app } = harness({ testMode: false, store: { listTranslationMemoryHistory(scope, id) { return id === 'a' ? a.promise : b.promise; } } });
  const first = app.openTMHistory(row('a')), second = app.openTMHistory(row('b'));
  b.resolve([{ id: 'event-b' }]); await second;
  a.reject(new Error('old request failed')); await first;
  assert.equal(app.tmHistoryUnit.id, 'b'); assert.equal(app.tmHistoryEvents[0].id, 'event-b'); assert.equal(app.tmLocalIssue, '');
});

test('opening another unit resets older-history loading and prevents stale pagination publication', async () => {
  const { app } = harness(), older = deferred();
  app.cloudSignedIn = true; app.cloudUser = { language: 'Thai' };
  app.tmHistoryVisible = true; app.tmHistoryUnit = row('a'); app.tmHistoryCursor = 'old-cursor'; app._tmHistoryEpoch = 1;
  app._cloud = { context: () => ({}), request(url) { return url.includes('old-cursor') ? older.promise
    : Promise.resolve({ nextCursor: 'new-cursor', events: [{ id: 'event-b' }] }); } };
  const pending = app.loadOlderTMHistory(); assert.equal(app.tmHistoryLoading, true);
  await app.openTMHistory(row('b'));
  assert.equal(app.tmHistoryLoading, false); assert.equal(app.tmHistoryCursor, 'new-cursor');
  older.resolve({ nextCursor: 'older-cursor', events: [{ id: 'old-event-a' }] }); await pending;
  assert.equal(app.tmHistoryCursor, 'new-cursor'); assert.deepEqual(copy(app.tmHistoryEvents.map(event => event.id)), ['event-b']);
});

test('a late remote restore detail cannot open confirmation after unit, language or dialog context changes', async () => {
  for (const change of [app => { app.tmHistoryUnit = row('other'); app._tmHistoryEpoch++; }, app => { app.lang = 'German'; }, app => { app.tmHistoryVisible = false; }]) {
    const original = row('restored'), detail = deferred(), { app, calls } = harness({ units: [original] });
    app.tmHistoryUnit = original; app.tmHistoryVisible = true; app._tmHistoryEpoch = 1;
    const ctx = { profile: 'guest', language: 'Thai' };
    app._cloud = { context: () => ctx, request(url, options, captured) { assert.equal(captured, ctx); assert.match(url, /\/Thai\/history\/event$/); return detail.promise; } };
    const pending = app.restoreTMHistory({ id: 'event', remote: true });
    change(app); detail.resolve({ before: { ...original, target: 'old translation' } }); await pending;
    assert.equal(calls.confirms, 0); assert.equal(app.tmUnits[0].target, original.target); assert.equal(app.tmLocalIssue, '');
  }
});

test('history restore carries the captured current revision and preserves stable source/context fields', async () => {
  const desc = description(['Damage']), current = row('restore', 'Damage', 'current', TM.contextFor(desc, 0));
  const historical = { ...current, target: 'historical', revision: 1, localRevision: 1 };
  const { app } = harness({ desc, units: [current] }); app.editorReady = false;
  app.tmHistoryUnit = current; app.tmHistoryVisible = true; app._tmHistoryEpoch = 1;
  let expected;
  const put = app.tmPut;
  app.tmPut = async (units, options) => { expected = copy(options.expectedUnits.restore); assert.equal(options.restore, true); await put(units, options); };
  await app.restoreTMHistory({ before: historical });
  assert.deepEqual(expected, current); assert.equal(app.tmHistoryVisible, false);
  const restored = app.tmUnits[0];
  assert.equal(restored.id, current.id); assert.equal(restored.source, current.source); assert.equal(restored.gameScope, current.gameScope);
  assert.deepEqual(copy(restored.context), current.context); assert.equal(restored.target, historical.target);
  assert.equal(restored.revision, current.revision); assert.equal(restored.localRevision, current.localRevision + 1);
});

test('history restore rejects a current unit correction made during confirmation', async () => {
  const current = row('restore', 'Damage', 'current'), confirm = deferred(), { app } = harness({ units: [current] });
  app.editorReady = false; app.tmHistoryUnit = current; app.tmHistoryVisible = true; app._tmHistoryEpoch = 1;
  app.appConfirm = () => confirm.promise;
  const pending = app.restoreTMHistory({ before: { ...current, target: 'historical' } });
  app.tmUnits = [{ ...current, target: 'newer correction', localRevision: current.localRevision + 1 }];
  confirm.resolve(true); await pending;
  assert.equal(app.tmUnits[0].target, 'newer correction'); assert.match(app.tmLocalIssue, /changed/); assert.equal(app.tmHistoryVisible, true);
});

test('stopped reviewed imports retain completed batches and retry only the remaining selected rows', async () => {
  const stored = new Map(), writes = new Map(); let batches = 0;
  const store = {
    async getTranslationMemory() { return { units: [...stored.values()], tombstones: [], conflicts: [] }; },
    async putTranslationMemoryUnits(scope, units, options) {
      if (++batches === 2) throw new Error('interrupted second batch');
      if (!options.guard()) throw Object.assign(new Error('stale'), { stale: true });
      for (const unit of units) {
        if (Object.hasOwn(options.expectedUnits, unit.id) && options.expectedUnits[unit.id] === null && stored.has(unit.id)) throw new Error('Review changed unit');
      }
      for (const unit of units) { stored.set(unit.id, { ...unit, revision: 0, localRevision: 1 }); writes.set(unit.id, (writes.get(unit.id) || 0) + 1); }
    },
  };
  const { app } = harness({ testMode: false, store }); app.editorReady = false;
  app.tmSeedRows = Array.from({ length: 101 }, (_, index) => ({ unit: row('row-' + index, 'Source ' + index, 'Target ' + index), existing: null, selected: true, restore: false }));
  app.tmSeedKey = JSON.stringify([app.tmScopeKey, app.sourceIdentity, app.branchId]); app.tmSeedVisible = true;
  await app.applyTMSeed(); assert.equal(stored.size, 100); assert.match(app.tmLocalIssue, /stopped/);
  assert.equal(app.tmSeedRows.filter(item => item.selected).length, 1);
  await app.applyTMSeed(); assert.equal(stored.size, 101); assert.ok([...writes.values()].every(count => count === 1));
  assert.equal(app.tmSeedVisible, false); assert.equal(app.tmLocalIssue, '');
});

test('TM scripts load after tag diagnostics and before storage consumers; diff rendering uses escaped interpolation', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const tagPosition = html.indexOf('<script src="translationDiagnostics.js"'), corePosition = html.indexOf('<script src="translationMemory.js"');
  assert.ok(tagPosition >= 0 && corePosition > tagPosition);
  assert.ok(html.indexOf('<script src="normalizedStore.js"') > corePosition);
  const components = fs.readFileSync(path.join(__dirname, '..', 'public', 'editorComponents.js'), 'utf8');
  const panel = components.slice(components.indexOf('id="tmResultsPanel"'), components.indexOf('id="editorLookupPanel"'));
  assert.match(panel, /part\.changed/); assert.doesNotMatch(panel, /v-html/);
});

function clientTextMemory(id, target = 'Remembered translation') {
  const original = clientTextUnit('Remembered source', target);
  return { ...ContentAdapters.clienttext.memoryUnits(original, ClientTextState.valuesFor(original), 'Thai', { game: 'poe2' })[0], id,
    revision: 2, localRevision: 3 };
}
function memoryPatch(app, entries, previousVersion = 7, localVersion = previousVersion + 1) {
  return { profile: app.cloudProfileId, language: app.lang, previousVersion, localVersion, entries };
}

test('an acknowledged ClientText patch preserves unrelated units, deletion lifecycle and the compiled SD worker', () => {
  const sd = row('stat'), previous = clientTextMemory('corrected'), removed = clientTextMemory('removed');
  const unrelated = clientTextMemory('unrelated'), deleted = { ...clientTextMemory('restored'), deleted: true, suppressed: true };
  const { app, calls } = harness({ units: [sd, previous, removed, unrelated] });
  app.tmTombstones = [deleted]; app.tmConflicts = [{ id: 'corrected', local: previous }, { id: 'unrelated', local: unrelated }];
  app._tmAcceptedScope = app.tmScopeKey; app._tmSnapshotVersion = 7;
  const generation = app.tmGeneration, updated = { ...previous, target: 'Committed correction', localRevision: 4 };
  const restored = { ...deleted, target: 'Explicitly restored', deleted: false, suppressed: false };
  const tombstone = { ...removed, deleted: true, suppressed: true };
  const conflict = { id: 'removed', local: { ...removed, target: 'Retained alternative' }, shared: tombstone };
  assert.equal(app.applyClientTextMemoryPatch(memoryPatch(app, [
    { unit: updated, conflict: null }, { unit: restored, conflict: null }, { unit: tombstone, conflict } ])), true);
  assert.equal(app.tmUnits.find(unit => unit.id === sd.id), sd); assert.equal(app.tmUnits.find(unit => unit.id === unrelated.id), unrelated);
  assert.equal(app.tmUnits.find(unit => unit.id === updated.id), updated); assert.equal(app.tmUnits.find(unit => unit.id === restored.id), restored);
  assert.equal(app.tmUnits.some(unit => unit.id === removed.id), false); assert.equal(app.tmTombstones.length, 1); assert.equal(app.tmTombstones[0], tombstone);
  assert.deepEqual(copy(app.tmConflicts.map(row => row.id)), ['unrelated', 'removed']); assert.equal(app.tmConflicts[1], conflict);
  assert.equal(app._tmSnapshotVersion, 8); assert.equal(app.tmGeneration, generation); assert.deepEqual(calls.publications, []);
});

test('ClientText patches reject another account, language, version or SD identity without replacing the visible snapshot', () => {
  for (const change of [patch => { patch.profile = 'another-account'; }, patch => { patch.language = 'German'; },
    patch => { patch.previousVersion = 6; }, patch => { patch.localVersion = 6; }, patch => { patch.entries[0].unit.context = null; }]) {
    const old = clientTextMemory('old'), { app } = harness({ units: [old] });
    app._tmAcceptedScope = app.tmScopeKey; app._tmSnapshotVersion = 7;
    const visible = app.tmUnits, patch = memoryPatch(app, [{ unit: { ...old, target: 'Wrong snapshot' }, conflict: null }]); change(patch);
    assert.equal(app.applyClientTextMemoryPatch(patch), false); assert.equal(app.tmUnits, visible); assert.equal(app._tmSnapshotVersion, 7);
  }
  const sd = row('same-id'), { app } = harness({ units: [sd] }); app._tmAcceptedScope = app.tmScopeKey; app._tmSnapshotVersion = 7;
  assert.equal(app.applyClientTextMemoryPatch(memoryPatch(app, [{ unit: clientTextMemory(sd.id), conflict: null }])), false);
  assert.equal(app.tmUnits[0], sd);
  app._tmAcceptedScope = 'previous-scope';
  assert.equal(app.applyClientTextMemoryPatch(memoryPatch(app, [{ unit: clientTextMemory('new'), conflict: null }])), false);
});

test('an acknowledged StatDescription save patch keeps the compiled worker and applies only its units', () => {
  const unrelated = row('unrelated'), corrected = row('corrected', 'Damage', 'ความเสียหายเดิม'), removed = row('removed');
  const deleted = { ...row('restored'), deleted: true, suppressed: true };
  const { app, calls } = harness({ units: [unrelated, corrected, removed] });
  app.tmTombstones = [deleted]; app.tmConflicts = [{ id: 'corrected', local: corrected }];
  app._tmAcceptedScope = app.tmScopeKey; app._tmSnapshotVersion = 7;
  const generation = app.tmGeneration, updated = { ...corrected, target: 'ความเสียหายที่บันทึกแล้ว', localRevision: 4 };
  const restored = { ...deleted, target: 'คืนค่าที่บันทึกแล้ว', deleted: false, suppressed: false };
  const tombstone = { ...removed, deleted: true, suppressed: true };
  assert.equal(app.applyStatDescriptionMemoryPatch(memoryPatch(app, [
    { unit: updated, conflict: null }, { unit: restored, conflict: null }, { unit: tombstone, conflict: null }])), true);
  assert.equal(app.tmUnits.find(unit => unit.id === unrelated.id), unrelated);
  assert.equal(app.tmUnits.find(unit => unit.id === updated.id), updated);
  assert.equal(app.tmUnits.find(unit => unit.id === restored.id), restored);
  assert.equal(app.tmUnits.some(unit => unit.id === removed.id), false);
  assert.equal(app.tmTombstones.length, 1); assert.equal(app.tmTombstones[0], tombstone);
  assert.equal(app._tmSnapshotVersion, 8); assert.equal(app.tmGeneration, generation);
  assert.deepEqual(calls.publications, [], 'the whole TM library is not republished to the worker');
});

test('StatDescription patches reject another account, language, version or ClientText identity', () => {
  const old = row('old', 'Damage', 'ความเสียหายเดิม');
  for (const change of [patch => { patch.profile = 'another-account'; }, patch => { patch.language = 'German'; },
    patch => { patch.previousVersion = 6; }, patch => { patch.localVersion = 6; },
    patch => { patch.entries[0].unit.context = { contentMode: 'clienttext', filepath: 'workbook' }; }]) {
    const { app } = harness({ units: [old] });
    app._tmAcceptedScope = app.tmScopeKey; app._tmSnapshotVersion = 7;
    const visible = app.tmUnits, patch = memoryPatch(app, [{ unit: { ...old, target: 'Wrong snapshot' }, conflict: null }]); change(patch);
    assert.equal(app.applyStatDescriptionMemoryPatch(patch), false);
    assert.equal(app.tmUnits, visible); assert.equal(app._tmSnapshotVersion, 7);
  }
  const ct = clientTextMemory('same-id'), { app } = harness({ units: [row('same-id')] });
  app._tmAcceptedScope = app.tmScopeKey; app._tmSnapshotVersion = 7;
  assert.equal(app.applyStatDescriptionMemoryPatch(memoryPatch(app, [{ unit: ct, conflict: null }])), false);
});

test('cloud acknowledgements patch StatDescription units and record the published version', () => {
  const sd = row('sd', 'Damage', 'ความเสียหายเดิม'), ct = clientTextMemory('ct');
  const { app, calls } = harness({ units: [sd, ct] });
  app._tmAcceptedScope = app.tmScopeKey; app._tmSnapshotVersion = 7;
  const marked = [];
  app._tmSync = { markPublished(scope, version) { marked.push([scope.profile, scope.language, version]); return true; } };
  const generation = app.tmGeneration;
  const saved = { ...sd, target: 'บันทึกแล้ว', localRevision: 4 };
  assert.equal(app.applyTranslationMemoryPatch(memoryPatch(app, [{ unit: saved, conflict: null }])), true);
  assert.equal(app.tmUnits.find(unit => unit.id === 'sd').target, 'บันทึกแล้ว');
  assert.deepEqual(marked, [['guest', 'Thai', 8]]);
  const savedClientText = { ...ct, target: 'ClientText saved', localRevision: 4 };
  assert.equal(app.applyTranslationMemoryPatch(memoryPatch(app, [{ unit: savedClientText, conflict: null }], 8, 9)), true);
  assert.equal(app.tmUnits.find(unit => unit.id === 'ct').target, 'ClientText saved');
  assert.deepEqual(marked[1], ['guest', 'Thai', 9]);
  assert.equal(app.applyTranslationMemoryPatch(memoryPatch(app, [
    { unit: { ...saved, target: 'mixed' }, conflict: null }, { unit: savedClientText, conflict: null }], 9, 10)), false);
  assert.equal(app._tmSnapshotVersion, 9);
  assert.equal(app.tmGeneration, generation, 'no full snapshot publication happens');
  assert.deepEqual(calls.publications, []);
});

test('a queued notification waits when cloud acknowledgement starts before its reload timer fires', async () => {
  let notify, reloads = 0;
  const { app, mixin } = harness({ store: { onTranslationMemoryChange(listener) { notify = listener; return () => {}; } } });
  app.loadTranslationMemory = async () => { reloads++; };
  mixin.mounted.call(app);
  notify({ profile: 'guest', language: 'Thai' });
  app._tmSync = { running: Promise.resolve(), destroy() {} };
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(reloads, 1, 'only the initial library load runs while acknowledgement is in progress');
  assert.equal(app._tmReloadNeeded, true);
  mixin.beforeUnmount.call(app);
});

test('unchanged notification reloads read only TM metadata and a changed version still reloads the durable corpus', async () => {
  let version = 7, snapshots = 0, summaries = 0;
  const old = clientTextMemory('old'), updated = { ...old, target: 'Shared correction', localRevision: 4 };
  const { app } = harness({ testMode: false, units: [old], store: {
    async getTranslationMemoryState() { summaries++; return { localVersion: version }; },
    async getTranslationMemory() { snapshots++; return { localVersion: version, units: [updated], tombstones: [], conflicts: [] }; },
  } });
  app._tmAcceptedScope = app.tmScopeKey; app._tmSnapshotVersion = 7;
  await app.loadTranslationMemory(); assert.equal(summaries, 1); assert.equal(snapshots, 0); assert.equal(app.tmUnits[0], old);
  version = 8; await app.loadTranslationMemory(); assert.equal(snapshots, 1); assert.equal(app.tmUnits[0], updated); assert.equal(app._tmSnapshotVersion, 8);
});

test('a successful saved-pair patch prevents an older in-flight snapshot or its failure from replacing current results', async () => {
  for (const reject of [false, true]) {
    const loading = deferred(), started = deferred(), old = clientTextMemory('old'), updated = { ...old, target: 'Durable saved pair', localRevision: 4 };
    const { app } = harness({ testMode: false, units: [old], store: {
      getTranslationMemory() { started.resolve(); return loading.promise; },
    } });
    app._tmAcceptedScope = app.tmScopeKey; app._tmSnapshotVersion = 7;
    const pending = app.loadTranslationMemory(); await started.promise;
    assert.equal(app.applyClientTextMemoryPatch(memoryPatch(app, [{ unit: updated, conflict: null }])), true);
    if (reject) loading.reject(new Error('Previous snapshot failed'));
    else loading.resolve({ localVersion: 7, units: [old], tombstones: [], conflicts: [] });
    await pending; assert.equal(app.tmUnits[0], updated); assert.equal(app._tmSnapshotVersion, 8); assert.equal(app.tmLocalIssue, '');
  }
});

test('a late cloud snapshot cannot roll back a newer saved-pair patch while new scopes retain independent versions', () => {
  const old = clientTextMemory('old'), updated = { ...old, target: 'Durable saved pair', localRevision: 4 };
  const { app, calls } = harness({ units: [old] }); app.editorReady = false;
  app._tmAcceptedScope = app.tmScopeKey; app._tmSnapshotVersion = 7;
  assert.equal(app.applyClientTextMemoryPatch(memoryPatch(app, [{ unit: updated, conflict: null }])), true);
  const visible = app.tmUnits, generation = app.tmGeneration;
  app.acceptTranslationMemory({ localVersion: 7, units: [old], tombstones: [], conflicts: [] });
  assert.equal(app.tmUnits, visible); assert.equal(app.tmUnits[0], updated); assert.equal(app._tmSnapshotVersion, 8);
  assert.equal(app.tmGeneration, generation); assert.deepEqual(calls.publications, []);
  app.acceptTranslationMemory({ localVersion: 8, units: [updated], tombstones: [], conflicts: [] });
  assert.equal(app.tmUnits[0], updated); assert.equal(app._tmSnapshotVersion, 8);
  const newest = { ...updated, target: 'Newer shared correction', localRevision: 5 };
  app.acceptTranslationMemory({ localVersion: 9, units: [newest], tombstones: [], conflicts: [] });
  assert.equal(app.tmUnits[0], newest); assert.equal(app._tmSnapshotVersion, 9);
  app.cloudProfileId = 'another-account'; app.lang = 'German';
  const otherScope = { ...old, target: 'Independent language library', localRevision: 1 };
  app.acceptTranslationMemory({ localVersion: 1, units: [otherScope], tombstones: [], conflicts: [] });
  assert.equal(app.tmUnits[0], otherScope); assert.equal(app._tmSnapshotVersion, 1); assert.equal(app._tmAcceptedScope, app.tmScopeKey);
});
