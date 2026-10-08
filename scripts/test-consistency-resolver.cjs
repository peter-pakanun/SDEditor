const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const snapshot = value => JSON.parse(JSON.stringify(value));

function loadEditor() {
  let config;
  const writes = [];
  const dialogs = { opened: 0, closed: 0, focused: 0 };
  const window = {
    location: { search: '?testMode=1&lang=Thai' },
    CloudUI: { mixin: {} },
    OfflineStore: {
      async saveWorkspaceWithRevisions(workspace, revisions, version) {
        writes.push(snapshot({ workspace, revisions, version }));
      },
    },
  };
  const context = vm.createContext({
    window, URLSearchParams, console, setTimeout, clearTimeout,
    document: {
      activeElement: { isConnected: true, focus() { dialogs.focused++; } },
      querySelectorAll() { return []; },
    },
    alert(message) { throw new Error(`Unexpected alert: ${message}`); },
    confirm(message) { throw new Error(`Unexpected confirmation: ${message}`); },
    Vue: {
      defineComponent(value) { config = value; return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; },
      nextTick(callback) { callback?.(); return Promise.resolve(); },
    },
  });
  for (const name of ['workspaceState.js', 'dictionaryScope.js', 'helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'), context, { filename: name });
  }
  const editor = Object.assign(config.data(), config.methods, {
    lang: 'Thai', gameVersion: 'poe1', dictionary: [],
    // DOM layout/history fetching is unrelated to the resolver's model and persistence contract.
    filterDesc() {}, refreshEditorHLter() {}, async refreshHistory() {},
    refreshEditorTableColumnHLter(column) { this.refreshTranslationDiagnostics(column); },
    $nextTick(callback) { callback?.(); return Promise.resolve(); },
    $refs: {
      consistencyDialog: {
        open: false,
        showModal() { this.open = true; dialogs.opened++; },
        close() { this.open = false; dialogs.closed++; },
      },
    },
  });
  for (const [name, getter] of Object.entries(config.computed)) {
    Object.defineProperty(editor, name, { get: () => getter.call(editor) });
  }
  return { editor, window, writes, dialogs, config };
}

function description(name, english, thai) {
  return {
    filepath: `test/${name}.txt`, filedir: 'test', filename: `${name}.txt`,
    translations: { English: [...english], Thai: [...thai], French: english.map((_, i) => `French ${name} ${i}`) },
    hasChanges: false, isMissing: false, needsReview: true,
  };
}

function openFile(editor, desc, drafts = desc.translations.Thai) {
  editor.editorCurrentEditingDesc = desc;
  editor.editorVisible = true;
  editor.editorBlocks = desc.translations.English.map((english, i) => {
    const translation = drafts[i] ?? '';
    const block = {
      english: editor.decodeEscapedNewlines(english),
      translation: editor.decodeEscapedNewlines(translation),
      isMultiline: editor.isMultilineText(english) || editor.isMultilineText(translation),
      isTable: editor.isTableText(english) || editor.isTableText(translation),
    };
    if (block.isTable) block.tableColumns = editor.buildEditorTableColumns(block.english, block.translation);
    return block;
  });
  editor.editorOriginalTranslations = desc.translations.Thai.map(text => editor.decodeEscapedNewlines(text));
}

function setup({ drafts = false, persistent = false } = {}) {
  const harness = loadEditor();
  const { editor } = harness;
  const english = 'Damage {1}%';
  const first = description('first', [english, 'Duration {2}', english], ['ความเสียหาย {1}%', 'ระยะเวลา {2}', 'ดาเมจ {1}%']);
  const peer = description('peer', [english, 'Damage {1}% extra'], ['พลังโจมตี {1}%', 'เพิ่มเติม {1}%']);
  editor.descs = [first, peer];
  editor.localDescs = {
    descs: snapshot(editor.descs), size: 123, lastModified: 7,
    status: {
      [first.filepath]: { needsReview: true, reviewedAt: 42, custom: 'retain first' },
      [peer.filepath]: { needsReview: true, reviewedAt: 43, custom: 'retain peer' },
    },
  };
  editor.testMode = !persistent;
  openFile(editor, first, drafts ? ['ความเสียหายใหม่ {1}%', 'ระยะเวลาร่าง {2}', 'ดาเมจ {1}%'] : undefined);
  return { ...harness, first, peer, english };
}

