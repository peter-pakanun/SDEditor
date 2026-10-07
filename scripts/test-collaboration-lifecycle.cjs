const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const protocol = require('../public/collaborationProtocol.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const repairedPath = 'stat_descriptions/ignite_faster_burn_%_applies_to_ignite_proliferation_delay_ms.txt';
function importText({ broken = true, translated = '' } = {}) {
  return 'description\n1 ignite_delay\n1\n# "Ignite spreads faster' + (broken ? '\n' : '\\n') + '"\nlang "Thai"\n1\n# "' + translated + '"\n';
}
function zipFixture(text, { translated = false, extra = {}, archive = false, envelope = '' } = {}) {
  const entries = { [repairedPath]: text, ...extra };
  const files = Object.fromEntries(Object.entries(entries).map(([name, content]) => [name, {
    name, dir: false,
    async: async format => {
      assert.equal(format, 'uint8array');
      return new Uint8Array(Buffer.from('\uFEFF' + content, 'utf16le'));
    },
  }]));
  const file = { name: translated ? 'StatDescriptions_Translated.zip' : 'StatDescriptions.zip', size: 100, lastModified: 123, files };
  if (archive) {
    // The ZIP loader is mocked; these distinct raw archive bytes exercise the
    // upstream-file identity independently of equivalent parsed contents.
    const bytes = Buffer.from(JSON.stringify({ entries, envelope }));
    file.size = bytes.length;
    file.arrayBuffer = async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return file;
}
class FixtureFileReader {
  readAsText(blob, encoding) {
    blob.arrayBuffer().then(bytes => {
      this.result = new TextDecoder(encoding).decode(bytes);
      this.onload?.();
    }, error => this.onerror?.(error));
  }
}
function description(name = 'old', english = ['Original {0}', 'Second']) {
  return { filepath: `source/${name}.txt`, filedir: 'source', filename: name + '.txt', name: '',
    stats: ['stat'], variables: ['#', '#'], remarks: ['', ''], translations: { English: english, Thai: ['เดิม {0}', 'สอง'] },
    hasChanges: true, needsReview: false };
}
function harness({ realImport = false } = {}) {
  let config;
  const writes = [], alerts = [], confirmations = [];
  let approved = true;
  const window = { location: { search: '?testMode=1&lang=Thai' }, CloudUI: { mixin: {} },
    CollaborationProtocol: realImport ? { ...protocol } : { sourceHash: async source => 'hash-' + source[0].filename },
    OfflineStore: {
      getWorkspace: async () => undefined, getSource: async () => undefined,
      getImportedBaseline: async () => undefined,
      saveSourceWorkspaceWithRevisions: async (...args) => { writes.push(plain(args)); },
      saveWorkspaceWithRevisions: async (...args) => { writes.push(plain(args)); },
    } };
  const context = vm.createContext({ window, URLSearchParams, console, setTimeout, clearTimeout, Blob, crypto: crypto.webcrypto, FileReader: FixtureFileReader,
    JSZip: class { async loadAsync(file) { return { files: file.files }; } },
    alert: () => assert.fail('Native alerts must not be used'), confirm: () => assert.fail('Native confirmations must not be used'),
    document: { activeElement: null, body: {}, querySelector: () => null },
    Vue: { nextTick(fn) { fn?.(); return Promise.resolve(); }, defineComponent(value) { config = value; return value; },
      createApp: () => ({ component() {}, directive() {}, mount() {} }) } });
  for (const file of ['workspaceState.js', 'helper.js', 'statDescParser.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'collaborationIntegration.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context, { filename: file });
  }
  vm.runInContext('offlineStoreReady = true', context);
  const mixin = window.CollaborationIntegration.mixin;
  const editor = Object.assign(mixin.data(), config.data(), mixin.methods, config.methods, {
    lang: 'Thai', gameVersion: 'poe1', sourceIdentity: 'old-hash', sourceLoaded: true,
    loadingProgress: 100,
    cloudUser: { id: 'account-one' }, dictionary: [], $refs: {}, $nextTick: fn => { fn?.(); return Promise.resolve(); },
    appAlert: async value => { alerts.push(value); },
    appConfirm: async value => { confirmations.push(value); return approved; },
    saveSettings() {}, closeHlPopup() {}, restoreFileTableFocusAfterEditor() {}, scheduleCollaboration() {},
  });
  for (const [name, getter] of Object.entries(config.computed)) Object.defineProperty(editor, name, { get: () => getter.call(editor) });
  editor.descs = [description()]; editor.localDescs = { descs: plain(editor.descs), status: {}, sourceHash: 'old-hash' };
  if (realImport) { editor.testMode = false; editor.confirmProceedByTypingYes = () => true; }
  return { editor, window, context, document: context.document, writes, alerts, confirmations, approve(value) { approved = value; } };
}

test('manager collaboration joins the selected language without an assignment and revocation disconnects it', async () => {
  const { editor: e, window } = harness();
  e.testMode = false; e.offlineStoreReady = true; e.editorVisible = false;
  e.cloudSignedIn = true; e.cloudCanAccessAllLanguages = true;
  e.cloudUser = { id: 'manager', role: 'manager', language: null, assignmentVersion: 1 };
  e.lang = 'German';
  e._cloud = { apiBase: 'http://api.test', context: () => ({}), request() {} };
  const joins = []; let disconnected = 0;
  window.CollaborationSync = { Client: class {
    async connect(input) { joins.push(plain(input)); }
    select() {} setAway() {} disconnect() { disconnected++; }
  } };
  await e.initializeCollaboration();
  assert.equal(joins.length, 1);
  assert.equal(joins[0].language, 'German');
  assert.equal(joins[0].accountId, 'manager');
  const captured = e.captureCollaborationContext();
  e.cloudUser.role = 'translator'; e.cloudCanAccessAllLanguages = false;
  assert.equal(e.collaborationContextCurrent(captured), false);
  window.CollaborationIntegration.mixin.methods.scheduleCollaboration.call(e);
  clearTimeout(e._collabStartTimer);
  assert.equal(disconnected, 1);
  assert.equal(e._collaboration, null);
  await e.initializeCollaboration();
  assert.equal(joins.length, 1);
});

test('manager archive lookup uses shared import decisions across languages', async () => {
  const { editor: e } = harness();
  e.cloudSignedIn = true; e.cloudCanAccessAllLanguages = true;
  e.cloudUser = { id: 'manager', role: 'manager', language: null };
  const requests = [];
  e._cloud = { request: async path => { requests.push(path); return { archive: { zipHash: 'archive' } }; } };
  assert.deepEqual(plain(await e.lookupImportArchive({ zipHash: 'archive' })), { zipHash: 'archive' });
  assert.equal(requests.length, 1);
  e.cloudCanAccessAllLanguages = false;
  assert.equal(await e.lookupImportArchive({ zipHash: 'archive' }), null);
  assert.equal(requests.length, 1);
});

test('admin language switching keeps Saved and Dropped counts within their language', () => {
  const { editor: e } = harness();
  e.cloudSignedIn = true; e.cloudCanAccessAllLanguages = true;
  e.cloudUser = { id: 'admin', role: 'admin', language: 'Thai' };
  e.descs = ['saved', 'review', 'missing'].map(name => {
    const desc = description(name);
    desc.hasChanges = false; desc.needsReview = false;
    desc.translations.German = ['Deutsch', 'Zwei'];
    if (name !== 'saved') desc.translations.Thai = ['', ''];
    return desc;
  });
  // A pre-existing workspace saved by a Thai translator has no language maps.
  e.localDescs = { descs: e.descs.slice(0, 2).map(desc => {
    const local = plain(desc);
    delete local.translations.German;
    local.hasChanges = desc.filename === 'saved.txt';
    if (desc.filename === 'review.txt') local.translations.Thai = ['Review candidate', 'Second'];
    return local;
  }), status: { 'source/review.txt': { needsReview: true } } };
  e.applyWorkspaceOverlay(); e.filterDesc();
  assert.deepEqual(plain(e.statistic), { hasChanges: 1, isRevised: 0, isMissing: 2, isDropped: 1 });
  e.lang = 'German'; e.applyWorkspaceOverlay(); e.filterDesc();
  assert.deepEqual(plain(e.statistic), { hasChanges: 0, isRevised: 0, isMissing: 0, isDropped: 0 });
  assert.deepEqual(plain(e.localDescs.descs[0].translations.Thai), ['เดิม {0}', 'สอง']);
  e.lang = 'Thai'; e.applyWorkspaceOverlay(); e.filterDesc();
  assert.deepEqual(plain(e.statistic), { hasChanges: 1, isRevised: 0, isMissing: 2, isDropped: 1 });
});

test('German collaboration metadata does not erase Saved or Dropped state in Thai', () => {
  const { editor: e } = harness();
  const saved = description('saved'), review = description('review');
  saved.hasChanges = false; review.hasChanges = false;
  saved.translations.German = ['Deutsch', 'Zwei']; review.translations.German = ['Deutsch', 'Zwei'];
  review.translations.Thai = ['', ''];
  e.descs = [saved, review];
  const localSaved = plain(saved), localReview = plain(review);
  delete localSaved.translations.German; delete localReview.translations.German;
  localSaved.hasChanges = true; localReview.translations.Thai = ['Thai review candidate', 'Second'];
  e.localDescs = { descs: [localSaved, localReview], status: { [review.filepath]: { needsReview: true } } };
  e.applyWorkspaceOverlay(); e.filterDesc();
  assert.equal(e.statistic.hasChanges, 1); assert.equal(e.statistic.isDropped, 1);
  e.lang = 'German'; e.applyWorkspaceOverlay();
  e.applyCollaborationFiles(e.descs.map(desc => ({ filepath: desc.filepath, translations: ['Neu', 'Zwei'],
    trackedForExport: false, needsReview: false })), 'German');
  e.filterDesc();
  assert.equal(e.statistic.hasChanges, 0); assert.equal(e.statistic.isDropped, 0);
  e.lang = 'Thai'; e.applyWorkspaceOverlay(); e.filterDesc();
  assert.equal(e.statistic.hasChanges, 1); assert.equal(e.statistic.isDropped, 1);
  assert.deepEqual(plain(saved.translations.Thai), ['เดิม {0}', 'สอง']);
  assert.deepEqual(plain(review.translations.Thai), ['', '']);
});

test('startup in German does not adopt Thai Saved or Dropped state from a stored workspace', async () => {
  const { editor: e, window } = harness();
  const source = [description('stored')];
  source[0].hasChanges = false; source[0].translations.Thai = ['', ''];
  source[0].translations.German = ['Deutsch', 'Zwei'];
  const original = plain(source);
  const local = plain(source[0]); delete local.translations.German;
  local.translations.Thai = ['แก้ไขแล้ว', 'สอง'];
  const workspace = { descs: [local], status: { [source[0].filepath]: { needsReview: true } } };
  e.lang = 'German';
  const prepared = await e.prepareStoredWorkspaceSource(source, workspace, true, () => true);
  assert.equal(prepared[0].hasChanges, false); assert.equal(prepared[0].needsReview, false);
  assert.deepEqual(plain(prepared[0].translations.German), ['Deutsch', 'Zwei']);
  assert.deepEqual(plain(source), original);
  e.lang = 'Thai';
  const thai = await e.prepareStoredWorkspaceSource(source, workspace, true, () => true);
  assert.equal(thai[0].hasChanges, false); assert.equal(thai[0].needsReview, true);
  assert.deepEqual(plain(thai[0].translations.Thai), ['', '']);
  assert.deepEqual(plain(window.WorkspaceState.droppedForFile(workspace, source[0].filepath, 'Thai').snapshot.translations), ['แก้ไขแล้ว', 'สอง']);
});

test('joining an empty German sparse room does not publish Thai saved or review metadata', async t => {
  const { editor: e } = harness({ realImport: true });
  const source = [description('saved'), description('review')];
  for (const desc of source) {
    desc.hasChanges = false; desc.needsReview = false;
    desc.translations.German = ['Deutsch', 'Zwei'];
  }
  e.descs = plain(source);
  e.localDescs = { descs: source.map((desc, index) => ({ filepath: desc.filepath,
    hasChanges: index === 0,
    translations: { English: [...desc.translations.English], Thai: [...desc.translations.Thai] } })),
    status: { [source[1].filepath]: { needsReview: true } } };
  e.applyWorkspaceOverlay();
  e.lang = 'German'; e.applyWorkspaceOverlay();
  const tree = await protocol.buildBaselineTree(source);
  const archive = await protocol.finalizeArchive({ version: 1,
    zipHash: await protocol.zipHash(new Uint8Array([1, 2, 3])), zipSize: 3,
    fileCount: source.length, descriptionCount: source.length, parserVersion: 1,
    decisions: [], treeRoot: tree.root });
  let state;
  const requests = [];
  const client = new (require('../public/collaborationSync.js').Client)({
    WebSocket: null,
    store: { async updateCollaborationState(fn, options = {}) {
      state = fn(state ? plain(state) : undefined);
      if (options.projectWorkspace) e.localDescs = options.projectWorkspace(e.localDescs, state);
      return plain(state);
    } },
    request: async (path, options = {}) => {
      requests.push({ path, options: plain(options) });
      if (path.endsWith('/archives/resolve')) return { archive };
      if (path.endsWith('/join')) return { mode: 'sparse', roomId: 'German', archive, sequence: 0, files: [] };
      if (path.includes('/changes?')) return { events: [], hasMore: false };
      if (path.endsWith('/mutations')) return { roomId: 'German', sequence: 1,
        files: options.body.files.map(file => protocol.fileState({ ...file, revision: 1 })) };
      throw new Error('Unexpected sparse endpoint: ' + path);
    },
  });
  t.after(() => client.destroy());
  await client.connect({ accountId: 'admin', game: 'poe1', language: 'German', source,
    files: e.descs.map(desc => e.collaborationFile(desc)), workspace: e.localDescs,
    archive, baselineSource: source, baselineTree: tree });
  assert.equal(requests.filter(request => request.path.endsWith('/mutations')).length, 0);
  const room = Object.values(state.rooms)[0];
  assert.deepEqual(plain(room.carries), {});
  assert.deepEqual(plain(room.outbox), []);
});

test('presence becomes away after two minutes or a hidden tab and activity restores it', () => {
  const { editor: e, document } = harness(); const states = [];
  e._collaboration = { setAway: away => states.push(away) };
  e._collabActivityAt = 1000;
  e.updateCollaborationActivity(120999); assert.equal(states.at(-1), false);
  e.updateCollaborationActivity(121000); assert.equal(states.at(-1), true);
  e.markCollaborationActivity(122000); assert.equal(states.at(-1), false);
  document.hidden = true; e.updateCollaborationActivity(122001); assert.equal(states.at(-1), true);
  e.markCollaborationActivity(122002); assert.equal(states.at(-1), true, 'Background events do not make a hidden tab active.');
  document.hidden = false; e.markCollaborationActivity(122003); assert.equal(states.at(-1), false);
});

test('switching game during getSource cannot activate the older source or clear the new load state', async () => {
  const { editor: e, window } = harness(); const oldSource = deferred(), newSource = deferred();
  window.OfflineStore.getSource = game => game === 'poe1' ? oldSource.promise : newSource.promise;
  const oldLoad = e.loadVersionedStorage(); e.gameVersion = 'poe2'; const newLoad = e.loadVersionedStorage();
  oldSource.resolve([description('old')]); await oldLoad;
  assert.equal(e.versionStorageLoading, true); assert.equal(e.sourceLoaded, false);
  newSource.resolve([description('new')]); await newLoad;
  assert.equal(e.sourceIdentity, 'hash-new.txt'); assert.equal(e.descs[0].filepath, 'source/new.txt');
  assert.equal(e.versionStorageLoading, false);
});

test('switching game while source hashing is pending keeps only the new game source', async () => {
  const { editor: e, window } = harness(); const hash = deferred();
  window.OfflineStore.getSource = async game => [description(game)];
  window.CollaborationProtocol.sourceHash = source => source[0].filename === 'poe1.txt' ? hash.promise : Promise.resolve('new-hash');
  const oldLoad = e.loadVersionedStorage(); await tick();
  e.gameVersion = 'poe2'; await e.loadVersionedStorage(); hash.resolve('old-hash'); await oldLoad;
  assert.equal(e.sourceIdentity, 'new-hash'); assert.equal(e.descs[0].filename, 'poe2.txt');
});

test('a stale rejected digest cannot replace a newer workspace status', async () => {
  const { editor: e, window } = harness(); const hash = deferred();
  window.OfflineStore.getSource = async game => [description(game)];
  window.CollaborationProtocol.sourceHash = source => source[0].filename === 'poe1.txt' ? hash.promise : Promise.resolve('new-hash');
  const oldLoad = e.loadVersionedStorage(); await tick();
  e.gameVersion = 'poe2'; await e.loadVersionedStorage(); e.collaborationNotice = 'Current workspace status';
  hash.reject(new Error('Old digest failed')); await oldLoad;
  assert.equal(e.collaborationNotice, 'Current workspace status');
});

test('same-game overlapping loads use generation order, not completion order', async () => {
  const { editor: e, window } = harness(); const first = deferred(); let calls = 0;
  window.OfflineStore.getSource = () => ++calls === 1 ? first.promise : Promise.resolve([description('new')]);
  const oldLoad = e.loadVersionedStorage(); await e.loadVersionedStorage();
  first.resolve([description('old')]); await oldLoad;
  assert.equal(e.sourceIdentity, 'hash-new.txt'); assert.equal(e.descs[0].filename, 'new.txt');
});

test('stored source/workspace hash mismatch preserves all database values and blocks activation', async () => {
  const { editor: e, window, writes } = harness();
  const workspace = { sourceHash: 'different-hash', descs: [description('saved')], status: { preserved: true } };
  const source = [description('source')]; const expected = plain({ workspace, source });
  window.OfflineStore.getWorkspace = async () => workspace;
  window.OfflineStore.getSource = async () => source;
  await e.loadVersionedStorage();
  assert.equal(e.sourceLoaded, false); assert.equal(e.sourceIdentity, ''); assert.equal(e.versionStorageLoading, false);
  assert.match(e.cloudStorageError, /different version hashes/); assert.equal(writes.length, 0);
  assert.deepEqual(plain({ workspace, source }), expected);
});

test('batched startup preserves review candidates separately without modifying the immutable baseline', async () => {
  const { editor: e, window } = harness();
  const source = [description('source')]; source[0].translations.Thai = ['', ''];
  const original = plain(source);
  const saved = description('source'); saved.translations.Thai = ['แก้ไขแล้ว', 'สอง'];
  const workspace = { descs: [saved], status: { [saved.filepath]: { needsReview: true } } };
  const prepared = await e.prepareStoredWorkspaceSource(source, workspace, true, () => true);
  assert.deepEqual(plain(source), original);
  assert.deepEqual(plain(prepared[0].translations.Thai), ['', '']);
  assert.deepEqual(plain(window.WorkspaceState.droppedForFile(workspace, saved.filepath, 'Thai').snapshot.translations), saved.translations.Thai);
  assert.equal(prepared[0].needsReview, true);
  prepared[0].translations.English[0] = 'Editor mutation';
  assert.deepEqual(plain(source), original);
});

test('startup preparation yields and cancels without publishing a partial workspace', async () => {
  const { editor: e, context } = harness();
  let clock = 0, active = true, yields = 0;
  context.Date = { now: () => clock += 8 };
  e.yieldEditorWork = async () => { yields++; active = false; };
  const existing = e.descs;
  const result = await e.prepareStoredWorkspaceSource([description('first'), description('second')], null, true, () => active);
  assert.equal(result, null); assert.equal(yields, 1); assert.equal(e.descs, existing);
});

test('preferences arriving during startup preparation activate only the final language overlay', async () => {
  const { editor: e, window, context } = harness();
  const source = [description('first'), description('second')];
  const saved = plain(source);
  for (const desc of saved) desc.translations.German = ['Deutsch', 'Zwei'];
  window.OfflineStore.getSource = async () => source;
  window.OfflineStore.getWorkspace = async () => ({ descs: saved, status: {} });
  let clock = 0;
  context.Date = { now: () => clock += 8 };
  e.yieldEditorWork = async () => { e.lang = 'German'; };
  await e.loadVersionedStorage();
  assert.equal(e.sourceLoaded, true);
  for (const desc of e.descs) assert.deepEqual(plain(desc.translations.German), ['Deutsch', 'Zwei']);
  assert.deepEqual(plain(e.browserWorkItems), {});
});

test('a stale failed storage read cannot report an error in the new game workspace', async () => {
  const { editor: e, window } = harness(); const read = deferred();
  window.OfflineStore.getSource = game => game === 'poe1' ? read.promise : Promise.resolve([description('new')]);
  const oldLoad = e.loadVersionedStorage(); e.gameVersion = 'poe2'; await e.loadVersionedStorage();
  e.cloudStorageError = ''; read.reject(new Error('Old read failed')); await oldLoad;
  assert.equal(e.cloudStorageError, ''); assert.equal(e.sourceIdentity, 'hash-new.txt');
});

test('source import rejects account, language, game, client, or workspace switches during digest', async t => {
  for (const [name, change] of Object.entries({
    account: e => { e.cloudUser = { id: 'account-two' }; },
    language: e => { e.lang = 'German'; },
    game: e => { e.gameVersion = 'poe2'; },
    client: e => { e._collaboration = { disconnect() {} }; },
    workspace: e => { e.localDescs = { descs: [], status: {}, sourceHash: 'different-source' }; },
    source: e => { e.descs = [description('different-source')]; },
  })) await t.test(name, async () => {
    const { editor: e, window, writes } = harness(); const hash = deferred();
    window.CollaborationProtocol.sourceHash = () => hash.promise;
    const importing = e.importUpdateZipFile({ name: 'StatDescriptions.zip', size: 1, lastModified: 1 }, [description('imported')]);
    change(e); const workspace = e.localDescs, source = e.descs;
    hash.resolve('imported-hash'); await importing;
    assert.equal(writes.length, 0); assert.equal(e.localDescs, workspace); assert.equal(e.descs, source);
    assert.match(e.collaborationNotice, /workspace changed while importing/i);
  });
});

test('source import cannot activate into a different account after its durable commit awaits', async () => {
  const { editor: e, window } = harness(); const commit = deferred();
  window.OfflineStore.saveSourceWorkspaceWithRevisions = () => commit.promise;
  const importing = e.importUpdateZipFile({ name: 'StatDescriptions.zip', size: 1, lastModified: 1 }, [description('imported')]);
  await tick();
  e.cloudUser = { id: 'account-two' }; e.localDescs = { descs: [description('second-account')], status: {}, sourceHash: 'second-account-hash' };
  e.descs = [description('second-account')]; e.sourceIdentity = 'second-account-hash';
  const workspace = e.localDescs, source = e.descs;
  commit.resolve(); await importing;
  assert.equal(e.localDescs, workspace); assert.equal(e.descs, source); assert.equal(e.sourceIdentity, 'second-account-hash');
});

test('source ZIP repairs before hashing and commits the same identity as a corrected ZIP', async () => {
  const { editor: e, window, alerts } = harness({ realImport: true });
  const commit = deferred(), saveStarted = deferred(); let stored;
  const workspace = e.localDescs, source = e.descs;
  window.CollaborationProtocol.sourceHash = async parsed => {
    assert.deepEqual(plain(parsed[0].translations.English), ['Ignite spreads faster\\n']);
    assert.deepEqual(plain(parsed[0].importRepairs), [{ filepath: repairedPath, lang: 'English', line: 4, endLine: 5, kind: 'quoted-line-break' }]);
    return protocol.sourceHash(parsed);
  };
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async (...args) => {
    stored = plain(args); saveStarted.resolve(); await commit.promise;
  };
  const importing = e.importUpdateZipFile(zipFixture(importText()));
  await saveStarted.promise;
  assert.equal(e.localDescs, workspace); assert.equal(e.descs, source); assert.equal(e.sourceIdentity, 'old-hash');
  assert.deepEqual(alerts, [], 'Repair success is not announced before durable storage completes.');
  assert.deepEqual(stored[0][0].translations.English, ['Ignite spreads faster\\n']);
  assert.equal(stored[1].sourceHash, await protocol.sourceHash(stored[0]));
  assert.equal(stored[2][0].sourceHash, stored[1].sourceHash);
  commit.resolve(); await importing;
  assert.equal(e.sourceIdentity, stored[1].sourceHash);
  assert.equal(e.localDescs.sourceHash, e.sourceIdentity);
  assert.equal(alerts.length, 1); assert.match(alerts[0], /Source import completed/);
  assert.match(alerts[0], /Automatically repaired 1 quoted entry/);
  assert.ok(alerts[0].includes(repairedPath + ':4-5 (English)'));

  const corrected = harness({ realImport: true });
  await corrected.editor.importUpdateZipFile(zipFixture(importText({ broken: false })));
  assert.equal(corrected.editor.sourceIdentity, e.sourceIdentity, 'Equivalent corrected source joins the same collaboration workspace.');
  assert.deepEqual(corrected.alerts, []);
});

test('failed repair import storage preserves the old source and does not announce a successful repair', async () => {
  const { editor: e, window, alerts } = harness({ realImport: true });
  const workspace = e.localDescs, source = e.descs, before = plain({ workspace, source });
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async () => { throw new Error('Storage unavailable'); };
  await e.importUpdateZipFile(zipFixture(importText()));
  assert.equal(e.localDescs, workspace); assert.equal(e.descs, source); assert.equal(e.sourceIdentity, 'old-hash');
  assert.deepEqual(plain({ workspace, source }), before);
  assert.equal(alerts.length, 1); assert.match(alerts[0], /Could not save the imported source.*Existing work is unchanged/);
  assert.doesNotMatch(alerts[0], /Automatically repaired|completed/);
});

test('another malformed file still aborts the whole source ZIP without saving its repaired entries', async () => {
  const { editor: e, writes, alerts } = harness({ realImport: true });
  const workspace = e.localDescs, source = e.descs;
  const invalid = 'description\n1 different_stat\n1\n# "Unclosed text\nlang "Thai"\n1\n# "translation"\n';
  await e.importUpdateZipFile(zipFixture(importText(), { extra: { 'stat_descriptions/invalid.txt': invalid } }));
  assert.equal(e.localDescs, workspace); assert.equal(e.descs, source); assert.equal(e.sourceIdentity, 'old-hash');
  assert.equal(writes.length, 0); assert.equal(alerts.length, 1);
  assert.match(alerts[0], /Import aborted.*invalid\.txt:4: Invalid quoted translation entry/);
  assert.doesNotMatch(alerts[0], /Automatically repaired/);
});

test('Import Translated repairs canonical English before matching and retains the source identity', async () => {
  const { editor: e, window, alerts } = harness({ realImport: true });
  await e.importUpdateZipFile(zipFixture(importText({ broken: false })));
  const hash = e.sourceIdentity, workspace = e.localDescs;
  const commit = deferred(), saveStarted = deferred(); let stored;
  window.OfflineStore.saveWorkspaceWithRevisions = async (...args) => {
    stored = plain(args); saveStarted.resolve(); await commit.promise;
  };
  const importing = e.importTranslatedZipFile(zipFixture(importText({ translated: 'ไฟลุกลามเร็วขึ้น' }), { translated: true }));
  await saveStarted.promise;
  assert.equal(e.localDescs, workspace); assert.deepEqual(alerts, []);
  assert.equal(stored[0].sourceHash, hash); assert.equal(stored[1][0].sourceHash, hash);
  commit.resolve(); await importing;
  assert.equal(e.sourceIdentity, hash); assert.equal(e.localDescs.sourceHash, hash);
  assert.deepEqual(plain(e.descs[0].translations.English), ['Ignite spreads faster\\n']);
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['ไฟลุกลามเร็วขึ้น']);
  assert.match(e.collaborationNotice, /Imported 1 translated files/);
  assert.equal(alerts.length, 1); assert.match(alerts[0], /Automatically repaired 1 quoted entry/);
});

test('failed translated repair persistence leaves translations unchanged and reports no successful repair', async () => {
  const { editor: e, window, alerts } = harness({ realImport: true });
  await e.importUpdateZipFile(zipFixture(importText({ broken: false })));
  const workspace = e.localDescs, before = plain(e.descs), hash = e.sourceIdentity;
  window.OfflineStore.saveWorkspaceWithRevisions = async () => { throw new Error('Storage unavailable'); };
  await e.importTranslatedZipFile(zipFixture(importText({ translated: 'ไฟลุกลามเร็วขึ้น' }), { translated: true }));
  assert.equal(e.localDescs, workspace); assert.deepEqual(plain(e.descs), before); assert.equal(e.sourceIdentity, hash);
  assert.equal(alerts.length, 1); assert.match(alerts[0], /Could not save imported translations.*Existing work is unchanged/);
  assert.doesNotMatch(alerts[0], /Automatically repaired/);
});

test('translated repair with no translation changes explains the repair without rewriting storage', async () => {
  const { editor: e, writes, alerts } = harness({ realImport: true });
  await e.importUpdateZipFile(zipFixture(importText({ broken: false })));
  const hash = e.sourceIdentity, writeCount = writes.length;
  await e.importTranslatedZipFile(zipFixture(importText(), { translated: true }));
  assert.equal(writes.length, writeCount); assert.equal(e.sourceIdentity, hash);
  assert.equal(alerts.length, 1); assert.match(alerts[0], /No translation changes detected/);
  assert.match(alerts[0], /Automatically repaired 1 quoted entry/);
});

test('shared-history fetch cannot publish into a switched account, source, or client', async t => {
  for (const [name, change] of Object.entries({
    account: e => { e.cloudUser = { id: 'other' }; },
    source: e => { e.sourceIdentity = 'new-source'; },
    client: e => { e._collaboration = { name: 'other-client' }; },
  })) await t.test(name, async () => {
    const { editor: e } = harness(); const fetched = deferred(); let publishes = 0;
    const filepath = e.descs[0].filepath;
    e._collaboration = { historyEntry: () => fetched.promise, fileBase: () => ({ filepath, revision: 4, translations: ['current', 'text'] }) };
    e.persistTranslationBatch = async () => { publishes++; return { status: 'synced' }; };
    const restoring = e.collabRestoreHistory(1, 'after', 4);
    change(e);
    fetched.resolve({ filepath, after: { filepath, translations: ['old', 'text'], needsReview: false } });
    await restoring.catch(error => assert.match(error.message, /changed|workspace|account|source/i));
    assert.equal(publishes, 0);
  });
});

test('conflict resolution blocks invalid translation diagnostics before queuing a save', async () => {
  const { editor: e } = harness(); let saves = 0; const filepath = e.descs[0].filepath;
  e._collaboration = { snapshot: () => ({ conflicts: [{ id: 'conflict', filepath, yours: { translations: ['mine', 'two'] } }] }),
    resolve: async () => { saves++; return { status: 'synced' }; } };
  e.analyzeTranslationDiagnostics = () => ({ diagnostics: [{ level: 'error', message: 'Missing variable {0}' }] });
  await assert.rejects(e.collabResolve('conflict', ['invalid', 'two']), /Missing variable/);
  assert.equal(saves, 0);
});

test('declining conflict warning confirmation preserves the pending comparison', async () => {
  const { editor: e, approve, confirmations } = harness(); approve(false); let saves = 0; const filepath = e.descs[0].filepath;
  e._collaboration = { snapshot: () => ({ conflicts: [{ id: 'conflict', filepath }] }), resolve: async () => { saves++; } };
  e.analyzeTranslationDiagnostics = () => ({ diagnostics: [{ level: 'warning', message: 'Empty translation' }] });
  assert.equal((await e.collabResolve('conflict', ['', ''])).status, 'conflict');
  assert.equal(confirmations.length, 1); assert.equal(saves, 0);
});

test('editing override cannot force a stale client after its dialog is accepted', async () => {
  const { editor: e } = harness(); const answer = deferred(); let forced = 0;
  const filepath = e.descs[0].filepath;
  e._collaboration = { claim: async (file, options) => {
    assert.equal(file, filepath);
    if (options.force) { forced++; return { granted: true }; }
    return { granted: false, peers: [{ name: 'Another translator' }] };
  } };
  e.appConfirm = () => answer.promise;
  const claiming = e.claimCollaborationFile(filepath);
  await tick(); e._collaboration = { claim: () => assert.fail('A new client must not receive the stale override') };
  answer.resolve(true);
  assert.equal(await claiming, false); assert.equal(forced, 0);
});

test('editing override cannot force a request that became stale during its dialog', async () => {
  const { editor: e } = harness(); const answer = deferred(); let forced = 0, current = true;
  e._collaboration = { leaveEdit() {}, claim: async (file, options) => {
    if (options.force) { forced++; return { granted: true }; }
    return { granted: false, peers: [] };
  } };
  e.appConfirm = () => answer.promise;
  const claiming = e.claimCollaborationFile(e.descs[0].filepath, false, () => current);
  await tick(); current = false; answer.resolve(true);
  assert.equal(await claiming, false); assert.equal(forced, 0);
});

test('conflict warnings cannot authorize resolution after the workspace changes', async () => {
  const { editor: e } = harness(); const answer = deferred(); let saves = 0;
  const filepath = e.descs[0].filepath;
  e._collaboration = { snapshot: () => ({ conflicts: [{ id: 'conflict', filepath }] }), resolve: async () => { saves++; } };
  e.analyzeTranslationDiagnostics = () => ({ diagnostics: [{ level: 'warning', message: 'Empty translation' }] });
  e.appConfirm = () => answer.promise;
  const resolution = e.collabResolve('conflict', ['', '']);
  await tick(); e.gameVersion = 'poe2'; e.sourceIdentity = 'new-source'; answer.resolve(true);
  const result = await resolution;
  assert.equal(saves, 0); assert.ok(result.stale || result.status === 'conflict');
});

test('small source archive waits for typed confirmation before parsing or writing', async () => {
  const { editor: e, writes } = harness({ realImport: true }); const answer = deferred();
  let prompts = 0, reads = 0;
  const file = zipFixture(importText({ broken: false }));
  const entry = file.files[repairedPath], read = entry.async;
  entry.async = (...args) => { reads++; return read(...args); };
  e.confirmProceedByTypingYes = () => { prompts++; return answer.promise; };
  const importing = e.importUpdateZipFile(file);
  await tick(); assert.equal(prompts, 1); assert.equal(writes.length, 0); assert.equal(reads, 0);
  answer.resolve(false); await importing;
  assert.equal(writes.length, 0); assert.equal(reads, 0); assert.equal(e.sourceIdentity, 'old-hash');
});

test('a full source archive in translated-import mode waits for YES before reading entries', async () => {
  const { editor: e, writes } = harness({ realImport: true }); const answer = deferred();
  let reads = 0, prompts = 0;
  const file = zipFixture(importText({ broken: false, translated: 'ใหม่' }), { translated: true });
  const entry = file.files[repairedPath], read = entry.async;
  entry.async = (...args) => { reads++; return read(...args); };
  e.countZipTxtFiles = () => 5000;
  e.confirmProceedByTypingYes = () => { prompts++; return answer.promise; };
  const importing = e.importTranslatedZipFile(file);
  await tick(); assert.equal(prompts, 1); assert.equal(reads, 0); assert.equal(writes.length, 0);
  answer.resolve(false); await importing;
  assert.equal(reads, 0); assert.equal(writes.length, 0);
});

test('translated archive with an unexpected filename waits for confirmation and can be cancelled', async () => {
  const { editor: e, writes } = harness({ realImport: true }); const answer = deferred();
  const file = zipFixture(importText({ broken: false, translated: 'ใหม่' }), { translated: true });
  file.name = 'Unexpected.zip'; e.appConfirm = () => answer.promise;
  const importing = e.importTranslatedZipFile(file);
  await tick(); assert.equal(writes.length, 0);
  answer.resolve(false); await importing; assert.equal(writes.length, 0);
});

test('conflict resolution cannot remove a table column even when its text has no variables', async () => {
  const { editor: e } = harness(); let saves = 0;
  e.descs[0].translations.English = ['Left@Right', 'Second'];
  const filepath = e.descs[0].filepath;
  e._collaboration = { snapshot: () => ({ conflicts: [{ id: 'conflict', filepath }] }), resolve: async () => { saves++; return { status: 'synced' }; } };
  await assert.rejects(e.collabResolve('conflict', ['Left only', 'Second']), /table|column/i);
  assert.equal(saves, 0);
});

test('archive import stores the immutable upstream baseline with dropped work kept separately', async () => {
  const { editor: e, writes, window } = harness({ realImport: true });
  const old = description('old', ['Old upstream source']);
  old.filepath = repairedPath; old.translations.Thai = ['recovered translation'];
  e.descs = [old]; e.localDescs = { sourceHash: 'old-hash', descs: plain(e.descs), status: {} };
  const file = zipFixture(importText({ broken: false }), { archive: true, extra: { 'metadata.json': '{}' } });
  await e.importUpdateZipFile(file);
  assert.equal(writes.length, 1);
  const [source, workspace, revisions, game, baseline] = writes[0];
  const archive = workspace.importArchive;
  assert.equal(archive.zipHash, crypto.createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'));
  assert.equal(archive.zipSize, file.size); assert.equal(archive.fileCount, 2); assert.equal(archive.descriptionCount, 1);
  assert.equal(archive.parserVersion, 1); assert.equal(game, 'poe1');
  assert.equal(archive.baselineId, workspace.sourceHash); assert.equal(e.sourceIdentity, archive.baselineId);
  assert.equal(baseline.archive.baselineId, archive.baselineId);
  assert.deepEqual(source[0].translations.Thai, ['']);
  assert.deepEqual(baseline.source[0].translations.Thai, ['']);
  assert.deepEqual(baseline.rawSource[0].translations.Thai, ['']);
  assert.deepEqual(workspace.descs[0].translations.Thai, ['']);
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['']);
  assert.deepEqual(plain(window.WorkspaceState.droppedForFile(workspace, old.filepath, 'Thai').snapshot.translations), ['recovered translation']);
  assert.equal(e.descs[0].needsReview, true); assert.equal(e.descs[0].hasChanges, false);
  assert.ok(revisions.length > 0); assert.ok(revisions.every(item => item.sourceHash === archive.baselineId));
  assert.ok(revisions.every(item => item.lang === 'English'));
  e.descs[0].translations.Thai[0] = 'later working edit';
  assert.deepEqual(plain(e.importBaseline.source[0].translations.Thai), ['']);
  assert.equal(e.importBaseline.archive.baselineId, archive.baselineId);
});

test('importing a changed source preserves dropped saved work separately for both Thai and German', async () => {
  const { editor: e, writes, window } = harness({ realImport: true });
  const old = description('old', ['Old upstream source']);
  old.filepath = repairedPath;
  old.translations.Thai = ['Thai carried translation'];
  old.translations.German = ['German saved translation'];
  const local = plain(old);
  local.statusLanguage = 'Thai';
  local.languageStatus = {
    Thai: { hasChanges: true, isMissing: false },
    German: { hasChanges: true, isMissing: false },
  };
  e.descs = [old];
  e.localDescs = { sourceHash: 'old-hash', descs: [local], status: {
    [repairedPath]: { statusLanguage: 'Thai', needsReview: false, languageStatus: {
      Thai: { needsReview: false }, German: { needsReview: false },
    } },
  } };
  const text = importText({ broken: false }) + 'lang "German"\n1\n# ""\n';
  await e.importUpdateZipFile(zipFixture(text, { archive: true }));
  assert.equal(writes.length, 1);
  e.filterDesc();
  assert.equal(e.statistic.hasChanges, 0); assert.equal(e.statistic.isDropped, 1);
  e.lang = 'German'; e.applyWorkspaceOverlay(); e.filterDesc();
  assert.equal(e.statistic.hasChanges, 0); assert.equal(e.statistic.isDropped, 1);
  assert.equal(e.statistic.isMissing, 1);
  assert.deepEqual(plain(e.descs[0].translations.German), ['']);
  assert.deepEqual(plain(window.WorkspaceState.droppedForFile(e.localDescs, repairedPath, 'German').snapshot.translations), ['German saved translation']);
  e.lang = 'Thai'; e.applyWorkspaceOverlay(); e.filterDesc();
  assert.equal(e.statistic.hasChanges, 0); assert.equal(e.statistic.isDropped, 1);
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['']);
  assert.deepEqual(plain(window.WorkspaceState.droppedForFile(writes[0][1], repairedPath, 'Thai').snapshot.translations), ['Thai carried translation']);
  assert.equal(writes[0][1].staged.German[repairedPath], undefined);
});

