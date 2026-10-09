const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const matching = require('../public/dictionaryMatching.js');
const scope = require('../public/dictionaryScope.js');

function drain(iterator) {
  let result;
  do { result = iterator.next(); } while (!result.done);
  return result.value;
}

function harness() {
  const tasks = [], messages = [];
  let clock = 0;
  const runtime = matching.createRuntime({
    postMessage: message => messages.push(message), schedule: callback => tasks.push(callback), now: () => ++clock, sliceMs: 4,
  });
  const send = message => runtime.handleMessage({ scopeEpoch: 1, ...message });
  send({ type: 'setScope', scopeKey: 'local/Thai/poe1' });
  function step() { assert.ok(tasks.length, 'There should be scheduled work.'); tasks.shift()(); }
  function until(predicate, limit = 200000) {
    while (!predicate() && limit--) step();
    assert.ok(predicate(), 'Expected worker state must be reached within bounded scheduling steps.');
  }
  function flush() { until(() => !tasks.length); }
  return { runtime, send, tasks, messages, step, until, flush };
}

const engineContext = vm.createContext({ console });
vm.runInContext(fs.readFileSync(require.resolve('../public/regexEngine.js'), 'utf8'), engineContext);
const keywordReplacement = vm.runInContext('lookupKeywordPopupReplacementInfo', engineContext);
const keywordLookup = vm.runInContext('getKeywordPopupLookupName', engineContext);
const patterns = vm.runInContext('({gggVarTagRegex, keywordPopupTagRegex, textDecorationTagNameRegex})', engineContext);
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Independent compatibility oracle: the previous editor's regexp matching,
// masking, boundaries and insertion order, without its DOM rendering stage.
function legacyHighlights(dictionary, game, english, highlightDict = true) {
  const entries = scope.activeEntries(dictionary, game);
  const HLs = [];
  let modified = matching.escapeHtml(english), nextHlId = 1, match;
  const add = hl => { hl._hlId = nextHlId++; HLs.push(hl); };
  const overlaps = (start, end) => HLs.some(hl => start < hl.index + hl.find.length && hl.index < end);
  const mask = (start, length) => { modified = modified.substring(0, start) + '*'.repeat(length) + modified.substring(start + length); };
  const decor = new RegExp(`(&lt;(${patterns.textDecorationTagNameRegex})&gt;\\{\\{([\\s\\S]*?)\\}\\})`, 'igm');
  while ((match = decor.exec(modified))) {
    const tagName = match[2], opener = `&lt;${tagName}&gt;`;
    add({ index: match.index, find: opener, tagName, isTextDecoration: true,
      replace: `<${tagName}>{{}}`, label: `<${tagName}>{{_}}`, caretOffset: `<${tagName}>{{`.length });
    mask(match.index, opener.length);
  }
  const keyword = new RegExp(patterns.keywordPopupTagRegex, 'igm');
  while ((match = keyword.exec(modified))) {
    const tagName = match[2], dynamicContent = match[3] || '';
    const rawTagName = matching.unescapeHtml(tagName), name = keywordLookup(rawTagName), key = name.toLowerCase();
    const rawDynamicContent = matching.unescapeHtml(dynamicContent), hasDynamicContent = /<[^>]*>/.test(rawDynamicContent);
    const staticContent = rawDynamicContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const dictIds = new Set();
    for (const text of [name, staticContent]) for (const entry of entries) {
      if (!text || !entry?._id || (key && String(entry.find || '').trim().toLowerCase() !== key)) continue;
      for (const pair of matching.getDefinitionPairs(entry)) {
        if (new RegExp(`\\b${escapePattern(pair.find)}\\b`, 'g').test(text)) { dictIds.add(entry._id); break; }
      }
    }
    const info = keywordReplacement(rawTagName, hasDynamicContent ? '' : rawDynamicContent, entries);
    add({ index: match.index, find: match[0], tagName, dynamicContent: hasDynamicContent ? '' : dynamicContent,
      isKeywordPopup: true, replace: info.text, dictId: info.dictEntry?._id,
      dictDefFind: info.matchedFind || '', dictIds: Array.from(dictIds) });
  }
  const variables = new RegExp(patterns.gggVarTagRegex, 'igm');
  while ((match = variables.exec(modified))) {
    const find = match[1] || match[0];
    if (!overlaps(match.index, match.index + find.length)) add({ index: match.index, find });
  }
  if (highlightDict) {
    const defs = [];
    for (const entry of entries) if (entry?._id) for (const pair of matching.getDefinitionPairs(entry)) defs.push({ entry, pair });
    defs.sort((a, b) => b.pair.find.length - a.pair.find.length);
    for (const { entry, pair } of defs) {
      const regex = new RegExp(`\\b${escapePattern(pair.find)}\\b`, 'g');
      while ((match = regex.exec(modified))) {
        if (overlaps(match.index, match.index + match[0].length)) continue;
        add({ index: match.index, find: match[0], replace: pair.replace, dictId: entry._id, dictDefFind: pair.find });
        mask(match.index, match[0].length);
      }
    }
  }
  return HLs.sort((a, b) => a.index - b.index);
}

