const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../public/normalizedStore.js');

test('accepted baseline equality follows immutable multilingual witnesses rather than parser or editor state', () => {
    const P = require('../public/collaborationProtocol.js');
    const original = { filepath: 'specific_skill_stat_descriptions/explosive_grenade.txt', name: null,
        filename: 'explosive_grenade.txt', filedir: 'specific_skill_stat_descriptions', stats: ['test_stat'], variables: ['#'], remarks: [''],
        translations: { English: ['English value'], Thai: ['Thai value'], German: [''] }, isMissing: false, isDNT: false };
    const equivalent = { ...structuredClone(original), name: '', isMissing: true, isDNT: true, hasChanges: true,
        needsReview: true, languageStatus: { German: { hasChanges: true } }, statusLanguage: 'German',
        duplicateLangEntries: [], tempTranslations: {} };
    assert.deepEqual(N.baselineFile(original), P.witness(original));
    assert.equal(N.sameBaselineFile(original, equivalent), true);
    assert.deepEqual(original.translations.German, [''], 'Comparisons never mutate immutable translations');
    for (const field of ['filepath', 'name', 'stats', 'variables', 'remarks']) {
        const changed = structuredClone(equivalent);
        changed[field] = Array.isArray(changed[field]) ? ['changed'] : 'changed';
        assert.equal(N.sameBaselineFile(original, changed), false, field + ' belongs to accepted file identity');
    }
    for (const language of Object.keys(original.translations)) {
        const changed = structuredClone(equivalent);
        changed.translations[language] = ['changed'];
        assert.equal(N.sameBaselineFile(original, changed), false, language + ' original text is protected');
    }
    const missingLanguage = structuredClone(equivalent);
    delete missingLanguage.translations.German;
    assert.equal(N.sameBaselineFile(original, missingLanguage), false, 'Language presence is immutable even for blank original text');
    const second = { ...structuredClone(original), filepath: 'second.txt' };
    assert.equal(N.sameBaselineSource([original, second], [second, equivalent]), true, 'Enumeration order does not change source identity');
    assert.equal(N.sameBaselineSource([original, second], [equivalent]), false, 'The complete accepted file set is protected');
    assert.equal(N.sameBaselineSource([original, second], [equivalent, equivalent]), false, 'Duplicate paths cannot replace an accepted file');
});

test('version availability reads normalized readiness and never resurrects removed work from frozen evidence', async () => {
    const scope = { accountId: 'owner', game: 'poe2', branchId: 'default', sourceHash: 'source' };
    let marker, meta;
    const n = N.create({ async openDb() { return { transaction(names, mode) {
        assert.equal(mode, 'readonly');
        const tx = { objectStore(name) { return { get(id) {
            assert.equal(id, N.scopeKey(scope));
            const req = {};
            queueMicrotask(() => { req.result = { value: name === N.stores.meta ? meta : marker }; req.onsuccess(); });
            return req;
        } }; } };
        setImmediate(() => tx.oncomplete());
        return tx;
    } }; } });
    assert.equal(await n.scopeAvailable(scope, true), true, 'Unconverted work remains selectable for migration');
    marker = { state: 'ready', removed: true };
    assert.equal(await n.scopeAvailable(scope, true), false, 'Frozen source existence cannot override authoritative absence');
    meta = { ...scope };
    marker = { state: 'ready' };
    assert.equal(await n.scopeAvailable(scope, false), true, 'Normalized-only imports remain available');
});

test('migration activity reports outcomes without allowing a presentation failure to change storage results', async () => {
    const events = [], scope = { accountId: 'owner', game: 'poe1', sourceHash: 'source', branchId: 'default' };
    const n = N.create({ onMigration(event) { events.push(event); throw new Error('Broken UI listener'); } });
    assert.equal(await n.trackMigration('workspace', N.scopeKey(scope), scope, async () => 'committed'), 'committed');
    const failure = new Error('Quota failure');
    await assert.rejects(n.trackMigration('workspace', N.scopeKey(scope), scope, async () => { throw failure; }), error => error === failure);
    assert.deepEqual(events.map(event => event.state), ['started', 'completed', 'started', 'failed']);
    assert.equal(events[0].id, events[1].id);
    assert.equal(events[2].id, events[3].id);
    assert.notEqual(events[0].id, events[2].id, 'Retries have distinct presentation tokens');
    assert.deepEqual(events[1].scope, scope);
    assert.notEqual(events[1].scope, scope);
    assert.ok(events[1].durationMs >= 0);
});

function schema() {
    const stores = new Map(['kv', 'revisions', 'revisions_poe1', 'revisions_poe2'].map(name => [name, { name, indices: new Map() }]));
    const created = [], indexes = [];
    const view = store => ({
        indexNames: { contains: name => store.indices.has(name) },
        createIndex(name, keyPath, options = {}) {
            assert.equal(store.indices.has(name), false, 'Existing indexes cannot be recreated');
            store.indices.set(name, { keyPath, ...options }); indexes.push({ store: store.name, name, keyPath, ...options });
        },
    });
    const db = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore(name, options) {
            assert.equal(stores.has(name), false, 'Legacy stores cannot be recreated');
            const store = { name, options, indices: new Map() }; stores.set(name, store); created.push(name); return view(store);
        },
        deleteObjectStore() { throw new Error('Storage upgrade must preserve recovery stores'); },
    };
    return { db, tx: { objectStore: name => view(stores.get(name)) }, stores, created, indexes };
}

