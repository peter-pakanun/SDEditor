const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadLookup(overrides = {}) {
  const timers = new Map();
  let timerId = 0;
  let searchFocusCount = 0;
  const context = vm.createContext({
    window: {},
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'editorLookup.js'), 'utf8'), context);
  const api = context.window.EditorLookup;
  const model = Object.assign(api.mixin.data(), api.mixin.methods, {
    descs: [], localDescs: { descs: [] }, lang: 'Thai', sideTab: 'lookup', editorVisible: true,
    $nextTick(callback) { callback?.(); return Promise.resolve(); },
    $refs: {
      lookupSearchInput: { focus() { searchFocusCount++; } },
      lookupResultsList: { scrollTop: 0 }, lookupReference: { scrollTop: 0 },
    },
  }, overrides);
  for (const [name, getter] of Object.entries(api.mixin.computed)) {
    Object.defineProperty(model, name, { get: () => getter.call(model) });
  }
  return {
    model, api, timers,
    flushTimers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    searchFocusCount: () => searchFocusCount,
  };
}

function description(name, english = `English ${name}`, thai = `ภาษาไทย ${name}`, other = {}) {
  return {
    filepath: `Reference/${name}.txt`, filename: `${name}.txt`, stats: [`stat_${name}`],
    variables: ['#'], remarks: [''],
    translations: { English: Array.isArray(english) ? english : [english], Thai: Array.isArray(thai) ? thai : [thai], ...other },
  };
}

function search(model, query, scope = 'all') {
  model.lookupQuery = query; model.lookupScope = scope; model.lookupApplySearch();
  return Array.from(model.lookupResults, item => item.filepath);
}

const plain = value => JSON.parse(JSON.stringify(value));
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

test('lookup searches all loaded descriptions independently of workspace filters and selection', () => {
  const one = description('one');
  const two = { ...description('two', 'Hidden reference'), isDNT: true };
  const { model } = loadLookup({ descs: [one, two], hideDNT: true, filteredDescs: [one],
    searchText: 'one', selectedFileFilters: ['missing'], selectedFilepath: one.filepath });
  assert.deepEqual(search(model, 'hidden'), [two.filepath]);
  assert.equal(model.lookupVisibleResults[0].isDNT, true);
  assert.equal(model.selectedFilepath, one.filepath);
  assert.equal(model.searchText, 'one');
});

test('plain case-insensitive lookup supports paths, stat codes, English and translation scopes', () => {
  const one = description('UniqueSword', 'Adds FIRE Damage', 'เพิ่มความเสียหายไฟ');
  const { model } = loadLookup({ descs: [one] });
  for (const query of ['REFERENCE/uniquesword', 'STAT_UNIQUESWORD', 'fire damage', 'ความเสียหายไฟ']) {
    assert.deepEqual(search(model, query), [one.filepath]);
  }
  assert.deepEqual(search(model, 'fire', 'path'), []);
  assert.deepEqual(search(model, 'ไฟ', 'english'), []);
  assert.deepEqual(search(model, 'fire', 'translation'), []);
  assert.deepEqual(search(model, 'ไฟ', 'translation'), [one.filepath]);
  assert.deepEqual(search(model, 'STAT_UNIQUE', 'path'), [one.filepath]);
  assert.deepEqual(search(model, '[.*]'), []);
});

test('encoded and actual newlines are searchable across lines and entries', () => {
  const one = description('multiline', ['Stores poison\\nDeals damage', 'Next entry'], ['กักเก็บ\\nสร้างความเสียหาย', 'บรรทัดถัดไป']);
  const { model } = loadLookup({ descs: [one] });
  assert.deepEqual(search(model, 'poison deals'), [one.filepath]);
  assert.deepEqual(search(model, 'damage\nnext entry'), [one.filepath]);
  assert.deepEqual(search(model, 'กักเก็บ\\nสร้าง'), [one.filepath]);
});

