'use strict';
// Real shared app, API/auth, ClientText cache worker and disposable IndexedDB.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join, sep, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const Codec = require('../public/clientTextCodec.js');
const State = require('../public/clientTextState.js');
const StatCodec = require('../public/statDescCodec.js');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!executablePath) throw new Error('Set FIXTURE_BROWSER_PATH to an installed Edge/Chrome browser.');
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const raw = 'Literal \\n plus actual\r\nline@column <img>';
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
const cell = (address, value) => `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
async function workbook(JSZip, role) {
    const rows = role === 'normal' ? [cell('A1', 'ID') + cell('B1', 'Notes') + cell('C1', 'Name') + cell('D1', 'Translation'),
        ...Array.from({ length: 23 }, (_, i) => cell('A' + (i + 2), 'same-' + i) + cell('B' + (i + 2), 'Developer blade note')
            + cell('C' + (i + 2), 'Blade ' + i) + cell('D' + (i + 2), i ? 'Original blade ' + i : raw))]
        : [cell('A1', 'ID') + cell('C1', 'Text') + cell('D1', 'MS') + cell('E1', 'FS'),
            cell('A2', 'same-0') + cell('C2', 'Blade form') + cell('D2', 'Original form') + cell('E2', 'Original feminine')];
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>');
    zip.file('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${role === 'normal' ? 'Normal' : 'Words_Gender'}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${NS}"><sheetData>${rows.map((cells, i) => `<row r="${i + 1}">${cells}</row>`).join('')}</sheetData></worksheet>`);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
