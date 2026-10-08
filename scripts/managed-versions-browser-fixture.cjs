// Disposable normal-mode acceptance check: real API, IndexedDB, workers and WebSockets.
// Run with PLAYWRIGHT_MODULE_PATH when Playwright is outside this checkout.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, readFileSync, existsSync, rmSync } = require('node:fs');
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
  for (const account of ['admin', 'manager', 'thai']) store.registerIdentity({ sub: 'fixture-' + account,
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
    if (req.get('X-Fixture-Key') !== secret || !['manager', 'thai'].includes(req.params.account)) return res.sendStatus(403);
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
    const bootstrap = async (page, account) => {
      await ready(page);
      await page.evaluate(async ({ account, secret }) => {
        const vm = window.__managedFixtureApp;
        const response = await fetch('/fixture/session/' + account, { method: 'POST', headers: { 'X-Fixture-Key': secret } });
        if (!response.ok) throw new Error('Fixture session refused');
        await vm._cloud.acceptLogin(await response.json()); await vm.cloudApply(vm._cloud.snapshot());
        vm.lang = 'Thai'; vm.needsInitialSettings = false; vm.showSetting = false; vm.inlineEditor = false;
        await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
        await vm.activateGameVersion('poe2', { checkMigration: false });
      }, { account, secret });
      await page.getByRole('region', { name: 'Source versions' }).waitFor();
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
    const thaiRow = manager.locator('.teamVersionTable tbody tr').filter({ has: manager.locator('td strong').filter({ hasText: /^Thai$/ }) });
    await manager.waitForFunction(() => window.__managedFixtureApp.managedVersionDetails?.teams.find(team => team.language === 'Thai')?.counts.saved === 1);
    assert.equal(await manager.evaluate(() => window.__managedFixtureApp.managedVersionDetails.teams.find(team => team.language === 'Thai').roomId), standaloneRoomId);
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await manager.evaluate(theme => { const vm = window.__managedFixtureApp; vm.theme = theme; vm.applyTheme(theme); }, theme);
      await manager.keyboard.press('Tab');
      assert.equal(await manager.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await manager.locator('.versionProgressTrack').count(), 12);
      assert.equal(await manager.locator('.teamVersionTable thead th').count(), 5);
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
    await translator.evaluate(() => window.__managedFixtureApp.showVersionChooser());
    assert.equal(await translator.locator('.teamVersionTable tbody tr').count(), 1);
    assert.equal(await translator.getByRole('button', { name: 'Upload next version', exact: true }).count(), 0);
    await translator.getByRole('button', { name: 'Open editor', exact: true }).click();
    await translator.waitForFunction(() => {
      const vm = window.__managedFixtureApp;
      return vm.sourceLoaded && vm.sourceIdentity && !vm.managedVersionBusy && !vm.versionStorageLoading && !vm.versionChooserVisible;
    });
    await translator.evaluate(async filepath => { const vm = window.__managedFixtureApp; vm.inlineEditor = false; await vm.editFile(filepath); }, source.filepath);
    const field = translator.locator('input[placeholder="Translation"]').filter({ visible: true }).first();
    await field.fill('ความเสียหายไฟที่แก้ไข');
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await translator.evaluate(theme => { const vm = window.__managedFixtureApp; vm.theme = theme; vm.applyTheme(theme); }, theme);
      await translator.keyboard.press('Tab');
      assert.equal(await translator.locator('html').getAttribute('data-theme'), theme);
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
    assert.equal(await thaiRow.locator('.versionBadge').textContent(), 'Open');
    results.push('Download only retains a Saved-only ZIP snapshot without changing the window or latest ending collection');
    const download = manager.waitForEvent('download');
    await thaiRow.getByRole('button', { name: 'Download and mark ended', exact: true }).click();
    await manager.locator('.appDialogConfirm').click();
    await checkTranslatedDownload(await download);
    await manager.waitForFunction(() => window.__managedFixtureApp.managedVersionDetails.teams.find(team => team.language === 'Thai').ended);
    await translator.evaluate(async () => { await window.__managedFixtureApp.managedRefreshActive(); });
    await translator.locator('.managedVersionBanner').filter({ hasText: 'Ended' }).waitFor();
    const opening = translator.evaluate(filepath => window.__managedFixtureApp.editFile(filepath), source.filepath);
    await translator.locator('.appDialogConfirm').filter({ hasText: 'Continue editing' }).click(); await opening;
    await translator.evaluate(async () => { await window.__managedFixtureApp.editorExit(); });
    results.push('Immutable named collection download/end, live ended banner, editable warning flow');
    await translator.route(apiOrigin + '/**', route => route.abort());
    await translator.reload();
    await translator.waitForFunction(() => window.__managedFixtureApp?.offlineStoreReady);
    await translator.getByRole('button', { name: 'PoE2 Path of Exile 2', exact: true }).click();
    await translator.waitForFunction(() => window.__managedFixtureApp?.offlineStoreReady && window.__managedFixtureApp?.sourceLoaded).catch(async error => {
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
    await translator.locator('.versionSelect').filter({ hasText: version.name }).click();
    await translator.waitForFunction(versionId => {
      const vm = window.__managedFixtureApp, team = vm.managedVersionDetails?.teams.find(team => team.language === 'Thai');
      return vm.managedSelectedVersion?.id === versionId && vm.managedVersionDetails?.version?.id === versionId
        && team?.ended && team.counts.saved === 1;
    }, version.id);
    assert.equal(await translator.locator('.versionDetails h2').textContent(), version.name + ' HEAD');
    await translator.getByRole('button', { name: 'Open editor', exact: true }).click();
    await translator.waitForFunction(sourceHash => {
      const vm = window.__managedFixtureApp;
      return !vm.managedVersionBusy && !vm.versionChooserVisible && vm.sourceLoaded && vm.sourceIdentity === sourceHash;
    }, version.sourceHash);
    await translator.locator('.managedVersionBanner').filter({ hasText: 'Ended' }).waitFor();
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
    await offline.evaluate(() => window.__managedFixtureApp.showVersionChooser());
    await offline.locator('#offlineVersionName').fill('Local reference export');
    await offline.locator('#offlineVersionName').press('Enter');
    await offline.waitForFunction(() => window.__managedFixtureApp.managedOfflineVersion?.name === 'Local reference export');
    await offline.getByRole('button', { name: 'Continue offline workspace', exact: true }).click();
    await offline.waitForFunction(() => window.__managedFixtureApp.sourceLoaded && !window.__managedFixtureApp.versionChooserVisible);
    assert.equal(await offline.evaluate(() => window.__managedFixtureApp.managedOfflineVersion?.name), 'Local reference export');
    assert.equal(await offline.evaluate(() => window.__managedFixtureApp.cloudSignedIn), false);
    await offline.reload();
    await offline.waitForFunction(() => window.__managedFixtureApp?.offlineStoreReady);
    await offline.getByRole('button', { name: 'PoE2 Path of Exile 2', exact: true }).click();
    await offline.locator('#offlineVersionName').waitFor();
    assert.equal(await offline.locator('#offlineVersionName').inputValue(), 'Local reference export');
    results.push('Unsigned Offline card keeps original import warnings, editable local name, keyboard naming and Continue workflow');
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
