// Disposable real-app presentation checks. Test mode avoids account/IndexedDB
// startup; synthetic ClientText fields exercise the current root controllers.
'use strict';
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const express = require('express');
const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const publicDir = join(__dirname, '../public');
const { checkHighlightGeometry } = require('./highlight-geometry-browser-check.cjs');
const { checkInlineDictionaryScroll } = require('./dictionary-scroll-browser-check.cjs');
const { checkDiagnosticScanner } = require('./diagnostic-scanner-browser-check.cjs');
const { thaiEnglish, germanEnglish, germanTarget, dictionary: shredDictionary } = require('./clienttext-highlight-fixture.cjs');

async function checkPreviewDecorations(page, contentMode) {
  const raw = await page.evaluate(async contentMode => {
    const host = window.__sharedFixtureApp, clientText = contentMode === 'clienttext';
    const wrap = (tag, text) => clientText ? `<${tag}>{${text}}` : `<${tag}>{{${text}}}`;
    const text = label => wrap('italic', wrap('b', wrap('underline', wrap('rgb(12,34,56)',
      `Styled ${label} {0}% [Skill::{7}|` + wrap('unique', `Keyword ${label} {1}%`) + ']')))) + ' tail <unknown>{literal}';
    const source = text('Source'), target = text('Translation');
    window.__previewStyleSnapshot = { contentMode, hideSource: host.hideSourceInPreviewPanel };
    host.hideSourceInPreviewPanel = false;
    if (clientText) {
      const unit = host.ctCurrentUnit, field = host.ctPreviewField;
      Object.assign(window.__previewStyleSnapshot, { units: host.ctUnits, index: host._ctUnitIndex, values: host.ctValues, vars: host.ctPreviewGggVars });
      const replacement = Vue.markRaw({ ...unit, fields: unit.fields.map(item => item.id === field.id ? { ...item, source, target } : item) });
      host._ctUnitIndex = Vue.markRaw(new Map([[replacement.id, replacement]])); host.ctUnits = Vue.markRaw([replacement]);
      host.ctValues = { ...host.ctValues, [field.id]: target };
      await host.$nextTick(); host.ctPreviewGggVars = { '0': '37', '1': '23' };
    } else {
      const index = host.editorBlocks.findIndex(block => !block.isTable);
      if (index < 0) throw Error('The preview fixture needs an ordinary SD block.');
      const block = host.editorBlocks[index];
      Object.assign(window.__previewStyleSnapshot, { index, focused: host.editorFocusedIndex, english: block.english, translation: block.translation, vars: host.previewGggVars });
      block.english = source; block.translation = target; host.editorFocusedIndex = index;
      host.refreshGamePreview(); host.previewGggVars = { '0': '37', '1': '23' };
    }
    await host.$nextTick();
    return { source, target };
  }, contentMode);
  try {
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      const frames = await page.locator('.gamePreviewWindow').evaluateAll(elements => elements.map(frame => {
        const style = element => {
          const value = getComputedStyle(element);
          return { text: element.textContent, italic: value.fontStyle, weight: value.fontWeight, underline: value.textDecorationLine, color: value.color };
        };
        return { text: frame.textContent, styled: style(frame.querySelector(':scope > .gamePreviewText')),
          variable: style(frame.querySelector(':scope > .gamePreviewVarDisplay')),
          keyword: style(frame.querySelector('.gamePreviewKw .gamePreviewText')),
          keywordVariable: style(frame.querySelector('.gamePreviewKw .gamePreviewVarDisplay')),
          tail: style([...frame.querySelectorAll(':scope > .gamePreviewText')].at(-1)) };
      }));
      assert.equal(frames.length, 2, contentMode + '/' + theme);
      for (const [index, frame] of frames.entries()) {
        const label = index ? 'Translation' : 'Source', message = contentMode + '/' + theme + '/' + label;
        assert.equal(frame.styled.text, 'Styled ' + label + ' ', message);
        for (const value of [frame.styled, frame.variable, frame.keyword, frame.keywordVariable]) {
          assert.equal(value.italic, 'italic', message);
          assert.ok(Number(value.weight) >= 700, message + ': bold style composes');
          assert.ok(value.underline.includes('underline'), message + ': underline style composes');
        }
        assert.equal(frame.styled.color, 'rgb(12, 34, 56)', message);
        assert.equal(frame.variable.color, 'rgb(12, 34, 56)', message);
        assert.equal(frame.keyword.color, 'rgb(175, 96, 37)', message + ': inner named color overrides outer RGB');
        assert.equal(frame.keywordVariable.color, 'rgb(175, 96, 37)', message);
        assert.equal(frame.variable.text, '37%', message);
        assert.equal(frame.keywordVariable.text, '23%', message);
        assert.ok(frame.text.includes('tail <unknown>{literal}'), message + ': unsupported tags remain visible');
        assert.equal(frame.tail.italic, 'normal', message + ': typography ends at its wrapper');
      }
    }
    const preserved = await page.evaluate(contentMode => {
      const host = window.__sharedFixtureApp;
      return contentMode === 'clienttext' ? { source: host.ctPreviewField.source, target: host.ctValues[host.ctPreviewField.id] }
        : { source: host.editorBlocks[host.editorFocusedIndex].english, target: host.editorBlocks[host.editorFocusedIndex].translation };
    }, contentMode);
    assert.deepEqual(preserved, raw, contentMode + ': rendered preview retains exact original tags');
  } finally {
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp, saved = window.__previewStyleSnapshot;
      host.hideSourceInPreviewPanel = saved.hideSource;
      if (saved.contentMode === 'clienttext') {
        host._ctUnitIndex = saved.index; host.ctUnits = saved.units; host.ctValues = saved.values; host.ctPreviewGggVars = saved.vars;
      } else {
        host.editorBlocks[saved.index].english = saved.english; host.editorBlocks[saved.index].translation = saved.translation;
        host.editorFocusedIndex = saved.focused; host.refreshGamePreview(); host.previewGggVars = saved.vars;
      }
      delete window.__previewStyleSnapshot; await host.$nextTick();
    });
  }
  console.log(contentMode + ' source/translation nested preview styles, variables, keyword text and raw tags passed in all four desktop themes.');
}