test('v10 separates translation and TM records from KV aggregates and adds scoped indexes without deleting legacy stores', () => {
    const fixture = schema(); N.upgrade(fixture.db, fixture.tx);
    const expected = ['translation_workspaces', 'baseline_files', 'baseline_assets', 'workspace_files', 'workspace_records',
        'translation_drafts', 'collaboration_rooms', 'collaboration_files', 'collaboration_operations', 'collaboration_records',
        'save_submissions', 'save_receipts', 'storage_migrations', 'tm_units', 'tm_outbox', 'tm_meta', 'tm_records'];
    assert.deepEqual(fixture.created.sort(), expected.sort());
    for (const name of expected) {
        assert.deepEqual(fixture.stores.get(name).options, { keyPath: 'key' });
        assert.deepEqual(fixture.stores.get(name).indices.get('by_scope'), { keyPath: 'scope' });
    }
    for (const name of ['kv', 'revisions', 'revisions_poe1', 'revisions_poe2']) assert.ok(fixture.stores.has(name));
    assert.deepEqual(fixture.stores.get('collaboration_operations').indices.get('by_path'), { keyPath: 'paths', multiEntry: true });
    assert.deepEqual(fixture.stores.get('save_submissions').indices.get('by_path'), { keyPath: 'paths', multiEntry: true });
    assert.deepEqual(fixture.stores.get('translation_drafts').indices.get('by_profile_lang'), { keyPath: 'profileLanguage' });
    assert.deepEqual(fixture.stores.get('translation_drafts').indices.get('by_scope_language'), { keyPath: 'scopeLanguage' });
    for (const name of ['workspace_files', 'workspace_records', 'collaboration_files']) {
        assert.deepEqual(fixture.stores.get(name).indices.get('by_path'), { keyPath: 'pathKey' });
    }
    assert.deepEqual(fixture.stores.get('collaboration_records').indices.get('by_path'), { keyPath: 'paths', multiEntry: true });
    for (const name of ['workspace_records', 'collaboration_records', 'tm_outbox', 'tm_records']) {
        assert.deepEqual(fixture.stores.get(name).indices.get('by_kind'), { keyPath: 'kindScope' });
    }
    assert.deepEqual(fixture.stores.get('tm_units').indices.get('by_identity'), { keyPath: 'identityScope', unique: true });
});

test('schema initialization is idempotent for workers and pages sharing the v10 database', () => {
    const fixture = schema(); N.upgrade(fixture.db, fixture.tx);
    const created = fixture.created.length, indexes = fixture.indexes.length;
    N.upgrade(fixture.db, fixture.tx);
    assert.equal(fixture.created.length, created); assert.equal(fixture.indexes.length, indexes);
});

test('workspace record identities isolate account, game, branch and source while baseline records remain reusable', () => {
    const scope = { accountId: 'translator', game: 'poe1', branchId: 'default', sourceHash: 'accepted' };
    const changed = [{ accountId: 'translator-two' }, { game: 'poe2' }, { branchId: 'release' }, { sourceHash: 'next' }];
    const identities = [scope, ...changed.map(change => ({ ...scope, ...change }))].map(N.scopeKey);
    assert.equal(new Set(identities).size, identities.length);
    assert.equal(N.scopeKey({ ...scope, branchId: undefined }), N.scopeKey(scope));
    assert.equal(N.baselineKey({ ...scope, accountId: 'another', branchId: 'release' }), N.baselineKey(scope));
    assert.notEqual(N.baselineKey({ ...scope, game: 'poe2' }), N.baselineKey(scope));
    assert.notEqual(N.baselineKey({ ...scope, sourceHash: 'next' }), N.baselineKey(scope));
});

test('encoded scopes cannot collide when identifiers include punctuation', () => {
    const scope = { accountId: 'a","poe1', game: 'poe1', branchId: 'default', sourceHash: '[accepted]' };
    const other = { ...scope, accountId: 'a', sourceHash: 'poe1","[accepted]' };
    assert.notEqual(N.scopeKey(scope), N.scopeKey(other));
    assert.deepEqual(JSON.parse(N.scopeKey(scope)), [scope.accountId, scope.game, scope.branchId, scope.sourceHash]);
});

test('checkpoint compaction verifies immutable source content and preserves differing recovery evidence', () => {
    const n = N.create({ normalizeScope: scope => ({ ...scope, accountId: scope.accountId || 'guest', branchId: scope.branchId || 'default' }) });
    const original = { filepath: 'source.txt', translations: { English: ['Accepted English'], Thai: ['Original Thai'] } };
    const scope = { profile: 'translator', game: 'poe1', sourceHash: 'accepted', language: 'Thai', filepath: original.filepath };
    const record = { ...scope, key: 'checkpoint', id: 'captured', revision: 'revision', state: 'active',
        translations: ['Unfinished text'], base: { translations: ['Captured base'] }, source: original,
        conflicts: [{ ...scope, id: 'older', revision: 'older-revision', translations: ['Preserved alternative'],
            source: { ...original, translations: { ...original.translations, English: ['Different captured English'] } } }] };
    const compact = n.draftRow(record, original).value;
    assert.equal(Object.hasOwn(compact, 'source'), false);
    assert.deepEqual(compact.sourceRef, { game: scope.game, sourceHash: scope.sourceHash, filepath: scope.filepath });
    assert.deepEqual(compact.base, record.base);
    assert.deepEqual(compact.translations, record.translations);
    assert.deepEqual(compact.conflicts[0].source, record.conflicts[0].source);
    assert.equal(Object.hasOwn(compact.conflicts[0], 'sourceRef'), false);
    assert.deepEqual(record.source, original, 'Compaction cannot mutate the captured source');
});

