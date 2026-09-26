const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Sync = require('../public/dictionarySync.js');

const clone = value => JSON.parse(JSON.stringify(value));
const alt = (_id, find, replace) => ({ _id, find, replace });
const entry = (_id = 'fire', fields = {}) => ({ _id, find: 'Fire', replace: 'ไฟ', alts: [], tlnote: '', ...fields });
const snapshot = (entries = [], revision = 1, tombstones = []) => ({ revision, entries, tombstones });
const resultEntry = result => result.entries[0];
const keep = (conflict, definitions = 'local', note = 'local') => Sync.resolve(conflict, { definitions, note });

test('browser global and CommonJS expose the same pure interface', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/dictionarySync.js'), 'utf8'), context);
  assert.equal(typeof context.DictionarySync.merge, 'function');
  assert.equal(typeof context.DictionarySync.resolve, 'function');
  assert.equal(typeof context.DictionarySync.normalizeEntries, 'function');
  assert.deepEqual(Object.keys(Sync), ['merge', 'resolve', 'normalizeEntries']);
});

test('does not mutate inputs, and result/candidates do not share nested input references', () => {
  const original = entry('fire', { alts: [alt('a', 'Flame', 'ไฟ')], tlnote: 'base' });
  const base = snapshot([original]);
  const local = [entry('fire', { ...clone(original), tlnote: 'local' })];
  const remote = snapshot([entry('fire', { ...clone(original), tlnote: 'remote' })], 2);
  const before = clone({ base, local, remote });
  const result = Sync.merge(base, local, remote);
  keep(result.conflicts[0]).alts[0].replace = 'changed resolved output';
  result.entries[0].alts[0].replace = 'changed output';
  result.conflicts[0].local.alts[0].replace = 'changed candidate snapshot';
  assert.deepEqual({ base, local, remote }, before);
  assert.equal(result.conflicts[0].localDefinitions.alts[0].replace, 'ไฟ');
});

test('unchanged data creates no writes', () => {
  const data = [entry()];
  const result = Sync.merge(snapshot(data), clone(data), snapshot(clone(data), 2));
  assert.deepEqual(result.entries, data);
  assert.deepEqual(result.upserts, []);
  assert.deepEqual(result.deletedIds, []);
  assert.deepEqual(result.conflicts, []);
});

test('independent settings within one entry and separate row fields merge', () => {
  const original = entry('fire', { alts: [alt('a', 'Flame', 'old')] });
  const local = entry('fire', { ...clone(original), find: 'FireDamage', alts: [alt('a', 'Flames', 'old')] });
  const remote = entry('fire', { ...clone(original), replace: 'new', tlnote: 'remote note', alts: [alt('a', 'Flame', 'updated')] });
  const result = Sync.merge(snapshot([original]), [local], snapshot([remote], 2));
  assert.deepEqual(result.conflicts, []);
  assert.equal(resultEntry(result).find, 'FireDamage');
  assert.equal(resultEntry(result).replace, 'new');
  assert.equal(resultEntry(result).tlnote, 'remote note');
  assert.deepEqual(resultEntry(result).alts, [alt('a', 'Flames', 'updated')]);
});

test('definition and note conflicts are the only two independent choices', () => {
  const original = entry('fire', { tlnote: 'base' });
  const local = entry('fire', { replace: 'local', tlnote: 'local note', alts: [alt('l', 'Local', 'l')] });
  const remote = entry('fire', { replace: 'remote', tlnote: 'remote note', alts: [alt('r', 'Remote', 'r')] });
  const result = Sync.merge(snapshot([original]), [local], snapshot([remote], 2));
  const conflict = result.conflicts[0];
  assert.equal(result.conflicts.length, 1);
  assert.equal(conflict.definitionsConflict, true);
  assert.equal(conflict.noteConflict, true);
  const resolved = keep(conflict, 'remote', 'local');
  assert.equal(resolved.replace, 'remote');
  assert.equal(resolved.tlnote, 'local note');
  assert.deepEqual(new Set(resolved.alts.map(row => row._id)), new Set(['l', 'r']));
  assert.deepEqual(result.upserts, []);
  assert.deepEqual(result.deletedIds, []);
});

