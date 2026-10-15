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

async function run() {
  assert.ok(executablePath, 'Set FIXTURE_BROWSER_PATH to installed Edge/Chrome.');
  const serverApp = express();
  serverApp.get('/', (_req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js', existsSync(vueScriptPath) ? '/fixture/vue.global.prod.js' : 'https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js')));
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
    browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/?testMode=1&lang=Thai', { waitUntil: 'domcontentloaded', timeout: 60000 });
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
    await setSurface('sd', 'list');
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
