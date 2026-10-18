// Disposable presentation regression: real shared notice/shell components in
// test mode, with synthetic ClientText fields and no durable/cloud writes.
'use strict';
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const express = require('express');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const publicDir = join(__dirname, '../public');
const vueScriptPath = process.env.FIXTURE_VUE_PATH || join(__dirname, '../temp/clienttext-fixture-vue.min.js');

function setErrors(active) {
  const vm = window.__noticeFixtureApp, detail = 'Retained translations need review before saving. '.repeat(10);
  Object.assign(vm, {
    localSaveError: active ? detail : '', dictionaryWorkerError: active ? detail : '',
    cloudStorageError: active ? detail : '', inlineDraftError: active ? detail : '',
    inlineDraftFindings: active ? { fixture: [{ level: 'error', deferredSave: true, message: detail }] } : {},
    storageMigrationMessage: active ? 'Local storage preparation is waiting for the retained operation. ' + detail : '',
    collaborationNotice: active ? 'Review shared recovery. ' + detail : '',
    ctError: active ? 'Workbook translation could not save. ' + detail : '',
    ctNotice: active ? 'Workbook recovery is retained. ' + detail : '',
  });
  vm.collaborationState = { ...vm.collaborationState, error: active ? 'Shared translation needs review. ' + detail : '', disconnected: false };
}

