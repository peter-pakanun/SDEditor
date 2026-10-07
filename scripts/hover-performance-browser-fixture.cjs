// Disposable, loopback-only fixture. Test mode bypasses storage and cloud startup.
// Run: node scripts/hover-performance-browser-fixture.cjs --baseline <old-index.js>
// Baseline HTML is captured at startup, or supplied with --baseline-html <old-index.html>.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const publicDir = path.join(__dirname, '..', 'public');
const port = 3339;
const option = name => {
  const at = process.argv.indexOf(name);
  if (at < 0) return null;
  if (!process.argv[at + 1]) throw new Error(`${name} requires a file path.`);
  return process.argv[at + 1];
};
const baselinePath = option('--baseline');
const baselineHtmlPath = option('--baseline-html');
const baselineSource = baselinePath ? fs.readFileSync(baselinePath, 'utf8') : null;
const baselineHtml = fs.readFileSync(baselineHtmlPath || path.join(publicDir, 'index.html'), 'utf8');

function instrument(app, metrics) {
  app.mixin({
    created() {
      if (this.$root !== this) return;
      for (const name of ['collaborationPeersFor', 'collaborationEditing', 'collaborationCellStyle', 'collaborationSelectionLabel', 'collaborationEditingPeersFor']) {
        const original = this[name];
        if (typeof original !== 'function') continue;
        this[name] = function (...args) {
          metrics.rowCalls[name] = (metrics.rowCalls[name] || 0) + 1;
          return original.apply(this, args);
        };
      }
    },
    beforeUpdate() {
      if (this.$root !== this) return;
      metrics.rootUpdates++;
      metrics.started = performance.now();
    },
    updated() {
      if (this.$root !== this) return;
      const elapsed = performance.now() - metrics.started;
      metrics.rootRenderMs += elapsed;
      metrics.maxRootRenderMs = Math.max(metrics.maxRootRenderMs, elapsed);
    },
  });
}

async function idleBenchmark(methods) {
  // Run the actual source method on a disposable plain context. Lexical mocks
  // preserve the page's real channels, instance detector and localStorage.
  const counters = { created: 0, living: 0, posts: 0, deliveries: 0 };
  const handles = [];
  const storage = new Map();
  const fakeStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  };
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      handles.push(this);
      counters.created++;
      counters.living++;
    }
    postMessage(message) {
      if (this.closed) throw new Error('Channel is closed.');
      counters.posts++;
      for (const other of handles) {
        if (other === this || other.closed || other.name !== this.name) continue;
        queueMicrotask(() => {
          if (other.closed) return;
          counters.deliveries++;
          other.onmessage?.({ data: { ...message } });
        });
      }
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      counters.living--;
    }
  }
  const context = { ...methods, instanceTabId: 'fixture-main', showMultiInstanceGate: false, multiInstanceBypass: false,
    multiInstanceCheckTimer: null, _broadcastChannel: null };
  // Method shorthand remains valid inside an object literal. Rebind every
  // detector helper that directly refers to a browser channel or storage.
  for (const [name, method] of Object.entries(methods)) {
    if (typeof method !== 'function') continue;
    const source = method.toString();
    if (!source.includes('BroadcastChannel') && name !== 'checkMultipleInstances') continue;
    context[name] = new Function('BroadcastChannel', 'localStorage', `return ({ ${source} })[${JSON.stringify(name)}];`)(FakeBroadcastChannel, fakeStorage);
  }
  const started = performance.now();
  try {
    for (let index = 0; index < 100; index++) context.checkMultipleInstances();
    await Promise.resolve();
    const idle = { ...counters, gateShown: context.showMultiInstanceGate, elapsedMs: performance.now() - started };
    const peer = new FakeBroadcastChannel('sdeditor-instances');
    peer.postMessage({ type: 'instance_check', id: 'fixture-other-tab' });
    await Promise.resolve();
    const peerDetected = context.showMultiInstanceGate;
    context.showMultiInstanceGate = false;
    context.multiInstanceBypass = true;
    peer.postMessage({ type: 'instance_check', id: 'fixture-other-tab' });
    await Promise.resolve();
    const bypassPreserved = !context.showMultiInstanceGate;
    return { idle, peerDetected, bypassPreserved };
  } finally {
    for (const channel of handles) channel.close();
  }
}

