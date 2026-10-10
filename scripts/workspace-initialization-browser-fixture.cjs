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
        app._cloud.refreshSession = async () => {};
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
        OfflineStore.getWorkspaceSnapshot = async () => ({ source: clone(source), workspace: await OfflineStore.getWorkspace() });
        app._cloud.request = async () => {
            window.__initializationFixture.requests++;
            await wait('final-details');
            return clone(details);
        };
        app.initializeCollaboration = async () => { await wait('shared'); };
        await app.$nextTick();
    }, mode);
}

async function checkProgressUI(page, results) {
    await page.evaluate(async () => {
        const app = window.__initializationFixtureApp;
        const owner = app.beginWorkspaceInitialization({ force: true, label: 'Preparing a progress fixture' });
        const unknown = app.beginWorkspaceInitializationTask('Preparing work with unknown size', owner);
        window.__fixtureProgress = { owner, unknown };
        await app.$nextTick();
    });
    const overall = page.getByRole('progressbar', { name: 'Overall workspace initialization progress', exact: true });
    const unknown = page.getByRole('progressbar', { name: 'Preparing work with unknown size progress', exact: true });
    assert.equal(await overall.isVisible(), true, 'Overall progress is always visible during initialization.');
    assert.equal(await overall.getAttribute('value'), null, 'An undiscovered overall workload remains indeterminate.');
    assert.equal(await unknown.getAttribute('value'), null, 'Work without a measurable total remains indeterminate.');
    assert.equal(await unknown.getAttribute('aria-valuetext'), 'In progress');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await unknown.evaluate(element => getComputedStyle(element, '::-webkit-progress-bar').animationName), 'none',
        'Reduced motion stops the indeterminate progress animation.');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(async () => {
        const app = window.__initializationFixtureApp, fixture = window.__fixtureProgress;
        app.setWorkspaceInitializationPlan(fixture.owner, [
            { label: 'Preparing work with unknown size', weight: 1 },
            { label: 'Downloading source archive', weight: 3 },
        ]);
        fixture.download = app.beginWorkspaceInitializationTask('Downloading source archive', fixture.owner);
        app.updateWorkspaceInitializationTaskProgress(fixture.download, { completed: 1024 * 1024, total: 4 * 1024 * 1024, unit: 'bytes' });
        app.finishWorkspaceInitializationTask(fixture.unknown);
        await app.$nextTick();
    });
    const download = page.getByRole('progressbar', { name: 'Downloading source archive progress', exact: true });
    assert.equal(await download.getAttribute('value'), '25', 'Downloaded bytes produce a determinate task percentage.');
    assert.match(await download.getAttribute('aria-valuetext'), /1\.0 MiB \/ 4\.0 MiB/, 'The task exposes readable byte progress.');
    assert.equal(await overall.getAttribute('value'), '43', 'Overall progress includes a completed step and the weighted measured task.');
    assert.match(await overall.getAttribute('aria-valuetext'), /1 of 2 steps completed/, 'Overall progress exposes completed and total steps.');
    assert.equal(await unknown.count(), 0, 'Completed unmeasured rows keep their timing without a misleading progress bar.');
    await page.evaluate(async () => {
        const app = window.__initializationFixtureApp;
        app.updateWorkspaceInitializationTaskProgress(window.__fixtureProgress.download, { completed: 3 * 1024 * 1024, total: 4 * 1024 * 1024, unit: 'bytes' });
        await app.$nextTick();
    });
    assert.equal(await download.getAttribute('value'), '75', 'Task progress updates in place as more bytes arrive.');
    assert.equal(await overall.getAttribute('value'), '81', 'Overall progress advances with the measured task.');
    await page.evaluate(async () => {
        const app = window.__initializationFixtureApp;
        app.finishWorkspaceInitializationTask(window.__fixtureProgress.download);
        await app.$nextTick();
    });
    assert.equal(await download.getAttribute('value'), '100', 'A completed measured task retains its completed bar.');
    assert.equal(await overall.getAttribute('value'), '99', 'Overall progress does not claim readiness while an initialization owner is active.');
    await page.evaluate(() => window.__initializationFixtureApp.finishWorkspaceInitialization(window.__fixtureProgress.owner));
    assert.equal(await overall.count(), 0, 'The completed initialization releases its progress view.');
    results.push('Overall and unknown-size task progress are indeterminate until measured; byte progress updates from 25 to 75 to completion, weighted overall progress advances without reporting readiness early, and reduced motion stops the indeterminate animation.');
}

