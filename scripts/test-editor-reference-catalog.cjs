const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const publicDir = path.join(__dirname, '..', 'public');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const sd = (text = 'Blade damage', target = 'Saved blade') => ({ filepath: 'same.txt', translations: { English: [text], Thai: [target] }, stats: ['blade_damage'] });
const unit = (target = 'Original') => ({ id: '["normal","Sheet","same"]', role: 'normal', sheet: 'Sheet', recordId: 'same',
  developerNotes: 'Developer note', fields: [{ id: 'Text', name: 'Text', kind: 'text', source: 'Blade damage', target }] });
function harness(options = {}) {
  const window = { ContentAdapters: require('../public/contentAdapters.js'), ...options.window };
  const context = vm.createContext({ window, AbortController, setTimeout, clearTimeout });
  for (const name of ['editorReferenceCatalog.js', 'editorLookup.js']) vm.runInContext(fs.readFileSync(path.join(publicDir, name), 'utf8'), context, { filename: name });
  const api = window.EditorLookup;
  const session = { mode: 'statdescription', language: 'Thai', tool: 'lookup', toolsVisible: true,
    scope: { accountId: 'alice', game: 'poe2', branchId: 'default', versionId: 'release', groupId: 'sd', sourceHash: 'baseline' },
    version: { id: 'release', game: 'poe2', branchId: 'default', contentGroups: [] },
    group: { id: 'sd', versionId: 'release', contentMode: 'statdescription' }, ...options.session };
  const host = Object.assign(api.mixin.data(), api.mixin.methods, {
    descs: [sd()], localDescs: { descs: [] }, lang: 'Thai', sideTab: 'dictionary', editorToolsVisible: false,
    editorBlocks: [{ translation: 'Never a reference draft' }], ctValues: { Text: 'Never a ClientText draft' },
    editorLookupSession: () => session, managedOnlineAvailable: false,
    $refs: {}, $nextTick(callback) { callback?.(); return Promise.resolve(); },
  }, options.host);
  for (const [name, getter] of Object.entries(api.mixin.computed)) Object.defineProperty(host, name, { get: () => getter.call(host) });
  return { window, host, session, api, catalog: window.EditorReferenceCatalog.create(host) };
}
test('mixed references have composite identities and retain exact ClientText raw values', () => {
  const { api } = harness(), text = 'Literal \\n, actual\r\nline@column <img>', original = unit(text);
  original.fields[0].source = text;
  const sources = ['first', 'second'].flatMap(groupId => [
    { mode: 'statdescription', scope: { groupId }, groupId, descs: [sd()], workspace: null },
    { mode: 'clienttext', scope: { groupId }, groupId, language: 'Thai', units: [original], saved: { [original.id]: { values: { Text: text + ' saved' } } } },
  ]);
  const entries = api.buildCatalogIndex(sources, 'Thai');
  assert.equal(entries.length, 4); assert.equal(new Set(entries.map(entry => entry.key)).size, 4);
  const ct = entries.find(entry => entry.mode === 'clienttext');
  assert.equal(ct.reference.blocks[0].english, text); assert.equal(ct.reference.blocks[0].translation, text + ' saved');
  assert.equal(ct.reference.blocks[0].isTable, false); assert.deepEqual(plain(ct.reference.blocks[0].englishColumns), [text]);
  assert.equal(ct.reference.developerNotes, 'Developer note');
  assert.equal(api.searchIndex(entries, 'Developer note', 'metadata', false, true).length, 2);
  assert.equal(api.searchIndex(entries, '\\n', 'english', false, true).length, 2);
});
test('ClientText queries do not interpret literal backslash-n as an actual newline', () => {
  const { api } = harness(), literal = unit(), actual = unit();
  literal.id = 'literal'; literal.fields[0].source = 'A\\nB';
  actual.id = 'actual'; actual.fields[0].source = 'A\nB';
  const entries = api.buildCatalogIndex([{ mode: 'clienttext', scope: {}, language: 'Thai', units: [literal, actual], saved: {} }], 'Thai');
  assert.deepEqual(Array.from(api.searchIndex(entries, 'A\\nB', 'english', false, true), entry => entry.unit.id), ['literal']);
  assert.deepEqual(Array.from(api.searchIndex(entries, 'A B', 'english', false, true), entry => entry.unit.id), ['actual']);
  assert.deepEqual(Array.from(api.searchIndex(entries, '\\n', 'english', false, true), entry => entry.unit.id), ['literal']);
});
test('ClientText metadata lookup includes immutable Tags and Character Class keys and exact raw values', () => {
  const { api } = harness(), original = unit();
  original.metadata = { Tags: ' weapon\\nspell ', 'Character Class': '  Una\r\nRanger  ', 'Empty metadata': '' };
  const before = plain(original);
  const entries = api.buildCatalogIndex([{ mode: 'clienttext', scope: {}, language: 'Thai', units: [original], saved: {} }], 'Thai');
  for (const query of ['Tags', 'weapon\\nspell', 'Character Class', 'uNA rANger'])
    assert.equal(api.searchIndex(entries, query, 'metadata', false, true).length, 1, query + ' matches workbook metadata');
  assert.equal(api.searchIndex(entries, 'Una Ranger', 'english', false, true).length, 0);
  assert.deepEqual(plain(original), before, 'Metadata lookup cannot normalize or replace immutable raw cell values');
});
test('neutral CT session visibility controls Lookup without consulting SD fields or drafts', () => {
  const original = unit(), { host, session } = harness({ session: { mode: 'clienttext', group: { id: 'ct', contentMode: 'clienttext' } },
    host: { ctUnits: [original], ctSaved: { [original.id]: { values: { Text: 'Committed CT' } } } } });
  host.lookupQuery = 'Committed'; host.lookupApplySearch();
  assert.equal(host.lookupResults.length, 1); assert.equal(host.lookupResults[0].mode, 'clienttext');
  host.lookupSelect(host.lookupResults[0].key); assert.equal(host.lookupSelectedReference.blocks[0].translation, 'Committed CT');
  assert.equal(host.ctValues.Text, 'Never a ClientText draft'); assert.equal(host.editorBlocks[0].translation, 'Never a reference draft');
  host.lookupQuery = 'Never a'; host.lookupApplySearch(); assert.equal(host.lookupResults.length, 0);
  session.toolsVisible = false; assert.equal(host.lookupResults.length, 0);
});
test('mode/group filters and read-only references retain SD pagination and saved overlays', async () => {
  const { host, session } = harness();
  const rows = Array.from({ length: 23 }, (_, index) => ({ ...sd(), filepath: index + '.txt' }));
  host.lookupCatalogKey = host.lookupSessionKey;
  host.lookupCatalogSources = [{ mode: 'statdescription', scope: { groupId: 'sibling' }, groupId: 'sibling', descs: rows },
    { mode: 'clienttext', scope: { groupId: 'ct' }, groupId: 'ct', language: 'Thai', units: [unit()], saved: {} }];
  host.lookupQuery = 'Blade'; host.lookupApplySearch(); assert.equal(host.lookupResultCount, 24); assert.equal(host.lookupPageCount, 2);
  host.lookupModeFilter = 'clienttext'; host.lookupApplySearch(); assert.equal(host.lookupResultCount, 1);
  host.lookupSelect(host.lookupResults[0].key); assert.equal(host.lookupSelectedReference.blocks[0].translation, 'Original');
  host.lookupModeFilter = 'all'; host.lookupGroupFilter = 'sibling'; host.lookupApplySearch();
  assert.equal(host.lookupResultCount, 23); assert.equal(host.lookupSelectedKey, '');
  assert.equal(session.group.id, 'sd'); assert.equal(host.editorBlocks[0].translation, 'Never a reference draft');
});
test('cached catalog loads only authorized groups of the current release and captured account', async () => {
  const calls = [], original = unit();
  const { host, session, catalog } = harness({ host: { cloudSignedIn: true, cloudUser: { id: 'alice', language: 'Thai', role: 'translator' },
    _ctStore: { async getMetadata(scope) { calls.push(plain(scope)); return { state: 'ready' }; },
      async getUnits() { return [original]; }, async getSaved() { return { [original.id]: { values: { Text: 'Cached saved' } } }; } } } });
  session.version.contentGroups = [session.group, { id: 'ct', versionId: 'release', contentMode: 'clienttext', language: 'Thai' },
    { id: 'foreign-language', versionId: 'release', contentMode: 'clienttext', language: 'German' },
    { id: 'old-release', versionId: 'old', contentMode: 'clienttext', language: 'Thai' }];
  const result = await catalog.load(session, 'Thai');
  assert.deepEqual(Array.from(result.sources, source => source.groupId), ['sd', 'ct']);
  assert.equal(calls.length, 1); assert.equal(calls[0].accountId, 'alice'); assert.equal(calls[0].groupId, 'ct');
  assert.equal(result.missing.length, 0);
  const foreign = await catalog.load(session, 'German'); assert.equal(foreign.sources.length, 0); assert.equal(calls.length, 1);
});