test('source upgrades retain a dropped Thai snapshot separately from current translations across reload', async () => {
  const { editor: e, writes, window } = harness({ realImport: true });
  const previous = description('old', ['Original English']);
  previous.filepath = repairedPath; previous.variables = ['#']; previous.remarks = [''];
  previous.translations.Thai = ['Original Thai translation']; previous.translations.German = [''];
  previous.hasChanges = false; previous.needsReview = false;
  e.descs = [previous];
  e.localDescs = { sourceHash: 'old-hash', descs: [], status: {} };
  window.WorkspaceState.initializeWorkspace(e.localDescs, {
    source: [previous], sourceHash: 'old-hash', game: 'poe1', language: 'Thai',
  });
  const upstream = english => 'description\n1 ignite_delay\n1\n# "' + english
    + '"\nlang "Thai"\n1\n# ""\nlang "German"\n1\n# ""\n';
  await e.importUpdateZipFile(zipFixture(upstream('Changed English'), { archive: true }));
  assert.equal(writes.length, 1);
  const first = window.WorkspaceState.droppedForFile(e.localDescs, repairedPath, 'Thai');
  assert.ok(first, 'The old complete translation remains available for an explicit review.');
  assert.deepEqual(plain(first.snapshot.english), ['Original English']);
  assert.deepEqual(plain(first.snapshot.translations), ['Original Thai translation']);
  assert.equal(first.originSourceHash, 'old-hash');
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['']);
  e.filterDesc();
  assert.equal(e.statistic.hasChanges, 0); assert.equal(e.statistic.isMissing, 1);
  assert.equal(e.statistic.isDropped, 1);
  assert.equal(window.WorkspaceState.droppedForFile(e.localDescs, repairedPath, 'German'), null);
  e.lang = 'German'; e.applyWorkspaceOverlay(); e.filterDesc();
  assert.equal(e.statistic.hasChanges, 0); assert.equal(e.statistic.isDropped, 0);
  e.lang = 'Thai'; e.applyWorkspaceOverlay();
  await e.importUpdateZipFile(zipFixture(upstream('Newest English'), { archive: true }));
  assert.equal(writes.length, 2);
  const second = window.WorkspaceState.droppedForFile(e.localDescs, repairedPath, 'Thai');
  assert.deepEqual(plain(second.snapshot), plain(first.snapshot));
  assert.equal(second.originSourceHash, first.originSourceHash);
  assert.equal(second.targetSourceHash, e.sourceIdentity);
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['']);

  const [source, workspace, , , baseline] = writes[1];
  const loaded = harness({ realImport: true });
  loaded.window.OfflineStore.getSource = async () => plain(source);
  loaded.window.OfflineStore.getWorkspace = async () => plain(workspace);
  loaded.window.OfflineStore.getImportedBaseline = async () => plain(baseline);
  await loaded.editor.loadVersionedStorage();
  assert.equal(loaded.editor.sourceLoaded, true);
  const restored = loaded.window.WorkspaceState.droppedForFile(loaded.editor.localDescs, repairedPath, 'Thai');
  assert.deepEqual(plain(restored.snapshot), plain(first.snapshot));
  assert.deepEqual(plain(loaded.editor.descs[0].translations.Thai), ['']);
  assert.equal(loaded.editor.descs[0].hasChanges, false);
  assert.equal(loaded.editor.descs[0].needsReview, true);
});

