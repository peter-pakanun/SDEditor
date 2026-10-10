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

function sparseSelectionFixture({ workspace } = {}) {
  const stores = { rooms: 'rooms', shared: 'shared', operations: 'operations', roomRecords: 'records',
    meta: 'workspaces', files: 'files', records: 'workspaceRecords', baseline: 'baseline', assets: 'assets', migration: 'migration' };
  const data = Object.fromEntries(Object.values(stores).map(name => [name, new Map()])), reads = [], transactions = [], selections = [], projections = [];
  const key = (...parts) => JSON.stringify(parts), baseId = key(identity.game, identity.sourceHash);
  const request = value => { const req = {}; queueMicrotask(() => { req.result = copy(value); req.onsuccess(); }); return req; };
  const matches = (value, query) => query && typeof query === 'object'
    ? value >= query.lower && value <= query.upper : value === query;
  const rows = (name, index, query) => [...data[name].values()].flatMap(row => {
    const keys = index === 'by_scope' ? [row.scope] : index === 'by_path' ? row.paths || [row.pathKey] : [row.key];
    return keys.filter(value => matches(value, query)).map(() => row);
  });
  const tx = { objectStore(name) { return {
    get(id) { reads.push({ name, id }); return request(data[name].get(id)); },
    getAll(id) { const value = rows(name, null, id); reads.push({ name, id, bulk: true, returned: value.map(row => row.key) }); return request(value); },
    count(id) { reads.push({ name, id, count: true }); return request(rows(name, null, id).length); },
    index(index) { return {
      getAll(id) { const value = rows(name, index, id); reads.push({ name, index, id, returned: value.map(row => row.key) }); return request(value); },
      count(id) { reads.push({ name, index, id, count: true }); return request(rows(name, index, id).length); },
    }; },
    put(value) { data[name].set(value.key, copy(value)); }, delete(id) { data[name].delete(id); },
  }; } };
  const n = { stores, copy, key, same: (a, b) => JSON.stringify(a) === JSON.stringify(b), baselineKey: () => baseId,
    row: (scope, id, value, extra = {}) => ({ key: key(scope, id), scope, value: copy(value), ...extra }),
    async get(tx, name, id) { reads.push({ name, id }); return copy(data[name].get(id)?.value); },
    async all(tx, name, scope) { reads.push({ name, all: true }); return [...data[name].values()].filter(row => row.scope === scope).map(value => copy(value)); },
    async readWorkspace(tx, scope, paths) { selections.push(copy(paths)); return workspace ? copy(workspace) : { descs: [], staged: {} }; },
    async writeWorkspace(tx, scope, workspace, paths) { projections.push({ scope: copy(scope), workspace: copy(workspace), paths: copy(paths) }); },
    async ensure() {},
    async transaction(names, mode, action) { transactions.push({ names, mode }); return action(tx); },
    dependencies: { normalizeScope: scope => scope, IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) } },
  };
  const put = (name, value) => data[name].set(value.key, copy(value));
  put(stores.migration, { key: key('room', roomKey), value: { state: 'ready' } });
  put(stores.rooms, { key: roomKey, value: { identity, mode: 'sparse', manifest: { version: 2 }, sequence: 4 } });
  return { n, rooms: create(n), stores, data, reads, transactions, selections, projections, put, tx };
}

test('reconnecting a repaired file replays valid staged or shared work while retaining excess immutable ZIP translations', async t => {
  for (const current of ['staged', 'shared']) await t.test(current, async () => {
    const original = { filepath: 'a.txt', translations: { English: ['Current English'], Thai: ['Old retained entry', 'Old removed entry'] } };
    const yours = { filepath: original.filepath, translations: ['Aligned translation'], revision: 0, trackedForExport: true };
    const workspace = { descs: [{ ...copy(original), translations: { English: ['Current English'], Thai: copy(yours.translations) } }],
      staged: current === 'staged' ? { Thai: { [original.filepath]: { sourceHash: identity.sourceHash, translations: copy(yours.translations) } } } : {} };
    const f = sparseSelectionFixture({ workspace }), baselineId = f.n.baselineKey();
    f.put(f.stores.baseline, f.n.row(baselineId, original.filepath, original));
    const preserved = copy(f.data.baseline.get(f.n.key(baselineId, original.filepath)));
    const operation = { id: 'alignment-save', kind: 'edit', origin: 'save', status: 'pending',
      files: [{ base: { ...copy(yours), translations: ['Old retained entry'], trackedForExport: false }, yours: copy(yours) }] };
    await f.rooms.writeRoom(f.tx, roomKey, { identity, mode: 'sparse', manifest: { version: 2, files: [{ filepath: original.filepath, entryCount: 1 }] },
      shared: current === 'shared' ? { [original.filepath]: copy(yours) } : {}, outbox: [operation] });
    const command = { key: roomKey, scope: identity, filepaths: [original.filepath], includeAffected: true, includeOutbox: true };
    const read = await f.rooms.getRecords(command);
    assert.deepEqual(read.room.local[original.filepath].translations, yours.translations);
    assert.deepEqual(read.room.outbox[0].files[0].yours.translations, yours.translations);
    await f.rooms.writeRoom(f.tx, roomKey, read.room, read.selection.filepaths, read.selection.operationIds);
    const reopened = await f.rooms.getRecords(command);
    assert.deepEqual(reopened.room.local[original.filepath].translations, yours.translations);
    assert.deepEqual(f.data.baseline.get(f.n.key(baselineId, original.filepath)), preserved,
      'Outbox replay must never truncate or rewrite immutable original blocks.');
  });
});

