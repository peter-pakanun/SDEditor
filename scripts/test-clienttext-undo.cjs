const test = require('node:test');
const assert = require('node:assert/strict');
const Undo = require('../public/clientTextUndo.js');

test('one paste restores every previous draft, blank position and raw newline together', () => {
    const history = Undo.create();
    const before = { values: { a: 'authored draft\r\nsecond line', b: '', c: 'untouched' } };
    const after = { values: { a: 'copied A', b: 'copied B', c: 'untouched' } };
    history.record(before, after);
    assert.deepEqual(history.undo(after), before);
    assert.deepEqual(history.redo(before), after);
    assert.equal(history.redo(after), null);
    before.values.a = 'mutated outside history';
    assert.equal(history.undo(after).values.a, 'authored draft\r\nsecond line');
});

test('native edits after a distributed paste undo before the whole paste', () => {
    const history = Undo.create();
    const original = { a: 'draft A', b: 'draft B' }, paste = { a: 'new A', b: 'new B' };
    const formatted = { a: '<b>{new A}', b: 'new B' };
    history.record(original, paste);
    history.record(paste, formatted);
    assert.deepEqual(history.undo(formatted), paste);
    assert.deepEqual(history.undo(paste), original);
    assert.deepEqual(history.redo(original), paste);
    const branch = { a: 'replacement branch', b: 'new B' };
    history.record(paste, branch);
    assert.equal(history.redo(branch), null);
    assert.deepEqual(history.undo(branch), paste);
});

test('picker/caret changes do not break Undo and restore recorded selection metadata', () => {
    const history = Undo.create({ key: state => JSON.stringify(state.values) });
    const before = { values: ['one', 'two'], sourceId: 'a', selection: [0, 3] };
    const after = { values: ['A', 'B'], sourceId: 'a', selection: [1, 1] };
    history.record(before, after);
    assert.deepEqual(history.undo({ ...after, sourceId: 'b', selection: [0, 0] }), before);
    assert.deepEqual(history.redo({ ...before, sourceId: 'b' }), after);
});

test('concurrent unexpected values cannot be overwritten by a stale undo entry', () => {
    const history = Undo.create();
    history.record(['old'], ['new']);
    assert.equal(history.undo(['concurrent']), null);
    assert.equal(history.canUndo(['concurrent']), false);
    assert.deepEqual(history.undo(['new']), ['old']);
    assert.equal(history.redo(['concurrent']), null);
});

test('typing groups coalesce, no-op edits retain redo, and bounds keep the latest transaction', () => {
    const history = Undo.create({ limit: 2 });
    history.record('', 'a', 'typing');
    history.record('a', 'ab', 'typing');
    assert.equal(history.undo('ab'), '');
    history.record('', '');
    assert.equal(history.redo(''), 'ab');
    history.record('ab', 'B'); history.record('B', 'C');
    assert.equal(history.undo('C'), 'B');
    assert.equal(history.undo('B'), 'ab');
    assert.equal(history.undo('ab'), null);
    const bounded = Undo.create({ maxBytes: 1 });
    bounded.record('', 'huge'); bounded.record('huge', 'latest');
    assert.equal(bounded.undo('latest'), 'huge');
    assert.equal(bounded.undo('huge'), null);
});

test('object key ordering does not change identity; reset fences an unrelated session', () => {
    const history = Undo.create();
    history.record({ a: 'old', b: 'same' }, { a: 'new', b: 'same' });
    assert.deepEqual(history.undo({ b: 'same', a: 'new' }), { a: 'old', b: 'same' });
    history.reset();
    assert.equal(history.canRedo({ a: 'old', b: 'same' }), false);
});
