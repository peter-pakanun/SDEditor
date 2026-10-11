// Disposable real-app presentation checks. Test mode avoids account/IndexedDB
// startup; synthetic ClientText fields exercise the current root controllers.
'use strict';
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const express = require('express');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const publicDir = join(__dirname, '../public');

async function run() {
  assert.ok(executablePath, 'Set FIXTURE_BROWSER_PATH to installed Edge/Chrome.');
  const serverApp = express();
  serverApp.get('/', (_req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
  serverApp.get('/fixture/jszip.min.js', (_req, res) => res.type('js').send(readFileSync(require.resolve('jszip/dist/jszip.min.js', { paths: [runtimeModules] }))));
  serverApp.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(publicDir, 'index.js'), 'utf8')
    .replace("app.mount('#app');", "window.__sharedFixtureApp=app.mount('#app');")));
  serverApp.use(express.static(publicDir));
  const server = await new Promise(resolve => { const instance = serverApp.listen(0, '127.0.0.1', () => resolve(instance)); });
  let browser, page;
  const failures = [];
  try {
    browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) failures.push(message.text()); });
    await page.goto('http://127.0.0.1:' + server.address().port + '/?testMode=1&lang=Thai', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!window.__sharedFixtureApp);
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp;
      host.showSetting = false; host.needsInitialSettings = false; host.versionChooserVisible = false;
      host.gameVersion = 'poe2'; host.loadingProgress = 100; host.inlineEditor = false;
      if (!host.descs.length) host.loadDummyData();
      await host.editFile(host.descs[0].filepath);
    });
    await page.waitForSelector('.editor [data-editor-ref="translation_1"]:not([readonly])');
    console.log('SD full editor and native fields mounted.');
    const sd = page.locator('.editor [data-editor-ref="translation_1"]');
    await sd.fill('SD retained draft');
    await page.locator('.sharedEditorSidebar').getByRole('button', { name: 'Lookup', exact: true }).click();
    await page.locator('#editorLookupSearch').fill('Damage');
    await page.locator('#editorLookupSearch').press('Enter');
    assert.equal(await sd.inputValue(), 'SD retained draft');
    await page.locator('#editorLookupSearch').press('Control+s');
    assert.equal(await sd.inputValue(), 'SD retained draft');
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      assert.equal(await page.locator('.sharedEditorSidebar').count(), 1);
      const box = await page.locator('.sharedEditorSidebar').boundingBox();
      assert.ok(box && box.width > 250 && box.x + box.width <= 1441, theme);
    }
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp;
      host.sideTab = 'dictionary'; await host.$nextTick();
    });
    await sd.focus(); await sd.press('Control+Space');
    await page.waitForSelector('.hlPopupFilter');
    await page.locator('.hlPopupFilter').press('Escape');
    assert.equal(await sd.inputValue(), 'SD retained draft');
    assert.equal(await sd.evaluate(input => input === document.activeElement), true);

    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp;
      await host.editorExit();
      const source = '[Fire|Fire] {0} <<icon>> raw @ literal\\n';
      const field = { id: 'text-field', kind: 'text', name: 'Text', source, target: 'raw @ literal\\n\nactual',
        targetCell: 'B2', required: true, originalMissing: false, outdated: false };
      const unit = Vue.markRaw({ id: 'normal|Sheet|record', role: 'normal', sheet: 'Sheet', recordId: 'record', fields: [field], developerNotes: 'Developer note', notes: [] });
      host.ctWorkspace = { scope: { accountId: 'guest', game: 'poe2', branchId: 'default', versionId: 'fixture', groupId: 'local:fixture', language: 'Thai' },
        metadata: { version: { name: 'Fixture' }, descriptors: [{ role: 'normal', baselineId: 'a'.repeat(64) }] } };
      host.ctUnits = Vue.markRaw([unit]); host._ctUnitIndex = Vue.markRaw(new Map([[unit.id, unit]])); host._ctWorkUnits = Vue.markRaw(new Map());
      host.ctSelection = unit.id; host.ctFocusedField = field.id; host.ctValues = { [field.id]: field.target };
      host.ctSaved = {}; host.ctReviewed = {}; host.ctEditor = true; host.ctActive = true;
      host.ctInitializing = false; host.ctBusy = false; host.ctTool = 'dictionary'; host.ctQueueDraft = () => {};
      host.ctFlushDraft = async () => true; host.ctQueueCommentDraft = () => {};
      host.ctFlushCommentDraft = async () => {}; host.ctLoadComments = async () => {};
      host.ctFieldGroups; await host.$nextTick();
    });
    await page.waitForSelector('.ctFullEditor [data-ct-target="text-field"]');
    console.log('ClientText full editor and native fields mounted.');
    const ct = page.locator('.ctFullEditor [data-ct-target="text-field"]');
    assert.equal(await ct.inputValue(), 'raw @ literal\\n\nactual');
    assert.ok(await page.locator('.ctFullEditor .HLter [data-ct-hl]').count() >= 3);
    await ct.fill('kept raw @ literal\\n\ntranslation');
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), 'kept raw @ literal\\n\ntranslation');
    await ct.focus(); await ct.press('Control+Space');
    await page.waitForSelector('.hlPopupFilter');
    await page.locator('.hlPopupFilter').press('Escape');
    assert.equal(await ct.inputValue(), 'kept raw @ literal\\n\ntranslation');
    assert.equal(await ct.evaluate(input => input === document.activeElement), true);
    const undoOriginal = 'Original\r\nsecond@literal\\n\r\nthird', undoReplacement = 'Replacement\r\nraw@literal\\n';
    await page.evaluate(async ({ original, replacement }) => {
      const host = window.__sharedFixtureApp, field = host.ctCurrentUnit.fields[0];
      host.ctValues[field.id] = original; await host.$nextTick();
      const input = document.querySelector('.ctFullEditor [data-ct-target="text-field"]');
      if (!EditorSession.insert(host, field, replacement, { input, whole: true })) throw Error('Native replacement rejected');
      await host.$nextTick();
    }, { original: undoOriginal, replacement: undoReplacement });
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), undoReplacement);
    await ct.press('Control+z');
    assert.equal(await ct.inputValue(), undoOriginal.replace(/\r\n/g, '\n'));
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), undoOriginal, 'native Undo retains exact removed CRLF');
    await ct.press('Control+y');
    assert.equal(await ct.inputValue(), undoReplacement.replace(/\r\n/g, '\n'));
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), undoReplacement, 'native Redo retains exact inserted CRLF');
    await ct.fill('kept raw @ literal\\n\ntranslation');
    await page.locator('.sharedEditorSidebar').getByRole('button', { name: 'Lookup', exact: true }).click();
    assert.equal(await page.locator('#editorLookupSearch').evaluate(input => input === document.activeElement), true);
    await page.locator('#editorLookupSearch').fill('raw'); await page.locator('#editorLookupSearch').press('Enter');
    assert.equal(await ct.inputValue(), 'kept raw @ literal\\n\ntranslation');
    await page.locator('.sharedEditorSidebar').getByRole('button', { name: 'TM', exact: true }).click();
    assert.equal(await page.locator('.sharedEditorSidebar').getByRole('button', { name: 'Manage TM', exact: true }).count(), 0);
    await page.locator('.sharedEditorSidebar').getByRole('button', { name: /History/ }).click();
    assert.equal(await page.locator('.ctHistoryPanel').count(), 1);
    await page.locator('.sharedEditorSidebar').getByRole('button', { name: 'Comments', exact: true }).click();
    assert.equal(await page.locator('.fileCommentsPanel').count(), 1);
    assert.match(await page.locator('.fileCommentsPanel').innerText(), /Shared comments are unavailable in test mode/);
    assert.equal(await page.locator('#ctFullEditorPreviewHost .gamePreviewWindow').count(), 2);
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp;
      window.__fixtureToolsNode = document.querySelector('.sharedEditorSidebar');
      window.__fixturePreviewNode = document.querySelector('.gamePreviewStrip');
      // The fixture validates presentation without staging its synthetic unit.
      host.ctSave = async () => true;
      host.saveSettings = async () => true;
      host.ctInlineFocusOut = () => {};
      host.inlineEditor = true; host.inlineSidebarVisible = true; host.ctEditor = false; host.ctInlineClosed = false;
      host.ctSelectedFilters = ['unchanged', 'missing', 'saved', 'outdated']; host.ctTool = 'preview';
      await host.$nextTick();
    });
    await page.waitForSelector('.ctListWorkspace [data-ct-target="text-field"]');
    assert.equal(await page.locator('#ctInlineEditorSidebarHost .sharedEditorSidebar').count(), 1);
    assert.equal(await page.locator('#inlineEditorPreviewHost .gamePreviewWindow').count(), 2);
    assert.equal(await page.evaluate(() => document.querySelector('.sharedEditorSidebar') === window.__fixtureToolsNode), true);
    assert.equal(await page.evaluate(() => document.querySelector('.gamePreviewStrip') === window.__fixturePreviewNode), true);
    assert.equal(await page.locator('.ctListWorkspace [data-ct-target="text-field"]').inputValue(), 'kept raw @ literal\\n\ntranslation');
    await page.locator('.ctListWorkspace').getByRole('button', { name: 'Show all comments', exact: true }).click();
    assert.equal(await page.locator('#allCommentsSidebar').count(), 1);
    await page.locator('#allCommentsSidebar').getByRole('button', { name: 'Close all comments', exact: true }).click();
    await page.evaluate(async () => { const host = window.__sharedFixtureApp; host.ctEditor = true; await host.$nextTick(); });
    assert.equal(await page.locator('#ctFullEditorSidebarHost .sharedEditorSidebar').count(), 1);
    assert.equal(await page.evaluate(() => document.querySelector('.sharedEditorSidebar') === window.__fixtureToolsNode), true);
    assert.equal(await page.locator('.ctFullEditor [data-ct-target="text-field"]').inputValue(), 'kept raw @ literal\\n\ntranslation');
    const screenshot = join(tmpdir(), 'sdeditor-shared-components-clienttext.png');
    await page.screenshot({ path: screenshot }); console.log('Desktop screenshot: ' + screenshot);
    assert.deepEqual(failures, []);
    console.log('PASS real-app SD and ClientText shared fields, Tools, Preview, popup and focus; four desktop themes.');
  } catch (error) {
    console.error('Browser errors:', failures);
    if (page && !page.isClosed()) console.error('Editor state:', await page.evaluate(() => {
      const host = window.__sharedFixtureApp;
      return { editorVisible: host?.editorVisible, editorReady: host?.editorReady, editorLoadError: host?.editorLoadError,
        descs: host?.descs?.length, fields: [...document.querySelectorAll('[data-editor-ref]')].map(field => field.dataset.editorRef),
        sidebar: !!document.querySelector('.sharedEditorSidebar'), ctActive: host?.ctActive, ctEditor: host?.ctEditor,
        inlineEditor: host?.inlineEditor, ctInlineClosed: host?.ctInlineClosed, ctSelection: host?.ctSelection,
        ctRows: host?.ctPageRows?.map(unit => unit.id), ctTargets: [...document.querySelectorAll('[data-ct-target]')].map(input => input.dataset.ctTarget) };
    }));
    throw error;
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