test('room replay still rejects excess immutable blocks when they are the required committed fallback', async () => {
  const f = sparseSelectionFixture(), original = { filepath: 'a.txt', translations: { English: ['Current English'], Thai: ['Old retained entry', 'Old removed entry'] } };
  const baselineId = f.n.baselineKey();
  f.put(f.stores.baseline, f.n.row(baselineId, original.filepath, original));
  const yours = { filepath: original.filepath, translations: ['Aligned translation'], revision: 0, trackedForExport: true };
  await f.rooms.writeRoom(f.tx, roomKey, { identity, mode: 'sparse', manifest: { version: 2, files: [{ filepath: original.filepath, entryCount: 1 }] },
    shared: {}, outbox: [{ id: 'alignment-save', files: [{ yours }] }] });
  const before = copy(f.data.baseline.get(f.n.key(baselineId, original.filepath)));
  await assert.rejects(f.rooms.getRecords({ key: roomKey, scope: identity, filepaths: [original.filepath], includeOutbox: true }),
    /Translation count exceeds source entry count: a\.txt/);
  assert.deepEqual(f.data.baseline.get(f.n.key(baselineId, original.filepath)), before);
});

test('cold sparse reconnect selects actual work and recovery paths instead of every original manifest path', async () => {
  const f = sparseSelectionFixture();
  const manifest = Array.from({ length: 1200 }, (_, index) => ({ filepath: 'file-' + index + '.txt', entryCount: 1 }));
  const shared = { filepath: manifest[8].filepath, translations: ['Accepted'], revision: 4 };
  const yours = { filepath: manifest[17].filepath, translations: ['Pending'], revision: 0 };
  await f.rooms.writeRoom(f.tx, roomKey, { identity, mode: 'sparse', manifest: { version: 2, files: manifest },
    shared: { [shared.filepath]: shared }, outbox: [{ id: 'pending', files: [{ yours }] }],
    conflicts: [{ id: 'conflict', filepath: manifest[25].filepath }],
    carries: { [manifest[31].filepath]: { filepath: manifest[31].filepath, translations: ['Carry'] } },
    placeholderRepairs: [{ id: 'repair', filepath: manifest[43].filepath }],
    recovery: [{ id: 'recovery', files: [{ filepath: manifest[51].filepath, translations: ['Recovered'] }] }, { id: 'empty-recovery', files: [] }] });
  f.reads.length = 0;
  const staged = manifest[67].filepath;
  const result = await f.rooms.getRecords({ key: roomKey, scope: identity, filepaths: [staged], includeAffected: true, includeDropped: true });
  const expected = [staged, shared.filepath, yours.filepath, manifest[25].filepath, manifest[31].filepath, manifest[43].filepath, manifest[51].filepath];
  assert.deepEqual(new Set(result.selection.filepaths), new Set(expected));
  assert.equal(result.room.manifest.files.length, expected.length);
  assert.equal(result.room.recovery.length, 2, 'Empty durable recovery headers remain available');
  assert.deepEqual(result.room.outbox.map(item => item.id), ['pending']);
  assert.deepEqual(f.selections, [result.selection.filepaths]);
  assert.equal(f.reads.filter(read => read.name === f.stores.baseline).length, expected.length,
    'Untouched originals must never be hydrated during sparse reconnect');
  await f.rooms.writeRoom(f.tx, roomKey, result.room, result.selection.filepaths, result.selection.operationIds);
  assert.equal(f.data.shared.size, manifest.length, 'A scoped reconnect preserves every unselected immutable manifest row');
});

