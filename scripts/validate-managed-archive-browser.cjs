// Real upstream ZIP parity in a disposable normal-mode browser and local API.
// Usage: node scripts/validate-managed-archive-browser.cjs /path/to/StatDescriptions.zip
// Duplicate choices use each first option in fixture data only; nothing is hosted.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const { Readable } = require('node:stream');
const { randomUUID, createHash } = require('node:crypto');

const archivePath = process.argv[2];
if (!archivePath) throw new Error('Pass the path to an original StatDescriptions.zip.');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!executablePath) throw new Error('Set FIXTURE_BROWSER_PATH to installed Edge/Chrome.');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function run() {
  const started = Date.now(), timings = {}, apiRoot = resolve(__dirname, '../../SDEditor-API');
  const fromApi = createRequire(join(apiRoot, 'package.json'));
  const load = name => import(pathToFileURL(join(apiRoot, 'src', name)).href);
  const [{ loadConfig }, { openDatabase, CloudStore }, { createApp }, { leafHash }] = await Promise.all([
    load('config.js'), load('database.js'), load('app.js'), load('collaboration-protocol.js'),
  ]);
  const express = fromApi('express'), directory = mkdtempSync(join(tmpdir(), 'sdeditor-archive-browser-'));
  const secret = randomUUID(), frontend = express(), frontendServer = createServer(frontend);
  await new Promise(resolve => frontendServer.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + frontendServer.address().port;
  const config = loadConfig({ ADMIN_GOOGLE_SUB: 'fixture-manager', FRONTEND_ORIGIN: origin,
    API_PUBLIC_URL: 'http://127.0.0.1:1', DATA_DIR: directory, DATABASE_PATH: ':memory:' });
  const database = openDatabase(':memory:'), store = new CloudStore(database, config);
  store.registerIdentity({ sub: 'fixture-manager', email: 'manager@fixture.example', name: 'Fixture manager' });
  store.registerIdentity({ sub: 'fixture-thai', email: 'thai@fixture.example', name: 'Fixture Thai' });
  store.assignLanguage('fixture-manager', 'fixture-thai', 'Thai');
  const api = createApp({ config, database, store, oauthProvider: null }), apiServer = createServer(api);
  api.locals.collaborationRealtime.attach(apiServer);
  await new Promise(resolve => apiServer.listen(0, '127.0.0.1', resolve));
  const apiOrigin = 'http://127.0.0.1:' + apiServer.address().port;
  frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  frontend.post('/fixture/session', (req, res) => {
    if (req.get('X-Fixture-Key') !== secret) return res.sendStatus(403);
    res.json(store.createSession('fixture-thai'));
  });
  frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(__dirname, '../public/index.html'), 'utf8')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
  frontend.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
  frontend.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(__dirname, '../public/index.js'), 'utf8')
    .replace("app.mount('#app');", "window.__managedFixtureApp = app.mount('#app');")));
  frontend.use(express.static(join(__dirname, '../public')));
  let browser;
  try {
    const bytes = readFileSync(resolve(archivePath)), versions = api.locals.versions;
    const upload = versions.createUpload('fixture-manager', { game: 'poe2', name: 'Browser parity fixture', idempotencyKey: 'fixture-create' }).upload;
    let phase = Date.now();
    await versions.receiveArchive(upload.id, 'fixture-manager', Readable.from([bytes]));
    timings.apiUploadMs = Date.now() - phase; phase = Date.now();
    versions.prepare(upload.id, 'fixture-manager', {}); await versions.idle();
    let status = versions.uploadStatus(upload.id, 'fixture-manager'), fixtureDuplicateChoices = 0;
    if (status.upload.status === 'needs_decisions') {
      const decisions = status.upload.duplicateGroups.map(group => ({ filepath: group.filepath, language: group.lang || group.language,
        occurrence: group.options[0].occurrence, blockHash: group.options[0].blockHash }));
      fixtureDuplicateChoices = decisions.length;
      versions.prepare(upload.id, 'fixture-manager', { decisions }); await versions.idle();
      status = versions.uploadStatus(upload.id, 'fixture-manager');
    }
    timings.apiPrepareMs = Date.now() - phase;
    assert.equal(status.upload.status, 'prepared', JSON.stringify(status.upload.validation));
    const result = versions.publish(upload.id, 'fixture-manager', { expectedHeadId: null, idempotencyKey: 'fixture-publish' });
    const canonical = versions.baseline(versions.version(result.version.id, 'fixture-manager'));
    console.log('API prepared ' + canonical.files.length + ' descriptions; opening real browser workflow.');
    browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/?cloudApi=' + encodeURIComponent(apiOrigin));
    await page.waitForFunction(() => window.__managedFixtureApp?.offlineStoreReady && window.__managedFixtureApp?._cloud?.state);
    await page.evaluate(async ({ secret }) => {
      const vm = window.__managedFixtureApp;
      const session = await fetch('/fixture/session', { method: 'POST', headers: { 'X-Fixture-Key': secret } });
      await vm._cloud.acceptLogin(await session.json()); await vm.cloudApply(vm._cloud.snapshot());
      vm.lang = 'Thai'; vm.needsInitialSettings = false; vm.showSetting = false; await vm.saveSettings();
      await OfflineStore.setMigratedFromSingleVersion(true); await vm.activateGameVersion('poe2', { checkMigration: false });
      const measurements = window.__archiveMeasurements = { parseFileCalls: 0, parsedDescriptions: 0, parseFileMs: 0 };
      const parse = window.parseFile;
      window.parseFile = async (...args) => {
        const began = performance.now(), desc = await parse(...args);
        measurements.parseFileMs += performance.now() - began; measurements.parseFileCalls++;
        if (desc) measurements.parsedDescriptions++; return desc;
      };
      for (const [target, method, label] of [[vm, 'buildImportedBaseline', 'canonicalTreeMs'],
        [vm, 'readImportZipIdentity', 'rawIdentityMs'], [OfflineStore, 'saveSourceWorkspaceWithRevisions', 'indexedDbCommitMs']]) {
        const original = target[method].bind(target);
        target[method] = async (...args) => { const began = performance.now(); try { return await original(...args); } finally { measurements[label] = performance.now() - began; } };
      }
      const request = vm._cloud.request.bind(vm._cloud);
      vm._cloud.request = async (path, ...args) => { const began = performance.now(); try { return await request(path, ...args); } finally { if (path.endsWith('/original')) measurements.originalDownloadMs = performance.now() - began; } };
    }, { secret });
    await page.getByRole('button', { name: 'Open editor', exact: true }).waitFor();
    phase = Date.now(); await page.getByRole('button', { name: 'Open editor', exact: true }).click();
    await page.waitForFunction(() => !window.__managedFixtureApp.managedVersionBusy, null, { timeout: 180000 });
    const actual = await page.evaluate(async () => {
      const vm = window.__managedFixtureApp, baseline = vm.importBaseline;
      const fingerprint = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))))
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (!baseline) return { error: vm.managedVisibleError, loaded: vm.sourceLoaded, measurements: window.__archiveMeasurements };
      const scope = vm.managedWorkspaceScope(), stored = await OfflineStore.getVersionWorkspace(scope, 'Thai');
      const storedSource = await OfflineStore.getVersionSource(scope);
      return { error: vm.managedVisibleError, loaded: vm.sourceLoaded, identity: vm.sourceIdentity, testMode: vm.testMode,
        archive: JSON.parse(JSON.stringify(baseline.archive)), sourceCount: baseline.source.length,
        leaves: await fingerprint(baseline.tree.levels[0]), paths: await fingerprint(baseline.tree.paths),
        storedIdentity: stored.importArchive?.baselineId, storedSourceCount: storedSource?.length,
        measurements: window.__archiveMeasurements };
    });
    timings.browserContinueMs = Date.now() - phase;
    assert.equal(actual.error, ''); assert.equal(actual.loaded, true); assert.equal(actual.testMode, false);
    assert.equal(actual.identity, canonical.archive.baselineId); assert.equal(actual.storedIdentity, canonical.archive.baselineId);
    assert.deepEqual(actual.archive, canonical.archive);
    assert.equal(actual.sourceCount, canonical.files.length); assert.equal(actual.storedSourceCount, canonical.files.length);
    assert.equal(actual.leaves, digest(canonical.files.map(leafHash)), 'Every browser leaf matches the API witness');
    assert.equal(actual.paths, digest(canonical.files.map(file => file.filepath)), 'Canonical ordering matches');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', normalMode: true, disposable: true, zipBytes: bytes.length,
      zipHash: canonical.archive.zipHash, baselineId: canonical.archive.baselineId, treeRoot: canonical.archive.treeRoot,
      originalFiles: canonical.archive.fileCount, descriptions: canonical.files.length, fixtureDuplicateChoices,
      repairs: status.upload.validation.repairs.length, timings: { ...timings, ...actual.measurements, elapsedMs: Date.now() - started } }, null, 2));
  } finally {
    await browser?.close(); await api.locals.versions.idle(); await api.locals.collaborationRealtime.close();
    await Promise.all([new Promise(resolve => apiServer.close(resolve)), new Promise(resolve => frontendServer.close(resolve))]);
    if (database.isOpen) database.close();
    const absolute = resolve(directory), expectedRoot = resolve(tmpdir()) + sep;
    if (!absolute.startsWith(expectedRoot) || !absolute.split(sep).pop().startsWith('sdeditor-archive-browser-')) throw new Error('Unsafe fixture cleanup path.');
    rmSync(absolute, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
