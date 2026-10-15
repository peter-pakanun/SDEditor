// Focused real IndexedDB acceptance fixture on a disposable origin/profile.
// No API server, account login, existing browser profile or workspace is used.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync, existsSync, mkdirSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const modules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [modules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const scripts = ['statDescCodec.js', 'workspaceState.js', 'collaborationProtocol.js', 'collaborationSync.js',
    'normalizedStore.js', 'normalizedRooms.js', 'offlineStore.js'];
const servedScripts = [...scripts, 'saveWorker.js', 'regexEngine.js', 'translationDiagnostics.js', 'translationMemory.js'];

async function seedAndRecover() {
    const W = WorkspaceState, P = CollaborationProtocol, N = NormalizedStore;
    const copy = structuredClone;
    const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const completed = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
    await OfflineStore.getSettings();
    const db = await request(indexedDB.open('sdeditor'));
    const results = [];
    for (const scenario of ['equal', 'different', 'newer-shared-file']) {
        const scope = { accountId: 'dropped-fixture-' + scenario, game: 'poe2', branchId: 'default', language: 'German', sourceHash: 'a'.repeat(64) };
        const original = { filepath: 'specific_skill_stat_descriptions/leech_bearer_active/skill_effect_duration.txt', name: 'skill_effect_duration',
            stats: ['skill_effect_duration'], variables: ['# table_only'], remarks: ['milliseconds_to_seconds_2dp_if_required 1'],
            translations: { English: ['Blood Expulsion Duration@{0}s'], German: ['Dauer des Blut-Ausstoßes@{0}s'] } };
        const key = P.scopeKey(scope), id = N.scopeKey(scope), baselineId = N.baselineKey(scope);
        const row = (scopeKey, entry, value, extra = {}) => ({ key: JSON.stringify([scopeKey, entry]), scope: scopeKey, value: copy(value), ...extra });
        const tx = db.transaction([N.stores.meta, N.stores.baseline, N.stores.files, N.stores.migration], 'readwrite'), ready = completed(tx);
        tx.objectStore(N.stores.meta).put({ key: id, scope: id, value: { ...scope, workspaceOrigin: 'online', stagedVersion: 1 } });
        tx.objectStore(N.stores.baseline).put(row(baselineId, original.filepath, original));
        tx.objectStore(N.stores.files).put(row(id, original.filepath, { filepath: original.filepath, overrides: {} },
            { pathKey: JSON.stringify([id, original.filepath]) }));
        tx.objectStore(N.stores.migration).put({ key: id, value: { state: 'ready' } });
        tx.objectStore(N.stores.migration).put({ key: JSON.stringify(['room', key]), value: { state: 'ready' } });
        await ready;
        const workspace = await OfflineStore.getWorkspace(scope);
        W.initializeWorkspace(workspace, { source: [original], sourceHash: scope.sourceHash, game: scope.game, language: scope.language });
        const local = W.dropTranslation(workspace, original, scope.language, { id: 'legacy-local-' + scenario, ownership: 'online', game: scope.game,
            originSourceHash: 'b'.repeat(64), targetSourceHash: scope.sourceHash, reason: 'Older preserved source' });
        const promotion = { id: local.id, revision: Number(local.revision) || 0, targetSourceHash: scope.sourceHash };
        const saved = ['Confirmed local translation@{0}s'];
        W.stageTranslation(workspace, { filepath: original.filepath, translations: saved }, scope.language,
            { source: original, sourceHash: scope.sourceHash, game: scope.game, promoteDropped: promotion });
        await OfflineStore.updateWorkspace(() => workspace, scope, { command: 'fixture-seed-reviewed-save', filepaths: [original.filepath], includeDropped: true });
        const base = P.fileState({ filepath: original.filepath, translations: ['Original accepted translation'], revision: 2 });
        const operation = { id: 'legacy-reviewed-' + scenario, kind: 'edit', origin: 'save', status: 'needs_candidate_review',
            files: [{ base: copy(base), yours: P.fileState({ ...base, translations: saved, trackedForExport: true }) }], promoteDropped: copy(promotion) };
        const sharedFile = P.fileState({ ...base, revision: scenario === 'newer-shared-file' ? 4 : 2 });
        await OfflineStore.updateCollaborationRecords({ key, scope, command: 'fixture-seed-orphan', filepaths: [original.filepath] }, state => {
            state.rooms[key] = { identity: scope, mode: 'sparse', roomId: 'fixture-room', sequence: 1,
                shared: { [original.filepath]: copy(sharedFile) }, local: { [original.filepath]: copy(sharedFile) },
                outbox: [copy(operation)], conflicts: [], recovery: [] };
            return state;
        });
        const canonical = { ...copy(local), id: 'canonical-' + scenario, revision: 7, status: 'dropped', originSourceHash: 'c'.repeat(64) };
        canonical.snapshot.remarks = ['Different archived metadata'];
        if (scenario === 'different') canonical.snapshot.translations = ['A different preserved translation'];
        const loaded = await OfflineStore.getCollaborationRecords({ key, scope, includeOutbox: true, includeDropped: true });
        const client = new CollaborationSync.Client({ store: OfflineStore, request: async () => { throw new Error('Unexpected API request.'); }, WebSocket: null });
        client.key = key; client.state = { version: 1, rooms: { [key]: loaded.room } };
        client.droppedWorkspace = loaded.workspace; client.droppedConflicts = copy(loaded.workspace.droppedConflicts?.German || {});
        const before = client.snapshot().droppedReviewPaths;
        await client.coalesceDroppedCopies([canonical], client.epoch);
        const after = await OfflineStore.getCollaborationRecords({ key, scope, includeOutbox: true, includeDropped: true });
        client.destroy();
        results.push({ scenario, scope, key, original, operation, local, canonical, saved, before,
            afterOperation: after.room.outbox[0], afterWorkspace: after.workspace });
    }
    db.close();
    return results;
}

