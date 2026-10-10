const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const TM = require('../public/translationMemory.js');

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
  const panel = html.slice(html.indexOf('id="tmResultsPanel"'), html.indexOf('id="editorLookupPanel"'));
  assert.match(panel, /part\.changed/); assert.doesNotMatch(panel, /v-html/);
});