test('saved workspace language overlays source translations without replacing source English', () => {
  const one = description('one', 'Current English', 'Original Thai', { French: ['Original French'] });
  const saved = { filepath: one.filepath, translations: { English: ['Stale English'], Thai: ['Saved Thai'], French: ['Saved French'] } };
  const { model } = loadLookup({ descs: [one], localDescs: { descs: [saved] } });
  assert.deepEqual(search(model, 'saved thai'), [one.filepath]);
  assert.deepEqual(search(model, 'original thai'), []);
  assert.deepEqual(search(model, 'stale english'), []);
  model.lookupLanguage = 'French';
  assert.deepEqual(search(model, 'saved french', 'translation'), [one.filepath]);
  model.lookupSelect(one.filepath);
  assert.equal(model.lookupSelectedReference.lang, 'French');
  assert.equal(model.lookupSelectedReference.blocks[0].english, 'Current English');
  assert.equal(model.lookupSelectedReference.blocks[0].translation, 'Saved French');
  assert.equal(model.lang, 'Thai');
});

test('an explicitly empty saved translation does not resurrect the original translation', () => {
  const one = description('one', 'English', 'Original Thai');
  const { model } = loadLookup({ descs: [one], localDescs: { descs: [{ filepath: one.filepath, translations: { Thai: [] } }] } });
  assert.deepEqual(search(model, 'original thai'), []);
  model.lookupClearSearch(); model.lookupSelect(one.filepath);
  assert.equal(model.lookupSelectedReference.blocks[0].translation, '');
});

test('language choices include saved references for loaded files and keep editor language independent', () => {
  const one = description('one', 'English', [], { French: ['Français'], German: [] });
  const { model } = loadLookup({ descs: [one], localDescs: { descs: [
    { filepath: one.filepath, translations: { Japanese: ['日本語'] } },
    { filepath: 'Unloaded.txt', translations: { Korean: ['한국어'] } },
  ] } });
  assert.deepEqual(Array.from(model.lookupLanguages), ['Thai', 'French', 'Japanese']);
  model.lookupLanguage = 'Japanese'; model.lookupSelect(one.filepath);
  assert.equal(model.lookupSelectedReference.blocks[0].translation, '日本語');
  assert.equal(model.lang, 'Thai');
});

test('reference preserves every source and translation entry, multiline text, table columns and stat metadata', () => {
  const one = description('table', ['Left A\\nLeft B@Right A\\nRight B', 'Second English'], ['ซ้าย A\\nซ้าย B@ขวา A\\nขวา B', 'ไทยสอง', 'Extra saved entry']);
  one.variables = ['# #', '1|#']; one.remarks = ['table_only', 'negate 1'];
  const { model } = loadLookup({ descs: [one] });
  model.lookupSelect(one.filepath);
  const reference = model.lookupSelectedReference;
  assert.deepEqual(plain(reference.stats), ['stat_table']);
  assert.equal(reference.blocks.length, 3);
  assert.equal(reference.blocks[0].english, 'Left A\nLeft B@Right A\nRight B');
  assert.equal(reference.blocks[0].isTable, true);
  assert.deepEqual(plain(reference.blocks[0].englishColumns), ['Left A\nLeft B', 'Right A\nRight B']);
  assert.deepEqual(plain(reference.blocks[0].translationColumns), ['ซ้าย A\nซ้าย B', 'ขวา A\nขวา B']);
  assert.equal(reference.blocks[0].variables, '# #');
  assert.equal(reference.blocks[0].remark, 'table_only');
  assert.equal(reference.blocks[2].english, '');
  assert.equal(reference.blocks[2].translation, 'Extra saved entry');
});

test('lookup methods preserve drafts, current editor, persistence, workspace search and selection', () => {
  const one = deepFreeze(description('one', 'English one', 'Saved Thai'));
  const two = deepFreeze(description('two', 'English two', 'Other Thai', { French: ['Autre'] }));
  const protectedState = {
    descs: deepFreeze([one, two]), localDescs: deepFreeze({ descs: [] }),
    editorCurrentEditingDesc: one, editorBlocks: [{ translation: 'Unsaved draft' }],
    selectedFilepath: one.filepath, searchText: 'workspace search', currentPage: 3,
    selectedFileFilters: ['review'],
  };
  const before = JSON.stringify(protectedState);
  const { model } = loadLookup(protectedState);
  for (const name of ['editorSave', 'editFile', 'selectFileRow', 'saveLocalDescs', 'persistTranslationBatch', 'applyWorkspaceOverlay']) {
    model[name] = () => assert.fail(`${name} must not be called by read-only lookup`);
  }
  model.lookupSelect(two.filepath);
  model.lookupLanguage = 'French'; model.lookupApplySearch();
  search(model, 'Autre'); model.lookupGoToPage(2); model.lookupClearSearch();
  model.invalidateEditorLookupIndex();
  const reference = model.lookupSelectedReference;
  reference.stats[0] = 'Mutating a copied view';
  reference.blocks[0].translation = 'Copied text';
  reference.blocks[0].translationColumns[0] = 'Copied column';
  assert.equal(JSON.stringify(Object.fromEntries(Object.keys(protectedState).map(key => [key, model[key]]))), before);
  assert.deepEqual(search(model, 'Unsaved draft'), []);
});

