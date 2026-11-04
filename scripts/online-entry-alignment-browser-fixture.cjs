// Disposable online acceptance: real API, signed-in Translator, managed group,
// normalized IndexedDB, save worker and server round trip. No hosted services.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFileSync, existsSync, mkdirSync, mkdtempSync } = require('node:fs');
const { createServer } = require('node:http');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const codec = require('../public/statDescCodec.js');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);

async function run() {
    const apiRoot = resolve(__dirname, '../../SDEditor-API'), fromApi = createRequire(join(apiRoot, 'package.json'));
    const load = name => import(pathToFileURL(join(apiRoot, 'src', name)).href);
    const [{ loadConfig }, { openDatabase, CloudStore }, { createApp }] = await Promise.all([
        load('config.js'), load('database.js'), load('app.js'),
    ]);
    const temp = resolve(__dirname, '../temp'); mkdirSync(temp, { recursive: true });
    const directory = mkdtempSync(join(temp, 'online-entry-alignment-'));
    const express = fromApi('express'), frontend = express(), server = createServer(frontend);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const config = loadConfig({ FRONTEND_ORIGIN: origin, API_PUBLIC_URL: origin, ADMIN_GOOGLE_SUB: 'admin',
        DATABASE_PATH: ':memory:', DATA_DIR: directory });
    const database = openDatabase(':memory:'), store = new CloudStore(database, config);
    for (const id of ['admin', 'translator']) store.registerIdentity({ sub: id, email: id + '@example.test', name: id });
    store.assignLanguage('admin', 'translator', 'Thai');
    const api = createApp({ config, database, store });
    api.locals.collaborationRealtime.attach(server);
    const publicDir = resolve(__dirname, '../public');
    frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
        .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
    frontend.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
    frontend.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(publicDir, 'index.js'), 'utf8')
        .replace("app.mount('#app');", "window.__onlineAlignmentApp = app.mount('#app');")));
    frontend.use(express.static(publicDir)); frontend.use(api);
    const cases = [
        { filepath: 'stat_descriptions/014850_fishing_lure_type.txt', count: 1, overflow: 7 },
        { filepath: 'stat_descriptions/online_alignment.txt', count: 2, overflow: 4 },
    ];
    const source = cases.map(({ filepath, count, overflow }, i) => ({ filepath, name: '', stats: ['alignment_' + i],
        variables: Array(count).fill('#'), remarks: Array(count).fill(''),
        translations: { English: Array.from({ length: count }, (_, index) => index ? 'Second source' : '{0}'),
            Thai: Array.from({ length: overflow }, (_, index) => index ? 'คำแปล ' + index : '{0}') } }));
    const zip = new (fromApi('jszip'))();
    for (const desc of source) zip.file(desc.filepath, codec.descEncode(desc), { createFolders: false });
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const upload = api.locals.content.createUpload('admin', { game: 'poe1', name: 'Online alignment fixture',
        contentMode: 'statdescription', assignments: ['Thai'], idempotencyKey: randomUUID() });
    await api.locals.content.receiveAsset(upload.upload.id, 'source', 'admin', Readable.from([bytes]), 'StatDescriptions.zip');
    const published = await api.locals.content.finalize(upload.upload.id, 'admin', { idempotencyKey: randomUUID() });
    const session = store.createSession('translator');
    let browser, page;
    const errors = [], requests = [];
    try {
        browser = await chromium.launchPersistentContext(join(directory, 'profile'), { executablePath, headless: true,
            args: ['--disable-gpu'], viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
        page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.url().includes('/mutations')) requests.push({ status: response.status(), url: response.url() }); });
        const ready = () => page.waitForFunction(() => window.__onlineAlignmentApp?.offlineStoreReady
            && window.__onlineAlignmentApp.startupReady && window.__onlineAlignmentApp._cloud?.state
            && !window.__onlineAlignmentApp._cloudInitializing && !window.__onlineAlignmentApp._cloudApplying);
        await page.goto(origin + '/?cloudApi=' + encodeURIComponent(origin)); await ready();
        await page.evaluate(async ({ session, published }) => {
            const vm = window.__onlineAlignmentApp;
            await vm._cloud.acceptLogin(session); await vm.cloudApply(vm._cloud.snapshot());
            vm.lang = 'Thai'; vm.inlineEditor = true; vm.needsInitialSettings = false; vm.showSetting = false;
            await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
            await vm.activateGameVersion('poe1', { checkMigration: false });
            if (!await vm.managedOpenStatGroup(published.version, published.group, 'Thai'))
                throw new Error('Could not open online source: ' + vm.managedVersionError);
        }, { session, published });
        await page.waitForFunction(() => window.__onlineAlignmentApp._collaboration?.room()?.initialized
            && !window.__onlineAlignmentApp._managedWorkspaceTransition);
        for (const [caseIndex, item] of cases.entries()) {
            await page.evaluate(() => { window.__onlineAlignmentApp.inlineEditor = true; });
            assert.equal(await page.evaluate(filepath => window.__onlineAlignmentApp.activateInlineRow(filepath), item.filepath), true);
            assert.equal(await page.evaluate(filepath => window.__onlineAlignmentApp.openFileEntryAlignment(filepath), item.filepath), true);
            const panel = page.getByRole('region', { name: 'Align translation entries', exact: true }); await panel.waitFor();
            for (let i = item.count; i < item.overflow; i++) await panel.locator('.entryAlignmentPool .entryAlignmentCard')
                .filter({ has: page.getByRole('button', { name: 'Select block #' + (i + 1), exact: true }) })
                .getByRole('checkbox', { name: 'Unused in this version' }).check();
            for (let i = 0; i < item.count; i++) {
                await panel.getByRole('button', { name: 'Select block #' + (i + 1), exact: true }).click();
                await panel.getByRole('button', { name: 'Place selected at #' + (i + 1), exact: true }).click();
            }
            await panel.getByRole('button', { name: 'Continue editing', exact: true }).click();
            const field = page.locator('.editor .edit [data-editor-ref="translation_0"]');
            await field.waitFor(); await field.fill('{0} แก้ไขแล้ว');
            await page.evaluate(() => {
                const vm = window.__onlineAlignmentApp, save = vm._saveWorker.save.bind(vm._saveWorker);
                const gate = window.__onlineAlignmentGate = { started: false };
                vm._saveWorker.save = async batch => {
                    gate.started = true;
                    await new Promise(resolve => { gate.release = resolve; });
                    vm._saveWorker.save = save;
                    return save(batch);
                };
            });
            await page.getByRole('button', { name: 'Save & close', exact: true }).click();
            await page.waitForFunction(() => window.__onlineAlignmentGate.started);
            assert.equal(await page.evaluate(() => window.__onlineAlignmentApp.editorVisible), true,
                'Aligned Save & close must keep the reviewed text open until the transaction acknowledges');
            assert.equal(await page.evaluate(() => window.__onlineAlignmentApp.editorSaving), true);
            if (caseIndex === 1) {
                // Another tab accepts a team save after our submission was
                // captured but before the worker validates its committed base.
                await page.evaluate(async ({ filepath, count }) => {
                    const vm = window.__onlineAlignmentApp, clone = value => JSON.parse(JSON.stringify(value));
                    const peer = new CollaborationSync.Client({ store: OfflineStore, WebSocket: null,
                        request: (path, options) => vm._cloud.request(path, options), presenceEnabled: () => false });
                    try {
                        await peer.connectSparse({ accountId: vm.cloudUser.id, game: vm.gameVersion, branchId: vm.branchId,
                            language: 'Thai', groupId: vm.activeContentGroup.id, versionId: vm.activeContentGroup.versionId,
                            baselineSource: clone(vm.workspaceSource()), archive: clone(vm.importBaseline.archive),
                            workspace: clone(vm.localDescs), files: [] });
                        const saved = await peer.save({ files: [{ filepath, translations: Array.from({ length: count },
                            (_, i) => i ? 'ฉบับทีม ' + i : '{0} ฉบับทีม'), trackedForExport: true }] });
                        if (saved.status !== 'synced') throw new Error('Peer save did not reach the API.');
                    } finally { peer.destroy(); }
                }, item);
            }
            await page.evaluate(() => window.__onlineAlignmentGate.release());
            if (caseIndex === 1) {
                await page.waitForFunction(() => !window.__onlineAlignmentApp.editorSaving
                    && !window.__onlineAlignmentApp._pendingSaves.snapshot().jobs.length);
                const retained = await page.evaluate(() => ({ open: window.__onlineAlignmentApp.editorVisible,
                    alignment: !!window.__onlineAlignmentApp.entryAlignment,
                    text: window.__onlineAlignmentApp.serializeEditorTranslations()[0],
                    recovery: window.__onlineAlignmentApp._draftSession?.alignmentRecovery[0]?.translations }));
                assert.equal(retained.open, true, 'A rejected online save must keep the aligned editor open');
                assert.equal(retained.alignment, false, 'Reviewing the failed save must not repeat block alignment');
                assert.equal(retained.text, '{0} แก้ไขแล้ว'); assert.deepEqual(retained.recovery, source[caseIndex].translations.Thai);
                await page.evaluate(() => window.__onlineAlignmentApp._collaboration.sync());
                await page.getByRole('button', { name: 'Review draft', exact: true }).click();
                await page.getByRole('button', { name: 'Use translation', exact: true }).click();
                await page.waitForFunction(() => !window.__onlineAlignmentApp.editorCompareActive && !window.__onlineAlignmentApp.draftWritePending);
                assert.equal(await page.evaluate(() => !!window.__onlineAlignmentApp.entryAlignment), false);
                await page.getByRole('button', { name: 'Save & close', exact: true }).click();
            }
            await page.waitForFunction(() => !window.__onlineAlignmentApp.editorVisible
                && !window.__onlineAlignmentApp.pendingLocalSaves && !window.__onlineAlignmentApp._pendingSaves.snapshot().jobs.length);
            await page.evaluate(async () => { await window.__onlineAlignmentApp._collaboration.retry(); });
            const result = await page.evaluate(async filepath => {
                const vm = window.__onlineAlignmentApp, client = vm._collaboration;
                const workspace = await OfflineStore.getWorkspace(vm.managedWorkspaceScope());
                return { committed: vm.getDescByFilepath(filepath).translations.Thai,
                    staged: workspace.staged?.Thai?.[filepath]?.translations, shared: client.fileBase(filepath),
                    pending: client.snapshot().pending, conflicts: client.snapshot().conflicts, error: vm.localSaveError,
                    notice: vm.collaborationNotice, findings: vm.inlineDraftFindings[filepath] };
            }, item.filepath);
            assert.equal(result.committed[0], '{0} แก้ไขแล้ว', JSON.stringify(result));
            assert.deepEqual(result.staged, result.committed); assert.deepEqual(result.shared.translations, result.committed);
            assert.equal(result.pending, 0, JSON.stringify(result)); assert.deepEqual(result.conflicts, []);
            const shared = api.locals.collaboration.snapshot(published.group.teams[0].roomId, 'translator');
            assert.equal(shared.files.find(file => file.filepath === item.filepath)?.translations[0], '{0} แก้ไขแล้ว');
        }
        assert.equal(requests.filter(request => request.status === 200).length, cases.length + 1, 'One peer save and two reviewed saves reached the API');
        await page.reload(); await ready();
        await page.evaluate(async published => {
            const vm = window.__onlineAlignmentApp;
            await vm.activateGameVersion('poe1', { checkMigration: false });
            await vm.managedOpenStatGroup(published.version, published.group, 'Thai');
        }, published);
        await page.waitForFunction(() => window.__onlineAlignmentApp._collaboration?.room()?.initialized
            && !window.__onlineAlignmentApp._managedWorkspaceTransition && !window.__onlineAlignmentApp.inlineTransitionBusy
            && !window.__onlineAlignmentApp.editorLoading);
        for (const item of cases) {
            assert.notEqual(await page.evaluate(filepath => window.__onlineAlignmentApp.openInlineFullEditor(filepath), item.filepath), false);
            assert.deepEqual(await page.evaluate(() => ({ alignment: !!window.__onlineAlignmentApp.entryAlignment,
                text: window.__onlineAlignmentApp.serializeEditorTranslations()[0] })), { alignment: false, text: '{0} แก้ไขแล้ว' });
            await page.getByRole('button', { name: 'Close', exact: true }).first().click();
        }
        assert.deepEqual(errors, []); console.log('PASS: online managed alignment, unused-first placement, edited text, delayed local acknowledgment, rejected peer-raced save retained without realignment, reviewed retry, real API acceptance and full reload.');
    } catch (error) {
        if (page) console.error(await page.evaluate(() => {
            const vm = window.__onlineAlignmentApp;
            return { error: vm?.localSaveError, notice: vm?.collaborationNotice, managedError: vm?.managedVersionError,
                findings: vm?.inlineDraftFindings, cloudError: vm?.cloudStorageError, text: document.body.innerText.slice(-2000) };
        }).catch(() => null));
        throw error;
    } finally {
        await browser?.close(); await api.locals.versions.idle(); await api.locals.collaborationRealtime.close();
        await new Promise(resolve => server.close(resolve)); database.close();
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