async function seedDeletedRecoveryCleanup() {
    const N = NormalizedStore, scope = { accountId: 'deleted-recovery-fixture', game: 'poe2', branchId: 'default', sourceHash: '1'.repeat(64) };
    const previousScope = { ...scope, sourceHash: '2'.repeat(64) }, id = N.scopeKey(scope), previousId = N.scopeKey(previousScope), baseId = N.baselineKey(scope);
    const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
    const db = await request(indexedDB.open('sdeditor')), filepath = 'removed.txt', current = 'current.txt';
    const original = { filepath: current, name: 'current', variables: ['#'], stats: ['stat'], remarks: [''], translations: { English: ['Current'], German: ['Original'] } };
    const record = (selected, entry, value, field, path) => ({ key: JSON.stringify([selected, entry]), scope: selected, value,
        kindScope: JSON.stringify([selected, field]), pathKey: JSON.stringify([selected, path]) });
    const tx = db.transaction([N.stores.meta,N.stores.baseline,N.stores.assets,N.stores.records,N.stores.migration,N.stores.receipts,'revisions_poe2'], 'readwrite'), ready = done(tx);
    for (const selected of [scope, previousScope]) {
        const selectedId = N.scopeKey(selected);
        tx.objectStore(N.stores.meta).put({ key: selectedId, scope: selectedId, value: { ...selected, stagedVersion: 1, languageStatusVersion: 1, statusMetadataVersion: 1 } });
        tx.objectStore(N.stores.migration).put({ key: selectedId, value: { state: 'ready' } });
    }
    tx.objectStore(N.stores.baseline).put({ key: JSON.stringify([baseId,current]), scope: baseId, value: original });
    tx.objectStore(N.stores.assets).put({ key: baseId, scope: baseId, value: { archive: { baselineId: scope.sourceHash, descriptionCount: 1 } } });
    for (const [owner,path] of [['local',filepath],['online',filepath],['keep',current]]) {
        const candidate = { id: owner, filepath: path, language: 'German', game: 'poe2', ownership: owner === 'online' ? 'online' : 'local', status: 'dropped',
            targetSourceHash: scope.sourceHash, targetSourceHashes: [scope.sourceHash], snapshot: { english: ['Before'], translations: ['Preserved ' + owner] } };
        tx.objectStore(N.stores.records).put(record(id,['droppedArchive',owner],{field:'droppedArchive',entry:owner,data:candidate},'droppedArchive',path));
    }
    tx.objectStore(N.stores.records).put(record(id,['droppedAliases','old-id'],{field:'droppedAliases',entry:'old-id',data:'local'},'droppedAliases',filepath));
    tx.objectStore(N.stores.records).put(record(previousId,['staged','German',filepath],{field:'staged',language:'German',entry:filepath,
        data:{filepath,sourceHash:previousScope.sourceHash,translations:['Earlier saved translation'],before:['Original'],savedAt:41,saveOrigin:'save'}},'staged',filepath));
    tx.objectStore(N.stores.receipts).put({ key:JSON.stringify([previousId,'save-receipt']),scope:previousId,value:{requestHash:'original-retry-hash'} });
    tx.objectStore('revisions_poe2').add({accountId:scope.accountId,game:'poe2',branchId:'default',sourceHash:previousScope.sourceHash,
        filepath,lang:'German',savedAt:41,translations:['Earlier saved translation'],note:'Before source update'});
    await ready; db.close();
    await OfflineStore.getWorkspace(scope);
    return { scope, previousScope, id, previousId };
}