test('a source upgrade drops the last saved translation instead of the older ZIP translation', async () => {
  const { editor: e, writes, window } = harness({ realImport: true });
  const previous = description('old', ['Original English']);
  previous.filepath = repairedPath; previous.variables = ['#']; previous.remarks = [''];
  previous.translations.Thai = ['Translation from the original ZIP']; previous.hasChanges = false;
  e.descs = [plain(previous)]; e._workspaceSourceBaseline = [plain(previous)];
  e.localDescs = { sourceHash: 'old-hash', descs: [], status: {} };
  window.WorkspaceState.initializeWorkspace(e.localDescs, {
    source: [previous], sourceHash: 'old-hash', game: 'poe1', language: 'Thai',
  });
  window.WorkspaceState.stageTranslation(e.localDescs, { filepath: repairedPath,
    translations: ['Last saved translation'] }, 'Thai', { source: [previous], sourceHash: 'old-hash', game: 'poe1' });
  e.applyWorkspaceOverlay();
  const text = 'description\n1 ignite_delay\n1\n# "Changed English"\nlang "Thai"\n1\n# ""\n';
  await e.importUpdateZipFile(zipFixture(text, { archive: true }));
  assert.equal(writes.length, 1);
  const candidate = window.WorkspaceState.droppedForFile(e.localDescs, repairedPath, 'Thai');
  assert.ok(candidate);
  assert.deepEqual(plain(candidate.snapshot.translations), ['Last saved translation']);
  assert.deepEqual(plain(candidate.snapshot.english), ['Original English']);
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['']);
  assert.equal(e.descs[0].hasChanges, false); assert.equal(e.descs[0].needsReview, true);
});

