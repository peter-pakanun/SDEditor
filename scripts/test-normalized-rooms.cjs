const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../public/normalizedRooms.js');
const copy = structuredClone;
const identity = { accountId: 'user', game: 'poe1', branchId: 'default', sourceHash: 'a'.repeat(64), language: 'Thai' };
const roomKey = JSON.stringify(['user', 'poe1', identity.sourceHash, 'Thai']);
function unavailableFixture(options = {}) {
  let transactions = 0, legacyReads = 0, ensures = 0;
  const stores = { rooms: 'rooms', shared: 'shared', operations: 'operations', roomRecords: 'records',
    meta: 'workspaces', files: 'files', records: 'workspaceRecords', baseline: 'baseline', migration: 'migration' };
  const n = { stores, key: (...parts) => JSON.stringify(parts), copy, same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    async transaction(names, mode, fn) {
      transactions++; assert.equal(mode, 'readonly', 'Missing evidence must never commit readiness or rewrite the old cache.');
      return fn({ objectStore(name) {
        assert.equal(name, stores.rooms);
        return { getAll() { const req = {}; queueMicrotask(() => { req.result = []; req.onsuccess(); }); return req; } };
      } });
    },
    async get() {},
    async ensure() { ensures++; if (options.ensureError) throw options.ensureError; },
    async hasScope() { return false; },
    dependencies: { normalizeScope: scope => scope,
      async legacyGet() { legacyReads++; return { version: 1, rooms: { [roomKey]: { identity, shared: {}, local: {}, outbox: [] } } }; },
    },
  };
  return { rooms: create(n), counts: () => ({ transactions, legacyReads, ensures }) };
}

test('room migration stays unready and preserves evidence when the original workspace is unavailable', async () => {
  const { rooms, counts } = unavailableFixture();
  await assert.rejects(rooms.ensureRoom(roomKey, identity), { code: 'ROOM_SOURCE_UNAVAILABLE' });
  await assert.rejects(rooms.ensureRoom(roomKey, identity), { code: 'ROOM_SOURCE_UNAVAILABLE' });
  assert.deepEqual(counts(), { transactions: 2, legacyReads: 2, ensures: 2 }, 'A later import can retry conversion rather than trusting false readiness.');
});

test('global cold room listings preserve unavailable foreign caches without blocking other scopes', async () => {
  const { rooms, counts } = unavailableFixture();
  assert.deepEqual(await rooms.getState(), { version: 1, rooms: {} });
  assert.equal(counts().legacyReads, 1);
  assert.equal(counts().ensures, 1);
});

test('explicit room selection reports missing source evidence instead of silently returning another room', async () => {
  const { rooms } = unavailableFixture();
  await assert.rejects(rooms.getState({ key: roomKey, scope: identity }), { code: 'ROOM_SOURCE_UNAVAILABLE' });
});

test('missing original-source errors skip inactive room conversion while quota failures remain visible', async t => {
  for (const message of ['The original source is unavailable. Reimport its matching ZIP.', 'The accepted baseline evidence is incomplete. Reimport the matching original ZIP.']) {
    await t.test(message, async () => {
      const { rooms } = unavailableFixture({ ensureError: new Error(message) });
      await assert.rejects(rooms.ensureRoom(roomKey, identity), { code: 'ROOM_SOURCE_UNAVAILABLE' });
      assert.deepEqual(await rooms.getState(), { version: 1, rooms: {} });
    });
  }
  const quota = Object.assign(new Error('Storage quota exceeded.'), { name: 'QuotaExceededError' });
  const { rooms } = unavailableFixture({ ensureError: quota });
  await assert.rejects(rooms.getState(), { name: 'QuotaExceededError' });
  assert.equal(quota.code, undefined);
});