test('resolver groups all exact-source occurrences, including duplicate entries and the current draft', async () => {
  const { editor, dialogs } = setup({ drafts: true });
  await editor.openConsistencyResolver(0);
  assert.equal(dialogs.opened, 1);
  assert.equal(editor.consistencyResolver.entries.length, 3);
  assert.equal(editor.consistencyCurrentChoice.text, 'ความเสียหายใหม่ {1}%');
  assert.deepEqual(Array.from(editor.consistencyResolver.versions, version => version.text).sort(),
    ['ความเสียหายใหม่ {1}%', 'ดาเมจ {1}%', 'พลังโจมตี {1}%'].sort());
  assert.equal(editor.consistencyAlternatives.length, 2);
  assert.ok(editor.consistencyOtherChoice);
  await editor.closeConsistencyResolver();
  assert.equal(editor.consistencyResolver, null);
  assert.equal(dialogs.closed, 1);
});

test('accepting This persists matching entries while preserving unrelated drafts, languages, and metadata', async () => {
  const { editor, first, peer, writes } = setup({ drafts: true });
  const french = editor.descs.map(desc => snapshot(desc.translations.French));
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
  await editor.openConsistencyResolver(0);
  assert.equal(await editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text), true);

  const chosen = 'ความเสียหายใหม่ {1}%';
  assert.deepEqual(snapshot(first.translations.Thai), [chosen, 'ระยะเวลา {2}', chosen]);
  assert.deepEqual(snapshot(peer.translations.Thai), [chosen, 'เพิ่มเติม {1}%']);
  assert.deepEqual(Array.from(editor.editorBlocks, block => block.translation), [chosen, 'ระยะเวลาร่าง {2}', chosen]);
  assert.deepEqual(snapshot(editor.editorOriginalTranslations), [chosen, 'ระยะเวลา {2}', chosen]);
  assert.equal(editor.editorHaveChanges(), true, 'The unrelated draft must remain unsaved.');
  assert.equal(editor.editorVisible, true);
  assert.deepEqual(editor.descs.map(desc => snapshot(desc.translations.French)), french);
  for (const desc of editor.descs) {
    assert.equal(desc.needsReview, true);
    assert.equal(editor.localDescs.status[desc.filepath].needsReview, undefined);
    assert.equal(editor.localDescs.status[desc.filepath].custom, `retain ${desc.filename.replace('.txt', '')}`);
    assert.deepEqual(snapshot(editor.localDescs.descs.find(item => item.filepath === desc.filepath).translations.Thai), snapshot(desc.translations.Thai));
  }
  assert.equal(editor.diagnosticScanCompleted, true, 'Resolving entries must preserve the completed manual scan.');
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), [first.filepath, peer.filepath]);
  assert.deepEqual(snapshot(editor.diagnosticScanResults[first.filepath].translationLines), snapshot(first.translations.Thai),
    'Cached results use saved translations, never unrelated editor drafts.');
  assert.equal(editor.diagnosticScanProcessed, 2);
  assert.equal(editor.diagnosticScanTotal, 2);
  assert.equal(editor.diagnosticScanWarningFileCount, 0);
  assert.equal(editor.editorConsistencyDiagnostics.some(Boolean), false);
  assert.ok(editor.consistencyResolutionNotice);
  assert.equal(writes.length, 0, 'Test mode must bypass IndexedDB.');
});

