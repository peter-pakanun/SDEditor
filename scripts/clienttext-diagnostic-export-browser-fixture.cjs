'use strict';
// Disposable origin/profile, native IndexedDB, real diagnostics and export worker.
// Optional --sample paths are read only; exports/logs stay under this checkout's temp/.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } = require('node:fs');
const { resolve, join, basename, sep } = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');
const runtime = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(require.resolve('playwright', { paths: [runtime] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);
const output = resolve(__dirname, '../temp/clienttext-diagnostic-export-browser');
mkdirSync(output, { recursive: true }); process.env.TEMP = output; process.env.TMP = output;
const publicRoot = resolve(__dirname, '../public'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const frontendRef = process.env.FIXTURE_FRONTEND_REF || '', deployedRef = process.env.FIXTURE_DEPLOYED_REF || '';
const memoryMode = process.env.FIXTURE_MEMORY === '1';
const fileBacked = process.env.FIXTURE_FILE_BACKED === '1', snapshotOriginals = process.env.FIXTURE_SNAPSHOT_ORIGINALS === '1';
const sourceCache = new Map();
function source(name, ref) {
    const key = ref + ':' + name;
    if (!sourceCache.has(key)) sourceCache.set(key, ref ? execFileSync('git', ['show', ref + ':public/' + name], { cwd: resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }) : readFileSync(join(publicRoot, name), 'utf8'));
    return sourceCache.get(key);
}
async function synthetic() {
    const zip = new JSZip(), ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const cell = (r, value) => `<c r="${r}" t="inlineStr"><is><t>${value}</t></is></c>`;
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Normal" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    const rows = [`<row r="1">${cell('A1', 'ID') + cell('C1', 'Name') + cell('D1', 'Translation')}</row>`];
    for (let i = 0; i < 260; i++) rows.push(`<row r="${i + 2}">${cell('A' + (i + 2), 'fixture/' + i) + cell('C' + (i + 2), 'Source {0}') + cell('D' + (i + 2), 'Original')}</row>`);
    zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${ns}"><sheetData>${rows.join('')}</sheetData></worksheet>`);
    zip.file('xl/styles.xml', `<styleSheet xmlns="${ns}"><fonts count="1"><font/></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
    zip.file('xl/native.bin', new Uint8Array([0, 255, 7, 8, 9]));
    return zip.generateAsync({ type: 'nodebuffer' });
}
async function main() {
    const samplePaths = process.argv.slice(2).filter(arg => arg !== '--sample');
    const bytes = await synthetic(), files = samplePaths.length ? samplePaths.map(path => ({ path: resolve(path), name: basename(path), bytes: readFileSync(path), role: /Gender/i.test(basename(path)) ? 'gender' : 'normal' })) :
        [{ name: 'French.xlsx', role: 'normal', bytes }, { name: 'French_Gender.xlsx', role: 'gender', bytes }];
    for (const file of files) file.hash = sha(file.bytes);
    if (fileBacked) {
        assert.equal(samplePaths.length, 0, 'Only generated disposable originals may be moved');
        const directory = join(output, 'disk-originals-' + Date.now()); mkdirSync(directory);
        for (const file of files) { file.diskPath = join(directory, file.name); writeFileSync(file.diskPath, file.bytes); }
    }
    const language = /Thai/i.test(files[0].name) ? 'Thai' : /German/i.test(files[0].name) ? 'German' : 'French';
    const scripts = ['clientTextState.js', 'clientTextStore.js', 'contentAdapters.js', 'clientTextMemoryStore.js', 'clientTextTransport.js', 'clientTextWorkerClient.js', 'clientTextExportProgress.js', 'translationDiagnostics.js', 'terminologyDiagnostics.js', 'clientTextUi.js'];
    let deployed = false;
    const server = createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        if (pathname === '/fixture/deploy') { deployed = true; response.end('Local worker assets advanced; open tab remains loaded.'); return; }
        if (pathname === '/fixture/move-originals') {
            assert(fileBacked);
            for (const file of files) {
                const from = resolve(file.diskPath), to = resolve(file.diskPath + '.moved');
                assert(from.startsWith(output + sep) && to.startsWith(output + sep)); renameSync(from, to);
            }
            response.end('Moved generated temporary originals only.'); return;
        }
        if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><div id="app"></div><script src="/fixture/vue.js"></script>${scripts.map(name => `<script src="/${name}"></script>`).join('')}<script>const mixin=ClientTextUI.mixin;window.app=Vue.createApp({data(){return{...mixin.data(),lang:${JSON.stringify(language)},gameVersion:'poe2',cloudProfileId:'fixture',branchId:'default',managedCatalogScope:'fixture:poe2',cloudCanAccessAllLanguages:true,dictionary:[],editorDictionaryRevision:0}},computed:mixin.computed,methods:mixin.methods,template:'<div>Local diagnostics and export fixture</div>'}).mount('#app');const createWorker=ClientTextWorkerClient.create;ClientTextWorkerClient.create=(options={})=>createWorker({...options,url:'/worker/clientTextWorker.js'});</script>`); return; }
        if (pathname === '/fixture/vue.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(readFileSync(process.env.FIXTURE_VUE_PATH || resolve(__dirname, '../temp/clienttext-fixture-vue.min.js'))); return; }
        if (pathname === '/fixture/jszip.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(readFileSync(require.resolve('jszip/dist/jszip.min.js'))); return; }
        const file = files[Number(pathname.match(/^\/fixture\/(\d+)$/)?.[1])];
        if (file) { response.end(file.bytes); return; }
        const workerRequest = pathname.startsWith('/worker/'), relativePath = workerRequest ? pathname.slice('/worker'.length) : pathname;
        const path = resolve(publicRoot, '.' + relativePath);
        if (!path.startsWith(publicRoot + sep) || !path.endsWith('.js') || !existsSync(path)) { response.writeHead(404); response.end(); return; }
        response.setHeader('Content-Type', 'text/javascript');
        const script = source(relativePath.slice(1), workerRequest && deployed ? deployedRef : frontendRef);
        response.end(relativePath === '/clientTextWorker.js' ? script.replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.js') : script);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ executablePath, headless: true });
        const context = await browser.newContext(), page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://127.0.0.1:' + server.address().port);
        if (fileBacked) for (let i = 0; i < files.length; i++) {
            await page.evaluate(index => { const input = document.createElement('input'); input.type = 'file'; input.id = 'source' + index; document.body.append(input); }, i);
            await page.locator('#source' + i).setInputFiles(files[i].diskPath);
        }
        const report = await page.evaluate(async ({files, memoryMode, fileBacked, snapshotOriginals}) => {
            const app = window.app, opening = memoryMode ? null : indexedDB.open('diagnostic-export-fixture', 1);
            if (memoryMode) app._ctStore = ClientTextMemoryStore.create();
            else {
            const db = await new Promise((resolve, reject) => { opening.onupgradeneeded = () => ClientTextStore.upgrade(opening.result, opening.transaction); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
            app._ctStore = ClientTextStore.create({ openDb: async () => db });
            }
            app._cloud = { request() { throw Error('This local export must not request a collection or access the API.'); } };
            const worker = ClientTextWorkerClient.create(), assets = [], units = [];
            let originals;
            if (fileBacked && snapshotOriginals) {
                app.ctUploadTest = true; app.ctUploadLocal = true; app.ctUploadHistory = false; app._ctWorker = worker; app.ctReport = () => {};
                app.ctUploadFiles = files.map((file, i) => ({ file: document.querySelector('#source' + i).files[0], role: file.role, language: app.lang, testVersion: 'current' }));
                await app.ctPrepareUpload();
                if (app.ctUploadError || app.ctPrepared.length !== 1) throw Error('Production preparation failed: ' + app.ctUploadError);
                const prepared = app.ctPrepared[0]; units.push(...prepared.units); assets.push(...prepared.assets); originals = prepared.originals;
            } else for (let i = 0; i < files.length; i++) {
                const file = files[i], selectedFile = fileBacked ? document.querySelector('#source' + i).files[0] : null,
                    bytes = selectedFile ? await selectedFile.arrayBuffer() : await (await fetch('/fixture/' + i)).arrayBuffer();
                const parsed = await worker.parseWorkbook(bytes, { filename: file.name, role: file.role, language: app.lang });
                units.push(...parsed.units); assets.push({ role: file.role, name: file.name, hash: parsed.artifactHash, blob: selectedFile && !snapshotOriginals ? selectedFile : new Blob([bytes]), parsed: { ...parsed, units: undefined } });
            }
            originals ||= await worker.buildDescriptors(units, assets.map(asset => ({ role: asset.role, hash: asset.parsed.artifactHash, parserVersion: asset.parsed.parserVersion })));
            worker.dispose(); const scope = app.ctScope(memoryMode ? 'local:test:version' : 'fixture-version', memoryMode ? 'local:test:group' : 'fixture-group', app.lang), metadata = { version: { id: scope.versionId, name: 'Fixture' }, group: { id: scope.groupId, contentMode: 'clienttext' } };
            if (memoryMode) app._ctTestStores = new Map([[scope.groupId, app._ctStore]]);
            await app._ctStore.import(scope, { units, assets, descriptors: originals.descriptors, metadata });
            app.ctWorkspace = { scope, metadata }; app.ctActive = true; app.ctUnits = Vue.markRaw(await app._ctStore.getUnits(scope));
            app._ctUnitIndex = Vue.markRaw(new Map(app.ctUnits.map(unit => [unit.id, unit])));
            const selected = units.filter(unit => unit.fields.some(field => field.kind !== 'gender' && field.source.trim())).slice(0, 260);
            for (const unit of selected) {
                const values = ClientTextState.valuesFor(unit);
                if (fileBacked && unit === selected[0]) values[unit.fields[0].id] = 'Saved rescue @ value';
                await app._ctStore.save(scope, unit.id, { jobId: 'save:' + unit.id, values, reviewed: {}, expectedRevision: 0 }, { sync: false });
            }
            app.ctSaved = Vue.markRaw(await app._ctStore.getSaved(scope)); app.ctSelection = selected[0].id;
            app.ctValues = ClientTextState.valuesFor(selected[0]); app.ctValues[selected[0].fields[0].id] = 'Unexported draft'; app.ctDraftDirty = true;
            const summary = async () => JSON.stringify([await app._ctStore.getMetadata(scope), await app._ctStore.getSaved(scope), await app._ctStore.listHistory(scope, selected[0].id), await app._ctStore.getOutbox?.(scope)]);
            const before = await summary(), beforeUnits = JSON.stringify(app.ctUnits), scans = [];
            // Simulate a deployment while this tab and its IndexedDB stay open.
            await fetch('/fixture/deploy', { method: 'POST' });
            if (fileBacked) await fetch('/fixture/move-originals', { method: 'POST' });
            window.downloads = []; window.saveAs = (blob, name) => downloads.push({ blob, name });
            for (let i = 0; i < 2; i++) {
                if (!await app.ctScan()) throw Error('Scan failed: ' + app.ctScanError);
                const diagnostics = JSON.stringify(app.ctDiagnostics), scanDone = app.ctScanDone;
                const success = await app.ctDownload();
                scans.push({ success, error: app.ctError, timing: app.ctExportLogText, scanned: app.ctScanProcessed });
                if (!success) break;
                if (diagnostics !== JSON.stringify(app.ctDiagnostics) || !scanDone || !app.ctScanDone) throw Error('Export changed diagnostic results.');
            }
            if (before !== await summary() || beforeUnits !== JSON.stringify(app.ctUnits)) throw Error('Scan/export changed originals or saved data/history/outbox.');
            const draft = await app._ctStore.getDraft(scope, selected[0].id);
            if (fileBacked && !snapshotOriginals) {
                let fileReadFailure;
                try { await (await app._ctStore.getAsset(scope, files[0].role)).blob.arrayBuffer(); }
                catch (error) { fileReadFailure = { name: error.name, message: error.message }; }
                return { units: units.length, saved: selected.length, scans, draftRetained: !!draft, downloads: downloads.length, fileReadFailure };
            }
            // An absent reference reproduces the reported phase shape without
            // deleting/mutating any original, Saved record or collection.
            const lookup = app._ctStore.getUnitsByIds, missing = JSON.stringify(['normal', 'Normal', 'PRIVATE-ID']);
            app._ctStore.getUnitsByIds = (scope, ids, options) => lookup(scope, [...ids, missing], options);
            const failed = await app.ctDownload(), failure = app.ctExportTiming.failure, failureTiming = app.ctExportLogText;
            app._ctStore.getUnitsByIds = lookup;
            if (failed || downloads.length !== 2 || !app.ctScanDone || before !== await summary()) throw Error('Injected lookup failure changed saved work or initiated a download.');
            if (typeof ClientTextExportProgress.Run.prototype.fail === 'function'
                && (failure?.code !== 'CLIENTTEXT_ORIGINAL_UNIT_MISSING' || failure.step !== 'Original records for saved values' || failureTiming.includes('PRIVATE-ID'))) throw Error('Missing safe, actionable lookup failure details.');
            return { units: units.length, saved: selected.length, scans, draftRetained: !!draft, downloads: downloads.length, injectedFailure: { ...failure, timing: failureTiming } };
        }, { files: files.map(({ name, role }) => ({ name, role })), memoryMode, fileBacked, snapshotOriginals });
        if (memoryMode) {
            const download = page.waitForEvent('download'), rescue = await page.evaluate(readFileSync(join(__dirname, 'clienttext-memory-recovery-console.js'), 'utf8'));
            const snapshotDownload = await download, snapshotPath = join(output, 'memory-recovery.json'); await snapshotDownload.saveAs(snapshotPath);
            const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
            assert.equal(snapshot.format, 'sdeditor-clienttext-memory-recovery-v1'); assert.equal(Object.keys(snapshot.saved).length, report.saved);
            assert(snapshot.drafts.length > 0); assert(snapshot.activeDraft.dirty); assert(Object.values(snapshot.activeDraft.values).includes('Unexported draft'));
            assert.equal(snapshot.source.language, language); assert(!snapshot.source.accountId); assert(rescue.downloadInitiated);
            report.recovery = rescue;
        }
        if (fileBacked && !snapshotOriginals) {
            const recoverySource = readFileSync(join(__dirname, 'clienttext-memory-reexport-console.js'), 'utf8');
            const state = () => page.evaluate(async () => {
                const s = app.ctWorkspace.scope, store = app._ctTestStores.get(s.groupId);
                return JSON.stringify([app.ctWorkspace, app.ctValues, app.ctReviewed, app.ctDiagnostics, await store.getSaved(s), await store.getDraft(s, app.ctSelection), await store.listHistory(s, app.ctSelection)]);
            });
            const before = await state();
            // Reject a different original before starting a recovery worker.
            const wrongChooser = page.waitForEvent('filechooser'), wrong = page.evaluate(recoverySource).catch(error => error.message);
            await (await wrongChooser).setFiles(files.map((file, index) => ({ name: file.name, mimeType: 'application/octet-stream', buffer: index ? file.bytes : Buffer.from('different original') })));
            assert.match(await wrong, /differs from the exact original/); assert.equal(await state(), before);
            const download = page.waitForEvent('download'), chooser = page.waitForEvent('filechooser'), recovering = page.evaluate(recoverySource);
            await (await chooser).setFiles(files.map(file => file.diskPath + '.moved'));
            report.reexportRecovery = await recovering;
            const recovered = await download, path = join(output, 'recovered.zip'); await recovered.saveAs(path);
            const zip = await JSZip.loadAsync(readFileSync(path));
            for (const file of files) {
                const workbook = files.length === 1 ? zip : await JSZip.loadAsync(await zip.file(file.name).async('nodebuffer'));
                assert.deepEqual(await workbook.file('xl/native.bin').async('uint8array'), new Uint8Array([0, 255, 7, 8, 9]));
                const xml = await workbook.file('xl/worksheets/sheet1.xml').async('string');
                if (file.role === 'normal') assert(xml.includes('Saved rescue @ value'));
                assert(!xml.includes('Unexported draft'));
            }
            assert.equal(await state(), before, 'reselect/re-export does not change the old session or its saved work/drafts/diagnostics/history');
        }
        const memberNames = new Map(await page.evaluate(files => {
            const names = ClientTextUI.workbookExportNames ? ClientTextUI.workbookExportNames(files) : files.map(file => file.name);
            return files.map((file, index) => [file.role, names[index]]);
        }, files.map(({name,role})=>({name,role}))));
        const downloads = await page.evaluate(async () => Promise.all(downloads.map(({ blob, name }) => new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve({ name, base64: reader.result.split(',')[1] }); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
        }))));
        for (let i = 0; i < downloads.length; i++) {
            const download = downloads[i], exported = Buffer.from(download.base64, 'base64');
            writeFileSync(join(output, 'export-' + i + '-' + download.name), exported);
            if (fileBacked) {
                const zip = await JSZip.loadAsync(exported);
                for (const file of files) {
                    const workbook = files.length === 1 ? zip : await JSZip.loadAsync(await zip.file(memberNames.get(file.role)).async('nodebuffer'));
                    const xml = await workbook.file('xl/worksheets/sheet1.xml').async('string');
                    if (file.role === 'normal') assert(xml.includes('Saved rescue @ value'));
                    assert(!xml.includes('Unexported draft'));
                }
            } else if (files.length === 1) assert.equal(sha(exported), files[0].hash, 'unchanged saved values and unsaved draft produce a byte-identical workbook');
            else {
                const zip = await JSZip.loadAsync(exported);
                for (const file of files) assert.equal(sha(await zip.file(memberNames.get(file.role)).async('nodebuffer')), file.hash, 'paired workbook bytes are preserved');
            }
        }
        for (const file of files) if (file.path) assert.equal(sha(readFileSync(file.path)), file.hash, 'original sample remains unchanged');
        const result = { ...report, memoryMode, fileBacked, snapshotOriginals, frontendRef: frontendRef || 'working-tree', deployedWorkerRef: deployedRef || 'working-tree', errors, samples: files.map(({ name, hash }) => ({ name, hash })) };
        writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
        if (fileBacked && !snapshotOriginals) {
            assert.equal(report.scans[0].success, false); assert.equal(report.downloads, 0);
            assert.equal(report.fileReadFailure?.name, 'NotFoundError');
        } else { assert.equal(report.scans.length, 2); assert(report.scans.every(scan => scan.success)); assert.equal(report.downloads, 2); }
        assert(report.draftRetained); assert.deepEqual(errors, []);
    } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