test('partial commands create distinct stable recovery identities for matching timestamp and array position', async () => {
  const stores = { rooms: 'rooms', shared: 'shared', operations: 'operations', roomRecords: 'records' }, writes = [];
  const key = (...parts) => JSON.stringify(parts);
  const request = value => { const req = {}; queueMicrotask(() => { req.result = value; req.onsuccess(); }); return req; };
  const tx = { objectStore(name) { return {
    get() { return request(undefined); }, index() { return { getAll() { return request([]); } }; },
    put(value) { if (name === 'records') writes.push(copy(value)); }, delete() {},
  }; } };
  const rooms = create({ stores, copy, key, same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    row: (scope, id, value, extra = {}) => ({ key: key(scope, id), scope, value: copy(value), ...extra }), async get() {} });
  const makeRoom = filepath => ({ identity, shared: {}, outbox: [], conflicts: [], recovery: [{ at: 123, reason: 'Preserved save', files: [{ filepath, translations: ['recovered'] }] }] });
  const first = makeRoom('a.txt'), second = makeRoom('b.txt');
  await rooms.writeRoom(tx, roomKey, first, ['a.txt'], []);
  await rooms.writeRoom(tx, roomKey, second, ['b.txt'], []);
  const groups = () => writes.filter(row => row.value.field === 'recovery');
  assert.notEqual(groups()[0].key, groups()[1].key);
  const originalKey = groups()[0].key;
  await rooms.writeRoom(tx, roomKey, first, ['a.txt'], []);
  assert.equal(groups()[2].key, originalKey, 'Retrying the captured recovery reuses its original record identity.');
  assert.equal(writes[0].value.data.localRecordId, undefined, 'The storage identity does not alter the preserved recovery content.');
});

