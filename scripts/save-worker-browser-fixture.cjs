// Local-only acceptance fixture for a supplied source ZIP and settings export.
// Set FIXTURE_ZIP_PATH and FIXTURE_SETTINGS_PATH; source contents never leave loopback.
const express = require('express');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');

function fixtureWorkerGate() {
  const measurements = { active: null }; window.__fixtureMeasurements = measurements;
  window.__fixtureWrapComponent = app => {
    for (const [name, getter] of Object.entries(app._component.computed || {})) {
      if (typeof getter !== 'function') continue;
      app._component.computed[name] = function (...args) {
        const measurement = measurements.active, started = performance.now();
        try { return getter.apply(this, args); }
        finally {
          if (measurement) {
            measurement.computedReads = (measurement.computedReads || 0) + 1;
            const phase = measurement.phases['computed.' + name] ||= { count: 0, ms: 0 };
            phase.count++; phase.ms += performance.now() - started;
          }
        }
      };
    }
  };
  window.__fixtureInstallVueTiming = () => {
    const createApp = Vue.createApp;
    Vue.createApp = function (options, ...args) {
      window.__fixtureWrapComponent({ _component: options });
      return createApp.call(this, options, ...args);
    };
  };
  const NativeWorker = window.Worker;
  const gate = { mode: 'normal', held: [], dispatched: 0, committed: 0, failed: 0, update() {} };
  window.__fixtureSaveGate = gate;
  if (!NativeWorker) return;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (event.data?.type === 'saved') gate.committed++;
        if (event.data?.type === 'error') gate.failed++;
        gate.update();
      });
    }
    postMessage(message, options) {
      if (message?.type === 'saveTranslations') {
        if (gate.mode === 'hold') { gate.held.push({ worker: this, message, options }); gate.update(); return; }
        if (gate.mode === 'fail-next') {
          gate.mode = 'normal';
          setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: {
            type: 'error', id: message.id, error: { name: 'QuotaExceededError', message: 'Fixture: local storage write failed before commit.' },
          } })), 0);
          return;
        }
        gate.dispatched++;
      }
      super.postMessage(message, options); gate.update();
    }
  };
  gate.release = () => {
    gate.mode = 'normal';
    for (const item of gate.held.splice(0)) { gate.dispatched++; NativeWorker.prototype.postMessage.call(item.worker, item.message, item.options); }
    gate.update();
  };
}

