const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Managed = require('../public/managedVersions.js');
const WorkspaceInitialization = require('../public/workspaceInitialization.js');
const codec = require('../public/statDescCodec.js');
const JSZip = require('../../SDEditor-API/node_modules/jszip');

const hash = character => character.repeat(64);
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
function version(fields = {}) {
  return { id: 'weekly-1', game: 'poe2', branchId: 'default', sourceHash: hash('a'), zipHash: hash('b'),
    name: '2026-10-05_POE2', deadlineAt: '2026-10-11T20:00:00.000Z', status: 'published', revision: 1,
    isHead: true, createdAt: '2026-10-04T21:00:00.000Z', ...fields };
}
function team(fields = {}) {
  return { language: 'Thai', counts: { loaded: 100, missing: 30, saved: 20, revised: 10, dropped: 2 },
    ended: false, presence: [], latestCollection: null, ...fields };
}
function harness(options = {}) {
  const events = [], requests = []; let counter = 0;
  const storage = {
    setWorkspaceContext(scope) { events.push({ type: 'context', scope: copy(scope) }); },
    async listLocalVersions() { return []; },
    async getVersionCatalog() { return []; },
    async setVersionCatalog(scope, values) { events.push({ type: 'catalog', scope: copy(scope), values: copy(values) }); },
    async setVersionMetadata(scope, values) { events.push({ type: 'metadata', scope: copy(scope), values: copy(values) }); },
    async getVersionSource() { return [{ filepath: 'source/test.txt' }]; },
    async activateVersion(scope) { events.push({ type: 'activate', scope: copy(scope) }); },
    async saveSourceWorkspaceWithRevisions() { events.push({ type: 'import' }); },
    ...options.storage,
  };
  const window = { OfflineStore: storage, crypto: { randomUUID: () => 'request-' + (++counter) },
    StatDescCodec: codec, JSZip: { async loadAsync() { return { files: { source: { name: 'specific_skill_stat_descriptions/explosive_grenade.txt', dir: false } } }; } },
    addEventListener() {}, removeEventListener() {}, saveAs(blob, name) { events.push({ type: 'download', blob, name }); },
    ...options.window };
  const context = vm.createContext({ window, URL, URLSearchParams, console, TextEncoder, TextDecoder,
    setTimeout(callback) { queueMicrotask(callback); return 1; }, clearTimeout() {},
    document: { hidden: false, addEventListener() {}, removeEventListener() {}, ...options.document } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/managedVersions.js'), 'utf8'), context,
    { filename: 'managedVersions.js' });
  const api = window.ManagedVersions;
  const app = { ...api.mixin.data(), gameVersion: 'poe2', gameVersionSelected: true, offlineStoreReady: true,
    sourceIdentity: hash('a'), sourceLoaded: true, lang: 'Thai', cloudSignedIn: true, cloudProfileId: 'alice',
    cloudUser: { id: 'alice', language: 'Thai', role: 'manager', assignmentVersion: 1 }, cloudCanAccessAllLanguages: true,
    testMode: false, editorSessionActive: false, editorVisible: false, localDescs: { versionName: 'My local ZIP' },
    async flushEditorDraft() { return true; }, async waitForPendingSaves() { return true; },
    _pendingSaves: { snapshot: () => ({ jobs: [] }) },
    async loadVersionedStorage() { events.push({ type: 'load' }); },
    async appConfirm() { events.push({ type: 'confirm' }); return true; },
    setBrowserWork(group, work) { events.push({ type: 'work', group, work: copy(work) }); },
    clearBrowserWork(group) { events.push({ type: 'clearWork', group }); },
  };
  app._cloud = { apiBase: 'https://api.example.test', async request(route, requestOptions) {
    requests.push({ route, options: copy(requestOptions) });
    if (options.request) return options.request(route, requestOptions, app);
    if (route.startsWith('/v1/versions?')) return { branch: { id: 'default', headVersionId: 'weekly-1' }, versions: [version()] };
    if (route === '/v1/versions/weekly-1') return { version: version(), teams: [team()] };
    throw new Error('Unexpected request: ' + route);
  } };
  for (const [name, method] of Object.entries(api.mixin.methods)) app[name] = method.bind(app);
  for (const [name, method] of Object.entries(api.mixin.computed)) Object.defineProperty(app, name,
    { configurable: true, get: () => method.call(app) });
  app.managedVersions = [version()]; app.selectedManagedVersionId = 'weekly-1';
  app.managedVersionDetails = { version: version(), teams: [team()] };
  return { app, events, requests, storage, window };
}

function withInitialization(app) {
  Object.assign(app, WorkspaceInitialization.mixin.data());
  for (const [name, method] of Object.entries(WorkspaceInitialization.mixin.methods)) app[name] = method.bind(app);
  for (const [name, method] of Object.entries(WorkspaceInitialization.mixin.computed)) Object.defineProperty(app, name,
    { configurable: true, get: () => method.call(app) });
  app.$nextTick = async () => {};
  return app;
}

// Record which payloads the real storage module requests. The browser fixture
// separately checks IndexedDB engine behavior and rendering during held reads.
function indexedMetadataHarness(records = {}) {
  const tables = new Map(['kv', 'revisions', 'revisions_poe1', 'revisions_poe2'].map(name => [name, new Map()]));
  const rows = tables.get('kv'), operations = [], commits = [];
  for (const [key, value] of Object.entries(records)) rows.set(key, { key, value: copy(value) });
  const db = { version: 8, close() {}, objectStoreNames: { contains: name => tables.has(name) },
    transaction(names, mode) {
      names = Array.isArray(names) ? names : [names];
      let pending = 0, complete = false, scheduled = false;
      const writes = [], tx = { objectStore(name) {
        assert.ok(names.includes(name));
        const request = (method, key, run) => {
          const result = {}; pending++; operations.push({ mode, name, method, key: copy(key) });
          queueMicrotask(() => { result.result = run(); result.onsuccess?.(); pending--; finish(); });
          return result;
        };
        const match = range => [...tables.get(name)].filter(([key]) => !range || key >= range.lower && key <= range.upper);
        return {
          get: key => request('get', key, () => copy(tables.get(name).get(key))),
          getAll: range => request('getAll', range, () => match(range).map(([, row]) => copy(row))),
          getAllKeys: range => request('getAllKeys', range, () => match(range).map(([key]) => key)),
          count: key => request('count', key, () => Number(tables.get(name).has(key))),
          put(row) { assert.equal(mode, 'readwrite'); writes.push({ name, key: row.key, row: copy(row) }); return request('put', row.key, () => row.key); },
          add(row) { const key = tables.get(name).size + writes.length + 1; writes.push({ name, key, row: { ...copy(row), id: key } }); return request('add', key, () => key); },
          delete(key) { writes.push({ name, key, deleted: true }); return request('delete', key, () => undefined); },
        };
      }, abort() { complete = true; queueMicrotask(() => tx.onabort?.()); } };
      function finish() {
        if (complete || pending || scheduled) return;
        scheduled = true;
        setImmediate(() => {
          scheduled = false; if (complete || pending) return;
          complete = true;
          for (const write of writes) {
            if (write.deleted) tables.get(write.name).delete(write.key);
            else tables.get(write.name).set(write.key, write.row);
          }
          commits.push(copy(writes)); tx.oncomplete?.();
        });
      }
      finish(); return tx;
    },
  };
  const root = {}, context = vm.createContext({ window: root, setTimeout, clearTimeout,
    console: { log() {} }, IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) },
    indexedDB: { open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess?.(); }); return request; } } });
  for (const name of ['workspaceState.js', 'offlineStore.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', name), 'utf8'), context, { filename: name });
  return { store: root.OfflineStore, root, rows, operations, commits };
}
const storageScope = fields => ({ accountId: 'alice', game: 'poe2', branchId: 'default', sourceHash: hash('a'), ...fields });
const scopedStorageKey = (prefix, scope) => prefix + ':' + JSON.stringify([scope.accountId, scope.game, scope.branchId, scope.sourceHash]);
const activeStorageKey = scope => 'workspace_active_v1:' + JSON.stringify([scope.accountId, scope.game, scope.branchId]);

test('dashboard scope discovery loads metadata without hydrating, adopting, assigning or auto-selecting a workspace', async () => {
  const localReads = [], forbidden = [];
  const { app, events, requests } = harness({ storage: {
    async listLocalVersions(scope, options) { localReads.push({ scope: copy(scope), options: copy(options) }); return [{ ...scope, sourceHash: hash('a'), hasSource: true }]; },
    async adoptGuestVersion() { forbidden.push('adopt'); }, async getSource() { forbidden.push('source'); },
    async getWorkspace() { forbidden.push('workspace'); }, async getVersionMetadata() { forbidden.push('details'); },
  } });
  app.versionChooserVisible = true; app._managedWorkspaceOwner = JSON.stringify(['guest', 'poe2', 'default']);
  app.loadVersionedStorage = async () => { forbidden.push('hydrate'); };
  app.resetVersionedState = () => { app.sourceLoaded = false; app.sourceIdentity = ''; };
  app.openManagedPresence = () => { forbidden.push('presence'); };
  await app.managedScopeChanged({ deferWorkspace: true });
  assert.deepEqual(forbidden, []); assert.equal(app.selectedManagedVersionId, ''); assert.equal(app.managedVersionDetails, null);
  assert.equal(requests.length, 1); assert.match(requests[0].route, /^\/v1\/versions\?/);
  assert.equal(localReads.length, 2); assert.ok(localReads.every(read => read.options.metadataOnly));
  assert.equal(app.managedCatalogLoaded, true); assert.equal(app.managedLocalVersionsLoaded, true);
  assert.equal(app.managedCatalogLoading, false); assert.equal(app.managedDetailsLoading, false);
  assert.equal(events.some(event => event.type === 'activate' || event.type === 'import'), false);
});

test('initial catalog loading remains independent of an explicitly requested slow team detail read', async () => {
  const catalog = deferred(), details = deferred();
  const { app } = harness({ request: route => route.includes('?') ? catalog.promise : details.promise });
  app.versionChooserVisible = true; app.managedVersions = []; app.managedVersionDetails = null; app.selectedManagedVersionId = '';
  const loading = app.refreshManagedVersions();
  assert.equal(app.managedCatalogLoading, true); assert.equal(app.managedCatalogLoaded, false);
  catalog.resolve({ versions: [version()], branch: { id: 'default' } }); await loading;
  assert.equal(app.managedCatalogLoaded, true); assert.equal(app.managedCatalogLoading, false);
  const selection = app.managedReadDetails('weekly-1'); await settle();
  assert.equal(app.managedDetailsLoading, true); assert.equal(app.managedDetailsLoaded, false);
  await app.refreshManagedVersions();
  assert.equal(app.managedCatalogLoading, false); assert.equal(app.managedDetailsLoading, true);
  details.resolve({ version: version(), teams: [team()] }); await selection;
  assert.equal(app.managedDetailsLoading, false); assert.equal(app.managedDetailsLoaded, true);
});

test('duplicate initial scope changes share one pending catalog load without resetting its loading state', async () => {
  const catalog = deferred(), { app, requests } = harness({ request: () => catalog.promise });
  app.versionChooserVisible = true;
  const initial = app.managedScopeChanged({ deferWorkspace: true }); await settle();
  assert.equal(app.managedCatalogLoading, true); assert.equal(app.managedCatalogLoaded, false);
  const duplicate = app.managedScopeChanged({ deferWorkspace: true });
  assert.equal(duplicate, initial);
  assert.equal(app.managedCatalogLoading, true); assert.equal(app.managedCatalogLoaded, false);
  assert.equal(requests.length, 1);
  catalog.resolve({ versions: [], branch: {} }); await Promise.all([initial, duplicate]);
  assert.equal(app.managedCatalogLoaded, true); assert.equal(app.managedCatalogLoading, false);
});