test('one-file recovery commands preserve large groups without reading their other members or rewriting unchanged records', async () => {
  const stores = { rooms: 'rooms', shared: 'shared', operations: 'operations', roomRecords: 'records', baseline: 'baseline' };
  const data = Object.fromEntries(Object.values(stores).map(name => [name, new Map()])), reads = [], writes = [];
  const key = (...parts) => JSON.stringify(parts), baseId = key(identity.game, identity.sourceHash);
  const request = value => { const req = {}; queueMicrotask(() => { req.result = copy(value); req.onsuccess(); }); return req; };
  const tx = { objectStore(name) { return {
    get(id) { const value = data[name].get(id); reads.push({ name, id, value: copy(value) }); return request(value); },
    index() { return { getAll(path) {
      const value = [...data[name].values()].filter(row => row.pathKey === path || row.paths?.includes(path));
      reads.push({ name, index: path, value: copy(value) }); return request(value);
    } }; },
    put(value) { writes.push({ name, value: copy(value) }); data[name].set(value.key, copy(value)); },
    delete(id) { writes.push({ name, id }); data[name].delete(id); },
  }; } };
  const rooms = create({ stores, copy, key, same: (a, b) => JSON.stringify(a) === JSON.stringify(b), baselineKey: () => baseId,
    row: (scope, id, value, extra = {}) => ({ key: key(scope, id), scope, value: copy(value), ...extra }),
    async get(tx, name, id) { const value = data[name].get(id); reads.push({ name, id, value: copy(value) }); return copy(value?.value); },
    async all(tx, name, scope) { reads.push({ name, all: true }); return [...data[name].values()].filter(row => row.scope === scope).map(value => copy(value)); },
    async readWorkspace() { return { descs: [], staged: {} }; },
  });
  const files = Array.from({ length: 1200 }, (_, index) => ({ filepath: `file-${1199 - index}.txt`, translations: ['Recovered ' + index], revision: index }));
  const group = { id: 'original-recovery-id', at: 9876, reason: 'Local workspace changed while disconnected', provenance: { sourceHash: identity.sourceHash }, files };
  const empty = { id: 'empty-group', at: 1, reason: 'Preserved empty facts', files: [] };
  await rooms.writeRoom(tx, roomKey, { identity, shared: {}, outbox: [], recovery: [group, empty], conflicts: [] });
  const comparable = value => { const result = copy(value); delete result.localRecordId; delete result._storageRecovery; return result; };
  assert.deepEqual((await rooms.readRoom(tx, roomKey)).room.recovery.map(comparable), [comparable(group), comparable(empty)]);
  const native = [...data.records.values()];
  assert.equal(native.filter(row => row.value.field === 'recoveryFiles').length, files.length);
  assert.ok(native.filter(row => row.value.field === 'recovery').every(row => row.value.data.files === undefined && row.paths.length === 0));
  const target = files[71].filepath;
  reads.length = 0; writes.length = 0;
  const hot = await rooms.readRoom(tx, roomKey, [target]);
  assert.deepEqual(hot.selection.filepaths, [target]);
  assert.equal(hot.room.recovery.length, 1);
  assert.deepEqual(hot.room.recovery[0].files, [files[71]]);
  await rooms.writeRoom(tx, roomKey, hot.room, hot.selection.filepaths, hot.selection.operationIds);
  assert.equal(writes.length, 0);
  assert.ok(reads.every(read => !read.all));
  assert.deepEqual(reads.filter(read => read.name === 'baseline').map(read => read.id), [key(baseId, target)]);
  assert.ok(reads.reduce((sum, read) => sum + JSON.stringify(read.value || null).length, 0) < 16000, 'Read payload is bounded by the selected member rather than the 1200-file group.');
  hot.room.recovery[0].files[0].translations = ['Edited recovery'];
  await rooms.writeRoom(tx, roomKey, hot.room, hot.selection.filepaths, hot.selection.operationIds);
  let cold = await rooms.readRoom(tx, roomKey);
  const expected = copy(files); expected[71].translations = ['Edited recovery'];
  assert.deepEqual(cold.room.recovery[0].files, expected, 'Changing a selected recovery retains its exact position and every unselected member.');
  const removing = await rooms.readRoom(tx, roomKey, [target]); removing.room.recovery = [];
  await rooms.writeRoom(tx, roomKey, removing.room, removing.selection.filepaths, []);
  cold = await rooms.readRoom(tx, roomKey);
  assert.deepEqual(cold.room.recovery[0].files, files.filter(file => file.filepath !== target));
  assert.equal(cold.room.recovery[0]._storageRecovery.fileCount, files.length - 1);
  assert.deepEqual(comparable(cold.room.recovery[1]), comparable(empty));
  const addTarget = files[0].filepath, adding = await rooms.readRoom(tx, roomKey, [addTarget]);
  adding.room.recovery.push({ at: 9876, reason: group.reason, files: [{ filepath: addTarget, translations: ['New recovery'] }] });
  await rooms.writeRoom(tx, roomKey, adding.room, adding.selection.filepaths, []);
  cold = await rooms.readRoom(tx, roomKey);
  assert.equal(cold.room.recovery.length, 3);
  assert.equal(cold.room.recovery[2].files[0].translations[0], 'New recovery');
  const last = await rooms.readRoom(tx, roomKey, [addTarget]); last.room.recovery = last.room.recovery.filter(entry => entry.id === group.id);
  await rooms.writeRoom(tx, roomKey, last.room, last.selection.filepaths, []);
  assert.equal((await rooms.readRoom(tx, roomKey)).room.recovery.length, 2, "Removing a group's final member also removes its header.");
});