function fixtureControls(secret) {
  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Local save fixture');
  panel.style.cssText = 'position:fixed;right:12px;bottom:60px;z-index:2147483000;padding:10px;background:#fff7dc;color:#302b1c;border:2px solid #aa7300;border-radius:8px;max-width:360px;font:13px system-ui;box-shadow:0 4px 18px #0004';
  const title = document.createElement('strong'); title.textContent = 'Local-only supplied-file fixture'; panel.append(title);
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:7px'; panel.append(actions);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Supplied files remain on this computer. No cloud account is used.'; panel.append(status);
  const timing = document.createElement('pre'); timing.setAttribute('aria-label', 'Save performance');
  timing.style.cssText = 'font:11px monospace;white-space:pre-wrap;max-height:220px;overflow:auto'; panel.append(timing);
  const workerState = document.createElement('p'); workerState.setAttribute('aria-label', 'Worker save state'); panel.append(workerState);
  const gate = window.__fixtureSaveGate;
  gate.update = () => { workerState.textContent = 'Held: ' + gate.held.length + ' · Sent: ' + gate.dispatched + ' · Committed: ' + gate.committed
    + ' · Failed: ' + gate.failed + ' · Pending local saves: ' + (window.__saveFixtureApp?.pendingLocalSaves || 0); };
  setInterval(gate.update, 100); gate.update();
  const button = (label, action) => {
    const control = document.createElement('button'); control.textContent = label;
    control.style.cssText = 'color:#222;background:#fff;border:1px solid #996d12;padding:6px;border-radius:4px;font:12px system-ui';
    control.onclick = async () => { control.disabled = true; try { await action(); } catch (error) { status.textContent = error.message; } finally { control.disabled = false; } };
    actions.append(control); return control;
  };
  const ready = async () => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const vm = window.__saveFixtureApp;
      if (vm?.offlineStoreReady && vm._cloud?.state) return vm;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Editor local storage is not ready.');
  };
  const stats = vm => {
    const files = vm.descs || [];
    return files.length + ' files · ' + files.reduce((count, desc) => count + (desc.translations?.English?.length || 0), 0)
      + ' entries · ' + vm.dictionary.length + ' dictionary entries · ' + vm.editorRegexes.length + ' regex rules';
  };
  let activeMeasurement;
  const instrument = vm => {
    const wrap = (owner, name, label = name) => {
      if (typeof owner?.[name] !== 'function' || owner[name].fixtureMeasured) return;
      const original = owner[name];
      const measured = function (...args) {
        const measurement = activeMeasurement, started = performance.now();
        const record = () => {
          if (!measurement) return;
          const phase = measurement.phases[label] ||= { count: 0, ms: 0 };
          phase.count++; phase.ms += performance.now() - started;
        };
        try {
          const result = original.apply(this, args);
          if (result && typeof result.then === 'function') {
            if (measurement) {
              const phase = measurement.phases[label + ' synchronous'] ||= { count: 0, ms: 0 };
              phase.count++; phase.ms += performance.now() - started;
            }
            return result.finally(record);
          }
          record(); return result;
        } catch (error) { record(); throw error; }
      };
      measured.fixtureMeasured = true; owner[name] = measured;
    };
    for (const name of ['toPlainForStorage', 'refreshEditorDiagnostics', 'persistTranslationBatch', 'applyCollaborationFiles', 'rebaseEditorAfterCommit', 'filterDesc',
      'syncFileSelection', 'initializePendingSaves', 'updateLeaveProtection', 'collaborationFile', 'getDescByFilepath', 'ensureLocalDescsReady']) wrap(vm, name);
    for (const name of ['saveWorkspaceWithRevisions', 'updateCollaborationState', 'saveTranslation']) wrap(OfflineStore, name, 'IndexedDB.' + name);
    if (vm.editorSave.fixtureMeasured) return;
    const original = vm.editorSave;
    const measured = async function (...args) {
      const measurement = { started: performance.now(), phases: {} }; activeMeasurement = measurement;
      window.__fixtureMeasurements.active = measurement;
      timing.textContent = 'Measuring save…';
      const closeObserver = () => {
        if (!vm.editorVisible) measurement.closedMs = performance.now() - measurement.started;
        else if (activeMeasurement === measurement) requestAnimationFrame(closeObserver);
      };
      requestAnimationFrame(closeObserver);
      try { return await original.apply(this, args); }
      finally {
        activeMeasurement = null;
        window.__fixtureMeasurements.active = null;
        timing.textContent = 'Save promise: ' + (performance.now() - measurement.started).toFixed(1) + ' ms\n'
          + 'Editor closed: ' + (!vm.editorVisible ? ((measurement.closedMs ?? (performance.now() - measurement.started)).toFixed(1) + ' ms') : 'still open') + '\n'
          + 'Computed reads: ' + (measurement.computedReads || 0) + '\n'
          + Object.entries(measurement.phases)
            .map(([name, phase]) => name + ': ' + phase.ms.toFixed(1) + ' ms (' + phase.count + ')').join('\n')
          + '\nNested phase times overlap.';
      }
    };
    measured.fixtureMeasured = true; vm.editorSave = measured;
  };
  button('Import supplied files locally', async () => {
    const vm = await ready();
    if (vm.cloudSignedIn) throw new Error('This fixture requires a signed-out isolated origin.');
    vm._cloud.fetcher = async () => { throw new TypeError('Cloud disabled in local-only fixture.'); };
    status.textContent = 'Reading supplied files from loopback…';
    const headers = { 'X-Fixture-Key': secret };
    const [settingsResponse, zipResponse] = await Promise.all([fetch('/fixture/settings', { headers }), fetch('/fixture/zip', { headers })]);
    if (!settingsResponse.ok || !zipResponse.ok) throw new Error('Local fixture input is unavailable.');
    const settings = await settingsResponse.json();
    CloudSync.validateImport(settings);
    if (!await vm.cloudImport(settings)) throw new Error('Supplied settings could not be imported locally.');
    const file = new File([await zipResponse.blob()], 'fixture-source.zip', { type: 'application/zip' });
    const zip = await new JSZip().loadAsync(file);
    await OfflineStore.setMigratedFromSingleVersion(true);
    await vm.activateGameVersion(vm.detectGameVersionFromZip(zip) || 'poe1', { checkMigration: false });
    vm.showSetting = false; vm.needsInitialSettings = false;
    status.textContent = 'Importing locally with the production ZIP parser…';
    await vm.importUpdateZipFile(file);
    instrument(vm);
    status.textContent = stats(vm) + ' · imported locally';
  });
  button('Measure saves', async () => { const vm = await ready(); instrument(vm); status.textContent = stats(vm) + ' · timing enabled'; });
  button('Open sample file', async () => {
    const vm = await ready();
    const desc = vm.descs.find(item => !item.isDNT && item.translations?.English?.length === 1
      && item.translations?.[vm.lang]?.length === 1 && item.translations[vm.lang][0]
      && !/[{}\[\]<>\\\n]/.test(item.translations.English[0] + item.translations[vm.lang][0]));
    if (!desc) throw new Error('No plain single-entry sample was found.');
    await vm.editFile(desc.filepath); status.textContent = stats(vm) + ' · single-entry sample open';
  });
  button('Check close warning', async () => {
    await ready();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    status.textContent = 'Beforeunload warning requested: ' + (event.defaultPrevented ? 'yes' : 'no');
  });
  button('Hold worker saves', async () => { gate.mode = 'hold'; status.textContent = 'Worker writes will wait until Release held saves.'; });
  button('Release held saves', async () => { gate.release(); status.textContent = 'Held writes released to the real storage worker.'; });
  button('Fail next worker save', async () => { gate.mode = 'fail-next'; status.textContent = 'The next worker save will fail before commit; retry remains available.'; });
  document.body.append(panel);
}

