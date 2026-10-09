// Disposable desktop UI check: real Vue/mixins with deliberately held storage and cloud boundaries.
// Uses normal mode startup; managed opening/activation/workspace preparation remain the production methods.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join } = require('node:path');
const { readFileSync, existsSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');

const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!executablePath) throw new Error('No installed Edge/Chrome found. Set FIXTURE_BROWSER_PATH.');

async function installHarness(page, mode = 'held') {
    await page.evaluate(async mode => {
        const app = window.__initializationFixtureApp, clone = value => JSON.parse(JSON.stringify(value));
        // Keep unrelated automatic catalog polls out of these controlled boundary tests.
        app.managedScopeChanged = app.refreshManagedVersions = async () => {};
        app.scheduleCollaboration = app.openManagedPresence = () => {};
        app.loadEditorDrafts = async () => {};
        app._cloudApplying = true;
        app._cloudPoll && clearInterval(app._cloudPoll);
        app._managedTimer && clearInterval(app._managedTimer);
        app.gameVersion = 'poe1'; app.gameVersionSelected = true; app.branchId = 'default';
        app.lang = 'Thai'; app.dictionary = []; app.editorRegexes = []; app.inlineEditor = false;
        app.cloudProfileId = 'fixture-translator'; app.cloudSignedIn = true;
        app.cloudUser = { id: 'fixture-translator', role: 'translator', language: 'Thai', assignmentVersion: 1 };
        app.showSetting = false; app.needsInitialSettings = false; app.cloudStorageError = '';
        app.disposeWorkspaceInitialization(); app.resetVersionedState(); app.versionChooserVisible = true;
        app.managedVersionBusy = false; app.managedOperationErrors = {}; app.managedVersionError = '';
        const source = [{ filepath: 'initialization-fixture/fire.txt', filedir: 'initialization-fixture', filename: 'fire.txt', name: 'fire',
            stats: ['fixture_fire'], variables: ['#'], remarks: [''],
            translations: { English: ['Fire damage'], Thai: ['ความเสียหายไฟ'] }, isDNT: false }];
        const hash = await CollaborationProtocol.sourceHashAsync(source);
        const version = { id: 'fixture-version', name: 'Initialization fixture', game: 'poe1', branchId: 'default',
            sourceHash: hash, zipHash: 'a'.repeat(64), status: mode === 'cancel' ? 'withdrawn' : 'published',
            isHead: true, createdAt: '2026-10-09T00:00:00Z', deadlineAt: '2030-10-09T00:00:00Z' };
        const details = { version, teams: [{ language: 'Thai', ended: false, presence: [],
            counts: { loaded: 1, saved: 0, missing: 0, dropped: 0, revised: 0 } }] };
        app.managedVersions = [clone(version)]; app.selectedManagedVersionId = version.id;
        app.managedVersionDetails = clone(details); app.managedActiveDetails = null; app.localVersions = [];
        app.managedShowWithdrawn = mode === 'cancel';
        app.managedCatalogLoaded = app.managedDetailsLoaded = app.managedLocalVersionsLoaded = true;
        const gates = {}, reached = [];
        const wait = name => {
            reached.push(name);
            if (mode !== 'held') return Promise.resolve();
            return new Promise((resolve, reject) => { gates[name] = { resolve, reject }; });
        };
        window.__initializationFixture = { mode, source, version, details, gates, reached, requests: 0,
            release(name) { const gate = gates[name]; if (!gate) throw new Error('Gate not reached: ' + name); delete gates[name]; gate.resolve(); } };
        let drafts = 0;
        app.flushEditorDraft = async () => { if (++drafts === 1) await wait('draft'); return true; };
        app.managedAdoptGuestOnOpen = async () => null;
        app.appConfirm = async () => false;
        OfflineStore.getVersionSource = async () => {
            await wait('cached');
            if (mode === 'error') throw new Error('Fixture source preparation failed <img src=x>');
            return clone(source);
        };
        OfflineStore.getVersionMetadata = async () => ({ details: clone(details) });
        OfflineStore.setVersionMetadata = async () => {};
        OfflineStore.resolveVersionScope = async scope => scope;
        OfflineStore.activateVersion = async () => ({ metadata: { details: clone(details) } });
        OfflineStore.getSource = async () => clone(source);
        OfflineStore.getWorkspace = async () => ({ descs: [], status: {}, sourceHash: hash, staged: {}, dropped: {} });
        app._cloud.request = async () => {
            if (++window.__initializationFixture.requests > 1) await wait('final-details');
            return clone(details);
        };
        app.initializeCollaboration = async () => { await wait('shared'); };
        await app.$nextTick();
    }, mode);
}

