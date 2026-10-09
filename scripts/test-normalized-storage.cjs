const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../public/normalizedStore.js');

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