test('an old scope loader cannot release the pending-loader guard for a newer account', async () => {
  const alice = deferred(), bob = deferred(), { app } = harness({ request: (_route, _options, current) => current.cloudProfileId === 'alice' ? alice.promise : bob.promise });
  app.versionChooserVisible = true;
  const old = app.managedScopeChanged(); await settle();
  app.cloudProfileId = 'bob';
  const newer = app.managedScopeChanged(); await settle();
  alice.resolve({ versions: [], branch: {} }); await old;
  assert.equal(app.managedCatalogLoading, true); assert.equal(app.managedScopeChanged(), newer);
  bob.resolve({ versions: [version()], branch: {} }); await newer;
  assert.equal(app.managedCatalogLoaded, true); assert.equal(app._managedScopePending, null);
});

test('cached catalog content appears immediately and a late cache cannot replace newer server metadata', async () => {
  const cache = deferred(), remote = deferred();
  const { app } = harness({ storage: { getVersionCatalog: () => cache.promise }, request: () => remote.promise });
  app.versionChooserVisible = true;
  const initial = app.managedScopeChanged(); await settle();
  assert.equal(app.managedCatalogLoading, true);
  remote.resolve({ versions: [version({ name: 'New server name' })], branch: {} }); await settle();
  cache.resolve([version({ name: 'Old cache name' })]); await initial;
  assert.equal(app.managedVersions[0].name, 'New server name');
  const next = deferred(); app._cloud.request = () => next.promise;
  const polling = app.refreshManagedVersions();
  assert.equal(app.managedCatalogLoading, false); assert.equal(app.managedVersions[0].name, 'New server name');
  next.resolve({ versions: [version({ name: 'New server name' })], branch: {} }); await polling;
});

test('explicit offline selection lazily reads scoped cached team details without loading source or workspace', async () => {
  const reads = [], saved = { version: version(), teams: [team({ ended: true }), team({ language: 'German' })] };
  const { app } = harness({ storage: {
    async getVersionMetadata(scope) { reads.push(copy(scope)); return { ...scope, details: saved }; },
    async getVersionSource() { throw new Error('Selection must not load source text.'); },
  } });
  app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'translator'; app._cloud = null;
  app.versionChooserVisible = true; app.managedVersionDetails = null;
  app.localVersions = [{ ...storageScope(), catalogVersionId: 'weekly-1', hasSource: true }];
  await app.managedReadDetails('weekly-1');
  assert.deepEqual(reads, [storageScope()]); assert.equal(app.managedVersionDetails.teams.length, 1);
  assert.equal(app.managedVersionDetails.teams[0].ended, true); assert.equal(app.managedDetailsLoaded, true);
});

test('a cached team-details payload with a mismatched source cannot become the selected version facts', async () => {
  const { app } = harness({ storage: { async getVersionMetadata() { return { details: { version: version({ sourceHash: hash('c') }), teams: [team({ ended: true })] } }; } } });
  app._cloud = null; app.managedVersionDetails = null;
  await app.managedReadDetails('weekly-1');
  assert.equal(app.managedVersionDetails, null);
});

test('old scope metadata and detail completions cannot settle a newer scope loading indicator', async () => {
  const local = deferred(), detail = deferred(), nextLocal = deferred(), nextDetail = deferred();
  const { app, storage } = harness({ storage: { listLocalVersions: () => local.promise }, request: () => detail.promise });
  app.versionChooserVisible = true; app.managedVersionDetails = null;
  const oldLocal = app.managedLoadLocal(), oldDetail = app.managedReadDetails('weekly-1');
  app.cloudProfileId = 'bob';
  app.managedLocalVersionsLoaded = false; app.managedDetailsLoaded = false;
  app._cloud.request = () => nextDetail.promise;
  storage.listLocalVersions = () => nextLocal.promise;
  const newLocal = app.managedLoadLocal();
  const newDetail = app.managedReadDetails('weekly-1');
  local.resolve([]); detail.resolve({ version: version(), teams: [team()] }); await oldLocal; await oldDetail;
  assert.equal(app.managedLocalVersionsLoading, true);
  assert.equal(app.managedDetailsLoading, true);
  nextLocal.resolve([]); await newLocal;
  assert.equal(app.managedLocalVersionsLoading, false);
  nextDetail.resolve({ version: version(), teams: [team()] }); await newDetail;
  assert.equal(app.managedDetailsLoading, false);
});

test('metadata-only local listing never reads stored source, workspace or full cached detail payloads', async () => {
  const scope = storageScope(), other = storageScope({ accountId: 'bob' });
  const indexKey = scopedStorageKey('version_index_v1', scope), metadataKey = scopedStorageKey('version_metadata_v1', scope);
  const fixture = indexedMetadataHarness({
    [indexKey]: { ...scope, name: 'Local alias', catalogVersionId: 'weekly-1' },
    [metadataKey]: { ...scope, details: { version: version(), teams: [{ recoveries: ['large retained text'] }] } },
    [scopedStorageKey('source_version_v1', scope)]: ['large baseline'],
    [scopedStorageKey('workspace_version_v1', scope)]: { descs: ['large workspace'] },
    [scopedStorageKey('version_metadata_v1', other)]: { ...other, name: 'Other account' },
    [activeStorageKey(scope)]: scope,
  });
  const versions = await fixture.store.listLocalVersions({ ...scope, sourceHash: '' }, { metadataOnly: true });
  assert.equal(versions.length, 1); assert.equal(versions[0].name, 'Local alias');
  assert.equal(versions[0].hasSource, true); assert.equal(versions[0].current, true); assert.equal(versions[0].details, undefined);
  assert.ok(fixture.operations.filter(op => op.method === 'getAll').every(op => op.key.lower.startsWith('version_index_v1:')));
  assert.ok(fixture.operations.filter(op => op.method === 'get').every(op => op.key.startsWith('workspace_active_v1:')));
  assert.equal(fixture.commits.some(writes => writes.length), false);
});

test('unindexed records use scoped key-only placeholders and legacy slots remain ownership-unknown until explicitly opened', async () => {
  const scope = storageScope(), metadataKey = scopedStorageKey('version_metadata_v1', scope);
  const fixture = indexedMetadataHarness({ [metadataKey]: { ...scope, name: 'Alias retained in full metadata', details: { teams: ['large'] } },
    [scopedStorageKey('source_version_v1', scope)]: ['baseline'] });
  const versions = await fixture.store.listLocalVersions(scope, { metadataOnly: true });
  assert.equal(versions[0].metadataPending, true); assert.equal(versions[0].hasSource, true);
  const explicit = await fixture.store.getVersionMetadata(scope);
  assert.equal(explicit.name, 'Alias retained in full metadata');
  const indexed = fixture.rows.get(scopedStorageKey('version_index_v1', scope)).value;
  assert.equal(indexed.name, explicit.name); assert.equal(indexed.details, undefined);
  const legacy = indexedMetadataHarness({ workspace_poe2: { accountId: 'bob', descs: ['private text'] }, source_poe2: ['large source'] });
  let hashed = 0; legacy.root.CollaborationProtocol = { async sourceHash() { hashed++; return hash('a'); } };
  const hints = await legacy.store.listLocalVersions({ ...scope, sourceHash: '' }, { metadataOnly: true });
  assert.equal(hints[0].ownershipUnknown, true); assert.equal(hints[0].sourceHash, ''); assert.equal(hashed, 0);
  assert.ok(legacy.operations.filter(op => op.method === 'get').every(op => op.key.startsWith('workspace_active_v1:')));
  const resolved = await legacy.store.resolveVersionScope({ ...scope, sourceHash: '' });
  assert.equal(resolved.sourceHash, ''); assert.equal(resolved.legacyWorkspacePending, undefined);
});

test('metadata and source commits force the captured identity and atomically maintain the lightweight index', async () => {
  const scope = storageScope(), key = scopedStorageKey('version_metadata_v1', scope);
  const fixture = indexedMetadataHarness({ [key]: { ...scope, accountId: 'bob', game: 'poe1', branchId: 'release', sourceHash: hash('c') } });
  await fixture.store.saveSourceWorkspaceWithRevisions([], { sourceHash: scope.sourceHash, branchId: scope.branchId, descs: [] }, [], scope);
  for (const prefix of ['version_metadata_v1', 'version_index_v1']) {
    const value = fixture.rows.get(scopedStorageKey(prefix, scope)).value;
    for (const field of ['accountId', 'game', 'branchId', 'sourceHash']) assert.equal(value[field], scope[field]);
  }
  assert.ok(fixture.commits.some(writes => writes.some(write => write.key === key)
    && writes.some(write => write.key === scopedStorageKey('version_index_v1', scope))
    && writes.some(write => write.key === scopedStorageKey('source_version_v1', scope))));
  await fixture.store.setVersionMetadata(scope, { name: 'Alias', details: { version: version(), teams: [team({ recoveries: ['large'] })] } });
  assert.equal(fixture.rows.get(scopedStorageKey('version_index_v1', scope)).value.catalogVersion.name, version().name);
  assert.equal(fixture.rows.get(scopedStorageKey('version_index_v1', scope)).value.details, undefined);
});

test('a mismatched active-pointer scope cannot redirect reads into another account, game or branch', async () => {
  for (const incompatible of [{ accountId: 'bob' }, { game: 'poe1' }, { branchId: 'release' }]) {
    const scope = storageScope({ sourceHash: '' }), fixture = indexedMetadataHarness({ [activeStorageKey(scope)]: { ...storageScope(), ...incompatible } });
    const resolved = await fixture.store.resolveVersionScope(scope);
    assert.equal(resolved.sourceHash, ''); assert.equal(resolved.accountId, 'alice');
    assert.equal(resolved.game, 'poe2'); assert.equal(resolved.branchId, 'default');
  }
});

test('denied ownership of a legacy recovery hint shows a scoped Offline error and preserves the chooser without writes', async () => {
  for (const action of [app => app.continueOfflineVersion(), app => app.managedImportOffline(false), app => app.managedImportOffline(true)]) {
    const { app, events } = harness({ storage: { async resolveVersionScope(scope) { return { ...scope, sourceHash: '' }; } } });
    app.managedVersions = []; app.versionChooserVisible = true;
    app.localVersions = [{ ...storageScope({ sourceHash: '' }), legacy: true, ownershipUnknown: true, name: 'Stored offline workspace' }];
    app.showImportUpdateZipDialog = () => { throw new Error('Denied entry must not open an import dialog.'); };
    app.importTranslatedZipClicked = app.showImportUpdateZipDialog;
    const source = app.sourceIdentity, language = app.lang;
    assert.equal(await action(app), false);
    assert.match(app.managedVisibleError, /current account.*Switch to the account or local profile.*preserved/);
    assert.equal(app.versionChooserVisible, true); assert.equal(app.sourceIdentity, source); assert.equal(app.lang, language);
    assert.equal(events.some(event => ['activate', 'context', 'load', 'import', 'metadata'].includes(event.type)), false);
  }
});

test('an Offline entry failure from an old account cannot appear in the new scope', async () => {
  const gate = deferred(), { app } = harness({ storage: { resolveVersionScope: () => gate.promise } });
  app.managedVersions = []; app.versionChooserVisible = true;
  app.localVersions = [{ ...storageScope({ sourceHash: '' }), legacy: true, ownershipUnknown: true }];
  const opening = app.continueOfflineVersion(); await settle();
  app.cloudProfileId = 'bob'; gate.reject(new Error('Old account IndexedDB failed.'));
  assert.equal(await opening, false); assert.equal(app.managedVisibleError, ''); assert.equal(app.versionChooserVisible, true);
});

