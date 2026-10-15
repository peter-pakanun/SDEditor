const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../public/normalizedStore.js');

test('cached sparse rooms queue local-only staged saves against accepted text and preserve them through rejoin', async t => {
    const P = require('../public/collaborationProtocol.js'), W = require('../public/workspaceState.js');
    const { Client } = require('../public/collaborationSync.js');
    for (const cached of ['none', 'empty', 'shared']) await t.test(cached, async t => {
        const f = recordFixture(), source = [f.source('a.txt')];
        const archive = await P.finalizeArchive({ version: 2, zipHash: await P.zipHash(new Uint8Array([1, 2, 3])), zipSize: 3,
            fileCount: 1, descriptionCount: 1, parserVersion: 1, decisions: [] });
        f.scope.sourceHash = archive.baselineId;
        f.put(N.stores.migration, { key: N.scopeKey(f.scope), value: { state: 'ready' } });
        f.workspace(source, true); f.put(N.stores.assets, { key: N.baselineKey(f.scope), value: { archive } });
        let workspace = await f.n.workspace(f.scope);
        W.initializeWorkspace(workspace, { source, sourceHash: f.scope.sourceHash, game: f.scope.game });
        W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['Local save while session expired'] }, 'Thai',
            { source: source[0], sourceHash: f.scope.sourceHash, game: f.scope.game });
        await f.n.saveWorkspace(f.scope, workspace);
        const rooms = require('../public/normalizedRooms.js').create(f.n), key = rooms.identityKey(f.scope);
        f.put(N.stores.migration, { key: f.n.key('room', key), value: { state: 'ready' } });
        const shared = { filepath: 'a.txt', translations: ['Earlier cloud save'], trackedForExport: true, revision: 3 };
        if (cached !== 'none') await f.n.transaction([N.stores.rooms, N.stores.shared, N.stores.operations, N.stores.roomRecords], 'readwrite', tx => rooms.writeRoom(tx, key,
            { identity: f.scope, archive, mode: 'sparse', roomId: 'room', initialized: true, sequence: 3,
                manifest: { version: 2, files: [{ filepath: 'a.txt', entryCount: 1 }] },
                shared: cached === 'shared' ? { 'a.txt': shared } : {}, outbox: [], conflicts: [], recovery: [], carries: {} }));
        const client = new Client({ store: { getCollaborationRecords: command => rooms.getRecords(command),
            updateCollaborationRecords: (command, update, options) => rooms.updateRecords(command, update, options), captureWorkspaceScope: scope => scope },
            WebSocket: null, presenceEnabled: () => false, request: async () => { throw new Error('Remote work remains deferred'); } });
        t.after(() => client.destroy());
        workspace = await f.n.workspace(f.scope);
        await client.connect({ ...f.scope, source, baselineSource: source, archive, workspace, deferRemote: true,
            files: [{ filepath: 'a.txt', translations: workspace.staged.Thai['a.txt'].translations, trackedForExport: true }] });
        assert.equal(client.room().outbox.length, 1, 'A local-only save needs its own durable join operation even in a cached room');
        const operation = client.room().outbox[0], originalId = operation.id;
        assert.deepEqual(operation.files[0].base.translations, cached === 'shared' ? shared.translations : source[0].translations.Thai);
        await client.acceptSnapshot({ roomId: 'room', sequence: 3, files: cached === 'empty' ? [] : [shared] }, client.epoch, true);
        assert.deepEqual((await f.n.workspace(f.scope)).staged.Thai['a.txt'].translations, ['Local save while session expired']);
        assert.equal(client.room().outbox[0].id, originalId);
        assert.equal(client.room().recovery.length, 1, 'The local copy is retained before joining');
        await client.connect({ ...f.scope, source, baselineSource: source, archive,
            workspace: await f.n.workspace(f.scope), deferRemote: true,
            files: [{ filepath: 'a.txt', translations: ['Local save while session expired'], trackedForExport: true }] });
        assert.equal(client.room().outbox.length, 1, 'Another reconnect reuses the pending operation instead of adding a duplicate');
        assert.equal(client.room().outbox[0].id, originalId);
    });
});

async function cachedSparseFixture(t, { cached = 'empty', pending = false, stageText = 'Later local-only save', sourceCarry } = {}) {
    const P = require('../public/collaborationProtocol.js'), W = require('../public/workspaceState.js');
    const { Client } = require('../public/collaborationSync.js');
    const f = recordFixture(), source = [f.source('a.txt')];
    const archive = await P.finalizeArchive({ version: 2, zipHash: await P.zipHash(new Uint8Array([4, 5, 6])), zipSize: 3,
        fileCount: 1, descriptionCount: 1, parserVersion: 1, decisions: [] });
    f.scope.sourceHash = archive.baselineId;
    f.put(N.stores.migration, { key: N.scopeKey(f.scope), value: { state: 'ready' } });
    f.workspace(source, true); f.put(N.stores.assets, { key: N.baselineKey(f.scope), value: { archive } });
    const carry = sourceCarry && { ...structuredClone(sourceCarry), toSourceHash: f.scope.sourceHash };
    const workspace = await f.n.workspace(f.scope);
    W.initializeWorkspace(workspace, { source, sourceHash: f.scope.sourceHash, game: f.scope.game });
    W.stageTranslation(workspace, { filepath: 'a.txt', translations: [stageText ?? source[0].translations.Thai[0]] }, 'Thai',
        { source: source[0], sourceHash: f.scope.sourceHash, game: f.scope.game, ...(carry ? { sourceCarry: carry } : {}) });
    await f.n.saveWorkspace(f.scope, workspace);
    const rooms = require('../public/normalizedRooms.js').create(f.n), key = rooms.identityKey(f.scope);
    f.put(N.stores.migration, { key: f.n.key('room', key), value: { state: 'ready' } });
    const shared = cached === 'shared' ? P.fileState({ filepath: 'a.txt', translations: ['Earlier cloud save'], trackedForExport: true, revision: 3 }) : null;
    const first = P.fileState({ filepath: 'a.txt', translations: ['Earlier queued save'], trackedForExport: true });
    const base = shared || P.fileState({ filepath: 'a.txt', translations: source[0].translations.Thai });
    await f.n.transaction([N.stores.rooms, N.stores.shared, N.stores.operations, N.stores.roomRecords], 'readwrite', tx => rooms.writeRoom(tx, key,
        { identity: f.scope, archive, mode: 'sparse', roomId: 'room', initialized: true, sequence: shared?.revision || 0,
            manifest: { version: 2, files: [{ filepath: 'a.txt', entryCount: 1 }] }, shared: shared ? { 'a.txt': shared } : {},
            outbox: pending ? [{ id: 'pending-a', origin: 'save', kind: 'edit', status: 'pending', files: [{ base, yours: first }] }] : [],
            conflicts: [], recovery: [], carries: {} }));
    const client = new Client({ store: { getCollaborationRecords: command => rooms.getRecords(command),
        updateCollaborationRecords: (command, update, options) => rooms.updateRecords(command, update, options), captureWorkspaceScope: scope => scope },
        WebSocket: null, presenceEnabled: () => false, request: async () => { throw new Error('Remote work remains deferred'); } });
    t.after(() => client.destroy());
    const connect = async () => {
        const workspace = await f.n.workspace(f.scope);
        const files = Object.entries(workspace.staged.Thai || {}).map(([filepath, stage]) => ({ filepath,
            translations: stage.translations, trackedForExport: true, ...(stage.sourceCarry ? { sourceCarry: stage.sourceCarry } : {}) }));
        return client.connect({ ...f.scope, source, baselineSource: source, archive, workspace, deferRemote: true, files });
    };
    return { f, P, W, source, archive, rooms, key, client, connect, shared, first, carry };
}

test('cached pending saves do not hide a later local-only save and its acknowledgement preserves the newer text', async t => {
    for (const cached of ['empty', 'shared']) await t.test(cached, async t => {
        const h = await cachedSparseFixture(t, { cached, pending: true }), { client, f, connect, first } = h;
        await connect();
        assert.equal(client.room().outbox.length, 2);
        assert.equal(client.room().outbox[0].id, 'pending-a');
        const newerId = client.room().outbox[1].id;
        assert.deepEqual(client.room().outbox[1].files[0].base.translations, first.translations);
        await connect();
        assert.deepEqual(client.room().outbox.map(operation => operation.id), ['pending-a', newerId], 'Rejoin reuses both durable operations.');
        const accepted = { ...first, revision: (h.shared?.revision || 0) + 1 };
        client.request = async (url, options) => {
            assert.ok(url.endsWith('/mutations'));
            if (options.body.mutationId === 'pending-a') return { files: [accepted] };
            throw new Error('Later save remains pending');
        };
        await assert.rejects(client.flush(client.epoch), /Later save remains pending/);
        assert.deepEqual(client.room().outbox.map(operation => operation.id), [newerId]);
        assert.deepEqual(client.room().local['a.txt'].translations, ['Later local-only save']);
        assert.deepEqual((await f.n.workspace(f.scope)).staged.Thai['a.txt'].translations, ['Later local-only save']);
        await client.acceptSnapshot({ roomId: 'room', sequence: accepted.revision, files: [accepted] }, client.epoch, true);
        await connect();
        assert.deepEqual(client.room().outbox.map(operation => operation.id), [newerId]);
        assert.deepEqual((await f.n.workspace(f.scope)).staged.Thai['a.txt'].translations, ['Later local-only save']);
    });
});