test('a consistency result preserves accepted peer merges, before text, and resolved dropped receipts', async () => {
  const W = require('../public/workspaceState.js');
  const { editor, first } = setup();
  const baseline = snapshot(editor.descs), sourceHash = 'a'.repeat(64), oldHash = 'b'.repeat(64);
  editor.sourceIdentity = sourceHash;
  editor.localDescs = W.initializeWorkspace({ sourceHash, descs: [], status: {} }, { source: baseline, sourceHash, game: 'poe1', language: 'Thai' });
  const candidate = W.dropTranslation(editor.localDescs, baseline[0], 'Thai',
    { id: 'local-candidate', game: 'poe1', originSourceHash: oldHash, targetSourceHash: sourceHash });
  const priorText = [...baseline[0].translations.Thai]; let committed, accepted;
  editor.persistTranslationBatch = async (updates, origin, options) => {
    assert.equal(origin, 'consistency');
    committed = snapshot(options.workspace);
    accepted = updates.map(({ desc, lines }) => ({ filepath: desc.filepath, translations: [...lines], trackedForExport: true,
      revision: 3, beforeTranslations: [...baseline.find(item => item.filepath === desc.filepath).translations.Thai] }));
    accepted.find(file => file.filepath === first.filepath).translations[1] = 'peer duration {2}';
    for (const file of accepted) W.stageTranslation(committed, file, 'Thai', { source: baseline, sourceHash,
      ...(file.filepath === first.filepath ? { promoteDropped: { id: candidate.id, revision: 0, targetSourceHash: sourceHash } } : {}) });
    W.acceptDropped(committed, [{ ...snapshot(candidate), id: 'server-candidate', revision: 2, status: 'promoted', snapshot: null }],
      { acknowledge: true, acknowledgeId: candidate.id, acknowledgeKind: 'put' });
    editor.localDescs = committed;
    return { status: 'synced' };
  };
  editor._collaboration = { snapshot: () => ({ files: accepted }), fileBase: filepath => accepted?.find(file => file.filepath === filepath) };
  await editor.openConsistencyResolver(0);
  assert.equal(await editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text), true);
  assert.equal(editor.localDescs, committed, 'The detached pre-ACK workspace must not replace the committed result.');
  const saved = editor.localDescs.staged.Thai[first.filepath];
  assert.equal(saved.translations[1], 'peer duration {2}'); assert.deepEqual(saved.before, priorText);
  assert.equal(editor.localDescs.droppedAliases['local-candidate'].id, 'server-candidate');
  assert.equal(editor.localDescs.droppedAliases['local-candidate'].revision, 2);
  assert.equal(editor.localDescs.droppedArchive['server-candidate'].status, 'promoted');
  assert.equal(editor.localDescs.droppedOutbox.length, 0);
  const status = W.workspaceFile(editor.localDescs, baseline[0], 'Thai');
  assert.equal(status.hasChanges, true); assert.equal(status.isDropped, false); assert.equal(status.translations[1], 'peer duration {2}');
});

test('accepting another version advances matching editor baselines and clears a clean editor', async () => {
  const { editor, first, peer } = setup();
  await editor.openConsistencyResolver(0);
  const chosen = peer.translations.Thai[0];
  assert.equal(await editor.applyConsistencyVersion(chosen), true);
  assert.equal(first.translations.Thai[0], chosen);
  assert.equal(first.translations.Thai[2], chosen);
  assert.equal(editor.editorBlocks[0].translation, chosen);
  assert.equal(editor.editorBlocks[2].translation, chosen);
  assert.equal(editor.editorHaveChanges(), false);
  assert.equal(editor.diagnosticScanCompleted, false, 'Resolving without an existing scan must not start one.');
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
});

test('resolution preserves unrelated diagnostic results and refreshes matching peers and filtered counts', async () => {
  const { editor, config } = loadEditor();
  const source = 'Fire damage {1}%';
  const first = description('first', [source, 'Cold damage'], ['ไฟ {1}', 'เย็นหนึ่ง']);
  const peer = description('peer', [source], ['ไฟ {1}%']);
  const coldPeer = description('cold-peer', ['Cold damage'], ['เย็นสอง']);
  const other = description('other', ['Lightning damage'], ['ฟ้าหนึ่ง']);
  const otherPeer = description('other-peer', ['Lightning damage'], ['ฟ้าสอง']);
  const error = description('error', ['Duration {2}'], ['ระยะเวลา']);
  editor.descs = [first, peer, coldPeer, other, otherPeer, error];
  editor.filterDesc = config.methods.filterDesc;
  editor.selectedFileFilters = ['diagnosticWarning'];
  openFile(editor, first);
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanWarningFileCount, 5);
  assert.equal(editor.diagnosticScanErrorFileCount, 2);
  const unchanged = new Map([coldPeer, other, otherPeer, error].map(desc => [desc.filepath, editor.diagnosticScanResults[desc.filepath]]));
  const analyzed = [];
  const analyze = editor.analyzeDescDiagnostics;
  editor.analyzeDescDiagnostics = function (desc, ...args) {
    analyzed.push(desc.filepath);
    return analyze.call(this, desc, ...args);
  };
  editor.scanAllDiagnostics = async () => { throw new Error('A resolution must not rerun the full scan.'); };

  await editor.openConsistencyResolver(0);
  assert.equal(await editor.applyConsistencyVersion(peer.translations.Thai[0]), true);
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanRunning, false);
  assert.deepEqual(analyzed.sort(), [first.filepath, peer.filepath].sort(), 'Only files containing the resolved source need analysis.');
  assert.equal(editor.diagnosticScanWarningFileCount, 4);
  assert.equal(editor.diagnosticScanErrorFileCount, 1);
  assert.equal(editor.diagnosticScanResults[peer.filepath].hasDiagnosticWarning, false,
    'The already-correct peer must lose its obsolete consistency warning too.');
  assert.deepEqual(Array.from(editor.diagnosticScanResults[first.filepath].consistencyDiagnostics, item => item.blockIndex), [1]);
  assert.deepEqual(Array.from(editor.filteredDescs, desc => desc.filepath), [first, coldPeer, other, otherPeer].map(desc => desc.filepath));
  assert.equal(editor.editorConsistencyDiagnostics[0], null);
  assert.equal(editor.editorConsistencyDiagnostics[1].code, 'inconsistent-translation');
  for (const [filepath, result] of unchanged) assert.equal(editor.diagnosticScanResults[filepath], result);
  editor.selectedFileFilters = ['diagnosticError'];
  editor.filterDesc();
  assert.deepEqual(Array.from(editor.filteredDescs, desc => desc.filepath), [error.filepath]);

  editor.selectedFileFilters = ['diagnosticWarning'];
  await editor.openConsistencyResolver(1);
  assert.ok(editor.consistencyResolver, 'The next conflict must remain actionable without rescanning.');
  assert.equal(await editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text), true);
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
  assert.equal(editor.diagnosticScanErrorFileCount, 1);
  assert.deepEqual(Array.from(editor.filteredDescs, desc => desc.filepath), [other.filepath, otherPeer.filepath]);
});

