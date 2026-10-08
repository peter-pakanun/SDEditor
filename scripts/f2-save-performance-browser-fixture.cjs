// Disposable normal-mode measurement of F2 navigation with a realistic workspace.
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
  const sourceText = path => baseline && ['index.js', 'pendingSaves.js'].includes(path)
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
      vm.showSetting = false; vm.needsInitialSettings = false; vm.selectAllFileFilters(); vm.applyFileSearch();
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
        'applyPreparedEditorBlocks', 'applyCollaborationFiles', 'filterDesc', 'editorDraftCommitted', 'seedEditorOpenSource']) wrap(vm, name);
      for (const name of ['getTranslationDraft', 'putTranslationDraft', 'getWorkspace', 'saveTranslations', 'getSaveReceipt']) wrap(OfflineStore, name, 'store.');
      document.addEventListener('keydown', e => { if (e.code === 'F2') window.__f2Probe.events.push({ name: 'F2.keydown', at: performance.now() }); }, true);
      new PerformanceObserver(list => { for (const event of list.getEntries()) window.__f2Probe.events.push({ name: 'longtask', at: event.startTime, duration: event.duration }); }).observe({ type: 'longtask', buffered: false });
    }, { count, dictionaryCount, openPaintGap });
    const filepath = n => 'f2-performance/' + String(n).padStart(5, '0') + '.txt';
    const field = () => page.locator('.editor .textHL input:not([readonly]), .editor .textHL textarea:not([readonly])').first();
    assert.equal(await page.evaluate(path => window.__f2App.editFile(path, true), filepath(0)), true);
    await field().focus();
    const samples = [];
    const modes = process.env.F2_SAMPLE_MODES ? process.env.F2_SAMPLE_MODES.split(',') : ['unchanged', 'hold', 'normal', 'unchanged', 'hold', 'normal'];
    for (const [index, mode] of modes.entries()) {
      if (mode !== 'unchanged') await field().fill('Changed damage ' + index);
      await field().focus();
      await page.evaluate(mode => {
        window.__f2Probe.events = [];
        window.__f2WorkerGate.mode = mode === 'hold' ? 'hold' : 'normal';
      }, mode);
      await page.keyboard.press('F2');
      try {
        await page.waitForFunction(path => {
          const vm = window.__f2App;
          return vm.editorCurrentEditingDesc?.filepath === path && !vm.editorLoading && !vm.navigationBusy;
        }, filepath(index + 1), { timeout: 30000 });
      } catch (error) {
        console.error(JSON.stringify(await page.evaluate(() => ({ current: window.__f2App.editorCurrentEditingDesc?.filepath,
          error: window.__f2App.collaborationNotice, saving: window.__f2App.editorSaving, loading: window.__f2App.editorLoading,
          body: document.body.innerText.slice(-3000), events: window.__f2Probe.events })), null, 2));
        throw error;
      }
      const sample = await page.evaluate(async mode => {
        await window.__f2App.$nextTick();
        const at = performance.now(), events = window.__f2Probe.events.slice(), start = events.find(e => e.name === 'F2.keydown').at;
        return { mode, readyMs: at - start, pendingAtReady: window.__f2App.pendingLocalSaves,
          events: events.map(e => ({ ...e, at: Math.round((e.at - start) * 10) / 10, duration: e.duration == null ? undefined : Math.round(e.duration * 10) / 10 })) };
      }, mode);
      await field().fill('Typing after next ' + index);
      await page.evaluate(() => window.__f2WorkerGate.release());
      await page.waitForFunction(() => !window.__f2App.pendingLocalSaves && !window.__f2App._pendingSaves?.snapshot().jobs.length);
      assert.equal(await field().inputValue(), 'Typing after next ' + index);
      // Restore this next file to its committed text so an unchanged sample is truly unchanged.
      await page.evaluate(async () => {
        const vm = window.__f2App;
        vm.editorBlocks[0].translation = vm.editorCurrentEditingDesc.translations.Thai[0];
        await vm.flushEditorDraft();
      });
      samples.push(sample);
      console.log(JSON.stringify(sample));
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ baseline, files: count, dictionaryEntries: dictionaryCount, openPaintGap,
      samples: samples.map(({ mode, readyMs, pendingAtReady }) => ({ mode, readyMs: Math.round(readyMs), pendingAtReady })) }, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
