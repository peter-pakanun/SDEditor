const assert = require('node:assert/strict');
const test = require('node:test');
const { splitTmx, writeTmx } = require('../public/tmx.js');

test('split TMX counts escaped UTF-8 bytes and retains whole entries in order', () => {
  const units = [
    { source: 'Fire & ice', target: 'ไฟและน้ำแข็ง 🔥', note: '<literal>', gameScope: 'poe2' },
    { source: 'Wind', target: 'สายลม', context: { contentMode: 'clienttext', form: 'A' } },
    { source: 'Earth', target: 'ดิน' }
  ];
  const firstPart = writeTmx(units.slice(0, 2), 'Thai');
  const maxBytes = Buffer.byteLength(firstPart);
  assert.ok(firstPart.length < maxBytes);
  const parts = splitTmx(units, 'Thai', maxBytes);
  assert.deepEqual(parts, [firstPart, writeTmx(units.slice(2), 'Thai')]);
  assert.ok(parts.every((part) => Buffer.byteLength(part) <= maxBytes));
  assert.ok(splitTmx(units, 'Thai', maxBytes - 1).every((part) => Buffer.byteLength(part) < maxBytes));
});

test('split TMX stays within the Weblate unit count even at a high byte limit', () => {
  const unit = { source: 'Fire', target: 'Feuer' };
  const parts = splitTmx(Array(100_001).fill(unit), 'German', 50_000_000);
  assert.deepEqual(parts.map((part) => [...part.matchAll(/<tu>/g)].length), [100_000, 1]);
});

test('split TMX reports a limit too small for a header or complete entry', () => {
  const unit = { source: 'Fire', target: 'Feuer' };
  const empty = writeTmx([], 'German');
  assert.deepEqual(splitTmx([], 'German', Buffer.byteLength(empty)), [empty]);
  assert.throws(() => splitTmx([], 'German', Buffer.byteLength(empty) - 1), /TMX header/);
  assert.throws(() => splitTmx([unit], 'German', Buffer.byteLength(empty)), /single translation entry/);
});
