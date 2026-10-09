// Disposable normal-mode desktop acceptance fixture. Real Vue/production mixins;
// cached source/room adapters and unresolved network gates isolate scheduling.
// Run: node scripts/startup-performance-browser-fixture.cjs
// No production storage, network account, or imported user files are used.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');
const { readFileSync, existsSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!executablePath) throw new Error('No installed Edge/Chrome found. Set FIXTURE_BROWSER_PATH.');

function installProbe() {
    const fixture = window.__startupPerformance = { gates: {}, reached: [], languageCalls: 0,
        languageWatchCalls: 0, languageReads: 0, inLanguage: false, connectCalls: 0, remoteDone: false };
    fixture.wait = name => new Promise(resolve => {
        fixture.reached.push(name); fixture.gates[name] = resolve;
    });
    fixture.release = name => { const resolve = fixture.gates[name]; if (!resolve) throw new Error('Missing gate: ' + name); delete fixture.gates[name]; resolve(); };
    const computed = EditorLookup.mixin.computed.lookupLanguages;
    EditorLookup.mixin.computed.lookupLanguages = function () {
        fixture.languageCalls++; fixture.inLanguage = true;
        try { return computed.call(this); } finally { fixture.inLanguage = false; }
    };
    const watch = EditorLookup.mixin.watch.lookupLanguages;
    EditorLookup.mixin.watch.lookupLanguages = function (...args) {
        fixture.languageWatchCalls++; return watch.apply(this, args);
    };
    OfflineStore.getSettings = async () => ({ lang: 'Thai', theme: 'light', inlineEditor: true,
        highlightDict: true, hideDNT: false, editorRegexes: [], dictionary: [
            { _id: 'fixture-fire', find: 'Fire', replace: 'ไฟ', gameScope: 'all', alts: [], tlnote: '' },
        ] });
    CloudSync.Client.prototype.refreshSession = function () {
        return fixture.sessionPending ||= fixture.wait('cloud-session');
    };
}

async function configureCachedWorkspace(page) {
    await page.evaluate(async () => {
        const app = window.__startupPerformanceApp, f = window.__startupPerformance;
        const clone = value => JSON.parse(JSON.stringify(value));
        // Keep catalog/presence polling outside this controlled acceptance run.
        app.managedScopeChanged = app.refreshManagedVersions = async () => {};
        app.scheduleCollaboration = app.openManagedPresence = () => {};
        app.managedWarnBeforeEdit = async () => true;
        clearInterval(app._cloudPoll); clearInterval(app._managedTimer);
        app._cloudApplying = true;
        app.lang = 'Thai'; app.gameVersion = 'poe2'; app.gameVersionSelected = true;
        app.branchId = 'default'; app.versionChooserVisible = false; app.showSetting = false;
        app.needsInitialSettings = false; app.inlineEditor = true; app.inlineSidebarVisible = true;
        app.selectedFileFilters = app.fileFilterOptions.map(option => option.key);
        app.searchText = ''; app.currentPage = 1; app.currentSort = 'filepath'; app.currentSortDir = 'asc';
        app.cloudProfileId = 'guest'; app.cloudSignedIn = true;
        app.cloudUser = { id: 'fixture-translator', role: 'translator', language: 'Thai', assignmentVersion: 1 };
        const source = Array.from({ length: 20000 }, (_, index) => ({
            filepath: 'startup-fixture/' + String(index).padStart(5, '0') + '.txt',
            filedir: 'startup-fixture/', filename: String(index).padStart(5, '0') + '.txt', name: 'fixture-' + index,
            stats: ['fixture_' + index], variables: [''], remarks: [''], isDNT: false,
            translations: { English: ['Fire damage ' + index], Thai: ['คำแปล ' + index],
                French: index === 0 ? ['Français'] : [], German: index === 0 ? ['Deutsch'] : [] },
        }));
        const hash = await CollaborationProtocol.sourceHashAsync(source);
        f.hash = hash; f.source = source; f.openPath = source[0].filepath;
        const cachedWorkspace = () => ({ descs: [
            { filepath: source[0].filepath, translations: { German: [] } },
            { filepath: 'unloaded.txt', translations: { Korean: ['Not loaded'] } },
        ], stagedVersion: 1, staged: {}, dropped: {}, status: {}, sourceHash: hash });
        f.snapshotCalls = f.sourceReads = f.workspaceReads = 0;
        OfflineStore.getSource = async () => { f.sourceReads++; return clone(source); };
        OfflineStore.getWorkspace = async () => { f.workspaceReads++; return cachedWorkspace(); };
        OfflineStore.getWorkspaceSnapshot = async () => {
            f.snapshotCalls++;
            return { scope: { accountId: 'guest', game: 'poe2', branchId: 'default', sourceHash: hash },
                language: 'Thai', source: clone(source), workspace: cachedWorkspace() };
        };
        OfflineStore.listTranslationDrafts = async () => [];
        OfflineStore.getTranslationDraft = async () => null;
        const OriginalClient = CollaborationSync.Client;
        CollaborationSync.Client = class extends OriginalClient {
            async connect(options) {
                f.connectCalls++; f.connectDeferred = options.deferRemote;
                f.cachedDuringInitialization = app.workspaceInitializationActive;
                await f.wait('cached-room');
                this.key = 'fixture-room'; this.epoch++;
                this.state = { version: 1, rooms: { [this.key]: {
                    identity: { ...options, sourceHash: hash }, local: Object.fromEntries(options.files.map(file => [file.filepath, clone(file)])),
                    shared: {}, outbox: [], conflicts: [], recovery: [], placeholderRepairs: [], revision: 1,
                } } };
            }
            async startRemote() {
                f.remoteDuringInitialization = app.workspaceInitializationActive;
                await f.wait('remote-connect'); f.remoteDone = true;
            }
            claim() { return Promise.resolve({ granted: true, offline: true }); }
            isEditing() { return false; }
            select(filepath) { this.selected = filepath; }
            setActivity() {}
            send() { return false; }
        };
        f.loadStarted = performance.now();
        f.loadPromise = app.loadVersionedStorage();
        await app.$nextTick();
    });
}