const dictionary = [
  { _id: 'fire', find: ' Fire ', replace: 'ไฟ', alts: [{ _id: 'duplicate', find: 'fire', replace: 'duplicate' }, { _id: 'burn', find: 'Burning', replace: 'เผา' }], tlnote: 'Old note' },
  { _id: 'fire-second', find: 'Fire', replace: 'second', alts: [] },
  { _id: 'fire-damage', find: 'Fire Damage', replace: 'ความเสียหายไฟ', alts: [{ find: 'Damage' }] },
  { _id: 'cold', find: 'Cold', replace: 'หนาว', alts: [{ find: 'Frozen', replace: '' }] },
  { _id: 'literal', find: 'a.b', replace: 'dot', alts: [{ find: '(x)' }, { find: 'a+b' }] },
  { _id: 'entities', find: 'amp', replace: 'entity', alts: [{ find: 'A&B' }, { find: 'A&amp;B' }] },
  { _id: 'unicode', find: 'ไทย', replace: 'Thai', alts: [{ find: 'é' }, { find: 'é' }, { find: '🔥Fire' }] },
  { find: 'NoId', replace: 'missing ID', alts: [] },
  { _id: 'scope-all', find: 'Scoped', replace: 'all', alts: [{ find: 'SharedAlternate' }] },
  { _id: 'scope-one', gameScope: 'poe1', find: 'Scoped', replace: 'one', alts: [{ find: 'OneAlternate' }] },
  { _id: 'scope-two', gameScope: 'poe2', find: 'Scoped', replace: 'two' },
  { _id: 'numeric', find: 'Numeric', replace: 'fallback', alts: [{ find: 'number', replace: 123 }] },
  { _id: 'alternate-only', find: '', replace: 'fallback', alts: [{ find: 'OnlyAlternate' }] },
  null,
];

test('cooperative matcher preserves escaped coordinates, overlaps, alternatives, scope and tag semantics', () => {
  const samples = [
    'Fire Damage Fire fire Burning Damage Fireball wildfire Frozen Cold',
    'a.b a+b aXb abc(x)def (x) xไทยx ไทย xéx é é 🔥Fire',
    '[Fire|Burning] [Cold] A&B A&amp;B OnlyAlternate Scoped SharedAlternate OneAlternate',
    '<gold>{{Fire Damage}} [Fire|<gold>Burning</gold>] @{0}% {1} +{2:d} {}',
    '[Fire<gemlevel={0}>|Burning] [Unknown] [NoId] [Numeric|number]',
    '<Bad>{{unclosed [Fire] {0} <gold>{{closed}} [nested[Fire|Burning]',
    'Fire\nDamage Fire Damage Fire Damage <gold>{{x}} <gold>{{y}}', '',
  ];
  for (const game of ['poe1', 'poe2']) {
    const snapshot = drain(matching.buildSnapshot(dictionary, game, 7));
    for (const english of samples) for (const highlightDict of [true, false]) {
      const actual = drain(matching.matchSnapshot(snapshot, [{ key: 'unit', english }], { highlightDict }));
      assert.deepEqual(actual.units[0].HLs, legacyHighlights(dictionary, game, english, highlightDict), `${game}: ${english}`);
    }
  }
  assert.equal(matching.unescapeHtml(matching.escapeHtml('&lt; &amp; < > " \'')), '&lt; &amp; < > " \'');
});