async function readDeletedRecoveryCleanup(value) {
    const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    await OfflineStore.getWorkspace(value.scope);
    const db = await request(indexedDB.open('sdeditor'));
    try {
        const tx = db.transaction([NormalizedStore.stores.records,NormalizedStore.stores.receipts,'revisions_poe2'],'readonly');
        const [records,receipts,history] = await Promise.all([request(tx.objectStore(NormalizedStore.stores.records).getAll()),
            request(tx.objectStore(NormalizedStore.stores.receipts).getAll()),request(tx.objectStore('revisions_poe2').getAll())]);
        return { current:records.filter(row=>row.scope===value.id),previous:records.filter(row=>row.scope===value.previousId),
            receipts:receipts.filter(row=>row.scope===value.previousId),history:history.filter(row=>row.sourceHash===value.previousScope.sourceHash) };
    } finally { db.close(); }
}

async function readAfterPageReopen(scopes) {
    const results = [];
    for (const { scenario, scope, key, original } of scopes) {
        const records = await OfflineStore.getCollaborationRecords({ key, scope, includeOutbox: true, includeDropped: true });
        const client = new CollaborationSync.Client({ store: OfflineStore, request: async () => { throw new Error('Unexpected API request.'); }, WebSocket: null });
        client.key = key; client.state = { version: 1, rooms: { [key]: records.room } };
        client.droppedWorkspace = records.workspace; client.droppedConflicts = structuredClone(records.workspace.droppedConflicts?.German || {});
        client.sourceFiles = new Map(CollaborationProtocol.manifest([original]).files.map(file => [file.filepath, file]));
        const reviewPaths = client.snapshot().droppedReviewPaths;
        if (scenario === 'newer-shared-file') await client.prepare(records.room.outbox[0].id, client.epoch);
        const after = await OfflineStore.getCollaborationRecords({ key, scope, includeOutbox: true, includeDropped: true });
        results.push({ scenario, reviewPaths, operation: after.room.outbox[0], workspace: after.workspace, conflicts: after.room.conflicts });
        client.destroy();
    }
    return results;
}