test('guest and unassigned translator catalog entry never reads cached managed data while owned local work stays available', async () => {
  for (const guest of [false, true]) {
    const forbidden = [], local = [{ ...storageScope({ accountId: guest ? 'guest' : 'alice' }), name: 'My local work', hasSource: true,
      catalogVersionId: 'weekly-1', details: { version: version(), teams: [team({ recoveries: [{ snapshot: { translations: ['private history'] } }] })] } }];
    const { app, requests } = harness({ storage: {
      async listLocalVersions() { return copy(local); },
      async getVersionCatalog() { forbidden.push('catalog'); return [version()]; },
      async getVersionUpload() { forbidden.push('upload'); return { id: 'manager-job' }; },
      async getVersionMetadata() { forbidden.push('details'); return local[0]; },
    } });
    app.cloudCanAccessAllLanguages = false; app.cloudUser = { ...app.cloudUser, role: 'translator', language: null };
    app.cloudSignedIn = !guest; app.cloudProfileId = guest ? 'guest' : 'alice'; app.versionChooserVisible = true;
    app.managedRecoveryTeam = team({ recoveries: [{ snapshot: { translations: ['hidden'] } }] }); app.managedRecoveryVisible = true;
    assert.equal(app.managedCatalogAccess, false); assert.equal(app.managedOnlineAvailable, false);
    assert.equal(app.managedVisibleVersions.length, 0); assert.equal(app.managedSelectedVersion, null);
    assert.equal(app.managedSelectedDetails, null); assert.equal(app.managedActiveVersion, null); assert.equal(app.managedVisibleRecoveryTeam, null);
    await app.managedScopeChanged({ deferWorkspace: true });
    await app.managedReadDetails('weekly-1');
    assert.deepEqual(forbidden, []); assert.equal(requests.length, 0);
    assert.equal(app.managedOfflineVersion.name, 'My local work'); assert.equal(app.managedOfflineVersion.hasSource, true);
    assert.equal(app.localVersions[0].details.teams[0].recoveries[0].snapshot.translations[0], 'private history', 'Owned local evidence is preserved.');
  }
});

test('unassigned direct managed handlers cannot read, open, recover, download, mutate or publish cached versions', async () => {
  const forbidden = [], { app, requests, events } = harness({ storage: {
    async getVersionMetadata() { forbidden.push('metadata-read'); }, async getVersionSource() { forbidden.push('source-read'); },
    async getVersionUpload() { forbidden.push('upload-read'); }, async setVersionUpload() { forbidden.push('upload-write'); },
  }, window: { WebSocket: function () { forbidden.push('socket'); } } });
  app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'translator'; app.cloudUser.language = null;
  app.managedUpload = { id: 'old-job', status: 'prepared' }; app.managedDuplicateVersion = version();
  app.managedMetadataVersion = version(); app.managedRecoveryTeam = team();
  for (const action of [
    () => app.managedReadDetails('weekly-1'), () => app.continueManagedVersion(version(), 'Thai'),
    () => app.managedOpenVersion(version()), () => app.managedOpenTeam(version(), team()),
    () => app.managedOpenDropped(team()), () => app.managedShowRecoveries(team()), () => app.managedOpenRecoveryFile({ filepath: 'a.txt' }),
    () => app.managedDownloadOriginal(version()), () => app.managedDownload('/v1/collections/old/archive', 'old.zip'),
    () => app.managedCollect(team()), () => app.managedDownloadCollection(team({ latestCollection: { id: 'old' } })),
    () => app.managedDownloadPrevious(team({ collections: [{ id: 'old', downloadReady: true }] }), { target: { value: 'old' } }),
    () => app.managedReopen(team()), () => app.managedAction('/old/action', {}), () => app.managedWithdraw(version()),
    () => app.managedRestore(version()), () => app.openManagedMetadata(version()), () => app.saveManagedMetadata(),
    () => app.openManagedUpload(), () => app.managedOpenDuplicateVersion(), () => app.managedRememberUpload(),
    () => app.discardManagedUpload(), () => app.prepareManagedUpload(), () => app.publishManagedUpload(), () => app.openManagedPresence('weekly-1'),
  ]) await action();
  assert.deepEqual(forbidden, []); assert.equal(requests.length, 0);
  assert.equal(events.some(event => ['activate', 'import', 'metadata', 'download'].includes(event.type)), false);
  assert.equal(app.managedUploadVisible, false); assert.equal(app.managedMetadataVisible, false); assert.equal(app.managedRecoveryVisible, false);
});

test('assignment removal hides cached content immediately, closes presence and rejects late cache and detail responses', async () => {
  const cache = deferred(), details = deferred(); let closed = 0;
  const { app, events } = harness({ storage: { getVersionCatalog: () => cache.promise }, request: () => details.promise });
  app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'translator'; app.versionChooserVisible = true;
  const initial = app.managedScopeChanged(); await settle();
  const selection = app.managedReadDetails('weekly-1'); await settle();
  app._managedPresenceSocket = { close() { closed++; } };
  app.managedRecoveryTeam = team(); app.managedRecoveryVisible = true;
  app.cloudUser.language = null;
  assert.equal(app.managedSelectedVersion, null); assert.equal(app.managedSelectedDetails, null); assert.equal(app.managedVisibleRecoveryTeam, null);
  app.managedClearCatalogAccess(); assert.equal(closed, 1);
  cache.resolve([version()]); details.resolve({ versions: [version()], version: version(), teams: [team()] });
  await Promise.all([initial, selection]);
  assert.equal(app.managedVersions.length, 0); assert.equal(app.managedVersionDetails, null);
  assert.equal(app.managedCatalogLoading, false); assert.equal(app.managedDetailsLoading, false);
  assert.equal(events.some(event => event.type === 'metadata'), false);
});

test('assignment removal prevents a pending managed download or presence ticket from producing output', async () => {
  for (const action of ['download', 'presence']) {
    const gate = deferred(); let sockets = 0;
    const { app, events } = harness({ request: () => gate.promise, window: { WebSocket: function () { sockets++; } } });
    app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'translator';
    const pending = action === 'download' ? app.managedDownloadOriginal(version()) : app.openManagedPresence('weekly-1');
    await settle(); app.cloudUser.language = null;
    gate.resolve(action === 'download' ? { blob: 'private archive' } : { url: 'https://api.example.test/presence' }); await pending;
    assert.equal(events.some(event => event.type === 'download'), false); assert.equal(sockets, 0);
  }
});

test('a revoked translator can continue owned cached work locally without managed metadata, room adoption or source deletion', async () => {
  const local = { ...storageScope(), name: 'Local alias', hasSource: true, catalogVersionId: 'weekly-1' };
  const { app, requests, events } = harness();
  app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'translator'; app.cloudUser.language = null;
  app.localVersions = [local]; app.versionChooserVisible = true;
  assert.equal(app.managedImportZipDisabled, false); assert.equal(await app.continueOfflineVersion(), true);
  assert.equal(app.versionChooserVisible, false); assert.equal(app.sourceIdentity, hash('a'));
  assert.equal(events.filter(event => event.type === 'activate').length, 1);
  assert.equal(events.some(event => ['metadata', 'import'].includes(event.type)), false); assert.equal(requests.length, 0);
  assert.equal(app.localVersions[0].catalogVersionId, 'weekly-1', 'Association stays retained for later authorized access.');
});

test('an assigned signed profile retains downloaded Online access during network failure, while managers and admins need no assignment', async () => {
  const saved = { version: version(), teams: [team({ ended: true }), team({ language: 'German' })] };
  const { app } = harness({ storage: { async getVersionMetadata() { return { ...storageScope(), details: saved }; } } });
  app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'translator'; app._cloud = null;
  app.managedVersionDetails = null; app.versionChooserVisible = true;
  assert.equal(app.managedCatalogAccess, true); assert.equal(app.managedOnlineAvailable, false); assert.equal(app.managedVisibleVersions.length, 1);
  await app.managedReadDetails('weekly-1'); assert.equal(app.managedSelectedDetails.teams.length, 1);
  assert.equal(await app.continueManagedVersion(version(), 'Thai'), true);
  for (const role of ['manager', 'admin']) {
    const current = harness(); current.app.cloudUser.role = role; current.app.cloudUser.language = null;
    assert.equal(current.app.managedCatalogAccess, true); assert.equal(current.app.managedManagerAccess, true);
    await current.app.managedReadDetails('weekly-1'); assert.equal(current.app.managedSelectedDetails.teams.length, 1);
    current.app.openManagedMetadata(version()); assert.equal(current.app.managedMetadataVisible, true);
  }
});

test('managed chooser templates gate cached tables, team details and recovery dialogs by current catalog access', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /<template v-if="managedCatalogAccess">[\s\S]*?onlineVersionTable/);
  assert.match(html, /v-else-if="!managedCatalogAccess"[^>]*>Your account needs a team language assignment/);
  assert.match(html, /v-if="managedCatalogAccess && managedSelectedVersion"/);
  assert.match(html, /v-for="team in managedSortedTeams"/);
  assert.match(html, /v-if="managedManagerAccess && managedUploadVisible"/);
  assert.match(html, /v-if="managedRecoveryVisible && managedVisibleRecoveryTeam"/);
});

test('weekly defaults use the New Zealand upload date and strictly following Monday at 09:00', () => {
  for (const [instant, name, deadline] of [
    ['2026-10-04T21:00:00Z', '2026-10-05_POE2', '2026-10-11T20:00:00.000Z'],
    ['2026-10-04T12:00:00Z', '2026-10-05_POE2', '2026-10-11T20:00:00.000Z'],
    ['2026-10-04T10:00:00Z', '2026-10-04_POE2', '2026-10-04T20:00:00.000Z'],
    ['2026-10-09T22:00:00Z', '2026-10-10_POE2', '2026-10-11T20:00:00.000Z'],
  ]) assert.deepEqual(Managed.defaults('poe2', new Date(instant)), { name, deadlineAt: deadline });
  assert.equal(Managed.defaults('poe1', new Date('2026-10-04T21:00:00Z')).name, '2026-10-05_POE1');
});

test('weekly deadlines cross both Auckland daylight saving transitions without changing 09:00', () => {
  assert.equal(Managed.defaults('poe2', new Date('2026-03-30T00:00:00Z')).deadlineAt, '2026-04-05T21:00:00.000Z');
  assert.equal(Managed.defaults('poe2', new Date('2026-09-20T22:00:00Z')).deadlineAt, '2026-09-27T20:00:00.000Z');
  for (const instant of ['2026-04-05T21:00:00.000Z', '2026-09-27T20:00:00.000Z']) {
    const input = Managed.deadlineInput(instant);
    assert.match(input, /T09:00$/);
    assert.equal(Managed.parseDeadline(input), instant);
  }
});

test('weekday selection uses next Monday-based New Zealand week and preserves the deadline time', () => {
  const now = new Date('2026-10-08T00:00:00Z');
  for (let day = 0; day < 7; day++) {
    const deadline = Managed.nextWeekDeadline('2026-11-02T18:45', String(day), now);
    assert.equal(deadline, `2026-10-${12 + day}T18:45`);
    assert.equal(Managed.deadlineWeekday(deadline), day);
  }
  assert.equal(Managed.nextWeekDeadline('2026-10-05T18:45', 0, new Date('2026-10-04T12:00:00Z')), '2026-10-12T18:45');
  assert.equal(Managed.nextWeekDeadline('2026-10-04T18:45', 6, new Date('2026-10-03T12:00:00Z')), '2026-10-11T18:45');
  assert.equal(Managed.nextWeekDeadline('2026-12-27T18:45', 6, new Date('2026-12-26T12:00:00Z')), '2027-01-03T18:45');
  assert.equal(Managed.nextWeekDeadline('', 0, now), '2026-10-12T09:00');
  assert.equal(Managed.deadlineWeekday(''), '');
});

test('invalid deadline dates are rejected instead of silently moving the deadline', () => {
  for (const input of ['', '2026-02-30T09:00', '2026-13-01T09:00', '2026-10-05T25:00', '2026-10-05T09:61']) {
    assert.throws(() => Managed.parseDeadline(input), /deadline|valid/i, input);
  }
});

test('filename sanitation preserves version identity and removes filesystem separators', () => {
  assert.equal(Managed.filename('2026-10-05_POE2'), '2026-10-05_POE2');
  assert.equal(Managed.filename('Weekly: "PoE/2"\\zip?*. '), 'Weekly_ _PoE_2__zip__');
  assert.equal(Managed.filename('... '), 'StatDescriptions');
  assert.equal(Managed.filename('week\u0000name'), 'week_name');
});