test('archive reload reuses persisted identity and proof cache while retaining separate dropped candidates', async () => {
  const imported = harness({ realImport: true });
  await imported.editor.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true }));
  const [source, workspace, , , baseline] = imported.writes[0];
  imported.window.WorkspaceState.dropTranslation(workspace, source[0], 'Thai', {
    game: 'poe1', translations: ['local recovery candidate'], originSourceHash: workspace.sourceHash,
    targetSourceHash: workspace.sourceHash,
  });
  const loaded = harness({ realImport: true }); const e = loaded.editor;
  loaded.window.OfflineStore.getSource = async () => plain(source);
  loaded.window.OfflineStore.getWorkspace = async () => plain(workspace);
  loaded.window.OfflineStore.getImportedBaseline = async (id, game) => {
    assert.equal(id, workspace.importArchive.baselineId); assert.equal(game, 'poe1'); return plain(baseline);
  };
  for (const name of ['zipHash', 'sourceHash', 'buildBaselineTree']) {
    loaded.window.CollaborationProtocol[name] = () => assert.fail('Cached baseline must avoid recomputing ' + name);
  }
  await e.loadVersionedStorage();
  assert.equal(e.sourceLoaded, true); assert.equal(e.sourceIdentity, workspace.importArchive.baselineId);
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['']);
  assert.deepEqual(plain(loaded.window.WorkspaceState.droppedForFile(e.localDescs, repairedPath, 'Thai').snapshot.translations), ['local recovery candidate']);
  assert.equal(e.descs[0].needsReview, true); assert.equal(e.descs[0].hasChanges, false);
  assert.deepEqual(plain(e.importBaseline.source[0].translations.Thai), ['']);
  assert.deepEqual(plain(e.importBaseline.tree), baseline.tree);
  assert.equal(loaded.writes.length, 0);
});