async function seedOwnedAndLinked() {
    const W = WorkspaceState, N = NormalizedStore, copy = structuredClone;
    const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const completed = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
    const db = await request(indexedDB.open('sdeditor'));
    const row = (scope, entry, value, extra = {}) => ({ key: JSON.stringify([scope, entry]), scope, value: copy(value), ...extra });
    const worker = new Worker('/saveWorker.js');
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Native save worker did not become ready.')), 10000);
        worker.onmessage = event => { if (event.data.type === 'ready') { clearTimeout(timer); resolve(); } };
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
    });
    const save = batch => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Native save worker did not acknowledge ' + batch.jobId)), 10000);
        worker.onmessage = event => { if (event.data.id === batch.jobId) { clearTimeout(timer); resolve(copy(event.data)); } };
        worker.postMessage({ type: 'saveTranslations', id: batch.jobId, batch });
    });
    const snapshot = async () => {
        const names = [N.stores.meta, N.stores.records, N.stores.receipts, N.stores.rooms, N.stores.roomRecords, 'revisions_poe2'];
        const tx = db.transaction(names, 'readonly');
        return Promise.all(names.map(async name => [name, await request(tx.objectStore(name).getAll())]));
    };
    const cases = [];
    try {
        for (const scenario of ['discard', 'worker-promote', 'worker-rollback']) {
            const scope = { accountId: 'owned-fixture-' + scenario, game: 'poe2', branchId: 'default', language: 'German', sourceHash: 'e'.repeat(64) };
            const managedScope = { ...scope, versionId: 'managed-version', groupId: 'managed-group-' + scenario };
            const original = { filepath: 'owned/source.txt', name: 'Current source', stats: ['stat'], variables: ['#'], remarks: ['current metadata'],
                translations: { English: ['Current English'], German: ['Current original'] } };
            const historical = { ...copy(original), translations: { English: ['Historical English'], German: ['Local preserved translation'] } };
            const localWorkspace = W.initializeWorkspace({ ...scope, workspaceOrigin: 'local', descs: [], status: {} },
                { source: [original], sourceHash: scope.sourceHash, game: scope.game, language: scope.language });
            const local = W.dropTranslation(localWorkspace, historical, scope.language, { id: 'local-' + scenario,
                originSourceHash: 'f'.repeat(64), targetSourceHash: scope.sourceHash });
            W.stageTranslation(localWorkspace, { filepath: original.filepath, translations: ['Existing standalone save'] }, scope.language,
                { source: original, savedAt: 41 });
            const managedWorkspace = W.initializeWorkspace({ ...managedScope, workspaceOrigin: 'online', descs: [], status: {} },
                { source: [original], sourceHash: scope.sourceHash, game: scope.game, language: scope.language });
            const online = { ...copy(local), id: 'dropped_owned_' + scenario, ownership: 'online', groupId: managedScope.groupId,
                versionId: managedScope.versionId, revision: 7, targetSourceHashes: [scope.sourceHash] };
            const scopes = [scope, managedScope];
            const tx = db.transaction([N.stores.meta, N.stores.baseline, N.stores.files, N.stores.migration,
                N.stores.rooms, N.stores.roomRecords, 'revisions_poe2'], 'readwrite'), ready = completed(tx);
            for (const selected of scopes) {
                const id = N.scopeKey(selected);
                tx.objectStore(N.stores.meta).put({ key: id, scope: id, value: { ...selected, stagedVersion: 1,
                    statusMetadataVersion: 1, sourceBaseline: { sourceHash: selected.sourceHash }, workspaceOrigin: selected.groupId ? 'online' : 'local' } });
                tx.objectStore(N.stores.files).put(row(id, original.filepath, { filepath: original.filepath, overrides: {} },
                    { pathKey: JSON.stringify([id, original.filepath]) }));
                tx.objectStore(N.stores.migration).put({ key: id, value: { state: 'ready' } });
            }
            tx.objectStore(N.stores.baseline).put(row(N.baselineKey(scope), original.filepath, original));
            const room = { key: 'preserved-room-' + scenario, value: { roomId: 'stable-room-' + scenario, sequence: 11, identity: managedScope } };
            const event = row(room.key, 'history-event', { eventId: 'preserved-authored-event', kind: 'history',
                actor: { id: scope.accountId, displayName: 'Original translator' }, translations: ['Original authored target'] });
            tx.objectStore(N.stores.rooms).put(room); tx.objectStore(N.stores.roomRecords).put(event);
            tx.objectStore('revisions_poe2').add({ filepath: original.filepath, lang: scope.language, sourceHash: scope.sourceHash,
                accountId: scope.accountId, savedAt: 41, translations: ['Existing standalone save'] });
            await ready;
            await OfflineStore.updateWorkspace(() => localWorkspace, scope, { filepaths: [original.filepath], includeDropped: true });
            const attached = await OfflineStore.getLocalDroppedCandidates(managedScope);
            if (attached.length !== 1 || attached[0].localRecoveryScope?.groupId) throw new Error('The native recovery reader lost its standalone origin.');
            W.attachLocalDroppedCandidates(managedWorkspace, attached);
            W.acceptDropped(managedWorkspace, [online]);
            await OfflineStore.updateWorkspace(() => managedWorkspace, managedScope, { filepaths: [original.filepath], includeDropped: true });
            await OfflineStore.setVersionMetadata(managedScope, { workspaceOrigin: 'online', catalogVersionId: managedScope.versionId });
            const expected = { id: local.id, ownership: 'local', revision: 0, targetSourceHash: scope.sourceHash };
            const batch = { ...managedScope, workspaceScope: copy(managedScope), jobId: 'owned-save-' + scenario,
                files: [{ filepath: original.filepath, translations: ['Reviewed local recovery'], trackedForExport: true }], descriptions: [original],
                promoteDropped: expected, revisions: [{ filepath: original.filepath, lang: scope.language, savedAt: 81,
                    translations: ['Reviewed local recovery'], sourceHash: scope.sourceHash }] };
            let response, replay, before, after;
            if (scenario === 'discard') {
                await OfflineStore.updateWorkspace(current => { W.discardDropped(current, original.filepath, scope.language, expected); return current; },
                    managedScope, { filepaths: [original.filepath], includeDropped: true });
            } else {
                if (scenario === 'worker-rollback') {
                    await OfflineStore.updateWorkspace(current => { W.dropTranslation(current, historical, scope.language, { id: local.id,
                        originSourceHash: 'f'.repeat(64), targetSourceHash: scope.sourceHash, translations: ['Changed standalone snapshot'] }); return current; },
                    scope, { filepaths: [original.filepath], includeDropped: true });
                    before = await snapshot();
                }
                response = await save(batch);
                if (scenario === 'worker-promote') replay = await save(batch);
                else after = await snapshot();
            }
            cases.push({ scenario, scope, managedScope, original, local, online, room, event, response, replay, before, after,
                standalone: await OfflineStore.getWorkspace(scope), managed: await OfflineStore.getWorkspace(managedScope) });
        }
    } finally { worker.terminate(); db.close(); }
    return cases;
}