test('ready snapshot metadata remains immutable and includes all matched alternatives and notes', () => {
  const input = structuredClone(dictionary), h = harness();
  h.send({ type: 'setSnapshot', generation: 1, game: 'poe1', entries: input }); h.flush();
  input[0].replace = 'NEW'; input[0].tlnote = 'New note'; input[0].alts[1].replace = 'NEW ALT';
  h.send({ type: 'match', requestId: 'immutable', units: [{ key: 1, english: 'Fire Burning' }] }); h.flush();
  const result = h.messages.find(message => message.type === 'matches');
  assert.equal(result.generation, 1);
  assert.equal(result.units[0].HLs[0].replace, 'ไฟ');
  assert.equal(result.entriesById.fire.tlnote, 'Old note');
  assert.equal(result.entriesById.fire.alts[1].replace, 'เผา');
  assert.equal(result.entriesById.fire._pairs.length, 2);
  assert.ok(Object.isFrozen(result.entriesById.fire));
  assert.ok(Object.isFrozen(result.entriesById.fire.alts[1]));
  assert.ok(Object.isFrozen(result.entriesById.fire._pairs[0]));
  assert.ok(Object.isFrozen(result.entriesById.fire._pairs[1]));
});

test('seeded mixed markup and malformed-tag combinations retain legacy matching order', () => {
  let seed = 94137;
  const random = count => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % count; };
  const fragments = ['Fire', 'Fire Damage', 'Burning', 'Frozen', 'Scoped', 'OneAlternate', 'a.b',
    'A&amp;B', ' ', '\n', '\t', '(', ')', '_', '+', '🔥', '[Fire]', '[Fire|Burning]', '[Cold|]',
    '[Unknown|<x>Fire]', '[', '[|', ']', '|', '<gold>{{', '}}', '<bad>', '@{0}%', '{d:+}', '{}',
    '[Fire<gemlevel={0}>|Burning]', '<gold>{{Fire}}', 'OnlyAlternate', 'NoId'];
  const snapshots = ['poe1', 'poe2'].map(game => drain(matching.buildSnapshot(dictionary, game, 1)));
  for (let sample = 0; sample < 300; sample++) {
    let english = '';
    for (let i = 0, length = 3 + random(12); i < length; i++) english += fragments[random(fragments.length)];
    for (let i = 0; i < snapshots.length; i++) {
      const actual = drain(matching.matchSnapshot(snapshots[i], [{ english }]));
      assert.deepEqual(actual.units[0].HLs, legacyHighlights(dictionary, i ? 'poe2' : 'poe1', english), english);
    }
  }
});

test('queries answer from ready generation while replacement is unfinished and publish atomically', () => {
  const h = harness();
  h.send({ type: 'setSnapshot', generation: 1, game: 'poe1', entries: [{ _id: 'word', find: 'Fire', replace: 'OLD' }] }); h.flush();
  const replacement = Array.from({ length: 2000 }, (_, i) => ({ _id: `d${i}`, find: `Unused ${i}`, replace: 'unused' }));
  replacement.push({ _id: 'word', find: 'Fire', replace: 'NEW' });
  h.send({ type: 'setSnapshot', generation: 2, game: 'poe1', entries: replacement }); h.step();
  h.send({ type: 'match', requestId: 'during', units: [{ key: 1, english: 'Fire' }] });
  h.until(() => h.messages.some(message => message.requestId === 'during'));
  assert.ok(!h.messages.some(message => message.type === 'ready' && message.generation === 2));
  assert.equal(h.messages.find(message => message.requestId === 'during').units[0].HLs[0].replace, 'OLD');
  h.flush();
  h.send({ type: 'match', requestId: 'after', units: [{ key: 1, english: 'Fire' }] }); h.flush();
  assert.equal(h.messages.find(message => message.requestId === 'after').units[0].HLs[0].replace, 'NEW');
});

