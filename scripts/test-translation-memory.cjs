const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const TM = require('../public/translationMemory.js');

const context = { filepath: 'stats/fire.txt', stats: ['fire_damage'], condition: '#', remarks: '', entryIndex: 0 };
const unit = (id, source, target = source, extra = {}) => ({ id, source, target, gameScope: 'poe1', context, ...extra });

test('context identity preserves source, stat order, condition and remarks, excluding provenance and target', () => {
  const original = unit('a', 'Deals damage', 'สร้างความเสียหาย');
  const changed = { ...original, target: 'แก้ไข', provenance: { sourceHash: 'new', branchId: 'other' } };
  assert.equal(TM.identityFor(original), TM.identityFor(changed));
  for (const edit of [{ condition: '#|-1' }, { remarks: 'negate 1' }, { entryIndex: 1 }, { stats: ['other'] }]) {
    assert.notEqual(TM.identityFor(original), TM.identityFor({ ...original, context: { ...context, ...edit } }));
  }
  assert.notEqual(TM.identityFor(original), TM.identityFor({ ...original, source: 'deals damage' }));
  assert.equal(TM.normalizeUnit({ ...original, id: undefined, _id: 'legacy' }).id, 'legacy');
  const metadata = TM.normalizeUnit({ ...original, localRevision: 4, author: { id: 'account', name: 'Translator' } });
  assert.equal(metadata.localRevision, 4); assert.deepEqual(metadata.author, { id: 'account', name: 'Translator' });
  const match = TM.searchSync(TM.createIndex([metadata]), { source: metadata.source })[0];
  assert.equal(match.id, metadata.id); assert.equal(match.unit.localRevision, 4);
  assert.deepEqual(TM.contextFor({ filepath: 'a\\b.txt', stats: ['a', 'b'], variables: ['# #'], remarks: ['negate 1'] }, 0),
    { filepath: 'a/b.txt', stats: ['a', 'b'], condition: '# #', remarks: 'negate 1', entryIndex: 0 });
});