test('identical parsed exports with different ZIP bytes retain separate archive identities', async () => {
  const first = harness({ realImport: true }), second = harness({ realImport: true });
  await first.editor.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true, envelope: 'original compression' }));
  await second.editor.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true, envelope: 'repacked compression' }));
  const a = first.editor.importBaseline, b = second.editor.importBaseline;
  assert.equal(a.tree.root, b.tree.root); assert.notEqual(a.archive.zipHash, b.archive.zipHash);
  assert.notEqual(first.editor.sourceIdentity, second.editor.sourceIdentity);
});

test('archive duplicate selections include occurrence and source metadata in shared configuration', async () => {
  const { editor: e, writes } = harness({ realImport: true });
  const text = 'description\n1 stat\n1\n# "Original"\nlang "English"\n1\n1 "Second source" canonical_rule\nlang "Thai"\n1\n# "Translation"\n';
  await e.importUpdateZipFile(zipFixture(text, { archive: true }));
  assert.equal(writes.length, 0); assert.equal(e.duplicateLangImportWarning.groups.length, 1);
  const group = e.duplicateLangImportWarning.groups[0], chosen = group.options[1];
  group.selectedOptionId = chosen.id;
  await e.confirmDuplicateLangImportResolution();
  assert.equal(writes.length, 1);
  const baseline = e.importBaseline, [decision] = baseline.archive.decisions;
  assert.equal(decision.filepath, repairedPath); assert.equal(decision.language, 'English'); assert.equal(decision.occurrence, 2);
  assert.equal(decision.blockHash, await protocol.blockHash(chosen));
  assert.deepEqual(plain(baseline.source[0].translations.English), ['Second source']);
  assert.deepEqual(plain(baseline.source[0].variables), ['1']);
  assert.deepEqual(plain(baseline.source[0].remarks), ['canonical_rule']);
  assert.deepEqual(plain(baseline.rawSource[0].duplicateLangGroups[0].options.map(option => option.content)), [['Original'], ['Second source']]);
});

test('archive duplicate confirmation cannot import into a changed workspace or language', async t => {
  for (const [name, change] of Object.entries({
    account: e => { e.cloudUser = { id: 'other' }; }, language: e => { e.lang = 'German'; },
    game: e => { e.gameVersion = 'poe2'; },
    workspace: e => { e.localDescs = { descs: [], status: {}, sourceHash: 'new-hash' }; },
  })) await t.test(name, async () => {
    const { editor: e, writes } = harness({ realImport: true });
    const text = importText({ broken: false }) + 'lang "Thai"\n1\n# "Second choice"\n';
    await e.importUpdateZipFile(zipFixture(text, { archive: true }));
    const group = e.duplicateLangImportWarning.groups[0]; group.selectedOptionId = group.options[1].id;
    change(e); const workspace = e.localDescs, source = e.descs;
    await e.confirmDuplicateLangImportResolution();
    assert.equal(writes.length, 0); assert.equal(e.localDescs, workspace); assert.equal(e.descs, source);
  });
});

test('a stale raw ZIP digest cannot commit an archive into a switched account', async () => {
  const { editor: e, window, writes } = harness({ realImport: true });
  const digest = deferred(); window.CollaborationProtocol.zipHash = () => digest.promise;
  const file = zipFixture(importText({ broken: false }), { archive: true });
  const importing = e.importUpdateZipFile(file); await tick();
  e.cloudUser = { id: 'new-account' }; const workspace = e.localDescs, source = e.descs;
  digest.resolve('a'.repeat(64)); await importing;
  assert.equal(writes.length, 0); assert.equal(e.localDescs, workspace); assert.equal(e.descs, source);
  assert.equal(e.sourceIdentity, 'old-hash');
});

function duplicateDescription() {
  const desc = description('duplicate', ['Original']);
  desc.hasChanges = false;
  desc.variables = ['#']; desc.remarks = ['']; desc.translations.Thai = ['First original']; desc.translations.French = ['French original'];
  desc.duplicateLangGroups = [{ filepath: desc.filepath, lang: 'Thai', options: [
    { id: 'Thai', lang: 'Thai', occurrence: 1, line: 5, content: ['First original'], variables: ['#'], remarks: [''] },
    { id: 'Thai-2', lang: 'Thai', occurrence: 2, line: 8, content: ['Second original'], variables: ['#'], remarks: [''] },
  ] }];
  return desc;
}
async function duplicateBaselines(editor) {
  const raw = [duplicateDescription()], identity = { zipHash: 'c'.repeat(64), zipSize: 100, fileCount: 1 };
  const decisions = await Promise.all(raw[0].duplicateLangGroups[0].options.map(async option => [{
    filepath: raw[0].filepath, language: 'Thai', occurrence: option.occurrence, blockHash: await protocol.blockHash(option),
  }]));
  return { first: await editor.buildImportedBaseline(identity, raw, decisions[0]),
    second: await editor.buildImportedBaseline(identity, raw, decisions[1]), raw, identity };
}

test('shared decisions reconstruct the alternate original baseline from retained raw parsing', async () => {
  const { editor: e } = harness({ realImport: true });
  const { first, second, raw } = await duplicateBaselines(e);
  const reconstructed = await e.buildImportedBaseline(first.archive, raw, [], second.archive);
  assert.deepEqual(plain(reconstructed.archive), plain(second.archive));
  assert.deepEqual(plain(reconstructed.source[0].translations.Thai), ['Second original']);
  assert.deepEqual(plain(raw[0].translations.Thai), ['First original']);
});

test('wrong duplicate fingerprints or raw archive identity abort shared baseline reconstruction', async () => {
  const { editor: e } = harness({ realImport: true });
  const { second, raw, identity } = await duplicateBaselines(e);
  const wrong = plain(second.archive); wrong.decisions[0].blockHash = 'a'.repeat(64);
  await assert.rejects(e.buildImportedBaseline(identity, raw, [], wrong), /choice does not match|baseline/);
  await assert.rejects(e.buildImportedBaseline({ ...identity, zipHash: 'd'.repeat(64) }, raw, [], second.archive), /does not reproduce/);
  await assert.rejects(e.buildImportedBaseline(identity, raw, [], { ...second.archive, parserVersion: 2 }), /different importer/);
});

test('offline configuration reconciliation preserves saved edits, candidates and other language work', async () => {
  const { editor: e, writes } = harness({ realImport: true });
  const { first, second } = await duplicateBaselines(e), filepath = first.source[0].filepath;
  e.importBaseline = first; e.sourceIdentity = first.archive.baselineId;
  e.descs = plain(first.source); e.descs[0].translations.Thai = ['reviewed local edit']; e.descs[0].hasChanges = true;
  e.localDescs = { sourceHash: e.sourceIdentity, importArchive: plain(first.archive), descs: plain(e.descs), status: { [filepath]: { needsReview: false } } };
  e.localDescs.descs[0].translations.French = ['saved French work'];
  const oldWorkspace = plain(e.localDescs);
  assert.equal(await e.reconcileImportArchive(second.archive), true);
  assert.equal(e.sourceIdentity, second.archive.baselineId); assert.equal(writes.length, 1);
  assert.deepEqual(plain(e.importBaseline.source[0].translations.Thai), ['Second original']);
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['reviewed local edit']);
  assert.equal(e.descs[0].hasChanges, true); assert.equal(e.descs[0].needsReview, false);
  assert.deepEqual(plain(e.localDescs.descs[0].translations.French), ['saved French work']);
  const recovery = plain(e.localDescs.importRecovery[0].descs);
  assert.deepEqual(recovery.map(({ languageStatus, statusLanguage, ...desc }) => desc),
    oldWorkspace.descs.map(({ hasChanges, isMissing, isRevised, isDropped, needsReview, trackedForExport, ...desc }) => desc));
  assert.equal(recovery[0].hasChanges, undefined);
  assert.deepEqual(writes[0][2], [], 'An unchanged English source does not create an invented translation revision.');
});

test('a stale canonical reconstruction cannot replace a switched local workspace', async () => {
  const { editor: e, window, writes } = harness({ realImport: true });
  const { first, second } = await duplicateBaselines(e);
  e.importBaseline = first; e.sourceIdentity = first.archive.baselineId;
  e.descs = plain(first.source); e.localDescs = { sourceHash: e.sourceIdentity, descs: plain(e.descs), status: {} };
  const tree = deferred(); window.CollaborationProtocol.buildBaselineTree = () => tree.promise;
  const reconciling = e.reconcileImportArchive(second.archive); await tick();
  e.localDescs = { descs: [], status: {}, sourceHash: 'switched-workspace' }; const workspace = e.localDescs;
  tree.resolve(second.tree); assert.equal(await reconciling, false);
  assert.equal(e.localDescs, workspace); assert.equal(writes.length, 0);
});

test('online import adopts shared duplicate choices before carry-forward without showing another choice dialog', async () => {
  const text = importText({ broken: false, translated: 'First original' }) + 'lang "Thai"\n1\n# "Shared original"\n';
  const first = harness({ realImport: true });
  await first.editor.importUpdateZipFile(zipFixture(text, { archive: true }));
  const group = first.editor.duplicateLangImportWarning.groups[0]; group.selectedOptionId = group.options[1].id;
  await first.editor.confirmDuplicateLangImportResolution();
  const accepted = plain(first.editor.importBaseline.archive);
  const second = harness({ realImport: true }); const e = second.editor;
  e.cloudSignedIn = true; e.cloudUser.language = 'Thai'; let requests = 0;
  e._cloud = { request: async route => {
    requests++; assert.equal(route, '/v1/collaboration/archives/poe1/' + accepted.zipHash); return { archive: accepted };
  } };
  await e.importUpdateZipFile(zipFixture(text, { archive: true }));
  assert.equal(requests, 1); assert.equal(e.duplicateLangImportWarning, null); assert.equal(second.writes.length, 1);
  assert.equal(e.sourceIdentity, accepted.baselineId);
  assert.deepEqual(plain(e.importBaseline.source[0].translations.Thai), ['Shared original']);
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['Shared original']);
});