test('room conversion reconstructs pending placeholder repairs after workspace readiness survives a crash', async () => {
  const rooms = create({ stores: {}, copy, key: (...parts) => JSON.stringify(parts) });
  const blank = { filepath: 'a.txt', translations: [''], revision: 0, needsReview: false, trackedForExport: false };
  const join = { id: 'old-empty-join', kind: 'join', origin: 'merge', files: [{ base: copy(blank), yours: { ...copy(blank), trackedForExport: true } }] };
  const authored = { ...copy(join), id: 'intentional-blank-save', kind: 'edit', origin: 'save' };
  const room = { mode: 'sparse', identity, shared: {}, local: { 'a.txt': copy(join.files[0].yours) }, outbox: [join, authored],
    conflicts: [{ mutationId: join.id }, { mutationId: authored.id }] };
  const workspace = { sourceHash: identity.sourceHash, accountId: identity.accountId, game: identity.game, branchId: 'default',
    placeholderRepairArchive: { 'stable-repair-id': { filepath: 'a.txt', language: 'Thai', sourceHash: identity.sourceHash, status: 'pending',
      staged: { sourceHash: identity.sourceHash, translations: [''], before: [], saveOrigin: 'legacy_inferred' } } } };
  const before = copy(workspace), originals = new Map([['a.txt', { filepath: 'a.txt', translations: { English: ['Original English'] } }]]);
  rooms.restorePlaceholderRepairs(room, workspace, originals);
  assert.deepEqual(room.placeholderRepairs, [{ id: 'stable-repair-id', filepath: 'a.txt', baseRevision: 1 }]);
  assert.deepEqual(room.outbox.map(operation => operation.id), [authored.id]);
  assert.deepEqual(room.conflicts.map(conflict => conflict.mutationId), [authored.id]);
  assert.equal(room.local['a.txt'], undefined);
  assert.deepEqual(workspace, before, 'Reconstructing the room must not alter durable workspace or repair evidence.');
  rooms.restorePlaceholderRepairs(room, workspace, originals);
  assert.equal(room.placeholderRepairs.length, 1, 'Retry reuses the durable repair ID rather than creating another generation.');
});

test('room metadata excludes archive decisions and seed payloads while cold reads recover their exact content', async () => {
  const stores = { rooms: 'rooms', shared: 'shared', operations: 'operations', roomRecords: 'records', baseline: 'baseline', assets: 'assets' };
  const data = Object.fromEntries(Object.values(stores).map(name => [name, new Map()])), reads = [], writes = [];
  const key = (...parts) => JSON.stringify(parts), baseId = key(identity.game, identity.sourceHash);
  const request = value => { const req = {}; queueMicrotask(() => { req.result = copy(value); req.onsuccess(); }); return req; };
  const tx = { objectStore(name) { return {
    get(id) { reads.push(name); return request(data[name].get(id)); },
    index() { return { getAll(path) { reads.push(name); return request([...data[name].values()].filter(row => row.pathKey === path || row.paths?.includes(path))); } }; },
    put(value) { writes.push({ name, value: copy(value) }); data[name].set(value.key, copy(value)); }, delete(id) { data[name].delete(id); },
  }; } };
  const rooms = create({ stores, copy, key, same: (a, b) => JSON.stringify(a) === JSON.stringify(b), baselineKey: () => baseId,
    row: (scope, id, value, extra = {}) => ({ key: key(scope, id), scope, value: copy(value), ...extra }),
    async get(tx, name, id) { reads.push(name); return copy(data[name].get(id)?.value); },
    async all(tx, name, scope) { reads.push(name); return [...data[name].values()].filter(row => row.scope === scope).map(value => copy(value)); },
    async readWorkspace() { return { descs: [], staged: {} }; },
  });
  const archive = { baselineId: identity.sourceHash, decisions: [{ filepath: 'a.txt', choice: 1 }, { filepath: 'b.txt', choice: 0 }] };
  const files = [{ filepath: 'a.txt', english: ['English A'], translations: ['Thai A'] }, { filepath: 'b.txt', english: ['English B'], translations: ['Thai B'] }];
  data.assets.set(baseId, { key: baseId, value: { archive } });
  await rooms.writeRoom(tx, roomKey, { identity, archive, shared: {}, outbox: [], recovery: [],
    seedUpload: { id: 'ticket', expiresAt: 12345, files } });
  const native = data.rooms.get(roomKey).value;
  assert.equal(native.archive.decisions, undefined);
  assert.equal(native.seedUpload.files, undefined);
  assert.equal(native._seedUploadFiles, true);
  const rows = [...data.records.values()].filter(row => row.value.field === 'seedUploadFiles');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.paths.length === 0), 'Seed payloads stay outside hot per-file path queries.');
  const cold = await rooms.readRoom(tx, roomKey);
  assert.deepEqual(cold.room.archive, archive);
  assert.deepEqual(cold.room.seedUpload, { id: 'ticket', expiresAt: 12345, files });
  reads.length = 0; writes.length = 0;
  const hot = await rooms.readRoom(tx, roomKey, ['a.txt'], { includeOutbox: 'paths' });
  assert.equal(hot.room.archive.decisions, undefined);
  assert.equal(hot.room.seedUpload.files, undefined);
  await rooms.writeRoom(tx, roomKey, hot.room, hot.selection.filepaths, hot.selection.operationIds);
  assert.equal(reads.includes('assets'), false);
  assert.equal(writes.length, 0);
  assert.equal([...data.records.values()].filter(row => row.value.field === 'seedUploadFiles').length, 2, 'Hot commands preserve the durable seed retry payload.');
});