test('status name prefers the current published name, retains its local alias in the tooltip and falls back to scoped local names or hash', () => {
  const { app } = harness();
  app.collaborationShortVersion = 'bbbbbbbbbbbb'; app.collaborationExportHash = hash('b');
  app.localVersions = [{ accountId: 'alice', game: 'poe2', branchId: 'default', sourceHash: hash('a'), name: 'My offline alias' }];
  assert.equal(app.managedStatusName, '2026-10-05_POE2');
  assert.match(app.managedStatusTooltip, /Local alias: My offline alias/);
  assert.match(app.managedStatusTooltip, new RegExp('ZIP SHA-256: ' + hash('b')));
  assert.match(app.managedStatusTooltip, /Import deadline:/);
  app.managedVersions = []; app.managedVersionDetails = null;
  assert.equal(app.managedStatusName, 'My offline alias');
  app.localVersions[0].sourceHash = hash('c');
  app.localDescs = { sourceHash: hash('c'), versionName: 'Wrong workspace' };
  assert.equal(app.managedStatusName, 'bbbbbbbbbbbb');
  app.collaborationShortVersion = ''; assert.equal(app.managedStatusName, hash('a').slice(0, 12));
});

test('status local names never come from another account, game or branch', () => {
  const { app } = harness(); app.managedVersions = []; app.managedVersionDetails = null;
  app.collaborationShortVersion = 'bbbbbbbbbbbb';
  for (const incompatible of [{ accountId: 'bob' }, { game: 'poe1' }, { branchId: 'release' }]) {
    app.localVersions = [{ accountId: 'alice', game: 'poe2', branchId: 'default', sourceHash: hash('a'), name: 'Other workspace', ...incompatible }];
    assert.equal(app.managedStatusName, 'bbbbbbbbbbbb');
  }
});

test('version ended badge represents all teams for managers and the assigned team for translators', () => {
  const { app } = harness();
  assert.equal(app.managedVersionEnded(version({ teamCount: 12, endedTeamCount: 11 })), false);
  assert.equal(app.managedVersionEnded(version({ teamCount: 12, endedTeamCount: 12 })), true);
  app.cloudCanAccessAllLanguages = false;
  assert.equal(app.managedVersionEnded(version({ endedTeamCount: 1, assignedTeam: { ended: true } })), true);
  assert.equal(app.managedVersionEnded(version({ endedTeamCount: 12, assignedTeam: { ended: false } })), false);
});

test('status tooltips retain ended and withdrawn guidance with the exact active deadline', () => {
  const { app } = harness(); app.managedVersionDetails.teams[0].ended = true;
  assert.match(app.managedStatusTooltip, /Ended · further saves are outside the last collection/);
  assert.match(app.managedStatusDeadlineTooltip, /New Zealand/); assert.match(app.managedStatusDeadlineTooltip, /Ended/);
  app.managedVersions[0].status = 'withdrawn';
  assert.match(app.managedStatusTooltip, /Withdrawn · shared saves paused; local work retained/);
});

test('direct version entry uses the assigned language and never assumes a manager language', async () => {
  const { app } = harness(); const opened = [];
  app.continueManagedVersion = async (selected, language) => { opened.push([selected.id, language]); return true; };
  assert.equal(await app.managedOpenVersion(version()), false); assert.equal(opened.length, 0);
  app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'manager';
  assert.equal(app.managedSingleLanguageAccess, false);
  app.cloudUser.role = 'translator'; app.lang = 'German';
  assert.equal(await app.managedOpenVersion(version()), true); assert.deepEqual(opened, [['weekly-1', 'Thai']]);
  app.cloudUser.language = ''; assert.equal(await app.managedOpenVersion(version()), false);
});

test('cancelling older ended version entry preserves active drafts, workspace and chooser without writes', async () => {
  const older = version({ id: 'older', sourceHash: hash('c'), isHead: false });
  const { app, events } = harness({ request: async () => ({ version: older, teams: [team({ ended: true })] }) });
  const draft = app._draftSession = { text: 'Unfinished typing' }; let message;
  app.versionChooserVisible = true; app.editorVisible = true; app.editorSessionActive = true;
  app.appConfirm = async (text, options) => { message = text; assert.equal(options.confirmLabel, 'Open editor'); return false; };
  assert.equal(await app.continueManagedVersion(older, 'Thai'), false);
  assert.match(message, /not HEAD/); assert.match(message, /translation window has ended/);
  assert.equal(app.sourceIdentity, hash('a')); assert.equal(app.lang, 'Thai');
  assert.equal(app._draftSession, draft); assert.equal(app.editorVisible, true); assert.equal(app.versionChooserVisible, true);
  assert.equal(events.some(event => ['metadata', 'activate', 'load', 'import', 'context'].includes(event.type)), false);
  assert.equal(app.managedVersionBusy, false);
});

test('managed opening keeps one initialization active through drafts, cached source and the final team-details request', async () => {
  const draft = deferred(), source = deferred(), finalDetails = deferred(); let detailReads = 0;
  const { app } = harness({ storage: { getVersionSource: () => source.promise }, request: async () => {
    if (++detailReads === 1) return { version: version(), teams: [team()] };
    return finalDetails.promise;
  } });
  withInitialization(app); app.versionChooserVisible = true;
  app.flushEditorDraft = () => draft.promise;
  let loadedSession;
  app.loadVersionedStorage = async session => { loadedSession = session; assert.equal(app.workspaceInitializationActive, true); };
  try {
    const pending = app.continueManagedVersion(version(), 'Thai');
    assert.equal(app.workspaceInitializationActive, true);
    const run = app._workspaceInitializationRun;
    await new Promise(setImmediate);
    assert.equal(app.workspaceInitializationRows.at(-1).label, 'Preserving editor drafts');
    assert.equal(app.workspaceInitializationRows.at(-1).status, 'running');
    draft.resolve(true); await new Promise(setImmediate);
    assert.equal(app.workspaceInitializationRows.at(-1).label, 'Reading the cached source version');
    assert.equal(app.versionChooserVisible, true);
    source.resolve([{ filepath: 'source/test.txt' }]); await new Promise(setImmediate);
    assert.equal(loadedSession.run, run);
    assert.equal(detailReads, 2);
    assert.equal(app.workspaceInitializationActive, true);
    assert.equal(app.workspaceInitializationRows.at(-1).label, 'Refreshing active version and team details');
    assert.equal(app.versionChooserVisible, false);
    finalDetails.resolve({ version: version(), teams: [team()] });
    assert.equal(await pending, true);
    assert.equal(app.workspaceInitializationActive, false);
    assert.equal(app.managedVersionBusy, false);
    assert.ok(app.workspaceInitializationRows.every(row => row.status === 'done'));
  } finally { app.disposeWorkspaceInitialization(); }
});

test('uncached opening stays under initialization while source parsing and its durable local commit are pending', async () => {
  const parsing = deferred(), committing = deferred();
  const sourceFile = { filepath: 'source/test.txt', English: ['Original'], Thai: ['Translation'], entryMeta: [{}] };
  const { app, events } = harness({ storage: {
    async getVersionSource() { return []; },
    async saveSourceWorkspaceWithRevisions(source, workspace, revisions, scope) {
      assert.equal(app.workspaceInitializationActive, true);
      assert.equal(scope.accountId, 'alice'); assert.equal(scope.sourceHash, hash('a'));
      assert.deepEqual(copy(source), [sourceFile]);
      await committing.promise; events.push({ type: 'import' });
    },
  }, window: {
    WorkspaceState: require('../public/workspaceState.js'),
    async parseFile(filepath, entry, language, options) {
      assert.equal(app.workspaceInitializationActive, true); assert.equal(language, 'Thai'); assert.equal(options.strict, true);
      await parsing.promise; return copy(sourceFile);
    },
  }, request: async route => {
    if (route.endsWith('/original')) return { downloaded: true };
    if (route.includes('/archives/')) return { archive: { zipHash: hash('b') } };
    return { version: version(), teams: [team()] };
  } });
  withInitialization(app); app.versionChooserVisible = true;
  app.readImportZipIdentity = async () => ({ zipHash: hash('b') });
  app.buildImportedBaseline = async (identity, source) => ({ archive: identity, source });
  try {
    const pending = app.continueManagedVersion(version(), 'Thai'); await new Promise(setImmediate);
    assert.equal(app.workspaceInitializationActive, true);
    assert.equal(app.workspaceInitializationRows.at(-1).label, 'Parsing source description files');
    assert.equal(app.versionChooserVisible, true);
    assert.equal(events.some(event => event.type === 'activate' || event.type === 'import'), false);
    parsing.resolve(); await new Promise(setImmediate);
    assert.equal(app.workspaceInitializationRows.at(-1).label, 'Storing the verified source version locally');
    assert.equal(app.workspaceInitializationActive, true);
    assert.equal(events.some(event => event.type === 'activate' || event.type === 'import'), false);
    committing.resolve(); assert.equal(await pending, true);
    assert.equal(app.workspaceInitializationActive, false);
    const imported = events.findIndex(event => event.type === 'import'), activated = events.findIndex(event => event.type === 'activate');
    assert.ok(imported >= 0 && activated > imported);
    const labels = app.workspaceInitializationRows.map(row => row.label);
    assert.ok(labels.includes('Downloading the original source ZIP'));
    assert.ok(labels.includes('Unpacking the source ZIP'));
    assert.ok(labels.includes('Verifying the source ZIP identity'));
    assert.ok(labels.includes('Applying import choices and verifying baseline proofs'));
  } finally { app.disposeWorkspaceInitialization(); }
});

test('initialization leaves an older-version confirmation reachable and releases its owner on cancellation', async () => {
  const older = version({ isHead: false }), confirmation = deferred();
  const { app, events } = harness({ request: async () => ({ version: older, teams: [team({ ended: true })] }) });
  withInitialization(app); app.versionChooserVisible = true; app.editorVisible = true; app.editorSessionActive = true;
  const draft = app._draftSession = { text: 'Unfinished typing' };
  app.appConfirm = () => confirmation.promise;
  try {
    const pending = app.continueManagedVersion(older, 'Thai'); await new Promise(setImmediate);
    assert.equal(app.workspaceInitializationActive, true);
    assert.equal(app.workspaceInitializationRows.at(-1).label, 'Waiting for source version confirmation');
    assert.equal(app.versionChooserVisible, true);
    confirmation.resolve(false); assert.equal(await pending, false);
    assert.equal(app.workspaceInitializationActive, false);
    assert.equal(app.versionChooserVisible, true); assert.equal(app.editorVisible, true); assert.equal(app._draftSession, draft);
    assert.equal(events.some(event => ['metadata', 'activate', 'load', 'import', 'context'].includes(event.type)), false);
  } finally { app.disposeWorkspaceInitialization(); }
});

test('a stale managed opening cannot add activity to or release a newer initialization', async () => {
  const source = deferred(), { app, events } = harness({ storage: { getVersionSource: () => source.promise } });
  withInitialization(app); app.versionChooserVisible = true;
  try {
    const pending = app.continueManagedVersion(version(), 'Thai'); await new Promise(setImmediate);
    assert.equal(app.workspaceInitializationRows.at(-1).label, 'Reading the cached source version');
    app.cloudProfileId = 'bob';
    const newer = app.beginWorkspaceInitialization({ label: 'Opening Bob workspace', force: true });
    const newerTask = app.beginWorkspaceInitializationTask('Loading Bob saved work', newer);
    source.resolve([{ filepath: 'source/test.txt' }]); await pending;
    assert.equal(app.workspaceInitializationActive, true);
    assert.equal(app._workspaceInitializationRun, newer.run);
    assert.equal(app.workspaceInitializationRows.length, 1);
    assert.equal(app.workspaceInitializationRows[0].status, 'running');
    assert.equal(events.some(event => ['metadata', 'activate', 'load', 'import', 'context'].includes(event.type)), false);
    app.finishWorkspaceInitializationTask(newerTask); app.finishWorkspaceInitialization(newer);
    assert.equal(app.workspaceInitializationActive, false);
  } finally { app.disposeWorkspaceInitialization(); }
});