test('a wrong shared ZIP descriptor leaves the existing workspace intact', async () => {
  const first = harness({ realImport: true });
  await first.editor.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true }));
  const accepted = plain(first.editor.importBaseline.archive);
  accepted.zipHash = 'e'.repeat(64); delete accepted.baselineId;
  const wrong = await protocol.finalizeArchive(accepted);
  const second = harness({ realImport: true }); const e = second.editor;
  e.cloudSignedIn = true; e.cloudUser.language = 'Thai'; e._cloud = { request: async () => ({ archive: wrong }) };
  const source = e.descs, workspace = e.localDescs;
  await e.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true }));
  assert.equal(second.writes.length, 0); assert.equal(e.descs, source); assert.equal(e.localDescs, workspace);
  assert.equal(e.sourceIdentity, 'old-hash'); assert.match(second.alerts[0], /does not reproduce/);
});

test('missing cached baseline preserves old browser data and refuses sparse collaboration activation', async () => {
  const first = harness({ realImport: true });
  await first.editor.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true }));
  const [source, workspace] = first.writes[0]; const before = plain({ source, workspace });
  const second = harness({ realImport: true }); const e = second.editor;
  second.window.OfflineStore.getSource = async () => source; second.window.OfflineStore.getWorkspace = async () => workspace;
  await e.loadVersionedStorage();
  assert.equal(e.sourceLoaded, false); assert.equal(e.sourceIdentity, ''); assert.equal(second.writes.length, 0);
  assert.deepEqual(plain({ source, workspace }), before); assert.match(e.cloudStorageError, /baseline is unavailable/);
});

test('changing English block metadata drops saved text separately even when source text stays identical', async () => {
  const { editor: e, window } = harness({ realImport: true });
  const raw = description('metadata', ['Same source']); raw.variables = ['#']; raw.remarks = [''];
  raw.translations.Thai = ['Current ZIP translation'];
  raw.duplicateLangGroups = [{ filepath: raw.filepath, lang: 'English', options: [
    { id: 'English', lang: 'English', occurrence: 1, content: ['Same source'], variables: ['#'], remarks: [''] },
    { id: 'English-2', lang: 'English', occurrence: 2, content: ['Same source'], variables: ['1'], remarks: ['new_rule'] },
  ] }];
  const identity = { zipHash: 'e'.repeat(64), zipSize: 100, fileCount: 1 };
  const decisions = await Promise.all(raw.duplicateLangGroups[0].options.map(async option => [{
    filepath: raw.filepath, language: 'English', occurrence: option.occurrence, blockHash: await protocol.blockHash(option),
  }]));
  const first = await e.buildImportedBaseline(identity, [raw], decisions[0]);
  const second = await e.buildImportedBaseline(identity, [raw], decisions[1]);
  e.importBaseline = first; e.sourceIdentity = first.archive.baselineId; e.descs = plain(first.source);
  e.descs[0].translations.Thai = ['saved local edit']; e.descs[0].hasChanges = true;
  e.localDescs = { sourceHash: e.sourceIdentity, descs: plain(e.descs), status: {} };
  assert.equal(await e.reconcileImportArchive(second.archive), true);
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['Current ZIP translation']);
  assert.deepEqual(plain(window.WorkspaceState.droppedForFile(e.localDescs, raw.filepath, 'Thai').snapshot.translations), ['saved local edit']);
  assert.deepEqual(plain(e.descs[0].variables), ['1']); assert.equal(e.descs[0].hasChanges, false); assert.equal(e.descs[0].needsReview, false);
});

test('recovering a history candidate waits for local durability and does not stage its translation', async () => {
  const { editor: e, window } = harness({ realImport: true });
  const desc = e.descs[0], lines = ['recovered {0}', 'recovered second'];
  desc.hasChanges = false; e.localDescs.descs[0].hasChanges = false;
  const original = plain(desc.translations.Thai), commit = deferred(); let batch;
  e._collaboration = {
    fileBase: () => ({ filepath: desc.filepath, translations: original, revision: 3 }),
    save: () => assert.fail('Private recovery cannot publish a collaborative save'),
    retry: () => assert.fail('Private recovery cannot trigger an outbox upload'),
  };
  window.OfflineStore.updateWorkspace = async (recover, game, options) => {
    const workspace = recover(plain(e.localDescs)); batch = plain({ workspace, game, revisions: options.revisions });
    await commit.promise; return workspace;
  };
  const context = e.captureCollaborationContext();
  const restoring = e.restoreReviewCandidate(desc, lines, context); await tick();
  assert.deepEqual(plain(desc.translations.Thai), original);
  assert.equal(batch.workspace.sourceHash, 'old-hash'); assert.equal(batch.game, 'poe1');
  assert.deepEqual(batch.workspace.staged, {});
  assert.deepEqual(batch.workspace.dropped.Thai[desc.filepath].snapshot.translations, lines);
  assert.equal(batch.revisions[0].needsReview, true); assert.deepEqual(batch.revisions[0].translations, lines);
  commit.resolve(); assert.equal((await restoring).status, 'local');
  assert.deepEqual(plain(desc.translations.Thai), original); assert.equal(desc.needsReview, false); assert.equal(desc.hasChanges, false);
  assert.deepEqual(plain(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai').snapshot.translations), lines);
  assert.equal(e._editorCollabBase.revision, 3);
});

test('failed private candidate persistence leaves the saved translation and review status unchanged', async () => {
  const { editor: e, window } = harness({ realImport: true }); const desc = e.descs[0], before = plain(e.localDescs);
  window.OfflineStore.updateWorkspace = async () => { throw new Error('Storage unavailable'); };
  await assert.rejects(e.restoreReviewCandidate(desc, ['candidate {0}', 'second']), /Storage unavailable/);
  assert.deepEqual(plain(e.localDescs), before); assert.deepEqual(plain(desc.translations.Thai), before.descs[0].translations.Thai);
  assert.equal(desc.needsReview, false);
});

test('a private review candidate cannot activate in another account after storage completes', async () => {
  const { editor: e, window } = harness({ realImport: true }); const desc = e.descs[0], before = plain(desc);
  const commit = deferred(); window.OfflineStore.updateWorkspace = () => commit.promise;
  const restoring = e.restoreReviewCandidate(desc, ['candidate {0}', 'second']);
  e.cloudUser = { id: 'other-account' }; commit.resolve({ status: 'local' });
  assert.equal((await restoring).stale, true); assert.deepEqual(plain(desc), before);
});

test('duplicate import continuation shares one ZIP digest and excludes archive directories from counts', async () => {
  const { editor: e, window } = harness({ realImport: true }); let digests = 0;
  window.CollaborationProtocol.zipHash = async () => { digests++; return 'd'.repeat(64); };
  const file = zipFixture(importText({ broken: false }), { archive: true, extra: { 'metadata.json': '{}' } });
  const zip = { files: { ...file.files, source: { dir: true }, empty: { dir: true } } };
  const a = await e.readImportZipIdentity(file, zip), b = await e.readImportZipIdentity(file);
  assert.equal(digests, 1); assert.deepEqual(plain(a), plain(b)); assert.equal(a.fileCount, 2);
  assert.equal(a.zipHash, 'd'.repeat(64)); assert.equal(a.zipSize, file.size);
});

test('connected recovery registers a separate dropped candidate without publishing a translation edit', async () => {
  const { editor: e, window } = harness({ realImport: true }); const desc = e.descs[0], commit = deferred();
  const original = plain(desc.translations.Thai), lines = ['recovered {0}', 'second recovered']; let candidate;
  window.OfflineStore.updateWorkspace = () => assert.fail('The connected client registers candidate and workspace atomically');
  e._collaboration = {
    registerDroppedCandidate: async (file, options) => {
      candidate = plain({ file, options }); await commit.promise;
      window.WorkspaceState.dropTranslation(e.localDescs, desc, 'Thai', { ...file, snapshot: file.snapshot });
      return { status: 'local' };
    },
    fileBase: () => ({ filepath: desc.filepath, translations: original, revision: 5 }),
    save: () => assert.fail('A review candidate cannot publish an edit'),
    retry: () => assert.fail('Candidate registration must not upload changes'),
  };
  const recovering = e.restoreReviewCandidate(desc, lines); await tick();
  assert.deepEqual(plain(desc.translations.Thai), original); assert.deepEqual(candidate.file.snapshot.translations, lines);
  assert.equal(candidate.file.originSourceHash, e.sourceIdentity);
  assert.equal(candidate.file.targetSourceHash, e.sourceIdentity);
  assert.deepEqual(candidate.options.revisions[0].translations, lines);
  commit.resolve(); assert.equal((await recovering).status, 'local');
  assert.deepEqual(plain(desc.translations.Thai), original);
  assert.deepEqual(plain(window.WorkspaceState.droppedForFile(e.localDescs, desc.filepath, 'Thai').snapshot.translations), lines);
  assert.equal(e._editorCollabBase.revision, 5);
});

test('a failed ZIP digest is retried for the same File while successful identity remains cached', async () => {
  const { editor: e, window } = harness({ realImport: true }); let digests = 0;
  window.CollaborationProtocol.zipHash = async () => {
    if (++digests === 1) throw new Error('Digest temporarily unavailable'); return 'a'.repeat(64);
  };
  const file = zipFixture(importText({ broken: false }), { archive: true });
  await assert.rejects(e.readImportZipIdentity(file, { files: file.files }), /temporarily unavailable/);
  const identity = await e.readImportZipIdentity(file, { files: file.files });
  assert.equal(identity.zipHash, 'a'.repeat(64)); assert.equal(identity.fileCount, 1); assert.equal(digests, 2);
  assert.deepEqual(plain(await e.readImportZipIdentity(file)), plain(identity)); assert.equal(digests, 2);
});

test('canonical baseline commit blocks an editor opening and another source import until durable activation', async () => {
  const { editor: e, window } = harness({ realImport: true });
  const { first, second } = await duplicateBaselines(e);
  e.importBaseline = first; e.sourceIdentity = first.archive.baselineId; e.descs = plain(first.source);
  e.localDescs = { sourceHash: e.sourceIdentity, descs: plain(e.descs), status: {} };
  const started = deferred(), commit = deferred(); let sourceWrites = 0;
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async () => { sourceWrites++; if (sourceWrites === 1) { started.resolve(); await commit.promise; } };
  // Keep editor rendering out of this lifecycle race; entry into the editor is
  // what must be refused while the immutable baseline transaction is pending.
  e.selectFileRow = () => {}; e.seedEditorOpenSource = request => { request.source = {}; };
  const reconciling = e.reconcileImportArchive(second.archive); await started.promise;
  const opening = e.beginEditorOpen(first.source[0].filepath), openedDuringCommit = e.editorVisible;
  await e.importUpdateZipFile({ name: 'StatDescriptions.zip', size: 1, lastModified: 1 }, [description('new-import')]);
  commit.resolve(); await reconciling;
  assert.equal(opening, null); assert.equal(openedDuringCommit, false); assert.equal(sourceWrites, 1);
  assert.equal(e.sourceIdentity, second.archive.baselineId); assert.equal(e.editorVisible, false);
});

test('canonical baseline transaction cannot be overwritten by a translation save started during its commit', async () => {
  const { editor: e, window } = harness({ realImport: true });
  const { first, second } = await duplicateBaselines(e);
  e.importBaseline = first; e.sourceIdentity = first.archive.baselineId; e.descs = plain(first.source);
  e.localDescs = { sourceHash: e.sourceIdentity, descs: plain(e.descs), status: {} };
  const started = deferred(), commit = deferred(); let translationWrites = 0;
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async () => { started.resolve(); await commit.promise; };
  window.OfflineStore.saveWorkspaceWithRevisions = async () => { translationWrites++; };
  const reconciling = e.reconcileImportArchive(second.archive); await started.promise;
  await e.persistTranslationBatch([{ desc: e.descs[0], lines: ['new racing translation'], needsReview: false }], 'restore');
  commit.resolve(); await reconciling;
  assert.equal(translationWrites, 0); assert.equal(e.sourceIdentity, second.archive.baselineId);
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['Second original']);
});

test('a language change during durable reconciliation reloads the accepted baseline after releasing its lock', async () => {
  const { editor: e, window } = harness({ realImport: true }); const { first, second } = await duplicateBaselines(e);
  e.importBaseline = first; e.sourceIdentity = first.archive.baselineId; e.descs = plain(first.source);
  e.localDescs = { sourceHash: e.sourceIdentity, descs: plain(e.descs), status: {} };
  const started = deferred(), commit = deferred(); let stored, reloads = 0;
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async (...args) => { started.resolve(); await commit.promise; stored = plain(args); };
  window.OfflineStore.getWorkspace = async () => stored?.[1]; window.OfflineStore.getSource = async () => stored?.[0];
  window.OfflineStore.getImportedBaseline = async () => stored?.[4];
  const load = e.loadVersionedStorage;
  e.loadVersionedStorage = async () => {
    assert.equal(!!e._reconcilingImport, false, 'Reload starts only after the transition lock releases'); reloads++;
    return load.call(e);
  };
  const reconciling = e.reconcileImportArchive(second.archive); await started.promise;
  e.lang = 'German'; commit.resolve(); await reconciling; await tick(); await tick();
  assert.ok(reloads > 0); assert.equal(e.lang, 'German'); assert.equal(e.sourceIdentity, second.archive.baselineId);
  assert.equal(e.importBaseline.archive.baselineId, second.archive.baselineId); assert.equal(!!e._reconcilingImport, false);
  assert.deepEqual(plain(e.importBaseline.source[0].translations.Thai), ['Second original']);
});

test('changing game waits for baseline reconciliation durability before loading another workspace', async () => {
  const { editor: e, window } = harness({ realImport: true }); const { first, second } = await duplicateBaselines(e);
  e.importBaseline = first; e.sourceIdentity = first.archive.baselineId; e.descs = plain(first.source);
  e.localDescs = { sourceHash: e.sourceIdentity, descs: plain(e.descs), status: {} };
  const started = deferred(), commit = deferred();
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async () => { started.resolve(); await commit.promise; };
  const reconciling = e.reconcileImportArchive(second.archive); await started.promise;
  const activating = e.activateGameVersion('poe2', { checkMigration: false }); await tick();
  const gameDuringCommit = e.gameVersion;
  commit.resolve(); await reconciling; await activating;
  assert.equal(gameDuringCommit, 'poe1'); assert.equal(e.gameVersion, 'poe2'); assert.equal(e.sourceLoaded, false);
  assert.equal(!!e._reconcilingImport, false);
});

test('failed canonical persistence releases its transition lock and keeps the previous baseline available', async () => {
  const { editor: e, window } = harness({ realImport: true }); const { first, second } = await duplicateBaselines(e);
  e.importBaseline = first; e.sourceIdentity = first.archive.baselineId; e.descs = plain(first.source);
  e.localDescs = { sourceHash: e.sourceIdentity, descs: plain(e.descs), status: {} };
  const before = plain(e.localDescs);
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async () => { throw new Error('Baseline storage unavailable'); };
  await assert.rejects(e.reconcileImportArchive(second.archive), /Baseline storage unavailable/);
  assert.equal(!!e._reconcilingImport, false); assert.equal(e.sourceIdentity, first.archive.baselineId);
  assert.deepEqual(plain(e.localDescs), before); assert.equal(e.importBaseline, first);
});

test('an earlier source import cannot resume its digest into an active canonical baseline commit', async () => {
  const { editor: e, window } = harness({ realImport: true }); const { first, second } = await duplicateBaselines(e);
  e.importBaseline = first; e.sourceIdentity = first.archive.baselineId; e.descs = plain(first.source);
  e.localDescs = { sourceHash: e.sourceIdentity, descs: plain(e.descs), status: {} };
  const hash = deferred(), started = deferred(), commit = deferred(); let sourceWrites = 0;
  window.CollaborationProtocol.sourceHash = () => hash.promise;
  e.buildImportedBaseline = async identity => identity ? second : null;
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async (source, workspace) => {
    sourceWrites++;
    if (workspace.sourceHash === second.archive.baselineId) { started.resolve(); await commit.promise; }
  };
  const importing = e.importUpdateZipFile({ name: 'StatDescriptions.zip', size: 1, lastModified: 1 }, [description('new-import')]);
  await tick();
  const reconciling = e.reconcileImportArchive(second.archive);
  const phase = await Promise.race([started.promise.then(() => 'committing'), reconciling.then(() => 'deferred')]);
  hash.resolve('new-import-hash'); await importing; commit.resolve(); await reconciling;
  assert.equal(sourceWrites, 1);
  assert.equal(e.sourceIdentity, phase === 'committing' ? second.archive.baselineId : 'new-import-hash');
});

test('an already running bulk translation write finishes before canonical baseline replacement', async () => {
  const { editor: e, window } = harness({ realImport: true }); const { first, second } = await duplicateBaselines(e);
  e.importBaseline = first; e.sourceIdentity = first.archive.baselineId; e.descs = plain(first.source);
  e.localDescs = { sourceHash: e.sourceIdentity, descs: plain(e.descs), status: {} };
  const started = deferred(), commit = deferred(); let baselineWrites = 0;
  e.buildImportedBaseline = async () => second;
  window.OfflineStore.saveWorkspaceWithRevisions = async () => { started.resolve(); await commit.promise; };
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async () => { baselineWrites++; };
  const saving = e.persistTranslationBatch([{ desc: e.descs[0], lines: ['imported local edit'], needsReview: false }], 'import');
  await started.promise;
  const reconciling = e.reconcileImportArchive(second.archive); await tick();
  const writesWhileSaving = baselineWrites;
  commit.resolve(); await saving; await reconciling;
  assert.equal(writesWhileSaving, 0);
  assert.deepEqual(plain(e.descs[0].translations.Thai), ['imported local edit']);
  assert.deepEqual(plain(e.localDescs.descs[0].translations.Thai), ['imported local edit']);
});

test('a failed raw ZIP digest restores settled import progress while preserving the previous workspace', async () => {
  const { editor: e, window, writes, alerts } = harness({ realImport: true });
  const workspace = e.localDescs, source = e.descs;
  window.CollaborationProtocol.zipHash = async () => { throw new Error('Digest temporarily unavailable'); };
  await e.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true }));
  assert.equal(e.loadingProgress, 100); assert.equal(e.importBaselineHashing, false);
  assert.equal(e.localDescs, workspace); assert.equal(e.descs, source); assert.equal(e.sourceIdentity, 'old-hash');
  assert.equal(writes.length, 0); assert.match(alerts[0], /Import aborted.*temporarily unavailable/);
});