test('same edits coalesce and note-only changes do not disturb definitions', () => {
  const original = entry();
  const edited = entry('fire', { replace: 'same', tlnote: 'same' });
  const result = Sync.merge(snapshot([original]), [edited], snapshot([clone(edited)], 2));
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.upserts, []);
});

test('first attach matches only unique main Find and remaps unique alternate IDs', () => {
  const local = entry('local-id', { find: ' fire ', alts: [alt('local-alt', 'Flames', 'ไฟ')] });
  const remote = entry('remote-id', { alts: [alt('remote-alt', 'flames', 'ไฟ')], tlnote: 'kept' });
  const result = Sync.merge(null, [local], snapshot([remote]));
  assert.equal(result.entries.length, 1);
  assert.equal(resultEntry(result)._id, 'remote-id');
  assert.equal(resultEntry(result).find, 'Fire');
  assert.equal(resultEntry(result).alts[0]._id, 'remote-alt');
  assert.equal(resultEntry(result).alts[0].find, 'flames');
  assert.equal(resultEntry(result).tlnote, 'kept');
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.upserts, []);
});

test('initial primary and note disagreements conflict after identity alignment', () => {
  const result = Sync.merge(null,
    [entry('local', { replace: 'own', tlnote: 'own note' })],
    snapshot([entry('remote', { replace: 'other', tlnote: 'other note' })]));
  assert.equal(result.conflicts[0].id, 'remote');
  assert.equal(result.conflicts[0].definitionsConflict, true);
  assert.equal(result.conflicts[0].noteConflict, true);
  assert.equal(keep(result.conflicts[0], 'local', 'remote').tlnote, 'other note');
});

test('initial omission and blank values do not delete cloud data', () => {
  const local = entry('fire', { replace: '', tlnote: '', alts: [] });
  const remote = entry('fire', { tlnote: 'cloud note', alts: [alt('a', 'Flame', 'cloud')] });
  const extra = entry('ice', { find: 'Ice', replace: 'น้ำแข็ง' });
  const result = Sync.merge(null, [local], snapshot([remote, extra]));
  assert.deepEqual(result.entries, [remote, extra]);
  assert.deepEqual(result.deletedIds, []);
  assert.deepEqual(result.upserts, []);
});

test('ambiguous duplicate main Finds retain all entries and notes', () => {
  const local = [entry('l1', { tlnote: 'local one' }), entry('l2', { tlnote: 'local two' })];
  const remote = [entry('r1', { tlnote: 'remote' })];
  const result = Sync.merge(null, local, snapshot(remote));
  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries.map(row => row._id), ['r1', 'l1', 'l2']);
  assert.deepEqual(new Set(result.entries.map(row => row.tlnote)), new Set(['remote', 'local one', 'local two']));
  assert.deepEqual(result.conflicts, []);
});

test('matching stable IDs outranks ambiguous Find and does not claim a remote twice', () => {
  const local = [entry('shared'), entry('old-import', { tlnote: 'distinct' })];
  const remote = [entry('shared')];
  const result = Sync.merge(null, local, snapshot(remote));
  assert.deepEqual(result.entries.map(row => row._id), ['shared', 'old-import']);
  assert.deepEqual(result.conflicts, []);
});

test('a known baseline does not match newly added entries by spelling', () => {
  const result = Sync.merge(snapshot([]), [entry('local')], snapshot([entry('remote')], 2));
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.conflicts, []);
});

