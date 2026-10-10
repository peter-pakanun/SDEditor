const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../public/entryAlignment.js');

test('a removed middle English entry keeps later translations in their matching positions', () => {
  const state = A.create(['One', 'Three'], ['หนึ่ง', 'สอง', 'สาม'], ['One', 'Two', 'Three']);
  assert.deepEqual(state.slots, [0, 2]);
  assert.deepEqual(A.pending(state), { unresolved: 0, unassigned: 1 });
  assert.equal(A.ready(state), false);
  assert.throws(() => A.translations(state), /mark every remaining translation entry obsolete/);
  A.setObsolete(state, 1, true);
  assert.equal(A.ready(state), true);
  assert.deepEqual(A.translations(state), ['หนึ่ง', 'สาม']);
  assert.equal(state.items[1].translation, 'สอง', 'The obsolete block stays reviewable in the alignment state.');
});

test('new English entries require an explicit assignment or blank decision', () => {
  const state = A.create(['One', 'New', 'Three'], ['one', 'three'], ['One', 'Three']);
  assert.deepEqual(state.slots, [0, null, 1]);
  assert.deepEqual(A.pending(state), { unresolved: 1, unassigned: 0 });
  assert.equal(A.ready(state), false);
  A.leaveBlank(state, 1);
  assert.equal(A.ready(state), true);
  assert.deepEqual(A.translations(state), ['one', '', 'three']);
  A.unassign(state, 1);
  assert.equal(A.ready(state), false, 'An explicit blank can be returned to unresolved.');
});

test('duplicate English entries are never guessed even when their counts match', () => {
  const state = A.create(['Repeated', 'Unique', 'Repeated'], ['first', 'second', 'third'], ['Repeated', 'Unique', 'Repeated']);
  assert.deepEqual(state.slots, [null, 1, null]);
  assert.deepEqual(A.pending(state), { unresolved: 2, unassigned: 2 });
  A.assign(state, 2, 0);
  A.assign(state, 0, 2);
  assert.deepEqual(A.translations(state), ['third', 'second', 'first']);
});

test('a duplicate on either side prevents automatic placement', () => {
  assert.deepEqual(A.create(['Repeated'], ['a', 'b'], ['Repeated', 'Repeated']).slots, [null]);
  assert.deepEqual(A.create(['Repeated', 'Repeated'], ['a'], ['Repeated']).slots, [null, null]);
  assert.deepEqual(A.create(['Repeated'], ['a'], ['Repeated', 'Repeated']).slots, [null],
    'Old English remains ambiguous even if a duplicate has no retained translation.');
});

test('unavailable old English and merely similar English require manual placement', () => {
  assert.deepEqual(A.create(['One', 'Two'], ['one', 'two']).slots, [null, null]);
  assert.deepEqual(A.create(['One ', 'Two'], ['one', 'two'], ['One', null]).slots, [null, null]);
  assert.deepEqual(A.create(['One', 'Two'], ['one', 'two'], ['One']).slots, [0, null]);
});

test('moving a block returns the displaced block to the pool without swapping it', () => {
  const state = A.create(['One', 'Two', 'Three'], ['one', 'two', 'three'], ['One', 'Two', 'Three']);
  A.assign(state, 0, 1);
  assert.deepEqual(state.slots, [null, 0, 2]);
  assert.deepEqual(A.pending(state), { unresolved: 1, unassigned: 1 });
  A.assign(state, 1, 0);
  assert.deepEqual(A.translations(state), ['two', 'one', 'three']);
  A.leaveBlank(state, 1);
  assert.deepEqual(A.pending(state), { unresolved: 0, unassigned: 1 }, 'Replacing an assigned block with blank returns it to the pool.');
  A.setObsolete(state, 0, true);
  assert.deepEqual(A.translations(state), ['two', '', 'three']);
});

test('obsolete decisions remove assignments and remain reversible', () => {
  const state = A.create(['One'], ['one'], ['One']);
  A.setObsolete(state, 0, true);
  assert.deepEqual(state.slots, [null]);
  assert.deepEqual(A.pending(state), { unresolved: 1, unassigned: 0 });
  A.leaveBlank(state, 0);
  assert.deepEqual(A.translations(state), ['']);
  A.setObsolete(state, 0, false);
  assert.deepEqual(A.pending(state), { unresolved: 0, unassigned: 1 });
  A.setObsolete(state, 0, true);
  A.assign(state, 0, 0);
  assert.equal(state.items[0].obsolete, false, 'An explicit assignment restores the obsolete block.');
  assert.deepEqual(A.translations(state), ['one']);
});

