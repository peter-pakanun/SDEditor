// Disposable, loopback-only performance fixture. No storage or cloud account is used.
// Run: node scripts/editor-opening-browser-fixture.cjs
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const publicDir = path.join(__dirname, '../public');

function controls(editor) {
  const panel = document.createElement('aside');
  panel.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:9999;background:#fff8df;color:#222;padding:10px;border:1px solid #a80;font:13px system-ui;max-width:620px';
  panel.setAttribute('aria-label', 'Editor performance fixture');
  const seed = document.createElement('button'); seed.textContent = 'Load 20,000 dictionary entries';
  const slow = document.createElement('button'); slow.textContent = 'Delay preparation for cancellation check';
  const status = document.createElement('p'); status.textContent = 'Test data only. Load the dictionary, then open a file.';
  status.setAttribute('role', 'status');
  panel.append(seed, slow, status); document.body.append(panel);
  seed.onclick = async () => {
    editor.editorExit();
    editor.dictionary = Array.from({ length: 19996 }, (_, i) => ({
      _id: 'fixture-' + i, find: 'Unrelated dictionary term ' + i, replace: 'คำแปล ' + i, alts: [], tlnote: '',
    })).concat([
      { _id: 'fixture-unarmed', find: 'UnarmedDamage', replace: 'ความเสียหายมือเปล่า', alts: [{ _id: 'fixture-unarmed-alt', find: 'Unarmed Damage', replace: 'ความเสียหายมือเปล่า' }], tlnote: '' },
      { _id: 'fixture-strength', find: 'Strength', replace: 'ความแข็งแกร่ง', alts: [], tlnote: '' },
      { _id: 'fixture-rune', find: 'Rune', replace: 'รูน', alts: [{ _id: 'fixture-rune-alt', find: 'Runes', replace: 'รูน' }], tlnote: '' },
      { _id: 'fixture-chest', find: 'BlackScytheArtifact', replace: 'วัตถุโบราณ', alts: [{ _id: 'fixture-chest-alt', find: 'Black Scythe Artifacts', replace: 'วัตถุโบราณ' }], tlnote: '' },
    ]);
    await editor.$nextTick();
    status.textContent = '20,000 entries ready. Relevant entries are at the end of the dictionary.';
  };
  let delay = false;
  slow.onclick = () => { delay = !delay; status.textContent = delay ? 'Preparation delayed 2 seconds. Open a file, then Close or Escape.' : 'Normal preparation restored.'; };
  const prepare = editor.prepareEditorDictionaryIndex;
  editor.prepareEditorDictionaryIndex = async function (current) {
    if (delay) await new Promise(resolve => setTimeout(resolve, 2000));
    return prepare.call(this, current);
  };
  const open = editor.openEditorFile;
  editor.openEditorFile = async function (...args) {
    const start = performance.now();
    let paint = null;
    const pending = open.apply(this, args);
    await this.$nextTick();
    const shell = !!document.querySelector('.editorOpening');
    requestAnimationFrame(() => { paint = performance.now() - start; });
    const opened = await pending;
    await this.$nextTick();
    requestAnimationFrame(() => {
      const rows = document.querySelectorAll('.side .dictRow').length;
      status.textContent = opened
        ? `Opening view: ${shell ? 'visible' : 'missing'} in ${Math.round(paint || 0)} ms; ready in ${Math.round(performance.now() - start)} ms; ${rows} dictionary rows rendered of ${this.dictionary.length}.`
        : `Open cancelled; editor visible: ${this.editorVisible}; draft blocks: ${this.editorBlocks.length}.`;
    });
    return opened;
  };
}

const app = express();
app.get('/index.js', (_req, res) => {
  const source = fs.readFileSync(path.join(publicDir, 'index.js'), 'utf8');
  res.type('js').send(source.replace("app.mount('#app');", `const fixtureEditor = app.mount('#app');\n(${controls.toString()})(fixtureEditor);`));
});
app.use(express.static(publicDir));
app.listen(3335, '127.0.0.1', () => console.log('Editor fixture: http://127.0.0.1:3335/?testMode=1&lang=Thai'));
