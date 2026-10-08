// Disposable test-mode fixture using the page's real Vue watchers.
// Run: node scripts/diagnostic-sync-browser-fixture.cjs
// Scan, correct dummy3.txt, and use Save & close or F2. The fixture replays
// an unchanged cloud snapshot during saving; unrelated findings must remain.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const publicDir = path.resolve(__dirname, '../public');

function controls(editor) {
  if (!editor.testMode) return;
  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Diagnostic sync regression fixture');
  panel.setAttribute('data-inline-focus-surface', '');
  panel.style.cssText = 'position:fixed;bottom:90px;right:12px;z-index:2147483000;padding:12px;max-width:430px;background:#fff8de;color:#222;border:2px solid #926400;font:13px system-ui';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const replay = document.createElement('button'); replay.textContent = 'Replay unchanged Dictionary sync';
  const arm = document.createElement('button'); arm.textContent = 'Replay sync during next save';
  for (const button of [replay, arm]) button.addEventListener('pointerdown', event => event.preventDefault());
  panel.append(replay, arm, status); document.body.append(panel);
  let armed = false;
  const report = message => {
    status.textContent = message + ' · Scan complete: ' + editor.diagnosticScanCompleted
      + ' · Files with findings: ' + editor.diagnosticScanResultFiles.length;
  };
  async function replaySnapshot() {
    // Cloud normalization rebuilds objects in schema order and may spell All
    // explicitly. Neither change alters the approved Dictionary contents.
    const dictionary = DictionarySync.normalizeEntries(editor.dictionary)
      .map(entry => ({ ...entry, gameScope: entry.gameScope || 'all' }));
    await editor.cloudApply({ settings: CloudSync.preferences(editor), dictionary,
      editorClipboard: editor.editorClipboard, user: editor.cloudUser,
      signedIn: editor.cloudSignedIn, profileId: editor.cloudProfileId,
      conflicts: editor.cloudConflicts, revision: editor.cloudRevision,
      needsDictionaryLanguage: false, recoveryCount: 0 });
    await editor.$nextTick();
    report('Replayed unchanged snapshot');
  }
  replay.onclick = () => replaySnapshot().catch(error => report(error.message));
  arm.onclick = () => { armed = true; report('Sync armed for next save'); };
  const persist = editor.persistTranslationBatch;
  editor.persistTranslationBatch = async function (...args) {
    const result = await persist.apply(this, args);
    if (armed && !result.stale && result.status !== 'conflict') {
      armed = false; await replaySnapshot();
    }
    return result;
  };
  report('Disposable test data; no cloud login or persistent storage');
}

const server = express();
server.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
server.get('/index.js', (_req, res) => {
  const source = fs.readFileSync(path.join(publicDir, 'index.js'), 'utf8');
  res.type('js').send(source.replace("app.mount('#app');",
    `const fixtureEditor = app.mount('#app');\n(${controls.toString()})(fixtureEditor);`));
});
server.use(express.static(publicDir));
const port = Number(process.env.DIAGNOSTIC_FIXTURE_PORT || 3362);
server.listen(port, '127.0.0.1', () => console.log(`Diagnostic sync fixture: http://127.0.0.1:${port}/?testMode=1&lang=Thai`));
