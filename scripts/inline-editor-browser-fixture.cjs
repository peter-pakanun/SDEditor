// Disposable normal-mode acceptance fixture; never served by the production server.
// Run: node scripts/inline-editor-browser-fixture.cjs
// Open http://127.0.0.1:3353/ and click Seed source v1. Do not add testMode.
// This origin uses real IndexedDB and the normal guest/settings/save-worker paths.
// Source v2 changes one file and removes one file, retaining old-source drafts for recovery.
// Reload page verifies durable state. The inspector only reads storage; it never flushes edits.
// Stop with Ctrl+C. Browser data remains confined to this disposable loopback origin.
const express = require('express');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const publicDir = resolve(__dirname, '../public');

function installControls() {
  const panel = document.createElement('aside');
  panel.id = 'inline-editor-fixture';
  panel.setAttribute('aria-label', 'Disposable inline editor fixture');
  panel.style.cssText = 'position:fixed;left:12px;bottom:105px;z-index:2147483000;width:340px;max-height:45vh;overflow:auto;box-sizing:border-box;padding:10px;border:2px solid #926400;border-radius:8px;background:#fff8de;color:#28220e;font:12px/1.4 system-ui;box-shadow:0 4px 16px #0004';
  const title = document.createElement('strong'); title.textContent = 'Inline editor · real IndexedDB fixture';
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-top:8px';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Seed v1 once; later reloads preserve the workspace and drafts.';
  const details = document.createElement('details'); details.open = true;
  const summary = document.createElement('summary'); summary.textContent = 'Persisted state (read only)';
  const output = document.createElement('pre'); output.setAttribute('aria-label', 'Persisted draft and staged translations'); output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 monospace;margin:6px 0 0';
  details.append(summary, output); panel.append(title, actions, status, details); document.body.append(panel);
  const getApp = () => window.__inlineFixtureApp || document.querySelector('#app')?.__vue_app__?._instance?.proxy;
  const ready = async () => {
    for (let n = 0; n < 200; n++) {
      const vm = getApp();
      if (vm?.offlineStoreReady && vm.startupReady && vm._cloud?.state && !vm._cloudInitializing && !vm._cloudApplying) {
        if (vm.testMode) throw new Error('Remove testMode from the URL: this fixture requires real IndexedDB.');
        return vm;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Normal initialization did not finish; inspect visible errors.');
  };
  let busy = false;
  const button = (label, action, preserveFocus = false) => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
    node.style.cssText = 'padding:5px 7px;border:1px solid #a78237;border-radius:4px;background:#fff;color:#28220e;font:12px system-ui';
    node.onclick = async () => {
      if (busy) return; busy = true; node.disabled = true;
      try { await action(); await inspect(); }
      catch (error) { status.textContent = 'Fixture error: ' + error.message; console.error(error); }
      finally { busy = false; node.disabled = false; }
    };
    if (preserveFocus) node.addEventListener('pointerdown', event => event.preventDefault());
    actions.append(node); return node;
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const fixtureSource = version => {
    const make = (name, english, thai) => ({ filepath: 'inline-fixture/' + name + '.txt', filedir: 'inline-fixture/', filename: name + '.txt',
      name: '', stats: ['inline_' + name.replace(/\W/g, '_')], variables: english.map(() => '#'), remarks: english.map(() => ''),
      translations: { English: english, Thai: thai, German: english.map((_, i) => 'Deutscher Text ' + (i + 1)) }, isDNT: false });
    const files = [
      make('01_ordinary', [version === 1 ? 'Adds {0} [Fire] damage' : 'Adds {0}% increased [Fire] damage', 'Gain [Strength]'], ['เพิ่มความเสียหาย [Fire|ไฟ] {0}', 'ได้รับ [Strength|ความแข็งแกร่ง]']),
      make('02_multiline', ['First line {0}\\nSecond line [Cold]', 'A much longer second block of English text which wraps when the sidebar is visible.'], ['บรรทัดแรก {0}\\nบรรทัดที่สอง [Cold|เย็น]', 'คำแปลสั้น']),
      make('03_table', ['[Fire] damage {0}@[Cold] damage {1}', 'One@Two@Three'], ['ความเสียหาย [Fire|ไฟ] {0}@ความเสียหาย [Cold|เย็น] {1}', 'หนึ่ง@สอง@สาม']),
      make('04_missing_and_error', ['Damage {0}', 'Gain [Strength]'], ['', 'ได้รับ [WrongKeyword]']),
      make('05_warning', ['Fire damage'], [' ความเสียหายไฟ ']),
      make('06_dropped', ['Current [Fire] damage {0}'], ['ความเสียหาย [Fire|ไฟ] ปัจจุบัน {0}']),
    ];
    if (version === 1) files.push(make('07_removed_in_v2', ['Preserved source {0}'], ['ต้นฉบับที่เก็บไว้ {0}']));
    return files;
  };
  async function configure(vm) {
    vm._cloudApplying = true;
    try {
      const previousLanguage = vm.lang;
      vm.lang = 'Thai'; vm.inlineEditor = true; vm.inlineSidebarVisible = true;
      await vm.$nextTick();
      await vm._cloud.selectLanguage('Thai', vm.cloudPayload(), previousLanguage);
      await vm.cloudApply(vm._cloud.snapshot());
    } finally { vm._cloudApplying = false; }
    vm.lang = 'Thai'; vm.inlineEditor = true; vm.inlineSidebarVisible = true; vm.hideDNT = false;
    vm.dictionary = [
      { _id: 'inline-fire', find: 'Fire', replace: 'ไฟ', gameScope: 'all', alts: [{ find: 'Fire damage', replace: 'ความเสียหายไฟ' }], tlnote: 'Fixture note: preserve the keyword identifier.' },
      { _id: 'inline-cold', find: 'Cold', replace: 'เย็น', gameScope: 'all', alts: [], tlnote: '' },
      { _id: 'inline-strength', find: 'Strength', replace: 'ความแข็งแกร่ง', gameScope: 'all', alts: [], tlnote: '' },
      { _id: 'inline-unmatched', find: 'Unmatched term', replace: 'คำที่ไม่ตรงกัน', gameScope: 'all', alts: [], tlnote: '' },
    ];
    await vm.saveSettings();
    await OfflineStore.setMigratedFromSingleVersion(true);
    vm.showSetting = false; vm.needsInitialSettings = false;
    await vm.activateGameVersion('poe1', { checkMigration: false });
  }
  async function seed(version) {
    const vm = await ready(); status.textContent = 'Importing known fixture source v' + version + ' into this origin…';
    if (vm.inlineActive) await vm.finishInlineSession({ promote: false });
    else if (vm.editorVisible) await vm.editorExit();
    if (vm.editorSessionActive) throw new Error('Close the active editor before changing fixture source.');
    await configure(vm);
    const source = fixtureSource(version), zip = new JSZip();
    for (const desc of source) zip.file(desc.filepath, descEncode(desc), { date: new Date('2026-10-08T00:00:00Z'), createFolders: false });
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const file = new File([bytes], 'InlineFixture-v' + version + '.zip', { type: 'application/zip', lastModified: Date.UTC(2026, 9, 8) });
    const identity = await vm.readImportZipIdentity(file, zip);
    // This tiny fixture supplies its known decoded descriptions. Normal import still
    // builds the archive descriptor/Merkle tree and commits source/workspace/history.
    await vm.importUpdateZipFile(file, clone(source), { identity, rawSource: clone(source) });
    if (vm.descs.length !== source.length || !vm.sourceIdentity) throw new Error('Fixture source import did not complete.');
    const droppedSource = clone(source.find(desc => desc.filename === '06_dropped.txt'));
    droppedSource.translations.English = ['Previous [Fire] damage {0}'];
    droppedSource.translations.Thai = ['ความเสียหาย [Fire|ไฟ] รุ่นก่อน {0}'];
    const workspace = clone(vm.localDescs);
    if (!WorkspaceState.droppedForFile(workspace, droppedSource.filepath, 'Thai')) {
      WorkspaceState.dropTranslation(workspace, droppedSource, 'Thai', { id: 'inline-fixture-dropped-' + vm.sourceIdentity,
        game: 'poe1', originSourceHash: await CollaborationProtocol.sourceHash([droppedSource]), targetSourceHash: vm.sourceIdentity,
        reason: 'Fixture preserved translation from an older source' });
      await OfflineStore.saveWorkspaceWithRevisions(workspace, [], 'poe1');
      await vm.activateGameVersion('poe1', { checkMigration: false });
    }
    vm.showSetting = false; vm.needsInitialSettings = false; vm.searchText = ''; vm.currentPage = 1;
    vm.selectAllFileFilters(); vm.applyFileSearch(); await vm.loadEditorDrafts(); await vm.$nextTick();
    vm.observeInlineBlocks(); sessionStorage.setItem('inline-fixture-source-version', String(version));
    status.textContent = 'Source v' + version + ' ready. ' + source.length + ' files; real guest IndexedDB; no cloud login. Seed does not delete local drafts.';
  }
  let inspecting = false;
  async function inspect() {
    if (inspecting) return;
    const vm = getApp(); if (!vm?.offlineStoreReady || !vm.gameVersionSelected || !vm.lang) return;
    inspecting = true;
    try {
      const scope = vm.editorDraftScope('inline-fixture/01_ordinary.txt');
      const [workspace, drafts] = await Promise.all([OfflineStore.getWorkspace(vm.gameVersion, vm.lang), OfflineStore.listTranslationDrafts(scope)]);
      const allDrafts = await OfflineStore.listTranslationDrafts({ profile: scope.profile, game: scope.game, language: scope.language });
      const staged = Object.entries(workspace?.staged?.[vm.lang] || {});
      let pairCount = 0, largestOffset = 0;
      for (const row of document.querySelectorAll('tr[data-filepath]')) {
        const groups = new Map();
        for (const block of row.querySelectorAll('[data-inline-block]')) {
          const pair = groups.get(block.dataset.inlineBlock) || {};
          pair[block.dataset.inlineSide] = block.getBoundingClientRect();
          groups.set(block.dataset.inlineBlock, pair);
        }
        for (const pair of groups.values()) if (pair.english && pair.translation) {
          pairCount++; largestOffset = Math.max(largestOffset, Math.abs(pair.english.top - pair.translation.top));
        }
      }
      const lines = ['Normal mode: ' + !vm.testMode, 'Scope: ' + scope.profile + ' / ' + vm.gameVersion + ' / ' + vm.lang,
        'Source: ' + String(vm.sourceIdentity).slice(0, 16), 'Stored source matches: ' + (workspace?.sourceHash === vm.sourceIdentity),
        'Current drafts: ' + drafts.length + ' | all source drafts: ' + allDrafts.length + ' | staged: ' + staged.length,
        'Displayed file rows: ' + document.querySelectorAll('tr[data-filepath]').length,
        'Aligned pairs: ' + pairCount + ' | largest top offset: ' + largestOffset.toFixed(1) + ' px',
        'Inline active: ' + !!vm.inlineActive + ' | autocomplete: ' + !!vm.hlPopup.visible];
      for (const draft of allDrafts) lines.push('DRAFT ' + draft.filepath + (draft.sourceHash !== vm.sourceIdentity ? ' [older source]' : '') + '\n' + JSON.stringify(draft.translations));
      for (const [filepath, record] of staged) lines.push('STAGED ' + filepath + '\n' + JSON.stringify(record.translations));
      const next = lines.join('\n'); if (output.textContent !== next) output.textContent = next;
    } catch (error) { output.textContent = 'Read error: ' + error.message; }
    finally { inspecting = false; }
  }
  button('Seed source v1', () => seed(1));
  button('Switch to source v2', () => seed(2));
  button('Reload data', async () => {
    const vm = await ready();
    if (vm.inlineActive) await vm.finishInlineSession({ promote: false }); else if (vm.editorVisible) await vm.editorExit();
    await vm.activateGameVersion('poe1', { checkMigration: false }); await vm.loadEditorDrafts(); vm.selectAllFileFilters();
    status.textContent = 'Reloaded the source, staged translations and drafts from IndexedDB.';
  });
  button('Reload page', async () => { location.reload(); });
  button('Inspect persisted', inspect);
  button('Cycle theme', async () => { const vm = await ready(); const themes = ['light', 'grey', 'dark', 'modern-dark']; vm.theme = themes[(themes.indexOf(vm.theme) + 1) % themes.length]; await vm.saveSettings(); status.textContent = 'Theme: ' + vm.theme; }, true);
  let beforeFixturePeers = null;
  button('Toggle wrapping peers', async () => {
    const vm = await ready();
    if (beforeFixturePeers) {
      vm.collaborationState = beforeFixturePeers; beforeFixturePeers = null;
      status.textContent = 'Simulated presence removed. This guest fixture does not connect to a collaboration server.';
    } else {
      const filepath = vm.editorCurrentEditingDesc?.filepath || vm.selectedFilepath || vm.descs[0]?.filepath;
      if (!filepath) throw new Error('Seed or select a file first.');
      beforeFixturePeers = clone(vm.collaborationState);
      vm.collaborationState = { ...vm.collaborationState, connected: true, sessionId: 'fixture-self', peers: [
        { sessionId: 'fixture-peer-a', accountId: 'fixture-a', name: 'Translator with a deliberately long wrapping display name', selected: filepath, editing: filepath, color: '#187848' },
        { sessionId: 'fixture-peer-b', accountId: 'fixture-b', name: 'Second fixture translator', selected: filepath, editing: filepath, color: '#9148a7' },
      ] };
      status.textContent = 'Simulated presence only: wrapping Editing badges on ' + filepath + '. Inspector measures alignment.';
    }
    await vm.$nextTick(); vm.observeInlineBlocks();
  }, true);
  button('Simulate IME [', async () => {
    const vm = await ready();
    if (!vm.inlineActive || !vm.editorReady) throw new Error('Focus an inline translation field first.');
    const index = vm.editorFocusedIndex || 0, block = vm.editorBlocks[index], column = vm.editorFocusedColumnIndex || 0;
    const el = vm.getEditorRef('translation', index, block.isTable ? column : null);
    if (!el) throw new Error('No active translation field.');
    el.focus();
    const field = block.isTable ? block.tableColumns[column] : block;
    const previous = field.translation, at = el.selectionStart ?? el.value.length;
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    el.value = el.value.slice(0, at) + '[' + el.value.slice(el.selectionEnd ?? at);
    el.setSelectionRange(at + 1, at + 1);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '[', isComposing: true }));
    const compositionHeld = field.translation === previous;
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '[' }));
    await vm.$nextTick(); await new Promise(resolve => setTimeout(resolve, 30));
    status.textContent = 'Synthetic IME check (not an OS IME): uncommitted text held=' + compositionHeld + '; committed=' + (field.translation !== previous) + '; autocomplete=' + vm.hlPopup.visible + '. This intentionally edits the selected draft.';
  }, true);
  button('Collapse panel', async () => { details.open = !details.open; });
  setInterval(() => { if (!document.hidden) inspect(); }, 1200);
  ready().then(async vm => {
    if (sessionStorage.getItem('inline-fixture-source-version') && !vm.gameVersionSelected) {
      await vm.activateGameVersion('poe1', { checkMigration: false });
      vm.showSetting = false; vm.needsInitialSettings = !vm.lang;
      vm.selectAllFileFilters(); await vm.loadEditorDrafts();
      status.textContent = 'Reloaded the previously seeded PoE1 workspace from IndexedDB. No fixture source was rewritten.';
    }
    await inspect();
  }).catch(error => { status.textContent = error.message; });
}

const app = express();
app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.get('/', (_req, res) => {
  const html = readFileSync(resolve(publicDir, 'index.html'), 'utf8');
  res.type('html').send(html.replace('</body>', '<script>(' + installControls.toString() + ')();</script></body>'));
});
app.get('/index.js', (_req, res) => {
  const source = readFileSync(resolve(publicDir, 'index.js'), 'utf8');
  res.type('js').send(source.replace("app.mount('#app');", "window.__inlineFixtureApp = app.mount('#app');"));
});
app.use(express.static(publicDir));
const port = Number(process.env.INLINE_FIXTURE_PORT || 3353);
app.listen(port, '127.0.0.1', () => console.log('Normal-mode inline fixture: http://127.0.0.1:' + port + '/ (click Seed source v1)'));