test('resolution refresh keeps hidden DNT conflicts excluded and preserves unrelated scan results', async () => {
  const { editor } = loadEditor();
  const first = description('first', ['Fire damage', 'Cold damage'], ['ไฟหนึ่ง', 'เย็นหนึ่ง']);
  const peer = description('peer', ['Fire damage'], ['ไฟสอง']);
  const hidden = description('hidden', ['Cold damage'], ['เย็นซ่อน']);
  hidden.isDNT = true;
  const other = description('other', ['Lightning damage'], ['ฟ้าหนึ่ง']);
  const otherPeer = description('other-peer', ['Lightning damage'], ['ฟ้าสอง']);
  const error = description('error', ['Duration {2}'], ['ระยะเวลา']);
  editor.descs = [first, peer, hidden, other, otherPeer, error];
  editor.hideDNT = true;
  openFile(editor, first);
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanWarningFileCount, 4);
  assert.equal(editor.diagnosticScanErrorFileCount, 1);
  const unchanged = new Map([other, otherPeer, error].map(desc => [desc.filepath, editor.diagnosticScanResults[desc.filepath]]));
  const analyzed = [];
  const analyze = editor.analyzeDescDiagnostics;
  editor.analyzeDescDiagnostics = function (desc, ...args) {
    analyzed.push(desc.filepath);
    return analyze.call(this, desc, ...args);
  };
  editor.scanAllDiagnostics = async () => { throw new Error('A resolution must not rerun the full scan.'); };

  await editor.openConsistencyResolver(0);
  assert.equal(await editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text), true);
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanTotal, 5);
  assert.equal(editor.diagnosticScanProcessed, 5);
  assert.deepEqual(analyzed.sort(), [first.filepath, peer.filepath].sort());
  assert.equal(editor.diagnosticScanResults[hidden.filepath], undefined);
  assert.equal(editor.diagnosticScanResults[first.filepath].consistencyDiagnostics.length, 0,
    'Refreshing the resolved file must not introduce a conflict against its hidden DNT peer.');
  assert.equal(editor.editorConsistencyDiagnostics.some(Boolean), false);
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
  assert.equal(editor.diagnosticScanErrorFileCount, 1);
  for (const [filepath, result] of unchanged) assert.equal(editor.diagnosticScanResults[filepath], result);
});

