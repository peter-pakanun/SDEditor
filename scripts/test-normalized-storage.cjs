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

test('v9 separates translation records from KV aggregates and adds scoped indexes without deleting legacy stores', () => {
    const fixture = schema(); N.upgrade(fixture.db, fixture.tx);
    const expected = ['translation_workspaces', 'baseline_files', 'baseline_assets', 'workspace_files', 'workspace_records',
        'translation_drafts', 'collaboration_rooms', 'collaboration_files', 'collaboration_operations', 'collaboration_records',
        'save_submissions', 'save_receipts', 'storage_migrations'];
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
    for (const name of ['workspace_records', 'collaboration_records']) {
        assert.deepEqual(fixture.stores.get(name).indices.get('by_kind'), { keyPath: 'kindScope' });
    }
});

test('schema initialization is idempotent for workers and pages sharing the v9 database', () => {
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

function recordFixture({ rejectBaselineTransaction = false, legacyGet = async () => undefined } = {}) {
    const data = new Map([...N.names, 'kv'].map(name => [name, new Map()])), reads = [], transactions = [];
    const request = value => {
        const req = {};
        queueMicrotask(() => { req.result = structuredClone(value); req.onsuccess(); });
        return req;
    };
    const db = { objectStoreNames: { contains: name => data.has(name) }, close() {}, transaction(names, mode) {
        if (rejectBaselineTransaction && names.includes(N.stores.baseline)) throw new Error('An unrelated baseline writer is still running');
        transactions.push({ names, mode });
        const tx = { objectStore(name) {
            assert.ok(names.includes(name), 'A transaction can access only its selected stores');
            const rows = data.get(name);
            return {
                get(id) { reads.push({ name, id }); return request(rows.get(id)); },
                put(value) { rows.set(value.key, structuredClone(value)); },
                delete(id) { rows.delete(id); },
                index(index) { return { getAll(id) {
                    reads.push({ name, index, id });
                    return request([...rows.values()].filter(row => index === 'by_scope' ? row.scope === id
                        : index === 'by_kind' ? row.kindScope === id : row.pathKey === id || row.paths?.includes(id)));
                } }; },
            };
        }, abort() { tx.onabort?.(); } };
        setImmediate(() => tx.oncomplete?.());
        return tx;
    } };
    const W = require('../public/workspaceState.js');
    const n = N.create({ W, openDb: async () => db, legacyGet,
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
    return { n, scope, data, reads, transactions, put, source, workspace, db };
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

test('activation loads the accepted baseline once while preserving independent source, workspace and import views', async () => {
    const f = recordFixture(), files = Array.from({ length: 512 }, (_, index) => f.source('file-' + index + '.txt', index));
    f.workspace(files, true);
    const hydrated = await f.n.activation(f.scope);
    assert.deepEqual(hydrated.source, files);
    assert.deepEqual(hydrated.workspace.descs.map(file => file.translations), files.map(file => file.translations));
    assert.deepEqual(hydrated.baseline.source, files);
    const reads = f.reads.filter(read => read.name === N.stores.baseline);
    assert.equal(reads.length, 1);
    assert.equal(reads[0].index, 'by_scope', 'Bulk activation must not issue a request per original file');
    hydrated.workspace.descs[0].translations.English[0] = 'Editor decoration';
    hydrated.baseline.source[0].translations.English[0] = 'Independent import consumer';
    assert.equal(hydrated.source[0].translations.English[0], 'English 0');
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
    assert.equal(f.reads.filter(read => read.name === N.stores.baseline).length, 1);
    assert.equal(f.reads.find(read => read.name === N.stores.baseline).index, 'by_scope');
    assert.equal(f.transactions.some(tx => tx.mode === 'readwrite'), false, 'A settled normalized snapshot is read-only');
    assert.deepEqual(snapshot.workspace, await store.getWorkspace(f.scope, 'Thai'), 'The bundle keeps the established selected-language workspace view');
});