test('catalog prepares generic context indexes for complete active and sibling workbook groups', async () => {
  const A = require('../public/contentAdapters.js'), builds = [], ref = 'Assets/Actors/Huntress';
  const dialogue = group => ({ id: group + '-dialogue', role: 'gender', sheet: 'Conversations', recordId: group + '-line',
    metadata: { Speaker: ref, Tags: 'ring, unknown' }, fields: [{ id: 'Text', name: 'Text', source: 'Greeting', target: '' }] });
  const records = (group, name) => [dialogue(group),
    { id: group + '-actor', role: 'normal', sheet: 'Actors', recordId: ref,
      fields: [{ id: 'Title', name: 'Title', source: name, target: 'Translated title', sourceCell: 'B10' }] },
    { id: group + '-ring', role: 'normal', sheet: 'RelatedItems', recordId: 'ring',
      fields: [{ id: 'Label', name: 'Label', source: 'Rings', target: '', sourceCell: 'C3' }] }];
  const activeUnits = records('active', 'Huntress'), siblingUnits = records('sibling', 'Different English label');
  const before = JSON.stringify([activeUnits, siblingUnits]);
  const { host, session, catalog, api, window } = harness({
    window: { ContentAdapters: { ...A, clienttext: { ...A.clienttext,
      async contextReferenceIndex(units, options) { builds.push(units); assert.ok(options.guard()); return A.clienttext.contextReferenceIndex(units, options); } } } },
    session: { mode: 'clienttext', group: { id: 'active', versionId: 'release', contentMode: 'clienttext', language: 'Thai' },
      scope: { accountId: 'alice', game: 'poe2', branchId: 'default', versionId: 'release', groupId: 'active' } },
    host: { ctUnits: activeUnits, ctSaved: {}, _ctStore: { async getMetadata() { return { state: 'ready' }; },
      async getUnits() { return siblingUnits; }, async getSaved() { return {}; } } },
  });
  session.version.contentGroups = [session.group, { id: 'sibling', versionId: 'release', contentMode: 'clienttext', language: 'Thai' }];
  const result = await catalog.load(session, 'Thai');
  assert.deepEqual(builds, [activeUnits, siblingUnits]);
  assert.notEqual(result.sources[0].contextReferences, result.sources[1].contextReferences);
  assert.equal(result.sources[0].contextReferences.size, 2);
  assert.equal(result.sources[0].contextReferences, window.EditorReferenceCatalog.activeSource(host, session, 'Thai').contextReferences);
  for (const source of result.sources) {
    const entry = api.buildCatalogIndex([source], 'Thai').find(entry => entry.unit.id === source.groupId + '-dialogue');
    const speaker = entry.reference.referenceMetadata[0];
    assert.equal(speaker.display, source.groupId === 'active' ? 'Huntress' : 'Different English label');
    assert.ok(speaker.parts[0].tooltip.includes('Actors!B10'));
    assert.ok(speaker.parts[0].tooltip.includes('normal workbook'));
    const tags = entry.reference.referenceMetadata[1];
    assert.equal(tags.value, 'ring, unknown'); assert.equal(tags.parts.map(part => part.text).join(''), 'ring, unknown');
    assert.ok(tags.parts[0].tooltip.includes('Rings'));
  }
  await catalog.load(session, 'Thai'); assert.equal(builds.length, 2, 'Repeated loads reuse indexes for unchanged immutable units');
  assert.equal(JSON.stringify([activeUnits, siblingUnits]), before);
});