test('resolution keeps completed scan categories after changing choices for the next scan', async () => {
  const { editor } = loadEditor();
  const first = description('first', ['Fire damage', 'Cold damage'], [' ผิดหนึ่ง', 'ผิดสาม']);
  const peer = description('peer', ['Fire damage'], ['ผิดสอง']);
  editor.descs = [first, peer];
  editor.dictionary = [{ find: 'Fire', replace: 'ไฟ' }, { find: 'Cold', replace: 'เย็น' }];
  editor.diagnosticScanChecks = Object.fromEntries(Object.keys(editor.diagnosticScanChecks)
    .map(key => [key, key === 'consistency' || key === 'terminology']));
  openFile(editor, first);
  await editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanResults[first.filepath].warningCount, 3);
  editor.diagnosticScanChecks = Object.fromEntries(Object.keys(editor.diagnosticScanChecks)
    .map(key => [key, key === 'whitespace']));
  editor.openDiagnosticScanDialog();
  editor.closeDiagnosticScanDialog();
  assert.equal(editor.diagnosticScanChecks.terminology, false);
  assert.equal(editor.diagnosticScanChecks.whitespace, true);

  await editor.openConsistencyResolver(0);
  assert.equal(await editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text), true);
  const result = editor.diagnosticScanResults[first.filepath];
  assert.equal(result.consistencyDiagnostics.length, 0);
  assert.equal(result.terminologyDiagnostics.length, 2, 'Previously selected terminology checks must remain active.');
  assert.equal(result.warningCount, 2, 'A default whitespace check must not be added to the completed scan.');
  assert.equal(editor.diagnosticScanResults[peer.filepath].warningCount, 1);
  assert.equal(editor.blockTerminologyDiagnostics(editor.editorBlocks[0]).length, 1);
});

test('source grouping normalizes only newline representation and preserves whole-entry boundaries', async () => {
  const { editor } = loadEditor();
  const first = description('first', ['Damage {1}%\\nDuration {2}'], ['หนึ่ง {1}%\\nสอง {2}']);
  const peer = description('peer', ['Damage {1}%\r\nDuration {2}', 'Damage {1}%\\nDuration {2} ', 'Damage {1}%'],
    ['แรก {1}%\nสอง {2}', 'ต่าง {1}%\\nสอง {2} ', 'เดี่ยว {1}%']);
  editor.descs = [first, peer];
  openFile(editor, first);
  await editor.openConsistencyResolver(0);
  assert.equal(editor.consistencyResolver.entries.length, 2);
  assert.equal(await editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text), true);
  assert.equal(peer.translations.Thai[0], first.translations.Thai[0]);
  assert.equal(peer.translations.Thai[1], 'ต่าง {1}%\\nสอง {2} ');
  assert.equal(peer.translations.Thai[2], 'เดี่ยว {1}%');
});

test('persistent apply stages workspace and before/after revisions before mutating the editor', async () => {
  const { editor, window, first, peer } = setup({ drafts: true, persistent: true });
  const before = snapshot({ descs: editor.descs, workspace: editor.localDescs, blocks: editor.editorBlocks });
  let release;
  let storageArgs;
  const pendingStorage = new Promise(resolve => { release = resolve; });
  window.OfflineStore.saveWorkspaceWithRevisions = async (workspace, revisions, version) => {
    storageArgs = snapshot({ workspace, revisions, version });
    await pendingStorage;
  };
  await editor.openConsistencyResolver(0);
  const applying = editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text);
  await Promise.resolve();
  assert.ok(storageArgs, 'The atomic storage API must be called.');
  assert.equal(editor.consistencyResolverBusy, true);
  assert.deepEqual(snapshot({ descs: editor.descs, workspace: editor.localDescs, blocks: editor.editorBlocks }), before);
  assert.equal(storageArgs.version, 'poe1');
  assert.equal(storageArgs.revisions.length, 4, 'Each changed file needs restorable before and after snapshots.');
  for (const desc of [first, peer]) {
    const revisions = storageArgs.revisions.filter(revision => revision.filepath === desc.filepath);
    assert.equal(revisions.length, 2);
    assert.deepEqual(revisions[0].translations, snapshot(desc.translations.Thai));
    assert.equal(revisions[1].translations[0], 'ความเสียหายใหม่ {1}%');
    assert.equal(revisions[1].lang, 'Thai');
  }
  release();
  assert.equal(await applying, true);
  assert.equal(editor.consistencyResolverBusy, false);
});

test('storage rejection preserves all saved data, drafts, and baselines and leaves the resolver open', async () => {
  const { editor, window, dialogs } = setup({ drafts: true, persistent: true });
  await editor.scanAllDiagnostics();
  const scanResults = editor.diagnosticScanResults;
  await editor.openConsistencyResolver(0);
  const before = snapshot({ descs: editor.descs, workspace: editor.localDescs, blocks: editor.editorBlocks, baseline: editor.editorOriginalTranslations });
  window.OfflineStore.saveWorkspaceWithRevisions = async () => { throw new Error('QuotaExceededError'); };
  assert.equal(await editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text), false);
  assert.deepEqual(snapshot({ descs: editor.descs, workspace: editor.localDescs, blocks: editor.editorBlocks, baseline: editor.editorOriginalTranslations }), before);
  assert.ok(editor.consistencyResolver);
  assert.match(editor.consistencyResolverError, /QuotaExceededError/);
  assert.equal(editor.consistencyResolutionNotice, '');
  assert.equal(editor.consistencyResolverBusy, false);
  assert.equal(dialogs.closed, 0);
  assert.equal(editor.diagnosticScanResults, scanResults);
  assert.equal(editor.diagnosticScanCompleted, true);
  assert.equal(editor.diagnosticScanWarningFileCount, 2);
});