test('empty lookup is paginated and safe page navigation clamps invalid input', () => {
  const descs = Array.from({ length: 45 }, (_, index) => description(String(index)));
  const { model } = loadLookup({ descs });
  assert.equal(model.lookupResultCount, 45);
  assert.equal(model.lookupVisibleResults.length, 20);
  assert.equal(model.lookupRangeLabel, '1–20 of 45');
  model.lookupGoToPage(3);
  assert.equal(model.lookupVisibleResults.length, 5);
  assert.equal(model.lookupVisibleResults[0].filepath, descs[40].filepath);
  assert.equal(model.lookupRangeLabel, '41–45 of 45');
  model.lookupGoToPage(900); assert.equal(model.lookupPage, 3);
  model.lookupGoToPage('bad'); assert.equal(model.lookupPage, 1);
  model.lookupGoToPage(-2); assert.equal(model.lookupPage, 1);
});

test('lookup browsing state survives switching tabs and closing/reopening the editor', () => {
  const { model, api } = loadLookup({ descs: Array.from({ length: 45 }, (_, i) => description(String(i))) });
  model.lookupGoToPage(3); model.lookupSelect('Reference/40.txt');
  model.sideTab = 'comments';
  api.mixin.watch.lookupPageCount.call(model, model.lookupPageCount);
  api.mixin.watch.lookupResults.call(model, model.lookupResults);
  assert.equal(model.lookupPage, 3); assert.equal(model.lookupSelectedFilepath, 'Reference/40.txt');
  model.sideTab = 'lookup'; model.editorVisible = false;
  api.mixin.watch.lookupPageCount.call(model, model.lookupPageCount);
  assert.equal(model.lookupPage, 3);
  model.editorVisible = true;
  assert.equal(model.lookupCurrentPage, 3);
  assert.equal(model.lookupSelectedReference.filepath, 'Reference/40.txt');
});

test('query matching is debounced, retains matching selection and clears nonmatching selection', () => {
  const one = description('one', 'Poison damage'); const two = description('two', 'Fire damage');
  const { model, timers, flushTimers } = loadLookup({ descs: [one, two] });
  model.lookupSelect(one.filepath);
  model.lookupQuery = 'po'; model.lookupSearchChanged();
  model.lookupQuery = 'poison'; model.lookupSearchChanged();
  assert.equal(timers.size, 1); assert.equal(model.lookupResultCount, 2);
  flushTimers();
  assert.equal(model.lookupResultCount, 1); assert.equal(model.lookupSelectedFilepath, one.filepath);
  model.lookupQuery = 'fire'; model.lookupSearchChanged(); flushTimers();
  assert.equal(model.lookupSelectedFilepath, ''); assert.equal(model.lookupVisibleResults[0].filepath, two.filepath);
});

test('clearing search cancels pending matches and focuses the lookup search only', () => {
  const { model, timers, searchFocusCount } = loadLookup({ descs: [description('one')] });
  model.lookupQuery = 'not found'; model.lookupSearchChanged();
  model.lookupClearSearch();
  assert.equal(timers.size, 0); assert.equal(model.lookupAppliedQuery, '');
  assert.equal(model.lookupResultCount, 1); assert.equal(searchFocusCount(), 1);
});

test('text index is lazy and cached across query changes until saved data is invalidated', () => {
  let translationReads = 0;
  const one = description('one');
  const translations = one.translations;
  Object.defineProperty(one, 'translations', { get() { translationReads++; return translations; } });
  const { model } = loadLookup({ descs: [one], sideTab: 'dictionary' });
  assert.equal(model.lookupResultCount, 0); assert.equal(translationReads, 0);
  model.sideTab = 'lookup'; assert.equal(model.lookupResultCount, 1);
  const initialReads = translationReads;
  search(model, 'english'); search(model, 'one'); model.lookupGoToPage(1);
  assert.equal(translationReads, initialReads);
  translations.Thai = ['Updated saved text'];
  model.invalidateEditorLookupIndex();
  assert.deepEqual(search(model, 'updated saved'), [one.filepath]);
  assert.ok(translationReads > initialReads);
});

