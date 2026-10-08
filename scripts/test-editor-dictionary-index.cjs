const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const indexApi = require('../public/editorDictionaryIndex.js');

// Use the editor's own definition normalization, including case-insensitive
// duplicate suppression within an entry and alternate replacement fallback.
let component;
const context = vm.createContext({
  window: { location: { search: '' }, CloudUI: { mixin: {} } },
  URLSearchParams, console, setTimeout, clearTimeout,
  Vue: {
    defineComponent(value) { component = value; return value; },
    createApp() { return { component() {}, directive() {}, mount() {} }; },
  },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'workspaceState.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'dictionaryScope.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.js'), 'utf8'), context);
const getPairs = component.methods.getDictionaryDefinitionPairs;

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exhaustive(dictionary) {
  const definitions = [];
  for (const dictEntry of dictionary) {
    if (!dictEntry?._id) continue;
    for (const pair of getPairs(dictEntry)) {
      definitions.push({ pair, dictEntry, regex: new RegExp(`\\b${escapePattern(pair.find)}\\b`, 'g') });
    }
  }
  return definitions.sort((a, b) => b.pair.find.length - a.pair.find.length);
}

function matches(definitions, text) {
  const results = [];
  for (const definition of definitions) {
    definition.regex.lastIndex = 0;
    let match;
    while ((match = definition.regex.exec(text))) {
      results.push([definition.dictEntry._id, definition.pair.find, definition.pair.replace, match.index]);
    }
  }
  return results;
}

const dictionary = [
  { _id: 'fire', find: ' Fire ', replace: 'ไฟ', alts: [{ find: 'fire', replace: 'duplicate' }, { find: 'Burning', replace: 'เผา' }] },
  { _id: 'fire-duplicate', find: 'Fire', replace: 'second', alts: [] },
  { _id: 'fire-damage', find: 'Fire Damage', replace: 'ความเสียหายไฟ', alts: [{ find: 'Damage' }] },
  { _id: 'cold', find: 'Cold', replace: 'หนาว', alts: [{ find: 'Frozen', replace: '' }] },
  { _id: 'literal', find: 'a.b', replace: 'dot', alts: [{ find: '(x)', replace: 'parentheses' }, { find: 'a+b', replace: 'plus' }] },
  { _id: 'entities', find: 'amp', replace: 'entity', alts: [{ find: 'A&B' }, { find: 'A&amp;B' }] },
  { _id: 'unicode', find: 'ไทย', replace: 'Thai', alts: [{ find: 'é' }, { find: 'é' }, { find: '🔥Fire' }] },
  { find: 'Fire', replace: 'missing ID', alts: [] },
  { _id: 'alternate-only', find: '', replace: 'fallback', alts: [{ find: 'OnlyAlternate' }] },
  null,
];

test('indexed candidates retain exhaustive literal, boundary, duplicate, alternate and stable-order results', () => {
  const index = indexApi.create(dictionary, getPairs);
  const legacy = exhaustive(dictionary);
  for (const text of [
    'Fire Damage Fire fire Burning Damage Fireball wildfire Frozen Cold',
    'a.b a+b aXb abc(x)def (x) xไทยx ไทย xéx é é 🔥Fire',
    '[Fire|Burning] [Cold] A&B A&amp;B OnlyAlternate',
    'Fire\nDamage Fire Damage Fire Damage', '',
  ]) {
    assert.deepEqual(matches(index.definitionsFor(text), text), matches(legacy, text), text);
  }
});

test('keyword candidates retain main-find restriction, original order, missing IDs and blank-tag fallback', () => {
  const index = indexApi.create(dictionary, getPairs);
  for (const tagName of ['fire', ' FIRE ', 'Cold', 'Burning', 'unknown']) {
    const key = tagName.trim().toLowerCase();
    assert.deepEqual(index.keywordEntries(tagName), dictionary.filter(entry => String(entry?.find ?? '').trim().toLowerCase() === key));
  }
  assert.equal(index.keywordEntries('Fire').length, 3);
  assert.equal(index.keywordEntries(''), dictionary);
  assert.equal(index.entriesById.get('fire'), dictionary[0]);
});

test('queries touch matching definitions only and reuse compiled expressions', () => {
  let normalizationCount = 0;
  const large = Array.from({ length: 20000 }, (_, index) => ({ _id: `d${index}`, find: `Unused${index}`, replace: `${index}`, alts: [] }));
  large.push({ _id: 'target', find: 'Fire', replace: 'ไฟ', alts: [] });
  const index = indexApi.create(large, entry => { normalizationCount++; return getPairs(entry); });
  assert.equal(normalizationCount, 20001);
  const first = index.definitionsFor('Fire Damage');
  assert.equal(first.length, 1);
  assert.equal(first[0].dictEntry._id, 'target');
  first[0].regex.exec('Fire Damage');
  assert.equal(first[0].regex.lastIndex, 4);
  const next = index.definitionsFor('Fire Damage');
  assert.equal(next[0].regex, first[0].regex);
  assert.equal(next[0].regex.lastIndex, 0);
  assert.equal(normalizationCount, 20001, 'Opening more blocks must not expand the dictionary again.');
});

test('asynchronous construction yields between bounded batches and preserves synchronous results', async () => {
  let yieldCount = 0;
  const slowPairs = entry => {
    const started = performance.now();
    while (performance.now() - started < 1) { /* Simulate expensive imported entries. */ }
    return getPairs(entry);
  };
  const index = await indexApi.createAsync(dictionary, slowPairs, { yieldTask: async () => { yieldCount++; } });
  assert.ok(yieldCount > 0);
  const text = 'Fire Damage Burning Cold a.b OnlyAlternate';
  assert.deepEqual(matches(index.definitionsFor(text), text), matches(exhaustive(dictionary), text));
});

test('cancellation discards an incomplete index before or after a yield', async () => {
  assert.equal(await indexApi.createAsync(dictionary, getPairs, { isCancelled: () => true }), null);
  let cancelled = false;
  let normalized = 0;
  const large = Array.from({ length: 50 }, (_, index) => ({ _id: `d${index}`, find: `Word${index}` }));
  const result = await indexApi.createAsync(large, entry => {
    normalized++;
    const started = performance.now();
    while (performance.now() - started < 1) { /* Ensure a batch boundary. */ }
    return getPairs(entry);
  }, {
    yieldTask: async () => { cancelled = true; },
    isCancelled: () => cancelled,
  });
  assert.equal(result, null);
  assert.ok(normalized > 0 && normalized < large.length);
});