test('large room selections batch IndexedDB requests while preserving operation closure, recovery order and atomic projection', async () => {
  const f = sparseSelectionFixture(), path = index => `files/${String(index).padStart(4, '0')}.txt`;
  const manifest = Array.from({ length: 1200 }, (_, index) => ({ filepath: path(index), entryCount: 1 }));
  const file = index => ({ filepath: path(index), translations: ['Saved ' + index], revision: 1, trackedForExport: true });
  const selected = manifest.slice(0, 256).map(file => file.filepath), shared = Object.fromEntries(selected.map((path, index) => [path, file(index)]));
  const operations = [
    { id: 'first', files: [{ base: file(254), yours: file(254) }, { base: file(255), yours: { ...file(255), translations: ['Pending selected'] } },
      { base: file(900), yours: file(900) }] },
    { id: 'chained', files: [{ base: file(900), yours: file(900) }, { base: file(901), yours: file(901) }] },
    { id: 'unrelated', files: [{ base: file(1100), yours: file(1100) }] },
  ];
  const recovered = manifest.slice(0, 300).map((row, index) => ({ filepath: row.filepath, translations: ['Recovered ' + index] }));
  await f.rooms.writeRoom(f.tx, roomKey, { identity, mode: 'sparse', manifest: { version: 2, files: manifest }, shared, outbox: operations,
    carries: { [path(8)]: { filepath: path(8), translations: ['Carry'] } }, carryRevisions: { [path(8)]: 7 },
    conflicts: [{ id: 'selected-conflict', filepath: path(9), mutationId: 'first' }, { id: 'unrelated-conflict', filepath: path(1100) }],
    placeholderRepairs: [{ id: 'repair', filepath: path(10) }],
    recovery: [{ id: 'recovered', at: 1, reason: 'Disconnected work', files: recovered }, { id: 'empty', at: 2, files: [] }],
    seedUpload: { id: 'seed-ticket', files: [{ filepath: path(1100), translations: ['Large private retry payload ' + 'x'.repeat(200000)] }] } });
  const unrelatedOperation = copy(f.data.operations.get(f.n.key(roomKey, 'unrelated')));
  const untouchedRecovery = copy(f.data.records.get(f.n.key(roomKey, ['recoveryFiles', ['recovered', 299]])));
  const seedRow = [...f.data.records.values()].find(row => row.value.field === 'seedUploadFiles'), seedBefore = copy(seedRow);
  const foreignKey = f.n.key('other', identity.game, identity.sourceHash, identity.language);
  f.put(f.stores.shared, f.n.row(foreignKey, path(5), { filepath: path(5), shared: { ...file(5), translations: ['Foreign scope'] } },
    { pathKey: f.n.key(foreignKey, path(5)) }));
  f.reads.length = 0;
  const read = await f.rooms.getRecords({ key: roomKey, scope: identity, filepaths: selected });
  const expected = new Set([...selected, path(900), path(901)]);
  assert.deepEqual(new Set(read.selection.filepaths), expected);
  assert.deepEqual(new Set(read.selection.operationIds), new Set(['first', 'chained']));
  assert.deepEqual(read.room.outbox.map(operation => operation.id), ['first', 'chained']);
  assert.equal(read.room.local[path(255)].translations[0], 'Pending selected');
  assert.equal(read.room.shared[path(5)].translations[0], 'Saved 5');
  assert.equal(read.room.carries[path(8)].translations[0], 'Carry'); assert.equal(read.room.carryRevisions[path(8)], 7);
  assert.deepEqual(read.room.conflicts.map(conflict => conflict.id), ['selected-conflict']);
  assert.deepEqual(read.room.placeholderRepairs.map(repair => repair.id), ['repair']);
  assert.equal(read.room.recovery.length, 1); assert.deepEqual(read.room.recovery[0].files, recovered.slice(0, 256));
  assert.equal(read.room.recovery[0]._storageRecovery.fileCount, 300);
  const roomReads = f.reads.filter(read => [f.stores.rooms, f.stores.shared, f.stores.operations, f.stores.roomRecords].includes(read.name));
  assert.ok(roomReads.length < 40, 'Hundreds of affected paths must not issue one IndexedDB event for each path and store.');
  assert.ok(roomReads.some(read => read.id && typeof read.id === 'object'), 'The selection uses bounded range reads.');
  assert.ok(roomReads.some(read => read.name === f.stores.operations && read.returned && new Set(read.returned).size < read.returned.length),
    'Duplicate rows from a multi-entry path index must still produce one authored operation.');
  assert.ok(!roomReads.some(read => read.all), 'Partial commands never materialize every room record.');
  assert.ok(!roomReads.some(read => read.returned?.includes(seedRow.key)), 'Pathless seed text stays outside bulk path reads.');
  assert.deepEqual(new Set(f.reads.filter(read => read.name === f.stores.baseline).map(read => JSON.parse(read.id)[1])), expected);
  assert.equal(f.reads.filter(read => read.name === f.stores.baseline).length, expected.size, 'Only exact selected originals are hydrated.');
  const updated = await f.rooms.updateRecords({ key: roomKey, scope: identity, filepaths: selected }, (state, room) => {
    room.shared[path(0)].translations = ['New accepted text']; room.recovery[0].files.shift(); return state;
  }, { projectWorkspace(workspace, state) {
    assert.equal(state.rooms[roomKey].outbox.length, 2); return { ...workspace, projected: 'selected room' };
  } });
  assert.deepEqual(new Set(updated.selection.filepaths), expected);
  assert.equal(f.transactions.at(-1).mode, 'readwrite'); assert.equal(f.projections.length, 1);
  assert.deepEqual(new Set(f.projections[0].paths), expected); assert.equal(f.projections[0].workspace.projected, 'selected room');
  assert.equal(f.data.shared.get(f.n.key(roomKey, path(0))).value.shared.translations[0], 'New accepted text');
  assert.deepEqual(f.data.operations.get(unrelatedOperation.key), unrelatedOperation);
  assert.deepEqual(f.data.records.get(untouchedRecovery.key), untouchedRecovery); assert.deepEqual(f.data.records.get(seedRow.key), seedBefore);
  assert.equal(f.data.records.has(f.n.key(roomKey, ['recoveryFiles', ['recovered', 0]])), false);
  assert.equal(f.data.records.get(f.n.key(roomKey, ['recovery', 'recovered'])).value.fileCount, 299);
  assert.equal(f.data.records.get(f.n.key(roomKey, ['recoveryFiles', ['recovered', 1]])).value.data.translations[0], 'Recovered 1');
  f.reads.length = 0;
  const explicit = await f.rooms.readRoom(f.tx, roomKey, selected, { includeOutbox: false, operationIds: ['unrelated'], includeConflicts: false });
  assert.deepEqual(new Set(explicit.selection.filepaths), new Set([...selected, path(1100)]));
  assert.deepEqual(explicit.room.outbox.map(operation => operation.id), ['unrelated']); assert.deepEqual(explicit.room.conflicts, []);
});