test('offline activation uses initialization while a failed local activation preserves the actionable chooser and draft', async () => {
  const activation = deferred(), { app } = harness({ storage: { activateVersion: () => activation.promise } });
  withInitialization(app); app._cloud = null; app.managedVersions = []; app.versionChooserVisible = true;
  app.localVersions = [{ ...storageScope(), hasSource: true, name: 'Offline work' }];
  app.editorVisible = true; app.editorSessionActive = true; const draft = app._draftSession = { text: 'Draft to preserve' };
  try {
    const pending = app.continueOfflineVersion(); await new Promise(setImmediate);
    assert.equal(app.workspaceInitializationActive, true);
    assert.equal(app.workspaceInitializationRows.at(-1).label, 'Activating the selected local workspace');
    activation.reject(new Error('IndexedDB activation failed')); assert.equal(await pending, false);
    assert.equal(app.workspaceInitializationActive, false);
    assert.equal(app.versionChooserVisible, true); assert.equal(app.editorVisible, true); assert.equal(app._draftSession, draft);
    assert.match(app.managedVisibleError, /IndexedDB activation failed/);
    assert.equal(app.workspaceInitializationRows.at(-1).status, 'failed');
  } finally { app.disposeWorkspaceInitialization(); }
});

test('accepted ended entry covers the same editing session but a new collection warns again', async () => {
  const details = { version: version(), teams: [team({ ended: true, latestCollection: { id: 'collection-1' } })] };
  const { app } = harness({ request: async () => details }); let prompts = 0;
  app.managedVersionDetails = copy(details); app.appConfirm = async () => { prompts++; return true; };
  assert.equal(await app.continueManagedVersion(version(), 'Thai'), true);
  assert.equal(prompts, 1); assert.equal(await app.managedWarnBeforeEdit(), true); assert.equal(prompts, 1);
  app.managedActiveDetails.teams[0].latestCollection.id = 'collection-2';
  assert.equal(await app.managedWarnBeforeEdit(), true); assert.equal(prompts, 2);
});

test('a late entry confirmation cannot activate a version after the account changes', async () => {
  const older = version({ isHead: false }), gate = deferred();
  const { app, events } = harness({ request: async () => ({ version: older, teams: [team()] }) });
  app.appConfirm = () => gate.promise;
  const pending = app.continueManagedVersion(older, 'Thai'); await settle();
  app.cloudProfileId = 'bob'; gate.resolve(true); await pending;
  assert.equal(events.some(event => ['metadata', 'activate', 'load', 'import', 'context'].includes(event.type)), false);
});

test('direct team entry refuses another translator language and changed server identities even with cached source', async () => {
  const { app, events } = harness({ request: async () => ({ version: version({ sourceHash: hash('c') }), teams: [team()] }) });
  app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'translator';
  assert.equal(await app.continueManagedVersion(version(), 'German'), false);
  assert.equal(await app.continueManagedVersion(version(), 'Thai'), false);
  assert.match(app.managedOperationErrors.open, /source version changed/);
  assert.equal(events.some(event => ['metadata', 'activate', 'load', 'import', 'context'].includes(event.type)), false);
});

test('row metadata saves retain their explicit version target when another version is selected', async () => {
  const { app, requests } = harness({ request: async () => ({}) });
  const edited = version({ id: 'row-action', name: 'Row action target', revision: 4 });
  app.openManagedMetadata(edited); app.selectedManagedVersionId = 'weekly-1';
  app.managedMetadataName = 'Renamed target'; app.refreshManagedVersions = async () => {};
  await app.saveManagedMetadata();
  assert.equal(requests[0].route, '/v1/versions/row-action');
  assert.equal(requests[0].options.body.name, 'Renamed target'); assert.equal(requests[0].options.body.expectedRevision, 4);
});

test('deadline reminders stay passive and progress uses Missing plus Saved with Revised inside Saved', () => {
  const { app, events, requests } = harness();
  const before = copy(app.managedVersionDetails), deadline = '2026-10-11T20:00:00Z';
  app.managedNow = Date.parse(deadline) - 3 * 86400000;
  assert.equal(app.managedReminder(deadline), '3 days until import deadline');
  app.managedNow = Date.parse(deadline) - 3600000;
  assert.equal(app.managedReminder(deadline), '1 hour until import deadline');
  app.managedNow = Date.parse(deadline);
  assert.match(app.managedReminder(deadline), /deadline passed/);
  assert.deepEqual(app.managedVersionDetails, before);
  assert.equal(events.length, 0); assert.equal(requests.length, 0);
  assert.deepEqual(copy(app.managedProgress(team())), { missing: 30, saved: 20, revised: 10, ordinarySaved: 10,
    total: 50, percent: 40, missingWidth: '60%', savedWidth: '20%', revisedWidth: '20%' });
  const noWork = app.managedProgress(team({ counts: { loaded: 100, missing: 0, saved: 0, revised: 0 } }));
  assert.equal(noWork.total, 0); assert.equal(noWork.savedWidth, '0%'); assert.equal(noWork.revisedWidth, '0%'); assert.equal(noWork.missingWidth, '0%');
  assert.match(app.managedProgressTooltip(team()), /Saved: 20 \/ 50 \(40%\)/);
  assert.match(app.managedProgressTooltip(team()), /Revised: 10 \(included in Saved\)/);
  assert.match(app.managedProgressTooltip(team()), /counts can overlap/);
});

test('displayed teams sort by descending progress and lowest workload denominator for ties', () => {
  const { app } = harness();
  app.managedVersionDetails.teams = [
    team({ language: 'Larger zero progress', counts: { missing: 200, saved: 0 } }),
    team({ language: 'Smaller zero progress', counts: { missing: 5, saved: 0 } }),
    team({ language: 'Larger rounded tie', counts: { missing: 33, saved: 1 } }),
    team({ language: 'Smaller rounded tie', counts: { missing: 30, saved: 1 } }),
    team({ language: 'Higher progress', counts: { missing: 3, saved: 1 } }),
  ];

  const retained = copy(app.managedSelectedDetails.teams);
  assert.deepEqual(app.managedSortedTeams.map(item => item.language), [
    'Higher progress', 'Smaller rounded tie', 'Larger rounded tie', 'Smaller zero progress', 'Larger zero progress',
  ]);
  assert.deepEqual(app.managedSelectedDetails.teams, retained, 'Rendering the sort preserves cached team details.');
});

test('pre-check tooltips describe existing standalone accepted work and disclose unavailable offline drafts', () => {
  const { app } = harness();
  const preview = { ...team(), isManaged: false, historyCount: 3, savedFileCount: 20, presence: [{ name: 'Fixture translator' }] };
  const tooltip = app.managedExistingTeamTooltip(preview);
  assert.match(tooltip, /Standalone \/ Offline import/); assert.match(tooltip, /Saved: 20/);
  assert.match(tooltip, /Shared history: 3 changes/); assert.match(tooltip, /Online: Fixture translator/);
  assert.match(tooltip, /Unuploaded offline work and local drafts are not visible/);
  assert.match(app.managedExistingTeamTooltip({ ...preview, isManaged: true, presence: [] }), /Published room/);
});

test('Download only skips ending confirmation and sends the explicit non-ending snapshot request', async () => {
  const before = team(), { app, events, requests } = harness({ request: async () => ({ collection: {
    id: 'download-1', status: 'ready', downloadReady: true, fileCount: 20, endWindow: false, kind: 'download_only' } }) });
  app.managedDownload = async (route, name) => { events.push({ type: 'collectionDownload', route, name }); return true; };
  app.managedReadDetails = async () => {}; app.refreshManagedVersions = async () => {};
  await app.managedCollect(before, false);
  assert.equal(requests[0].route, '/v1/versions/weekly-1/teams/Thai/downloads');
  assert.equal(requests[0].options.body.endWindow, false);
  assert.equal(events.some(event => event.type === 'confirm'), false);
  assert.equal(events.filter(event => event.type === 'collectionDownload').length, 1);
  assert.equal(before.ended, false); assert.equal(before.latestCollection, null);
});

test('Download only fails safely on an older API without falling back to an ending collection', async () => {
  const { app, requests } = harness({ request: async () => { throw Object.assign(new Error('Download-only is unavailable on this API.'), { status: 404 }); } });
  await app.managedCollect(team(), false);
  assert.equal(requests.length, 1); assert.match(requests[0].route, /\/downloads$/);
  assert.match(app.managedVisibleError, /unavailable/); assert.equal(app.managedVersionDetails.teams[0].ended, false);
});

test('Download only retries use their own durable identifier across reloads without consuming an ending collection request', async () => {
  const durable = new Map();
  const key = (scope, versionId, language, endWindow = true) => JSON.stringify([scope.accountId, scope.game, scope.branchId, versionId, language, endWindow]);
  const storage = {
    async getVersionCollectionRequest(scope, versionId, language, endWindow) { return durable.get(key(scope, versionId, language, endWindow)); },
    async setVersionCollectionRequest(scope, versionId, language, requestId, endWindow) {
      const selected = key(scope, versionId, language, endWindow);
      if (requestId == null) durable.delete(selected); else durable.set(selected, requestId);
    },
  };
  const first = harness({ storage, request: async () => { throw new Error('Download snapshot acknowledgement lost'); } });
  await first.app.managedCollect(team(), false);
  const firstRequest = first.requests[0].options.body.idempotencyKey;
  const endingKey = key(first.app.managedWorkspaceScope(''), 'weekly-1', 'Thai', true);
  durable.set(endingKey, 'existing-ending-request');
  const reloaded = harness({ storage, request: async () => ({ collection: { id: 'download-retry', status: 'ready', downloadReady: true, fileCount: 20, endWindow: false } }) });
  reloaded.app.managedDownload = async () => true; reloaded.app.managedReadDetails = async () => {}; reloaded.app.refreshManagedVersions = async () => {};
  await reloaded.app.managedCollect(team(), false);
  assert.equal(reloaded.requests[0].options.body.idempotencyKey, firstRequest);
  assert.equal(reloaded.requests[0].options.body.endWindow, false);
  assert.equal(durable.size, 1); assert.equal(durable.get(endingKey), 'existing-ending-request');
});

test('matching published baseline adopts only metadata while retaining active drafts and local alias', async () => {
  const { app, events } = harness();
  const local = app.localDescs, draft = { text: 'Unfinished typing' }, editor = { filepath: 'source/test.txt' };
  app._draftSession = draft; app.editorCurrentEditingDesc = editor; app.editorSessionActive = true; app.editorVisible = true;
  await app.managedAssociateActive();
  assert.equal(app.activeManagedVersionId, 'weekly-1');
  assert.equal(app.localDescs, local); assert.equal(app.localDescs.versionName, 'My local ZIP');
  assert.equal(app._draftSession, draft); assert.equal(app.editorCurrentEditingDesc, editor);
  assert.equal(app.editorVisible, true); assert.equal(app.editorSessionActive, true);
  assert.deepEqual(events.map(event => event.type), ['metadata']);
  assert.deepEqual(events[0].values, { catalogVersionId: 'weekly-1', officialName: '2026-10-05_POE2' });
});

test('an associated cached baseline remains available for local Continue without becoming a standalone workspace', async () => {
  const { app, events } = harness();
  const local = { ...storageScope(), name: 'My previous offline ZIP', hasSource: true, current: true,
    catalogVersionId: 'weekly-1' };
  app.localVersions = [local]; app.versionChooserVisible = true;
  assert.equal(app.managedOfflineVersion, null);
  assert.equal(app.managedOfflineAssociatedVersion, local);
  assert.equal(await app.continueAssociatedOfflineVersion(), true);
  assert.equal(app.versionChooserVisible, false);
  assert.equal(events.filter(event => event.type === 'activate').length, 1);
  assert.deepEqual(events.find(event => event.type === 'activate').scope, storageScope());
  assert.equal(events.some(event => event.type === 'import'), false);
  assert.equal(app.localVersions[0].catalogVersionId, 'weekly-1');
  assert.equal(app.localVersions[0].name, 'My previous offline ZIP');
  assert.equal(app.managedImportZipDisabled, true, 'Local Continue preserves the published source import policy.');
});

