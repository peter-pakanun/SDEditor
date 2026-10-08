const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Scope = require('../public/dictionaryScope.js');
const Terminology = require('../public/terminologyDiagnostics.js');
const entry = (_id, find, gameScope) => ({ _id, find, replace: _id, ...(gameScope === undefined ? {} : { gameScope }), alts: [] });

test('legacy entries apply to both games without mutating stored data', () => {
  const rows = [entry('legacy', 'Fire')];
  assert.equal(Scope.normalize(rows[0]), 'all');
  assert.deepEqual(Scope.activeEntries(rows, 'poe1'), rows);
  assert.deepEqual(Scope.activeEntries(rows, 'poe2'), rows);
  assert.equal(Object.hasOwn(rows[0], 'gameScope'), false);
});

test('each game uses its own variant and All fallback while all rows stay stored', () => {
  const rows = [entry('all', 'Fire', 'all'), entry('one', 'Fire', 'poe1'), entry('two', 'Fire', 'poe2'), entry('other', 'Cold')];
  assert.deepEqual(Scope.activeEntries(rows, 'poe1').map(row => row._id), ['one', 'other']);
  assert.deepEqual(Scope.activeEntries(rows, 'poe2').map(row => row._id), ['two', 'other']);
  assert.equal(rows.length, 4);
  assert.equal(Scope.available(rows[1], 'poe2'), false);
  assert.equal(Scope.shadowed(rows[0], rows, 'poe2'), true);
});

test('override uses the normalized main Find and inherits the parent scope for alternates', () => {
  const rows = [entry('all', ' FIRE ', 'all'), entry('two', 'fire', 'poe2')];
  rows[0].alts = [{ find: 'Flames', replace: 'All wording' }];
  rows[1].alts = [{ find: 'Flames', replace: 'PoE2 wording' }];
  assert.deepEqual(Scope.activeEntries(rows, 'poe2'), [rows[1]]);
  assert.deepEqual(Scope.activeEntries(rows, 'poe1'), [rows[0]]);
});

test('an opposite-game variant never shadows All, including when that variant appears first', () => {
  const rows = [entry('one', 'Fire', 'poe1'), entry('all', 'Fire')];
  assert.deepEqual(Scope.activeEntries(rows, 'poe2'), [rows[1]]);
  assert.equal(Scope.shadowed(rows[1], rows, 'poe2'), false);
});

test('duplicates in the same scope keep independent identity and original order', () => {
  const rows = [entry('two-a', 'Fire', 'poe2'), entry('two-b', 'Fire', 'poe2'), entry('cold', 'Cold', 'all')];
  assert.deepEqual(Scope.activeEntries(rows, 'poe2'), rows);
});

test('blank drafts do not suppress unrelated All drafts and no selected game uses only All', () => {
  const rows = [entry('all', '', 'all'), entry('two', '', 'poe2'), entry('cold', 'Cold')];
  assert.deepEqual(Scope.activeEntries(rows, 'poe2'), rows);
  assert.deepEqual(Scope.activeEntries(rows, ''), [rows[0], rows[2]]);
  assert.deepEqual(Scope.activeEntries(null, 'poe2'), []);
});

test('browser and CommonJS expose the same scope rules', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/dictionaryScope.js'), 'utf8'), context);
  assert.equal(context.DictionaryScope.normalize('poe2'), 'poe2');
  assert.equal(context.DictionaryScope.normalize(undefined), 'all');
  assert.equal(context.DictionaryScope.activeEntries([entry('one', 'Fire', 'poe1')], 'poe2').length, 0);
});

test('terminology excludes foreign entries and shadowed All translations and alternates', () => {
  const rows = [entry('All wording', 'Fire', 'all'), entry('PoE1 wording', 'Fire', 'poe1'), entry('PoE2 wording', 'Fire', 'poe2')];
  rows[0].alts = [{ find: 'Flames', replace: 'All alternative' }];
  rows[2].alts = [{ find: 'Flames', replace: 'PoE2 alternative' }];
  const compiled = Terminology.compileDictionary(rows, { game: 'poe2' });
  assert.equal(Terminology.analyze('Fire', 'PoE2 wording', compiled).length, 0);
  assert.equal(Terminology.analyze('Fire', 'All wording', compiled).length, 1);
  assert.equal(Terminology.analyze('Fire', 'PoE1 wording', compiled).length, 1);
  assert.equal(Terminology.analyze('Flames', 'PoE2 alternative', compiled).length, 0);
  assert.equal(Terminology.analyze('Flames', 'All alternative', compiled).length, 1);
  const fallback = Terminology.compileDictionary(rows.filter(row => row.gameScope !== 'poe2'), { game: 'poe2' });
  assert.equal(Terminology.analyze('Fire', 'All wording', fallback).length, 0);
  assert.equal(Terminology.analyze('Fire', 'PoE1 wording', fallback).length, 1);
});