async function checkPreviewLineBreaks(page, contentMode, surface = 'full', table = false) {
  const raw = await page.evaluate(async ({ contentMode, table }) => {
    const host = window.__sharedFixtureApp, ct = contentMode === 'clienttext';
    const wrap = (tag, text) => ct ? `<${tag}>{${text}}` : `<${tag}>{{${text}}}`;
    const text = (label, newline) => table ? ['', '', `LeftStart${label}`, '', `LeftDouble${label}`, '', '', `LeftTriple${label}`, `LeftSingle${label}`].join(newline)
      + '@' + ['', '', `RightStart${label}`, '', `RightDouble${label}`, '', '', `RightTriple${label}`, `RightSingle${label}`].join(newline)
      : [`PlainStart${label}`, '', `PlainDouble${label}`, '', '', `PlainTriple${label}`, `PlainSingle${label}`,
      wrap('i', wrap('bold', `NestedStart${label}${newline}${newline}NestedDouble${label}`)),
      `[Skill|KeyStart${label}${newline}${newline}KeyDouble${label}]`, ...(ct ? [`Literal${label}\\nLiteralEnd${label}`] : [])].join(newline);
    const source = text('Source', '\r\n'), target = text('Translation', '\n');
    const saved = { contentMode, hideSource: host.hideSourceInPreviewPanel };
    window.__previewLineSnapshot = saved; host.hideSourceInPreviewPanel = false;
    if (ct) {
      const unit = host.ctCurrentUnit, field = host.ctPreviewField;
      Object.assign(saved, { units: host.ctUnits, index: host._ctUnitIndex, values: host.ctValues });
      const replacement = Vue.markRaw({ ...unit, fields: unit.fields.map(item => item.id === field.id ? { ...item, source, target } : item) });
      host._ctUnitIndex = Vue.markRaw(new Map([[replacement.id, replacement]])); host.ctUnits = Vue.markRaw([replacement]);
      host.ctValues = { ...host.ctValues, [field.id]: target };
    } else {
      const index = host.editorBlocks.findIndex(block => !block.isTable), block = host.editorBlocks[index];
      Object.assign(saved, { index, focused: host.editorFocusedIndex, english: block.english, translation: block.translation });
      block.english = source; block.translation = target; host.editorFocusedIndex = index; host.refreshGamePreview();
    }
    await host.$nextTick(); return { source, target };
  }, { contentMode, table });
  try {
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      const frames = await page.locator('.gamePreviewWindow').evaluateAll((elements, table) => elements.map((frame, index) => {
        const label = index ? 'Translation' : 'Source', walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT), nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        const top = word => {
          const node = nodes.find(node => node.textContent.includes(word));
          if (!node) throw Error('Missing preview word ' + word);
          const offset = node.textContent.indexOf(word), range = document.createRange();
          range.setStart(node, offset); range.setEnd(node, offset + word.length); return range.getBoundingClientRect().top;
        };
        const gap = (before, after) => top(after + label) - top(before + label);
        const value = getComputedStyle(frame), lineHeight = Number.parseFloat(value.lineHeight);
        if (table) return { lineHeight, single: gap('LeftTriple', 'LeftSingle'), double: gap('LeftStart', 'LeftDouble'), triple: gap('LeftDouble', 'LeftTriple'),
          rightDouble: gap('RightStart', 'RightDouble'), rightTriple: gap('RightDouble', 'RightTriple'),
          leading: nodes.find(node => node.textContent.includes('LeftStart' + label)).parentElement.getBoundingClientRect().top
            - frame.getBoundingClientRect().top - Number.parseFloat(value.paddingTop) - Number.parseFloat(value.borderTopWidth),
          alignment: top('LeftStart' + label) - top('RightStart' + label) };
        return { lineHeight,
          single: gap('PlainTriple', 'PlainSingle'), double: gap('PlainStart', 'PlainDouble'), triple: gap('PlainDouble', 'PlainTriple'),
          nested: gap('NestedStart', 'NestedDouble'), keyword: gap('KeyStart', 'KeyDouble'),
          literal: frame.textContent.includes('Literal' + label + '\\nLiteralEnd' + label) };
      }), table);
      assert.equal(frames.length, 2, contentMode + '/' + surface + '/' + theme);
      for (const [index, frame] of frames.entries()) {
        const message = contentMode + '/' + surface + '/' + theme + '/' + (index ? 'Translation LF' : 'Source CRLF');
        const gaps = table ? [['single', 1], ['double', 2], ['triple', 3], ['rightDouble', 2], ['rightTriple', 3]]
          : [['single', 1], ['double', 2], ['triple', 3], ['nested', 2], ['keyword', 2]];
        for (const [name, lines] of gaps) {
          assert.ok(Math.abs(frame[name] - lines * frame.lineHeight) < 1, message + ': ' + name + ' line gap ' + frame[name] + ' equals ' + lines + ' lines of ' + frame.lineHeight);
        }
        if (table) {
          assert.ok(Math.abs(frame.leading - 2 * frame.lineHeight) < 1, message + ': two leading empty table rows retain height (' + frame.leading + 'px)');
          assert.ok(Math.abs(frame.alignment) < 1, message + ': columns remain aligned');
        }
        if (contentMode === 'clienttext') assert.equal(frame.literal, true, message + ': literal backslash-n remains text');
      }
    }
    assert.deepEqual(await page.evaluate(contentMode => {
      const host = window.__sharedFixtureApp;
      return contentMode === 'clienttext' ? { source: host.ctPreviewField.source, target: host.ctValues[host.ctPreviewField.id] }
        : { source: host.editorBlocks[host.editorFocusedIndex].english, target: host.editorBlocks[host.editorFocusedIndex].translation };
    }, contentMode), raw, contentMode + '/' + surface + ': line-break rendering preserves raw text');
  } finally {
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp, saved = window.__previewLineSnapshot;
      host.hideSourceInPreviewPanel = saved.hideSource;
      if (saved.contentMode === 'clienttext') { host._ctUnitIndex = saved.index; host.ctUnits = saved.units; host.ctValues = saved.values; }
      else {
        Object.assign(host.editorBlocks[saved.index], { english: saved.english, translation: saved.translation });
        host.editorFocusedIndex = saved.focused; host.refreshGamePreview();
      }
      delete window.__previewLineSnapshot; await host.$nextTick();
    });
  }
  console.log(contentMode + '/' + surface + ' source/translation consecutive preview line breaks' + (table ? ' and empty table rows' : ', nested styles and keyword labels') + ' passed in all four desktop themes.');
}

