const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Managed = require('../public/managedVersions.js');

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

test('withdrawing the active translator version retains its recovery banner outside ordinary listings', async () => {
  const withdrawn = version({ status: 'withdrawn', isHead: false });
  const { app } = harness({ request: async route => {
    if (route.startsWith('/v1/versions?')) return { branch: { id: 'default' }, versions: [] };
    if (route === '/v1/versions/weekly-1') return { version: withdrawn, teams: [team()] };
    throw new Error('Unexpected request: ' + route);
  } });
  app.cloudCanAccessAllLanguages = false; app.cloudUser.role = 'translator'; app.activeManagedVersionId = 'weekly-1';
  app.managedActiveDetails = { version: version(), teams: [team()] };
  await app.refreshManagedVersions();
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

test('a published upload recovered after a lost response clears its durable receipt and selects the existing catalog entry', async () => {
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