test('durable placeholder repair reconstruction retains source, language, account and branch proof guards', async t => {
  const rooms = create({ stores: {}, copy, key: (...parts) => JSON.stringify(parts) });
  const blank = { filepath: 'a.txt', translations: [''], revision: 0, needsReview: false, trackedForExport: false };
  const room = { mode: 'sparse', identity, shared: {}, local: { 'a.txt': blank }, outbox: [{ id: 'join', kind: 'join', origin: 'merge',
    files: [{ base: blank, yours: { ...blank, trackedForExport: true } }] }], conflicts: [] };
  const workspace = { sourceHash: identity.sourceHash, accountId: identity.accountId, game: identity.game, branchId: 'default',
    placeholderRepairArchive: { repair: { filepath: 'a.txt', language: 'Thai', sourceHash: identity.sourceHash, status: 'pending',
      staged: { sourceHash: identity.sourceHash, translations: [''], before: [], saveOrigin: 'legacy_inferred' } } } };
  for (const variant of ['source', 'account', 'branch', 'language', 'original-language-block', 'authored-staged-evidence']) await t.test(variant, () => {
    const current = copy(room), proof = copy(workspace), original = { filepath: 'a.txt', translations: { English: ['Original English'] } };
    if (variant === 'source') proof.sourceHash = 'b'.repeat(64);
    if (variant === 'account') proof.accountId = 'other';
    if (variant === 'branch') proof.branchId = 'other';
    if (variant === 'language') proof.placeholderRepairArchive.repair.language = 'German';
    if (variant === 'original-language-block') original.translations.Thai = [''];
    if (variant === 'authored-staged-evidence') proof.placeholderRepairArchive.repair.staged.saveOrigin = 'save';
    rooms.restorePlaceholderRepairs(current, proof, new Map([['a.txt', original]]));
    assert.deepEqual(current, room);
  });
});

test('granular commands reject changed account, branch, source and language before reading storage', async t => {
  for (const [field, value] of [['accountId', 'other'], ['game', 'poe2'], ['branchId', 'other'], ['sourceHash', 'b'.repeat(64)], ['language', 'German']]) {
    await t.test(field, async () => {
      const { rooms, counts } = unavailableFixture();
      await assert.rejects(rooms.getRecords({ key: roomKey, scope: { ...identity, [field]: value }, filepaths: ['a.txt'] }), { stale: true });
      await assert.rejects(rooms.updateRecords({ key: roomKey, scope: { ...identity, [field]: value }, filepaths: ['a.txt'] }, () => {}), { stale: true });
      assert.deepEqual(counts(), { transactions: 0, legacyReads: 0, ensures: 0 });
    });
  }
});