test('the Offline chooser explains published cache association and offers local Continue', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const associated = html.match(/<template v-else-if="managedOfflineAssociatedVersion">[\s\S]*?<\/template>/)?.[0];
  assert.ok(associated, 'The associated cache has its own fallback after standalone workspace selection.');
  assert.match(associated, /matches a published version/);
  assert.match(associated, /remains available offline/);
  assert.match(associated, /saved work and history/);
  assert.match(associated, /@click="continueAssociatedOfflineVersion"[^>]*>Continue cached workspace/);
  assert.ok(html.indexOf('v-if="managedOfflineVersion"') < html.indexOf('v-else-if="managedOfflineAssociatedVersion"'));
});

test('associated local Continue excludes unavailable source and caches from another account, game or branch', async () => {
  const { app, events } = harness();
  const local = { ...storageScope(), hasSource: true, catalogVersionId: 'weekly-1' };
  app.localVersions = [{ ...local, hasSource: false }, { ...local, sourceHash: '' },
    { ...local, accountId: 'bob' }, { ...local, game: 'poe1' }, { ...local, branchId: 'release' }];
  assert.equal(app.managedOfflineAssociatedVersion, null);
  assert.equal(await app.continueAssociatedOfflineVersion(), false);
  assert.equal(events.length, 0);
  app.localVersions.push({ ...local, catalogVersionId: undefined });
  assert.equal(app.managedOfflineAssociatedVersion.sourceHash, local.sourceHash,
    'A matching accepted published source is available before association metadata is persisted.');
  app.managedVersions = [version({ game: 'poe1' }), version({ branchId: 'release' })];
  assert.equal(app.managedOfflineAssociatedVersion, null);
});

test('associated local Continue prefers the current scope and rejects late account changes', async () => {
  const gate = deferred(), { app, events } = harness();
  app.localVersions = [{ ...storageScope({ sourceHash: hash('c') }), hasSource: true,
    catalogVersionId: 'weekly-2', updatedAt: 200 }, { ...storageScope(), hasSource: true,
    catalogVersionId: 'weekly-1', current: true, updatedAt: 100 }];
  assert.equal(app.managedOfflineAssociatedVersion.sourceHash, hash('a'));
  app.flushEditorDraft = () => gate.promise;
  const pending = app.continueAssociatedOfflineVersion(); app.cloudProfileId = 'bob'; gate.resolve(true);
  assert.equal(await pending, false);
  assert.equal(events.some(event => ['activate', 'context', 'load', 'metadata', 'import'].includes(event.type)), false);
  app.cloudUser.role = 'translator'; app.cloudUser.language = null; app.cloudCanAccessAllLanguages = false;
  assert.equal(app.managedOfflineAssociatedVersion, null);
});

test('a differing canonical baseline is not adopted solely because the raw ZIP hash matches', async () => {
  const { app, events } = harness();
  app.managedVersions = [version({ sourceHash: hash('c') })];
  await app.managedAssociateActive();
  assert.equal(app.activeManagedVersionId, ''); assert.equal(events.length, 0);
});

test('late adoption acknowledgements cannot activate the previous account or source', async () => {
  for (const change of [app => { app.cloudProfileId = 'bob'; }, app => { app.sourceIdentity = hash('c'); }]) {
    const gate = deferred(), { app } = harness({ storage: { setVersionMetadata: () => gate.promise } });
    const pending = app.managedAssociateActive(); change(app); gate.resolve(); await pending;
    assert.equal(app.activeManagedVersionId, '');
  }
});

test('late remote catalog responses cannot replace a switched game or account', async () => {
  for (const change of [app => { app.gameVersion = 'poe1'; }, app => { app.cloudProfileId = 'bob'; }]) {
    const gate = deferred(), { app, events } = harness({ request: () => gate.promise });
    const pending = app.refreshManagedVersions(); change(app);
    app.managedVersions = [version({ id: 'new-scope', game: app.gameVersion })];
    gate.resolve({ branch: { id: 'default' }, versions: [version()] }); await pending;
    assert.equal(app.managedVersions[0].id, 'new-scope');
    assert.equal(events.some(event => event.type === 'catalog'), false);
  }
});

test('late cached catalogs cannot replace current scope after an account change', async () => {
  const gate = deferred(); let entered = false;
  const { app } = harness({ storage: { getVersionCatalog: () => { entered = true; return gate.promise; } } });
  app.refreshManagedVersions = async () => {};
  const pending = app.managedScopeChanged(); await settle(); assert.equal(entered, true);
  app.cloudProfileId = 'bob'; app.managedVersions = [version({ id: 'bob-version' })];
  gate.resolve([version({ id: 'alice-version' })]); await pending;
  assert.equal(app.managedVersions[0].id, 'bob-version');
});

test('workspace switching captures account and game before waiting for drafts', async () => {
  for (const change of [app => { app.gameVersion = 'poe1'; }, app => { app.cloudProfileId = 'bob'; }]) {
    const gate = deferred(), { app, events } = harness();
    app.flushEditorDraft = () => gate.promise;
    const pending = app.managedActivateWorkspace(hash('c')); change(app); gate.resolve(true);
    assert.equal(await pending, false);
    assert.equal(events.some(event => event.type === 'activate' || event.type === 'load'), false);
  }
});

test('failed IndexedDB activation leaves the current editor and chooser actionable', async () => {
  const { app } = harness({ storage: { async activateVersion() { throw new Error('IndexedDB unavailable'); } } });
  app.editorSessionActive = true; app.editorVisible = true; app.inlineActive = true; app.versionChooserVisible = true;
  const draft = app._draftSession = { text: 'Saved local draft' }, workspace = app.localDescs;
  try { await app.managedActivateWorkspace(hash('c')); } catch (error) { assert.match(error.message, /IndexedDB/); }
  assert.equal(app.editorVisible, true); assert.equal(app.inlineActive, true);
  assert.equal(app.versionChooserVisible, true); assert.equal(app.editorSessionActive, true);
  assert.equal(app._draftSession, draft); assert.equal(app.localDescs, workspace); assert.equal(app.sourceIdentity, hash('a'));
});

test('late offline renames cannot write their local alias into another account using the same baseline', async () => {
  const gate = deferred(), { app } = harness({ storage: { setVersionMetadata: () => gate.promise } });
  app.offlineVersionName = 'Alice weekly draft';
  const pending = app.saveOfflineVersionName();
  app.cloudProfileId = 'bob'; app.localDescs = { versionName: 'Bob local ZIP' };
  gate.resolve(); await pending;
  assert.equal(app.localDescs.versionName, 'Bob local ZIP');
});

test('stale detail failures do not replace the error state of a newer selected version', async () => {
  const gate = deferred(), { app } = harness({ request: route => route.endsWith('weekly-1') ? gate.promise : { version: version({ id: 'weekly-2' }), teams: [team()] } });
  const old = app.managedReadDetails('weekly-1');
  await app.managedReadDetails('weekly-2');
  gate.reject(new Error('Old detail unavailable')); await old;
  assert.equal(app.managedVersionDetails.version.id, 'weekly-2');
  assert.equal(app.managedVersionError, '');
});

test('offline selection immediately shows the cached selected team and Continue opens that version after request failure', async () => {
  const gate = deferred(), { app, events } = harness({ request: () => gate.promise });
  const selected = version({ id: 'weekly-2', sourceHash: hash('c'), name: '2026-10-12_POE2' });
  app.managedVersions.push(selected);
  app.localVersions = [{ ...selected, accountId: 'alice', catalogVersionId: selected.id,
    details: { version: selected, teams: [team({ ended: true }), team({ language: 'German' })] } }];
  app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'translator';
  const pending = app.managedReadDetails(selected.id);
  assert.equal(app.managedSelectedVersion.id, selected.id);
  assert.equal(app.managedVersionDetails.version.id, selected.id);
  assert.equal(app.managedVersionDetails.teams.length, 1);
  assert.equal(app.managedVersionDetails.teams[0].language, 'Thai');
  assert.equal(app.managedVersionDetails.teams[0].ended, true);
  gate.reject(new Error('Network unavailable')); await pending;
  assert.equal(app.managedSelectedVersion.id, selected.id);
  let opened; app.managedActivateWorkspace = async sourceHash => { opened = sourceHash; return true; };
  assert.equal(await app.continueManagedVersion(), true);
  assert.equal(opened, selected.sourceHash);
  assert.equal(events.find(event => event.type === 'metadata').scope.sourceHash, selected.sourceHash);
});

test('selecting an uncached version clears old details and excludes other account, game and branch caches', async () => {
  const { app } = harness({ request: async () => { throw new Error('Network unavailable'); } });
  const selected = version({ id: 'weekly-2', sourceHash: hash('c') });
  app.managedVersions.push(selected);
  const cache = { ...selected, accountId: 'alice', catalogVersionId: selected.id,
    details: { version: selected, teams: [team()] } };
  app.localVersions = [{ ...cache, accountId: 'bob' }, { ...cache, game: 'poe1' }, { ...cache, branchId: 'release' }];
  await app.managedReadDetails(selected.id);
  assert.equal(app.managedVersionDetails, null);
  assert.equal(app.managedSelectedVersion.id, selected.id);
});

test('selected version computation ignores details for another selected ID', () => {
  const { app } = harness();
  app.managedVersions.push(version({ id: 'weekly-2' })); app.selectedManagedVersionId = 'weekly-2';
  assert.equal(app.managedSelectedVersion.id, 'weekly-2');
});

test('same-version detail polls retain settled content until a successful response and on failure', async () => {
  for (const succeeds of [true, false]) {
    const gate = deferred(), { app } = harness({ request: () => gate.promise });
    const details = app.managedVersionDetails;
    const pending = app.managedReadDetails('weekly-1', false);
    assert.equal(app.managedVersionDetails, details);
    if (succeeds) gate.resolve({ version: version(), teams: [team({ ended: true })] });
    else gate.reject(new Error('Network unavailable'));
    await pending;
    if (succeeds) assert.equal(app.managedVersionDetails.teams[0].ended, true);
    else assert.equal(app.managedVersionDetails, details);
    assert.equal(app.managedSelectedVersion.id, 'weekly-1');
  }
});

test('background failures retain the catalog, details, focus and active editing state', async () => {
  const { app } = harness({ request: async () => { throw new Error('Network unavailable'); } });
  const versions = app.managedVersions, details = app.managedVersionDetails, draft = { text: 'Typing' };
  app._draftSession = draft; app.editorSessionActive = true; app.editorVisible = true;
  await app.refreshManagedVersions();
  assert.equal(app.managedVersions, versions); assert.equal(app.managedVersionDetails, details);
  assert.equal(app._draftSession, draft); assert.equal(app.editorVisible, true);
  assert.equal(app.managedVersionError, 'Network unavailable'); assert.equal(app.managedVersionsUnavailable, true);
});

test('ended warning is accepted once per scope and collection while denied warnings remain retryable', async () => {
  const { app } = harness(); let prompts = 0, accepted = false;
  app.managedActiveDetails = { version: version(), teams: [team({ ended: true, latestCollection: { id: 'collection-1' } })] };
  app.appConfirm = async () => { prompts++; return accepted; };
  assert.equal(await app.managedWarnBeforeEdit(), false); assert.equal(prompts, 1);
  accepted = true;
  assert.equal(await app.managedWarnBeforeEdit(), true); assert.equal(prompts, 2);
  assert.equal(await app.managedWarnBeforeEdit(), true); assert.equal(prompts, 2);
  app.managedActiveDetails.teams[0].latestCollection.id = 'collection-2';
  assert.equal(await app.managedWarnBeforeEdit(), true); assert.equal(prompts, 3);
  app.lang = 'German'; app.managedActiveDetails.teams.push(team({ language: 'German', ended: true }));
  assert.equal(await app.managedWarnBeforeEdit(), true); assert.equal(prompts, 4);
});

