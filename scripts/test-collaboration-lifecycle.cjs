const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
function description(name = 'old', english = ['Original {0}', 'Second']) {
  return { filepath: `source/${name}.txt`, filedir: 'source', filename: name + '.txt', name: '',
    stats: ['stat'], variables: ['#', '#'], remarks: ['', ''], translations: { English: english, Thai: ['เดิม {0}', 'สอง'] },
    hasChanges: true, needsReview: false };
}
function harness() {
  let config;
  const writes = [], alerts = [], confirmations = [];
  let approved = true;
  const window = { location: { search: '?testMode=1&lang=Thai' }, CloudUI: { mixin: {} },
    CollaborationProtocol: { sourceHash: async source => 'hash-' + source[0].filename },
    OfflineStore: {
      getWorkspace: async () => undefined, getSource: async () => undefined,
      saveSourceWorkspaceWithRevisions: async (...args) => { writes.push(plain(args)); },
    } };
  const context = vm.createContext({ window, URLSearchParams, console, setTimeout, clearTimeout,
    alert: value => alerts.push(value), confirm: value => { confirmations.push(value); return approved; },
    document: { activeElement: null, body: {}, querySelector: () => null },
    Vue: { nextTick(fn) { fn?.(); return Promise.resolve(); }, defineComponent(value) { config = value; return value; },
      createApp: () => ({ component() {}, directive() {}, mount() {} }) } });
  for (const file of ['helper.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'collaborationIntegration.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context, { filename: file });
  }
  vm.runInContext('offlineStoreReady = true', context);
  const mixin = window.CollaborationIntegration.mixin;
  const editor = Object.assign(mixin.data(), config.data(), mixin.methods, config.methods, {
    lang: 'Thai', gameVersion: 'poe1', sourceIdentity: 'old-hash', sourceLoaded: true,
    cloudUser: { id: 'account-one' }, dictionary: [], $refs: {}, $nextTick: fn => { fn?.(); return Promise.resolve(); },
    saveSettings() {}, closeHlPopup() {}, restoreFileTableFocusAfterEditor() {}, scheduleCollaboration() {},
  });
  for (const [name, getter] of Object.entries(config.computed)) Object.defineProperty(editor, name, { get: () => getter.call(editor) });
  editor.descs = [description()]; editor.localDescs = { descs: plain(editor.descs), status: {}, sourceHash: 'old-hash' };
  return { editor, window, document: context.document, writes, alerts, confirmations, approve(value) { approved = value; } };
}

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

test('conflict resolution cannot remove a table column even when its text has no variables', async () => {
  const { editor: e } = harness(); let saves = 0;
  e.descs[0].translations.English = ['Left@Right', 'Second'];
  const filepath = e.descs[0].filepath;
  e._collaboration = { snapshot: () => ({ conflicts: [{ id: 'conflict', filepath }] }), resolve: async () => { saves++; return { status: 'synced' }; } };
  await assert.rejects(e.collabResolve('conflict', ['Left only', 'Second']), /table|column/i);
  assert.equal(saves, 0);
});
