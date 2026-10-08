// Disposable normal-mode acceptance check: real IndexedDB, draft records and save worker.
// Run with PLAYWRIGHT_MODULE_PATH when Playwright is outside this checkout.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join } = require('node:path');
const { readFileSync, existsSync } = require('node:fs');
const { createServer } = require('node:http');

const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!executablePath) throw new Error('No installed Edge/Chrome found. Set FIXTURE_BROWSER_PATH.');

function workerGate() {
  const NativeWorker = window.Worker;
  const gate = window.__deferredSaveGate = { mode: 'normal', held: [], sent: [], committed: 0, failed: 0 };
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (event.data?.type === 'saved') gate.committed++;
        if (event.data?.type === 'error') gate.failed++;
      });
    }
    postMessage(message, options) {
      if (message?.type === 'saveTranslations') {
        gate.sent.push({ id: message.id, filepath: message.batch.files[0]?.filepath });
        if (gate.mode === 'hold') { gate.held.push({ worker: this, message, options }); return; }
        if (gate.mode === 'fail-next' || gate.mode === 'fail-base-next') {
          const baseChanged = gate.mode === 'fail-base-next';
          gate.mode = 'normal';
          setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: {
            type: 'error', id: message.id,
            error: baseChanged ? { name: 'Error', code: 'DRAFT_BASE_CHANGED', message: 'Fixture committed base changed before draft staging.' }
              : { name: 'QuotaExceededError', message: 'Fixture storage failure before commit.' },
          } })), 0);
          return;
        }
      }
      super.postMessage(message, options);
    }
  };
  gate.release = () => {
    gate.mode = 'normal';
    for (const item of gate.held.splice(0)) NativeWorker.prototype.postMessage.call(item.worker, item.message, item.options);
  };
}