function recordFixture({ rejectBaselineTransaction = false, legacyGet = async () => undefined, activationNow, activationYield, IDBKeyRange, onPut } = {}) {
    const data = new Map([...N.names, 'kv'].map(name => [name, new Map()])), reads = [], writes = [], transactions = [];
    const request = value => {
        const req = {};
        queueMicrotask(() => { req.result = structuredClone(value); req.onsuccess(); });
        return req;
    };
    const db = { objectStoreNames: { contains: name => data.has(name) }, close() {}, transaction(names, mode) {
        if (rejectBaselineTransaction && names.includes(N.stores.baseline)) throw new Error('An unrelated baseline writer is still running');
        const activity = { names, mode, completed: false };
        const before = mode === 'readwrite' ? new Map(names.map(name => [name, new Map(data.get(name))])) : null;
        transactions.push(activity);
        const tx = { mode, objectStore(name) {
            assert.ok(names.includes(name), 'A transaction can access only its selected stores');
            const rows = data.get(name);
            const selected = (index, id) => {
                const range = id && typeof id === 'object' && Object.hasOwn(id, 'lower');
                const matches = value => range ? value != null && value >= id.lower && value <= id.upper : id === undefined || value === id;
                const result = [...rows.values()].filter(row => index === 'by_scope' ? matches(row.scope)
                    : index === 'by_kind' ? matches(row.kindScope) : index ? matches(row.pathKey) || row.paths?.some(matches) : matches(row.key));
                if (range) result.sort((a, b) => {
                    const left = index ? a.pathKey || a.paths?.[0] : a.key, right = index ? b.pathKey || b.paths?.[0] : b.key;
                    return left < right ? -1 : left > right ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
                });
                return result;
            };
            return {
                get(id) { reads.push({ name, id }); return request(rows.get(id)); },
                getAll(id) { reads.push({ name, id, method: 'getAll' }); return request(selected(null, id)); },
                count(id) { reads.push({ name, id, method: 'count' }); return request(selected(null, id).length); },
                put(value) { writes.push({ name, value: structuredClone(value) }); rows.set(value.key, structuredClone(value)); onPut?.({ name, value, tx }); },
                delete(id) { rows.delete(id); },
                index(index) { return {
                    getAll(id) { reads.push({ name, index, id }); return request(selected(index, id)); },
                    count(id) { reads.push({ name, index, id, method: 'count' }); return request(selected(index, id).length); },
                }; },
            };
        }, hold() { activity.held = true; }, complete() {
            if (activity.completed || activity.aborted) return;
            activity.completed = true; tx.oncomplete?.();
        }, abort() {
            if (activity.completed) throw new Error('Transaction already completed');
            if (activity.aborted) return;
            activity.aborted = true;
            for (const [name, rows] of before || []) data.set(name, new Map(rows));
            tx.onabort?.();
        } };
        setImmediate(() => { if (!activity.held) tx.complete(); });
        return tx;
    } };
    const W = require('../public/workspaceState.js');
    const n = N.create({ W, openDb: async () => db, legacyGet, activationNow, activationYield, IDBKeyRange,
        normalizeScope: scope => ({ ...scope, accountId: scope.accountId || scope.profile || 'guest', branchId: scope.branchId || 'default' }) });
    const put = (name, value) => data.get(name).set(value.key, structuredClone(value));
    const scope = { accountId: 'owner', game: 'poe2', branchId: 'default', sourceHash: 'accepted', language: 'Thai' };
    put(N.stores.migration, { key: N.scopeKey(scope), value: { state: 'ready' } });
    const source = (filepath, index = 0) => ({ filepath, name: 'Description ' + index, stats: ['stat_' + index], variables: ['#'], remarks: [''],
        translations: { English: ['English ' + index], Thai: ['Original Thai ' + index], German: ['German ' + index] } });
    function workspace(files, archive = false) {
        const id = N.scopeKey(scope), baseId = N.baselineKey(scope);
        put(N.stores.meta, { key: id, scope: id, value: { ...scope, stagedVersion: 1,
            ...(archive ? { importArchive: { baselineId: scope.sourceHash } } : {}) } });
        for (const [order, file] of files.entries()) {
            put(N.stores.baseline, n.row(baseId, file.filepath, file, { order }));
            put(N.stores.files, n.row(id, file.filepath, { filepath: file.filepath, overrides: {} }, { pathKey: n.key(id, file.filepath) }));
        }
        if (archive) put(N.stores.assets, { key: baseId, value: { archive: { baselineId: scope.sourceHash }, tree: { root: 'tree' } } });
    }
    return { n, scope, data, reads, writes, transactions, put, source, workspace, db };
}

test('one room projection reuses each immutable baseline read through room, workspace and write adapters', async () => {
    const f = recordFixture(), file = f.source('one.txt');
    f.workspace([file]);
    const R = require('../public/normalizedRooms.js'), rooms = R.create(f.n), roomKey = rooms.identityKey(f.scope);
    f.put(N.stores.rooms, { key: roomKey, value: { identity: f.scope, mode: 'sparse', manifest: { version: 2 } } });
    f.put(N.stores.shared, f.n.row(roomKey, file.filepath, { filepath: file.filepath,
        manifest: { filepath: file.filepath, entryCount: 1 }, shared: { filepath: file.filepath, translations: ['Accepted'], revision: 1 } }));
    await f.n.transaction([N.stores.rooms, N.stores.shared, N.stores.operations, N.stores.roomRecords,
        N.stores.meta, N.stores.files, N.stores.records, N.stores.baseline], 'readwrite', async tx => {
        const result = await rooms.readRoom(tx, roomKey, [file.filepath]);
        assert.equal(result.workspace.descs[0].translations.English[0], 'English 0');
        result.workspace.descs[0].translations.English[0] = 'Only the materialized copy changes';
        await f.n.writeWorkspace(tx, f.scope, result.workspace, [file.filepath]);
        assert.equal((await f.n.get(tx, N.stores.baseline, f.n.key(N.baselineKey(f.scope), file.filepath))).translations.English[0], 'English 0');
    });
    assert.equal(f.reads.filter(read => read.name === N.stores.baseline).length, 1,
        'Room hydration, workspace hydration and projection must issue a single baseline request');
});