test('learning admits whole validated table and multiline entries, and excludes blank, DNT and malformed pairs', () => {
  const desc = { filepath: 'stats/a.txt', stats: ['a'], variables: ['#', '1|#'], remarks: ['', 'negate 1'],
    translations: { English: ['[Fire] {0}%\\nDamage@{1}', 'Blank'] } };
  const rows = TM.unitsFromDescription(desc, ['[Fire|ไฟ] {0}%\\nความเสียหาย@{1}', ''], 'Thai',
    { game: 'poe2', sourceHash: 'source', jobId: 'job' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, desc.translations.English[0]);
  assert.equal(rows[0].target, '[Fire|ไฟ] {0}%\\nความเสียหาย@{1}');
  assert.equal(rows[0].gameScope, 'poe2');
  assert.equal(rows[0].provenance.jobId, 'job');
  assert.deepEqual(TM.unitsFromDescription(desc, ['wrong count'], 'Thai'), []);
  assert.deepEqual(TM.unitsFromDescription({ ...desc, translations: { English: ['[DNT foo]'] } }, ['text'], 'Thai'), []);
  for (const [source, target] of [['{0}%', '{0}'], ['[Fire]', '[Cold]'], ['a@b', 'a'],
    ['a\\nb', 'a b'], ['[Fire]', '[Fire'], ['<white>{{x}}', '<red>{{x}}']]) {
    assert.equal(TM.validatePair(source, target).valid, false, source + ' / ' + target);
  }
  assert.equal(TM.validatePair('[Skill<gemlevel={0}>] {1}', '[Skill<gemlevel={0}>|สกิล] {1}').valid, true);
  assert.equal(TM.validatePair('[TentacleSmash::{0}] {1}', '[TentacleSmash::{0}|แส้] {1}').valid, true);
});

test('TM normalization enforces API field bounds while automatic learning safely excludes oversized pairs or context', () => {
  const base = unit('bounded', 'Damage', 'ความเสียหาย');
  for (const patch of [{ source: 'a'.repeat(32769) }, { target: 'a'.repeat(32769) }, { note: 'a'.repeat(4097) },
    { context: { filepath: 'a'.repeat(2049) } }, { context: { stats: Array(129).fill('stat') } },
    { context: { stats: ['a'.repeat(1025)] } }, { context: { condition: 'a'.repeat(4097) } },
    { context: { remarks: 'a'.repeat(4097) } }, { provenance: { sourceHash: 'a'.repeat(257) } },
    { provenance: { branchId: 'a'.repeat(257) } }, { provenance: { jobId: 'a'.repeat(129) } },
    { provenance: { filepath: 'a'.repeat(2049) } }, { provenance: { origin: 'a'.repeat(65) } },
    { id: 'a'.repeat(129) }, { id: 'bad id' }, { _id: 'different' }]) {
    assert.throws(() => TM.normalizeUnit({ ...base, ...patch }), TypeError);
  }
  assert.equal(TM.normalizeUnit({ ...base, source: 'a'.repeat(32768), target: 'b'.repeat(32768), note: 'c'.repeat(4096) }).source.length, 32768);
  assert.equal(TM.validatePair('a'.repeat(32769), 'a').errors[0].code, 'length');
  const desc = { filepath: 'ok.txt', stats: ['damage'], translations: { English: ['Damage', 'a'.repeat(32769)] } };
  assert.equal(TM.unitsFromDescription(desc, ['ความเสียหาย', 'long'], 'Thai').length, 1);
  assert.deepEqual(TM.unitsFromDescription({ ...desc, filepath: 'a'.repeat(2049) }, ['ความเสียหาย', 'long'], 'Thai'), []);
  assert.deepEqual(TM.unitsFromDescription(desc, ['ความเสียหาย', 'long'], 'Thai', { jobId: 'a'.repeat(129) }), []);
  const normalized = TM.normalizeUnit({ ...base, provenance: { extra: 'omit' }, context: { extra: 'omit' } });
  assert.equal(Object.hasOwn(normalized.context, 'extra'), false); assert.equal(Object.hasOwn(normalized.provenance, 'extra'), false);
});

test('exact raw matches get 100, known context gets 101, normalization never produces an exact match', () => {
  const index = TM.createIndex([unit('a', 'Deals {0}% damage', 'สร้าง {0}% ความเสียหาย')]);
  assert.equal(TM.searchSync(index, { source: 'Deals {0}% damage', context })[0].score, 101);
  assert.equal(TM.searchSync(index, { source: 'Deals {0}% damage' })[0].score, 100);
  assert.equal(TM.searchSync(index, { source: 'deals {0}% damage', context })[0].score, 99);
  const unicode = TM.createIndex([unit('b', 'Caf\u00e9 damage')]);
  assert.equal(TM.searchSync(unicode, { source: 'Cafe\u0301 damage', context })[0].kind, 'fuzzy');
  assert.equal(TM.searchSync(unicode, { source: 'Cafe\u0301 damage', context })[0].score, 99);
  assert.equal(TM.levenshtein('a😀b', 'a😄b'), 1);
});

test('game-specific sources override All, while other All sources remain candidates and foreign games stay excluded', () => {
  const index = TM.createIndex([unit('all', 'Fire Damage', 'all', { gameScope: 'all' }),
    unit('poe1', 'Fire Damage', 'poe1'), unit('poe2', 'Fire Damage', 'poe2', { gameScope: 'poe2' }),
    unit('fallback', 'Cold Damage', 'fallback', { gameScope: 'all' })], { game: 'poe1' });
  const exact = TM.searchSync(index, { source: 'Fire Damage' }, { threshold: 100 });
  assert.deepEqual(exact.map(match => match.id), ['poe1']);
  assert.equal(TM.searchSync(index, { source: 'Cold Damage' }, { threshold: 100 })[0].id, 'fallback');
  assert.throws(() => TM.searchSync(index, { source: 'Fire Damage', game: 'poe2' }), { name: 'AbortError' });
});

test('safe variable renumbering is bijective, atomic, modifier-preserving, and never changes keyword identities or numbers', () => {
  const old = 'Deals {0}% to {1} [Fire] damage, repeats {0}%';
  const target = 'สร้าง {1} ถึง {0}% [Fire|ไฟ] และ {0}%';
  const current = 'Deals {1}% to {0} [Fire] damage, repeats {1}%';
  const adjusted = TM.adaptVariables(old, target, current);
  assert.deepEqual(adjusted.mapping, { 0: '1', 1: '0' });
  assert.equal(adjusted.target, 'สร้าง {0} ถึง {1}% [Fire|ไฟ] และ {1}%');
  const match = TM.searchSync(TM.createIndex([unit('a', old, target)]), { source: current, context })[0];
  assert.equal(match.score, 99); assert.equal(match.kind, 'adapted');
  for (const changed of [current.replace('Fire', 'Cold'), current.replace('repeats {1}%', 'repeats {2}%'),
    current.replace('{1}%', '{1}'), current.replace('Deals', 'Gains')]) assert.equal(TM.adaptVariables(old, target, changed), null);
  assert.equal(TM.adaptVariables('{0:d} damage', '{0:d} ความเสียหาย', '{1:d} damage'), null);
  assert.equal(TM.adaptVariables('[Skill::{0}] {0}', '[Skill::{0}|ทักษะ] {0}', '[Skill::{1}] {1}'), null);
  assert.equal(TM.adaptVariables('10 damage {0}', '10 ความเสียหาย {0}', '20 damage {1}'), null);
});

test('semantic and structural warnings remain visible independently of a high score', () => {
  const prefix = 'Your attacks while affected by this skill always deal ';
  const source = prefix + 'more damage to enemies', current = prefix + 'less damage to enemies';
  const match = TM.searchSync(TM.createIndex([unit('a', source, 'มากกว่า')]), { source: current })[0];
  assert.ok(match.score >= 90); assert.ok(match.warnings.some(warning => warning.code === 'meaning'));
  assert.ok(TM.matchWarnings('1% damage', '2% damage', '1% ความเสียหาย').some(warning => warning.code === 'numbers'));
  assert.ok(TM.matchWarnings('Can gain damage', 'Cannot gain damage', 'ได้รับ').some(warning => warning.code === 'meaning'));
  const diff = TM.sourceDiff('a😀b', 'a😄b');
  assert.equal(diff.oldSource.map(part => part.text).join(''), 'a😀b');
  assert.equal(diff.currentSource.filter(part => part.changed).map(part => part.text).join(''), '😄');
});

test('source ambiguity examines every target variant even when only one result is returned', () => {
  const index = TM.createIndex([unit('a', 'Damage', 'first'), unit('b', 'Damage', 'second', { context: { ...context, entryIndex: 1 } })]);
  const sourceOnly = TM.searchSync(index, { source: 'Damage' }, { limit: 1 })[0];
  assert.equal(sourceOnly.variantCount, 2); assert.equal(sourceOnly.ambiguous, true);
  const contextual = TM.searchSync(index, { source: 'Damage', context }, { limit: 1 })[0];
  assert.equal(contextual.score, 101); assert.equal(contextual.ambiguous, false);
});

function exhaustive(index, query, options = {}) {
  const matches = [];
  for (const group of index.groups) {
    for (const row of group.units) {
      const knownContext = !!query.context?.filepath && Number.isSafeInteger(query.context?.entryIndex);
      const sameContext = knownContext && row.contextKey === TM.canonicalContext(query.context);
      const exact = group.source === query.source;
      const adapted = exact ? null : TM.adaptVariables(group.source, row.unit.target, query.source);
      const score = exact ? sameContext ? 101 : 100 : adapted ? 99 : TM.scoreFor(group.source, query.source);
      if (score < (options.threshold ?? 60)) continue;
      matches.push({ id: row.identity, unit: row.unit, score, kind: exact ? sameContext ? 'context' : 'exact' : adapted ? 'adapted' : 'fuzzy', sameContext });
    }
  }
  return matches.sort(TM.compareMatches).slice(0, options.limit ?? 5).map(match => [match.id, match.score, match.kind]);
}

test('indexed retrieval equals exhaustive scoring, including short zero-bigram overlaps and deterministic ties', () => {
  let seed = 1234567;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const alphabet = 'abcdef ghij😀';
  const sources = ['abc', 'adc', 'é', 'é', 'a😀b', 'a😄b', 'Gain {0}% damage', 'Gain {1}% damage'];
  for (let index = 0; index < 250; index++) {
    let source = '';
    for (let count = 0, length = 1 + Math.floor(random() * 40); count < length; count++) source += alphabet[Math.floor(random() * alphabet.length)];
    if (source.trim()) sources.push(source);
  }
  const index = TM.createIndex(sources.map((source, ordinal) => unit('row-' + ordinal, source)));
  for (const source of [...sources.slice(0, 20), 'aec', 'a😀c', 'More damage', 'Gain {3}% damage']) {
    for (const threshold of [0, 40, 60, 80, 99, 100]) {
      const query = { source, context }, options = { threshold, limit: 5 };
      const actual = TM.searchSync(index, query, options).map(match => [match.id, match.score, match.kind]);
      assert.deepEqual(actual, exhaustive(index, query, options), JSON.stringify({ source, threshold }));
    }
  }
});

test('classic-script tag helper and Node adapter extract the same protected variables', () => {
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'regexEngine.js'), 'utf8'), sandbox);
  const source = '[TentacleSmash::{0}|Hit {1}%] [Skill<gemlevel={2}>] +{3} <white>{{{4}}}'
  assert.deepEqual(TM.variableTags(source), JSON.parse(JSON.stringify(sandbox.extractGGGVarTags(source))));
});

test('cooperative construction/search cancellation prevents stale results', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(TM.buildIndex([unit('a', 'Damage')], { signal: controller.signal }), { name: 'AbortError' });
  const index = await TM.buildIndex([unit('a', 'Damage')]);
  await assert.rejects(TM.search(index, { source: 'damage' }, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual((await TM.search(index, { source: 'damage' })).map(match => match.score), [99]);
});
