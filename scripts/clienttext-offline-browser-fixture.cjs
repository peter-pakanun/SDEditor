'use strict';
// Disposable normal-mode check. Fixture identity is injected locally; no API,
// production account, retained workbook, or downloaded browser is needed.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join } = require('node:path');
const { readFileSync, existsSync } = require('node:fs');
const { createServer } = require('node:http');
const Codec = require('../public/clientTextCodec.js');
const fromApi = createRequire(resolve(__dirname, '../../SDEditor-API/package.json'));
const express = require('express');
const JSZip = fromApi('jszip');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);
if (!executablePath) throw new Error('No installed Edge/Chrome found; set FIXTURE_BROWSER_PATH.');

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const VBA = Buffer.from([0, 255, 8, 99, 14, 0]);
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
const row = (number, values) => `<row r="${number}">${values.map((value, index) => cell(String.fromCharCode(65 + index) + number, value)).join('')}</row>`;
async function workbook(role = 'normal') {
    const zip = new JSZip();
    const rows = role === 'normal' ? [
        row(1, ['ID', 'Notes', 'Name', 'Translation', 'Gender', 'Description', 'Translation']),
        row(2, ['offline-test-record', 'Immutable developer note', 'Sword', '', 'M', 'Original description', 'Description originale']),
        row(3, ['offline-test-blank', 'Blank ClientText fields are legal', 'Shield', 'Original name', 'F', 'Other description', 'Autre description'])
    ] : [
        row(1, ['ID', 'Tags', 'Text', 'MS', 'FS', 'NS', 'MP', 'FP', 'NP']),
        row(2, ['offline-test-gender', 'weapon', 'Strong', 'Fort', 'Forte', '', '', '', 'NONEXISTENT'])
    ];
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>');
    zip.file('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${role === 'normal' ? 'Normal' : 'Words_Gender'}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>${rows.join('')}</sheetData></worksheet>`);
    zip.file('xl/styles.xml', `<styleSheet xmlns="${NS}"><fonts count="1"><font><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
    zip.file('xl/vbaProject.bin', VBA);
    zip.file('xl/metadata', Buffer.from([0, 77, 255, 16]));
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function monitor(page, enabled) {
    await page.evaluate(enabled => {
        window.__offlineTestMonitoring = enabled;
        if (enabled) {
            window.__offlineTestWrites = [];
            window.__offlineTestStorageWrites = [];
            window.__offlineTestRequests = [];
        }
    }, enabled);
}
async function assertLocal(page, label, exited = false) {
    const activity = await page.evaluate(() => ({
        indexedDb: window.__offlineTestWrites,
        browserStorage: window.__offlineTestStorageWrites,
        requests: window.__offlineTestRequests
    }));
    if (exited) activity.requests = activity.requests.filter(path => !/^\/v1\/comments\/unread\?game=poe2$/.test(path));
    assert.deepEqual(activity, { indexedDb: [], browserStorage: [], requests: [] }, label + ': the test session writes no durable data or cloud requests');
}
async function saved(page, unitId, fieldId, target) {
    await page.waitForFunction(({ unitId, fieldId, target }) => {
        const vm = window.__offlineTestApp;
        return !vm.ctBusy && vm.ctSaved[unitId]?.values[fieldId] === target;
    }, { unitId, fieldId, target });
    assert.equal(await page.evaluate(() => window.__offlineTestApp.ctError), '');
}
async function layout(page, surface, label, screenshot = false) {
    for (const width of [1440, 1100]) for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(async theme => {
            document.documentElement.dataset.theme = theme;
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, theme);
        const geometry = await surface.evaluate(element => {
            const box = target => { const rect = target.getBoundingClientRect(); return { x: rect.x, right: rect.right, width: rect.width, height: rect.height }; };
            return { viewport: innerWidth, body: document.documentElement.scrollWidth, outer: box(element),
                controls: [...element.querySelectorAll('input[type=file],textarea[data-ct-target],.ctEditorActionButtons button')]
                    .filter(control => control.getClientRects().length && getComputedStyle(control).visibility !== 'hidden').map(control => ({ name: control.getAttribute('data-ct-target') || control.textContent || control.type, ...box(control) })) };
        });
        assert.ok(geometry.outer.x >= -1 && geometry.outer.right <= width + 1, `${label} fits ${theme} at ${width}px: ${JSON.stringify(geometry.outer)}`);
        assert.ok(geometry.body <= width + 1, `${label} has no page overflow in ${theme} at ${width}px`);
        for (const control of geometry.controls) assert.ok(control.x >= -1 && control.right <= width + 1 && control.height >= 20,
            `${label} control fits ${theme} at ${width}px: ${JSON.stringify(control)}`);
        if (screenshot && width === 1440 && theme === 'modern-dark' && process.env.OFFLINE_FIXTURE_SCREENSHOT) await page.screenshot({ path: process.env.OFFLINE_FIXTURE_SCREENSHOT });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'modern-dark'; });
}

async function run() {
    const frontend = express(), server = createServer(frontend);
    frontend.use((request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
    frontend.get('/', (request, response) => response.type('html').send(readFileSync(join(__dirname, '../public/index.html'), 'utf8')
        .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
    frontend.get('/fixture/jszip.min.js', (request, response) => response.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
    frontend.get('/clientTextWorker.js', (request, response) => response.type('js').send(readFileSync(join(__dirname, '../public/clientTextWorker.js'), 'utf8')
        .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
    frontend.get('/index.js', (request, response) => response.type('js').send(readFileSync(join(__dirname, '../public/index.js'), 'utf8')
        .replace("app.mount('#app');", "window.__offlineTestApp = app.mount('#app');")));
    frontend.use(express.static(join(__dirname, '../public')));
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const normal = await workbook(), gender = await workbook('gender'), failures = [], results = [];
    let browser, page;
    try {
        browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, ignoreHTTPSErrors: true });
        // Monitoring is activated only after normal startup/fixture identity
        // initialization has settled. The real test path receives no stubs.
        await context.addInitScript(() => {
            window.__offlineTestMonitoring = false;
            const transaction = IDBDatabase.prototype.transaction;
            IDBDatabase.prototype.transaction = function (names, mode, ...rest) {
                const tx = transaction.call(this, names, mode, ...rest);
                if (window.__offlineTestMonitoring && mode === 'readwrite') {
                    tx.__offlineTestWriteRecord = { database: this.name, names: Array.from(typeof names === 'string' ? [names] : names), stack: new Error().stack, puts: [] };
                    window.__offlineTestWrites.push(tx.__offlineTestWriteRecord);
                }
                return tx;
            };
            const put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (value, ...rest) {
                this.transaction.__offlineTestWriteRecord?.puts.push({ store: this.name, key: value?.key, stack: new Error().stack });
                return put.call(this, value, ...rest);
            };
            for (const method of ['setItem', 'removeItem', 'clear']) {
                const original = Storage.prototype[method];
                Storage.prototype[method] = function (...args) {
                    if (window.__offlineTestMonitoring) window.__offlineTestStorageWrites.push({ method, key: args[0] || '' });
                    return original.apply(this, args);
                };
            }
        });
        page = await context.newPage();
        page.on('pageerror', error => failures.push(error.message));
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin === origin || !/\/auth\/|\/v1\//.test(url.pathname)) return route.continue();
            throw new Error('Fixture unexpectedly attempted an actual API request: ' + url.pathname);
        });
        async function bootstrap(role = 'manager') {
            await page.evaluate(() => window.OfflineStore?.updateHybridState?.(state => { state.auth = null; state.activeProfile = 'guest'; return state; }));
            await page.goto(origin);
            await page.waitForFunction(() => window.__offlineTestApp?.offlineStoreReady && window.__offlineTestApp?._cloud?.state && !window.__offlineTestApp.workspaceInitializationActive);
            await page.evaluate(async role => {
                const vm = window.__offlineTestApp;
                // Keep the actual cloud client for scope guards. Destroy its
                // scheduling and replace API transport; only empty catalog
                // lookups are allowed, and no network leaves this fixture.
                vm._cloud.destroy();
                vm._cloud.destroyed = false;
                vm._cloud.schedule = () => {};
                vm._cloud.refreshSession = async () => {};
                vm._cloud.sync = async () => {};
                clearInterval(vm._cloudPoll);
                vm._cloud.request = async path => {
                    if (String(path).startsWith('/v1/versions?')) return { versions: [], branch: { id: 'default' } };
                    if (window.__offlineTestMonitoring) window.__offlineTestRequests.push(String(path));
                    if (String(path).startsWith('/v1/comments/unread?')) return { total: 0, files: [] };
                    throw new Error('Offline test attempted cloud data request: ' + path);
                };
                const id = role === 'guest' ? 'guest' : 'fixture-' + role;
                const user = role === 'guest' ? null : { id, role, isAdmin: role === 'admin', language: role === 'translator' ? 'French' : null, assignmentVersion: 1 };
                vm._cloud.state = await OfflineStore.updateHybridState(state => {
                    if (role !== 'guest') {
                        state.profiles[id] = JSON.parse(JSON.stringify(state.profiles.guest));
                        state.profiles[id].settings.lang = 'French';
                    }
                    state.activeProfile = id;
                    state.auth = user ? { token: 'fixture-local-identity', user } : null;
                    return state;
                });
                await vm.cloudApply(vm._cloud.snapshot());
                vm.needsInitialSettings = false; vm.showSetting = false; vm.inlineEditor = false;
                await vm.saveSettings();
                await OfflineStore.setMigratedFromSingleVersion(true);
                await vm.activateGameVersion('poe2', { checkMigration: false });
                await vm.ctRefreshLocal();
                await vm.$nextTick();
            }, role);
            await page.getByRole('region', { name: 'Source versions' }).waitFor();
            // Scope changes may queue ordinary settings/account preparation;
            // complete those fixture tasks before measuring test activity.
            await page.waitForTimeout(500);
        }
        await bootstrap();
        assert.equal(await page.evaluate(() => typeof window.__offlineTestApp.ctOpenOfflineTest), 'function', 'Offline test integration is present');
        const offline = page.getByRole('region', { name: 'Offline workspace' });
        assert.equal(await offline.getByRole('button', { name: 'Test Sheet Offline', exact: true }).count(), 1, 'An unassigned Manager has an offline test button');
        const sentinel = { key: 'offline-clienttext-fixture-sentinel', value: { language: 'Thai', source: 'ordinary-persisted-work', values: ['Keep this translation'], marker: 42 } };
        await page.evaluate(async sentinel => {
            const db = await OfflineStore.openClientTextDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(['kv'], 'readwrite'); tx.objectStore('kv').put(sentinel);
                tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
            });
        }, sentinel);
        const originalRecords = await page.evaluate(async () => {
            const db = await OfflineStore.openClientTextDb(), names = Object.values(ClientTextStore.stores);
            return Promise.all(names.map(name => new Promise((resolve, reject) => {
                const request = db.transaction([name], 'readonly').objectStore(name).getAll();
                request.onsuccess = () => resolve({ name, records: request.result }); request.onerror = () => reject(request.error);
            })));
        });
        const upload = page.getByRole('region', { name: 'Content upload' });
        const workspace = page.getByRole('region', { name: 'ClientText workspace' });
        let layoutChecked = false;
        async function openTest(files) {
            await offline.getByRole('button', { name: 'Test Sheet Offline', exact: true }).click();
            await upload.getByRole('heading', { name: 'Test Sheet Offline', exact: true }).waitFor();
            assert.equal(await upload.locator('input[type=file]').first().getAttribute('accept'), '.xlsx,.xlsm');
            assert.equal(await upload.locator('.ctUploadPolicy').count(), 0, 'Offline tests offer no API policy edit');
            assert.equal(await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).count(), 0, 'Test sheets combine preparation and opening into one action');
            assert.equal(await upload.getByRole('button', { name: 'Open test sheet', exact: true }).count(), 0, 'The previous separate opening action is absent');
            if (!layoutChecked) await layout(page, upload, 'Offline workbook importer');
            await upload.locator('input[type=file]').first().setInputFiles(files);
            await upload.getByRole('button', { name: 'Open', exact: true }).click();
            await page.waitForFunction(() => {
                const vm = window.__offlineTestApp;
                return !vm.ctUploading && !vm.ctBusy && !vm.workspaceInitializationActive && (vm.ctActive || vm.ctUploadError);
            });
            assert.equal(await page.evaluate(() => window.__offlineTestApp.ctUploadError), '', 'One Open click prepares and validates the workbooks');
            assert.equal(await page.evaluate(() => window.__offlineTestApp.ctActive), true, 'Prepared test sheet opens successfully');
            await workspace.waitFor();
            await page.waitForFunction(() => window.__offlineTestApp.ctActive && !window.__offlineTestApp.ctBusy && !window.__offlineTestApp.workspaceInitializationActive);
            assert.equal(await page.evaluate(() => window.__offlineTestApp.ctError), '');
            assert.equal(await page.evaluate(() => window.__offlineTestApp.ctOfflineTest), true);
            assert.match(await workspace.textContent(), /In-memory test/);
            assert.equal(await page.evaluate(() => window.__offlineTestApp.lang), 'French', 'Opening a test preserves the selected language');
        }
        await monitor(page, true);
        // A French Normal workbook alone is allowed here even though a
        // published French content group normally requires its Gender pair.
        await openTest([{ name: 'French.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', buffer: normal }]);
        await layout(page, workspace, 'Offline ClientText list');
        const unit = await page.evaluate(() => {
            const unit = window.__offlineTestApp.ctUnits.find(unit => unit.recordId === 'offline-test-record');
            return { id: unit.id, field: unit.fields.find(field => field.name === 'Name').id };
        });
        await workspace.getByRole('button', { name: 'offline-test-record', exact: true }).click();
        const translation = workspace.locator('.ctFullEditor textarea[data-ct-target]').first();
        await layout(page, workspace.locator('.ctFullEditor'), 'Offline ClientText full editor', true);
        layoutChecked = true;
        await translation.fill('Épée offline');
        await workspace.getByRole('button', { name: 'Save', exact: true }).click();
        await saved(page, unit.id, unit.field, 'Épée offline');
        await translation.fill('Épée offline final');
        await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
        await saved(page, unit.id, unit.field, 'Épée offline final');
        await page.waitForFunction(() => !window.__offlineTestApp.ctEditor);
        await workspace.getByRole('button', { name: 'offline-test-record', exact: true }).click();
        await workspace.locator('.ctTools').getByRole('button', { name: /History$/ }).click();
        await page.waitForFunction(() => !window.__offlineTestApp.ctHistoryLoading && window.__offlineTestApp.ctHistory.length >= 2);
        assert.equal(await page.evaluate(() => window.__offlineTestApp.ctHistoryError), '');
        assert.ok(await page.evaluate(({ id, field }) => window.__offlineTestApp.ctHistory.some(entry => entry.unitId === id && entry.after.values[field] === 'Épée offline final'), unit), 'Saved edits retain local in-memory history');
        await workspace.getByRole('button', { name: 'Close', exact: true }).click();
        await page.evaluate(() => window.__offlineTestApp.ctShowAllLoaded());
        const blankUnit = await page.evaluate(() => {
            const unit = window.__offlineTestApp.ctUnits.find(unit => unit.recordId === 'offline-test-blank');
            return { id: unit.id, field: unit.fields.find(field => field.name === 'Name').id };
        });
        await workspace.getByRole('button', { name: 'offline-test-blank', exact: true }).click();
        await translation.fill('');
        await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
        await saved(page, blankUnit.id, blankUnit.field, '');
        const downloaded = page.waitForEvent('download');
        await workspace.getByRole('button', { name: 'Download workbooks', exact: true }).click();
        await page.waitForFunction(() => !window.__offlineTestApp.ctBusy);
        assert.equal(await page.evaluate(() => window.__offlineTestApp.ctError), '', 'Export succeeds');
        const download = await downloaded;
        assert.equal(download.suggestedFilename(), 'French.xlsm');
        const output = readFileSync(await download.path()), exportedZip = await JSZip.loadAsync(output);
        assert.deepEqual(await exportedZip.file('xl/vbaProject.bin').async('nodebuffer'), VBA, 'XLSM export preserves VBA bytes');
        const exported = await Codec.parseWorkbook(output, { filename: 'French.xlsm', role: 'normal' });
        assert.equal(exported.units.find(unit => unit.recordId === 'offline-test-record').fields.find(field => field.name === 'Name').target, 'Épée offline final');
        assert.equal(exported.units.find(unit => unit.recordId === 'offline-test-blank').fields.find(field => field.name === 'Name').target, '');
        await assertLocal(page, 'Prepare/open/edit/history/save/export');
        results.push('Manager Normal-only XLSM: in-memory edit, Save, Save & close, history, blank save and byte-preserving export');
        await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
        await offline.waitFor();
        assert.deepEqual(await page.evaluate(() => ({ active: window.__offlineTestApp.ctActive, workspace: window.__offlineTestApp.ctWorkspace, units: window.__offlineTestApp.ctUnits.length, stores: window.__offlineTestApp._ctTestStores?.size || 0 })),
            { active: false, workspace: null, units: 0, stores: 0 }, 'Versions discards the whole temporary workspace');
        await assertLocal(page, 'Leaving the test', true);
        await monitor(page, false);
        const retained = await page.evaluate(async () => {
            const db = await OfflineStore.openClientTextDb();
            const get = name => new Promise((resolve, reject) => {
                const request = db.transaction([name], 'readonly').objectStore(name).getAll();
                request.onsuccess = () => resolve({ name, records: request.result }); request.onerror = () => reject(request.error);
            });
            const records = await Promise.all(Object.values(ClientTextStore.stores).map(get));
            const sentinel = await new Promise((resolve, reject) => {
                const request = db.transaction(['kv'], 'readonly').objectStore('kv').get('offline-clienttext-fixture-sentinel');
                request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            return { records, sentinel };
        });
        assert.deepEqual(retained.records, originalRecords, 'Ordinary persisted ClientText records remain untouched');
        assert.deepEqual(retained.sentinel, sentinel, 'Ordinary persisted SD workspace sentinel remains untouched');
        await page.evaluate(() => OfflineStore.updateHybridState(state => { state.auth = null; state.activeProfile = 'guest'; return state; }));
        await page.reload();
        await page.waitForFunction(() => window.__offlineTestApp?.offlineStoreReady && !window.__offlineTestApp.workspaceInitializationActive);
        assert.deepEqual(await page.evaluate(() => ({ active: window.__offlineTestApp.ctActive, workspace: window.__offlineTestApp.ctWorkspace, test: window.__offlineTestApp.ctOfflineTest })),
            { active: false, workspace: null, test: false }, 'Reload never restores an in-memory test');
        results.push('Versions discards the test; reload restores no test and existing persisted data is unchanged');
        await bootstrap('guest');
        assert.equal(await offline.getByRole('button', { name: 'Test Sheet Offline', exact: true }).count(), 1, 'Guests have an offline test button');
        await page.evaluate(async () => { await window.__offlineTestApp.ctOpenOfflineTest(); });
        assert.equal(await page.evaluate(() => window.__offlineTestApp.ctUploadVisible), true, 'Guests can open the local test importer');
        await page.evaluate(() => window.__offlineTestApp.ctCloseUpload());
        await monitor(page, true);
        await openTest([{ name: 'French.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', buffer: normal }]);
        await assertLocal(page, 'Guest ClientText testing');
        await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
        await offline.waitFor();
        await assertLocal(page, 'Leaving guest test', true);
        await monitor(page, false);
        await bootstrap('translator');
        assert.equal(await offline.getByRole('button', { name: 'Test Sheet Offline', exact: true }).count(), 1, 'Translators have an offline test button');
        await page.evaluate(async () => { await window.__offlineTestApp.ctOpenOfflineTest(); });
        assert.equal(await page.evaluate(() => window.__offlineTestApp.ctUploadVisible), true, 'Direct invocation is available to Translators');
        await bootstrap('admin');
        assert.equal(await offline.getByRole('button', { name: 'Test Sheet Offline', exact: true }).count(), 1, 'Admin has an offline test button');
        await monitor(page, true);
        await openTest([{ name: 'Thai.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', buffer: normal }]);
        assert.equal(await page.evaluate(() => window.__offlineTestApp.lang), 'French', 'A different test team never changes account language settings');
        assert.equal(await page.evaluate(() => window.__offlineTestApp.ctWorkspace.scope.language), 'Thai');
        assert.equal(await workspace.getByRole('columnheader', { name: 'Thai translation', exact: true }).count(), 1, 'Test table uses the workbook team language');
        await assertLocal(page, 'Admin testing a different language');
        await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
        await offline.waitFor();
        await assertLocal(page, 'Leaving different-language test', true);
        await monitor(page, true);
        await openTest([{ name: 'French_Gender.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', buffer: gender }]);
        assert.equal(await page.evaluate(() => window.__offlineTestApp.ctUnits.every(unit => unit.role === 'gender')), true, 'Gender-only tests use the explicitly selected role');
        await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
        await offline.waitFor();
        await assertLocal(page, 'Admin Gender-only session', true);
        await monitor(page, false);
        results.push('Manager, Admin, Translator, and Guest access is local-only; Gender-only tests remain local');
        results.push('Different test language preserves account language; importer, list and full editor fit all four themes at 1440px and 1100px');
        for (const version of [null, { id: 'fixture-normal-version', name: 'Existing fixture version' }]) {
            // Inspect the ordinary importer without beginning a publication or
            // invoking its API policy/preparation actions.
            await page.evaluate(version => {
                const vm = window.__offlineTestApp;
                vm.ctUploadTest = false; vm.ctUploadLocal = false; vm.ctUploadVersion = version; vm.ctUploadVisible = true;
            }, version);
            await upload.waitFor();
            assert.equal(await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).isVisible(), true, 'Ordinary new-version/Add Content importers retain preparation');
            assert.equal(await upload.getByRole('button', { name: 'Publish complete groups', exact: true }).isVisible(), true, 'Ordinary new-version/Add Content importers retain separate publication');
            assert.equal(await upload.getByRole('button', { name: 'Open', exact: true }).count(), 0, 'The combined Open button is test-only');
        }
        results.push('Ordinary New Version and Add Content retain separate Prepare and validate/Publish complete groups actions');
        assert.deepEqual(failures, [], 'No browser runtime errors');
        console.log(JSON.stringify({ ok: true, results }, null, 2));
    } catch (error) {
        if (page && !page.isClosed()) console.error('Offline fixture state:', JSON.stringify(await page.evaluate(() => {
            const vm = window.__offlineTestApp;
            return { active: vm?.ctActive, test: vm?.ctOfflineTest, workspace: vm?.ctWorkspace?.scope,
                uploadVisible: vm?.ctUploadVisible, uploadError: vm?.ctUploadError, error: vm?.ctError,
                busy: vm?.ctBusy, uploading: vm?.ctUploading, units: vm?.ctUnits?.length,
                chooser: vm?.versionChooserVisible, stores: vm?._ctTestStores?.size,
                writes: window.__offlineTestWrites, storageWrites: window.__offlineTestStorageWrites,
                requests: window.__offlineTestRequests };
        }).catch(() => null), null, 2));
        console.error('Browser errors:', failures);
        throw error;
    } finally {
        if (browser) await browser.close();
        await new Promise(done => server.close(done));
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