const zipPath = process.env.FIXTURE_ZIP_PATH, settingsPath = process.env.FIXTURE_SETTINGS_PATH;
if (!zipPath || !settingsPath) throw new Error('Set FIXTURE_ZIP_PATH and FIXTURE_SETTINGS_PATH to local input files.');
const secret = randomUUID(), frontend = express(), port = Number(process.env.FIXTURE_PORT || 37201);
frontend.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "connect-src 'self'; form-action 'none'; frame-src 'none'" }); next();
});
for (const [route, path, type] of [['zip', zipPath, 'application/zip'], ['settings', settingsPath, 'application/json']]) {
  frontend.get('/fixture/' + route, (req, res) => {
    if (req.get('X-Fixture-Key') !== secret) return res.sendStatus(403);
    res.type(type).send(readFileSync(resolve(path)));
  });
}
frontend.use('/v1', (req, res) => res.status(503).json({ error: 'Cloud disabled in local-only fixture.' }));
frontend.get('/', (req, res) => {
  const html = readFileSync(resolve(__dirname, '../public/index.html'), 'utf8');
  const script = '<script>(' + fixtureControls.toString() + ')(' + JSON.stringify(secret) + ');</script>';
  res.type('html').send(html.replace('<head>', '<head><script>(' + fixtureWorkerGate.toString() + ')();</script>')
    .replace('<script src="index.js">', '<script>window.__fixtureInstallVueTiming();</script><script src="index.js">').replace('</body>', script + '</body>'));
});
frontend.get('/index.js', (req, res) => {
  const source = readFileSync(resolve(__dirname, '../public/index.js'), 'utf8');
  res.type('js').send(source.replace("app.mount('#app');", "window.__saveFixtureApp = app.mount('#app');"));
});
frontend.use(express.static(resolve(__dirname, '../public')));
const server = createServer(frontend);
server.listen(port, '127.0.0.1', () => console.log('Local-only fixture: http://127.0.0.1:' + port + '/?cloudApi=' + encodeURIComponent('http://127.0.0.1:' + port)));
process.once('SIGINT', () => server.close()); process.once('SIGTERM', () => server.close());