async function run() {
    const fromApi = createRequire(resolve(__dirname, '../../SDEditor-API/package.json'));
    const express = require('express'), frontend = express(), server = createServer(frontend);
    const publicDir = resolve(__dirname, '../public');
    frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
        .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
    frontend.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
    frontend.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(publicDir, 'index.js'), 'utf8')
        .replace("app.mount('#app');", "window.__initializationFixtureApp = app.mount('#app');")));
    frontend.use('/v1', (req, res) => res.status(503).json({ error: 'Cloud disabled in local fixture.' }));
    frontend.use(express.static(publicDir));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const screenshots = mkdtempSync(join(tmpdir(), 'sdeditor-initialization-browser-'));
    let browser;
    const failures = [], results = [], layouts = [];
    try {
        browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
        const page = await context.newPage();
        page.on('pageerror', error => failures.push(error.message));
        await page.goto(origin + '/?cloudApi=' + encodeURIComponent(origin));
        await page.waitForFunction(() => window.__initializationFixtureApp?.startupReady
            && window.__initializationFixtureApp?.offlineStoreReady && window.__initializationFixtureApp?._cloud?.state
            && !window.__initializationFixtureApp.workspaceInitializationActive, null, { timeout: 30000 });
        const startupLabels = await page.evaluate(() => window.__initializationFixtureApp.workspaceInitializationRows.map(row => row.label));
        for (const label of ['Opening browser storage and checking legacy data', 'Restoring local settings',
            'Restoring account and Dictionary', 'Saving restored settings']) assert(startupLabels.includes(label), 'Existing startup work logged: ' + label);
        results.push('Normal-mode startup logs existing browser storage, settings, account/Dictionary and settings-save work.');
        await installHarness(page);
        const terminal = page.getByRole('log', { name: 'Workspace initialization activity' });
        const openButton = () => page.locator('.onlineVersionTable').getByRole('button', { name: 'Open editor', exact: true });
        const held = name => page.waitForFunction(name => !!window.__initializationFixture.gates[name], name);
        const release = name => page.evaluate(name => window.__initializationFixture.release(name), name);
        const hiddenBehindPreparation = async () => {
            assert.equal(await terminal.isVisible(), true);
            assert.equal(await page.locator('.versionCatalog').isVisible(), false);
            assert.equal(await page.locator('.workspace').isVisible(), false);
            assert.equal(await page.locator('.editor').isVisible(), false);
        };
        await openButton().click(); await held('draft'); await hiddenBehindPreparation();
        const totalBefore = await page.locator('.workspaceInitializationTotal').innerText();
        const runningBefore = await page.locator('.workspaceInitializationRow.running').last().locator('.workspaceInitializationTime').innerText();
        await page.waitForFunction(before => document.querySelector('.workspaceInitializationTotal')?.textContent !== before, totalBefore);
        await page.waitForFunction(before => document.querySelector('.workspaceInitializationRow.running:last-child .workspaceInitializationTime')?.textContent !== before, runningBefore);
        assert.match(await page.locator('.workspaceInitializationTotal').innerText(), /^\(\d+\.\ds\)$/);
        results.push('Open editor immediately shows the terminal before draft preservation; live total and running-row times advance.');
        await release('draft'); await held('cached'); await hiddenBehindPreparation();
        const completed = page.locator('.workspaceInitializationRow.done').filter({ hasText: 'Preserving editor drafts' }).first();
        const fixedTime = await completed.locator('.workspaceInitializationTime').innerText();
        await page.waitForFunction(before => document.querySelector('.workspaceInitializationTotal')?.textContent !== before,
            await page.locator('.workspaceInitializationTotal').innerText());
        assert.equal(await completed.locator('.workspaceInitializationTime').innerText(), fixedTime);
        await release('cached'); await held('shared'); await hiddenBehindPreparation();
        assert.equal(await page.evaluate(() => window.__initializationFixtureApp.loadingProgress), 100);
        assert.equal(await page.evaluate(() => window.__initializationFixtureApp.sourceLoaded), true);
        await release('shared'); await held('final-details'); await hiddenBehindPreparation();
        assert.equal(await page.evaluate(() => window.__initializationFixture.requests), 2);
        results.push('Cached source, actual workspace preparation, held shared preparation and final version details all remain behind initialization after local loading reaches 100.');
        await page.evaluate(() => {
            window.__initializationFixtureApp.theme = 'modern-dark';
            document.documentElement.setAttribute('data-theme', 'modern-dark');
        });
        await page.screenshot({ path: join(screenshots, 'opening-selected-source-1440.png') });
        await page.evaluate(() => {
            const app = window.__initializationFixtureApp;
            for (let index = 0; index < 25; index++) {
                const row = app.beginWorkspaceInitializationTask(index === 0
                    ? 'A filename <img src=x onerror=alert(1)> and a long source description'.repeat(3)
                    : 'Completed earlier initialization work ' + (index + 1));
                app.finishWorkspaceInitializationTask(row);
            }
            const errorRow = app.beginWorkspaceInitializationTask('Preserving old local work');
            app.finishWorkspaceInitializationTask(errorRow, { error: new Error('A storage error <script>alert(1)</script>') });
        });
        assert.equal(await terminal.locator('img, script').count(), 0, 'Task labels/errors render as escaped text.');
        assert((await terminal.innerText()).includes('<img src=x onerror=alert(1)>'));
        await terminal.evaluate(element => { element.scrollTop = 0; });
        await page.evaluate(async () => {
            const app = window.__initializationFixtureApp;
            app.finishWorkspaceInitializationTask(app.beginWorkspaceInitializationTask('New work while reviewing earlier steps'));
            await app.$nextTick();
        });
        assert.equal(await terminal.evaluate(element => element.scrollTop), 0, 'New work preserves manual scrolling through earlier steps.');
        await terminal.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await page.evaluate(async () => {
            const app = window.__initializationFixtureApp;
            app.finishWorkspaceInitializationTask(app.beginWorkspaceInitializationTask('New work while following current progress'));
            await app.$nextTick();
        });
        assert.equal(await terminal.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight < 2), true,
            'New work follows automatically when the log was already at its end.');
        const backgroundContrast = await page.evaluate(() => {
            const number = rgb => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
                const normalized = value / 255; return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
            }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
            window.__fixtureContrast = (first, second) => { const a = number(first), b = number(second); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
            return true;
        });
        assert(backgroundContrast);
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 900, height: 650 }, { width: 900, height: 420 }]) {
            await page.setViewportSize(viewport);
            for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
                await page.evaluate(theme => { window.__initializationFixtureApp.theme = theme; document.documentElement.setAttribute('data-theme', theme); }, theme);
                const metrics = await terminal.evaluate(element => {
                    const panel = element.closest('.workspaceInitializationPanel'), bounds = panel.getBoundingClientRect();
                    const computed = getComputedStyle(element), timing = getComputedStyle(element.querySelector('.workspaceInitializationTime'));
                    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
                        viewportWidth: innerWidth, viewportHeight: innerHeight, scrollWidth: element.scrollWidth,
                        clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
                        textContrast: window.__fixtureContrast(computed.color, computed.backgroundColor),
                        timeContrast: window.__fixtureContrast(timing.color, computed.backgroundColor) };
                });
                assert(metrics.x >= 0 && metrics.x + metrics.width <= viewport.width + 1, theme + ': panel fits desktop width.');
                assert(metrics.y >= 0 && metrics.y + metrics.height <= viewport.height + 1, theme + ': panel fits desktop height.');
                assert(metrics.scrollWidth <= metrics.clientWidth + 1, theme + ': long text wraps without horizontal overflow.');
                assert(metrics.scrollHeight > metrics.clientHeight, theme + ': historical rows stay available by scrolling.');
                assert(metrics.textContrast >= 4.5 && metrics.timeContrast >= 4.5, theme + ': log and times have readable contrast.');
                layouts.push({ viewport, theme, ...metrics });
                await page.screenshot({ path: join(screenshots, theme + '-' + viewport.width + 'x' + viewport.height + '.png') });
            }
        }
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Tab');
        assert.equal(await terminal.evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('End');
        await page.waitForFunction(() => { const log = document.querySelector('.workspaceInitializationTerminal'); return log.scrollTop > 0; });
        const bottom = await terminal.evaluate(element => element.scrollTop);
        await page.keyboard.press('Home');
        await page.waitForFunction(bottom => document.querySelector('.workspaceInitializationTerminal').scrollTop < bottom, bottom);
        results.push('All four themes at 1440×1000, resized 900×650 and shorter 900×420 fit, wrap long text, retain historical rows, provide readable contrast and support keyboard scrolling; automatic following preserves manual scrolling.');
        await release('final-details');
        await page.waitForFunction(() => !window.__initializationFixtureApp.workspaceInitializationActive && !window.__initializationFixtureApp.managedVersionBusy);
        assert.equal(await page.locator('.workspace').isVisible(), true);
        assert.equal(await terminal.count(), 0);
        assert.equal(await page.evaluate(() => window.__initializationFixtureApp._workspaceInitializationTimer), null);
        for (const mode of ['cancel', 'error']) {
            await installHarness(page, mode); await openButton().click();
            await page.waitForFunction(() => !window.__initializationFixtureApp.workspaceInitializationActive && !window.__initializationFixtureApp.managedVersionBusy);
            assert.equal(await page.locator('.versionCatalog').isVisible(), true, mode + ': chooser is restored.');
            assert.equal(await page.locator('.workspace').isVisible(), false);
            assert.equal(await page.evaluate(() => window.__initializationFixtureApp._workspaceInitializationTimer), null);
            if (mode === 'error') {
                const error = await page.evaluate(() => window.__initializationFixtureApp.managedOperationErrors.open);
                assert(error.includes('Fixture source preparation failed'));
                assert.equal(await page.locator('.versionCatalog img[src="x"]').count(), 0);
                assert.equal(await page.evaluate(() => window.__initializationFixtureApp.workspaceInitializationRows.some(row => row.status === 'failed')), true);
            }
        }
        results.push('Success reveals the ready workspace; declined confirmation and failed source preparation reveal the chooser and release timers.');
        assert.deepEqual(failures, [], 'No browser exceptions.');
        console.log(JSON.stringify({ status: 'PASS', normalMode: true, controlledStorageAndCloud: true, browser: executablePath,
            results, layouts, screenshots }, null, 2));
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
