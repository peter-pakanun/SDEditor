const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../public/normalizedStore.js');
const R = require('../public/normalizedRooms.js');
const W = require('../public/workspaceState.js');
const P = require('../public/collaborationProtocol.js');
const { Client } = require('../public/collaborationSync.js');
const copy = structuredClone;

// Exercise the actual per-file adapters, including their by_path operation
// selection and persisted read views. No aggregate collaboration mock is used.
function database() {
    const data = new Map([...N.names, 'kv'].map(name => [name, new Map()]));
    const request = value => {
        const result = {};
        queueMicrotask(() => { result.result = copy(value); result.onsuccess(); });
        return result;
    };
    const db = { objectStoreNames: { contains: name => data.has(name) }, transaction(names, mode) {
        const before = mode === 'readwrite' ? new Map(names.map(name => [name, new Map(data.get(name))])) : null;
        const tx = { mode, objectStore(name) {
            assert.ok(names.includes(name), 'Reads and writes remain within their atomic transaction.');
            const rows = data.get(name);
            return {
                get(id) { return request(rows.get(id)); },
                getAll() { return request([...rows.values()]); },
                put(value) { rows.set(value.key, copy(value)); },
                delete(id) { rows.delete(id); },
                index(index) { return { getAll(id) {
                    return request([...rows.values()].filter(row => index === 'by_scope' ? row.scope === id
                        : index === 'by_kind' ? row.kindScope === id : row.pathKey === id || row.paths?.includes(id)));
                } }; },
            };
        }, abort() {
            if (tx.completed || tx.aborted) return;
            tx.aborted = true;
            for (const [name, rows] of before || []) data.set(name, rows);
            tx.onabort?.();
        } };
        setImmediate(() => { if (!tx.aborted) { tx.completed = true; tx.oncomplete?.(); } });
        return tx;
    } };
    return { db, data };
}

test('deleted-path cleanup physically deletes scoped normalized recovery records and preserves previous Saved work and history', async () => {
    const { db, data } = database(), scope = { accountId: 'alice', game: 'poe2', branchId: 'default', sourceHash: 'c'.repeat(64) };
    const normalized = N.create({ W, openDb: async () => db, legacyGet: async () => undefined, normalizeScope: value => value });
    const id = N.scopeKey(scope), baseId = N.baselineKey(scope), kept = 'current.txt', removed = 'removed.txt';
    const put = (store, row) => data.get(store).set(row.key, copy(row));
    put(N.stores.meta, { key: id, scope: id, value: { ...scope, stagedVersion: 1 } });
    put(N.stores.migration, { key: id, scope: id, value: { state: 'ready' } });
    put(N.stores.assets, { key: baseId, scope: baseId, value: { archive: { baselineId: scope.sourceHash, descriptionCount: 1 } } });
    put(N.stores.baseline, normalized.row(baseId, kept, { filepath: kept, translations: { English: ['Current'], Thai: ['Current target'] } }));
    const records = [
        ['dropped', 'Thai', removed, { id: 'deleted', filepath: removed }],
        ['droppedArchive', 'deleted', null, { id: 'deleted', filepath: removed, snapshot: { translations: ['Deleted recovery target'] } }],
        ['droppedConflicts', 'Thai', removed, { yours: { id: 'deleted', filepath: removed, snapshot: { translations: ['Another target'] } } }],
        ['droppedConflictArchive', 'old-conflict', null, { yours: { id: 'deleted', filepath: removed } }],
        ['droppedOutbox', 'queued', null, { id: 'deleted', kind: 'put', candidate: { filepath: removed } }],
        ['droppedAliases', 'alias', null, 'deleted'],
        ['droppedArchive', 'keep', null, { id: 'keep', filepath: kept, snapshot: { translations: ['Current alternative'] } }],
    ];
    for (const [field, entry, filepath, value] of records) {
        const identity = filepath ? [field, entry, filepath] : [field, entry];
        put(N.stores.records, normalized.row(id, identity, { field, entry: filepath || entry, ...(filepath ? { language: entry } : {}), data: value },
            { pathKey: normalized.key(id, filepath || value?.filepath || removed), kindScope: normalized.key(id, field) }));
    }
    const previousScope = { ...scope, sourceHash: 'a'.repeat(64) }, previousId = N.scopeKey(previousScope);
    put(N.stores.records, normalized.row(previousId, ['staged', 'Thai', removed], { field: 'staged', language: 'Thai', entry: removed, data: { translations: ['Previous saved work'] } }, { kindScope: normalized.key(previousId, 'staged') }));
    put(N.stores.receipts, normalized.row(previousId, 'receipt', { originalHash: 'unchanged' }));
    const protectedRows = [...data.get(N.stores.records).values()].filter(row => row.scope !== id), receipts = copy([...data.get(N.stores.receipts)]);
    // An incomplete source cache proves nothing, even when its descriptor exists.
    data.get(N.stores.baseline).clear();
    assert.deepEqual(await normalized.removeDeletedRecoveries(scope), { removed: [] });
    assert.equal(data.get(N.stores.records).size, 8);
    put(N.stores.baseline, normalized.row(baseId, kept, { filepath: kept, translations: { English: ['Current'] } }));
    assert.deepEqual(await normalized.removeDeletedRecoveries(scope), { removed: [removed] });
    const currentRows = [...data.get(N.stores.records).values()].filter(row => row.scope === id);
    assert.equal(currentRows.length, 1); assert.equal(currentRows[0].value.data.id, 'keep');
    assert.deepEqual([...data.get(N.stores.records).values()].filter(row => row.scope !== id), protectedRows);
    assert.deepEqual([...data.get(N.stores.receipts)], receipts);
    assert.deepEqual(await normalized.removeDeletedRecoveries(scope), { removed: [] });
});