async function run() {
  const fromApi = createRequire(resolve(__dirname, '../../SDEditor-API/package.json'));
  const express = require('express'), frontend = express(), server = createServer(frontend);
  const publicDir = resolve(__dirname, '../public');
  frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
    .replace('<head>', '<head><script>(' + workerGate.toString() + ')();</script>')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
  frontend.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
  frontend.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(publicDir, 'index.js'), 'utf8')
    .replace("app.mount('#app');", "window.__deferredSaveApp = app.mount('#app');")));
  frontend.use('/v1', (req, res) => res.status(503).json({ error: 'Cloud disabled in local fixture.' }));
  frontend.use(express.static(publicDir));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  const pageErrors = [], results = [];
  try {
    browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin + '/?cloudApi=' + encodeURIComponent(origin));
    await page.waitForFunction(() => window.__deferredSaveApp?.offlineStoreReady && window.__deferredSaveApp?.startupReady
      && window.__deferredSaveApp?._cloud?.state && !window.__deferredSaveApp._cloudInitializing
      && !window.__deferredSaveApp._cloudApplying, null, { timeout: 30000 });
    await page.evaluate(async () => {
      const vm = window.__deferredSaveApp;
      if (vm.testMode || vm.cloudSignedIn) throw new Error('Requires signed-out normal mode.');
      vm._cloudApplying = true;
      try {
        const previous = vm.lang;
        vm.lang = 'Thai'; vm.inlineEditor = false;
        await vm.$nextTick();
        await vm._cloud.selectLanguage('Thai', vm.cloudPayload(), previous);
        await vm.cloudApply(vm._cloud.snapshot());
      } finally { vm._cloudApplying = false; }
      vm.lang = 'Thai'; vm.inlineEditor = false; vm.hideDNT = false; vm.dictionary = []; vm.editorRegexes = [];
      await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
      vm.showSetting = false; vm.needsInitialSettings = false;
      await vm.activateGameVersion('poe1', { checkMigration: false });
      const source = ['01_first', '02_second', '03_third'].map((name, index) => ({
        filepath: 'deferred-fixture/' + name + '.txt', filedir: 'deferred-fixture', filename: name + '.txt', name: '',
        stats: ['deferred_' + index], variables: ['#'], remarks: [''],
        translations: { English: ['English ' + index], Thai: ['Original ' + index], German: ['German ' + index] }, isDNT: false,
      }));
      const zip = new JSZip();
      for (const desc of source) zip.file(desc.filepath, descEncode(desc), { date: new Date('2026-10-08T00:00:00Z'), createFolders: false });
      const file = new File([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], 'DeferredFixture.zip', { type: 'application/zip' });
      const identity = await vm.readImportZipIdentity(file, zip);
      const clone = item => JSON.parse(JSON.stringify(item));
      await vm.importUpdateZipFile(file, clone(source), { identity, rawSource: clone(source) });
      if (vm.descs.length !== 3 || !vm.sourceIdentity) throw new Error('Source fixture import failed.');
      vm.showSetting = false; vm.needsInitialSettings = false; vm.selectAllFileFilters(); vm.applyFileSearch();
      await vm.loadEditorDrafts(); await vm.$nextTick();
    });
    const first = 'deferred-fixture/01_first.txt', second = 'deferred-fixture/02_second.txt', third = 'deferred-fixture/03_third.txt';
    const open = async filepath => {
      assert.equal(await page.evaluate(filepath => window.__deferredSaveApp.editFile(filepath, true), filepath), true);
      await page.waitForFunction(filepath => {
        const vm = window.__deferredSaveApp;
        return vm.editorVisible && vm.editorCurrentEditingDesc?.filepath === filepath && !vm.editorLoading;
      }, filepath);
    };
    const field = () => page.locator('.editor .textHL input:not([readonly]), .editor .textHL textarea:not([readonly])').first();
    const edit = async text => {
      await field().fill(text);
      assert.equal(await page.evaluate(() => window.__deferredSaveApp.flushEditorDraft()), true);
      assert.equal(await page.evaluate(() => !!window.__deferredSaveApp._draftSession?.record), true);
    };
    const inspect = filepath => page.evaluate(async filepath => {
      const vm = window.__deferredSaveApp, desc = vm.getDescByFilepath(filepath), scope = vm.editorDraftScope(filepath);
      const workspace = await OfflineStore.getWorkspace(vm.managedWorkspaceScope());
      const draft = await OfflineStore.getTranslationDraft(vm.editorDraftKey(scope));
      return { committed: desc.translations.Thai, saved: !!desc.hasChanges, staged: workspace?.staged?.Thai?.[filepath] || null,
        draft, pending: vm.pendingLocalSaves, error: vm.localSaveError, current: vm.editorCurrentEditingDesc?.filepath,
        currentText: vm.editorBlocks.map(block => block.translation), mode: vm.testMode,
        jobs: vm._pendingSaves.snapshot().jobs.map(job => ({ id: job.id, durable: job.durable, status: job.status, deferDisplay: job.batch.deferDisplay })) };
    }, filepath);
    const hold = () => page.evaluate(() => { window.__deferredSaveGate.mode = 'hold'; });
    const release = async () => {
      await page.evaluate(() => window.__deferredSaveGate.release());
      await page.waitForFunction(() => !window.__deferredSaveApp.pendingLocalSaves && !window.__deferredSaveApp._pendingSaves.snapshot().jobs.length);
    };
    await open(first);
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await page.evaluate(theme => { window.__deferredSaveApp.theme = theme; document.documentElement.setAttribute('data-theme', theme); }, theme);
      assert.equal(await field().isVisible(), true, theme + ': editable field visible');
      assert.equal(await page.getByRole('button', { name: 'Save & close', exact: true }).isEnabled(), true, theme + ': Save enabled');
      assert.equal(await page.evaluate(() => document.querySelector('.editor').getBoundingClientRect().width <= innerWidth + 1), true,
        theme + ': editor fits desktop viewport');
    }
    results.push('Four desktop themes: editable field and Save control visible/enabled; editor fits viewport.');
    await edit('First queued translation'); await hold();
    const startClose = Date.now();
    await page.getByRole('button', { name: 'Save & close', exact: true }).click();
    await page.waitForFunction(() => !window.__deferredSaveApp.editorVisible, null, { timeout: 2000 });
    await page.waitForFunction(() => window.__deferredSaveGate.held.length === 1, null, { timeout: 2000 });
    const closedMs = Date.now() - startClose, beforeAck = await inspect(first);
    assert.deepEqual(beforeAck.committed, ['Original 0']); assert.equal(beforeAck.saved, false); assert.equal(beforeAck.staged, null);
    assert.equal(beforeAck.pending, 1); assert.equal(beforeAck.draft.state, 'active'); assert.equal(beforeAck.jobs[0].deferDisplay, true);
    await open(second); await edit('Second draft stays editable');
    const whileHeld = await inspect(first);
    assert.equal(whileHeld.current, second); assert.deepEqual(whileHeld.currentText, ['Second draft stays editable']);
    assert.deepEqual(whileHeld.committed, ['Original 0']);
    await release();
    const committed = await inspect(first);
    assert.deepEqual(committed.committed, ['First queued translation']); assert.equal(committed.saved, true);
    assert.ok(committed.staged); assert.notEqual(committed.draft.state, 'active');
    assert.equal(committed.current, second); assert.deepEqual(committed.currentText, ['Second draft stays editable']);
    results.push('Save & close finished in ' + closedMs + ' ms while worker was held; second-file typing stayed intact; committed text/Saved changed only after real worker ACK.');

    await hold();
    const startNext = Date.now();
    await field().focus(); await page.keyboard.press('F2');
    await page.waitForFunction(filepath => window.__deferredSaveApp.editorCurrentEditingDesc?.filepath === filepath
      && !window.__deferredSaveApp.editorLoading && !window.__deferredSaveApp.navigationBusy, third, { timeout: 2000 });
    await page.waitForFunction(() => window.__deferredSaveGate.held.length === 1, null, { timeout: 2000 });
    const nextMs = Date.now() - startNext, secondHeld = await inspect(second);
    assert.deepEqual(secondHeld.committed, ['Original 1']); assert.equal(secondHeld.saved, false); assert.equal(secondHeld.draft.state, 'active');
    await edit('Third draft after next'); await release();
    const secondAck = await inspect(second);
    assert.deepEqual(secondAck.committed, ['Second draft stays editable']); assert.equal(secondAck.saved, true);
    assert.equal(secondAck.current, third); assert.deepEqual(secondAck.currentText, ['Third draft after next']);
    results.push('F2 Save & next opened the next file in ' + nextMs + ' ms while worker was held; next-file draft survived ACK.');

    await page.evaluate(() => { window.__deferredSaveGate.mode = 'fail-next'; });
    await page.getByRole('button', { name: 'Save & close', exact: true }).click();
    await page.waitForFunction(() => !!window.__deferredSaveApp.localSaveError, null, { timeout: 5000 });
    const failed = await inspect(third);
    assert.deepEqual(failed.committed, ['Original 2']); assert.equal(failed.saved, false); assert.equal(failed.staged, null);
    assert.equal(failed.draft.state, 'active'); assert.deepEqual(failed.draft.translations, ['Third draft after next']);
    assert.equal(failed.jobs[0].status, 'failed');
    const originalId = failed.jobs[0].id;
    await hold();
    await page.evaluate(() => { window.__fixtureRetry = window.__deferredSaveApp.retryPendingSaves(); });
    await page.waitForFunction(() => window.__deferredSaveGate.held.length === 1);
    const retryId = await page.evaluate(() => window.__deferredSaveGate.held[0].message.id);
    assert.equal(retryId, originalId);
    assert.match((await inspect(third)).error, /Fixture storage failure/);
    await release(); await page.evaluate(() => window.__fixtureRetry);
    const retried = await inspect(third);
    assert.deepEqual(retried.committed, ['Third draft after next']); assert.equal(retried.saved, true); assert.ok(retried.staged);
    assert.equal(retried.error, ''); assert.notEqual(retried.draft.state, 'active');
    const revisions = await page.evaluate(async filepath => {
      const vm = window.__deferredSaveApp;
      return await OfflineStore.listRevisions(filepath, 'Thai', 100, vm.managedWorkspaceScope());
    }, third);
    assert.equal(revisions.filter(row => row.note === 'save').length, 1, 'Retry created one saved revision');
    results.push('Injected pre-commit storage failure retained recoverable draft and unchanged committed text; retry reused the job ID, cleared its warning after ACK and created one save revision.');
    const sourceHash = await page.evaluate(() => window.__deferredSaveApp.sourceIdentity);
    await page.reload();
    await page.waitForFunction(() => window.__deferredSaveApp?.offlineStoreReady && window.__deferredSaveApp?.startupReady
      && window.__deferredSaveApp?._cloud?.state && !window.__deferredSaveApp._cloudInitializing
      && !window.__deferredSaveApp._cloudApplying, null, { timeout: 30000 });
    await page.evaluate(() => window.__deferredSaveApp.activateGameVersion('poe1', { checkMigration: false }));
    assert.equal(await page.evaluate(sourceHash => window.__deferredSaveApp.managedActivateWorkspace(sourceHash, 'Thai'), sourceHash), true,
      'Select the retained local source version after normal startup');
    try {
      await page.waitForFunction(() => window.__deferredSaveApp.descs?.length === 3 && !window.__deferredSaveApp.versionStorageLoading, null, { timeout: 5000 });
    } catch (error) {
      console.error(JSON.stringify(await page.evaluate(() => {
        const vm = window.__deferredSaveApp;
        return { lang: vm.lang, game: vm.gameVersion, selected: vm.gameVersionSelected, source: vm.sourceIdentity,
          descs: vm.descs.length, loading: vm.versionStorageLoading, chooser: vm.versionChooserVisible,
          localVersions: vm.localVersions, error: vm.cloudStorageError, profile: vm.cloudProfileId, ready: vm.startupReady };
      }), null, 2));
      throw error;
    }
    assert.equal(await page.evaluate(() => window.__deferredSaveApp.testMode), false);
    assert.deepEqual(await page.evaluate(() => window.__deferredSaveApp.descs.map(desc => desc.translations.Thai[0]).sort()),
      ['First queued translation', 'Second draft stays editable', 'Third draft after next'].sort());
    results.push('Reload recovered all three committed translations from real IndexedDB.');

    await page.evaluate(async () => {
      const vm = window.__deferredSaveApp;
      vm.inlineEditor = true; vm.inlineSidebarVisible = false; vm.showSetting = false; vm.needsInitialSettings = false;
      vm.selectAllFileFilters(); vm.applyFileSearch(); await vm.$nextTick();
    });
    const row = filepath => page.locator('tr[data-filepath="' + filepath + '"]');
    const inlineField = filepath => row(filepath).locator('.textHL input:not([readonly]), .textHL textarea:not([readonly])').first();
    const waitInline = filepath => page.waitForFunction(filepath => {
      const vm = window.__deferredSaveApp;
      return vm.inlineActive && vm.editorCurrentEditingDesc?.filepath === filepath && !vm.editorLoading
        && !vm.inlineTransitionBusy && !vm.navigationBusy;
    }, filepath, { timeout: 2000 });
    await row(first).locator('.inlineSourceCell').click(); await waitInline(first);
    await inlineField(first).fill('Inline queued translation');
    assert.equal(await page.evaluate(() => window.__deferredSaveApp.flushEditorDraft()), true);
    await hold();
    const startInline = Date.now();
    await row(second).locator('.inlineSourceCell').click(); await waitInline(second);
    await page.waitForFunction(() => window.__deferredSaveGate.held.length === 1);
    const inlineMs = Date.now() - startInline;
    assert.deepEqual((await inspect(first)).committed, ['First queued translation']);
    await inlineField(second).fill('Inline second draft');
    assert.equal(await page.evaluate(() => window.__deferredSaveApp.flushEditorDraft()), true);
    await inlineField(second).focus(); await page.keyboard.press('Control+ArrowDown'); await waitInline(third);
    assert.equal(await page.evaluate(() => window.__deferredSaveApp.pendingLocalSaves), 2,
      'Second inline job queued without waiting for held first worker');
    await inlineField(third).fill('Rejected inline private draft');
    assert.equal(await page.evaluate(() => window.__deferredSaveApp.flushEditorDraft()), true);
    await release();
    const inlineAck = await inspect(first);
    assert.deepEqual(inlineAck.committed, ['Inline queued translation']);
    assert.deepEqual((await inspect(second)).committed, ['Inline second draft']);
    assert.equal(inlineAck.current, third); assert.deepEqual(inlineAck.currentText, ['Rejected inline private draft']);
    results.push('Pointer row transition completed in ' + inlineMs + ' ms while held; Ctrl+Down queued a second inline save and opened another row; ACK preserved that row\'s private typing.');

    await inlineField(third).fill('Third explicitly staged inline');
    assert.equal(await page.evaluate(() => window.__deferredSaveApp.flushEditorDraft()), true);
    await hold();
    await row(third).getByRole('button', { name: 'Stage draft', exact: true }).click();
    await page.waitForFunction(() => window.__deferredSaveGate.held.length === 1 && !window.__deferredSaveApp.editorSaving,
      null, { timeout: 2000 });
    assert.deepEqual((await inspect(third)).committed, ['Third draft after next']);
    await row(first).locator('.inlineSourceCell').click(); await waitInline(first);
    assert.equal(await inlineField(first).isEditable(), true);
    assert.equal(await page.evaluate(() => window.__deferredSaveApp.pendingLocalSaves), 1);
    await release();
    assert.deepEqual((await inspect(third)).committed, ['Third explicitly staged inline']);
    assert.equal((await inspect(third)).current, first);
    results.push('Explicit Stage draft released navigation while worker was held; another inline row remained editable before ACK.');

    await row(third).locator('.inlineSourceCell').click(); await waitInline(third);
    await inlineField(third).fill('Rejected inline private draft');
    assert.equal(await page.evaluate(() => window.__deferredSaveApp.flushEditorDraft()), true);
    await page.evaluate(() => { window.__deferredSaveGate.mode = 'fail-base-next'; });
    await row(first).locator('.inlineSourceCell').click(); await waitInline(first);
    await page.waitForFunction(() => !!window.__deferredSaveApp.deferredDraftSaveError
      && !window.__deferredSaveApp._pendingSaves.snapshot().jobs.length);
    const rejected = await inspect(third);
    assert.deepEqual(rejected.committed, ['Third explicitly staged inline']); assert.equal(rejected.draft.state, 'active');
    assert.deepEqual(rejected.draft.translations, ['Rejected inline private draft']);
    assert.equal(await page.evaluate(() => window.__deferredSaveApp.inlineDraftError), '', 'Review rejection does not block unrelated row navigation');
    assert.equal(await inlineField(first).isEditable(), true);
    await inlineField(first).fill('Unrelated row remains editable');
    await inlineField(first).fill('Inline queued translation');
    assert.equal(await page.evaluate(() => window.__deferredSaveApp.flushEditorDraft()), true);
    const reviewBanner = page.locator('[role="alert"]').filter({ hasText: 'The committed translation or local draft changed' });
    await reviewBanner.getByRole('button', { name: 'View local drafts', exact: true }).click();
    await page.getByRole('dialog', { name: 'Local drafts', exact: true }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Preserved drafts' }).getByRole('button').filter({ hasText: third }).count(), 1);
    await page.getByRole('dialog', { name: 'Local drafts', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    results.push('Injected DRAFT_BASE_CHANGED retained the private inline draft, displayed its scoped review warning, left another row editable and opened View local drafts successfully.');
    assert.deepEqual(pageErrors, [], 'No uncaught browser errors');
    results.push('No uncaught browser errors.');
    console.log(JSON.stringify({ origin, results }, null, 2));
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
