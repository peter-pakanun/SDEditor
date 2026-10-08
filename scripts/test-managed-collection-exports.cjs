const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const JSZip = require('jszip');
const Protocol = require('../public/collaborationProtocol.js');
const Codec = require('../public/statDescCodec.js');
const Exports = require('../public/managedCollectionExports.js');
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture() {
  const text = 'description example\r\n\t1 example_stat\r\n\t2\r\n\t\t1 "First English" remark\r\n\t\t2 "Second English"\r\n'
    + '\tlang "Thai"\r\n\t2\r\n\t\t1 "First original" remark\r\n\t\t2 "Second original"\r\n'
    + '\tlang "Thai"\r\n\t2\r\n\t\t1 "Accepted first" remark\r\n\t\t2 "Accepted second"\r\n'
    + '\tlang "German"\r\n\t2\r\n\t\t1 "Erstes Original" remark\r\n\t\t2 "Zweites Original"\r\n';
  const other = text.replace('description example', 'description other').replace('example_stat', 'other_stat');
  const zip = new JSZip();
  zip.file('source/b.txt', new Uint8Array(Codec.strEncodeUTF16(other).buffer));
  zip.file('source/a.txt', new Uint8Array(Codec.strEncodeUTF16(text).buffer));
  zip.file('notice.txt', 'No description here');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const rawSource = [Codec.parseText('source/a.txt', text, 'Thai', { strict: true }), Codec.parseText('source/b.txt', other, 'Thai', { strict: true })];
  const groups = Codec.collectDuplicateLangGroups(rawSource);
  const decisions = await Promise.all(groups.map(async group => ({ filepath: group.filepath, language: group.lang,
    occurrence: 2, blockHash: await Codec.blockHash(group.options[1]) })));
  const source = await Codec.applyDuplicateSelections(rawSource, decisions, { language: 'Thai' });
  const tree = await Protocol.buildBaselineTree(source);
  const archive = await Protocol.finalizeArchive({ version: 1, zipHash: await Protocol.zipHash(bytes), zipSize: bytes.byteLength,
    fileCount: 3, descriptionCount: 2, parserVersion: 1, decisions, treeRoot: tree.root });
  const version = { id: 'weekly-1', game: 'poe2', branchId: 'default', sourceHash: archive.baselineId, zipHash: archive.zipHash,
    name: 'Weekly export', archive, revision: 1, status: 'published' };
  const collection = { id: 'frozen-1', versionId: version.id, language: 'Thai', sequence: 2,
    format: 'manifest', status: 'ready', fileCount: 1, downloadReady: true };
  const manifest = { formatVersion: 1, versionId: version.id, game: version.game, branchId: version.branchId,
    sourceHash: version.sourceHash, zipHash: version.zipHash, archive, language: 'Thai', sequence: 2,
    parserVersion: 1, encoderVersion: 1, downloadName: 'Weekly_export_Translated_Thai.zip',
    files: [{ filepath: 'source/a.txt', revision: 2, translations: ['Frozen saved', ''] }] };
  const response = { version, collection, manifest };
  const expected = { collectionId: collection.id, versionId: version.id, game: version.game, branchId: version.branchId,
    sourceHash: version.sourceHash, zipHash: version.zipHash, language: 'Thai' };
  return { bytes, baseline: { archive, source }, response, expected, version, collection };
}

