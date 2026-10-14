'use strict';
// Disposable normal-mode check. Fixture identity is injected locally; no API,
// production account or downloaded browser is needed. --npc-real-workbooks
// additionally verifies supplied Thai and French/French_Gender files.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join } = require('node:path');
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
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
const realNpcWorkbooks = process.argv.includes('--npc-real-workbooks') || process.argv.includes('--convo-real-workbooks');
const realHistoryWorkbooks = process.argv.includes('--history-real-workbooks');
const realWorkbookFolder = process.env.CLIENTTEXT_NPC_WORKBOOK_FOLDER || 'C:/Users/lpeac/Downloads/2026-10-13_POE2';
const screenshotFolder = process.env.CLIENTTEXT_NPC_SCREENSHOT_FOLDER || 'C:/Users/lpeac/.codex/visualizations/2026/10/14/01a1388c-f446-7330-ab32-353def01f2d9';
const disposableFolder = resolve(__dirname, '../temp/clienttext-npc-offline-fixture');
const vueScriptPath=process.env.FIXTURE_VUE_PATH || resolve(__dirname,'../temp/clienttext-fixture-vue.min.js');
const checksum = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const VBA = Buffer.from([0, 255, 8, 99, 14, 0]);
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
const row = (number, values) => `<row r="${number}">${values.map((value, index) => cell(String.fromCharCode(65 + index) + number, value)).join('')}</row>`;
async function workbook(role = 'normal', sampleVersion = '') {
    const zip = new JSZip();
    const rows = role === 'normal' ? [
        row(1, ['ID', 'Notes', 'Name', 'Translation', 'Gender', 'Description', 'Translation']),
        row(2, ['offline-test-record', 'Immutable developer note', 'Sword', '', 'M', 'Original description', 'Description originale']),
        row(3, ['offline-test-blank', 'Blank ClientText fields are legal', 'Shield', 'Original name', 'F', 'Other description', 'Autre description'])
    ] : [
        row(1, ['ID', 'Tags', 'Text', 'MS', 'FS', 'NS', 'MP', 'FP', 'NP']),
        row(2, ['offline-test-gender', 'weapon', 'Strong', 'Fort', 'Forte', '', '', '', 'NONEXISTENT'])
    ];
    if (role === 'normal' && sampleVersion) {
        const previous = sampleVersion === 'previous';
        rows.push(row(4, ['version-changed', previous ? 'Previous note' : 'Current note', previous ? 'Previous English' : 'Current English', previous ? 'Ancienne traduction' : 'Traduction actuelle', 'M', '', '']),
            row(5, ['version-noaudio', '', previous ? 'Marker dialogue' : '[NOAUDIO] Marker dialogue', 'Dialogue traduit', 'M', '', '']),
            row(6, ['version-audiotest', '', previous ? '[OLD AUDIO] Test dialogue' : '[AUDIOTEST] Test dialogue', 'Dialogue test', 'M', '', '']));
        if (!previous) for (const index of [3,4,5]) rows[index] = rows[index].replace(/<c r="D(\d+)"/, '<c s="1" r="D$1"');
    }
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>');
    const sheets = [{ name: role === 'normal' ? 'Normal' : 'Words_Gender', rows }];
    if (role === 'normal') sheets.push(
        { name: 'NPCs', rows: [row(1, ['ID', 'Name', 'Translation', 'Short Name', 'Translation']),
            row(2, ['Metadata/NPC/Renly', 'Renly', 'Renly traduit', 'Renly', 'Renly court']),
            row(3, ['Metadata/NPC/Una', 'Una', 'Una traduite', 'Una', 'Una courte']),
            row(4, ['Metadata/NPC/Doryani', 'Doryani', 'Doryani traduit', 'Doryani', 'Doryani court'])] },
        { name: 'NPCTalk', rows: [row(1, ['ID', 'Text', 'Translation']),
            row(2, ['Metadata/NPC/Renly::0', 'A conversation with Renly', 'Conversation avec Renly']),
            row(3, ['Metadata/NPC/Doryani::0', 'Introduction', 'Introduction'])] },
        { name: 'NPCTextAudio', rows: [row(1, ['ID', 'Text', 'Translation']),
            row(2, ['RenlyIntro', 'Welcome, friend.', 'Bienvenue, ami.']),
            row(3, ['UnaRenly', 'Have you spoken with Renly?', 'Avez-vous parlé à Renly ?']),
            row(4, ['UnarmedStart', 'Unarmed dialogue unrelated to Una.', 'Sans armes.'])] },
        { name: 'NPCTalkDialogueTextAudio', rows: [row(1, ['ID', 'Text', 'Translation', 'Character']),
            row(2, ['RenlyIntro', 'Player reply addressing Renly.', 'Réponse du joueur.', 'Metadata/Characters/Str/StrFourb']),
            row(3, ['HuntressRenlyReply', 'Renly, can you help?', 'Renly, pouvez-vous aider ?', 'Metadata/Characters/Dex/DexFourb']),
            row(4, ['UnknownReply', 'A reply without an NPC ID match.', 'Réponse sans association.', 'Metadata/Characters/Int/IntFour']),
            row(5, ['DoryaniA4_Intro_A1_Str4b', 'Doryani introduces the expedition.', '', 'Metadata/Characters/Str/StrFourb']),
            row(6, ['DoryaniA4_Intro_A2_Dex4', 'A player asks Doryani about the expedition.', 'Question au sujet de l’expédition.', 'Metadata/Characters/Dex/DexFour']),
            row(7, ['DoryaniA4_Quest_A1_Str4b', 'Doryani discusses a different quest.', 'Une autre quête.', 'Metadata/Characters/Str/StrFourb'])] }
    );
    else sheets.push({ name: 'NPCTextAudio_Gender', rows: [row(1, ['ID', 'Text', 'MS', 'FS', 'NS', 'MP', 'FP', 'NP']),
        row(2, ['RenlyGenderReply', 'Renly-related grammatical variants.', 'Variante Renly', 'Variante Renly', '', '', '', 'NONEXISTENT'])] });
    zip.file('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`);
    for (const [index, sheet] of sheets.entries()) zip.file(`xl/worksheets/sheet${index + 1}.xml`, `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>${sheet.rows.join('')}</sheetData></worksheet>`);
    zip.file('xl/styles.xml', `<styleSheet xmlns="${NS}"><fonts count="1"><font><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF9966"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="1" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
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
        .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')
        .replace('https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js',existsSync(vueScriptPath)?'/fixture/vue.global.prod.js':'https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js')));
    frontend.get('/fixture/vue.global.prod.js',(request,response)=>response.type('js').send(readFileSync(vueScriptPath)));
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
        async function bootstrap(role = 'manager', selectedLanguage = 'French') {
            await page.evaluate(() => window.OfflineStore?.updateHybridState?.(state => { state.auth = null; state.activeProfile = 'guest'; return state; }));
            await page.goto(origin);
            await page.waitForFunction(() => window.__offlineTestApp?.offlineStoreReady && window.__offlineTestApp?._cloud?.state && !window.__offlineTestApp.workspaceInitializationActive);
            await page.evaluate(async ({ role, selectedLanguage }) => {
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
                clearInterval(vm._managedTimer);
                clearInterval(vm._commentsPollTimer);
                clearTimeout(vm._commentsReadTimer);
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
                        state.profiles[id].settings.lang = selectedLanguage;
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
            }, { role, selectedLanguage });
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
        async function openTest(files, previousNames = []) {
            const selectedLanguage = await page.evaluate(() => window.__offlineTestApp.lang);
            await offline.getByRole('button', { name: 'Test Sheet Offline', exact: true }).click();
            await upload.getByRole('heading', { name: 'Test Sheet Offline', exact: true }).waitFor();
            assert.equal(await upload.locator('input[type=file]').first().getAttribute('accept'), '.xlsx,.xlsm');
            assert.equal(await upload.locator('.ctUploadPolicy').count(), 0, 'Offline tests offer no API policy edit');
            assert.equal(await upload.getByRole('button', { name: 'Prepare and validate', exact: true }).count(), 0, 'Test sheets combine preparation and opening into one action');
            assert.equal(await upload.getByRole('button', { name: 'Open test sheet', exact: true }).count(), 0, 'The previous separate opening action is absent');
            if (!layoutChecked) await layout(page, upload, 'Offline workbook importer');
            if(previousNames.length){
                await upload.locator('input[type=file]').first().setInputFiles(files.slice(0,1));
                await upload.locator('input[type=file]').first().setInputFiles(files.slice(1));
                assert.equal(await upload.locator('.ctUploadFiles tbody tr').count(),files.length,'Successive file choices retain both versions');
            }else await upload.locator('input[type=file]').first().setInputFiles(files);
            for (const name of previousNames) await upload.getByRole('combobox', { name: 'Version for ' + name, exact: true }).selectOption('previous');
            if(previousNames.length)await layout(page,upload,'Previous/current workbook selection');
            await upload.getByRole('button', { name: 'Open', exact: true }).click();
            await page.waitForFunction(() => {
                const vm = window.__offlineTestApp;
                return !vm.ctUploading && !vm.ctBusy && !vm.workspaceInitializationActive && (vm.ctActive || vm.ctUploadError);
            }, null, { timeout: realNpcWorkbooks || realHistoryWorkbooks ? 180000 : 30000 });
            assert.equal(await page.evaluate(() => window.__offlineTestApp.ctUploadError), '', 'One Open click prepares and validates the workbooks');
            assert.equal(await page.evaluate(() => window.__offlineTestApp.ctActive), true, 'Prepared test sheet opens successfully');
            await workspace.waitFor();
            await page.waitForFunction(() => window.__offlineTestApp.ctActive && !window.__offlineTestApp.ctBusy && !window.__offlineTestApp.workspaceInitializationActive);
            assert.equal(await page.evaluate(() => window.__offlineTestApp.ctError), '');
            assert.equal(await page.evaluate(() => window.__offlineTestApp.ctOfflineTest), true);
            assert.match(await workspace.textContent(), /In-memory test/);
            assert.equal(await page.evaluate(() => window.__offlineTestApp.lang), selectedLanguage, 'Opening a test preserves the selected language');
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
        await workspace.locator('.ctFullEditor .ctTarget').first().getByRole('button',{name:'Comparison options and revision history'}).click();
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
        async function browseRenly(label) {
            const sheetsTab = workspace.getByRole('tab', { name: 'Sheets', exact: true });
            const npcsTab = workspace.getByRole('tab', { name: 'NPCs', exact: true });
            const before = await page.evaluate(() => {
                const vm = window.__offlineTestApp;
                return { ids: vm.ctUnits.map(unit => unit.id), counts: vm.ctCounts, sheet: vm.ctSheet,
                    search: vm.ctSearch, applied: vm.ctAppliedSearch, filters: vm.ctSelectedFilters.slice(), page: vm.ctPage };
            });
            await sheetsTab.focus(); await sheetsTab.press('ArrowRight');
            assert.equal(await npcsTab.evaluate(element => element === document.activeElement), true, label + ': arrow key focuses NPCs');
            await npcsTab.press('Enter');
            await page.waitForFunction(() => window.__offlineTestApp.ctBrowseMode === 'npcs' && !window.__offlineTestApp.ctBrowseBusy);
            assert.equal(await npcsTab.getAttribute('aria-selected'), 'true');
            assert.ok(await page.evaluate(() => window.__offlineTestApp.ctSelectedFilters.includes('unchanged')), label + ': NPCs initially includes Unchanged');
            const npcFilter = workspace.getByRole('searchbox', { name: 'Filter NPCs', exact: true });
            await npcFilter.fill(' Renly ');
            const npc = workspace.getByRole('button', { name: 'Renly', exact: true });
            assert.equal(await npc.count(), 1, label + ': the NPC filter resolves one shared name group');
            await npc.click();
            await page.waitForFunction(() => window.__offlineTestApp.ctNpcBrowseTitle === 'Renly' && !window.__offlineTestApp.ctBrowseBusy);
            const related = await page.evaluate(() => {
                const vm = window.__offlineTestApp;
                return { ids: vm.ctUnits.map(unit => unit.id), counts: vm.ctCounts,
                    related: vm.ctRows.map(unit => ({ id: unit.id, recordId: unit.recordId, role: unit.role, sheet: unit.sheet })), total: vm.ctNpcTotal };
            });
            assert.deepEqual(related.ids, before.ids, label + ': browsing preserves immutable unit identities');
            assert.deepEqual(related.counts, before.counts, label + ': NPC counts never replace workspace progress');
            assert.equal(new Set(related.related.map(unit => unit.id)).size, related.related.length, label + ': original units appear once');
            for (const sheet of ['NPCs', 'NPCTalk', 'NPCTextAudio', 'NPCTalkDialogueTextAudio']) assert.ok(related.related.some(unit => unit.sheet.replace(/_Gender$/, '') === sheet), label + ': Renly spans ' + sheet);
            assert.equal(related.related.length, related.total, label + ': all statuses expose the complete related worklist');
            await npcFilter.press('Escape');
            await layout(page, workspace, label + ' NPC worklist');
            await sheetsTab.click();
            await page.waitForFunction(() => window.__offlineTestApp.ctBrowseMode === 'sheets' && !window.__offlineTestApp.ctBrowseBusy);
            assert.deepEqual(await page.evaluate(() => {
                const vm = window.__offlineTestApp;
                return { sheet: vm.ctSheet, search: vm.ctSearch, applied: vm.ctAppliedSearch, filters: vm.ctSelectedFilters.slice(), page: vm.ctPage };
            }), { sheet: before.sheet, search: before.search, applied: before.applied, filters: before.filters, page: before.page }, label + ': Sheets restores independent browsing state');
            await npcsTab.click();
            await page.waitForFunction(() => window.__offlineTestApp.ctBrowseMode === 'npcs' && !window.__offlineTestApp.ctBrowseBusy);
            assert.equal(await page.evaluate(() => window.__offlineTestApp.ctNpcBrowseTitle), 'Renly', label + ': NPC selection survives tab switching');
            return related.related;
        }
        async function browseConvoFamily(label, stem, expectedUnits) {
            const before = await page.evaluate(() => {
                const vm = window.__offlineTestApp;
                return { mode: vm.ctBrowseMode, snapshot: vm.ctBrowseSnapshot(), counts: vm.ctCounts, ids: vm.ctUnits.map(unit => unit.id) };
            });
            await workspace.getByRole('tab', { name: 'Convo', exact: true }).click();
            await page.waitForFunction(() => window.__offlineTestApp.ctBrowseMode === 'convo' && !window.__offlineTestApp.ctBrowseBusy);
            const allConversations = await page.evaluate(() => {
                const vm = window.__offlineTestApp;
                return { families: vm._ctConvoIndex.families.length, units: vm.ctRows.length, total: vm.ctConvoTotal,
                    ids: vm.ctUnits.map(unit => unit.id), counts: vm.ctCounts, scans: vm.ctScanDone };
            });
            assert.deepEqual(allConversations.ids, before.ids, label + ': Convo preserves immutable workbook units');
            assert.deepEqual(allConversations.counts, before.counts, label + ': Convo counts remain separate from workspace totals');
            assert.equal(allConversations.units, allConversations.total, label + ': All conversations initially includes every status');
            assert.equal(allConversations.scans, false, label + ': browsing does not run optional diagnostic scans');
            const info = await page.evaluate(stem => {
                const vm = window.__offlineTestApp, family = vm._ctConvoIndex.familyByKey.get(stem), parent = vm._ctConvoIndex.parentByKey.get(family.parentKey);
                return { familyKey: family.key, familyLabel: family.label, parentKey: parent.key, parentLabel: parent.label,
                    units: family.units.map(unit => ({ id: unit.id, role: unit.role, sheet: unit.sheet, recordId: unit.recordId })),
                    rowKey: JSON.stringify(['family', family.key]), parentRowKey: JSON.stringify(['parent', parent.key]) };
            }, stem);
            assert.equal(info.units.length, expectedUnits, label + ': exact stem has the expected original unit count');
            const tree = workspace.getByRole('tree', { name: 'Conversations', exact: true });
            const parent = tree.getByRole('treeitem', { name: info.parentLabel, exact: true });
            await parent.focus(); await parent.press('ArrowRight');
            await page.waitForFunction(key => window.__offlineTestApp.ctConvoExpanded.includes(key), info.parentKey);
            assert.equal(await parent.getAttribute('aria-expanded'), 'true', label + ': ArrowRight expands the parent');
            const childSelector = await page.evaluate(key => '[data-convo-key="' + CSS.escape(key) + '"]', info.rowKey);
            const child = tree.locator(childSelector);
            await child.focus(); await child.press('Enter');
            await page.waitForFunction(key => window.__offlineTestApp.ctConvoSelection === key && !window.__offlineTestApp.ctBrowseBusy, info.rowKey);
            assert.equal(await child.getAttribute('aria-selected'), 'true', label + ': Enter selects the family');
            assert.deepEqual(await page.evaluate(() => window.__offlineTestApp.ctRows.map(unit => unit.id).sort()), info.units.map(unit => unit.id).sort(), label + ': family selection contains exact original units');
            assert.ok(info.units.every(unit => unit.sheet.replace(/_Gender$/, '') === 'NPCTalkDialogueTextAudio'), label + ': Convo excludes names, menu topics and standalone dialogue');
            const expanded = await page.evaluate(() => window.__offlineTestApp.ctConvoExpanded.slice());
            await workspace.getByRole('tab', { name: before.mode === 'npcs' ? 'NPCs' : 'Sheets', exact: true }).click();
            await page.waitForFunction(mode => window.__offlineTestApp.ctBrowseMode === mode && !window.__offlineTestApp.ctBrowseBusy, before.mode);
            assert.deepEqual(await page.evaluate(() => window.__offlineTestApp.ctBrowseSnapshot()), before.snapshot, label + ': previous tab retains its independent navigation/search/filter state');
            await workspace.getByRole('tab', { name: 'Convo', exact: true }).click();
            await page.waitForFunction(() => window.__offlineTestApp.ctBrowseMode === 'convo' && !window.__offlineTestApp.ctBrowseBusy);
            assert.equal(await page.evaluate(() => window.__offlineTestApp.ctConvoSelection), info.rowKey, label + ': family selection survives tabs');
            assert.deepEqual(await page.evaluate(() => window.__offlineTestApp.ctConvoExpanded), expanded, label + ': expansion survives tabs');
            return { ...info, allConversations };
        }
        const syntheticRelated = await browseRenly('Synthetic offline NPCs');
        assert.equal(syntheticRelated.filter(unit => unit.recordId === 'RenlyIntro').length, 2, 'Identical audio IDs retain their two distinct sheets');
        const orderedNpcIds = await page.evaluate(() => window.__offlineTestApp.ctRows.map(unit => unit.id));
        await workspace.locator('.ctTable tbody tr').first().locator('.ctID').click();
        await workspace.locator('.ctFullEditor').waitFor();
        await workspace.getByRole('button', { name: 'Next', exact: true }).click();
        await page.waitForFunction(id => window.__offlineTestApp.ctSelection === id && !window.__offlineTestApp.ctBusy, orderedNpcIds[1]);
        await workspace.getByRole('button', { name: 'Previous', exact: true }).click();
        await page.waitForFunction(id => window.__offlineTestApp.ctSelection === id && !window.__offlineTestApp.ctBusy, orderedNpcIds[0]);
        await workspace.getByRole('button', { name: 'Close', exact: true }).click();
        await assertLocal(page, 'NPC full-editor cross-sheet Next/Previous');
        await monitor(page, false);
        await page.evaluate(async () => { const vm = window.__offlineTestApp; vm.inlineEditor = true; await vm.$nextTick(); await vm.saveSettings(); });
        await monitor(page, true);
        const inlineTargets = workspace.locator('.ctListWorkspace textarea[data-ct-target]');
        await inlineTargets.last().focus(); await inlineTargets.last().press('Tab');
        await page.waitForFunction(id => window.__offlineTestApp.ctSelection === id && !window.__offlineTestApp.ctBusy, orderedNpcIds[1]);
        assert.equal(await inlineTargets.first().evaluate(element => element === document.activeElement), true, 'Tab enters the first target of the next original sheet record');
        await inlineTargets.first().press('Shift+Tab');
        await page.waitForFunction(id => window.__offlineTestApp.ctSelection === id && !window.__offlineTestApp.ctBusy, orderedNpcIds[0]);
        assert.equal(await inlineTargets.last().evaluate(element => element === document.activeElement), true, 'Shift+Tab returns to the exact preceding worksheet target');
        await assertLocal(page, 'NPC inline cross-sheet Tab/Shift+Tab');
        await monitor(page, false);
        await page.evaluate(async () => { const vm = window.__offlineTestApp; vm.inlineEditor = false; await vm.$nextTick(); await vm.saveSettings(); });
        await monitor(page, true);
        const kinds = workspace.getByRole('group', { name: 'NPC text types' });
        await kinds.getByRole('button', { name: /^Conversations/ }).click();
        await page.waitForFunction(() => !window.__offlineTestApp.ctBrowseBusy && window.__offlineTestApp.ctRows.every(unit => unit.sheet === 'NPCTalkDialogueTextAudio'));
        const conversation = await page.evaluate(() => {
            const unit = window.__offlineTestApp.ctRows.find(unit => unit.recordId === 'RenlyIntro');
            return { id: unit.id, field: unit.fields[0].id };
        });
        await workspace.getByRole('button', { name: 'RenlyIntro', exact: true }).click();
        await translation.fill('Réponse Renly enregistrée');
        await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
        await saved(page, conversation.id, conversation.field, 'Réponse Renly enregistrée');
        await page.waitForFunction(() => !window.__offlineTestApp.ctEditor);
        await kinds.getByRole('button', { name: /^All text/ }).click();
        await workspace.getByRole('button', { name: 'Unassigned dialogue', exact: true }).click();
        await page.waitForFunction(() => window.__offlineTestApp.ctNpcSelection === 'unassigned' && !window.__offlineTestApp.ctBrowseBusy);
        assert.deepEqual(await page.evaluate(() => window.__offlineTestApp.ctRows.map(unit => unit.recordId).sort()), ['UnarmedStart', 'UnknownReply'], 'Unassigned dialogue excludes false Una prefix matches');
        await workspace.getByRole('button', { name: 'All NPC text', exact: true }).click();
        await page.waitForFunction(() => window.__offlineTestApp.ctNpcSelection === 'all' && !window.__offlineTestApp.ctBrowseBusy);
        assert.equal(await page.evaluate(() => window.__offlineTestApp.ctRows.length), 14, 'All NPC text contains every recognized unit exactly once');
        await assertLocal(page, 'Synthetic NPC browsing and cross-sheet save');
        results.push('NPC tabs, keyboard focus, independent Sheets state, four-sheet Renly group, distinct IDs, kind filtering and temporary cross-sheet save');
        const syntheticConvo = await browseConvoFamily('Synthetic Convo', 'DoryaniA4_Intro', 2);
        assert.equal(await page.evaluate(key => window.__offlineTestApp.ctConvoSeverities.get(key), syntheticConvo.parentRowKey), 'error', 'Missing turn text marks its family and NPC parent actionable');
        assert.equal(syntheticConvo.allConversations.families, 5, 'Conversation families strip turn/class suffixes while preserving unrelated stems');
        assert.equal(syntheticConvo.allConversations.units, 6, 'All conversations includes only original conversation-turn units');
        const convoFilter = workspace.getByRole('searchbox', { name: 'Filter conversations', exact: true });
        await convoFilter.fill('DORYANI');
        assert.equal(await workspace.getByRole('tree', { name: 'Conversations' }).getByRole('treeitem', { name: 'Doryani', exact: true }).count(), 1, 'Tree search matches immutable NPC names case-insensitively');
        await workspace.getByRole('searchbox', { name: 'Search ClientText', exact: true }).fill('player asks');
        await page.waitForFunction(() => window.__offlineTestApp.ctRows.length === 1);
        assert.equal(await page.evaluate(() => window.__offlineTestApp.ctRows[0].recordId), 'DoryaniA4_Intro_A2_Dex4', 'Row search intersects the selected conversation family');
        await workspace.getByRole('tab', { name: 'NPCs', exact: true }).click();
        await page.waitForFunction(() => window.__offlineTestApp.ctBrowseMode === 'npcs' && !window.__offlineTestApp.ctBrowseBusy);
        assert.equal(await workspace.getByRole('searchbox', { name: 'Search ClientText', exact: true }).inputValue(), '', 'Convo row search does not leak into NPC browsing');
        await workspace.getByRole('tab', { name: 'Convo', exact: true }).click();
        await page.waitForFunction(() => window.__offlineTestApp.ctBrowseMode === 'convo' && !window.__offlineTestApp.ctBrowseBusy);
        assert.equal(await convoFilter.inputValue(), 'DORYANI');
        assert.equal(await workspace.getByRole('searchbox', { name: 'Search ClientText', exact: true }).inputValue(), 'player asks', 'Convo restores its independent row and tree search');
        await workspace.getByRole('searchbox', { name: 'Search ClientText', exact: true }).press('Escape');
        await page.waitForFunction(() => window.__offlineTestApp.ctRows.length === 2);
        const convoEntry = await page.evaluate(() => {
            const unit = window.__offlineTestApp.ctRows.find(unit => unit.recordId === 'DoryaniA4_Intro_A1_Str4b');
            return { id: unit.id, field: unit.fields[0].id };
        });
        await workspace.getByRole('button', { name: 'DoryaniA4_Intro_A1_Str4b', exact: true }).click();
        await translation.fill('Présentation de Doryani enregistrée');
        await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
        await saved(page, convoEntry.id, convoEntry.field, 'Présentation de Doryani enregistrée');
        await page.waitForFunction(() => !window.__offlineTestApp.ctEditor);
        assert.equal(await page.evaluate(key => window.__offlineTestApp.ctConvoSeverities.get(key), syntheticConvo.parentRowKey), '', 'A complete temporary save resolves the parent Missing severity');
        await assertLocal(page, 'Synthetic conversation tree/search/edit');
        results.push('Convo exact families, dedicated turn counts, keyboard expansion/select, independent searches/tabs and temporary save with reactive severity');
        await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
        await offline.waitFor();
        assert.deepEqual(await page.evaluate(() => ({ active: window.__offlineTestApp.ctActive, workspace: window.__offlineTestApp.ctWorkspace, units: window.__offlineTestApp.ctUnits.length, stores: window.__offlineTestApp._ctTestStores?.size || 0 })),
            { active: false, workspace: null, units: 0, stores: 0 }, 'Versions discards the whole temporary workspace');
        await assertLocal(page, 'Leaving the test', true);
        async function checkVersionHistory(files, previousNames, label) {
            // Establish the real editor preference before measuring the test
            // session; changing a personal setting itself is durable work.
            await monitor(page,false);
            await page.evaluate(async()=>{const vm=window.__offlineTestApp;vm.inlineEditor=true;await vm.saveSettings();});
            await page.waitForTimeout(500);await monitor(page,true);
            await openTest(files, previousNames);
            const sample = await page.evaluate(async () => {
                const vm = window.__offlineTestApp, store = vm.ctStorage(vm.ctWorkspace.scope),
                    previousScope = (await store.getMetadata(vm.ctWorkspace.scope)).previousScope,
                    reviewed = vm.ctUnits.flatMap(unit => unit.fields.filter(field => vm.ctSaved[unit.id]?.reviewed?.[field.id]).map(field => ({ id: unit.id, source: field.source, outdated: vm.ctStatus(unit).fields[field.id].outdated }))),
                    imported = Object.values(vm.ctSaved).filter(record => record.provenance?.origin === 'version_import');
                let changed;
                for(const unit of vm.ctUnits.filter(unit=>vm.ctSaved[unit.id]?.outdated?.length)){
                    const old=await store.getUnit(previousScope,unit.id);
                    if(unit.fields.some(field=>vm.ctSaved[unit.id].outdated.includes(field.id) && old.fields.some(before=>before.id===field.id && before.source.trim()
                        && ClientTextState.canonicalSource(before.source)!==ClientTextState.canonicalSource(field.source)))){changed=unit;break;}
                }
                return { id: changed?.id, recordId: changed?.recordId, source: changed?.fields.find(field => vm.ctSaved[changed.id].outdated.includes(field.id))?.source,
                    reviewed, noaudioReviewed:reviewed.filter(field=>field.source.includes('[NOAUDIO]') && !field.outdated).length, imported: imported.length, saved: vm.ctCounts.saved };
            });
            assert.ok(sample.id, label + ': changed dialogue is Outdated');
            assert.equal(sample.saved, 0, label + ': source-only imports do not count as Saved');
            assert.ok(sample.reviewed.some(field => /\[(?:NOAUDIO|AUDIOTEST|OLD AUDIO|NO AUDIO)\]/.test(field.source) && !field.outdated), label + ': real parsed marker-only changes satisfy source review');
            assert.ok(sample.noaudioReviewed>0,label+': NOAUDIO-only changes resolve orange source review');
            await workspace.getByRole('button', { name: 'All sheets', exact: true }).click();
            await workspace.getByRole('searchbox', { name: 'Search ClientText', exact: true }).fill(sample.recordId);
            await workspace.getByRole('button', { name: sample.recordId, exact: true }).click();
            assert.equal(await workspace.locator('.ctTools').getByRole('button', { name: /History$/ }).count(),0,'ClientText has no History sidebar tab');
            await page.waitForFunction(() => !window.__offlineTestApp.ctHistoryLoading && window.__offlineTestApp.ctHistory.length);
            await page.waitForFunction(()=>!window.__offlineTestApp.ctComparisonBusy && window.__offlineTestApp.ctComparisonVersions.length>0);
            const editor=workspace.locator('.ctFullEditor'),sourceDiff=editor.locator('.ctSourceDiff').first();await sourceDiff.waitFor();
            const comparison = await page.evaluate(() => {
                const vm = window.__offlineTestApp,old=vm.ctComparisonVersions[0].snapshot.unit,latest=vm.ctCurrentUnit;
                return { error: vm.ctComparisonError, rows:latest.fields.map(field=>({beforeSource:old.fields.find(value=>value.id===field.id)?.source || '',afterSource:field.source})),
                    previous:old.id,current:latest.id };
            });
            assert.equal(comparison.error, '');assert.equal(comparison.previous, sample.id);assert.equal(comparison.current, sample.id);
            assert.ok(comparison.rows.some(row => row.beforeSource !== row.afterSource), label + ': actual previous English differs from current');
            const sourceKey=await sourceDiff.evaluate(field=>field.closest('.ctSourceBlock').dataset.sourceField),source=editor.locator('.ctSourceBlock[data-source-field='+JSON.stringify(sourceKey)+']');
            assert.deepEqual(await source.locator('.editorFieldToolbar').evaluate(bar=>({last:bar.lastElementChild.classList.contains('fieldDiffButton'),separator:bar.lastElementChild.previousElementSibling.getAttribute('role'),insideField:!!bar.closest('.editorFieldFrame')})),
                {last:true,separator:'separator',insideField:true},'Diff toggle is the final toolbar item inside the field');
            assert.equal(await source.locator('.editorFieldComparisonControls').evaluate(controls=>!controls.closest('.editorFieldFrame') && controls.getBoundingClientRect().top>=controls.parentElement.querySelector('.editorFieldFrame').getBoundingClientRect().bottom),true,'Comparison selector sits underneath the field');
            assert.equal(await source.getByRole('button',{name:'Bold',exact:true}).isDisabled(),true,'Source has matching disabled style controls');
            await source.getByRole('button',{name:'Comparison options and revision history'}).click();
            await source.getByRole('checkbox', { name: 'Show whitespace', exact: true }).check();
            await source.getByRole('checkbox', { name: 'Character differences', exact: true }).check();
            await source.getByRole('button',{name:'Close revision menu'}).press('Escape');
            assert.equal(await source.locator('.fieldHistoryMenu').count(),0);
            const target=editor.locator('.ctTarget').first(),draft=target.locator('[data-ct-target]');
            await draft.fill('Selected\nsecond line');await draft.press('Control+a');await draft.press('Control+b');
            assert.equal(await draft.inputValue(),'<b>{Selected\nsecond line}');await draft.press('Control+z');assert.equal(await draft.inputValue(),'Selected\nsecond line');
            await draft.press('Control+a');await target.getByRole('button',{name:'Italic',exact:true}).click();assert.equal(await draft.inputValue(),'<i>{Selected\nsecond line}');
            await target.getByRole('button',{name:'Compare translation',exact:true}).click();assert.equal(await target.locator('.ctTranslationDiff').count(),1);
            await draft.fill('Live draft comparison');
            assert.equal(await target.locator('.ctTranslationDiff').evaluate(diff=>[...diff.querySelectorAll('span')].filter(span=>!span.classList.contains('diffInlineDel')).map(span=>span.textContent).join('')),'Live·draft·comparison');
            const inputNode=await draft.evaluate(input=>{input.__fieldIdentity=42;return input.dataset.ctTarget;});
            await source.getByRole('button',{name:'Compare English source',exact:true}).click();
            await page.evaluate(()=>window.__offlineTestApp.ctAutoOpenComparisons());assert.equal(await source.locator('.ctSourceDiff').count(),0,'Manual closure survives refresh');
            assert.equal(await draft.evaluate(input=>input.__fieldIdentity),42,'Toggling source diff retains translation input');
            await source.getByRole('button',{name:'Compare English source',exact:true}).click();
            await layout(page, editor, label + ' previous-version inline diff');
            mkdirSync(disposableFolder, { recursive: true });
            await editor.screenshot({ path: join(disposableFolder, 'history-' + (label === 'Synthetic' ? 'synthetic' : 'real') + '.png') });
            assert.equal(await workspace.getByRole('button', { name: 'Close', exact: true }).isVisible(), true);
            await workspace.getByRole('button', { name: 'Close', exact: true }).click();
            const row=workspace.locator('tr[data-unit-id='+JSON.stringify(sample.id)+']');await row.click();
            await row.locator('[data-ct-target]').first().waitFor();await layout(page,row,label+' inline row toolbar');
            assert.equal(await row.locator('.ctTranslationDiff').count(),1,'Inline/full transition retains the translation comparison');
            await row.locator('[data-ct-target]').first().press('Control+Enter');await editor.waitFor();
            assert.equal(await editor.locator('[data-ct-target]').first().inputValue(),'Live draft comparison','Field toolbar transitions retain the exact draft');
            await workspace.getByRole('button', { name: 'Close', exact: true }).click();
            await workspace.getByRole('button', { name: 'Versions', exact: true }).click();await offline.waitFor();
            await assertLocal(page, label + ' previous version history', true);
            results.push({ name: label + ' previous/current workbook comparison', imported: sample.imported, reviewedMarkerFields: sample.reviewed.length,noaudioReviewedFields:sample.noaudioReviewed,
                oldEnglish: comparison.rows.find(row => row.beforeSource.trim() && row.beforeSource !== row.afterSource)?.beforeSource,
                currentEnglish: comparison.rows.find(row => row.beforeSource.trim() && row.beforeSource !== row.afterSource)?.afterSource });
        }
        await checkVersionHistory([
            { name: 'French_previous.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', buffer: await workbook('normal', 'previous') },
            { name: 'French_current.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', buffer: await workbook('normal', 'current') }
        ], ['French_previous.xlsm'], 'Synthetic');
        if (realHistoryWorkbooks) {
            const previousPath = process.env.CLIENTTEXT_HISTORY_PREVIOUS || 'C:/Users/lpeac/Downloads/2026-10-05_POE2/French_PoE2.xlsm',
                currentPath = process.env.CLIENTTEXT_HISTORY_CURRENT || 'C:/Users/lpeac/Downloads/2026-10-13_POE2/French.xlsx',
                beforeHashes = [previousPath, currentPath].map(checksum);
            await checkVersionHistory([previousPath, currentPath], [require('node:path').basename(previousPath)], 'Real French');
            assert.deepEqual([previousPath, currentPath].map(checksum), beforeHashes, 'Real source workbooks remain byte-for-byte unchanged');
        }
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
        if (realNpcWorkbooks) {
            mkdirSync(disposableFolder, { recursive: true });
            mkdirSync(screenshotFolder, { recursive: true });
            const filenames = ['Thai.xlsx', 'French.xlsx', 'French_Gender.xlsx'];
            const originalHashes = Object.fromEntries(filenames.map(filename => [filename, checksum(join(realWorkbookFolder, filename))]));
            for (const [language, files] of [['Thai', ['Thai.xlsx']], ['French', ['French.xlsx', 'French_Gender.xlsx']]]) {
                console.log('Validating supplied ' + language + ' workbooks through Test Sheet Offline…');
                await bootstrap('admin', language);
                assert.equal(await page.evaluate(() => window.__offlineTestApp.cloudStorageError), '', 'Fixture profile language is established before entering the test');
                const preparationStarted = Date.now();
                await monitor(page, true);
                await openTest(files.map(filename => join(realWorkbookFolder, filename)));
                const preparationMs = Date.now() - preparationStarted;
                const related = await browseRenly(language + ' supplied workbook');
                if (language === 'French') assert.ok(related.some(unit => unit.role === 'gender'), 'Normal/Gender pair shares the complete NPC index');
                assert.equal(await workspace.getByRole('note').filter({ hasText: /Saves are temporary/ }).count(), 1, 'Real workbook screenshots retain the genuine temporary-save notice');
                if (language === 'Thai') {
                    await workspace.getByRole('searchbox', { name: 'Filter NPCs', exact: true }).fill('Renly');
                    await workspace.getByRole('button', { name: 'Renly', exact: true }).click();
                    await page.waitForFunction(() => !window.__offlineTestApp.ctBrowseBusy);
                    await page.mouse.move(1, 1);
                    await workspace.getByRole('searchbox', { name: 'Filter NPCs', exact: true }).focus();
                    await page.waitForTimeout(100);
                    await page.screenshot({ path: join(screenshotFolder, 'npc-browse-renly.png') });
                }
                await kinds.getByRole('button', { name: /^Conversations/ }).click();
                await page.waitForFunction(() => !window.__offlineTestApp.ctBrowseBusy && window.__offlineTestApp.ctRows.length > 0);
                let entry = await page.evaluate(async () => {
                    const vm = window.__offlineTestApp;
                    const unit = vm.ctRows.find(unit => unit.recordId === 'RenlyP1_Intro_A2_Str4b' && unit.role === 'normal')
                        || vm.ctRows.find(unit => unit.role === 'normal') || vm.ctRows[0];
                    const field = unit.fields.find(field => field.kind !== 'gender');
                    const index = vm.ctRows.findIndex(candidate => candidate.id === unit.id);
                    vm.ctSetPage(Math.floor(index / vm.ctEffectivePageSize) + 1);
                    await vm.$nextTick();
                    return { id: unit.id, role: unit.role, recordId: unit.recordId, field: field.id, sheet: unit.sheet, source: field.source, target: field.target,
                        row: vm.ctPageRows.findIndex(candidate => candidate.id === unit.id) };
                });
                await workspace.locator('.ctTable tbody tr').nth(entry.row).getByRole('button', { name: entry.recordId, exact: true }).click();
                await translation.waitFor();
                assert.ok((await workspace.locator('.editorFileIdentity').textContent()).includes(entry.role + ' / ' + entry.sheet + ' / ' + entry.recordId), 'Conversation editor retains the exact workbook identity');
                entry.field = await translation.getAttribute('data-ct-target');
                Object.assign(entry, await page.evaluate(fieldId => {
                    const field = window.__offlineTestApp.ctCurrentUnit.fields.find(field => field.id === fieldId);
                    return { source: field.source, target: field.target };
                }, entry.field));
                await layout(page, workspace.locator('.ctFullEditor'), language + ' supplied conversation editor');
                if (language === 'Thai') await page.screenshot({ path: join(screenshotFolder, 'npc-conversation-renly.png') });
                await workspace.getByRole('button', { name: 'Close', exact: true }).click();
                await page.waitForFunction(() => !window.__offlineTestApp.ctEditor);
                const ailithConvo = await browseConvoFamily(language + ' lowercase numbered turns', 'Ailith_MonasteryFirstInteract', 103);
                const numberedTurns = await page.evaluate(() => {
                    const vm = window.__offlineTestApp, index = vm._ctConvoIndex;
                    const conversationUnits = vm.ctUnits.filter(unit => unit.sheet.replace(/_Gender$/, '') === 'NPCTalkDialogueTextAudio');
                    const ailith = conversationUnits.filter(unit => unit.recordId.startsWith('Ailith_MonasteryFirstInteract_'));
                    const lower = ailith.filter(unit => /_(?:i1|i2)(?:_|=|$)/.test(unit.recordId));
                    const elder = conversationUnits.filter(unit => unit.recordId === 'ElderMadox_DeliCraft_i1');
                    const identity = unit => ({ id: unit.id, role: unit.role, sheet: unit.sheet, recordId: unit.recordId,
                        family: index.memberships.get(unit.id)?.familyKey });
                    return { ailith: ailith.map(identity), lower: lower.map(identity), elder: elder.map(identity),
                        displayedIds: vm.ctRows.map(unit => unit.id) };
                });
                assert.equal(numberedTurns.ailith.length, 103, language + ': all original Ailith turns and nested responses share one family');
                assert.equal(numberedTurns.lower.length, 12, language + ': numbered lowercase i1/i2 variants join their existing Ailith family');
                assert.ok(numberedTurns.lower.some(unit => unit.recordId === 'Ailith_MonasteryFirstInteract_i1_Dex4'), language + ': the reported i1_Dex4 record remains present exactly');
                assert.ok(numberedTurns.lower.some(unit => unit.recordId === 'Ailith_MonasteryFirstInteract_i1_StrDex4b_a1'), language + ': the nested lowercase a1 response remains present exactly');
                assert.ok(numberedTurns.lower.some(unit => unit.recordId === 'Ailith_MonasteryFirstInteract_i2=DexInt4b'), language + ': the conditional lowercase i2 turn remains present exactly');
                for (const unit of numberedTurns.ailith) {
                    assert.equal(unit.family, 'Ailith_MonasteryFirstInteract', language + ': unchanged original Ailith ID retains its family: ' + unit.recordId);
                    assert.equal(unit.id, JSON.stringify([unit.role, unit.sheet, unit.recordId]), language + ': grouping preserves the full workbook/sheet/record identity');
                }
                assert.deepEqual(numberedTurns.displayedIds.slice().sort(), numberedTurns.ailith.map(unit => unit.id).sort(), language + ': the selected Convo family displays all 103 exact original units');
                assert.ok(numberedTurns.elder.length > 0, language + ': the original ElderMadox lowercase numbered turn exists');
                for (const unit of numberedTurns.elder) assert.equal(unit.family, 'ElderMadox_DeliCraft', language + ': ElderMadox_DeliCraft_i1 retains the surrounding conversation family');
                const conversationFilter = workspace.getByRole('searchbox', { name: 'Filter conversations', exact: true });
                await conversationFilter.fill('Ailith');
                const ailithSelector = await page.evaluate(key => '[data-convo-key="' + CSS.escape(key) + '"]', ailithConvo.rowKey);
                await workspace.getByRole('tree', { name: 'Conversations', exact: true }).locator(ailithSelector).click();
                await page.waitForFunction(key => window.__offlineTestApp.ctConvoSelection === key && !window.__offlineTestApp.ctBrowseBusy, ailithConvo.rowKey);
                assert.equal(await page.evaluate(() => window.__offlineTestApp.ctRows.length), 103, language + ': filtered tree selection includes lowercase variants and nested responses');
                results.push(language + ': Ailith tree selection contains 103 unchanged original units, including 12 numbered lowercase turns and nested replies; ElderMadox i1 joins its original family');
                await conversationFilter.press('Escape');
                await workspace.getByRole('button', { name: 'All conversations', exact: true }).click();
                await page.waitForFunction(() => window.__offlineTestApp.ctConvoSelection === 'all' && !window.__offlineTestApp.ctBrowseBusy);
                await workspace.getByRole('tab', { name: 'NPCs', exact: true }).click();
                await page.waitForFunction(() => window.__offlineTestApp.ctBrowseMode === 'npcs' && !window.__offlineTestApp.ctBrowseBusy);
                const realConvo = await browseConvoFamily(language + ' supplied Convo', 'DoryaniA4_Intro', 25);
                assert.equal(realConvo.allConversations.families, 1106, language + ' supplied workbook exposes all 1,106 conversation families');
                assert.equal(realConvo.allConversations.units, 11717, language + ' supplied workbook exposes all 11,717 conversation turns');
                await workspace.getByRole('searchbox', { name: 'Filter conversations', exact: true }).fill('Doryani');
                await layout(page, workspace, language + ' supplied Convo worklist');
                if (language === 'Thai') {
                    const selectedFamily = await page.evaluate(key => '[data-convo-key="' + CSS.escape(key) + '"]', realConvo.rowKey);
                    await workspace.getByRole('tree', { name: 'Conversations', exact: true }).locator(selectedFamily).scrollIntoViewIfNeeded();
                    await page.mouse.move(1, 1);
                    await workspace.getByRole('searchbox', { name: 'Filter conversations', exact: true }).focus();
                    await page.waitForTimeout(100);
                    await page.screenshot({ path: join(screenshotFolder, 'convo-browse-doryani.png') });
                }
                entry = await page.evaluate(() => {
                    const vm = window.__offlineTestApp, unit = vm.ctPageRows[0], field = unit.fields.find(field => field.kind !== 'gender');
                    return { id: unit.id, role: unit.role, recordId: unit.recordId, field: field.id, sheet: unit.sheet,
                        source: field.source, target: field.target, row: 0 };
                });
                await workspace.locator('.ctTable tbody tr').nth(entry.row).getByRole('button', { name: entry.recordId, exact: true }).click();
                await translation.waitFor();
                entry.field = await translation.getAttribute('data-ct-target');
                Object.assign(entry, await page.evaluate(fieldId => {
                    const field = window.__offlineTestApp.ctCurrentUnit.fields.find(field => field.id === fieldId);
                    return { source: field.source, target: field.target };
                }, entry.field));
                assert.equal(await workspace.locator('.ctFullEditor .ctConvoRelation').textContent(), 'ID match', 'Convo editor retains explicit ID association context');
                if (language === 'Thai') {
                    await page.mouse.move(1, 1);
                    await page.screenshot({ path: join(screenshotFolder, 'convo-editor-doryani.png') });
                }
                const target = entry.target + ' [offline fixture saved edit]';
                await translation.fill(target);
                await workspace.getByRole('button', { name: 'Save', exact: true }).click();
                await saved(page, entry.id, entry.field, target);
                await workspace.locator('.ctFullEditor .ctTarget').first().getByRole('button',{name:'Comparison options and revision history'}).click();
                await page.waitForFunction(({ id, field, target }) => {
                    const vm = window.__offlineTestApp;
                    return !vm.ctHistoryLoading && vm.ctHistory.some(entry => entry.unitId === id && entry.after.values[field] === target);
                }, { id: entry.id, field: entry.field, target });
                await workspace.getByRole('button', { name: 'Close', exact: true }).click();
                await page.waitForFunction(() => !window.__offlineTestApp.ctEditor);
                const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
                await workspace.getByRole('button', { name: 'Download workbooks', exact: true }).click();
                await page.waitForFunction(() => !window.__offlineTestApp.ctBusy, null, { timeout: 180000 });
                assert.equal(await page.evaluate(() => window.__offlineTestApp.ctError), '', 'Real supplied workbook export succeeds');
                const download = await downloadPromise;
                const outputPath = join(disposableFolder, language + '-' + download.suggestedFilename());
                await download.saveAs(outputPath);
                const downloadedBytes = readFileSync(outputPath);
                const envelope = files.length > 1 ? await JSZip.loadAsync(downloadedBytes) : null;
                for (const filename of files) {
                    const exportedBytes = envelope ? await envelope.file(filename).async('nodebuffer') : downloadedBytes;
                    const role = filename.includes('_Gender') ? 'gender' : 'normal';
                    if (role !== entry.role) assert.deepEqual(exportedBytes, readFileSync(join(realWorkbookFolder, filename)), 'Untouched paired ' + role + ' workbook preserves exact original bytes');
                    else {
                        const parsed = await Codec.parseWorkbook(exportedBytes, { filename, role });
                        const unit = parsed.units.find(unit => unit.id === entry.id);
                        assert.equal(unit.fields.find(field => field.id === entry.field).target, target, 'Downloaded workbook contains the temporary saved translation');
                        assert.equal(unit.fields.find(field => field.id === entry.field).source, entry.source, 'Downloaded workbook preserves immutable English');
                        const originalZip = await JSZip.loadAsync(readFileSync(join(realWorkbookFolder, filename))), exportedZip = await JSZip.loadAsync(exportedBytes);
                        assert.deepEqual(Object.keys(exportedZip.files).sort(), Object.keys(originalZip.files).sort(), 'Export preserves native workbook parts');
                        const changedSheet = parsed.sheets.find(sheet => sheet.name === entry.sheet).path;
                        for (const [path, part] of Object.entries(originalZip.files)) if (!part.dir && path !== changedSheet && path !== 'xl/styles.xml') {
                            assert.deepEqual(await exportedZip.file(path).async('nodebuffer'), await part.async('nodebuffer'), 'Export retains original native part ' + path);
                        }
                    }
                }
                // Keep monitoring across at least one normal 20s polling
                // interval; long preparation must not accidentally hide an
                // unisolated timer behind a fast synthetic workbook.
                await page.waitForTimeout(Math.max(0, 21000 - (Date.now() - preparationStarted)));
                await assertLocal(page, language + ' real NPC/Convo browsing/save/history/export');
                await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
                await offline.waitFor();
                assert.deepEqual(await page.evaluate(() => ({ active: window.__offlineTestApp.ctActive, units: window.__offlineTestApp.ctUnits.length,
                    groups: window.__offlineTestApp.ctNpcGroups.length, conversations: window.__offlineTestApp.ctConvoParents.length })),
                    { active: false, units: 0, groups: 0, conversations: 0 }, 'Leaving real workbooks clears derived NPC/Convo and in-memory translation data');
                await assertLocal(page, language + ' real session exit', true);
                await monitor(page, false);
                // Verify disappearance through a real reload, then re-establish
                // only the fixture account before the next independent import.
                await page.evaluate(() => OfflineStore.updateHybridState(state => { state.auth = null; state.activeProfile = 'guest'; return state; }));
                await page.reload();
                await page.waitForFunction(() => window.__offlineTestApp?.offlineStoreReady && !window.__offlineTestApp.workspaceInitializationActive);
                assert.equal(await page.evaluate(() => window.__offlineTestApp.ctActive), false, 'Reload cannot restore supplied in-memory workbooks');
                await bootstrap('admin');
                results.push({ name: language + ' real import: NPC/Convo grouping, original cross-sheet identity, temporary save/history, native workbook export, no durable/cloud activity and exit/reload cleanup', preparationMs });
            }
            for (const filename of filenames) assert.equal(checksum(join(realWorkbookFolder, filename)), originalHashes[filename], 'Supplied ' + filename + ' checksum remains unchanged');
            results.push({ screenshots: ['npc-browse-renly.png', 'npc-conversation-renly.png', 'convo-browse-doryani.png', 'convo-editor-doryani.png'].map(filename => join(screenshotFolder, filename)), originalWorkbookSha256: originalHashes });
        }
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
                comparisonBusy:vm?.ctComparisonBusy,comparisonError:vm?.ctComparisonError,historyError:vm?.ctHistoryError,comparisons:vm?.ctComparisonVersions?.length,
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
