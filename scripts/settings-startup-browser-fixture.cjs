// Disposable normal-mode startup checks using real Vue and native IndexedDB.
// Optional --baseline-ref=<git ref> collects the old startup timings without asserting the new behavior.
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, existsSync, mkdtempSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const express = require('express');
const root = resolve(__dirname, '..'), publicDir = join(root, 'public');
const work = mkdtempSync(join(root, 'temp', 'settings-startup-'));
const modules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [modules] }));
const fromApi = createRequire(resolve(root, '../SDEditor-API/package.json'));
const executablePath = process.env.FIXTURE_BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const baselineRef = process.argv.find(value => value.startsWith('--baseline-ref='))?.slice('--baseline-ref='.length);
const coreSource = file => baselineRef && ['index.js', 'cloudSync.js'].includes(file)
    ? execFileSync('git', ['show', baselineRef + ':public/' + file], { cwd: root, maxBuffer: 4 * 1024 * 1024 }).toString()
    : readFileSync(join(publicDir, file), 'utf8');

const instrumentation = String.raw`
window.__startupWrites = [];
for (const method of ['put', 'add', 'delete', 'clear']) {
    const original = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function (...args) {
        window.__startupWrites.push({ store: this.name, method, key: method === 'put' ? args[0]?.key : args[0], at: performance.now() });
        return original.apply(this, args);
    };
}
if (new URL(location.href).searchParams.has('failSave')) {
    const original = OfflineStore.updateHybridState; let failed = false;
    OfflineStore.updateHybridState = async update => {
        if (!failed) { failed = true; throw new Error('Fixture storage failure'); }
        return original(update);
    };
}
window.__startupApp = app.mount('#app');
`;

async function seed(page, spec) {
    return page.evaluate(async spec => {
        await OfflineStore.migrateFromLocalStorageIfNeeded();
        const languages = ['Thai', 'French', 'German', 'Japanese', 'Korean', 'Polish', 'Portuguese', 'Russian',
            'Simplified Chinese', 'Spanish', 'Traditional Chinese', 'Turkish'].slice(0, spec.languages || 1);
        const settings = { editorRegexes: [], lang: spec.language || 'Thai', theme: 'grey', hideDNT: true, hideEditorClipboard: true,
            hideSourceInPreviewPanel: false, mapClientTextClassNames: true, highlightDict: true, shiftEnterSave: false,
            autoOpenNextFile: true, inlineEditor: true, filterShortcutCtrlD: false, autocompleteShortcut: 'ctrl-space',
            mtlShortcut: 'disabled', mtlConsentVersion: '', dictionaryDefaultGameScope: 'all', uiDensity: 'compact',
            gamePreviewFrame: 'm', gamePreviewFonts: null, fullEditorPreviewHeight: null };
        const entries = Array.from({ length: spec.count || 2 }, (_, i) => ({ _id: 'entry-' + i, find: 'Synthetic ' + i + ' fire damage term',
            replace: 'Synthetic translated ' + i + ' target', tlnote: 'Synthetic note for entry ' + i,
            alts: [{ _id: 'alt-' + i, find: 'Other synthetic ' + i, replace: 'Alternative target ' + i }] }));
        const dictionaries = Object.fromEntries(languages.map(language => [language, { entries, base: { entries, tombstones: ['removed'], revision: 1 },
            conflicts: [], pendingResolution: null, revision: 1, localVersion: 1, syncedLocalVersion: 1 }]));
        const profile = { settings, clipboard: 'Synthetic clipboard', settingsBase: { revision: 1, settings }, dictionaries, unassignedDictionary: null,
            recovery: Array.from({ length: spec.recovery || 1 }, (_, i) => ({ at: i + 1, reason: 'Synthetic recovery', settings, dictionaries, editorClipboard: 'Keep clipboard' })) };
        const state = { version: 1, activeProfile: 'guest', auth: null, profiles: { guest: profile }, legacyRecovery: { ...settings, dictionary: entries } };
        if (spec.role) state.auth = { token: 'synthetic-token', user: { id: 'guest', role: spec.role, language: 'Thai', assignmentVersion: 1 } };
        if (spec.normalize) {
            profile.settings = { lang: 'Thai', theme: 'grey', editorRegexes: [] };
            dictionaries.Thai.entries = [{ find: 'Legacy fire', replace: 'Legacy target', tlnote: 12, alts: [{ find: 'Legacy flame' }] }];
        }
        const legacy = { ...profile.settings, dictionary: dictionaries[profile.settings.lang].entries, editorClipboard: profile.clipboard };
        // Independent persisted copies match actual cached bases/recovery generations rather than sharing object references.
        const detached = JSON.parse(JSON.stringify(state));
        await OfflineStore.setSettings(JSON.parse(JSON.stringify(legacy)));
        await OfflineStore.updateHybridState(() => detached);
        const db = await OfflineStore.openClientTextDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(['revisions_poe1', 'workspace_records', 'clienttext_drafts'], 'readwrite');
            tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
            tx.objectStore('revisions_poe1').add({ filepath: 'synthetic/history.txt', lang: 'Thai', savedAt: 1, translations: ['Retained authored target'] });
            tx.objectStore('workspace_records').put({ key: 'synthetic-dropped', scope: 'synthetic-old-version', value: { recoveryId: 'keep-recovery', translations: ['Frozen Dropped target'] } });
            tx.objectStore('clienttext_drafts').put({ key: 'synthetic-draft', scope: 'synthetic-old-version', values: { Text: 'Retained private draft' } });
        });
        return { hybridJsonBytes: new TextEncoder().encode(JSON.stringify(detached)).length, entries: entries.length };
    }, spec);
}

