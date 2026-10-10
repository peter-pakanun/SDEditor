'use strict';
// Disposable normal-mode acceptance check: real API/auth, IndexedDB and the ClientText worker.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync, copyFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const { randomUUID, createHash } = require('node:crypto');
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
async function inlineGeometry(row) {
    await row.page().evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    return row.evaluate(row => {
        const rect = element => { if (!element) return null; const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom }; };
        const visible = element => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
        const side = name => {
            const host = row.querySelector('.ctFields[data-side="' + name + '"]');
            return { notes: rect(host?.querySelector('.ctDeveloperNotes')), prelude: rect(host?.querySelector('.inlineBlockPrelude')), metadata: host?.querySelector('.ctMetadata')?.textContent || '',
                groups: Array.from(host?.querySelectorAll('.ctBlock[data-field-group]') || [], block => ({ key: block.dataset.fieldGroup,
                    block: rect(block.closest('[data-inline-block]') || block), natural: rect(block), heading: visible(block.querySelector('h3')) ? rect(block.querySelector('h3')) : null, control: rect(block.querySelector('textarea,select')),
                    labels: Array.from(block.querySelectorAll('label'), label => ({ text: label.textContent.trim(), visible: visible(label) && !label.classList.contains('srOnly') })),
                    grid: rect(block.querySelector('.ctFormGrid')), source: !!block.querySelector('.editorSourceField') })) };
        };
        return { row: rect(row), source: side('source'), translation: side('translation') };
    });
}
function assertInlineAlignment(geometry, label) {
    assert.ok(geometry.source.prelude && geometry.translation.prelude, label + ': shared prelude blocks exist on both sides');
    assert.ok(Math.abs(geometry.source.prelude.y - geometry.translation.prelude.y) <= 1, label + ': context row starts together');
    assert.ok(Math.abs(geometry.source.prelude.height - geometry.translation.prelude.height) <= 1, label + ': source-only notes and translation-only choices keep the paired context row aligned');
    const targets = new Map(geometry.translation.groups.map(group => [group.key, group]));
    assert.equal(geometry.source.groups.length, geometry.translation.groups.length, label + ': paired groups exist on both sides');
    for (const source of geometry.source.groups) {
        const target = targets.get(source.key);
        assert.ok(target, label + ': matching translation group ' + source.key);
        assert.ok(Math.abs(source.block.y - target.block.y) <= 1, label + ': group tops align ' + source.key + ' ' + JSON.stringify({ source: source.block, target: target.block }));
        assert.ok(Math.abs(source.block.height - target.block.height) <= 1, label + ': paired group heights match ' + source.key);
        assert.equal(source.heading, null, label + ': inline English group names are omitted ' + source.key);
        assert.equal(target.heading, null, label + ': inline translation group names are omitted ' + source.key);
        assert.equal([...source.labels, ...target.labels].some(item => item.visible && /^(English|French translation)$/.test(item.text)), false, label + ': table headers identify the language without repeated field labels');
        if (source.control && target.control && !target.grid) {
            assert.ok(Math.abs(source.control.y - target.control.y) <= 1, label + ': English and translation inputs align ' + source.key);
            assert.ok(Math.abs(source.control.height - target.control.height) <= 1, label + ': paired text input heights match ' + source.key + ' ' + JSON.stringify({ source: source.control, target: target.control }));
        }
    }
    assert.equal(geometry.source.metadata + geometry.translation.metadata, '', label + ': generic workbook metadata is absent');
}
function fieldStackExtent(geometry) {
    const boxes = ['source', 'translation'].flatMap(side => [geometry[side].prelude, ...geometry[side].groups.map(group => group.block)]).filter(Boolean);
    return boxes.length ? Math.max(...boxes.map(box => box.bottom)) - Math.min(...boxes.map(box => box.y)) : 0;
}
const styles = `<styleSheet xmlns="${NS}"><fonts count="1"><font><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFA8072"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF9966"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4">${[0, 1, 2, 3].map(fill => `<xf numFmtId="0" fontId="0" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf>`).join('')}</cellXfs></styleSheet>`;
async function workbook(JSZip, role) {
    const sheets = role === 'normal' ? [
        ['Normal', sheet([
            row(1, [cell('A1', 'ID'), cell('B1', 'Notes'), cell('C1', 'Name'), cell('D1', 'Translation'), cell('E1', 'Gender'), cell('G1', 'Description'), cell('H1', 'Translation')]),
            row(2, [cell('A2', 'record'), cell('B2', 'Developer instruction'), cell('C2', 'Sword'), blank('D2', 2), cell('E2', 'M', 1), cell('G2', '[NOAUDIO] New description'), cell('H2', 'Old description', 3)]),
            row(3, [cell('A3', 'complete'), cell('C3', 'Shield'), cell('D3', 'Original', 1), cell('E3', 'F', 1), cell('G3', '{0:+d} <<keybind:open_panel>>'), cell('H3', '{0:+d} <<keybind:open_panel>>', 1)]),
            row(4, [cell('A4', 'noaudio'), cell('C4', '[NOAUDIO] '), blank('D4', 2), blank('E4')])
        ])],
        ['Second', sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Translation Note'), cell('C1', 'Text'), cell('D1', 'Translation')]), row(2, [cell('A2', 'second'), cell('B2', 'Other developer note'), cell('C2', 'Other text'), cell('D2', 'Autre texte', 1)])])],
        ['Visibility', sheet([
            row(1, [cell('A1', 'ID'), cell('B1', 'Notes'), cell('C1', 'Name'), cell('D1', 'Translation'), cell('E1', 'Gender'), cell('F1', 'Description'), cell('G1', 'Translation'), cell('H1', 'Unused'), cell('I1', 'Translation')]),
            row(2, [cell('A2', 'visible-raw'), cell('B2', 'Visibility developer note'), cell('C2', ' \tVisible English\nline \t'), cell('D2', 'Texte exact\nvisible', 1), cell('E2', 'F', 1), blank('F2'), cell('G2', 'Hidden empty-source translation', 1), cell('H2', ' \t\n'), cell('I2', 'Hidden whitespace-source translation', 1)]),
            row(3, [cell('A3', 'empty-english'), blank('C3'), cell('D3', 'Hidden all-empty row translation', 1), cell('E3', 'M', 1), cell('F3', ' \t\n'), cell('G3', 'Hidden all-whitespace row translation', 1)])
        ])]
    ] : [
        ['Words_Gender', sheet([
            row(1, [cell('A1', 'ID'), cell('B1', 'Tags'), cell('C1', 'Text'), ...['MS', 'FS', 'NS', 'MP', 'FP', 'NP'].map((label, i) => cell(String.fromCharCode(68 + i) + '1', label))]),
            row(2, [cell('A2', 'form'), cell('B2', 'weapon'), cell('C2', 'Strong'), cell('D2', 'Fort', 1), cell('F2', ' NONEXISTENT', 1), cell('I2', 'NONEXISTENT', 1)]),
            row(3, [cell('A3', 'new-form'), cell('C3', 'New'), blank('D3', 2), blank('E3', 2), blank('F3', 1), blank('G3', 1), blank('H3', 1), blank('I3', 1)])
        ])],
        ['Nouns', sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Display Name'), cell('C1', 'Translation'), cell('D1', 'Gender')]), row(2, [cell('A2', 'noun'), cell('B2', 'Chest'), cell('C2', 'Coffre', 1), blank('D2', 2)])])],
        ['Audio_Gender', sheet([row(1, [cell('A1', 'ID'), cell('B1', 'Character Class'), cell('C1', 'Text'), cell('D1', 'MS'), cell('E1', 'FS')]), row(2, [cell('A2', 'two-form'), cell('B2', 'Fixture character'), cell('C2', 'Audio text'), cell('D2', 'Texte audio', 1), blank('E2', 1)])])]
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
        if (process.argv.includes('--french-patchnote')) {
            const publicationRequests = [];
            page.on('request', request => { if (request.method() === 'POST' && /\/v1\/(?:versions|version-releases|content-groups|content-uploads)(?:[/?]|$)/.test(request.url())) publicationRequests.push(request.url()); });
            const outputDirectory = resolve(process.env.CLIENTTEXT_PATCHNOTE_DIRECTORY || 'C:/Users/lpeac/.codex/visualizations/2026/10/10/01a124dd-8f8b-7d71-b610-ee036d540410/patchnote-french');
            const previousValidation = existsSync(join(outputDirectory, 'validation.json')) ? JSON.parse(readFileSync(join(outputDirectory, 'validation.json'), 'utf8')) : null;
            const previousNormal = previousValidation?.inlineFacts?.find(item => item.filename === '04-french-clienttext-inline.png');
            if (previousNormal?.geometry?.source.groups.length > 1 && existsSync(join(outputDirectory, '04-french-clienttext-inline.png')) && !existsSync(join(outputDirectory, '04-french-clienttext-inline-before-compact.png'))) copyFileSync(join(outputDirectory, '04-french-clienttext-inline.png'), join(outputDirectory, '04-french-clienttext-inline-before-compact.png'));
            const productionDirectory = resolve(process.env.CLIENTTEXT_PRODUCTION_DIRECTORY || 'C:/Users/lpeac/Downloads/2026-10-05_POE2');
            const originals = ['French_PoE2.xlsm', 'French_Gender_PoE2.xlsm'].map(name => {
                const path = join(productionDirectory, name), bytes = readFileSync(path);
                return { name, path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
            });
            mkdirSync(outputDirectory, { recursive: true });
            await page.setViewportSize({ width: 1920, height: 1080 });
            await page.evaluate(async () => {
                const vm = window.__clientFixtureApp; vm.theme = 'modern-dark'; vm.hideClipboard = true; vm.hideSourceInPreviewPanel = false;
                await vm.saveSettings(); document.documentElement.setAttribute('data-theme', 'modern-dark');
            });
            await page.getByRole('button', { name: 'Import ClientText workbooks', exact: true }).click();
            const captureUpload = page.getByRole('region', { name: 'Content upload' });
            await captureUpload.locator('input[type=text]').fill('2026-10-05 · PoE 2');
            await captureUpload.locator('input[type=file]').first().setInputFiles(originals.map(original => ({ name: original.name, mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', buffer: original.bytes })));
            const started = Date.now();
            console.log('French patchnote: preparing the original normal/Gender pair in a disposable local workspace.');
            await captureUpload.getByRole('button', { name: 'Prepare and validate', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading, null, { timeout: 300000 });
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '', 'Real French pair prepares safely');
            const prepareMs = Date.now() - started;
            const preparedFacts = await page.evaluate(() => {
                const group = window.__clientFixtureApp.ctPrepared[0];
                return { units: group.units.length, assets: group.assets.map(asset => ({ filename: asset.filename, role: asset.role, hash: asset.parsed?.artifactHash || asset.hash || asset.assetHash })),
                    counts: group.units.reduce((counts, unit) => (counts[unit.role] = (counts[unit.role] || 0) + 1, counts), {}) };
            });
            assert.deepEqual(preparedFacts.counts, { normal: 89659, gender: 68250 });
            await captureUpload.getByRole('button', { name: 'Store local workspaces', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctUploading && !window.__clientFixtureApp.ctUploadVisible, null, { timeout: 300000 });
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctUploadError), '', 'Original French workbooks store locally');
            const storeMs = Date.now() - started - prepareMs;
            await page.getByRole('button', { name: '2026-10-05 · PoE 2 · ClientText · French', exact: true }).click();
            const captureWorkspace = page.getByRole('region', { name: 'ClientText workspace' }), sheetNavigation = captureWorkspace.getByRole('navigation', { name: 'Workbook sheets' });
            await captureWorkspace.waitFor(); await page.waitForFunction(() => !window.__clientFixtureApp.ctBusy, null, { timeout: 180000 });
            assert.equal(await captureWorkspace.getByRole('combobox', { name: 'Content group', exact: true }).count(), 0, 'Production capture uses the Versions assignment workflow without a header selector');
            const candidates = await page.evaluate(() => {
                const vm = window.__clientFixtureApp, meaningful = field => field.kind !== 'gender' && field.target.trim() && !['NONEXISTENT', 'MISSING_TRANSLATION'].includes(field.target.trim());
                const base = unit => ({ id: unit.id, recordId: unit.recordId, sheet: unit.sheet, role: unit.role, developerNotes: unit.developerNotes,
                    fields: unit.fields.map(field => ({ id: field.id, name: field.name, form: field.form, source: field.source, target: field.target })) });
                const normal = vm.ctUnits.filter(unit => unit.role === 'normal').map(unit => {
                    const field = unit.fields.filter(meaningful).sort((a, b) => b.source.length - a.source.length)[0];
                    if (!field || field.source.length < 70 || field.source.length > 650 || field.target.length > 800) return null;
                    const notes = typeof unit.developerNotes === 'string' ? unit.developerNotes : JSON.stringify(unit.developerNotes || '');
                    const score = (/\[[^\]]+\]/.test(field.source) ? 15 : 0) + (/\{\d+[^}]*\}/.test(field.source) ? 25 : 0)
                        + (/<<[^>]+>>/.test(field.source) ? 8 : 0) + (notes && notes !== '""' && notes !== '[]' ? 30 : 0)
                        + (field.target.length > 70 ? 6 : 0) - unit.fields.length;
                    return { ...base(unit), fieldId: field.id, score };
                }).filter(Boolean).sort((a, b) => b.score - a.score || a.recordId.localeCompare(b.recordId)).slice(0, 8);
                const gender = vm.ctUnits.filter(unit => unit.role === 'gender').map(unit => {
                    const forms = unit.fields.filter(field => field.kind === 'form');
                    const translated = forms.filter(meaningful);
                    if (forms.length !== 6 || translated.length < 3 || forms.some(field => field.target.length > 80) || !forms[0].source || forms[0].source.length > 90) return null;
                    const score = translated.length * 10 + new Set(translated.map(field => field.target)).size * 5 + (forms[0].source.length < 35 ? 5 : 0);
                    return { ...base(unit), fieldId: forms.find(field => field.form === 'MS').id, score };
                }).filter(Boolean).sort((a, b) => b.score - a.score || a.recordId.localeCompare(b.recordId)).slice(0, 8);
                return { normal, gender };
            });
            assert.ok(candidates.normal.length && candidates.gender.length, 'Production French contains useful text and six-form examples');
            writeFileSync(join(outputDirectory, 'examples.json'), JSON.stringify(candidates, null, 2));
            const choose = async candidate => {
                await sheetNavigation.getByRole('button', { name: candidate.sheet, exact: true }).click();
                await captureWorkspace.getByRole('searchbox', { name: 'Search ClientText' }).fill(candidate.recordId);
                await captureWorkspace.getByRole('searchbox', { name: 'Search ClientText' }).press('Enter');
                await captureWorkspace.getByRole('button', { name: candidate.recordId, exact: true }).click();
                await page.waitForFunction(id => { const vm = window.__clientFixtureApp; return vm.ctSelection === id && vm.ctEditor && !vm.ctBusy && !vm._ctSelectRun?.pending; }, candidate.id);
                await page.evaluate(fieldId => { const vm = window.__clientFixtureApp; vm.ctFocusedField = fieldId; }, candidate.fieldId);
                await captureWorkspace.locator('#ctFullEditorPreviewHost .gamePreviewStrip').waitFor();
                await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
            };
            await choose(candidates.normal[0]);
            assert.equal(await captureWorkspace.locator('#ctFullEditorPreviewHost .gamePreviewWindow').count(), 2, 'Real French text has both source and translation game previews');
            const normalVisibleNames = candidates.normal[0].fields.filter(field => field.source.trim()).map(field => field.name);
            assert.deepEqual(await captureWorkspace.locator('.ctFullEditor .ctBlock h3').allTextContents(), normalVisibleNames, 'Real French full editor retains named English-bearing fields only');
            await page.screenshot({ path: join(outputDirectory, '01-french-clienttext-editor.png') });
            await captureWorkspace.getByRole('button', { name: 'Close', exact: true }).click();
            await choose(candidates.gender[0]);
            assert.equal(await captureWorkspace.locator('.ctFormGrid textarea').count(), 6);
            await page.screenshot({ path: join(outputDirectory, '02-french-gender-editor.png') });
            await captureWorkspace.getByRole('button', { name: 'Close', exact: true }).click();
            await captureWorkspace.getByRole('searchbox', { name: 'Search ClientText' }).fill('');
            await captureWorkspace.getByRole('searchbox', { name: 'Search ClientText' }).press('Enter');
            await sheetNavigation.getByRole('button', { name: candidates.normal[0].sheet, exact: true }).click();
            await page.screenshot({ path: join(outputDirectory, '03-french-worksheet-list.png') });
            const inlineFacts = [];
            let compactComparison = null;
            await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.inlineEditor = true; vm.inlineSidebarVisible = true; await vm.$nextTick(); });
            for (const [candidate, filename] of [[candidates.normal[0], '04-french-clienttext-inline.png'], [candidates.gender[0], '05-french-gender-inline.png']]) {
                await sheetNavigation.getByRole('button', { name: candidate.sheet, exact: true }).click();
                await captureWorkspace.getByRole('searchbox', { name: 'Search ClientText' }).fill(candidate.recordId);
                await captureWorkspace.getByRole('searchbox', { name: 'Search ClientText' }).press('Enter');
                const row = captureWorkspace.locator('.ctTable > tbody > tr').filter({ has: page.getByRole('button', { name: candidate.recordId, exact: true }) });
                await row.click();
                await page.waitForFunction(id => { const vm = window.__clientFixtureApp; return vm.ctSelection === id && !vm.ctEditor && !vm.ctBusy && !vm._ctSelectRun?.pending; }, candidate.id);
                await page.evaluate(fieldId => { window.__clientFixtureApp.ctFocusedField = fieldId; }, candidate.fieldId);
                await captureWorkspace.locator('.ctTools').getByRole('button', { name: 'Preview', exact: true }).click();
                await captureWorkspace.locator('#ctInlineEditorPreviewHost .gamePreviewStrip').waitFor();
                const geometry = await inlineGeometry(row);
                assertInlineAlignment(geometry, 'Real French ' + candidate.role + ' inline');
                if (candidate.role === 'normal') {
                    assert.ok(geometry.source.notes, 'Real developer notes are visible above aligned text pairs');
                    assert.equal(geometry.source.groups.length, normalVisibleNames.length, 'The real inline example omits every optional field with empty English');
                    const prior = previousValidation?.compactComparison?.before || (previousNormal && previousNormal.sheet === candidate.sheet && previousNormal.id === candidate.recordId
                        ? { sheet: previousNormal.sheet, id: previousNormal.id, fields: previousNormal.geometry.source.groups.length, fieldStackHeight: fieldStackExtent(previousNormal.geometry) } : null);
                    const after = { sheet: candidate.sheet, id: candidate.recordId, fields: geometry.source.groups.length, fieldStackHeight: fieldStackExtent(geometry), rowHeight: geometry.row.height };
                    if (prior) {
                        assert.ok(after.fieldStackHeight < prior.fieldStackHeight * .8, 'Same real French example has a materially shorter field stack after blank fields/names are hidden');
                        compactComparison = { before: prior, after, reducedBy: prior.fieldStackHeight - after.fieldStackHeight };
                    }
                }
                if (candidate.role === 'gender') assert.equal(await row.locator('.ctFormGrid thead th').first().evaluate(header => { const range = document.createRange(); range.selectNodeContents(header); return range.getClientRects().length; }), 1, 'Real Gender Form heading stays on one line');
                assert.equal(await captureWorkspace.getByText('NONEXISTENT: type a prefix and press Tab', { exact: true }).count(), 0);
                inlineFacts.push({ filename, sheet: candidate.sheet, id: candidate.recordId, geometry });
                await page.screenshot({ path: join(outputDirectory, filename) });
            }
            assert.equal(await page.evaluate(async () => { const vm = window.__clientFixtureApp; return Object.keys(await vm._ctStore.getSaved(vm.ctWorkspace.scope)).length; }), 0, 'Patchnote screenshots use only upstream translations');
            assert.deepEqual(publicationRequests, [], 'Patchnote capture never publishes content to an API');
            for (const original of originals) assert.equal(createHash('sha256').update(readFileSync(original.path)).digest('hex'), original.sha256, 'Upstream workbook remains unchanged');
            assert.deepEqual(failures, [], 'Production French browser script errors');
            writeFileSync(join(outputDirectory, 'validation.json'), JSON.stringify({ status: 'PASS', originals: originals.map(({ name, sha256 }) => ({ name, sha256 })), preparedFacts,
                timings: { prepareMs, storeMs }, normal: { sheet: candidates.normal[0].sheet, id: candidates.normal[0].recordId }, gender: { sheet: candidates.gender[0].sheet, id: candidates.gender[0].recordId },
                inlineFacts, compactComparison, screenshots: ['01-french-clienttext-editor.png', '02-french-gender-editor.png', '03-french-worksheet-list.png', '04-french-clienttext-inline.png', '05-french-gender-inline.png'] }, null, 2));
            console.log(JSON.stringify({ status: 'PASS', frenchPatchnote: true, outputDirectory, units: preparedFacts.units, prepareMs, storeMs, compactComparison }));
            return;
        }
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
        assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctPrepared[0].units.length), 10, 'Hidden fields, empty-English rows and two-form audio retain their immutable parsed workbook records');
        assert.ok((await page.evaluate(() => window.__ctProgressEvents)).some(event => event.sheet === 'Words_Gender'), 'Real worker reports per-sheet progress');
        await upload.getByRole('button', { name: 'Store local workspaces', exact: true }).click();
        await page.waitForFunction(() => !window.__clientFixtureApp.ctUploadVisible && window.__clientFixtureApp.ctLocalWorkspaces.length === 1);
        const showAllClientStatuses = async () => {
            const region = page.getByRole('region', { name: 'ClientText workspace' }), filter = region.getByRole('button', { name: 'Filters', exact: true });
            if (await filter.getAttribute('aria-expanded') !== 'true') await filter.click();
            const all = region.locator('.fileFilters').getByRole('button', { name: 'Select all', exact: true });
            if (await all.isEnabled()) await all.click();
            await filter.click();
        };
        const openCached = async ({ allStatuses = true } = {}) => {
            await page.getByRole('button', { name: 'ClientText browser fixture · ClientText · French', exact: true }).click();
            await page.getByRole('region', { name: 'ClientText workspace' }).waitFor();
            if (allStatuses) await showAllClientStatuses();
        };
        await openCached({ allStatuses: false });
        const workspace = page.getByRole('region', { name: 'ClientText workspace' }), navigation = workspace.getByRole('navigation', { name: 'Workbook sheets' });
        await navigation.getByRole('button', { name: 'All sheets', exact: true }).click();
        const clientChrome = new Map();
        const readWorkspaceChrome = element => {
            const style = (selector, keys) => {
                const value = getComputedStyle(element.querySelector(selector));
                return Object.fromEntries(keys.map(key => [key, value[key]]));
            };
            return { header: style('.workspaceHeader', ['backgroundColor', 'fontFamily', 'fontSize', 'padding']),
                searchInput: style('.workspaceHeader .searchField input', ['flex', 'border', 'backgroundColor', 'padding', 'fontFamily', 'fontSize', 'minWidth']),
                tableHeading: style('.fileTableScroll table thead th', ['fontFamily', 'fontSize', 'fontWeight', 'padding']),
                footer: style('.workspaceFooter', ['backgroundColor', 'fontFamily', 'fontSize', 'padding']) };
        };
        for (const size of desktopSizes) {
            await page.setViewportSize(size);
            for (const theme of themes) {
                await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                assert.equal(await workspace.locator('.workspaceHeader .workspaceBrand').count(), 1);
                assert.equal(await workspace.locator('.workspaceHeader .workspaceSearch .searchField').count(), 1);
                assert.equal(await workspace.locator('.workspaceHeader .workspaceActions').count(), 1);
                assert.equal(await workspace.locator('.workspaceHeader .filterToggle').count(), 1);
                assert.equal(await workspace.locator('.ctTable.fileTable thead th').count(), 3, 'ClientText reuses the filename/English/translation table columns');
                assert.ok(await workspace.locator('.workspaceFooter .workspaceStatus').count() === 1);
                assert.equal(await navigation.count(), 1, 'Worksheet navigation remains beside the shared ClientText file list');
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), theme + ': ClientText shared table fits the resized desktop');
                clientChrome.set(size.width + ':' + theme, await workspace.evaluate(readWorkspaceChrome));
                await page.screenshot({ path: join(directory, `clienttext-shared-table-${size.width}-${theme}.png`), fullPage: true });
            }
        }
        await page.setViewportSize(desktopSizes[0]); await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), 'modern-dark');
        await workspace.getByRole('button', { name: 'Filters', exact: true }).click();
        const clientFilters = workspace.locator('.workspaceHeader fieldset.fileFilters');
        assert.equal(await clientFilters.isVisible(), true);
        assert.ok(await clientFilters.locator('.filterChip input[type=checkbox]').count() >= 5, 'ClientText uses the shared checkbox status filters');
        assert.equal(await clientFilters.getByRole('checkbox', { name: 'Unchanged', exact: true }).isChecked(), true, 'Complete records and their durable drafts remain discoverable in the default ClientText filter');
        const selectAllClientFilters = clientFilters.getByRole('button', { name: 'Select all', exact: true });
        if (await selectAllClientFilters.isEnabled()) await selectAllClientFilters.click();
        assert.equal(await clientFilters.locator('.filterChip input[type=checkbox]').evaluateAll(inputs => inputs.every(input => input.checked)), true);
        await workspace.getByRole('button', { name: 'Filters', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctWorkProgress.total), 5, 'ClientText retains the exact initial field-workload denominator');
        assert.match(await workspace.locator('.workspaceFooter .collaborationFooterMessage').textContent(), /0\s*\/\s*5.*initial.*fields/i, 'The shared footer labels field workload explicitly');
        await workspace.getByRole('button', { name: 'Scan diagnostics', exact: true }).click();
        const scanDialog = page.getByRole('dialog', { name: 'Scan diagnostics', exact: true });
        await scanDialog.waitFor(); assert.equal(await scanDialog.locator('.diagnosticScanForm .diagnosticScanFooter').count(), 1);
        assert.equal(await scanDialog.getByRole('checkbox', { name: /^Consistency/ }).isChecked(), false, 'The shared diagnostic dialog leaves optional consistency unchecked');
        await scanDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctScanDone), false, 'Opening or cancelling diagnostics does not run a scan');
        const visibilityId = JSON.stringify(['normal', 'Visibility', 'visible-raw']);
        const visibilityFields = { Name: ' \tVisible English\nline \t', Description: '', Unused: ' \t\n' };
        await navigation.getByRole('button', { name: 'Visibility', exact: true }).click();
        assert.equal(await workspace.getByRole('button', { name: 'empty-english', exact: true }).count(), 0, 'A row without any nonblank English is omitted even when translations and Gender metadata exist');
        assert.doesNotMatch(await workspace.locator('.ctTable').textContent(), /Hidden (?:empty-source|whitespace-source|all-empty|all-whitespace)/, 'Unselected list previews omit translation slots with no English');
        await workspace.getByRole('button', { name: 'visible-raw', exact: true }).click();
        await page.waitForFunction(id => { const vm = window.__clientFixtureApp; return vm.ctSelection === id && vm.ctEditor && !vm._ctSelectRun?.pending; }, visibilityId);
        assert.equal(await workspace.getByRole('textbox', { name: 'Name English', exact: true }).inputValue(), visibilityFields.Name, 'Meaningful English retains its exact leading/trailing whitespace and newline');
        assert.equal(await workspace.getByRole('heading', { name: 'Name', exact: true }).count(), 1, 'The full editor retains the visible field name');
        for (const name of ['Description', 'Unused']) {
            assert.equal(await workspace.getByRole('textbox', { name, exact: true }).count(), 0, 'A blank English field has no editable translation: ' + name);
            assert.equal(await workspace.getByRole('heading', { name, exact: true }).count(), 0, 'A blank English field has no full-editor heading: ' + name);
        }
        assert.equal(await workspace.getByRole('combobox', { name: 'Gender', exact: true }).inputValue(), 'F', 'Gender remains editable metadata on an English-bearing row');
        const hiddenBaseline = await page.evaluate(async id => {
            const vm = window.__clientFixtureApp, units = await vm._ctStore.getUnits(vm.ctWorkspace.scope);
            return { units: units.filter(unit => unit.sheet === 'Visibility').map(unit => ({ id: unit.recordId, fields: unit.fields.map(field => ({ name: field.name, source: field.source, target: field.target })) })),
                values: { ...vm.ctValues }, saved: Object.keys(await vm._ctStore.getSaved(vm.ctWorkspace.scope)).length };
        }, visibilityId);
        assert.equal(hiddenBaseline.units.length, 2, 'Both visible and hidden rows remain in immutable local storage');
        assert.equal(hiddenBaseline.saved, 0, 'Hiding empty English creates no saved changes');
        for (const [name, source] of Object.entries(visibilityFields)) assert.equal(hiddenBaseline.units.find(unit => unit.id === 'visible-raw').fields.find(field => field.name === name).source, source);
        assert.equal(hiddenBaseline.values[JSON.stringify(['Description', null])], 'Hidden empty-source translation');
        assert.equal(hiddenBaseline.values[JSON.stringify(['Unused', null])], 'Hidden whitespace-source translation');
        await workspace.getByRole('button', { name: 'Close', exact: true }).click();
        await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.inlineEditor = true; vm.inlineSidebarVisible = true; await vm.$nextTick(); });
        const visibilityRow = workspace.locator('.ctTable > tbody > tr').filter({ has: page.getByRole('button', { name: 'visible-raw', exact: true }) });
        await visibilityRow.click();
        await page.waitForFunction(id => { const vm = window.__clientFixtureApp; return vm.ctSelection === id && !vm.ctEditor && !vm._ctSelectRun?.pending; }, visibilityId);
        const visibilityTarget = workspace.getByRole('textbox', { name: 'Name', exact: true });
        await visibilityTarget.focus(); await visibilityTarget.evaluate(input => input.setSelectionRange(1, 4));
        for (const size of desktopSizes) {
            await page.setViewportSize(size);
            for (const theme of themes) {
                await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                const geometry = await inlineGeometry(visibilityRow);
                assertInlineAlignment(geometry, theme + '/' + size.width + ': visible fields with hidden raw translations');
                assert.equal(geometry.source.groups.length, 2, 'Only the meaningful text and Gender metadata groups appear inline');
                assert.equal(await visibilityTarget.inputValue(), 'Texte exact\nvisible');
                assert.equal(await workspace.getByRole('textbox', { name: 'Name English', exact: true }).inputValue(), visibilityFields.Name);
                assert.equal(await visibilityTarget.evaluate(input => document.activeElement === input && input.selectionStart === 1 && input.selectionEnd === 4), true, 'Theme/width changes preserve the active textarea and selection');
                assert.equal(await visibilityRow.getByRole('combobox', { name: 'Gender', exact: true }).inputValue(), 'F');
                assert.equal(await visibilityRow.getByText('Gender', { exact: true }).isVisible(), true, 'Compact inline retains the Gender metadata label');
                assert.ok(geometry.translation.groups.find(group => group.control && !group.grid && group.control.width > 100).control.height < 80, 'Short inline text uses the compact control height');
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Compact fields fit the resized desktop');
                await page.screenshot({ path: join(directory, `clienttext-visibility-inline-${size.width}-${theme}.png`), fullPage: true });
            }
        }
        await page.setViewportSize(desktopSizes[0]); await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), 'modern-dark');
        await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.inlineEditor = false; await vm.$nextTick(); });
        await navigation.getByRole('button', { name: 'Normal', exact: true }).click();
        results.push('Blank/whitespace English fields and entirely blank-English rows are hidden without losing raw translations or whitespace; full names/Gender metadata remain; compact inline preserves focus and alignment in eight desktop/theme cases');
        const checkClientKeyboard = async () => {
            const fieldKey = (name, form = null) => JSON.stringify([name, form]);
            const inputFor = label => workspace.getByRole(label === 'Gender' ? 'combobox' : 'textbox', { name: label, exact: true });
            const keyFor = label => label.startsWith('Text ') ? fieldKey('Text', label.slice(5)) : fieldKey(label);
            const waitTarget = async (recordId, full, fieldId) => page.waitForFunction(({ recordId, full, fieldId }) => {
                const vm = window.__clientFixtureApp;
                return !vm.ctBusy && !vm._ctSelectRun?.pending && vm.ctCurrentUnit?.recordId === recordId && vm.ctEditor === full
                    && (!fieldId || document.activeElement?.dataset.ctTarget === fieldId);
            }, { recordId, full, fieldId });
            const open = async (sheet, recordId, inline) => {
                if (await workspace.locator('.ctFullEditor').count()) await workspace.getByRole('button', { name: 'Close', exact: true }).click();
                await page.evaluate(async inline => { const vm = window.__clientFixtureApp; vm.inlineEditor = inline; vm.inlineSidebarVisible = false; vm.ctSort = 'filename'; vm.ctSortDir = 'asc'; await vm.$nextTick(); }, inline);
                await navigation.getByRole('button', { name: sheet, exact: true }).click();
                const recordRow = workspace.locator('.ctTable > tbody > tr').filter({ has: page.getByRole('button', { name: recordId, exact: true }) });
                if (inline) await recordRow.click(); else await workspace.getByRole('button', { name: recordId, exact: true }).click();
                await waitTarget(recordId, !inline);
            };
            const tabOrder = async ({ sheet, recordId, labels, cells }, inline) => {
                await open(sheet, recordId, inline);
                const mapping = await page.evaluate(keys => { const vm = window.__clientFixtureApp; return keys.map(key => vm.ctCurrentUnit.fields.find(field => field.id === key).targetCell); }, labels.map(keyFor));
                assert.deepEqual(mapping, cells, 'Keyboard fixture retains its physical worksheet cells');
                await inputFor(labels[0]).focus();
                for (let index = 1; index < labels.length; index++) {
                    await inputFor(labels[index - 1]).press('Tab');
                    await waitTarget(recordId, !inline, keyFor(labels[index]));
                }
                for (let index = labels.length - 2; index >= 0; index--) {
                    await inputFor(labels[index + 1]).press('Shift+Tab');
                    await waitTarget(recordId, !inline, keyFor(labels[index]));
                }
                if (!inline) {
                    await inputFor(labels.at(-1)).focus(); await inputFor(labels.at(-1)).press('Tab');
                    assert.equal(await page.evaluate(() => document.activeElement?.dataset.ctTarget || null), null, 'Full-editor boundary Tab reaches surrounding controls instead of another record');
                    assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctCurrentUnit.recordId), recordId);
                }
            };
            const cases = [
                { sheet: 'Normal', recordId: 'record', labels: ['Name', 'Gender', 'Description'], cells: ['D2', 'E2', 'H2'] },
                { sheet: 'Visibility', recordId: 'visible-raw', labels: ['Name', 'Gender'], cells: ['D2', 'E2'] },
                { sheet: 'Words_Gender', recordId: 'form', labels: ['Text MS', 'Text FS', 'Text NS', 'Text MP', 'Text FP', 'Text NP'], cells: ['D2', 'E2', 'F2', 'G2', 'H2', 'I2'] },
                { sheet: 'Audio_Gender', recordId: 'two-form', labels: ['Text MS', 'Text FS'], cells: ['D2', 'E2'] }
            ];
            const initial = await page.evaluate(async () => { const vm = window.__clientFixtureApp; return { saved: JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)), outbox: (await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length }; });
            for (const inline of [false, true]) for (const testCase of cases) await tabOrder(testCase, inline);
            await open('Normal', 'record', true); await inputFor('Name').focus();
            await inputFor('Name').evaluate(input => input.addEventListener('keydown', event => event.preventDefault(), { capture: true, once: true }));
            await inputFor('Name').press('Tab');
            await waitTarget('record', false, fieldKey('Name'));
            const guardedEvent = async options => inputFor('Name').evaluate((input, options) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...options })), options);
            await guardedEvent({ isComposing: true, keyCode: 229 }); await waitTarget('record', false, fieldKey('Name'));
            await page.evaluate(() => { window.__clientFixtureApp.ctBusy = true; }); await guardedEvent({ key: 'Enter', ctrlKey: true });
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctEditor), false, 'Busy inline keyboard input cannot open or navigate an editor');
            await page.evaluate(() => { window.__clientFixtureApp.ctBusy = false; });
            await workspace.getByRole('button', { name: 'Scan diagnostics', exact: true }).click();
            const keyboardModal = page.getByRole('dialog', { name: 'Scan diagnostics', exact: true }); await keyboardModal.waitFor();
            await guardedEvent({ key: 'Enter', ctrlKey: true });
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctEditor), false, 'An open modal prevents a background inline target from opening a full editor');
            await keyboardModal.getByRole('button', { name: 'Cancel', exact: true }).click();
            await open('Normal', 'record', true); await inputFor('Name').focus(); await inputFor('Name').press('Shift+Tab');
            await waitTarget('noaudio', false, fieldKey('Gender'));
            await inputFor('Gender').press('Tab'); await waitTarget('record', false, fieldKey('Name'));
            await inputFor('Gender').focus(); await inputFor('Gender').press('Control+ArrowUp'); await waitTarget('noaudio', false, fieldKey('Name'));
            await inputFor('Name').press('Control+ArrowDown'); await waitTarget('record', false, fieldKey('Name'));
            // Hold one real draft read to verify repeated boundary keys cannot
            // create a second asynchronous navigation or hydrate another row.
            await open('Normal', 'complete', true); await inputFor('Description').focus();
            await page.evaluate(() => {
                const vm = window.__clientFixtureApp, original = vm._ctStore.getDraft.bind(vm._ctStore);
                window.__keyboardDraftRead = { count: 0, original, release: null };
                vm._ctStore.getDraft = (scope, id) => {
                    if (id !== JSON.stringify(['normal', 'Normal', 'noaudio'])) return original(scope, id);
                    window.__keyboardDraftRead.count++;
                    return new Promise(resolve => { window.__keyboardDraftRead.release = () => resolve(original(scope, id)); });
                };
            });
            await inputFor('Description').press('Tab');
            await page.waitForFunction(() => typeof window.__keyboardDraftRead.release === 'function');
            await inputFor('Description').evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
            assert.equal(await page.evaluate(() => window.__keyboardDraftRead.count), 1, 'Repeated boundary Tab cannot start another draft hydration');
            await page.evaluate(() => { const vm = window.__clientFixtureApp, held = window.__keyboardDraftRead; vm._ctStore.getDraft = held.original; held.release(); });
            await waitTarget('noaudio', false, fieldKey('Name'));
            await page.evaluate(() => { delete window.__keyboardDraftRead; });
            for (const overlay of ['settings', 'dictionary history']) {
                await open('Normal', 'complete', true); await inputFor('Description').focus();
                const anchor = await page.evaluate(() => window.__clientFixtureApp.ctSelection);
                await page.evaluate(() => {
                    const vm = window.__clientFixtureApp, original = vm._ctStore.getDraft.bind(vm._ctStore);
                    window.__keyboardCancelledRead = { original, release: null };
                    vm._ctStore.getDraft = (scope, id) => id !== JSON.stringify(['normal', 'Normal', 'noaudio']) ? original(scope, id)
                        : new Promise(resolve => { window.__keyboardCancelledRead.release = () => resolve(original(scope, id)); });
                });
                await inputFor('Description').press('Tab');
                await page.waitForFunction(() => typeof window.__keyboardCancelledRead.release === 'function');
                if (overlay === 'settings') await workspace.getByRole('button', { name: 'Settings', exact: true }).click();
                else await page.evaluate(async () => window.__clientFixtureApp.cloudOpenHistory());
                const dialog = page.getByRole('dialog', { name: overlay === 'settings' ? 'Settings' : 'Shared dictionary history', exact: true });
                await dialog.waitFor(); await dialog.locator('button').first().focus();
                await page.evaluate(() => { window.__keyboardOverlayFocus = document.activeElement; const vm = window.__clientFixtureApp, held = window.__keyboardCancelledRead; vm._ctStore.getDraft = held.original; held.release(); });
                await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return !vm.ctBusy && !vm._ctSelectRun?.pending && !vm._ctNavigationRun; });
                assert.equal(await dialog.isVisible(), true, overlay + ' stays open when queued navigation settles');
                assert.equal(await page.evaluate(() => document.activeElement === window.__keyboardOverlayFocus), true, overlay + ' retains focus after a cancelled draft hydration');
                assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctSelection), anchor, overlay + ' cancels navigation before activating another record');
                assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctEditor), false);
                if (overlay === 'settings') { await dialog.locator('.settingsClose').click(); await page.waitForFunction(() => !window.__clientFixtureApp.settingsDialogVisible); }
                else { await dialog.getByRole('button', { name: 'Close shared dictionary history', exact: true }).click(); await page.waitForFunction(() => !window.__clientFixtureApp.cloudHistoryVisible); }
                await inputFor('Description').focus();
                await waitTarget('complete', false, fieldKey('Description'));
                await page.evaluate(() => { delete window.__keyboardCancelledRead; delete window.__keyboardOverlayFocus; });
            }
            await open('Normal', 'complete', true);
            const description = inputFor('Description'), rawDraft = 'raw @\\n [Keyword|display] {0}\nsecond line';
            await description.fill(rawDraft);
            const beforeExternalArrows = await page.evaluate(async () => { const vm = window.__clientFixtureApp; return { selection: vm.ctSelection, values: JSON.stringify(vm.ctValues),
                saved: JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)), history: (await vm._ctStore.listHistory(vm.ctWorkspace.scope, vm.ctSelection)).length }; });
            for (const [label, control] of [['search', workspace.getByRole('searchbox', { name: 'Search ClientText' })],
                ['readonly English', workspace.getByRole('textbox', { name: 'Description English', exact: true })],
                ['toolbar', workspace.getByRole('button', { name: 'Download workbooks', exact: true })]]) {
                await control.focus();
                for (const key of ['Control+ArrowUp', 'Control+ArrowDown']) {
                    await control.press(key);
                    const state = await page.evaluate(async () => { const vm = window.__clientFixtureApp; return { selection: vm.ctSelection, values: JSON.stringify(vm.ctValues),
                        saved: JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)), history: (await vm._ctStore.listHistory(vm.ctWorkspace.scope, vm.ctSelection)).length,
                        inline: !vm.ctEditor && !vm.ctInlineClosed, navigating: !!vm._ctNavigationRun, busy: vm.ctBusy }; });
                    assert.deepEqual(state, { ...beforeExternalArrows, inline: true, navigating: false, busy: false }, label + ' ' + key + ' cannot navigate or save the underlying private inline draft');
                }
            }
            await description.focus(); await page.evaluate(async () => window.__clientFixtureApp.cloudOpenHistory());
            const dictionaryHistory = page.getByRole('dialog', { name: 'Shared dictionary history', exact: true });
            await dictionaryHistory.waitFor();
            const historyClose = dictionaryHistory.getByRole('button', { name: 'Close shared dictionary history', exact: true });
            await historyClose.focus();
            for (const key of ['Control+s', 'F2']) {
                await historyClose.press(key);
                const state = await page.evaluate(async () => { const vm = window.__clientFixtureApp; return { selection: vm.ctSelection, values: JSON.stringify(vm.ctValues),
                    saved: JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)), history: (await vm._ctStore.listHistory(vm.ctWorkspace.scope, vm.ctSelection)).length,
                    overlay: vm.cloudHistoryVisible, inline: !vm.ctEditor && !vm.ctInlineClosed, navigating: !!vm._ctNavigationRun, busy: vm.ctBusy }; });
                assert.deepEqual(state, { ...beforeExternalArrows, overlay: true, inline: true, navigating: false, busy: false }, 'Dictionary history ' + key + ' cannot save or navigate the underlying private inline draft');
            }
            await historyClose.press('Escape'); await page.waitForFunction(() => !window.__clientFixtureApp.cloudHistoryVisible);
            assert.equal(await page.evaluate(() => { const vm = window.__clientFixtureApp; return !vm.ctEditor && !vm.ctInlineClosed && vm.ctValues[JSON.stringify(['Description', null])]; }), rawDraft, 'Overlay Escape closes only Dictionary history and preserves the active inline draft');
            await description.focus(); await description.evaluate(input => input.setSelectionRange(2, 7, 'backward'));
            const beforeHandoff = await page.evaluate(async () => { const vm = window.__clientFixtureApp; return { values: JSON.stringify(vm.ctValues), reviewed: JSON.stringify(vm.ctReviewed), history: (await vm._ctStore.listHistory(vm.ctWorkspace.scope, vm.ctSelection)).length }; });
            await description.press('Control+Enter'); await waitTarget('complete', true, fieldKey('Description'));
            assert.deepEqual(await description.evaluate(input => [input.value, input.selectionStart, input.selectionEnd, input.selectionDirection]), [rawDraft, 2, 7, 'backward'], 'Ctrl+Enter opens the exact inline field and text selection in the full editor');
            await description.press('Escape'); await waitTarget('complete', false, fieldKey('Description'));
            assert.deepEqual(await description.evaluate(input => [input.value, input.selectionStart, input.selectionEnd, input.selectionDirection]), [rawDraft, 2, 7, 'backward'], 'Escape returns to the exact inline field, caret range and raw private draft');
            const afterHandoff = await page.evaluate(async () => { const vm = window.__clientFixtureApp; return { values: JSON.stringify(vm.ctValues), reviewed: JSON.stringify(vm.ctReviewed), history: (await vm._ctStore.listHistory(vm.ctWorkspace.scope, vm.ctSelection)).length,
                saved: JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)), outbox: (await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length, draft: (await vm._ctStore.getDraft(vm.ctWorkspace.scope, vm.ctSelection))?.values[JSON.stringify(['Description', null])] }; });
            assert.deepEqual({ values: afterHandoff.values, reviewed: afterHandoff.reviewed, history: afterHandoff.history }, beforeHandoff, 'Inline/full handoff preserves field values/reviews and creates no saved history');
            assert.equal(afterHandoff.draft, rawDraft, 'The private raw draft remains durable through the handoff');
            assert.deepEqual({ saved: afterHandoff.saved, outbox: afterHandoff.outbox }, initial, 'Tab, guarded keys and inline/full handoff never save unchanged work or publish the private draft');
            await description.press('Escape');
            await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return vm.ctInlineClosed && !vm.ctEditor && document.activeElement?.dataset.unitId === vm.ctSelection; });
            assert.equal(await workspace.locator('[data-ct-target]').count(), 0, 'Inline Escape closes translation controls and returns focus to the exact file row');
            const reopenedRow = workspace.locator('.ctTable > tbody > tr').filter({ has: page.getByRole('button', { name: 'complete', exact: true }) });
            await reopenedRow.click(); await waitTarget('complete', false, fieldKey('Description'));
            assert.equal(await description.inputValue(), rawDraft, 'Reopening an escaped inline row preserves its exact private draft');
            await workspace.getByRole('button', { name: 'Discard draft', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.ctDraftDirty);
            await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.inlineEditor = false; vm.ctNotice = ''; await vm.$nextTick(); });
            await navigation.getByRole('button', { name: 'Normal', exact: true }).click();
            results.push('Full/inline Tab follows worksheet target columns (Gender, hidden fields, optional two/six forms); boundary/guarded keys stay scoped; external Ctrl-arrows and Dictionary-history shortcuts preserve drafts; overlays cancel queued navigation without stuck state; Ctrl+Enter/Escape retain exact durable text/caret without Saved/history changes');
        };
        await checkClientKeyboard();
        if (process.argv.includes('--keyboard-only')) { assert.deepEqual(failures, [], 'Focused keyboard fixture has no browser script errors'); console.log(JSON.stringify({ status: 'PASS', keyboardOnly: true, results }, null, 2)); return; }
        const checkClientHistory = async ({ historyOrigin, currentText, previousText, emptyOlder = false, themes = false }) => {
            const fieldId = JSON.stringify(['Name', null]);
            await workspace.locator('.ctTools').getByRole('button', { name: /History/i }).click();
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
            await page.waitForFunction(() => !window.__clientFixtureApp.ctEditor && !window.__clientFixtureApp.ctBusy);
            if (historyOrigin === 'shared') await page.waitForFunction(async ({ fieldId, previousText }) => { const vm = window.__clientFixtureApp; return !(await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length && Object.values(vm.ctSaved).some(saved => saved.serverRevision > 0 && saved.values[fieldId] === previousText); }, { fieldId, previousText });
            results.push(historyOrigin + ' ClientText history compares saved revisions/original/current; Restore before creates a durable draft without changing saved work' + (emptyOlder ? '; empty older pagination keeps existing rows' : ''));
        };
        await navigation.getByRole('button', { name: 'Normal', exact: true }).click();
        await workspace.locator('.ctTable tbody > tr').filter({ has: page.getByRole('button', { name: 'record', exact: true }) }).first().click();
        await page.waitForFunction(() => window.__clientFixtureApp.ctEditor && !window.__clientFixtureApp.inlineEditor);
        assert.equal(await workspace.locator('.editor > .edit').count(), 1, 'Normal ClientText row clicks use the shared full-editor layout');
        assert.equal(await navigation.count(), 0, 'The full editor uses the shared editor layout without the worksheet rail');
        assert.match(await workspace.locator('.ctDeveloperNotes').textContent(), /Developer instruction/);
        assert.equal(await workspace.locator('.ctMetadata').count(), 0, 'Internal workbook metadata stays out of the translator editor');
        if (process.argv.includes('--inline-alignment-audit')) {
            await workspace.getByRole('button', { name: 'Close', exact: true }).click();
            await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.inlineEditor = true; vm.inlineSidebarVisible = true; await vm.$nextTick(); });
            const row = workspace.locator('.ctTable > tbody > tr').filter({ has: page.getByRole('button', { name: 'record', exact: true }) });
            await row.click(); await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return vm.ctCurrentUnit?.recordId === 'record' && !vm.ctBusy && !vm._ctSelectRun?.pending; });
            const geometry = await inlineGeometry(row);
            writeFileSync(join(directory, 'clienttext-inline-alignment-audit.json'), JSON.stringify(geometry, null, 2));
            await page.screenshot({ path: join(directory, 'clienttext-inline-alignment-audit.png'), fullPage: true });
            const originalDescription = await workspace.getByRole('textbox', { name: 'Description', exact: true }).inputValue();
            await workspace.getByRole('textbox', { name: 'Description', exact: true }).fill('A long private translation line that wraps at the available desktop column width. '.repeat(5));
            const wrappedGeometry = await inlineGeometry(row);
            writeFileSync(join(directory, 'clienttext-inline-alignment-wrapped-audit.json'), JSON.stringify(wrappedGeometry, null, 2));
            await workspace.getByRole('textbox', { name: 'Description', exact: true }).fill(originalDescription);
            const restoredGeometry = await inlineGeometry(row);
            writeFileSync(join(directory, 'clienttext-inline-alignment-restored-audit.json'), JSON.stringify(restoredGeometry, null, 2));
            const summary = geometry => geometry.source.groups.map((group, index) => { const target = geometry.translation.groups[index]; return { key: group.key,
                topDelta: group.block.y-target.block.y, headingDelta: group.heading && target.heading ? group.heading.y-target.heading.y : null,
                heights: [group.block.height,target.block.height], controlDelta: group.control && target.control ? group.control.y-target.control.y : null,
                controlHeights: [group.control?.height,target.control?.height] }; });
            console.log(JSON.stringify({ status: 'AUDIT', original: summary(geometry), wrapped: summary(wrappedGeometry), restored: summary(restoredGeometry) }, null, 2)); return;
        }
        const name = workspace.getByRole('textbox', { name: 'Name', exact: true });
        await name.fill('Épée'); await workspace.getByRole('button', { name: 'Save', exact: true }).click();
        await page.waitForFunction(() => Object.values(window.__clientFixtureApp.ctSaved).some(saved => Object.values(saved.values).includes('Épée')));
        await workspace.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
        await workspace.getByRole('combobox', { name: 'Gender', exact: true }).selectOption('F');
        await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
        await page.waitForFunction(() => !window.__clientFixtureApp.ctEditor && !window.__clientFixtureApp.ctBusy);
        await workspace.getByRole('button', { name: 'record', exact: true }).click();
        await name.fill('Épée locale'); await workspace.getByRole('button', { name: 'Save', exact: true }).click();
        await page.waitForFunction(() => !window.__clientFixtureApp.ctBusy && Object.values(window.__clientFixtureApp.ctSaved).some(saved => Object.values(saved.values).includes('Épée locale')));
        await checkClientHistory({ historyOrigin: 'local', currentText: 'Épée locale', previousText: 'Épée', themes: true });
        await workspace.getByRole('button', { name: 'record', exact: true }).click();
        await workspace.locator('.ctTools').getByRole('button', { name: 'TM', exact: true }).click();
        const memoryMatch = workspace.locator('.ctTools article').filter({ has: page.locator('pre').filter({ hasText: /^Épée$/ }) });
        await memoryMatch.waitFor();
        const beforeMemory = await page.evaluate(async () => {
            const vm = window.__clientFixtureApp;
            return { saved: JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)),
                history: (await vm._ctStore.listHistory(vm.ctWorkspace.scope, vm.ctSelection)).length,
                outbox: (await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length };
        });
        const checkDictionaryControls = async editorMode => {
            const tools = workspace.locator('.ctTools'), target = workspace.getByRole('textbox', { name: 'Name', exact: true }), original = await target.inputValue();
            const before = await page.evaluate(async () => { const vm = window.__clientFixtureApp; return { values: { ...vm.ctValues }, saved: JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)), history: (await vm._ctStore.listHistory(vm.ctWorkspace.scope, vm.ctSelection)).length, outbox: (await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length }; });
            await target.fill('Première ligne'); await target.press('End'); await target.press('Enter'); await target.pressSequentially('Deuxième ligne');
            assert.equal(await target.inputValue(), 'Première ligne\nDeuxième ligne', editorMode + ': plain Enter inserts a raw newline in translation text');
            await target.fill(original);
            await tools.getByRole('button', { name: 'Dictionary', exact: true }).click();
            const search = tools.getByRole('searchbox', { name: 'Search dictionary entries', exact: true });
            await search.waitFor();
            assert.equal(await search.evaluate(input => input.tagName), 'INPUT', 'Dictionary search retains its search-input semantics');
            assert.equal(await tools.getByRole('button', { name: 'Previous dictionary page', exact: true }).count(), 1);
            assert.equal(await tools.getByRole('button', { name: 'Next dictionary page', exact: true }).count(), 1);
            await tools.getByRole('button', { name: 'Add entry', exact: true }).click();
            const entryId = await page.evaluate(() => window.__clientFixtureApp.ctDictionaryEditingId), entry = tools.locator('.dictionaryEntries > .editBlock[data-dict-id="' + entryId + '"]');
            assert.ok(entryId, 'Adding a Dictionary entry gives it a stable editing identity');
            const marker = 'ct-browser-' + editorMode, find = entry.locator('.dictRow textarea[placeholder=Find]'), replace = entry.locator('.dictRow textarea[placeholder=Replace]');
            assert.equal(await entry.locator('.dictRow input[placeholder=Find],.dictRow input[placeholder=Replace]').count(), 0, 'CT Dictionary Find/Replace use multiline textareas');
            await find.fill('Sword'); await find.press('End'); await find.press('Enter'); await find.pressSequentially(marker);
            await replace.fill('Épée'); await replace.press('End'); await replace.press('Enter'); await replace.pressSequentially('Forgée');
            assert.equal(await find.inputValue(), 'Sword\n' + marker); assert.equal(await replace.inputValue(), 'Épée\nForgée');
            assert.equal(await target.inputValue(), original, 'Plain Enter in Dictionary Replace does not insert or save a translation');
            await entry.locator('.dictScopeSelect').selectOption('poe2');
            assert.deepEqual(await entry.locator('.dictScopeSelect option').allTextContents(), ['PoE1', 'PoE2', 'All']);
            assert.equal(await entry.locator('.dictHistoryBtn').count(), 1, 'Dictionary history control remains available');
            await entry.getByRole('button', { name: /^Add an alternate for / }).click();
            const alternate = entry.locator('.dictAltRow'), alternateFind = alternate.locator('textarea[placeholder=Find]'), alternateReplace = alternate.locator('textarea[placeholder=Replace]');
            await alternateFind.fill('Shield\nChest'); await alternateReplace.fill('Bouclier\nFort');
            assert.equal(await alternateFind.inputValue(), 'Shield\nChest'); assert.equal(await alternateReplace.inputValue(), 'Bouclier\nFort');
            await entry.locator('.dictTlnote summary').click();
            await entry.getByPlaceholder('Translator note (shared)', { exact: true }).fill('Translator fixture note\nSecond line');
            assert.equal(await entry.getByPlaceholder('Translator note (shared)', { exact: true }).inputValue(), 'Translator fixture note\nSecond line');
            await target.focus(); await target.press('Control+A');
            await entry.locator('.dictUseBtn').first().click();
            assert.equal(await target.inputValue(), 'Épée\nForgée', 'Use translation inserts the exact multiline main definition into the focused target');
            await target.focus(); await target.press('Control+A');
            await alternate.getByRole('button', { name: 'Use translation', exact: true }).click();
            assert.equal(await target.inputValue(), 'Bouclier\nFort', 'An alternate inserts its exact multiline raw text');
            await target.fill(original);
            await search.fill('unmatched-dictionary-fixture-query');
            assert.equal(await tools.locator('.dictionaryEntries > .editBlock').count(), 0, 'Dictionary search filters the complete list');
            await search.fill(marker); await entry.waitFor();
            await alternate.getByRole('button', { name: /^Remove alternate / }).click();
            await page.getByRole('button', { name: 'Remove alternate', exact: true }).click();
            await page.waitForFunction(id => !window.__clientFixtureApp.dictionary.find(word => word._id === id)?.alts?.length, entryId);
            await entry.locator('.dictDeleteBtn').click();
            await page.getByRole('button', { name: 'Remove entry', exact: true }).click();
            await page.waitForFunction(id => !window.__clientFixtureApp.dictionary.some(word => word._id === id), entryId);
            await search.fill('');
            const after = await page.evaluate(async () => { const vm = window.__clientFixtureApp; return { values: { ...vm.ctValues }, saved: JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)), history: (await vm._ctStore.listHistory(vm.ctWorkspace.scope, vm.ctSelection)).length, outbox: (await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length }; });
            assert.deepEqual(after, before, 'Dictionary editing/insertion leaves restored raw values, committed work, history and translation outbox unchanged');
            await tools.getByRole('button', { name: 'TM', exact: true }).click();
        };
        for (const editorMode of ['full', 'inline']) {
            if (editorMode === 'inline') {
                await workspace.getByRole('button', { name: 'Close', exact: true }).click();
                await page.waitForFunction(() => !window.__clientFixtureApp.ctEditor);
                await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.inlineEditor = true; vm.inlineSidebarVisible = true; await vm.$nextTick(); });
                await workspace.locator('.ctTable tbody > tr').filter({ has: page.getByRole('button', { name: 'record', exact: true }) }).first().click();
                assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctEditor), false, 'Inline ClientText row clicks respect the normal inline-editor preference');
                const inlineRow = workspace.locator('.ctTable tbody > tr').filter({ has: page.getByRole('button', { name: 'record', exact: true }) }).first();
                assert.equal(await inlineRow.locator('td').count(), 3, 'Inline editing stays in the three shared table columns');
                assert.equal(await inlineRow.locator('td:nth-child(3)').getByRole('textbox', { name: 'Name', exact: true }).count(), 1, 'The selected row edits translation directly in its table cell');
                assert.equal(await workspace.locator('.ctExpanded').count(), 0, 'Inline ClientText uses table cells rather than a separate expanded row');
                await workspace.locator('.ctTools').getByRole('button', { name: 'TM', exact: true }).click();
                for (const size of desktopSizes) {
                    await page.setViewportSize(size);
                    for (const theme of themes) {
                        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                        assert.equal(await inlineRow.locator('td:nth-child(2) .ctFields[data-side="source"]').count(), 1);
                        assert.equal(await inlineRow.locator('td:nth-child(3) .ctFields[data-side="translation"]').count(), 1);
                        assert.equal(await workspace.locator('.ctTools .sideTabs .tabBtn').count(), 6, 'Inline CT tools reuse the familiar sidebar tabs including Preview');
                        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), theme + ': inline CT table/tools remain inside the desktop');
                        const target = inlineRow.locator('td:nth-child(3)').getByRole('textbox', { name: 'Name', exact: true });
                        await target.scrollIntoViewIfNeeded();
                        const bounds = await target.boundingBox();
                        assert.ok(bounds && bounds.width > 80 && bounds.x >= 0 && bounds.x + bounds.width <= size.width, theme + ': inline CT target is reachable in its shared table cell');
                        const geometry = await inlineGeometry(inlineRow);
                        assert.ok(geometry.source.notes, 'Developer notes remain visible for translators');
                        assertInlineAlignment(geometry, theme + '/' + size.width + ': notes, ordinary fields and Gender');
                        await page.screenshot({ path: join(directory, `clienttext-shared-inline-${size.width}-${theme}.png`), fullPage: true });
                    }
                }
                await page.setViewportSize(desktopSizes[0]); await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), 'modern-dark');
                const description = workspace.getByRole('textbox', { name: 'Description', exact: true }), originalDescription = await description.inputValue();
                await description.fill('A long private translation line that wraps at the available desktop column width. '.repeat(5));
                assertInlineAlignment(await inlineGeometry(inlineRow), 'Wrapping translation keeps all later paired fields aligned');
                await description.fill(originalDescription);
                assertInlineAlignment(await inlineGeometry(inlineRow), 'Restoring shorter translation keeps paired fields aligned');
            }
            await checkDictionaryControls(editorMode);
            const otherFields = await page.evaluate(() => {
                const vm = window.__clientFixtureApp;
                return Object.fromEntries(Object.entries(vm.ctValues).filter(([id]) => id !== JSON.stringify(['Name', null])));
            });
            await name.fill('A private ' + editorMode + ' draft');
            await memoryMatch.locator('pre').first().click();
            assert.equal(await name.inputValue(), 'A private ' + editorMode + ' draft', 'One click does not insert a ClientText memory');
            await memoryMatch.locator('pre').last().dblclick();
            assert.equal(await name.inputValue(), 'Épée', editorMode + ': a TM match double-click inserts into the focused Name field');
            assert.deepEqual(await page.evaluate(() => {
                const vm = window.__clientFixtureApp;
                return Object.fromEntries(Object.entries(vm.ctValues).filter(([id]) => id !== JSON.stringify(['Name', null])));
            }), otherFields, 'Other target fields retain their drafts');
            await page.evaluate(() => window.__clientFixtureApp.ctFlushDraft());
            const appliedMemory = await page.evaluate(async () => {
                const vm = window.__clientFixtureApp, draft = await vm._ctStore.getDraft(vm.ctWorkspace.scope, vm.ctSelection);
                return { saved: JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)),
                    history: (await vm._ctStore.listHistory(vm.ctWorkspace.scope, vm.ctSelection)).length,
                    outbox: (await vm._ctStore.getOutbox(vm.ctWorkspace.scope)).length,
                    target: draft?.values[JSON.stringify(['Name', null])], dirty: vm.ctDraftDirty };
            });
            assert.deepEqual(appliedMemory, { ...beforeMemory, target: 'Épée', dirty: true }, 'TM insertion persists only a private draft');
        }
        results.push('ClientText TM double-click inserts into the focused target in full and inline editors; one click preserves typing, other fields and committed work stay unchanged');
        results.push('Full/inline Dictionary keeps search, pagination, Add, scope, alternates, notes, history and deletion controls; all CT text fields preserve raw newlines and explicit main/alternate insertion stays private');
        await workspace.getByRole('button', { name: 'complete', exact: true }).click();
        await page.waitForFunction(() => window.__clientFixtureApp.ctCurrentUnit?.recordId === 'complete' && !window.__clientFixtureApp.ctBusy);
        const beforePreview = await page.evaluate(async () => { const vm = window.__clientFixtureApp; return { values: JSON.stringify(vm.ctValues), saved: JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)) }; });
        await workspace.getByRole('textbox', { name: 'Description', exact: true }).focus();
        const fullPreview = workspace.locator('#ctFullEditorPreviewHost');
        await fullPreview.locator('.gamePreviewStrip').waitFor();
        assert.equal(await fullPreview.locator('.gamePreviewWindow').count(), 2, 'Full ClientText preview shows English and translation using the shared renderer');
        await fullPreview.getByRole('textbox', { name: 'Variable {0:+d}', exact: true }).fill('37');
        assert.deepEqual(await fullPreview.locator('.gamePreviewVarValue').allTextContents(), ['37', '37'], 'The shared {} input resolves the complete SD-format variable identity in both preview frames');
        await fullPreview.getByRole('button', { name: 'Small', exact: true }).click();
        assert.equal(await fullPreview.locator('.gamePreviewWindow--s').count(), 2);
        await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.hideSourceInPreviewPanel = true; await vm.$nextTick(); });
        assert.equal(await fullPreview.locator('.gamePreviewWindow').count(), 1, 'Hide-source setting also controls ClientText preview');
        await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.hideSourceInPreviewPanel = false; await vm.$nextTick(); });
        await fullPreview.getByRole('button', { name: 'Medium', exact: true }).click();
        await workspace.getByRole('button', { name: 'Close', exact: true }).click();
        await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.inlineEditor = true; vm.inlineSidebarVisible = true; await vm.$nextTick(); });
        await workspace.locator('.ctTable > tbody > tr').filter({ has: page.getByRole('button', { name: 'complete', exact: true }) }).click();
        await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return vm.ctCurrentUnit?.recordId === 'complete' && !vm.ctEditor && !vm.ctBusy && !vm._ctSelectRun?.pending; });
        await workspace.getByRole('textbox', { name: 'Description', exact: true }).focus();
        assertInlineAlignment(await inlineGeometry(workspace.locator('.ctTable > tbody > tr').filter({ has: page.getByRole('button', { name: 'complete', exact: true }) })), 'Ordinary multi-field record without developer notes');
        await workspace.locator('.ctTools').getByRole('button', { name: 'Preview', exact: true }).click();
        const inlinePreview = workspace.locator('#ctInlineEditorPreviewHost');
        await inlinePreview.locator('.gamePreviewStrip').waitFor();
        await inlinePreview.getByRole('textbox', { name: 'Variable {0:+d}', exact: true }).fill('84');
        assert.deepEqual(await inlinePreview.locator('.gamePreviewVarValue').allTextContents(), ['84', '84']);
        await page.screenshot({ path: join(directory, 'clienttext-inline-game-preview.png'), fullPage: true });
        await workspace.getByRole('button', { name: 'complete', exact: true }).click();
        await page.waitForFunction(() => window.__clientFixtureApp.ctEditor);
        assert.equal(await fullPreview.getByRole('textbox', { name: 'Variable {0:+d}', exact: true }).inputValue(), '84', 'Same-field inline/full handoff preserves preview variables');
        const afterPreview = await page.evaluate(async () => { const vm = window.__clientFixtureApp; return { values: JSON.stringify(vm.ctValues), saved: JSON.stringify(await vm._ctStore.getSaved(vm.ctWorkspace.scope)) }; });
        assert.deepEqual(afterPreview, beforePreview, 'Preview and {} inputs never change raw targets or committed translation work');
        await page.screenshot({ path: join(directory, 'clienttext-full-game-preview.png'), fullPage: true });
        results.push('Full and inline ClientText reuse game preview and {} variables; frame sizing/hide-source work and preview changes preserve raw translations/Saved state');
        await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.inlineEditor = false; await vm.$nextTick(); });
        await workspace.getByRole('textbox', { name: 'Name', exact: true }).fill('Bouclier brouillon');
        await workspace.getByRole('button', { name: 'Close', exact: true }).click();
        await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
        await bootstrap(); await page.waitForFunction(() => window.__clientFixtureApp.ctLocalWorkspaces.length === 1); await openCached();
        await navigation.getByRole('button', { name: 'Normal', exact: true }).click();
        await workspace.getByRole('button', { name: 'complete', exact: true }).click();
        await page.waitForFunction(() => window.__clientFixtureApp.ctDraftDirty);
        assert.equal(await workspace.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Bouclier brouillon', 'Draft survives reload in real IndexedDB');
        assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctStatus().saved), false, 'Recovered draft is not committed Saved work');
        await workspace.getByRole('textbox', { name: 'Name', exact: true }).fill('Bouclier');
        await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
        await page.waitForFunction(() => !window.__clientFixtureApp.ctEditor && !window.__clientFixtureApp.ctBusy);
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
        await page.waitForFunction(() => !window.__clientFixtureApp.ctEditor && !window.__clientFixtureApp.ctBusy);
        await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.inlineEditor = true; vm.inlineSidebarVisible = false; await vm.$nextTick(); });
        await workspace.locator('.ctTable > tbody > tr').filter({ has: page.getByRole('button', { name: 'form', exact: true }) }).click();
        await page.waitForFunction(() => window.__clientFixtureApp.ctCurrentUnit?.recordId === 'form' && !window.__clientFixtureApp.ctEditor && !window.__clientFixtureApp.ctBusy);
        const inlineFormGrid = workspace.locator('.ctTable .ctFormGrid'), inlineFormRow = inlineFormGrid.locator('tbody > tr').first();
        for (const size of desktopSizes) {
            await page.setViewportSize(size);
            for (const theme of themes) {
                await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                await inlineFormRow.hover();
                const formStyles = await inlineFormRow.evaluate(row => ({ cursor: getComputedStyle(row).cursor,
                    rowShadow: getComputedStyle(row).boxShadow,
                    headerLines: (() => { const range = document.createRange(); range.selectNodeContents(row.closest('table').querySelector('thead th')); return range.getClientRects().length; })(),
                    cells: Array.from(row.children).map(cell => ({ padding: getComputedStyle(cell).padding, shadow: getComputedStyle(cell).boxShadow })) }));
                assert.notEqual(formStyles.cursor, 'pointer', 'Nested form rows do not inherit the outer file-row click cursor');
                assert.equal(formStyles.rowShadow, 'none', 'Nested form rows do not receive the outer hover frame');
                assert.equal(formStyles.headerLines, 1, theme + ': Form heading stays on one line');
                assert.ok(formStyles.cells.every(cell => cell.padding === '5px' && cell.shadow === 'none'), theme + ': form cells retain compact padding without the file-grid hover frame');
                assertInlineAlignment(await inlineGeometry(workspace.locator('.ctTable > tbody > tr').filter({ has: page.getByRole('button', { name: 'form', exact: true }) })), theme + '/' + size.width + ': six-form group');
                assert.equal(await workspace.getByText('NONEXISTENT: type a prefix and press Tab', { exact: true }).count(), 0, 'Typing guidance stays absent from translation fields');
                await page.screenshot({ path: join(directory, `clienttext-shared-inline-gender-${size.width}-${theme}.png`), fullPage: true });
            }
        }
        results.push('Inline notes, ordinary multi-field records, Gender enum and six-form groups stay paired across desktop themes; wrapping text grows/shrinks both controls together and Form headers never wrap');
        await workspace.getByRole('button', { name: 'form', exact: true }).click();
        await page.waitForFunction(() => window.__clientFixtureApp.ctEditor);
        await workspace.getByRole('button', { name: 'Close', exact: true }).click();
        await page.setViewportSize(desktopSizes[0]); await page.evaluate(async () => { document.documentElement.setAttribute('data-theme', 'modern-dark'); const vm = window.__clientFixtureApp; vm.inlineEditor = false; await vm.$nextTick(); });
        await navigation.getByRole('button', { name: 'Nouns', exact: true }).click(); await workspace.getByRole('button', { name: 'noun', exact: true }).click();
        await workspace.getByRole('combobox', { name: 'Gender', exact: true }).selectOption('M');
        await workspace.getByRole('button', { name: 'Save & close', exact: true }).click();
        await page.waitForFunction(() => !window.__clientFixtureApp.ctEditor && !window.__clientFixtureApp.ctBusy);
        for (const size of desktopSizes) {
            await page.setViewportSize(size);
            for (const theme of themes) {
                await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                await navigation.getByRole('button', { name: 'Normal', exact: true }).click(); await workspace.getByRole('button', { name: 'record', exact: true }).click();
                const bounds = await workspace.getByRole('textbox', { name: 'Name', exact: true }).boundingBox();
                assert.ok(bounds && bounds.width > 140 && bounds.height > 30 && bounds.x >= 0 && bounds.x + bounds.width <= size.width, theme + ': editable text fits the shared full editor');
                assert.ok(await workspace.locator('.editorTextField').count() > 0, 'CT source/target fields reuse the shared field presentation');
                const sourceBounds = await workspace.locator('textarea[readonly],input[readonly]').evaluateAll(elements => {
                    const source = elements.find(element => element.value === 'Sword'); if (!source) return null;
                    const box = source.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, height: box.height, bottom: box.bottom };
                });
                assert.ok(sourceBounds && sourceBounds.right <= bounds.x, 'Readonly English is on the left of the editable translation in the shared full-editor block');
                assert.ok(Math.abs(sourceBounds.y - bounds.y) <= 1 && Math.abs(sourceBounds.height - bounds.height) <= 1, 'Full-editor English and translation inputs share aligned tops and heights');
                assert.deepEqual((await workspace.locator('.ctTools .sideTabs .tabBtn').allTextContents()).map(text => text.replace(/[📚🕒]/gu, '').trim()), ['Dictionary', 'Lookup', 'TM', 'History', 'Comments']);
                assert.equal(await workspace.locator('.side.fixed.editorSidebarHost').count(), 1);
                assert.match(await workspace.locator('.editorActions h1').textContent(), /Translation/);
                await page.screenshot({ path: join(directory, `clienttext-shared-full-${size.width}-${theme}.png`), fullPage: true });
                await workspace.getByRole('button', { name: 'Close', exact: true }).click();
                await navigation.getByRole('button', { name: 'Words_Gender', exact: true }).click(); await workspace.getByRole('button', { name: 'form', exact: true }).click();
                const formBounds = await workspace.getByRole('textbox', { name: 'Text FS', exact: true }).boundingBox();
                assert.ok(formBounds && formBounds.width > 80 && formBounds.x >= 0 && formBounds.x + formBounds.width <= size.width, theme + ': six-form text fits the shared full editor');
                const fullFormSource = await workspace.getByRole('textbox', { name: 'Text English', exact: true }).boundingBox(), fullFormGrid = await workspace.locator('.ctFormGrid').boundingBox();
                assert.ok(fullFormSource && fullFormGrid && fullFormSource.x + fullFormSource.width <= fullFormGrid.x, 'Gender source stays in the left English column beside its six-form translation grid');
                await page.screenshot({ path: join(directory, `clienttext-shared-gender-${size.width}-${theme}.png`), fullPage: true });
                await workspace.getByRole('button', { name: 'Close', exact: true }).click();
            }
        }
        await page.setViewportSize(desktopSizes[0]); await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), 'modern-dark');
        await navigation.getByRole('button', { name: 'Normal', exact: true }).click(); await workspace.getByRole('button', { name: 'record', exact: true }).click();
        await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return vm.ctEditor && vm.ctCurrentUnit?.recordId === 'record' && !vm.ctBusy && !vm._ctSelectRun?.pending; });
        await page.evaluate(async () => {
            const vm = window.__clientFixtureApp;
            window.__fixtureToolContent = { units: vm.ctUnits, comments: vm.ctComments, tool: vm.ctTool, lookup: vm.ctLookup, focusedField: vm.ctFocusedField };
            const template = vm.ctUnits.find(unit => unit.recordId === 'complete');
            vm.ctUnits = Vue.markRaw([...vm.ctUnits, ...Array.from({ length: 40 }, (_, index) => ({ ...template,
                id: 'fixture-lookup-' + index, recordId: 'fixture-lookup-' + index,
                fields: template.fields.map(field => ({ ...field, source: 'Fixture lookup source ' + index,
                    target: 'Fixture lookup translation ' + index + '\n' + 'A long reference result. '.repeat(15) })) }))]);
            vm.ctLookup = 'Fixture lookup source';
            vm.ctFocusedField = JSON.stringify(['Name', null]);
            vm.ctComments = Array.from({ length: 100 }, (_, index) => ({ id: 'fixture-comment-' + index,
                authorName: 'Fixture author', audience: 'language', text: 'Fixture comment ' + index + '\n' + 'A long scoped comment. '.repeat(15) }));
            await vm.$nextTick();
        });
        const tools = workspace.locator('.ctTools');
        assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctLookupResults.length), 40, 'Long Lookup fixture is scoped to the focused text field');
        for (const size of desktopSizes) {
            await page.setViewportSize(size);
            for (const theme of themes) {
                await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                await tools.getByRole('button', { name: 'Lookup', exact: true }).click();
                const lookupResults = tools.locator('.lookupResults');
                await lookupResults.evaluate(async element => { await new Promise(requestAnimationFrame); element.scrollTop = element.scrollHeight; await new Promise(requestAnimationFrame); });
                const lookupGeometry = await lookupResults.evaluate(element => {
                    const box = element.getBoundingClientRect(), last = element.lastElementChild.getBoundingClientRect();
                    return { scrollable: element.scrollHeight > element.clientHeight, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollTop: element.scrollTop,
                        top: box.top, bottom: box.bottom, lastTop: last.top, lastBottom: last.bottom };
                });
                await page.screenshot({ path: join(directory, `clienttext-shared-lookup-${size.width}-${theme}.png`), fullPage: true });
                assert.ok(lookupGeometry.scrollable && lookupGeometry.lastTop >= lookupGeometry.top - 1 && lookupGeometry.lastBottom <= lookupGeometry.bottom + 1, 'The last long Lookup result remains reachable by its own scroll area: ' + JSON.stringify(lookupGeometry));
                await tools.getByRole('button', { name: 'Comments', exact: true }).click();
                const commentsList = tools.locator('.commentsList');
                const beforeScrollComposer = await tools.getByRole('textbox', { name: 'Comment', exact: true }).boundingBox();
                await commentsList.evaluate(async element => { await new Promise(requestAnimationFrame); element.scrollTop = element.scrollHeight; await new Promise(requestAnimationFrame); });
                const commentsGeometry = await commentsList.evaluate(element => {
                    const box = element.getBoundingClientRect(), last = element.lastElementChild.getBoundingClientRect();
                    return { scrollable: element.scrollHeight > element.clientHeight, top: box.top, bottom: box.bottom, lastTop: last.top, lastBottom: last.bottom };
                });
                const composer = await tools.getByRole('textbox', { name: 'Comment', exact: true }).boundingBox();
                assert.ok(commentsGeometry.scrollable && commentsGeometry.lastTop >= commentsGeometry.top - 1 && commentsGeometry.lastBottom <= commentsGeometry.bottom + 1, 'The last scoped comment remains reachable by its own scroll area');
                assert.ok(composer && Math.abs(composer.y - beforeScrollComposer.y) < 1 && composer.y >= commentsGeometry.bottom && composer.y + composer.height <= size.height, 'The comment composer stays visible and fixed while comments scroll');
                for (const button of await tools.locator('.sideTabs .tabBtn').all()) {
                    const bounds = await button.boundingBox(); assert.ok(bounds && bounds.y >= 0 && bounds.x >= 0 && bounds.x + bounds.width <= size.width, 'Shared tool tabs remain visible in the resized full editor');
                }
                await page.screenshot({ path: join(directory, `clienttext-shared-comments-${size.width}-${theme}.png`), fullPage: true });
            }
        }
        await page.evaluate(async () => {
            const vm = window.__clientFixtureApp, previous = window.__fixtureToolContent;
            vm.ctUnits = previous.units; vm.ctComments = previous.comments; vm.ctTool = previous.tool; vm.ctLookup = previous.lookup; vm.ctFocusedField = previous.focusedField;
            delete window.__fixtureToolContent; await vm.$nextTick();
        });
        await workspace.getByRole('button', { name: 'Close', exact: true }).click();
        await page.setViewportSize(desktopSizes[0]); await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), 'modern-dark');
        results.push('Shared full-editor Lookup and Comments keep long content in inner scroll areas, last entries reachable, and composer/tool tabs visible in both desktop widths and all themes');
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
        assert.equal(get(parsedNormal, 'visible-raw', 'Name').source, visibilityFields.Name, 'Export preserves exact whitespace/newlines around visible English');
        assert.equal(get(parsedNormal, 'visible-raw', 'Description').target, 'Hidden empty-source translation', 'Hidden empty-English translation survives export');
        assert.equal(get(parsedNormal, 'visible-raw', 'Unused').source, visibilityFields.Unused, 'Whitespace-only source is preserved in the workbook');
        assert.equal(get(parsedNormal, 'visible-raw', 'Unused').target, 'Hidden whitespace-source translation');
        assert.equal(get(parsedNormal, 'empty-english', 'Name').target, 'Hidden all-empty row translation', 'Entirely hidden rows survive export');
        assert.equal(get(parsedNormal, 'empty-english', 'Description').target, 'Hidden all-whitespace row translation');
        assert.equal(get(parsedGender, 'form', 'Text', 'FS').target, 'Forte'); assert.equal(get(parsedGender, 'noun', 'Gender').target, 'M');
        for (const file of files) {
            const output = await JSZip.loadAsync(await archive.file(file.name).async('uint8array'));
            assert.deepEqual(await output.file('xl/vbaProject.bin').async('uint8array'), new Uint8Array([1, 9, 255]));
            assert.deepEqual(await output.file('xl/metadata').async('uint8array'), new Uint8Array([0, 255, 8, 99]));
        }
        const retained = await page.evaluate(async () => { const vm = window.__clientFixtureApp, assets = await Promise.all(['normal', 'gender'].map(role => vm._ctStore.getAsset(vm.ctWorkspace.scope, role))); return assets.map(asset => ({ role: asset.role, size: asset.blob.size, units: asset.parsed.units || null })); });
        assert.deepEqual(retained, files.map((file, index) => ({ role: index ? 'gender' : 'normal', size: file.buffer.length, units: null })), 'Original blobs and immutable parsed metadata stay local');
        await navigation.getByRole('button', { name: 'Normal', exact: true }).click();
        await page.evaluate(async () => {
            const vm = window.__clientFixtureApp; window.__fixtureAutoNext = vm.autoOpenNextFile;
            vm.ctSort = 'filename'; vm.ctSortDir = 'asc'; await vm.$nextTick();
        });
        await workspace.getByRole('button', { name: 'complete', exact: true }).click();
        await workspace.getByRole('textbox', { name: 'Name', exact: true }).fill('Bouclier shortcut');
        await workspace.getByRole('textbox', { name: 'Name', exact: true }).press('F2');
        await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return !vm.ctBusy && vm.ctCurrentUnit?.recordId === 'noaudio' && vm.ctEditor; });
        assert.equal(await page.evaluate(() => { const vm = window.__clientFixtureApp, unit = vm.ctUnits.find(unit => unit.recordId === 'complete'); return vm.ctSaved[unit.id].values[JSON.stringify(['Name', null])]; }), 'Bouclier shortcut', 'F2 durably saves before opening the next record');
        for (const [key, target] of [['F1', 'complete'], ['Control+Period', 'noaudio'], ['Control+Comma', 'complete']]) {
            await workspace.getByRole('textbox', { name: 'Name', exact: true }).press(key);
            await page.waitForFunction(target => { const vm = window.__clientFixtureApp; return !vm.ctBusy && vm.ctCurrentUnit?.recordId === target && vm.ctEditor; }, target);
        }
        await page.evaluate(() => { window.__clientFixtureApp.autoOpenNextFile = true; });
        await workspace.getByRole('textbox', { name: 'Name', exact: true }).press('Control+s');
        await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return !vm.ctBusy && vm.ctCurrentUnit?.recordId === 'noaudio' && vm.ctEditor; });
        await page.evaluate(() => { window.__clientFixtureApp.autoOpenNextFile = false; });
        await workspace.getByRole('textbox', { name: 'Name', exact: true }).press('Control+s');
        await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return !vm.ctBusy && !vm.ctEditor; });
        await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.inlineEditor = true; vm.inlineSidebarVisible = false; await vm.$nextTick(); });
        await workspace.locator('.ctTable > tbody > tr').filter({ has: page.getByRole('button', { name: 'complete', exact: true }) }).click();
        await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return !vm.ctBusy && !vm._ctSelectRun?.pending && !vm.ctEditor && vm.ctCurrentUnit?.recordId === 'complete'; });
        await workspace.getByRole('textbox', { name: 'Name', exact: true }).fill('Bouclier inline shortcut');
        await workspace.getByRole('textbox', { name: 'Name', exact: true }).press('Control+s');
        await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return !vm.ctBusy && !vm.ctEditor && vm.ctCurrentUnit?.recordId === 'complete' && vm.ctSaved[vm.ctSelection]?.values[JSON.stringify(['Name', null])] === 'Bouclier inline shortcut'; });
        await workspace.getByRole('textbox', { name: 'Name', exact: true }).press('F2');
        await page.waitForFunction(() => { const vm = window.__clientFixtureApp; return !vm.ctBusy && vm.ctEditor && vm.ctCurrentUnit?.recordId === 'noaudio'; });
        await workspace.getByRole('button', { name: 'Close', exact: true }).click();
        await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.inlineEditor = false; vm.autoOpenNextFile = window.__fixtureAutoNext; delete window.__fixtureAutoNext; await vm.$nextTick(); });
        results.push('ClientText matches SD keyboard saves: F2/F1 and Ctrl+period/comma navigate; Ctrl+S follows automatic next in full mode and preserves the active inline row');
        assert.deepEqual(failures, [], 'Browser script errors');
        results.push('French pair enforcement; real worker sheet progress; immutable original workbook blobs in IndexedDB');
        results.push('Save and Save & close persist per-field values/reviews; draft survives reload without becoming Saved');
        results.push('Sheet filter, developer-note search, Gender combo box, six-form grid and NONEXISTENT completion');
        results.push('Four desktop themes; paired full-workbook download preserves macros/native metadata and gray/green/purple status fills');
        if (process.env.CLIENTTEXT_SHARED_FLOW === '1' || process.argv.includes('--shared')) {
            await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
            await page.waitForFunction(() => window.__clientFixtureApp.versionChooserVisible);
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
            await workspace.getByRole('button', { name: 'Save', exact: true }).click();
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
            const checkAssignmentTooltip = async (row, expected) => {
                const meter = row.locator('.versionProgress');
                assert.equal(await meter.getAttribute('title'), null, 'Assignment progress uses the shared tooltip without a native title');
                await meter.hover(); await page.getByRole('tooltip').waitFor();
                assert.match(await page.getByRole('tooltip').textContent(), expected);
                await meter.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
                assert.equal(await meter.evaluate(element => element === document.activeElement), true, 'Assignment progress is keyboard reachable');
                await page.getByRole('tooltip').waitFor();
                assert.match(await page.getByRole('tooltip').textContent(), expected);
                await page.mouse.move(0, 0); await meter.evaluate(element => element.blur());
            };
            for (const size of desktopSizes) {
                await page.setViewportSize(size);
                for (const theme of themes) {
                    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                    await details.scrollIntoViewIfNeeded();
                    const layout = await details.evaluate(element => {
                        const rect = node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }; };
                        const header = element.querySelector('.selectedVersionHeader'), table = element.querySelector('.contentGroupTeamTable');
                        return { panel: rect(element), header: rect(header), title: rect(header.querySelector('h2')), add: rect(header.querySelector('button')),
                            overflow: document.documentElement.scrollWidth - innerWidth, cards: element.querySelectorAll('.ctGroupCard').length,
                            tableCount: element.querySelectorAll('.teamVersionTable').length, groupSections: element.querySelectorAll('.versionContentGroup').length,
                            wrapper: rect(table.closest('.versionTableScroll')), headers: Array.from(table.querySelectorAll('th'), th => ({ text: th.textContent.replace(/[↑↓▲▼]/g, '').trim(), scope: th.scope })),
                            rowKeys: Array.from(table.querySelectorAll('tbody tr'), row => JSON.stringify([row.dataset.contentGroup, row.dataset.language])),
                            groups: Array.from(table.querySelectorAll('tr[data-language="French"]'), team => {
                                const model = window.__clientFixtureApp.ctGroups.find(candidate => candidate.id === team.dataset.contentGroup);
                                const progress = team.querySelector('.versionProgress');
                                return { id: team.dataset.contentGroup, assignment: team.querySelector('.teamEditorLink').textContent.trim(), href: team.querySelector('.teamEditorLink').getAttribute('href'),
                                    cells: team.children.length, progress: rect(progress), meter: progress.getAttribute('role'),
                                    contentMode: model.contentMode, counts: model.teams.find(candidate => candidate.language === 'French').counts,
                                    loadedText: team.querySelector('td:first-child > small').textContent.trim(), progressText: team.querySelector('.versionProgressSummary strong').textContent.trim(),
                                    progressPercent: team.querySelector('.versionProgressSummary > span')?.textContent.trim(),
                                    progressNow: progress.getAttribute('aria-valuenow'), progressMax: progress.getAttribute('aria-valuemax'), tooltip: progress.getAttribute('aria-label'),
                                    segments: Array.from(team.querySelectorAll('.versionProgressTrack > span'), span => ({ kind: span.className, width: span.style.width })),
                                    actions: Array.from(team.querySelectorAll('.versionTeamActions button'), button => ({ text: button.textContent.trim(), disabled: button.disabled, bounds: rect(button) })) };
                            }) };
                    });
                    assert.equal(layout.cards, 0, 'Content groups use the shared team table instead of cards'); assert.equal(layout.groupSections, 0);
                    assert.equal(layout.tableCount, 1, 'Both content modes share exactly one Assignment table'); assert.equal(layout.groups.length, 2);
                    assert.equal(layout.rowKeys.length, 13, 'Twelve StatDescription teams and French ClientText are shown together');
                    assert.equal(new Set(layout.rowKeys).size, 13, 'Each content group/team assignment appears once');
                    assert.deepEqual(layout.headers.map(header => header.text), ['Assignment', 'Progress', 'Online', 'Actions']);
                    assert.ok(layout.headers.every(header => header.scope === 'col'));
                    assert.ok(layout.add.x > layout.title.right && Math.abs(layout.add.right - layout.header.right) < 1, theme + ': Add content group is on the right of the selected version header');
                    assert.ok(Math.abs(layout.add.y - layout.header.y) < 1, theme + ': selected version header and action align at the top');
                    assert.ok(layout.overflow <= 1, theme + ': content table scroll is contained without widening the page');
                    assert.ok(layout.wrapper.x >= layout.panel.x && layout.wrapper.right <= layout.panel.right, 'Narrow desktop table overflow stays inside the selected version panel');
                    for (const group of layout.groups) {
                        assert.equal(group.assignment, 'French — ' + (group.contentMode === 'clienttext' ? 'ClientText' : 'StatDescription'));
                        assert.equal(group.href, '#table'); assert.equal(group.cells, 4); assert.equal(group.meter, 'meter');
                        assert.deepEqual(group.segments.map(segment => segment.kind), group.contentMode === 'clienttext' ? ['saved', 'revised', 'missing', 'outdated'] : ['saved', 'revised', 'missing'], 'Both modes share the progress bar layout, with ClientText Outdated work in orange');
                        assert.ok(group.progress.width >= 200, 'Both content modes reuse the existing readable progress meter');
                        assert.ok(['Open editor', 'Download accepted work', 'Collect and end'].every(text => group.actions.some(action => action.text === text && !action.disabled)), 'Shared table keeps the team actions available');
                        if (group.contentMode === 'clienttext') {
                            assert.equal(group.loadedText, `${group.counts.loaded ?? 0} IDs`, 'ClientText table shows the exact ID count');
                            assert.equal(group.progressText, group.counts.workloadFields ? `${group.counts.resolvedFields ?? 0} / ${group.counts.workloadFields}` : '—', 'ClientText progress uses field workload, rather than unit counts');
                            assert.equal(group.progressPercent, group.counts.workloadFields ? `${Math.round(100 * (group.counts.resolvedFields ?? 0) / group.counts.workloadFields)}%` : undefined);
                            assert.equal(group.progressNow, String(group.counts.resolvedFields ?? 0));
                            assert.equal(group.progressMax, String(Math.max(1, group.counts.workloadFields ?? 0)));
                            assert.equal(group.segments.find(segment => segment.kind === 'revised').width, '0%', 'Revised corrections remain outside the initial ClientText workload');
                        } else {
                            const total = (group.counts.missing ?? 0) + (group.counts.saved ?? 0);
                            assert.equal(group.progressText, total ? `${group.counts.saved ?? 0} / ${total}` : '—');
                            assert.equal(group.progressPercent, total ? `${Math.round(100 * (group.counts.saved ?? 0) / total)}%` : undefined);
                        }
                        const expectedWidth = Number(group.progressMax) > 1 || Number(group.progressNow) > 0 || group.progressText !== '—' ? 100 : 0;
                        assert.ok(Math.abs(group.segments.reduce((sum, segment) => sum + parseFloat(segment.width), 0) - expectedWidth) < 0.01, 'Overlapping status counts never overfill the workload bar');
                        await checkAssignmentTooltip(details.locator(`tr[data-content-group="${group.id}"][data-language="French"]`), /Only server-accepted work is counted; unsaved drafts and pending offline saves are excluded\./);
                    }
                    await page.screenshot({ path: join(directory, `clienttext-assignment-table-${size.width}-${theme}.png`), fullPage: true });
                }
            }
            await page.setViewportSize(desktopSizes[0]); await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), 'modern-dark');
            await page.evaluate(async groupId => {
                const vm = window.__clientFixtureApp; window.__fixtureOriginalDetails = vm.managedVersionDetails;
                vm.managedVersionDetails = { ...vm.managedVersionDetails, contentGroups: vm.ctGroups.map(group => group.id !== groupId ? group : { ...group, teams: group.teams.map(team => team.language !== 'French' ? team : { ...team,
                    counts: { ...team.counts, loaded: 0, total: 999, resolved: 999, workload: 999, resolvedFields: 0, workloadFields: 0 } }) }) };
                await vm.$nextTick();
            }, clientGroup.id);
            const emptyTeam = details.locator(`tr[data-content-group="${clientGroup.id}"][data-language="French"]`);
            assert.equal(await emptyTeam.locator('.versionProgressSummary strong').textContent(), '—', 'Empty field workload uses the same empty meter as StatDescription despite nonzero unit-count fallbacks');
            assert.equal(await emptyTeam.locator('td:first-child > small').first().textContent(), '0 IDs', 'Zero loaded IDs never falls back to another count');
            assert.equal(await emptyTeam.locator('.versionProgressTrack .saved').evaluate(element => element.style.width), '0%');
            assert.equal(await emptyTeam.locator('.versionProgress').getAttribute('aria-valuenow'), '0');
            assert.equal(await emptyTeam.locator('.versionProgress').getAttribute('aria-valuemax'), '1');
            assert.equal(await emptyTeam.locator('.versionProgressSummary > span').count(), 0, 'Empty meters do not display a percentage');
            await page.evaluate(async () => { const vm = window.__clientFixtureApp; vm.managedVersionDetails = window.__fixtureOriginalDetails; delete window.__fixtureOriginalDetails; await vm.$nextTick(); });
            await page.evaluate(async statGroupId => {
                const vm = window.__clientFixtureApp;
                window.__fixtureCachedModernDetails = vm.managedVersionDetails;
                vm.managedVersionDetails = { ...vm.managedVersionDetails, teams: vm.ctGroups.find(group => group.id === statGroupId).teams };
                await vm.$nextTick();
            }, statGroup.id);
            assert.equal(await details.locator('.contentGroupTeamTable tbody tr').count(), 13, 'Cached modern SD teams do not add a phantom legacy assignment');
            assert.equal(await details.locator(`tr[data-content-group="${statGroup.id}"]`).count(), 12);
            assert.equal(await details.locator(`tr[data-content-group="${clientGroup.id}"]`).count(), 1);
            assert.equal(await page.evaluate(() => window.__clientFixtureApp.ctAssignmentRows.some(row => row.legacy)), false, 'Explicit modern groups remain authoritative over cached top-level team details');
            await page.evaluate(async () => {
                const vm = window.__clientFixtureApp;
                vm.managedVersionDetails = window.__fixtureCachedModernDetails; delete window.__fixtureCachedModernDetails;
                await vm.$nextTick();
            });
            await page.evaluate(async ({ statGroupId, clientGroupId }) => {
                const vm = window.__clientFixtureApp, details = vm.managedVersionDetails;
                window.__fixtureOriginalDetails = details;
                const stat = vm.ctGroups.find(group => group.id === statGroupId), client = vm.ctGroups.find(group => group.id === clientGroupId);
                const collection = { id: 'fixture-legacy-collection-1', sequence: 1, createdAt: new Date().toISOString(), downloadReady: true, kind: 'download_only' };
                const team = { ...stat.teams.find(team => team.language === 'French'), ended: true,
                    counts: { loaded: 5, saved: 2, missing: 1, revised: 1 }, latestCollection: collection,
                    collections: [collection, { ...collection, id: 'fixture-legacy-collection-2', sequence: 2 }] };
                window.__fixtureLegacyDetails = { ...details, teams: [team], contentGroups: [client, { ...stat, legacyVersionId: details.version.id, teams: [team] }] };
                vm.managedVersionDetails = window.__fixtureLegacyDetails;
                window.__fixtureLegacyCalls = []; window.__fixtureLegacyMethods = {};
                for (const name of ['managedOpenTeam', 'managedCollect', 'managedDownloadCollection', 'managedDownloadPrevious', 'managedReopen']) {
                    window.__fixtureLegacyMethods[name] = vm[name];
                    vm[name] = (...args) => {
                        window.__fixtureLegacyCalls.push({ name, language: (name === 'managedOpenTeam' ? args[1] : args[0]).language,
                            versionId: name === 'managedOpenTeam' ? args[0].id : undefined,
                            end: name === 'managedCollect' ? args[1] !== false : undefined,
                            snapshot: name === 'managedDownloadPrevious' ? args[1].target.value : undefined });
                        return false;
                    };
                }
                await vm.$nextTick();
            }, { statGroupId: statGroup.id, clientGroupId: clientGroup.id });
            const legacyTeam = details.locator('tr[data-language="French"]').filter({ has: page.getByRole('link', { name: 'French — StatDescription', exact: true }) });
            for (const size of desktopSizes) {
                await page.setViewportSize(size);
                for (const theme of themes) {
                    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                    assert.equal(await details.locator('.teamVersionTable').count(), 1, 'Legacy StatDescription and ClientText use the same table');
                    assert.equal(await details.locator('.contentGroupTeamTable tbody tr').count(), 2, 'Legacy top-level and content-group copies appear once alongside ClientText');
                    assert.equal(await legacyTeam.count(), 1); assert.equal(await legacyTeam.getAttribute('data-content-group'), null, 'Rich legacy team details retain the legacy action path');
                    assert.equal(await legacyTeam.locator('.versionProgressSummary strong').textContent(), '2 / 3');
                    assert.equal(await legacyTeam.locator('.versionProgressSummary > span').textContent(), '67%');
                    assert.equal(await legacyTeam.locator('.versionBadge.ended').textContent(), 'Ended');
                    assert.equal(await legacyTeam.locator('.teamEditorLink').getAttribute('href'), '#table');
                    for (const name of ['Open editor', 'Download', 'Recollect', 'Download collection', 'Reopen']) assert.equal(await legacyTeam.getByRole('button', { name, exact: true }).isEnabled(), true, 'Legacy action remains available: ' + name);
                    assert.equal(await legacyTeam.getByRole('combobox', { name: 'Download previous snapshot', exact: true }).count(), 1);
                    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), theme + ': legacy mixed table stays within the resized desktop');
                    await checkAssignmentTooltip(legacyTeam, /Revised: 1 \(included in Saved\)/);
                    if (theme === 'modern-dark') await page.screenshot({ path: join(directory, `clienttext-legacy-assignment-table-${size.width}-${theme}.png`), fullPage: true });
                }
            }
            await legacyTeam.getByRole('link', { name: 'French — StatDescription', exact: true }).click();
            for (const name of ['Open editor', 'Download', 'Recollect', 'Download collection', 'Reopen']) await legacyTeam.getByRole('button', { name, exact: true }).click();
            await legacyTeam.getByRole('combobox', { name: 'Download previous snapshot', exact: true }).selectOption('fixture-legacy-collection-2');
            const legacyCalls = await page.evaluate(() => window.__fixtureLegacyCalls);
            assert.deepEqual(legacyCalls.map(call => call.name), ['managedOpenTeam', 'managedOpenTeam', 'managedCollect', 'managedCollect', 'managedDownloadCollection', 'managedReopen', 'managedDownloadPrevious']);
            assert.ok(legacyCalls.every(call => call.language === 'French'));
            assert.ok(legacyCalls.filter(call => call.name === 'managedOpenTeam').every(call => call.versionId === draftVersionId));
            assert.deepEqual(legacyCalls.filter(call => call.name === 'managedCollect').map(call => call.end), [false, true]);
            assert.equal(legacyCalls.at(-1).snapshot, 'fixture-legacy-collection-2');
            await page.evaluate(async () => {
                const vm = window.__clientFixtureApp;
                vm.managedVersionDetails = { ...window.__fixtureLegacyDetails, contentGroups: [] };
                await vm.$nextTick();
            });
            assert.equal(await legacyTeam.count(), 1, 'An old API with no content groups still supplies the StatDescription assignment');
            assert.equal(await details.locator('.contentGroupTeamTable tbody tr').count(), 1);
            await page.evaluate(async () => {
                const vm = window.__clientFixtureApp;
                vm.managedVersionDetails = { ...window.__fixtureLegacyDetails, teams: [] }; await vm.$nextTick();
            });
            assert.equal(await legacyTeam.count(), 1, 'A group-only legacy response still supplies the StatDescription assignment');
            assert.equal(await legacyTeam.getAttribute('data-content-group'), statGroup.id);
            await legacyTeam.getByRole('link', { name: 'French — StatDescription', exact: true }).click();
            assert.equal(await page.evaluate(() => window.__fixtureLegacyCalls.at(-1).name), 'managedOpenTeam', 'A legacy content-group row retains the legacy editor action');
            await page.evaluate(async () => {
                const vm = window.__clientFixtureApp;
                for (const [name, method] of Object.entries(window.__fixtureLegacyMethods)) vm[name] = method;
                vm.managedVersionDetails = window.__fixtureOriginalDetails;
                for (const name of ['__fixtureOriginalDetails', '__fixtureLegacyDetails', '__fixtureLegacyCalls', '__fixtureLegacyMethods']) delete window[name];
                await vm.$nextTick();
            });
            await page.setViewportSize(desktopSizes[0]); await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), 'modern-dark');
            results.push('Combined Assignment table avoids phantom rows from cached modern teams and preserves deduplicated legacy API/group fallback, editor links, collections, snapshot selector and reopening at both desktop widths in all four themes');
            await details.getByRole('button', { name: 'Add content group', exact: true }).click();
            await upload.waitFor(); assert.match(await upload.locator('h2').textContent(), /Add content groups to Shared ClientText fixture/);
            await upload.getByRole('button', { name: 'Close', exact: true }).click();
            results.push('One Assignment table combines Language — Mode rows at two desktop sizes in all four themes; CT/SD share fraction/percentage layout, hover and keyboard tooltips, exact field workload and empty meters; header action opens the content uploader');
            const statTeam = details.locator('tr[data-content-group="' + statGroup.id + '"][data-language="French"]');
            await statTeam.getByRole('button', { name: 'Open editor', exact: true }).click();
            await page.waitForFunction(groupId => { const vm = window.__clientFixtureApp; return vm.sourceLoaded && !vm.ctActive && vm.activeContentGroup?.id === groupId && !vm.workspaceInitializationActive; }, statGroup.id);
            for (const size of desktopSizes) {
                await page.setViewportSize(size);
                for (const theme of themes) {
                    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                    const statChrome = await page.locator('.workspace').evaluate(readWorkspaceChrome);
                    assert.deepEqual(clientChrome.get(size.width + ':' + theme), statChrome, theme + ': ClientText and StatDescription reuse the same header, search input, table-heading and footer presentation');
                    await page.screenshot({ path: join(directory, `statdescription-shared-table-${size.width}-${theme}.png`), fullPage: true });
                }
            }
            await page.setViewportSize(desktopSizes[0]); await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), 'modern-dark');
            results.push('ClientText and StatDescription share header/search/filter/table/footer presentation at two desktop widths in all four themes; ClientText preserves worksheet navigation and exact field workload');
            await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
            await page.getByRole('button', { name: '📚 Dictionary', exact: true }).click();
            const statDictionary = page.locator('#fullEditorSidebarHost .dictionaryEntries');
            await page.locator('#fullEditorSidebarHost').getByRole('button', { name: 'Add entry', exact: true }).click();
            const statEntryId = await page.evaluate(() => window.__clientFixtureApp.dictionaryEditingId), statEntry = statDictionary.locator('.editBlock[data-dict-id="' + statEntryId + '"]');
            await statEntry.locator('.dictRow input[placeholder=Find]').waitFor();
            assert.equal(await statEntry.locator('.dictRow input[placeholder=Find],.dictRow input[placeholder=Replace]').count(), 2, 'StatDescription retains the existing shared Dictionary input branch');
            assert.equal(await statEntry.locator('.dictRow textarea').count(), 0, 'CT-specific multiline Dictionary controls do not replace SD controls');
            await statEntry.locator('.dictDeleteBtn').click(); await page.getByRole('button', { name: 'Remove entry', exact: true }).click();
            await page.waitForFunction(id => !window.__clientFixtureApp.dictionary.some(word => word._id === id), statEntryId);
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
            const openVersionGroup = async (versionName, groupId) => {
                if (await workspace.isVisible()) await workspace.getByRole('button', { name: 'Versions', exact: true }).click();
                else await page.locator('.workspaceFooter .versionStatusName').click();
                await page.waitForFunction(() => window.__clientFixtureApp.versionChooserVisible);
                await page.getByRole('button', { name: versionName, exact: true }).click();
                await details.locator('tr[data-content-group="' + groupId + '"][data-language="French"]').getByRole('button', { name: 'Open editor', exact: true }).click();
            };
            for (const size of desktopSizes) {
                await page.setViewportSize(size);
                for (const theme of themes) {
                    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                    assert.equal(await page.getByRole('navigation', { name: 'StatDescription directories' }).count(), 0, 'StatDescription has no left directory pane');
                    assert.equal(await page.locator('.ctDirectoryPane').count(), 0);
                    assert.equal(await page.locator('.workspaceHeader').getByRole('combobox', { name: 'Content group', exact: true }).count(), 0, 'Content groups are selected through Versions instead of the workspace header');
                    const layout = await page.locator('.workspaceContent').evaluate(element => {
                        const box = element.getBoundingClientRect(), styles = getComputedStyle(element), table = element.querySelector('.fileTableScroll').getBoundingClientRect();
                        return { left: box.left + parseFloat(styles.paddingLeft), right: box.right - parseFloat(styles.paddingRight),
                            tableLeft: table.left, tableRight: table.right,
                            overflow: document.documentElement.scrollWidth - innerWidth };
                    });
                    assert.ok(Math.abs(layout.tableLeft - layout.left) <= 1 && Math.abs(layout.tableRight - layout.right) <= 1, theme + ': StatDescription file list uses the available content width');
                    assert.ok(layout.overflow <= 1, theme + ': resized StatDescription workspace stays within the desktop width');
                }
            }
            await page.setViewportSize(desktopSizes[0]); await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), 'modern-dark');
            await page.evaluate(async () => {
                const vm = window.__clientFixtureApp;
                window.__fixtureInlineSidebarVisible = vm.inlineSidebarVisible;
                vm.inlineEditor = true; vm.inlineSidebarVisible = false; await vm.$nextTick();
            });
            await page.getByRole('button', { name: 'Show file tools', exact: true }).click();
            assert.equal(await page.getByRole('complementary', { name: 'Selected file tools', exact: true }).isVisible(), true, 'Inline SD keeps its selected-file tools sidebar');
            const inlineLayout = await page.locator('.workspaceContent').evaluate(element => {
                const main = element.querySelector('.workspaceMain').getBoundingClientRect(), table = element.querySelector('.fileTableScroll').getBoundingClientRect();
                const sidebar = element.querySelector('#inlineEditorSidebar').getBoundingClientRect();
                return { mainLeft: main.left, mainRight: main.right, tableLeft: table.left, tableRight: table.right, sidebarLeft: sidebar.left };
            });
            assert.ok(Math.abs(inlineLayout.tableLeft - inlineLayout.mainLeft) <= 1 && Math.abs(inlineLayout.tableRight - inlineLayout.mainRight) <= 1, 'Inline SD uses its main column without a left directory pane');
            assert.ok(inlineLayout.mainRight < inlineLayout.sidebarLeft, 'Selected-file tools remain in the separate right column');
            const sdPairs = await page.locator('#table > tbody > tr[data-filepath]').first().evaluate(async row => {
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const pairs = new Map();
                for (const block of row.querySelectorAll('[data-inline-block]')) {
                    const bounds = block.getBoundingClientRect(), key = block.dataset.inlineBlock;
                    if (!pairs.has(key)) pairs.set(key, []); pairs.get(key).push({ side: block.dataset.inlineSide, y: bounds.y, height: bounds.height });
                }
                return [...pairs];
            });
            assert.ok(sdPairs.length >= 2, 'StatDescription retains its shared context and content block alignment');
            for (const [key, pair] of sdPairs) {
                assert.equal(pair.length, 2, 'StatDescription paired block ' + key);
                assert.ok(Math.abs(pair[0].y - pair[1].y) <= 1 && Math.abs(pair[0].height - pair[1].height) <= 1, 'StatDescription shared block geometry remains aligned ' + key);
            }
            assert.equal(await page.locator('.ctDirectoryPane').count(), 0);
            await page.getByRole('button', { name: 'Hide file tools', exact: true }).click();
            assert.equal(await page.getByRole('complementary', { name: 'Selected file tools', exact: true }).count(), 0);
            const inlineFullWidth = await page.locator('.workspaceContent').evaluate(element => {
                const box = element.getBoundingClientRect(), styles = getComputedStyle(element), table = element.querySelector('.fileTableScroll').getBoundingClientRect();
                return Math.abs(table.left - box.left - parseFloat(styles.paddingLeft)) <= 1 && Math.abs(table.right - box.right + parseFloat(styles.paddingRight)) <= 1;
            });
            assert.equal(inlineFullWidth, true, 'Hiding inline file tools returns the full content width to the SD file list');
            await page.evaluate(async () => {
                const vm = window.__clientFixtureApp;
                vm.inlineEditor = false; vm.inlineSidebarVisible = window.__fixtureInlineSidebarVisible;
                delete window.__fixtureInlineSidebarVisible; await vm.$nextTick();
            });
            await openVersionGroup('Shared ClientText fixture', clientGroup.id);
            await workspace.waitFor(); await page.waitForFunction(() => !window.__clientFixtureApp.ctBusy);
            assert.equal(await navigation.count(), 1, 'ClientText keeps its left workbook-sheet pane');
            assert.equal(await workspace.getByRole('combobox', { name: 'Content group', exact: true }).count(), 0, 'ClientText also selects content through the Versions assignment table');
            await navigation.getByRole('button', { name: 'Normal', exact: true }).click(); await workspace.getByRole('button', { name: 'record', exact: true }).click();
            assert.equal(await workspace.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'En ligne', 'ClientText work survives StatDescription switching');
            await workspace.getByRole('button', { name: 'Close', exact: true }).click();
            await openVersionGroup('Shared ClientText fixture', statGroup.id);
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
            results.push('Same version adds a StatDescription group for all teams; SD uses available width without a directory pane, Versions assignment rows switch CT↔SD while preserving both workspaces and proof-backed SD save/collection');
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
            const secondTeam = details.locator('tr[data-content-group="' + secondGroup.id + '"][data-language="French"]');
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
            await workspace.getByRole('button', { name: 'Close', exact: true }).click();
            await openVersionGroup('Gap version C: matching content returns', gapCStat.id);
            await page.waitForFunction(groupId => { const vm = window.__clientFixtureApp, state = vm._collaboration?.snapshot({ includeFiles: false }); return !vm.ctActive && vm.activeContentGroup?.id === groupId && !vm.workspaceInitializationActive && state?.connected && !state.pending; }, gapCStat.id);
            await page.getByRole('button', { name: 'Open full editor for fire.txt', exact: true }).click();
            assert.equal(await translation.inputValue(), 'Dégâts de feu du nouveau groupe', 'Returning SD content carries the latest matching accepted work');
            await page.locator('.editorActions').getByRole('button', { name: 'Close', exact: true }).click();
            await page.waitForFunction(() => !window.__clientFixtureApp.editorSessionActive);
            results.push('Matching CT/SD parent discovery crosses an omitted-content version and limited catalog; changed English retains carried work as Outdated with a verified previous-version comparison');
        }
        if (process.argv.includes('--large-journal')) {
            const journalId = 'fixture-large-' + randomUUID();
            const scope = await page.evaluate(() => window.__clientFixtureApp.ctScope('fixture-large-version', 'fixture-large-group', 'French'));
            const measured = await page.evaluate(async ({ scope, journalId }) => {
                const vm = window.__clientFixtureApp, text = 'ก'.repeat(32768), rows = 4500;
                const payload = { kind: 'publication', name: 'Large publication checkpoint fixture', groups: [{ language: 'French', contentMode: 'clienttext', carryOffset: 120,
                    carry: Array.from({ length: rows }, (_, index) => ({ id: String(index), text: String(index) + ':' + text })) }] };
                const inlineBytes = payload.groups[0].carry.reduce((sum, row) => sum + row.text.length * 2, 0);
                if (inlineBytes <= 257949696) throw new Error('The fixture must exceed Chromium’s old single-value limit.');
                const originalPut = IDBObjectStore.prototype.put; let maxPutBytes = 0, writes = 0;
                const weight = value => typeof value === 'string' ? value.length * 2 + 32 : value && typeof value === 'object'
                    ? Object.entries(value).reduce((sum, [key, item]) => sum + key.length * 2 + 48 + weight(item), 128) : 24;
                IDBObjectStore.prototype.put = function (value, ...args) {
                    if (this.name === ClientTextStore.stores.requests) {
                        maxPutBytes = Math.max(maxPutBytes, weight(value)); writes++;
                        if (maxPutBytes > 4 * 1024 * 1024 + 65536) throw new Error('The fixture observed an unbounded publication journal put.');
                    }
                    return originalPut.call(this, value, ...args);
                };
                let header;
                try { header = await vm._ctStore.putRequest(scope, journalId, payload); }
                finally { IDBObjectStore.prototype.put = originalPut; }
                return { inlineBytes, maxPutBytes, writes, carryInline: header.payload.groups[0].carry.length, fragments: header.storage?.parts.reduce((sum, part) => sum + part.chunkIds.length, 0), rows };
            }, { scope, journalId });
            assert.ok(measured.inlineBytes > 257949696); assert.equal(measured.carryInline, 0); assert.ok(measured.fragments > 1);
            await bootstrap();
            const resumed = await page.evaluate(async ({ scope, journalId }) => {
                const vm = window.__clientFixtureApp, checkpoint = await vm._ctStore.getRequest(scope, journalId), rows = checkpoint.payload.groups[0].carry;
                if (rows.length !== 4500 || rows[0].text !== '0:' + 'ก'.repeat(32768) || rows.at(-1).text !== '4499:' + 'ก'.repeat(32768)) throw new Error('The large checkpoint did not hydrate exactly after reload.');
                const oldOffset = checkpoint.payload.groups[0].carryOffset; checkpoint.payload.groups[0].carryOffset = 121;
                const originalPut = IDBObjectStore.prototype.put; let puts = 0, interrupted = false;
                IDBObjectStore.prototype.put = function (value, ...args) {
                    if (this.name === ClientTextStore.stores.requests && String(value.scope).includes('request-fragments') && ++puts === 3) throw new Error('Fixture interrupted journal staging.');
                    return originalPut.call(this, value, ...args);
                };
                try { await vm._ctStore.putRequest(scope, journalId, checkpoint.payload); }
                catch (error) { if (!error.message.includes('Fixture interrupted')) throw error; interrupted = true; }
                finally { IDBObjectStore.prototype.put = originalPut; }
                if (!interrupted) throw new Error('Journal staging was not interrupted.');
                const retained = await vm._ctStore.getRequest(scope, journalId);
                if (retained.payload.groups[0].carryOffset !== oldOffset || retained.payload.groups[0].carry.length !== 4500) throw new Error('The previous complete checkpoint was replaced by partial staging.');
                await vm._ctStore.putRequest(scope, journalId, checkpoint.payload);
                const retried = await vm._ctStore.getRequest(scope, journalId);
                if (retried.payload.groups[0].carryOffset !== 121 || retried.payload.groups[0].carry.at(-1).text !== rows.at(-1).text) throw new Error('The journal retry lost resumable progress or raw text.');
                await vm._ctStore.deleteRequest(scope, journalId);
                return { resumedOffset: oldOffset, retriedOffset: retried.payload.groups[0].carryOffset, rows: rows.length };
            }, { scope, journalId });
            await bootstrap();
            assert.equal(await page.evaluate(async ({ scope, journalId }) => (await window.__clientFixtureApp._ctStore.listRequests(scope)).some(row => row.requestId === journalId), { scope, journalId }), false, 'Deleted large checkpoint no longer appears in resumable uploads');
            results.push({ largeJournal: true, ...measured, ...resumed });
        }
        const productionOption = process.env.CLIENTTEXT_PRODUCTION_DIRECTORY || (process.argv.includes('--production') ? 'C:/Users/lpeac/Downloads/2026-10-05_POE2' : '');
        if (productionOption) {
            const productionDirectory = resolve(productionOption);
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
                await showAllClientStatuses();
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
                await input.fill(selected.target + ' [fixture]'); await workspace.getByRole('button', { name: 'Save', exact: true }).click();
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
                    await workspace.getByRole('button', { name: 'Close', exact: true }).click();
                    await workspace.getByRole('searchbox', { name: 'Search ClientText' }).fill(selectedGender.recordId);
                    await workspace.getByRole('searchbox', { name: 'Search ClientText' }).press('Enter');
                    await navigation.getByRole('button', { name: selectedGender.sheet, exact: true }).click();
                    await workspace.getByRole('button', { name: selectedGender.recordId, exact: true }).click();
                    const input = workspace.getByRole('textbox', { name: selectedGender.fieldName, exact: true });
                    await input.fill(selectedGender.target + ' [fixture]'); await workspace.getByRole('button', { name: 'Save', exact: true }).click();
                    await page.waitForFunction(({ id, field }) => window.__clientFixtureApp.ctSaved[id]?.values[field]?.endsWith(' [fixture]'), { id: selectedGender.unitId, field: selectedGender.fieldId });
                    assert.equal(await workspace.locator('.ctFormGrid textarea').count(), 6, 'Production French six-form layout');
                    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
                        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
                        await page.screenshot({ path: join(directory, 'production-French-gender-' + theme + '.png'), fullPage: true });
                    }
                }
                if (await page.evaluate(() => window.__clientFixtureApp.ctEditor)) await workspace.getByRole('button', { name: 'Close', exact: true }).click();
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
                    clientActive: vm?.ctActive, clientEditor: vm?.ctEditor, clientSelection: vm?.ctCurrentUnit?.recordId, clientBusy: vm?.ctBusy, clientDraft: vm?.ctDraftDirty, clientNotice: vm?.ctNotice,
                    clientSelectionId: vm?.ctSelection, clientUnits: vm?.ctUnits?.length, clientIndexSize: vm?._ctUnitIndex?.size,
                    clientIndexHasSelection: vm?._ctUnitIndex?.has(vm?.ctSelection), clientSelectionRunId: vm?._ctSelectRun?.unitId,
                    versionChooserMethod: typeof vm?.ctShowVersionChooser, clientSelectionPending: vm?._ctSelectRun?.pending,
                    sourceLoaded: vm?.sourceLoaded, sourceHash: vm?.sourceIdentity, initializing: vm?.workspaceInitializationActive, managedBusy: vm?.managedVersionBusy,
                    chooser: vm?.versionChooserVisible, editor: vm?.editorSessionActive, editorSaving: vm?.editorSaving,
                    collaboration: vm?._collaboration?.snapshot({ includeFiles: false }), requests: vm?.ctRequests?.map(request => request.payload?.kind), workspaces };
            }, isolationScopes).catch(() => null);
            console.error('Fixture failure state: ' + JSON.stringify(state));
            await failedPage.screenshot({ path: join(directory, 'clienttext-fixture-failure.png'), fullPage: true }).catch(() => {});
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