test('large workspace selection batches only selected paths and keeps cold recovery out of atomic projections', async () => {
    const ranges = { bound: (lower, upper) => ({ lower, upper }) }, f = recordFixture({ IDBKeyRange: ranges });
    const files = Array.from({ length: 300 }, (_, index) => f.source('dense/' + String(index).padStart(5, '0') + '.txt', index));
    f.workspace(files);
    const id = N.scopeKey(f.scope), archived = f.n.row(id, ['importRecovery', 0, 'desc', 0],
        { field: 'importRecovery', kind: 'desc', entry: 0, order: 0, data: { translations: { English: new Array(2048).fill('Cold recovery') } } },
        { kindScope: f.n.key(id, 'importRecovery') });
    f.put(N.stores.records, archived);
    for (const file of files) f.put(N.stores.records, f.n.row(id, ['staged', 'Thai', file.filepath],
        { field: 'staged', language: 'Thai', entry: file.filepath, data: { translations: ['Staged ' + file.filepath] } },
        { pathKey: f.n.key(id, file.filepath), kindScope: f.n.key(id, 'staged') }));
    const selected = files.slice(0, 128).map(file => file.filepath).reverse(), untouched = files[299].filepath;
    await f.n.transaction([N.stores.meta, N.stores.files, N.stores.records, N.stores.baseline], 'readwrite', async tx => {
        const view = await f.n.readWorkspace(tx, f.scope, selected, false);
        assert.deepEqual(view.descs.map(file => file.filepath), selected, 'Range hydration retains requested order');
        assert.deepEqual(Object.keys(view.staged.Thai), selected, 'Records use only the selected path order');
        assert.equal(view.importRecovery, undefined);
        assert.equal(view.staged.Thai[untouched], undefined);
        view.staged.Thai[selected[0]].translations = ['Edited selected text'];
        await f.n.writeWorkspace(tx, f.scope, view, selected);
    });
    assert.equal(f.reads.filter(read => read.name === N.stores.baseline).length, 2,
        'One count and one bounded baseline read are reused by the atomic write');
    assert.equal(f.reads.filter(read => read.name === N.stores.files).length, 4);
    assert.equal(f.reads.filter(read => read.name === N.stores.records).length, 4);
    assert.ok(f.reads.filter(read => read.name === N.stores.records).every(read => read.index === 'by_path'), 'Partial writes never hydrate pathless importRecovery');
    assert.deepEqual(f.data.get(N.stores.records).get(archived.key), archived);
    assert.deepEqual(f.data.get(N.stores.records).get(f.n.key(id, ['staged', 'Thai', untouched])).value.data.translations, ['Staged ' + untouched]);
    const batchedReads = f.reads.length;
    f.reads.length = 0;
    await f.n.workspace(f.scope, { filepaths: selected.slice(1), includeDropped: false });
    assert.ok(f.reads.length > batchedReads * 20, 'The deterministic threshold collapses hundreds of success events into bounded range requests');
    assert.equal(f.reads.filter(read => read.method === 'count').length, 0, 'Selections below 128 retain their point path');
});

test('scattered workspace ranges guard overfetch and baseline range misses remain writable in the transaction', async () => {
    const f = recordFixture({ IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) } });
    const files = Array.from({ length: 1800 }, (_, index) => f.source('sparse/' + String(index).padStart(5, '0') + '.txt', index));
    f.workspace(files);
    const selected = Array.from({ length: 128 }, (_, index) => files[index * 14].filepath), id = N.scopeKey(f.scope);
    await f.n.workspace(f.scope, { filepaths: selected, includeDropped: false });
    for (const name of [N.stores.files, N.stores.baseline]) {
        const reads = f.reads.filter(read => read.name === name);
        assert.equal(reads.filter(read => read.method === 'count').length, 1);
        assert.equal(reads.filter(read => read.id?.lower && read.method !== 'count').length, 0, 'An oversized range never serializes unrelated original text');
        assert.equal(reads.length, 129, 'Sparse selection safely falls back to exact requests');
    }
    const missing = Array.from({ length: 128 }, (_, index) => 'missing/' + index + '.txt');
    await f.n.transaction([N.stores.baseline], 'readwrite', async tx => {
        assert.ok((await f.n.originalFiles(tx, f.scope, missing)).every(value => value === undefined));
        tx.objectStore(N.stores.baseline).put(f.n.row(N.baselineKey(f.scope), missing[0], f.source(missing[0])));
        assert.equal((await f.n.originalFiles(tx, f.scope, missing))[0].filepath, missing[0]);
    });
    assert.equal(f.data.get(N.stores.meta).get(id).value.accountId, f.scope.accountId);
});

test('concurrent large baseline adapters share in-flight bounded requests', async () => {
    const f = recordFixture({ IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) } });
    const files = Array.from({ length: 128 }, (_, index) => f.source('file-' + index + '.txt', index)); f.workspace(files);
    const paths = files.map(file => file.filepath);
    await f.n.transaction([N.stores.baseline], 'readonly', async tx => {
        const [first, second, point] = await Promise.all([f.n.originalFiles(tx, f.scope, paths), f.n.originalFiles(tx, f.scope, paths),
            f.n.get(tx, N.stores.baseline, f.n.key(N.baselineKey(f.scope), paths[0]))]);
        assert.deepEqual(first, files); assert.deepEqual(second, files); assert.deepEqual(point, files[0]);
    });
    assert.equal(f.reads.filter(read => read.name === N.stores.baseline).length, 2, 'Both range adapters and a point read share one count/read pair');
});

test('activation loads the accepted baseline once while preserving independent source, workspace and import views', async () => {
    const f = recordFixture(), files = Array.from({ length: 512 }, (_, index) => f.source('file-' + index + '.txt', index));
    f.workspace(files, true);
    f.data.get(N.stores.assets).get(N.baselineKey(f.scope)).value.rawSource = structuredClone(files);
    const hydrated = await f.n.activation(f.scope);
    assert.deepEqual(hydrated.source, files);
    assert.deepEqual(hydrated.workspace.descs.map(file => file.translations), files.map(file => file.translations));
    assert.deepEqual(hydrated.baseline.source, files);
    const reads = f.reads.filter(read => read.name === N.stores.baseline);
    assert.equal(reads.length, 1);
    assert.equal(reads[0].index, 'by_scope', 'Bulk activation must not issue a request per original file');
    assert.equal(f.reads.filter(read => read.name === N.stores.assets).length, 1, 'Accepted assets are detached only once');
    assert.equal(hydrated.sourceBaselineId, f.scope.sourceHash);
    hydrated.workspace.descs[0].translations.English[0] = 'Editor decoration';
    hydrated.baseline.source[0].translations.English[0] = 'Independent import consumer';
    hydrated.baseline.rawSource[0].translations.English[0] = 'Independent retained parse';
    hydrated.baseline.tree.root = 'Independent tree';
    assert.equal(hydrated.source[0].translations.English[0], 'English 0');
    assert.equal(f.data.get(N.stores.assets).get(N.baselineKey(f.scope)).value.rawSource[0].translations.English[0], 'English 0');
    assert.equal(f.data.get(N.stores.assets).get(N.baselineKey(f.scope)).value.tree.root, 'tree');
});