async function run() {
    const apiRoot = resolve(process.env.SDEDITOR_FIXTURE_API_ROOT || join(__dirname, '../../SDEditor-API'));
    const fromApi = createRequire(join(apiRoot, 'package.json'));
    const load = name => import(pathToFileURL(join(apiRoot, 'src', name)).href);
    const [{ loadConfig }, { openDatabase, CloudStore }, { createApp }] = await Promise.all([load('config.js'), load('database.js'), load('app.js')]);
    const express = fromApi('express'), JSZip = fromApi('jszip');
    const directory = mkdtempSync(join(tmpdir(), 'sdeditor-lookup-')), secret = randomUUID();
    const frontend = express(), frontendServer = createServer(frontend);
    await new Promise(done => frontendServer.listen(0, '127.0.0.1', done));
    const origin = 'http://127.0.0.1:' + frontendServer.address().port;
    const config = loadConfig({ ADMIN_GOOGLE_SUB: 'fixture-admin', FRONTEND_ORIGIN: origin, DATA_DIR: directory, DATABASE_PATH: ':memory:' });
    const database = openDatabase(':memory:'), store = new CloudStore(database, config);
    store.registerIdentity({ sub: 'fixture-admin', email: 'lookup@fixture.example', name: 'Lookup Fixture Admin' });
    const api = createApp({ config, database, store, oauthProvider: null }), apiServer = createServer(api);
    api.locals.collaborationRealtime.attach(apiServer);
    await new Promise(done => apiServer.listen(0, '127.0.0.1', done));
    const apiOrigin = 'http://127.0.0.1:' + apiServer.address().port;
    frontend.post('/fixture/session', (req, res) => req.get('X-Fixture-Key') === secret ? res.json(store.createSession('fixture-admin')) : res.sendStatus(403));
    frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(__dirname, '../public/index.html'), 'utf8').replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
    frontend.get('/fixture/jszip.min.js', (_req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
    frontend.get('/clientTextWorker.js', (_req, res) => res.type('js').send(readFileSync(join(__dirname, '../public/clientTextWorker.js'), 'utf8').replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
    frontend.get('/index.js', (_req, res) => res.type('js').send(readFileSync(join(__dirname, '../public/index.js'), 'utf8').replace("app.mount('#app');", "window.__lookupFixtureApp = app.mount('#app');")));
    frontend.use(express.static(join(__dirname, '../public')));
    let browser;
    try {
        let version = api.locals.content.createVersion('fixture-admin', { game: 'poe2', branchId: 'default', name: 'Lookup release', idempotencyKey: randomUUID() }).version;
        const groups = [];
        const upload = async (contentMode, key) => {
            const created = api.locals.content.createUpload('fixture-admin', { versionId: version.id, expectedMembershipRevision: version.membershipRevision,
                game: 'poe2', contentMode, name: version.name, groupName: key, logicalKey: key, assignments: ['French'],
                ...(contentMode === 'clienttext' ? { language: 'French', storageProtocol: State.STORAGE_PROTOCOL } : {}), idempotencyKey: randomUUID() });
            let input = {};
            if (contentMode === 'clienttext') {
                const units = [], assets = [];
                for (const role of ['normal', 'gender']) {
                    const bytes = await workbook(JSZip, role), filename = role === 'normal' ? 'French.xlsm' : 'French_Gender.xlsm';
                    const parsed = await Codec.parseWorkbook(bytes, { filename, role });
                    units.push(...parsed.units); assets.push({ role, hash: parsed.artifactHash, parserVersion: parsed.parserVersion });
                    await api.locals.content.receiveAsset(created.upload.id, role, 'fixture-admin', Readable.from([bytes]), filename);
                }
                input = await State.buildDescriptors(units, assets);
            } else {
                const desc = { filepath: 'specific_skill_stat_descriptions/explosive_grenade/fire.txt', stats: ['blade_damage'],
                    variables: ['#'], remarks: [''], translations: { English: ['Blade damage@Other column'], French: [''] } };
                const zip = new JSZip(); zip.file(desc.filepath, StatCodec.descEncode(desc), { createFolders: false });
                await api.locals.content.receiveAsset(created.upload.id, 'source', 'fixture-admin', Readable.from([await zip.generateAsync({ type: 'nodebuffer' })]), 'StatDescriptions.zip');
            }
            const accepted = await api.locals.content.finalize(created.upload.id, 'fixture-admin', { ...input, expectedMembershipRevision: version.membershipRevision, idempotencyKey: randomUUID() });
            version = accepted.version; groups.push(accepted.group); return accepted.group;
        };
        const sdGroup = await upload('statdescription', 'SD'), first = await upload('clienttext', 'First CT'), second = await upload('clienttext', 'Second CT');
        browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
        const page = await context.newPage(), failures = [], requests = [];
        page.on('pageerror', error => failures.push(error.message)); page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
        await page.goto(origin + '/?cloudApi=' + encodeURIComponent(apiOrigin));
        await page.waitForFunction(() => window.__lookupFixtureApp?.offlineStoreReady && window.__lookupFixtureApp?._cloud?.state);
        await page.evaluate(async ({ secret, version, group }) => {
            const vm = window.__lookupFixtureApp;
            const response = await fetch('/fixture/session', { method: 'POST', headers: { 'X-Fixture-Key': secret } });
            await vm._cloud.acceptLogin(await response.json()); await vm.cloudApply(vm._cloud.snapshot());
            vm.lang = 'French'; vm.needsInitialSettings = false; vm.showSetting = false; vm.inlineEditor = false;
            await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
            await vm.activateGameVersion('poe2', { checkMigration: false }); await vm.managedReadDetails(version.id, false);
            await vm.managedOpenStatGroup(version, group, 'French');
        }, { secret, version, group: sdGroup });
        await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
        await page.getByRole('button', { name: 'Lookup', exact: true }).click();
        const panel = page.locator('#editorLookupPanel'); await panel.waitFor();
        await page.waitForFunction(() => window.__lookupFixtureApp.lookupMissingReferenceCount === 2);
        const identity = () => page.evaluate(() => { const vm = window.__lookupFixtureApp; return {
            active: OfflineStore.captureWorkspaceScope(), group: vm.activeContentGroup.id, source: vm.sourceIdentity,
            collaboration: vm._collaboration?.snapshot({ includeFiles: false }).identity, collabKey: vm._collabKey,
            ctWorkspace: vm.ctWorkspace?.scope || null, ctSelection: vm.ctSelection, ctActive: vm.ctActive, ctProgress: vm.ctProgress, ctBusy: vm.ctBusy }; });
        const before = await identity(), requestStart = requests.length;
        let held, release;
        const entered = new Promise(done => { held = done; }), pending = new Promise(done => { release = done; });
        await page.route(apiOrigin + '/v1/content-groups/' + first.id + '/assets/normal/original', async route => { held(); await pending; await route.continue().catch(() => {}); });
        await panel.getByRole('button', { name: /Prepare missing references/ }).click(); await entered;
        await panel.getByRole('button', { name: 'Cancel', exact: true }).click(); release();
        await page.waitForFunction(() => !window.__lookupFixtureApp.lookupPreparing);
        assert.deepEqual(await identity(), before, 'Cancelled preparation preserves the active source, group, selection, progress and collaboration');
        await page.unroute(apiOrigin + '/v1/content-groups/' + first.id + '/assets/normal/original');
        await panel.getByRole('button', { name: /Prepare missing references/ }).click();
        await page.waitForFunction(() => !window.__lookupFixtureApp.lookupPreparing && window.__lookupFixtureApp.lookupMissingReferenceCount === 0);
        assert.equal(await page.evaluate(() => window.__lookupFixtureApp.lookupPreparationError), '');
        assert.deepEqual(await identity(), before, 'Completed preparation preserves the active editor and collaboration');
        assert.equal(requests.slice(requestStart).filter(request => /\/collaboration\/rooms/.test(request.url) && request.method === 'POST').length, 0, 'Reference preparation never joins a room');
        await page.evaluate(async ({ groupId }) => {
            const vm = window.__lookupFixtureApp, scope = { ...vm.editorLookupSession().scope, groupId, language: 'French' };
            const unit = (await vm._ctStore.getUnits(scope)).find(unit => unit.role === 'normal' && unit.recordId === 'same-0');
            const values = ClientTextState.valuesFor(unit); values[unit.fields[0].id] = '';
            await vm._ctStore.save(scope, unit.id, { jobId: 'lookup-blank-saved', values, reviewed: {}, baseRevision: 0, expectedRevision: 0 });
            await vm._ctStore.putDraft(scope, unit.id, { values: { ...values, [unit.fields[0].id]: 'Secret reference draft' }, reviewed: {} });
            await vm.lookupLoadCatalog();
        }, { groupId: first.id });
        await context.setOffline(true);
        const search = panel.locator('#editorLookupSearch'); await search.fill('Blade');
        await page.waitForFunction(() => window.__lookupFixtureApp.lookupAppliedQuery === 'Blade');
        assert.ok(await page.evaluate(() => window.__lookupFixtureApp.lookupResultCount) > 40, 'Cached cross-mode references remain available offline');
        assert.equal(await panel.locator('.lookupResult').count(), 20); await panel.getByRole('button', { name: 'Next reference results', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__lookupFixtureApp.lookupCurrentPage), 2);
        await panel.locator('#editorLookupMode').selectOption('clienttext'); await panel.locator('#editorLookupGroup').selectOption(first.id);
        await search.fill('same-0'); await page.waitForFunction(() => window.__lookupFixtureApp.lookupAppliedQuery === 'same-0');
        await panel.locator('.lookupResult').filter({ hasText: 'normal · Normal · same-0' }).click();
        assert.equal(await page.evaluate(() => window.__lookupFixtureApp.lookupSelectedReference.blocks[0].translation), '', 'Blank Saved overlays replace original translations');
        assert.equal(await panel.locator('.lookupReference').locator('textarea,input').count(), 0, 'Selected references remain read only');
        await panel.locator('#editorLookupGroup').selectOption(second.id); await panel.locator('.lookupResult').filter({ hasText: 'normal · Normal · same-0' }).click();
        assert.equal(await page.evaluate(() => window.__lookupFixtureApp.lookupSelectedReference.blocks[0].translation), raw, 'Duplicate record IDs in different groups retain exact raw literal text');
        assert.equal(await panel.locator('.lookupReference img').count(), 0, 'Raw markup is escaped');
        await search.fill('Secret reference draft'); await page.waitForFunction(() => window.__lookupFixtureApp.lookupAppliedQuery === 'Secret reference draft');
        assert.equal(await page.evaluate(() => window.__lookupFixtureApp.lookupResultCount), 0, 'Unsaved drafts are excluded from references');
        await context.setOffline(false);
        await page.evaluate(async ({ version, group }) => {
            const vm = window.__lookupFixtureApp; await vm.ctOpenGroup(version, group, 'French');
            await vm.ctSelect(vm.ctUnits.find(unit => unit.role === 'normal' && unit.recordId === 'same-0'), true);
        }, { version, group: second });
        await page.getByRole('button', { name: 'Lookup', exact: true }).click();
        await page.waitForFunction(() => window.__lookupFixtureApp.ctTool === 'lookup' && window.__lookupFixtureApp.lookupCatalogSources.length === 3);
        const ctPanel = page.locator('#ctFullEditorSidebarHost #editorLookupPanel');
        await ctPanel.locator('#editorLookupMode').selectOption('statdescription'); await ctPanel.locator('#editorLookupSearch').fill('Blade');
        await page.waitForFunction(() => window.__lookupFixtureApp.lookupAppliedQuery === 'Blade' && window.__lookupFixtureApp.lookupResultCount === 1);
        await ctPanel.locator('.lookupResult').click();
        assert.equal(await page.evaluate(() => window.__lookupFixtureApp.lookupSelectedReference.blocks[0].isTable), true, 'ClientText uses SD reference/table behavior for SD siblings');
        const activeUnit = await page.evaluate(() => window.__lookupFixtureApp.ctSelection);
        await page.keyboard.press('Control+f'); assert.equal(await ctPanel.locator('#editorLookupSearch').evaluate(input => input === document.activeElement), true);
        assert.equal(await page.evaluate(() => window.__lookupFixtureApp.ctSelection), activeUnit, 'Lookup keyboard focus does not navigate the active ClientText record');
        for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
            await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
            await page.setViewportSize({ width: 1100, height: 850 });
            assert.ok(await ctPanel.isVisible(), theme + ': shared sidebar remains visible in resized desktop');
        }
        assert.deepEqual(failures, []); console.log('PASS: shared SD/ClientText lookup, offline cached references, pagination, blank Saved overlays, excluded drafts, duplicate/raw identities, cancellation and unchanged active pointers/rooms.');
    } finally {
        await browser?.close(); api.locals.collaborationRealtime.close();
        await Promise.all([new Promise(done => frontendServer.close(done)), new Promise(done => apiServer.close(done))]);
        database.close();
        if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith('sdeditor-lookup-')) throw new Error('Refusing cleanup outside the disposable fixture directory.');
        rmSync(directory, { recursive: true, force: true });
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