test('metadata carry facts survive cached rejoin, operation acknowledgement and accepted snapshots', async t => {
    const metadata = { name: 'Description 0', stats: ['stat_0'], variables: ['#'], remarks: [''] };
    const sourceCarry = { fromSourceHash: 'previous-source', fromSavedAt: 4,
        metadataCorrection: { before: { ...structuredClone(metadata), stats: ['old_stat'] }, after: metadata } };
    const { client, connect, f, carry, source, W } = await cachedSparseFixture(t, { stageText: null, sourceCarry });
    await connect();
    assert.equal(client.room().outbox.length, 1, 'Provenance differs from an unstaged baseline even when translation text matches.');
    assert.deepEqual(client.room().outbox[0].files[0].yours.sourceCarry, carry);
    assert.deepEqual(client.room().local['a.txt'].sourceCarry, carry);
    let accepted;
    client.request = async (url, options) => {
        assert.ok(url.endsWith('/mutations'));
        assert.deepEqual(options.body.files[0].sourceCarry, carry);
        accepted = { ...options.body.files[0], revision: 1 };
        return { files: [accepted] };
    };
    await client.flush(client.epoch);
    assert.equal(client.room().outbox.length, 0);
    assert.deepEqual(client.room().shared['a.txt'].sourceCarry, carry);
    await client.acceptSnapshot({ roomId: 'room', sequence: 1, files: [accepted] }, client.epoch, true);
    await connect();
    const workspace = await f.n.workspace(f.scope);
    assert.equal(client.room().outbox.length, 0, 'Accepted provenance does not create another upload.');
    assert.deepEqual(workspace.staged.Thai['a.txt'].sourceCarry, carry);
    assert.equal(W.workspaceFile(workspace, source[0], 'Thai').isMetadataCorrection, true);
    assert.equal(W.workspaceFile(workspace, source[0], 'Thai').isRevised, false);
});

test('accepted staging reset cannot reconstruct a redundant carry from normalized room caches', async t => {
    const { client, connect, f, source, P, rooms, key } = await cachedSparseFixture(t, { cached: 'shared', stageText: null,
        sourceCarry: { fromSourceHash: 'previous-source', fromSavedAt: 4 } });
    const cleaned = await f.n.workspace(f.scope);
    assert.equal(cleaned.staged.Thai?.['a.txt'], undefined);
    assert.equal(Object.keys(cleaned.sourceCarryRepairArchive).length, 1);
    await connect();
    assert.equal(client.room().outbox.length, 0);
    const reset = P.fileState({ filepath: 'a.txt', translations: source[0].translations.Thai,
        trackedForExport: false, stagingReset: true, revision: 4 });
    await client.acceptSnapshot({ roomId: 'room', sequence: 4, files: [reset] }, client.epoch, true);
    await connect();
    const stored = await rooms.getRecords({ key, scope: f.scope, filepaths: ['a.txt'], includeOutbox: true });
    assert.equal(stored.room.outbox.length, 0);
    assert.equal(stored.room.local['a.txt'].trackedForExport, false);
    assert.equal(stored.room.local['a.txt'].stagingReset, true);
    const reloaded = await f.n.workspace(f.scope);
    assert.equal(reloaded.staged.Thai?.['a.txt'], undefined);
    assert.equal(Object.keys(reloaded.sourceCarryRepairArchive).length, 1);
    await client.acceptSnapshot({ roomId: 'room', sequence: 4, files: [] }, client.epoch, true);
    await connect();
    assert.equal(client.room().outbox.length, 0);
    assert.equal((await f.n.workspace(f.scope)).staged.Thai?.['a.txt'], undefined, 'An omitted sparse reset also remains authoritative.');
});

test('automatic first shared merges cannot revive archived inheritance and queue one durable repair', async t => {
    for (const marked of [false, true]) await t.test(marked ? 'with carry provenance' : 'without carry provenance', async sub => {
    const fromSourceHash = 'a'.repeat(64);
    const { client, connect, f, source, P, rooms, key } = await cachedSparseFixture(sub, { stageText: null,
        sourceCarry: { fromSourceHash, fromSavedAt: 4 } });
    const cleaned = await f.n.workspace(f.scope);
    assert.equal(cleaned.staged.Thai?.['a.txt'], undefined);
    const shared = P.fileState({ filepath: 'a.txt', translations: source[0].translations.Thai, trackedForExport: true, revision: 1,
        ...(marked ? { sourceCarry: { fromSourceHash, toSourceHash: f.scope.sourceHash } } : {}) });
    await f.n.transaction(rooms.roomStores, 'readwrite', tx => rooms.writeRoom(tx, key, { identity: f.scope,
        archive: client.archive || f.data.get(N.stores.assets).values().next().value.value.archive, mode: 'sparse', roomId: 'room',
        sequence: 1, initialized: true, shared: { 'a.txt': shared }, outbox: [], conflicts: [], recovery: [], carries: {} }));
    const previous = structuredClone(source[0]); previous.translations.Thai = ['Earlier original'];
    client.store.getSourceFiles = async (scope, paths) => {
        assert.equal(scope.sourceHash, fromSourceHash); assert.deepEqual(paths, ['a.txt']); return [previous];
    };
    await connect();
    assert.equal(client.room().outbox.length, 1);
    const mutationId = client.room().outbox[0].id;
    assert.deepEqual(client.room().outbox[0].previousBaselines['a.txt'], P.witness(previous));
    await client.acceptSnapshot({ roomId: 'room', sequence: 1, files: [shared] }, client.epoch, true);
    assert.equal((await f.n.workspace(f.scope)).staged.Thai?.['a.txt'], undefined, 'A repeated server snapshot cannot restage the removed carry.');
    await connect();
    assert.deepEqual(client.room().outbox.map(item => item.id), [mutationId], 'Reconnect reuses the durable operation.');
    let accepted;
    client.request = async (url, options) => {
        assert.ok(url.endsWith('/source-carry-repairs')); assert.equal(options.body.mutationId, mutationId);
        assert.deepEqual(options.body.files[0].previousBaseline, P.witness(previous));
        accepted = { ...shared, revision: 3, trackedForExport: false, stagingReset: true };
        return { files: [accepted] };
    };
    await client.flush(client.epoch);
    assert.equal((await f.n.workspace(f.scope)).staged.Thai?.['a.txt'], undefined);
    await client.acceptSnapshot({ roomId: 'room', sequence: 3, files: [{ ...shared, revision: 3, trackedForExport: false, stagingReset: true }] }, client.epoch);
    await connect();
    assert.equal(client.room().outbox.length, 0);
    assert.equal(Object.keys((await f.n.workspace(f.scope)).sourceCarryRepairArchive).length, 1);
    });
});

test('a rejected orphan repair durably restores protected shared work and does not queue again', async t => {
    for (const kind of ['protected-first', 'changed-during-request', 'changed-before-request']) await t.test(kind, async sub => {
        const revision = kind === 'protected-first' ? 1 : 2;
        const h = await cachedSparseFixture(sub, { stageText: null, sourceCarry: { fromSourceHash: 'a'.repeat(64) } });
        const { client, connect, f, source, P, rooms, key } = h;
        await f.n.workspace(f.scope);
        const shared = P.fileState({ filepath: 'a.txt', translations: source[0].translations.Thai, trackedForExport: true, revision: 1 });
        await f.n.transaction(rooms.roomStores, 'readwrite', tx => rooms.writeRoom(tx, key, { identity: f.scope,
            archive: h.archive, mode: 'sparse', roomId: 'room', sequence: 1, initialized: true,
            shared: { 'a.txt': shared }, outbox: [], conflicts: [], recovery: [], carries: {} }));
        client.store.getSourceFiles = async () => { const file = structuredClone(source[0]); file.translations.Thai = ['Old original']; return [file]; };
        await connect(); assert.equal(client.room().outbox.length, 1);
        const protectedFile = { ...shared, revision, translations: revision === 1 ? shared.translations : ['Later explicit text'] };
        let remote;
        client.onRemote = async files => { remote = files; };
        if (kind === 'changed-before-request') await client.acceptSnapshot({ roomId: 'room', sequence: 2, files: [protectedFile] }, client.epoch);
        client.request = async () => { assert.notEqual(kind, 'changed-before-request', 'Known newer work cancels repair without a request'); throw Object.assign(new Error('Protected'), { status: 409, code: 'SOURCE_CARRY_REPAIR_CONFLICT', current: { files: [protectedFile] } }); };
        await client.flush(client.epoch);
        const workspace = await f.n.workspace(f.scope);
        assert.deepEqual(workspace.staged.Thai['a.txt'].translations, protectedFile.translations);
        assert.equal(Object.values(workspace.sourceCarryRepairArchive)[0].protectedRevision, revision);
        assert.equal(remote[0].sourceCarryRepairProtection.revision, revision);
        await connect(); assert.equal(client.room().outbox.length, 0);
        await client.acceptSnapshot({ roomId: 'room', sequence: revision, files: [protectedFile] }, client.epoch, true);
        assert.deepEqual((await f.n.workspace(f.scope)).staged.Thai['a.txt'].translations, protectedFile.translations);
    });
});

test('unchanged shared projection preserves original save time and before text while explicit later saves override archived cleanup', () => {
    const W = require('../public/workspaceState.js'), P = require('../public/collaborationProtocol.js');
    const source = { filepath: 'a.txt', name: '', stats: ['stat'], variables: ['#'], remarks: [''], translations: { English: ['Fire'], Thai: ['Thai'] } };
    const workspace = { sourceHash: 'current', descs: [], staged: {}, status: {} };
    W.initializeWorkspace(workspace, { source: [source], sourceHash: 'current', language: 'Thai' });
    W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['Thai'] }, 'Thai', { source, savedAt: 41, before: ['Old Thai'] });
    const shared = { filepath: 'a.txt', translations: ['Thai'], beforeTranslations: ['Thai'], trackedForExport: true, revision: 1 };
    const projected = P.projectWorkspace(workspace, [shared], 'Thai', [source]);
    assert.equal(projected.staged.Thai['a.txt'].savedAt, 41); assert.deepEqual(projected.staged.Thai['a.txt'].before, ['Old Thai']);
    projected.sourceCarryRepairArchive = { repair: { filepath: 'a.txt', language: 'Thai', sourceHash: 'current', fromSourceHash: 'previous',
        stage: structuredClone(projected.staged.Thai['a.txt']) } };
    projected.staged.Thai['a.txt'].saveOrigin = 'save';
    assert.ok(P.projectWorkspace(projected, [shared], 'Thai', [source]).staged.Thai['a.txt'], 'An explicit unchanged save remains Saved.');
    delete projected.staged.Thai['a.txt'].saveOrigin;
    assert.equal(P.projectWorkspace(projected, [shared], 'Thai', [source]).staged.Thai['a.txt'], undefined);
    assert.ok(P.projectWorkspace(projected, [{ ...shared, revision: 2 }], 'Thai', [source]).staged.Thai['a.txt'], 'A later unmarked shared save remains protected.');
    assert.ok(P.projectWorkspace(projected, [{ ...shared, revision: 2, sourceCarry: { fromSourceHash: 'previous', toSourceHash: 'current' } }],
        'Thai', [source]).staged.Thai['a.txt'], 'Unverified later accepted inheritance remains visible until a server reset.');
    assert.ok(P.projectWorkspace(projected, [{ ...shared, sourceCarry: { metadataCorrection: { before: {}, after: {} } } }], 'Thai', [source]).staged.Thai['a.txt']);
    assert.ok(P.projectWorkspace(projected, [{ ...shared, sourceCarry: { fromSourceHash: 'previous', toSourceHash: 'current',
        destinationSave: { actorId: 'other', acceptedAt: 2, sequence: 1 } } }], 'Thai', [source]).staged.Thai['a.txt'],
        'A server-accepted explicit destination save remains Saved even when another actor authored it.');
});