test('activation task slices start after transaction completion and preserve the captured materialized view', async () => {
    let clock = 0, yields = 0, otherTasks = 0, f;
    f = recordFixture({ activationNow: () => clock += 4, activationYield: async () => {
        yields++;
        assert.ok(f.transactions.every(tx => tx.completed), 'Detached materialization cannot hold an IDB transaction across a task yield');
        if (yields === 1) {
            const changed = f.source('file-0.txt'); changed.translations.English[0] = 'Later source';
            f.put(N.stores.baseline, f.n.row(N.baselineKey(f.scope), changed.filepath, changed));
            f.scope.accountId = 'replacement-account';
        }
        await new Promise(resolve => setImmediate(() => { otherTasks++; resolve(); }));
    } });
    const files = Array.from({ length: 96 }, (_, index) => f.source('file-' + index + '.txt', index));
    files[7].translations.English = Array.from({ length: 4096 }, (_, index) => 'Large entry ' + index);
    f.workspace(files, true);
    const id = N.scopeKey(f.scope), meta = f.data.get(N.stores.meta).get(id);
    meta.value._storageArchiveKinds = ['importRecovery'];
    meta.value.extra = { date: new Date('2026-10-09T00:00:00Z'), values: [undefined, NaN], omitted: undefined };
    const records = [
        { field: 'staged', language: 'Thai', entry: files[7].filepath, data: { translations: ['Saved Thai'], marker: { retained: true } } },
        { field: 'droppedOutbox', entry: 'last', order: 8, data: { id: 'last', translations: ['Last'] } },
        { field: 'importRecovery', kind: 'desc', entry: 0, order: 0, data: files[1] },
        { field: 'importRecovery', kind: 'status', entry: 0, statusKey: 'kept', data: { unresolved: true } },
        { field: 'droppedOutbox', entry: 'first', order: 2, data: { id: 'first', translations: ['First'] } },
        { field: 'importRecovery', kind: 'group', entry: 0, data: { descs: [], status: {}, note: 'Kept recovery' } },
        { field: 'droppedArchive', entry: 'older', data: { source: files[2], translations: ['Dropped text'] } },
    ];
    records.forEach((value, index) => f.put(N.stores.records, f.n.row(id, index, value)));
    const expected = await f.n.workspace(f.scope), captured = { ...f.scope };
    f.reads.length = 0;
    const result = await f.n.activation(f.scope);
    assert.ok(yields > 2, 'A large entry and corpus must run in multiple bounded slices');
    assert.equal(otherTasks, yields, 'Each cooperative yield executes an actual event-loop task');
    assert.deepEqual(result.workspace, expected, 'Ordering, overlays, JSON copies and archived recovery match the existing adapter');
    assert.equal(result.source[0].translations.English[0], 'English 0', 'A later stored change cannot mix with captured raw rows');
    assert.equal(result.workspace.accountId, captured.accountId);
    assert.equal(result.sourceBaselineId, captured.sourceHash);
    assert.equal(f.reads.filter(read => read.name === N.stores.baseline).length, 1);
    assert.equal(f.reads.filter(read => read.name === N.stores.assets).length, 1);
    result.workspace.descs[7].translations.English[0] = 'Workspace only';
    result.workspace.staged.Thai[files[7].filepath].translations[0] = 'Record only';
    result.baseline.source[7].translations.English[0] = 'Import baseline only';
    result.workspace.importArchive.baselineId = 'Editor archive only';
    assert.equal(result.source[7].translations.English[0], 'Large entry 0');
    assert.equal(result.workspace.descs[7].translations.Thai[0], 'Saved Thai');
    assert.equal(result.baseline.archive.baselineId, captured.sourceHash);
    assert.equal(result.workspace.importRecovery[0].descs[0].translations.English[0], 'English 1');
});

test('readonly assets are reused locally while readwrite imports observe replacements', async () => {
    const f = recordFixture(); f.workspace([f.source('one.txt')], true);
    const id = N.baselineKey(f.scope);
    await f.n.transaction([N.stores.assets], 'readonly', async tx => {
        assert.equal((await f.n.get(tx, N.stores.assets, id)).tree.root, 'tree');
        assert.equal((await f.n.get(tx, N.stores.assets, id)).tree.root, 'tree');
    });
    assert.equal(f.reads.filter(read => read.name === N.stores.assets).length, 1);
    await f.n.transaction([N.stores.assets], 'readwrite', async tx => {
        assert.equal((await f.n.get(tx, N.stores.assets, id)).tree.root, 'tree');
        tx.objectStore(N.stores.assets).put({ key: id, value: { archive: { baselineId: f.scope.sourceHash }, tree: { root: 'replacement' } } });
        assert.equal((await f.n.get(tx, N.stores.assets, id)).tree.root, 'replacement');
    });
    await f.n.transaction([N.stores.assets], 'readonly', async tx => {
        assert.equal((await f.n.get(tx, N.stores.assets, id)).tree.root, 'replacement');
    });
    assert.equal(f.reads.filter(read => read.name === N.stores.assets).length, 4, 'Readwrite changes and a new readonly transaction are never stale');
});

test('activation provenance requires an accepted archive and missing assets remain actionable', async () => {
    const f = recordFixture(); f.workspace([f.source('one.txt')]);
    assert.equal(Object.hasOwn(await f.n.activation(f.scope), 'sourceBaselineId'), false, 'Legacy parsed sources have no accepted archive provenance');
    f.workspace([f.source('one.txt')], true);
    f.data.get(N.stores.assets).get(N.baselineKey(f.scope)).value.archive.baselineId = 'other-baseline';
    assert.equal(Object.hasOwn(await f.n.activation(f.scope), 'sourceBaselineId'), false, 'A mismatched asset cannot authorize corpus reuse');
    f.data.get(N.stores.assets).delete(N.baselineKey(f.scope));
    await assert.rejects(f.n.activation(f.scope), /accepted archive descriptor is unavailable/);
    f.workspace([f.source('one.txt')], true);
    f.data.get(N.stores.meta).get(N.scopeKey(f.scope)).value.unsupported = 1n;
    await assert.rejects(f.n.activation(f.scope), /serialize a BigInt/);
});

