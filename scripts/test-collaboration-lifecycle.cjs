const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
function zipFixture(text, { translated = false, extra = {} } = {}) {
  const entries = { [repairedPath]: text, ...extra };
  const files = Object.fromEntries(Object.entries(entries).map(([name, content]) => [name, {
    name, dir: false,
    async: async format => {
      assert.equal(format, 'uint8array');
      return new Uint8Array(Buffer.from('\uFEFF' + content, 'utf16le'));
    },
  }]));
  return { name: translated ? 'StatDescriptions_Translated.zip' : 'StatDescriptions.zip', size: 100, lastModified: 123, files };
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
      saveSourceWorkspaceWithRevisions: async (...args) => { writes.push(plain(args)); },
      saveWorkspaceWithRevisions: async (...args) => { writes.push(plain(args)); },
    } };
  const context = vm.createContext({ window, URLSearchParams, console, setTimeout, clearTimeout, Blob, FileReader: FixtureFileReader,
    JSZip: class { async loadAsync(file) { return { files: file.files }; } },
    alert: () => assert.fail('Native alerts must not be used'), confirm: () => assert.fail('Native confirmations must not be used'),
    document: { activeElement: null, body: {}, querySelector: () => null },
    Vue: { nextTick(fn) { fn?.(); return Promise.resolve(); }, defineComponent(value) { config = value; return value; },
      createApp: () => ({ component() {}, directive() {}, mount() {} }) } });
  for (const file of ['helper.js', 'statDescParser.js', 'regexEngine.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'collaborationIntegration.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context, { filename: file });
  }
  vm.runInContext('offlineStoreReady = true', context);
  const mixin = window.CollaborationIntegration.mixin;
  const editor = Object.assign(mixin.data(), config.data(), mixin.methods, config.methods, {
    lang: 'Thai', gameVersion: 'poe1', sourceIdentity: 'old-hash', sourceLoaded: true,
    cloudUser: { id: 'account-one' }, dictionary: [], $refs: {}, $nextTick: fn => { fn?.(); return Promise.resolve(); },
    appAlert: async value => { alerts.push(value); },
    appConfirm: async value => { confirmations.push(value); return approved; },
    saveSettings() {}, closeHlPopup() {}, restoreFileTableFocusAfterEditor() {}, scheduleCollaboration() {},
  });
  for (const [name, getter] of Object.entries(config.computed)) Object.defineProperty(editor, name, { get: () => getter.call(editor) });
  editor.descs = [description()]; editor.localDescs = { descs: plain(editor.descs), status: {}, sourceHash: 'old-hash' };
  if (realImport) { editor.testMode = false; editor.confirmProceedByTypingYes = () => true; }
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