test('local and remote distinct additions union while top insertion remains at top', () => {
  const existing = entry('old', { find: 'Existing' });
  const local = [entry('new-local', { find: 'Local' }), existing];
  const remote = [entry('new-remote', { find: 'Remote' }), existing];
  const result = Sync.merge(snapshot([existing]), local, snapshot(remote, 2));
  assert.deepEqual(result.entries.map(row => row._id), ['new-remote', 'new-local', 'old']);
  assert.deepEqual(result.upserts.map(row => row._id), ['new-local']);
});

test('different concurrent renames conflict without creating new identities', () => {
  const original = entry();
  const result = Sync.merge(snapshot([original]), [entry('fire', { find: 'FireDamage' })], snapshot([entry('fire', { find: 'Burning' })], 2));
  assert.equal(result.entries.length, 1);
  assert.equal(result.conflicts[0].definitionsConflict, true);
  assert.equal(keep(result.conflicts[0], 'remote').find, 'Burning');
  assert.equal(keep(result.conflicts[0], 'remote')._id, 'fire');
});

test('unilateral deletion applies in either direction and double deletion coalesces', () => {
  const original = entry();
  let result = Sync.merge(snapshot([original]), [], snapshot([original], 2));
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.deletedIds, ['fire']);
  assert.deepEqual(result.conflicts, []);
  result = Sync.merge(snapshot([original]), [original], snapshot([], 2, ['fire']));
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.deletedIds, []);
  result = Sync.merge(snapshot([original]), [], snapshot([], 2, ['fire']));
  assert.deepEqual(result.conflicts, []);
});

test('delete versus note-only edit requires an existence choice and preserves survivor note', () => {
  const original = entry('fire', { tlnote: 'old' });
  const changed = entry('fire', { tlnote: 'important new note' });
  let result = Sync.merge(snapshot([original]), [], snapshot([changed], 2));
  assert.equal(result.conflicts[0].definitionsConflict, true);
  assert.equal(result.conflicts[0].noteConflict, false);
  assert.equal(keep(result.conflicts[0], 'local'), null);
  assert.equal(keep(result.conflicts[0], 'remote', 'local').tlnote, 'important new note');
  assert.deepEqual(result.deletedIds, []);
  result = Sync.merge(snapshot([original]), [changed], snapshot([], 2, ['fire']));
  assert.equal(keep(result.conflicts[0], 'remote'), null);
  assert.equal(keep(result.conflicts[0], 'local', 'remote').tlnote, 'important new note');
  assert.deepEqual(result.upserts, []);
});

test('remote tombstones block stale first-attach resurrection, but acknowledged restoration can upload', () => {
  const original = entry();
  const remote = snapshot([], 4, ['fire']);
  for (const base of [null, snapshot([], 1)]) {
    const result = Sync.merge(base, [original], remote);
    assert.equal(result.conflicts[0].reason, 'remote-deletion');
    assert.deepEqual(result.upserts, []);
    assert.equal(keep(result.conflicts[0], 'remote'), null);
  }
  const result = Sync.merge(remote, [original], remote);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.upserts, [original]);
});

test('alternate deletion versus edit conflicts while unrelated additions survive either choice', () => {
  const original = entry('fire', { alts: [alt('a', 'Flame', 'old')] });
  const local = entry('fire', { alts: [alt('b', 'Local', 'l')] });
  const remote = entry('fire', { alts: [alt('a', 'Flame', 'edited'), alt('c', 'Remote', 'r')] });
  const result = Sync.merge(snapshot([original]), [local], snapshot([remote], 2));
  const own = keep(result.conflicts[0], 'local');
  const other = keep(result.conflicts[0], 'remote');
  assert.deepEqual(new Set(own.alts.map(row => row._id)), new Set(['b', 'c']));
  assert.deepEqual(new Set(other.alts.map(row => row._id)), new Set(['a', 'b', 'c']));
  assert.equal(other.alts.find(row => row._id === 'a').replace, 'edited');
});

