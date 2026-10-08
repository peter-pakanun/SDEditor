// Disposable normal-mode acceptance check: real API, IndexedDB, workers and WebSockets.
// Run with PLAYWRIGHT_MODULE_PATH when Playwright is outside this checkout.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const codec = require('../public/statDescCodec.js');

const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!executablePath) throw new Error('No installed Edge/Chrome found. Set FIXTURE_BROWSER_PATH; no browser download is needed.');

async function run() {
  const apiRoot = resolve(__dirname, '../../SDEditor-API'), fromApi = createRequire(join(apiRoot, 'package.json'));
  const load = name => import(pathToFileURL(join(apiRoot, 'src', name)).href);
  const [{ loadConfig }, { openDatabase, CloudStore }, { createApp }] = await Promise.all([load('config.js'), load('database.js'), load('app.js')]);
  const express = fromApi('express'), JSZip = fromApi('jszip');
  const directory = mkdtempSync(join(tmpdir(), 'sdeditor-managed-browser-'));
  const secret = randomUUID(), frontend = express(), frontendServer = createServer(frontend);
  await new Promise(resolve => frontendServer.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + frontendServer.address().port;
  const config = loadConfig({ ADMIN_GOOGLE_SUB: 'fixture-admin', FRONTEND_ORIGIN: origin,
    API_PUBLIC_URL: 'http://127.0.0.1:1', DATA_DIR: directory, DATABASE_PATH: ':memory:' });
  const database = openDatabase(':memory:'), store = new CloudStore(database, config);
  for (const account of ['admin', 'manager', 'thai', 'unassigned']) store.registerIdentity({ sub: 'fixture-' + account,
    email: account + '@fixture.example', name: 'Fixture ' + account });
  store.assignRole('fixture-admin', 'fixture-manager', 'manager');
  store.assignLanguage('fixture-admin', 'fixture-thai', 'Thai');
  const api = createApp({ config, database, store, oauthProvider: null });
  for (const method of ['createUpload', 'receiveArchive', 'prepare', 'publish']) {
    const original = api.locals.versions[method].bind(api.locals.versions);
    api.locals.versions[method] = (...args) => {
      const report = error => { console.error('Fixture ' + method + ': ' + error.name + ': ' + error.message); throw error; };
      try { const result = original(...args); return result?.catch ? result.catch(report) : result; }
      catch (error) { return report(error); }
    };
  }
  const apiServer = createServer(api); api.locals.collaborationRealtime.attach(apiServer);
  await new Promise(resolve => apiServer.listen(0, '127.0.0.1', resolve));
  const apiOrigin = 'http://127.0.0.1:' + apiServer.address().port;
  frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  frontend.post('/fixture/session/:account', (req, res) => {
    if (req.get('X-Fixture-Key') !== secret || !['admin', 'manager', 'thai', 'unassigned'].includes(req.params.account)) return res.sendStatus(403);
    res.json(store.createSession('fixture-' + req.params.account));
  });
  frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(__dirname, '../public/index.html'), 'utf8')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
  frontend.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
  frontend.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(__dirname, '../public/index.js'), 'utf8')
    .replace("app.mount('#app');", "window.__managedFixtureApp = app.mount('#app');")));
  frontend.use(express.static(join(__dirname, '../public')));
  const source = { filepath: 'fixture/fire.txt', filedir: 'fixture', filename: 'fire.txt', name: 'fire',
    stats: ['fire_damage'], variables: ['#'], remarks: [''], translations: { English: ['Fire damage'], Thai: ['ความเสียหายไฟ'], German: ['Feuerschaden'] } };
  const zip = new JSZip(); zip.file(source.filepath, codec.descEncode(source), { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
  const missingSource = { ...source, filepath: 'fixture/cold.txt', filename: 'cold.txt', name: 'cold', stats: ['cold_damage'],
    translations: { English: ['Cold damage'], German: ['Kälteschaden'] } };
  zip.file(missingSource.filepath, codec.descEncode(missingSource), { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  let browser;
  const failures = [], results = [];
  try {
    browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
    const contexts = await Promise.all(['manager', 'thai'].map(() => browser.newContext({ viewport: { width: 1440, height: 1000 },
      acceptDownloads: true, ignoreHTTPSErrors: true })));
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of pages) page.on('pageerror', error => failures.push(error.message));
    const ready = async page => {
      await page.goto(origin + '/?cloudApi=' + encodeURIComponent(apiOrigin));
      await page.waitForFunction(() => window.__managedFixtureApp?.offlineStoreReady && window.__managedFixtureApp?._cloud?.state,
        { timeout: 30000 });
    };
    const bootstrapProfile = async (page, account) => {
      await ready(page);
      await page.evaluate(async ({ account, secret }) => {
        const vm = window.__managedFixtureApp;
        const response = await fetch('/fixture/session/' + account, { method: 'POST', headers: { 'X-Fixture-Key': secret } });
        if (!response.ok) throw new Error('Fixture session refused');
        await vm._cloud.acceptLogin(await response.json()); await vm.cloudApply(vm._cloud.snapshot());
        vm.lang = 'Thai'; vm.needsInitialSettings = false; vm.showSetting = false; vm.inlineEditor = false;
        await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
      }, { account, secret });
    };
    const bootstrap = async (page, account) => {
      await bootstrapProfile(page, account);
      await page.evaluate(() => window.__managedFixtureApp.activateGameVersion('poe2', { checkMigration: false }));
      await page.getByRole('region', { name: 'Source versions' }).waitFor();
    };
    const installCatalogCounters = page => page.evaluate(() => {
      const vm = window.__managedFixtureApp;
      const counters = window.__managedCatalogCounters = { reads: {}, hydration: {}, status: {}, roomJoins: 0 };
      const instrument = (owner, name, bucket, include = () => true) => {
        const original = owner?.[name]; if (typeof original !== 'function') return;
        counters[bucket][name] = 0;
        owner[name] = function (...args) {
          if (include(...args)) counters[bucket][name]++;
          return original.apply(this, args);
        };
      };
      for (const name of ['getSource', 'getWorkspace', 'getImportedBaseline', 'getImportBaseline', 'getVersionSource', 'getVersionWorkspace'])
        instrument(OfflineStore, name, 'reads');
      instrument(vm, 'loadVersionedStorage', 'hydration');
      instrument(vm, 'prepareStoredWorkspaceSource', 'hydration', source => !!source?.length);
      instrument(WorkspaceState, 'descriptionStatus', 'status', local => !!local?.filepath);
      instrument(WorkspaceState, 'fileStatus', 'status', (_status, _language, local) => !!local?.filepath);
      instrument(WorkspaceState, 'workspaceFile', 'status', (_workspace, desc) => !!desc?.filepath);
      instrument(WorkspaceState, 'initializeWorkspace', 'status', (_workspace, options) => !!options?.source?.length);
      const client = CollaborationSync.Client.prototype, originalApi = client.api;
      client.api = function (path, ...args) {
        if (path === '/join') counters.roomJoins++;
        return originalApi.call(this, path, ...args);
      };
    });
    const catalogCounters = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__managedCatalogCounters)));
    const assertMetadataOnly = async (page, phase) => {
      const counters = await catalogCounters(page);
      assert.equal(Object.values(counters.reads).some(Boolean), false, phase + ': no source/workspace/baseline reads');
      assert.equal(Object.values(counters.hydration).some(Boolean), false, phase + ': no workspace hydration');
      assert.equal(Object.values(counters.status).some(Boolean), false, phase + ': no translation status calculation');
      assert.equal(counters.roomJoins, 0, phase + ': no translation collaboration room joins');
      assert.equal(await page.evaluate(() => !!window.__managedFixtureApp._collaboration), false, phase + ': dashboard only observes aggregate presence');
    };
    const metadataGate = async (page, kind) => {
      const pattern = apiOrigin + '/v1/versions**';
      let release, received, requests = 0;
      const hold = new Promise(resolve => { release = resolve; }), hit = new Promise(resolve => { received = resolve; });
      const pending = new Set();
      const handler = async route => {
        const path = new URL(route.request().url()).pathname;
        const matches = route.request().method() === 'GET' && (kind === 'list' ? path === '/v1/versions' : /^\/v1\/versions\/[^/]+$/.test(path));
        if (!matches) return route.fallback();
        requests++; received();
        const completed = (async () => { await hold; await route.continue(); })();
        pending.add(completed);
        try { await completed; } finally { pending.delete(completed); }
      };
      await page.route(pattern, handler);
      return {
        wasRequested() { return requests > 0; },
        async wait() {
          let timer;
          try { await Promise.race([hit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('No gated ' + kind + ' metadata request')), 30000); })]); }
          finally { clearTimeout(timer); }
        },
        async release() { release(); await Promise.all([...pending]); await page.unroute(pattern, handler); },
      };
    };
    const importOffline = async page => {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Import previous version', exact: true }).click();
      await (await chooser).setFiles({ name: 'StatDescriptions.zip', mimeType: 'application/zip', buffer: bytes });
      await page.locator('#appDialogInput').fill('YES');
      await page.locator('.appDialogConfirm').click();
      await page.locator('.appDialogConfirm').filter({ hasText: 'Proceed' }).click();
      await page.waitForFunction(() => window.__managedFixtureApp.sourceLoaded && !window.__managedFixtureApp._importingSource);
    };
    const checkTooltip = async (page, target, expected) => {
      assert.equal(await target.getAttribute('title'), null, 'Uses the shared tooltip, without a native title');
      await target.hover(); await page.getByRole('tooltip').waitFor();
      assert.match(await page.getByRole('tooltip').textContent(), expected);
      await target.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert.equal(await target.evaluate(element => element === document.activeElement), true, 'Tooltip target is keyboard reachable');
      await page.getByRole('tooltip').waitFor(); assert.match(await page.getByRole('tooltip').textContent(), expected);
    };
    const checkStatusVersion = async (page, name, { ended = false, deadline = false, online = false } = {}) => {
      const label = page.locator('.workspaceStatus .versionStatusName');
      await label.waitFor(); assert.equal(await label.textContent(), name);
      assert.equal(await page.locator('.managedVersionBanner').count(), 0, 'No separate version banner');
      assert.equal(await page.locator('.workspaceActions').getByRole('button', { name: /^(Versions|Version dashboard)$/ }).count(), 0, 'No duplicate header chooser');
      await checkTooltip(page, label, /ZIP SHA-256: [a-f0-9]{64}/);
      assert.equal(await page.getByRole('button', { name: 'Import ZIP', exact: true }).isDisabled(), online,
        online ? 'Online versions disable Import ZIP' : 'Standalone Offline workspaces keep Import ZIP enabled');
      assert.equal(await page.locator('.workspaceStatus .versionBadge.ended').count(), ended ? 1 : 0);
      const reminder = page.locator('.workspaceStatus .versionDeadline');
      assert.equal(await reminder.count(), deadline ? 1 : 0);
      if (deadline) {
        assert.equal(await reminder.evaluate(element => element.previousElementSibling?.classList.contains('saved')), true, 'Deadline immediately follows Saved counts');
        await checkTooltip(page, reminder, /New Zealand.*local/);
      }
    };
    const openStatusChooser = async page => {
      await page.locator('.workspaceStatus .versionStatusName').click();
      await page.getByRole('region', { name: 'Source versions' }).waitFor();
      const activeId = await page.evaluate(() => window.__managedFixtureApp.managedActiveVersion?.id || window.__managedFixtureApp.activeManagedVersionId);
      if (activeId) {
        // The chooser intentionally waits for a source-row selection before loading team details.
        const activeRow = page.locator('.onlineVersionTable tbody tr[data-version-id="' + activeId + '"]');
        await activeRow.locator('td').first().locator('small').first().click();
        await page.locator('.teamVersionTable tbody tr').first().waitFor();
      }
    };
    const teamRow = (page, language) => page.locator('.teamVersionTable tbody tr').filter({
      has: page.locator('.teamEditorLink').filter({ hasText: new RegExp('^' + language + '$') }),
    });
    const versionRow = (page, name) => page.locator('.onlineVersionTable tbody tr').filter({ hasText: name });
    const waitWorkspace = (page, version, language) => page.waitForFunction(({ sourceHash, language }) => {
      const vm = window.__managedFixtureApp;
      return vm.sourceLoaded && vm.sourceIdentity === sourceHash && vm.lang === language
        && !vm.managedVersionBusy && !vm.versionStorageLoading && !vm.versionChooserVisible;
    }, { sourceHash: version.sourceHash, language });
    const managedApiProbes = (page, versionId, collectionId) => page.evaluate(async ({ versionId, collectionId }) => {
      const vm = window.__managedFixtureApp, token = vm._cloud.context().token;
      const routes = [
        ['GET', '/v1/versions?game=poe2&branchId=default'],
        ['GET', '/v1/versions/' + versionId],
        ['GET', '/v1/versions/' + versionId + '/original'],
        ['GET', '/v1/versions/' + versionId + '/presence'],
        ['POST', '/v1/versions/' + versionId + '/ticket'],
        ...(collectionId ? [['GET', '/v1/collections/' + collectionId], ['GET', '/v1/collections/' + collectionId + '/archive']] : []),
      ];
      return Promise.all(routes.map(async ([method, path]) => {
        // Raw authenticated requests prove the server gate without refreshing the SDK's cached permissions.
        const response = await fetch(vm._cloud.apiBase + path, { method, headers: { Authorization: 'Bearer ' + token,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) });
        const data = response.headers.get('Content-Type')?.includes('json') ? await response.json() : (await response.arrayBuffer(), null);
        return { method, path, status: response.status, code: data?.error?.code || null };
      }));
    }, { versionId, collectionId });
    const checkManagedDenied = async (page, phase) => {
      await page.getByRole('region', { name: 'Source versions' }).waitFor();
      await page.waitForFunction(() => {
        const vm = window.__managedFixtureApp;
        return vm.cloudSignedIn && !vm.cloudUser?.language && !vm.managedCatalogAccess && !vm.managedOnlineAvailable
          && vm.managedLocalVersionsLoaded && !vm.managedLocalVersionsLoading;
      });
      assert.equal(await page.locator('.onlineVersionTable tbody tr').count(), 0, phase + ': cached Online rows are hidden');
      assert.equal(await page.locator('.versionDetails').count(), 0, phase + ': no team details or metadata');
      assert.equal(await page.locator('.onlineVersions').getByRole('button', { name: 'Download original ZIP', exact: true }).count(), 0,
        phase + ': no archive actions');
      assert.match(await page.locator('.onlineVersions').textContent(), /needs a team language assignment/);
      assert.equal(await page.getByRole('region', { name: 'Offline workspace' }).count(), 1, phase + ': Offline work remains available');
      const access = await page.evaluate(() => {
        const vm = window.__managedFixtureApp;
        return { visible: vm.managedVisibleVersions.length, selected: vm.managedSelectedVersion, active: vm.managedActiveVersion,
          presenceOpen: !!vm._managedPresenceSocket, profile: vm.cloudProfileId, role: vm.cloudUser?.role };
      });
      assert.equal(access.visible, 0); assert.equal(access.selected, null); assert.equal(access.active, null);
      assert.equal(access.presenceOpen, false, phase + ': aggregate presence is disconnected');
      assert.equal(access.role, 'translator');
      return access;
    };
    const checkPrimary = async target => {
      const style = await target.evaluate(element => {
        const probe = document.createElement('i'); probe.style.backgroundColor = 'var(--ui-accent)'; document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor; probe.remove();
        return { primary: element.classList.contains('primaryAction'), expected, actual: getComputedStyle(element).backgroundColor };
      });
      assert.equal(style.primary, true, 'Open editor is the primary row action');
      assert.equal(style.actual, style.expected, 'Primary row action uses the theme accent');
    };
    const entryScope = page => page.evaluate(() => {
      const vm = window.__managedFixtureApp;
      return { chooser: vm.versionChooserVisible, selectedId: vm.selectedManagedVersionId,
        sourceHash: vm.sourceIdentity, language: vm.lang, editorVisible: vm.editorVisible };
    });
    const cancelEntry = async (page, action, warning) => {
      const before = await entryScope(page);
      await action(); await page.locator('#appDialogMessage').waitFor();
      assert.match(await page.locator('#appDialogMessage').textContent(), warning);
      await page.locator('.appDialogCancel').click();
      await page.waitForFunction(() => !window.__managedFixtureApp.managedVersionBusy);
      assert.deepEqual(await entryScope(page), before, 'Canceling entry keeps the chooser, selection, active language and workspace stable');
    };
    const acceptEntryWarning = async page => {
      await page.locator('.appDialogConfirm').waitFor();
      await page.locator('.appDialogConfirm').click();
    };
    const checkTranslatedDownload = async download => {
      assert.equal(download.suggestedFilename(), '2026-10-05_POE2_Translated_Thai.zip');
      const collectedZip = await JSZip.loadAsync(readFileSync(await download.path()));
      assert.deepEqual(Object.values(collectedZip.files).filter(file => !file.dir).map(file => file.name), [source.filepath]);
      const collectedFile = await collectedZip.file(source.filepath).async('uint8array');
      assert.deepEqual(Array.from(collectedFile.slice(0, 2)), [255, 254]);
      const collectedDesc = codec.parseText(source.filepath, codec.decodeUTF16(collectedFile), 'Thai', { strict: true });
      assert.deepEqual(collectedDesc.translations.Thai, ['ความเสียหายไฟที่แก้ไข']);
      assert.deepEqual(collectedDesc.translations.English, source.translations.English);
    };
    const [manager, translator] = pages;
    await bootstrap(manager, 'manager');
    await bootstrap(translator, 'thai'); await importOffline(translator);
    await translator.waitForFunction(() => window.__managedFixtureApp._collaboration?.snapshot().roomId);
    const standaloneRoomId = await translator.evaluate(() => window.__managedFixtureApp._collaboration.snapshot().roomId);
    const unnamedHash = await translator.evaluate(() => window.__managedFixtureApp.collaborationExportHash.slice(0, 12));
    assert.match(unnamedHash, /^[a-f0-9]{12}$/); await checkStatusVersion(translator, unnamedHash);
    await translator.evaluate(async () => { const vm = window.__managedFixtureApp; vm.importBaselineHashing = true; await vm.$nextTick(); });
    await translator.locator('.workspaceStatus .collaborationHashSpinner').waitFor();
    assert.equal(await translator.locator('.workspaceStatus .versionStatusName').count(), 0);
    await translator.evaluate(async () => { const vm = window.__managedFixtureApp; vm.importBaselineHashing = false; await vm.$nextTick(); });
    await translator.evaluate(filepath => window.__managedFixtureApp.editFile(filepath), source.filepath);
    await translator.locator('input[placeholder="Translation"]').filter({ visible: true }).first().fill('ความเสียหายไฟที่แก้ไข');
    await translator.getByRole('button', { name: 'Save & close', exact: true }).click();
    await translator.evaluate(async () => { const vm = window.__managedFixtureApp; await vm.waitForPendingSaves(); await vm._collaboration.retry(); });
    await manager.getByRole('button', { name: 'Upload next version', exact: true }).click();
    await manager.locator('#managerUploadName').fill('2026-10-05_POE2');
    await manager.locator('#managerUploadArchive').setInputFiles({ name: 'StatDescriptions.zip', mimeType: 'application/zip', buffer: bytes });
    await manager.getByRole('button', { name: 'Upload and prepare', exact: true }).click();
    await manager.waitForFunction(() => window.__managedFixtureApp.managedUpload?.status === 'prepared' || window.__managedFixtureApp.managedUploadError);
    const uploadError = await manager.evaluate(() => window.__managedFixtureApp.managedUploadError);
    assert.equal(uploadError, '', 'Manager upload preparation');
    const existingTeam = await manager.evaluate(() => window.__managedFixtureApp.managedUpload.existingTeams.find(team => team.language === 'Thai'));
    assert.equal(existingTeam.roomId, standaloneRoomId); assert.equal(existingTeam.isManaged, false);
    assert.equal(existingTeam.workStarted, true); assert.equal(existingTeam.savedFileCount, 1);
    assert.ok(existingTeam.historyCount > 0); assert.ok(existingTeam.presence.length > 0);
    await checkTooltip(manager, manager.locator('.versionTeamChip').filter({ hasText: 'Thai' }), /Standalone \/ Offline import/);
    assert.match(await manager.getByRole('tooltip').textContent(), /Shared history: [1-9]/);
    await manager.screenshot({ path: join(directory, 'prepared-existing-work.png'), fullPage: true });
    await manager.getByRole('button', { name: 'Publish to all teams', exact: true }).waitFor({ timeout: 30000 });
    await manager.getByRole('button', { name: 'Publish to all teams', exact: true }).click();
    await manager.locator('.teamVersionTable tbody tr').first().waitFor();
    assert.equal(await manager.locator('.teamVersionTable tbody tr').count(), 12);
    const version = await manager.evaluate(() => JSON.parse(JSON.stringify(window.__managedFixtureApp.managedSelectedVersion)));
    assert.equal(version.name, '2026-10-05_POE2'); assert.equal(version.isHead, true);
    await translator.waitForFunction(() => window.__managedFixtureApp.managedImportZipDisabled);
    assert.equal(await translator.getByRole('button', { name: 'Import ZIP', exact: true }).isDisabled(), true,
      'Manager publication adopts the active matching Offline workspace and disables Import ZIP');
    const probeContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    const catalogProbe = await probeContext.newPage();
    catalogProbe.on('pageerror', error => failures.push(error.message));
    await bootstrapProfile(catalogProbe, 'manager'); await installCatalogCounters(catalogProbe);
    const initialList = await metadataGate(catalogProbe, 'list'), initialDetails = await metadataGate(catalogProbe, 'details');
    await catalogProbe.getByRole('button', { name: 'PoE2 Path of Exile 2', exact: true }).click();
    await catalogProbe.getByRole('region', { name: 'Source versions' }).waitFor(); await initialList.wait();
    await catalogProbe.locator('.onlineVersions .versionLoading').filter({ hasText: 'Loading online versions…' }).waitFor();
    assert.equal(await catalogProbe.locator('.onlineVersionTable tbody tr').count(), 0);
    assert.equal(await catalogProbe.getByText('No source versions have been published for this game.', { exact: true }).count(), 0,
      'Pending initial metadata does not flash the settled empty state');
    assert.equal(await catalogProbe.locator('.versionCatalogHeader .browserWorkSpinner').count(), 0,
      'Catalog entry does not show workspace preparation progress');
    await assertMetadataOnly(catalogProbe, 'Dashboard displayed before initial list response');
    const loadingSnapshot = () => catalogProbe.evaluate(() => {
      const vm = window.__managedFixtureApp, element = document.querySelector('.onlineVersions .versionLoading');
      const style = element && getComputedStyle(element), spinner = element?.querySelector('.browserWorkSpinner');
      return { loading: vm.managedCatalogLoading, loaded: vm.managedCatalogLoaded, requestPending: !!vm._managedRefreshPending,
        scopeRun: vm._managedScopeRun, text: element?.textContent.trim() || '',
        visible: !!element && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
        spinnerWidth: spinner?.getBoundingClientRect().width || 0, rows: document.querySelectorAll('.onlineVersionTable tbody tr').length };
    });
    const beforeCapture = await loadingSnapshot(), captureStarted = Date.now();
    await catalogProbe.screenshot({ path: join(directory, 'catalog-initial-loading.png'), fullPage: false });
    const afterCapture = await loadingSnapshot();
    writeFileSync(join(directory, 'catalog-initial-loading-state.json'), JSON.stringify({ before: beforeCapture,
      after: afterCapture, captureElapsedMs: Date.now() - captureStarted }, null, 2));
    for (const state of [beforeCapture, afterCapture]) {
      assert.equal(state.loading, true, 'Initial catalog loading remains true throughout the held request');
      assert.equal(state.loaded, false); assert.equal(state.requestPending, true); assert.equal(state.rows, 0);
      assert.equal(state.visible, true, 'Initial loader remains visually present before and after screenshot');
      assert.equal(state.text, 'Loading online versions…'); assert.ok(state.spinnerWidth > 0, 'Initial spinner has visible dimensions');
    }
    await initialList.release(); await catalogProbe.locator('.onlineVersionTable tbody tr').first().waitFor();
    assert.equal(initialDetails.wasRequested(), false, 'Initial catalog render does not prefetch any team details');
    assert.equal(await catalogProbe.locator('.versionDetails').count(), 0, 'Team details wait for explicit source selection');
    await versionRow(catalogProbe, version.name).locator('.versionSelect').click(); await initialDetails.wait();
    await catalogProbe.locator('.versionDetails .versionLoading').filter({ hasText: 'Loading team details…' }).waitFor();
    assert.equal(await catalogProbe.locator('.onlineVersionTable tbody tr').count(), 1);
    assert.equal(await catalogProbe.locator('.teamVersionTable tbody tr').count(), 0);
    assert.equal(await catalogProbe.locator('.onlineVersions .versionLoading').count(), 0);
    await assertMetadataOnly(catalogProbe, 'Source row displayed before initial team-details response');
    await initialDetails.release(); await catalogProbe.locator('.teamVersionTable tbody tr').first().waitFor();
    assert.equal(await catalogProbe.locator('.teamVersionTable tbody tr').count(), 12);
    await catalogProbe.waitForFunction(() => !window.__managedFixtureApp._managedRefreshPending);
    await assertMetadataOnly(catalogProbe, 'Settled initial source/team metadata');
    const stableMetadata = await catalogProbe.evaluate(() => {
      window.__catalogStableNodes = { sourceRow: document.querySelector('.onlineVersionTable tbody tr'),
        teamRow: document.querySelector('.teamVersionTable tbody tr'), header: document.querySelector('.versionDetails h2') };
      return { version: window.__catalogStableNodes.sourceRow.textContent, team: window.__catalogStableNodes.teamRow.textContent,
        header: window.__catalogStableNodes.header.textContent };
    });
    const assertSettledCatalog = async () => {
      const current = await catalogProbe.evaluate(() => ({ version: document.querySelector('.onlineVersionTable tbody tr')?.textContent,
        team: document.querySelector('.teamVersionTable tbody tr')?.textContent, header: document.querySelector('.versionDetails h2')?.textContent,
        sameRows: window.__catalogStableNodes.sourceRow === document.querySelector('.onlineVersionTable tbody tr')
          && window.__catalogStableNodes.teamRow === document.querySelector('.teamVersionTable tbody tr') }));
      assert.deepEqual({ version: current.version, team: current.team, header: current.header }, stableMetadata,
        'Settled cached metadata stays visible during background requests');
      assert.equal(current.sameRows, true, 'Background requests preserve existing table rows');
      assert.equal(await catalogProbe.locator('.versionLoading').count(), 0,
        'Background metadata requests remain silent');
      await assertMetadataOnly(catalogProbe, 'Background source/team metadata refresh');
    };
    const backgroundList = await metadataGate(catalogProbe, 'list');
    await catalogProbe.evaluate(() => { window.__catalogRefreshTask = window.__managedFixtureApp.refreshManagedVersions(); });
    await backgroundList.wait(); await assertSettledCatalog();
    await backgroundList.release(); await catalogProbe.evaluate(() => window.__catalogRefreshTask);
    const backgroundDetails = await metadataGate(catalogProbe, 'details');
    await catalogProbe.evaluate(id => { window.__catalogDetailTask = window.__managedFixtureApp.managedReadDetails(id, false); }, version.id);
    await backgroundDetails.wait(); await assertSettledCatalog();
    await backgroundDetails.release(); await catalogProbe.evaluate(() => window.__catalogDetailTask);
    await assertSettledCatalog();
    await teamRow(catalogProbe, 'French').locator('.teamEditorLink').click(); await waitWorkspace(catalogProbe, version, 'French');
    await catalogProbe.waitForFunction(() => window.__managedFixtureApp._collaboration?.snapshot().roomId);
    const activatedProbe = await catalogCounters(catalogProbe);
    assert.ok(activatedProbe.reads.getSource > 0 && activatedProbe.reads.getWorkspace > 0 && activatedProbe.reads.getImportedBaseline > 0,
      'Explicit editor activation reads its source, workspace and immutable baseline');
    assert.ok(activatedProbe.hydration.loadVersionedStorage > 0 && Object.values(activatedProbe.status).some(Boolean),
      'Explicit editor activation performs translation hydration/status work');
    assert.ok(activatedProbe.roomJoins > 0, 'Explicit editor activation joins its exact-language collaboration room');
    await probeContext.close();
    results.push('Dashboard renders before gated source/team metadata, shows initial loaders only, keeps cached rows/details stable during silent polls, and defers all workspace/status/collaboration work until editor activation');
    const thaiRow = teamRow(manager, 'Thai');
    await manager.waitForFunction(() => window.__managedFixtureApp.managedVersionDetails?.teams.find(team => team.language === 'Thai')?.counts.saved === 1);
    assert.equal(await manager.evaluate(() => window.__managedFixtureApp.managedVersionDetails.teams.find(team => team.language === 'Thai').roomId), standaloneRoomId);
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await manager.evaluate(theme => { const vm = window.__managedFixtureApp; vm.theme = theme; vm.applyTheme(theme); }, theme);
      await manager.keyboard.press('Tab');
      assert.equal(await manager.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await manager.locator('.versionProgressTrack').count(), 12);
      assert.equal(await manager.locator('.teamVersionTable thead th').count(), 4);
      assert.equal(await manager.locator('.onlineVersions thead th').count(), 4);
      const columnNames = await manager.locator('.versionTable th').allTextContents();
      assert.equal(columnNames.some(name => /Window|Teams ended/i.test(name)), false, 'Window and collection-summary columns are removed');
      const progress = await thaiRow.locator('.versionProgress').evaluate(element => ({
        saved: element.getAttribute('aria-valuenow'), total: element.getAttribute('aria-valuemax'),
        widths: Array.from(element.querySelectorAll('.versionProgressTrack > span')).map(segment => parseFloat(segment.style.width)),
      }));
      assert.deepEqual(progress, { saved: '1', total: '2', widths: [0, 50, 50] }, 'Revised remains part of Saved, using Missing + Saved denominator');
      const layout = await manager.evaluate(() => ({
        alignment: Array.from(document.querySelectorAll('.versionTable th, .versionTable td')).map(cell => getComputedStyle(cell).verticalAlign),
        badges: Array.from(document.querySelectorAll('.versionCatalog .versionBadge')).map(badge => ({ height: badge.getBoundingClientRect().height,
          minWidth: getComputedStyle(badge).minWidth, fontSize: parseFloat(getComputedStyle(badge).fontSize) })),
        nativeTitles: document.querySelectorAll('.versionCatalog [title]').length,
      }));
      assert.ok(layout.alignment.every(alignment => alignment === 'middle'), 'Headers and data cells center vertically in ' + theme);
      assert.ok(layout.badges.every(badge => badge.height <= 22 && badge.minWidth === '0px' && badge.fontSize <= 11), 'Compact badges in ' + theme);
      assert.equal(layout.nativeTitles, 0, 'Dashboard uses shared tooltips only in ' + theme);
      assert.equal(await thaiRow.getByRole('button', { name: 'Open editor', exact: true }).evaluate(element => element.classList.contains('primaryAction')), false,
        'Manager team actions keep equal prominence across all languages');
      await checkTooltip(manager, manager.locator('.onlineVersions time').first(), /New Zealand.*local/);
      await checkTooltip(manager, thaiRow.locator('.versionProgress'), /Revised: 1 \(included in Saved\)/);
      assert.equal(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, 'No page overflow in ' + theme);
      await manager.locator('.teamVersionTable tbody tr').nth(2).hover();
      const hoverColors = await manager.evaluate(() => {
        const probe = document.createElement('i'); probe.style.backgroundColor = 'var(--ui-accent-soft)'; document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor; probe.remove();
        return { expected, actual: getComputedStyle(document.querySelectorAll('.teamVersionTable tbody tr')[2]).backgroundColor };
      });
      assert.equal(hoverColors.actual, hoverColors.expected, 'Hovered row uses soft theme background in ' + theme);
      await manager.screenshot({ path: join(directory, 'dashboard-' + theme + '.png'), fullPage: true });
    }
    results.push('Prepared upload discovers matching standalone Saved work/history/presence and reuses its room; 12-team combined progress, compact aligned badges, hover/keyboard tooltips in four themes');
    const managerVersionRow = versionRow(manager, version.name);
    const managerBeforeRowOpen = await entryScope(manager);
    await managerVersionRow.locator('td').first().locator('small').first().dblclick();
    await manager.waitForFunction(() => !window.__managedFixtureApp.managedVersionBusy);
    assert.deepEqual(await entryScope(manager), managerBeforeRowOpen, 'Manager Online double-click selects without choosing a team language');
    assert.equal(await managerVersionRow.getByRole('button', { name: 'Open editor', exact: true }).count(), 0,
      'Manager upper row has no implicit-language Open editor action');
    await managerVersionRow.locator('.versionSelect').focus(); await manager.keyboard.press('Enter');
    await manager.waitForFunction(id => window.__managedFixtureApp.managedVersionDetails?.version.id === id, version.id);
    assert.deepEqual(await entryScope(manager), managerBeforeRowOpen, 'Manager version name is a keyboard-selectable details control');
    assert.equal(await manager.locator('.versionDetails > .versionPanelHeading button').count(), 0, 'Source actions reside in the upper table');
    await manager.setViewportSize({ width: 1100, height: 820 });
    const actionMenu = managerVersionRow.locator('.versionActionMenu'), menuSummary = actionMenu.locator('summary');
    const closedRowHeight = await managerVersionRow.evaluate(element => element.getBoundingClientRect().height);
    const checkFloatingMenu = async () => {
      await actionMenu.locator('.versionActionMenuItems').waitFor();
      await manager.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await actionMenu.evaluate(element => {
        const items = element.querySelector('.versionActionMenuItems'), bounds = items.getBoundingClientRect();
        return { fixed: getComputedStyle(items).position === 'fixed', rowHeight: element.closest('tr').getBoundingClientRect().height,
          visible: bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight };
      });
      assert.equal(geometry.fixed, true, 'Compact actions float above the table');
      assert.ok(Math.abs(geometry.rowHeight - closedRowHeight) <= 1, 'Opening compact actions leaves the version row height unchanged');
      assert.equal(geometry.visible, true, 'Floating compact actions fit within the viewport');
    };
    await menuSummary.waitFor(); await menuSummary.focus(); await manager.keyboard.press('Enter');
    assert.equal(await actionMenu.getAttribute('open'), '', 'Compact source actions open from the keyboard');
    await checkFloatingMenu();
    await manager.locator('.versionCatalogHeader h1').click();
    assert.equal(await actionMenu.getAttribute('open'), null, 'Clicking outside closes the floating actions');
    await menuSummary.focus(); await manager.keyboard.press('Space');
    assert.equal(await actionMenu.getAttribute('open'), '', 'Space also opens compact source actions');
    await checkFloatingMenu();
    await actionMenu.getByRole('button', { name: 'Edit name/deadline', exact: true }).click();
    await manager.locator('#versionMetadataName').waitFor();
    assert.equal(await actionMenu.getAttribute('open'), null, 'Invoking metadata closes the floating actions');
    assert.equal(await manager.locator('#versionMetadataName').inputValue(), version.name);
    await manager.getByRole('dialog', { name: 'Edit version details' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await menuSummary.focus();
    if (await actionMenu.getAttribute('open') === null) await manager.keyboard.press('Space');
    await manager.keyboard.press('Escape');
    assert.equal(await actionMenu.getAttribute('open'), null, 'Escape closes the compact menu');
    assert.equal(await menuSummary.evaluate(element => element === document.activeElement), true, 'Escape returns focus to the action summary');
    await menuSummary.click();
    const originalDownload = manager.waitForEvent('download');
    await actionMenu.getByRole('button', { name: 'Download original ZIP', exact: true }).click();
    const downloadedOriginal = await originalDownload;
    assert.equal(await actionMenu.getAttribute('open'), null, 'Invoking original download closes the floating actions');
    assert.equal(downloadedOriginal.suggestedFilename(), version.name + '_StatDescriptions.zip');
    assert.deepEqual(readFileSync(await downloadedOriginal.path()), bytes, 'Upper-row original download preserves the exact ZIP bytes');
    assert.equal(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, 'Compact action menu stays inside the desktop viewport');
    await menuSummary.click(); await checkFloatingMenu();
    // A full-page capture temporarily resizes the viewport and intentionally dismisses floating menus.
    await manager.screenshot({ path: join(directory, 'dashboard-compact-menu.png'), fullPage: false });
    await manager.locator('.versionCatalogHeader h1').click();
    await manager.setViewportSize({ width: 1440, height: 1000 });
    await openStatusChooser(translator);
    await translator.locator('.teamVersionTable tbody tr').first().waitFor();
    assert.equal(await translator.locator('.teamVersionTable tbody tr').count(), 1);
    assert.equal(await translator.getByRole('button', { name: 'Upload next version', exact: true }).count(), 0);
    const translatorVersionRow = versionRow(translator, version.name);
    await translatorVersionRow.locator('td').first().locator('small').first().click();
    assert.equal(await translator.evaluate(() => window.__managedFixtureApp.versionChooserVisible), true, 'Online single-click selects details without opening');
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await translator.evaluate(theme => { const vm = window.__managedFixtureApp; vm.theme = theme; vm.applyTheme(theme); }, theme);
      await checkPrimary(translatorVersionRow.getByRole('button', { name: 'Open editor', exact: true }));
      await checkPrimary(teamRow(translator, 'Thai').getByRole('button', { name: 'Open editor', exact: true }));
    }
    await translatorVersionRow.locator('.versionEditorLink').focus(); await translator.keyboard.press('Enter');
    await waitWorkspace(translator, version, 'Thai');
    await openStatusChooser(translator);
    await versionRow(translator, version.name).locator('td').first().locator('small').first().dblclick();
    await waitWorkspace(translator, version, 'Thai');
    await openStatusChooser(translator);
    await teamRow(translator, 'Thai').locator('.teamEditorLink').click();
    await waitWorkspace(translator, version, 'Thai');
    await openStatusChooser(translator);
    await versionRow(translator, version.name).getByRole('button', { name: 'Open editor', exact: true }).click();
    await waitWorkspace(translator, version, 'Thai');
    await checkStatusVersion(translator, version.name, { deadline: true, online: true });
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await translator.evaluate(theme => { const vm = window.__managedFixtureApp; vm.theme = theme; vm.applyTheme(theme); }, theme);
      await checkStatusVersion(translator, version.name, { deadline: true, online: true });
      assert.equal(await translator.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, 'Footer fits in ' + theme);
      await translator.screenshot({ path: join(directory, 'footer-' + theme + '.png'), fullPage: true });
    }
    await translator.setViewportSize({ width: 1100, height: 820 });
    await checkStatusVersion(translator, version.name, { deadline: true, online: true });
    assert.equal(await translator.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, 'Footer fits a resized desktop window');
    await translator.screenshot({ path: join(directory, 'footer-resized-desktop.png'), fullPage: true });
    await translator.setViewportSize({ width: 1440, height: 1000 });
    await translator.evaluate(async filepath => { const vm = window.__managedFixtureApp; vm.inlineEditor = false; await vm.editFile(filepath); }, source.filepath);
    const field = translator.locator('input[placeholder="Translation"]').filter({ visible: true }).first();
    await field.fill('ความเสียหายไฟที่แก้ไข');
    const guardedImport = await translator.evaluate(async () => {
      const vm = window.__managedFixtureApp;
      const before = JSON.stringify(vm.editorCurrentEditingDesc);
      const visible = vm.editorVisible;
      await vm.importZipClicked(); await vm.$nextTick();
      return { dialog: vm.importDialogVisible, editorUnchanged: before === JSON.stringify(vm.editorCurrentEditingDesc),
        visibilityUnchanged: visible === vm.editorVisible };
    });
    assert.deepEqual(guardedImport, { dialog: false, editorUnchanged: true, visibilityUnchanged: true },
      'Direct Online import action leaves the dialog closed and the active editor unchanged');
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await translator.evaluate(theme => { const vm = window.__managedFixtureApp; vm.theme = theme; vm.applyTheme(theme); }, theme);
      await translator.keyboard.press('Tab');
      assert.equal(await translator.locator('html').getAttribute('data-theme'), theme);
      await checkTooltip(translator, translator.locator('.editorVersionContext .versionStatusName'), /Import deadline:.*New Zealand/);
      assert.equal(await translator.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, 'Editor fits ' + theme);
      await translator.screenshot({ path: join(directory, 'translator-' + theme + '.png'), fullPage: true });
    }
    await translator.getByRole('button', { name: 'Save & close', exact: true }).click();
    await translator.waitForFunction(() => window.__managedFixtureApp.statistic.hasChanges === 1);
    await translator.evaluate(async () => { const vm = window.__managedFixtureApp; await vm.waitForPendingSaves(); await vm._collaboration?.retry(); });
    await manager.evaluate(async () => { const vm = window.__managedFixtureApp; await vm.managedReadDetails(vm.selectedManagedVersionId); });
    await manager.waitForFunction(() => window.__managedFixtureApp.managedVersionDetails?.teams.find(team => team.language === 'Thai')?.counts.saved === 1);
    await manager.waitForFunction(() => window.__managedFixtureApp.managedVersionDetails?.teams.find(team => team.language === 'Thai')?.presence.length > 0);
    assert.equal(await manager.evaluate(() => !!window.__managedFixtureApp._collaboration), false, 'Dashboard does not join team editing rooms');
    results.push('Translator language isolation, original download/open, keyboard translation save, real worker/API synchronization');
    const beforeDownloadOnly = api.locals.versions.detail(version.id, 'fixture-manager').teams.find(team => team.language === 'Thai');
    const onlyDownload = manager.waitForEvent('download');
    await thaiRow.getByRole('button', { name: 'Download only', exact: true }).click();
    await checkTranslatedDownload(await onlyDownload);
    await manager.waitForFunction(() => !window.__managedFixtureApp.managedVersionBusy);
    const afterDownloadOnly = api.locals.versions.detail(version.id, 'fixture-manager').teams.find(team => team.language === 'Thai');
    assert.equal(afterDownloadOnly.ended, beforeDownloadOnly.ended);
    assert.deepEqual(afterDownloadOnly.latestCollection, beforeDownloadOnly.latestCollection, 'Download only preserves ending collection/cutoff');
    const downloadSnapshot = afterDownloadOnly.collections.find(collection => collection.kind === 'download_only');
    assert.ok(downloadSnapshot?.downloadReady); assert.equal(downloadSnapshot.endWindow, false);
    assert.equal(await thaiRow.locator('td').first().locator('.versionBadge.ended').count(), 0);
    results.push('Download only retains a Saved-only ZIP snapshot without changing the window or latest ending collection');
    const download = manager.waitForEvent('download');
    await thaiRow.getByRole('button', { name: 'Download and mark ended', exact: true }).click();
    await manager.locator('.appDialogConfirm').click();
    await checkTranslatedDownload(await download);
    await manager.waitForFunction(() => window.__managedFixtureApp.managedVersionDetails.teams.find(team => team.language === 'Thai').ended);
    assert.equal(await thaiRow.locator('td').first().locator('.versionBadge.ended').textContent(), 'Ended');
    assert.equal(await manager.locator('.onlineVersions tbody tr').first().locator('td').first().locator('.versionBadge.ended').count(), 0,
      'Manager version badge waits until every team ends');
    const remainingTeams = await manager.evaluate(() => window.__managedFixtureApp.managedVersionDetails.teams.filter(team => !team.ended).map(team => team.language));
    for (const language of remainingTeams) {
      const row = teamRow(manager, language);
      await row.getByRole('button', { name: 'Mark ended — no saved files', exact: true }).click();
      await manager.locator('.appDialogConfirm').click();
      await manager.waitForFunction(language => {
        const vm = window.__managedFixtureApp;
        return !vm.managedVersionBusy && vm.managedVersionDetails.teams.find(team => team.language === language).ended;
      }, language);
    }
    await manager.waitForFunction(() => window.__managedFixtureApp.managedVersions[0].endedTeamCount === 12);
    assert.equal(await manager.locator('.onlineVersions tbody tr').first().locator('td').first().locator('.versionBadge.ended').textContent(), 'Ended');
    await translator.evaluate(async () => { await window.__managedFixtureApp.managedRefreshActive(); });
    await checkStatusVersion(translator, version.name, { ended: true, deadline: true, online: true });
    await openStatusChooser(translator);
    assert.equal(await translator.locator('.onlineVersions tbody tr').first().locator('td').first().locator('.versionBadge.ended').textContent(), 'Ended');
    assert.equal(await translator.locator('.teamVersionTable tbody tr').first().locator('td').first().locator('.versionBadge.ended').textContent(), 'Ended');
    await cancelEntry(translator, () => teamRow(translator, 'Thai').locator('.teamEditorLink').click(), /ended/i);
    await versionRow(translator, version.name).getByRole('button', { name: 'Open editor', exact: true }).click();
    await acceptEntryWarning(translator);
    await translator.waitForFunction(() => !window.__managedFixtureApp.managedVersionBusy && !window.__managedFixtureApp.versionChooserVisible);
    await translator.evaluate(filepath => window.__managedFixtureApp.editFile(filepath), source.filepath);
    assert.equal(await translator.locator('.appDialogConfirm').count(), 0, 'Accepted ended entry warning covers editing in the same session');
    await translator.evaluate(async () => { await window.__managedFixtureApp.editorExit(); });
    results.push('First-column team/assigned-team/all-team Ended badges, footer name/deadline and tooltip, sole status-label chooser, hashing spinner and editable ended warning');
    await translator.route(apiOrigin + '/**', route => route.abort());
    await translator.reload();
    await translator.waitForFunction(() => window.__managedFixtureApp?.offlineStoreReady);
    await installCatalogCounters(translator);
    await translator.getByRole('button', { name: 'PoE2 Path of Exile 2', exact: true }).click();
    await translator.waitForFunction(() => window.__managedFixtureApp?.offlineStoreReady && window.__managedFixtureApp?.versionChooserVisible
      && !window.__managedFixtureApp?.versionStorageLoading).catch(async error => {
      console.error('Offline reload state: ' + JSON.stringify(await translator.evaluate(async () => {
        const vm = window.__managedFixtureApp;
        return { ready: vm?.offlineStoreReady, sourceLoaded: vm?.sourceLoaded, game: vm?.gameVersion,
          language: vm?.lang, account: vm?.cloudUser?.id, cloudStatus: vm?.cloudStatus,
          sourceHash: vm?.sourceIdentity, scope: vm?.managedWorkspaceScope(), settings: vm?.settings,
          migration: vm?.showMigrationDialog, chooser: vm?.showGameVersionDialog,
          managedError: vm?.managedVisibleError, cloudError: vm?.cloudError,
          localDescs: { sourceHash: vm?.localDescs?.sourceHash, count: vm?.localDescs?.descs?.length },
          activeScope: await OfflineStore.getActiveWorkspaceScope?.(vm?.gameVersion),
          storageErrors: vm?.storageError, saveError: vm?.pendingSaveError };
      })));
      await translator.screenshot({ path: join(directory, 'offline-reload-failure.png'), fullPage: true });
      throw error;
    });
    await assertMetadataOnly(translator, 'Cached Online game selection without API connectivity');
    await versionRow(translator, version.name).locator('td').first().locator('small').first().click();
    await translator.waitForFunction(versionId => {
      const vm = window.__managedFixtureApp, team = vm.managedVersionDetails?.teams.find(team => team.language === 'Thai');
      return vm.managedSelectedVersion?.id === versionId && vm.managedVersionDetails?.version?.id === versionId
        && team?.ended && team.counts.saved === 1;
    }, version.id);
    assert.equal(await translator.locator('.versionDetails h2').textContent(), version.name + ' HEAD');
    await assertMetadataOnly(translator, 'Cached Online version/team selection');
    await versionRow(translator, version.name).getByRole('button', { name: 'Open editor', exact: true }).click();
    await acceptEntryWarning(translator);
    await translator.waitForFunction(sourceHash => {
      const vm = window.__managedFixtureApp;
      return !vm.managedVersionBusy && !vm.versionChooserVisible && vm.sourceLoaded && vm.sourceIdentity === sourceHash;
    }, version.sourceHash);
    await checkStatusVersion(translator, version.name, { ended: true, deadline: true, online: true });
    const activatedCached = await catalogCounters(translator);
    assert.ok(activatedCached.reads.getSource > 0 && activatedCached.reads.getWorkspace > 0 && activatedCached.reads.getImportedBaseline > 0,
      'Cached editor activation reads its source, workspace and accepted baseline');
    assert.ok(activatedCached.hydration.loadVersionedStorage > 0 && Object.values(activatedCached.status).some(Boolean),
      'Cached editor activation hydrates translations and calculates status');
    const stored = await translator.evaluate(async () => {
      const vm = window.__managedFixtureApp; const scope = vm.managedWorkspaceScope();
      const workspace = await OfflineStore.getVersionWorkspace(scope, 'Thai');
      return { version: vm.sourceIdentity, saved: workspace.staged?.Thai?.['fixture/fire.txt']?.translations,
        baseline: workspace.importArchive.baselineId, testMode: vm.testMode, versions: (await OfflineStore.listLocalVersions(scope)).length };
    });
    assert.equal(stored.testMode, false); assert.equal(stored.version, version.sourceHash);
    assert.equal(stored.baseline, version.sourceHash); assert.deepEqual(stored.saved, ['ความเสียหายไฟที่แก้ไข']);
    assert.ok(stored.versions >= 1);
    results.push('API-offline reload selects cached version/team Ended and Saved details, continues the exact baseline, and retains original ZIP/work in IndexedDB');
    const offlineContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    const offline = await offlineContext.newPage();
    offline.on('pageerror', error => failures.push(error.message));
    await ready(offline);
    await offline.evaluate(async () => {
      const vm = window.__managedFixtureApp; vm.lang = 'Thai'; vm.needsInitialSettings = false; vm.showSetting = false;
      await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
      await vm.activateGameVersion('poe2', { checkMigration: false });
    });
    await importOffline(offline);
    const offlineHash = await offline.evaluate(() => window.__managedFixtureApp.collaborationExportHash.slice(0, 12));
    await checkStatusVersion(offline, offlineHash); await openStatusChooser(offline);
    await offline.locator('#offlineVersionName').fill('Local reference export');
    await offline.locator('#offlineVersionName').press('Enter');
    await offline.waitForFunction(() => window.__managedFixtureApp.managedOfflineVersion?.name === 'Local reference export');
    await offline.getByRole('button', { name: 'Continue offline workspace', exact: true }).click();
    await offline.waitForFunction(() => window.__managedFixtureApp.sourceLoaded && !window.__managedFixtureApp.versionChooserVisible);
    assert.equal(await offline.evaluate(() => window.__managedFixtureApp.managedOfflineVersion?.name), 'Local reference export');
    assert.equal(await offline.evaluate(() => window.__managedFixtureApp.cloudSignedIn), false);
    await checkStatusVersion(offline, 'Local reference export');
    await openStatusChooser(offline);
    await offline.getByRole('button', { name: 'Continue offline workspace', exact: true }).click();
    await offline.waitForFunction(() => !window.__managedFixtureApp.versionStorageLoading && !window.__managedFixtureApp.versionChooserVisible);
    await offline.reload();
    await offline.waitForFunction(() => window.__managedFixtureApp?.offlineStoreReady);
    await installCatalogCounters(offline);
    await offline.getByRole('button', { name: 'PoE2 Path of Exile 2', exact: true }).click();
    await offline.locator('#offlineVersionName').waitFor();
    assert.equal(await offline.locator('#offlineVersionName').inputValue(), 'Local reference export');
    await assertMetadataOnly(offline, 'Named standalone Offline game selection');
    results.push('Unsigned Offline card keeps original import warnings, editable local name, keyboard naming and Continue workflow');
    results.push('Import ZIP remains enabled for named/unnamed Offline workspaces and disabled for adopted, published, ended and cached Online versions');
    const successorZip = await JSZip.loadAsync(bytes); successorZip.comment = 'Distinct successor archive for catalog navigation fixture';
    const successorBytes = await successorZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await manager.getByRole('button', { name: 'Upload next version', exact: true }).click();
    await manager.locator('#managerUploadName').fill('2026-10-12_POE2');
    await manager.locator('#managerUploadArchive').setInputFiles({ name: 'StatDescriptions.zip', mimeType: 'application/zip', buffer: successorBytes });
    await manager.getByRole('button', { name: 'Upload and prepare', exact: true }).click();
    await manager.waitForFunction(() => window.__managedFixtureApp.managedUpload?.status === 'prepared' || window.__managedFixtureApp.managedUploadError);
    assert.equal(await manager.evaluate(() => window.__managedFixtureApp.managedUploadError), '');
    await manager.getByRole('button', { name: 'Publish to all teams', exact: true }).click();
    await manager.waitForFunction(() => window.__managedFixtureApp.managedSelectedVersion?.name === '2026-10-12_POE2'
      && !window.__managedFixtureApp.managedVersionBusy && window.__managedFixtureApp.managedVersionDetails?.teams.length === 12);
    const successor = await manager.evaluate(() => JSON.parse(JSON.stringify(window.__managedFixtureApp.managedSelectedVersion)));
    assert.equal(successor.isHead, true); assert.notEqual(successor.sourceHash, version.sourceHash);
    assert.equal(await manager.locator('.onlineVersionTable tbody tr').count(), 2);
    const frenchLink = teamRow(manager, 'French').locator('.teamEditorLink');
    await frenchLink.focus(); await manager.keyboard.press('Enter'); await waitWorkspace(manager, successor, 'French');
    await openStatusChooser(manager); await teamRow(manager, 'German').waitFor();
    await teamRow(manager, 'German').locator('td').nth(1).dblclick(); await waitWorkspace(manager, successor, 'German');
    await openStatusChooser(manager); await teamRow(manager, 'French').waitFor();
    await teamRow(manager, 'French').getByRole('button', { name: 'Open editor', exact: true }).click();
    await waitWorkspace(manager, successor, 'French');
    await openStatusChooser(manager);
    await translator.unroute(apiOrigin + '/**');
    await translator.evaluate(async () => { const vm = window.__managedFixtureApp; await vm.refreshManagedVersions(); await vm.managedRefreshActive(); });
    await openStatusChooser(translator);
    await translator.waitForFunction(() => window.__managedFixtureApp.managedVersions.length === 2);
    const olderRow = versionRow(translator, version.name);
    await olderRow.locator('td').first().locator('small').first().click();
    await translator.waitForFunction(id => window.__managedFixtureApp.selectedManagedVersionId === id
      && window.__managedFixtureApp.managedVersionDetails?.version.id === id, version.id);
    await cancelEntry(translator, async () => {
      await olderRow.locator('.versionEditorLink').focus(); await translator.keyboard.press('Enter');
    }, /not HEAD[\s\S]*ended/i);
    await cancelEntry(translator, () => teamRow(translator, 'Thai').locator('td').nth(1).dblclick(), /not HEAD[\s\S]*ended/i);
    await versionRow(translator, successor.name).getByRole('button', { name: 'Open editor', exact: true }).click();
    await waitWorkspace(translator, successor, 'Thai');
    await openStatusChooser(translator);
    await olderRow.locator('td').first().locator('small').first().click();
    await translator.waitForFunction(id => window.__managedFixtureApp.selectedManagedVersionId === id
      && window.__managedFixtureApp.managedVersionDetails?.version.id === id, version.id);
    await olderRow.locator('td').first().locator('small').first().dblclick(); await acceptEntryWarning(translator);
    await waitWorkspace(translator, version, 'Thai');
    results.push('Online single-select and translator double-click/name/primary entry, exact-language team links and double-click, manager no-language assumption, compact keyboard/pointer actions, and canceled non-HEAD/ended warnings');
    const collectionId = api.locals.versions.detail(version.id, 'fixture-manager').teams.find(team => team.language === 'Thai').latestCollection.id;
    const privilegedState = await manager.evaluate(() => {
      const vm = window.__managedFixtureApp;
      return { role: vm.cloudUser.role, language: vm.cloudUser.language, access: vm.managedOnlineAvailable };
    });
    assert.equal(privilegedState.role, 'manager'); assert.equal(privilegedState.language, null); assert.equal(privilegedState.access, true);
    for (const probe of await managedApiProbes(manager, version.id, collectionId)) assert.equal(probe.status, 200, 'Unassigned manager: ' + probe.path);
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    const admin = await adminContext.newPage(); admin.on('pageerror', error => failures.push(error.message));
    await bootstrap(admin, 'admin');
    await admin.waitForFunction(() => window.__managedFixtureApp.managedVisibleVersions.length === 2);
    const adminState = await admin.evaluate(() => {
      const vm = window.__managedFixtureApp;
      return { role: vm.cloudUser.role, language: vm.cloudUser.language, access: vm.managedOnlineAvailable };
    });
    assert.equal(adminState.role, 'admin'); assert.equal(adminState.language, null); assert.equal(adminState.access, true);
    for (const probe of await managedApiProbes(admin, version.id, collectionId)) assert.equal(probe.status, 200, 'Unassigned admin: ' + probe.path);
    const unassignedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    const unassigned = await unassignedContext.newPage(); unassigned.on('pageerror', error => failures.push(error.message));
    await bootstrap(unassigned, 'unassigned');
    await checkManagedDenied(unassigned, 'Fresh authenticated unassigned translator');
    for (const probe of await managedApiProbes(unassigned, version.id, collectionId)) {
      assert.equal(probe.status, 403, 'Unassigned translator: ' + probe.path); assert.equal(probe.code, 'LANGUAGE_UNASSIGNED');
    }
    const existingCatalog = await manager.evaluate(() => JSON.parse(JSON.stringify(window.__managedFixtureApp.managedVersions)));
    await unassigned.evaluate(async catalog => {
      const vm = window.__managedFixtureApp;
      // Recovery caches must remain stored even when their owner no longer has catalog permission.
      await OfflineStore.setVersionCatalog(vm.managedWorkspaceScope(''), catalog);
      await vm.managedScopeChanged({ deferWorkspace: true });
    }, existingCatalog);
    await checkManagedDenied(unassigned, 'Unassigned translator with retained catalog cache');
    assert.equal(await unassigned.evaluate(async () => (await OfflineStore.getVersionCatalog(window.__managedFixtureApp.managedWorkspaceScope(''))).length), 2);
    await unassigned.screenshot({ path: join(directory, 'unassigned-translator.png'), fullPage: true });
    await importOffline(unassigned);
    const unassignedLocal = await unassigned.evaluate(() => {
      const vm = window.__managedFixtureApp;
      return { hash: vm.collaborationExportHash.slice(0, 12), managed: vm.managedActiveVersion,
        catalogId: vm.managedStatusLocalVersion?.catalogVersionId, signedIn: vm.cloudSignedIn, role: vm.cloudUser.role };
    });
    assert.equal(unassignedLocal.signedIn, true); assert.equal(unassignedLocal.role, 'translator');
    assert.equal(unassignedLocal.managed, null); assert.equal(unassignedLocal.catalogId || '', '');
    await checkStatusVersion(unassigned, unassignedLocal.hash);
    results.push('Unassigned Manager/Admin retain catalog, original, collection and presence access; authenticated unassigned translators receive LANGUAGE_UNASSIGNED for all raw managed API probes and cannot adopt a matching Offline import');
    await openStatusChooser(translator);
    await translator.waitForFunction(() => window.__managedFixtureApp._managedPresenceSocket?.readyState === WebSocket.OPEN);
    const retainedBefore = await translator.evaluate(async sourceHash => {
      const vm = window.__managedFixtureApp, scope = vm.managedWorkspaceScope(sourceHash);
      window.__managedRevokedPresence = vm._managedPresenceSocket;
      const workspace = await OfflineStore.getVersionWorkspace(scope, 'Thai');
      return { catalogIds: (await OfflineStore.getVersionCatalog(scope)).map(version => version.id).sort(),
        saved: workspace.staged.Thai['fixture/fire.txt'].translations, baseline: workspace.importArchive.baselineId,
        metadataCatalogId: (await OfflineStore.getVersionMetadata(scope)).catalogVersionId };
    }, version.sourceHash);
    const removed = await admin.evaluate(async () => {
      const user = await window.__managedFixtureApp._cloud.assignLanguage('fixture-thai', null);
      return { id: user.id, language: user.language };
    });
    assert.deepEqual(removed, { id: 'fixture-thai', language: null });
    for (const probe of await managedApiProbes(translator, version.id, collectionId)) {
      assert.equal(probe.status, 403, 'Removed assignment with same session: ' + probe.path); assert.equal(probe.code, 'LANGUAGE_UNASSIGNED');
    }
    const revokedRequest = await translator.evaluate(async () => {
      const vm = window.__managedFixtureApp;
      let rejected;
      try { await vm._cloud.request('/v1/versions?game=poe2&branchId=default'); }
      catch (error) { rejected = { status: error.status, code: error.code }; }
      await vm._cloudApplyPending;
      return rejected;
    });
    assert.deepEqual(revokedRequest, { status: 403, code: 'LANGUAGE_UNASSIGNED' }, 'Real CloudSync 403 path learns revoked access');
    await translator.waitForFunction(() => {
      const vm = window.__managedFixtureApp;
      return vm.cloudSignedIn && vm.cloudUser?.language === null && !vm.managedCatalogAccess;
    });
    await translator.evaluate(() => window.__managedFixtureApp.showVersionChooser());
    await checkManagedDenied(translator, 'Known assignment removal in the existing cached profile');
    await translator.waitForFunction(() => window.__managedRevokedPresence?.readyState === WebSocket.CLOSED);
    const retainedAfter = await translator.evaluate(async sourceHash => {
      const scope = window.__managedFixtureApp.managedWorkspaceScope(sourceHash), workspace = await OfflineStore.getVersionWorkspace(scope, 'Thai');
      return { catalogIds: (await OfflineStore.getVersionCatalog(scope)).map(version => version.id).sort(),
        saved: workspace.staged.Thai['fixture/fire.txt'].translations, baseline: workspace.importArchive.baselineId,
        metadataCatalogId: (await OfflineStore.getVersionMetadata(scope)).catalogVersionId };
    }, version.sourceHash);
    assert.deepEqual(retainedAfter, retainedBefore, 'Revocation hides shared data without deleting local recovery caches, baseline or Saved work');
    await translator.route(apiOrigin + '/**', route => route.abort());
    await translator.reload(); await translator.waitForFunction(() => window.__managedFixtureApp?.offlineStoreReady);
    await installCatalogCounters(translator);
    await translator.getByRole('button', { name: 'PoE2 Path of Exile 2', exact: true }).click();
    const revokedAccess = await checkManagedDenied(translator, 'API-offline reload after known assignment removal');
    assert.equal(revokedAccess.profile, 'fixture-thai', 'Revocation retains the authenticated account profile');
    assert.equal(await translator.evaluate(async () => (await OfflineStore.getVersionCatalog(window.__managedFixtureApp.managedWorkspaceScope(''))).length), 2,
      'The same profile still holds its catalog cache, which remains inaccessible');
    await assertMetadataOnly(translator, 'Unassigned translator catalog entry after offline reload');
    await translator.screenshot({ path: join(directory, 'assignment-removed-cached.png'), fullPage: true });
    results.push('Real Admin assignment removal denies the same translator token, closes aggregate presence, hides cached catalog/team details, preserves local work, and keeps the known denial after API-offline reload');
    assert.deepEqual(failures, [], 'Browser script errors');
    console.log(JSON.stringify({ status: 'PASS', normalMode: true, browser: executablePath, results }, null, 2));
  } finally {
    await browser?.close(); await api.locals.versions.idle(); await api.locals.collaborationRealtime.close();
    await Promise.all([new Promise(resolve => apiServer.close(resolve)), new Promise(resolve => frontendServer.close(resolve))]);
    if (database.isOpen) database.close();
    const absolute = resolve(directory), expectedRoot = resolve(tmpdir()) + sep;
    if (!absolute.startsWith(expectedRoot) || !absolute.split(sep).pop().startsWith('sdeditor-managed-browser-')) throw new Error('Refusing cleanup outside fixture temporary directory.');
    if (process.env.KEEP_FIXTURE_ARTIFACTS === '1') console.log('Fixture artifacts: ' + absolute);
    else rmSync(absolute, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