test('large sparse ranges fall back to exact paths instead of pulling unrelated archived recovery text', async () => {
  const f = sparseSelectionFixture(), path = index => `files/${String(index).padStart(4, '0')}.txt`;
  const manifest = Array.from({ length: 2048 }, (_, index) => ({ filepath: path(index), entryCount: 1 }));
  await f.rooms.writeRoom(f.tx, roomKey, { identity, mode: 'sparse', manifest: { version: 2, files: manifest }, shared: {}, outbox: [],
    recovery: [{ id: 'large-recovery', files: manifest.map((row, index) => ({ filepath: row.filepath, translations: ['Archived ' + index] })) }] });
  const selected = Array.from({ length: 128 }, (_, index) => path(index * 16)), wanted = new Set(selected);
  const skipped = f.n.key(roomKey, ['recoveryFiles', ['large-recovery', 1001]]);
  f.reads.length = 0;
  const read = await f.rooms.readRoom(f.tx, roomKey, selected);
  assert.deepEqual(new Set(read.selection.filepaths), wanted);
  assert.equal(read.room.recovery[0].files.length, selected.length);
  assert.ok(read.room.recovery[0].files.every(file => wanted.has(file.filepath)));
  assert.ok(f.reads.some(read => read.name === f.stores.roomRecords && read.count), 'The range count avoids serializing an oversized sparse range.');
  assert.ok(f.reads.some(read => read.name === f.stores.roomRecords && read.index === 'by_path' && typeof read.id === 'string'));
  assert.ok(!f.reads.some(read => read.returned?.includes(skipped)), 'Unselected recovery members are never read into JavaScript.');
  assert.equal(f.reads.filter(read => read.name === f.stores.baseline).length, selected.length);
});