async function fixture({ status = 'needs_candidate_review', different = false, wire = false, stagedDifferent = false } = {}) {
    const { db, data } = database();
    const scope = { accountId: 'julia', game: 'poe2', branchId: 'default', language: 'German', sourceHash: 'a'.repeat(64) };
    const original = { filepath: 'specific_skill_stat_descriptions/leech_bearer_active/skill_effect_duration.txt', name: 'skill_effect_duration',
        stats: ['skill_effect_duration'], variables: ['# table_only'], remarks: ['milliseconds_to_seconds_2dp_if_required 1'],
        translations: { English: ['Blood Expulsion Duration@{0}s'], German: ['Dauer des Blut-Ausstoßes@{0}s'] } };
    const makeAdapters = () => {
        const normalized = N.create({ W, openDb: async () => db, legacyGet: async () => undefined,
            normalizeScope: value => ({ ...value, accountId: value.accountId || 'guest', branchId: value.branchId || 'default' }) });
        return { normalized, rooms: R.create(normalized) };
    };
    let { normalized, rooms } = makeAdapters();
    const key = rooms.identityKey(scope), id = N.scopeKey(scope), baselineId = N.baselineKey(scope);
    const put = (name, value) => data.get(name).set(value.key, copy(value));
    put(N.stores.migration, { key: id, value: { state: 'ready' } });
    put(N.stores.migration, { key: normalized.key('room', key), value: { state: 'ready' } });
    put(N.stores.meta, { key: id, scope: id, value: { ...scope, stagedVersion: 1 } });
    put(N.stores.baseline, normalized.row(baselineId, original.filepath, original));
    put(N.stores.files, normalized.row(id, original.filepath, { filepath: original.filepath, overrides: {} },
        { pathKey: normalized.key(id, original.filepath) }));
    const workspace = await normalized.workspace(scope);
    W.initializeWorkspace(workspace, { source: [original], sourceHash: scope.sourceHash, game: scope.game, language: scope.language });
    // This is an existing online generation with a historical temporary ID.
    // Its reviewed mutation and uncertain wire must retain their old guards.
    const local = W.dropTranslation(workspace, original, scope.language, { id: 'legacy-local-copy', ownership: 'online', game: scope.game,
        originSourceHash: 'b'.repeat(64), targetSourceHash: scope.sourceHash, reason: 'Older preserved source' });
    const promotion = { id: local.id, revision: Number(local.revision) || 0, targetSourceHash: scope.sourceHash };
    const saved = ['Confirmed local translation@{0}s'];
    W.stageTranslation(workspace, { filepath: original.filepath, translations: saved }, scope.language,
        { source: original, sourceHash: scope.sourceHash, game: scope.game, promoteDropped: promotion });
    // Older clients could leave a rejected save blocked after its visible copy
    // conflict had already been removed. Preserve that persisted shape.
    assert.equal(workspace.droppedConflicts[scope.language]?.[original.filepath], undefined);
    assert.equal(W.droppedForFile(workspace, original.filepath, scope.language), null);
    if (stagedDifferent) W.stageTranslation(workspace, { filepath: original.filepath, translations: ['A newer local save@{0}s'] }, scope.language,
        { source: original, sourceHash: scope.sourceHash, game: scope.game });
    await normalized.saveWorkspace(scope, workspace);
    const base = P.fileState({ filepath: original.filepath, translations: ['Original accepted translation'], revision: 2 });
    const yours = P.fileState({ filepath: original.filepath, translations: saved, revision: 2, trackedForExport: true });
    const operation = { id: 'legacy-reviewed-save', kind: 'edit', origin: 'save', status,
        files: [{ base: copy(base), yours }], promoteDropped: copy(promotion) };
    if (wire) {
        operation.wire = { mutationId: operation.id, files: [{ ...copy(yours), baseRevision: base.revision }], promoteDropped: copy(promotion) };
        operation.upload = { id: 'prepared-upload', uncertain: true };
    }
    const sharedFile = P.fileState({ ...base, revision: 4 });
    await normalized.transaction(rooms.stores, 'readwrite', tx => rooms.writeRoom(tx, key, { identity: scope, mode: 'sparse',
        roomId: 'room', sequence: 1, shared: { [original.filepath]: sharedFile }, outbox: [operation], conflicts: [], recovery: [] }));
    const canonical = { ...copy(local), id: 'canonical-shared-copy', revision: 7, status: 'dropped', originSourceHash: 'c'.repeat(64) };
    canonical.snapshot.remarks = ['Different archived metadata'];
    if (different) canonical.snapshot.translations = ['A genuinely different preserved translation'];
    const clients = [];
    const load = async () => {
        ({ normalized, rooms } = makeAdapters());
        const records = await rooms.getRecords({ key, scope, includeOutbox: true, includeDropped: true });
        const store = { getCollaborationRecords: command => rooms.getRecords(command),
            updateCollaborationRecords: (command, update, options) => rooms.updateRecords(command, update, options),
            mergeWorkspaceRecords: normalized.mergeWorkspaceRecords };
        const client = new Client({ store, request: async () => { throw new Error('This fixture never sends API requests.'); }, WebSocket: null });
        client.key = key; client.state = { version: 1, rooms: { [key]: copy(records.room) } };
        client.droppedWorkspace = copy(records.workspace);
        client.droppedConflicts = copy(records.workspace.droppedConflicts?.[scope.language] || {});
        clients.push(client);
        return { client, records };
    };
    return { load, canonical, operation, original, local, saved, scope, close: () => clients.forEach(client => client.destroy()) };
}