function controls(editor, metrics, mode, baselineAvailable, methods, measureIdle) {
  const panel = document.createElement('aside');
  panel.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:9999;background:#fff8df;color:#222;padding:10px;border:1px solid #a80;font:13px system-ui;max-width:800px;max-height:40vh;overflow:auto';
  panel.setAttribute('aria-label', 'File hover performance fixture');
  const heading = document.createElement('strong');
  heading.textContent = `File hover fixture — ${mode} source`;
  const actions = document.createElement('div');
  actions.style.marginTop = '6px';
  const appearance = document.createElement('div');
  appearance.style.marginTop = '6px';
  const status = document.createElement('p');
  status.textContent = 'Test data only. Load 20,000 files, then hover filenames or run the benchmark. Storage and cloud startup are bypassed.';
  status.setAttribute('role', 'status');
  const live = document.createElement('div');
  const output = document.createElement('pre');
  output.style.cssText = 'font:12px monospace;white-space:pre-wrap;margin-bottom:0';
  panel.append(heading, actions, appearance, status, live, output);
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
  const totalCalls = () => Object.values(metrics.rowCalls).reduce((sum, count) => sum + count, 0);
  const refresh = () => {
    live.textContent = `Root updates: ${metrics.rootUpdates}; total root render: ${metrics.rootRenderMs.toFixed(2)} ms; longest root render: ${metrics.maxRootRenderMs.toFixed(2)} ms; collaboration row calls: ${totalCalls()}; filename mousemove events: ${metrics.pointerEvents}.`;
  };
  const reset = () => {
    metrics.rootUpdates = 0;
    metrics.rootRenderMs = 0;
    metrics.maxRootRenderMs = 0;
    metrics.rowCalls = {};
    metrics.pointerEvents = 0;
    refresh();
  };
  document.addEventListener('mousemove', event => {
    if (event.target?.closest?.('.fileOpenButton')) metrics.pointerEvents++;
  }, true);
  setInterval(refresh, 250);
  let loaded = false;
  let busy = false;
  const run = async task => {
    if (busy) return;
    busy = true;
    try { await task(); }
    catch (error) { status.textContent = 'Fixture failed: ' + error.message; }
    finally { busy = false; refresh(); }
  };

  button(actions, 'Load 20,000 files', () => run(async () => {
    status.textContent = 'Preparing 20,000 files with a separate source baseline and staged translations…';
    await frame();
    if (editor.editorVisible) {
      await editor.editorExit();
      if (editor.editorVisible) { status.textContent = 'Close the editor before loading fixture data.'; return; }
    }
    clearTimeout(editor._fileSearchTimer);
    editor._fileSearchTimer = null;
    const sourceHash = 'fixture-file-hover-v1';
    const language = editor.lang;
    const source = Array.from({ length: 20000 }, (_, index) => {
      const filename = `fixture-${String(index).padStart(5, '0')}.txt`;
      return {
        filepath: `fixture/hover/${filename}`, filedir: 'fixture/hover/', filename,
        name: `fixture-${index}`, stats: [`fixture_stat_${index}`], variables: ['#', '#', '#'], remarks: ['', '', ''], isDNT: false,
        translations: {
          English: [`Adds {0} damage for fixture ${index}`, 'Additional [Strength] and [Poison] damage', 'Complete English text'],
          Thai: [`เพิ่มความเสียหาย {0} สำหรับตัวอย่าง ${index}`, 'เพิ่ม [Strength|ความแข็งแกร่ง] และ [Poison|พิษ]', index % 31 ? 'คำแปลภาษาไทยครบถ้วน' : ''],
          German: [`Verursacht {0} Schaden für Beispiel ${index}`, 'Zusätzliche [Strength|Stärke] und [Poison|Gift]', 'Vollständige deutsche Übersetzung'],
        },
      };
    });
    const workspace = { descs: [], status: {}, game: editor.gameVersion, sourceHash };
    window.WorkspaceState.initializeWorkspace(workspace, { source, sourceHash, game: editor.gameVersion, language });
    for (const desc of source) window.WorkspaceState.stageTranslation(workspace,
      { filepath: desc.filepath, translations: desc.translations[language] || [] }, language,
      { source: desc, sourceHash, savedAt: 1, saveOrigin: 'fixture' });
    editor.importBaseline = null;
    editor._workspaceSourceBaseline = Vue.markRaw(source);
    editor._workspaceBaselineIndex = null;
    editor.sourceIdentity = sourceHash;
    editor.localDescs = workspace;
    editor.descs = source.map(desc => ({ ...desc, translations: Object.fromEntries(Object.entries(desc.translations).map(([lang, lines]) => [lang, [...lines]])) }));
    editor.sourceLoaded = true;
    editor.loadingProgress = 100;
    editor.searchText = '';
    editor.currentPage = 1;
    editor.pageSize = 20;
    editor._fileSearchSnapshot = null;
    editor.applyWorkspaceOverlay();
    editor.filterDesc();
    await editor.$nextTick();
    await frame();
    loaded = true;
    output.textContent = '';
    reset();
    status.textContent = `20,000 files ready in ${language}; 20 rows per page (app default). Staged text belongs only to ${language}; source baseline and displayed text are separate. Hover any filename to measure root work.`;
  }));

  button(actions, 'Benchmark 120 pointer events', () => run(async () => {
    if (!loaded) { status.textContent = 'Load the files first.'; return; }
    editor.hideTooltip();
    document.activeElement?.blur?.();
    await editor.$nextTick();
    await frame();
    const filename = document.querySelector('.fileOpenButton');
    if (!filename) throw new Error('No filename button is visible.');
    const rect = filename.getBoundingClientRect();
    status.textContent = 'Measuring 120 filename mousemove events, one per animation frame…';
    reset();
    const dispatchTimes = [];
    const frameTimes = [];
    const started = performance.now();
    let previous = started;
    for (let index = 0; index < 120; index++) {
      await frame();
      const now = performance.now();
      frameTimes.push(now - previous);
      previous = now;
      const dispatchStarted = performance.now();
      filename.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + 8 + index % 20, clientY: rect.top + 8 + index % 5 }));
      dispatchTimes.push(performance.now() - dispatchStarted);
    }
    await editor.$nextTick();
    await frame();
    const elapsed = performance.now() - started;
    output.textContent = `${mode} source; ${editor.descs.length.toLocaleString('en-US')} files; ${editor.descsDisplay.length} displayed rows\n`
      + `Pointer events: ${metrics.pointerEvents}\nRoot updates: ${metrics.rootUpdates}\nRoot render total: ${metrics.rootRenderMs.toFixed(2)} ms\nLongest root render: ${metrics.maxRootRenderMs.toFixed(2)} ms\n`
      + `Collaboration row calls: ${totalCalls()}\nCalls by method: ${JSON.stringify(metrics.rowCalls)}\n`
      + `Event dispatch max: ${Math.max(...dispatchTimes).toFixed(2)} ms\nFrame gap max: ${Math.max(...frameTimes).toFixed(2)} ms\nElapsed: ${elapsed.toFixed(2)} ms`;
    status.textContent = 'Benchmark complete. Tooltip remains visible. Use the source links to reload the other version, then load files and benchmark again.';
  }));
  button(actions, 'Reset metrics', reset);
  button(actions, 'Benchmark 100 idle checks', () => run(async () => {
    status.textContent = 'Measuring the actual instance detector with disposable simulated channels and storage…';
    const result = await measureIdle(methods);
    output.textContent = `${mode} source; 100 idle instance checks (equivalent to 200 seconds of normal polling)\n`
      + `Detector channels created: ${result.idle.created}\nDetector channels still open: ${result.idle.living}\n`
      + `Broadcast posts: ${result.idle.posts}\nDelivered callbacks among same-tab channels: ${result.idle.deliveries}\n`
      + `False multiple-instance gate: ${result.idle.gateShown}\nDifferent tab detected: ${result.peerDetected}\nBypass respected: ${result.bypassPreserved}\n`
      + `Simulated check and callback time: ${result.idle.elapsedMs.toFixed(2)} ms\nAll simulated channels closed after benchmark.`;
    status.textContent = 'Idle benchmark complete. Real browser channels and localStorage were untouched. Reload the other source version to compare.';
  }));
  button(actions, '20 rows (default)', () => { editor.pageSize = 20; });
  button(actions, '100 rows (stress)', () => { editor.pageSize = 100; });
  button(actions, 'Focus first filename', () => {
    document.querySelector('.fileOpenButton')?.focus();
    status.textContent = 'First filename focused: its filepath tooltip should be visible. Press Tab to leave it.';
  });
  button(actions, 'Dismiss tooltip', () => {
    document.activeElement?.blur?.();
    editor.hideTooltip();
    status.textContent = 'Tooltip dismissed.';
  });
  for (const theme of ['light', 'grey', 'dark', 'modern-dark']) button(appearance, theme, () => {
    editor.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
  });
  for (const sourceMode of ['current', ...(baselineAvailable ? ['baseline'] : [])]) {
    const link = document.createElement('a');
    link.textContent = `Reload ${sourceMode}`;
    link.style.cssText = 'margin-left:8px;color:#0645ad';
    link.href = `/?testMode=1&lang=${encodeURIComponent(editor.lang || 'Thai')}${sourceMode === 'baseline' ? '&baseline=1' : ''}`;
    appearance.append(link);
  }
  refresh();
}