test('replacing source, saved workspace, or reference language rebuilds the index', () => {
  const one = description('one'); const two = description('two', 'Fresh source', 'Fresh Thai', { French: ['Français'] });
  const { model } = loadLookup({ descs: [one] });
  assert.equal(model.lookupResultCount, 1);
  model.descs = [two]; assert.deepEqual(search(model, 'fresh source'), [two.filepath]);
  model.localDescs = { descs: [{ filepath: two.filepath, translations: { Thai: ['Fresh workspace'] } }] };
  assert.deepEqual(search(model, 'fresh workspace'), [two.filepath]);
  model.lookupLanguage = 'French'; assert.deepEqual(search(model, 'français'), [two.filepath]);
  model.lookupSelect(two.filepath); assert.equal(model.lookupSelectedReference.lang, 'French');
});

test('refreshing saved reference text updates selected reference and expires vanished matches', () => {
  const one = description('one'); const local = { filepath: one.filepath, translations: { Thai: ['Old text'] } };
  const { model, api } = loadLookup({ descs: [one], localDescs: { descs: [local] } });
  model.lookupSelect(one.filepath); assert.equal(model.lookupSelectedReference.blocks[0].translation, 'Old text');
  local.translations.Thai = ['Updated text']; model.invalidateEditorLookupIndex();
  assert.equal(model.lookupSelectedReference.blocks[0].translation, 'Updated text');
  search(model, 'updated'); model.lookupSelect(one.filepath);
  local.translations.Thai = ['No longer matches']; model.invalidateEditorLookupIndex();
  api.mixin.watch.lookupResults.call(model, model.lookupResults);
  assert.equal(model.lookupSelectedFilepath, ''); assert.equal(model.lookupSelectedReference, null);
});

test('result excerpts show a later matching passage and reference keeps the complete text', () => {
  const text = 'A long introductory sentence. '.repeat(20) + 'A distinctive reference at the end.';
  const one = description('one', text);
  const { model } = loadLookup({ descs: [one] });
  search(model, 'distinctive reference');
  assert.match(model.lookupVisibleResults[0].englishPreview, /distinctive reference/);
  assert.ok(model.lookupVisibleResults[0].englishPreview.length < text.length);
  model.lookupSelect(one.filepath); assert.equal(model.lookupSelectedReference.blocks[0].english, text);
});

test('changing result or page resets only its own scroll and leaves focus in place', () => {
  const descs = Array.from({ length: 21 }, (_, i) => description(String(i)));
  const { model, searchFocusCount } = loadLookup({ descs });
  model.$refs.lookupReference.scrollTop = 250; model.lookupSelect(descs[0].filepath);
  assert.equal(model.$refs.lookupReference.scrollTop, 0);
  model.$refs.lookupReference.scrollTop = 200; model.lookupSelect(descs[0].filepath);
  assert.equal(model.$refs.lookupReference.scrollTop, 200);
  model.$refs.lookupResultsList.scrollTop = 300; model.lookupGoToPage(2);
  assert.equal(model.$refs.lookupResultsList.scrollTop, 0);
  assert.equal(searchFocusCount(), 0);
});

test('destroying lookup cancels pending search work', () => {
  const { model, api, timers } = loadLookup();
  model.lookupQuery = 'waiting'; model.lookupSearchChanged();
  assert.equal(timers.size, 1); api.mixin.beforeUnmount.call(model); assert.equal(timers.size, 0);
});

test('query highlighting marks every literal case-insensitive occurrence and preserves source text', () => {
  const { api } = loadLookup();
  const text = 'FIRE and fire; [.*] <img src=x onerror=alert(1)>';
  const parts = plain(api.highlightParts(text, 'fire'));
  assert.deepEqual(parts.filter(part => part.matched).map(part => part.text), ['FIRE', 'fire']);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(plain(api.highlightParts(text, '[.*]')).filter(part => part.matched), [{ text: '[.*]', matched: true }]);
  assert.deepEqual(plain(api.highlightParts(text, '<img')).filter(part => part.matched), [{ text: '<img', matched: true }]);
  assert.deepEqual(plain(api.highlightParts(text, ' \n ')), [{ text, matched: false }]);
  assert.deepEqual(plain(api.highlightParts('', 'fire')), []);
});