test('long query stays pinned across publication and retired pins delay the following build', () => {
  const h = harness();
  h.send({ type: 'setSnapshot', generation: 1, game: 'poe1', entries: [{ _id: 'word', find: 'Fire', replace: 'OLD' }] }); h.flush();
  h.send({ type: 'match', requestId: 'long', units: [{ key: 1, english: 'Fire ' + 'x'.repeat(30000) }] }); h.step();
  h.send({ type: 'setSnapshot', generation: 2, game: 'poe1', entries: [{ _id: 'word', find: 'Fire', replace: 'MID' }] });
  h.send({ type: 'setSnapshot', generation: 3, game: 'poe1', entries: [{ _id: 'word', find: 'Fire', replace: 'NEW' }] });
  h.until(() => h.messages.some(message => message.type === 'ready' && message.generation === 2));
  assert.ok(!h.messages.some(message => message.requestId === 'long'));
  for (let i = 0; i < 20; i++) h.step();
  assert.ok(!h.messages.some(message => message.type === 'ready' && message.generation === 3));
  h.send({ type: 'match', requestId: 'mid', units: [{ key: 1, english: 'Fire' }] });
  h.until(() => h.messages.some(message => message.requestId === 'mid'));
  assert.equal(h.messages.find(message => message.requestId === 'mid').generation, 2);
  h.flush();
  const long = h.messages.find(message => message.requestId === 'long');
  assert.equal(long.generation, 1); assert.equal(long.units[0].HLs[0].replace, 'OLD');
  assert.equal(h.messages.at(-1).generation, 3);
});

test('interleaved queries use independent state; cancellation drains pins and newer pending input coalesces', () => {
  const h = harness();
  h.send({ type: 'match', requestId: 'first-ready', units: [{ key: 1, english: 'Fire Fire' }] });
  h.send({ type: 'setSnapshot', generation: 1, game: 'poe1', entries: [{ _id: 'word', find: 'Fire', replace: 'OLD' }] }); h.flush();
  assert.equal(h.messages.find(message => message.requestId === 'first-ready').units[0].HLs.length, 2);
  h.send({ type: 'match', requestId: 'cancel', units: [{ key: 1, english: 'Fire '.repeat(20000) }] });
  h.send({ type: 'match', requestId: 'short', units: [{ key: 1, english: 'Fire Fire Fire' }] });
  const entries = Array.from({ length: 200 }, (_, i) => ({ _id: `d${i}`, find: `Unused ${i}` }));
  h.send({ type: 'setSnapshot', generation: 2, game: 'poe1', entries }); h.step();
  h.send({ type: 'setSnapshot', generation: 3, game: 'poe1', entries });
  h.send({ type: 'setSnapshot', generation: 4, game: 'poe1', entries });
  h.send({ type: 'cancel', requestId: 'cancel' }); h.flush();
  assert.equal(h.messages.find(message => message.requestId === 'short').units[0].HLs.length, 3);
  assert.ok(!h.messages.some(message => message.requestId === 'cancel'));
  assert.deepEqual(h.messages.filter(message => message.type === 'ready').map(message => message.generation), [1, 2, 4]);
});

test('scope changes discard builds, ready snapshots and pending old-scope replies', () => {
  const h = harness();
  h.send({ type: 'setSnapshot', generation: 1, game: 'poe1', entries: dictionary });
  h.send({ type: 'match', requestId: 'old', units: [{ english: 'Fire' }] }); h.step();
  h.send({ type: 'setScope', scopeEpoch: 2, scopeKey: 'other/French/poe2' });
  h.send({ type: 'setSnapshot', scopeEpoch: 1, generation: 99, game: 'poe1', entries: dictionary });
  h.send({ type: 'setSnapshot', scopeEpoch: 2, generation: 1, game: 'poe2', entries: [] });
  h.send({ type: 'match', scopeEpoch: 2, requestId: 'new', units: [{ english: 'Fire {0}' }] }); h.flush();
  assert.ok(!h.messages.some(message => message.scopeEpoch === 1));
  const result = h.messages.find(message => message.requestId === 'new');
  assert.equal(result.scopeEpoch, 2); assert.deepEqual(result.units[0].HLs.map(hl => hl.find), ['{0}']);
});