async function checkRetainedSettingsLog(page, context, screenshots, results, layouts) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.workspace').getByRole('button', { name: 'Settings', exact: true }).click();
    const logsTab = page.getByRole('tab', { name: 'Logs', exact: true });
    await logsTab.click();
    const panel = page.locator('#settings-panel-logs');
    const text = panel.locator('textarea');
    const copy = panel.getByRole('button', { name: 'Copy log', exact: true });
    assert.equal(await text.isVisible(), true, 'Completed preparation remains readable in Settings > Logs.');
    assert.equal(await text.evaluate(element => element.readOnly), true, 'The retained log is a selectable read-only field.');
    const frozen = await text.inputValue();
    assert(frozen.includes('Preserving editor drafts'), 'The completed managed opening is retained.');
    assert(frozen.includes('New work while reviewing earlier steps'), 'Earlier terminal activity remains in the log.');
    assert(frozen.includes('A storage error <script>alert(1)</script>'), 'Errors are retained as text.');
    assert.match(frozen, /Total[^\n]*\(\d+\.\ds\)/i, 'The retained log includes its total elapsed time.');
    assert.match(frozen, /\(\d+\.\ds\)/, 'Individual phase timings remain available.');
    assert.equal(await panel.locator('script, img').count(), 0, 'Log labels and error messages stay escaped.');
    await logsTab.focus();
    for (const [key, tab] of [['ArrowLeft', 'Data'], ['ArrowRight', 'Logs'], ['Home', 'General'], ['End', 'Logs']]) {
        await page.keyboard.press(key);
        assert.equal(await page.getByRole('tab', { name: tab, exact: true }).getAttribute('aria-selected'), 'true', key + ': keyboard selects the expected settings tab.');
        assert.equal(await page.getByRole('tab', { name: tab, exact: true }).evaluate(element => element === document.activeElement), true, key + ': keyboard focus follows the selected tab.');
    }
    await text.focus(); await page.keyboard.press('Control+A');
    assert.equal(await text.evaluate(element => element.selectionStart === 0 && element.selectionEnd === element.value.length), true,
        'The complete retained log can be selected with the keyboard.');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await copy.click();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clipboardText.replace(/\r\n/g, '\n'), frozen, 'Copy log writes the complete displayed text (Windows clipboard normalizes line endings).');
    assert.match(await panel.locator('[role="status"]').innerText(), /copied/i, 'Successful clipboard writing reports completion.');
    await page.evaluate(() => {
        window.__fixtureOriginalClipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new DOMException('Fixture denied clipboard access', 'NotAllowedError'); } });
    });
    await copy.click();
    assert.doesNotMatch(await panel.locator('[role="status"]').innerText(), /copied/i, 'Rejected clipboard access does not claim a successful copy.');
    assert.equal(await text.evaluate(element => element === document.activeElement && element.selectionStart === 0 && element.selectionEnd === element.value.length), true,
        'Clipboard rejection focuses and selects the retained text for manual copying.');
    await page.setViewportSize({ width: 900, height: 420 });
    await copy.click();
    await page.waitForFunction(() => {
        const field = document.querySelector('#settings-panel-logs textarea').getBoundingClientRect();
        const body = document.querySelector('.settingsBody').getBoundingClientRect();
        return Math.min(field.bottom, body.bottom) - Math.max(field.top, body.top) >= 100;
    });
    assert.equal(await text.evaluate(element => element === document.activeElement && element.selectionStart === 0 && element.selectionEnd === element.value.length), true,
        'The rejected-copy fallback remains selected and visible in a short desktop window.');
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: window.__fixtureOriginalClipboardWrite }));
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 900, height: 650 }, { width: 900, height: 420 }]) {
        await page.setViewportSize(viewport);
        for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
            await page.evaluate(theme => { window.__initializationFixtureApp.theme = theme; document.documentElement.setAttribute('data-theme', theme); }, theme);
            await copy.focus(); await page.keyboard.press('Tab');
            if (viewport.height < 500) {
                await page.locator('.settingsBody').hover({ position: { x: 10, y: 10 } });
                await page.mouse.wheel(0, 600);
                await page.waitForFunction(() => {
                    const field = document.querySelector('#settings-panel-logs textarea').getBoundingClientRect();
                    const body = document.querySelector('.settingsBody').getBoundingClientRect();
                    return Math.min(field.bottom, body.bottom) - Math.max(field.top, body.top) >= 100;
                });
            }
            const metrics = await text.evaluate(element => {
                const dialog = element.closest('.settingsDialog').getBoundingClientRect();
                const field = element.getBoundingClientRect(), body = element.closest('.settingsBody').getBoundingClientRect(), computed = getComputedStyle(element);
                return { x: dialog.x, y: dialog.y, width: dialog.width, height: dialog.height,
                    fieldWidth: field.width, fieldRight: field.right, viewportWidth: innerWidth, viewportHeight: innerHeight,
                    focused: element === document.activeElement, visibleFieldHeight: Math.min(field.bottom, body.bottom) - Math.max(field.top, body.top),
                    scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
                    textContrast: window.__fixtureContrast(computed.color, computed.backgroundColor) };
            });
            assert(metrics.x >= 0 && metrics.x + metrics.width <= viewport.width + 1, theme + ': Settings Logs fits desktop width.');
            assert(metrics.y >= 0 && metrics.y + metrics.height <= viewport.height + 1, theme + ': Settings Logs fits desktop height.');
            assert(metrics.fieldRight <= viewport.width + 1, theme + ': retained log field fits the dialog.');
            assert(metrics.focused, theme + ': the retained log remains keyboard accessible.');
            assert(metrics.visibleFieldHeight >= 100, theme + ': Settings body scrolling keeps the retained log readable in short desktop windows.');
            assert(metrics.scrollHeight > metrics.clientHeight, theme + ': long retained logs can be scrolled.');
            assert(metrics.textContrast >= 4.5, theme + ': retained log text has readable contrast.');
            layouts.push({ section: 'Settings Logs', viewport, theme, ...metrics });
            await page.screenshot({ path: join(screenshots, 'settings-logs-' + theme + '-' + viewport.width + 'x' + viewport.height + '.png') });
        }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.settingsHeader').getByRole('button', { name: /Close/ }).click();
    await page.waitForFunction(() => !window.__initializationFixtureApp.showSetting);
    await page.locator('.workspace').getByRole('button', { name: 'Settings', exact: true }).click();
    await logsTab.click();
    assert.equal(await text.inputValue(), frozen, 'Reopening settings preserves the completed log and frozen durations.');
    await page.locator('.settingsHeader').getByRole('button', { name: /Close/ }).click();
    await page.waitForFunction(() => !window.__initializationFixtureApp.showSetting);
    results.push('Completed initialization remains selectable in Settings > Logs; real clipboard copying succeeds, rejected access offers a selected manual fallback, keyboard tabs work, reopening preserves text and all four themes fit resized desktop windows.');
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
        await checkProgressUI(page, results);
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
        assert.equal(await page.evaluate(() => window.__initializationFixture.requests), 0);
        results.push('Cached source, actual workspace preparation and held local shared preparation remain behind initialization after local loading reaches 100; cached version facts require no network request.');
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
            const measured = app.beginWorkspaceInitializationTask('Downloading fixture data');
            app.updateWorkspaceInitializationTaskProgress(measured, { completed: 1024 * 1024, total: 4 * 1024 * 1024, unit: 'bytes' });
            window.__fixtureMeasuredTask = measured;
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
                await terminal.evaluate(element => { element.scrollTop = element.scrollHeight; });
                const metrics = await terminal.evaluate(element => {
                    const panel = element.closest('.workspaceInitializationPanel'), bounds = panel.getBoundingClientRect();
                    const computed = getComputedStyle(element), timing = getComputedStyle(element.querySelector('.workspaceInitializationTime'));
                    const overall = panel.querySelector('.workspaceInitializationOverallProgress progress').getBoundingClientRect();
                    const taskElement = [...element.querySelectorAll('.workspaceInitializationTaskProgress progress')].at(-1);
                    const task = taskElement.getBoundingClientRect(), terminalBounds = element.getBoundingClientRect();
                    const progressLabel = taskElement.parentElement.querySelector('.workspaceInitializationProgressDetail');
                    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
                        viewportWidth: innerWidth, viewportHeight: innerHeight, scrollWidth: element.scrollWidth,
                        clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
                        textContrast: window.__fixtureContrast(computed.color, computed.backgroundColor),
                        timeContrast: window.__fixtureContrast(timing.color, computed.backgroundColor),
                        progressTextContrast: window.__fixtureContrast(getComputedStyle(progressLabel).color, computed.backgroundColor),
                        overallLeft: overall.left, overallRight: overall.right, overallHeight: overall.height,
                        taskLeft: task.left, taskRight: task.right, taskHeight: task.height,
                        taskVisible: task.top >= terminalBounds.top && task.bottom <= terminalBounds.bottom };
                });
                assert(metrics.x >= 0 && metrics.x + metrics.width <= viewport.width + 1, theme + ': panel fits desktop width.');
                assert(metrics.y >= 0 && metrics.y + metrics.height <= viewport.height + 1, theme + ': panel fits desktop height.');
                assert(metrics.scrollWidth <= metrics.clientWidth + 1, theme + ': long text wraps without horizontal overflow.');
                assert(metrics.scrollHeight > metrics.clientHeight, theme + ': historical rows stay available by scrolling.');
                assert(metrics.textContrast >= 4.5 && metrics.timeContrast >= 4.5, theme + ': log and times have readable contrast.');
                assert(metrics.progressTextContrast >= 4.5, theme + ': task progress text has readable contrast.');
                assert(metrics.overallHeight >= 8 && metrics.taskHeight >= 5, theme + ': progress bars remain visible.');
                assert(metrics.taskVisible, theme + ': scrolling to current work exposes the task progress bar.');
                assert(metrics.overallLeft >= metrics.x && metrics.overallRight <= metrics.x + metrics.width + 1,
                    theme + ': overall progress fits the panel.');
                assert(metrics.taskLeft >= metrics.x && metrics.taskRight <= metrics.x + metrics.width + 1,
                    theme + ': task progress fits the terminal beside aligned timings.');
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
        await page.evaluate(() => window.__initializationFixtureApp.finishWorkspaceInitializationTask(window.__fixtureMeasuredTask));
        await release('shared');
        await page.waitForFunction(() => !window.__initializationFixtureApp.workspaceInitializationActive && !window.__initializationFixtureApp.managedVersionBusy);
        await held('final-details');
        assert.equal(await page.locator('.workspace').isVisible(), true);
        assert.equal(await terminal.count(), 0);
        assert.equal(await page.evaluate(() => window.__initializationFixtureApp._workspaceInitializationTimer), null);
        assert.equal(await page.evaluate(() => window.__initializationFixture.requests), 1);
        assert.equal(await page.evaluate(() => window.__initializationFixtureApp.workspaceInitializationRows.some(row => /Refreshing active version/.test(row.label))), false);
        results.push('An unresolved refreshed team-details request starts after local readiness and leaves the workspace visible and the initialization log completed.');
        await release('final-details');
        await checkRetainedSettingsLog(page, context, screenshots, results, layouts);
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
                await page.locator('.versionCatalog').getByRole('button', { name: 'Settings', exact: true }).click();
                await page.getByRole('tab', { name: 'Logs', exact: true }).click();
                assert((await page.locator('#settings-panel-logs textarea').inputValue()).includes(error), 'Failed source preparation is retained in Settings > Logs.');
                await page.locator('.settingsHeader').getByRole('button', { name: /Close/ }).click();
                await page.waitForFunction(() => !window.__initializationFixtureApp.showSetting);
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