test('a language switch during atomic save preserves the new language editor and baselines', async () => {
  const { editor, window, first } = setup({ drafts: true, persistent: true });
  let release;
  let savedVersion;
  const pendingStorage = new Promise(resolve => { release = resolve; });
  window.OfflineStore.saveWorkspaceWithRevisions = async (_workspace, _revisions, version) => {
    savedVersion = version;
    await pendingStorage;
  };
  await editor.openConsistencyResolver(0);
  const chosen = editor.consistencyCurrentChoice.text;
  const applying = editor.applyConsistencyVersion(chosen);
  await Promise.resolve();
  assert.equal(editor.consistencyResolverBusy, true);

  editor.lang = 'French';
  openFile(editor, first, ['French draft zero', 'French draft one', 'French draft two']);
  editor.editorOriginalTranslations = [...first.translations.French];
  const frenchEditor = snapshot({ blocks: editor.editorBlocks, baseline: editor.editorOriginalTranslations });
  await editor.scanAllDiagnostics();
  const frenchResults = editor.diagnosticScanResults;
  release();
  assert.equal(await applying, true);
  assert.equal(savedVersion, 'poe1');
  assert.equal(first.translations.Thai[0], chosen, 'The original Thai save must still finish.');
  assert.deepEqual(snapshot({ blocks: editor.editorBlocks, baseline: editor.editorOriginalTranslations }), frenchEditor);
  assert.deepEqual(snapshot(first.translations.French), ['French first 0', 'French first 1', 'French first 2']);
  assert.match(editor.consistencyResolutionNotice, /Thai/);
  assert.equal(editor.diagnosticScanResults, frenchResults, 'Finishing the Thai save must preserve a new French scan.');
  assert.equal(editor.diagnosticScanCompleted, true);
});

test('reopening the same file during atomic save preserves the new editor draft', async () => {
  const { editor, window, first } = setup({ drafts: true, persistent: true });
  let release;
  const pendingStorage = new Promise(resolve => { release = resolve; });
  window.OfflineStore.saveWorkspaceWithRevisions = async () => pendingStorage;
  await editor.openConsistencyResolver(0);
  const applying = editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text);
  await Promise.resolve();
  openFile(editor, first, ['ร่างเปิดใหม่ {1}%', 'ระยะเวลาใหม่ {2}', 'ร่างแถวสอง {1}%']);
  const reopenedEditor = snapshot({ blocks: editor.editorBlocks, baseline: editor.editorOriginalTranslations });
  release();
  assert.equal(await applying, true);
  assert.deepEqual(snapshot({ blocks: editor.editorBlocks, baseline: editor.editorOriginalTranslations }), reopenedEditor);
});

test('a game version switch during atomic save preserves the new workspace and editor', async () => {
  const { editor, window } = setup({ drafts: true, persistent: true });
  let release;
  let savedVersion;
  const pendingStorage = new Promise(resolve => { release = resolve; });
  window.OfflineStore.saveWorkspaceWithRevisions = async (_workspace, _revisions, version) => {
    savedVersion = version;
    await pendingStorage;
  };
  await editor.openConsistencyResolver(0);
  const applying = editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text);
  await Promise.resolve();

  editor.gameVersion = 'poe2';
  const newVersionDesc = description('first', ['PoE 2 damage {1}%'], ['ภาคสอง {1}%']);
  editor.descs = [newVersionDesc];
  editor.localDescs = { descs: snapshot(editor.descs), status: {}, lastModified: 999, size: 456 };
  openFile(editor, newVersionDesc, ['ร่างภาคสอง {1}%']);
  const poe2State = snapshot({ descs: editor.descs, workspace: editor.localDescs, blocks: editor.editorBlocks, baseline: editor.editorOriginalTranslations });
  await editor.scanAllDiagnostics();
  const poe2Results = editor.diagnosticScanResults;
  release();
  assert.equal(await applying, true);
  assert.equal(savedVersion, 'poe1');
  assert.deepEqual(snapshot({ descs: editor.descs, workspace: editor.localDescs, blocks: editor.editorBlocks, baseline: editor.editorOriginalTranslations }), poe2State);
  assert.equal(editor.diagnosticScanResults, poe2Results, 'Finishing a prior game version save must preserve the current scan.');
  assert.equal(editor.diagnosticScanCompleted, true);
});

