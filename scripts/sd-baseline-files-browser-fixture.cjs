// Native IndexedDB v21 and a real ZIP worker on a disposable local origin.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync, existsSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const modules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [modules] }));
const jszip = require.resolve('jszip/dist/jszip.min.js', { paths: [join(__dirname, '../../SDEditor-API'), modules] });
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
(async () => {
  let browser;
  const allowed = ['workspaceState.js', 'collaborationProtocol.js', 'statDescCodec.js', 'normalizedStore.js', 'normalizedRooms.js',
    'offlineStore.js', 'sdBaselineFiles.js', 'sdBaselineWorker.js', 'sdBaselineUi.js'];
  const server = createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><script src="/jszip.min.js"></script>'); return; }
    if (req.url === '/jszip.min.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(readFileSync(jszip)); return; }
    const file = req.url.slice(1);
    if (!allowed.includes(file)) { res.writeHead(404); res.end(); return; }
    let source = readFileSync(join(__dirname, '../public', file), 'utf8');
    if (file === 'sdBaselineWorker.js') {
      source = source.replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/jszip.min.js');
      source += `\nconst load = self.JSZip.loadAsync;
        self.JSZip.loadAsync = async (...args) => {
          self.postMessage({ type:'probe', operation:'open' });
          const zip = await load(...args);
          for (const entry of Object.values(zip.files)) {
            const read = entry.async.bind(entry);
            entry.async = (...args) => { self.postMessage({ type:'probe', operation:'inflate', filepath:entry.name }); return read(...args); };
          }
          return zip;
        };`;
    }
    res.setHeader('Content-Type', 'application/javascript'); res.end(source);
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launchPersistentContext(mkdtempSync(join(__dirname, '../temp/sd-baseline-browser-')), { headless: true, executablePath });
    const page = await browser.newPage();
    const origin = 'http://127.0.0.1:' + server.address().port;
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const completed = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); });
      const add = src => new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.append(script); });
      for (const file of ['statDescCodec.js', 'workspaceState.js', 'collaborationProtocol.js', 'normalizedStore.js', 'normalizedRooms.js']) await add('/' + file);
      const opened = indexedDB.open('sdeditor', 20);
      opened.onupgradeneeded = () => {
        opened.result.createObjectStore('kv', { keyPath: 'key' }); NormalizedStore.upgrade(opened.result, opened.transaction);
      };
      const old = await request(opened);
      const work = { key: 'recovery', value: { recoveryId: 'stable-recovery', translations: ['Last translation'], sourceRef: { baselineId: 'historical' } } };
      const receipt = { key: 'receipt', value: { jobId: 'same-id', signature: 'exact-old-signature' } };
      let tx = old.transaction(['workspace_records', 'save_receipts'], 'readwrite'), done = completed(tx);
      tx.objectStore('workspace_records').put(work); tx.objectStore('save_receipts').put(receipt); await done;
      let fenced = false; old.onversionchange = () => { fenced = true; old.close(); };
      await add('/offlineStore.js'); await OfflineStore.getSettings();
      window.__sourceWorkerProbe = [];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker { constructor(...args) { super(...args); this.addEventListener('message', event => {
        if (event.data?.type === 'probe') window.__sourceWorkerProbe.push(event.data);
      }); } };
      await add('/sdBaselineFiles.js');
      const zip = new JSZip(), text = 'description test\n1 damage\n1\n# "English"\nlang "Thai"\n1\n# "Original target"';
      for (let i = 0; i < 50; i++) zip.file('source/' + i + '.txt', new Uint8Array(StatDescCodec.strEncodeUTF16(text).buffer), { createFolders: false });
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const identity = await SDBaselineFiles.readZipIdentity(blob);
      const archive = await CollaborationProtocol.finalizeArchive({ version: 2, ...identity, parserVersion: 1, decisions: [], fileCount: 50, descriptionCount: 50 });
      await SDBaselineFiles.cacheOriginalZip(blob, archive);
      const ref = { baselineId: archive.baselineId, archive, game: 'poe2', filepath: 'source/7.txt' };
      const files = await Promise.all([SDBaselineFiles.resolveBaselineFile(ref), SDBaselineFiles.resolveBaselineFile(ref)]);
      files[0].translations.English[0] = 'Detached edit';
      const warm = await SDBaselineFiles.resolveBaselineFile(ref);
      const second = await SDBaselineFiles.resolveBaselineFile({ ...ref, filepath: 'source/8.txt' });
      await add('/sdBaselineUi.js');
      const workspace = { sourceHash: archive.baselineId, game: 'poe2', descs: [], status: {} };
      WorkspaceState.initializeWorkspace(workspace, { source: [warm], sourceHash: archive.baselineId, game: 'poe2', language: 'Thai' });
      const candidate = WorkspaceState.dropTranslation(workspace, warm, 'Thai', { id: 'target-only', revision: 3,
        originSourceHash: 'b'.repeat(64), sourceRef: { kind: 'sd-baseline', baselineId: 'b'.repeat(64), filepath: warm.filepath },
        snapshot: { translations: ['Retained authored target'] } });
      const frozen = JSON.stringify(candidate), ui = SDBaselineUI.mixin;
      const viewer = { ...ui.data(), ...ui.methods, editorDroppedCandidate: candidate, editorVisible: true,
        sdBaselineViewScope: 'native-scope', resolveSDSource: async () => { throw new Error('The original ZIP is unavailable. Import it to compare source.'); } };
      await viewer.loadSDDroppedSource();
      if (JSON.stringify(candidate) !== frozen || !viewer.sdDroppedSourceError) throw new Error('Missing old ZIP changed recovery or hid its comparison error.');
      WorkspaceState.stageTranslation(workspace, { filepath: warm.filepath, translations: candidate.snapshot.translations }, 'Thai', {
        source: warm, sourceHash: archive.baselineId, promoteDropped: { id: candidate.id, revision: 3, targetSourceHash: archive.baselineId } });
      const db = await OfflineStore.openClientTextDb();
      tx = db.transaction('workspace_records', 'readwrite'); done = completed(tx);
      tx.objectStore('workspace_records').put({ key: 'target-only-promotion', value: workspace }); await done;
      tx = db.transaction(['workspace_records', 'save_receipts', 'statdescription_zips'], 'readonly'); done = completed(tx);
      const retained = await Promise.all([request(tx.objectStore('workspace_records').get(work.key)), request(tx.objectStore('save_receipts').get(receipt.key)), request(tx.objectStore('statdescription_zips').get(archive.zipHash))]);
      await done;
      window.__sourceFixtureArchive = archive;
      sessionStorage.setItem('source-archive', JSON.stringify(archive));
      return { fenced, version: db.version, warm, second, retained: retained.slice(0, 2), cachedHash: await CollaborationProtocol.zipHash(retained[2].blob), archive, probe: window.__sourceWorkerProbe,
        sourceLoss: { error: viewer.sdDroppedSourceError, candidate: workspace.droppedArchive[candidate.id], stage: workspace.staged.Thai[warm.filepath] } };
    });
    assert.equal(result.version, 21); assert.equal(result.fenced, true);
    assert.equal(result.warm.translations.English[0], 'English'); assert.equal(result.second.filepath, 'source/8.txt');
    assert.equal(result.cachedHash, result.archive.zipHash);
    assert.deepEqual(result.probe.filter(value => value.operation === 'inflate').map(value => value.filepath), ['source/7.txt', 'source/8.txt']);
    assert.equal(result.probe.filter(value => value.operation === 'open').length, 1);
    assert.equal(result.retained[0].value.recoveryId, 'stable-recovery'); assert.equal(result.retained[1].value.signature, 'exact-old-signature');
    assert.match(result.sourceLoss.error, /original ZIP is unavailable/); assert.equal(result.sourceLoss.candidate.status, 'promoted');
    assert.equal(result.sourceLoss.candidate.snapshot.english, undefined); assert.deepEqual(result.sourceLoss.stage.translations, ['Retained authored target']);
    await page.reload();
    const offline = await page.evaluate(async () => {
      for (const file of ['statDescCodec.js', 'workspaceState.js', 'collaborationProtocol.js', 'normalizedStore.js', 'normalizedRooms.js', 'offlineStore.js', 'sdBaselineFiles.js']) {
        await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/' + file; script.onload = resolve; script.onerror = reject; document.head.append(script); });
      }
      const archive = JSON.parse(sessionStorage.getItem('source-archive'));
      const file = await SDBaselineFiles.resolveBaselineFile({ baselineId: archive.baselineId, archive, game: 'poe2', filepath: 'source/9.txt' });
      const db = await OfflineStore.openClientTextDb();
      const promotion = await new Promise((resolve, reject) => { const read = db.transaction('workspace_records').objectStore('workspace_records').get('target-only-promotion'); read.onsuccess = () => resolve(read.result.value); read.onerror = () => reject(read.error); });
      return { file, promotion };
    });
    assert.equal(offline.file.filepath, 'source/9.txt'); assert.equal(offline.file.translations.English[0], 'English');
    assert.deepEqual(offline.promotion.staged.Thai['source/7.txt'].translations, ['Retained authored target']);
    assert.equal(offline.promotion.droppedArchive['target-only'].snapshot.english, undefined);
    console.log('PASS: native v20→v21 fence, durable ZIP reload, selective worker extraction, coalesced/warm detached reads, preserved recovery/receipt and target-only promotion despite missing historical ZIP.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