test('exceptionally large definitions and single units yield inside their character loops', () => {
  const h = harness(), veryLong = 'F' + 'a'.repeat(30000);
  h.send({ type: 'setSnapshot', generation: 1, game: 'poe1', entries: [{ _id: 'long', find: veryLong, replace: 'long' }] });
  for (let i = 0; i < 10; i++) h.step();
  assert.equal(h.messages.length, 0, 'A single definition must span slices rather than complete in one turn.');
  h.flush();
  h.send({ type: 'match', requestId: 'large', units: [{ english: veryLong }] });
  h.send({ type: 'match', requestId: 'small', units: [{ english: '{0}' }] });
  h.until(() => h.messages.some(message => message.requestId === 'small'));
  assert.ok(!h.messages.some(message => message.requestId === 'large'));
  h.flush();
  assert.equal(h.messages.find(message => message.requestId === 'large').units[0].HLs[0].replace, 'long');
});

test('chunked transport stays invisible until commit and reconstructs large text and alternate fragments', () => {
  const h = harness();
  h.send({ type: 'setSnapshot', generation: 1, game: 'poe1', entries: [{ _id: 'fire', find: 'Fire', replace: 'OLD' }] }); h.flush();
  h.send({ type: 'beginSnapshot', generation: 2, game: 'poe1' });
  h.send({ type: 'appendEntries', generation: 2, startIndex: 0,
    entries: [{ _id: 'fire', find: '', replace: '', tlnote: '', alts: [] }] });
  h.send({ type: 'appendText', generation: 2, entryIndex: 0, field: 'find', text: 'Fi' });
  h.send({ type: 'match', requestId: 'partial', units: [{ english: 'Fire' }] }); h.flush();
  assert.equal(h.messages.find(message => message.requestId === 'partial').units[0].HLs[0].replace, 'OLD');
  assert.deepEqual(h.messages.filter(message => message.type === 'ready').map(message => message.generation), [1]);
  h.send({ type: 'appendText', generation: 2, entryIndex: 0, field: 'find', text: 're' });
  h.send({ type: 'appendText', generation: 2, entryIndex: 0, field: 'replace', text: 'NEW' });
  const longNote = 'Translator context. '.repeat(4000);
  for (let offset = 0; offset < longNote.length; offset += 32768) {
    h.send({ type: 'appendText', generation: 2, entryIndex: 0, field: 'tlnote', text: longNote.slice(offset, offset + 32768) });
  }
  h.send({ type: 'appendAlternates', generation: 2, entryIndex: 0, startIndex: 0,
    alts: [{ _id: 'burn', find: '', replace: '' }] });
  h.send({ type: 'appendText', generation: 2, entryIndex: 0, altIndex: 0, field: 'find', text: 'Burn' });
  h.send({ type: 'appendText', generation: 2, entryIndex: 0, altIndex: 0, field: 'find', text: 'ing' });
  h.send({ type: 'appendText', generation: 2, entryIndex: 0, altIndex: 0, field: 'replace', text: 'ALT' });
  const entry = { _id: 'cold', find: 'Cold', replace: 'COLD', alts: [{ _id: 'frozen', find: 'Frozen', replace: 'FROZEN' }] };
  h.send({ type: 'appendEntries', generation: 2, startIndex: 1, entries: [entry] });
  entry.find = 'Corrupted'; entry.alts[0].find = 'Corrupted';
  h.send({ type: 'commitSnapshot', generation: 2 }); h.flush();
  h.send({ type: 'appendText', generation: 2, entryIndex: 0, field: 'replace', text: ' CORRUPTED' });
  h.send({ type: 'match', requestId: 'assembled', units: [{ english: 'Fire Burning Cold Frozen' }] }); h.flush();
  const result = h.messages.find(message => message.requestId === 'assembled');
  assert.equal(result.generation, 2);
  assert.deepEqual(result.units[0].HLs.map(hl => hl.replace), ['NEW', 'ALT', 'COLD', 'FROZEN']);
  assert.equal(result.entriesById.fire.tlnote, longNote);
});