function prepareSourceImportCollaboration(editor, window, join = async () => {}) {
  const activity = { clients: 0, joins: 0, syncs: 0, disconnects: 0 };
  editor.offlineStoreReady = true;
  editor.cloudSignedIn = true; editor.cloudCanAccessAllLanguages = true;
  editor.cloudUser = { id: 'manager', role: 'manager', language: null, assignmentVersion: 1 };
  editor._cloud = { apiBase: 'http://api.test', context: () => ({}), request: async () => undefined };
  window.CollaborationSync = { Client: class {
    constructor() { activity.clients++; }
    connect(input) { activity.joins++; return join(input); }
    sync() { activity.syncs++; }
    disconnect() { activity.disconnects++; }
    room() { return null; }
    select() {} setAway() {}
  } };
  return activity;
}

test('source import survives an old join 404 throughout parsing and archive preparation', async t => {
  for (const stage of ['parse', 'zipHash', 'archiveLookup', 'baselineTree']) await t.test(stage, async () => {
    const { editor: e, window, writes, alerts } = harness({ realImport: true });
    const oldJoin = deferred(), entered = deferred(), release = deferred();
    const activity = prepareSourceImportCollaboration(e, window, () => oldJoin.promise);
    let joinError;
    const joining = e.initializeCollaboration().catch(error => { joinError = error; });
    assert.equal(activity.joins, 1);
    const file = zipFixture(importText({ broken: false }), { archive: true });
    if (stage === 'parse') {
      const entry = file.files[repairedPath], read = entry.async;
      entry.async = async (...args) => { entered.resolve(); await release.promise; return read(...args); };
    } else if (stage === 'archiveLookup') {
      const lookup = e.lookupImportArchive;
      e.lookupImportArchive = async (...args) => { entered.resolve(); await release.promise; return lookup.apply(e, args); };
    } else {
      const method = stage === 'zipHash' ? 'zipHash' : 'buildBaselineTree';
      window.CollaborationProtocol[method] = async (...args) => { entered.resolve(); await release.promise; return protocol[method](...args); };
    }
    const previousSource = e.descs, previousWorkspace = e.localDescs;
    const importing = e.importUpdateZipFile(file);
    await entered.promise;
    const locked = !!e._importingSource, detached = e._collaboration === null;
    oldJoin.reject(Object.assign(new Error('Collaboration join returned 404'), { status: 404 }));
    await joining;
    await e.initializeCollaboration(); await e.collabRetry();
    const joinsDuringImport = activity.joins, clientsDuringImport = activity.clients, syncsDuringImport = activity.syncs;
    const writesDuringImport = writes.length;
    release.resolve(); await importing;
    assert.equal(joinError, undefined, 'A discarded room failure does not report an error in the active import.');
    assert.doesNotMatch(e.collaborationNotice, /join returned 404/i);
    assert.equal(locked, true, 'Source import owns its entire parsing and hashing lifetime.');
    assert.equal(detached, true, 'The previous room is detached before asynchronous import preparation.');
    assert.equal(joinsDuringImport, 1); assert.equal(clientsDuringImport, 1); assert.equal(syncsDuringImport, 0);
    assert.equal(writesDuringImport, 0);
    assert.equal(writes.length, 1); assert.equal(e.loadingProgress, 100); assert.equal(e.importBaselineHashing, false);
    assert.equal(!!e._importingSource, false); assert.notEqual(e.descs, previousSource); assert.notEqual(e.localDescs, previousWorkspace);
    assert.equal(e.sourceIdentity, e.importBaseline.archive.baselineId); assert.deepEqual(alerts, []);
  });
});

test('raw source ZIP preparation aborts real workspace changes with settled progress', async t => {
  for (const [name, change] of Object.entries({
    account: e => { e.cloudUser = { ...e.cloudUser, id: 'other-account' }; },
    language: e => { e.lang = 'German'; },
    game: e => { e.gameVersion = 'poe2'; },
    workspace: e => { e.localDescs = { descs: [], status: {}, sourceHash: 'other-source' }; },
    source: e => { e.descs = [description('other-source')]; },
  })) await t.test(name, async () => {
    const { editor: e, window, writes } = harness({ realImport: true });
    const entered = deferred(), digest = deferred();
    window.CollaborationProtocol.zipHash = () => { entered.resolve(); return digest.promise; };
    const importing = e.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true }));
    await entered.promise;
    change(e); const source = e.descs, workspace = e.localDescs, sourceIdentity = e.sourceIdentity;
    digest.resolve('a'.repeat(64)); await importing;
    assert.equal(writes.length, 0); assert.equal(e.descs, source); assert.equal(e.localDescs, workspace);
    assert.equal(e.sourceIdentity, sourceIdentity); assert.equal(e.loadingProgress, 100);
    assert.equal(e.importBaselineHashing, false); assert.equal(!!e._importingSource, false);
  });
});