test('single-file room commands retain point reads while a dense bulk selection reduces success-event count', async () => {
  const f = sparseSelectionFixture(), manifest = Array.from({ length: 128 }, (_, index) => ({ filepath: `file-${String(index).padStart(3, '0')}.txt` }));
  const shared = Object.fromEntries(manifest.map(row => [row.filepath, { filepath: row.filepath, translations: ['Accepted'], revision: 1 }]));
  await f.rooms.writeRoom(f.tx, roomKey, { identity, mode: 'sparse', manifest: { version: 2, files: manifest }, shared, outbox: [] });
  f.reads.length = 0;
  const hot = await f.rooms.readRoom(f.tx, roomKey, [manifest[0].filepath]);
  assert.deepEqual(hot.selection.filepaths, [manifest[0].filepath]);
  assert.equal(f.reads.some(read => read.count || read.all || typeof read.id === 'object'), false);
  assert.equal(f.reads.filter(read => read.name === f.stores.baseline).length, 1);
  f.reads.length = 0;
  const smaller = await f.rooms.readRoom(f.tx, roomKey, manifest.slice(0, 127).map(row => row.filepath));
  const smallRoomRequests = f.reads.filter(read => read.name !== f.stores.baseline).length;
  f.reads.length = 0;
  const bulk = await f.rooms.readRoom(f.tx, roomKey, manifest.map(row => row.filepath));
  const bulkRoomRequests = f.reads.filter(read => read.name !== f.stores.baseline).length;
  for (const row of manifest.slice(0, 127)) assert.deepEqual(bulk.room.local[row.filepath], smaller.room.local[row.filepath]);
  assert.ok(bulkRoomRequests * 20 < smallRoomRequests, 'Batching reduces deterministic IndexedDB request counts independent of machine speed.');
  assert.equal(f.reads.filter(read => read.name === f.stores.baseline).length, 128);
});

test('bulk explicit operation IDs and recovery headers keep exact selections and unrelated durable groups', async () => {
  const f = sparseSelectionFixture(), path = index => `file-${String(index).padStart(3, '0')}.txt`;
  const manifest = Array.from({ length: 256 }, (_, index) => ({ filepath: path(index) }));
  const operations = manifest.map((file, index) => ({ id: 'operation-' + String(index).padStart(3, '0'),
    files: [{ yours: { filepath: file.filepath, translations: ['Pending ' + index], revision: 0 } }] }));
  const recovery = manifest.map((file, index) => ({ id: 'group-' + String(index).padStart(3, '0'), at: index + 1,
    files: [{ filepath: file.filepath, translations: ['Recovered ' + index] }] }));
  await f.rooms.writeRoom(f.tx, roomKey, { identity, mode: 'sparse', manifest: { version: 2, files: manifest }, shared: {}, outbox: operations, recovery });
  const selectedIds = operations.filter((_, index) => index % 2 === 0).map(operation => operation.id);
  const selectedPaths = manifest.filter((_, index) => index % 2 === 0).map(file => file.filepath);
  f.reads.length = 0;
  const read = await f.rooms.readRoom(f.tx, roomKey, [], { includeOutbox: false, operationIds: selectedIds });
  assert.deepEqual(new Set(read.selection.operationIds), new Set(selectedIds)); assert.deepEqual(new Set(read.selection.filepaths), new Set(selectedPaths));
  assert.deepEqual(read.room.outbox.map(operation => operation.id), selectedIds);
  assert.deepEqual(read.room.recovery.map(group => group.id), recovery.filter((_, index) => index % 2 === 0).map(group => group.id));
  assert.equal(read.room.recovery[127].files[0].translations[0], 'Recovered 254');
  const roomReads = f.reads.filter(read => read.name !== f.stores.baseline);
  assert.ok(roomReads.length < 20, 'Bulk operation IDs and recovery headers must not restore per-record success-event fan-out.');
  assert.ok(roomReads.some(read => read.name === f.stores.operations && read.bulk));
  assert.ok(roomReads.some(read => read.name === f.stores.roomRecords && read.bulk));
  assert.equal(f.reads.filter(read => read.name === f.stores.baseline).length, selectedPaths.length);
  const untouched = copy(f.data.records.get(f.n.key(roomKey, ['recovery', 'group-001'])));
  await f.rooms.writeRoom(f.tx, roomKey, read.room, read.selection.filepaths, read.selection.operationIds);
  assert.deepEqual(f.data.records.get(untouched.key), untouched);
  assert.equal(f.data.operations.size, operations.length); assert.equal(f.data.records.size, 512);
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