test('superseded transfers and old-scope chunks cannot contaminate a committed snapshot', () => {
  const h = harness();
  h.send({ type: 'beginSnapshot', generation: 1, game: 'poe1' });
  h.send({ type: 'appendEntries', generation: 1, startIndex: 0, entries: [{ _id: 'fire', find: 'Fire', replace: 'OLD' }] });
  h.send({ type: 'beginSnapshot', generation: 2, game: 'poe1' });
  h.send({ type: 'appendText', generation: 1, entryIndex: 0, field: 'replace', text: 'BAD' });
  h.send({ type: 'commitSnapshot', generation: 1 });
  h.send({ type: 'appendEntries', generation: 2, startIndex: 0, entries: [{ _id: 'fire', find: 'Fire', replace: 'NEW' }] });
  h.send({ type: 'commitSnapshot', generation: 2 }); h.flush();
  assert.deepEqual(h.messages.filter(message => message.type === 'ready').map(message => message.generation), [2]);
  h.send({ type: 'beginSnapshot', generation: 3, game: 'poe1' });
  h.send({ type: 'setScope', scopeEpoch: 2, scopeKey: 'other/French/poe2' });
  h.send({ type: 'appendEntries', generation: 3, startIndex: 0, entries: [{ _id: 'bad', find: 'Fire', replace: 'WRONG SCOPE' }] });
  h.send({ type: 'commitSnapshot', generation: 3 });
  h.send({ type: 'beginSnapshot', scopeEpoch: 2, generation: 1, game: 'poe2' });
  h.send({ type: 'appendEntries', scopeEpoch: 2, generation: 1, startIndex: 0, entries: [{ _id: 'fire', find: 'Fire', replace: 'OTHER' }] });
  h.send({ type: 'commitSnapshot', scopeEpoch: 2, generation: 1 });
  h.send({ type: 'match', scopeEpoch: 2, requestId: 'scope', units: [{ english: 'Fire' }] }); h.flush();
  assert.equal(h.messages.find(message => message.requestId === 'scope').units[0].HLs[0].replace, 'OTHER');
});

test('invalid chunk ordering rejects the assembly while retaining the published cache', () => {
  const h = harness();
  h.send({ type: 'setSnapshot', generation: 1, game: 'poe1', entries: [{ _id: 'fire', find: 'Fire', replace: 'OLD' }] }); h.flush();
  h.send({ type: 'beginSnapshot', generation: 2, game: 'poe1' });
  h.send({ type: 'appendEntries', generation: 2, startIndex: 2, entries: [{ _id: 'fire', find: 'Fire', replace: 'BAD' }] });
  h.send({ type: 'commitSnapshot', generation: 2 });
  const error = h.messages.find(message => message.type === 'error');
  assert.equal(error.generation, 2); assert.match(error.error.message, /consecutive/);
  h.send({ type: 'match', requestId: 'old-still-valid', units: [{ english: 'Fire' }] }); h.flush();
  assert.equal(h.messages.find(message => message.requestId === 'old-still-valid').units[0].HLs[0].replace, 'OLD');
  assert.deepEqual(h.messages.filter(message => message.type === 'ready').map(message => message.generation), [1]);
});

test('dispose prevents queued tasks from publishing', () => {
  const h = harness();
  h.send({ type: 'setSnapshot', generation: 1, game: 'poe1', entries: dictionary });
  h.runtime.dispose(); h.flush();
  assert.deepEqual(h.messages, []);
});