test('absent checkpoint hydration completes without entering the busy baseline store even on first lookup', async () => {
    const f = recordFixture({ rejectBaselineTransaction: true });
    assert.equal(await f.n.draftGet('absent'), undefined);
    assert.deepEqual(f.transactions[0].names, [N.stores.drafts]);
    assert.ok(f.transactions.every(tx => !tx.names.includes(N.stores.baseline)));
    assert.equal(f.data.get(N.stores.migration).get(f.n.key('draft', 'absent')).value.state, 'ready');
    assert.equal(await f.n.draftGet('absent'), undefined, 'Readiness keeps later absence authoritative');
});

test('draft hydration resolves captured source references without replacing its revision or copying another scope', async () => {
    const f = recordFixture(), file = f.source('draft.txt');
    f.workspace([file]);
    f.put(N.stores.drafts, { key: 'draft', value: { id: 'captured', revision: 'revision-3', translations: ['Typing'],
        sourceRef: { game: f.scope.game, sourceHash: f.scope.sourceHash, filepath: file.filepath },
        recovery: [{ revision: 'older', source: { translations: { English: ['Different preserved English'] } } }] } });
    const draft = await f.n.draftGet('draft');
    assert.equal(draft.revision, 'revision-3');
    assert.deepEqual(draft.source, file);
    assert.equal(draft.recovery[0].source.translations.English[0], 'Different preserved English');
    assert.deepEqual(f.transactions.map(tx => tx.names), [[N.stores.drafts], [N.stores.baseline]]);
    draft.source.translations.English[0] = 'Later mutable caller';
    assert.equal((await f.n.draftGet('draft')).source.translations.English[0], 'English 0');
});

test('draft absence migration rechecks a checkpoint created concurrently before recording readiness', async () => {
    let f;
    f = recordFixture({ legacyGet: async () => {
        f.put(N.stores.drafts, { key: 'new', value: { id: 'other-tab', revision: 'new-revision', translations: ['Other typing'] } });
        return undefined;
    } });
    assert.equal((await f.n.draftGet('new')).revision, 'new-revision');
    assert.equal(f.data.get(N.stores.drafts).get('new').value.translations[0], 'Other typing');
});

test('baseline read reuse ends at transaction and source boundaries and never caches a missing imported row', async () => {
    const f = recordFixture(), file = f.source('same.txt');
    f.workspace([file]);
    const id = f.n.key(N.baselineKey(f.scope), file.filepath), otherScope = { ...f.scope, sourceHash: 'other-source' };
    f.put(N.stores.baseline, f.n.row(N.baselineKey(otherScope), file.filepath, { ...file, name: 'Other source' }));
    await f.n.transaction([N.stores.baseline], 'readwrite', async tx => {
        assert.equal((await f.n.get(tx, N.stores.baseline, id)).name, file.name);
        assert.equal((await f.n.get(tx, N.stores.baseline, f.n.key(N.baselineKey(otherScope), file.filepath))).name, 'Other source');
        const missing = f.n.key(N.baselineKey(f.scope), 'new.txt');
        assert.equal(await f.n.get(tx, N.stores.baseline, missing), undefined);
        tx.objectStore(N.stores.baseline).put(f.n.row(N.baselineKey(f.scope), 'new.txt', f.source('new.txt')));
        assert.equal((await f.n.get(tx, N.stores.baseline, missing)).filepath, 'new.txt');
    });
    await f.n.transaction([N.stores.baseline], 'readonly', tx => f.n.get(tx, N.stores.baseline, id));
    assert.equal(f.reads.filter(read => read.name === N.stores.baseline && read.id === id).length, 2,
        'A later transaction must not reuse a retained or aborted snapshot');
});

test('legacy draft transfer preserves captured source and recovery then marks absence as authoritative', async () => {
    const legacy = { key: 'legacy', profile: 'owner', game: 'poe2', branchId: 'default', sourceHash: 'accepted', language: 'Thai',
        filepath: 'legacy.txt', id: 'legacy-id', revision: 'legacy-revision', translations: ['Unfinished'],
        source: { filepath: 'legacy.txt', translations: { English: ['Different preserved source'] } },
        recovery: [{ revision: 'old', translations: ['Older work'] }] };
    const f = recordFixture({ legacyGet: async id => id === 'legacy' ? structuredClone(legacy) : undefined });
    f.workspace([f.source('legacy.txt')]);
    const result = await f.n.draftGet('legacy');
    assert.equal(result.revision, 'legacy-revision');
    assert.deepEqual(result.source, legacy.source);
    assert.deepEqual(result.recovery, legacy.recovery);
    assert.equal(f.data.get(N.stores.migration).get(f.n.key('draft', 'legacy')).value.state, 'ready');
    f.data.get(N.stores.drafts).delete('legacy');
    assert.equal(await f.n.draftGet('legacy'), undefined, 'Frozen legacy content must not resurrect a removed normalized checkpoint');
});

test('editing a hydrated draft source cannot mutate the original reused by its atomic update', async () => {
    const f = recordFixture(), original = f.source('draft.txt');
    f.workspace([original]);
    f.put(N.stores.drafts, { key: 'draft', value: { key: 'draft', profile: 'owner', game: f.scope.game, branchId: 'default', sourceHash: f.scope.sourceHash,
        language: 'Thai', filepath: original.filepath, id: 'captured', revision: 'revision', translations: ['Typing'],
        sourceRef: { game: f.scope.game, sourceHash: f.scope.sourceHash, filepath: original.filepath } } });
    await f.n.draftUpdate('draft', current => {
        current.source.translations.English[0] = 'Different recovery source';
        return { record: current };
    });
    const retained = f.data.get(N.stores.drafts).get('draft').value;
    assert.equal(retained.source.translations.English[0], 'Different recovery source');
    assert.equal(retained.sourceRef, undefined, 'Recovery differences must not be mistaken for the shared immutable original');
    assert.equal(f.data.get(N.stores.baseline).get(f.n.key(N.baselineKey(f.scope), original.filepath)).value.translations.English[0], 'English 0');
});

