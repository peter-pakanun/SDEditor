// Disposable Vue performance fixture. Translation storage/cloud are bypassed.
// Run: node scripts/inline-performance-browser-fixture.cjs
// Current: http://127.0.0.1:3356/current/?testMode=1&lang=Thai
// Baseline: http://127.0.0.1:3356/baseline/?testMode=1&lang=Thai
// Baseline assets are the committed HEAD at server startup (or --baseline-ref REF).
// --baseline-dir DIR reads an already exported public/ directory, avoiding Git spawning.
// Add &probe=1 to instrument selected methods/computeds before Vue mounts. Probe
// results are synchronous inclusive/self/max timings, including only the initial
// synchronous part of async methods; nested/resumed work is measured by its calls.
// The visible controls use DOM clicks/keyboard events and report DOM paint proxies,
// animation-frame gaps and Long Tasks where supported. These are local timings,
// not a substitute for a browser profiler or trusted OS keyboard/IME input.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const publicDir = path.resolve(__dirname, '../public');
const baselineFlag = process.argv.indexOf('--baseline-ref');
const baselineRef = baselineFlag >= 0 ? process.argv[baselineFlag + 1] : 'HEAD';
if (!baselineRef || baselineRef.startsWith('-')) throw new Error('--baseline-ref requires a Git revision.');
const baselineDirFlag = process.argv.indexOf('--baseline-dir');
const baselineDir = baselineDirFlag >= 0 ? process.argv[baselineDirFlag + 1] : null;
if (baselineDirFlag >= 0 && !baselineDir) throw new Error('--baseline-dir requires an exported public directory.');
const portFlag = process.argv.indexOf('--port');
const port = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : 3356;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid --port.');
const baseline = new Map();
for (const filename of fs.readdirSync(publicDir)) {
  if (!/\.(?:js|css|html)$/.test(filename)) continue;
  try {
    baseline.set(filename, baselineDir ? fs.readFileSync(path.join(baselineDir, filename), 'utf8') : execFileSync('git', ['show', baselineRef + ':public/' + filename], {
      cwd: path.dirname(publicDir), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch (error) {
    if (filename === 'index.js' || filename === 'inlineEditor.js') throw error;
  }
}

function installTimingProbe(config) {
  const enabled = new URLSearchParams(location.search).get('probe') === '1';
  let active = null;
  const stack = [];
  const names = new Set([
    'getActiveDictionaryEntries', 'getEditorDictionaryIndex', 'prepareEditorDictionaryIndex',
    'getDictionaryDefinitionPairs', 'filterDesc', 'applyFileSearch', 'getDescByFilepath', 'inlineRowBlocks',
    'orderedDictionary', 'filteredDictionary', 'activeDictionaryIds', 'foundDictionarySet', 'foundDictionaryDefMap',
    'terminologyDictionary', 'visibleDictionary', 'dictionaryPageCount', 'descsDisplay',
    'buildEnglishHLter', 'buildTranslationHLter', 'buildTranslationRanges', 'buildDiagnosticRanges',
    'refreshEditorBlockHLter', 'refreshEditorBlockMeta', 'refreshEditorTableColumnHLter', 'syncHlScroll',
    'observeInlineBlocks', 'scheduleInlineAlignment', 'refreshGamePreview', 'updateGamePreview',
    'buildHlPopupItems', 'positionHlPopup', 'syncHlPopupEnglishHighlight', 'updateHlPopupActiveDictRow',
    'captureCollaborationContext', 'getFileWorkspaceState', 'getEditorDiagnosticScanResult',
    'prepareEditorBlocks', 'prepareEditorBlocksAsync', 'beginEditorOpen', 'activateInlineRow', 'finishInlineSession',
    'serializeEditorTranslations', 'flushEditorDraft', 'getWorkspaceBaselineIndex', 'ensureWorkspaceState',
    'editorDiagnostics', 'editorConsistencyDiagnostics', 'getDiagnosticContext', 'openEditorFile',
  ]);
  function wrap(fn, name) {
    return function (...args) {
      if (!active) return fn.apply(this, args);
      const collection = active;
      const entry = { child: 0, start: performance.now() };
      stack.push(entry);
      try { return fn.apply(this, args); }
      finally {
        const elapsed = performance.now() - entry.start;
        stack.pop();
        if (stack.length) stack[stack.length - 1].child += elapsed;
        const stats = collection.get(name) || { name, calls: 0, total: 0, self: 0, max: 0 };
        stats.calls++; stats.total += elapsed; stats.self += Math.max(0, elapsed - entry.child); stats.max = Math.max(stats.max, elapsed);
        collection.set(name, stats);
      }
    };
  }
  const visited = new Set();
  function instrument(options) {
    if (!options || visited.has(options)) return;
    visited.add(options);
    for (const mixin of options.mixins || []) instrument(mixin);
    for (const type of ['methods', 'computed']) for (const [name, fn] of Object.entries(options[type] || {})) {
      if (!names.has(name)) continue;
      if (typeof fn === 'function') options[type][name] = wrap(fn, type + '.' + name);
      else if (type === 'computed' && typeof fn?.get === 'function') fn.get = wrap(fn.get, type + '.' + name);
    }
  }
  if (enabled) instrument(config);
  return {
    enabled,
    begin() { if (enabled) active = new Map(); },
    end() { const entries = active ? [...active.values()].sort((a, b) => b.self - a.self) : []; active = null; return entries; },
  };
}

function installPerformanceControls(editor, variant, probe) {
  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Inline editor performance fixture');
  // Fixture controls should not end the editor focus session while measuring it.
  panel.setAttribute('data-inline-focus-surface', '');
  panel.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:2147483000;max-width:780px;max-height:43vh;overflow:auto;padding:10px;background:#fff8df;color:#222;border:2px solid #a80;font:12px/1.4 system-ui;box-shadow:0 4px 15px #0004';
  const title = document.createElement('strong');
  title.textContent = 'Inline performance · ' + variant;
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;margin:7px 0';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  status.textContent = 'Load the large corpus, then run the benchmark. No cloud account or translation persistence.';
  const output = document.createElement('pre'); output.setAttribute('aria-label', 'Inline performance results');
  output.style.cssText = 'white-space:pre-wrap;font:11px/1.5 monospace;margin:5px 0';
  const note = document.createElement('small');
  note.textContent = 'Fields/frame metrics are animation-frame observations, not compositor paint timestamps. Long Tasks may be unsupported in this browser.';
  const probeOutput = document.createElement('pre'); probeOutput.setAttribute('aria-label', 'Synchronous timing probe results');
  probeOutput.style.cssText = 'white-space:pre-wrap;font:11px/1.5 monospace;margin:5px 0';
  panel.append(title, actions, status, output, probeOutput, note); document.body.append(panel);
  let loaded = false, busy = false;
  const metrics = [];
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const button = (label, action) => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
    node.style.cssText = 'padding:4px 7px;border:1px solid #986e24;border-radius:3px;background:#fff;color:#222';
    node.addEventListener('pointerdown', event => event.preventDefault());
    node.onclick = async () => {
      if (busy) return;
      busy = true;
      try { await action(); }
      catch (error) { status.textContent = 'Fixture error: ' + error.message; console.error(error); }
      finally { busy = false; }
    };
    actions.append(node); return node;
  };
  const selectedFields = () => [...document.querySelectorAll('.inlineFocusedRow input[data-editor-ref^="translation"], .inlineFocusedRow textarea[data-editor-ref^="translation"], .editor input[data-editor-ref^="translation"], .editor textarea[data-editor-ref^="translation"]')];
  function renderResults() {
    output.textContent = 'Action                  fields ms  ready ms  max frame gap  long tasks  dict rows  key p50/max ms\n'
      + metrics.map(item => [item.name.padEnd(23), String(item.fields == null ? '-' : Math.round(item.fields)).padStart(9),
        String(Math.round(item.ready)).padStart(9), String(Math.round(item.maxGap)).padStart(14),
        String(item.longTasks == null ? 'n/a' : item.longTasks).padStart(11), String(item.dictionaryRows).padStart(10),
        (item.keyLatencies.length ? Math.round([...item.keyLatencies].sort((a, b) => a - b)[Math.floor(item.keyLatencies.length / 2)])
          + '/' + Math.round(Math.max(...item.keyLatencies)) : '-').padStart(16)].join('')).join('\n');
    probeOutput.textContent = probe.enabled ? 'Timing probe ON: instrumentation adds overhead; inclusive totals overlap. Async methods include initial synchronous work only.\n'
      + metrics.map(item => item.name + '\n  calls   self ms  total ms   max ms  method/computed\n'
        + (item.probe || []).slice(0, 14).map(entry => '  ' + String(entry.calls).padStart(5) + entry.self.toFixed(1).padStart(10)
          + entry.total.toFixed(1).padStart(10) + entry.max.toFixed(1).padStart(9) + '  ' + entry.name).join('\n')).join('\n\n') : '';
  }
  async function measured(name, action, ready, { fields = false } = {}) {
    await frame();
    const result = { name, fields: null, ready: 0, maxGap: 0, longTasks: null, dictionaryRows: 0, keyLatencies: [] };
    let observer;
    if (window.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
      result.longTasks = 0;
      observer = new PerformanceObserver(list => { result.longTasks += list.getEntries().length; });
      observer.observe({ type: 'longtask' });
    }
    let stopped = false, lastFrame = performance.now(), frameId;
    const started = performance.now();
    probe.begin();
    const sample = time => {
      result.maxGap = Math.max(result.maxGap, time - lastFrame); lastFrame = time;
      if (fields && result.fields == null && selectedFields().length) result.fields = performance.now() - started;
      if (!stopped) frameId = requestAnimationFrame(sample);
    };
    frameId = requestAnimationFrame(sample);
    try {
      await action(result);
      while (!ready()) {
        if (performance.now() - started > 30000) throw new Error(name + ' did not become ready in 30 seconds.');
        await pause(5);
      }
      await editor.$nextTick();
      await frame();
      result.ready = performance.now() - started;
      // Include the render/layout following the ready-state transition.
      await frame(); await pause(0);
      result.dictionaryRows = document.querySelectorAll('.side .dictRow').length;
      if (observer) result.longTasks += observer.takeRecords().length;
    } finally { stopped = true; cancelAnimationFrame(frameId); observer?.disconnect(); result.probe = probe.end(); }
    metrics.push(result); renderResults(); return result;
  }
  async function leaveSession() {
    if (editor.hlPopup.visible) editor.closeHlPopup({ refocus: false });
    if (editor.inlineActive) await editor.finishInlineSession({ promote: false });
    else if (editor.editorVisible) await editor.editorExit();
    await editor.$nextTick(); await frame();
  }
  function description(index) {
    const name = 'fixture-' + String(index).padStart(5, '0');
    const english = ['Adds {0}% increased [Fire] damage with [Strength] and [Cold] damage'];
    const thai = ['เพิ่มความเสียหาย [Fire|ไฟ] {0}% พร้อม [Strength|ความแข็งแกร่ง] และ [Cold|เย็น]'];
    if (index < 10644) { english.push('Gain {1} [Strength]'); thai.push('ได้รับ [Strength|ความแข็งแกร่ง] {1}'); }
    if (index % 3 === 1) { english[0] += '\\nGain {1} [Strength]'; thai[0] += '\\nได้รับ [Strength|ความแข็งแกร่ง] {1}'; }
    if (index % 3 === 2) { english[0] += '@[Cold] damage {1}'; thai[0] += '@ความเสียหาย [Cold|เย็น] {1}'; }
    return { filepath: 'fixture/performance/' + name + '.txt', filedir: 'fixture/performance/', filename: name + '.txt',
      name, stats: ['performance_stat_' + index], variables: english.map(() => '# #'), remarks: english.map(() => ''), isDNT: false,
      translations: { English: english, Thai: thai } };
  }
  button('Load 20,520 files + 20,000 Dictionary entries', async () => {
    if (!editor.testMode) throw new Error('This performance fixture must run in testMode.');
    await leaveSession();
    status.textContent = 'Preparing the corpus. Setup time is excluded from interaction measurements…';
    await frame();
    const source = Array.from({ length: 20520 }, (_, index) => description(index));
    const sourceHash = 'inline-performance-fixture-v1';
    const workspace = { descs: [], status: {}, game: editor.gameVersion, sourceHash };
    WorkspaceState.initializeWorkspace(workspace, { source, sourceHash, game: editor.gameVersion, language: 'Thai' });
    editor.importBaseline = null;
    editor._workspaceSourceBaseline = Vue.markRaw(source);
    editor._workspaceBaselineIndex = null;
    editor.sourceIdentity = sourceHash; editor.localDescs = workspace;
    editor.descs = source.map(desc => ({ ...desc, translations: { English: [...desc.translations.English], Thai: [...desc.translations.Thai] } }));
    editor.dictionary = Array.from({ length: 19996 }, (_, index) => ({ _id: 'perf-' + index,
      find: 'Unrelated dictionary expression ' + index, replace: 'คำแปลตัวอย่าง ' + index, gameScope: 'all', alts: [], tlnote: '' })).concat([
      { _id: 'perf-fire', find: 'Fire', replace: 'ไฟ', gameScope: 'all', alts: [{ _id: 'perf-fire-alt', find: 'Fire damage', replace: 'ความเสียหายไฟ' }], tlnote: 'Preserve the Fire keyword identifier.' },
      { _id: 'perf-cold', find: 'Cold', replace: 'เย็น', gameScope: 'all', alts: [], tlnote: '' },
      { _id: 'perf-strength', find: 'Strength', replace: 'ความแข็งแกร่ง', gameScope: 'all', alts: [], tlnote: 'Preserve the Strength keyword identifier.' },
      { _id: 'perf-increased', find: 'increased', replace: 'เพิ่มขึ้น', gameScope: 'all', alts: [], tlnote: '' },
    ]);
    editor.sourceLoaded = true; editor.loadingProgress = 100; editor.inlineEditor = true; editor.inlineSidebarVisible = true;
    editor.sideTab = 'dictionary'; editor.dictionaryPageSize = 40; editor.pageSize = 20;
    editor.searchText = ''; editor._fileSearchSnapshot = null; editor.currentSort = 'filepath'; editor.currentSortDir = 'asc';
    editor.selectedFileFilters = editor.fileFilterOptions.map(option => option.key);
    editor.applyWorkspaceOverlay(); editor.applyFileSearch();
    await editor.$nextTick();
    editor.currentPage = 1026; // Tail-of-corpus lookups expose repeated linear scans.
    await editor.$nextTick(); await frame(); await pause(250);
    loaded = true; metrics.length = 0; renderResults();
    status.textContent = 'Ready: 20,520 files / 31,164 blocks / 20,000 Dictionary entries. Showing the last 20 files; Dictionary renders 40 rows. Relevant Dictionary entries are at the end.';
  });
  async function selectRow(index, name) {
    const rows = [...document.querySelectorAll('tr[data-filepath]')];
    const row = rows[index];
    if (!row) throw new Error('Fixture row ' + index + ' is absent.');
    const filepath = row.dataset.filepath;
    await measured(name, () => row.querySelector('.fileOpenButton').click(),
      () => editor.inlineActive && editor.editorCurrentEditingDesc?.filepath === filepath && editor.editorReady && !editor.inlineTransitionBusy, { fields: true });
  }
  async function popup(name) {
    const field = selectedFields()[0];
    if (!field || field.readOnly) throw new Error('The translation field is not editable.');
    field.focus(); field.setSelectionRange?.(0, 0);
    await measured(name, () => {
      editor.autocompleteShortcut = 'ctrl-i';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', code: 'KeyI', ctrlKey: true, bubbles: true, cancelable: true }));
    }, () => editor.hlPopup.visible && !!document.querySelector('.hlPopupItem'));
  }
  button('Run inline benchmark', async () => {
    if (!loaded) throw new Error('Load the corpus first.');
    metrics.length = 0; await leaveSession();
    editor.invalidateEditorDictionaryIndex();
    status.textContent = 'Measuring row selection with a cold Dictionary index, then popup opening and selection…';
    await selectRow(0, 'Inline cold selection');
    await popup('Inline autocomplete');
    await measured('Inline 20 arrow keys', async result => {
      for (let index = 0; index < 20; index++) {
        const key = index % 2 ? 'ArrowUp' : 'ArrowDown';
        const started = performance.now();
        (document.activeElement || selectedFields()[0]).dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
        await editor.$nextTick(); await frame();
        result.keyLatencies.push(performance.now() - started);
      }
    }, () => editor.hlPopup.visible);
    editor.closeHlPopup({ refocus: false }); await editor.$nextTick();
    await selectRow(1, 'Inline warm selection');
    await popup('Inline warm popup');
    status.textContent = 'Inline benchmark complete. Test-mode synthetic DOM events; use normal keyboard input on the selected row for manual verification.';
  });
  button('Run full-editor comparison', async () => {
    if (!loaded) throw new Error('Load the corpus first.');
    await leaveSession();
    const row = document.querySelector('tr[data-filepath]');
    await measured('Full editor selection', () => editor.openInlineFullEditor(row.dataset.filepath), () => editor.editorVisible && editor.editorReady, { fields: true });
    await popup('Full autocomplete');
    await measured('Full 20 arrow keys', async result => {
      for (let index = 0; index < 20; index++) {
        const key = index % 2 ? 'ArrowUp' : 'ArrowDown';
        const started = performance.now();
        (document.activeElement || selectedFields()[0]).dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
        await editor.$nextTick(); await frame();
        result.keyLatencies.push(performance.now() - started);
      }
    }, () => editor.hlPopup.visible);
    status.textContent = 'Full-editor comparison complete; uses the same corpus and warmed Dictionary index.';
  });
  button('Close editor', leaveSession);
  button(probe.enabled ? 'Reload without timing probe' : 'Reload with timing probe', () => {
    const url = new URL(location.href);
    if (probe.enabled) url.searchParams.delete('probe'); else url.searchParams.set('probe', '1');
    location.href = url.href;
  });
  button('Collapse fixture', () => {
    const collapsed = output.hidden = !output.hidden;
    note.hidden = collapsed; status.hidden = collapsed; probeOutput.hidden = collapsed;
  });
}

const app = express();
for (const variant of ['baseline', 'current']) {
  const router = express.Router();
  router.get(['/', '/index.html'], (req, res) => {
    if (req.query.testMode !== '1') return res.redirect('/' + variant + '/?testMode=1&lang=Thai');
    res.type('html').send(variant === 'baseline' ? baseline.get('index.html') : fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8'));
  });
  router.get('/index.js', (_req, res) => {
    const source = variant === 'baseline' ? baseline.get('index.js') : fs.readFileSync(path.join(publicDir, 'index.js'), 'utf8');
    if (!source.includes("app.mount('#app');")) throw new Error('Could not instrument the application mount.');
    if (!source.includes('const app = Vue.createApp(config);')) throw new Error('Could not instrument the application config.');
    res.type('js').send(source.replace('const app = Vue.createApp(config);', 'const performanceFixtureProbe = ('
      + installTimingProbe.toString() + ')(config);\nconst app = Vue.createApp(config);')
      .replace("app.mount('#app');", 'const performanceFixtureEditor = app.mount(\'#app\');\n('
      + installPerformanceControls.toString() + ')(performanceFixtureEditor, ' + JSON.stringify(variant) + ', performanceFixtureProbe);'));
  });
  if (variant === 'baseline') router.get('/:asset', (req, res, next) => {
    if (!baseline.has(req.params.asset)) return next();
    res.type(path.extname(req.params.asset)).send(baseline.get(req.params.asset));
  });
  router.use(express.static(publicDir));
  app.use('/' + variant, router);
}
app.get('/', (_req, res) => res.redirect('/current/?testMode=1&lang=Thai'));
app.listen(port, '127.0.0.1', () => console.log('Inline performance fixture: http://127.0.0.1:' + port + '/current/?testMode=1&lang=Thai\nBaseline (' + baselineRef + '): http://127.0.0.1:' + port + '/baseline/?testMode=1&lang=Thai'));