test('same alternate replacement conflict preserves a separately merged rename', () => {
  const original = entry('fire', { alts: [alt('a', 'Flame', 'old')] });
  const local = entry('fire', { alts: [alt('a', 'Flames', 'local')] });
  const remote = entry('fire', { alts: [alt('a', 'Flame', 'remote')] });
  const result = Sync.merge(snapshot([original]), [local], snapshot([remote], 2));
  assert.deepEqual(keep(result.conflicts[0], 'remote').alts, [alt('a', 'Flames', 'remote')]);
});

test('one-sided row ordering merges; incompatible reorder uses the definitions choice', () => {
  const rows = [alt('a', 'A', 'a'), alt('b', 'B', 'b'), alt('c', 'C', 'c')];
  const original = entry('fire', { alts: rows });
  const local = entry('fire', { alts: [rows[1], rows[0], rows[2]] });
  let result = Sync.merge(snapshot([original]), [local], snapshot([original], 2));
  assert.deepEqual(resultEntry(result).alts.map(row => row._id), ['b', 'a', 'c']);
  assert.deepEqual(result.conflicts, []);
  const remote = entry('fire', { alts: [rows[0], rows[2], rows[1]] });
  result = Sync.merge(snapshot([original]), [local], snapshot([remote], 2));
  assert.equal(result.conflicts[0].reason, 'row-order');
  assert.deepEqual(keep(result.conflicts[0], 'local').alts.map(row => row._id), ['b', 'a', 'c']);
  assert.deepEqual(keep(result.conflicts[0], 'remote').alts.map(row => row._id), ['a', 'c', 'b']);
});

test('conflicts block only their own entry while other modifications and deletions upload', () => {
  const original = [entry('a'), entry('b', { find: 'B' }), entry('c', { find: 'C' })];
  const local = [entry('a', { replace: 'local' }), entry('b', { find: 'B', tlnote: 'changed' })];
  const remote = [entry('a', { replace: 'remote' }), original[1], original[2]];
  const result = Sync.merge(snapshot(original), local, snapshot(remote, 2));
  assert.deepEqual(result.conflicts.map(conflict => conflict.id), ['a']);
  assert.deepEqual(result.upserts.map(row => row._id), ['b']);
  assert.deepEqual(result.deletedIds, ['c']);
});

test('blank-Find drafts remain local and are excluded from upserts', () => {
  const draft = entry('draft', { find: '   ', replace: 'draft', tlnote: 'keep locally' });
  const result = Sync.merge(null, [draft], snapshot([]));
  assert.deepEqual(result.entries, [draft]);
  assert.deepEqual(result.upserts, []);
  assert.deepEqual(result.deletedIds, []);
});

test('numeric and missing IDs normalize to deterministic string identities', () => {
  const local = [{ _id: 1, find: 'A', replace: 'a', alts: [{ _id: 2, find: 'B', replace: 'b' }] }, { find: 'C', replace: 'c' }];
  const result = Sync.merge(null, local, snapshot([]));
  assert.equal(result.entries[0]._id, '1');
  assert.equal(result.entries[0].alts[0]._id, '2');
  assert.equal(typeof result.entries[1]._id, 'string');
  assert.deepEqual(result, Sync.merge(null, local, snapshot([])));
});

test('rebase compares against newer remote and does not silently apply an old resolution', () => {
  const base = snapshot([entry()]);
  const local = [entry('fire', { replace: 'local' })];
  const seen = snapshot([entry('fire', { replace: 'remote one' })], 2);
  const first = Sync.merge(base, local, seen);
  const resolved = keep(first.conflicts[0], 'local');
  const newer = snapshot([entry('fire', { replace: 'remote two', tlnote: 'new note' })], 3);
  const rebased = Sync.merge(seen, [resolved], newer);
  assert.equal(rebased.conflicts.length, 1);
  assert.equal(keep(rebased.conflicts[0], 'local').tlnote, 'new note');
  assert.equal(keep(rebased.conflicts[0], 'remote').replace, 'remote two');
});
