// Disposable, loopback-only performance fixture. Workspace storage/cloud are bypassed.
// Run: node scripts/workspace-search-browser-fixture.cjs
// Optional: --baseline <file> supplies `git show HEAD:public/index.js` without spawning Git.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

// The comparison stays inside this fixture; production code is served unchanged.
const baselineFlag = process.argv.indexOf('--baseline');
if (baselineFlag >= 0 && !process.argv[baselineFlag + 1]) throw new Error('--baseline requires a path to the original index.js.');
let previousFilter = 'null';
if (baselineFlag >= 0) {
  const previousSource = fs.readFileSync(process.argv[baselineFlag + 1], 'utf8');
  const previousMatch = previousSource.match(/    filterDesc\(\) \{([\s\S]*?)\r?\n    \},\r?\n    sort\(s\)/);
  if (!previousMatch) throw new Error('The supplied baseline must contain the original filterDesc() method.');
  previousFilter = 'function () {' + previousMatch[1] + '\n}';
}

function controls(editor, originalFilter) {
  const panel = document.createElement('aside');
  panel.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:9999;background:#fff8df;color:#222;padding:10px;border:1px solid #a80;font:13px system-ui;max-width:760px;max-height:40vh;overflow:auto';
  panel.setAttribute('aria-label', 'Workspace search performance fixture');
  const actions = document.createElement('div');
  const appearance = document.createElement('div');
  appearance.style.marginTop = '6px';
  const status = document.createElement('p');
  status.textContent = 'Test data only. Load files, then search or run the benchmark.';
  status.setAttribute('role', 'status');
  const metric = document.createElement('div');
  const output = document.createElement('pre');
  output.style.cssText = 'font:12px monospace;white-space:pre-wrap;margin-bottom:0';
  panel.append(actions, appearance, status, metric, output);
  document.body.append(panel);
  const button = (parent, label, onclick) => {
    const element = document.createElement('button');
    element.textContent = label;
    element.style.marginRight = '5px';
    element.onclick = onclick;
    parent.append(element);
    return element;
  };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const metrics = [];
  const filter = editor.filterDesc;
  editor.filterDesc = function (...args) {
    const started = performance.now();
    const result = filter.apply(this, args);
    const entry = { searchOnly: !!args[0]?.searchOnly, ms: performance.now() - started, results: this.filteredDescs.length };
    metrics.push(entry);
    metric.textContent = `Filter calls: ${metrics.length}; searchOnly: ${entry.searchOnly}; synchronous query: ${entry.ms.toFixed(2)} ms; results: ${entry.results.toLocaleString('en-US')}.`;
    return result;
  };
  let loaded = false;
  let busy = false;
  const run = async task => {
    if (busy) return;
    busy = true;
    try { await task(); }
    catch (error) { status.textContent = 'Fixture failed: ' + error.message; }
    finally { busy = false; }
  };

  button(actions, 'Load 20,000 files', () => run(async () => {
    status.textContent = 'Preparing 20,000 staged files and their separate immutable source baseline…';
    await frame();
    if (editor.editorVisible) {
      await editor.editorExit();
      if (editor.editorVisible) { status.textContent = 'Close the editor before loading fixture data.'; return; }
    }
    clearTimeout(editor._fileSearchTimer);
    editor._fileSearchTimer = null;
    const sourceHash = 'fixture-workspace-search-v1';
    const source = Array.from({ length: 20000 }, (_, i) => {
      const filename = i === 19997 ? 'late-filename-match.txt' : `fixture-${String(i).padStart(5, '0')}.txt`;
      return {
        filepath: 'fixture/search/' + filename, filedir: 'fixture/search/', filename,
        name: 'fixture-' + i, stats: ['fixture_stat_' + i], variables: ['#', '#', '#'], remarks: ['', '', ''], isDNT: false,
        translations: {
          English: [`Adds {0} damage for fixture ${i}`, 'Additional [Strength] and [Poison] damage', i === 19998 ? 'late-english-match' : 'Complete English text'],
          Thai: [`เพิ่มความเสียหาย {0} สำหรับตัวอย่าง ${i}`, 'เพิ่ม [Strength|ความแข็งแกร่ง] และ [Poison|พิษ]', i === 19999 ? 'ปลายทางค้นหา' : 'คำแปลภาษาไทยครบถ้วน'],
          German: [`Verursacht {0} Schaden für Beispiel ${i}`, 'Zusätzliche [Strength|Stärke] und [Poison|Gift]', i === 19999 ? 'spätfund' : 'Vollständige deutsche Übersetzung'],
        },
      };
    });
    const workspace = { descs: [], status: {}, game: editor.gameVersion, sourceHash };
    window.WorkspaceState.initializeWorkspace(workspace, { source, sourceHash, game: editor.gameVersion, language: editor.lang });
    for (const desc of source) for (const language of ['Thai', 'German']) {
      window.WorkspaceState.stageTranslation(workspace, { filepath: desc.filepath, translations: desc.translations[language] }, language,
        { source: desc, sourceHash, savedAt: 1, saveOrigin: 'fixture' });
    }
    editor.importBaseline = null;
    editor._workspaceSourceBaseline = Vue.markRaw(source);
    editor._workspaceBaselineIndex = null;
    editor.sourceIdentity = sourceHash;
    editor.localDescs = workspace;
    // Keep the displayed descriptions distinct from immutable source arrays.
    editor.descs = source.map(desc => ({ ...desc, translations: Object.fromEntries(Object.entries(desc.translations).map(([language, lines]) => [language, [...lines]])) }));
    editor.sourceLoaded = true;
    editor.loadingProgress = 100;
    editor.searchText = 'late-english-match';
    editor.currentPage = 1;
    editor._fileSearchSnapshot = null;
    editor.applyWorkspaceOverlay();
    editor.filterDesc();
    await editor.$nextTick();
    loaded = true;
    output.textContent = '';
    status.textContent = `20,000 files ready in ${editor.lang}; stagedVersion=${workspace.stagedVersion}; source baseline is separate. Late matches: late-filename-match, late-english-match, ปลายทางค้นหา (Thai), spätfund (German).`;
  }));

  button(actions, 'Run search benchmark', () => run(async () => {
    if (!loaded) { status.textContent = 'Load the files first.'; return; }
    clearTimeout(editor._fileSearchTimer);
    editor._fileSearchTimer = null;
    output.textContent = originalFilter ? 'Query                     Previous ms   Current ms  Results  Equal\n'
      : 'Query                         Current ms  Results\n';
    const queries = ['late-filename-match', 'late-english-match', 'ปลายทางค้นหา', 'spätfund', 'no-fixture-match'];
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    for (const query of queries) {
      status.textContent = `Measuring ${editor.lang}: ${query} (three runs per method)…`;
      await frame();
      const previous = [], current = [];
      let equal = true;
      for (let i = 0; i < 3; i++) {
        editor.searchText = query;
        let previousPaths;
        if (originalFilter) {
          const started = performance.now();
          originalFilter.call(editor);
          previous.push(performance.now() - started);
          previousPaths = editor.filteredDescs.map(row => row.filepath);
        }
        editor.applyFileSearch();
        current.push(metrics[metrics.length - 1].ms);
        if (originalFilter) equal &&= JSON.stringify(previousPaths) === JSON.stringify(editor.filteredDescs.map(row => row.filepath));
      }
      output.textContent += originalFilter
        ? `${query.padEnd(25)} ${median(previous).toFixed(2).padStart(11)} ${median(current).toFixed(2).padStart(12)} ${String(editor.filteredDescs.length).padStart(8)}  ${equal}\n`
        : `${query.padEnd(29)} ${median(current).toFixed(2).padStart(10)} ${String(editor.filteredDescs.length).padStart(8)}\n`;
      await editor.$nextTick();
    }
    editor.searchText = 'late-english-match';
    editor.applyFileSearch();
    status.textContent = `Benchmark complete for ${editor.lang}: synchronous median times across 20,000 files${originalFilter ? '; Previous includes the supplied original status/filter work' : ''}. Only the normal paginated table is rendered.`;
  }));

  button(actions, 'Simulate fast typing', () => run(async () => {
    if (!loaded) { status.textContent = 'Load the files first.'; return; }
    const input = document.getElementById('searchInp');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await editor.$nextTick();
    await frame();
    metrics.length = 0;
    const eventTimes = [];
    for (const query of ['late', 'late-', 'late-english', 'late-english-match']) {
      const started = performance.now();
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      eventTimes.push(performance.now() - started);
      await pause(45);
    }
    await pause(300);
    await editor.$nextTick();
    status.textContent = `Four input events 45 ms apart: ${metrics.length} search call(s), ${editor.filteredDescs.length} result(s), query ${JSON.stringify(editor.searchText)}. Longest synchronous input event: ${Math.max(...eventTimes).toFixed(2)} ms.`;
  }));

  for (const language of ['Thai', 'German']) button(appearance, language, () => run(async () => {
    // Suppress account requests even when a test-mode watcher changes language.
    const applying = editor._cloudApplying;
    editor._cloudApplying = true;
    try { editor.lang = language; await editor.$nextTick(); }
    finally { editor._cloudApplying = applying; }
    status.textContent = `${language} selected; ${editor.filteredDescs.length} result(s).`;
  }));
  for (const theme of ['light', 'grey', 'dark', 'modern-dark']) button(appearance, theme, () => {
    editor.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
  });
}

const app = express();
app.get(['/', '/index.html'], (req, res, next) => {
  if (req.query.testMode === '1') return next();
  const target = new URL(req.originalUrl, 'http://127.0.0.1:3337');
  target.searchParams.set('testMode', '1');
  if (!target.searchParams.has('lang')) target.searchParams.set('lang', 'Thai');
  res.redirect(target.pathname + target.search);
});
app.get('/index.js', (_req, res) => {
  const source = fs.readFileSync(path.join(publicDir, 'index.js'), 'utf8');
  res.type('js').send(source.replace("app.mount('#app');", `const fixtureEditor = app.mount('#app');\n(${controls.toString()})(fixtureEditor, (${previousFilter}));`));
});
app.use(express.static(publicDir));
app.listen(3337, '127.0.0.1', () => console.log('Search fixture: http://127.0.0.1:3337/?testMode=1&lang=Thai'));