async function run() {
  assert.ok(executablePath, 'Set FIXTURE_BROWSER_PATH to installed Edge/Chrome.');
  const serverApp = express();
  serverApp.get('/', (_req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
  serverApp.get('/fixture/jszip.min.js', (_req, res) => res.type('js').send(readFileSync(require.resolve('jszip/dist/jszip.min.js', { paths: [runtimeModules] }))));
  serverApp.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(publicDir, 'index.js'), 'utf8')
    .replace("app.mount('#app');", "window.__sharedFixtureApp=app.mount('#app');")));
  serverApp.use(express.static(publicDir));
  const server = await new Promise(resolve => { const instance = serverApp.listen(0, '127.0.0.1', () => resolve(instance)); });
  let browser, page;
  const failures = [];
  try {
    browser = await chromium.launch({ executablePath, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) failures.push(message.text()); });
    await page.goto('http://127.0.0.1:' + server.address().port + '/?testMode=1&lang=Thai', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!window.__sharedFixtureApp);
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp;
      host.showSetting = false; host.needsInitialSettings = false; host.versionChooserVisible = false;
      host.gameVersion = 'poe2'; host.loadingProgress = 100; host.inlineEditor = false;
      if (!host.descs.length) host.loadDummyData();
      await host.editFile(host.descs[0].filepath);
    });
    await page.waitForSelector('.editor [data-editor-ref="translation_1"]:not([readonly])');
    console.log('SD full editor and native fields mounted.');
    if (process.env.SDEDITOR_SCANNER_ONLY === '1') {
      await checkDiagnosticScanner(page); assert.deepEqual(failures, []); return;
    }
    await checkPreviewDecorations(page, 'statdescription');
    await checkPreviewLineBreaks(page, 'statdescription');
    await checkPreviewLineBreaks(page, 'statdescription', 'table', true);
    const sd = page.locator('.editor [data-editor-ref="translation_1"]');
    await sd.fill('SD retained draft');
    await page.locator('.sharedEditorSidebar').getByRole('button', { name: 'Lookup', exact: true }).click();
    await page.locator('#editorLookupSearch').fill('Damage');
    await page.locator('#editorLookupSearch').press('Enter');
    assert.equal(await sd.inputValue(), 'SD retained draft');
    await page.locator('#editorLookupSearch').press('Control+s');
    assert.equal(await sd.inputValue(), 'SD retained draft');
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      assert.equal(await page.locator('.sharedEditorSidebar').count(), 1);
      const box = await page.locator('.sharedEditorSidebar').boundingBox();
      assert.ok(box && box.width > 250 && box.x + box.width <= 1441, theme);
    }
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp;
      host.sideTab = 'dictionary'; await host.$nextTick();
    });
    await sd.focus(); await sd.press('Control+Space');
    await page.waitForSelector('.hlPopupFilter');
    await page.locator('.hlPopupFilter').press('Escape');
    assert.equal(await sd.inputValue(), 'SD retained draft');
    assert.equal(await sd.evaluate(input => input === document.activeElement), true);

    const dictionaryGeometry = async () => page.locator('.dictionaryEntries .editBlock[data-dict-id="fixture-shared"]').evaluate(element => {
      const rect = input => { const value = input.getBoundingClientRect(); return { width: value.width, height: value.height, top: value.top }; };
      return { main: [...element.querySelectorAll('.dictRow > input')].map(rect),
        alternate: [...element.querySelectorAll('.dictAltRow > input')].map(rect),
        useButtons: element.querySelectorAll('.dictUseBtn').length };
    });
    const sdDictionary = new Map();
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp;
      host.dictionary = [{ _id: 'fixture-shared', find: 'AbyssThread', replace: 'Abgrund-Faden', game: 'all', tlnote: '',
        alts: [{ _id: 'fixture-alternate', find: 'Abyss Threads', replace: 'Abgrund-Fäden' }] }];
      host.dictionaryFilter = ''; await host.$nextTick();
    });
    await page.waitForSelector('.dictionaryEntries .editBlock[data-dict-id="fixture-shared"]');
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) for (const width of [1440, 1100, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => { document.documentElement.setAttribute('data-theme', theme); }, theme);
      sdDictionary.set(theme + '/' + width, await dictionaryGeometry());
    }

    let alignedGlyphs = 0;
    await page.evaluate(async ({ source, target }) => {
      const host = window.__sharedFixtureApp, table = host.editorBlocks[0];
      table.tableColumns[0].english = source + '\n\t[Attack] repeated tabbed source';
      table.tableColumns[0].translation = target + '\n\t[Attack|Angriff] repeated tabbed translation';
      table.tableColumns[0].isMultiline = true;
      table.tableColumns[1].english = '[Poison] native horizontal scrolling ' + 'long input words '.repeat(12);
      table.tableColumns[1].translation = '[Poison|Gift] native horizontal scrolling ' + 'long input words '.repeat(12);
      host.editorBlocks[1].english = source + '\n[Trigger] second native line';
      host.editorBlocks[1].translation = target + '\n[Trigger|löst] second native line';
      host.refreshEditorBlockHLter(0); host.refreshEditorBlockHLter(1);
      await host.$nextTick(); host.autosizeEditorMultilineFields();
    }, { source: germanEnglish, target: germanTarget });
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) for (const width of [1440, 1100, 1001]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      alignedGlyphs += await checkHighlightGeometry(page, '.editor .editorTextField > input, .editor .editorTextField > textarea', 'SD ' + theme + '/' + width);
    }
    await page.evaluate(() => {
      for (const input of document.querySelectorAll('.editor .editorTextField > textarea')) {
        input.style.height = '90px'; input.scrollTop = Math.min(40, input.scrollHeight - input.clientHeight); input.dispatchEvent(new Event('scroll'));
      }
      for (const input of document.querySelectorAll('.editor .editorTextField > input')) {
        input.scrollLeft = 80; input.dispatchEvent(new Event('scroll'));
      }
    });
    alignedGlyphs += await checkHighlightGeometry(page, '.editor .editorTextField > input, .editor .editorTextField > textarea', 'SD native scroll');
    console.log('SD multiline/table wrapping, native input/textarea scrolling and all four themes aligned.');
    await checkInlineDictionaryScroll(page, 'statdescription', { requireScrollRetention: true });

    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp;
      await host.editorExit();
      const source = '[Fire] [Fire|Burning] {0} <<icon>> raw @ literal\\n';
      const field = { id: 'text-field', kind: 'text', name: 'Text', source, target: 'raw @ literal\\n\nactual',
        targetCell: 'B2', required: true, originalMissing: false, outdated: false };
      const unit = Vue.markRaw({ id: 'normal|Sheet|record', role: 'normal', sheet: 'Sheet', recordId: 'record', fields: [field], developerNotes: 'Developer note', notes: [] });
      host.ctWorkspace = { scope: { accountId: 'guest', game: 'poe2', branchId: 'default', versionId: 'fixture', groupId: 'local:fixture', language: 'Thai' },
        metadata: { version: { name: 'Fixture' }, descriptors: [{ role: 'normal', baselineId: 'a'.repeat(64) }] } };
      host.ctUnits = Vue.markRaw([unit]); host._ctUnitIndex = Vue.markRaw(new Map([[unit.id, unit]])); host._ctWorkUnits = Vue.markRaw(new Map());
      host.ctSelection = unit.id; host.ctFocusedField = field.id; host.ctValues = { [field.id]: field.target };
      host.ctSaved = {}; host.ctReviewed = {}; host.ctEditor = true; host.ctActive = true;
      host.ctInitializing = false; host.ctBusy = false; host.ctTool = 'dictionary'; host.ctQueueDraft = () => {};
      host.ctFlushDraft = async () => true; host.ctQueueCommentDraft = () => {};
      host.ctFlushCommentDraft = async () => {}; host.ctLoadComments = async () => {};
      host.ctFieldGroups; await host.$nextTick();
    });
    await page.waitForSelector('.ctFullEditor [data-ct-target="text-field"]');
    console.log('ClientText full editor and native fields mounted.');
    await checkPreviewDecorations(page, 'clienttext');
    await checkPreviewLineBreaks(page, 'clienttext');
    const ct = page.locator('.ctFullEditor [data-ct-target="text-field"]');
    assert.equal(await ct.inputValue(), 'raw @ literal\\n\nactual');
    assert.ok(await page.locator('.ctFullEditor .HLter [data-ct-hl]').count() >= 3);
    await page.waitForSelector('.dictionaryEntries .editBlock[data-dict-id="fixture-shared"]');
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) for (const width of [1440, 1100, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => new Promise(resolve => {
        document.documentElement.setAttribute('data-theme', theme); requestAnimationFrame(() => requestAnimationFrame(resolve));
      }), theme);
      const name = theme + '/' + width, dictionary = await dictionaryGeometry(), reference = sdDictionary.get(name);
      assert.equal(dictionary.useButtons, 0, name + ': ClientText Dictionary keeps the SD controls');
      for (const row of ['main', 'alternate']) {
        assert.equal(dictionary[row].length, 2);
        assert.ok(Math.abs(dictionary[row][0].top - dictionary[row][1].top) < 1, name + ': Dictionary inputs retain one row');
        for (const [index, input] of dictionary[row].entries()) {
          assert.ok(Math.abs(input.height - reference[row][index].height) < 1, name + ': Dictionary row height matches SD');
          assert.ok(Math.abs(input.width - reference[row][index].width) < 1, name + ': Dictionary input width matches SD');
        }
      }
      const layout = await page.locator('.ctFullFieldPair').evaluate(element => {
        const rect = node => { const value = node.getBoundingClientRect(); return { left: value.left, right: value.right, top: value.top, width: value.width }; };
        const header = document.querySelector('.ctEditorActions'), actions = header.querySelector('.ctEditorActionButtons');
        return { source: rect(element.querySelector('.ctFieldSource')), target: rect(element.querySelector('.ctFieldTranslation')),
          pair: rect(element), editor: rect(element.closest('.edit')), actions: rect(actions), header: rect(header),
          buttons: [...actions.children].map(rect) };
      });
      assert.ok(layout.source.right <= layout.target.left, name + ': full editor places English left of translation');
      assert.ok(Math.abs(layout.source.width - layout.target.width) < 1, name + ': full field columns have equal width');
      assert.ok(Math.abs(layout.source.top - layout.target.top) < 1, name + ': full fields are top aligned');
      assert.ok(layout.pair.left >= layout.editor.left && layout.pair.right <= layout.editor.right, name + ': full fields remain in the edit pane');
      assert.ok(layout.actions.right <= layout.header.right + 1, name + ': header actions fit their pane');
      for (let index = 1; index < layout.buttons.length; index++) {
        const before = layout.buttons[index - 1], after = layout.buttons[index];
        if (Math.abs(before.top - after.top) < 1) assert.ok(after.left - before.right >= 0 && after.left - before.right < 12, name + ': header actions remain grouped');
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    const keywordOriginal = 'Before\r\nselected\r\nAfter', keywordInserted = 'Before\r\n[Fire|ไฟ]\r\nAfter';
    await page.evaluate(async original => {
      const host = window.__sharedFixtureApp; host.ctValues['text-field'] = original; await host.$nextTick();
      const input = document.querySelector('.ctFullEditor [data-ct-target="text-field"]');
      input.focus(); input.setSelectionRange(7, 15);
    }, keywordOriginal);
    await ct.press('Control+Space'); await page.waitForSelector('.hlPopupFilter');
    await page.locator('.hlPopupFilter').fill('Fire');
    assert.equal(await page.locator('.hlPopupItem.active.mustCreate').count(), 1, 'missing keyword uses the SD Dictionary creation action');
    assert.ok(await page.locator('.ctFieldSource .hlPopupActive').count() > 0, 'selected keyword highlights its exact English source');
    await page.locator('.hlPopupFilter').fill('{0}');
    assert.match((await page.locator('.ctFieldSource .hlPopupActive').allTextContents()).join(''), /\{0\}/, 'filter selection moves the English highlight');
    await page.locator('.hlPopupFilter').fill('Fire'); await page.locator('.hlPopupFilter').press('Enter');
    await page.waitForFunction(() => document.activeElement?.placeholder === 'Replace');
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), keywordOriginal, 'creating a missing Dictionary entry retains the captured translation');
    const fireId = await page.evaluate(() => window.__sharedFixtureApp.dictionary.find(word => word.find === 'Fire')._id);
    const fireReplace = page.locator('.dictRow[data-dict-id="' + fireId + '"] input[placeholder="Replace"]');
    assert.equal(await fireReplace.evaluate(input => input === document.activeElement), true);
    await fireReplace.fill('ไฟ'); await fireReplace.press('Enter');
    assert.equal(await ct.inputValue(), keywordInserted.replace(/\r\n/g, '\n'));
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), keywordInserted, 'Replace Enter inserts at the captured selection and retains raw CRLF');
    assert.equal(await ct.evaluate(input => input === document.activeElement), true);
    await ct.press('Control+z');
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), keywordOriginal, 'Dictionary return insertion retains native Undo and exact raw CRLF');
    await ct.press('Control+y');
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), keywordInserted, 'Dictionary return insertion retains native Redo');
    await ct.fill('Existing '); await ct.focus(); await ct.press('Control+Space');
    await page.waitForSelector('.hlPopupFilter'); await page.locator('.hlPopupFilter').fill('Fire');
    assert.equal(await page.locator('.hlPopupItem.active.mustCreate').count(), 0);
    assert.equal(await page.locator('.dictRow[data-dict-id="' + fireId + '"].hlPopupDictActive').count(), 1, 'selected exact replacement highlights its Dictionary row');
    await page.locator('.hlPopupFilter').press('Enter');
    assert.equal(await ct.inputValue(), 'Existing [Fire|ไฟ]', 'Enter inserts an existing exact pair directly');
    assert.equal(await ct.evaluate(input => input === document.activeElement), true);
    await ct.fill('Edit '); await ct.focus(); await ct.press('Control+Space');
    await page.waitForSelector('.hlPopupFilter'); await page.locator('.hlPopupFilter').fill('Fire');
    await page.locator('.hlPopupFilter').press('Control+Enter');
    await page.waitForFunction(() => document.activeElement?.placeholder === 'Replace');
    assert.equal(await fireReplace.evaluate(input => input === document.activeElement), true, 'Ctrl+Enter opens the existing Dictionary replacement');
    await fireReplace.fill('ไฟใหม่'); await fireReplace.press('Enter');
    assert.equal(await ct.inputValue(), 'Edit [Fire|ไฟใหม่]', 'Replace Enter returns to the captured existing-entry caret');
    assert.equal(await ct.evaluate(input => input === document.activeElement), true);
    await ct.fill('Alternate '); await ct.focus(); await ct.press('Control+Space');
    await page.waitForSelector('.hlPopupFilter'); await page.locator('.hlPopupFilter').fill('Burning');
    assert.equal(await page.locator('.hlPopupItem.active.mustCreate').count(), 1, 'missing keyword alternatives use the Dictionary creation action');
    await page.locator('.hlPopupFilter').press('Enter');
    await page.waitForFunction(() => document.activeElement?.closest('.dictAltRow'));
    const fireAltId = await page.evaluate(() => window.__sharedFixtureApp.dictionary.find(word => word.find === 'Fire').alts.find(alt => alt.find === 'Burning')._id);
    const fireAltReplace = page.locator('.dictAltRow[data-dict-alt-id="' + fireAltId + '"] input[placeholder="Replace"]');
    assert.equal(await fireAltReplace.evaluate(input => input === document.activeElement), true);
    await fireAltReplace.fill('ไฟแรง'); await fireAltReplace.press('Enter');
    assert.equal(await ct.inputValue(), 'Alternate [Fire|ไฟแรง]', 'alternate Replace Enter returns to the captured caret');
    await ct.press('Control+Space'); await page.waitForSelector('.hlPopupFilter'); await page.locator('.hlPopupFilter').fill('Burning');
    assert.equal(await page.locator('.dictAltRow[data-dict-alt-id="' + fireAltId + '"].hlPopupDictActive').count(), 1, 'selected alternate highlights its exact Dictionary row');
    await page.locator('.hlPopupFilter').press('Escape');
    console.log('ClientText missing and existing Dictionary actions, source/row highlights, caret return and native Undo/Redo passed.');
    await ct.fill('kept raw @ literal\\n\ntranslation');
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), 'kept raw @ literal\\n\ntranslation');
    await ct.focus(); await ct.press('Control+Space');
    await page.waitForSelector('.hlPopupFilter');
    await page.locator('.hlPopupFilter').press('Escape');
    assert.equal(await ct.inputValue(), 'kept raw @ literal\\n\ntranslation');
    assert.equal(await ct.evaluate(input => input === document.activeElement), true);
    const undoOriginal = 'Original\r\nsecond@literal\\n\r\nthird', undoReplacement = 'Replacement\r\nraw@literal\\n';
    await page.evaluate(async ({ original, replacement }) => {
      const host = window.__sharedFixtureApp, field = host.ctCurrentUnit.fields[0];
      host.ctValues[field.id] = original; await host.$nextTick();
      const input = document.querySelector('.ctFullEditor [data-ct-target="text-field"]');
      if (!EditorSession.insert(host, field, replacement, { input, whole: true })) throw Error('Native replacement rejected');
      await host.$nextTick();
    }, { original: undoOriginal, replacement: undoReplacement });
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), undoReplacement);
    await ct.press('Control+z');
    assert.equal(await ct.inputValue(), undoOriginal.replace(/\r\n/g, '\n'));
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), undoOriginal, 'native Undo retains exact removed CRLF');
    await ct.press('Control+y');
    assert.equal(await ct.inputValue(), undoReplacement.replace(/\r\n/g, '\n'));
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.ctValues['text-field']), undoReplacement, 'native Redo retains exact inserted CRLF');
    await ct.fill('kept raw @ literal\\n\ntranslation');
    await page.locator('.sharedEditorSidebar').getByRole('button', { name: 'Lookup', exact: true }).click();
    assert.equal(await page.locator('#editorLookupSearch').evaluate(input => input === document.activeElement), true);
    await page.locator('#editorLookupSearch').fill('raw'); await page.locator('#editorLookupSearch').press('Enter');
    assert.equal(await ct.inputValue(), 'kept raw @ literal\\n\ntranslation');
    await page.locator('.sharedEditorSidebar').getByRole('button', { name: 'TM', exact: true }).click();
    assert.equal(await page.locator('.sharedEditorSidebar').getByRole('button', { name: 'Manage TM', exact: true }).count(), 0);
    await page.locator('.sharedEditorSidebar').getByRole('button', { name: /History/ }).click();
    assert.equal(await page.locator('.ctHistoryPanel').count(), 1);
    await page.locator('.sharedEditorSidebar').getByRole('button', { name: 'Comments', exact: true }).click();
    assert.equal(await page.locator('.fileCommentsPanel').count(), 1);
    assert.match(await page.locator('.fileCommentsPanel').innerText(), /Shared comments are unavailable in test mode/);
    assert.equal(await page.locator('#ctFullEditorPreviewHost .gamePreviewWindow').count(), 2);
    await page.evaluate(async () => {
      const host = window.__sharedFixtureApp;
      window.__fixtureToolsNode = document.querySelector('.sharedEditorSidebar');
      window.__fixturePreviewNode = document.querySelector('.gamePreviewStrip');
      // The fixture validates presentation without staging its synthetic unit.
      host.ctSave = async () => true;
      host.saveSettings = async () => true;
      host.ctInlineFocusOut = () => {};
      host.inlineEditor = true; host.inlineSidebarVisible = true; host.ctEditor = false; host.ctInlineClosed = false;
      host.ctSelectedFilters = ['unchanged', 'missing', 'saved', 'outdated']; host.ctTool = 'preview';
      await host.$nextTick();
    });
    await page.waitForSelector('.ctListWorkspace [data-ct-target="text-field"]');
    assert.equal(await page.locator('#ctInlineEditorSidebarHost .sharedEditorSidebar').count(), 1);
    assert.equal(await page.locator('#inlineEditorPreviewHost .gamePreviewWindow').count(), 2);
    assert.equal(await page.evaluate(() => document.querySelector('.sharedEditorSidebar') === window.__fixtureToolsNode), true);
    assert.equal(await page.evaluate(() => document.querySelector('.gamePreviewStrip') === window.__fixturePreviewNode), true);
    await checkPreviewLineBreaks(page, 'clienttext', 'inline');
    assert.equal(await page.locator('.ctListWorkspace [data-ct-target="text-field"]').inputValue(), 'kept raw @ literal\\n\ntranslation');
    await page.locator('.ctListWorkspace').getByRole('button', { name: 'Show all comments', exact: true }).click();
    assert.equal(await page.locator('#allCommentsSidebar').count(), 1);
    await page.locator('#allCommentsSidebar').getByRole('button', { name: 'Close all comments', exact: true }).click();
    await page.evaluate(async () => { const host = window.__sharedFixtureApp; host.ctEditor = true; await host.$nextTick(); });
    assert.equal(await page.locator('#ctFullEditorSidebarHost .sharedEditorSidebar').count(), 1);
    assert.equal(await page.evaluate(() => document.querySelector('.sharedEditorSidebar') === window.__fixtureToolsNode), true);
    assert.equal(await page.locator('.ctFullEditor [data-ct-target="text-field"]').inputValue(), 'kept raw @ literal\\n\ntranslation');
    await page.evaluate(async ({ source, newerSource, target, words }) => {
      const host = window.__sharedFixtureApp;
      const fields = [
        { id: 'shred-description', kind: 'text', name: 'Description', source, target, required: true, targetCell: 'B2' },
        { id: 'shred-short', kind: 'text', name: 'Newer source / tabs', source: newerSource + '\r\n\t[Attack] tabbed line', target: newerSource + '\r\n\t[Attack] tabbed line', required: true, targetCell: 'C2' },
      ];
      const unit = Vue.markRaw({ id: 'normal|ActiveSkills|shred', role: 'normal', sheet: 'ActiveSkills', recordId: 'shred', fields, developerNotes: 'Reported ActiveSkills/shred geometry' });
      host.ctUnits = Vue.markRaw([unit]); host._ctUnitIndex = Vue.markRaw(new Map([[unit.id, unit]]));
      host.ctSelection = unit.id; host.ctFocusedField = fields[0].id; host.ctValues = Object.fromEntries(fields.map(field => [field.id, field.target]));
      host.dictionary = words.map(word => ({ ...word, game: 'all', tlnote: '' })); host.ctTool = 'dictionary'; host.ctDictionaryFilter = '';
      await host.$nextTick(); host.ctResizeFields(); await host.scheduleClientTextDictionaryMatches();
    }, { source: germanEnglish, newerSource: thaiEnglish, target: germanTarget, words: shredDictionary });
    await page.waitForSelector('.ctFullEditor [data-ct-target="shred-description"]');
    await page.waitForFunction(() => window.__sharedFixtureApp.ctDictionaryPack?.units?.some(unit => unit.key === 'shred-description'
      && unit.english === window.__sharedFixtureApp.ctCurrentUnit.fields[0].source && unit.HLs?.some(hl => hl.dictId === 'shift')));
    const shredTarget = page.locator('.ctFullEditor [data-ct-target="shred-description"]');
    const shredSourceTag = page.locator('.ctFullEditor [data-ct-source="shred-description"]').locator('..').locator('[data-ct-hl]').filter({ hasText: '[Shapeshift]' }).first();
    await shredTarget.focus(); await shredTarget.evaluate(input => input.setSelectionRange(0, 0));
    await shredSourceTag.click();
    assert.equal(await shredTarget.inputValue(), '[Shapeshift|Verwandelt]' + germanTarget, 'source pointer click pastes its exact prepared keyword through the clipped overlay');
    await shredSourceTag.click({ modifiers: ['Alt'] });
    assert.equal(await page.evaluate(() => window.__sharedFixtureApp.editorClipboard), '[Shapeshift]', 'Alt-click copies the exact raw source tag through the inner highlight content');
    assert.equal(await shredTarget.inputValue(), '[Shapeshift|Verwandelt]' + germanTarget, 'Alt-click preserves the translation');
    await page.evaluate(async target => { const host = window.__sharedFixtureApp; host.ctValues['shred-description'] = target; await host.$nextTick(); host.ctResizeFields(); }, germanTarget);
    for (const surface of ['full', 'inline']) {
      await page.evaluate(async surface => {
        const host = window.__sharedFixtureApp; host.ctEditor = surface === 'full'; host.inlineEditor = surface === 'inline';
        host.ctInlineClosed = false; host.inlineSidebarVisible = true; await host.$nextTick(); host.ctResizeFields();
      }, surface);
      const selector = surface === 'full' ? '.ctFullEditor .editorTextField > textarea' : '.ctListWorkspace .editorTextField > textarea';
      for (const theme of ['light', 'grey', 'dark', 'modern-dark']) for (const width of [1440, 1100, 1001]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
        alignedGlyphs += await checkHighlightGeometry(page, selector, 'ClientText Shred ' + surface + ' ' + theme + '/' + width);
      }
      const pane = surface === 'full' ? '.ctFullEditor' : '.ctListWorkspace';
      const sourceInput = page.locator(pane + ' [data-ct-source="shred-description"]');
      const sourceFragment = sourceInput.locator('..').locator('[data-ct-hl]').filter({ hasText: '[IceFragment|Ice Fragments]' }).first();
      const targetInput = page.locator(pane + ' [data-ct-target="shred-description"]');
      await sourceInput.scrollIntoViewIfNeeded();
      await targetInput.evaluate(input => { input.focus({ preventScroll: true }); input.setSelectionRange(0, 0); });
      await sourceInput.evaluate(input => { input.scrollTop = input.scrollHeight - input.clientHeight; input.dispatchEvent(new Event('scroll')); });
      const fragmentPoint = await sourceFragment.evaluate(element => {
        const fragments = [...element.getClientRects()], box = fragments[fragments.length - 1];
        const native = element.closest('.textHL').querySelector('textarea'), rect = native.getBoundingClientRect();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        return { x, y, fragments: fragments.length, laterLine: box.top > rect.top + 30,
          hit: document.elementFromPoint(x, y)?.closest('[data-ct-hl]')?.textContent };
      });
      assert.ok(fragmentPoint.laterLine, surface + ': test source token is on a later wrapped line');
      assert.equal(fragmentPoint.hit, '[IceFragment|Ice Fragments]', surface + ': pointer hits the visible clipped source token ' + JSON.stringify(fragmentPoint));
      await page.mouse.click(fragmentPoint.x, fragmentPoint.y);
      assert.equal(await targetInput.inputValue(), '[IceFragment|Eisfragmente]' + germanTarget, surface + ': real pointer on later source line inserts exact translated tag at captured caret');
      await sourceInput.scrollIntoViewIfNeeded();
      const copyPoint = await sourceFragment.evaluate(element => {
        const boxes = [...element.getClientRects()], box = boxes[boxes.length - 1]; return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      await page.keyboard.down('Alt'); await page.mouse.click(copyPoint.x, copyPoint.y); await page.keyboard.up('Alt');
      assert.equal(await page.evaluate(() => window.__sharedFixtureApp.editorClipboard), '[IceFragment|Ice Fragments]', surface + ': real pointer Alt-click copies exact later-line source tag');
      await page.evaluate(async target => { const host = window.__sharedFixtureApp; host.ctValues['shred-description'] = target; await host.$nextTick(); host.ctResizeFields(); }, germanTarget);
      await page.evaluate(async () => { const host = window.__sharedFixtureApp; host.uiDensity = 'spacious'; await host.$nextTick(); host.ctResizeFields(); });
      alignedGlyphs += await checkHighlightGeometry(page, selector, 'ClientText Shred ' + surface + ' spacious density');
      await page.evaluate(async () => { const host = window.__sharedFixtureApp; host.uiDensity = 'compact'; await host.$nextTick(); host.ctResizeFields(); });
      await page.evaluate(selector => {
        for (const input of document.querySelectorAll(selector)) {
          input.style.height = '90px'; input.scrollTop = Math.min(60, input.scrollHeight - input.clientHeight); input.dispatchEvent(new Event('scroll'));
        }
      }, selector);
      alignedGlyphs += await checkHighlightGeometry(page, selector, 'ClientText Shred ' + surface + ' native scroll');
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(async () => { const host = window.__sharedFixtureApp; host.ctResizeFields(); await host.$nextTick(); });
      const path = join(tmpdir(), 'sdeditor-shred-' + surface + '.png');
      await page.screenshot({ path }); console.log('Shred screenshot: ' + path);
    }
    console.log('PASS ' + alignedGlyphs + ' annotated glyph positions: SD and Shred ClientText inline/full, four themes, resized desktop widths, native scrolling and tabs.');
    await checkInlineDictionaryScroll(page, 'clienttext', { negativeControl: true, requireScrollRetention: true });
    await checkDiagnosticScanner(page);
    const screenshot = join(tmpdir(), 'sdeditor-shared-components-clienttext.png');
    await page.screenshot({ path: screenshot }); console.log('Desktop screenshot: ' + screenshot);
    assert.deepEqual(failures, []);
    console.log('PASS real-app SD and ClientText shared fields, Tools, Preview, popup and focus; four desktop themes.');
  } catch (error) {
    console.error('Browser errors:', failures);
    if (page && !page.isClosed()) console.error('Editor state:', await page.evaluate(() => {
      const host = window.__sharedFixtureApp;
      return { editorVisible: host?.editorVisible, editorReady: host?.editorReady, editorLoadError: host?.editorLoadError,
        dictionaryWorkerError: host?.dictionaryWorkerError, cloudStorageError: host?.cloudStorageError,
        descs: host?.descs?.length, fields: [...document.querySelectorAll('[data-editor-ref]')].map(field => field.dataset.editorRef),
        sidebar: !!document.querySelector('.sharedEditorSidebar'), ctActive: host?.ctActive, ctEditor: host?.ctEditor,
        inlineEditor: host?.inlineEditor, ctInlineClosed: host?.ctInlineClosed, ctSelection: host?.ctSelection,
        ctRows: host?.ctPageRows?.map(unit => unit.id), ctCompletion: host?.ctCompletion,
        ctKeyboardBlocked: host?.ctKeyboardBlocked?.(), ctFocusedField: host?.ctFocusedField,
        ctDictionaryPack: host?.ctDictionaryPack?.units?.map(unit => ({ key: unit.key, english: unit.english, HLs: unit.HLs?.slice(0, 3) })),
        ctError: host?.ctError,
        ctTargets: [...document.querySelectorAll('[data-ct-target]')].map(input => ({id:input.dataset.ctTarget,value:input.value,readonly:input.readOnly,
          selection:[input.selectionStart,input.selectionEnd],active:input===document.activeElement,
          fieldSource:host?.ctCurrentUnit?.fields.find(field=>field.id===input.dataset.ctTarget)?.source,
          keyboardTarget:host?.ctKeyboardTarget?.(host?.ctCurrentUnit?.fields.find(field=>field.id===input.dataset.ctTarget),input)})) };
    }));
    throw error;
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
