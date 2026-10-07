const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEditor() {
  let config;
  const window = { location: { search: '' }, CloudUI: { mixin: {} } };
  const context = vm.createContext({
    window, URLSearchParams, console, setTimeout, clearTimeout,
    document: {
      createElement(tag) {
        assert.equal(tag, 'textarea');
        return {
          value: '',
          set innerHTML(value) {
            this.value = String(value).replace(/&(lt|gt|quot|#039|amp);/g, (_, entity) => ({ lt: '<', gt: '>', quot: '"', '#039': "'", amp: '&' })[entity]);
          },
        };
      },
    },
    Vue: {
      defineComponent(value) { config = value; return value; },
      createApp() { return { component() {}, directive() {}, mount() {} }; },
      nextTick(callback) { callback?.(); return Promise.resolve(); },
    },
  });
  for (const name of ['workspaceState.js', 'helper.js', 'regexEngine.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'), context, { filename: name });
  }
  const editor = Object.assign(config.data(), config.methods, {
    lang: 'Thai', hideDNT: false, selectedFileFilters: ['missing', 'saved', 'review', 'unchanged'], searchText: '',
    currentPage: 1, pageCount: 1, refreshGamePreview() {},
  });
  return { editor, context, window };
}

function fixtureDescription(english, translation) {
  return {
    filepath: 'test/render-safety.txt', filedir: 'test', filename: 'render-safety.txt',
    translations: { English: english, Thai: translation },
    hasChanges: true, isMissing: false, needsReview: false,
  };
}

function assertOnlyBreakMarkup(html) {
  assert.equal(html.replaceAll('<br />', '').includes('<'), false, 'User text must not produce HTML elements.');
  assert.equal(html.replaceAll('<br />', '').includes('>'), false, 'User text must not close or inject HTML elements.');
}

test('saved translation from a shared dictionary is escaped in the description list', () => {
  const { editor } = loadEditor();
  const attack = '<img src=x onerror="window.dictionaryAttack=1"> & "quoted"';
  editor.dictionary = [{ _id: 'd_fire', find: 'Fire', replace: attack, alts: [], tlnote: '' }];
  const block = { translationReplace: 'Damage: 🔖', translation: '', words: [{ captured: 'Fire', replace: '' }] };
  editor.doTranslationReplace(block, false);
  assert.equal(block.translation, 'Damage: ' + attack, 'The dictionary text must remain literal in the translation model.');
  editor.descs = [fixtureDescription(['Fire damage'], [block.translation])];
  editor.filterDesc();
  const html = editor.filteredDescs[0].translation;
  assert.equal(html, 'Damage: &lt;img src=x onerror=&quot;window.dictionaryAttack=1&quot;&gt; &amp; &quot;quoted&quot;');
  assertOnlyBreakMarkup(html);
});

test('description list escapes source and translation markup but preserves intended line breaks', () => {
  const { editor } = loadEditor();
  editor.descs = [fixtureDescription(
    ['<svg onload="window.sourceAttack=1">\\nnext', 'literal <br /> & second'],
    ['</span><script>window.translationAttack=1</script>', 'third\\nfourth']
  )];
  editor.filterDesc();
  const result = editor.filteredDescs[0];
  assert.equal(result.english, '&lt;svg onload=&quot;window.sourceAttack=1&quot;&gt;<br />next<br />literal &lt;br /&gt; &amp; second');
  assert.equal(result.translation, '&lt;/span&gt;&lt;script&gt;window.translationAttack=1&lt;/script&gt;<br />third<br />fourth');
  assertOnlyBreakMarkup(result.english);
  assertOnlyBreakMarkup(result.translation);
});

test('cached file-list text stays escaped and fresh after edits, array replacement, and language changes', () => {
  const { editor } = loadEditor();
  const desc = fixtureDescription(['First'], ['Original']);
  desc.translations.French = ['Autre']; editor.descs = [desc];
  editor.filterDesc(); editor.filterDesc();
  desc.translations.English[0] = '<source>\\nchanged';
  desc.translations.Thai[0] = '<img src=x> & new';
  editor.filterDesc();
  assert.equal(editor.filteredDescs[0].english, '&lt;source&gt;<br />changed');
  assert.equal(editor.filteredDescs[0].translation, '&lt;img src=x&gt; &amp; new');
  desc.translations.Thai.push('second'); editor.filterDesc();
  assert.equal(editor.filteredDescs[0].translation, '&lt;img src=x&gt; &amp; new<br />second');
  desc.translations.Thai = ['replacement']; editor.filterDesc();
  assert.equal(editor.filteredDescs[0].translation, 'replacement');
  editor.lang = 'French'; editor.filterDesc();
  assert.equal(editor.filteredDescs[0].translation, 'Autre');
  editor.lang = 'Thai'; editor.filterDesc();
  assert.equal(editor.filteredDescs[0].translation, 'replacement');
});

test('dictionary replacement cannot escape highlight attributes or insert markup', () => {
  const { editor } = loadEditor();
  const attack = '"><img src=x onerror="window.highlightAttack=1"><span data-x="';
  editor.highlightDict = true;
  editor.dictionary = [{ _id: 'd_fire', find: 'Fire', replace: attack, alts: [], tlnote: '<script>noteAttack()</script>' }];
  const result = editor.buildEnglishHLter('Fire');
  const attribute = /dataValue="([^"]*)"/.exec(result.englishHLter);
  assert.ok(attribute);
  assert.equal(attribute[1], '&quot;&gt;&lt;img src=x onerror=&quot;window.highlightAttack=1&quot;&gt;&lt;span data-x=&quot;');
  assert.equal((result.englishHLter.match(/<span\b/g) || []).length, 1);
  assert.equal((result.englishHLter.match(/<\/span>/g) || []).length, 1);
  assert.equal(result.englishHLter.replace(/<span\b[^>]*>|<\/span>/g, ''), 'Fire');
  assert.equal(result.HLs[0].replace, attack, 'Escaping must affect rendering only, not dictionary content.');
});

test('translation highlights and diagnostic tooltips escape text and attribute payloads', () => {
  const { editor } = loadEditor();
  const text = '<img src=x onerror="window.translationAttack=1">';
  const message = '"><svg onload="window.tooltipAttack=1">\nnext';
  const html = editor.buildTagHLter(text, [{ start: 0, end: text.length, level: 'warning', message }]);
  assert.equal(html.replace(/<span\b[^>]*>|<\/span>/g, ''), '&lt;img src=x onerror=&quot;window.translationAttack=1&quot;&gt;');
  assert.match(html, /data-tooltip="&quot;&gt;&lt;svg onload=&quot;window\.tooltipAttack=1&quot;&gt;&#10;next"/);
  assert.equal((html.match(/<span\b/g) || []).length, 1);
});

test('inline and history diffs render hostile translation text as text', () => {
  const { editor, context, window } = loadEditor();
  const attack = '<img src=x onerror="window.diffAttack=1">';
  window.Diff = { diffWordsWithSpace() { return [{ value: attack, added: true }]; } };
  const inline = editor.renderInlineDiffHtml('', attack);
  assert.equal(inline, '<span class="diffInlineAdd">&lt;img src=x onerror=&quot;window.diffAttack=1&quot;&gt;</span>');
  const history = context.renderUnifiedLineDiff([{ type: 'insert', line: attack }]);
  assert.equal(history, '<div class="diffLine add"><span class="diffPrefix">+</span>&lt;img src=x onerror=&quot;window.diffAttack=1&quot;&gt;</div>');
});
