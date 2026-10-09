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
  const rebuild = document.createElement('button'); rebuild.textContent = 'Rebuild while querying'; rebuild.disabled = true;
  rebuild.addEventListener('pointerdown', event => {
    if (document.activeElement?.matches('.editor .textHL input, .editor .textHL textarea')) event.preventDefault();
  });
  const metrics = document.createElement('pre'); metrics.style.cssText = 'white-space:pre-wrap;font:12px ui-monospace;margin:8px 0 0';
  const status = document.createElement('p'); status.textContent = 'Test data only. Load the dictionary, then open a file.';
  status.setAttribute('role', 'status');
  panel.append(seed, slow, finish, rebuild);
  for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
    const button = document.createElement('button'); button.textContent = theme;
    button.onclick = () => { editor.theme = theme; document.documentElement.setAttribute('data-theme', theme); };
    panel.append(button);
  }
  panel.append(status, metrics); document.body.append(panel);
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const until = async predicate => {
    const deadline = performance.now() + 30000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error('Fixture wait timed out');
      await pause(10);
    }
  };
  const percentile = (values, fraction) => {
    const ordered = values.slice().sort((left, right) => left - right);
    return ordered.length ? ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)] : 0;
  };
  seed.onclick = async () => {
    seed.disabled = true;
    metrics.textContent = '';
    editor.editorExit();
    const client = editor.ensureDictionaryWorker(), previousGeneration = client.readyGeneration;
    const started = performance.now();
    editor.dictionary = Array.from({ length: 19995 }, (_, i) => ({
      _id: 'fixture-' + i, find: `${['Arcane', 'Molten', 'Frozen', 'Venomous', 'Ancient'][i % 5]} ${i % 97} fixture term ${i}`, replace: 'คำแปล ' + i,
      alts: [{ _id: 'fixture-alt-' + i, find: `Variant ${i % 113} of fixture ${i}`, replace: 'คำแปลทางเลือก ' + i }], tlnote: '',
    })).concat([
      { _id: 'fixture-huge', find: 'ExceptionallyLongDefinition' + 'LongDefinitionSegment'.repeat(5000), replace: 'นิยามยาว', alts: [], tlnote: '' },
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
    status.textContent = 'Preparing the varied 20,000-entry snapshot, including alternates and a 100,000-character definition.';
    try {
      await until(() => client.readyGeneration > previousGeneration);
      rebuild.disabled = false;
      metrics.textContent = `Initial replacement build/publication: ${Math.round(performance.now() - started)} ms; detached capture: ${Math.round(editor._dictionarySnapshotCaptureMs || 0)} ms; serialization ${Number(client.serializationMs || 0).toFixed(1)} ms; transfer ${Math.round(client.transferMs || 0)} ms; ${client.fallback ? 'cooperative fallback' : 'worker'}.`;
      status.textContent = '20,000 entries ready. Relevant entries are at the end of the dictionary.';
    } catch (error) { status.textContent = error.message; }
    finally { seed.disabled = false; }
  };
  rebuild.onclick = async () => {
    rebuild.disabled = true;
    const client = editor.ensureDictionaryWorker(), initialGeneration = client.readyGeneration;
    const started = performance.now(), timings = [], generations = new Set(), frameGaps = [];
    let updatesFinished = false, running = true, lastFrame = performance.now(), busyReplies = 0;
    const frame = timestamp => {
      frameGaps.push(timestamp - lastFrame); lastFrame = timestamp;
      if (running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const fields = Array.from(document.querySelectorAll('.editor .textHL input, .editor .textHL textarea'));
    const fieldBounds = fields.map(field => field.getBoundingClientRect());
    const focused = document.activeElement;
    const selection = fields.includes(focused) && Number.isInteger(focused.selectionStart) && Number.isInteger(focused.selectionEnd)
      ? [focused.selectionStart, focused.selectionEnd] : null;
    const sourceTexts = ['[UnarmedDamage|Unarmed Damage] increases per Strength', 'Runes and Black Scythe Artifacts', 'Molten 1 fixture term 1 Variant 1 of fixture 1'];
    const settled = () => {
      const state = editor._dictionaryWorkerState;
      return !client.buildingGeneration && client.readyGeneration > initialGeneration
        && (!state || (!state.capturePromise && state.submittedSerial >= state.serial && client.readyGeneration >= state.generation));
    };
    const queries = (async () => {
      while (!updatesFinished || !settled()) {
        const begin = performance.now(), wasBuilding = !!client.buildingGeneration;
        const result = await client.match(sourceTexts.map((english, index) => ({ key: 'fixture-query-' + index, english })));
        timings.push(performance.now() - begin); generations.add(result.generation);
        if (wasBuilding && client.buildingGeneration) busyReplies++;
        await pause(5);
        if (performance.now() - started > 30000) throw new Error('Background query benchmark timed out');
      }
    })();
    status.textContent = 'Editing notes repeatedly while querying the completed snapshot. Type in the editor or use autocomplete during this run.';
    try {
      for (let index = 1; index <= 16; index++) {
        const row = editor.dictionary[editor.dictionary.length - 1];
        row.tlnote = 'Background fixture revision ' + index;
        editor.dictionaryEntryInput(row);
        await pause(35);
      }
      updatesFinished = true;
      await queries;
      await until(settled);
      const currentFields = Array.from(document.querySelectorAll('.editor .textHL input, .editor .textHL textarea'));
      const kept = fields.filter((field, index) => field === currentFields[index]).length;
      const shift = Math.max(0, ...fields.map((field, index) => {
        const bounds = field.getBoundingClientRect(), original = fieldBounds[index];
        return Math.max(Math.abs(bounds.x - original.x), Math.abs(bounds.y - original.y), Math.abs(bounds.width - original.width), Math.abs(bounds.height - original.height));
      }));
      const retainedSelection = selection
        ? document.activeElement === focused && focused.selectionStart === selection[0] && focused.selectionEnd === selection[1]
        : 'n/a (no focused text selection tracked)';
      metrics.textContent = `${timings.length} queries; p50 ${percentile(timings, .5).toFixed(1)} ms, p95 ${percentile(timings, .95).toFixed(1)} ms; ${busyReplies} replies completed while a build remained active.\nGenerations ${Array.from(generations).join(', ')}; settled after ${Math.round(performance.now() - started)} ms; last detached capture ${Math.round(editor._dictionarySnapshotCaptureMs || 0)} ms; serialization ${Number(client.serializationMs || 0).toFixed(1)} ms; transfer ${Math.round(client.transferMs || 0)} ms; largest frame gap ${Math.round(Math.max(0, ...frameGaps))} ms.\nKept ${kept}/${fields.length} input nodes; largest field shift ${Math.round(shift)} px; untouched focused selection retained: ${retainedSelection}.`;
      status.textContent = 'Background benchmark finished. Repeat in each theme and check popup suggestions remain stable until the popup closes.';
    } catch (error) { updatesFinished = true; status.textContent = error.message; await queries.catch(() => {}); }
    finally { running = false; rebuild.disabled = false; }
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
