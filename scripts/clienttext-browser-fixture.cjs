'use strict';
// Disposable normal-mode acceptance check: real API/auth, IndexedDB and the ClientText worker.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const Codec = require('../public/clientTextCodec.js');
const StatCodec = require('../public/statDescCodec.js');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);
if (!executablePath) throw new Error('No installed Edge/Chrome found; set FIXTURE_BROWSER_PATH.');

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = (r, value, s = 0) => `<c r="${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
const blank = (r, s = 0) => `<c r="${r}" s="${s}"/>`;
const row = (r, cells) => `<row r="${r}">${cells.join('')}</row>`;
const sheet = rows => `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>${rows.join('')}</sheetData></worksheet>`;
const styles = `<styleSheet xmlns="${NS}"><fonts count="1"><font><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFA8072"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF9966"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4">${[0, 1, 2, 3].map(fill => `<xf numFmtId="0" fontId="0" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf>`).join('')}</cellXfs></styleSheet>`;
async function workbook(JSZip, role) {
    const sheets = role === 'normal' ? [
        ['Normal', sheet([
            row(1, [cell('A1', 'ID'), cell('B1', 'Notes'), cell('C1', 'Name'), cell('D1', 'Translation'), cell('E1', 'Gender'), cell('G1', 'Description'), cell('H1', 'Translation')]),
            row(2, [cell('A2', 'record'), cell('B2', 'Developer instruction'), cell('C2', 'Sword'), blank('D2', 2), cell('E2', 'M', 1), cell('G2', '[NOAUDIO] New description'), cell('H2', 'Old description', 3)]),
            row(3, [cell('A3', 'complete'), cell('C3', 'Shield'), cell('D3', 'Original', 1), cell('E3', 'F', 1), cell('G3', '{0:+d} <<keybind:open_panel>>'), cell('H3', '{0:+d} <<keybind:open_panel>>', 1)]),
            row(4, [cell('A4', 'noaudio'), cell('C4', '[NOAUDIO] '), blank('D4', 2), blank('E4')])
        ])],
        ['Second', sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Translation Note'), cell('C1', 'Text'), cell('D1', 'Translation')]), row(2, [cell('A2', 'second'), cell('B2', 'Other developer note'), cell('C2', 'Other text'), cell('D2', 'Autre texte', 1)])])]
    ] : [
        ['Words_Gender', sheet([
            row(1, [cell('A1', 'ID'), cell('B1', 'Tags'), cell('C1', 'Text'), ...['MS', 'FS', 'NS', 'MP', 'FP', 'NP'].map((label, i) => cell(String.fromCharCode(68 + i) + '1', label))]),
            row(2, [cell('A2', 'form'), cell('B2', 'weapon'), cell('C2', 'Strong'), cell('D2', 'Fort', 1), cell('F2', ' NONEXISTENT', 1), cell('I2', 'NONEXISTENT', 1)]),
            row(3, [cell('A3', 'new-form'), cell('C3', 'New'), blank('D3', 2), blank('E3', 2), blank('F3', 1), blank('G3', 1), blank('H3', 1), blank('I3', 1)])
        ])],
        ['Nouns', sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Display Name'), cell('C1', 'Translation'), cell('D1', 'Gender')]), row(2, [cell('A2', 'noun'), cell('B2', 'Chest'), cell('C2', 'Coffre', 1), blank('D2', 2)])])]
    ];
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>');
    zip.file('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([name], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`);
    sheets.forEach(([, xml], i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, xml));
    zip.file('xl/styles.xml', styles); zip.file('xl/vbaProject.bin', new Uint8Array([1, 9, 255])); zip.file('xl/metadata', new Uint8Array([0, 255, 8, 99]));
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function run() {
    const apiRoot = resolve(process.env.SDEDITOR_FIXTURE_API_ROOT || join(__dirname, '../../SDEditor-API'));
    const fromApi = createRequire(join(apiRoot, 'package.json'));
    const load = name => import(pathToFileURL(join(apiRoot, 'src', name)).href);
    const [{ loadConfig }, { openDatabase, CloudStore }, { createApp }] = await Promise.all([load('config.js'), load('database.js'), load('app.js')]);
    const express = fromApi('express'), JSZip = fromApi('jszip');
    const directory = mkdtempSync(join(tmpdir(), 'sdeditor-clienttext-browser-')), secret = randomUUID();
    const frontend = express(), frontendServer = createServer(frontend);
    await new Promise(resolve => frontendServer.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + frontendServer.address().port;
    const config = loadConfig({ ADMIN_GOOGLE_SUB: 'fixture-admin', FRONTEND_ORIGIN: origin, API_PUBLIC_URL: 'http://127.0.0.1:1', DATA_DIR: directory, DATABASE_PATH: ':memory:' });
    const database = openDatabase(':memory:'), store = new CloudStore(database, config);
    store.registerIdentity({ sub: 'fixture-admin', email: 'admin@fixture.example', name: 'ClientText Fixture Admin' });
    const api = createApp({ config, database, store, oauthProvider: null }), apiServer = createServer(api);
    api.locals.collaborationRealtime.attach(apiServer);
    await new Promise(resolve => apiServer.listen(0, '127.0.0.1', resolve));
    const apiOrigin = 'http://127.0.0.1:' + apiServer.address().port;
    frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    frontend.post('/fixture/session', (req, res) => { if (req.get('X-Fixture-Key') !== secret) return res.sendStatus(403); res.json(store.createSession('fixture-admin')); });
    frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(__dirname, '../public/index.html'), 'utf8').replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
    frontend.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
    frontend.get('/clientTextWorker.js', (req, res) => res.type('js').send(readFileSync(join(__dirname, '../public/clientTextWorker.js'), 'utf8').replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
    frontend.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(__dirname, '../public/index.js'), 'utf8').replace("app.mount('#app');", "window.__clientFixtureApp = app.mount('#app');")));
    frontend.use(express.static(join(__dirname, '../public')));
    const normal = await workbook(JSZip, 'normal'), gender = await workbook(JSZip, 'gender');
    const files = [{ name: 'French_PoE2.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', buffer: normal }, { name: 'French_Gender_PoE2.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', buffer: gender }];
    const statDescription = { filepath: 'specific_skill_stat_descriptions/explosive_grenade/fire.txt', filedir: 'specific_skill_stat_descriptions/explosive_grenade', filename: 'fire.txt', name: 'fire',
        stats: ['fire_damage'], variables: ['#'], remarks: [''], translations: { English: ['Fire damage'], French: [''] } };
    const statArchive = new JSZip(); statArchive.file(statDescription.filepath, StatCodec.descEncode(statDescription), { createFolders: false });
    const statFile = { name: 'StatDescriptions.zip', mimeType: 'application/zip', buffer: await statArchive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) };
    const failures = [], results = [], isolationScopes = []; let browser;
    try {
        browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, ignoreHTTPSErrors: true });
        const page = await context.newPage(); page.on('pageerror', error => failures.push(error.message));
        const bootstrap = async () => {
            await page.goto(origin + '/?cloudApi=' + encodeURIComponent(apiOrigin));
            await page.waitForFunction(() => window.__clientFixtureApp?.offlineStoreReady && window.__clientFixtureApp?._cloud?.state, { timeout: 30000 });
            await page.evaluate(async secret => {
                const vm = window.__clientFixtureApp, response = await fetch('/fixture/session', { method: 'POST', headers: { 'X-Fixture-Key': secret } });
                await vm._cloud.acceptLogin(await response.json()); await vm.cloudApply(vm._cloud.snapshot());
                vm.lang = 'French'; vm.needsInitialSettings = false; vm.showSetting = false; vm.inlineEditor = false;
                await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
                await vm.activateGameVersion('poe2', { checkMigration: false });
                const report = vm.ctReport.bind(vm); window.__ctProgressEvents = [];
                vm.ctReport = value => { window.__ctProgressEvents.push(JSON.parse(JSON.stringify(value))); report(value); };
            }, secret);
            await page.getByRole('region', { name: 'Source versions' }).waitFor();
        };
        await bootstrap();
        await page.getByRole('button', { name: 'Import ClientText workbooks', exact: true }).click();
        const upload = page.getByRole('region', { name: 'Content upload' });
        const desktopSizes = [{ width: 1440, height: 1000 }, { width: 1100, height: 850 }];
        const themes = ['light', 'grey', 'dark', 'modern-dark'];
        const checkUploadLayout = async ({ admin = false } = {}) => {
            const policy = upload.locator('.ctUploadPolicy');
            assert.equal(await policy.count(), admin ? 1 : 0, 'Role configuration is shown only in manager publication for an admin');
            assert.doesNotMatch(await upload.textContent(), /Missing_XXX\.txt is ignored|Missing_.*\.txt.*ignore/i, 'Removed Missing-file explanation stays absent');
            if (admin) await policy.locator('summary').click();
            for (const size of desktopSizes) {
                await page.setViewportSize(size);
                for (const theme of themes) {
                    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                    const spacing = await upload.evaluate(element => {
                        const rect = node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }; };
                        const fields = Array.from(element.querySelectorAll('.ctUploadSelectors .ctUploadField'), label => {
                            const range = document.createRange(); range.selectNode(label.firstChild);
                            return { label: rect({ getBoundingClientRect: () => range.getBoundingClientRect() }), input: rect(label.querySelector('input')) };
                        });
                        const policy = element.querySelector('.ctUploadPolicy');
                        return { dialog: rect(element), fields, overflow: document.documentElement.scrollWidth - innerWidth,
                            policy: policy ? { summary: rect(policy.querySelector('summary')), textarea: rect(policy.querySelector('textarea')), button: rect(policy.querySelector('button')) } : null };
                    });
                    assert.ok(spacing.dialog.width <= 900 && spacing.dialog.x >= 29 && spacing.dialog.right <= size.width - 29, theme + ': upload fits the desktop viewport');
                    assert.ok(spacing.overflow <= 1, theme + ': upload creates no horizontal page overflow');
                    assert.equal(spacing.fields.length, 2);
                    assert.ok(spacing.fields[1].input.x - spacing.fields[0].input.right >= 15, theme + ': file and folder inputs retain their column gap');
                    for (const field of spacing.fields) {
                        assert.ok(field.input.y - field.label.bottom >= 5, theme + ': chooser label has a separate line with spacing');
                        assert.ok(field.input.height >= 38, theme + ': native file chooser has sufficient vertical padding');
                    }
                    if (admin) {
                        assert.ok(spacing.policy.textarea.y - spacing.policy.summary.bottom >= 20, theme + ': role configuration separates summary and JSON editor');
                        assert.ok(spacing.policy.button.y - spacing.policy.textarea.bottom >= 11, theme + ': role configuration separates JSON editor and Save button');
                    }
                    let first;
                    for (const completed of [0, 1, 999, 141568, 1000000]) {
                        await page.evaluate(async completed => {
                            const vm = window.__clientFixtureApp;
                            vm.ctReport({ phase: completed % 2 ? 'Validating' : 'Preparing', workbook: 'French_Gender_PoE2.xlsm',
                                sheet: completed ? 'A very long worksheet label with repeated descriptive names '.repeat(5) : 'Normal', completed, total: 1000000 });
                            await vm.$nextTick();
                        }, completed);
                        const progress = upload.locator('.ctProgress'); await progress.scrollIntoViewIfNeeded();
                        const bounds = await progress.evaluate(element => {
                            const bar = element.querySelector('progress'), cancel = element.querySelector('.ctProgressCancel'), label = element.querySelector('.ctProgressLabel'), count = element.querySelector('.ctProgressCount');
                            const rect = node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right }; };
                            const prior = window.__fixtureProgressNodes;
                            window.__fixtureProgressNodes = { element, bar, cancel, label, count };
                            return { panel: rect(element), bar: rect(bar), cancel: rect(cancel), count: rect(count), label: rect(label),
                                countText: count.textContent, title: label.title, ellipsis: getComputedStyle(label).textOverflow,
                                tabular: getComputedStyle(count).fontVariantNumeric, sameNodes: !prior || prior.element !== element || (prior.bar === bar && prior.cancel === cancel && prior.label === label && prior.count === count) };
                        });
                        assert.equal(bounds.countText.trim(), completed + ' / 1000000');
                        assert.equal(bounds.ellipsis, 'ellipsis'); assert.equal(bounds.tabular, 'tabular-nums'); assert.ok(bounds.sameNodes, 'Progress updates reuse the existing controls');
                        assert.ok(bounds.cancel.x > bounds.bar.right && bounds.cancel.right <= bounds.panel.right - 11, theme + ': Cancel occupies a separate right column');
                        assert.ok(bounds.cancel.width > 60 && bounds.bar.width > 500, theme + ': Cancel and progress retain usable widths');
                        if (completed) assert.ok(bounds.title.includes('A very long worksheet label'), 'Full truncated sheet label remains available in the title');
                        if (first) for (const key of ['panel', 'bar', 'cancel', 'count']) for (const property of ['x', 'width', 'height']) assert.ok(Math.abs(bounds[key][property] - first[key][property]) < 1, `${theme}: ${key}.${property} stays stable as progress count and sheet label change`);
                        else first = bounds;
                    }
                    await page.screenshot({ path: join(directory, `clienttext-upload-${admin ? 'admin' : 'local'}-${size.width}-${theme}.png`), fullPage: true });
                }
            }
            await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.ctProgress = null; await vm.$nextTick(); });
            if (admin) await policy.locator('summary').click();
            await page.setViewportSize(desktopSizes[0]);
            await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), 'modern-dark');
            results.push(`${admin ? 'Admin publication' : 'Local import'} layout: two desktop sizes and four themes; spaced file/folder selectors${admin ? ' and role configuration' : ''}; fixed-right Cancel and stable progress controls from 0 to 1000000`);
        };
        await checkUploadLayout();
        await upload.locator('input[type=text]').fill('ClientText browser fixture');
        await upload.locator('input[type=file]').first().setInputFiles(files.slice(0, 1));
        await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).click();
        await upload.getByRole('alert').filter({ hasText: 'French requires exactly' }).waitFor();
        assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctPrepared.length), 0);
        await upload.locator('input[type=file]').first().setInputFiles(files);
        await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).click();
        await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
        assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '', 'Workbook preparation succeeds');
        assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctPrepared.length), 1);
        assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctPrepared[0].units.length), 7);
        assert.ok((await page.evaluate(() => window.__ctProgressEvents)).some(event => event.sheet === 'Words_Gender'), 'Real worker reports per-sheet progress');
        await upload.getByRole('button', { name: 'Store local workspaces', exact: true }).click();
        await page.waitForFunction(() => !window.__clientFixtureApp.ctUploadVisible && window.__clientFixtureApp.ctLocalWorkspaces.length === 1);
        const openCached = async () => { await page.getByRole('button', { name: 'ClientText browser fixture · ClientText · French', exact: true }).click(); await page.getByRole('region', { name: 'ClientText workspace' }).waitFor(); };
        await openCached();
        const workspace = page.getByRole('region', { name: 'ClientText workspace' }), navigation = workspace.getByRole('navigation', { name: 'Workbook sheets' });
        const checkClientHistory = async ({ historyOrigin, currentText, previousText, emptyOlder = false, themes = false }) => {
            const fieldId = JSON.stringify(['Name', null]);
            await workspace.getByRole('button', { name: /^history$/i }).click();
            let historyPattern, emptyPageSeen = false;
            if (emptyOlder) {
                const historyScope = await page.evaluate(() => ({ groupId: window.__clientFixtureApp.ctWorkspace.scope.groupId, unitId: window.__clientFixtureApp.ctSelection }));
                historyPattern = apiOrigin + '/v1/content-groups/' + historyScope.groupId + '/units/' + encodeURIComponent(historyScope.unitId) + '/history?*';
                await page.route(historyPattern, async route => {
                    const response = await route.fetch(), body = await response.json();
                    if (!new URL(route.request().url()).searchParams.has('cursor') && body.history.length) body.nextCursor = String(Math.min(...body.history.map(entry => entry.id)));
                    else if (!body.history.length) emptyPageSeen = true;
                    await route.fulfill({ response, json: body });
                });
                await page.evaluate(() => window.__clientFixtureApp.ctLoadHistory());
            }
            await page.waitForFunction(({ historyOrigin, fieldId, currentText, previousText }) => {
                const vm = window.__clientFixtureApp;
                return !vm.ctHistoryLoading && vm.ctHistory.some(entry => entry.origin === historyOrigin && entry.after.values[fieldId] === currentText && entry.before.values[fieldId] === previousText);
            }, { historyOrigin, fieldId, currentText, previousText });
            const panel = workspace.locator('.ctHistoryPanel');
            if (emptyOlder) {
                const beforeKeys = await page.evaluate(() => window.__clientFixtureApp.ctHistory.map(entry => entry.key));
                await panel.getByRole('button', { name: 'Load older history', exact: true }).click();
                await page.waitForFunction(() => !window.__clientFixtureApp.ctHistoryLoading && !window.__clientFixtureApp.ctHistoryCursor);
                assert.equal(emptyPageSeen, true, 'The real history cursor reaches an empty older page');
                assert.deepEqual(await page.evaluate(() => window.__clientFixtureApp.ctHistory.map(entry => entry.key)), beforeKeys, 'An empty older page preserves visible history');
                assert.equal(await panel.getByRole('button', { name: 'Load older history', exact: true }).count(), 0);
                await page.unroute(historyPattern);
            }
            const entries = await page.evaluate(({ historyOrigin, fieldId, currentText, previousText }) => {
                const rows = window.__clientFixtureApp.ctHistory;
                return { changedIndex: rows.findIndex(entry => entry.origin === historyOrigin && entry.after.values[fieldId] === currentText && entry.before.values[fieldId] === previousText),
                    previousKey: rows.find(entry => entry.origin === historyOrigin && entry.after.values[fieldId] === previousText)?.key };
            }, { historyOrigin, fieldId, currentText, previousText });
            assert.ok(entries.changedIndex >= 0 && entries.previousKey, 'Both saved revisions are available for comparison');
            const event = panel.locator('.ctHistoryEvent').nth(entries.changedIndex);
            if (historyOrigin === 'shared') assert.match(await event.textContent(), /ClientText Fixture Admin/);
            await event.getByRole('button', { name: 'Compare change', exact: true }).click();
            const viewer = page.getByRole('dialog', { name: 'Compare · Normal · record', exact: true }); await viewer.waitFor();
            const nameField = viewer.locator('.ctHistoryDiffField').filter({ has: page.getByRole('heading', { name: 'Name', exact: true }) });
            assert.equal(await nameField.locator('.ctHistory-before .ctHistoryTarget').textContent(), previousText);
            assert.equal(await nameField.locator('.ctHistory-after .ctHistoryTarget').textContent(), currentText);
            assert.ok(await nameField.locator('.diffInlineAdd').count() > 0, 'Inserted translation text is highlighted');
            assert.equal(await nameField.locator('.ctHistory-before .ctHistorySource').textContent(), 'Sword');
            assert.match(await viewer.locator('.ctHistoryNotes').textContent(), /Developer instruction/);
            assert.equal(await viewer.locator('textarea,input:not([type=checkbox])').count(), 0, 'The comparison is read only');
            const beforeSelect = viewer.locator('.ctHistoryCompareControls select').nth(0), afterSelect = viewer.locator('.ctHistoryCompareControls select').nth(1);
            const changedKey = await page.evaluate(index => window.__clientFixtureApp.ctHistory[index].key, entries.changedIndex);
            await beforeSelect.selectOption(changedKey + ':after'); await afterSelect.selectOption(entries.previousKey + ':after');
            assert.equal(await nameField.locator('.ctHistory-before .ctHistoryTarget').textContent(), currentText);
            assert.equal(await nameField.locator('.ctHistory-after .ctHistoryTarget').textContent(), previousText);
            await beforeSelect.selectOption('original'); await afterSelect.selectOption('current');
            assert.equal(await nameField.locator('.ctHistory-before .ctHistoryTarget').textContent(), '');
            assert.equal(await nameField.locator('.ctHistory-after .ctHistoryTarget').textContent(), currentText);
            const genderField = viewer.locator('.ctHistoryDiffField[data-field-kind=gender]');
            assert.equal(await genderField.locator('.ctHistory-before .ctHistoryTarget').textContent(), 'M');
            if (historyOrigin === 'local') assert.equal(await genderField.locator('.ctHistory-after .ctHistoryTarget').textContent(), 'F');
            if (themes) for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
                await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                const bounds = await viewer.boundingBox();
                assert.ok(bounds && bounds.width > 900 && bounds.x >= 0 && bounds.x + bounds.width <= 1440 && bounds.y >= 0 && bounds.y + bounds.height <= 1000, theme + ': history comparison fits desktop');
                await page.screenshot({ path: join(directory, 'clienttext-history-' + theme + '.png'), fullPage: true });
            }
            await viewer.getByRole('button', { name: 'Close history comparison', exact: true }).click();
            assert.equal(await workspace.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), currentText, 'Read-only comparison leaves the editor unchanged');
            const beforeRestore = await page.evaluate(async () => { const vm = window.__clientFixtureApp; return { history: (await vm._ctStore.listHistory(vm.ctWorkspace.scope, vm.ctSelection)).length, outbox: (await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length }; });
            await event.getByRole('button', { name: 'Restore before as draft', exact: true }).click();
            await page.waitForFunction(async ({ fieldId, previousText }) => { const vm = window.__clientFixtureApp, draft = await vm._ctStore.getDraft(vm.ctWorkspace.scope, vm.ctSelection); return vm.ctDraftDirty && draft?.values[fieldId] === previousText; }, { fieldId, previousText });
            const restored = await page.evaluate(async fieldId => {
                const vm = window.__clientFixtureApp, saved = await vm._ctStore.getSaved(vm.ctWorkspace.scope);
                return { editor: vm.ctValues[fieldId], saved: saved[vm.ctSelection].values[fieldId], history: (await vm._ctStore.listHistory(vm.ctWorkspace.scope, vm.ctSelection)).length, outbox: (await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length, error: vm.ctHistoryError };
            }, fieldId);
            assert.deepEqual(restored, { editor: previousText, saved: currentText, history: beforeRestore.history, outbox: beforeRestore.outbox, error: '' }, 'History restore writes only a durable draft');
            await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctSelection && !window.__clientFixtureApp.ctBusy);
            if (historyOrigin === 'shared') await page.waitForFunction(async ({ fieldId, previousText }) => { const vm = window.__clientFixtureApp; return !(await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length && Object.values(vm.ctSaved).some(saved => saved.serverRevision > 0 && saved.values[fieldId] === previousText); }, { fieldId, previousText });
            results.push(historyOrigin + ' ClientText history compares saved revisions/original/current; Restore before creates a durable draft without changing saved work' + (emptyOlder ? '; empty older pagination keeps existing rows' : ''));
        };
        await navigation.getByRole('button', { name: 'Normal', exact: true }).click();
        await workspace.getByRole('button', { name: 'record', exact: true }).click();
        assert.match(await workspace.locator('.ctDeveloperNotes').textContent(), /Developer instruction/);
        const name = workspace.getByRole('textbox', { name: 'Name', exact: true });
        await name.fill('Épée'); await name.press('F2');
        await page.waitForFunction(() => Object.values(window.__clientFixtureApp.ctSaved).some(saved => Object.values(saved.values).includes('Épée')));
        await workspace.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
        await workspace.getByRole('combobox', { name: 'Gender', exact: true }).selectOption('F');
        await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
        await page.waitForFunction(() => !window.__clientFixtureApp.ctSelection && !window.__clientFixtureApp.ctBusy);
        await workspace.getByRole('button', { name: 'record', exact: true }).click();
        await name.fill('Épée locale'); await name.press('F2');
        await page.waitForFunction(() => !window.__clientFixtureApp.ctBusy && Object.values(window.__clientFixtureApp.ctSaved).some(saved => Object.values(saved.values).includes('Épée locale')));
        await checkClientHistory({ historyOrigin: 'local', currentText: 'Épée locale', previousText: 'Épée', themes: true });
        await workspace.getByRole('button', { name: 'complete', exact: true }).click();
        await workspace.getByRole('textbox', { name: 'Name', exact: true }).fill('Bouclier brouillon');
        await workspace.getByRole('button', { name: 'Table', exact: true }).click();
        await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
        await bootstrap(); await page.waitForFunction(() => window.__clientFixtureApp.ctLocalWorkspaces.length === 1); await openCached();
        await navigation.getByRole('button', { name: 'Normal', exact: true }).click();
        await workspace.getByRole('button', { name: 'complete', exact: true }).click();
        await page.waitForFunction(() => window.__clientFixtureApp.ctDraftDirty);
        assert.equal(await workspace.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Bouclier brouillon', 'Draft survives reload in real IndexedDB');
        assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctStatus().saved), false, 'Recovered draft is not committed Saved work');
        await workspace.getByRole('textbox', { name: 'Name', exact: true }).fill('Bouclier');
        await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
        await page.waitForFunction(() => !window.__clientFixtureApp.ctSelection && !window.__clientFixtureApp.ctBusy);
        await navigation.getByRole('button', { name: 'Second', exact: true }).click();
        assert.equal(await workspace.getByRole('button', { name: 'second', exact: true }).count(), 1);
        await navigation.getByRole('button', { name: 'All sheets', exact: true }).click();
        await workspace.getByRole('searchbox', { name: 'Search ClientText' }).fill('Developer instruction');
        await page.waitForFunction(() => window.__clientFixtureApp.ctRows.length === 1);
        await workspace.getByRole('searchbox', { name: 'Search ClientText' }).fill('');
        await navigation.getByRole('button', { name: 'Words_Gender', exact: true }).click();
        await workspace.getByRole('button', { name: 'form', exact: true }).click();
        await workspace.locator('.ctFormGrid').waitFor();
        assert.deepEqual(await workspace.locator('.ctFormGrid thead th').allTextContents(), ['Form', 'Singular', 'Plural']);
        assert.deepEqual(await workspace.locator('.ctFormGrid tbody th').allTextContents(), ['M', 'F', 'N']);
        await workspace.getByRole('textbox', { name: 'Text FS', exact: true }).fill('Forte');
        const form = workspace.getByRole('textbox', { name: 'Text NP', exact: true }); await form.fill('NON'); await form.press('Tab');
        assert.equal(await form.inputValue(), 'NONEXISTENT');
        await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
        await page.waitForFunction(() => !window.__clientFixtureApp.ctSelection && !window.__clientFixtureApp.ctBusy);
        await navigation.getByRole('button', { name: 'Nouns', exact: true }).click(); await workspace.getByRole('button', { name: 'noun', exact: true }).click();
        await workspace.getByRole('combobox', { name: 'Gender', exact: true }).selectOption('M');
        await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
        await page.waitForFunction(() => !window.__clientFixtureApp.ctSelection && !window.__clientFixtureApp.ctBusy);
        for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
            await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
            await navigation.getByRole('button', { name: 'Normal', exact: true }).click(); await workspace.getByRole('button', { name: 'record', exact: true }).click();
            const bounds = await workspace.getByRole('textbox', { name: 'Name', exact: true }).boundingBox();
            assert.ok(bounds && bounds.width > 180 && bounds.height > 40 && bounds.x + bounds.width <= 1440, theme + ': editable text fits desktop');
            await page.screenshot({ path: join(directory, 'clienttext-' + theme + '.png'), fullPage: true });
            await workspace.getByRole('button', { name: 'Table', exact: true }).click();
            await navigation.getByRole('button', { name: 'Words_Gender', exact: true }).click(); await workspace.getByRole('button', { name: 'form', exact: true }).click();
            const formBounds = await workspace.getByRole('textbox', { name: 'Text FS', exact: true }).boundingBox();
            assert.ok(formBounds && formBounds.width > 180 && formBounds.x + formBounds.width <= 1440, theme + ': six-form text fits desktop');
            await page.screenshot({ path: join(directory, 'clienttext-gender-' + theme + '.png'), fullPage: true });
            await workspace.getByRole('button', { name: 'Table', exact: true }).click();
        }
        const downloaded = page.waitForEvent('download'); await workspace.getByRole('button', { name: 'Download workbooks', exact: true }).click();
        const download = await downloaded, path = await download.path();
        assert.match(download.suggestedFilename(), /ClientText\.zip$/);
        const archive = await JSZip.loadAsync(readFileSync(path));
        assert.deepEqual(Object.keys(archive.files).filter(name => !archive.files[name].dir).sort(), files.map(file => file.name).sort());
        const parsedNormal = await Codec.parseWorkbook(await archive.file(files[0].name).async('uint8array'), { filename: files[0].name, role: 'normal' });
        const parsedGender = await Codec.parseWorkbook(await archive.file(files[1].name).async('uint8array'), { filename: files[1].name, role: 'gender' });
        const get = (parsed, id, name, form = null) => parsed.units.find(unit => unit.recordId === id).fields.find(field => field.id === JSON.stringify([name, form]));
        assert.equal(get(parsedNormal, 'record', 'Name').target, 'Épée'); assert.equal(get(parsedNormal, 'record', 'Name').originalFill, 'D9D9D9');
        assert.equal(get(parsedNormal, 'record', 'Description').target, 'Old description'); assert.equal(get(parsedNormal, 'record', 'Description').originalFill, 'C6EFCE');
        assert.equal(get(parsedNormal, 'complete', 'Name').target, 'Bouclier'); assert.equal(get(parsedNormal, 'complete', 'Name').originalFill, 'D9D2E9');
        assert.equal(get(parsedGender, 'form', 'Text', 'FS').target, 'Forte'); assert.equal(get(parsedGender, 'noun', 'Gender').target, 'M');
        for (const file of files) {
            const output = await JSZip.loadAsync(await archive.file(file.name).async('uint8array'));
            assert.deepEqual(await output.file('xl/vbaProject.bin').async('uint8array'), new Uint8Array([1, 9, 255]));
            assert.deepEqual(await output.file('xl/metadata').async('uint8array'), new Uint8Array([0, 255, 8, 99]));
        }
        const retained = await page.evaluate(async () => { const vm = window.__clientFixtureApp, assets = await Promise.all(['normal', 'gender'].map(role => vm._ctStore.getAsset(vm.ctWorkspace.scope, role))); return assets.map(asset => ({ role: asset.role, size: asset.blob.size, units: asset.parsed.units || null })); });
        assert.deepEqual(retained, files.map((file, index) => ({ role: index ? 'gender' : 'normal', size: file.buffer.length, units: null })), 'Original blobs and immutable parsed metadata stay local');
        assert.deepEqual(failures, [], 'Browser script errors');
        results.push('French pair enforcement; real worker sheet progress; immutable original workbook blobs in IndexedDB');
        results.push('F2 and Save & close persist per-field values/reviews; draft survives reload without becoming Saved');
        results.push('Sheet filter, developer-note search, Gender combo box, six-form grid and NONEXISTENT completion');
        results.push('Four desktop themes; paired full-workbook download preserves macros/native metadata and gray/green/purple status fills');
        if (process.env.CLIENTTEXT_SHARED_FLOW === '1' || process.argv.includes('--shared')) {
            await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
            await page.getByRole('button', { name: 'Upload next version', exact: true }).click();
            await checkUploadLayout({ admin: true });
            await upload.locator('input[type=text]').fill('Shared ClientText fixture');
            await upload.getByRole('button', { name: 'Save version draft', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '', 'Metadata-only version draft is saved');
            const draftVersionId = await page.evaluate(() => window.__clientFixtureApp.ctUploadVersion.id);
            await upload.getByRole('button', { name: 'Close', exact: true }).click();
            await bootstrap(); await page.getByRole('button', { name: 'Shared ClientText fixture', exact: true }).click();
            const details = page.getByRole('region', { name: 'Selected version' });
            assert.equal(await details.locator('[data-content-group]').count(), 0, 'Version starts without attached content');
            await details.getByRole('button', { name: 'Add content group', exact: true }).click();
            await upload.locator('input[type=file]').first().setInputFiles(files);
            await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '');
            let interrupted = false;
            const uploadPattern = apiOrigin + '/v1/content-uploads/*/assets/*';
            await page.route(uploadPattern, route => {
                if (interrupted) return route.continue(); interrupted = true;
                return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FIXTURE_UPLOAD_INTERRUPTED', message: 'Fixture interrupted original upload.' } }) });
            });
            await upload.getByRole('button', { name: 'Publish complete groups', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(interrupted, true, 'The first publication is interrupted after durable preparation');
            assert.match(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), /Fixture interrupted/);
            await page.unroute(uploadPattern); await upload.getByRole('button', { name: 'Close', exact: true }).click();
            await bootstrap();
            await page.getByRole('button', { name: 'Resume Shared ClientText fixture · content upload', exact: true }).click();
            await page.waitForFunction(() => window.__clientFixtureApp.ctPrepared.length === 1);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadVersion.id), draftVersionId, 'Resume reuses the existing metadata version');
            await upload.getByRole('button', { name: 'Publish complete groups', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '', 'Real API publishes complete workbook group');
            await details.getByRole('button', { name: 'Open editor', exact: true }).click();
            await workspace.waitFor(); await page.waitForFunction(() => !window.__clientFixtureApp.ctBusy);
            await navigation.getByRole('button', { name: 'Normal', exact: true }).click(); await workspace.getByRole('button', { name: 'record', exact: true }).click();
            await workspace.getByRole('textbox', { name: 'Name', exact: true }).fill('En ligne');
            await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
            await page.waitForFunction(async () => { const vm = window.__clientFixtureApp; return !vm.ctBusy && !(await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length && Object.values(vm.ctSaved).some(record => record.serverRevision > 0 && Object.values(record.values).includes('En ligne')); });
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctError), '', 'ClientText proof-backed save is accepted');
            await workspace.getByRole('button', { name: 'record', exact: true }).click();
            await workspace.getByRole('textbox', { name: 'Name', exact: true }).fill('En ligne temporaire');
            await workspace.getByRole('textbox', { name: 'Name', exact: true }).press('F2');
            await page.waitForFunction(async () => { const vm = window.__clientFixtureApp; return !vm.ctBusy && !(await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length && Object.values(vm.ctSaved).some(record => record.serverRevision > 0 && Object.values(record.values).includes('En ligne temporaire')); });
            await checkClientHistory({ historyOrigin: 'shared', currentText: 'En ligne temporaire', previousText: 'En ligne', emptyOlder: true });
            await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
            const acceptedEvent = page.waitForEvent('download'); await details.getByRole('button', { name: 'Download accepted work', exact: true }).click();
            const acceptedDownload = await acceptedEvent, acceptedArchive = await JSZip.loadAsync(readFileSync(await acceptedDownload.path()));
            const acceptedNormal = await Codec.parseWorkbook(await acceptedArchive.file(files[0].name).async('uint8array'), { filename: files[0].name, role: 'normal' });
            const acceptedField = get(acceptedNormal, 'record', 'Name'); assert.equal(acceptedField.target, 'En ligne'); assert.equal(acceptedField.originalFill, 'D9D9D9');
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctError), '', 'Immutable accepted-work collection downloads');
            results.push('Metadata-only version draft; publication resumes after interrupted upload and reload using cached original files');
            results.push('Real API complete-group publication, proof-backed save/acknowledgement and immutable accepted-work collection');
            await details.getByRole('button', { name: 'Add content group', exact: true }).click();
            await upload.locator('input[type=file]').first().setInputFiles(statFile);
            assert.equal(await upload.getByRole('checkbox').count(), 12); assert.equal(await upload.getByRole('checkbox').evaluateAll(inputs => inputs.every(input => input.checked)), true, 'StatDescription defaults to all teams');
            await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '', 'StatDescription group prepares');
            await upload.getByRole('button', { name: 'Publish complete groups', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '', 'StatDescription group publishes alongside ClientText');
            const groups = await page.evaluate(() => window.__clientFixtureApp.ctGroups.map(group => ({ id: group.id, contentMode: group.contentMode })));
            const statGroup = groups.find(group => group.contentMode === 'statdescription'), clientGroup = groups.find(group => group.contentMode === 'clienttext');
            assert.ok(statGroup && clientGroup && statGroup.id !== clientGroup.id);
            for (const size of desktopSizes) {
                await page.setViewportSize(size);
                for (const theme of themes) {
                    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                    await details.scrollIntoViewIfNeeded();
                    const layout = await details.evaluate(element => {
                        const rect = node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }; };
                        const header = element.querySelector('.selectedVersionHeader');
                        return { panel: rect(element), header: rect(header), title: rect(header.querySelector('h2')), add: rect(header.querySelector('button')),
                            overflow: document.documentElement.scrollWidth - innerWidth, cards: element.querySelectorAll('.ctGroupCard').length,
                            groups: Array.from(element.querySelectorAll('.versionContentGroup'), group => {
                                const wrapper = group.querySelector('.versionTableScroll'), table = group.querySelector('.contentGroupTeamTable');
                                const team = group.querySelector('tr[data-language="French"]');
                                const model = window.__clientFixtureApp.ctGroups.find(candidate => candidate.id === group.dataset.contentGroup);
                                return { id: group.dataset.contentGroup, wrapper: rect(wrapper), headers: Array.from(table.querySelectorAll('th'), th => ({ text: th.textContent.trim(), scope: th.scope })),
                                    cells: team.children.length, progress: rect(team.querySelector('.versionProgress')), meter: team.querySelector('.versionProgress').getAttribute('role'),
                                    contentMode: model.contentMode, counts: model.teams.find(candidate => candidate.language === 'French').counts,
                                    loadedText: team.querySelector('td:first-child > small').textContent.trim(), progressText: team.querySelector('.versionProgressSummary strong').textContent.trim(),
                                    progressNow: team.querySelector('.versionProgress').getAttribute('aria-valuenow'), progressMax: team.querySelector('.versionProgress').getAttribute('aria-valuemax'),
                                    actions: Array.from(team.querySelectorAll('.versionTeamActions button'), button => ({ text: button.textContent.trim(), disabled: button.disabled, bounds: rect(button) })) };
                            }) };
                    });
                    assert.equal(layout.cards, 0, 'Content groups use the shared team table instead of cards'); assert.equal(layout.groups.length, 2);
                    assert.ok(layout.add.x > layout.title.right && Math.abs(layout.add.right - layout.header.right) < 1, theme + ': Add content group is on the right of the selected version header');
                    assert.ok(Math.abs(layout.add.y - layout.header.y) < 1, theme + ': selected version header and action align at the top');
                    assert.ok(layout.overflow <= 1, theme + ': content table scroll is contained without widening the page');
                    for (const group of layout.groups) {
                        assert.deepEqual(group.headers.map(header => header.text), ['Language team', 'Progress', 'Online', 'Actions']);
                        assert.ok(group.headers.every(header => header.scope === 'col')); assert.equal(group.cells, 4); assert.equal(group.meter, 'meter');
                        assert.ok(group.wrapper.x >= layout.panel.x && group.wrapper.right <= layout.panel.right, 'Narrow desktop table overflow stays inside the selected version panel');
                        assert.ok(group.progress.width >= 200, 'Both content modes reuse the existing readable progress meter');
                        assert.ok(['Open editor', 'Download accepted work', 'Collect and end'].every(text => group.actions.some(action => action.text === text && !action.disabled)), 'Shared table keeps the team actions available');
                        if (group.contentMode === 'clienttext') {
                            assert.equal(group.loadedText, `${group.counts.loaded ?? 0} IDs`, 'ClientText table shows the exact ID count');
                            assert.equal(group.progressText, `${group.counts.resolvedFields ?? 0} / ${group.counts.workloadFields ?? 0}`, 'ClientText progress uses field workload, rather than unit counts');
                            assert.equal(group.progressNow, String(group.counts.resolvedFields ?? 0));
                            assert.equal(group.progressMax, String(Math.max(1, group.counts.workloadFields ?? 0)));
                        }
                    }
                    await page.screenshot({ path: join(directory, `clienttext-group-tables-${size.width}-${theme}.png`), fullPage: true });
                }
            }
            await page.setViewportSize(desktopSizes[0]); await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), 'modern-dark');
            await page.evaluate(async groupId => {
                const vm = window.__clientFixtureApp; window.__fixtureOriginalDetails = vm.managedVersionDetails;
                vm.managedVersionDetails = { ...vm.managedVersionDetails, contentGroups: vm.ctGroups.map(group => group.id !== groupId ? group : { ...group, teams: group.teams.map(team => team.language !== 'French' ? team : { ...team,
                    counts: { ...team.counts, loaded: 0, total: 999, resolved: 999, workload: 999, resolvedFields: 0, workloadFields: 0 } }) }) };
                await vm.$nextTick();
            }, clientGroup.id);
            const emptyTeam = details.locator(`[data-content-group="${clientGroup.id}"] tr[data-language="French"]`);
            assert.equal(await emptyTeam.locator('.versionProgressSummary strong').textContent(), '0 / 0', 'Empty field workload remains zero despite nonzero unit-count fallbacks');
            assert.equal(await emptyTeam.locator('td:first-child > small').first().textContent(), '0 IDs', 'Zero loaded IDs never falls back to another count');
            assert.equal(await emptyTeam.locator('.versionProgressTrack .saved').evaluate(element => element.style.width), '0%');
            await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.managedVersionDetails = window.__fixtureOriginalDetails; delete window.__fixtureOriginalDetails; await vm.$nextTick(); });
            await details.getByRole('button', { name: 'Add content group', exact: true }).click();
            await upload.waitFor(); assert.match(await upload.locator('h2').textContent(), /Add content groups to Shared ClientText fixture/);
            await upload.getByRole('button', { name: 'Close', exact: true }).click();
            results.push('Selected version header and CT/SD team tables fit two desktop sizes in all four themes; accessible field progress and exact zero-workload counts; header action opens the content uploader');
            const statCard = details.locator('[data-content-group="' + statGroup.id + '"]');
            const statTeam = statCard.locator('.ctGroupTeam').filter({ has: page.locator('strong').filter({ hasText: /^French$/ }) });
            await statTeam.getByRole('button', { name: 'Open editor', exact: true }).click();
            await page.waitForFunction(groupId => { const vm = window.__clientFixtureApp; return vm.sourceLoaded && !vm.ctActive && vm.activeContentGroup?.id === groupId && !vm.workspaceInitializationActive; }, statGroup.id);
            await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
            const translation = page.locator('input[placeholder="Translation"]').filter({ visible: true }).first(); await translation.fill('Dégâts de feu du groupe');
            await page.getByRole('button', { name: 'Save & close', exact: true }).click();
            await page.evaluate(async () => { const vm = window.__clientFixtureApp; await vm.waitForPendingSaves(); await vm._collaboration?.retry(); });
            await page.waitForFunction(() => { const vm = window.__clientFixtureApp, collaboration = vm._collaboration?.snapshot({ includeFiles: false }); return vm.statistic.hasChanges === 1 && collaboration?.connected && collaboration.roomId && !collaboration.pending; });
            const statScope = await page.evaluate(() => { const vm = window.__clientFixtureApp; return { scope: vm.managedWorkspaceScope(), collaboration: vm._collaboration.snapshot({ includeFiles: false }).identity }; });
            isolationScopes.push(statScope.scope);
            assert.equal(statScope.scope.groupId, statGroup.id); assert.equal(statScope.scope.versionId, draftVersionId); assert.equal(statScope.collaboration.groupId, statGroup.id);
            await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
            await translation.fill('Dégâts de feu temporaires');
            await page.getByRole('button', { name: 'Save & close', exact: true }).click();
            await page.evaluate(async () => { const vm = window.__clientFixtureApp; await vm.waitForPendingSaves(); await vm._collaboration?.retry(); });
            await page.waitForFunction(() => !window.__clientFixtureApp._collaboration?.snapshot({ includeFiles: false }).pending);
            await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
            await page.getByRole('button', { name: '🕒 History', exact: true }).click();
            await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return !vm.historyLoading && vm.historyItems.length >= 2; });
            const statHistory = page.locator('.historyPanel'); await statHistory.locator('.historyPick').nth(1).click();
            await statHistory.locator('.historyDiff').waitFor();
            assert.match(await statHistory.locator('.historyDiff').textContent(), /temporaires/);
            assert.match(await statHistory.locator('.historyDiff').textContent(), /du groupe/);
            await statHistory.getByRole('button', { name: 'Clear', exact: true }).click();
            await translation.fill('Dégâts de feu du groupe');
            await page.getByRole('button', { name: 'Save & close', exact: true }).click();
            await page.evaluate(async () => { const vm = window.__clientFixtureApp; await vm.waitForPendingSaves(); await vm._collaboration?.retry(); });
            await page.waitForFunction(() => !window.__clientFixtureApp._collaboration?.snapshot({ includeFiles: false }).pending);
            results.push('Legacy SD local history still compares revisions inside an independently scoped content group');
            const directoryPane = page.getByRole('navigation', { name: 'StatDescription directories' });
            await directoryPane.getByRole('combobox', { name: 'Content group', exact: true }).selectOption(clientGroup.id);
            await workspace.waitFor(); await page.waitForFunction(() => !window.__clientFixtureApp.ctBusy);
            await navigation.getByRole('button', { name: 'Normal', exact: true }).click(); await workspace.getByRole('button', { name: 'record', exact: true }).click();
            assert.equal(await workspace.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'En ligne', 'ClientText work survives StatDescription switching');
            await workspace.getByRole('combobox', { name: 'Content group', exact: true }).selectOption(statGroup.id);
            await page.waitForFunction(groupId => !window.__clientFixtureApp.ctActive && window.__clientFixtureApp.activeContentGroup?.id === groupId && !window.__clientFixtureApp.workspaceInitializationActive, statGroup.id);
            await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
            assert.equal(await translation.inputValue(), 'Dégâts de feu du groupe', 'StatDescription work survives ClientText switching');
            await page.getByRole('button', { name: 'Save & close', exact: true }).click();
            await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return !vm.editorSessionActive && !vm.editorSaving; });
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.showVersionChooser()), true, 'Versions opens after the final SD save');
            await page.getByRole('button', { name: 'Shared ClientText fixture', exact: true }).click();
            const statCollection = page.waitForEvent('download'); await statTeam.getByRole('button', { name: 'Download accepted work', exact: true }).click();
            const statDownload = await statCollection, exportedStats = await JSZip.loadAsync(readFileSync(await statDownload.path()));
            const exportedDescription = StatCodec.parseText(statDescription.filepath, StatCodec.decodeUTF16(await exportedStats.file(statDescription.filepath).async('uint8array')), 'French', { strict: true });
            assert.deepEqual(exportedDescription.translations.French, ['Dégâts de feu du groupe']);
            results.push('Same version adds a StatDescription group for all teams; proof-backed SD save/collection and CT↔SD switches preserve both workspaces');
            await page.getByRole('button', { name: 'Upload next version', exact: true }).click();
            await upload.locator('input[type=text]').fill('Identical-original StatDescription fixture');
            await upload.locator('input[type=file]').first().setInputFiles(statFile);
            await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '');
            await upload.getByRole('button', { name: 'Publish complete groups', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '', 'Identical original publishes as an independent version');
            const secondGroup = await page.evaluate(() => window.__clientFixtureApp.ctGroups.find(group => group.contentMode === 'statdescription'));
            assert.notEqual(secondGroup.id, statGroup.id); assert.notEqual(secondGroup.versionId, draftVersionId);
            const secondTeam = details.locator('[data-content-group="' + secondGroup.id + '"] .ctGroupTeam').filter({ has: page.locator('strong').filter({ hasText: /^French$/ }) });
            await secondTeam.getByRole('button', { name: 'Open editor', exact: true }).click();
            await page.waitForFunction(groupId => { const vm = window.__clientFixtureApp; if (vm.managedVisibleError) throw new Error(vm.managedVisibleError); return vm.sourceLoaded && vm.activeContentGroup?.id === groupId && !vm.workspaceInitializationActive && !vm.versionChooserVisible; }, secondGroup.id);
            await page.waitForFunction(() => { const vm = window.__clientFixtureApp, collaboration = vm._collaboration?.snapshot({ includeFiles: false }); return collaboration?.connected && !collaboration.pending && vm.statistic.hasChanges === 1; });
            await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
            assert.equal(await translation.inputValue(), 'Dégâts de feu du groupe', 'Accepted previous work carries forward explicitly');
            isolationScopes.push(await page.evaluate(() => window.__clientFixtureApp.managedWorkspaceScope()));
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.sourceIdentity), statScope.scope.sourceHash, 'Original identity remains equal across independent groups');
            await translation.fill('Dégâts de feu du nouveau groupe');
            await page.getByRole('button', { name: 'Save & close', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.editorSessionActive && !window.__clientFixtureApp.editorSaving);
            await page.evaluate(async () => { const vm = window.__clientFixtureApp; await vm.waitForPendingSaves(); await vm._collaboration?.retry(); });
            await page.waitForFunction(() => { const collaboration = window.__clientFixtureApp._collaboration?.snapshot({ includeFiles: false }); return collaboration?.connected && !collaboration.pending; });
            await bootstrap();
            await page.getByRole('button', { name: 'Identical-original StatDescription fixture', exact: true }).click();
            await secondTeam.getByRole('button', { name: 'Open editor', exact: true }).click();
            await page.waitForFunction(groupId => { const vm = window.__clientFixtureApp; if (vm.managedVisibleError) throw new Error(vm.managedVisibleError); return vm.activeContentGroup?.id === groupId && !vm.workspaceInitializationActive && !vm.versionChooserVisible; }, secondGroup.id);
            await page.waitForFunction(() => { const collaboration = window.__clientFixtureApp._collaboration?.snapshot({ includeFiles: false }); return collaboration?.connected && !collaboration.pending; });
            await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
            assert.equal(await translation.inputValue(), 'Dégâts de feu du nouveau groupe', 'The new group reopens its own cached save after reload');
            await page.getByRole('button', { name: 'Save & close', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.editorSessionActive && !window.__clientFixtureApp.editorSaving);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.showVersionChooser()), true);
            const retainedOldWork = await page.evaluate(async scope => {
                const workspace = await OfflineStore.getVersionWorkspace(scope, 'French');
                return workspace?.staged?.French?.['specific_skill_stat_descriptions/explosive_grenade/fire.txt']?.translations;
            }, statScope.scope);
            assert.deepEqual(retainedOldWork, ['Dégâts de feu du groupe'], 'The previous group remains intact before reopening');
            await page.getByRole('button', { name: 'Shared ClientText fixture', exact: true }).click();
            await statTeam.getByRole('button', { name: 'Open editor', exact: true }).click();
            const olderVersionWarning = page.getByRole('dialog', { name: 'Open source version?', exact: true });
            await olderVersionWarning.waitFor(); assert.match(await olderVersionWarning.textContent(), /not HEAD/);
            const warningScope = await page.evaluate(() => {
                const vm = window.__clientFixtureApp;
                return { groupId: vm.localDescs.groupId, collaborationGroupId: vm._collaboration?.snapshot({ includeFiles: false })?.identity?.groupId };
            });
            assert.equal(warningScope.groupId, secondGroup.id, 'Version confirmation retains the current workspace until accepted');
            assert.ok(!warningScope.collaborationGroupId || warningScope.collaborationGroupId === secondGroup.id, 'The future group cannot synchronize current workspace text while confirmation is pending');
            await olderVersionWarning.getByRole('button', { name: 'Cancel', exact: true }).click();
            await page.waitForFunction(groupId => { const vm = window.__clientFixtureApp; return !vm.managedVersionBusy && !vm.workspaceInitializationActive && vm.activeContentGroup?.id === groupId && vm.localDescs.groupId === groupId; }, secondGroup.id);
            await page.waitForFunction(groupId => { const state = window.__clientFixtureApp._collaboration?.snapshot({ includeFiles: false }); return state?.roomId && state.identity?.groupId === groupId && !state.pending; }, secondGroup.id);
            await statTeam.getByRole('button', { name: 'Open editor', exact: true }).click();
            await olderVersionWarning.waitFor();
            await olderVersionWarning.getByRole('button', { name: 'Open editor', exact: true }).click();
            await page.waitForFunction(groupId => { const vm = window.__clientFixtureApp; if (vm.managedVisibleError) throw new Error(vm.managedVisibleError); return vm.activeContentGroup?.id === groupId && !vm.workspaceInitializationActive && !vm.versionChooserVisible; }, statGroup.id);
            await page.waitForFunction(() => { const collaboration = window.__clientFixtureApp._collaboration?.snapshot({ includeFiles: false }); return collaboration?.connected && !collaboration.pending; });
            await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
            assert.equal(await translation.inputValue(), 'Dégâts de feu du groupe', 'The previous version retains its independent accepted work');
            await page.getByRole('button', { name: 'Save & close', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.editorSessionActive && !window.__clientFixtureApp.editorSaving);
            results.push('Identical-original new SD version carries accepted work, then keeps later edits and cached reloads separate; confirmation cancellation restores the current group');
            await page.evaluate(async () => { const vm = window.__clientFixtureApp; await vm.waitForPendingSaves(); await vm._collaboration?.retry(); });
            await page.waitForFunction(() => !window.__clientFixtureApp._collaboration?.snapshot({ includeFiles: false }).pending);
            await context.setOffline(true);
            for (const [groupId, expected] of [[secondGroup.id, 'Dégâts de feu du nouveau groupe'], [statGroup.id, 'Dégâts de feu du groupe']]) {
                assert.equal(await page.evaluate(() => window.__clientFixtureApp.showVersionChooser()), true);
                assert.equal(await page.evaluate(async selectedGroupId => {
                    const vm = window.__clientFixtureApp, cached = vm.localVersions.find(version => version.groupId === selectedGroupId);
                    if (!cached) throw new Error('The exact group is missing from the cached version catalog.');
                    return vm.managedContinueLocalVersion(cached);
                }, groupId), true, 'Cached group activates with the browser fully offline');
                await page.waitForFunction(selectedGroupId => { const vm = window.__clientFixtureApp; return vm.activeContentGroup?.id === selectedGroupId && vm.localDescs.groupId === selectedGroupId && !vm.workspaceInitializationActive && !vm.versionChooserVisible; }, groupId);
                await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
                assert.equal(await translation.inputValue(), expected, 'Offline activation preserves the exact group translation');
                await page.locator('.editorActions').getByRole('button', { name: 'Close', exact: true }).click();
                await page.waitForFunction(() => !window.__clientFixtureApp.editorSessionActive);
            }
            await context.setOffline(false);
            results.push('Both identical-baseline SD groups activate from the real cached catalog with the browser offline and retain independent translations');
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.showVersionChooser()), true);
            await page.getByRole('button', { name: 'Identical-original StatDescription fixture', exact: true }).click();
            await details.getByRole('button', { name: 'Add content group', exact: true }).click();
            await upload.locator('input[type=file]').first().setInputFiles(files);
            await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '');
            await upload.getByRole('button', { name: 'Publish complete groups', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '');
            const gapAClientGroup = await page.evaluate(() => window.__clientFixtureApp.ctGroups.find(group => group.contentMode === 'clienttext' && group.language === 'French'));
            await details.locator('[data-content-group="' + gapAClientGroup.id + '"]').getByRole('button', { name: 'Open editor', exact: true }).click();
            await workspace.waitFor(); await page.waitForFunction(() => !window.__clientFixtureApp.ctBusy);
            await navigation.getByRole('button', { name: 'Normal', exact: true }).click(); await workspace.getByRole('button', { name: 'record', exact: true }).click();
            await workspace.getByRole('textbox', { name: 'Name', exact: true }).fill('En ligne avant omission');
            await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
            await page.waitForFunction(async () => { const vm = window.__clientFixtureApp; return !vm.ctBusy && !(await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length && Object.values(vm.ctSaved).some(record => record.serverRevision > 0 && Object.values(record.values).includes('En ligne avant omission')); });
            await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
            await page.getByRole('button', { name: 'Upload next version', exact: true }).click();
            await upload.locator('input[type=text]').fill('Gap version B: Thai only');
            await upload.locator('input[type=file]').first().setInputFiles({ name: 'Thai_PoE2.xlsm', mimeType: files[0].mimeType, buffer: normal });
            await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '');
            await upload.getByRole('button', { name: 'Publish complete groups', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '');
            const gapBVersionId = await page.evaluate(() => window.__clientFixtureApp.ctUploadVersion.id);
            assert.deepEqual(await page.evaluate(() => window.__clientFixtureApp.ctGroups.map(group => [group.contentMode, group.language])), [['clienttext', 'Thai']], 'Intermediate version omits French ClientText and StatDescription');
            const partialCatalog = apiOrigin + '/v1/versions?*';
            await page.route(partialCatalog, async route => {
                const response = await route.fetch(), body = await response.json();
                body.versions = body.versions.filter(version => version.id === gapBVersionId);
                await route.fulfill({ response, json: body });
            });
            await page.evaluate(() => window.__clientFixtureApp.refreshManagedVersions());
            assert.deepEqual(await page.evaluate(() => window.__clientFixtureApp.managedVersions.map(version => version.id)), [gapBVersionId], 'A limited cached catalog does not contain the matching previous version');
            await page.getByRole('button', { name: 'Upload next version', exact: true }).click();
            await upload.locator('input[type=text]').fill('Gap version C: matching content returns');
            const gapCNormalArchive = await JSZip.loadAsync(normal), gapCNormalSheet = await gapCNormalArchive.file('xl/worksheets/sheet1.xml').async('string');
            assert.match(gapCNormalSheet, />Sword</); gapCNormalArchive.file('xl/worksheets/sheet1.xml', gapCNormalSheet.replace('>Sword<', '>New Sword<'));
            const gapCNormalFile = { ...files[0], buffer: await gapCNormalArchive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) };
            await upload.locator('input[type=file]').first().setInputFiles([statFile, gapCNormalFile, files[1]]);
            await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '');
            const gapParents = await page.evaluate(() => window.__clientFixtureApp.ctPrepared.map(group => ({ contentMode: group.contentMode, parentGroupId: group.parentGroupId })));
            assert.equal(gapParents.find(group => group.contentMode === 'statdescription').parentGroupId, secondGroup.id, 'SD parent discovery skips a version without its content');
            assert.equal(gapParents.find(group => group.contentMode === 'clienttext').parentGroupId, gapAClientGroup.id, 'French parent discovery skips an optional-language-only version despite the limited catalog');
            await page.unroute(partialCatalog);
            await upload.getByRole('button', { name: 'Publish complete groups', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '');
            const gapCGroups = await page.evaluate(() => window.__clientFixtureApp.ctGroups.map(group => ({ id: group.id, contentMode: group.contentMode, language: group.language })));
            const gapCClient = gapCGroups.find(group => group.contentMode === 'clienttext'), gapCStat = gapCGroups.find(group => group.contentMode === 'statdescription');
            const gapAcceptedParents = database.prepare('SELECT result_group_id AS groupId, parent_group_id AS parentGroupId FROM content_uploads WHERE result_group_id IN (?,?)').all(gapCClient.id, gapCStat.id);
            assert.equal(gapAcceptedParents.find(group => group.groupId === gapCClient.id).parentGroupId, gapAClientGroup.id);
            assert.equal(gapAcceptedParents.find(group => group.groupId === gapCStat.id).parentGroupId, secondGroup.id);
            await details.locator('[data-content-group="' + gapCClient.id + '"]').getByRole('button', { name: 'Open editor', exact: true }).click();
            await workspace.waitFor(); await page.waitForFunction(() => !window.__clientFixtureApp.ctBusy);
            await navigation.getByRole('button', { name: 'Normal', exact: true }).click(); await workspace.getByRole('button', { name: 'record', exact: true }).click();
            assert.equal(await workspace.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'En ligne avant omission', 'Returning French content carries the latest matching accepted work');
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctCurrentUnit.fields.find(field => field.name === 'Name').source), 'New Sword');
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctStatus().outdated), true, 'Changed English retains carried target as Outdated');
            await workspace.getByRole('button', { name: /^history$/i }).click();
            const beforePreviousCompare = await page.evaluate(() => { const vm = window.__clientFixtureApp; return { groupId: vm.ctWorkspace.scope.groupId, unitId: vm.ctSelection, target: vm.ctValues[JSON.stringify(['Name', null])], draft: vm.ctDraftDirty, saved: JSON.stringify(vm.ctSaved[vm.ctSelection]) }; });
            await workspace.getByRole('button', { name: 'Compare previous version', exact: true }).click();
            const previousViewer = page.getByRole('dialog', { name: 'Compare · Normal · record', exact: true }); await previousViewer.waitFor();
            const previousName = previousViewer.locator('.ctHistoryDiffField').filter({ has: page.getByRole('heading', { name: 'Name', exact: true }) });
            assert.equal(await previousName.locator('.ctHistory-before .ctHistorySource').textContent(), 'Sword', 'Previous English comes from the verified matching ancestor');
            assert.equal(await previousName.locator('.ctHistory-after .ctHistorySource').textContent(), 'New Sword');
            assert.equal(await previousName.locator('.ctHistory-before .ctHistoryTarget').textContent(), 'En ligne avant omission', 'Previous comparison uses the exact accepted revision');
            assert.equal(await previousName.locator('.ctHistory-after .ctHistoryTarget').textContent(), 'En ligne avant omission');
            assert.ok(await previousName.locator('.ctHistory-after .ctHistorySource .diffInlineAdd').count() > 0, 'Changed English is highlighted');
            await previousViewer.getByRole('button', { name: 'Close history comparison', exact: true }).click();
            const afterPreviousCompare = await page.evaluate(() => { const vm = window.__clientFixtureApp; return { groupId: vm.ctWorkspace.scope.groupId, unitId: vm.ctSelection, target: vm.ctValues[JSON.stringify(['Name', null])], draft: vm.ctDraftDirty, saved: JSON.stringify(vm.ctSaved[vm.ctSelection]) }; });
            assert.deepEqual(afterPreviousCompare, beforePreviousCompare, 'Previous-version comparison does not activate or modify the previous/current workspace');
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctHistoryError), '');
            await workspace.getByRole('combobox', { name: 'Content group', exact: true }).selectOption(gapCStat.id);
            await page.waitForFunction(groupId => { const vm = window.__clientFixtureApp, state = vm._collaboration?.snapshot({ includeFiles: false }); return !vm.ctActive && vm.activeContentGroup?.id === groupId && !vm.workspaceInitializationActive && state?.connected && !state.pending; }, gapCStat.id);
            await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
            assert.equal(await translation.inputValue(), 'Dégâts de feu du nouveau groupe', 'Returning SD content carries the latest matching accepted work');
            await page.locator('.editorActions').getByRole('button', { name: 'Close', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.editorSessionActive);
            results.push('Matching CT/SD parent discovery crosses an omitted-content version and limited catalog; changed English retains carried work as Outdated with a verified previous-version comparison');
        }
        if (process.env.CLIENTTEXT_PRODUCTION_DIRECTORY) {
            const productionDirectory = resolve(process.env.CLIENTTEXT_PRODUCTION_DIRECTORY);
            const productionFiles = ['Thai_PoE2.xlsm', 'French_PoE2.xlsm', 'French_Gender_PoE2.xlsm'].map(name => ({ name, mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', buffer: readFileSync(join(productionDirectory, name)) }));
            if (await workspace.isVisible()) await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
            else if (!await page.getByRole('region', { name: 'Source versions' }).isVisible()) assert.equal(await page.evaluate(() => window.__clientFixtureApp.showVersionChooser()), true);
            await page.getByRole('button', { name: 'Import ClientText workbooks', exact: true }).click();
            await upload.locator('input[type=text]').fill('Production ClientText fixture');
            await upload.locator('input[type=file]').first().setInputFiles(productionFiles);
            await page.evaluate(() => {
                const sample = window.__productionTiming = { started: performance.now(), maxEventLoopLag: 0, ticks: 0 }, interval = 100;
                let expected = performance.now() + interval;
                window.__productionTimer = setInterval(() => { const now = performance.now(); sample.maxEventLoopLag = Math.max(sample.maxEventLoopLag, now - expected); sample.ticks++; expected = now + interval; }, interval);
                window.__ctProgressEvents = [];
            });
            const preparing = Date.now();
            console.log('Production fixture: preparing three workbooks.');
            await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading, null, { timeout: 300000 });
            const prepareMs = Date.now() - preparing;
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '', 'Production workbook preparation');
            assert.deepEqual(await page.evaluate(() => window.__clientFixtureApp.ctPrepared.map(group => [group.language, group.units.length]).sort()), [['French', 157909], ['Thai', 149550]]);
            const storing = Date.now();
            console.log('Production fixture: prepared in ' + prepareMs + 'ms; storing workspaces.');
            await upload.getByRole('button', { name: 'Store local workspaces', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading, null, { timeout: 300000 });
            const storeMs = Date.now() - storing;
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '', 'Production workbooks store locally');
            const timing = await page.evaluate(() => { clearInterval(window.__productionTimer); return window.__productionTiming; });
            const groups = [];
            console.log('Production fixture: stored in ' + storeMs + 'ms; opening workspaces.');
            for (const language of ['Thai', 'French']) {
                const opening = Date.now();
                await page.getByRole('button', { name: 'Production ClientText fixture · ClientText · ' + language, exact: true }).click();
                await workspace.waitFor(); await page.waitForFunction(() => !window.__clientFixtureApp.ctBusy, null, { timeout: 180000 });
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                const openMs = Date.now() - opening;
                const selected = await page.evaluate(() => {
                    const vm = window.__clientFixtureApp, unit = vm.ctUnits.find(unit => unit.role === 'normal' && unit.fields.some(field => field.kind === 'text' && field.target && !field.originalMissing && !field.outdated));
                    const field = unit.fields.find(field => field.kind === 'text' && field.target && !field.originalMissing && !field.outdated);
                    return { unitId: unit.id, recordId: unit.recordId, sheet: unit.sheet, fieldId: field.id, fieldName: field.name, target: field.target, source: field.source };
                });
                const interacting = Date.now();
                await navigation.getByRole('button', { name: 'All sheets', exact: true }).click();
                await workspace.getByRole('searchbox', { name: 'Search ClientText' }).fill(selected.recordId);
                await workspace.getByRole('searchbox', { name: 'Search ClientText' }).press('Enter');
                await page.waitForFunction(id => window.__clientFixtureApp.ctRows.some(unit => unit.id === id), selected.unitId);
                // Exact sheet/role selection disambiguates repeated record IDs across sheets.
                await navigation.getByRole('button', { name: selected.sheet, exact: true }).first().click();
                await workspace.getByRole('button', { name: selected.recordId, exact: true }).click();
                const input = workspace.getByRole('textbox', { name: selected.fieldName, exact: true });
                await input.fill(selected.target + ' [fixture]'); await input.press('F2');
                await page.waitForFunction(({ id, field }) => window.__clientFixtureApp.ctSaved[id]?.values[field]?.endsWith(' [fixture]'), { id: selected.unitId, field: selected.fieldId });
                const interactionMs = Date.now() - interacting;
                for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
                    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                    const bounds = await input.boundingBox(); assert.ok(bounds && bounds.width > 180 && bounds.x + bounds.width <= 1440);
                    await page.screenshot({ path: join(directory, 'production-' + language + '-' + theme + '.png'), fullPage: true });
                }
                let selectedGender = null;
                if (language === 'French') {
                    selectedGender = await page.evaluate(() => {
                        const unit = window.__clientFixtureApp.ctUnits.find(unit => unit.role === 'gender' && unit.fields.some(field => field.kind === 'form' && field.target.trim() && field.target.trim() !== 'NONEXISTENT' && !field.originalMissing && !field.outdated));
                        const field = unit.fields.find(field => field.kind === 'form' && field.target.trim() && field.target.trim() !== 'NONEXISTENT' && !field.originalMissing && !field.outdated);
                        return { unitId: unit.id, recordId: unit.recordId, sheet: unit.sheet, fieldId: field.id, fieldName: field.name + ' ' + field.form, target: field.target, source: field.source };
                    });
                    await workspace.getByRole('button', { name: 'Table', exact: true }).click();
                    await workspace.getByRole('searchbox', { name: 'Search ClientText' }).fill(selectedGender.recordId);
                    await workspace.getByRole('searchbox', { name: 'Search ClientText' }).press('Enter');
                    await navigation.getByRole('button', { name: selectedGender.sheet, exact: true }).click();
                    await workspace.getByRole('button', { name: selectedGender.recordId, exact: true }).click();
                    const input = workspace.getByRole('textbox', { name: selectedGender.fieldName, exact: true });
                    await input.fill(selectedGender.target + ' [fixture]'); await input.press('F2');
                    await page.waitForFunction(({ id, field }) => window.__clientFixtureApp.ctSaved[id]?.values[field]?.endsWith(' [fixture]'), { id: selectedGender.unitId, field: selectedGender.fieldId });
                    assert.equal(await workspace.locator('.ctFormGrid textarea').count(), 6, 'Production French six-form layout');
                    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
                        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                        await page.screenshot({ path: join(directory, 'production-French-gender-' + theme + '.png'), fullPage: true });
                    }
                }
                const exporting = Date.now(), event = page.waitForEvent('download', { timeout: 300000 });
                await workspace.getByRole('button', { name: 'Download workbooks', exact: true }).click();
                const exported = await event, exportedBytes = readFileSync(await exported.path()), exportMs = Date.now() - exporting;
                const outputs = language === 'Thai' ? new Map([['Thai_PoE2.xlsm', exportedBytes]]) : new Map(await Promise.all(['French_PoE2.xlsm', 'French_Gender_PoE2.xlsm'].map(async name => [name, await (await JSZip.loadAsync(exportedBytes)).file(name).async('uint8array')])));
                for (const [filename, output] of outputs) {
                    const role = filename.includes('_Gender_') ? 'gender' : 'normal', parsed = await Codec.parseWorkbook(output, { filename, role, language });
                    assert.equal(parsed.units.length, filename.startsWith('Thai') ? 149550 : role === 'normal' ? 89659 : 68250);
                    const edited = role === 'normal' ? selected : selectedGender;
                    if (edited) {
                        const field = parsed.units.find(unit => unit.id === edited.unitId).fields.find(field => field.id === edited.fieldId);
                        assert.equal(field.source, edited.source); assert.equal(field.target, edited.target + ' [fixture]'); assert.equal(field.originalFill, 'D9D2E9');
                    }
                    const original = await JSZip.loadAsync(productionFiles.find(file => file.name === filename).buffer), rebuilt = await JSZip.loadAsync(output);
                    const changedPart = edited ? parsed.sheets.find(sheet => sheet.name === edited.sheet).path : '';
                    for (const name of Object.keys(original.files).filter(name => !original.files[name].dir && name !== changedPart && name !== 'xl/styles.xml')) assert.deepEqual(await rebuilt.file(name).async('uint8array'), await original.file(name).async('uint8array'), filename + ':' + name);
                }
                groups.push({ language, openMs, interactionMs, exportMs });
                console.log('Production fixture: ' + JSON.stringify(groups.at(-1)));
                await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
            }
            assert.deepEqual(failures, [], 'Full production browser script errors');
            results.push({ production: true, prepareMs, storeMs, maxEventLoopLagMs: Math.round(timing.maxEventLoopLag), ticksWhilePreparing: timing.ticks, groups });
        }
        assert.deepEqual(failures, [], 'All normal-mode browser script errors');
        console.log(JSON.stringify({ status: 'PASS', normalMode: true, browser: executablePath, results }, null, 2));
    } catch (error) {
        const failedPage = browser?.contexts()[0]?.pages()[0];
        if (failedPage && !failedPage.isClosed()) {
            const state = await failedPage.evaluate(async scopes => {
                const vm = window.__clientFixtureApp;
                const workspaces = await Promise.all(scopes.map(async scope => {
                    const workspace = await OfflineStore.getVersionWorkspace(scope, 'French');
                    return { groupId: scope.groupId, workspaceGroupId: workspace?.groupId,
                        staged: workspace?.staged?.French?.['specific_skill_stat_descriptions/explosive_grenade/fire.txt'],
                        target: workspace?.descs?.find(file => file.filepath === 'specific_skill_stat_descriptions/explosive_grenade/fire.txt')?.translations?.French };
                }));
                return { ctError: vm?.ctError, uploadError: vm?.ctUploadError, managedError: vm?.managedVisibleError, activeGroup: vm?.activeContentGroup?.id,
                    sourceLoaded: vm?.sourceLoaded, sourceHash: vm?.sourceIdentity, initializing: vm?.workspaceInitializationActive, managedBusy: vm?.managedVersionBusy,
                    chooser: vm?.versionChooserVisible, editor: vm?.editorSessionActive, editorSaving: vm?.editorSaving,
                    collaboration: vm?._collaboration?.snapshot({ includeFiles: false }), requests: vm?.ctRequests?.map(request => request.payload?.kind), workspaces };
            }, isolationScopes).catch(() => null);
            console.error('Fixture failure state: ' + JSON.stringify(state));
            const { readPayload } = await load('payload-store.js');
            const accepted = database.prepare('SELECT r.content_group_id AS groupId, f.translations FROM collaboration_rooms r JOIN collaboration_files f ON f.room_id=r.id WHERE r.language=? AND f.filepath=?').all('French', statDescription.filepath)
                .map(row => ({ groupId: row.groupId, translations: readPayload(database, row.translations) }));
            if (isolationScopes.length) console.error('Fixture accepted synthetic SD work: ' + JSON.stringify(accepted));
        }
        throw error;
    } finally {
        await browser?.close(); await api.locals.versions.idle(); await api.locals.collaborationRealtime.close();
        await Promise.all([new Promise(resolve => apiServer.close(resolve)), new Promise(resolve => frontendServer.close(resolve))]);
        if (database.isOpen) database.close();
        const absolute = resolve(directory), expectedRoot = resolve(tmpdir()) + sep;
        if (!absolute.startsWith(expectedRoot) || !absolute.split(sep).pop().startsWith('sdeditor-clienttext-browser-')) throw new Error('Refusing cleanup outside fixture temporary directory.');
        if (process.env.KEEP_FIXTURE_ARTIFACTS === '1' || process.argv.includes('--keep')) console.log('Fixture artifacts: ' + absolute); else rmSync(absolute, { recursive: true, force: true });
    }
}
run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
