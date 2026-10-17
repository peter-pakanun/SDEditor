// Disposable loopback acceptance fixture. It never runs in the production server.
// Two editor origins isolate browser storage; both connect to the real API and WS server.
// --check-sd-validation runs the current save/recovery checks headlessly and exits.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFileSync, existsSync, mkdtempSync, rmSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');

function browserControls(account, secret, settings) {
  // This function is serialized only into fixture-served pages, never public/index.html.
  const panel = document.createElement('aside');
  panel.id = 'collaboration-fixture-controls';
  panel.setAttribute('aria-label', 'Disposable collaboration fixture');
  panel.style.cssText = 'position:fixed;right:12px;bottom:60px;z-index:2147483000;padding:10px;background:#fff7dc;color:#302b1c;border:2px solid #aa7300;border-radius:8px;max-width:310px;font:13px system-ui;box-shadow:0 4px 18px #0004';
  const title = document.createElement('strong'); title.textContent = 'Disposable fixture · Translator ' + account.toUpperCase(); panel.append(title);
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:7px'; panel.append(actions);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.style.margin = '7px 0 0'; status.textContent = 'Bootstrapping replaces only this fixture origin’s local source.'; panel.append(status);
  const timing = document.createElement('pre'); timing.setAttribute('aria-label', 'Save performance');
  timing.style.cssText = 'font:11px monospace;white-space:pre-wrap;margin:7px 0 0;max-height:230px;overflow:auto'; panel.append(timing);
  const button = (label, action) => {
    const control = document.createElement('button'); control.textContent = label;
    control.style.cssText = 'color:#222;background:#fff;border:1px solid #996d12;padding:6px;border-radius:4px;font:12px system-ui';
    control.onclick = async () => { control.disabled = true; try { await action(); } catch (error) { panel.dataset.error = error.message; status.textContent = error.message; } finally { control.disabled = false; } };
    actions.append(control); return control;
  };
  const getApp = () => window.__collaborationFixtureApp || document.querySelector('#app').__vue_app__?._instance?.proxy;
  const ready = async () => {
    for (let index = 0; index < 200; index++) {
      const vm = getApp();
      if (vm?._cloud?.state && vm.offlineStoreReady && vm.startupReady && !vm._cloudInitializing && !vm._cloudApplying) return vm;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Editor initialization did not finish. Inspect visible storage or script errors.');
  };
  const openFixtureSource = async (vm, scope) => {
    await vm.activateGameVersion(scope.game, { checkMigration: false });
    await OfflineStore.activateVersion(scope);
    await vm.loadVersionedStorage();
    vm.gameVersionSelected = true; vm.versionChooserVisible = false;
    await vm.$nextTick(); await vm.initializeCollaboration();
  };
  let offline = false;
  let originalFetcher;
  let activeMeasurement = null;
  const instrument = vm => {
    const wrap = (owner, name, label = name) => {
      if (typeof owner?.[name] !== 'function' || owner[name].fixtureMeasured) return;
      const original = owner[name];
      const measured = function (...args) {
        const measurement = activeMeasurement, start = performance.now();
        const record = () => {
          if (!measurement) return;
          const phase = measurement.phases[label] ||= { calls: 0, ms: 0 };
          phase.calls++; phase.ms += performance.now() - start;
        };
        try {
          const result = original.apply(this, args);
          if (result && typeof result.then === 'function') return result.finally(record);
          record(); return result;
        } catch (error) { record(); throw error; }
      };
      measured.fixtureMeasured = true; owner[name] = measured;
    };
    for (const name of ['toPlainForStorage', 'refreshEditorDiagnostics', 'persistTranslationBatch', 'applyCollaborationFiles',
      'rebaseEditorAfterCommit', 'updateEditorHLter', 'saveSettings', 'filterDesc']) wrap(vm, name);
    for (const name of ['save', 'update', 'snapshot']) wrap(vm._collaboration, name, 'Client.' + name);
    for (const name of ['updateCollaborationState', 'saveWorkspaceWithRevisions']) wrap(OfflineStore, name, 'IndexedDB.' + name);
    if (vm.editorSave.fixtureMeasured) return;
    const originalSave = vm.editorSave;
    const measuredSave = async function (...args) {
      const measurement = { phases: {}, start: performance.now() }; activeMeasurement = measurement;
      timing.textContent = 'Measuring local save…';
      try { return await originalSave.apply(this, args); }
      finally {
        measurement.totalMs = performance.now() - measurement.start;
        activeMeasurement = null;
        timing.textContent = 'Save total: ' + measurement.totalMs.toFixed(1) + ' ms\n'
          + Object.entries(measurement.phases).map(([name, phase]) => name + ': ' + phase.ms.toFixed(1) + ' ms (' + phase.calls + ')').join('\n')
          + '\nNested phase times overlap.';
      }
    };
    measuredSave.fixtureMeasured = true; vm.editorSave = measuredSave;
  };
  const seed = Array.from({ length: settings.fileCount }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    const english = Array.from({ length: settings.entriesPerFile }, (_, entry) => (entry % 2 ? 'Cold' : 'Fire') + ' damage ' + number + (entry > 1 ? ' line ' + (entry + 1) : ''));
    const thai = Array.from({ length: settings.entriesPerFile }, (_, entry) => 'ความเสียหาย' + (entry % 2 ? 'เย็น' : 'ไฟ') + ' ' + number + (entry > 1 ? ' บรรทัด ' + (entry + 1) : ''));
    return { filepath: 'fixture/stat_' + number + '.txt', filedir: 'fixture', filename: 'stat_' + number + '.txt', name: '',
      stats: ['fixture_stat_' + number], variables: english.map(() => '#'), remarks: english.map(() => ''),
      translations: { English: english, Thai: thai },
      isMissing: false, isDNT: false, hasChanges: false, needsReview: false };
  });
  button('Bootstrap translator ' + account.toUpperCase(), async () => {
    const vm = await ready();
    status.textContent = 'Preparing disposable account and source…';
    const response = await fetch('/fixture/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fixture-Key': secret }, body: '{}' });
    if (!response.ok) throw new Error('Fixture session refused');
    vm._cloudApplying = true;
    try {
      vm.lang = 'Thai'; vm.theme = account === 'a' ? 'grey' : 'dark';
      await vm.$nextTick();
      await vm._cloud.selectLanguage('Thai', vm.cloudPayload(), vm._cloud.state.profiles[vm._cloud.state.activeProfile].settings.lang);
    } finally { vm._cloudApplying = false; }
    await vm.saveSettings();
    await vm._cloud.acceptLogin(await response.json());
    await vm.cloudApply(vm._cloud.snapshot());
    if (vm.lang !== 'Thai') await vm.cloudSelectLanguage('Thai', vm.lang);
    const source = JSON.parse(JSON.stringify(seed));
    const zip = new JSZip();
    for (const desc of source) zip.file(desc.filepath, descEncode(desc), { date: new Date('2026-10-05T00:00:00Z'), createFolders: false });
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const archive = await CollaborationProtocol.finalizeArchive({ version: 2, zipHash: await CollaborationProtocol.zipHash(bytes),
      zipSize: bytes.byteLength, fileCount: source.length, descriptionCount: source.length, parserVersion: 1, decisions: [] });
    const baseline = { archive, source, rawSource: JSON.parse(JSON.stringify(source)) };
    const scope = { accountId: String(vm.cloudUser.id), game: 'poe1', branchId: 'default', sourceHash: archive.baselineId };
    const workspace = { ...scope, descs: JSON.parse(JSON.stringify(seed)), status: {}, lastModified: 0, size: bytes.byteLength,
      sourceHash: archive.baselineId, importArchive: archive };
    await OfflineStore.saveSourceWorkspaceWithRevisions(source, workspace, [], scope, baseline);
    await OfflineStore.setMigratedFromSingleVersion(true);
    vm.showSetting = false; vm.needsInitialSettings = false;
    await openFixtureSource(vm, scope);
    if (settings.dictionaryCount) {
      vm.dictionary = Array.from({ length: settings.dictionaryCount }, (_, index) => ({ _id: 'fixture-dictionary-' + index, find: 'Fixture term ' + index, replace: 'คำทดสอบ ' + index }));
      await vm.saveSettings();
    }
    instrument(vm);
    status.textContent = 'Translator ' + account.toUpperCase() + ' ready · ' + settings.fileCount + ' files · ' + settings.entriesPerFile + ' entries/file · ' + settings.dictionaryCount + ' dictionary entries · real API + WebSocket.';
  });
  const offlineButton = button('Simulate offline', async () => {
    const vm = await ready();
    offline = !offline;
    if (offline) {
      originalFetcher = vm._cloud.fetcher;
      vm._cloud.fetcher = async () => { throw new TypeError('Fixture: network offline'); };
      vm._collaboration?.closeSocket();
      offlineButton.textContent = 'Restore connection';
      status.textContent = 'Fixture network disabled. Editor Save still writes to IndexedDB.';
    } else {
      vm._cloud.fetcher = originalFetcher;
      offlineButton.textContent = 'Simulate offline';
      await vm.collabRetry();
      status.textContent = 'Fixture network restored. Pending saves are retrying.';
    }
  });
  button('Switch theme', async () => {
    const vm = await ready(); vm.theme = vm.theme === 'grey' ? 'dark' : 'grey';
    status.textContent = 'Theme: ' + vm.theme;
  });
  button('Check idle sync', async () => {
    const vm = await ready();
    await vm._cloud.sync();
    const counts = { storageWrites: 0, dictionaryMerges: 0, dictionaryDownloads: 0, fullFileSnapshots: 0 };
    const restores = [];
    const wrap = (owner, key, observe) => {
      const original = owner[key];
      owner[key] = function (...args) { observe(args); return original.apply(this, args); };
      restores.push(() => { owner[key] = original; });
    };
    wrap(OfflineStore, 'updateHybridState', () => counts.storageWrites++);
    wrap(DictionarySync, 'merge', () => counts.dictionaryMerges++);
    wrap(vm._cloud, 'request', args => { if (args[0].startsWith('/v1/dictionaries/')) counts.dictionaryDownloads++; });
    if (vm._collaboration) wrap(vm._collaboration, 'snapshot', args => { if (args[0]?.includeFiles !== false) counts.fullFileSnapshots++; });
    try { await vm._cloud.sync(); await vm.collabRetry(); }
    finally { for (const restore of restores.reverse()) restore(); }
    timing.textContent = 'Unchanged sync checks\n' + Object.entries(counts).map(([key, value]) => key + ': ' + value).join('\n');
    status.textContent = 'Checks finished. Idle data should require no writes, merges, downloads or full file copies.';
  });
  button('Update shared Dictionary', async () => {
    const vm = await ready(), language = vm.cloudUser.language;
    const remote = await vm._cloud.request('/v1/dictionaries/' + encodeURIComponent(language));
    const entry = { _id: 'fixture-push-term', find: 'Push fixture term', replace: 'แจ้งจากทีม ' + Date.now(), alts: [], tlnote: '' };
    await vm._cloud.request('/v1/dictionaries/' + encodeURIComponent(language), { method: 'PATCH', body: { baseRevision: remote.revision,
      mutationId: crypto.randomUUID(), upserts: [entry], deletedIds: [] } });
    status.textContent = 'Shared Dictionary changed. Both translators should receive it through the account socket.';
  });
  let releaseTranslationUpload;
  button('Hold next translation upload', async () => {
    const vm = await ready();
    if (releaseTranslationUpload) return;
    const fetcher = vm._cloud.fetcher;
    const held = new Promise(resolve => { releaseTranslationUpload = resolve; });
    vm._cloud.fetcher = async (url, options) => {
      if (options?.method === 'POST' && new URL(url).pathname.endsWith('/mutations')) {
        vm._cloud.fetcher = fetcher;
        status.textContent = 'Translation upload held. Inspect the status bar spinner, then release the upload.';
        await held;
      }
      return fetcher(url, options);
    };
    status.textContent = 'The next translation upload will wait. Open a file, edit, and Save.';
  });
  button('Release translation upload', async () => {
    releaseTranslationUpload?.(); releaseTranslationUpload = null;
    status.textContent = 'Translation upload released.';
  });
  button('Preview work indicator', async () => {
    const vm = await ready();
    vm.setBrowserWork('fixture', { key: 'preview', label: 'Preparing collaboration data (fixture preview)', active: true, immediate: true });
    setTimeout(() => vm.clearBrowserWork('fixture'), 15000);
    status.textContent = 'Work indicator preview lasts 15 seconds. Hover or focus its spinner for details.';
  });
  button('Measure saves', async () => { instrument(await ready()); status.textContent = 'Save timing enabled for the current workspace.'; });
  let dictionaryMeasurement;
  button('Measure Dictionary edits', async () => {
    const vm = await ready(); await vm.saveSettings(); await vm._cloud.sync();
    const requests = [], start = performance.now();
    const fetcher = vm._cloud.fetcher; let delayNext = true, uploadDelayed = false, typingDuringUpload = false;
    const recordTyping = event => { if (uploadDelayed && event.target.closest?.('[data-dict-id]')) typingDuringUpload = true; };
    document.addEventListener('input', recordTyping);
    vm._cloud.fetcher = async (url, options) => {
      const isDictionary = new URL(url).pathname.startsWith('/v1/dictionaries/');
      const body = options?.body ? JSON.parse(options.body) : null;
      if (isDictionary && options?.method === 'PATCH' && delayNext) {
        delayNext = false;
        uploadDelayed = true;
        status.textContent = 'Dictionary upload delayed for 3 seconds. Adding and typing should stay available.';
        await new Promise(resolve => setTimeout(resolve, 3000));
        uploadDelayed = false;
      }
      const response = await fetcher(url, options);
      if (isDictionary) {
        const data = await response.clone().json();
        requests.push({ method: options?.method || 'GET', requestBytes: new TextEncoder().encode(options?.body || '').length,
          responseBytes: new TextEncoder().encode(JSON.stringify(data)).length,
          upserts: body?.upserts?.length || 0, deletedIds: body?.deletedIds?.length || 0,
          fullResponse: Array.isArray(data.entries) });
      }
      return response;
    };
    dictionaryMeasurement = { vm, fetcher, requests, start, recordTyping, didTypeDuringUpload: () => typingDuringUpload };
    status.textContent = 'Dictionary measurement started. The next upload waits 3 seconds; edit normally.';
  });
  button('Finish Dictionary check', async () => {
    if (!dictionaryMeasurement) return;
    const { vm, fetcher, requests, start, recordTyping, didTypeDuringUpload } = dictionaryMeasurement;
    await vm.saveSettings(); await vm._cloud.sync();
    vm._cloud.fetcher = fetcher; dictionaryMeasurement = null;
    document.removeEventListener('input', recordTyping);
    timing.textContent = 'Dictionary checks\n' + JSON.stringify({ requests, localPending: vm.pendingSettingsSaves,
      typingDuringUpload: didTypeDuringUpload(), elapsedMs: Math.round(performance.now() - start) }, null, 2);
    status.textContent = 'Dictionary measurement completed. Requests contain no credentials or dictionary text.';
  });
  const savedRepairKey = 'sdeditor-fixture-sd-validation-v2';
  const assertRepair = (condition, message) => { if (!condition) throw new Error('FAIL: ' + message); };
  const settleRepair = async (vm, expectedSaved, filepath) => {
    for (let index = 0; index < 160; index++) {
      if (vm._collaboration?.room()) await vm._collaboration.retry();
      if (vm._collaboration?.room()?.initialized && vm._collaboration.snapshot({ includeFiles: false }).pending === 0
        && vm.descs.some(desc => desc.filepath === filepath)) {
        vm.filterDesc(); await vm.$nextTick();
        if (vm.statistic.hasChanges === expectedSaved) return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('FAIL: expected Saved ' + expectedSaved + ', found ' + vm.statistic.hasChanges);
  };
  button('Check SD save validation', async () => {
    const vm = await ready();
    assertRepair(vm.cloudSignedIn && vm.cloudUser?.id, 'Bootstrap this translator before checking validation.');
    assertRepair(['127.0.0.1', 'localhost'].includes(new URL(vm._cloud.apiBase).hostname), 'Fixture API must use loopback.');
    assertRepair(!offline, 'Restore the fixture connection first.');
    if (vm._pendingSaves?.snapshot().jobs.length) assertRepair(await vm.waitForPendingSaves(), 'Existing local saves must finish.');
    const details = [], slug = crypto.randomUUID(), prefix = 'fixture_validation_' + slug;
    status.textContent = 'Checking retained invalid stages and rejected new blank saves...';
    vm.resetVersionedState(); clearTimeout(vm._collabStartTimer);
    const source = ['ordinary', 'dnt', 'complete'].map(kind => ({
      filepath: prefix + '/' + kind + '.txt', filedir: prefix, filename: kind + '.txt', name: '', stats: [prefix + '_' + kind],
      variables: ['#'], remarks: [''], translations: { English: [(kind === 'dnt' ? '[DNT] ' : '') + 'Fixture validation ' + kind + ' ' + slug],
        ...(kind === 'complete' ? { Thai: ['Fixture original translation'] } : {}) }, isDNT: kind === 'dnt',
    }));
    const zip = new JSZip();
    for (const desc of source) zip.file(desc.filepath, descEncode(desc), { date: new Date('2026-10-05T00:00:00Z'), createFolders: false });
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const archive = await CollaborationProtocol.finalizeArchive({ version: 2, zipHash: await CollaborationProtocol.zipHash(bytes),
      zipSize: bytes.byteLength, fileCount: source.length, descriptionCount: source.length, parserVersion: 1, decisions: [] });
    const baseline = { archive, source, rawSource: JSON.parse(JSON.stringify(source)) };
    await vm._cloud.request('/v1/collaboration/archives/resolve', { method: 'POST', body: { game: 'poe1', archive } });
    const joined = await vm._cloud.request('/v1/collaboration/join', { method: 'POST', body: { game: 'poe1', language: 'Thai', sourceHash: archive.baselineId, archive } });
    const invalidFiles = source.slice(0, 2).map(desc => ({ filepath: desc.filepath, baseRevision: 0, translations: [''],
      trackedForExport: true, needsReview: false, baseline: CollaborationProtocol.witness(desc) }));
    const mixedBatch = [{ filepath: source[2].filepath, baseRevision: 0, translations: ['Complete proposed text'],
      trackedForExport: true, needsReview: false, baseline: CollaborationProtocol.witness(source[2]) }, invalidFiles[0]];
    let apiError;
    try { await vm._cloud.request('/v1/collaboration/rooms/' + encodeURIComponent(joined.roomId) + '/mutations',
      { method: 'POST', body: { mutationId: crypto.randomUUID(), origin: 'save', files: mixedBatch } }); } catch (error) { apiError = error; }
    assertRepair(apiError?.code === 'SD_TRANSLATION_INVALID', 'The real API must reject new incomplete SD mutations.');
    const rejectedSnapshot = await vm._cloud.request('/v1/collaboration/rooms/' + encodeURIComponent(joined.roomId) + '/snapshot');
    assertRepair(rejectedSnapshot.files.length === 0, 'The rejected batch must not partially stage either file.');
    details.push('PASS: real API rejects the whole mixed complete/blank batch without staged files.');
    const scope = { accountId: String(vm.cloudUser.id), game: 'poe1', branchId: 'default', sourceHash: archive.baselineId };
    const workspace = { ...scope, stagedVersion: 1, statusMetadataVersion: 1, languageStatusVersion: 1,
      sourceBaseline: { sourceHash: archive.baselineId }, importArchive: archive, collaborationAccountId: scope.accountId,
      descs: JSON.parse(JSON.stringify(source)), status: {}, staged: { Thai: {} } };
    // Synthetic pre-policy evidence only; normal authored saves must reject it.
    for (const file of invalidFiles) workspace.staged.Thai[file.filepath] = {
      sourceHash: archive.baselineId, translations: [''], before: [], savedAt: Date.now(), saveOrigin: 'save',
    };
    const revisions = invalidFiles.map(file => ({ filepath: file.filepath, lang: 'Thai', sourceHash: archive.baselineId,
      translations: [''], savedAt: Date.now(), note: 'Historical pre-policy blank save' }));
    await OfflineStore.saveSourceWorkspaceWithRevisions(source, workspace, revisions, scope, baseline);
    await OfflineStore.setMigratedFromSingleVersion(true);
    vm.hideDNT = false; vm.searchText = ''; vm.showSetting = false; vm.needsInitialSettings = false;
    await openFixtureSource(vm, scope);
    await settleRepair(vm, 0, source[0].filepath);
    const durable = await OfflineStore.getVersionWorkspace(scope, 'Thai'), recovery = Object.values(durable.invalidTranslationArchive || {});
    assertRepair(invalidFiles.every(file => !durable.staged.Thai?.[file.filepath]), 'Incomplete retained stages cannot remain Saved work.');
    assertRepair(invalidFiles.every(file => recovery.some(record => record.filepath === file.filepath && record.stage.translations[0] === '')),
      'Both exact pre-policy stages must remain recoverable.');
    const history = await OfflineStore.listRevisions(source[0].filepath, 'Thai', 50, scope);
    assertRepair(history.some(row => row.note === revisions[0].note && row.translations[0] === ''), 'Immutable historical blank text remains retained.');
    details.push('PASS: invalid stages are quarantined; exact recovery and history remain.');
    const ordinary = vm.descs.find(desc => desc.filepath === source[0].filepath);
    let blankError;
    try { await vm.persistTranslationBatch([{ desc: ordinary, lines: [''] }], 'save'); } catch (error) { blankError = error; }
    assertRepair(blankError?.code === 'SD_TRANSLATION_INVALID', 'The real browser save command must reject a new blank.');
    assertRepair(JSON.stringify(await OfflineStore.listRevisions(ordinary.filepath, 'Thai', 50, scope)) === JSON.stringify(history), 'Rejected Save cannot append history.');
    assertRepair(vm.pendingLocalSaves === 0 && !WorkspaceState.workspaceFile(await OfflineStore.getVersionWorkspace(scope, 'Thai'), source[0], 'Thai').hasChanges,
      'Rejected Save cannot stage text or queue an upload.');
    details.push('PASS: browser blank Save leaves staging, history and pending uploads unchanged.');
    const target = 'Complete authored fixture translation';
    await vm.persistTranslationBatch([{ desc: ordinary, lines: [target] }], 'save');
    assertRepair(await vm.waitForPendingSaves(), 'The complete correction must reach durable storage.');
    await settleRepair(vm, 1, ordinary.filepath);
    const accepted = await vm._cloud.request('/v1/collaboration/rooms/' + encodeURIComponent(joined.roomId) + '/snapshot');
    assertRepair(accepted.files.length === 1 && accepted.files[0].translations[0] === target, 'Only the complete correction reaches the real API.');
    details.push('PASS: complete correction is Saved locally and shared.');
    sessionStorage.setItem(savedRepairKey, JSON.stringify({ details, filepath: ordinary.filepath, dntPath: source[1].filepath,
      sourceHash: archive.baselineId, scope, target, recoveryId: recovery.find(record => record.filepath === source[1].filepath).id }));
    status.textContent = 'Reloading to verify Saved work and retained invalid evidence...'; location.reload();
  });
  document.body.append(panel);
  const pendingRepairCheck = sessionStorage.getItem(savedRepairKey);
  if (pendingRepairCheck) {
    (async () => {
      const check = JSON.parse(pendingRepairCheck); sessionStorage.removeItem(savedRepairKey);
      const vm = await ready(); vm.hideDNT = false;
      await openFixtureSource(vm, check.scope);
      await settleRepair(vm, 1, check.filepath);
      const durable = await OfflineStore.getVersionWorkspace(check.scope, 'Thai');
      assertRepair(vm.sourceIdentity === check.sourceHash, 'Reload must retain the accepted source identity.');
      assertRepair(durable.staged.Thai?.[check.filepath]?.translations[0] === check.target && !durable.staged.Thai?.[check.dntPath],
        'Reload keeps the complete Save and excludes the invalid DNT stage.');
      assertRepair(durable.invalidTranslationArchive[check.recoveryId].stage.translations[0] === '', 'Reload preserves the exact invalid recovery copy.');
      check.details.push('PASS: reload retains the complete Save, source identity and quarantined recovery.');
      timing.textContent = check.details.join('\n'); panel.dataset.validation = 'passed';
      status.textContent = 'PASS: SD save validation and recovery verified with real IndexedDB and API.';
    })().catch(error => { panel.dataset.validation = 'failed'; status.textContent = error.message; timing.textContent += '\nFAIL: ' + error.message; });
  }
}

(async () => {
  const checking = process.argv.includes('--check-sd-validation');
  const vuePath = process.env.FIXTURE_VUE_PATH || resolve(__dirname, '../temp/clienttext-fixture-vue.min.js');
  if (checking) assert.ok(existsSync(vuePath), 'Set FIXTURE_VUE_PATH to a cached Vue 3 browser build.');
  const apiRoot = resolve(__dirname, '../../SDEditor-API');
  const fromApi = createRequire(resolve(apiRoot, 'package.json'));
  const express = fromApi('express');
  const load = name => import(pathToFileURL(resolve(apiRoot, 'src', name)).href);
  const { loadConfig } = await load('config.js');
  const { openDatabase, CloudStore } = await load('database.js');
  const { createApp } = await load('app.js');
  let ports = [Number(process.env.FIXTURE_A_PORT || 34201), Number(process.env.FIXTURE_B_PORT || 34202)];
  let apiPort = Number(process.env.FIXTURE_API_PORT || 34203);
  if (checking) {
    const reservations = Array.from({ length: 3 }, () => createServer());
    await Promise.all(reservations.map(server => new Promise(done => server.listen(0, '127.0.0.1', done))));
    [ports[0], ports[1], apiPort] = reservations.map(server => server.address().port);
    await Promise.all(reservations.map(server => new Promise(done => server.close(done))));
  }
  const boundedNumber = (name, fallback, max) => Math.min(max, Math.max(1, Number(process.env[name]) || fallback));
  const fixtureSettings = { fileCount: boundedNumber('FIXTURE_FILE_COUNT', 25, 10000),
    entriesPerFile: boundedNumber('FIXTURE_ENTRIES_PER_FILE', 2, 100),
    dictionaryCount: Math.min(10000, Math.max(0, Number(process.env.FIXTURE_DICTIONARY_COUNT) || 0)) };
  const origins = ports.map(port => `http://127.0.0.1:${port}`);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const directory = mkdtempSync(resolve(__dirname, '../temp/sdeditor-collaboration-'));
  const config = loadConfig({ FRONTEND_ORIGIN: origins[0], ALLOWED_ORIGINS: origins[1], API_PUBLIC_URL: apiOrigin,
    ADMIN_EMAIL: 'admin@example.test', DATABASE_PATH: ':memory:', DATA_DIR: directory });
  const database = openDatabase(':memory:');
  const store = new CloudStore(database, config);
  store.registerIdentity({ sub: 'fixture-admin', email: 'admin@example.test', name: 'Fixture Administrator' });
  for (const account of ['a', 'b']) {
    store.registerIdentity({ sub: 'fixture-' + account, email: account + '@example.test', name: 'Translator ' + account.toUpperCase() });
    store.assignLanguage('fixture-admin', 'fixture-' + account, 'Thai');
  }
  const api = createApp({ config, database, store, oauthProvider: null });
  const apiServer = createServer(api);
  api.locals.collaborationRealtime.attach(apiServer);
  const frontendServers = [];
  for (let index = 0; index < ports.length; index++) {
    const account = ['a', 'b'][index], secret = randomUUID(), frontend = express();
    frontend.use((req, res, next) => {
      res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      next();
    });
    if (checking) {
      frontend.get('/fixture/vue.js', (_req, res) => res.type('js').send(readFileSync(vuePath)));
      frontend.get('/fixture/jszip.js', (_req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
    }
    frontend.post('/fixture/session', (req, res) => {
      if (req.get('X-Fixture-Key') !== secret || req.get('Origin') !== origins[index]) return res.status(403).json({ error: 'Fixture request refused' });
      res.json(store.createSession('fixture-' + account));
    });
    frontend.get('/', (req, res) => {
      let html = readFileSync(resolve(__dirname, '../public/index.html'), 'utf8');
      if (checking) html = html.replace('https://cdnjs.cloudflare.com/ajax/libs/vue/3.0.11/vue.global.prod.js', '/fixture/vue.js')
        .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.js')
        .replace(/<script src="https:\/\/cdnjs.cloudflare.com\/ajax\/libs\/jsdiff\/[^\"]+"><\/script>/, '<!-- Optional diff rendering is outside the SD validation fixture. -->');
      const script = '<script>(' + browserControls.toString() + ')(' + JSON.stringify(account) + ',' + JSON.stringify(secret) + ',' + JSON.stringify(fixtureSettings) + ');</script>';
      res.type('html').send(html.replace('</body>', script + '</body>'));
    });
    frontend.get('/index.js', (req, res) => {
      const source = readFileSync(resolve(__dirname, '../public/index.js'), 'utf8');
      res.type('js').send(source.replace("app.mount('#app');", "window.__collaborationFixtureApp = app.mount('#app');"));
    });
    frontend.use(express.static(resolve(__dirname, '../public')));
    frontendServers.push(createServer(frontend));
  }
  const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await Promise.all([listen(apiServer, apiPort), ...frontendServers.map((server, index) => listen(server, ports[index]))]);
  if (!checking) {
    console.log('Translator A: ' + origins[0] + '/?cloudApi=' + encodeURIComponent(apiOrigin));
    console.log('Translator B: ' + origins[1] + '/?cloudApi=' + encodeURIComponent(apiOrigin));
    console.log('Click each visible Bootstrap translator button. Isolated browser storage; disposable in-memory API.');
  }
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await api.locals.collaborationRealtime.close();
    await Promise.all([...frontendServers, apiServer].map(server => new Promise(resolve => server.close(resolve))));
    database.close();
    const tempRoot = resolve(__dirname, '../temp');
    assert.ok(directory.startsWith(tempRoot + sep) && directory !== tempRoot);
    rmSync(directory, { recursive: true, force: true });
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  if (checking) {
    let browser;
    try {
      const modules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
      const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [modules] }));
      const executablePath = process.env.FIXTURE_BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
      assert.ok(executablePath, 'Set FIXTURE_BROWSER_PATH to an installed Edge or Chrome browser.');
      browser = await chromium.launch({ headless: true, executablePath });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto(origins[0] + '/?cloudApi=' + encodeURIComponent(apiOrigin));
      await page.getByRole('button', { name: 'Bootstrap translator A', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#collaboration-fixture-controls [role="status"]')?.textContent.startsWith('Translator A ready')
        || document.querySelector('#collaboration-fixture-controls')?.dataset.error);
      assert.equal(await page.locator('#collaboration-fixture-controls').getAttribute('data-error'), null);
      const rendered = await page.evaluate(async () => {
        const vm = window.__collaborationFixtureApp;
        vm.collabReceiveState({ ...vm.collaborationState, connected: true,
          peers: [{ userId: 'render-only-peer', sessionId: 'render-only-session', name: 'Fixture peer', color: '#123456', away: true }] });
        await vm.$nextTick();
        const wrapper = document.querySelector('.collaborationAvatars'), pagination = document.querySelector('[aria-label="File pagination"]'),
          avatar = wrapper?.querySelector('.collaborationAvatar');
        return { catalog: !!window.EditorReferenceCatalog, session: !!window.EditorSession,
          wrapper: !!wrapper, pagination: !!pagination, precedes: !!(wrapper?.compareDocumentPosition(pagination) & Node.DOCUMENT_POSITION_FOLLOWING),
          label: avatar?.getAttribute('aria-label'), border: avatar && getComputedStyle(avatar).borderColor,
          filter: avatar && getComputedStyle(avatar.querySelector('.collaborationAvatarFace')).filter };
      });
      assert.equal(rendered.catalog, true); assert.equal(rendered.session, true);
      assert.equal(rendered.wrapper, true, JSON.stringify(rendered)); assert.equal(rendered.pagination, true); assert.equal(rendered.precedes, true);
      assert.match(rendered.label, /Fixture peer.*Away/); assert.equal(rendered.border, 'rgb(18, 52, 86)'); assert.match(rendered.filter, /grayscale\(1\)/);
      await page.getByRole('button', { name: 'Check SD save validation', exact: true }).click();
      await page.waitForFunction(() => ['passed', 'failed'].includes(document.querySelector('#collaboration-fixture-controls')?.dataset.validation)
        || document.querySelector('#collaboration-fixture-controls')?.dataset.error, null, { timeout: 45000 });
      const result = await page.locator('#collaboration-fixture-controls').evaluate(panel => ({ state: panel.dataset.validation,
        error: panel.dataset.error, status: panel.querySelector('[role="status"]').textContent, details: panel.querySelector('pre').textContent }));
      assert.equal(result.state, 'passed', JSON.stringify(result)); assert.deepEqual(errors, []);
      console.log(JSON.stringify({ pass: true, rendered, ...result }));
    } finally { await browser?.close(); await stop(); }
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
