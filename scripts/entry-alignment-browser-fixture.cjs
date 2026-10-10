// Disposable normal-mode acceptance: real IndexedDB, recovery checkpoints and save worker.
// Run with PLAYWRIGHT_MODULE_PATH or FIXTURE_BROWSER_PATH when runtimes are elsewhere.
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

async function run() {
  const fromApi = createRequire(resolve(__dirname, '../../SDEditor-API/package.json'));
  const express = require('express'), frontend = express(), server = createServer(frontend);
  const publicDir = resolve(__dirname, '../public');
  frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
  frontend.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
  frontend.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(publicDir, 'index.js'), 'utf8')
    .replace("app.mount('#app');", "window.__alignmentApp = app.mount('#app');")));
  frontend.use('/v1', (req, res) => res.status(503).json({ error: 'Cloud disabled in local fixture.' }));
  frontend.use(express.static(publicDir));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser, page;
  const pageErrors = [], results = [], screenshots = [];
  try {
    browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    const ready = () => page.waitForFunction(() => window.__alignmentApp?.offlineStoreReady && window.__alignmentApp?.startupReady
      && window.__alignmentApp?._cloud?.state && !window.__alignmentApp._cloudInitializing
      && !window.__alignmentApp._cloudApplying, null, { timeout: 30000 });
    await page.goto(origin + '/?cloudApi=' + encodeURIComponent(origin)); await ready();
    await page.evaluate(async () => {
      const vm = window.__alignmentApp;
      if (vm.testMode || vm.cloudSignedIn) throw new Error('Requires signed-out normal mode.');
      vm._cloudApplying = true;
      try {
        const previous = vm.lang;
        vm.lang = 'Thai'; vm.inlineEditor = false;
        await vm.$nextTick(); await vm._cloud.selectLanguage('Thai', vm.cloudPayload(), previous);
        await vm.cloudApply(vm._cloud.snapshot());
      } finally { vm._cloudApplying = false; }
      vm.lang = 'Thai'; vm.inlineEditor = false; vm.hideDNT = false; vm.dictionary = []; vm.editorRegexes = [];
      await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
      vm.showSetting = false; vm.needsInitialSettings = false;
      await vm.activateGameVersion('poe1', { checkMigration: false });
      const make = (name, english, thai) => ({ filepath: 'alignment-fixture/' + name + '.txt', filedir: 'alignment-fixture',
        filename: name + '.txt', name: '', stats: ['alignment_' + name], variables: english.map(() => '#'),
        remarks: english.map(() => ''), translations: { English: english, Thai: thai }, isDNT: false });
      const source = [make('01_overflow', ['English A', 'English C'], ['Thai A', 'Thai removed', 'Thai C']),
        make('02_dropped', ['Unique English', 'Repeated English', 'Repeated English', 'New English'],
          ['Current unique', 'Current repeated one', 'Current repeated two', 'Current new']),
        make('03_long', Array.from({ length: 28 }, (_, i) => 'English entry #' + (i + 1) + ': a long current source entry for desktop scrolling and placement.'),
          Array.from({ length: 29 }, (_, i) => 'Translation block #' + (i + 1) + ': preserved complete text for the alignment scrolling fixture.'))];
      const clone = item => JSON.parse(JSON.stringify(item)), zip = new JSZip();
      for (const desc of source) zip.file(desc.filepath, descEncode(desc), { date: new Date('2026-10-10T00:00:00Z'), createFolders: false });
      const file = new File([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], 'AlignmentFixture.zip', { type: 'application/zip' });
      const identity = await vm.readImportZipIdentity(file, zip);
      await vm.importUpdateZipFile(file, clone(source), { identity, rawSource: clone(source) });
      if (vm.descs.length !== 3 || !vm.sourceIdentity) throw new Error('Alignment fixture import failed.');
      const old = make('02_dropped', ['Unique English', 'Repeated English', 'Repeated English'],
        ['Old unique', 'Old repeat one', 'Old repeat two']);
      const workspace = clone(vm.localDescs);
      WorkspaceState.dropTranslation(workspace, old, 'Thai', { id: 'alignment-fixture-drop', game: 'poe1',
        originSourceHash: await CollaborationProtocol.sourceHash([old]), targetSourceHash: vm.sourceIdentity,
        reason: 'Fixture preserved translation after source entry removal' });
      await OfflineStore.saveWorkspaceWithRevisions(workspace, [{ filepath: source[0].filepath,
        filename: source[0].filename, filedir: source[0].filedir, lang: 'Thai', sourceHash: vm.sourceIdentity,
        savedAt: Date.UTC(2026, 9, 9), note: 'Fixture previous translation',
        translations: ['Historical Thai A', 'Historical removed', 'Historical Thai C'] }], vm.managedWorkspaceScope());
      const retainedSource = vm.sourceIdentity;
      await vm.activateGameVersion('poe1', { checkMigration: false });
      if (!await vm.managedActivateWorkspace(retainedSource, 'Thai')) throw new Error('Could not activate fixture source with Dropped copy.');
      vm.showSetting = false; vm.needsInitialSettings = false; vm.selectAllFileFilters(); vm.applyFileSearch();
      await vm.loadEditorDrafts(); await vm.$nextTick();
    });
    const overflow = 'alignment-fixture/01_overflow.txt', dropped = 'alignment-fixture/02_dropped.txt', long = 'alignment-fixture/03_long.txt';
    const open = async filepath => {
      assert.equal(await page.evaluate(filepath => window.__alignmentApp.editFile(filepath, true), filepath), true);
      await page.waitForFunction(filepath => {
        const vm = window.__alignmentApp;
        return vm.editorVisible && vm.editorCurrentEditingDesc?.filepath === filepath && !vm.editorLoading;
      }, filepath);
    };
    const inspect = filepath => page.evaluate(async filepath => {
      const vm = window.__alignmentApp, desc = vm.getDescByFilepath(filepath), scope = vm.editorDraftScope(filepath);
      const workspace = await OfflineStore.getWorkspace(vm.managedWorkspaceScope());
      const draft = await OfflineStore.getTranslationDraft(vm.editorDraftKey(scope));
      const baseline = (await OfflineStore.getSource(vm.managedWorkspaceScope()))?.find(item => item.filepath === filepath);
      return { committed: desc.translations.Thai, saved: !!desc.hasChanges, missing: !!desc.isMissing, dropped: !!desc.isDropped,
        staged: workspace?.staged?.Thai?.[filepath] || null, draft, baseline: baseline?.translations.Thai,
        candidate: WorkspaceState.droppedForFile(workspace, filepath, 'Thai'),
        localCandidate: WorkspaceState.droppedForFile(vm.localDescs, filepath, 'Thai'),
        derivedDropped: WorkspaceState.workspaceFile(vm.localDescs, baseline, 'Thai').isDropped,
        currentText: vm.serializeEditorTranslations(), recovery: vm._draftSession?.alignmentRecovery,
        readonly: vm.editorTranslationReadOnly, slots: vm.entryAlignment?.slots };
    }, filepath);
    const panel = () => page.getByRole('region', { name: 'Align translation entries', exact: true });
    const poolCard = id => panel().locator('.entryAlignmentPool .entryAlignmentCard').filter({ has: page.getByRole('button', { name: 'Select block #' + id, exact: true }) });
    const slot = id => panel().locator('.entryAlignmentSlot').nth(id - 1);
    const continueButton = () => panel().getByRole('button', { name: 'Continue editing', exact: true });
    const save = () => page.getByRole('button', { name: 'Save & close', exact: true });
    await open(overflow); await panel().waitFor();
    const initial = await inspect(overflow);
    assert.deepEqual(initial.slots, [null, null]); assert.equal(initial.readonly, true);
    assert.deepEqual(initial.committed, ['Thai A', 'Thai removed', 'Thai C']); assert.equal(initial.staged, null);
    assert.equal(await save().isDisabled(), true); assert.equal(await continueButton().isDisabled(), true);
    assert.equal(await page.locator('.editor .editBlock').count(), 0, 'Overflow blocks cannot be edited before alignment');
    assert.equal(await page.evaluate(() => window.__alignmentApp.editorSave()), false, 'Direct save is also gated');
    await page.getByRole('button', { name: '🕒 History', exact: true }).click();
    await page.waitForFunction(() => !window.__alignmentApp.historyLoading && window.__alignmentApp.historyItems?.length > 0);
    const historyActions = page.locator('.historyPanel .historyPick, .historyPanel .historyRestore');
    assert.ok(await page.locator('.historyPanel .historyPick').count(), 'Durable fixture history exposes comparison actions');
    assert.ok(await page.locator('.historyPanel .historyRestore').count(), 'Durable fixture history exposes restore actions');
    for (const action of await historyActions.all()) assert.equal(await action.isDisabled(), true,
      'History comparison and restore controls cannot interrupt active entry alignment');
    assert.equal(await panel().isVisible(), true); assert.equal(await page.evaluate(() => window.__alignmentApp.editorCompareActive), false);
    await page.getByRole('button', { name: '📚 Dictionary', exact: true }).click();
    results.push('Actual History sidebar comparison and restore actions were disabled while entry alignment was active.');
    await page.keyboard.press('F2');
    await page.waitForFunction(() => !window.__alignmentApp.navigationBusy && !window.__alignmentApp.editorLoading);
    const afterShortcut = await inspect(overflow);
    assert.deepEqual(afterShortcut.committed, initial.committed); assert.equal(afterShortcut.staged, null);
    if (await page.evaluate(() => window.__alignmentApp.editorCurrentEditingDesc.filepath) !== overflow) await open(overflow);
    await panel().waitFor();
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await page.evaluate(theme => { window.__alignmentApp.theme = theme; document.documentElement.setAttribute('data-theme', theme); }, theme);
      await panel().scrollIntoViewIfNeeded();
      assert.equal(await panel().isVisible(), true, theme + ': alignment panel visible');
      const geometry = await panel().evaluate(node => ({ left: node.getBoundingClientRect().left,
        right: node.getBoundingClientRect().right, scroll: node.scrollWidth, width: node.clientWidth, viewport: innerWidth }));
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport + 1 && geometry.scroll <= geometry.width + 1,
        theme + ': alignment fits desktop viewport');
      if (process.env.ALIGNMENT_SCREENSHOT_PATH) {
        const screenshot = resolve(theme === 'modern-dark' ? process.env.ALIGNMENT_SCREENSHOT_PATH
          : process.env.ALIGNMENT_SCREENSHOT_PATH.replace(/(\.[^./\\]+)?$/, '.' + theme + '.png'));
        await page.screenshot({ path: screenshot, fullPage: true }); screenshots.push(screenshot);
      }
    }
    await page.setViewportSize({ width: 1100, height: 850 });
    assert.equal(await panel().evaluate(node => node.getBoundingClientRect().right <= innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1), true,
      'Alignment fits resized desktop viewport');
    await page.setViewportSize({ width: 1440, height: 1000 });
    results.push('Overflow automatically opened full-editor alignment, blocked Save/typing, and fit all four themes plus a resized desktop viewport.');
    await poolCard(1).dragTo(slot(1));
    assert.deepEqual((await inspect(overflow)).slots, [0, null], 'Native pointer drag assigned a whole translation block');
    const selectC = poolCard(3).getByRole('button', { name: 'Select block #3', exact: true });
    await selectC.focus(); await page.keyboard.press('Enter');
    const placeC = slot(2).getByRole('button', { name: 'Place selected at #2', exact: true });
    await placeC.focus(); await page.keyboard.press('Enter');
    assert.deepEqual((await inspect(overflow)).slots, [0, 2]);
    assert.equal(await continueButton().isDisabled(), true, 'Unused block requires an explicit decision');
    await poolCard(2).getByRole('checkbox', { name: 'Unused in this version' }).check();
    assert.equal(await continueButton().isEnabled(), true); await continueButton().click();
    await page.waitForFunction(() => !window.__alignmentApp.entryAlignment && !!window.__alignmentApp._draftSession?.record);
    const aligned = await inspect(overflow);
    assert.deepEqual(aligned.currentText, ['Thai A', 'Thai C']); assert.deepEqual(aligned.draft.translations, ['Thai A', 'Thai C']);
    assert.deepEqual(aligned.draft.alignmentRecovery[0].translations, initial.committed);
    assert.deepEqual(aligned.committed, initial.committed); assert.equal(aligned.staged, null); assert.equal(aligned.saved, false);
    assert.equal(aligned.missing, true, 'Private alignment draft cannot clear committed Missing status');
    assert.equal(aligned.readonly, false);
    results.push('Pointer drag and keyboard placement preserved whole blocks; explicit unused decision enabled Continue; Continue only retained an aligned private draft and the original blocks.');
    const sourceHash = await page.evaluate(() => window.__alignmentApp.sourceIdentity);
    await page.getByRole('button', { name: 'Close', exact: true }).first().click(); await open(overflow);
    assert.deepEqual((await inspect(overflow)).recovery[0].translations, initial.committed, 'Reopen retained original alignment recovery');
    await page.reload(); await ready();
    await page.evaluate(() => window.__alignmentApp.activateGameVersion('poe1', { checkMigration: false }));
    assert.equal(await page.evaluate(hash => window.__alignmentApp.managedActivateWorkspace(hash, 'Thai'), sourceHash), true);
    await page.waitForFunction(() => window.__alignmentApp.descs?.length === 3 && !window.__alignmentApp.versionStorageLoading);
    await open(overflow);
    const restored = await inspect(overflow);
    assert.deepEqual(restored.currentText, ['Thai A', 'Thai C']); assert.deepEqual(restored.recovery[0].translations, initial.committed);
    assert.deepEqual(restored.committed, initial.committed); assert.equal(restored.staged, null);
    await save().click();
    await page.waitForFunction(() => !window.__alignmentApp.editorVisible && !window.__alignmentApp.pendingLocalSaves
      && !window.__alignmentApp._pendingSaves.snapshot().jobs.length);
    const saved = await inspect(overflow);
    assert.equal(await page.evaluate(() => !!window.__alignmentApp._saveWorker?.worker && !window.__alignmentApp._saveWorker.fallback), true,
      'Durable translation save used the real background worker');
    assert.deepEqual(saved.committed, ['Thai A', 'Thai C']); assert.equal(saved.saved, true); assert.equal(saved.missing, false);
    assert.deepEqual(saved.baseline, initial.committed); assert.ok(saved.staged);
    const revisions = await page.evaluate(async filepath => {
      const vm = window.__alignmentApp; return await OfflineStore.listRevisions(filepath, 'Thai', 100, vm.managedWorkspaceScope());
    }, overflow);
    assert.deepEqual(revisions.find(row => row.note === 'Before entry alignment')?.translations, initial.committed);
    assert.equal(revisions.filter(row => row.note === 'save').length, 1);
    results.push('Reopen and full reload recovered the aligned draft with originals. Real save worker staged two entries and retained a complete Before entry alignment revision without rewriting the ZIP baseline.');
    await open(dropped); await panel().waitFor();
    const droppedInitial = await inspect(dropped);
    assert.deepEqual(droppedInitial.slots, [0, null, null, null], 'Only unique exact old-English matches were placed');
    assert.ok(droppedInitial.candidate); assert.equal(droppedInitial.staged, null);
    assert.equal(droppedInitial.missing, false, 'Complete current text coexists with the Dropped candidate');
    await poolCard(2).getByRole('button', { name: 'Select block #2', exact: true }).click();
    await slot(2).getByRole('button', { name: 'Place selected at #2', exact: true }).click();
    await slot(3).getByRole('button', { name: 'Leave #3 blank', exact: true }).click();
    await slot(4).getByRole('button', { name: 'Leave #4 blank', exact: true }).click();
    await poolCard(3).getByRole('checkbox', { name: 'Unused in this version' }).check();
    await continueButton().click();
    await page.waitForFunction(() => !window.__alignmentApp.entryAlignment && !!window.__alignmentApp._draftSession?.record);
    const droppedDraft = await inspect(dropped);
    assert.deepEqual(droppedDraft.currentText, ['Old unique', 'Old repeat one', '', '']);
    assert.deepEqual(droppedDraft.committed, droppedInitial.committed); assert.ok(droppedDraft.candidate);
    assert.equal(droppedDraft.missing, false, 'Blank draft slots do not alter committed Missing status');
    await save().click();
    const confirmation = page.getByRole('alertdialog', { name: 'Confirm action', exact: true });
    await confirmation.waitFor(); assert.match(await confirmation.innerText(), /missing fields/);
    await confirmation.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => !window.__alignmentApp.editorVisible && !window.__alignmentApp.pendingLocalSaves
      && !window.__alignmentApp._pendingSaves.snapshot().jobs.length);
    await page.waitForFunction(filepath => {
      const vm = window.__alignmentApp;
      return !WorkspaceState.droppedForFile(vm.localDescs, filepath, 'Thai') && !vm.getDescByFilepath(filepath).isDropped;
    }, dropped, { timeout: 3000 });
    const droppedSaved = await inspect(dropped);
    assert.deepEqual(droppedSaved.committed, ['Old unique', 'Old repeat one', '', '']);
    assert.equal(droppedSaved.saved, true); assert.equal(droppedSaved.missing, true); assert.equal(droppedSaved.candidate, null);
    assert.equal(droppedSaved.dropped, false); assert.equal(droppedSaved.derivedDropped, false); assert.equal(droppedSaved.localCandidate, null);
    const droppedRevisions = await page.evaluate(async filepath => {
      const vm = window.__alignmentApp; return await OfflineStore.listRevisions(filepath, 'Thai', 100, vm.managedWorkspaceScope());
    }, dropped);
    assert.ok(droppedRevisions.some(row => row.note === 'Before entry alignment'
      && JSON.stringify(row.translations) === JSON.stringify(['Old unique', 'Old repeat one', 'Old repeat two'])),
      'Local history retained the complete Dropped blocks: ' + JSON.stringify(droppedRevisions));
    assert.ok(droppedRevisions.some(row => row.note === 'Before entry alignment'
      && JSON.stringify(row.translations) === JSON.stringify(droppedInitial.committed)),
      'Local history also retained the current translation replaced by Dropped alignment');
    await page.reload(); await ready();
    await page.evaluate(() => window.__alignmentApp.activateGameVersion('poe1', { checkMigration: false }));
    assert.equal(await page.evaluate(hash => window.__alignmentApp.managedActivateWorkspace(hash, 'Thai'), sourceHash), true);
    await page.waitForFunction(() => window.__alignmentApp.descs?.length === 3 && !window.__alignmentApp.versionStorageLoading);
    await open(dropped);
    const droppedReloaded = await inspect(dropped);
    assert.deepEqual(droppedReloaded.committed, droppedSaved.committed); assert.equal(droppedReloaded.saved, true);
    assert.equal(droppedReloaded.missing, true); assert.equal(droppedReloaded.dropped, false);
    assert.equal(droppedReloaded.candidate, null); assert.equal(droppedReloaded.localCandidate, null);
    assert.equal(await panel().count(), 0, 'Reload does not offer alignment for already resolved Dropped work');
    results.push('Dropped source evidence placed only a unique exact match; duplicate English stayed manual. Continue kept Dropped unresolved; explicit confirmed Save resolved it, kept blank slots Missing, and retained all old blocks in local history.');
    await open(long); await panel().waitFor();
    const longGeometry = [];
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 1100, height: 850 }]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(() => window.__alignmentApp.startEntryAlignment()), true);
      await slot(20).scrollIntoViewIfNeeded();
      const geometry = await page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
        const pool = document.querySelector('.entryAlignmentPool');
        return { viewport: { width: innerWidth, height: innerHeight }, toolbar: rect('.editorActions'),
          pool: rect('.entryAlignmentPool'), english: rect('.entryAlignmentSlot:nth-child(20)'),
          poolScroll: { height: pool.clientHeight, content: pool.scrollHeight } };
      });
      longGeometry.push(geometry);
      assert.ok(geometry.pool.top >= geometry.toolbar.bottom - 1 && geometry.pool.bottom <= viewport.height + 1,
        'Entire available-block pool stays visible below sticky toolbar at English #20: ' + JSON.stringify(geometry));
      assert.ok(geometry.poolScroll.content > geometry.poolScroll.height, 'Long available pool scrolls independently');
      assert.ok(geometry.english.top >= geometry.toolbar.bottom && geometry.english.bottom <= viewport.height,
        'English #20 is accessible below the sticky toolbar');
      await poolCard(1).dragTo(slot(20));
      assert.equal((await inspect(long)).slots[19], 0, 'Visible pool permits pointer placement at English #20');
      await poolCard(25).getByRole('button', { name: 'Select block #25', exact: true }).click();
      await slot(21).getByRole('button', { name: 'Place selected at #21', exact: true }).click();
      assert.equal((await inspect(long)).slots[20], 24, 'Pool scrolling permits selected-button placement at English #21');
      if (process.env.ALIGNMENT_SCREENSHOT_PATH && viewport.width === 1440) {
        const screenshot = resolve(process.env.ALIGNMENT_SCREENSHOT_PATH.replace(/(\.[^./\\]+)?$/, '.long.png'));
        await page.screenshot({ path: screenshot }); screenshots.push(screenshot);
      }
    }
    results.push('28 English entries and 29 translation blocks: available pool stayed fully visible below the toolbar while English #20 was visible, with pointer placement and pool-scroll/button placement in both desktop viewports.');
    assert.deepEqual(pageErrors, [], 'No uncaught browser errors'); results.push('No uncaught browser errors.');
    console.log(JSON.stringify({ origin, results, screenshots, longGeometry }, null, 2)); await context.close();
  } catch (error) {
    if (page) console.error(JSON.stringify(await page.evaluate(() => {
      const vm = window.__alignmentApp;
      return { ready: vm?.startupReady, loading: vm?.editorLoading, loadError: vm?.editorLoadError,
        storageError: vm?.cloudStorageError, alignmentError: vm?.entryAlignmentError, notice: vm?.collaborationNotice,
        source: vm?.sourceIdentity, descs: vm?.descs?.length, current: vm?.editorCurrentEditingDesc?.filepath,
        alignment: vm?.entryAlignment, drafts: vm?._draftSession?.record, pageText: document.body.innerText.slice(-4000) };
    }).catch(() => ({})), null, 2));
    throw error;
  } finally {
    if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