async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function checkDismissals(page) {
  const testBanner = page.locator('.ctTestBanner:visible'), notice = page.locator('.ctListWorkspace .collaborationNotice:visible'),
    error = page.locator('.ctListWorkspace .collaborationError:visible');
  await page.evaluate(setErrors, false);
  await page.evaluate(() => {
    const vm = window.__noticeFixtureApp, unit = vm.ctUnits[0], field = unit.fields[0];
    vm.ctSaved = { [unit.id]: { unitId: unit.id, revision: 1, values: { [field.id]: 'Saved synthetic target' }, reviewed: {} } };
    vm.ctValues = { [field.id]: 'Unsaved synthetic draft' };
    vm.ctError = 'Synthetic operation failed.'; vm.ctNotice = 'Cancelled. Saved work is retained.';
    vm.ctBusy = true; vm.ctProgress = { phase: 'Synthetic work', completed: 1, total: 10 };
    vm._ctAbort = new AbortController();
  });
  const state = () => page.evaluate(() => {
    const vm = window.__noticeFixtureApp;
    return JSON.stringify({ workspace: vm.ctWorkspace, units: vm.ctUnits, saved: vm.ctSaved, values: vm.ctValues,
      selection: vm.ctSelection, busy: vm.ctBusy, progress: vm.ctProgress, notice: vm.ctNotice, error: vm.ctError,
      aborted: vm._ctAbort.signal.aborted });
  });
  const before = await state();
  await testBanner.getByRole('button', { name: 'Dismiss information message', exact: true }).click();
  await notice.getByRole('button', { name: 'Dismiss information message', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.ctTestBanner:visible').count(), 0);
  assert.equal(await notice.count(), 0);
  assert.equal(await error.count(), 1, 'Dismissing an information notice does not dismiss an independent error');
  const closeError = error.getByRole('button', { name: 'Dismiss error message', exact: true });
  assert.equal(await closeError.evaluate(element => document.activeElement === element && getComputedStyle(element).outlineStyle !== 'none'), true,
    'Keyboard dismissal restores visible focus to the remaining notice close control');
  await page.keyboard.press('Space'); await frames(page);
  assert.equal(await error.count(), 0); assert.equal(await state(), before, 'All exact saved/draft/session/error/operation state survives closing banners');
  assert.equal(await page.evaluate(() => document.activeElement?.matches('button, a[href], input, select, textarea') && document.activeElement.getClientRects().length > 0), true,
    'Closing the last notice returns focus to a visible workspace control');
  await page.evaluate(async () => { const vm = window.__noticeFixtureApp; vm.ctBusy = false; vm.ctProgress = null; vm.ctRevision++; await vm.$nextTick(); vm.ctEditor = true; });
  await page.locator('.ctFullEditor').waitFor(); await frames(page);
  assert.equal(await page.locator('.ctTestBanner:visible, .ctFullEditor .collaborationError:visible, .ctFullEditor .collaborationNotice:visible').count(), 0,
    'Same dismissed occurrences stay hidden after unrelated renders and opening the full editor');
  await page.evaluate(async () => { const vm = window.__noticeFixtureApp; vm.ctEditor = false; vm.ctNotice = ''; vm.ctNotice = 'Cancelled. Saved work is retained.'; });
  await notice.waitFor();
  await notice.getByRole('button', { name: 'Dismiss information message', exact: true }).click();
  await page.evaluate(() => window.__noticeFixtureApp.ctCancel()); await notice.waitFor();
  assert.equal(await notice.textContent(), 'Cancelled. Saved work is retained.', 'A repeated explicit Cancel posts the same notice again');
  await notice.getByRole('button', { name: 'Dismiss information message', exact: true }).click();
  await page.evaluate(() => { window.__noticeFixtureApp.ctNotice = 'A different synthetic notice.'; window.__noticeFixtureApp.ctError = 'A different synthetic failure.'; });
  await notice.waitFor(); await error.waitFor();
  await error.getByRole('button', { name: 'Dismiss error message', exact: true }).click();
  await page.evaluate(() => { const vm = window.__noticeFixtureApp; vm.ctError = ''; vm.ctError = 'A different synthetic failure.'; });
  await error.waitFor();
  await page.evaluate(() => { const vm = window.__noticeFixtureApp; vm.ctWorkspace = { ...vm.ctWorkspace,
    scope: { ...vm.ctWorkspace.scope, groupId: 'local:test:new-notice-session' } }; });
  await testBanner.waitFor();
  assert.ok((await testBanner.textContent()).includes('In-memory test'), 'A new temporary session shows its information banner');
  await page.locator('.ctListWorkspace').screenshot({ path: join(__dirname, '../temp/notice-dismissal-session.png') });
  // Clearing/reposting a message while its entire surface is absent is still
  // observable by the app-owned synchronous watch.
  await error.getByRole('button', { name: 'Dismiss error message', exact: true }).click();
  await page.evaluate(async () => { const vm = window.__noticeFixtureApp; vm.ctActive = false; await vm.$nextTick();
    vm.ctError = ''; vm.ctError = 'A different synthetic failure.'; await vm.$nextTick(); vm.ctActive = true; });
  await error.waitFor();
  console.log('Dismissal lifecycle passed: pointer, Enter/Space and focus; exact state preservation; independent/changed/cleared/repeated notices; list/full remounts; new test scope; absent-surface repost.');
}

async function checkExplicitPostsAndShortcuts(page) {
  await page.evaluate(setErrors, false);
  await page.evaluate(() => {
    const vm = window.__noticeFixtureApp, field = vm.ctCurrentUnit.fields[0];
    // Restore the real Save method after the layout-only fixture's IO stub.
    vm.ctSave = window.ClientTextUI.mixin.methods.ctSave.bind(vm);
    vm.ctChoices = [{ fieldId: field.id, local: 'Retained synthetic target', remote: 'Shared synthetic target' }];
    vm.ctError = ''; vm.ctNotice = ''; vm.ctBusy = false; vm.ctBrowseBusy = false; vm.autoOpenNextFile = false;
    window.__noticeShortcutEvents = [];
    window.__noticeShortcutListener = event => {
      if (event.code === 'KeyS' || event.key === 'F2') window.__noticeShortcutEvents.push({ code: event.code, prevented: event.defaultPrevented,
        fromClose: event.target.classList.contains('appNoticeClose') });
    };
    document.addEventListener('keydown', window.__noticeShortcutListener);
  });
  const state = () => page.evaluate(() => { const vm = window.__noticeFixtureApp;
    return JSON.stringify([vm.ctWorkspace, vm.ctSelection, vm.ctSaved, vm.ctValues, vm.ctChoices]); });
  const before = await state(), save = page.locator('.ctFullEditor .ctEditorActionButtons').getByRole('button', { name: 'Save', exact: true }),
    error = page.locator('.ctFullEditor .editorNotice .collaborationError:visible'),
    banner = page.locator('.ctFullEditor .ctTestBanner:visible');
  for (let attempt = 0; attempt < 2; attempt++) {
    await save.click(); await error.waitFor();
    assert.ok((await error.textContent()).includes('Choose between the retained alternatives'), 'The real Save action posts its retained-alternative error');
    await error.getByRole('button', { name: 'Dismiss error message', exact: true }).click();
    assert.equal(await error.count(), 0);
  }
  for (const shortcut of ['Control+s', 'Meta+s']) {
    await banner.getByRole('button', { name: 'Dismiss information message', exact: true }).focus();
    await page.keyboard.press(shortcut); await error.waitFor();
    assert.equal(await banner.count(), 1, shortcut + ' on X reaches real Save without dismissing its banner');
    await error.getByRole('button', { name: 'Dismiss error message', exact: true }).click();
  }
  assert.equal(await state(), before, 'Repeated explicit Save and Save shortcuts preserve retained alternatives and exact saved/draft data');
  assert.deepEqual(await page.evaluate(() => window.__noticeShortcutEvents), [
    { code: 'KeyS', prevented: true, fromClose: true }, { code: 'KeyS', prevented: true, fromClose: true },
  ], 'Save shortcuts bubble from the focused X to the real document/editor handler');
  await page.evaluate(() => {
    const vm = window.__noticeFixtureApp;
    vm.ctChoices = []; vm.ctValues = window.ClientTextState.valuesFor(vm.ctCurrentUnit); vm.ctError = ''; vm.ctNotice = '';
    window.__noticeOriginalStorage = vm.ctStorage; window.__noticeOriginalFlushDraft = vm.ctFlushDraft;
    vm.ctStorage = () => ({ async save() { throw new Error('Synthetic repeated Save failure'); } });
  });
  for (const phase of ['save', 'checkpoint']) {
    await page.evaluate(phase => {
      const vm = window.__noticeFixtureApp; vm._ctSaveJob = null;
      vm.ctFlushDraft = phase === 'save' ? async () => true : async () => { vm.ctError = 'Synthetic repeated checkpoint failure'; return false; };
    }, phase);
    for (let attempt = 0; attempt < 2; attempt++) {
      await save.click(); await error.waitFor();
      assert.ok((await error.textContent()).includes(phase === 'save' ? 'Synthetic repeated Save failure' : 'Synthetic repeated checkpoint failure'));
      const retryState = () => page.evaluate(() => { const vm = window.__noticeFixtureApp;
        return JSON.stringify([vm._ctSaveJob, vm.ctDraftStageFailure, vm.ctValues, vm.ctSaved]); });
      const pending = await retryState();
      await error.getByRole('button', { name: 'Dismiss error message', exact: true }).click();
      assert.equal(await retryState(), pending, 'Dismissing a repeated ' + phase + ' failure preserves its exact retry command and work');
    }
  }
  await page.evaluate(() => { const vm = window.__noticeFixtureApp;
    vm.ctStorage = window.__noticeOriginalStorage; vm.ctFlushDraft = window.__noticeOriginalFlushDraft;
    vm._ctSaveJob = null; vm.ctDraftStageFailure = null; vm.ctError = '';
  });
  const fullNotice = page.locator('.ctFullEditor .editorNotice .collaborationNotice:visible');
  for (let attempt = 0; attempt < 2; attempt++) {
    await banner.getByRole('button', { name: 'Dismiss information message', exact: true }).focus();
    await page.keyboard.press('F2'); await fullNotice.waitFor();
    assert.ok((await fullNotice.textContent()).includes('No available files in this direction.'), 'Real full-editor navigation reposts its same-text boundary notice');
    await fullNotice.getByRole('button', { name: 'Dismiss information message', exact: true }).click();
  }
  assert.equal(await page.evaluate(() => window.__noticeShortcutEvents.filter(event => event.code === 'F2' && event.prevented && event.fromClose).length), 2,
    'F2 also reaches the real document/editor handler from X');
  await banner.getByRole('button', { name: 'Dismiss information message', exact: true }).focus(); await page.keyboard.press('Enter');
  assert.equal(await banner.count(), 0, 'Unmodified Enter still dismisses the focused X');
  await page.evaluate(() => { const vm = window.__noticeFixtureApp; vm.ctEditor = false; vm.inlineEditor = true; });
  const inlineNotice = page.locator('.ctListWorkspace .collaborationNotice:visible');
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(await page.evaluate(() => window.__noticeFixtureApp.ctNavigate(1)), false);
    await inlineNotice.waitFor();
    await inlineNotice.getByRole('button', { name: 'Dismiss information message', exact: true }).click();
  }
  // The real background method uses a synthetic failing transport; unchanged
  // polls are the same failure occurrence and must stay manually dismissed.
  await page.evaluate(async () => {
    const vm = window.__noticeFixtureApp;
    vm.ctPolicy = { ...vm.ctPolicy, clientTextStorageProtocols: ['clienttext-trusted-v1'] };
    vm._ctSync = { async flush() { throw new Error('Unchanged synthetic background failure'); } };
    await vm.ctSync();
  });
  const backgroundError = page.locator('.ctListWorkspace .collaborationError:visible'); await backgroundError.waitFor();
  await backgroundError.getByRole('button', { name: 'Dismiss error message', exact: true }).click();
  await page.evaluate(async () => { const vm = window.__noticeFixtureApp; await vm.ctSync(); await vm.ctSync(); }); await frames(page);
  assert.equal(await backgroundError.count(), 0, 'Unchanged background failures do not repeatedly resurface');
  await page.evaluate(() => { const vm = window.__noticeFixtureApp; vm._ctSync = null; vm.ctError = '';
    document.removeEventListener('keydown', window.__noticeShortcutListener); });
  console.log('Explicit occurrences/shortcuts passed with real Vue/application methods: repeated retained-alternative/failed/checkpoint Save, exact retry preservation, inline/full boundary navigation, Ctrl+S/Meta+S/F2 from focused X, native Enter, and unchanged background sync.');
}

async function run() {
  assert.ok(executablePath, 'Set FIXTURE_BROWSER_PATH to installed Edge/Chrome.');
  const serverApp = express();
  serverApp.get('/', (_req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js', '/fixture/vue.global.prod.js')
    .replace(/<link\b[^>]*https:\/\/[^>]*>/g, '')
    .replace(/<script src="https:\/\/cdnjs.cloudflare.com\/ajax\/libs\/jsdiff\/[^>]*><\/script>/, '')));
  serverApp.get('/fixture/vue.global.prod.js', (_req, res) => res.type('js').send(readFileSync(vueScriptPath)));
  serverApp.get('/fixture/jszip.min.js', (_req, res) => res.type('js').send(readFileSync(require.resolve('jszip/dist/jszip.min.js', { paths: [runtimeModules] }))));
  serverApp.get('/index.js', (_req, res) => res.type('js').send(readFileSync(join(publicDir, 'index.js'), 'utf8')
    .replace("app.mount('#app');", "window.__noticeFixtureApp=app.mount('#app');")));
  serverApp.use(express.static(publicDir));
  const server = await new Promise(resolve => { const instance = serverApp.listen(0, '127.0.0.1', () => resolve(instance)); });
  let browser, page;
  const failures = [];
  let checked = 0;
  try {
    assert.ok(existsSync(vueScriptPath), 'Set FIXTURE_VUE_PATH to a cached Vue build; this synthetic fixture never uses external network.');
    browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const origin = 'http://127.0.0.1:' + server.address().port;
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(origin + '/?testMode=1&lang=Thai', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!window.__noticeFixtureApp);
    await page.evaluate(async () => {
      const vm = window.__noticeFixtureApp;
      vm.showSetting = false; vm.needsInitialSettings = false; vm.versionChooserVisible = false;
      vm.gameVersion = 'poe2'; vm.loadingProgress = 100; vm.inlineEditor = false;
      vm.saveSettings = async () => true;
      if (!vm.descs.length) vm.loadDummyData();
      vm.selectAllFileFilters(); vm.applyFileSearch();
    });
    const setSurface = async (mode, surface) => {
      await page.evaluate(setErrors, false);
      await page.evaluate(async ({ mode, surface }) => {
        const vm = window.__noticeFixtureApp;
        if (vm.inlineActive) await vm.finishInlineSession({ promote: false });
        if (vm.editorVisible) await vm.editorExit();
        vm.ctActive = false; vm.ctEditor = false; vm.ctWorkspace = null;
        vm.inlineEditor = surface === 'inline'; vm.inlineSidebarVisible = true;
        if (mode === 'sd') {
          if (surface === 'full') await vm.editFile(vm.descs[0].filepath, true);
          else if (surface === 'inline') await vm.activateInlineRow(vm.descs[0].filepath);
        } else {
          const field = { id: 'notice-field', kind: 'text', name: 'Text', source: 'English {0}', target: 'Translation {0}',
            targetCell: 'B2', required: true, originalMissing: false, outdated: false };
          const unit = Vue.markRaw({ id: 'normal|NoticeSheet|record', role: 'normal', sheet: 'NoticeSheet', recordId: 'record', fields: [field], notes: [] });
          vm.ctWorkspace = { scope: { accountId: 'guest', game: 'poe2', branchId: 'default', versionId: 'fixture', groupId: 'local:test:notices', language: 'Thai' },
            metadata: { version: { name: 'Fixture' }, descriptors: [{ role: 'normal', baselineId: 'a'.repeat(64) }] } };
          vm.ctUnits = Vue.markRaw([unit]); vm._ctUnitIndex = Vue.markRaw(new Map([[unit.id, unit]])); vm._ctWorkUnits = Vue.markRaw(new Map());
          vm.ctSelection = unit.id; vm.ctFocusedField = field.id; vm.ctValues = { [field.id]: field.target };
          vm.ctSaved = {}; vm.ctReviewed = {}; vm.ctEditor = surface === 'full'; vm.ctActive = true;
          vm.ctInitializing = false; vm.ctBusy = false; vm.ctTool = 'dictionary'; vm.ctInlineClosed = false;
          vm.ctSelectedFilters = ['unchanged', 'missing', 'saved', 'outdated'];
          vm.ctSave = async () => true; vm.ctInlineFocusOut = () => {}; vm.ctQueueDraft = () => {};
          vm.ctFlushDraft = async () => true; vm.ctQueueCommentDraft = () => {};
          vm.ctFlushCommentDraft = async () => {}; vm.ctLoadComments = async () => {};
        }
        await vm.$nextTick(); window.scrollTo(0, 0);
      }, { mode, surface });
      if (surface === 'full') await page.waitForSelector('.editor');
      else if (surface === 'inline') await page.waitForSelector('.sharedEditorSidebar');
      await page.evaluate(setErrors, true); await frames(page);
    };
    for (const mode of ['sd', 'clienttext']) {
      for (const surface of ['list', 'inline', 'full']) {
        await setSurface(mode, surface);
        for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
          for (const density of ['compact', 'spacious']) {
            for (const width of [1440, 1100, 800]) {
              await page.setViewportSize({ width, height: width === 800 ? 500 : 700 });
              await page.evaluate(async ({ theme, density, surface }) => {
                const vm = window.__noticeFixtureApp;
                vm.theme = theme; vm.uiDensity = density; document.documentElement.setAttribute('data-theme', theme);
                await vm.$nextTick();
                if (surface === 'full') document.querySelector('.editor .edit').style.minHeight = '1800px';
                window.scrollTo(0, surface === 'full' ? 800 : 400); vm.measureWorkspaceChrome?.();
              }, { theme, density, surface });
              await page.evaluate(setErrors, true);
              await frames(page);
              const label = [mode, surface, theme, density, width].join('/');
              const geometry = await page.evaluate(async surface => {
                // Test mode's real Dictionary preparation can settle while the
                // viewport changes; restore this presentation-only error after
                // its callback, immediately before inspecting the DOM.
                const vm = window.__noticeFixtureApp;
                vm.dictionaryWorkerError = vm.inlineDraftError; await vm.$nextTick();
                const visible = element => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
                const rect = element => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height }; };
                const full = surface === 'full', owner = full ? document.querySelector('.editor') : [...document.querySelectorAll('.workspace')].find(visible);
                const stack = owner.querySelector(full ? ':scope > .editorNotice' : '.workspaceNoticeStack');
                const globals = [...document.querySelectorAll('.workspaceAlerts')].filter(visible);
                const sidebar = owner.querySelector(full ? '.editorSidebarHost' : '.inlineEditorSidebar');
                const header = full ? null : owner.querySelector('.workspaceHeader');
                const preview = full ? owner.querySelector('.editorPreviewPane') : null, actions = full ? owner.querySelector('.editorActions') : null;
                const save = actions && [...actions.querySelectorAll('button')].find(button => /Save\s*&\s*close/.test(button.textContent));
                const saveBox = save?.getBoundingClientRect(), hit = saveBox && document.elementFromPoint(saveBox.left + saveBox.width / 2, saveBox.top + saveBox.height / 2);
                return { globals: globals.length, errors: globals[0]?.querySelectorAll('[role="alert"]').length,
                  stack: rect(stack), scrollable: getComputedStyle(stack).overflowY, scrollHeight: stack.scrollHeight, clientHeight: stack.clientHeight,
                  tabIndex: stack.tabIndex, role: stack.getAttribute('role'),
                  header: header && rect(header), sidebar: sidebar && visible(sidebar) ? rect(sidebar) : null,
                  preview: preview && rect(preview), actions: actions && rect(actions),
                  scrollY, save: save && rect(save), saveHit: !!save?.contains(hit), saveHitElement: hit?.outerHTML.slice(0, 200),
                  noticeHeight: parseFloat(getComputedStyle(owner).getPropertyValue('--editor-notice-height')) || 0,
                  closeGeometry: [...stack.querySelectorAll('.appNoticeClose')].filter(visible).every(button => {
                    const box = button.getBoundingClientRect(), notice = button.closest('.appNotice'), content = notice.querySelector('.appNoticeContent').getBoundingClientRect(),
                      actions = notice.querySelector('.appNoticeActions')?.getBoundingClientRect();
                    return content.right <= box.left && (!actions || actions.right <= box.left) && box.right <= notice.getBoundingClientRect().right;
                  }),
                  headerHit: !header || [...header.querySelectorAll('.workspaceActions button')].every(button => {
                    const box = button.getBoundingClientRect(); return button.disabled || button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
                  }), viewport: { width: innerWidth, height: innerHeight } };
              }, surface);
              assert.equal(geometry.globals, 1, label + ': only one global error stack');
              assert.equal(geometry.errors, 5, label + ': all retained errors remain rendered');
              assert.ok(geometry.stack.height > 0 && geometry.stack.height <= geometry.viewport.height * .32 + 1, label + ': notice height is bounded');
              assert.ok(geometry.stack.left >= -1 && geometry.stack.right <= geometry.viewport.width + 1, label + ': notices fit resized desktop');
              assert.equal(geometry.scrollable, 'auto', label + ': long notices scroll');
              assert.ok(geometry.scrollHeight > geometry.clientHeight, label + ': messages remain available inside overflow');
              assert.equal(geometry.tabIndex, 0, label + ': overflowing notice region is keyboard focusable');
              assert.equal(geometry.role, 'region', label + ': overflow scrolling has an accessible region');
              assert.equal(geometry.headerHit, true, label + ': workspace action buttons remain clickable');
              assert.equal(geometry.closeGeometry, true, label + ': close controls reserve a right column without overlapping long messages or actions');
              if (surface === 'full') {
                assert.ok(Math.abs(geometry.noticeHeight - geometry.stack.height) <= 2, label + ': measured notice height matches the shell offset');
                assert.ok(geometry.sidebar.top >= geometry.stack.bottom - 1, label + ': file tools begin below notices');
                assert.ok(geometry.preview.top >= geometry.stack.bottom - 1, label + ': preview begins below notices');
                assert.ok(geometry.actions.top >= geometry.preview.bottom - 1, label + ': actions begin below preview');
                assert.ok(geometry.scrollY > 500, label + ': the long editor body is actually scrolled');
                assert.equal(geometry.saveHit, true, label + ': Save remains pointer reachable after scrolling; ' + JSON.stringify({ save: geometry.save, hit: geometry.saveHitElement, notices: geometry.stack, preview: geometry.preview, actions: geometry.actions }));
              } else {
                assert.ok(geometry.stack.top >= geometry.header.top - 1 && geometry.stack.bottom <= geometry.header.bottom + 1, label + ': header owns notices');
                if (geometry.sidebar) assert.ok(geometry.sidebar.top >= geometry.header.bottom - 1, label + ': inline tools begin below header');
              }
              if (surface !== 'list') {
                const sidebar = page.locator('.sharedEditorSidebar:visible');
                for (const name of [/^TM(?:\s|$)/, /Dictionary/]) {
                  const button = sidebar.getByRole('button', { name }).first();
                  assert.equal(await button.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)); }), true, label + ': tab is pointer reachable');
                  await button.click(); await button.focus(); await page.keyboard.press('Enter');
                  assert.equal(await button.evaluate(element => element === document.activeElement && element.classList.contains('active')), true, label + ': pointer and keyboard select the tab');
                }
              }
              checked++;
            }
          }
        }
        const noticeStack = page.locator(surface === 'full' ? '.editor > .editorNotice' : '.workspace:visible .workspaceNoticeStack');
        await noticeStack.focus(); await page.keyboard.press('End');
        await page.waitForFunction(selector => document.querySelector(selector)?.scrollTop > 0,
          surface === 'full' ? '.editor > .editorNotice' : (mode === 'clienttext' ? '.ctListWorkspace .workspaceNoticeStack' : '.workspaceNoticeStack'), { timeout: 5000 });
        assert.equal(await noticeStack.evaluate(element => element === document.activeElement), true, mode + '/' + surface + ': keyboard can focus and scroll through all retained notices');
        await noticeStack.evaluate(element => { element.scrollTop = 0; });
        if (surface === 'full') {
          await page.evaluate(setErrors, false); await frames(page);
          const height = () => page.locator('.editor').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--editor-notice-height')) || 0);
          const baseline = await height();
          await page.evaluate(async () => { const vm = window.__noticeFixtureApp; vm.inlineDraftError = 'A short retained draft error.'; await vm.$nextTick(); });
          await frames(page); const short = await height();
          assert.ok(short > baseline, mode + ': adding a notice updates the shell offset');
          await page.setViewportSize({ width: 1440, height: 700 });
          await page.evaluate(async () => { const vm = window.__noticeFixtureApp; vm.inlineDraftError = 'A wrapping retained draft error. '.repeat(9); await vm.$nextTick(); });
          await frames(page); const wide = await height();
          await page.setViewportSize({ width: 800, height: 700 }); await frames(page); const narrow = await height();
          assert.ok(narrow >= wide && narrow > short, mode + ': wrapping notices update the measured offset');
          await page.evaluate(async () => { const vm = window.__noticeFixtureApp; vm.inlineDraftError = ''; await vm.$nextTick(); });
          await frames(page); assert.ok(Math.abs(await height() - baseline) <= 2, mode + ': removing notices restores the offset');
        }
        console.log(mode + '/' + surface + ': 24 notice layouts passed.');
      }
    }
    await setSurface('clienttext', 'list'); await checkDismissals(page);
    await setSurface('clienttext', 'full'); await checkExplicitPostsAndShortcuts(page);
    await setSurface('sd', 'list');
    const longStack = page.locator('.workspace:visible .workspaceNoticeStack');
    await longStack.locator('.appNoticeClose').last().click();
    assert.equal(await longStack.evaluate(stack => {
      const active = document.activeElement, box = active.getBoundingClientRect(), region = stack.getBoundingClientRect();
      return stack.contains(active) && box.top >= region.top && box.bottom <= region.bottom && box.top >= 0 && box.bottom <= innerHeight;
    }), true, 'Closing a message at the bottom of an overflowing stack reveals the new keyboard focus');
    const localError = page.locator('.workspace:visible .appNotice').filter({ hasText: 'Could not finish saving your translations.' });
    const retainedError = await page.evaluate(() => window.__noticeFixtureApp.localSaveError);
    await localError.getByRole('button', { name: 'Dismiss error message', exact: true }).click();
    assert.equal(await localError.isVisible(), false);
    assert.equal(await page.evaluate(() => window.__noticeFixtureApp.localSaveError), retainedError, 'Dismissing a storage error preserves the failed save and retry state');
    await page.evaluate(() => { window.__noticeFixtureApp.localSaveError = 'A different synthetic storage failure.'; }); await localError.waitFor();
    const collaboration = page.locator('.workspace:visible .collaborationStatus');
    await collaboration.getByRole('button', { name: 'Dismiss error message', exact: true }).click();
    await page.evaluate(() => { window.__noticeFixtureApp.collaborationState.error = 'A different synthetic collaboration failure.'; });
    await collaboration.waitFor();
    assert.ok((await collaboration.textContent()).includes('A different synthetic collaboration failure.'), 'A changed collaboration error returns even when its general status label stays the same');
    await page.evaluate(() => window.__noticeFixtureApp.openSettings());
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true }); await settings.waitFor();
    assert.equal(await settings.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.left + 20, box.top + 20)); }), true, 'Settings appears above notices');
    await page.keyboard.press('Escape'); await settings.waitFor({ state: 'hidden' });
    await page.locator('.workspaceAlerts:visible').getByRole('button', { name: 'Review retained edits', exact: true }).first().click();
    const drafts = page.getByRole('dialog', { name: 'Retained edits', exact: true }); await drafts.waitFor();
    assert.equal(await drafts.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.left + 20, box.top + 20)); }), true, 'Local drafts appears above notices');
    await drafts.getByRole('button', { name: 'Close', exact: true }).click();
    assert.deepEqual(failures, [], 'No browser runtime errors');
    console.log('Shared notices passed ' + checked + ' desktop layouts: SD/ClientText list, inline and full; four themes, two densities, three widths; TM/Dictionary pointer and keyboard, dynamic offsets, bounded scrolling and modal layering.');
  } catch (error) {
    if (page) {
      console.error(await page.evaluate(() => ({ text: document.body.innerText.slice(0, 1000), mode: window.__noticeFixtureApp?.ctActive, full: window.__noticeFixtureApp?.editorVisible, ctFull: window.__noticeFixtureApp?.ctEditor,
        errors: ['localSaveError', 'dictionaryWorkerError', 'cloudStorageError', 'dictionaryPreparationOwnsStorageError', 'inlineDraftError', 'deferredDraftSaveError'].map(key => [key, !!window.__noticeFixtureApp?.[key]]),
        notices: [...document.querySelectorAll('.workspaceAlerts [role="alert"]')].map(element => element.textContent.slice(0, 70)) })));
      await page.screenshot({ path: join(__dirname, '../temp/notice-layout-failure.png') }).catch(() => {});
    }
    throw error;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