const app = express();
app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.get(['/', '/index.html'], (req, res) => {
  if (req.query.testMode !== '1') {
    const target = new URL(req.originalUrl, `http://127.0.0.1:${port}`);
    target.searchParams.set('testMode', '1');
    if (!target.searchParams.has('lang')) target.searchParams.set('lang', 'Thai');
    return res.redirect(target.pathname + target.search);
  }
  const useBaseline = req.query.baseline === '1' && !!baselineSource;
  const html = useBaseline ? baselineHtml : fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  res.type('html').send(html.replace('<script src="index.js"></script>', `<script src="index.js${useBaseline ? '?baseline=1' : ''}"></script>`));
});
app.get('/index.js', (req, res) => {
  const useBaseline = req.query.baseline === '1' && !!baselineSource;
  const source = useBaseline ? baselineSource : fs.readFileSync(path.join(publicDir, 'index.js'), 'utf8');
  if (!source.includes("app.mount('#app');")) return res.status(500).send('Fixture expects the standard app mount.');
  const injected = `const fixtureMetrics = { rootUpdates: 0, rootRenderMs: 0, maxRootRenderMs: 0, rowCalls: {}, pointerEvents: 0, started: 0 };\n`
    + `(${instrument.toString()})(app, fixtureMetrics);\n`
    + `const fixtureEditor = app.mount('#app');\n`
    + `(${controls.toString()})(fixtureEditor, fixtureMetrics, ${JSON.stringify(useBaseline ? 'baseline' : 'current')}, ${!!baselineSource}, config.methods, (${idleBenchmark.toString()}));`;
  res.type('js').send(source.replace("app.mount('#app');", injected));
});
app.use(express.static(publicDir));
app.listen(port, '127.0.0.1', () => console.log(`Hover fixture: http://127.0.0.1:${port}/?testMode=1&lang=Thai${baselineSource ? ' (baseline comparison available)' : ''}`));