async function fingerprint(page) {
    return page.evaluate(async () => {
        const state = await OfflineStore.getHybridState();
        const db = await OfflineStore.openClientTextDb();
        const witnesses = await new Promise((resolve, reject) => {
            const tx = db.transaction(['revisions_poe1', 'workspace_records', 'clienttext_drafts'], 'readonly'), result = {};
            for (const name of tx.objectStoreNames) { const req = tx.objectStore(name).getAll(); req.onsuccess = () => { result[name] = req.result; }; }
            tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error);
        });
        const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))),
            byte => byte.toString(16).padStart(2, '0')).join('');
        return { hybrid: await hash(state), retained: await hash(witnesses), recovery: await hash(state.profiles.guest.recovery),
            base: await hash(state.profiles.guest.dictionaries.Thai.base), legacy: await hash(state.legacyRecovery) };
    });
}

async function startup(page, origin, { failSave = false } = {}) {
    await page.goto(origin + '/?cloudApi=' + encodeURIComponent(origin) + (failSave ? '&failSave=1' : ''));
    await page.waitForFunction(() => window.__startupApp?.startupReady && !window.__startupApp.workspaceInitializationActive,
        null, { timeout: 120000 });
    return page.evaluate(() => {
        const app = window.__startupApp, row = app.workspaceInitializationRows.find(row => row.label === 'Saving restored settings');
        return { phaseMs: row.endedAt - row.startedAt, initializationMs: Math.max(...app.workspaceInitializationRows.map(row => row.endedAt))
            - Math.min(...app.workspaceInitializationRows.map(row => row.startedAt)), writes: window.__startupWrites,
            pending: app.pendingSettingsSaves, error: app.cloudStorageError, dictionary: app.dictionary.length,
            userAgent: navigator.userAgent, visibility: document.visibilityState };
    });
}