async function readOwnedAfterPageReopen(cases) {
    const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const db = await request(indexedDB.open('sdeditor')), results = [];
    try {
        for (const value of cases) {
            const { scenario, scope, managedScope, room, event } = value;
            const tx = db.transaction([NormalizedStore.stores.rooms, NormalizedStore.stores.roomRecords, 'revisions_poe2'], 'readonly');
            const [retainedRoom, retainedEvent, revisions] = await Promise.all([
                request(tx.objectStore(NormalizedStore.stores.rooms).get(room.key)), request(tx.objectStore(NormalizedStore.stores.roomRecords).get(event.key)),
                request(tx.objectStore('revisions_poe2').getAll()),
            ]);
            const activated = await OfflineStore.activateVersion(managedScope);
            results.push({ scenario, standalone: await OfflineStore.getWorkspace(scope), managed: await OfflineStore.getWorkspace(managedScope),
                metadata: await OfflineStore.getVersionMetadata(managedScope), retainedRoom, retainedEvent,
                activatedScope: activated.scope, activatedOrigin: activated.workspace.workspaceOrigin,
                revisions: revisions.filter(revision => revision.accountId === scope.accountId || revision.collaborationAccountId === scope.accountId) });
        }
    } finally { db.close(); }
    return results;
}

(async () => {
    if (!executablePath) throw new Error('No installed Edge/Chrome found. Set FIXTURE_BROWSER_PATH.');
    const server = createServer((req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html>' + scripts.map(name => '<script src="/' + name + '"></script>').join(''));
            return;
        }
        const name = req.url.slice(1);
        if (!servedScripts.includes(name)) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', 'application/javascript');
        res.end(readFileSync(join(__dirname, '..', 'public', name)));
    });
    let browser;
    const errors = [];
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = 'http://127.0.0.1:' + server.address().port;
        const scratch = join(__dirname, '..', 'temp'); mkdirSync(scratch, { recursive: true });
        const profile = mkdtempSync(join(scratch, 'dropped-owned-browser-'));
        browser = await chromium.launchPersistentContext(profile, { headless: true, executablePath, viewport: { width: 1440, height: 1000 } });
        const context = browser;
        const first = await context.newPage();
        first.on('pageerror', error => errors.push(error.message));
        await first.goto(origin);
        const initial = await first.evaluate(seedAndRecover);
        const owned = await first.evaluate(seedOwnedAndLinked);
        const deleted = await first.evaluate(seedDeletedRecoveryCleanup);
        await first.close();
        const reopened = await context.newPage();
        reopened.on('pageerror', error => errors.push(error.message));
        await reopened.goto(origin);
        const persisted = await reopened.evaluate(readAfterPageReopen, initial.map(({ scenario, scope, key, original }) => ({ scenario, scope, key, original })));
        const persistedOwned = await reopened.evaluate(readOwnedAfterPageReopen, owned);
        const persistedDeleted = await reopened.evaluate(readDeletedRecoveryCleanup, deleted);
        assert.deepEqual(persistedDeleted.current.map(row => row.value.data.id), ['keep'], 'Native IndexedDB contains no deleted-path recovery copies after reopening.');
        assert.deepEqual(persistedDeleted.previous[0].value.data.translations, ['Earlier saved translation']);
        assert.equal(persistedDeleted.receipts[0].value.requestHash, 'original-retry-hash');
        assert.deepEqual(persistedDeleted.history[0].translations, ['Earlier saved translation']);
        for (const result of initial) {
            const restored = persisted.find(item => item.scenario === result.scenario), path = result.original.filepath;
            assert.deepEqual(result.before, [path]);
            assert.equal(result.afterOperation.status, result.scenario === 'different' ? 'needs_candidate_review' : 'pending');
            assert.deepEqual(restored.operation.files[0].base, result.operation.files[0].base);
            assert.deepEqual(restored.workspace.staged.German[path].translations, result.saved);
            assert.deepEqual(restored.workspace.descs[0].remarks, result.original.remarks);
            assert.deepEqual(restored.workspace.droppedArchive[result.local.id].snapshot, result.local.snapshot);
            assert.equal(restored.workspace.droppedConflicts.German?.[path], undefined);
            if (result.scenario === 'different') {
                assert.equal(restored.operation.status, 'needs_candidate_review');
                assert.deepEqual(restored.operation.promoteDropped, result.operation.promoteDropped);
                assert.deepEqual(restored.reviewPaths, [path]);
            } else {
                assert.deepEqual(restored.operation.promoteDropped, { id: result.canonical.id, revision: result.canonical.revision, targetSourceHash: result.scope.sourceHash });
                assert.deepEqual(restored.reviewPaths, []);
                assert.equal(restored.operation.status, result.scenario === 'newer-shared-file' ? 'conflict' : 'pending');
                if (result.scenario === 'newer-shared-file') {
                    assert.equal(restored.operation.wire, undefined);
                    assert.equal(restored.conflicts[0].shared.revision, 4);
                    assert.equal(restored.conflicts[0].base.revision, 2);
                }
            }
        }
        for (const result of owned) {
            const restored = persistedOwned.find(value => value.scenario === result.scenario), path = result.original.filepath;
            assert.equal(restored.managed.workspaceOrigin, 'online');
            assert.equal(restored.metadata.workspaceOrigin, 'online');
            assert.equal(restored.activatedOrigin, 'online');
            assert.equal(restored.activatedScope.groupId, result.managedScope.groupId);
            assert.equal(restored.activatedScope.versionId, result.managedScope.versionId);
            assert.deepEqual(restored.managed.droppedArchive[result.online.id], result.managed.droppedArchive[result.online.id]);
            assert.equal(restored.managed.droppedArchive[result.online.id].status, 'dropped');
            assert.deepEqual(restored.standalone.staged.German[path].translations, ['Existing standalone save']);
            assert.deepEqual(restored.retainedRoom, result.room);
            assert.deepEqual(restored.retainedEvent, result.event);
            assert.deepEqual(restored.revisions.find(revision => revision.savedAt === 41).translations, ['Existing standalone save']);
            if (result.scenario === 'worker-rollback') {
                assert.equal(result.response.type, 'error');
                assert.equal(result.response.error.code, 'DROPPED_PROMOTION_CHANGED');
                assert.deepEqual(result.after, result.before, 'A stale linked candidate rolls back staged text, history, receipts and both recovery records.');
                assert.equal(restored.standalone.droppedArchive[result.local.id].status, 'dropped');
                assert.equal(restored.managed.droppedArchive[result.local.id].status, 'dropped');
                assert.equal(restored.managed.staged.German?.[path], undefined);
            } else {
                const disposition = result.scenario === 'discard' ? 'discarded' : 'promoted';
                assert.equal(restored.standalone.droppedArchive[result.local.id].status, disposition);
                assert.equal(restored.managed.droppedArchive[result.local.id].status, disposition);
                if (result.scenario === 'worker-promote') {
                    assert.equal(result.response.type, 'saved');
                    assert.equal(result.replay.type, 'saved');
                    assert.equal(result.replay.result.duplicate, true);
                    assert.deepEqual(restored.managed.staged.German[path].translations, ['Reviewed local recovery']);
                    assert.equal(restored.revisions.filter(revision => revision.savedAt === 81).length, 1, 'Worker retry reuses its durable receipt.');
                }
            }
        }
        assert.deepEqual(errors, []);
        console.log('PASS: deleted-path recovery records are physically absent after page reopen; predecessor Saved text, history and receipts remain.');
        console.log('PASS: native IndexedDB orphan recovery survives page reopen, retains original recovery/staged text/baseline metadata, blocks different copies and preserves shared-file revision review.');
        console.log('PASS: native IndexedDB linked local/managed discard and worker promotion survive page reopen, preserve shared candidates/history, replay one durable save receipt, and atomically roll back stale linked recovery.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
