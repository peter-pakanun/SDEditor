// Disposable loopback acceptance fixture. It never runs in the production server.
// Two editor origins isolate browser storage; both connect to the real API and WS server.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFileSync } = require('node:fs');
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
    control.onclick = async () => { control.disabled = true; try { await action(); } catch (error) { status.textContent = error.message; } finally { control.disabled = false; } };
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
    const tree = await CollaborationProtocol.buildBaselineTree(source);
    const archive = await CollaborationProtocol.finalizeArchive({ version: 1, zipHash: await CollaborationProtocol.zipHash(bytes),
      zipSize: bytes.byteLength, fileCount: source.length, descriptionCount: source.length, parserVersion: 1, decisions: [], treeRoot: tree.root });
    const baseline = { archive, source, rawSource: JSON.parse(JSON.stringify(source)), tree };
    const workspace = { descs: JSON.parse(JSON.stringify(seed)), status: {}, lastModified: 0, size: bytes.byteLength,
      sourceHash: archive.baselineId, importArchive: archive };
    await OfflineStore.saveSourceWorkspaceWithRevisions(source, workspace, [], 'poe1', baseline);
    await OfflineStore.setMigratedFromSingleVersion(true);
    vm.showSetting = false; vm.needsInitialSettings = false;
    await vm.activateGameVersion('poe1', { checkMigration: false });
    await vm.$nextTick();
    await vm.initializeCollaboration();
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
  const savedRepairKey = 'sdeditor-fixture-saved-status-repair';
  const assertRepair = (condition, message) => { if (!condition) throw new Error('FAIL: ' + message); };
  const settleRepair = async (vm, expectedSaved, filepath) => {
    for (let index = 0; index < 160; index++) {
      if (vm._collaboration?.room()) await vm._collaboration.retry();
      const client = vm._collaboration;
      if (client?.room()?.initialized && client.snapshot({ includeFiles: false }).pending === 0
        && vm.descs.some(desc => desc.filepath === filepath)) {
        vm.filterDesc(); await vm.$nextTick();
        if (vm.statistic.hasChanges === expectedSaved) return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('FAIL: expected Saved ' + expectedSaved + ', found ' + vm.statistic.hasChanges
      + '; pending ' + (vm._collaboration?.snapshot({ includeFiles: false }).pending ?? 'unavailable'));
  };
  button('Check saved status repair', async () => {
    const vm = await ready();
    assertRepair(vm.cloudSignedIn && vm.cloudUser?.id, 'Bootstrap this translator before checking repair.');
    assertRepair(['127.0.0.1', 'localhost'].includes(new URL(vm._cloud.apiBase).hostname), 'Fixture API must use loopback.');
    assertRepair(!offline, 'Restore the fixture connection first.');
    if (vm._pendingSaves?.snapshot().jobs.length) assertRepair(await vm.waitForPendingSaves(), 'Existing local saves must finish.');
    const details = [], slug = crypto.randomUUID(), prefix = 'fixture_repair_' + slug;
    status.textContent = 'Recreating the old Saved placeholder bug in real browser storage…';
    timing.textContent = 'Running Saved status repair checks…';
    vm.resetVersionedState(); clearTimeout(vm._collabStartTimer);
    const source = ['ordinary', 'dnt', 'complete'].map((kind, index) => ({
      filepath: prefix + '/' + kind + '.txt', filedir: prefix, filename: kind + '.txt', name: '', stats: [prefix + '_' + kind],
      variables: ['#'], remarks: [''], translations: { English: [(kind === 'dnt' ? '[DNT] ' : '') + 'Fixture repair ' + kind + ' ' + slug],
        ...(kind === 'complete' ? { Thai: ['คำแปลทดสอบ'] } : {}) }, isDNT: kind === 'dnt',
    }));
    const zip = new JSZip();
    for (const desc of source) zip.file(desc.filepath, descEncode(desc), { date: new Date('2026-10-05T00:00:00Z'), createFolders: false });
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const tree = await CollaborationProtocol.buildBaselineTree(source);
    const archive = await CollaborationProtocol.finalizeArchive({ version: 1, zipHash: await CollaborationProtocol.zipHash(bytes),
      zipSize: bytes.byteLength, fileCount: source.length, descriptionCount: source.length, parserVersion: 1, decisions: [], treeRoot: tree.root });
    const baseline = { archive, source, rawSource: JSON.parse(JSON.stringify(source)), tree };
    await vm._cloud.request('/v1/collaboration/archives/resolve', { method: 'POST', body: { game: 'poe1', archive } });
    const joined = await vm._cloud.request('/v1/collaboration/join', { method: 'POST', body: { game: 'poe1', language: 'Thai', sourceHash: archive.baselineId, archive } });
    const ghostFiles = source.slice(0, 2).map(desc => ({ filepath: desc.filepath, baseRevision: 0, translations: [''],
      trackedForExport: true, needsReview: false, baseline: CollaborationProtocol.witness(desc), proof: CollaborationProtocol.baselineProof(tree, desc.filepath) }));
    const accepted = await vm._cloud.request('/v1/collaboration/rooms/' + encodeURIComponent(joined.roomId) + '/mutations',
      { method: 'POST', body: { mutationId: crypto.randomUUID(), origin: 'merge', files: ghostFiles } });
    assertRepair(accepted.files.length === 2 && accepted.files.every(file => file.revision === 1 && file.trackedForExport), 'Both accidental first merges must be acknowledged.');
    const workspace = { stagedVersion: 1, statusMetadataVersion: 1, languageStatusVersion: 1, game: 'poe1', sourceHash: archive.baselineId,
      sourceBaseline: { sourceHash: archive.baselineId }, importArchive: archive, collaborationAccountId: String(vm.cloudUser.id),
      descs: source.map(desc => ({ ...JSON.parse(JSON.stringify(desc)), translations: { ...JSON.parse(JSON.stringify(desc.translations)),
        Thai: desc.translations.Thai || [''] } })), status: {}, staged: { Thai: {} } };
    for (const file of ghostFiles) workspace.staged.Thai[file.filepath] = { sourceHash: archive.baselineId, translations: [''], before: [], savedAt: Date.now() };
    const identity = { accountId: String(vm.cloudUser.id), game: 'poe1', sourceHash: archive.baselineId, language: 'Thai' };
    const shared = Object.fromEntries(accepted.files.map(file => [file.filepath, JSON.parse(JSON.stringify(file))]));
    const recovery = ghostFiles.map(file => ({ id: crypto.randomUUID(), at: Date.now(), reason: 'Local edited translation before joining',
      files: [{ filepath: file.filepath, translations: [''], needsReview: false, trackedForExport: true }] }));
    const room = { mode: 'sparse', identity, archive, manifest: { version: 2, files: source.map(desc => ({ filepath: desc.filepath, entryCount: 1 })) },
      roomId: joined.roomId, sequence: accepted.sequence, shared, local: JSON.parse(JSON.stringify(shared)), outbox: [], conflicts: [], recovery,
      carries: {}, carryRevisions: {}, initialized: true };
    await OfflineStore.saveSourceWorkspaceWithRevisions(source, workspace, [], 'poe1', baseline);
    await OfflineStore.updateCollaborationState(state => {
      state ||= { version: 1, rooms: {} }; state.rooms[CollaborationProtocol.scopeKey(identity)] = room; return state;
    }, { version: 'poe1' });
    await OfflineStore.setMigratedFromSingleVersion(true);
    assertRepair(source.slice(0, 2).every(desc => WorkspaceState.workspaceFile(workspace, desc, 'Thai').hasChanges), 'The seeded v1 workspace reproduces two false Saved records.');
    details.push('PASS: old v1 workspace and real API contain 2 accidental Saved blanks.');
    vm.hideDNT = false; vm.searchText = ''; vm.showSetting = false; vm.needsInitialSettings = false;
    await vm.activateGameVersion('poe1', { checkMigration: false }); await vm.initializeCollaboration();
    await settleRepair(vm, 0, source[0].filepath);
    const durable = await OfflineStore.getWorkspace('poe1', 'Thai');
    const snapshot = await vm._cloud.request('/v1/collaboration/rooms/' + encodeURIComponent(joined.roomId) + '/snapshot');
    assertRepair(source.slice(0, 2).every(desc => !WorkspaceState.workspaceFile(durable, desc, 'Thai').hasChanges), 'Durable placeholder staging must be removed.');
    assertRepair(snapshot.files.filter(file => ghostFiles.some(ghost => ghost.filepath === file.filepath))
      .every(file => file.revision === 2 && file.stagingReset && !file.trackedForExport), 'The API must publish revision-checked resets.');
    assertRepair(Object.values(durable.placeholderRepairArchive || {}).filter(record => record.status === 'repaired').length === 2, 'Both recovery archives must be retained.');
    details.push('PASS: normal app load repairs local staging and real API records.');
    details.push('Counters after repair: Saved ' + vm.statistic.hasChanges + ', Revised ' + vm.statistic.isRevised + ', Missing ' + vm.statistic.isMissing + '.');
    const ordinary = vm.descs.find(desc => desc.filepath === source[0].filepath);
    await vm.persistTranslationBatch([{ desc: ordinary, lines: [''] }], 'save');
    assertRepair(await vm.waitForPendingSaves(), 'The deliberate blank must reach durable storage.');
    await settleRepair(vm, 1, source[0].filepath);
    const blank = await OfflineStore.getWorkspace('poe1', 'Thai');
    assertRepair(WorkspaceState.workspaceFile(blank, source[0], 'Thai').hasChanges, 'An intentional blank save must remain Saved.');
    assertRepair(blank.staged.Thai[source[0].filepath].saveOrigin === 'save', 'Authored provenance must persist.');
    details.push('PASS: deliberate blank through the normal Save pipeline is Saved.');
    sessionStorage.setItem(savedRepairKey, JSON.stringify({ phase: 'reload', details, filepath: source[0].filepath, dntPath: source[1].filepath, sourceHash: archive.baselineId }));
    status.textContent = 'Local/API checks passed. Reloading to verify the deliberate blank and repaired DNT file…';
    timing.textContent = details.join('\n');
    location.reload();
  });
  document.body.append(panel);
  const pendingRepairCheck = sessionStorage.getItem(savedRepairKey);
  if (pendingRepairCheck) {
    (async () => {
      const check = JSON.parse(pendingRepairCheck);
      sessionStorage.removeItem(savedRepairKey);
      if (check.phase !== 'reload') return;
      const vm = await ready(); vm.hideDNT = false;
      await vm.activateGameVersion('poe1', { checkMigration: false }); await vm.initializeCollaboration();
      await settleRepair(vm, 1, check.filepath);
      const durable = await OfflineStore.getWorkspace('poe1', 'Thai');
      assertRepair(vm.sourceIdentity === check.sourceHash, 'Reload must retain the accepted source identity.');
      assertRepair(!!durable.staged.Thai?.[check.filepath] && !durable.staged.Thai?.[check.dntPath], 'Reload must keep the intentional blank and exclude the repaired DNT placeholder.');
      check.details.push('PASS: full browser reload retains Saved 1; repaired DNT remains unsaved.');
      check.details.push('Final counters: Saved ' + vm.statistic.hasChanges + ', Revised ' + vm.statistic.isRevised + ', Missing ' + vm.statistic.isMissing + '.');
      timing.textContent = check.details.join('\n');
      status.textContent = 'PASS · saved status repair, intentional blank Save, and reload verified with real IndexedDB + API.';
    })().catch(error => { status.textContent = error.message; timing.textContent += '\nFAIL: ' + error.message; });
  }
}

(async () => {
  const apiRoot = resolve(__dirname, '../../SDEditor-API');
  const fromApi = createRequire(resolve(apiRoot, 'package.json'));
  const express = fromApi('express');
  const load = name => import(pathToFileURL(resolve(apiRoot, 'src', name)).href);
  const { loadConfig } = await load('config.js');
  const { openDatabase, CloudStore } = await load('database.js');
  const { createApp } = await load('app.js');
  const ports = [Number(process.env.FIXTURE_A_PORT || 34201), Number(process.env.FIXTURE_B_PORT || 34202)];
  const apiPort = Number(process.env.FIXTURE_API_PORT || 34203);
  const boundedNumber = (name, fallback, max) => Math.min(max, Math.max(1, Number(process.env[name]) || fallback));
  const fixtureSettings = { fileCount: boundedNumber('FIXTURE_FILE_COUNT', 25, 10000),
    entriesPerFile: boundedNumber('FIXTURE_ENTRIES_PER_FILE', 2, 100),
    dictionaryCount: Math.min(10000, Math.max(0, Number(process.env.FIXTURE_DICTIONARY_COUNT) || 0)) };
  const origins = ports.map(port => `http://127.0.0.1:${port}`);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const config = loadConfig({ FRONTEND_ORIGIN: origins[0], ALLOWED_ORIGINS: origins[1], API_PUBLIC_URL: apiOrigin, ADMIN_EMAIL: 'admin@example.test', DATABASE_PATH: ':memory:' });
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
    frontend.post('/fixture/session', (req, res) => {
      if (req.get('X-Fixture-Key') !== secret || req.get('Origin') !== origins[index]) return res.status(403).json({ error: 'Fixture request refused' });
      res.json(store.createSession('fixture-' + account));
    });
    frontend.get('/', (req, res) => {
      const html = readFileSync(resolve(__dirname, '../public/index.html'), 'utf8');
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
  console.log('Translator A: ' + origins[0] + '/?cloudApi=' + encodeURIComponent(apiOrigin));
  console.log('Translator B: ' + origins[1] + '/?cloudApi=' + encodeURIComponent(apiOrigin));
  console.log('Click each visible Bootstrap translator button. Isolated browser storage; disposable in-memory API.');
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await api.locals.collaborationRealtime.close();
    await Promise.all([...frontendServers, apiServer].map(server => new Promise(resolve => server.close(resolve))));
    database.close();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