test('client ZIP reproduces the server codec bytes from frozen Saved files and canonical duplicate choices', async () => {
  const data = await fixture();
  const manifest = await Exports.validateManifest(data.response, data.expected);
  const source = await Exports.parseOriginal(data.bytes, manifest.archive, manifest.language, JSZip);
  // Later shared text, local drafts, Dropped text and pending uploads never enter the frozen input.
  data.response.manifest.files[0].translations = ['Later save', 'Later save'];
  data.baseline.source[0].translations.Thai = ['Local draft', 'Dropped or pending'];
  const bytes = await Exports.generate(manifest, source, JSZip, { type: 'uint8array' });
  const zip = await JSZip.loadAsync(bytes);
  assert.deepEqual(Object.keys(zip.files), ['source/a.txt'], 'Nested filepaths must not create directory entries with current timestamps');
  const desc = Codec.parseText('source/a.txt', Codec.decodeUTF16(await zip.file('source/a.txt').async('uint8array')), 'Thai', { strict: true });
  assert.deepEqual(desc.translations.Thai, ['Frozen saved', '']);
  assert.deepEqual(desc.translations.German, ['Erstes Original', 'Zweites Original']);
  assert.deepEqual(desc.translations.English, ['First English', 'Second English']);
  assert.deepEqual(desc.variables, ['1', '2']); assert.deepEqual(desc.remarks, ['remark', '']);
  const apiRoot = process.env.SDEDITOR_FIXTURE_API_ROOT || path.resolve(__dirname, '../../SDEditor-API');
  const { exportCollection } = await import(pathToFileURL(path.join(apiRoot, 'src/version-codec.js')).href);
  const expected = await exportCollection({ files: manifest.files.map(file => ({ ...file, trackedForExport: true })) }, source, 'Thai');
  assert.deepEqual(Object.keys((await JSZip.loadAsync(expected)).files), ['source/a.txt']);
  assert.deepEqual(Buffer.from(bytes), expected);
  assert.deepEqual(bytes, await Exports.generate(manifest, source, JSZip, { type: 'uint8array' }));
});

test('cached immutable baseline is verified and a draft-contaminated cache cannot be used', async () => {
  const data = await fixture(), archive = data.baseline.archive;
  assert.equal((await Exports.cachedBaseline(data.baseline, archive)).length, 2);
  data.baseline.source[0].translations.Thai[0] = 'Unsaved draft';
  await assert.rejects(Exports.cachedBaseline(data.baseline, archive), /does not reproduce/);
  const different = copy(data.baseline); different.archive.zipSize++;
  assert.equal(await Exports.cachedBaseline(different, archive), null);
});

test('wrong ZIP, parser choices, tree, team and frozen file metadata are rejected', async () => {
  const data = await fixture();
  const wrongBytes = data.bytes.slice(); wrongBytes[0] ^= 1;
  await assert.rejects(Exports.parseOriginal(wrongBytes, data.baseline.archive, 'Thai', JSZip), /does not match/);
  const wrongDecision = copy(data.baseline.archive); wrongDecision.decisions[0].occurrence = 1;
  delete wrongDecision.configHash; delete wrongDecision.baselineId;
  const wrongArchive = await Protocol.finalizeArchive(wrongDecision);
  await assert.rejects(Exports.parseOriginal(data.bytes, wrongArchive, 'Thai', JSZip), /duplicate language choice/);
  for (const mutate of [
    response => { response.manifest.language = 'German'; },
    response => { response.manifest.game = 'poe1'; },
    response => { response.manifest.archive.treeRoot = 'f'.repeat(64); },
    response => { response.manifest.encoderVersion = 2; },
    response => { response.manifest.files[0].filepath = '../escape.txt'; },
    response => { response.manifest.files[0].revision = 0; },
    response => { response.collection.sequence++; },
  ]) {
    const response = copy(data.response); mutate(response);
    await assert.rejects(Exports.validateManifest(response, data.expected));
  }
  const manifest = await Exports.validateManifest(data.response, data.expected);
  manifest.files[0].filepath = 'absent.txt';
  await assert.rejects(Exports.generate(manifest, data.baseline.source, JSZip), /absent from its original/);
});

test('a context change during original ZIP reading or ZIP generation rejects before output', async () => {
  const data = await fixture(), gate = deferred(); let current = true;
  const pending = Exports.parseOriginal({ arrayBuffer: () => gate.promise }, data.baseline.archive, 'Thai', JSZip, { current: () => current });
  current = false; gate.resolve(data.bytes); await assert.rejects(pending, error => error.stale === true);
  current = true;
  const manifest = await Exports.validateManifest(data.response, data.expected);
  await assert.rejects(Exports.generate(manifest, data.baseline.source, JSZip, { type: 'uint8array', current: () => current,
    progress() { current = false; } }), error => error.stale === true);
});