test('the collaboration client reconnects through normalized records without hydrating untouched manifest originals', async t => {
    const f = recordFixture(), P = require('../public/collaborationProtocol.js'), { Client } = require('../public/collaborationSync.js');
    const files = Array.from({ length: 256 }, (_, index) => f.source('file-' + index + '.txt', index));
    const tree = await P.buildBaselineTree(files);
    const archive = await P.finalizeArchive({ version: 1, zipHash: await P.zipHash(new Uint8Array([1, 2, 3])), zipSize: 3,
        fileCount: files.length, descriptionCount: files.length, parserVersion: 1, decisions: [], treeRoot: tree.root });
    f.scope.sourceHash = archive.baselineId;
    f.put(N.stores.migration, { key: N.scopeKey(f.scope), value: { state: 'ready' } });
    f.workspace(files, true);
    f.put(N.stores.assets, { key: N.baselineKey(f.scope), value: { archive, tree } });
    const rooms = require('../public/normalizedRooms.js').create(f.n), roomKey = rooms.identityKey(f.scope), selected = files[8].filepath;
    f.put(N.stores.migration, { key: f.n.key('room', roomKey), value: { state: 'ready' } });
    await f.n.transaction([N.stores.rooms, N.stores.shared, N.stores.operations, N.stores.roomRecords], 'readwrite', tx => rooms.writeRoom(tx, roomKey,
        { identity: f.scope, archive, mode: 'sparse', roomId: 'room', initialized: true, sequence: 3,
            manifest: { version: 2, files: files.map(file => ({ filepath: file.filepath, entryCount: 1 })) },
            shared: { [selected]: { filepath: selected, translations: ['Accepted shared text'], revision: 3, trackedForExport: true } },
            outbox: [], conflicts: [], recovery: [], carries: {} }));
    let networkRequests = 0;
    const client = new Client({ store: {
        getCollaborationRecords: command => rooms.getRecords(command),
        updateCollaborationRecords: (command, update, options) => rooms.updateRecords(command, update, options),
        captureWorkspaceScope: scope => scope,
    }, WebSocket: null, presenceEnabled: () => false, request: async () => { networkRequests++; throw new Error('Network must remain deferred'); } });
    t.after(() => client.destroy());
    const workspace = await f.n.workspace(f.scope);
    f.reads.length = 0;
    await client.connect({ ...f.scope, source: files, baselineSource: files, baselineTree: tree, archive,
        files: files.map(file => ({ filepath: file.filepath, translations: file.translations.Thai })), workspace, deferRemote: true });
    assert.equal(networkRequests, 0);
    assert.equal(client.fileBase(selected).translations[0], 'Accepted shared text');
    assert.equal(client.room().manifest.files.length, files.length);
    const baselineReads = f.reads.filter(read => read.name === N.stores.baseline);
    assert.equal(baselineReads.length, 2, 'Cold scoped read plus atomic projection each read the single affected original once');
    assert.ok(baselineReads.every(read => read.id === f.n.key(N.baselineKey(f.scope), selected)));
    assert.equal(f.data.get(N.stores.shared).size, files.length, 'Scoped reconnect retains all immutable manifest rows');

    // A first connection has no room read-view. Its projection must still use
    // the durable selected workspace, not copy and rewrite every in-memory row.
    f.data.get(N.stores.rooms).delete(roomKey);
    f.data.get(N.stores.shared).clear();
    f.reads.length = 0;
    const oldRows = structuredClone([...f.data.get(N.stores.files)]);
    await client.connect({ ...f.scope, source: files, baselineSource: files, baselineTree: tree, archive,
        files: files.map(file => ({ filepath: file.filepath, translations: file.translations.Thai })), workspace, deferRemote: true });
    assert.equal(networkRequests, 0);
    assert.equal(f.reads.filter(read => read.name === N.stores.baseline).length, 0,
        'Creating an empty sparse room must not hydrate any originals for its workspace projection');
    assert.deepEqual([...f.data.get(N.stores.files)], oldRows, 'Empty new-room projection never rewrites unrelated descriptions');
    assert.equal(f.data.get(N.stores.shared).size, files.length, 'First room creation persists its compact immutable manifest');
});

test('OfflineStore cold snapshot captures one scope and shares its baseline across workspace, source and imported assets', async () => {
    const f = recordFixture(), files = Array.from({ length: 128 }, (_, index) => f.source('file-' + index + '.txt', index));
    f.workspace(files, true);
    const root = { WorkspaceState: require('../public/workspaceState.js'), NormalizedStore: N };
    const context = require('node:vm').createContext({ window: root, console: { log() {} }, setTimeout, clearTimeout,
        indexedDB: { open() { const req = {}; queueMicrotask(() => { req.result = f.db; req.onsuccess(); }); return req; } } });
    require('node:vm').runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/offlineStore.js'), 'utf8'), context);
    const store = root.OfflineStore;
    store.setWorkspaceContext(f.scope);
    const loading = store.getWorkspaceSnapshot(f.scope, 'Thai');
    store.setWorkspaceContext({ ...f.scope, accountId: 'new-account', game: 'poe1', sourceHash: 'replacement' });
    const snapshot = await loading;
    assert.deepEqual(structuredClone(snapshot.scope), { accountId: 'owner', game: 'poe2', branchId: 'default', sourceHash: 'accepted' });
    assert.deepEqual(snapshot.source, files);
    assert.deepEqual(snapshot.baseline.source, files);
    assert.equal(snapshot.workspace.sourceHash, 'accepted');
    assert.equal(snapshot.sourceBaselineId, 'accepted');
    assert.equal(f.reads.filter(read => read.name === N.stores.baseline).length, 1);
    assert.equal(f.reads.filter(read => read.name === N.stores.assets).length, 1);
    assert.equal(f.reads.find(read => read.name === N.stores.baseline).index, 'by_scope');
    assert.equal(f.transactions.some(tx => tx.mode === 'readwrite'), false, 'A settled normalized snapshot is read-only');
    assert.deepEqual(snapshot.workspace, await store.getWorkspace(f.scope, 'Thai'), 'The bundle keeps the established selected-language workspace view');
});

