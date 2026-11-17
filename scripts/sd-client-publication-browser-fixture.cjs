// Real browser/IndexedDB/API acceptance for client-prepared SD publication.
// Originals and accounts are synthetic; no hosted service or existing browser is used.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const codec = require('../public/statDescCodec.js');

const runtime = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtime] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!executablePath) throw new Error('Set FIXTURE_BROWSER_PATH to an installed desktop browser.');

async function run() {
    const apiRoot = resolve(__dirname, '../../SDEditor-API'), fromApi = createRequire(join(apiRoot, 'package.json'));
    const load = name => import(pathToFileURL(join(apiRoot, 'src', name)).href);
    const [{ loadConfig }, { openDatabase, CloudStore }, { createApp }, { parseArchive }] = await Promise.all([
        load('config.js'), load('database.js'), load('app.js'), load('version-codec.js'),
    ]);
    const express = fromApi('express'), JSZip = fromApi('jszip');
    const parent = resolve(__dirname, '../temp'), directory = mkdtempSync(join(parent, 'sd-client-browser-'));
    const frontend = express(), frontendServer = createServer(frontend);
    await new Promise(resolve => frontendServer.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + frontendServer.address().port;
    const config = loadConfig({ ADMIN_GOOGLE_SUB: 'fixture-admin', FRONTEND_ORIGIN: origin, API_PUBLIC_URL: 'http://127.0.0.1:1', DATA_DIR: directory });
    const db = openDatabase(':memory:'), store = new CloudStore(db, config);
    store.registerIdentity({ sub: 'fixture-admin', email: 'admin@fixture.example', name: 'Fixture administrator' });
    store.registerIdentity({ sub: 'fixture-thai', email: 'thai@fixture.example', name: 'Fixture Thai' });
    store.assignLanguage('fixture-admin', 'fixture-thai', 'Thai');
    const diagnostics = [], api = createApp({ config, store, oauthProvider: null, logger: { error: (...args) => diagnostics.push(args), warn() {} } });
    const content = api.locals.content, collaboration = api.locals.collaboration;
    const apiServer = createServer(api); api.locals.collaborationRealtime.attach(apiServer);
    await new Promise(resolve => apiServer.listen(0, '127.0.0.1', resolve));
    const apiOrigin = 'http://127.0.0.1:' + apiServer.address().port, secret = randomUUID();
    frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    frontend.post('/fixture/session', (req, res) => {
        if (req.get('X-Fixture-Key') !== secret) return res.sendStatus(403);
        res.json(store.createSession('fixture-admin'));
    });
    const vendor = {
        'https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js': ['vue.js', process.env.FIXTURE_VUE_PATH || join(parent, 'clienttext-fixture-vue.min.js')],
        'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js': ['jszip.js', fromApi.resolve('jszip/dist/jszip.min.js')],
        'https://cdnjs.cloudflare.com/ajax/libs/jsdiff/8.0.1/diff.min.js': ['diff.js', process.env.FIXTURE_DIFF_PATH || join(parent, 'sd-fixture-diff.min.js')],
    };
    frontend.get('/', (req, res) => {
        let html = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
        for (const [url, [name, file]] of Object.entries(vendor)) if (existsSync(file)) html = html.replace(url, '/fixture/' + name);
        res.type('html').send(html);
    });
    for (const [, [name, file]] of Object.entries(vendor)) if (existsSync(file)) frontend.get('/fixture/' + name, (req, res) => res.type('js').send(readFileSync(file)));
    frontend.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(__dirname, '../public/index.js'), 'utf8').replace("app.mount('#app');", "window.__sdFixtureApp = app.mount('#app');")));
    frontend.use(express.static(join(__dirname, '../public')));

    const path = name => 'specific_skill_stat_descriptions/fixture/' + name + '.txt';
    const file = (name, english, target) => ({ filepath: path(name), name, stats: [name + '_stat'], variables: ['#'], remarks: [''],
        translations: { English: [english], ...(target === undefined ? {} : { Thai: [target] }), German: ['German ' + name] } });
    const first = [file('carry', 'Fire damage', 'Original carry'), file('recover', 'Old cold damage', 'Original recovery'), file('recall', 'Original lightning damage', 'Historical untouched target')];
    const previous = [file('carry', 'Fire damage', 'Upstream carry'), file('recover', 'Changed cold damage', 'Upstream recovery'), file('recall', 'Original lightning damage', 'Historical untouched target')];
    const incoming = [file('carry', 'Fire damage', 'Current upstream carry'), file('recover', 'Changed cold damage', undefined), file('recall', 'New lightning damage', undefined)];
    const zipBytes = async files => {
        const zip = new JSZip();
        for (const row of files) zip.file(row.filepath, codec.descEncode(row), { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
        return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    };
    const publishLegacy = async (name, files) => {
        const bytes = await zipBytes(files), parsed = await parseArchive(bytes, { expectedGame: 'poe2' });
        const { upload } = content.createUpload('fixture-admin', { game: 'poe2', contentMode: 'statdescription', name, assignments: ['Thai'], idempotencyKey: randomUUID() });
        await content.receiveAsset(upload.id, 'source', 'fixture-admin', Readable.from([bytes]), 'StatDescriptions.zip');
        const result = await content.finalize(upload.id, 'fixture-admin', { idempotencyKey: randomUUID() });
        return { ...result, parsed };
    };
    const save = (group, baseline, target) => {
        const room = group.teams.find(team => team.language === 'Thai').roomId;
        collaboration.mutate('fixture-admin', room, { mutationId: randomUUID(), origin: 'save', files: [{ filepath: baseline.filepath, translations: [target], baseRevision: collaboration.file(room, baseline.filepath)?.revision || 0, baseline }] });
    };
    let browser;
    try {
        const initial = await publishLegacy('Fixture initial', first);
        save(initial.group, initial.parsed.files.find(row => row.filepath === path('carry')), 'Accepted authored carry');
        save(initial.group, initial.parsed.files.find(row => row.filepath === path('recover')), 'Frozen authored recovery');
        await content.collect(initial.group.id, 'Thai', 'fixture-admin', { idempotencyKey: randomUUID(), endWindow: true });
        const old = await publishLegacy('Fixture previous', previous);
        const oldRoom = old.group.teams[0].roomId;
        const oldSaved = collaboration.file(oldRoom, path('carry'));
        const historyBefore = db.prepare('SELECT COUNT(*) n FROM collaboration_history').get().n;
        const recoveryBefore = db.prepare("SELECT id,snapshot,status FROM collaboration_dropped_candidates WHERE content_group_id=? AND status='dropped'").all(old.group.id);
        assert.equal(recoveryBefore.length, 1);
        await content.collect(old.group.id, 'Thai', 'fixture-admin', { idempotencyKey: randomUUID(), endWindow: true });
        const bytes = await zipBytes(incoming);
        let forbiddenServerParses = 0;
        api.locals.versions.parser = async () => { forbiddenServerParses++; throw new Error('New publication must not parse an SD ZIP on the API.'); };
        content.prepareSDCarry = async () => { forbiddenServerParses++; throw new Error('New publication must compute source carry in the browser.'); };
        browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/?cloudApi=' + encodeURIComponent(apiOrigin), { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__sdFixtureApp?.offlineStoreReady && window.__sdFixtureApp?._cloud?.state, { timeout: 30000 });
        await page.evaluate(async ({ secret }) => {
            const vm = window.__sdFixtureApp, response = await fetch('/fixture/session', { method: 'POST', headers: { 'X-Fixture-Key': secret } });
            await vm._cloud.acceptLogin(await response.json()); await vm.cloudApply(vm._cloud.snapshot());
            vm.lang = 'Thai'; vm.needsInitialSettings = false; vm.showSetting = false; vm.inlineEditor = false;
            await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
            await vm.activateGameVersion('poe2', { checkMigration: false });
        }, { secret });
        await page.waitForFunction(() => window.__sdFixtureApp.gameVersion === 'poe2' && window.__sdFixtureApp.managedHeadVersion && !window.__sdFixtureApp.managedVersionBusy && !window.__sdFixtureApp.ctBusy);
        await page.evaluate(async () => {
            const vm = window.__sdFixtureApp;
            if (!await vm.ctOpenUpload()) throw new Error('Upload dialog did not open: ' + (vm.managedNextVersionBlockedReason || vm.managedError || vm.ctError || 'busy'));
            vm.ctUploadName = 'Fixture client prepared'; vm.ctUploadAssignments = ['Thai'];
        });
        await page.evaluate(async ({ bytes }) => {
            const vm = window.__sdFixtureApp;
            vm.ctUploadFiles = [{ file: new File([new Uint8Array(bytes)], 'StatDescriptions.zip', { type: 'application/zip' }) }];
            await vm.ctPrepareUpload();
            if (vm.ctUploadError) throw new Error(vm.ctUploadError + ' ' + JSON.stringify({ game: vm.gameVersion, head: vm.managedHeadVersion?.id, predecessor: vm.ctUploadPredecessor, versions: vm.managedVersions?.map(row => [row.id, row.game, row.isHead]), error: vm.ctError }));
            await vm.ctPublishPrepared();
            if (vm.ctUploadError || vm.ctError) throw new Error(vm.ctUploadError || vm.ctError);
        }, { bytes: [...bytes] });
        const groupRow = db.prepare("SELECT g.* FROM content_groups g JOIN content_versions v ON v.id=g.version_id WHERE v.name='Fixture client prepared'").get();
        assert.ok(groupRow, 'The browser published the prepared group');
        assert.equal(groupRow.storage_protocol, 'sd-client-publication-v1');
        const published = content.publicGroup(groupRow, 'fixture-admin'), newRoom = published.teams[0].roomId;
        assert.deepEqual(collaboration.file(newRoom, path('carry')).translations, ['Accepted authored carry']);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM collaboration_dropped_candidates WHERE content_group_id=? AND filepath=? AND status='dropped'").get(published.id, path('recall')).n, 0, 'Untouched old ZIP text stays recallable without automatic Dropped creation');
        assert.equal(db.prepare("SELECT COUNT(*) n FROM collaboration_dropped_candidates WHERE content_group_id=? AND filepath=? AND status='dropped'").get(published.id, path('recover')).n, 1, 'Existing recovery survives source advancement');
        assert.deepEqual(collaboration.file(oldRoom, path('carry')), oldSaved, 'Existing Saved work remains unchanged');
        assert.deepEqual(db.prepare("SELECT id,snapshot,status FROM collaboration_dropped_candidates WHERE content_group_id=? AND status='dropped'").all(old.group.id), recoveryBefore);
        assert.ok(db.prepare('SELECT COUNT(*) n FROM collaboration_history').get().n >= historyBefore);
        assert.equal(forbiddenServerParses, 0);
        assert.equal(api.locals.versions.branch('poe2').head_version_id, old.version.id, 'Publishing a manual candidate leaves the outgoing HEAD in place');
        const metadataDraft = content.createVersion('fixture-admin', { game: 'poe2', name: 'Fixture metadata only', promotion: 'manual', expectedHeadId: old.version.id, idempotencyKey: randomUUID() }).version;
        await page.evaluate(async () => { await window.__sdFixtureApp.showVersionChooser(); });
        const candidateRow = page.locator('[data-version-id="' + published.version.id + '"]');
        await candidateRow.getByText('Awaiting promotion', { exact: true }).waitFor();
        await page.locator('[data-version-id="' + metadataDraft.id + '"]').getByText('Draft', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-version-id="' + metadataDraft.id + '"]').getByRole('button', { name: 'Promote', exact: true }).count(), 0);
        for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
            await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
            await page.setViewportSize({ width: 1160, height: 1000 });
            await page.screenshot({ path: join(directory, 'promotion-' + theme + '.png') });
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await candidateRow.getByRole('button', { name: 'Promote', exact: true }).click();
        await page.locator('.appDialogCancel').click();
        assert.equal(api.locals.versions.branch('poe2').head_version_id, old.version.id, 'Cancelling promotion changes no release state');
        const promotionRequests = [];
        await page.route('**/v1/versions/' + published.version.id + '/promote', async route => {
            promotionRequests.push(route.request().postDataJSON());
            if (promotionRequests.length === 1) { const accepted = await route.fetch(); assert.equal(accepted.status(), 200); await route.abort('failed'); }
            else await route.continue();
        });
        await candidateRow.getByRole('button', { name: 'Promote', exact: true }).focus();
        await page.keyboard.press('Enter');
        await page.locator('.appDialogConfirm').click();
        await page.getByRole('button', { name: 'Resume promotion', exact: true }).waitFor();
        assert.equal(api.locals.versions.branch('poe2').head_version_id, published.version.id, 'A lost acknowledgement does not undo committed HEAD');
        await page.getByRole('button', { name: 'Resume promotion', exact: true }).click();
        await page.waitForFunction(id => window.__sdFixtureApp.managedBranch?.headVersionId === id && !window.__sdFixtureApp.managedVersionBusy, published.version.id);
        assert.equal(promotionRequests.length, 2); assert.deepEqual(promotionRequests[1], promotionRequests[0], 'Lost promotion responses retry the exact durable command');
        await candidateRow.getByText('HEAD', { exact: true }).waitFor();
        assert.equal(await candidateRow.getByText('Awaiting promotion', { exact: true }).count(), 0);
        assert.deepEqual(collaboration.file(oldRoom, path('carry')), oldSaved, 'Promotion preserves predecessor Saved work and history');
        assert.equal((await page.evaluate(() => window.__sdFixtureApp._ctStore.listRequests(window.__sdFixtureApp.ctRequestScope()))).filter(row => row.payload.kind === 'promotion').length, 0);
        published.version = content.publicVersion(content.version(published.version.id, 'fixture-admin'));
        await page.evaluate(async ({ version, group }) => { const vm = window.__sdFixtureApp; await vm.ctOpenGroup(version, group, 'Thai'); }, { version: published.version, group: published });
        await page.waitForFunction(() => window.__sdFixtureApp.sourceLoaded && !window.__sdFixtureApp.managedVersionBusy);
        await page.evaluate(async filepath => {
            const vm = window.__sdFixtureApp;
            await vm.editFile(filepath, true);
            vm.editorBlocks[0].translation = 'Separate unfinished normal draft';
            await vm.flushEditorDraft({ force: true });
        }, path('recall'));
        const savedCount = () => db.prepare('SELECT COUNT(*) n FROM collaboration_files WHERE room_id=? AND tracked_for_export=1').get(newRoom).n;
        const beforeRecall = { saved: savedCount(), history: db.prepare('SELECT COUNT(*) n FROM collaboration_history').get().n };
        await page.getByRole('button', { name: 'Recall translation…', exact: true }).filter({ visible: true }).click();
        const dialog = page.locator('dialog.sdRecallDialog');
        await dialog.waitFor({ state: 'visible' });
        await page.waitForFunction(() => !window.__sdFixtureApp.sdRecallLoading);
        const recalled = await page.evaluate(() => {
            const vm = window.__sdFixtureApp;
            if (vm.sdRecallError) throw new Error(vm.sdRecallError);
            return { values: vm.sdRecallReview?.values, old: vm.sdRecallReview?.oldEnglish, current: vm.sdRecallReview?.currentEnglish,
                normal: vm.editorBlocks[0].translation, kind: vm.sdRecallReview?.kind };
        });
        assert.deepEqual(recalled.values, ['Historical untouched target']);
        assert.deepEqual(recalled.old, ['Original lightning damage']);
        assert.deepEqual(recalled.current, ['New lightning damage']);
        assert.equal(recalled.normal, 'Separate unfinished normal draft');
        assert.match(recalled.kind, /Original ZIP/);
        assert.equal(savedCount(), beforeRecall.saved, 'Viewing a historical source creates no Saved work');
        assert.equal(db.prepare('SELECT COUNT(*) n FROM collaboration_history').get().n, beforeRecall.history);
        assert.equal(await dialog.getByRole('button', { name: 'Save reviewed translation', exact: true }).isDisabled(), true);
        assert.match(await dialog.locator('.englishDiff').first().innerHTML(), /diffInline(?:Add|Del)/, 'The source viewer renders differences');
        await dialog.getByLabel('Show whitespace', { exact: true }).check();
        await dialog.getByLabel('Character differences', { exact: true }).check();
        for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
            await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
            await page.setViewportSize({ width: 1160, height: 850 });
            const box = await dialog.boundingBox();
            assert.ok(box && box.x >= 0 && box.x + box.width <= 1161 && box.y >= 0, theme + ': recall stays inside the resized desktop');
            await page.screenshot({ path: join(directory, 'recall-' + theme + '.png') });
        }
        await dialog.locator('#sdRecallTarget-0').fill('   ');
        assert.equal(await dialog.getByRole('button', { name: 'Save reviewed translation', exact: true }).isDisabled(), true, 'Incomplete recalled text cannot Save');
        await dialog.locator('#sdRecallTarget-0').fill('Historical untouched target');
        await dialog.getByRole('button', { name: 'Keep unchanged', exact: true }).click();
        assert.equal(await dialog.getByRole('button', { name: 'Save reviewed translation', exact: true }).isEnabled(), true);
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__sdFixtureApp.editorBlocks[0].translation), 'Separate unfinished normal draft');
        await page.getByRole('button', { name: 'Recall translation…', exact: true }).filter({ visible: true }).click();
        await page.waitForFunction(() => !window.__sdFixtureApp.sdRecallLoading && !!window.__sdFixtureApp.sdRecallReview);
        await dialog.getByRole('button', { name: 'Save reviewed translation', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        for (let attempt = 0; attempt < 100 && !collaboration.file(newRoom, path('recall'))?.trackedForExport; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
        assert.deepEqual(collaboration.file(newRoom, path('recall'))?.translations, ['Historical untouched target'], 'Explicit reviewed Save uses normal durable and shared persistence');
        assert.equal(await page.evaluate(() => window.__sdFixtureApp.editorBlocks[0].translation), 'Separate unfinished normal draft', 'A separately authored normal draft survives the recalled Save');
        await page.evaluate(async filepath => {
            const vm = window.__sdFixtureApp;
            await vm.editorExit();
            vm.inlineEditor = true;
            await vm.activateInlineRow(filepath);
        }, path('carry'));
        const inlineRecall = page.getByRole('button', { name: 'Recall translation…', exact: true }).filter({ visible: true });
        await inlineRecall.click();
        await dialog.waitFor({ state: 'visible' });
        await page.waitForFunction(() => !window.__sdFixtureApp.sdRecallLoading);
        assert.equal(await dialog.locator('#sdRecallTarget-0').inputValue(), 'Accepted authored carry', 'Historical Saved work takes precedence over ZIP target');
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        assert.deepEqual(errors, [], 'No unhandled browser errors');
        writeFileSync(join(directory, 'result.json'), JSON.stringify({ published: published.id, serverParses: forbiddenServerParses, errors, diagnostics }, null, 2));
        console.log('Client SD publication, preserved Saved/recovery/history, full/inline recall, diff, themes and reviewed Save checks passed.');
    } finally {
        if (browser) await browser.close();
        await api.locals.versions.idle(); await api.locals.collaborationRealtime.close();
        await Promise.all([new Promise(resolve => apiServer.close(resolve)), new Promise(resolve => frontendServer.close(resolve))]);
        if (db.isOpen) db.close();
        const target = resolve(directory);
        if (!target.startsWith(parent + require('node:path').sep) || !require('node:path').basename(target).startsWith('sd-client-browser-')) throw new Error('Refusing cleanup outside the disposable fixture.');
        if (process.env.KEEP_FIXTURE_ARTIFACTS === '1') console.log('Fixture artifacts: ' + target);
        else rmSync(target, { recursive: true, force: true });
    }
}
run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