test('resolution does not restore a scan invalidated while storage was committing', async () => {
  const { editor, window } = setup({ persistent: true });
  await editor.scanAllDiagnostics();
  let release;
  window.OfflineStore.saveWorkspaceWithRevisions = async () => new Promise(resolve => { release = resolve; });
  await editor.openConsistencyResolver(0);
  const applying = editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text);
  await Promise.resolve();
  editor.scheduleDictionaryDiagnosticScan();
  release();
  assert.equal(await applying, true);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
});

test('resolution cancels an unfinished scan before it can publish stale peer warnings', async () => {
  const { editor, first } = setup();
  editor.descs.push(...Array.from({ length: 24 }, (_, index) => description(`extra-${index}`, [`Other source ${index}`], [`อื่น ${index}`])));
  await editor.openConsistencyResolver(0);
  const scanning = editor.scanAllDiagnostics();
  assert.equal(editor.diagnosticScanRunning, true);
  assert.equal(editor.diagnosticScanProcessed, 0, 'The scan yields before doing work.');
  while (editor.diagnosticScanRunning && editor.diagnosticScanProcessed < 25) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal(editor.diagnosticScanProcessed, 25);
  assert.equal(await editor.applyConsistencyVersion(first.translations.Thai[0]), true);
  await scanning;
  assert.equal(editor.diagnosticScanRunning, false);
  assert.equal(editor.diagnosticScanCompleted, false);
  assert.deepEqual(Object.keys(editor.diagnosticScanResults), []);
});

test('resolver rejects changed language, game version, saved peers, or current drafts', async () => {
  const changes = [
    editor => { editor.lang = 'French'; },
    editor => { editor.gameVersion = 'poe2'; },
    editor => { editor.descs[1].translations.Thai[0] = 'เปลี่ยนแล้ว {1}%'; },
    editor => { editor.editorBlocks[0].translation = 'เปลี่ยนร่าง {1}%'; },
    editor => { editor.descs[1].translations.English[0] = 'Other damage {1}%'; },
  ];
  for (const change of changes) {
    const { editor, writes } = setup({ persistent: true });
    await editor.openConsistencyResolver(0);
    const chosen = editor.consistencyCurrentChoice.text;
    change(editor);
    const before = snapshot({ descs: editor.descs, workspace: editor.localDescs, blocks: editor.editorBlocks });
    assert.equal(await editor.applyConsistencyVersion(chosen), false);
    assert.ok(editor.consistencyResolverError);
    assert.deepEqual(snapshot({ descs: editor.descs, workspace: editor.localDescs, blocks: editor.editorBlocks }), before);
    assert.equal(writes.length, 0);
  }
});

test('history compare cannot open or apply a consistency replacement', async () => {
  for (const mode of ['source', 'translation']) {
    const { editor } = setup();
    editor.editorCompareActive = true;
    editor.editorCompareMode = mode;
    await editor.openConsistencyResolver(0);
    assert.equal(editor.consistencyResolver, null);
    editor.editorCompareActive = false;
    await editor.openConsistencyResolver(0);
    const chosen = editor.consistencyCurrentChoice.text;
    editor.editorCompareActive = true;
    assert.equal(await editor.applyConsistencyVersion(chosen), false);
  }
});

test('percentage variable errors block bulk replacement without changing valid peers', async () => {
  const { editor, first, peer } = setup();
  editor.editorBlocks[0].translation = 'ความเสียหาย {1}';
  await editor.openConsistencyResolver(0);
  const before = snapshot(editor.descs);
  assert.equal(await editor.applyConsistencyVersion(editor.consistencyCurrentChoice.text), false);
  assert.deepEqual(snapshot(editor.descs), before);
  assert.equal(first.translations.Thai[0], 'ความเสียหาย {1}%');
  assert.equal(peer.translations.Thai[0], 'พลังโจมตี {1}%');
  assert.ok(editor.consistencyResolverError);
});

test('bulk validation checks percentage variables independently in table columns', async () => {
  const { editor } = loadEditor();
  const first = description('first', ['{1}%@{1}'], ['{1}%@{1}']);
  const peer = description('peer', ['{1}%@{1}'], ['{1}@{1}%']);
  editor.descs = [first, peer];
  openFile(editor, first);
  await editor.openConsistencyResolver(0);
  assert.equal(await editor.applyConsistencyVersion(peer.translations.Thai[0]), false);
  assert.equal(first.translations.Thai[0], '{1}%@{1}');
  assert.ok(editor.consistencyResolverError);
});