function offlineFixture(f, wrapActivation = value => value, legacy = false) {
    const root = { WorkspaceState: require('../public/workspaceState.js'), NormalizedStore: legacy ? undefined : { ...N, create(dependencies) {
        const n = N.create(dependencies); n.activation = wrapActivation(n.activation); return n;
    } } };
    const context = require('node:vm').createContext({ window: root, console: { log() {} }, setTimeout, clearTimeout,
        indexedDB: { open() { const req = {}; queueMicrotask(() => { req.result = f.db; req.onsuccess(); }); return req; } } });
    require('node:vm').runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/offlineStore.js'), 'utf8'), context);
    return root.OfflineStore;
}
function seedAnotherVersion(f, changes) {
    const saved = { ...f.scope }; Object.assign(f.scope, changes);
    f.put(N.stores.migration, { key: N.scopeKey(f.scope), value: { state: 'ready' } });
    f.workspace([f.source('other.txt', 1)], true);
    const scope = { ...f.scope }; Object.assign(f.scope, saved); return scope;
}

test('an older cooperative activation cannot replace the newer durable selection or cached context', async () => {
    const f = recordFixture(); f.workspace([f.source('old.txt')], true);
    const newer = seedAnotherVersion(f, { sourceHash: 'newer' });
    let unblock, announce;
    const blocked = new Promise(resolve => { unblock = resolve; }), reached = new Promise(resolve => { announce = resolve; });
    const store = offlineFixture(f, activation => async scope => {
        const result = await activation(scope);
        if (scope.sourceHash === f.scope.sourceHash) { announce(); await blocked; }
        return result;
    });
    store.setWorkspaceContext(f.scope);
    const oldResult = store.activateVersion(f.scope);
    await reached;
    const selected = await store.activateVersion(newer);
    assert.equal(selected.sourceBaselineId, newer.sourceHash);
    unblock();
    await assert.rejects(oldResult, error => error.code === 'WORKSPACE_ACTIVATION_SUPERSEDED' && error.stale === true);
    const pointer = 'workspace_active_v1:' + JSON.stringify([f.scope.accountId, f.scope.game, f.scope.branchId]);
    assert.equal(f.data.get('kv').get(pointer).value.sourceHash, newer.sourceHash);
    assert.equal((await store.getWorkspaceSnapshot('poe2', 'Thai')).scope.sourceHash, newer.sourceHash);
    assert.equal(f.writes.filter(write => write.name === 'kv' && write.value.key === pointer).length, 1, 'The superseded activation never queues its pointer write');
});

test('activation rechecks its token in the pointer write callback and fences independent keys separately', async () => {
    const f = recordFixture(); f.workspace([f.source('old.txt')], true);
    const newer = seedAnotherVersion(f, { sourceHash: 'newer' });
    const otherAccount = seedAnotherVersion(f, { accountId: 'other-account', sourceHash: 'other' });
    const otherBranch = seedAnotherVersion(f, { branchId: 'another-branch', sourceHash: 'branch' });
    const store = offlineFixture(f); store.setWorkspaceContext(f.scope);
    const transact = f.db.transaction.bind(f.db);
    let replacement, fired = false;
    f.db.transaction = (names, mode) => {
        const tx = transact(names, mode);
        if (!fired && mode === 'readwrite' && names.length === 1 && names[0] === 'kv') {
            fired = true; replacement = store.activateVersion(newer);
        }
        return tx;
    };
    await assert.rejects(store.activateVersion(f.scope), error => error.code === 'WORKSPACE_ACTIVATION_SUPERSEDED' && error.stale);
    await replacement;
    const pointer = 'workspace_active_v1:' + JSON.stringify([f.scope.accountId, f.scope.game, f.scope.branchId]);
    assert.deepEqual(f.writes.filter(write => write.name === 'kv' && write.value.key === pointer).map(write => write.value.value.sourceHash), ['newer'],
        'Supersession between transaction creation and the success callback cannot queue a stale put');
    const selections = await Promise.all([store.activateVersion(newer), store.activateVersion(otherAccount), store.activateVersion(otherBranch)]);
    assert.deepEqual(selections.map(value => value.scope.sourceHash), ['newer', 'other', 'branch']);
    for (const selected of selections) {
        const scope = selected.scope, key = 'workspace_active_v1:' + JSON.stringify([scope.accountId, scope.game, scope.branchId]);
        assert.equal(f.data.get('kv').get(key).value.sourceHash, scope.sourceHash, 'Account and branch selections keep separate durable keys');
    }
});

for (const legacy of [false, true]) test((legacy ? 'legacy' : 'normalized') + ' activation rolls back a queued pointer put when the newer selection fails', async () => {
    let announce, held;
    const reached = new Promise(resolve => { announce = resolve; });
    const f = recordFixture({ onPut({ name, value, tx }) {
        if (name === 'kv' && value.key === pointer && value.value.sourceHash === 'accepted') {
            held = tx; tx.hold(); announce();
        }
    } });
    const pointer = 'workspace_active_v1:' + JSON.stringify([f.scope.accountId, f.scope.game, f.scope.branchId]);
    const previous = { ...f.scope, sourceHash: 'previous-selection' };
    f.put('kv', { key: pointer, value: previous });
    if (legacy) {
        const suffix = N.scopeKey(f.scope);
        f.put('kv', { key: 'workspace_version_v1:' + suffix, value: { ...f.scope, descs: [f.source('old.txt')] } });
        f.put('kv', { key: 'source_version_v1:' + suffix, value: [f.source('old.txt')] });
    } else f.workspace([f.source('old.txt')], true);
    const store = offlineFixture(f, undefined, legacy); store.setWorkspaceContext(previous);
    const older = store.activateVersion(f.scope);
    const olderOutcome = assert.rejects(older, error => error.code === 'WORKSPACE_ACTIVATION_SUPERSEDED' && error.stale === true);
    await reached;
    await assert.rejects(store.activateVersion({ ...f.scope, sourceHash: 'missing-version' }), /not available in this browser/);
    await olderOutcome;
    assert.ok(held);
    assert.ok(f.transactions.some(tx => tx.aborted && tx.mode === 'readwrite'));
    assert.deepEqual(f.data.get('kv').get(pointer).value, previous, 'An uncommitted superseded put cannot replace the last successful selection');
    assert.equal(store.captureWorkspaceScope().sourceHash, previous.sourceHash, 'Failed and superseded requests cannot publish cached context');
});