test('an explicit save during asynchronous predecessor reads cancels the automatic relay and queues the authored save', async t => {
    const h = await cachedSparseFixture(t, { stageText: null, sourceCarry: { fromSourceHash: 'a'.repeat(64), fromSavedAt: 4 } });
    const { client, connect, f, rooms, key, source, P, W, archive } = h;
    await f.n.workspace(f.scope);
    const shared = P.fileState({ filepath: 'a.txt', translations: source[0].translations.Thai, trackedForExport: true, revision: 1 });
    await f.n.transaction(rooms.roomStores, 'readwrite', tx => rooms.writeRoom(tx, key, { identity: f.scope, archive,
        mode: 'sparse', roomId: 'room', sequence: 1, initialized: true, shared: { 'a.txt': shared }, outbox: [], conflicts: [], recovery: [], carries: {} }));
    client.store.getSourceFiles = async () => {
        const current = await f.n.workspace(f.scope);
        W.stageTranslation(current, { filepath: 'a.txt', translations: source[0].translations.Thai }, 'Thai', { saveOrigin: 'save', savedAt: 300 });
        await f.n.saveWorkspace(f.scope, current); return source;
    };
    await connect();
    assert.equal(client.room().outbox.length, 1); assert.equal(client.room().outbox[0].origin, 'save');
    assert.equal(client.room().outbox[0].carryRepair, undefined);
    await client.acceptSnapshot({ roomId: 'room', sequence: 1, files: [shared] }, client.epoch);
    const current = await f.n.workspace(f.scope);
    assert.equal(current.staged.Thai['a.txt'].saveOrigin, 'save'); assert.equal(current.staged.Thai['a.txt'].savedAt, 300);
});

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
test('content groups isolate workspaces, drafts and room identities while sharing immutable ZIP baselines', () => {
    const scope={accountId:'owner',game:'poe2',branchId:'default',sourceHash:'accepted',language:'French'},
        first={...scope,versionId:'version',groupId:'first'},second={...scope,versionId:'version',groupId:'second'};
    assert.deepEqual(JSON.parse(N.scopeKey(scope)),['owner','poe2','default','accepted']);
    assert.equal(new Set([scope,first,second].map(N.scopeKey)).size,3);
    assert.equal(N.baselineKey(scope),N.baselineKey(first));assert.equal(N.baselineKey(first),N.baselineKey(second));
    const n=N.create({normalizeScope:value=>({...value,accountId:value.accountId||'guest',branchId:value.branchId||'default'})});
    const a=n.draftRow({...first,profile:'owner',key:'a'}),b=n.draftRow({...second,profile:'owner',key:'b'});
    assert.notEqual(a.profileLanguage,b.profileLanguage);assert.equal(a.scope,N.scopeKey(first));
    const rooms=require('../public/normalizedRooms.js').create(n),P=require('../public/collaborationProtocol.js');
    for(const value of [scope,first,second,{...first,branchId:'release'}]){
        const id=rooms.identityKey(value);assert.equal(id,P.scopeKey(value));
        const decoded=rooms.identityFromKey(id);assert.equal(decoded.sourceHash,'accepted');assert.equal(decoded.groupId,value.groupId);
    }
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

function recordFixture({ rejectBaselineTransaction = false, legacyGet = async () => undefined, workspaceKey, sourceKey, listVersionScopes, activationNow, activationYield, IDBKeyRange, onPut } = {}) {
    const data = new Map([...N.names, 'kv', 'revisions_poe1', 'revisions_poe2'].map(name => [name, new Map()])), reads = [], writes = [], transactions = [];
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
                if (index === 'by_file_lang_time') return [...rows.values()].filter(item => item.filepath === id.lower[0] && item.lang === id.lower[1]
                    && item.savedAt >= id.lower[2] && item.savedAt <= id.upper[2]);
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
                add(value) { const id = Math.max(0, ...rows.keys()) + 1; rows.set(id, structuredClone(value)); },
                index(index) { return {
                    getAll(id) { reads.push({ name, index, id }); return request(selected(index, id)); },
                    getAllKeys(id) { reads.push({ name, index, id, method: 'getAllKeys' }); return request(selected(index, id).map(item => item.key)); },
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
    const n = N.create({ W, openDb: async () => db, legacyGet, workspaceKey, sourceKey, listVersionScopes, receiptKey: scope => 'receipt:' + N.scopeKey(scope), activationNow, activationYield, IDBKeyRange,
        revisionStoreName: game => 'revisions_' + game, scopedRevision: (revision, scope) => ({ ...revision, ...scope }),
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

function putCarryWorkspace(f, scope, files, stages) {
    const id = N.scopeKey(scope), baseId = N.baselineKey(scope);
    f.put(N.stores.meta, { key: id, scope: id, value: { ...scope, stagedVersion: 1, statusMetadataVersion: 1 } });
    f.put(N.stores.migration, { key: id, value: { state: 'ready' } });
    f.put('kv', { key: 'version_metadata_v1:' + id, value: { ...scope, createdAt: scope.sourceHash === f.scope.sourceHash ? 100 : 1 } });
    for (const [order, file] of files.entries()) {
        f.put(N.stores.baseline, f.n.row(baseId, file.filepath, file, { order }));
        f.put(N.stores.files, f.n.row(id, file.filepath, { filepath: file.filepath, overrides: {} }, { pathKey: f.n.key(id, file.filepath) }));
    }
    for (const [language, entries] of Object.entries(stages)) for (const [filepath, data] of Object.entries(entries))
        f.put(N.stores.records, f.n.row(id, ['staged', language, filepath], { field: 'staged', language, entry: filepath, data },
            { pathKey: f.n.key(id, filepath), kindScope: f.n.key(id, 'staged') }));
}

test('frozen copy evidence repairs provenance lost to first shared replay and protects receipts and later revisions', async t => {
    for (const kind of ['automatic', 'receipt', 'later-shared', 'different-frozen-scope']) await t.test(kind, async () => {
        let frozen;
        const f = recordFixture({ workspaceKey: scope => 'frozen:' + N.scopeKey(scope), legacyGet: async () => structuredClone(frozen) });
        const file = f.source('a.txt'), previous = { ...f.scope, sourceHash: 'previous' }, oldFile = structuredClone(file);
        oldFile.translations.Thai = ['Old original'];
        const inherited = { sourceHash: f.scope.sourceHash, translations: file.translations.Thai, before: ['Old original'], savedAt: 41 };
        frozen = { ...f.scope, ...(kind === 'different-frozen-scope' ? { sourceHash: 'unrelated' } : {}), staged: { Thai: { 'a.txt': inherited } } };
        putCarryWorkspace(f, previous, [oldFile], { Thai: { 'a.txt': { ...inherited, sourceHash: previous.sourceHash } } });
        putCarryWorkspace(f, f.scope, [file], { Thai: { 'a.txt': { ...inherited, before: file.translations.Thai, savedAt: 250 } } });
        const rooms = require('../public/normalizedRooms.js').create(f.n), roomKey = rooms.identityKey(f.scope);
        f.put(N.stores.shared, f.n.row(roomKey, 'a.txt', { filepath: 'a.txt', shared: { filepath: 'a.txt', translations: file.translations.Thai,
            trackedForExport: true, revision: kind === 'later-shared' ? 2 : 1 } }));
        if (kind === 'receipt') f.put(N.stores.receipts, f.n.row(N.scopeKey(f.scope), 'save', { signature: JSON.stringify({
            scope: [f.scope.game, 'Thai', f.scope.sourceHash, f.scope.accountId], files: [{ filepath: 'a.txt', translations: file.translations.Thai }] }) }));
        const copy = structuredClone(frozen), workspace = await f.n.workspace(f.scope);
        assert.equal(!!workspace.staged.Thai?.['a.txt'], kind !== 'automatic');
        assert.deepEqual(frozen, copy, 'Retained evidence is never changed.');
    });
});

test('normalized first-merge recovery and authored timestamps prove inheritance without a frozen current workspace', async t => {
    for (const kind of ['automatic', 'newer-edit', 'wrong-language', 'no-recovery', 'later-shared', 'receipt', 'protected']) await t.test(kind, async () => {
        const f = recordFixture(), file = f.source('a.txt'), previous = { ...f.scope, sourceHash: 'previous' }, old = structuredClone(file);
        old.translations.Thai = ['Old original'];
        const stage = { sourceHash: previous.sourceHash, translations: file.translations.Thai, before: ['Old original'], savedAt: 41 };
        f.put(N.stores.migration, { key: f.n.key('source-carry-repair-v3', N.scopeKey(f.scope)), value: { state: 'ready' } });
        putCarryWorkspace(f, previous, [old], { Thai: { 'a.txt': stage } });
        putCarryWorkspace(f, f.scope, [file], { Thai: { 'a.txt': { ...stage, sourceHash: f.scope.sourceHash, savedAt: 250, before: file.translations.Thai } } });
        const status = { languageStatus: { [kind === 'wrong-language' ? 'German' : 'Thai']: { lastEditedAt: kind === 'newer-edit' ? 140 : 41, lastTranslatedAt: 41 } } };
        f.put(N.stores.records, f.n.row(N.scopeKey(f.scope), ['status', 'a.txt'], { field: 'status', entry: 'a.txt', data: status }, { pathKey: f.n.key(N.scopeKey(f.scope), 'a.txt'), kindScope: f.n.key(N.scopeKey(f.scope), 'status') }));
        const rooms = require('../public/normalizedRooms.js').create(f.n), key = rooms.identityKey(f.scope);
        const shared = { filepath: 'a.txt', translations: file.translations.Thai, trackedForExport: true, revision: kind === 'later-shared' ? 2 : 1 };
        await f.n.transaction(rooms.roomStores, 'readwrite', tx => rooms.writeRoom(tx, key, { identity: f.scope, mode: 'sparse', shared: { 'a.txt': shared },
            outbox: [], conflicts: [], recovery: kind === 'no-recovery' ? [] : [{ id: 'join-copy', at: 200, reason: 'Local edited translation before joining', files: [shared] }], carries: {} }));
        if (kind === 'receipt') f.put(N.stores.receipts, f.n.row(N.scopeKey(f.scope), 'save', { signature: JSON.stringify({ scope: [f.scope.game, 'Thai', f.scope.sourceHash, f.scope.accountId], files: [{ filepath: 'a.txt', translations: file.translations.Thai }] }) }));
        if (kind === 'protected') f.put(N.stores.records, f.n.row(N.scopeKey(f.scope), ['sourceCarryRepairArchive', 'protected'], {
            field: 'sourceCarryRepairArchive', entry: 'protected', data: { filepath: 'a.txt', language: 'Thai', sourceHash: f.scope.sourceHash, fromSourceHash: previous.sourceHash, protectedRevision: 1, stage } },
            { pathKey: f.n.key(N.scopeKey(f.scope), 'a.txt'), kindScope: f.n.key(N.scopeKey(f.scope), 'sourceCarryRepairArchive') }));
        const workspace = await f.n.workspace(f.scope);
        assert.equal(!!workspace.staged.Thai?.['a.txt'], kind !== 'automatic');
    });
});

test('carry cleanup discovers and verifies an unopened legacy predecessor without a server version', async () => {
    const legacy = new Map(), reads = [], workspaceKey = scope => 'frozen:' + N.scopeKey(scope), sourceKey = scope => 'raw:' + N.scopeKey(scope);
    let previous;
    const f = recordFixture({ workspaceKey, sourceKey, legacyGet: async key => { reads.push(key); return structuredClone(legacy.get(key)); },
        listVersionScopes: async () => [{ ...previous, hasSource: true }, { ...previous, accountId: 'foreign', hasSource: true }] });
    previous = { ...f.scope, sourceHash: 'unopened-predecessor' };
    const file = f.source('a.txt'), old = structuredClone(file); old.translations.Thai = ['Old original'];
    const stage = { sourceHash: f.scope.sourceHash, translations: file.translations.Thai, before: ['Old original'], savedAt: 41 };
    legacy.set(workspaceKey(previous), { ...previous, stagedVersion: 1, descs: [old], droppedOutbox: [], staged: { Thai: { 'a.txt': { ...stage, sourceHash: previous.sourceHash } } } });
    legacy.set(sourceKey(previous), [old]);
    legacy.set(workspaceKey(f.scope), { ...f.scope, staged: { Thai: { 'a.txt': stage } } });
    f.put('kv', { key: 'version_metadata_v1:' + N.scopeKey(previous), value: { ...previous, createdAt: 1 } });
    putCarryWorkspace(f, f.scope, [file], { Thai: { 'a.txt': { ...stage, savedAt: 250, before: file.translations.Thai } } });
    const roomKey = require('../public/normalizedRooms.js').create(f.n).identityKey(f.scope);
    f.put(N.stores.shared, f.n.row(roomKey, 'a.txt', { filepath: 'a.txt', shared: { filepath: 'a.txt', translations: file.translations.Thai, trackedForExport: true, revision: 1 } }));
    assert.equal(await f.n.hasScope(previous), false);
    const frozen = structuredClone([...legacy]), workspace = await f.n.workspace(f.scope);
    assert.equal(workspace.staged.Thai?.['a.txt'], undefined);
    assert.equal(await f.n.hasScope(previous), true);
    assert.deepEqual([...legacy], frozen);
    assert.equal(reads.some(key => key?.includes('foreign')), false);
    const readCount = reads.length; await f.n.workspace(f.scope);
    assert.equal(reads.length, readCount, 'A settled cleanup does not hydrate older workspaces again.');
});

test('an unavailable unopened predecessor defers cleanup while the current workspace remains usable', async () => {
    let previous;
    const f = recordFixture({ workspaceKey: scope => 'frozen:' + N.scopeKey(scope), sourceKey: scope => 'raw:' + N.scopeKey(scope),
        listVersionScopes: async () => [{ ...previous, hasSource: true }], legacyGet: async key => key?.startsWith('frozen:')
            ? { ...previous, stagedVersion: 1, descs: [], staged: {}, status: {}, droppedOutbox: [] } : undefined });
    previous = { ...f.scope, sourceHash: 'unavailable' };
    const file = f.source('a.txt'), stage = { sourceHash: f.scope.sourceHash, translations: file.translations.Thai, before: ['Old original'], savedAt: 41 };
    putCarryWorkspace(f, f.scope, [file], { Thai: { 'a.txt': stage } });
    const workspace = await f.n.workspace(f.scope);
    assert.deepEqual(workspace.staged.Thai['a.txt'], stage);
    assert.equal(f.data.get(N.stores.migration).get(f.n.key('source-carry-repair-v4', N.scopeKey(f.scope))).value.state, 'deferred');
    assert.equal(await f.n.hasScope(previous), false);
});

test('scoped carry repair removes proven inherited baseline text in every language while preserving explicit and ambiguous saves', async () => {
    const f = recordFixture(), files = ['known.txt', 'legacy.txt', 'explicit.txt', 'uncertain.txt', 'receipt.txt'].map(path => f.source(path));
    const previous = { ...f.scope, sourceHash: 'predecessor' }, foreign = { ...previous, accountId: 'another-account' };
    const entry = (file, language, sourceHash = f.scope.sourceHash) => ({ sourceHash, translations: structuredClone(file.translations[language]), before: ['authored before'], savedAt: 41 });
    const current = { Thai: {}, German: {} }, old = { Thai: {}, German: {} };
    for (const language of Object.keys(current)) for (const file of files) current[language][file.filepath] = entry(file, language);
    for (const language of Object.keys(current)) {
        current[language]['known.txt'].sourceCarry = { fromSourceHash: previous.sourceHash, toSourceHash: f.scope.sourceHash, fromSavedAt: 41 };
        old[language]['legacy.txt'] = entry(files[1], language, previous.sourceHash);
    }
    current.Thai['receipt.txt'].sourceCarry = { fromSourceHash: previous.sourceHash, toSourceHash: f.scope.sourceHash, fromSavedAt: 41 };
    putCarryWorkspace(f, f.scope, files, current); putCarryWorkspace(f, previous, files, old);
    putCarryWorkspace(f, foreign, files, { Thai: { 'uncertain.txt': entry(files[3], 'Thai', previous.sourceHash) } });
    f.data.get('revisions_poe2').set(1, { ...f.scope, filepath: 'explicit.txt', lang: 'Thai', translations: files[2].translations.Thai, savedAt: 42 });
    f.put(N.stores.receipts, f.n.row(N.scopeKey(f.scope), 'intentional-receipt', { jobId: 'intentional-receipt', signature: JSON.stringify({
        scope: [f.scope.game, 'Thai', f.scope.sourceHash, f.scope.accountId], files: [{ filepath: 'receipt.txt', translations: files[4].translations.Thai }],
    }), result: { retained: true } }));
    const oldRecords = structuredClone([...f.data.get(N.stores.records)].filter(([, item]) => item.scope !== N.scopeKey(f.scope)));
    const result = await f.n.repairCarriedStages(f.scope), workspace = await f.n.workspace(f.scope);
    assert.equal(result.removed.length, 4);
    for (const language of Object.keys(current)) {
        assert.equal(workspace.staged[language]['known.txt'], undefined); assert.equal(workspace.staged[language]['legacy.txt'], undefined);
        assert.deepEqual(workspace.staged[language]['uncertain.txt'], current[language]['uncertain.txt']);
    }
    assert.deepEqual(workspace.staged.Thai['explicit.txt'], current.Thai['explicit.txt']);
    assert.deepEqual(workspace.staged.Thai['receipt.txt'], current.Thai['receipt.txt']);
    assert.deepEqual([...f.data.get(N.stores.records)].filter(([, item]) => item.scope !== N.scopeKey(f.scope)), oldRecords);
    assert.equal(f.data.get(N.stores.receipts).size, 1, 'Durable receipts remain replayable');
    assert.equal(f.data.get('revisions_poe2').size, 1, 'History remains recovery evidence');
    assert.equal(Object.keys(workspace.sourceCarryRepairArchive).length, 4, 'Each removed stage remains recoverable');
    for (const archived of Object.values(workspace.sourceCarryRepairArchive)) {
        assert.deepEqual(archived.stage, current[archived.language][archived.filepath]);
        assert.equal(archived.sourceHash, f.scope.sourceHash);
    }
    const writes = f.writes.length; await f.n.activation(f.scope);
    assert.equal(f.writes.length, writes, 'Settled activation never repeats cleanup writes');
    assert.equal(f.writes.some(write => write.name === 'kv'), false, 'Cleanup never rewrites frozen aggregates or metadata');
});

test('carry repair adds factual metadata correction provenance and preserves Dropped workload and pending operations', async () => {
    const f = recordFixture(), files = ['metadata.txt', 'dropped.txt', 'pending.txt', 'submitted.txt'].map(path => f.source(path));
    const previous = { ...f.scope, sourceHash: 'previous' }, originals = structuredClone(files);
    originals[0].stats = ['previous_stat'];
    const stage = file => ({ sourceHash: f.scope.sourceHash, translations: file.translations.Thai, before: ['previous'], savedAt: 11 });
    const current = Object.fromEntries(files.map(file => [file.filepath, stage(file)]));
    for (const path of ['dropped.txt', 'pending.txt', 'submitted.txt']) current[path].sourceCarry = { fromSourceHash: 'previous', toSourceHash: f.scope.sourceHash };
    putCarryWorkspace(f, f.scope, files, { Thai: current });
    putCarryWorkspace(f, previous, originals, { Thai: { 'metadata.txt': { ...stage(originals[0]), sourceHash: 'previous' } } });
    const id = N.scopeKey(f.scope), path = 'dropped.txt';
    f.put(N.stores.records, f.n.row(id, ['droppedArchive', 'resolved-dropped'], { field: 'droppedArchive', entry: 'resolved-dropped',
        data: { id: 'resolved-dropped', filepath: path, language: 'Thai', game: f.scope.game, status: 'promoted', targetSourceHashes: [f.scope.sourceHash] } },
        { pathKey: f.n.key(id, path), kindScope: f.n.key(id, 'droppedArchive') }));
    const R = require('../public/normalizedRooms.js'), roomKey = R.create(f.n).identityKey(f.scope);
    f.put(N.stores.operations, f.n.row(roomKey, 'pending', { id: 'pending', files: [{ yours: { filepath: 'pending.txt' } }] },
        { paths: [f.n.key(roomKey, 'pending.txt')] }));
    f.put(N.stores.submissions, f.n.row(id, 'submitted', { batch: { files: [{ filepath: 'submitted.txt' }] } },
        { paths: [f.n.key(id, 'Thai', 'submitted.txt')] }));
    await f.n.repairCarriedStages(f.scope);
    let workspace = await f.n.workspace(f.scope);
    assert.deepEqual(workspace.staged.Thai['metadata.txt'].sourceCarry.metadataCorrection.before.stats, ['previous_stat']);
    assert.deepEqual(workspace.staged.Thai['metadata.txt'].sourceCarry.metadataCorrection.after.stats, files[0].stats);
    const state = require('../public/workspaceState.js').workspaceFile(workspace, files[0], 'Thai');
    assert.equal(state.isMetadataCorrection, true); assert.equal(state.isRevised, false);
    assert.ok(workspace.staged.Thai['dropped.txt']); assert.ok(workspace.staged.Thai['pending.txt']); assert.ok(workspace.staged.Thai['submitted.txt']);
    f.data.get(N.stores.operations).clear(); f.data.get(N.stores.submissions).clear();
    await f.n.repairCarriedStages(f.scope); workspace = await f.n.workspace(f.scope);
    assert.equal(workspace.staged.Thai['pending.txt'], undefined); assert.equal(workspace.staged.Thai['submitted.txt'], undefined);
    assert.ok(workspace.staged.Thai['dropped.txt'], 'A resolved Dropped assignment remains meaningful');
});

test('blank carry cleanup revisits a completed v1 checkpoint and archives explicit current-version blanks', async () => {
    const f = recordFixture(), files = ['inherited.txt', 'legacy.txt', 'explicit.txt'].map(path => f.source(path));
    for (const file of files) delete file.translations.Thai;
    const previous = { ...f.scope, sourceHash: 'previous' };
    const stage = sourceHash => ({ sourceHash, translations: [''], before: [''], savedAt: 41 });
    const current = Object.fromEntries(files.map(file => [file.filepath, stage(f.scope.sourceHash)]));
    current['inherited.txt'].sourceCarry = { fromSourceHash: previous.sourceHash, toSourceHash: f.scope.sourceHash };
    putCarryWorkspace(f, f.scope, files, { Thai: current });
    putCarryWorkspace(f, previous, files, { Thai: { 'legacy.txt': stage(previous.sourceHash) } });
    f.put(N.stores.migration, { key: f.n.key('source-carry-repair-v1', N.scopeKey(f.scope)), value: { state: 'ready' } });
    f.data.get('revisions_poe2').set(1, { ...f.scope, filepath: 'explicit.txt', lang: 'Thai', translations: [''], savedAt: 42 });
    const result = await f.n.repairCarriedStages(f.scope), workspace = await f.n.workspace(f.scope);
    assert.equal(result.removed.length, 2);
    assert.equal(workspace.staged.Thai?.['explicit.txt'], undefined);
    assert.equal(Object.keys(workspace.invalidTranslationArchive).length, 1);
    assert.deepEqual(Object.values(workspace.invalidTranslationArchive)[0].stage.translations, ['']);
    assert.equal(Object.keys(workspace.sourceCarryRepairArchive).length, 2);
    const writes = f.writes.length; await f.n.activation(f.scope);
    assert.equal(f.writes.length, writes, 'The new checkpoint settles without repeated writes');
});

test('carry cleanup resumes committed batches after failure without reviving removed records from frozen legacy state', async () => {
    let failure = true;
    const f = recordFixture({ onPut({ name, value }) {
        if (failure && name === N.stores.migration && value.key.startsWith('["source-carry-repair-v4"') && value.value.state === 'ready') throw new Error('Interrupted cleanup');
    } }), files = Array.from({ length: 70 }, (_, index) => f.source('carry-' + String(index).padStart(3, '0') + '.txt'));
    putCarryWorkspace(f, f.scope, files, { Thai: Object.fromEntries(files.map(file => [file.filepath, { sourceHash: f.scope.sourceHash,
        translations: file.translations.Thai, sourceCarry: { fromSourceHash: 'old', toSourceHash: f.scope.sourceHash }, savedAt: 1 }])) });
    await assert.rejects(f.n.repairCarriedStages(f.scope), /Interrupted cleanup/);
    assert.equal([...f.data.get(N.stores.records).values()].filter(item => item.value.field === 'staged').length, 6);
    assert.equal([...f.data.get(N.stores.records).values()].filter(item => item.value.field === 'sourceCarryRepairArchive').length, 64);
    failure = false; await f.n.repairCarriedStages(f.scope);
    const workspace = await f.n.workspace(f.scope);
    assert.equal(Object.keys(workspace.staged).length, 0); assert.equal(Object.keys(workspace.sourceCarryRepairArchive).length, 70);
    const reloaded = N.create({ W: require('../public/workspaceState.js'), openDb: async () => f.db, legacyGet: async () => { throw new Error('Frozen legacy state cannot be read'); },
        revisionStoreName: game => 'revisions_' + game });
    assert.deepEqual((await reloaded.activation(f.scope)).workspace.sourceCarryRepairArchive, workspace.sourceCarryRepairArchive);
    assert.equal(f.writes.filter(write => write.name === N.stores.migration && write.value.value.state === 'converting').length, 1);
});

test('carry repair preserves unreadable current-scope receipts and unrelated content-group predecessor evidence', async () => {
    const f = recordFixture(), file = f.source('uncertain.txt'), scope = { ...f.scope, versionId: 'release', groupId: 'first' },
        other = { ...scope, sourceHash: 'previous', groupId: 'second' };
    const stage = { sourceHash: scope.sourceHash, translations: file.translations.Thai, before: ['old'], savedAt: 2 };
    putCarryWorkspace(f, scope, [file], { Thai: { [file.filepath]: stage } });
    putCarryWorkspace(f, other, [file], { Thai: { [file.filepath]: { ...stage, sourceHash: other.sourceHash } } });
    assert.equal((await f.n.repairCarriedStages(scope)).changed, false);
    const proven = { ...stage, sourceCarry: { fromSourceHash: other.sourceHash, toSourceHash: scope.sourceHash } };
    putCarryWorkspace(f, f.scope, [file], { Thai: { [file.filepath]: proven } });
    f.put(N.stores.receipts, f.n.row(N.scopeKey(f.scope), 'unknown-receipt', { jobId: 'unknown-receipt', signature: '{incomplete' }));
    await f.n.repairCarriedStages(f.scope);
    assert.deepEqual((await f.n.workspace(f.scope)).staged.Thai[file.filepath], proven);
    assert.equal(f.data.get(N.stores.receipts).size, 1);
});

test('unmarked legacy carry cleanup requires a chronological predecessor and prefers verified metadata before source history', async t => {
    for (const variant of ['reverse', 'unknown', 'source-history', 'metadata-first']) await t.test(variant, async () => {
        const f = recordFixture(), file = f.source('legacy.txt'), previous = { ...f.scope, sourceHash: 'sibling' },
            stage = { sourceHash: f.scope.sourceHash, translations: file.translations.Thai, before: ['authored before'], savedAt: 41 };
        putCarryWorkspace(f, f.scope, [file], { Thai: { [file.filepath]: stage } });
        putCarryWorkspace(f, previous, [file], { Thai: { [file.filepath]: { ...stage, sourceHash: previous.sourceHash } } });
        const currentKey = 'version_metadata_v1:' + N.scopeKey(f.scope), previousKey = 'version_metadata_v1:' + N.scopeKey(previous);
        if (variant === 'reverse') {
            f.put('kv', { key: currentKey, value: { ...f.scope, createdAt: 1 } });
            f.put('kv', { key: previousKey, value: { ...previous, createdAt: 100 } });
        } else if (variant === 'unknown' || variant === 'source-history') {
            f.put('kv', { key: currentKey, value: { ...f.scope, createdAt: 999, migrated: true } });
            f.put('kv', { key: previousKey, value: { ...previous, createdAt: 1, migrated: true } });
        }
        if (variant === 'source-history' || variant === 'metadata-first') {
            // Verified normal metadata wins over archive modification-date
            // metadata and over unrelated/incomplete source history timestamps.
            f.data.get('revisions_poe2').set(1, { ...previous, filepath: file.filepath, lang: 'English', note: 'Source import', savedAt: variant === 'metadata-first' ? 200 : 1 });
            f.data.get('revisions_poe2').set(2, { ...f.scope, filepath: file.filepath, lang: 'English', note: 'Source import', savedAt: variant === 'metadata-first' ? 10 : 100 });
        }
        const result = await f.n.repairCarriedStages(f.scope), workspace = await f.n.workspace(f.scope);
        const shouldRemove = variant === 'source-history' || variant === 'metadata-first';
        assert.equal(result.removed.length, Number(shouldRemove));
        if (shouldRemove) assert.equal(workspace.staged.Thai, undefined);
        else assert.deepEqual(workspace.staged.Thai[file.filepath], stage, 'A later sibling or unknown order cannot prove inheritance');
    });
});

test('source import atomically retains existing destination saves and preserves differing incoming carries for review', async () => {
    const f = recordFixture(), file = f.source('destination.txt'), target = { Thai: { [file.filepath]: { sourceHash: f.scope.sourceHash,
        translations: ['newer destination Thai'], before: ['older destination Thai'], savedAt: 90 } }, German: { [file.filepath]: {
        sourceHash: f.scope.sourceHash, translations: ['newer destination German'], before: ['older destination German'], savedAt: 91 } } };
    putCarryWorkspace(f, f.scope, [file], target);
    const incoming = { ...f.scope, stagedVersion: 1, statusMetadataVersion: 1, descs: [file], staged: { Thai: { [file.filepath]: {
        sourceHash: f.scope.sourceHash, translations: ['carried predecessor Thai'], before: ['predecessor baseline'], savedAt: 10,
        sourceCarry: { fromSourceHash: 'predecessor', toSourceHash: f.scope.sourceHash } } } }, status: {} };
    const committed = await f.n.importScope(f.scope, [file], incoming, [], undefined);
    assert.deepEqual(committed.staged, target);
    assert.deepEqual(committed.dropped.Thai[file.filepath].snapshot.translations, ['carried predecessor Thai']);
    assert.equal(committed.dropped.Thai[file.filepath].originSourceHash, 'predecessor');
    assert.deepEqual((await f.n.workspace(f.scope)).staged, target);
    assert.equal([...f.data.get('kv').keys()].some(key => key.startsWith('workspace') || key.startsWith('source_')), false,
        'Imports do not rewrite frozen aggregate workspace data');
    f.data.get(N.stores.migration).set(N.scopeKey(f.scope), { key: N.scopeKey(f.scope), value: { state: 'converting' } });
    const before = structuredClone([...f.data.get(N.stores.records)]);
    await assert.rejects(f.n.importScope(f.scope, [file], incoming, [], undefined), /destination workspace is still being recovered/);
    assert.deepEqual([...f.data.get(N.stores.records)], before, 'An unfinished destination stays recoverable');
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
    const archive = await P.finalizeArchive({ version: 2, zipHash: await P.zipHash(new Uint8Array([1, 2, 3])), zipSize: 3,
        fileCount: files.length, descriptionCount: files.length, parserVersion: 1, decisions: [] });
    f.scope.sourceHash = archive.baselineId;
    f.put(N.stores.migration, { key: N.scopeKey(f.scope), value: { state: 'ready' } });
    f.workspace(files, true);
    f.put(N.stores.assets, { key: N.baselineKey(f.scope), value: { archive } });
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
    await client.connect({ ...f.scope, source: files, baselineSource: files, archive,
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
    await client.connect({ ...f.scope, source: files, baselineSource: files, archive,
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
    f.put(N.stores.migration, { key: f.n.key('invalid-statdescription-stage-v1', N.scopeKey(f.scope)), value: { state: 'ready' } });
    f.put(N.stores.migration, { key: f.n.key('invalid-statdescription-dropped-v1', N.scopeKey(f.scope)), value: { state: 'ready' } });
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

test('cached shared source never makes a different content group workspace ready', async () => {
    const f = recordFixture(), file = f.source('same-original.txt');
    Object.assign(f.scope, { versionId: 'first-version', groupId: 'first-group' });
    const originalScope = { ...f.scope }, originalId = N.scopeKey(originalScope);
    f.put(N.stores.migration, { key: originalId, value: { state: 'ready' } });
    f.workspace([file], true);
    f.put(N.stores.records, f.n.row(originalId, ['staged', 'Thai', file.filepath], {
        language: 'Thai', filepath: file.filepath, data: { translations: ['First group saved text'], sourceHash: f.scope.sourceHash },
    }, { kind: 'staged', pathKey: f.n.key(originalId, file.filepath) }));
    const second = { ...originalScope, versionId: 'second-version', groupId: 'second-group' };
    const secondId = N.scopeKey(second);
    f.put(N.stores.migration, { key: secondId, value: { state: 'ready' } });
    const store = offlineFixture(f);
    store.setWorkspaceContext(originalScope);
    assert.equal(N.baselineKey(second), N.baselineKey(originalScope), 'Both groups reuse the identical immutable source');
    assert.notEqual(secondId, originalId);
    assert.deepEqual(await store.getVersionSource(second), [file]);
    assert.equal(await store.hasVersionWorkspace(originalScope), true);
    assert.equal(await store.hasVersionWorkspace(second), false, 'Readiness requires exact group metadata, even after source hydration');
    assert.equal(await store.getVersionWorkspace(second, 'Thai'), null);
    assert.equal(f.data.get(N.stores.meta).has(secondId), false);
    assert.equal([...f.data.get(N.stores.records).values()].some(row => row.scope === secondId), false,
        'Reading readiness does not clone another group\'s staged translations');
    f.put(N.stores.meta, { key: secondId, scope: secondId, value: { ...second, stagedVersion: 1 } });
    assert.equal(await store.hasVersionWorkspace(second), true);
    await f.n.clearScope(second);
    assert.deepEqual(await store.getVersionSource(second), [file], 'Removing group work retains the shared original');
    assert.equal(await store.hasVersionWorkspace(second), false, 'A removed group is not resurrected by its retained baseline');
    assert.equal(await store.hasVersionWorkspace(originalScope), true);
});

test('group workspace readiness also separates versions and accounts using the same baseline', async () => {
    const f = recordFixture();
    Object.assign(f.scope, { versionId: 'first-version', groupId: 'shared-group-name' });
    f.workspace([f.source('same-original.txt')], true);
    f.put(N.stores.migration, { key: N.scopeKey(f.scope), value: { state: 'ready' } });
    const store = offlineFixture(f);
    for (const changes of [{ versionId: 'second-version' }, { accountId: 'other-account' }]) {
        const scope = { ...f.scope, ...changes };
        f.put(N.stores.migration, { key: N.scopeKey(scope), value: { state: 'ready' } });
        assert.deepEqual(await store.getVersionSource(scope), [f.source('same-original.txt')]);
        assert.equal(await store.hasVersionWorkspace(scope), false);
    }
    assert.equal(await store.hasVersionWorkspace(f.scope), true);
});

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

test('settled normalized scopes archive invalid Dropped copies atomically and never restore them as drafts on reload', async () => {
    const W = require('../public/workspaceState.js'), f = recordFixture(), files = ['blank.txt', 'partial.txt', 'count.txt', 'valid.txt'].map(path => f.source(path));
    f.workspace(files);
    const id = N.scopeKey(f.scope), candidates = files.map((file, index) => ({ id: 'candidate-' + index, filepath: file.filepath,
        language: 'Thai', game: f.scope.game, ownership: index % 2 ? 'online' : 'local', revision: 3,
        originSourceHash: index === 0 ? f.scope.sourceHash : 'unavailable-previous', targetSourceHash: f.scope.sourceHash,
        targetSourceHashes: [f.scope.sourceHash], status: 'dropped', originSourceAvailable: false,
        snapshot: { english: index === 1 || index === 2 ? ['Old one', 'Old two'] : ['Old source'],
            translations: index === 0 ? [''] : index === 1 ? ['Useful old text', ''] : index === 2 ? ['Only one entry'] : ['Valid old text'] } }));
    const put = (field, entry, data, language) => f.put(N.stores.records, f.n.row(id, language ? [field, language, entry] : [field, entry],
        { field, entry, ...(language ? { language } : {}), data }, { pathKey: f.n.key(id, data.filepath || data.candidate?.filepath || entry), kindScope: f.n.key(id, field) }));
    const commands = [];
    for (const candidate of candidates) {
        put('dropped', candidate.filepath, candidate, candidate.language); put('droppedArchive', candidate.id, candidate);
        const command = { id: candidate.id, kind: 'put', revision: candidate.revision, candidate: structuredClone(candidate), preparedRequest: { raw: 'exact old bytes' } };
        commands.push(command); put('droppedOutbox', f.n.key(command.id, command.kind), command);
    }
    put('staged', files[0].filepath, { sourceHash: f.scope.sourceHash, translations: ['Current saved text'], savedAt: 30, saveOrigin: 'save' }, 'Thai');
    const history = { id: 7, filepath: files[0].filepath, lang: 'Thai', translations: ['Earlier authored text'] };
    f.data.get('revisions_poe2').set(history.id, structuredClone(history));
    f.put(N.stores.migration, { key: f.n.key('invalid-statdescription-stage-v1', id), value: { state: 'ready' } });
    const workspace = (await f.n.activation(f.scope)).workspace;
    assert.equal(Object.keys(workspace.invalidTranslationArchive).length, 3);
    for (const candidate of candidates.slice(0, 3)) {
        assert.equal(W.droppedForFile(workspace, candidate.filepath, 'Thai'), null);
        assert.equal(workspace.droppedArchive[candidate.id].status, 'quarantined');
        const archive = Object.values(workspace.invalidTranslationArchive).find(value => value.candidate?.id === candidate.id);
        assert.deepEqual(archive.candidate, candidate, 'The original invalid copy remains exact recovery evidence');
        assert.deepEqual(archive.operations, [commands.find(command => command.id === candidate.id)]);
    }
    assert.deepEqual(W.droppedForFile(workspace, 'valid.txt', 'Thai').snapshot.translations, ['Valid old text']);
    assert.deepEqual(workspace.staged.Thai['blank.txt'].translations, ['Current saved text']);
    assert.deepEqual(f.data.get('revisions_poe2').get(history.id), history);
    assert.deepEqual(workspace.droppedOutbox.map(command => command.id), [candidates[3].id]);
    assert.equal(f.data.get(N.stores.drafts).size, 0, 'Quarantined Dropped evidence must not become an active draft');
    const writes = f.writes.length;
    assert.deepEqual((await f.n.activation(f.scope)).workspace, workspace);
    assert.equal(f.writes.length, writes, 'A settled reload cannot repeat quarantine writes');
});

test('invalid Dropped repair retains all active evidence when the archive transaction fails and succeeds on retry', async () => {
    let fail = true;
    const f = recordFixture({ onPut({ name, value }) {
        if (fail && name === N.stores.records && value.value.field === 'invalidTranslationArchive') throw new Error('Archive quota failure');
    } }), file = f.source('a.txt');
    f.workspace([file]);
    const id = N.scopeKey(f.scope), candidate = { id: 'legacy-invalid', filepath: file.filepath, language: 'Thai', game: f.scope.game,
        status: 'dropped', ownership: 'local', originSourceHash: 'old', targetSourceHashes: [f.scope.sourceHash],
        snapshot: { english: ['Old'], translations: [''] } };
    for (const [field, identity] of [['dropped', ['dropped', 'Thai', file.filepath]], ['droppedArchive', ['droppedArchive', candidate.id]]])
        f.put(N.stores.records, f.n.row(id, identity, { field, entry: field === 'dropped' ? file.filepath : candidate.id,
            ...(field === 'dropped' ? { language: 'Thai' } : {}), data: candidate }, { pathKey: f.n.key(id, file.filepath), kindScope: f.n.key(id, field) }));
    const original = structuredClone([...f.data.get(N.stores.records)]);
    await assert.rejects(f.n.workspace(f.scope), /Archive quota failure/);
    assert.deepEqual([...f.data.get(N.stores.records)], original, 'A failed durable archive cannot remove its source copy');
    fail = false;
    const repaired = await f.n.workspace(f.scope);
    assert.equal(repaired.droppedArchive[candidate.id].status, 'quarantined');
    assert.deepEqual(Object.values(repaired.invalidTranslationArchive)[0].candidate, candidate);
});

test('v19 quarantine archives every invalid stage origin and retains draft, receipt and pending-command evidence', async () => {
    const f = recordFixture(), originals = ['authored.txt', 'imported.txt', 'restore.txt', 'complete.txt'].map(path => f.source(path));
    const id = N.scopeKey(f.scope), invalid = { translations: [' \r\n\t '], sourceHash: f.scope.sourceHash, before: ['earlier'], savedAt: 43 };
    putCarryWorkspace(f, f.scope, originals, { Thai: Object.fromEntries(originals.slice(0, 3).map((file, index) => [file.filepath,
        { ...invalid, saveOrigin: ['save', 'translated_import', 'restore'][index] }])), German: { 'authored.txt': { ...invalid } } });
    const receipt = { jobId: 'accepted-invalid', signature: 'immutable-signature', result: { files: [{ filepath: 'authored.txt', translations: invalid.translations }] } };
    f.put(N.stores.receipts, f.n.row(id, receipt.jobId, receipt));
    const draftKey = 'translation_draft_v1:' + f.n.key('owner', 'poe2', 'accepted', 'Thai', 'authored.txt');
    const priorDraft = { profile: 'owner', game: 'poe2', sourceHash: 'accepted', language: 'Thai', filepath: 'authored.txt', key: draftKey,
        id: 'active-draft', revision: 'draft-v1', state: 'active', translations: ['unsaved editor text'], base: { translations: originals[0].translations.Thai }, updatedAt: 11 };
    f.put('kv', { key: draftKey, value: priorDraft });
    const command = jobId => ({ jobId, workspaceScope: f.scope, game: 'poe2', accountId: 'owner', sourceHash: 'accepted', language: 'Thai',
        files: [{ filepath: 'authored.txt', translations: ['partial', ''] }] });
    for (const jobId of ['pending-invalid', receipt.jobId]) f.put(N.stores.submissions, f.n.row(id, jobId, { batch: command(jobId), state: 'queued', createdAt: 1 }));
    const roomKey = require('../public/normalizedRooms.js').create(f.n).identityKey(f.scope);
    f.put(N.stores.rooms, { key: roomKey, value: { identity: f.scope } });
    f.put(N.stores.operations, f.n.row(roomKey, 'old-invalid-op', { id: 'old-invalid-op', status: 'pending', files: [{ yours: { filepath: 'authored.txt', translations: [''] } }] }));
    const result = await f.n.repairInvalidStages(f.scope), workspace = await f.n.workspace(f.scope);
    assert.equal(result.removed.length, 4); assert.equal(Object.keys(workspace.staged).length, 0);
    assert.equal(Object.keys(workspace.invalidTranslationArchive).length, 5);
    assert.deepEqual(Object.values(workspace.invalidTranslationArchive).find(archive => archive.language === 'German').stage, invalid);
    assert.deepEqual(await f.n.source(f.scope), originals, 'Quarantine cannot rewrite the immutable multilingual baseline.');
    assert.deepEqual(f.data.get(N.stores.receipts).get(f.n.key(id, receipt.jobId)).value, receipt);
    assert.equal(f.data.get(N.stores.submissions).get(f.n.key(id, 'pending-invalid')).value.state, 'review');
    assert.equal(f.data.get(N.stores.submissions).get(f.n.key(id, 'pending-invalid')).value.error.code, 'SD_TRANSLATION_INVALID');
    assert.equal(f.data.get(N.stores.submissions).get(f.n.key(id, receipt.jobId)).value.state, 'queued', 'Accepted receipt evidence is immutable.');
    assert.equal(f.data.get(N.stores.operations).get(f.n.key(roomKey, 'old-invalid-op')).value.status, 'invalid_translation');
    const recovered = await f.n.draftGet(draftKey);
    assert.deepEqual(recovered.translations, priorDraft.translations); assert.deepEqual(f.data.get('kv').get(draftKey).value, priorDraft);
    assert.equal(recovered.conflicts.length, 3, 'The invalid historical stage, upload and pending submission remain recoverable.');
    assert.ok(recovered.submissionJobIds.includes('pending-invalid'));
    const writes = f.writes.length;
    await f.n.repairInvalidStages(f.scope); await f.n.activation(f.scope);
    assert.equal(f.writes.length, writes, 'Reload must not duplicate archives or checkpoint conflicts.');
});

test('v19 quarantine resumes bounded batches after an aborted final transaction without deleting unarchived stages', async () => {
    let fail = true;
    const f = recordFixture({ onPut({ name, value }) {
        if (fail && name === N.stores.migration && value.key.startsWith('["invalid-statdescription-stage-v1"') && value.value.state === 'ready') throw new Error('Quota blocked final quarantine batch');
    } }), files = Array.from({ length: 70 }, (_, index) => f.source('invalid-' + String(index).padStart(3, '0') + '.txt'));
    putCarryWorkspace(f, f.scope, files, { Thai: Object.fromEntries(files.map(file => [file.filepath, { sourceHash: 'accepted', translations: [''], savedAt: 2 }])) });
    await assert.rejects(f.n.repairInvalidStages(f.scope), /Quota blocked/);
    const field = name => [...f.data.get(N.stores.records).values()].filter(row => row.value.field === name);
    assert.equal(field('staged').length, 6); assert.equal(field('invalidTranslationArchive').length, 64);
    fail = false; await f.n.repairInvalidStages(f.scope);
    assert.equal(field('staged').length, 0); assert.equal(field('invalidTranslationArchive').length, 70);
    const drafts = [...f.data.get(N.stores.drafts).values()].map(row => row.value);
    assert.equal(drafts.length, 70); assert.ok(drafts.every(draft => draft.translations[0] === ''));
});

test('late legacy room conversion fences invalid uploads even after the workspace quarantine checkpoint settled', async () => {
    const f = recordFixture(), original = f.source('a.txt'); f.workspace([original]);
    await f.n.repairInvalidStages(f.scope);
    const rooms = require('../public/normalizedRooms.js').create(f.n), roomKey = rooms.identityKey(f.scope);
    const invalid = { id: 'late-invalid', kind: 'edit', origin: 'save', status: 'pending', files: [{
        base: { filepath: 'a.txt', translations: original.translations.Thai, revision: 0 },
        yours: { filepath: 'a.txt', translations: [' \t '], trackedForExport: true, revision: 0 } }] };
    const legacy = { identity: f.scope, mode: 'legacy', manifest: { version: 1, files: [{ filepath: 'a.txt', english: original.translations.English }] },
        shared: {}, local: {}, outbox: [invalid], conflicts: [], recovery: [] };
    await rooms.ensureRoom(roomKey, f.scope, legacy);
    const records = await rooms.getRecords({ key: roomKey, scope: f.scope, filepaths: ['a.txt'] });
    assert.equal(records.room.outbox[0].status, 'invalid_translation');
    assert.equal(records.room.outbox[0].translationError.code, 'SD_TRANSLATION_INVALID');
    assert.deepEqual(records.room.local['a.txt'].translations, original.translations.Thai, 'Invalid upload text cannot overlay the current committed translation.');
    assert.deepEqual(legacy.outbox[0], invalid, 'Frozen legacy input remains unmodified.');
    const recovered = await f.n.workspace(f.scope), archive = Object.values(recovered.invalidTranslationArchive)[0];
    assert.equal(archive.operationId, invalid.id); assert.deepEqual(archive.stage, invalid.files[0].yours);
    assert.deepEqual(archive.source.english, original.translations.English);
    const draftKey = 'translation_draft_v1:' + f.n.key('owner', 'poe2', 'accepted', 'Thai', 'a.txt');
    assert.deepEqual((await f.n.draftGet(draftKey)).translations, invalid.files[0].yours.translations);
    const writes = f.writes.length, reloaded = require('../public/normalizedRooms.js').create(f.n);
    await reloaded.getRecords({ key: roomKey, scope: f.scope, filepaths: ['a.txt'] });
    assert.equal(f.writes.length, writes, 'Disk reload keeps the same recovery artifact and checkpoint.');
});

test('same-source reimport retains history without reopening a promoted or discarded automatic recovery draft', async () => {
    for (const state of ['promoted', 'discarded']) {
        const f = recordFixture(), original = f.source('a.txt');
        putCarryWorkspace(f, f.scope, [original], { Thai: { 'a.txt': { sourceHash: 'accepted', translations: [' \t '], savedAt: 3 } } });
        const recovered = await f.n.workspace(f.scope), archiveId = Object.keys(recovered.invalidTranslationArchive)[0];
        const draftKey = 'translation_draft_v1:' + f.n.key('owner', 'poe2', 'accepted', 'Thai', 'a.txt');
        const active = await f.n.draftGet(draftKey);
        await f.n.draftUpdate(draftKey, current => ({ record: { ...current, state, revision: current.revision + ':' + state,
            translations: [], consumedRevision: current.revision } }));
        const consumed = await f.n.draftGet(draftKey), W = require('../public/workspaceState.js');
        if (state === 'discarded') f.data.get(N.stores.migration).delete(f.n.key('invalid-draft-recovery-v1', N.scopeKey(f.scope), archiveId));
        W.stageTranslation(recovered, { filepath: 'a.txt', translations: ['accepted correction'] }, 'Thai', { source: original });
        await f.n.saveWorkspace(f.scope, recovered);
        const imported = { ...f.scope, descs: [structuredClone(original)], staged: {}, stagedVersion: 1, statusMetadataVersion: 1 };
        await f.n.importScope(f.scope, [original], imported, [], undefined);
        const reloaded = await f.n.workspace(f.scope);
        assert.deepEqual(await f.n.draftGet(draftKey), consumed, 'Automatic history recovery cannot reactivate consumed text.');
        assert.deepEqual(reloaded.staged.Thai['a.txt'].translations, ['accepted correction']);
        assert.deepEqual(Object.keys(reloaded.invalidTranslationArchive), [archiveId]);
        assert.equal(active.id, archiveId, 'A reimport retains the original recovery identity.');
    }
});

test('normalized backup writes quarantine invalid stages despite an existing policy checkpoint and keep ClientText exempt', async () => {
    const f = recordFixture(), original = f.source('a.txt'); f.workspace([original]);
    const current = await f.n.workspace(f.scope); current.invalidTranslationPolicyVersion = 1;
    current.staged.Thai = { 'a.txt': { sourceHash: 'accepted', translations: [''], savedAt: 2, saveOrigin: 'cloud_restore' } };
    await f.n.saveWorkspace(f.scope, current);
    const restored = await f.n.workspace(f.scope);
    assert.equal(restored.staged.Thai?.['a.txt'], undefined); assert.equal(Object.keys(restored.invalidTranslationArchive).length, 1);
    const invalidCommand = { jobId: 'new-invalid', workspaceScope: f.scope, files: [{ filepath: 'a.txt', translations: [''] }], language: 'Thai' };
    await assert.rejects(f.n.putSubmission(invalidCommand), { code: 'SD_TRANSLATION_INVALID' });
    assert.equal(f.data.get(N.stores.submissions).size, 0);
    restored.contentMode = 'clienttext'; restored.staged.Thai = current.staged.Thai = { 'a.txt': { sourceHash: 'accepted', translations: [''], savedAt: 3 } };
    await f.n.saveWorkspace(f.scope, restored); await f.n.putSubmission(invalidCommand);
    assert.equal((await f.n.workspace(f.scope)).staged.Thai['a.txt'].translations[0], '');
    assert.equal(f.data.get(N.stores.submissions).size, 1);
});

test('resolved invalid operations survive disk reconversion without overlaying a later accepted corrected save', async () => {
    const f = recordFixture(), original = f.source('a.txt'); f.workspace([original]);
    const W = require('../public/workspaceState.js'), workspace = await f.n.workspace(f.scope);
    W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['accepted correction'] }, 'Thai', { source: original });
    await f.n.saveWorkspace(f.scope, workspace);
    const rooms = require('../public/normalizedRooms.js').create(f.n), roomKey = rooms.identityKey(f.scope);
    const retained = { id: 'older-invalid', status: 'invalid_translation_resolved', resolvedByMutationId: 'corrected-save',
        files: [{ base: { filepath: 'a.txt', translations: ['old base'], revision: 0 },
            yours: { filepath: 'a.txt', translations: [''], trackedForExport: true, revision: 0 } }] };
    await rooms.ensureRoom(roomKey, f.scope, { identity: f.scope, mode: 'legacy', manifest: { version: 1, files: [{ filepath: 'a.txt', english: original.translations.English }] },
        shared: { 'a.txt': { filepath: 'a.txt', translations: ['accepted correction'], trackedForExport: true, revision: 2 } },
        local: {}, outbox: [retained], conflicts: [], recovery: [] });
    const reloaded = require('../public/normalizedRooms.js').create(f.n);
    f.data.get(N.stores.migration).delete(f.n.key('invalid-statdescription-stage-v1', N.scopeKey(f.scope)));
    await f.n.repairInvalidStages(f.scope);
    const records = await reloaded.getRecords({ key: roomKey, scope: f.scope, filepaths: ['a.txt'] });
    assert.equal(records.room.outbox[0].status, 'invalid_translation_resolved');
    assert.equal(records.room.outbox[0].resolvedByMutationId, 'corrected-save');
    assert.deepEqual(records.room.local['a.txt'].translations, ['accepted correction']);
    assert.deepEqual((await f.n.workspace(f.scope)).staged.Thai['a.txt'].translations, ['accepted correction']);
});

test('frozen legacy preparation reproduces invalid recovery evidence without rewriting originals on retry', async () => {
    const f = recordFixture(), original = f.source('a.txt'), suffix = f.n.key('owner', 'poe2', 'default', 'accepted');
    const legacy = { ...f.scope, stagedVersion: 1, statusMetadataVersion: 1, descs: [original], status: {},
        staged: { Thai: { 'a.txt': { sourceHash: 'accepted', translations: [' \t '], savedAt: 8, saveOrigin: 'save' } } } };
    f.put('kv', { key: 'workspace_version_v1:' + suffix, value: legacy });
    f.put('kv', { key: 'source_version_v1:' + suffix, value: [original] });
    let captured;
    const root = { WorkspaceState: require('../public/workspaceState.js'), NormalizedStore: { ...N, create(dependencies) {
        captured = dependencies; return N.create(dependencies);
    } } };
    const vm = require('node:vm'), context = vm.createContext({ window: root, console: { log() {} }, setTimeout, clearTimeout,
        indexedDB: { open() { const req = {}; queueMicrotask(() => { req.result = f.db; req.onsuccess(); }); return req; } } });
    vm.runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/offlineStore.js'), 'utf8'), context);
    const first = await captured.prepareWorkspace(f.scope, 'Thai'), again = await captured.prepareWorkspace(f.scope, 'Thai');
    assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(again)));
    assert.equal(Object.values(first.invalidTranslationArchive)[0].archivedAt, 1);
    assert.equal(f.writes.length, 0); assert.deepEqual(f.data.get('kv').get('workspace_version_v1:' + suffix).value, legacy);
});

test('normalized receipt replay checks the original signature before draft transfer, room conversion or quarantine writes', async () => {
    const f = recordFixture(), original = f.source('a.txt');
    putCarryWorkspace(f, f.scope, [original], { Thai: { 'a.txt': { sourceHash: 'accepted', translations: [''], savedAt: 3 } } });
    const id = N.scopeKey(f.scope), draftKey = 'translation_draft_v1:' + f.n.key('owner', 'poe2', 'accepted', 'Thai', 'a.txt');
    const command = { jobId: 'old-accepted', accountId: 'owner', game: 'poe2', branchId: 'default', sourceHash: 'accepted', language: 'Thai', workspaceScope: f.scope,
        files: [{ filepath: 'a.txt', translations: [''], needsReview: false, trackedForExport: true, revision: 0 }], descriptions: [original], revisions: [],
        checkpoint: { key: draftKey, id: 'legacy-draft', revision: 'legacy-draft-v1' } };
    const signature = JSON.stringify({ scope: ['poe2', 'Thai', 'accepted', 'owner'], files: command.files, descriptions: command.descriptions,
        statuses: {}, revisions: [], collaboration: null, promoteDropped: null, promoteDroppedByPath: null, checkpoint: command.checkpoint });
    const receipt = { jobId: command.jobId, signature, result: { jobId: command.jobId, status: 'local', files: command.files } };
    f.put(N.stores.receipts, f.n.row(id, command.jobId, receipt));
    f.put('kv', { key: draftKey, value: { profile: 'owner', game: 'poe2', sourceHash: 'accepted', language: 'Thai', filepath: 'a.txt',
        key: draftKey, id: 'legacy-draft', revision: 'legacy-draft-v1', state: 'active', translations: ['unfinished'], base: { translations: original.translations.Thai } } });
    const store = offlineFixture(f), beforeRecords = structuredClone([...f.data.get(N.stores.records)]);
    const replay = await store.saveTranslationBatch(command);
    assert.equal(replay.duplicate, true); assert.deepEqual(Array.from(replay.files[0].translations), original.translations.Thai);
    assert.equal(f.writes.length, 0); assert.equal(f.data.get(N.stores.drafts).size, 0);
    assert.deepEqual([...f.data.get(N.stores.records)], beforeRecords);
    await assert.rejects(store.saveTranslationBatch({ ...command, files: [{ ...command.files[0], translations: ['changed retry'] }] }), /identifier was reused/);
    assert.equal(f.writes.length, 0);
    let roomPrepared = false;
    const handle = await f.n.beginBatch({ ...command, collaboration: { key: 'unconverted-room' } }, f.scope,
        { workspace: 'workspace', source: 'source', receipts: 'receipts' }, { ensureRoom() { roomPrepared = true; throw new Error('Room conversion must wait for new work'); } });
    await new Promise(resolve => { handle.tx.oncomplete = resolve; });
    assert.equal(roomPrepared, false); assert.equal(f.writes.length, 0);
});
