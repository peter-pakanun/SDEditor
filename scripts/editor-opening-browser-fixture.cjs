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
  const slow = document.createElement('button'); slow.textContent = 'Hold preparation for layout check';
  const finish = document.createElement('button'); finish.textContent = 'Finish preparation'; finish.disabled = true;
  const status = document.createElement('p'); status.textContent = 'Test data only. Load the dictionary, then open a file.';
  status.setAttribute('role', 'status');
  panel.append(seed, slow, finish, status); document.body.append(panel);
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
    const tableFile = editor.descs.find(desc => desc.filepath === 'test/dummy2.txt');
    tableFile.translations.Thai = [
      'คอลัมน์ A: [UnarmedDamage|ความเสียหายมือเปล่า] เพิ่มขึ้น 1% ต่อ [Strength|ความแข็งแกร่ง] {0} หน่วย@คอลัมน์ B: ข้อความเพิ่มเติม {1}',
      '[UnarmedDamage|ความเสียหายมือเปล่า] ลดลง 1% ต่อ [Strength|ความแข็งแกร่ง] {0} หน่วย',
      'ตัวอย่างซ้าย A\\nตัวอย่างซ้าย B@ตัวอย่างขวา a\\nตัวอย่างขวา b',
      '<enchanted>{{หีบที่ขุดค้นมีโอกาส {0}% ที่จะมี [BlackScytheArtifact|วัตถุโบราณ] เพิ่มเติม}}',
    ];
    await editor.$nextTick();
    status.textContent = '20,000 entries ready. Relevant entries are at the end of the dictionary.';
  };
  let delay = false, releasePreparation;
  slow.onclick = () => { delay = true; status.textContent = 'Preparation will pause after the text appears. Inspect the fields, then Finish preparation, Close or Escape.'; };
  finish.onclick = () => { delay = false; releasePreparation?.(); finish.disabled = true; };
  const prepare = editor.prepareEditorDictionaryIndex;
  editor.prepareEditorDictionaryIndex = async function (current) {
    if (delay) {
      finish.disabled = false;
      await new Promise(resolve => {
        releasePreparation = resolve;
        const timer = setInterval(() => { if (!current()) { clearInterval(timer); resolve(); } }, 100);
        releasePreparation = () => { clearInterval(timer); resolve(); };
      });
      finish.disabled = true;
    }
    return prepare.call(this, current);
  };
  const open = editor.openEditorFile;
  editor.openEditorFile = async function (...args) {
    const start = performance.now();
    let paint = null;
    const pending = open.apply(this, args);
    await this.$nextTick();
    await new Promise(resolve => requestAnimationFrame(resolve));
    paint = performance.now() - start;
    const fields = Array.from(document.querySelectorAll('.editor .textHL input, .editor .textHL textarea'));
    const bounds = fields.map(field => field.getBoundingClientRect());
    const readonly = fields.every(field => field.readOnly);
    const initialOverlays = document.querySelectorAll('.editor .HLter').length;
    status.textContent = `${fields.length} text fields visible; read-only: ${readonly}; highlight layers: ${initialOverlays}.`;
    const opened = await pending;
    await this.$nextTick();
    requestAnimationFrame(() => {
      const rows = document.querySelectorAll('.side .dictRow').length;
      const currentFields = Array.from(document.querySelectorAll('.editor .textHL input, .editor .textHL textarea'));
      const kept = fields.filter((field, index) => field === currentFields[index]).length;
      const shift = Math.max(0, ...fields.map((field, index) => {
        const now = field.getBoundingClientRect(), before = bounds[index];
        return Math.max(Math.abs(now.x - before.x), Math.abs(now.y - before.y), Math.abs(now.width - before.width), Math.abs(now.height - before.height));
      }));
      status.textContent = opened
        ? `Text visible in ${Math.round(paint)} ms; kept ${kept}/${fields.length} fields; largest field shift ${Math.round(shift)} px; ready in ${Math.round(performance.now() - start)} ms; ${rows} dictionary rows of ${this.dictionary.length}.`
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
