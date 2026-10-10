// Disposable normal-mode TM fixture: real API, IndexedDB, workers and WebSockets.
// `node scripts/tm-browser-fixture.cjs --check` runs the automated acceptance checks.
// Without --check, the loopback-only fixture remains available for manual review.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync } = require('node:fs');
const { tmpdir, homedir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');
const TM = require('../public/translationMemory.js');

const fixtureSource = [
  { filepath: 'tm-fixture/01_exact.txt', stats: ['fixture_fire_damage'], variables: ['#'], remarks: [''],
    translations: { English: ['{0}% increased Fire Damage'], Thai: [''], German: [''] } },
  { filepath: 'tm-fixture/02_fuzzy.txt', stats: ['fixture_moving_damage'], variables: ['#'], remarks: [''],
    translations: { English: ['{0}% increased Fire Damage while moving'], Thai: [''], German: [''] } },
  { filepath: 'tm-fixture/03_structured.txt', stats: ['fixture_structured'], variables: ['# #', '#', '#'], remarks: ['', '', ''],
    translations: { English: ['Deals {0} Damage\\nfor {1} seconds', 'Health@Mana', 'First\\nSecond@Third\\nFourth'], Thai: ['', '', ''], German: ['', '', ''] } },
  { filepath: 'tm-fixture/04_seed.txt', stats: ['fixture_mana_cost'], variables: ['#'], remarks: [''],
    translations: { English: ['{0}% reduced Mana Cost'], Thai: ['ลดค่าใช้งานมานา {0}%'], German: ['{0}% verringerte Manakosten'] } },
].map(desc => ({ ...desc, name: '', filedir: 'tm-fixture', filename: desc.filepath.split('/').pop(), isDNT: false }));

async function browserBootstrap({ account, secret, openEditor = true }) {
  const vm = window.__tmFixtureApp;
  const response = await fetch('/fixture/session/' + account, { method: 'POST', headers: { 'X-Fixture-Key': secret } });
  if (!response.ok) throw new Error('Disposable fixture sign-in refused.');
  const result = await response.json();
  await vm._cloud.acceptLogin(result.session); await vm.cloudApply(vm._cloud.snapshot());
  if (vm.lang !== result.language) await vm.cloudSelectLanguage(result.language, vm.lang);
  vm.lang = result.language; vm.inlineEditor = false; vm.autoOpenNextFile = false; vm.hideDNT = false;
  await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
  vm.showSetting = false; vm.needsInitialSettings = false;
  await vm.activateGameVersion('poe1', { checkMigration: false });
  const source = result.source, zip = new JSZip();
  for (const desc of source) zip.file(desc.filepath, descEncode(desc), { date: new Date('2026-10-09T00:00:00Z'), createFolders: false });
  const file = new File([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], 'TMFixture.zip', { type: 'application/zip' });
  const identity = await vm.readImportZipIdentity(file, zip);
  await vm.importUpdateZipFile(file, structuredClone(source), { identity, rawSource: structuredClone(source) });
  vm.showSetting = false; vm.needsInitialSettings = false; vm.versionChooserVisible = false;
  vm.selectAllFileFilters(); vm.applyFileSearch(); await vm.loadEditorDrafts();
  await vm._cloud.sync(); await vm.loadTranslationMemory();
  if (openEditor) { await vm.editFile(source[0].filepath, true); vm.openEditorTM(0); }
  return { profile: vm.cloudProfileId, language: vm.lang, sourceHash: vm.sourceIdentity };
}

function browserControls(secret) {
  const panel = document.createElement('aside'); panel.setAttribute('aria-label', 'Disposable TM fixture');
  panel.style.cssText = 'position:fixed;left:12px;bottom:45px;z-index:2147483000;padding:10px;background:#fff7dc;color:#302b1c;border:2px solid #aa7300;border-radius:8px;max-width:330px;font:12px system-ui';
  panel.innerHTML = '<strong>Disposable TM fixture</strong><p>Loopback accounts and storage only. Bootstrap imports four synthetic files.</p>';
  const status = document.createElement('p'); panel.append(status);
  const ready = async () => {
    for (let count = 0; count < 600; count++) {
      const vm = window.__tmFixtureApp;
      if (vm?.offlineStoreReady && vm._cloud?.state && !vm._cloudInitializing && !vm._cloudApplying) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Editor did not initialize.');
  };
  for (const account of ['a', 'b', 'admin', 'german']) {
    const button = document.createElement('button'); button.textContent = 'Bootstrap ' + account;
    button.style.cssText = 'padding:4px 7px;margin:3px;border:1px solid #aa7300;background:#fff;color:#302b1c;border-radius:4px';
    button.onclick = async () => {
      button.disabled = true; status.textContent = 'Preparing ' + account + '…';
      try { await ready(); const result = await window.__tmFixtureBootstrap({ account, secret }); status.textContent = result.profile + ' · ' + result.language + ' · TM ready'; }
      catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    };
    panel.append(button);
  }
  document.body.append(panel);
}

async function createFixture() {
  const apiRoot = resolve(process.env.SDEDITOR_FIXTURE_API_ROOT || join(__dirname, '../../SDEditor-API'));
  const fromApi = createRequire(join(apiRoot, 'package.json')), express = fromApi('express');
  const load = file => import(pathToFileURL(join(apiRoot, 'src', file)).href);
  const [{ loadConfig }, { openDatabase, CloudStore }, { createApp }, { tmPatch }] = await Promise.all([
    load('config.js'), load('database.js'), load('app.js'), load('tm-validation.js')]);
  const directory = mkdtempSync(join(tmpdir(), 'sdeditor-tm-browser-')), secret = randomUUID();
  const frontend = express(), frontendServer = createServer(frontend);
  await new Promise(done => frontendServer.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + frontendServer.address().port;
  const config = loadConfig({ ADMIN_GOOGLE_SUB: 'fixture-admin', FRONTEND_ORIGIN: origin,
    API_PUBLIC_URL: 'http://127.0.0.1:1', DATA_DIR: directory, DATABASE_PATH: join(directory, 'fixture.sqlite') });
  const database = openDatabase(config.databasePath || join(directory, 'fixture.sqlite')), store = new CloudStore(database, config);
  for (const account of ['admin', 'a', 'b', 'german']) {
    store.registerIdentity({ sub: 'fixture-' + account, email: account + '@fixture.example', name: 'Fixture ' + account });
    if (account !== 'admin') store.assignLanguage('fixture-admin', 'fixture-' + account, account === 'german' ? 'German' : 'Thai');
    store.writeSettings('fixture-' + account, { baseRevision: 0, mutationId: 'fixture-settings-' + account,
      settings: { lang: account === 'german' ? 'German' : 'Thai', theme: 'modern-dark', inlineEditor: false, autoOpenNextFile: false, hideDNT: false } });
  }
  const api = createApp({ config, store, oauthProvider: null });
  const seed = [
    { id: 'tm-exact', source: fixtureSource[0].translations.English[0], target: 'เพิ่มความเสียหายไฟ {0}%', context: TM.contextFor(fixtureSource[0], 0) },
    { id: 'tm-fuzzy', source: '{0}% increased Fire Damage while stationary', target: 'เพิ่มความเสียหายไฟ {0}% ขณะอยู่กับที่', context: TM.contextFor(fixtureSource[1], 0) },
    { id: 'tm-multiline', source: fixtureSource[2].translations.English[0], target: 'สร้างความเสียหาย {0}\\nเป็นเวลา {1} วินาที', context: TM.contextFor(fixtureSource[2], 0) },
    { id: 'tm-table', source: fixtureSource[2].translations.English[1], target: 'พลังชีวิต@มานา', context: TM.contextFor(fixtureSource[2], 1) },
    { id: 'tm-table-multiline', source: fixtureSource[2].translations.English[2], target: 'แรก\\nสอง@สาม\\nสี่', context: TM.contextFor(fixtureSource[2], 2) },
  ].map(unit => ({ ...unit, gameScope: 'poe1', note: 'Disposable fixture memory', provenance: { origin: 'manual' }, baseRevision: 0 }));
  api.locals.translationMemory.mutate('fixture-admin', 'Thai', tmPatch({ mutationId: 'fixture-seed', upserts: seed, deletions: [] }));
  api.locals.translationMemory.mutate('fixture-admin', 'German', tmPatch({ mutationId: 'fixture-german-seed',
    upserts: [{ ...seed[0], id: 'tm-german', target: '{0}% erhöhter Feuerschaden' }], deletions: [] }));
  const requests = [];
  const instrumented = express();
  instrumented.use((req, res, next) => { if (req.path.startsWith('/v1/translation-memories/')) requests.push({ path: req.path, method: req.method }); next(); });
  instrumented.use(api);
  const apiServer = createServer(instrumented); api.locals.collaborationRealtime.attach(apiServer);
  await new Promise(done => apiServer.listen(0, '127.0.0.1', done));
  const apiOrigin = 'http://127.0.0.1:' + apiServer.address().port, publicDir = resolve(__dirname, '../public');
  frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  frontend.post('/fixture/session/:account', (req, res) => {
    if (req.get('X-Fixture-Key') !== secret || !['admin', 'a', 'b', 'german'].includes(req.params.account)) return res.sendStatus(403);
    res.json({ session: store.createSession('fixture-' + req.params.account), source: fixtureSource,
      language: req.params.account === 'german' ? 'German' : 'Thai' });
  });
  frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')
    .replace('</body>', '<script>window.__tmFixtureBootstrap=' + browserBootstrap.toString() + ';(' + browserControls.toString() + ')(' + JSON.stringify(secret) + ');</script></body>')));
  frontend.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
  frontend.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(publicDir, 'index.js'), 'utf8')
    .replace("app.mount('#app');", "window.__tmFixtureApp = app.mount('#app');")));
  frontend.use(express.static(publicDir));
  let stopped = false;
  return { origin, apiOrigin, secret, requests, directory, tm: api.locals.translationMemory, store,
    async stop() {
      if (stopped) return; stopped = true;
      await api.locals.collaborationRealtime.close();
      await Promise.all([new Promise(done => frontendServer.close(done)), new Promise(done => apiServer.close(done))]);
      database.close();
      const checked = resolve(directory);
      if (checked.startsWith(resolve(tmpdir()) + '\\') || checked.startsWith(resolve(tmpdir()) + '/')) rmSync(checked, { recursive: true, force: true });
    } };
}