function appHarness(data, { cache = data.baseline, request, JSZipOverride, storage = {} } = {}) {
  const writes = [], downloads = [], requests = [];
  const window = { ManagedCollectionExports: Exports, JSZip: JSZipOverride || JSZip,
    OfflineStore: { async getImportedBaseline() { return cache; }, ...storage },
    saveAs(blob, name) { downloads.push({ blob, name }); } };
  const context = vm.createContext({ window, URL, URLSearchParams, console, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(require.resolve('../public/managedVersions.js'), 'utf8'), context);
  const api = window.ManagedVersions;
  const app = { ...api.mixin.data(), cloudProfileId: 'alice', cloudSignedIn: true, cloudCanAccessAllLanguages: true,
    cloudUser: { id: 'alice', role: 'manager', language: 'Thai', assignmentVersion: 1 }, testMode: false,
    gameVersion: 'poe2', sourceIdentity: data.version.sourceHash, lang: 'Thai', importBaseline: null,
    localDescs: { drafts: ['Unsaved draft'], pending: ['Pending upload'], dropped: ['Dropped copy'] },
    async flushEditorDraft() { writes.push('draft'); }, async managedActivateWorkspace() { writes.push('activate'); },
    async saveSettings() { writes.push('settings'); }, setBrowserWork() {}, clearBrowserWork() {},
    _cloud: { async request(route, options) {
      requests.push({ route, options });
      if (request) return request(route, options);
      if (route.endsWith('/manifest')) return copy(data.response);
      if (route.endsWith('/original')) return data.bytes;
      throw new Error('Unexpected route: ' + route);
    } },
  };
  for (const [name, method] of Object.entries(api.mixin.methods)) if (!Object.hasOwn(app, name)) app[name] = method.bind(app);
  for (const [name, method] of Object.entries(api.mixin.computed)) Object.defineProperty(app, name, { get: () => method.call(app) });
  app.managedVersions = [copy(data.version)]; app.selectedManagedVersionId = data.version.id;
  return { app, downloads, writes, requests };
}

test('managed manifest download uses only immutable cache and leaves workspace, drafts and settings untouched', async () => {
  const data = await fixture(), { app, downloads, writes, requests } = appHarness(data);
  const before = copy(app.localDescs);
  assert.equal(await app.managedDownloadCollection({ language: 'Thai', latestCollection: data.collection }), true);
  assert.deepEqual(requests.map(call => call.route), ['/v1/collections/frozen-1/manifest']);
  assert.deepEqual(app.localDescs, before); assert.deepEqual(writes, []);
  assert.equal(downloads.length, 1); assert.equal(downloads[0].name, 'Weekly export_Translated_Thai.zip');
  const zip = await JSZip.loadAsync(await downloads[0].blob.arrayBuffer());
  assert.deepEqual(Object.keys(zip.files), ['source/a.txt']);
  assert.equal(zip.file('source/a.txt').date.toISOString(), '2000-01-01T00:00:00.000Z');
  assert.equal(app.managedVersionBusy, false);
});

test('cache miss builds collection from original ZIP without activating or writing a workspace', async () => {
  const data = await fixture(), { app, downloads, writes, requests } = appHarness(data, { cache: null });
  assert.equal(await app.managedDownloadCollection({ language: 'Thai', latestCollection: data.collection }), true);
  assert.deepEqual(requests.map(call => call.route), ['/v1/collections/frozen-1/manifest', '/v1/versions/weekly-1/original']);
  assert.equal(downloads.length, 1); assert.deepEqual(writes, []);
});

test('account, game, branch, source, selected language, access and selected version changes reject late managed exports', async () => {
  const data = await fixture();
  for (const mutate of [
    app => { app.cloudProfileId = 'bob'; }, app => { app.gameVersion = 'poe1'; },
    app => { app.branchId = 'release'; }, app => { app.sourceIdentity = 'e'.repeat(64); },
    app => { app.lang = 'German'; }, app => { app.cloudCanAccessAllLanguages = false; },
    app => { app.selectedManagedVersionId = 'other'; }, app => { app.cloudSignedIn = false; },
  ]) {
    const gate = deferred(), { app, downloads, writes } = appHarness(data, { request: () => gate.promise });
    const pending = app.managedDownloadCollection({ language: 'Thai', latestCollection: data.collection });
    mutate(app); gate.resolve(copy(data.response)); assert.equal(await pending, false);
    assert.equal(downloads.length, 0); assert.deepEqual(writes, []);
  }
});

test('a late client ZIP completion cannot download after source changes or release a newer spinner', async () => {
  const data = await fixture(), gate = deferred(); let entered;
  const started = new Promise(resolve => { entered = resolve; });
  class HeldZip extends JSZip {
    async generateAsync(options, progress) { entered(); await gate.promise; return super.generateAsync(options, progress); }
  }
  const { app, downloads } = appHarness(data, { JSZipOverride: HeldZip });
  const pending = app.managedDownloadCollection({ language: 'Thai', latestCollection: data.collection });
  await started; app.sourceIdentity = 'c'.repeat(64);
  app._managedOperation = {}; app.managedVersionBusy = true;
  gate.resolve(); assert.equal(await pending, false);
  assert.equal(downloads.length, 0); assert.equal(app.managedVersionBusy, true);
});

test('interrupted manifest exports keep the durable cutoff request and retry format without including local saves', async () => {
  const data = await fixture(), receipts = [], cutoffs = []; let failOriginal = true, receipt;
  const { app, downloads, writes } = appHarness(data, { cache: null, storage: {
    async getVersionCollectionRequest() { return receipt; },
    async setVersionCollectionRequest(scope, versionId, language, requestId, endWindow) {
      receipts.push({ scope: copy(scope), versionId, language, requestId, endWindow }); receipt = requestId;
    },
  }, request: async (route, options) => {
    if (route.endsWith('/downloads')) {
      cutoffs.push(copy(options.body)); return { collection: copy(data.collection) };
    }
    if (route.endsWith('/manifest')) return copy(data.response);
    if (route.endsWith('/original')) {
      if (failOriginal) throw new Error('Original download interrupted');
      return data.bytes;
    }
    throw new Error('Unexpected request: ' + route);
  } });
  // The durable receipt lives in OfflineStore; no workspace activation is needed.
  app.managedReadDetails = async () => {}; app.refreshManagedVersions = async () => {};
  // Exercise the in-memory retry key as well as the explicit immutable request.
  await app.managedCollect({ language: 'Thai', counts: { saved: 1 }, presence: [] }, false);
  assert.equal(downloads.length, 0); assert.equal(app._managedCollectionIds.size, 1);
  assert.equal(receipts.at(-1).requestId, cutoffs[0].idempotencyKey);
  // A reloaded page recovers the durable request rather than making a new cutoff.
  app._managedCollectionIds = new Map();
  assert.match(app.managedVisibleError, /Original download interrupted/);
  failOriginal = false;
  await app.managedCollect({ language: 'Thai', counts: { saved: 1 }, presence: [] }, false);
  assert.equal(cutoffs.length, 2); assert.equal(cutoffs[0].idempotencyKey, cutoffs[1].idempotencyKey);
  assert.equal(cutoffs[0].format, 'manifest'); assert.equal(cutoffs[0].endWindow, false);
  assert.equal(app._managedCollectionIds.size, 0); assert.equal(downloads.length, 1);
  assert.equal(receipts.at(-1).requestId, null);
  assert.deepEqual(writes, []); assert.equal(app.managedVisibleError, '');
});