test('late context index preparation cannot publish into a replacement Lookup session', async () => {
  const entered = deferred(), pending = deferred(), original = unit(); let guard;
  const { host, session } = harness({ session: { mode: 'clienttext', group: { id: 'ct', contentMode: 'clienttext' } },
    host: { ctUnits: [original], ctSaved: {} }, window: { ContentAdapters: { clienttext: {
      cachedContextReferenceIndex() {}, async contextReferenceIndex(_units, options) {
        guard = options.guard; assert.ok(guard()); entered.resolve(); await pending.promise; return new Map();
      } } } } });
  const loading = host.lookupLoadCatalog(); await entered.promise;
  session.language = 'German'; assert.equal(guard(), false); pending.resolve();
  assert.equal(await loading, false); assert.equal(host.lookupCatalogSources.length, 0);
});

test('catalog reuses verified sibling originals across fresh storage arrays and refreshes Saved overlays', async () => {
  const A = require('../public/contentAdapters.js'); let reads = 0, signature = 'first-original', saved = 'First saved';
  const row = { ...unit(), metadata: { Context: 'Assets/Person' } };
  const target = { id: 'person', recordId: 'Assets/Person', role: 'normal', sheet: 'People',
    fields: [{ id: 'Name', name: 'Name', source: 'Huntress', target: '', sourceCell: 'B2' }] };
  const units = [row, target];
  const { session, catalog } = harness({ host: { _ctStore: {
    async getMetadata() { return { state: 'ready', signature }; },
    async getUnits() { reads++; return [...units]; },
    async getSaved() { return { [row.id]: { values: { Text: saved } } }; },
  } } });
  session.version.contentGroups = [{ id: 'ct', versionId: 'release', contentMode: 'clienttext', language: 'Thai' }];
  const initial = (await catalog.load(session, 'Thai')).sources[1];
  assert.equal(reads, 1); assert.equal(initial.contextReferences, A.clienttext.cachedContextReferenceIndex(initial.units));
  saved = '';
  const refreshed = (await catalog.load(session, 'Thai')).sources[1];
  assert.equal(refreshed.units, initial.units); assert.equal(refreshed.contextReferences, initial.contextReferences);
  assert.equal(reads, 1); assert.equal(refreshed.saved[row.id].values.Text, '', 'Committed blank overlay must refresh');
  signature = 'replacement-original';
  const replacement = (await catalog.load(session, 'Thai')).sources[1];
  assert.equal(reads, 2); assert.notEqual(replacement.units, initial.units); assert.notEqual(replacement.contextReferences, initial.contextReferences);
});
test('standalone imported content searches only the active mode without reading sibling storage', async () => {
  const { host, session, catalog } = harness({ session: { version: null, scope: { accountId: 'guest', game: 'poe2' } },
    host: { _ctStore: { getMetadata() { assert.fail('Standalone references must not traverse another mode'); } } } });
  host.managedActiveDetails = { version: { id: 'other' }, contentGroups: [{ id: 'ct', versionId: 'other', contentMode: 'clienttext', language: 'Thai' }] };
  const result = await catalog.load(session, 'Thai'); assert.equal(result.sources.length, 1); assert.equal(result.groups.length, 0);
});
test('late cached loads cannot publish across account, game, branch, version, mode, group, language or access changes', async () => {
  for (const change of ['account', 'game', 'branch', 'release', 'source', 'mode', 'group', 'language', 'access', 'generation']) {
    const pending = deferred(), entered = deferred();
    const { host, session } = harness({ host: { _ctStore: {
      async getMetadata() { return { state: 'ready' }; }, async getUnits() { entered.resolve(); return pending.promise; }, async getSaved() { return {}; } } } });
    session.version.contentGroups = [{ id: 'ct', versionId: 'release', contentMode: 'clienttext', language: 'Thai' }];
    const loading = host.lookupLoadCatalog(); await entered.promise;
    if (change === 'account') session.scope.accountId = 'bob';
    if (change === 'game') session.scope.game = 'poe1';
    if (change === 'branch') session.scope.branchId = 'alternate';
    if (change === 'release') session.version.id = 'next';
    if (change === 'source') session.scope.sourceHash = 'another-original';
    if (change === 'mode') session.mode = 'clienttext';
    if (change === 'group') session.group.id = session.scope.groupId = 'another';
    if (change === 'language') session.language = 'German';
    if (change === 'access') host.cloudUser = { id: 'alice', assignmentVersion: 2 };
    if (change === 'generation') session.generation = 1;
    pending.resolve([unit()]); assert.equal(await loading, false); assert.equal(host.lookupCatalogSources.length, 0);
  }
});
test('explicit workbook preparation reuses the cache service with isolated progress and no activation', async () => {
  const requests = [], progress = [], original = unit(); let ready = false;
  const { host, session, catalog } = harness({ host: { managedOnlineAvailable: true, ctBusy: false, ctProgress: 'untouched',
    _cloud: { async request(route) { requests.push(route); return { group: { id: 'ct', versionId: 'release', contentMode: 'clienttext', language: 'Thai' } }; } },
    _ctWorker: {}, _ctStore: { async getMetadata() { return ready ? { state: 'ready' } : undefined; }, async getUnits() { return [original]; }, async getSaved() { return {}; } },
    async ctCacheGroup(version, group, scope, options) {
      assert.notEqual(this, host); assert.equal(this.ctBusy, undefined); assert.equal(scope.accountId, 'alice');
      assert.equal(scope.language, 'Thai'); assert.equal(version.id, 'release'); assert.equal(group.id, 'ct');
      assert.ok(options.current()); this.ctReport({ phase: 'Parsed' }); ready = true;
    }, ctActivate() { assert.fail('Preparation must not activate'); }, ctOpenGroup() { assert.fail('Preparation must not open or join'); } } });
  session.version.contentGroups = [{ id: 'ct', versionId: 'release', contentMode: 'clienttext', language: 'Thai' }];
  const initial = await catalog.load(session, 'Thai'); assert.equal(initial.missing.length, 1); assert.equal(requests.length, 0);
  const result = await catalog.load(session, 'Thai', { prepare: true, onProgress: value => progress.push(value) });
  assert.equal(result.sources.length, 2); assert.equal(result.missing.length, 0); assert.equal(host.ctBusy, false); assert.equal(host.ctProgress, 'untouched');
  assert.equal(progress.length, 1); assert.equal(requests.length, 1); assert.equal(session.group.id, 'sd');
});
test('Vue-bound host cache methods cannot bypass the isolated preparation facade', async () => {
  let ready = false;
  const { session, catalog } = harness({ window: { ClientTextUI: { mixin: { methods: {
    async ctCacheGroup(_version, _group, _scope, options) {
      assert.equal(this.ctProgress, undefined); assert.ok(options.current()); this.ctReport({ phase: 'Parsed' }); ready = true;
    } } } } }, host: { managedOnlineAvailable: true, ctProgress: 'Preserved', _ctWorker: {},
      ctCacheGroup() { assert.fail('The Vue-bound editor method must not be invoked with a fake receiver'); },
      _cloud: { async request() { return { group: { id: 'ct', versionId: 'release', contentMode: 'clienttext', language: 'Thai' } }; } },
      _ctStore: { async getMetadata() { return ready ? { state: 'ready' } : null; }, async getUnits() { return [unit()]; }, async getSaved() { return {}; } } } });
  session.version.contentGroups = [{ id: 'ct', versionId: 'release', contentMode: 'clienttext', language: 'Thai' }];
  const result = await catalog.load(session, 'Thai', { prepare: true }); assert.equal(result.missing.length, 0);
});
test('prepared SD originals stay in a bounded release memory cache without persistence or room joins', async () => {
  let parsed = 0, downloaded = 0, saved = 'Local staged sibling';
  const descriptor = { baselineId: 'sibling-baseline', zipHash: 'verified' };
  const group = { id: 'sibling', versionId: 'release', contentMode: 'statdescription', assets: [{ role: 'source', descriptor }] };
  const { host, session, catalog } = harness({ window: { JSZip: {}, OfflineStore: {
      async getVersionSource() {}, async getVersionWorkspace() { return { descs: [{ ...sd(), translations: { Thai: [saved] } }] }; },
      saveSourceWorkspaceWithRevisions() { assert.fail('Reference preparation must not activate a source'); } },
    ManagedCollectionExports: { async parseOriginal(_blob, archive, language, _zip, options) {
      assert.equal(archive.baselineId, descriptor.baselineId); assert.equal(language, 'Thai'); assert.ok(options.current()); parsed++; return [sd()]; } } },
    host: { managedOnlineAvailable: true, _cloud: { async request(route) { downloaded++; return route.endsWith('/original') ? {} : { group }; } } } });
  session.version.contentGroups = [group];
  await catalog.load(session, 'Thai', { prepare: true }); assert.equal(parsed, 1); assert.equal(downloaded, 2);
  const retained = await catalog.load(session, 'Thai'); assert.equal(parsed, 1); assert.equal(downloaded, 2);
  assert.equal(retained.sources[1].workspace.descs[0].translations.Thai[0], 'Local staged sibling');
  saved = '';
  const refreshed = await catalog.load(session, 'Thai');
  assert.equal(refreshed.sources[1].workspace.descs[0].translations.Thai[0], '', 'A sibling committed blank refreshes the retained source overlay');
  session.version = { ...session.version, id: 'next', contentGroups: [] };
  await catalog.load(session, 'Thai'); session.version = { ...session.version, id: 'release', contentGroups: [group] };
  const reloaded = await catalog.load(session, 'Thai'); assert.equal(reloaded.missing.length, 1);
});
test('lookup delayed focus and scrolling cannot affect replacement sessions', () => {
  const callbacks = [], refs = { lookupSearchInput: { focus() { assert.fail('Stale session must not focus replacement Lookup'); } },
    lookupResultsList: { scrollTop: 19 }, lookupReference: { scrollTop: 29 } };
  const { host, session } = harness({ host: { $nextTick(callback) { callbacks.push(callback); }, getEditorComponentRef(name) { return refs[name]; } } });
  host.lookupQuery = 'Blade'; host.lookupApplySearch(); host.lookupSelect(host.lookupResults[0].key); host.lookupFocusSearch();
  session.mode = 'clienttext'; session.scope.groupId = 'replacement';
  for (const callback of callbacks) callback();
  assert.equal(refs.lookupResultsList.scrollTop, 19); assert.equal(refs.lookupReference.scrollTop, 29);
});
test('cancelled explicit preparation publishes no catalog and releases only its browser work', async () => {
  const pending = deferred(), entered = deferred(), work = [];
  const { host, session } = harness({ host: { managedOnlineAvailable: true,
    setBrowserWork(scope, value) { work.push({ scope, ...value }); },
    _cloud: { async request() { entered.resolve(); return pending.promise; } },
    _ctStore: { async getMetadata() {} }, _ctWorker: {} } });
  session.version.contentGroups = [{ id: 'ct', versionId: 'release', contentMode: 'clienttext', language: 'Thai' }];
  await host.lookupLoadCatalog(); const preparing = host.lookupPrepareReferences(); await entered.promise;
  host.lookupCancelPreparation(); pending.resolve({ group: session.version.contentGroups[0] });
  assert.equal(await preparing, false); assert.equal(host.lookupPreparing, false); assert.equal(host.lookupCatalogSources.length, 1);
  assert.equal(work[0].active, true); assert.equal(work.at(-1).active, false); assert.equal(work[0].key, work.at(-1).key);
});