test('highlight offsets follow whitespace and Unicode normalization without changing literal text', () => {
  const { api } = loadLookup();
  for (const [text, query, match] of [
    ['two\n  three', 'two three', 'two\n  three'],
    ['a  \u0301 b', 'a \u0301 b', 'a  \u0301 b'],
    ['Cafe\u0301 damage', 'café', 'Cafe\u0301'],
    ['İ prefix FIRE suffix', 'fire', 'FIRE'],
    ['İ prefix FIRE suffix', 'i', 'İ'],
    ['🗡️ ความเสียหายไฟ เพิ่มไฟ', 'ไฟ', 'ไฟ'],
  ]) {
    const parts = plain(api.highlightParts(text, query));
    assert.equal(parts.map(part => part.text).join(''), text);
    assert.ok(parts.some(part => part.matched && part.text === match), `${query} should mark ${match}`);
  }
});

test('visible result highlights follow the applied query and scope, including matching stats', () => {
  const one = description('FireBlade', 'FIRE damage and fire resistance', 'เพิ่ม Fire damage');
  const { model } = loadLookup({ descs: [one] });
  search(model, 'fire');
  const marked = parts => Array.from(parts).filter(part => part.matched).map(part => part.text);
  let result = model.lookupVisibleResults[0];
  assert.deepEqual(marked(result.filepathParts), ['Fire']);
  assert.deepEqual(marked(result.englishParts), ['FIRE', 'fire']);
  assert.deepEqual(marked(result.translationParts), ['Fire']);
  assert.deepEqual(marked(result.statsParts), ['Fire']);
  model.lookupQuery = 'damage'; model.lookupSearchChanged();
  assert.deepEqual(marked(model.lookupVisibleResults[0].englishParts), ['FIRE', 'fire'], 'Highlights retain the currently applied search during debounce');
  search(model, 'fire', 'english');
  result = model.lookupVisibleResults[0];
  assert.deepEqual(marked(result.filepathParts), []);
  assert.deepEqual(marked(result.translationParts), []);
  assert.deepEqual(marked(result.statsParts), []);
  assert.deepEqual(marked(result.englishParts), ['FIRE', 'fire']);
  search(model, 'stat_fireblade', 'path');
  result = model.lookupVisibleResults[0];
  assert.deepEqual(marked(result.statsParts), ['stat_FireBlade']);
  search(model, 'FireBlade.txt stat_FireBlade', 'path');
  result = model.lookupVisibleResults[0];
  assert.deepEqual(marked(result.filepathParts), ['FireBlade.txt']);
  assert.deepEqual(marked(result.statsParts), ['stat_FireBlade']);
  model.lookupClearSearch();
  result = model.lookupVisibleResults[0];
  for (const field of ['filepathParts', 'englishParts', 'translationParts', 'statsParts']) assert.deepEqual(marked(result[field]), []);
});

test('result excerpts keep highlights visible after normalized prefixes, across blocks and when clipped', () => {
  const { api, model } = loadLookup({ descs: [description('one', ['Stores poison', 'Deals damage'])] });
  search(model, 'poison deals');
  assert.ok(model.lookupVisibleResults[0].englishParts.some(part => part.matched && part.text === 'poison Deals'));
  const text = 'Cafe\u0301 '.repeat(40) + 'FIRE damage';
  const parts = plain(api.excerptParts(text, 'fire'));
  assert.ok(parts.some(part => part.matched && part.text === 'FIRE'));
  assert.ok(parts.map(part => part.text).join('').startsWith('…'));
  const longQuery = 'damage '.repeat(35).trim();
  const clipped = plain(api.excerptParts('Before ' + longQuery + ' after', longQuery));
  assert.ok(clipped.some(part => part.matched && part.text.startsWith('damage')));
  assert.ok(clipped.map(part => part.text).join('').endsWith('…'));
  assert.ok(clipped.map(part => part.text).join('').length <= 151);
  for (const [source, query] of [['🗡'.repeat(20) + 'Fire damage', 'fire'], ['a'.repeat(149) + '🗡', 'a']]) {
    const preview = plain(api.excerptParts(source, query)).map(part => part.text).join('');
    assert.equal(preview.isWellFormed(), true, 'Excerpt boundaries must preserve complete emoji');
  }
});
