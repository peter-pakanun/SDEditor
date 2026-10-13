// Focused real IndexedDB acceptance fixture on a disposable origin/profile.
// No API server, account login, existing browser profile or workspace is used.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const modules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [modules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const scripts = ['statDescCodec.js', 'workspaceState.js', 'collaborationProtocol.js', 'collaborationSync.js',
    'normalizedStore.js', 'normalizedRooms.js', 'offlineStore.js'];

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
        tx.objectStore(N.stores.meta).put({ key: id, scope: id, value: { ...scope, stagedVersion: 1 } });
        tx.objectStore(N.stores.baseline).put(row(baselineId, original.filepath, original));
        tx.objectStore(N.stores.files).put(row(id, original.filepath, { filepath: original.filepath, overrides: {} },
            { pathKey: JSON.stringify([id, original.filepath]) }));
        tx.objectStore(N.stores.migration).put({ key: id, value: { state: 'ready' } });
        tx.objectStore(N.stores.migration).put({ key: JSON.stringify(['room', key]), value: { state: 'ready' } });
        await ready;
        const workspace = await OfflineStore.getWorkspace(scope);
        W.initializeWorkspace(workspace, { source: [original], sourceHash: scope.sourceHash, game: scope.game, language: scope.language });
        const local = W.dropTranslation(workspace, original, scope.language, { id: 'legacy-local-' + scenario, game: scope.game,
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
        if (!scripts.includes(name)) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', 'application/javascript');
        res.end(readFileSync(join(__dirname, '..', 'public', name)));
    });
    let browser;
    const errors = [];
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = 'http://127.0.0.1:' + server.address().port;
        browser = await chromium.launch({ headless: true, executablePath });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const first = await context.newPage();
        first.on('pageerror', error => errors.push(error.message));
        await first.goto(origin);
        const initial = await first.evaluate(seedAndRecover);
        await first.close();
        const reopened = await context.newPage();
        reopened.on('pageerror', error => errors.push(error.message));
        await reopened.goto(origin);
        const persisted = await reopened.evaluate(readAfterPageReopen, initial.map(({ scenario, scope, key, original }) => ({ scenario, scope, key, original })));
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
        assert.deepEqual(errors, []);
        console.log('PASS: native IndexedDB orphan recovery survives page reopen, retains original recovery/staged text/baseline metadata, blocks different copies and preserves shared-file revision review.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