test('raw multiline, table and escaped strings retain exact fidelity without changing inputs', () => {
  const english = Object.freeze(['A', 'B', 'C']);
  const raw = Object.freeze(['  多行\n第二行\r\n', '| a | b |\n|---|---|\n| x | y |', 'literal \\n \\r \\t {0} <tag> &amp; "quote"']);
  const old = Object.freeze(['C', 'A', 'B']);
  const state = A.create(english, raw, old);
  assert.deepEqual(state.slots, [1, 2, 0]);
  assert.deepEqual(A.translations(state), [raw[1], raw[2], raw[0]]);
  state.english[0] = 'Changed';
  assert.equal(english[0], 'A');
  assert.deepEqual(raw, ['  多行\n第二行\r\n', '| a | b |\n|---|---|\n| x | y |', 'literal \\n \\r \\t {0} <tag> &amp; "quote"']);
  assert.deepEqual(old, ['C', 'A', 'B']);
});

test('identical translations stay separate cards with distinct old English', () => {
  const state = A.create(['One', 'Three'], ['same', 'same', 'same'], ['One', 'Two', 'Three']);
  assert.equal(state.items.length, 3);
  assert.deepEqual(state.items.map(item => item.id), [0, 1, 2]);
  A.setObsolete(state, 1, true);
  assert.deepEqual(A.translations(state), ['same', 'same']);
});

test('stale IDs and positions reject without changing the alignment', () => {
  const state = A.create(['One'], ['one'], ['One']);
  const before = structuredClone(state);
  for (const id of [-1, 1, 0.5, '0', NaN, null]) {
    assert.throws(() => A.assign(state, id, 0), /translation entry is no longer available/);
    assert.throws(() => A.setObsolete(state, id, true), /translation entry is no longer available/);
  }
  for (const index of [-1, 1, 0.5, '0', NaN, null]) {
    assert.throws(() => A.assign(state, 0, index), /English entry position is no longer available/);
    assert.throws(() => A.leaveBlank(state, index), /English entry position is no longer available/);
    assert.throws(() => A.unassign(state, index), /English entry position is no longer available/);
  }
  assert.throws(() => A.setObsolete(state, 0, 'yes'), /true or false/);
  assert.deepEqual(state, before);
});

test('final translation construction rejects duplicate, invalid and contradictory slots', () => {
  const original = A.create(['One', 'Two'], ['one', 'two'], ['One', 'Two']);
  for (const slots of [[0, 0], [0, 2], [0, undefined], [0, '0']]) {
    const state = { ...structuredClone(original), slots };
    assert.equal(A.ready(state), false);
    assert.throws(() => A.translations(state));
  }
  const obsoleteAssigned = structuredClone(original);
  obsoleteAssigned.items[0].obsolete = true;
  assert.equal(A.ready(obsoleteAssigned), false);
  assert.throws(() => A.translations(obsoleteAssigned), /obsolete/);
  const missingSlot = { ...structuredClone(original), slots: [0] };
  assert.equal(A.ready(missingSlot), false);
  assert.throws(() => A.translations(missingSlot), /do not match/);
  const wrongItemId = structuredClone(original);
  wrongItemId.items[0].id = 5;
  assert.equal(A.ready(wrongItemId), false);
  assert.throws(() => A.translations(wrongItemId), /invalid translation item/);
  const missingItem = { ...structuredClone(original), items: new Array(2), slots: ['blank', 'blank'] };
  assert.equal(A.ready(missingItem), false);
  assert.throws(() => A.translations(missingItem), /invalid translation item/);
});

test('an empty current source still requires an obsolete decision for each retained block', () => {
  const state = A.create([], ['retained']);
  assert.equal(A.ready(state), false);
  A.setObsolete(state, 0, true);
  assert.equal(A.ready(state), true);
  assert.deepEqual(A.translations(state), []);
  assert.deepEqual(A.translations(A.create([], [])), []);
});