async function run() {
    const fromApi = createRequire(resolve(__dirname, '../../SDEditor-API/package.json'));
    const express = require('express'), frontend = express(), server = createServer(frontend);
    const publicDir = resolve(__dirname, '../public');
    frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
        .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
    frontend.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
    frontend.get('/index.js', (req, res) => res.type('js').send('(' + installProbe.toString() + ')();\n'
        + readFileSync(join(publicDir, 'index.js'), 'utf8').replace("app.mount('#app');", "window.__startupPerformanceApp = app.mount('#app');")));
    frontend.use('/v1', (req, res) => res.status(503).json({ error: 'Cloud disabled in disposable fixture.' }));
    frontend.use(express.static(publicDir));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const artifacts = mkdtempSync(join(tmpdir(), 'sdeditor-startup-performance-'));
    let browser;
    const errors = [], results = [], metrics = [];
    try {
        browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/?cloudApi=' + encodeURIComponent(origin));
        await page.waitForFunction(() => window.__startupPerformanceApp?.startupReady
            && window.__startupPerformanceApp?.offlineStoreReady && !window.__startupPerformanceApp.workspaceInitializationActive);
        await page.waitForFunction(() => !!window.__startupPerformance.gates['cloud-session']);
        console.log('PASS: cold local startup while session check remains pending.');
        assert.equal(await page.evaluate(() => window.__startupPerformanceApp.testMode), false);
        assert.equal(await page.evaluate(() => window.__startupPerformanceApp.workspaceInitializationRows.some(row => /Checking cloud session/.test(row.label))), false);
        results.push('Cold normal-mode local readiness finishes while cloud-session promise is unresolved; remote authentication owns no initialization phase.');
        await configureCachedWorkspace(page);
        await page.waitForFunction(() => !!window.__startupPerformance.gates['cached-room'], null, { timeout: 60000 });
        assert.equal(await page.evaluate(() => window.__startupPerformanceApp.workspaceInitializationActive), true);
        assert.equal(await page.locator('.workspace').isVisible(), false);
        assert.equal(await page.evaluate(() => window.__startupPerformance.cachedDuringInitialization && window.__startupPerformance.connectDeferred), true);
        await page.evaluate(() => window.__startupPerformance.release('cached-room'));
        await page.waitForFunction(() => !window.__startupPerformanceApp.workspaceInitializationActive && window.__startupPerformanceApp.loadingProgress === 100);
        await page.waitForFunction(() => !!window.__startupPerformance.gates['remote-connect']);
        console.log('PASS: cached preparation gates readiness; remote connection starts afterward.');
        assert.equal(await page.evaluate(() => window.__startupPerformance.remoteDuringInitialization), false);
        assert.equal(await page.locator('.workspace').isVisible(), true);
        assert.deepEqual(await page.evaluate(() => ({ snapshot: window.__startupPerformance.snapshotCalls,
            source: window.__startupPerformance.sourceReads, workspace: window.__startupPerformance.workspaceReads })),
        { snapshot: 1, source: 0, workspace: 0 }, 'Cold preparation consumes one combined snapshot without duplicate workspace/source provider reads.');
        results.push('Cached room hydration stays inside initialization; local workspace publishes before unresolved remote connection.');
        // Count only translations read inside the watched language computed,
        // separating legitimate per-file preparation from corpus enumeration.
        await page.evaluate(() => {
            const app = window.__startupPerformanceApp, f = window.__startupPerformance;
            for (const value of Vue.toRaw(app.descs)) {
                const translations = value.translations;
                Object.defineProperty(value, 'translations', { configurable: true, enumerable: true,
                    get() { if (f.inLanguage) f.languageReads++; return translations; },
                    set(next) { Object.assign(translations, next); } });
            }
            f.languageReads = 0; f.hiddenWatchCallsBefore = f.languageWatchCalls;
            app.sideTab = 'dictionary'; f.openStarted = performance.now();
        });
        const row = page.locator('tr[data-filepath="startup-fixture/00000.txt"]');
        await row.click();
        await page.waitForFunction(() => window.__startupPerformanceApp.inlineActive && window.__startupPerformanceApp.editorReady);
        await page.evaluate(() => { window.__startupPerformance.openMilliseconds = performance.now() - window.__startupPerformance.openStarted; });
        console.log('PASS: immediate inline row is ready.');
        const field = row.locator('.translationTr .textHL input, .translationTr .textHL textarea').first();
        await field.fill('Typed immediately while remote work is held');
        assert.equal(await page.evaluate(() => window.__startupPerformance.languageReads), 0);
        assert.equal(await page.evaluate(() => !!window.__startupPerformance.gates['remote-connect'] && !!window.__startupPerformance.gates['cloud-session']), true);
        results.push('Immediate inline opening and typing finish with both network gates unresolved and zero hidden Lookup corpus reads.');
        for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
            await page.evaluate(theme => {
                const app = window.__startupPerformanceApp;
                app.theme = theme; document.documentElement.setAttribute('data-theme', theme);
            }, theme);
            await field.focus(); await page.keyboard.press('Control+A');
            await page.keyboard.type('Draft ' + theme + ' during background changes ' + 'retained text '.repeat(12));
            await page.keyboard.press('ArrowLeft');
            const before = await field.evaluate(element => {
                window.__startupField = element; element.scrollLeft = 12;
                const bounds = element.getBoundingClientRect();
                return { value: element.value, start: element.selectionStart, end: element.selectionEnd,
                    scrollLeft: element.scrollLeft, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
            });
            assert(before.scrollLeft > 0, theme + ': exercise a scrolled translation field.');
            await page.evaluate(async theme => {
                const app = window.__startupPerformanceApp, f = window.__startupPerformance;
                f.editorRun ||= app._editorOpenRun;
                await app.receiveCollaborationFiles([{ filepath: 'startup-fixture/00001.txt', translations: ['Background saved update ' + theme], revision: 2 }], 'Thai');
                app.invalidateEditorLookupIndex(); await app.$nextTick();
            }, theme);
            const after = await field.evaluate(element => {
                const bounds = element.getBoundingClientRect();
                return { same: element === window.__startupField, focused: element === document.activeElement,
                    value: element.value, start: element.selectionStart, end: element.selectionEnd, scrollLeft: element.scrollLeft,
                    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
            });
            assert.equal(after.same && after.focused, true, theme + ': background update retains the focused input node.');
            for (const key of Object.keys(before)) assert.equal(after[key], before[key], theme + ': retained ' + key);
            assert.equal(await page.evaluate(() => window.__startupPerformance.languageReads), 0);
            assert.equal(await page.evaluate(() => window.__startupPerformanceApp._editorOpenRun === window.__startupPerformance.editorRun), true);
            assert(after.x >= 0 && after.x + after.width <= 1441, theme + ': translation input fits desktop width.');
            await page.screenshot({ path: join(artifacts, 'inline-' + theme + '.png') });
            metrics.push({ theme, ...after });
        }
        results.push('All four desktop themes retain typing, input node, focus, selection, scroll, layout and editor session during unrelated shared updates.');
        await page.locator('.lookupTab').click();
        await page.waitForFunction(() => window.__startupPerformance.languageReads >= 20000);
        const choices = page.locator('#editorLookupLanguage option');
        assert.deepEqual(await choices.allTextContents(), ['Thai (editor language)', 'Thai', 'French']);
        await page.locator('#editorLookupLanguage').selectOption('French');
        const reads = await page.evaluate(() => window.__startupPerformance.languageReads);
        await page.locator('#editorLookupSearch').fill('00000');
        await page.waitForFunction(() => window.__startupPerformanceApp.lookupResultCount === 1);
        await page.locator('.lookupResult').click();
        await page.locator('#editorLookupSearch').focus(); await page.keyboard.press('Escape');
        assert.equal(await page.locator('#editorLookupSearch').inputValue(), '');
        assert.equal(await page.evaluate(() => window.__startupPerformanceApp.inlineActive), true);
        assert.equal(await page.evaluate(() => window.__startupPerformance.languageReads), reads);
        await page.getByRole('button', { name: '📚 Dictionary', exact: true }).click();
        await page.evaluate(async () => {
            const app = window.__startupPerformanceApp;
            Vue.toRaw(app.descs)[0].translations.Japanese = ['日本語'];
            app.invalidateEditorLookupIndex(); await app.$nextTick();
        });
        assert.equal(await page.evaluate(() => window.__startupPerformanceApp.lookupLanguage), 'French');
        assert.equal(await page.evaluate(() => window.__startupPerformance.languageReads), reads);
        await page.locator('.lookupTab').click();
        assert.deepEqual(await choices.allTextContents(), ['Thai (editor language)', 'Thai', 'French', 'Japanese']);
        assert.equal(await page.locator('#editorLookupLanguage').inputValue(), 'French');
        assert.equal(await page.evaluate(() => window.__startupPerformance.languageReads), reads + 20000);
        results.push('Real Vue language getter/watch remain lazy; active enumeration is cached, empty saved overlays suppress German, unloaded Korean is excluded, and reentry preserves French while refreshing Japanese.');
        await page.evaluate(() => {
            const f = window.__startupPerformance;
            f.release('remote-connect'); f.release('cloud-session');
        });
        await page.waitForFunction(() => window.__startupPerformance.remoteDone);
        assert.deepEqual(errors, []);
        const timing = await page.evaluate(() => ({ files: window.__startupPerformanceApp.descs.length,
            languageReads: window.__startupPerformance.languageReads, languageCalls: window.__startupPerformance.languageCalls,
            languageWatchCalls: window.__startupPerformance.languageWatchCalls,
            immediateInlineOpenMilliseconds: window.__startupPerformance.openMilliseconds,
            connectCalls: window.__startupPerformance.connectCalls,
            snapshotCalls: window.__startupPerformance.snapshotCalls,
            duplicateSourceReads: window.__startupPerformance.sourceReads,
            duplicateWorkspaceReads: window.__startupPerformance.workspaceReads,
            initialization: window.__startupPerformanceApp.workspaceInitializationRows.map(row => ({ label: row.label, status: row.status, milliseconds: row.endedAt - row.startedAt })) }));
        writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ results, timing, metrics }, null, 2));
        console.log(JSON.stringify({ pass: true, results, timing, artifacts }, null, 2));
        await context.close();
    } finally {
        await browser?.close(); await new Promise(resolve => server.close(resolve));
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