test('normalized reload recovers an orphaned reviewed save when canonical dropped text is identical', async t => {
    const f = await fixture(); t.after(f.close);
    const { client } = await f.load();
    assert.deepEqual(client.snapshot().droppedReviewPaths, [f.original.filepath]);
    await client.coalesceDroppedCopies([f.canonical], client.epoch);
    const reloaded = await f.load(), operation = reloaded.records.room.outbox[0];
    assert.equal(operation.status, 'pending');
    assert.deepEqual(operation.promoteDropped, { id: f.canonical.id, revision: f.canonical.revision, targetSourceHash: f.scope.sourceHash });
    assert.deepEqual(operation.files[0].base, f.operation.files[0].base, 'The original accepted-file revision guard remains authoritative.');
    assert.deepEqual(operation.files[0].yours.translations, f.saved);
    assert.deepEqual(reloaded.records.workspace.staged.German[f.original.filepath].translations, f.saved);
    assert.deepEqual(reloaded.records.workspace.droppedArchive[f.operation.promoteDropped.id].snapshot, f.local.snapshot,
        'Only archived metadata differs; the exact local recovery metadata remains preserved.');
    assert.deepEqual(reloaded.client.snapshot().droppedReviewPaths, []);
    assert.equal(reloaded.records.workspace.droppedConflicts.German?.[f.original.filepath], undefined);
    assert.deepEqual(reloaded.records.workspace.descs[0].remarks, f.original.remarks, 'Active metadata continues to use the immutable baseline.');
});

test('normalized orphan recovery leaves different preserved text blocked and the saved result intact', async t => {
    const f = await fixture({ different: true }); t.after(f.close);
    const { client } = await f.load();
    await client.coalesceDroppedCopies([f.canonical], client.epoch);
    const reloaded = await f.load(), operation = reloaded.records.room.outbox[0];
    assert.equal(operation.status, 'needs_candidate_review');
    assert.deepEqual(operation.promoteDropped, f.operation.promoteDropped);
    assert.deepEqual(operation.files[0].base, f.operation.files[0].base);
    assert.deepEqual(reloaded.records.workspace.staged.German[f.original.filepath].translations, f.saved);
    assert.deepEqual(reloaded.client.snapshot().droppedReviewPaths, [f.original.filepath]);
});

test('normalized orphan recovery preserves an uncertain prepared request before replay', async t => {
    const f = await fixture({ wire: true }); t.after(f.close);
    const { client } = await f.load();
    await client.coalesceDroppedCopies([f.canonical], client.epoch);
    const reloaded = await f.load(), operation = reloaded.records.room.outbox[0];
    assert.equal(operation.status, 'pending');
    assert.deepEqual(operation.wire, f.operation.wire, 'An uncertain mutation replays the exact originally prepared request.');
    assert.deepEqual(operation.upload, f.operation.upload);
    assert.deepEqual(operation.files[0].base, f.operation.files[0].base);
    assert.deepEqual(operation.promoteDropped, f.operation.promoteDropped, 'The candidate guard inside the uncertain request cannot be silently rewritten.');
    assert.deepEqual(reloaded.records.workspace.staged.German[f.original.filepath].translations, f.saved);
    assert.deepEqual(reloaded.client.snapshot().droppedReviewPaths, []);
});

test('normalized orphan recovery cannot replay an obsolete save over newer staged work', async t => {
    const f = await fixture({ stagedDifferent: true }); t.after(f.close);
    const { client } = await f.load();
    await client.coalesceDroppedCopies([f.canonical], client.epoch);
    const reloaded = await f.load(), operation = reloaded.records.room.outbox[0];
    assert.equal(operation.status, 'needs_candidate_review');
    assert.deepEqual(operation.promoteDropped, f.operation.promoteDropped);
    assert.deepEqual(operation.files[0].base, f.operation.files[0].base);
    assert.deepEqual(reloaded.records.workspace.staged.German[f.original.filepath].translations, ['A newer local save@{0}s']);
    assert.deepEqual(reloaded.client.snapshot().droppedReviewPaths, [f.original.filepath]);
});
