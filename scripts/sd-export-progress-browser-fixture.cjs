/* Synthetic loopback-only SD collection/export QA. No hosted account or source data.
 * Set PLAYWRIGHT_MODULE_PATH if playwright is supplied by an external runtime.
 * Optional FIXTURE_BROWSER_PATH and FIXTURE_VUE_PATH select local dependencies. */
'use strict';
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const express = require('express'), JSZip = require('jszip');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const Codec = require('../public/statDescCodec.js'), Protocol = require('../public/collaborationProtocol.js');
const Exports = require('../public/managedCollectionExports.js');
const publicDir = resolve(__dirname, '../public'), output = resolve(__dirname, '../temp/sd-export-progress-browser');
mkdirSync(output, { recursive: true }); process.env.TMP = output; process.env.TEMP = output;
const executablePath = process.env.FIXTURE_BROWSER_PATH || [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean).flatMap(dir => [join(dir, 'Microsoft/Edge/Application/msedge.exe'), join(dir, 'Google/Chrome/Application/chrome.exe')]).find(existsSync);
const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
const dialog = html.slice(html.indexOf('    <dialog ref="ctExportDialog"'), html.indexOf('    <section v-if="workspaceInitializationActive'));
const index = readFileSync(join(publicDir, 'index.js'), 'utf8');
const localExportMethod = index.slice(index.indexOf('    async exportZip(doFullExport)'), index.indexOf('    // Multi-instance detection methods')).trim().replace(/,$/, '');
async function syntheticOriginal() {
    const zip = new JSZip();
    for (let i = 0; i < 192; i++) {
        const text = `description synthetic_${i}\n1 synthetic_stat_${i}\n2\n1 "Source first ${i}"\n2 "Source second ${i}"\nlang "Thai"\n2\n1 "Original first"\n2 "Original second"\nlang "German"\n2\n1 "Original one"\n2 "Original two"\n`;
        zip.file('synthetic/record-' + i + '.txt', new Uint8Array(Codec.strEncodeUTF16(text).buffer));
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const archive = await Protocol.finalizeArchive({ version: 2, zipHash: await Protocol.zipHash(bytes), zipSize: bytes.byteLength,
        fileCount: 192, descriptionCount: 192, parserVersion: 1, decisions: [] });
    return { bytes, archive };
}
async function main() {
    const original = await syntheticOriginal(), version = { id: 'synthetic-version', name: 'Synthetic version', game: 'poe2', branchId: 'default', sourceHash: original.archive.baselineId, zipHash: original.archive.zipHash, archive: original.archive, status: 'published' };
    const snapshots = new Map(), posts = [], requests = [], held = [];
    let mode = 'success', workerHold = false;
    function snapshot(language) {
        const collection = { id: 'synthetic-' + language, versionId: version.id, language, sequence: 1, fileCount: 3, format: 'manifest', status: 'ready', downloadReady: true };
        const files = [1, 7, 128].map(i => ({ filepath: 'synthetic/record-' + i + '.txt', translations: ['Frozen first', 'Frozen second'], revision: 1 }));
        return { version, collection, manifest: { formatVersion: 1, parserVersion: 1, encoderVersion: 1, versionId: version.id, groupId: 'synthetic-group', game: version.game, branchId: version.branchId,
            language, sourceHash: version.sourceHash, zipHash: version.zipHash, archive: original.archive, sequence: 1, assets: [{ role: 'source', descriptor: original.archive }], files } };
    }
    for (const language of ['Thai', 'German']) snapshots.set(language, snapshot(language));
    const frontend = express(); frontend.use(express.json());
    frontend.get('/', (req, res) => res.type('html').send(`<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/interface.css"><style>body{padding:32px}.fixture{max-width:900px;margin:auto}.fixture>button{padding:8px;margin:4px}</style></head><body><div id="app" class="fixture"><h1>Synthetic SD export fixture</h1><p>Disposable local records and simulated server snapshots.</p><button id="collect" @click="managedCollectStatGroup(version,group,team,true)">Download and end</button><button id="legacy" @click="managedCollect(team,true)">Legacy collection</button><button id="local" @click="exportZip(false)">Local export</button><button id="reopen" @click="ctShowExport">View export timings</button>${dialog}</div><script src="/fixture/vue.js"></script><script src="/fixture/jszip.js"></script>${['workspaceState.js','statDescCodec.js','collaborationProtocol.js','clientTextState.js','clientTextStore.js','sdBaselineFiles.js','managedCollectionExports.js','managedVersions.js','clientTextExportProgress.js'].map(file => '<script src="/' + file + '"></script>').join('')}<script>
        const progress=ClientTextExportProgress.mixin,managed=ManagedVersions.mixin;
        const app=Vue.createApp({data(){return{...managed.data(),...progress.data(),version:${JSON.stringify(version)},group:{id:'synthetic-group',versionId:'synthetic-version',contentMode:'statdescription'},team:{language:'Thai',counts:{saved:3}},lang:'Thai',gameVersion:'poe2',cloudProfileId:'synthetic-account',cloudUser:{id:'synthetic-account',role:'manager'},cloudSignedIn:true,cloudCanAccessAllLanguages:true,selectedManagedVersionId:'synthetic-version',managedVersions:[${JSON.stringify(version)}],sourceIdentity:'${version.sourceHash}',descs:[],localDescs:{}}},computed:{...managed.computed,...progress.computed},methods:{...managed.methods,...progress.methods,${localExportMethod},ctRequestScope(){return{accountId:this.cloudProfileId,game:this.gameVersion,branchId:this.branchId}}}}).mount('#app');window.app=app;window.descEncode=StatDescCodec.descEncode;
        </script></body></html>`));
    frontend.get('/fixture/vue.js', (req, res) => { const file = process.env.FIXTURE_VUE_PATH || resolve(__dirname, '../temp/clienttext-fixture-vue.min.js'); if (existsSync(file)) res.type('js').send(readFileSync(file)); else res.redirect('https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js'); });
    frontend.get('/fixture/jszip.js', (req, res) => res.type('js').send(readFileSync(require.resolve('jszip/dist/jszip.min.js'))));
    frontend.get('/sdBaselineWorker.js', (req, res) => {
        let code = readFileSync(join(publicDir, 'sdBaselineWorker.js'), 'utf8').replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.js');
        // A controlled CPU stall proves native termination while a real verification job is pending.
        if (workerHold) code += '\nconst actual=self.onmessage;self.onmessage=event=>{if(["verify","prepare"].includes(event.data.type)){const until=performance.now()+5000;while(performance.now()<until){}}return actual(event);};';
        res.type('js').send(code);
    });
    frontend.post(['/v1/content-groups/:group/teams/:language/collections', '/v1/versions/:version/teams/:language/collections'], (req, res) => {
        posts.push({ language: req.params.language, body: req.body }); const value = snapshots.get(req.params.language);
        if (mode === 'post-hold') { held.push(res); return; }
        res.json({ collection: mode === 'legacy-archive' ? { ...value.collection, format: 'archive' } : value.collection });
    });
    frontend.get(['/v1/content-collections/:id/manifest', '/v1/collections/:id/manifest'], (req, res) => {
        requests.push(req.path); const value = [...snapshots.values()].find(item => item.collection.id === req.params.id);
        if (mode === 'manifest-hold') { held.push(res); return; }
        if (mode === 'failure') return res.status(503).json({ error: 'Synthetic failure' });
        if (req.path.startsWith('/v1/collections/')) return res.json(value);
        res.json({ ...value, manifest: { ...value.manifest, files: req.query.cursor ? value.manifest.files.slice(2) : value.manifest.files.slice(0, 2) }, nextCursor: req.query.cursor ? '' : 'second' });
    });
    frontend.get('/v1/collections/:id/archive', async (req, res) => { const value = [...snapshots.values()].find(item => item.collection.id === req.params.id), baseline = await Exports.parseOriginal(original.bytes, original.archive, value.manifest.language, JSZip); res.send(await Exports.generate(value.manifest, baseline, JSZip, { type: 'nodebuffer' })); });
    frontend.get(['/v1/content-groups/:group/assets/source/original', '/v1/versions/:version/original'], (req, res) => { requests.push(req.path); res.send(original.bytes); });
    frontend.use(express.static(publicDir));
    const server = await new Promise(resolve => { const server = frontend.listen(0, '127.0.0.1', () => resolve(server)); });
    let browser; const errors = [], results = [], layouts = [];
    try {
        browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.evaluate(async () => {
            const opening = indexedDB.open('synthetic-sd-export', 1), db = await new Promise((resolve, reject) => { opening.onupgradeneeded = () => { ClientTextStore.upgrade(opening.result, opening.transaction); opening.result.createObjectStore('fixture', { keyPath: 'key' }); }; opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
            const record = (key, value, remove = false) => new Promise((resolve, reject) => { const tx = db.transaction(['fixture'], value === undefined && !remove ? 'readonly' : 'readwrite'), store = tx.objectStore('fixture'), request = remove ? store.delete(key) : value === undefined ? store.get(key) : store.put({ key, value }); request.onsuccess = () => { tx.oncomplete = () => resolve(value === undefined && !remove ? request.result?.value : value); }; tx.onerror = tx.onabort = () => reject(tx.error); });
            const key = (scope,version,language,end=true) => JSON.stringify([scope.accountId,scope.game,scope.branchId,version,language,end]);
            window.OfflineStore = { getImportedBaseline:async()=>null,getStatDescriptionZip:hash=>record('zip:'+hash),putStatDescriptionZip:(hash,blob)=>record('zip:'+hash,blob),getVersionCollectionRequest:(...args)=>record('request:'+key(...args)),setVersionCollectionRequest:async(scope,version,language,id,end=true)=>{if(id==null){await record('receipt:'+key(scope,version,language,end),undefined,true);return record('request:'+key(scope,version,language,end),undefined,true);}return record('request:'+key(scope,version,language,end),id);},getVersionCollectionReceipt:(...args)=>record('receipt:'+key(...args)),setVersionCollectionReceipt:(scope,version,language,id,collection,end=true)=>record('receipt:'+key(scope,version,language,end),{requestId:id,collection})};
            window.fixtureBaselineCache = ManagedCollectionExports.createBaselineCache();
            const collectionBaseline = ManagedCollectionExports.collectionBaseline;
            ManagedCollectionExports.collectionBaseline = (manifest, options) => collectionBaseline(manifest, { ...options, cache: fixtureBaselineCache });
            app._ctStore = ClientTextStore.create({ openDb: async () => db }); app.appConfirm = async () => true; app.managedReadDetails = app.refreshManagedVersions = async () => {}; app.flushEditorDraft = async () => true;
            app._cloud = { async request(path, options = {}) { const response = await fetch(path, { method: options.method || 'GET', body: options.body ? JSON.stringify(options.body) : undefined, headers: { 'Content-Type': 'application/json' }, signal: options.signal }); if (!response.ok) throw Error('Synthetic request failed'); return options.responseType === 'blob' ? response.blob() : response.json(); } };
            const NativeWorker = window.Worker; window.fixtureWorkers = []; window.Worker = class extends NativeWorker { constructor(...args) { super(...args); fixtureWorkers.push(this); } terminate() { this.stopped = true; super.terminate(); } };
            window.fixtureDownloads = []; window.saveAs = (blob,name) => { fixtureDownloads.push({blob,name}); const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
        });
        const finished = () => page.waitForFunction(() => app.ctExportTiming && app.ctExportTiming.status !== 'running' && !app.ctBusy && !app.managedVersionBusy);
        const close = () => page.getByRole('button', { name: 'Close', exact: true }).click();
        mode = 'manifest-hold'; await page.locator('#collect').click(); await page.waitForFunction(() => app.ctExportTiming?.rows.at(-1)?.label.startsWith('Manifest page'));
        const dialog = page.locator('dialog'); assert(await dialog.isVisible());
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 900, height: 650 }, { width: 390, height: 740 }]) {
            await page.setViewportSize(viewport);
            for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
                await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
                const box = await dialog.boundingBox(); assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
                layouts.push({ theme, viewport, box }); await page.screenshot({ path: join(output, theme + '-' + viewport.width + '.png') });
            }
        }
        await page.keyboard.press('Shift+Tab'); assert(await dialog.evaluate(element => element.contains(document.activeElement)));
        await page.keyboard.press('Escape'); await finished(); assert.equal(await page.evaluate(() => app.ctExportTiming.collection), 'accepted'); assert.equal(await page.evaluate(() => fixtureDownloads.length), 0); await close();
        assert(await page.locator('#collect').evaluate(element => element === document.activeElement)); held.splice(0).forEach(response => response.destroy());
        results.push('Four themes and three viewport sizes fit the shared compact dialog; native focus trapping, Escape Abort and trigger-focus restoration pass.');
        mode = 'success'; await page.setViewportSize({ width: 1440, height: 1000 });
        for (const language of ['Thai', 'German']) {
            await page.evaluate(language => { app.lang = app.team.language = language; }, language);
            const download = page.waitForEvent('download'); await page.locator('#collect').click(); const file = await download; await file.saveAs(join(output, 'modern-' + language + '.zip')); await finished();
            const value = snapshots.get(language), baseline = await Exports.parseOriginal(original.bytes, original.archive, language, JSZip), expected = await Exports.generate(value.manifest, baseline, JSZip, { type: 'nodebuffer' });
            assert.deepEqual(readFileSync(join(output, 'modern-' + language + '.zip')), expected); assert.equal(await page.evaluate(() => app.ctExportTiming.status), 'done'); await close();
        }
        assert.equal(requests.filter(path => path.endsWith('/original')).length, 1, 'Back-to-back modern exports reuse immutable originals');
        assert.equal(posts.length, 2, 'Accepted receipt retry did not create a second ending operation for the first team');
        results.push('Back-to-back language exports are byte-identical to the existing codec path, reuse immutable originals, and reuse an interrupted accepted receipt.');
        await page.locator('#legacy').click(); await finished(); assert.equal(await page.evaluate(() => app.ctExportTiming.status), 'done'); await close();
        results.push('Legacy manifest collection succeeds through the same dialog and real original-verification worker.');
        mode = 'legacy-archive'; const archiveDownload = page.waitForEvent('download'); await page.locator('#legacy').click(); const archiveFile = await archiveDownload; await archiveFile.saveAs(join(output, 'legacy-archive.zip')); await finished(); assert.equal(await page.evaluate(() => app.ctExportTiming.status), 'done'); await close(); mode = 'success';
        const legacyValue = snapshots.get('German'), legacyBaseline = await Exports.parseOriginal(original.bytes, original.archive, 'German', JSZip); assert.deepEqual(readFileSync(join(output, 'legacy-archive.zip')), await Exports.generate(legacyValue.manifest, legacyBaseline, JSZip, { type: 'nodebuffer' })); results.push('Supported legacy archive download preserves the exact server package bytes.');
        await context.grantPermissions(['clipboard-read', 'clipboard-write']); await page.locator('#reopen').click(); await page.getByRole('button', { name: 'Copy timings', exact: true }).click();
        const report = await page.evaluate(() => navigator.clipboard.readText()); assert.match(report, /StatDescription export timing/); assert(!report.includes('Frozen')); assert(!report.includes('synthetic-account')); await page.screenshot({ path: join(output, 'completed.png') }); await close();
        mode = 'post-hold'; await page.locator('#collect').click(); await page.waitForFunction(() => app.ctExportTiming?.collection === 'uncertain'); await page.getByRole('button', { name: 'Abort', exact: true }).click(); await finished(); assert.equal(await page.evaluate(() => app.ctExportTiming.collection), 'uncertain'); await close(); held.splice(0).forEach(response => response.destroy());
        mode = 'failure'; await page.locator('#collect').click(); await finished(); assert.equal(await page.evaluate(() => app.ctExportTiming.status), 'failed'); assert.equal(await page.evaluate(() => app.ctExportTiming.collection), 'accepted'); await page.screenshot({ path: join(output, 'failed.png') }); await close();
        results.push('Unknown POST outcome, accepted-manifest failure and retained copyable reports are honest and retryable.');
        mode = 'success'; workerHold = true; await page.evaluate(() => fixtureBaselineCache.clear()); await page.locator('#collect').click(); await page.waitForFunction(() => app.ctExportTiming?.rows.at(-1)?.label === 'Cached ZIP worker verification / directory checks');
        const before = await page.evaluate(() => fixtureDownloads.length); await page.getByRole('button', { name: 'Abort', exact: true }).click(); await finished(); assert.equal(await page.evaluate(() => fixtureDownloads.length), before); assert(await page.evaluate(() => fixtureWorkers.every(worker => worker.stopped))); await page.screenshot({ path: join(output, 'worker-aborted.png') }); await close(); workerHold = false;
        results.push('Abort terminates a real verifier during a controlled worker CPU stall, suppresses download, and releases operation flags.');
        await page.evaluate(() => { app.descs = [{ filepath: 'synthetic/local.txt', name: 'synthetic', stats: ['synthetic_stat'], variables: ['#'], remarks: [''], translations: { English: ['Source'], German: ['Local saved target'] }, hasChanges: true }]; app.committedTranslationIssues = desc => ({ languageBlockPresent: Object.hasOwn(desc.translations, app.lang), valid: true }); app.workspaceSourceFile = () => null; });
        const localDownload = page.waitForEvent('download'); await page.locator('#local').click(); const local = await localDownload; await local.saveAs(join(output, 'local.zip')); await finished();
        const localZip = await JSZip.loadAsync(readFileSync(join(output, 'local.zip'))); assert(Codec.decodeUTF16(await localZip.file('synthetic/local.txt').async('uint8array')).includes('Local saved target')); await close();
        results.push('The production local export method uses the shared dialog and preserves saved UTF-16 output.');
        assert.deepEqual(errors, []); const result = { status: 'PASS', localEndpointsOnly: true, syntheticContentOnly: true, nativeIndexedDB: true, realVerificationWorker: true, controlledWorkerStall: true, results, layouts, errors };
        writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
    } finally { held.forEach(response => response.destroy()); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
