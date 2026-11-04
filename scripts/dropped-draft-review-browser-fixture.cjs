// Real IndexedDB, collaboration hydration and save-worker regression for the reported SDE1 loop.
// Set SDEDITOR_REPORTED_SOURCE_ZIP to verify the exact production entry without changing the ZIP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolve, join } = require('node:path');
const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const fromApi = createRequire(resolve(__dirname, '../../SDEditor-API/package.json'));
const JSZip = fromApi('jszip');
const Codec = require('../public/statDescCodec.js');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', {
  paths: ['C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'],
}));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(fs.existsSync);
const filepath = 'specific_skill_stat_descriptions/pestilent_volley/statset_0/active_skill_base_area_of_effect_radius.txt';
const language = 'Traditional Chinese';
const targets = ['額外[Poison|中毒]基礎範圍@{1:+d}公尺', '爆炸範圍為{0}公尺', '爆炸範圍為{0}公尺',
  ...Array.from({ length: 4 }, () => '爆炸半徑為{0}公尺，若其嵌入\\n了一名[Poison|中毒]的目標，則{1:+d}公尺')];

async function run() {
  let source;
  if (process.env.SDEDITOR_REPORTED_SOURCE_ZIP) {
    const original = await JSZip.loadAsync(fs.readFileSync(process.env.SDEDITOR_REPORTED_SOURCE_ZIP));
    assert.ok(original.file(filepath), 'Reported path exists in supplied source');
    source = Codec.parseText(filepath, Codec.decodeUTF16(await original.file(filepath).async('uint8array')), language);
  } else {
    const english = ['Additional [Poison|Poisoned] base radius@{1:+d}m', 'Explosion radius is {0} metre', 'Explosion radius is {0} metres',
      ...['metre, {1:+d} metre', 'metres, {1:+d} metre', 'metre, {1:+d} metres', 'metres, {1:+d} metres']
        .map(text => 'Explosion radius is {0} ' + text + ' if\\nlodged in a [Poison|Poisoned] target')];
    source = { filepath, filedir: filepath.slice(0, filepath.lastIndexOf('/')), filename: filepath.slice(filepath.lastIndexOf('/') + 1),
      name: '', stats: ['active_skill_base_area_of_effect_radius'], variables: english.map(() => '#'), remarks: english.map(() => ''),
      translations: { English: english }, isDNT: false };
  }
  assert.equal(source.translations.English.length, 7);
  assert.equal(Object.hasOwn(source.translations, language), false, 'Reported immutable source has no TCN block');
  const zip = new JSZip(); zip.file(filepath, Codec.descEncode(source), { createFolders: false });
  const fixtureZip = await zip.generateAsync({ type: 'nodebuffer' });
  const express = require('express'), app = express(), server = createServer(app), publicDir = resolve(__dirname, '../public');
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/', (req, res) => res.type('html').send(fs.readFileSync(join(publicDir, 'index.html'), 'utf8')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
  app.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(fs.readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
  app.get('/fixture/source.zip', (req, res) => res.type('application/zip').send(fixtureZip));
  app.get('/index.js', (req, res) => res.type('js').send(fs.readFileSync(join(publicDir, 'index.js'), 'utf8')
    .replace("app.mount('#app');", "window.__draftReviewApp = app.mount('#app');")));
  app.use('/v1', (req, res) => res.status(503).json({ error: 'Cloud disabled in local fixture.' }));
  app.use(express.static(publicDir));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port, errors = [];
  let browser;
  try {
    fs.mkdirSync(resolve(__dirname, '../temp'), { recursive: true });
    const profile = fs.mkdtempSync(resolve(__dirname, '../temp/dropped-draft-review-'));
    const context = browser = await chromium.launchPersistentContext(profile, { executablePath, headless: true,
      args: ['--disable-gpu'], viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const ready = () => page.waitForFunction(() => {
      const vm = window.__draftReviewApp;
      return vm?.offlineStoreReady && vm.startupReady && vm._cloud?.state && !vm._cloudInitializing && !vm._cloudApplying;
    });
    await page.goto(origin + '/?cloudApi=' + encodeURIComponent(origin)); await ready();
    await page.evaluate(async ({ filepath, language, targets }) => {
      const vm = window.__draftReviewApp, copy = value => JSON.parse(JSON.stringify(value));
      vm._cloudApplying = true;
      try {
        const previous = vm.lang; vm.lang = language; vm.inlineEditor = false;
        await vm.$nextTick(); await vm._cloud.selectLanguage(language, vm.cloudPayload(), previous);
        await vm.cloudApply(vm._cloud.snapshot());
      } finally { vm._cloudApplying = false; }
      vm.lang = language; vm.inlineEditor = false; vm.hideDNT = false; vm.dictionary = []; vm.editorRegexes = [];
      await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
      vm.showSetting = false; vm.needsInitialSettings = false;
      await vm.activateGameVersion('poe2', { checkMigration: false });
      const bytes = new Uint8Array(await (await fetch('/fixture/source.zip')).arrayBuffer()), zip = await JSZip.loadAsync(bytes);
      const source = await parseFile(filepath, zip.file(filepath), language);
      const file = new File([bytes], 'ReportedDroppedReview.zip', { type: 'application/zip' });
      const identity = await vm.readImportZipIdentity(file, zip);
      await vm.importUpdateZipFile(file, [copy(source)], { identity, rawSource: [copy(source)] });
      vm.showSetting = false; vm.needsInitialSettings = false; vm.selectAllFileFilters(); vm.applyFileSearch();
      vm.localDescs.workspaceOrigin = 'online';
      await OfflineStore.updateWorkspace(() => copy(vm.localDescs), vm.managedWorkspaceScope(),
        { filepaths: [filepath], includeDropped: true, command: 'fixture-online-origin' });
      // Simulate a retained private draft, followed by a newer accepted shared save.
      if (!await vm.editFile(filepath, true)) throw new Error('Could not open reported file.');
      vm.applyPreparedEditorBlocks(await vm.prepareMatchedEditorBlocks(source.translations.English, targets, () => true));
      if (!await vm.flushEditorDraft({ force: true })) throw new Error('Could not retain reported draft.');
      await vm.editorExit();
      vm.cloudUser = { id: 'guest', language, role: 'translator', assignmentVersion: 1 };
      await vm.$nextTick(); clearTimeout(vm._collabStartTimer);
      const client = new CollaborationSync.Client({ store: OfflineStore, WebSocket: null,
        request: async () => { throw new Error('Unexpected live cloud request in local review fixture.'); }, presenceEnabled: () => false,
        onChange: state => vm.collabReceiveState(state), onRemote: files => vm.receiveCollaborationFiles(files, language),
        onRemoteDropped: (records, snapshot) => vm.applyRemoteDropped(records, language, snapshot) });
      vm._collaboration = client;
      await client.connectSparse({ accountId: vm.managedWorkspaceScope().accountId, game: 'poe2', language,
        baselineSource: [copy(source)], archive: copy(vm.importBaseline.archive), workspace: copy(vm.localDescs), files: [], deferRemote: true });
      await client.acceptSnapshot({ roomId: 'fixture-shared-room', sequence: 4,
        files: [{ filepath, translations: targets.map((text, i) => i ? text : '已儲存：' + text),
          trackedForExport: true, needsReview: false, revision: 4 }] }, client.epoch);
      const workspace = copy(vm.localDescs), old = copy(source); old.translations.English[0] += ' (older source)';
      const dropped = WorkspaceState.dropTranslation(workspace, old, language, { id: 'reported-shared-copy', ownership: 'online',
        revision: 3, game: 'poe2', originSourceHash: 'e'.repeat(64), targetSourceHash: vm.sourceIdentity,
        translations: targets, reason: 'Changed English source' });
      await client.receiveDropped([dropped], client.epoch, { acknowledge: true });
      if (!await vm.editFile(filepath, true)) throw new Error('Could not reopen retained draft.');
    }, { filepath, language, targets });
    const inspect = () => page.evaluate(async ({ filepath, language }) => {
      const vm = window.__draftReviewApp, workspace = await OfflineStore.getWorkspace(vm.managedWorkspaceScope());
      return { text: vm.serializeEditorTranslations(), stale: vm.editorDraftBaseChanged, candidate: vm.editorDroppedCandidate?.id,
        committed: vm.getDescByFilepath(filepath).translations[language], shared: vm._collaboration?.sharedBase(filepath),
        draft: await OfflineStore.getTranslationDraft(vm.editorDraftKey(vm.editorDraftScope(filepath))),
        dropped: WorkspaceState.droppedForFile(workspace, filepath, language),
        stage: workspace.staged?.[language]?.[filepath], baseline: vm.toPlainForStorage(vm.workspaceSourceFile(filepath)),
        originalHash: vm.sourceIdentity, findings: vm.inlineFindingsFor(filepath) };
    }, { filepath, language });
    const initial = await inspect();
    assert.equal(initial.stale, true); assert.deepEqual(initial.text, targets); assert.equal(initial.dropped.ownership, 'online');
    assert.equal(await page.evaluate(() => window.__draftReviewApp.editorSave({ close: true, defer: false })), false);
    assert.match((await inspect()).findings.map(item => item.message).join(' '), /Review draft/);
    // Alignment of seven complete pairs must not implicitly approve a stale base.
    await page.getByRole('button', { name: 'Align entries', exact: true }).click();
    await page.evaluate(() => {
      const vm = window.__draftReviewApp;
      for (let i = 0; i < 7; i++) vm.mutateEntryAlignment('assign', i, i);
    });
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await page.waitForFunction(() => !window.__draftReviewApp.entryAlignment && !window.__draftReviewApp.entryAlignmentApplying);
    assert.equal((await inspect()).stale, true);
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      const action = page.getByRole('button', { name: 'Review draft', exact: true });
      await action.scrollIntoViewIfNeeded(); await action.focus();
      assert.equal(await action.isVisible(), true); assert.equal(await action.isEnabled(), true);
    }
    fs.mkdirSync(resolve(__dirname, '../temp'), { recursive: true });
    await page.screenshot({ path: resolve(__dirname, '../temp/dropped-draft-review.png') });
    await page.getByRole('button', { name: 'Review draft', exact: true }).click();
    await page.waitForFunction(() => window.__draftReviewApp.editorCompareActive);
    await page.getByRole('button', { name: 'Exit compare', exact: true }).click();
    assert.equal((await inspect()).stale, true); assert.deepEqual((await inspect()).text, targets);
    await page.getByRole('button', { name: 'Review draft', exact: true }).click();
    await page.getByRole('button', { name: 'Use translation', exact: true }).click();
    await page.waitForFunction(() => !window.__draftReviewApp.editorCompareActive && !window.__draftReviewApp.editorDraftBaseChanged);
    const reviewed = await inspect();
    assert.deepEqual(reviewed.draft.base.translations, initial.shared.translations);
    assert.equal(reviewed.draft.base.revision, 4); assert.equal(reviewed.candidate, initial.candidate);
    assert.ok(reviewed.draft.alignmentRecovery.length); assert.ok(reviewed.dropped);
    await page.getByRole('button', { name: 'Save & close', exact: true }).click();
    await page.waitForFunction(() => {
      const vm = window.__draftReviewApp;
      return !vm.editorVisible && !vm.pendingLocalSaves && !vm._pendingSaves.snapshot().jobs.length;
    });
    const saved = await inspect();
    assert.deepEqual(saved.stage.translations, targets); assert.equal(saved.dropped, null);
    assert.equal(saved.draft.state, 'promoted'); assert.deepEqual(saved.baseline, initial.baseline);
    const operation = await page.evaluate(async filepath => {
      const vm = window.__draftReviewApp, client = vm._collaboration;
      const op = client.room().outbox.find(op => op.files.some(file => file.yours.filepath === filepath));
      await client.prepare(op.id, client.epoch);
      return client.room().outbox.find(item => item.id === op.id);
    }, filepath);
    assert.equal(operation.files[0].base.revision, 4);
    assert.equal(operation.wire.promoteDropped.id, initial.dropped.id);
    assert.equal(operation.wire.promoteDropped.revision, initial.dropped.revision);
    const exported = await page.evaluate(async ({ filepath, language }) => {
      const vm = window.__draftReviewApp; window.saveAs = blob => { window.__reviewExport = blob; };
      await vm.exportZip(false);
      const zip = await JSZip.loadAsync(window.__reviewExport);
      return (await parseFile(filepath, zip.file(filepath), language)).translations;
    }, { filepath, language });
    assert.deepEqual(exported[language], targets); assert.deepEqual(exported.English, initial.baseline.translations.English);
    await page.reload(); await ready();
    await page.evaluate(() => window.__draftReviewApp.activateGameVersion('poe2', { checkMigration: false }));
    assert.equal(await page.evaluate(async ({ hash, language }) => window.__draftReviewApp.managedActivateWorkspace(hash, language),
      { hash: saved.originalHash, language }), true);
    const reloaded = await page.evaluate(async ({ filepath, language }) => {
      const vm = window.__draftReviewApp, workspace = await OfflineStore.getWorkspace(vm.managedWorkspaceScope());
      return { stage: workspace.staged?.[language]?.[filepath], dropped: WorkspaceState.droppedForFile(workspace, filepath, language) };
    }, { filepath, language });
    assert.deepEqual(reloaded.stage.translations, targets); assert.equal(reloaded.dropped, null);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, filepath, source: process.env.SDEDITOR_REPORTED_SOURCE_ZIP ? 'production entry' : 'reported layout',
      entryCount: 7, verified: 'Retained draft + newer collaboration save; alignment preserves stale guard; explicit comparison rebases; guarded Shared Dropped promotion, parsed export and reload retain the save.' }, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
