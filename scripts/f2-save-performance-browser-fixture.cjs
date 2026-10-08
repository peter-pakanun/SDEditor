// Disposable normal-mode measurement of F1/F2 and inline Ctrl+Up/Ctrl+Down
// navigation with a realistic workspace and real IndexedDB save transactions.
// No production account or browser profile is used. Run directly with Node.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join } = require('node:path');
const { readFileSync, existsSync } = require('node:fs');
const { createServer } = require('node:http');
const { execFileSync } = require('node:child_process');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
function workerGate() {
  const NativeWorker = window.Worker;
  const gate = window.__f2WorkerGate = { mode: 'normal', held: [] };
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (event.data?.type === 'saved') window.__f2Probe?.events.push({ name: 'worker.saved', at: performance.now() });
      });
    }
    postMessage(message, options) {
      if (message?.type === 'saveTranslations') {
        window.__f2Probe?.events.push({ name: 'worker.postMessage', at: performance.now() });
        if (gate.mode === 'hold') { gate.held.push({ worker: this, message, options }); return; }
      }
      return super.postMessage(message, options);
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
  const baseline = process.env.F2_BASELINE === '1';
  const sourceText = path => baseline && ['index.js', 'pendingSaves.js', 'inlineEditor.js'].includes(path)
    ? execFileSync('git', ['show', 'HEAD:public/' + path], { cwd: resolve(__dirname, '..'), encoding: 'utf8' })
    : readFileSync(join(publicDir, path), 'utf8');
  frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
    .replace('<head>', '<head><script>(' + workerGate.toString() + ')();</script>')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
  frontend.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
  frontend.get('/index.js', (req, res) => res.type('js').send(sourceText('index.js')
    .replace("app.mount('#app');", "window.__f2App = app.mount('#app');")));
  frontend.get('/pendingSaves.js', (req, res) => res.type('js').send(sourceText('pendingSaves.js')));
  frontend.get('/inlineEditor.js', (req, res) => res.type('js').send(sourceText('inlineEditor.js')));
  frontend.use('/v1', (req, res) => res.status(503).json({ error: 'Cloud disabled in local fixture.' }));
  frontend.use(express.static(publicDir));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  const errors = [];
  try {
    browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/?cloudApi=' + encodeURIComponent(origin));
    await page.waitForFunction(() => window.__f2App?.offlineStoreReady && window.__f2App?.startupReady
      && window.__f2App?._cloud?.state && !window.__f2App._cloudInitializing && !window.__f2App._cloudApplying,
    null, { timeout: 30000 });
    const count = Number(process.env.F2_FILE_COUNT || 20000), dictionaryCount = Number(process.env.F2_DICTIONARY_COUNT || 8000);
    console.log('Preparing ' + count + ' files and ' + dictionaryCount + ' dictionary entries.');
    const openPaintGap = process.env.F2_OPEN_PAINT_GAP !== '0';
    await page.evaluate(async ({ count, dictionaryCount, openPaintGap }) => {
      const vm = window.__f2App;
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
      const source = Array.from({ length: count }, (_, index) => ({
        filepath: 'f2-performance/' + String(index).padStart(5, '0') + '.txt', filedir: 'f2-performance',
        filename: String(index).padStart(5, '0') + '.txt', name: '', stats: ['perf_' + index],
        variables: ['#'], remarks: [''], translations: { English: ['Damage increases by amount ' + index], Thai: ['Original damage ' + index] }, isDNT: false,
      }));
      const zip = new JSZip();
      for (const desc of source) zip.file(desc.filepath, descEncode(desc), { date: new Date('2026-10-08T00:00:00Z'), createFolders: false });
      const file = new File([await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })], 'F2PerformanceFixture.zip', { type: 'application/zip' });
      const identity = await vm.readImportZipIdentity(file, zip);
      const clone = item => JSON.parse(JSON.stringify(item));
      await vm.importUpdateZipFile(file, clone(source), { identity, rawSource: clone(source) });
      if (vm.descs.length !== count || !vm.sourceIdentity) throw new Error('Source fixture import failed.');
      vm.dictionary = Array.from({ length: dictionaryCount }, (_, i) => ({ _id: 'perf_dictionary_' + i, find: 'Keyword' + i, replace: 'คำศัพท์' + i, alts: [] }));
      vm.showSetting = false; vm.needsInitialSettings = false; vm.versionChooserVisible = false; vm.loadingProgress = 100;
      vm.selectAllFileFilters(); vm.applyFileSearch();
      vm.currentSort = 'filename'; vm.currentSortDir = 'asc';
      await vm.loadEditorDrafts(); await vm.$nextTick();
      window.__f2Probe = { events: [] };
      if (openPaintGap) {
        // Shared editing paints the loading surface before its asynchronous claim.
        // Reproduce that scheduling gap without a cloud account or network data.
        const hydrate = vm.hydrateEditorDraft;
        vm.hydrateEditorDraft = async function (request) {
          await this.yieldEditorPaint();
          return hydrate.call(this, request);
        };
      }
      const wrap = (owner, name, prefix = '') => {
        const fn = owner[name];
        if (typeof fn !== 'function') return;
        owner[name] = function (...args) {
          const events = window.__f2Probe.events, label = prefix + name, at = performance.now();
          events.push({ name: label + '.start', at });
          const result = fn.apply(this, args);
          events.push({ name: label + '.sync', at: performance.now(), duration: performance.now() - at });
          if (result?.then) return result.then(value => { events.push({ name: label + '.end', at: performance.now(), duration: performance.now() - at }); return value; });
          events.push({ name: label + '.end', at: performance.now(), duration: performance.now() - at });
          return result;
        };
      };
      for (const name of ['saveAndSkipFile', 'editorSave', 'flushEditorDraft', 'writeEditorDraft', 'editorSaveFindings', 'persistTranslationBatch',
        'editFile', 'beginEditorOpen', 'openEditorFile', 'hydrateEditorDraft', 'yieldEditorPaint', 'prepareEditorDictionaryIndex',
        'applyPreparedEditorBlocks', 'applyCollaborationFiles', 'filterDesc', 'editorDraftCommitted', 'seedEditorOpenSource',
        'activateInlineRow', 'runInlineRowActivation', 'finishInlineSession', 'moveInlineFile']) wrap(vm, name);
      for (const name of ['getTranslationDraft', 'putTranslationDraft', 'getWorkspace', 'saveTranslations', 'getSaveReceipt']) wrap(OfflineStore, name, 'store.');
      document.addEventListener('keydown', e => {
        if (['F1', 'F2'].includes(e.code) || e.ctrlKey && ['ArrowUp', 'ArrowDown'].includes(e.code))
          window.__f2Probe.events.push({ name: 'navigation.keydown', key: e.ctrlKey ? 'Control+' + e.code : e.code, at: performance.now() });
      }, true);
      new PerformanceObserver(list => { for (const event of list.getEntries()) window.__f2Probe.events.push({ name: 'longtask', at: event.startTime, duration: event.duration }); }).observe({ type: 'longtask', buffered: false });
    }, { count, dictionaryCount, openPaintGap });
    const filepath = n => 'f2-performance/' + String(n).padStart(5, '0') + '.txt';
    const field = (inline = false, path = '') => inline
      ? page.locator('tr[data-filepath="' + path + '"]').locator('.textHL input:not([readonly]), .textHL textarea:not([readonly])').first()
      : page.locator('.editor .textHL input:not([readonly]), .editor .textHL textarea:not([readonly])').first();
    const samples = [];
    const modes = process.env.F2_SAMPLE_MODES ? process.env.F2_SAMPLE_MODES.split(',') : ['unchanged', 'hold', 'normal', 'unchanged', 'hold', 'normal'];
    const cases = modes.map((mode, index) => ({ mode, key: 'F2', from: index, to: index + 1, inline: false }));
    if (process.env.F2_KEYBOARD_CASES !== '0') cases.push(
      { mode: 'normal', key: 'F1', from: 11, to: 10, inline: false },
      { mode: 'hold', key: 'F1', from: 13, to: 12, inline: false },
      { mode: 'normal', key: 'Control+ArrowDown', from: 20, to: 21, inline: true },
      { mode: 'normal', key: 'Control+ArrowUp', from: 23, to: 22, inline: true },
      { mode: 'hold', key: 'Control+ArrowDown', from: 24, to: 25, inline: true },
      { mode: 'hold', key: 'Control+ArrowUp', from: 27, to: 26, inline: true },
    );
    assert.ok(count > Math.max(...cases.map(item => item.from), ...cases.map(item => item.to)), 'Fixture needs enough files for its navigation cases');
    for (const [index, navigation] of cases.entries()) {
      const { mode, key, from, to, inline } = navigation, outgoingPath = filepath(from), targetPath = filepath(to);
      assert.equal(await page.evaluate(async ({ path, inline }) => {
        const vm = window.__f2App;
        // Case setup selects a new, unstaged outgoing file. Avoid the previous
        // full editor's focus restoration activating and pinning its old row.
        vm._fileTableReturnFocus = false;
        await vm.editorExit();
        await vm.$nextTick();
        vm.inlineEditor = inline; vm.inlineSidebarVisible = false;
        await vm.$nextTick();
        if (!inline) return vm.editFile(path, true);
        const position = vm.filteredDescs.findIndex(row => row.filepath === path);
        vm.currentPage = Math.floor(position / vm.pageSize) + 1; vm.selectFileRow(path);
        await vm.$nextTick();
        return true;
      }, { path: outgoingPath, inline }), true, key + ': open outgoing file');
      if (inline) {
        try { await page.locator('tr[data-filepath="' + outgoingPath + '"] .inlineSourceCell').click({ timeout: 3000 }); }
        catch (error) {
          console.error(JSON.stringify(await page.evaluate(() => {
            const vm = window.__f2App;
            return { current: vm.editorCurrentEditingDesc?.filepath, selected: vm.selectedFilepath, inline: vm.inlineEditor,
              inlineActive: vm.inlineActive, visible: vm.editorVisible, loading: vm.editorLoading, transition: vm.inlineTransitionBusy,
              page: vm.currentPage, displayed: vm.descsDisplay.map(row => row.filepath), chooser: vm.versionChooserVisible,
              gameSelected: vm.gameVersionSelected, loadingProgress: vm.loadingProgress, initial: vm.needsInitialSettings,
              rowPaths: [...document.querySelectorAll('tr[data-filepath]')].map(row => row.dataset.filepath), body: document.body.innerText.slice(0, 3000) };
          }), null, 2));
          throw error;
        }
        await page.waitForFunction(path => {
          const vm = window.__f2App;
          return vm.inlineActive && vm.editorCurrentEditingDesc?.filepath === path && !vm.editorLoading && !vm.inlineTransitionBusy;
        }, outgoingPath);
      }
      const changed = 'Changed damage ' + index;
      try { if (mode !== 'unchanged') await field(inline, outgoingPath).fill(changed); }
      catch (error) {
        console.error(JSON.stringify(await page.evaluate(() => {
          const vm = window.__f2App;
          return { current: vm.editorCurrentEditingDesc?.filepath, selected: vm.selectedFilepath, inline: vm.inlineEditor,
            inlineActive: vm.inlineActive, visible: vm.editorVisible, loading: vm.editorLoading, transition: vm.inlineTransitionBusy,
            page: vm.currentPage, displayed: vm.descsDisplay.map(row => row.filepath), readOnly: vm.editorTranslationReadOnly,
            activeElement: document.activeElement?.tagName, chooser: vm.versionChooserVisible, body: document.body.innerText.slice(-3000) };
        }), null, 2));
        throw error;
      }
      await field(inline, outgoingPath).focus();
      await page.evaluate(mode => {
        window.__f2Probe.events = [];
        window.__f2WorkerGate.mode = mode === 'hold' ? 'hold' : 'normal';
      }, mode);
      await page.keyboard.press(key);
      try {
        await page.waitForFunction(path => {
          const vm = window.__f2App;
          return vm.editorCurrentEditingDesc?.filepath === path && !vm.editorLoading && !vm.navigationBusy && !vm.inlineTransitionBusy;
        }, targetPath, { timeout: 30000 });
      } catch (error) {
        console.error(JSON.stringify(await page.evaluate(() => ({ current: window.__f2App.editorCurrentEditingDesc?.filepath,
          error: window.__f2App.collaborationNotice, saving: window.__f2App.editorSaving, loading: window.__f2App.editorLoading,
          body: document.body.innerText.slice(-3000), events: window.__f2Probe.events })), null, 2));
        throw error;
      }
      assert.equal(await field(inline, targetPath).evaluate(el => el === document.activeElement), true, key + ': target translation has keyboard focus');
      const sample = await page.evaluate(async ({ mode, key, inline }) => {
        await window.__f2App.$nextTick();
        const at = performance.now(), events = window.__f2Probe.events.slice(), start = events.find(e => e.name === 'navigation.keydown').at;
        return { mode, key, inline, readyMs: at - start, pendingAtReady: window.__f2App.pendingLocalSaves,
          events: events.map(e => ({ ...e, at: Math.round((e.at - start) * 10) / 10, duration: e.duration == null ? undefined : Math.round(e.duration * 10) / 10 })) };
      }, { mode, key, inline });
      const dispatch = sample.events.find(e => e.name === 'worker.postMessage'), opened = sample.events.find(e => e.name === 'openEditorFile.end');
      if (!baseline && mode !== 'unchanged' && dispatch) {
        assert.ok(opened && dispatch.at >= opened.at, key + ': worker dispatch waits until target editor is prepared');
        const painted = sample.events.find(e => e.name === 'yieldEditorPaint.end' && e.at >= opened.at && e.at <= dispatch.at);
        assert.ok(painted, key + ': target paints before queued worker dispatch');
      }
      const typing = 'Typing after navigation ' + index;
      await page.keyboard.press('Control+A');
      await page.keyboard.type(typing);
      await page.evaluate(() => window.__f2WorkerGate.release());
      await page.waitForFunction(() => !window.__f2App.pendingLocalSaves && !window.__f2App._pendingSaves?.snapshot().jobs.length);
      assert.equal(await field(inline, targetPath).inputValue(), typing, key + ': target typing survives outgoing save acknowledgment');
      if (mode !== 'unchanged') {
        const saved = await page.evaluate(async path => {
          const vm = window.__f2App, workspace = await OfflineStore.getWorkspace(vm.managedWorkspaceScope());
          const draft = await OfflineStore.getTranslationDraft(vm.editorDraftKey(vm.editorDraftScope(path)));
          const history = await OfflineStore.listRevisions(path, 'Thai', 100, vm.managedWorkspaceScope());
          return { committed: vm.getDescByFilepath(path).translations.Thai, staged: workspace.staged.Thai[path]?.translations,
            draftState: draft?.state, saves: history.filter(row => row.note === 'save').length };
        }, outgoingPath);
        assert.deepEqual(saved.committed, [changed], key + ': outgoing committed text');
        assert.deepEqual(saved.staged, [changed], key + ': outgoing durable staged text');
        assert.notEqual(saved.draftState, 'active', key + ': exact outgoing draft consumed');
        assert.equal(saved.saves, 1, key + ': one durable saved revision');
      }
      // Restore this next file to its committed text so an unchanged sample is truly unchanged.
      await page.evaluate(async () => {
        const vm = window.__f2App;
        vm.editorBlocks[0].translation = vm.editorCurrentEditingDesc.translations.Thai[0];
        await vm.flushEditorDraft();
      });
      samples.push(sample);
      console.log(JSON.stringify(process.env.F2_TRACE === '1' ? sample : {
        mode, key, readyMs: Math.round(sample.readyMs), draftReadMs: sample.events.find(e => e.name === 'store.getTranslationDraft.end')?.duration,
        dispatchMs: dispatch?.at, targetPreparedMs: opened?.at, pendingAtReady: sample.pendingAtReady,
      }));
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ baseline, files: count, dictionaryEntries: dictionaryCount, openPaintGap,
      samples: samples.map(({ mode, key, readyMs, pendingAtReady }) => ({ mode, key, readyMs: Math.round(readyMs), pendingAtReady })) }, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