test('source archive storage failure releases import ownership and permits a later import', async () => {
  const { editor: e, window, writes, alerts } = harness({ realImport: true });
  const source = e.descs, workspace = e.localDescs, original = plain({ source, workspace });
  const save = window.OfflineStore.saveSourceWorkspaceWithRevisions;
  window.OfflineStore.saveSourceWorkspaceWithRevisions = async () => { throw new Error('Storage quota exceeded'); };
  await e.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true }));
  assert.equal(e.descs, source); assert.equal(e.localDescs, workspace); assert.deepEqual(plain({ source, workspace }), original);
  assert.equal(e.sourceIdentity, 'old-hash'); assert.equal(e.loadingProgress, 100); assert.equal(e.importBaselineHashing, false);
  assert.equal(!!e._importingSource, false); assert.equal(writes.length, 0);
  assert.match(alerts[0], /Could not save the imported source.*Storage quota exceeded/);
  window.OfflineStore.saveSourceWorkspaceWithRevisions = save;
  await e.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true }));
  assert.equal(writes.length, 1); assert.equal(e.loadingProgress, 100); assert.equal(!!e._importingSource, false);
  assert.notEqual(e.sourceIdentity, 'old-hash');
});

test('source import drains local saves before disconnecting and prevents a waiting join from restarting', async () => {
  const { editor: e, window, writes } = harness({ realImport: true });
  const activity = prepareSourceImportCollaboration(e, window);
  await e.initializeCollaboration();
  const saves = deferred(), hashing = deferred(), digest = deferred(); let pending = true;
  e._pendingSaves = { snapshot: () => ({ jobs: pending ? [{ id: 'durable-save' }] : [] }) };
  e.waitForPendingSaves = () => saves.promise;
  window.CollaborationProtocol.zipHash = async file => { hashing.resolve(); await digest.promise; return protocol.zipHash(file); };
  const joining = e.initializeCollaboration();
  const importing = e.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true }));
  const disconnectsBeforeDurability = activity.disconnects;
  await e.collabRetry();
  pending = false; saves.resolve(true);
  await joining; await hashing.promise;
  const joinsDuringImport = activity.joins, syncsDuringImport = activity.syncs;
  digest.resolve(); await importing;
  assert.equal(disconnectsBeforeDurability, 0, 'The client needed by pending local saves remains available until they finish.');
  assert.equal(joinsDuringImport, 1, 'A join awaiting the same save queue rechecks import ownership when it resumes.');
  assert.equal(syncsDuringImport, 0); assert.equal(activity.disconnects, 1);
  assert.equal(writes.length, 1); assert.equal(e.loadingProgress, 100); assert.equal(!!e._importingSource, false);
  await e.initializeCollaboration(); assert.equal(activity.joins, 2);
});

test('source import cannot switch scope while awaiting pending local saves', async t => {
  for (const [name, change] of Object.entries({
    account: e => { e.cloudUser = { ...e.cloudUser, id: 'other-account' }; },
    language: e => { e.lang = 'German'; },
    game: e => { e.gameVersion = 'poe2'; },
    workspace: e => { e.localDescs = { descs: [], status: {}, sourceHash: 'other-source' }; },
    source: e => { e.descs = [description('other-source')]; },
  })) await t.test(name, async () => {
    const { editor: e, writes } = harness({ realImport: true }); const saves = deferred(); let pending = true;
    e._pendingSaves = { snapshot: () => ({ jobs: pending ? [{ id: 'durable-save' }] : [] }) };
    e.waitForPendingSaves = () => saves.promise;
    const importing = e.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true }));
    change(e); const source = e.descs, workspace = e.localDescs, sourceIdentity = e.sourceIdentity;
    pending = false; saves.resolve(true); await importing;
    assert.equal(writes.length, 0); assert.equal(e.descs, source); assert.equal(e.localDescs, workspace);
    assert.equal(e.sourceIdentity, sourceIdentity); assert.equal(e.loadingProgress, 100); assert.equal(!!e._importingSource, false);
  });
});

test('a collaboration teardown during pending local saves does not cancel the source import', async () => {
  const { editor: e, writes } = harness({ realImport: true }); const saves = deferred(); let pending = true;
  e._collaboration = { disconnect() {} };
  e._pendingSaves = { snapshot: () => ({ jobs: pending ? [{ id: 'durable-save' }] : [] }) };
  e.waitForPendingSaves = () => saves.promise;
  const importing = e.importUpdateZipFile(zipFixture(importText({ broken: false }), { archive: true }));
  e._collaboration = null; pending = false; saves.resolve(true); await importing;
  assert.equal(writes.length, 1); assert.equal(e.loadingProgress, 100); assert.equal(!!e._importingSource, false);
});

test('confirming the detected game version imports into its newly loaded workspace', async () => {
  const { editor: e, writes, confirmations } = harness({ realImport: true });
  const previousSource = e.descs, previousWorkspace = e.localDescs;
  const file = zipFixture(importText({ broken: false }), { archive: true, extra: {
    'stat_descriptions/specific_skill_stat_descriptions/explosive_grenade.txt': importText({ broken: false }),
  } });
  e.countZipTxtFiles = () => 5000;
  await e.importUpdateZipFile(file);
  assert.equal(confirmations.length, 1); assert.match(confirmations[0], /Switch to .* and import it there/);
  assert.equal(writes.length, 1); assert.equal(writes[0][3], 'poe2'); assert.equal(e.gameVersion, 'poe2');
  assert.notEqual(e.descs, previousSource); assert.notEqual(e.localDescs, previousWorkspace);
  assert.equal(e.sourceLoaded, true); assert.equal(e.loadingProgress, 100); assert.equal(!!e._importingSource, false);
  assert.equal(e.sourceIdentity, e.importBaseline.archive.baselineId);
});

test('source duplicate choices keep background retries paused and can resume the import', async () => {
  const { editor: e, window, writes } = harness({ realImport: true });
  const activity = prepareSourceImportCollaboration(e, window);
  await e.initializeCollaboration(); assert.equal(activity.joins, 1);
  const text = importText({ broken: false }) + 'lang "Thai"\n1\n# "Second choice"\n';
  await e.importUpdateZipFile(zipFixture(text, { archive: true }));
  assert.equal(e.pendingDuplicateLangImport.mode, 'update'); assert.equal(e.loadingProgress, 100);
  assert.equal(!!e._importingSource, false); assert.equal(writes.length, 0);
  await e.initializeCollaboration(); await e.collabRetry();
  assert.equal(activity.joins, 1); assert.equal(activity.clients, 1); assert.equal(activity.syncs, 0);
  const group = e.duplicateLangImportWarning.groups[0]; group.selectedOptionId = group.options[1].id;
  await e.confirmDuplicateLangImportResolution();
  assert.equal(writes.length, 1); assert.equal(e.pendingDuplicateLangImport, null); assert.equal(e.duplicateLangImportWarning, null);
  assert.equal(e.loadingProgress, 100); assert.equal(!!e._importingSource, false);
  assert.deepEqual(plain(e.importBaseline.source[0].translations.Thai), ['Second choice']);
  await e.initializeCollaboration();
  assert.equal(activity.joins, 2, 'Background collaboration can start for the committed source.');
});

test('cancelling source duplicate choices resumes collaboration without writing the archive', async () => {
  const { editor: e, window, writes } = harness({ realImport: true });
  const activity = prepareSourceImportCollaboration(e, window);
  await e.initializeCollaboration();
  const text = importText({ broken: false }) + 'lang "Thai"\n1\n# "Second choice"\n';
  await e.importUpdateZipFile(zipFixture(text, { archive: true }));
  await e.collabRetry(); assert.equal(activity.joins, 1);
  e.closeDuplicateLangImportWarning(); await e.initializeCollaboration();
  assert.equal(activity.joins, 2); assert.equal(writes.length, 0); assert.equal(e.sourceIdentity, 'old-hash');
  assert.equal(e.pendingDuplicateLangImport, null); assert.equal(e.loadingProgress, 100); assert.equal(!!e._importingSource, false);
});

test('stale source import failures preserve a newer workspace load and remain quiet', async t => {
  for (const stage of ['parse', 'archiveLookup', 'baselineTree']) await t.test(stage, async () => {
    const { editor: e, window, writes, alerts } = harness({ realImport: true });
    const entered = deferred(), failure = deferred(), newerSource = deferred();
    const file = zipFixture(importText({ broken: false }), { archive: true });
    if (stage === 'parse') {
      file.files[repairedPath].async = () => { entered.resolve(); return failure.promise; };
    } else if (stage === 'archiveLookup') {
      e.lookupImportArchive = () => { entered.resolve(); return failure.promise; };
    } else {
      window.CollaborationProtocol.buildBaselineTree = () => { entered.resolve(); return failure.promise; };
    }
    const importing = e.importUpdateZipFile(file); await entered.promise;
    window.OfflineStore.getSource = game => game === 'poe2' ? newerSource.promise : Promise.resolve(undefined);
    e.gameVersion = 'poe2'; const loading = e.loadVersionedStorage();
    const source = e.descs, workspace = e.localDescs;
    assert.equal(e.versionStorageLoading, true); assert.equal(e.loadingProgress, 0.001);
    failure.reject(new Error('Old import preparation failed')); await importing;
    assert.equal(e.loadingProgress, 0.001, 'The newer workspace retains its active load state.');
    assert.equal(e.versionStorageLoading, true); assert.equal(e.descs, source); assert.equal(e.localDescs, workspace);
    assert.equal(writes.length, 0); assert.deepEqual(alerts, []); assert.equal(!!e._importingSource, false);
    newerSource.resolve([description('newer')]); await loading;
    assert.equal(e.versionStorageLoading, false); assert.equal(e.loadingProgress, 100); assert.equal(e.descs[0].filename, 'newer.txt');
  });
});

test('a translated import waiting for local saves yields to a source import before reading or writing', async () => {
  const { editor: e, writes } = harness({ realImport: true });
  const saves = deferred(), sourceRead = deferred(), sourceRelease = deferred(); let pending = true, translatedReads = 0;
  e._pendingSaves = { snapshot: () => ({ jobs: pending ? [{ id: 'durable-save' }] : [] }) };
  e.waitForPendingSaves = () => saves.promise;
  const translated = zipFixture(importText({ broken: false, translated: 'racing transfer' }), { translated: true });
  const translatedEntry = translated.files[repairedPath], readTranslated = translatedEntry.async;
  translatedEntry.async = (...args) => { translatedReads++; return readTranslated(...args); };
  const translating = e.importTranslatedZipFile(translated);
  const source = zipFixture(importText({ broken: false }), { archive: true });
  const sourceEntry = source.files[repairedPath], readSource = sourceEntry.async;
  sourceEntry.async = async (...args) => { sourceRead.resolve(); await sourceRelease.promise; return readSource(...args); };
  const importing = e.importUpdateZipFile(source);
  pending = false; saves.resolve(true); await translating; await sourceRead.promise;
  const readsDuringSourceImport = translatedReads, writesDuringSourceImport = writes.length;
  sourceRelease.resolve(); await importing;
  assert.equal(readsDuringSourceImport, 0); assert.equal(writesDuringSourceImport, 0);
  assert.equal(writes.length, 1); assert.equal(e.loadingProgress, 100); assert.equal(!!e._importingSource, false);
});