async function run() {
    let browser, server;
    const results = [], errors = [];
    try {
        const candidate = process.env.FIXTURE_VUE_PATH || join(root, 'temp', 'clienttext-fixture-vue.min.js');
        const vue = existsSync(candidate) ? readFileSync(candidate) : Buffer.from(await (await fetch('https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js')).text());
        const frontend = express(); frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
        frontend.get('/seed', (req, res) => res.type('html').send('<!doctype html><script src="/workspaceState.js"></script><script src="/normalizedStore.js"></script><script src="/offlineStore.js"></script>'));
        frontend.get('/', (req, res) => res.type('html').send(coreSource('index.html')
            .replace('https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js', '/fixture-vue.js')
            .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture-zip.js')
            .replace('https://cdnjs.cloudflare.com/ajax/libs/jsdiff/8.0.1/diff.min.js', '/fixture-diff.js')));
        frontend.get('/fixture-vue.js', (req, res) => res.type('js').send(vue));
        frontend.get('/fixture-zip.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
        frontend.get('/fixture-diff.js', (req, res) => res.type('js').send('window.Diff = {};'));
        frontend.get('/index.js', (req, res) => res.type('js').send(coreSource('index.js').replace("app.mount('#app');", instrumentation)));
        frontend.get('/cloudSync.js', (req, res) => res.type('js').send(coreSource('cloudSync.js')));
        frontend.use(['/v1', '/auth'], (req, res) => res.status(503).json({ error: 'Disconnected synthetic fixture' }));
        frontend.use(express.static(publicDir));
        server = await new Promise(resolve => { const listening = frontend.listen(0, '127.0.0.1', () => resolve(listening)); });
        const origin = 'http://127.0.0.1:' + server.address().port;
        browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const specs = baselineRef ? [{ name: 'baseline-large', count: 5000, languages: 12, recovery: 2 }] : [
            { name: 'unchanged-small' }, { name: 'normalization-once', normalize: true },
            { name: 'failed-normalization', normalize: true, failSave: true },
            { name: 'local-translator-language', languages: 2, language: 'French', role: 'translator' },
            { name: 'selected-manager-language', languages: 2, language: 'French', role: 'manager' },
            { name: 'unchanged-large', count: 5000, languages: 12, recovery: 2 },
        ];
        for (const spec of specs) {
            const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
            await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
            const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
            await page.goto(origin + '/seed'); const size = await seed(page, spec); const original = await fingerprint(page);
            let settled;
            for (let reload = 0; reload < 2; reload++) {
                const metrics = await startup(page, origin, { failSave: spec.failSave && reload === 0 });
                if (!baselineRef) {
                    const expectedWrites = spec.normalize && reload === 0 && !spec.failSave ? 1 : 0;
                    assert.equal(metrics.writes.filter(row => row.key === 'settings').length, 0, spec.name + ': hydration must not rewrite legacy settings');
                    assert.equal(metrics.writes.filter(row => row.key === 'hybrid_v1').length, expectedWrites, spec.name + ': only necessary normalization writes');
                    if (spec.failSave && reload === 0) {
                        assert.equal(metrics.pending, 1); assert.match(metrics.error, /Fixture storage failure/);
                        assert.deepEqual(await fingerprint(page), original, 'Failed normalization is atomic.');
                        assert.equal(await page.evaluate(() => window.__startupApp.flushScheduledSettingsSave()), true);
                    } else { assert.equal(metrics.pending, 0); assert.equal(metrics.error, ''); }
                    const current = await fingerprint(page);
                    for (const field of ['retained', 'recovery', 'base', 'legacy']) assert.equal(current[field], original[field], spec.name + ': preserve ' + field);
                    if (!spec.normalize) assert.equal(current.hybrid, original.hybrid, spec.name + ': unchanged complete hybrid snapshot');
                    if (reload === 0) settled = current; else assert.deepEqual(current, settled, spec.name + ': stable persisted identities/defaults after normalization');
                }
                results.push({ name: spec.name, reload, ...size, ...metrics });
                console.log(JSON.stringify({ name: spec.name, reload, ...size, phaseMs: metrics.phaseMs, initializationMs: metrics.initializationMs, writes: metrics.writes.length }));
            }
            if (!baselineRef && spec.name === 'unchanged-small') {
                const other = await context.newPage(); await other.goto(origin + '/seed');
                await other.evaluate(() => OfflineStore.updateHybridState(state => { state.profiles.guest.dictionaries.Thai.entries[1].tlnote = 'Other tab note'; return state; }));
                const remote = await fingerprint(other);
                assert.equal(await page.evaluate(() => window.__startupApp.saveRestoredSettings()), true);
                assert.equal((await fingerprint(page)).hybrid, remote.hybrid, 'Unchanged restoration must not overwrite newer tab work.');
                assert.equal(await page.evaluate(() => { const app = window.__startupApp; app.dictionary[0].replace = 'Genuine edit'; return app.saveRestoredSettings(); }), true);
                const combined = await other.evaluate(async () => (await OfflineStore.getHybridState()).profiles.guest.dictionaries.Thai.entries);
                assert.equal(combined[0].replace, 'Genuine edit'); assert.equal(combined[1].tlnote, 'Other tab note');
                assert.equal((await fingerprint(page)).retained, original.retained);
                await page.evaluate(async () => { await window.__startupApp._cloudApplyPending; await window.__startupApp.$nextTick(); });
                await page.evaluate(() => { const app = window.__startupApp; app.scheduleSettingsSave(); app._cloud.epoch++; });
                assert.equal(await page.evaluate(() => window.__startupApp.saveRestoredSettings()), false, 'Queued obsolete contexts cannot bypass guards.');
                const state = await page.evaluate(() => ({ pending: window.__startupApp.pendingSettingsSaves, error: window.__startupApp.cloudStorageError }));
                assert.ok(state.pending); assert.match(state.error, /account or language changed/);
            }
            await context.close();
        }
        assert.deepEqual(errors, []);
        const report = { status: 'PASS', baselineRef: baselineRef || null, nativeIndexedDB: true, normalMode: true, localRequestsOnly: true, results, errors };
        writeFileSync(join(work, 'results.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ status: report.status, report: join(work, 'results.json') }));
    } finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