async function check(fixture) {
  const runtimeModules = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [process.cwd(), __dirname, runtimeModules] }));
  const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  ].find(existsSync);
  const browser = await playwright.chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--disable-gpu'] });
  const deadline = setTimeout(() => browser.close(), 120000);
  const failures = [], results = [];
  try {
    const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })));
    const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of [a, b]) page.on('pageerror', error => failures.push(error.message));
    const ready = async (page, account) => {
      await page.goto(fixture.origin + '/?cloudApi=' + encodeURIComponent(fixture.apiOrigin));
      await page.waitForFunction(() => window.__tmFixtureApp?.offlineStoreReady && window.__tmFixtureApp?._cloud?.state
        && !window.__tmFixtureApp._cloudInitializing && !window.__tmFixtureApp._cloudApplying, null, { timeout: 30000 });
      await page.evaluate(browserBootstrap, { account, secret: fixture.secret, openEditor: account !== 'b' });
      await page.waitForFunction(account => window.__tmFixtureApp.tmUnits.length >= 5 && (account === 'b' || window.__tmFixtureApp.editorReady), account, { timeout: 30000 });
    };
    await ready(a, 'a'); await ready(b, 'b');
    const snapshot = page => page.evaluate(() => OfflineStore.getTranslationMemory(window.__tmFixtureApp.tmScope()));
    const freezeAutomaticTM = page => page.evaluate(() => {
      const vm = window.__tmFixtureApp; clearTimeout(vm._cloud.timer); vm._cloud.syncSharedResource = async () => {};
      vm._tmSync?.destroy(); vm._tmSync = new TMCloudSync.Client({ cloud: vm._cloud, store: OfflineStore,
        onChange: (scope, state) => vm.acceptTranslationMemory(state), onIssue: issue => { vm.tmIssue = issue; } });
    });
    const sync = page => page.evaluate(async () => {
      const vm = window.__tmFixtureApp, state = await OfflineStore.getTranslationMemory(vm.tmScope());
      await vm._tmSync.sync(vm._cloud.context(), { tmRevision: state.revision });
      if (vm.tmIssue && !(await OfflineStore.getTranslationMemory(vm.tmScope())).conflicts.length) throw new Error(vm.tmIssue);
      return OfflineStore.getTranslationMemory(vm.tmScope());
    });
    const catchup = page => page.evaluate(async () => {
      const vm = window.__tmFixtureApp; await vm._tmSync.sync(vm._cloud.context(), {});
      if (vm.tmIssue && !(await OfflineStore.getTranslationMemory(vm.tmScope())).conflicts.length) throw new Error(vm.tmIssue);
      return OfflineStore.getTranslationMemory(vm.tmScope());
    });
    const put = (page, unit, options = {}) => page.evaluate(async ({ unit, options }) => {
      await OfflineStore.putTranslationMemoryUnits(window.__tmFixtureApp.tmScope(), [unit], options);
    }, { unit, options });
    await a.waitForFunction(() => window.__tmFixtureApp.tmMatches.some(match => match.id === 'tm-exact'));
    assert.equal(await a.evaluate(() => window.__tmFixtureApp.tmSelectedMatch.score), 101);
    const exactMatch = a.getByRole('listbox', { name: 'TM matches' }).getByRole('option').filter({ hasText: 'Context match' });
    await exactMatch.click();
    assert.equal(await a.evaluate(() => window.__tmFixtureApp.serializeEditorTranslations()[0]), '', 'Single click selects without inserting');
    await exactMatch.dblclick();
    await a.waitForFunction(() => document.activeElement === window.__tmFixtureApp.getEditorRef('translation', 0));
    assert.equal(await a.evaluate(() => window.__tmFixtureApp.serializeEditorTranslations()[0]), 'เพิ่มความเสียหายไฟ {0}%');
    assert.equal(await a.evaluate(async () => { const vm = window.__tmFixtureApp; await vm.flushEditorDraft(); return !!vm.getDescByFilepath('tm-fixture/01_exact.txt').hasChanges; }), false);
    assert.equal(await a.evaluate(() => window.__tmFixtureApp.testMode), false);
    results.push('Normal mode loads five remote memories into real IndexedDB; single click selects and double-click inserts only a private draft and focuses its target');
    await a.evaluate(async () => { const vm = window.__tmFixtureApp; await vm.editorExit(); await vm.editFile('tm-fixture/02_fuzzy.txt', true); vm.openEditorTM(0); });
    await a.waitForFunction(() => window.__tmFixtureApp.tmMatches.some(match => match.id === 'tm-fuzzy'));
    const fuzzy = await a.evaluate(() => window.__tmFixtureApp.tmMatches.find(match => match.id === 'tm-fuzzy'));
    assert.equal(fuzzy.kind, 'fuzzy'); assert.ok(fuzzy.score >= 60 && fuzzy.score < 100);
    await a.getByRole('listbox', { name: 'TM matches' }).getByRole('option').filter({ hasText: '{0}% increased Fire Damage while stationary' }).click();
    const comparison = a.getByRole('region', { name: 'Selected TM match comparison' });
    assert.ok(await comparison.locator('.tmRemoved').count()); assert.ok(await comparison.locator('.tmAdded').count());
    assert.ok((await comparison.locator('.tmDiff').first().textContent()).includes('stationary'));
    assert.ok((await comparison.locator('.tmDiff').last().textContent()).includes('moving'));
    const fuzzyScreenshot = resolve(process.env.FIXTURE_SCREENSHOT || join(__dirname, '../.tmp/tm-browser-fixture.png')).replace(/\.png$/i, '-fuzzy.png');
    mkdirSync(resolve(fuzzyScreenshot, '..'), { recursive: true });
    await a.evaluate(() => { document.querySelector('[aria-label="Disposable TM fixture"]').hidden = true; });
    await a.screenshot({ path: fuzzyScreenshot, fullPage: false });
    await a.evaluate(async () => { const vm = window.__tmFixtureApp; await vm.editorExit(); await vm.editFile('tm-fixture/03_structured.txt', true); vm.openEditorTM(0); });
    for (const [index, id] of [[0, 'tm-multiline'], [1, 'tm-table'], [2, 'tm-table-multiline']]) {
      await a.evaluate(index => window.__tmFixtureApp.openEditorTM(index), index);
      await a.waitForFunction(id => window.__tmFixtureApp.tmMatches.some(match => match.id === id), id);
      await a.getByRole('listbox', { name: 'TM matches' }).getByRole('option').filter({ hasText: 'Context match' }).dblclick();
      await a.waitForFunction(index => {
        const vm = window.__tmFixtureApp, block = vm.editorBlocks[index];
        return document.activeElement === vm.getEditorRef('translation', index, block.isTable ? 0 : null);
      }, index);
      assert.equal(await a.evaluate(index => window.__tmFixtureApp.editorBlocks[index].diagnosticErrorCount, index), 0);
    }
    assert.deepEqual(await a.evaluate(() => window.__tmFixtureApp.serializeEditorTranslations()),
      ['สร้างความเสียหาย {0}\\nเป็นเวลา {1} วินาที', 'พลังชีวิต@มานา', 'แรก\\nสอง@สาม\\nสี่']);
    results.push('Fuzzy English differences remain visible; multiline and table TM entries preserve complete entry layout and valid tags');
    await a.evaluate(async () => {
      const vm = window.__tmFixtureApp; await vm.editorExit(); vm.inlineEditor = true;
      await vm.activateInlineRow('tm-fixture/01_exact.txt'); await vm.openEditorTM(0);
    });
    await a.waitForFunction(() => window.__tmFixtureApp.inlineActive && window.__tmFixtureApp.tmMatches.some(match => match.id === 'tm-exact'));
    const inlineTarget = a.locator('[data-editor-ref="translation_0"]');
    await inlineTarget.fill('existing draft {0}');
    await exactMatch.dblclick();
    const replaceDialog = a.getByRole('dialog', { name: 'Use TM translation?', exact: true });
    await replaceDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await inlineTarget.inputValue(), 'existing draft {0}', 'Cancelling replacement preserves the draft');
    await exactMatch.dblclick();
    await replaceDialog.getByRole('button', { name: 'Replace draft', exact: true }).click();
    await a.waitForFunction(() => {
      const vm = window.__tmFixtureApp;
      return vm.inlineActive && !vm.editorVisible && vm.serializeEditorTranslations()[0] === 'เพิ่มความเสียหายไฟ {0}%'
        && document.activeElement === vm.getEditorRef('translation', 0);
    });
    await a.evaluate(async () => { const vm = window.__tmFixtureApp; await vm.finishInlineSession({ promote: false }); vm.inlineEditor = false; });
    results.push('Inline double-click preserves replacement confirmation, cancellation and target focus without closing the row');
    await freezeAutomaticTM(a); await freezeAutomaticTM(b);
    const added = { id: 'tm-client-shared', source: 'Cold Damage', target: 'ความเสียหายน้ำแข็ง', gameScope: 'poe1', context: null, note: '', provenance: { origin: 'manual' } };
    await put(a, added); await sync(a); await catchup(b);
    let shared = (await snapshot(b)).units.find(unit => unit.id === added.id);
    assert.equal(shared.revision, 1, 'per-unit acknowledgement must not use the language revision');
    await put(a, { ...shared, target: 'แก้ไข A' }); await put(b, { ...shared, target: 'แก้ไข B' });
    await sync(a);
    const conflict = await sync(b); assert.equal(conflict.conflicts.length, 1);
    assert.equal(conflict.conflicts[0].local.target, 'แก้ไข B');
    await b.evaluate(async id => { const vm = window.__tmFixtureApp, state = await OfflineStore.getTranslationMemory(vm.tmScope());
      await OfflineStore.resolveTranslationMemoryConflict(vm.tmScope(), id, 'local', { expectedRevision: state.conflicts[0].revision }); }, added.id);
    await sync(b); await catchup(a);
    shared = (await snapshot(a)).units.find(unit => unit.id === added.id);
    assert.equal(shared.target, 'แก้ไข B'); assert.equal(shared.revision, 3);
    results.push('Two isolated browser clients share edits; real CAS preserves the losing correction until explicit resolution');
    await a.evaluate(async id => { const vm = window.__tmFixtureApp, state = await OfflineStore.getTranslationMemory(vm.tmScope()), unit = state.units.find(unit => unit.id === id);
      await OfflineStore.deleteTranslationMemoryUnit(vm.tmScope(), id, { expectedRevision: unit.revision, expectedLocalRevision: unit.localRevision }); }, added.id);
    await sync(a); await catchup(b);
    const deleted = (await snapshot(b)).tombstones.find(unit => unit.id === added.id); assert.equal(deleted.revision, 4);
    await put(b, added, { origin: 'learn' }); assert.equal((await snapshot(b)).units.some(unit => unit.id === added.id), false);
    await put(b, { ...shared, target: 'คืนจากประวัติ' }, { restore: true, origin: 'restore', expectedRevision: deleted.revision });
    await sync(b); await catchup(a);
    const restored = (await snapshot(a)).units.find(unit => unit.id === added.id);
    assert.equal(restored.revision, 5); assert.equal(restored.target, 'คืนจากประวัติ');
    const history = await a.evaluate(id => window.__tmFixtureApp._cloud.request('/v1/translation-memories/Thai/history?unitId=' + id), added.id);
    assert.ok(history.items.some(item => item.action === 'delete')); assert.ok(history.items.some(item => item.action === 'restore'));
    results.push('Shared deletion suppresses automatic relearning; explicit restoration advances the exact unit revision and retains server history');
    const importedDeletion = { id: 'tm-reviewed-suppression', source: 'Deleted before import', target: 'ลบก่อนนำเข้า', gameScope: 'poe1', context: null, deleted: true };
    await put(b, importedDeletion, { origin: 'seed' }); await sync(b); await catchup(a);
    const importedTombstone = (await snapshot(a)).tombstones.find(unit => unit.id === importedDeletion.id);
    assert.equal(importedTombstone.revision, 1); assert.equal(importedTombstone.source, importedDeletion.source);
    await put(a, { ...importedDeletion, deleted: false }, { origin: 'learn' });
    assert.equal((await snapshot(a)).units.some(unit => unit.id === importedDeletion.id), false);
    results.push('Reviewed JSON deletion records retain identity and suppression when shared with another browser');
    const thaiProfile = await a.evaluate(() => window.__tmFixtureApp.cloudProfileId);
    const beforeGermanRequests = fixture.requests.filter(item => item.path.includes('/German')).length;
    await a.evaluate(async () => { const vm = window.__tmFixtureApp; await vm.editorExit(); await vm.cloudSelectLanguage('German', vm.lang); vm.lang = 'German'; await vm.saveSettings(); });
    await put(a, { id: 'tm-local-german', source: 'Only local German', target: 'Nur lokal', gameScope: 'all', context: null });
    await sync(a);
    assert.equal(fixture.requests.filter(item => item.path.includes('/German')).length, beforeGermanRequests);
    const denied = await a.evaluate(async apiOrigin => {
      const token = window.__tmFixtureApp._cloud.context().token;
      return (await fetch(apiOrigin + '/v1/translation-memories/German', { headers: { Authorization: 'Bearer ' + token } })).status;
    }, fixture.apiOrigin);
    assert.equal(denied, 403);
    const tokenSession = fixture.store.createSession('fixture-b');
    await a.evaluate(async session => { const vm = window.__tmFixtureApp; await vm._cloud.acceptLogin(session); await vm.cloudApply(vm._cloud.snapshot()); }, tokenSession);
    const scopes = await a.evaluate(async thaiProfile => ({ oldGerman: await OfflineStore.getTranslationMemory({ profile: thaiProfile, language: 'German' }),
      newGerman: await OfflineStore.getTranslationMemory({ profile: window.__tmFixtureApp.cloudProfileId, language: 'German' }) }), thaiProfile);
    assert.ok(scopes.oldGerman.units.some(unit => unit.id === 'tm-local-german')); assert.equal(scopes.newGerman.units.length, 0);
    results.push('Translator selection outside assignment stays local; direct API access is denied and account switching preserves separate IndexedDB profiles');
    await b.evaluate(async () => { const vm = window.__tmFixtureApp; await vm.editorExit(); vm.versionChooserVisible = false; await vm.editFile('tm-fixture/01_exact.txt', true); vm.openEditorTM(0); });
    await b.waitForFunction(() => window.__tmFixtureApp.tmMatches.length);
    const matches = b.getByRole('listbox', { name: 'TM matches' });
    await matches.getByRole('option').first().click(); await b.keyboard.press('ArrowDown');
    assert.equal(await b.evaluate(() => window.__tmFixtureApp.tmSelectedMatch.id), 'tm-fuzzy');
    await b.keyboard.press('ArrowUp'); assert.equal(await b.evaluate(() => window.__tmFixtureApp.tmSelectedMatch.id), 'tm-exact');
    await b.keyboard.press('Enter');
    await b.waitForFunction(() => window.__tmFixtureApp.serializeEditorTranslations()[0] === 'เพิ่มความเสียหายไฟ {0}%');
    const screenshotPath = resolve(process.env.FIXTURE_SCREENSHOT || join(__dirname, '../.tmp/tm-browser-fixture.png'));
    mkdirSync(resolve(screenshotPath, '..'), { recursive: true });
    await b.evaluate(() => { document.querySelector('[aria-label="Disposable TM fixture"]').hidden = true; });
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await b.evaluate(theme => { window.__tmFixtureApp.theme = theme; document.documentElement.setAttribute('data-theme', theme); }, theme);
      assert.ok(await b.getByRole('region', { name: 'Translation memory suggestions' }).isVisible());
      await b.screenshot({ path: screenshotPath.replace(/\.png$/i, '-' + theme + '.png'), fullPage: false });
    }
    await b.screenshot({ path: screenshotPath, fullPage: false });
    await b.setViewportSize({ width: 1100, height: 900 });
    await b.getByRole('button', { name: 'Manage TM', exact: true }).click();
    const manager = b.getByRole('dialog', { name: 'Translation Memory', exact: true });
    await manager.getByRole('button', { name: 'Add entry', exact: true }).click();
    await manager.getByLabel('English', { exact: true }).fill('{0}% increased Lightning Damage');
    await manager.getByLabel('Translation', { exact: true }).fill('เพิ่มความเสียหายสายฟ้า');
    await manager.getByRole('button', { name: 'Save TM entry', exact: true }).click();
    await b.waitForFunction(() => window.__tmFixtureApp.tmLocalIssue && window.__tmFixtureApp.tmEditing);
    assert.equal((await snapshot(b)).units.some(unit => unit.source === '{0}% increased Lightning Damage'), false);
    await manager.getByLabel('Translation', { exact: true }).fill('เพิ่มความเสียหายสายฟ้า {0}%');
    await manager.getByLabel('Translator note', { exact: true }).fill('Reviewed through the real manager UI');
    await manager.getByRole('button', { name: 'Save TM entry', exact: true }).click();
    await b.waitForFunction(() => !window.__tmFixtureApp.tmEditing && !window.__tmFixtureApp.tmBusy);
    const lightningRow = manager.locator('.tmManagerList > article').filter({ hasText: '{0}% increased Lightning Damage' });
    await lightningRow.getByRole('button', { name: 'Edit', exact: true }).click();
    await manager.getByLabel('Translation', { exact: true }).fill('ความเสียหายสายฟ้าเพิ่มขึ้น {0}%');
    await manager.getByRole('button', { name: 'Save TM entry', exact: true }).click();
    await b.waitForFunction(() => !window.__tmFixtureApp.tmEditing && !window.__tmFixtureApp.tmBusy);
    await sync(b);
    assert.equal((await snapshot(b)).units.find(unit => unit.source === '{0}% increased Lightning Damage').target, 'ความเสียหายสายฟ้าเพิ่มขึ้น {0}%');
    await manager.getByLabel('Include original ZIP translations when building TM').check();
    await manager.getByRole('button', { name: 'Build TM from workspace…', exact: true }).click();
    const review = b.getByRole('dialog', { name: 'Review TM import', exact: true });
    await review.waitFor(); assert.ok(await review.getByText('{0}% reduced Mana Cost', { exact: true }).isVisible());
    await review.getByRole('button', { name: 'Close TM import', exact: true }).click();
    const beforeJson = await snapshot(b), exactUnit = beforeJson.units.find(unit => unit.id === 'tm-exact');
    const jsonImport = { format: 'sdeditor-tm', version: 1, language: 'Thai', units: [{ ...exactUnit, target: 'ข้อความแก้ไขที่ยังไม่เลือก {0}%' },
      { id: 'tm-json-addition', source: '{0}% increased Chaos Damage', target: 'เพิ่มความเสียหายเคออส {0}%', gameScope: 'poe1', context: null }] };
    await manager.locator('input[type="file"]').setInputFiles({ name: 'reviewed-tm.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(jsonImport)) });
    await review.waitFor();
    assert.equal(await b.evaluate(() => window.__tmFixtureApp.tmSeedRows.length), 2);
    assert.equal(await b.evaluate(() => window.__tmFixtureApp.tmSeedSelectedCount), 1);
    assert.equal((await snapshot(b)).units.find(unit => unit.id === 'tm-exact').target, exactUnit.target);
    await review.getByRole('button', { name: 'Import selected entries', exact: true }).click();
    await b.waitForFunction(() => !window.__tmFixtureApp.tmSeedVisible && !window.__tmFixtureApp.tmBusy);
    await sync(b);
    assert.ok((await snapshot(b)).units.some(unit => unit.id === 'tm-json-addition'));
    assert.equal((await snapshot(b)).units.find(unit => unit.id === 'tm-exact').target, exactUnit.target);
    const managerBox = await manager.boundingBox(); assert.ok(managerBox.x >= 0 && managerBox.x + managerBox.width <= 1101);
    await b.screenshot({ path: screenshotPath.replace(/\.png$/i, '-manager.png'), fullPage: false });
    results.push('Desktop keyboard arrows/Enter apply a draft; pointer manager add/edit validates tags, workspace seed and JSON imports require review at 1100px');
    await manager.getByRole('button', { name: 'Close TM manager', exact: true }).click();
    await b.evaluate(() => window.__tmFixtureApp.openSettings('cloud'));
    const settings = b.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'Manage translation memory', exact: true }).click();
    await manager.waitFor();
    assert.equal(await b.evaluate(() => {
      const heading = document.getElementById('tmManagerTitle'), box = heading.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('[role="dialog"]')?.contains(heading);
    }), true, 'TM must receive pointer interaction above the Settings dialog');
    await manager.getByRole('button', { name: 'Close TM manager', exact: true }).click();
    await settings.getByRole('button', { name: 'Save and close', exact: true }).click();
    await b.getByRole('button', { name: 'Manage TM', exact: true }).click();
    const neverUploaded = { id: 'tm-preupload-local', source: 'Local memory before upload', target: 'หน่วยความจำในเครื่องก่อนอัปโหลด', gameScope: 'poe1', context: null };
    await put(b, neverUploaded, { origin: 'edit' }); await b.evaluate(() => window.__tmFixtureApp.loadTranslationMemory());
    const privateRow = manager.locator('.tmManagerList > article').filter({ hasText: neverUploaded.source });
    await privateRow.getByRole('button', { name: 'Delete', exact: true }).click();
    await b.getByRole('alertdialog', { name: 'Delete TM entry?', exact: true }).getByRole('button', { name: 'Delete entry', exact: true }).click();
    await b.waitForFunction(id => window.__tmFixtureApp.tmTombstones.some(unit => unit.id === id), neverUploaded.id);
    assert.equal(fixture.tm.unit('Thai', neverUploaded.id), null);
    assert.equal((await snapshot(b)).pending, 0, 'a never-uploaded creation/delete must cancel its pending creation');
    await manager.locator('.tmDeleted > summary').click();
    await manager.locator('.tmDeleted > div').filter({ hasText: neverUploaded.source }).getByRole('button', { name: 'History / restore', exact: true }).click();
    const historyDialog = b.getByRole('dialog', { name: 'TM history', exact: true });
    await b.waitForFunction(() => window.__tmFixtureApp.tmHistoryEvents.some(event => !event.remote && event.origin === 'delete'));
    await historyDialog.locator('.tmSeedRow').filter({ hasText: /Local.*delete/ }).getByRole('button', { name: 'Restore before…', exact: true }).click();
    await b.getByRole('dialog', { name: 'Restore TM entry?', exact: true }).getByRole('button', { name: 'Restore translation', exact: true }).click();
    await b.waitForFunction(id => !window.__tmFixtureApp.tmHistoryVisible && window.__tmFixtureApp.tmUnits.some(unit => unit.id === id), neverUploaded.id);
    await sync(b); assert.equal(fixture.tm.unit('Thai', neverUploaded.id).target, neverUploaded.target);
    const originalLightning = (await snapshot(b)).units.find(unit => unit.source === '{0}% increased Lightning Damage');
    await manager.locator('.tmManagerList > article').filter({ hasText: originalLightning.source }).getByRole('button', { name: 'Edit', exact: true }).click();
    const movedSource = '{0}% increased Lightning Damage while moving';
    await manager.getByLabel('English', { exact: true }).fill(movedSource);
    await manager.getByLabel('Translation', { exact: true }).fill('ความเสียหายสายฟ้าเพิ่มขึ้น {0}% ขณะเคลื่อนที่');
    await manager.getByRole('button', { name: 'Save TM entry', exact: true }).click();
    await b.waitForFunction(() => !window.__tmFixtureApp.tmEditing && !window.__tmFixtureApp.tmBusy);
    await sync(b); assert.equal(fixture.tm.unit('Thai', originalLightning.id).source, movedSource);
    await manager.locator('.tmManagerList > article').filter({ hasText: movedSource }).getByRole('button', { name: 'History', exact: true }).click();
    await b.waitForFunction(() => window.__tmFixtureApp.tmHistoryEvents.some(event => event.remote));
    await historyDialog.locator('.tmSeedRow').filter({ hasText: /^Shared/ }).first().getByRole('button', { name: 'Restore before…', exact: true }).click();
    const restoreDialog = b.getByRole('dialog', { name: 'Restore TM entry?', exact: true });
    const restoreMessage = await restoreDialog.locator('#appDialogMessage').textContent();
    assert.ok(restoreMessage.includes(originalLightning.source)); assert.equal(restoreMessage.includes(movedSource), false);
    await restoreDialog.getByRole('button', { name: 'Restore translation', exact: true }).click();
    await b.waitForFunction(id => !window.__tmFixtureApp.tmHistoryVisible && window.__tmFixtureApp.tmUnits.some(unit => unit.id === id && unit.source === '{0}% increased Lightning Damage'), originalLightning.id);
    await sync(b);
    assert.equal(fixture.tm.unit('Thai', originalLightning.id).source, originalLightning.source);
    assert.equal(fixture.tm.unit('Thai', originalLightning.id).target, originalLightning.target);
    const restoredHistory = fixture.tm.history('fixture-b', 'Thai', { unitId: originalLightning.id }).items[0];
    assert.equal(restoredHistory.action, 'restore'); assert.equal(restoredHistory.origin, 'restore');
    assert.equal(restoredHistory.sourceEventId, null, 'queued restoration must not invent a server history link');
    results.push('Settings opens TM above its overlay; local deleted-before-upload history restores, and shared history restores stable-id source edits with server-authored restore evidence');
    const peer = await contexts[1].newPage(); peer.on('pageerror', error => failures.push(error.message));
    await ready(peer, 'b'); await freezeAutomaticTM(peer);
    const tabLocal = { id: 'tm-tab-local', source: 'Local edit across tabs', target: 'การแก้ไขในเครื่องระหว่างแท็บ', gameScope: 'poe1', context: null };
    await put(b, tabLocal, { origin: 'edit' });
    await peer.waitForFunction(id => window.__tmFixtureApp.tmUnits.some(unit => unit.id === id), tabLocal.id);
    assert.equal(fixture.tm.unit('Thai', tabLocal.id), null, 'local page notifications must work before any server upload');
    await sync(b);
    await peer.waitForFunction(id => window.__tmFixtureApp.tmUnits.some(unit => unit.id === id && unit.revision === 1), tabLocal.id);
    results.push('A second tab sharing real IndexedDB receives local corrections and exact server acknowledgements through scoped page notifications');
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ passed: results, screenshot: screenshotPath, apiRevision: fixture.tm.revision('Thai'), browserErrors: failures }, null, 2));
  } finally { clearTimeout(deadline); await browser.close(); }
}

(async () => {
  const fixture = await createFixture();
  if (process.argv.includes('--check')) { try { await check(fixture); } finally { await fixture.stop(); } }
  else {
    console.log('Disposable TM editor: ' + fixture.origin + '/?cloudApi=' + encodeURIComponent(fixture.apiOrigin));
    console.log('Use Bootstrap a/b/admin/german controls. Open clients in separate disposable browser profiles or private sessions.');
    console.log('Scratch data: ' + fixture.directory + ' (deleted when the fixture stops)');
    const stop = () => fixture.stop().catch(error => { console.error(error.message); process.exitCode = 1; });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