test('simultaneous ended edit attempts share one warning dialog', async () => {
  const { app } = harness(), gate = deferred(); let prompts = 0;
  app.managedActiveDetails = { version: version(), teams: [team({ ended: true })] };
  app.appConfirm = () => { prompts++; return gate.promise; };
  const first = app.managedWarnBeforeEdit(), second = app.managedWarnBeforeEdit();
  assert.equal(prompts, 1); gate.resolve(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});

test('withdrawing the active translator version retains its recovery context outside ordinary listings', async () => {
  const withdrawn = version({ status: 'withdrawn', isHead: false });
  const { app } = harness({ request: async route => {
    if (route.startsWith('/v1/versions?')) return { branch: { id: 'default' }, versions: [] };
    if (route === '/v1/versions/weekly-1') return { version: withdrawn, teams: [team()] };
    throw new Error('Unexpected request: ' + route);
  } });
  app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'translator'; app.activeManagedVersionId = 'weekly-1';
  app.managedActiveDetails = { version: version(), teams: [team()] };
  await app.refreshManagedVersions();
  await settle();
  assert.equal(app.managedVisibleVersions.length, 0);
  assert.equal(app.managedActiveVersion?.id, 'weekly-1'); assert.equal(app.managedActiveVersion?.status, 'withdrawn');
  let prompts = 0; app.appConfirm = async () => { prompts++; return true; };
  assert.equal(await app.managedWarnBeforeEdit(), true); assert.equal(prompts, 1);
});

test('collection polls durable API building jobs before downloading the immutable ready ZIP', async () => {
  const { app, requests, events } = harness({ request: async route => {
    if (route.endsWith('/collections')) return { collection: { id: 'collection-1', status: 'building', downloadReady: false } };
    if (route === '/v1/collections/collection-1') return { collection: { id: 'collection-1', status: 'ready', downloadReady: true, fileCount: 20 } };
    throw new Error('Unexpected request: ' + route);
  } });
  app.managedDownload = async (route, name) => { events.push({ type: 'collectionDownload', route, name }); };
  app.managedReadDetails = async () => {}; app.refreshManagedVersions = async () => {};
  await app.managedCollect(team());
  assert.deepEqual(requests.map(request => request.route), ['/v1/versions/weekly-1/teams/Thai/collections', '/v1/collections/collection-1']);
  const download = events.find(event => event.type === 'collectionDownload');
  assert.equal(download?.route, '/v1/collections/collection-1/archive');
  assert.equal(download?.name, '2026-10-05_POE2_Translated_Thai.zip');
  assert.equal(app.managedVersionBusy, false);
});

test('the immutable collection file count controls downloading when displayed Saved counts are stale', async () => {
  const { app, events } = harness({ request: async () => ({ collection: { id: 'collection-1', status: 'ready', downloadReady: true, fileCount: 1 } }) });
  app.managedDownload = async (route, name) => { events.push({ type: 'collectionDownload', route, name }); return true; };
  app.managedReadDetails = async () => {}; app.refreshManagedVersions = async () => {};
  await app.managedCollect(team({ counts: { loaded: 100, saved: 0 } }));
  assert.equal(events.filter(event => event.type === 'collectionDownload').length, 1);
});

test('uncertain collection requests retry their id and recollection gets a new id', async () => {
  let attempts = 0;
  const { app, requests } = harness({ request: async () => {
    if (++attempts === 1) throw new Error('Response lost after commit');
    return { collection: { id: 'collection-' + attempts, status: 'ready', downloadReady: false, fileCount: 0 } };
  } });
  app.managedReadDetails = async () => {}; app.refreshManagedVersions = async () => {};
  const zero = team({ counts: { loaded: 100, saved: 0 } });
  await app.managedCollect(zero); assert.match(app.managedVisibleError, /Response lost/);
  await app.managedCollect(zero); await app.managedCollect(zero);
  const keys = requests.map(request => request.options.body.idempotencyKey);
  assert.equal(keys.length, 3); assert.equal(keys[0], keys[1]); assert.notEqual(keys[1], keys[2]);
});

test('failed collection jobs retain the same id and current ended status for retry', async () => {
  const { app, requests } = harness({ request: async () => ({ collection: { id: 'collection-1', status: 'failed', error: { message: 'ZIP generation failed' } } }) });
  const before = copy(app.managedVersionDetails);
  await app.managedCollect(team()); await app.managedCollect(team());
  assert.equal(requests[0].options.body.idempotencyKey, requests[1].options.body.idempotencyKey);
  assert.deepEqual(app.managedVersionDetails, before);
  assert.equal(app.managedVisibleError, 'ZIP generation failed'); assert.equal(app.managedVersionBusy, false);
});

test('a healthy catalog refresh does not clear an unresolved collection failure', async () => {
  const { app } = harness({ request: async route => {
    if (route.endsWith('/collections')) return { collection: { id: 'collection-1', status: 'failed', error: { message: 'ZIP generation failed' } } };
    if (route.startsWith('/v1/versions?')) return { branch: { id: 'default' }, versions: [version()] };
    if (route === '/v1/versions/weekly-1') return { version: version(), teams: [team()] };
    throw new Error('Unexpected request: ' + route);
  } });
  await app.managedCollect(team());
  assert.equal(app.managedVisibleError, 'ZIP generation failed');
  await app.refreshManagedVersions();
  assert.equal(app.managedVisibleError, 'ZIP generation failed');
});

async function gameArchive(game) {
  const zip = new JSZip();
  zip.file(game === 'poe2' ? 'specific_skill_stat_descriptions/explosive_grenade/damage.txt' : 'stat_descriptions/damage.txt', 'description damage');
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('manager uploads reject either other game before creating or sending an upload', async t => {
  for (const game of ['poe1', 'poe2']) for (const resume of [false, true]) await t.test(game + (resume ? ' resumed' : ' new'), async () => {
    const writes = [], { app, events, requests } = harness({ window: { JSZip }, storage: {
      async setVersionUpload(scope, value) { writes.push({ scope, value }); },
    } });
    app.gameVersion = game;
    app.managedUploadFile = await gameArchive(game === 'poe1' ? 'poe2' : 'poe1');
    if (resume) app.managedUpload = { id: 'existing-upload', status: 'awaiting_archive', game };
    const upload = app.managedUpload, source = app.localDescs;
    await app.prepareManagedUpload();
    const expectedLabel = game === 'poe1' ? 'PoE1' : 'PoE2', otherLabel = game === 'poe1' ? 'PoE2' : 'PoE1';
    assert.equal(app.managedUploadError, `This ZIP is for ${otherLabel}, but this upload is for ${expectedLabel}. Select a ${expectedLabel} StatDescriptions.zip.`);
    assert.equal(requests.length, 0); assert.equal(writes.length, 0);
    assert.equal(app.managedUpload, upload); assert.equal(app.localDescs, source); assert.equal(app.gameVersion, game);
    assert.equal(events.some(event => event.type === 'confirm'), false);
    assert.equal(app.managedVersionBusy, false); assert.equal(events.at(-1).type, 'clearWork');
  });
});

test('matching game uploads proceed through creation, archive transfer and preparation', async t => {
  for (const game of ['poe1', 'poe2']) await t.test(game, async () => {
    const { app, requests } = harness({ window: { JSZip }, request: async route => {
      if (route === '/v1/version-uploads') return { upload: { id: 'matching-upload', status: 'awaiting_archive' } };
      if (route.endsWith('/archive')) return { upload: { id: 'matching-upload', status: 'uploaded' } };
      if (route.endsWith('/prepare')) return { upload: { id: 'matching-upload', status: 'prepared' } };
      throw new Error('Unexpected request: ' + route);
    } });
    app.gameVersion = game; app.managedUploadFile = await gameArchive(game);
    app.managedUploadName = 'Weekly release'; app.managedUploadDeadline = '2026-10-12T09:00';
    await app.prepareManagedUpload();
    assert.equal(app.managedUploadError, ''); assert.equal(app.managedUpload.status, 'prepared');
    assert.equal(requests.length, 3); assert.equal(requests[0].options.body.game, game);
    assert.equal(app.gameVersion, game); assert.equal(app.managedVersionBusy, false);
  });
});

test('invalid ZIPs and directory-only text markers cannot start a manager upload', async t => {
  const directories = new JSZip(); directories.folder('specific_skill_stat_descriptions/explosive_grenade.txt');
  for (const file of [Buffer.from('invalid zip'), await directories.generateAsync({ type: 'nodebuffer' })]) await t.test('invalid input', async () => {
    const { app, requests } = harness({ window: { JSZip } }); app.managedUploadFile = file;
    await app.prepareManagedUpload();
    assert.match(app.managedUploadError, /Cannot open this ZIP|No \.txt files/);
    assert.equal(requests.length, 0); assert.equal(app.managedUpload, null); assert.equal(app.managedVersionBusy, false);
  });
});

test('switching account or game during ZIP inspection cancels the upload before persistence', async t => {
  for (const change of [app => { app.cloudProfileId = 'bob'; }, app => { app.gameVersion = 'poe1'; }]) await t.test('scope switch', async () => {
    const gate = deferred(), writes = [], { app, requests } = harness({ window: { JSZip: { loadAsync: () => gate.promise } }, storage: {
      async setVersionUpload(scope, value) { writes.push({ scope, value }); },
    } });
    app.managedUploadFile = {};
    const pending = app.prepareManagedUpload(); await settle(); change(app);
    gate.resolve(await JSZip.loadAsync(await gameArchive('poe2'))); await pending;
    assert.equal(requests.length, 0); assert.equal(writes.length, 0); assert.equal(app.managedUploadError, '');
  });
});

test('uncertain upload creation retries the same durable creation request', async () => {
  let creates = 0;
  const { app, requests } = harness({ request: async route => {
    if (route === '/v1/version-uploads') {
      if (++creates === 1) throw new Error('Upload response lost after commit');
      return { upload: { id: 'upload-1', status: 'awaiting_archive', duplicateGroups: [] } };
    }
    if (route.endsWith('/archive')) return { upload: { id: 'upload-1', status: 'uploaded', duplicateGroups: [] } };
    if (route.endsWith('/prepare')) return { upload: { id: 'upload-1', status: 'prepared', duplicateGroups: [] } };
    throw new Error('Unexpected request: ' + route);
  } });
  app.managedUploadFile = { name: 'StatDescriptions.zip', size: 100 };
  app.managedUploadName = '2026-10-05_POE2'; app.managedUploadDeadline = '2026-10-12T09:00';
  await app.prepareManagedUpload(); assert.match(app.managedUploadError, /response lost/);
  await app.prepareManagedUpload();
  const creationRequests = requests.filter(request => request.route === '/v1/version-uploads');
  assert.equal(creationRequests.length, 2);
  assert.equal(creationRequests[0].options.body.idempotencyKey, creationRequests[1].options.body.idempotencyKey);
  assert.equal(app.managedUpload.status, 'prepared');
});

test('reloading after a lost collection acknowledgement reuses the persisted request id', async () => {
  const durable = new Map();
  const key = (scope, versionId, language) => JSON.stringify([scope.accountId, scope.game, scope.branchId, versionId, language]);
  const storage = {
    async getVersionCollectionRequest(scope, versionId, language) { return durable.get(key(scope, versionId, language)); },
    async setVersionCollectionRequest(scope, versionId, language, requestId) {
      const selected = key(scope, versionId, language);
      if (requestId == null) durable.delete(selected); else durable.set(selected, requestId);
    },
  };
  const first = harness({ storage, window: { crypto: { randomUUID: () => 'persisted-first-request' } },
    request: async () => { throw new Error('Collection committed, acknowledgement lost'); } });
  const zero = team({ counts: { loaded: 100, saved: 0 } });
  await first.app.managedCollect(zero);
  assert.equal(durable.size, 1);
  const reloaded = harness({ storage, window: { crypto: { randomUUID: () => 'new-second-request' } },
    request: async () => ({ collection: { id: 'committed-original-collection', status: 'ready', downloadReady: false, fileCount: 0 } }) });
  reloaded.app.managedReadDetails = async () => {}; reloaded.app.refreshManagedVersions = async () => {};
  await reloaded.app.managedCollect(zero);
  assert.equal(reloaded.requests[0].options.body.idempotencyKey, first.requests[0].options.body.idempotencyKey);
  assert.equal(durable.size, 0);
});

test('scope changes while recovering a collection id cannot write that id under another account', async () => {
  const gate = deferred(), writes = [];
  const { app, requests } = harness({ storage: {
    getVersionCollectionRequest: () => gate.promise,
    async setVersionCollectionRequest(scope, versionId, language, requestId) { writes.push({ scope: copy(scope), requestId }); },
  } });
  const pending = app.managedCollect(team()); await settle();
  app.cloudProfileId = 'bob'; gate.resolve('alice-original-request'); await pending;
  assert.equal(requests.length, 0);
  assert.equal(writes.some(write => write.scope.accountId === 'bob'), false);
});

test('a published upload recovery is deferred until its modal opens, then clears the durable receipt and selects the existing entry', async () => {
  const writes = [];
  const saved = { id: 'upload-finished', name: 'Weekly release', deadlineAt: '2026-10-11T20:00:00.000Z',
    createRequestId: 'create-original', publishRequestId: 'publish-original', status: 'prepared' };
  const { app, requests } = harness({ storage: {
    async getVersionUpload() { return copy(saved); },
    async setVersionUpload(scope, value) { writes.push({ scope: copy(scope), value: copy(value) }); },
  }, request: async route => {
    assert.equal(route, '/v1/version-uploads/upload-finished');
    return { upload: { ...saved, status: 'published', publishedVersionId: 'already-published' } };
  } });
  app.refreshManagedVersions = async () => {};
  await app.managedScopeChanged();
  assert.equal(requests.length, 0, 'Catalog entry restores only the small local receipt.');
  assert.equal(app.managedUpload.id, 'upload-finished');
  assert.equal(writes.length, 0);
  await app.openManagedUpload();
  assert.equal(app.managedUpload, null); assert.equal(app.selectedManagedVersionId, 'already-published');
  assert.equal(app._managedCreateId, null); assert.equal(app._managedPublishId, null);
  assert.equal(writes.length, 1); assert.equal(writes[0].value, null); assert.equal(writes[0].scope.accountId, 'alice');
  assert.equal(requests.length, 1, 'Recovery never starts another prepare or publication.');
});

test('account and branch changes clear previous upload IDs, collection IDs and cached team details before loading', async () => {
  const gate = deferred(), { app } = harness({ storage: { listLocalVersions: () => gate.promise } });
  app._managedCreateId = 'alice-create'; app._managedPublishId = 'alice-publish';
  app._managedCollectionIds = new Map([['old-team', 'alice-collect']]);
  app.localVersions = [{ ...version(), details: { version: version(), teams: [team({ language: 'German' })] } }];
  app.managedDuplicateVersion = version(); app.managedVersionBusy = true;
  app.refreshManagedVersions = async () => {};
  const pending = app.managedScopeChanged();
  assert.equal(app._managedCreateId, null); assert.equal(app._managedPublishId, null);
  assert.equal(app._managedCollectionIds.size, 0); assert.equal(app.localVersions.length, 0);
  assert.equal(app.managedDuplicateVersion, null); assert.equal(app.managedVersionBusy, false);
  gate.resolve([]); await pending;
});

test('stale manual operation completion cannot clear a newer scope operation busy state or spinner', async t => {
  for (const method of ['continueManagedVersion', 'managedCollect', 'managedAction', 'managedWithdraw', 'saveManagedMetadata', 'prepareManagedUpload', 'publishManagedUpload']) {
    await t.test(method, async () => {
      const oldGate = deferred(), newGate = deferred();
      const { app, events } = harness({ storage: { getVersionSource: () => oldGate.promise }, request: () => oldGate.promise });
      app.managedUploadName = 'Weekly'; app.managedUploadDeadline = '2026-10-12T09:00'; app.managedUploadFile = { name: 'StatDescriptions.zip' };
      app.managedMetadataName = 'Weekly'; app.managedMetadataDeadline = '2026-10-12T09:00';
      if (method === 'publishManagedUpload') app.managedUpload = { id: 'old-upload', status: 'prepared', parentVersionId: null };
      const args = method === 'managedAction' ? ['/old/action', {}] : method === 'managedCollect' ? [team()] : method === 'managedWithdraw' ? [version()] : [];
      const old = app[method](...args); await settle();
      app.cloudProfileId = 'bob'; app.cloudUser = { ...app.cloudUser, id: 'bob' };
      app.refreshManagedVersions = async () => {};
      await app.managedScopeChanged();
      app._cloud.request = () => newGate.promise;
      const newer = app.managedAction('/new/action', {}); await settle();
      const clearCount = events.filter(event => event.type === 'clearWork').length;
      oldGate.resolve({ version: version(), upload: { id: 'old-upload', status: 'prepared' }, collection: { id: 'old-collection', status: 'ready', fileCount: 0 } });
      await old;
      assert.equal(app.managedVersionBusy, true);
      assert.equal(events.filter(event => event.type === 'clearWork').length, clearCount);
      newGate.resolve({}); await newer; assert.equal(app.managedVersionBusy, false);
    });
  }
});

test('a failed collected ZIP download retains the request ID so retry downloads the same cutoff', async () => {
  const writes = [], { app, requests } = harness({ storage: {
    async setVersionCollectionRequest(scope, versionId, language, value) { writes.push(value); },
  }, request: async () => ({ collection: { id: 'same-cutoff', status: 'ready', fileCount: 1, downloadReady: true } }) });
  app.managedReadDetails = async () => {}; app.refreshManagedVersions = async () => {};
  app.managedDownload = async () => false;
  await app.managedCollect(team()); assert.equal(writes.includes(null), false);
  app.managedDownload = async () => true;
  await app.managedCollect(team());
  assert.equal(requests[0].options.body.idempotencyKey, requests[1].options.body.idempotencyKey);
  assert.equal(writes.at(-1), null);
});

test('pre-upgrade durable collection IDs recover their original archive cutoff without changing the operation', async () => {
  for (const endWindow of [true, false]) {
    const { app, requests, events } = harness({ storage: { async getVersionCollectionRequest() { return 'old-committed-request'; } },
      request: async (route, options) => {
        if (options.body.format) throw Object.assign(new Error('The request identifier was already used for different data.'), { status: 409, code: 'IDEMPOTENCY_REUSED' });
        return { collection: { id: 'old-cutoff', status: 'ready', downloadReady: true, fileCount: 1, format: 'archive' } };
      } });
    app.managedDownload = async route => { events.push({ type: 'legacyDownload', route }); return true; };
    app.managedReadDetails = async () => {}; app.refreshManagedVersions = async () => {};
    await app.managedCollect(team(), endWindow);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.body.idempotencyKey, 'old-committed-request');
    assert.equal(requests[1].options.body.idempotencyKey, 'old-committed-request');
    assert.equal(requests[1].options.body.format, undefined);
    assert.equal(requests[1].route, requests[0].route);
    assert.equal(requests[1].options.body.endWindow, endWindow ? undefined : false);
    assert.equal(events.find(event => event.type === 'legacyDownload').route, '/v1/collections/old-cutoff/archive');
  }
});

test('older APIs reject manifest format before mutation and safely receive the same archive request ID', async () => {
  const { app, requests } = harness({ request: async (route, options) => {
    if (options.body.format) throw Object.assign(new Error('The request contains unsupported fields.'), { status: 400, code: 'INVALID_REQUEST' });
    return { collection: { id: 'older-api-cutoff', status: 'ready', downloadReady: false, fileCount: 0 } };
  } });
  app.managedReadDetails = async () => {}; app.refreshManagedVersions = async () => {};
  await app.managedCollect(team({ counts: { saved: 0 } }));
  assert.equal(requests.length, 2); assert.equal(requests[0].options.body.idempotencyKey, requests[1].options.body.idempotencyKey);
  assert.equal(requests[1].options.body.format, undefined); assert.equal(app.managedVisibleError, '');
});

test('cached ended teams warn offline and a downgraded translator cannot inspect another cached team', async () => {
  const { app } = harness();
  app.managedActiveDetails = null; app.managedVersionDetails = null;
  app.localVersions = [{ ...version(), catalogVersionId: 'weekly-1', details: { version: version(),
    teams: [team({ ended: true }), team({ language: 'German', ended: true })] } }];
  app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'translator';
  assert.equal(app.managedActiveTeam.ended, true);
  let prompts = 0; app.appConfirm = async () => { prompts++; return false; };
  assert.equal(await app.managedWarnBeforeEdit(), false); assert.equal(prompts, 1);
  app.lang = 'German'; assert.equal(app.managedActiveTeam, null);
});

test('restore fills an empty branch HEAD with a null compare-and-swap guard and preserves an existing HEAD', async () => {
  for (const head of [null, 'other-head']) {
    const { app, requests } = harness({ request: async () => ({}) });
    app.managedBranch = { headVersionId: head }; app.refreshManagedVersions = async () => {};
    await app.managedRestore(version({ status: 'withdrawn' }));
    assert.equal(requests[0].options.body.setHead, head === null);
    assert.equal(requests[0].options.body.expectedHeadId, head);
  }
});

test('opening another game or branch version refuses to import or activate it in the current scope', async () => {
  for (const incompatible of [version({ game: 'poe1' }), version({ branchId: 'release' })]) {
    const { app, events, requests } = harness();
    assert.equal(await app.continueManagedVersion(incompatible), false);
    assert.equal(events.length, 0); assert.equal(requests.length, 0);
    assert.match(app.managedVisibleError, /current game and branch/);
  }
});

test('duplicate upload conflicts retain the published entry for explicit navigation and restoration', async () => {
  const duplicate = version({ status: 'withdrawn' });
  const { app } = harness({ request: async () => { throw Object.assign(new Error('ZIP already published'), { details: { version: duplicate } }); } });
  app.managedUpload = { id: 'duplicate-upload', status: 'uploaded', duplicateGroups: [] };
  await app.prepareManagedUpload(); assert.equal(app.managedDuplicateVersion.id, duplicate.id);
  let opened; app.managedReadDetails = async versionId => { opened = versionId; };
  await app.managedOpenDuplicateVersion();
  assert.equal(opened, duplicate.id); assert.equal(app.managedShowWithdrawn, true); assert.equal(app.versionChooserVisible, true);
});

test('an assignment update during account loading cannot mark an unloaded owner as already active', async () => {
  const firstLoad = deferred(), { app } = harness(); let loads = 0;
  app._managedWorkspaceOwner = JSON.stringify(['alice', 'poe2', 'default']);
  app.cloudProfileId = 'bob'; app.cloudUser = { ...app.cloudUser, id: 'bob' };
  app.refreshManagedVersions = async () => {};
  app.loadVersionedStorage = async () => { if (++loads === 1) await firstLoad.promise; };
  const old = app.managedScopeChanged(); await settle(); assert.equal(loads, 1);
  assert.equal(JSON.parse(app._managedWorkspaceOwner)[0], 'alice');
  app.cloudUser.assignmentVersion++;
  await app.managedScopeChanged(); assert.equal(loads, 2);
  assert.equal(JSON.parse(app._managedWorkspaceOwner)[0], 'bob');
  firstLoad.resolve(); await old; assert.equal(JSON.parse(app._managedWorkspaceOwner)[0], 'bob');
});

test('resumed upload dialogs focus an enabled modal control when the version-name field is disabled', () => {
  let focused = '';
  const requested = { disabled: true, focus() { focused = 'disabled-name'; },
    closest() { return { querySelector() { return { focus() { focused = 'modal-button'; } }; } }; } };
  const { app } = harness({ document: { activeElement: {}, getElementById() { return requested; } } });
  app.$nextTick = callback => callback();
  app.managedModalVisibility(true, 'managerUploadName'); assert.equal(focused, 'modal-button');
  requested.disabled = false; app.managedModalVisibility(true, 'managerUploadName'); assert.equal(focused, 'disabled-name');
});