test('missing and excess table columns reject a version before storage or model changes', async () => {
  for (const candidate of ['หนึ่ง', 'หนึ่ง@สอง@สาม']) {
    const { editor, writes } = loadEditor();
    const first = description('first', ['First@Second'], ['หนึ่ง@สอง']);
    const peer = description('peer', ['First@Second'], [candidate]);
    editor.descs = [first, peer];
    editor.testMode = false;
    openFile(editor, first);
    await editor.openConsistencyResolver(0);
    assert.ok(editor.buildConsistencyChoice(candidate).errors.some(error => /table column/i.test(error.message)));
    const before = snapshot({ descs: editor.descs, workspace: editor.localDescs, blocks: editor.editorBlocks, baseline: editor.editorOriginalTranslations });
    assert.equal(await editor.applyConsistencyVersion(candidate), false);
    assert.equal(writes.length, 0);
    assert.deepEqual(snapshot({ descs: editor.descs, workspace: editor.localDescs, blocks: editor.editorBlocks, baseline: editor.editorOriginalTranslations }), before);
  }
});

test('explicitly accepting an empty plain-text version clears all matching entries', async () => {
  const { editor } = loadEditor();
  const first = description('first', ['Fire damage'], ['ความเสียหายไฟ']);
  const peer = description('peer', ['Fire damage'], ['']);
  peer.isMissing = true;
  editor.descs = [first, peer];
  openFile(editor, first);
  await editor.openConsistencyResolver(0);
  const empty = editor.buildConsistencyChoice('');
  assert.equal(empty.errors.length, 0);
  assert.ok(empty.warnings.some(warning => /Empty translation/.test(warning.message)));
  assert.equal(await editor.applyConsistencyVersion(''), true);
  assert.equal(first.translations.Thai[0], '');
  assert.equal(peer.translations.Thai[0], '');
  assert.equal(first.isMissing, true);
  assert.equal(editor.editorBlocks[0].translation, '');
  assert.equal(editor.editorOriginalTranslations[0], '');
  assert.equal(editor.editorHaveChanges(), false);
});

test('valid table replacement updates every column and stays consistent after editor serialization', async () => {
  const { editor } = loadEditor();
  const first = description('first', ['Damage {1}%@Duration {2}'], ['เสียหาย {1}%@เวลา {2}']);
  const peer = description('peer', ['Damage {1}%@Duration {2}'], ['ความเสียหาย {1}%@ระยะเวลา {2}']);
  editor.descs = [first, peer];
  openFile(editor, first);
  await editor.openConsistencyResolver(0);
  const chosen = peer.translations.Thai[0];
  assert.equal(editor.buildConsistencyChoice(chosen).errors.length, 0);
  assert.equal(await editor.applyConsistencyVersion(chosen), true);
  assert.equal(first.translations.Thai[0], chosen);
  assert.deepEqual(Array.from(editor.editorBlocks[0].tableColumns, column => column.translation), ['ความเสียหาย {1}%', 'ระยะเวลา {2}']);
  editor.syncEditorBlockFromTableColumns(editor.editorBlocks[0]);
  assert.equal(editor.editorBlocks[0].translation, chosen);
  assert.equal(editor.editorOriginalTranslations[0], chosen);
  assert.equal(editor.editorHaveChanges(), false);
  assert.equal(editor.editorConsistencyDiagnostics.some(Boolean), false);
});

test('unoffered translation values cannot be bulk applied', async () => {
  const { editor } = setup();
  await editor.openConsistencyResolver(0);
  const before = snapshot(editor.descs);
  assert.equal(await editor.applyConsistencyVersion('ข้อความที่ไม่เคยเสนอ {1}%'), false);
  assert.deepEqual(snapshot(editor.descs), before);
});

test('shared inline diff escapes user HTML in both removed and added text', () => {
  const { editor, window } = loadEditor();
  const changes = [
    { value: '<img src=x onerror=alert(1)>', removed: true },
    { value: '<script>bad()</script>', added: true },
  ];
  window.Diff = { diffWordsWithSpace() { return changes; }, diffChars() { return changes; } };
  const html = editor.renderInlineDiffHtml('old', 'new', { characters: true, showWhitespace: false });
  assert.match(html, /diffInlineDel/);
  assert.match(html, /diffInlineAdd/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
});
