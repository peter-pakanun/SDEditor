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
