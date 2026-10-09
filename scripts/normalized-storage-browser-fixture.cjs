// Disposable real IndexedDB / authenticated API acceptance fixture for v9.
// No production account, browser profile or storage is used.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, join, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');

const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);

function browserProbe() {
    const probe = window.__normalizedProbe = { operations: [], workerOperations: [], events: [], held: [], mode: 'normal' };
    const bytes = value => { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch (_) { return 0; } };
    for (const name of ['get', 'getAll', 'put', 'add', 'delete', 'openCursor', 'openKeyCursor', 'count']) {
        const original = IDBObjectStore.prototype[name];
        IDBObjectStore.prototype[name] = function (...args) {
            const entry = { store: this.name, method: name, key: name === 'put' || name === 'add' ? args[0]?.key : args[0],
                mode: this.transaction.mode, bytes: name === 'put' || name === 'add' ? bytes(args[0]) : 0 };
            probe.operations.push(entry);
            if (probe.fail && this.name !== 'kv' && ['put', 'add'].includes(name) && --probe.fail.after <= 0) {
                probe.fail = null;
                throw new DOMException('Fixture quota failure', 'QuotaExceededError');
            }
            const request = original.apply(this, args);
            if (name === 'get' || name === 'getAll') request.addEventListener('success', () => { entry.bytes = bytes(request.result); });
            return request;
        };
    }
    for (const method of ['get', 'getAll', 'openCursor', 'openKeyCursor', 'count']) {
        const original = IDBIndex.prototype[method];
        IDBIndex.prototype[method] = function (...args) {
            const entry = { store: this.objectStore.name, index: this.name, method, key: args[0], mode: this.objectStore.transaction.mode, bytes: 0 };
            probe.operations.push(entry);
            const request = original.apply(this, args);
            if (method === 'get' || method === 'getAll') request.addEventListener('success', () => { entry.bytes = bytes(request.result); });
            return request;
        };
    }
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
        constructor(...args) {
            super(...args);
            this.addEventListener('message', event => {
                if (event.data?.type === 'saved') probe.events.push({ name: 'saved', at: performance.now() });
                if (event.data?.type === 'storageProbe') probe.workerOperations.push(...event.data.operations);
            });
        }
        postMessage(message, options) {
            if (message?.type === 'saveTranslations') {
                probe.events.push({ name: 'dispatch', at: performance.now(), id: message.id });
                if (probe.mode === 'hold') { probe.held.push({ worker: this, message, options }); return; }
                probe.events.push({ name: 'worker.start', at: performance.now(), id: message.id });
            }
            return super.postMessage(message, options);
        }
    };
    probe.release = () => {
        probe.mode = 'normal';
        for (const item of probe.held.splice(0)) {
            probe.events.push({ name: 'worker.start', at: performance.now(), id: item.message.id });
            NativeWorker.prototype.postMessage.call(item.worker, item.message, item.options);
        }
    };
}

function workerStorageProbe() {
    const operations = [], bytes = value => { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch (_) { return 0; } };
    for (const method of ['get', 'getAll', 'put', 'add', 'delete', 'openCursor', 'openKeyCursor', 'count']) {
        const original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function (...args) {
            const entry = { store: this.name, method, key: ['put', 'add'].includes(method) ? args[0]?.key : args[0],
                mode: this.transaction.mode, bytes: ['put', 'add'].includes(method) ? bytes(args[0]) : 0 };
            operations.push(entry);
            const request = original.apply(this, args);
            if (method === 'get' || method === 'getAll') request.addEventListener('success', () => { entry.bytes = bytes(request.result); });
            return request;
        };
    }
    for (const method of ['get', 'getAll', 'openCursor', 'openKeyCursor', 'count']) {
        const original = IDBIndex.prototype[method];
        IDBIndex.prototype[method] = function (...args) {
            const entry = { store: this.objectStore.name, index: this.name, method, key: args[0], mode: this.objectStore.transaction.mode, bytes: 0 };
            operations.push(entry);
            const request = original.apply(this, args);
            if (method === 'get' || method === 'getAll') request.addEventListener('success', () => { entry.bytes = bytes(request.result); });
            return request;
        };
    }
    const send = self.postMessage.bind(self);
    self.postMessage = message => {
        if (message?.type === 'saved' || message?.type === 'error') send({ type: 'storageProbe', id: message.id, operations: operations.splice(0) });
        send(message);
    };
}

function aggregateOperations(operations) {
    return operations.filter(op => op.store === 'kv' && typeof op.key === 'string'
        && /^(workspace_version_v1:|source_version_v1:|workspace_poe|source_poe|collaboration_v1$|translation_save_receipts)/.test(op.key));
}

function assertNoAssetReads(operations, scenario) {
    assert.equal(operations.some(operation => operation.store === 'baseline_assets'
        && ['get', 'getAll', 'openCursor', 'openKeyCursor'].includes(operation.method)), false,
    scenario + ': hot commands never read archive assets');
}

function assertSelectedBaselineReads(operations, filepaths, scenario) {
    const allowed = new Set(filepaths);
    for (const operation of operations.filter(operation => operation.store === 'baseline_files')) {
        assert.equal(operation.method, 'get', scenario + ': no complete baseline enumeration');
        assert.ok(allowed.has(JSON.parse(operation.key)[1]), scenario + ': no unrelated baseline file read');
    }
}

async function runFixture({ storageOnly = false } = {}) {
    if (!executablePath) throw new Error('No installed Edge/Chrome found. Set FIXTURE_BROWSER_PATH.');
    const legacyFileCount = Number(process.env.NORMALIZED_LEGACY_FILE_COUNT || 700);
    assert.ok(Number.isInteger(legacyFileCount) && legacyFileCount >= 25, 'Legacy fixture needs at least 25 files');
    const apiRoot = process.env.SDEDITOR_FIXTURE_API_ROOT ? resolve(process.env.SDEDITOR_FIXTURE_API_ROOT) : resolve(__dirname, '../../SDEditor-API');
    const fromApi = createRequire(join(apiRoot, 'package.json'));
    const load = name => import(pathToFileURL(join(apiRoot, 'src', name)).href);
    const [{ loadConfig }, { openDatabase, CloudStore }, { createApp }] = await Promise.all([load('config.js'), load('database.js'), load('app.js')]);
    const directory = mkdtempSync(join(tmpdir(), 'sdeditor-normalized-browser-'));
    const publicDir = resolve(__dirname, '../public'), express = fromApi('express'), frontend = express(), frontendServer = createServer(frontend);
    await new Promise(resolve => frontendServer.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + frontendServer.address().port, secret = randomUUID();
    const config = loadConfig({ ADMIN_GOOGLE_SUB: 'normalized-admin', FRONTEND_ORIGIN: origin,
        API_PUBLIC_URL: 'http://127.0.0.1:1', DATA_DIR: directory, DATABASE_PATH: ':memory:' });
    const database = openDatabase(':memory:'), cloudStore = new CloudStore(database, config);
    cloudStore.registerIdentity({ sub: 'normalized-admin', email: 'admin@normalized.fixture', name: 'Fixture Admin' });
    cloudStore.registerIdentity({ sub: 'normalized-translator', email: 'translator@normalized.fixture', name: 'Fixture Translator' });
    cloudStore.assignLanguage('normalized-admin', 'normalized-translator', 'Thai');
    const api = createApp({ config, database, store: cloudStore, oauthProvider: null }), apiServer = createServer(api);
    api.locals.collaborationRealtime.attach(apiServer);
    await new Promise(resolve => apiServer.listen(0, '127.0.0.1', resolve));
    const apiOrigin = 'http://127.0.0.1:' + apiServer.address().port;
    frontend.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    frontend.post('/fixture/session', (req, res) => req.get('X-Fixture-Key') === secret
        ? res.json(cloudStore.createSession('normalized-translator')) : res.sendStatus(403));
    frontend.get('/fixture/storage', (req, res) => res.type('html').send('<!doctype html><script>(' + browserProbe.toString()
        + ')();</script><script src="/workspaceState.js"></script><script src="/statDescCodec.js"></script><script src="/collaborationProtocol.js"></script><script src="/normalizedStore.js"></script><script src="/normalizedRooms.js"></script><script src="/offlineStore.js"></script><script src="/fixture/jszip.min.js"></script>'));
    frontend.get('/', (req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
        .replace('<head>', '<head><script>(' + browserProbe.toString() + ')();</script>')
        .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
    frontend.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
    frontend.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(publicDir, 'index.js'), 'utf8')
        .replace("app.mount('#app');", "window.__normalizedApp = app.mount('#app');")));
    frontend.get('/saveWorker.js', (req, res) => res.type('js').send('(' + workerStorageProbe.toString() + ')();\n'
        + readFileSync(join(publicDir, 'saveWorker.js'), 'utf8')));
    frontend.use(express.static(publicDir));
    let browser, activePage;
    const errors = [], results = [];
    try {
        browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
        const page = await context.newPage();
        activePage = page;
        page.on('pageerror', error => { errors.push(error.message); console.error('Fixture browser error: ' + error.stack); });
        await page.goto(origin + '/fixture/storage');
        await page.waitForFunction(() => !!window.OfflineStore && !!window.NormalizedStore);
        const migration = await page.evaluate(async ({ legacyFileCount }) => {
            const copy = value => JSON.parse(JSON.stringify(value));
            const migrationEvents = [], unsubscribeMigration = OfflineStore.onMigration(event => migrationEvents.push(copy(event)));
            const migrationTimings = {};
            const scope = { accountId: 'fixture-owner', game: 'poe1', branchId: 'release', sourceHash: 'fixture-v8' };
            const suffix = JSON.stringify([scope.accountId, scope.game, scope.branchId, scope.sourceHash]);
            const source = Array.from({ length: legacyFileCount }, (_, i) => ({ filepath: 'storage/' + i + '.txt', filename: i + '.txt', filedir: 'storage',
                stats: ['stat_' + i], variables: ['#'], remarks: [''], translations: { English: ['English ' + i], Thai: ['Thai ' + i], German: ['German ' + i] } }));
            const workspace = { ...scope, descs: copy(source), status: {} };
            WorkspaceState.initializeWorkspace(workspace, { source, sourceHash: scope.sourceHash, game: scope.game, language: 'Thai' });
            WorkspaceState.stageTranslation(workspace, { filepath: source[0].filepath, translations: ['Saved Thai'] }, 'Thai', { source: source[0] });
            WorkspaceState.stageTranslation(workspace, { filepath: source[6].filepath, translations: ['Saved six'] }, 'Thai', { source: source[6] });
            WorkspaceState.stageTranslation(workspace, { filepath: source[10].filepath, translations: ['Saved ten'] }, 'Thai', { source: source[10] });
            WorkspaceState.stageTranslation(workspace, { filepath: source[0].filepath, translations: [''] }, 'German', { source: source[0] });
            WorkspaceState.dropTranslation(workspace, source[1], 'Thai', { id: 'retained-recovery', recoveryId: 'explicit-generation',
                originSourceHash: 'predecessor', targetSourceHash: scope.sourceHash, translations: ['Dropped Thai'] });
            const request = indexedDB.open('sdeditor', 8);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('kv', { keyPath: 'key' });
                for (const name of ['revisions', 'revisions_poe1', 'revisions_poe2']) {
                    const store = request.result.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('by_file_lang_time', ['filepath', 'lang', 'savedAt']);
                    store.createIndex('by_file_time', ['filepath', 'savedAt']);
                }
            };
            const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
            const values = { ['workspace_version_v1:' + suffix]: workspace, ['source_version_v1:' + suffix]: source,
                ['workspace_active_v1:' + JSON.stringify([scope.accountId, scope.game, scope.branchId])]: scope,
                ['version_metadata_v1:' + suffix]: { ...scope, name: 'Retained v8 source' },
                ['translation_save_receipts_v2:' + suffix]: [{ jobId: 'original-id', signature: 'original-signature', files: [] }],
                collaboration_v1: { version: 1, rooms: {} }, settings: { lang: 'Thai', dictionary: [{ find: 'untouched', replace: 'unchanged' }] } };
            const orphanScope = { profile: scope.accountId, game: scope.game, branchId: scope.branchId, sourceHash: 'absent-older-source',
                language: 'Thai', filepath: 'removed/old.txt' };
            const orphanKey = OfflineStore.translationDraftKey(orphanScope);
            values[orphanKey] = { ...orphanScope, key: orphanKey, id: 'old-checkpoint-id', revision: 'old-checkpoint-revision',
                state: 'active', translations: ['Unfinished older text'], base: { translations: ['Older committed text'] }, updatedAt: 1,
                source: { ...copy(source[0]), filepath: orphanScope.filepath, translations: { English: ['Older English'], Thai: ['Older ZIP translation'] } },
                recovery: [{ id: 'retained-variant', translations: ['Variant text'], revision: 'variant-revision' }] };
            const missingScope = { ...scope, game: 'poe2', sourceHash: 'missing-source-evidence' };
            values['workspace_version_v1:' + JSON.stringify([missingScope.accountId, missingScope.game, missingScope.branchId, missingScope.sourceHash])] =
                { ...missingScope, descs: [copy(source[0])], stagedVersion: 1, staged: { Thai: { [source[0].filepath]: { translations: ['Retain despite missing source'] } } }, status: {} };
            const roomIdentity = { ...scope, language: 'Thai' }, roomKey = JSON.stringify([scope.accountId, scope.game, scope.branchId, scope.sourceHash, 'Thai']);
            const sharedFile = { filepath: source[0].filepath, translations: ['Remote accepted zero'], revision: 2, trackedForExport: true, needsReview: false };
            values.collaboration_v1.rooms[roomKey] = { identity: roomIdentity, roomId: 'retained-room', mode: 'legacy', seq: 8,
                manifest: CollaborationProtocol.manifest(source), shared: { [source[0].filepath]: sharedFile },
                seedUpload: { id: 'retained-seed-upload', expiresAt: 4102444800000,
                    files: CollaborationProtocol.manifest(source).files.map(file => ({ ...file, translations: copy(source.find(desc => desc.filepath === file.filepath).translations.Thai), trackedForExport: false })) },
                local: { [source[0].filepath]: { ...sharedFile, translations: ['Saved Thai'] } },
                outbox: [{ id: 'lost-response-operation', status: 'pending', kind: 'mutation', origin: 'save',
                    files: [{ base: sharedFile, yours: { ...sharedFile, translations: ['Saved Thai'] } }],
                    wire: { mutationId: 'lost-response-operation', baseRevision: 2, files: [{ filepath: source[0].filepath, translations: ['Saved Thai'] }] } }],
                conflicts: [{ id: 'retained-conflict', filepath: source[1].filepath, yours: { filepath: source[1].filepath, translations: ['Conflicting text'] } }],
                recovery: [{ id: 'retained-room-recovery', at: 1, reason: 'Preserved cache text', files: [{ filepath: source[7].filepath, translations: ['Recovery seven'] }] },
                    { id: 'retained-many-file-recovery', at: 2, reason: 'Preserved disconnected workspace', sourceHash: 'predecessor',
                        files: source.map(desc => ({ filepath: desc.filepath, translations: ['Recovered ' + desc.filename], revision: 0, trackedForExport: true, needsReview: false })) }] };
            const historyScope = { accountId: 'fixture-history-owner', game: 'poe1', branchId: 'default', sourceHash: 'tiny-baseline' };
            const tinyScopes = [historyScope, { ...historyScope, accountId: 'fixture-history-other' }, { ...historyScope, branchId: 'release' },
                { ...historyScope, game: 'poe2' }, { ...historyScope, sourceHash: 'tiny-successor' }];
            for (const [index, tinyScope] of tinyScopes.entries()) {
                const suffix = JSON.stringify([tinyScope.accountId, tinyScope.game, tinyScope.branchId, tinyScope.sourceHash]);
                const tinySource = [copy(source[0])], tinyWorkspace = { ...tinyScope, descs: copy(tinySource), status: {} };
                WorkspaceState.initializeWorkspace(tinyWorkspace, { source: tinySource, sourceHash: tinyScope.sourceHash, game: tinyScope.game, language: 'Thai' });
                WorkspaceState.stageTranslation(tinyWorkspace, { filepath: source[0].filepath, translations: [index === 1 ? '' : 'Tiny scoped save ' + index] }, 'Thai', { source: tinySource[0] });
                values['workspace_version_v1:' + suffix] = tinyWorkspace;
                values['source_version_v1:' + suffix] = tinySource;
            }
            const conversionScope = { ...scope, sourceHash: 'legacy-resolved-conflict-buckets' };
            const conversionSuffix = JSON.stringify([conversionScope.accountId, conversionScope.game, conversionScope.branchId, conversionScope.sourceHash]);
            const conversionSource = copy(source.slice(20, 25)), conversionWorkspace = { ...conversionScope, descs: copy(conversionSource), status: {} };
            WorkspaceState.initializeWorkspace(conversionWorkspace, { source: conversionSource, sourceHash: conversionScope.sourceHash,
                game: conversionScope.game, language: 'Thai' });
            const resolved = WorkspaceState.dropTranslation(conversionWorkspace, conversionSource[0], 'Thai', { id: 'resolved-local',
                originSourceHash: 'predecessor', targetSourceHash: conversionScope.sourceHash, translations: ['Resolved local text'] });
            const resolvedShared = { ...copy(resolved), id: 'resolved-shared', revision: 2, status: 'promoted' };
            WorkspaceState.recordDroppedConflict(conversionWorkspace, { language: 'Thai', filepath: conversionSource[0].filepath,
                yours: copy(resolved), shared: resolvedShared });
            WorkspaceState.resolveDroppedConflict(conversionWorkspace, conversionSource[0].filepath, 'Thai', 'shared', { id: resolvedShared.id, revision: 2 });
            // Conflict/stage cleanup leaves these empty language containers in
            // legacy aggregates. They do not denote a translation or candidate.
            for (const field of ['staged', 'dropped', 'droppedConflicts', 'droppedAssignments']) (conversionWorkspace[field] ||= {}).French = {};
            const unresolved = WorkspaceState.dropTranslation(conversionWorkspace, conversionSource[1], 'German', { id: 'unresolved-local',
                originSourceHash: 'predecessor', targetSourceHash: conversionScope.sourceHash, translations: ['Unresolved local text'] });
            WorkspaceState.recordDroppedConflict(conversionWorkspace, { language: 'German', filepath: conversionSource[1].filepath,
                yours: copy(unresolved), shared: { ...copy(unresolved), id: 'unresolved-shared', revision: 3,
                    snapshot: { ...copy(unresolved.snapshot), translations: ['Unresolved shared text'] } },
                recoveryEvidence: { emptySnapshotMetadata: {}, decisions: [] } });
            WorkspaceState.stageTranslation(conversionWorkspace, { filepath: conversionSource[2].filepath, translations: [''] }, 'German',
                { source: conversionSource[2], savedAt: 1, saveOrigin: 'save' });
            WorkspaceState.stageTranslation(conversionWorkspace, { filepath: conversionSource[3].filepath, translations: copy(conversionSource[3].translations.Thai) },
                'Thai', { source: conversionSource[3], savedAt: 2, saveOrigin: 'save' });
            WorkspaceState.dropTranslation(conversionWorkspace, conversionSource[4], 'Thai', { id: 'z-first',
                originSourceHash: 'predecessor', targetSourceHash: conversionScope.sourceHash, translations: ['First queued copy'] });
            WorkspaceState.dropTranslation(conversionWorkspace, conversionSource[4], 'German', { id: 'a-second',
                originSourceHash: 'predecessor', targetSourceHash: conversionScope.sourceHash, translations: ['Second queued copy'] });
            values['workspace_version_v1:' + conversionSuffix] = conversionWorkspace;
            values['source_version_v1:' + conversionSuffix] = conversionSource;
            const tx = db.transaction(['kv', 'revisions_poe1'], 'readwrite');
            for (const [key, value] of Object.entries(values)) tx.objectStore('kv').put({ key, value });
            tx.objectStore('revisions_poe1').add({ filepath: source[0].filepath, lang: 'Thai', savedAt: 1, translations: ['Saved Thai'], ...scope });
            tx.objectStore('revisions_poe1').add({ id: 51, filepath: source[0].filepath, lang: 'Thai', savedAt: 1,
                translations: ['Legacy owned history'], collaborationAccountId: historyScope.accountId, sourceHash: historyScope.sourceHash });
            tx.objectStore('revisions_poe1').add({ id: 61, filepath: conversionSource[2].filepath, lang: 'German', savedAt: 1,
                translations: [''], ...conversionScope });
            await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
            window.__storageScope = scope; window.__storageSource = source; window.__legacyValues = values;
            OfflineStore.setWorkspaceContext(scope);
            // Fail after one migration batch has had an opportunity to commit.
            window.__normalizedProbe.fail = { after: 380 };
            let interrupted = false;
            let timingStarted = performance.now();
            try { await OfflineStore.getVersionWorkspace(scope, 'Thai'); }
            catch (error) { interrupted = /quota|fixture/i.test(error.message) || error.name === 'QuotaExceededError'; }
            migrationTimings.workspaceInterruptedMs = performance.now() - timingStarted;
            window.__normalizedProbe.fail = null;
            timingStarted = performance.now();
            const recovered = await OfflineStore.getVersionWorkspace(scope, 'Thai');
            migrationTimings.workspaceResumeMs = performance.now() - timingStarted;
            migrationTimings.workspaceTotalMs = migrationTimings.workspaceInterruptedMs + migrationTimings.workspaceResumeMs;
            const importedSource = await OfflineStore.getVersionSource(scope);
            const orphanedDrafts = await OfflineStore.listTranslationDrafts({ profile: scope.accountId, game: scope.game,
                branchId: scope.branchId, language: 'Thai', sourceHash: orphanScope.sourceHash });
            timingStarted = performance.now();
            const roomState = await OfflineStore.getCollaborationState({ key: roomKey, scope: roomIdentity });
            migrationTimings.roomConversionMs = performance.now() - timingStarted;
            const warmEventStart = migrationEvents.length;
            window.__normalizedProbe.operations = [];
            timingStarted = performance.now();
            await OfflineStore.getVersionWorkspace(scope, 'Thai');
            migrationTimings.warmWorkspaceReadMs = performance.now() - timingStarted;
            timingStarted = performance.now();
            await OfflineStore.getCollaborationState({ key: roomKey, scope: roomIdentity });
            migrationTimings.warmRoomReadMs = performance.now() - timingStarted;
            const warmMigrationEvents = migrationEvents.slice(warmEventStart), warmMigrationOperations = window.__normalizedProbe.operations.slice();
            window.__storageRoom = { key: roomKey, identity: roomIdentity };
            let missingBlocked = false;
            try { await OfflineStore.getVersionWorkspace(missingScope, 'Thai'); }
            catch (error) { missingBlocked = /source.*unavailable|matching ZIP|retained/i.test(error.message); }
            const tinyWorkspaces = [];
            for (const tinyScope of tinyScopes) tinyWorkspaces.push(await OfflineStore.getVersionWorkspace(tinyScope, 'Thai'));
            // Omit one actual conflict only from a verifier's returned read,
            // preserving its native persisted row and all legacy evidence.
            // Conversion must reject this loss and keep the scope unready.
            const originalGetAll = IDBIndex.prototype.getAll;
            let verificationInjected = false, verificationFailure;
            IDBIndex.prototype.getAll = function (...args) {
                const request = originalGetAll.apply(this, args);
                if (this.objectStore.name === 'workspace_records' && this.name === 'by_scope'
                    && this.objectStore.transaction.mode === 'readwrite' && args[0] === conversionSuffix) request.addEventListener('success', () => {
                    if (verificationInjected) return;
                    const index = request.result.findIndex(row => row.value.field === 'droppedConflicts' && row.value.language === 'German');
                    if (index >= 0) { request.result.splice(index, 1); verificationInjected = true; }
                });
                return request;
            };
            try { await OfflineStore.getVersionWorkspace(conversionScope, 'Thai'); }
            catch (error) { verificationFailure = error.message; }
            finally { IDBIndex.prototype.getAll = originalGetAll; }
            const conversionHistoryBefore = await OfflineStore.listRevisions(conversionSource[2].filepath, 'German', 100, conversionScope);
            const legacyHistory = await OfflineStore.listRevisions(source[0].filepath, 'Thai', 100, historyScope);
            const read = indexedDB.open('sdeditor', 9), upgraded = await new Promise((resolve, reject) => {
                read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
            });
            const frozen = {}, inspect = upgraded.transaction(['kv', 'collaboration_rooms', 'collaboration_records', 'storage_migrations', 'workspace_records'], 'readonly');
            const roomMetadata = inspect.objectStore('collaboration_rooms').get(roomKey);
            const roomRecords = inspect.objectStore('collaboration_records').index('by_scope').getAll(roomKey);
            const conversionProgress = inspect.objectStore('storage_migrations').get(conversionSuffix);
            const conversionRows = inspect.objectStore('workspace_records').index('by_scope').getAll(conversionSuffix);
            for (const key of Object.keys(values)) {
                const get = inspect.objectStore('kv').get(key); get.onsuccess = () => { frozen[key] = get.result?.value; };
            }
            await new Promise(resolve => { inspect.oncomplete = resolve; });
            const stores = [...upgraded.objectStoreNames]; upgraded.close();
            window.__normalizedProbe.operations = [];
            const converted = await OfflineStore.getVersionWorkspace(conversionScope, 'Thai'), conversionRetryOperations = window.__normalizedProbe.operations.slice();
            const conversionHistoryAfter = await OfflineStore.listRevisions(conversionSource[2].filepath, 'German', 100, conversionScope);
            const finalRead = indexedDB.open('sdeditor', 9), finalDb = await new Promise((resolve, reject) => {
                finalRead.onsuccess = () => resolve(finalRead.result); finalRead.onerror = () => reject(finalRead.error);
            });
            const finalEvidence = finalDb.transaction(['kv'], 'readonly'), conversionFrozen = finalEvidence.objectStore('kv').get('workspace_version_v1:' + conversionSuffix);
            await new Promise(resolve => { finalEvidence.oncomplete = resolve; }); finalDb.close();
            const recoveryHeader = roomRecords.result.find(record => record.value.field === 'recovery' && record.value.entry === 'retained-many-file-recovery');
            const recoveryMembers = roomRecords.result.filter(record => record.value.field === 'recoveryFiles' && record.value.groupId === 'retained-many-file-recovery');
            const recordFacts = { recoveryHeaderHasFiles: Object.hasOwn(recoveryHeader.value.data, 'files'), recoveryMembers: recoveryMembers.length,
                recoveryMemberPaths: recoveryMembers.every(record => record.paths.length === 1 && !Object.hasOwn(record.value.data, 'files')),
                seedMembers: roomRecords.result.filter(record => record.value.field === 'seedUploadFiles').length };
            const measuredEvents = migrationEvents.filter(event => event.scope.sourceHash === scope.sourceHash);
            migrationTimings.workspaceInterruptedConversionMs = measuredEvents.find(event => event.kind === 'workspace' && event.state === 'failed').durationMs;
            migrationTimings.workspaceResumeConversionMs = measuredEvents.find(event => event.kind === 'workspace' && event.state === 'completed').durationMs;
            migrationTimings.roomConversionOnlyMs = measuredEvents.find(event => event.kind === 'room' && event.state === 'completed').durationMs;
            unsubscribeMigration();
            return { interrupted, recovered, source: importedSource, originalSource: source, frozen, values, stores,
                orphanedDrafts, orphanKey, missingBlocked, roomState, roomKey, roomMetadata: roomMetadata.result?.value, recordFacts, tinyWorkspaces, legacyHistory,
                conversionWorkspace, conversionSource, converted, verificationInjected, verificationFailure,
                conversionProgress: conversionProgress.result?.value, conversionRows: conversionRows.result, conversionRetryOperations,
                conversionHistoryBefore, conversionHistoryAfter, conversionFrozen: conversionFrozen.result?.value,
                migrationEvents, migrationTimings, warmMigrationEvents, warmMigrationOperations };
        }, { legacyFileCount });
        assert.equal(migration.interrupted, true, 'A failed bounded migration remains retryable');
        assert.equal(migration.missingBlocked, true, 'Missing immutable source prevents conversion instead of reconstructing baseline from edited work');
        assert.deepEqual(migration.warmMigrationEvents, [], 'Warm workspace and room reads never repeat conversion activity');
        assert.equal(migration.warmMigrationOperations.filter(operation => ['put', 'add', 'delete'].includes(operation.method)).length, 0,
            'Warm workspace and room materialization perform zero storage writes');
        const migrationActivity = new Map();
        for (const event of migration.migrationEvents) {
            assert.ok(['started', 'completed', 'failed'].includes(event.state), 'Migration activity has an explicit lifecycle state');
            const activity = migrationActivity.get(event.id) || { started: 0, completed: 0, failed: 0 };
            activity[event.state]++; migrationActivity.set(event.id, activity);
            if (event.state !== 'started') assert.ok(event.durationMs >= 0, 'Finished migration events expose measured duration');
        }
        for (const activity of migrationActivity.values()) assert.equal(activity.started, activity.completed + activity.failed,
            'Every conversion attempt completes or fails, including interruption and retry');
        const schemaEvents = migration.migrationEvents.filter(event => event.kind === 'schema');
        assert.deepEqual(schemaEvents.map(event => event.state), ['started', 'completed'], 'Real v8-to-v9 schema upgrade emits one balanced activity');
        const workspaceEvents = migration.migrationEvents.filter(event => event.kind === 'workspace' && event.scope.sourceHash === 'fixture-v8');
        assert.equal(workspaceEvents.filter(event => event.state === 'started').length, 2, 'Workspace interruption and retry start separate activity attempts');
        assert.equal(workspaceEvents.filter(event => event.state === 'failed').length, 1, 'Failed workspace conversion ends its activity');
        assert.equal(workspaceEvents.filter(event => event.state === 'completed').length, 1, 'Successful resume completes workspace conversion activity');
        const byPath = files => files.slice().sort((left, right) => left.filepath.localeCompare(right.filepath));
        assert.deepEqual(byPath(migration.source), byPath(migration.originalSource), 'Immutable source survives migration');
        assert.deepEqual(migration.frozen, migration.values, 'v8 evidence is frozen, including unrelated settings');
        assert.deepEqual(migration.recovered.staged.Thai['storage/0.txt'].translations, ['Saved Thai']);
        assert.deepEqual(migration.recovered.staged.German['storage/0.txt'].translations, ['']);
        assert.ok(migration.recovered.dropped.Thai['storage/1.txt']);
        assert.equal(migration.orphanedDrafts.length, 1, 'Older-version recovery stays available without a full retained baseline');
        assert.deepEqual(migration.orphanedDrafts[0].source, migration.values[migration.orphanKey].source, 'Orphan checkpoint preserves original comparison evidence');
        assert.deepEqual(migration.orphanedDrafts[0].recovery, migration.values[migration.orphanKey].recovery, 'Recovery variants survive compaction');
        const room = migration.roomState.rooms[migration.roomKey], originalRoom = migration.values.collaboration_v1.rooms[migration.roomKey];
        assert.deepEqual(room.shared, originalRoom.shared, 'Accepted server files survive room conversion');
        assert.equal(room.seq, 8, 'Replay cursor survives room conversion');
        assert.equal(room.outbox[0].id, 'lost-response-operation');
        assert.deepEqual(room.outbox[0].wire, originalRoom.outbox[0].wire, 'Prepared retry payload survives room conversion');
        assert.deepEqual(room.conflicts, originalRoom.conflicts, 'Conflict records survive conversion');
        assert.ok(room.recovery.some(record => record.id === 'retained-room-recovery'), 'Cached recovery records survive conversion');
        const retainedGroup = room.recovery.find(record => record.id === 'retained-many-file-recovery');
        const { localRecordId, _storageRecovery, ...group } = retainedGroup;
        assert.deepEqual(group, originalRoom.recovery.find(record => record.id === 'retained-many-file-recovery'),
            'Cold room assembly preserves all recovery members, facts and their original order');
        assert.deepEqual(migration.recordFacts, { recoveryHeaderHasFiles: false, recoveryMembers: legacyFileCount, recoveryMemberPaths: true, seedMembers: legacyFileCount },
            'Native recovery and seed snapshots are physically stored as individually keyed file records');
        assert.equal(Object.hasOwn(migration.roomMetadata.seedUpload, 'files'), false, 'Legacy seed upload files are excluded from room metadata');
        assert.deepEqual(room.seedUpload, originalRoom.seedUpload, 'Cold room adapters hydrate exact seed-upload files and retry ticket');
        assert.deepEqual(migration.tinyWorkspaces.map(workspace => workspace.staged.Thai['storage/0.txt'].translations),
            [['Tiny scoped save 0'], [''], ['Tiny scoped save 2'], ['Tiny scoped save 3'], ['Tiny scoped save 4']],
            'Accounts, branches, games, versions and intentional blank saves remain independent');
        assert.deepEqual(migration.legacyHistory.map(row => row.id), [51], 'Scoped history index preserves the original legacy revision ID');
        assert.equal(migration.legacyHistory[0].accountId, 'fixture-history-owner');
        assert.equal(migration.legacyHistory[0].branchId, 'default');
        assert.equal(migration.verificationInjected, true, 'Final native verification examined converted conflict records');
        assert.match(migration.verificationFailure, /Workspace conversion verification failed: droppedConflicts/,
            'An omitted nonempty conflict must still block conversion');
        assert.equal(migration.conversionProgress.state, 'converting', 'Failed verification cannot mark incomplete conversion ready');
        assert.ok(migration.conversionProgress.offset > 0, 'Failed final verification retains durable migration progress');
        assert.ok(migration.conversionRows.some(row => row.value.field === 'droppedConflicts' && row.value.language === 'German'),
            'Failed verification retains the actual persisted conflict for a safe retry');
        assert.equal(migration.conversionRetryOperations.filter(operation => operation.store === 'workspace_records' && operation.method === 'put').length, 0,
            'Final verification retry resumes existing batches instead of rebuilding converted recovery rows');
        assert.equal(migration.conversionRetryOperations.some(operation => operation.store === 'kv' && ['put', 'add', 'delete'].includes(operation.method)), false,
            'Final verification retry never mutates frozen legacy aggregates');
        assert.deepEqual(migration.conversionFrozen, migration.conversionWorkspace, 'Frozen recovery evidence remains exact after successful retry');
        assert.deepEqual(migration.converted.droppedArchive, migration.conversionWorkspace.droppedArchive,
            'Conversion retry preserves recovery identities, revisions and generations without creating additional copies');
        assert.deepEqual(migration.conversionHistoryBefore.map(revision => revision.id), [61], 'Original conversion-scope history ID remains available after failure');
        assert.deepEqual(migration.conversionHistoryAfter, migration.conversionHistoryBefore, 'Retry cannot duplicate or alter original history');
        assert.deepEqual(migration.conversionWorkspace.droppedConflicts.Thai, {}, 'Resolved legacy conflict leaves the reproducible empty language bucket');
        for (const field of ['staged', 'dropped', 'droppedConflicts', 'droppedAssignments']) {
            assert.deepEqual(migration.conversionWorkspace[field].French, {}, 'Legacy input includes an empty ' + field + ' language bucket');
            assert.equal(migration.converted[field].French, undefined, 'Empty ' + field + ' language buckets have no normalized facts');
        }
        const unresolvedPath = migration.conversionSource[1].filepath;
        assert.deepEqual(migration.converted.droppedConflicts.German[unresolvedPath], migration.conversionWorkspace.droppedConflicts.German[unresolvedPath],
            'The unresolved conflict and its nested empty recovery evidence survive exactly');
        assert.deepEqual(migration.converted.staged.German[migration.conversionSource[2].filepath].translations, [''], 'Explicit blank Saved presence survives conversion');
        assert.deepEqual(migration.converted.staged.Thai[migration.conversionSource[3].filepath].translations,
            migration.conversionSource[3].translations.Thai, 'Explicit unchanged Saved presence survives conversion');
        assert.deepEqual(migration.converted.droppedOutbox, migration.conversionWorkspace.droppedOutbox,
            'Dropped queue preserves authored order and complete payloads instead of IndexedDB primary-key order');
        assert.deepEqual(migration.converted.droppedOutbox.filter(operation => ['z-first', 'a-second'].includes(operation.id)).map(operation => operation.id),
            ['z-first', 'a-second']);
        results.push({ scenario: 'resolved conflict buckets, strict conflict verification retry and preserved Dropped queue order' });
        results.push({ scenario: 'interrupted migration and recovery', stores: migration.stores.length, legacyFileCount, timings: migration.migrationTimings });
        console.log('Validated interrupted v8 conversion, immutable evidence and older-source recovery.');

        await sameBaselineImportChecks(page, results);

        const writes = await page.evaluate(async () => {
            const scope = window.__storageScope, filepath = 'storage/2.txt';
            const batch = { jobId: 'one-file-save', ...scope, workspaceScope: scope, language: 'Thai',
                files: [{ filepath, translations: ['New saved text'] }],
                revisions: [{ filepath, lang: 'Thai', savedAt: 2, translations: ['New saved text'] }] };
            window.__storageReplayBatch = JSON.parse(JSON.stringify(batch));
            window.__normalizedProbe.operations = [];
            const acknowledgment = await OfflineStore.saveTranslationBatch(batch);
            const operations = window.__normalizedProbe.operations.slice();
            const firstHistory = await OfflineStore.listRevisions(filepath, 'Thai', 100, scope);
            window.__normalizedProbe.operations = [];
            const duplicate = await OfflineStore.saveTranslationBatch(batch), replayOperations = window.__normalizedProbe.operations.slice();
            const history = await OfflineStore.listRevisions(filepath, 'Thai', 100, scope);
            const before = await OfflineStore.getVersionWorkspace(scope, 'Thai');
            window.__normalizedProbe.fail = { after: 1 };
            let failed = false;
            try { await OfflineStore.saveTranslationBatch({ ...batch, jobId: 'aborted-save', files: [{ filepath, translations: ['Must abort'] }] }); }
            catch (_) { failed = true; }
            window.__normalizedProbe.fail = null;
            const after = await OfflineStore.getVersionWorkspace(scope, 'Thai');
            return { acknowledgment, operations, duplicate, replayOperations, firstHistory, history, before, after, failed };
        });
        assert.equal(writes.failed, true, 'Quota failure aborts a one-file commit');
        assert.deepEqual(writes.before, writes.after, 'Abort preserves committed state');
        assert.equal(writes.duplicate.duplicate, true, 'Lost acknowledgment retry finds the original receipt');
        assert.equal(writes.history.length, writes.firstHistory.length, 'Replay does not duplicate history');
        assert.deepEqual(aggregateOperations(writes.operations), [], 'One-file save avoids all legacy aggregates');
        assertNoAssetReads(writes.operations, 'One-file save');
        assert.equal(writes.replayOperations.filter(op => ['put', 'add', 'delete'].includes(op.method)).length, 0, 'Receipt replay performs no writes');
        const saveBytes = writes.operations.reduce((total, operation) => total + operation.bytes, 0);
        assert.ok(saveBytes < 65536, 'One-file transaction copies only bounded data');
        results.push({ scenario: 'one-file atomic save and receipt replay', operations: writes.operations.length, bytes: saveBytes });
        const changedReplay = await page.evaluate(async () => {
            const scope = window.__storageScope, filepath = 'storage/2.txt', batch = window.__storageReplayBatch;
            const latestWorkspace = await OfflineStore.updateWorkspace(workspace => {
                WorkspaceState.stageTranslation(workspace, { filepath, translations: ['Later text from another tab'] }, 'Thai',
                    { source: window.__storageSource[2], sourceHash: scope.sourceHash });
                return workspace;
            }, scope, { scope, filepaths: [filepath] });
            window.__normalizedProbe.operations = [];
            const latest = await OfflineStore.saveTranslationBatch(batch), latestOperations = window.__normalizedProbe.operations.slice();
            await OfflineStore.updateWorkspace(workspace => {
                delete workspace.staged.Thai[filepath]; delete workspace.status[filepath]; return workspace;
            }, scope, { scope, filepaths: [filepath] });
            window.__normalizedProbe.operations = [];
            const deleted = await OfflineStore.saveTranslationBatch(batch), deletedOperations = window.__normalizedProbe.operations.slice();
            const history = await OfflineStore.listRevisions(filepath, 'Thai', 100, scope);
            return { latest, deleted, latestOperations, deletedOperations, history,
                latestStatus: latestWorkspace.status?.[filepath] || {} };
        });
        assert.deepEqual(changedReplay.latest.files[0].translations, ['Later text from another tab'], 'Lost response replay returns newer durable text');
        assert.equal(changedReplay.latest.files[0].trackedForExport, true, 'Newer Saved presence survives receipt replay');
        assert.deepEqual(changedReplay.latest.statuses['storage/2.txt'], changedReplay.latestStatus, 'Replay returns current factual metadata');
        assert.deepEqual(changedReplay.deleted.files[0].translations, ['Thai 2'], 'Replay returns immutable text after another tab removes the stage');
        assert.equal(changedReplay.deleted.files[0].trackedForExport, false); assert.equal(changedReplay.deleted.files[0].stagingReset, true);
        assert.deepEqual(changedReplay.deleted.statuses['storage/2.txt'], {}, 'Deleted-stage replay cannot restore old Saved metadata');
        assert.equal([...changedReplay.latestOperations, ...changedReplay.deletedOperations].filter(operation => ['put', 'add', 'delete'].includes(operation.method)).length, 0,
            'Receipt reconciliation after another tab changes or deletes text performs zero writes');
        assert.deepEqual(changedReplay.history.map(row => row.id), writes.firstHistory.map(row => row.id), 'Changed-text replay creates no duplicate history');
        assertSelectedBaselineReads(changedReplay.latestOperations, ['storage/2.txt'], 'Later-text receipt replay');
        assertSelectedBaselineReads(changedReplay.deletedOperations, ['storage/2.txt'], 'Deleted-stage receipt replay');
        results.push({ scenario: 'same-ID receipt replay reconciles later saved text and staged deletion without writes' });
        const absence = await page.evaluate(async () => {
            const scope = window.__storageScope, filepath = 'storage/0.txt', original = window.__storageSource[0];
            await OfflineStore.saveTranslationBatch({ jobId: 'delete-original-v8-save', ...scope, workspaceScope: scope, language: 'Thai',
                origin: 'delete_staged', resetStaging: true,
                files: [{ filepath, translations: original.translations.Thai, trackedForExport: false, stagingReset: true }],
                bases: { [filepath]: { filepath, translations: ['Saved Thai'], trackedForExport: true, revision: 0 } },
                revisions: [{ filepath, lang: 'Thai', savedAt: 3, translations: original.translations.Thai, note: 'Delete staged translation' }] });
            const first = await OfflineStore.getVersionWorkspace(scope, 'Thai'), activated = await OfflineStore.activateVersion(scope),
                second = await OfflineStore.getVersionWorkspace(scope, 'Thai');
            return { first: first.staged.Thai?.[filepath], second: second.staged.Thai?.[filepath],
                activated: activated.workspace.staged.Thai?.[filepath], committed: second.descs.find(desc => desc.filepath === filepath).translations.Thai };
        });
        assert.equal(absence.first, undefined); assert.equal(absence.second, undefined); assert.equal(absence.activated, undefined);
        assert.deepEqual(absence.committed, ['Thai 0'], 'Normalized absence stays authoritative across reads and activation');
        results.push({ scenario: 'deleted staged work is never resurrected from frozen v8 evidence' });
        const journal = await page.evaluate(async () => {
            const scope = window.__storageScope, batch = { jobId: 'journal-recovery', ...scope, workspaceScope: scope, language: 'Thai',
                files: [{ filepath: 'storage/3.txt', translations: ['Submitted without a checkpoint'] }],
                bases: { 'storage/3.txt': { translations: ['Thai 3'] } },
                revisions: [{ filepath: 'storage/3.txt', lang: 'Thai', savedAt: 3, translations: ['Submitted without a checkpoint'] }] };
            await OfflineStore.putSaveSubmission(batch);
            const queued = await OfflineStore.listSaveSubmissions({ ...scope, language: 'Thai' });
            const isolated = await OfflineStore.listSaveSubmissions({ ...scope, accountId: 'another-account', language: 'Thai' });
            await OfflineStore.saveTranslationBatch(batch);
            const consumed = await OfflineStore.listSaveSubmissions({ ...scope, language: 'Thai' });
            return { queued, isolated, consumed };
        });
        assert.equal(journal.queued.length, 1); assert.equal(journal.queued[0].batch.jobId, 'journal-recovery');
        assert.deepEqual(journal.isolated, [], 'Submitted saves remain account scoped');
        assert.deepEqual(journal.consumed, [], 'Submission is removed atomically by its save');
        results.push({ scenario: 'durable submitted save without a private checkpoint' });
        const order = await page.evaluate(async () => {
            const scope = window.__storageScope, make = (id, filepath) => ({ jobId: id, ...scope, workspaceScope: scope, language: 'Thai',
                files: [{ filepath, translations: ['Ordered submission ' + id] }],
                revisions: [{ filepath, lang: 'Thai', savedAt: 10, translations: ['Ordered submission ' + id] }] });
            const batches = [make('ordered-z', 'storage/8.txt'), make('ordered-a', 'storage/9.txt')], clock = Date.now;
            let retryOperations;
            try {
                Date.now = () => 1234567890000;
                for (const batch of batches) await OfflineStore.putSaveSubmission(batch);
                window.__normalizedProbe.operations = [];
                await OfflineStore.putSaveSubmission(batches[0]);
                retryOperations = window.__normalizedProbe.operations.slice();
            } finally { Date.now = clock; }
            const queued = await OfflineStore.listSaveSubmissions({ ...scope, language: 'Thai' });
            for (const batch of batches) await OfflineStore.saveTranslationBatch(batch);
            return { queued, retryOperations };
        });
        assert.deepEqual(order.queued.map(submission => submission.batch.jobId), ['ordered-z', 'ordered-a'],
            'Same-clock submitted saves preserve insertion order instead of sorting random job IDs');
        assert.equal(order.retryOperations.filter(operation => ['put', 'add', 'delete'].includes(operation.method)).length, 0,
            'Same-ID submission retry performs no writes');
        results.push({ scenario: 'same-clock durable submission ordering and zero-write retry' });
        const sharedSave = await page.evaluate(async () => {
            const scope = window.__storageScope, { key, identity } = window.__storageRoom, filepath = 'storage/12.txt';
            window.__normalizedProbe.operations = [];
            await OfflineStore.saveTranslationBatch({ jobId: 'bounded-shared-save', ...scope, workspaceScope: scope, language: 'Thai',
                files: [{ filepath, translations: ['Authored bounded shared save'] }], collaboration: { key, identity, origin: 'save' },
                revisions: [{ filepath, lang: 'Thai', savedAt: 12, translations: ['Authored bounded shared save'] }] });
            return window.__normalizedProbe.operations;
        });
        assert.deepEqual(aggregateOperations(sharedSave), [], 'Shared save avoids every aggregate');
        assertNoAssetReads(sharedSave, 'Shared save');
        assertSelectedBaselineReads(sharedSave, ['storage/12.txt'], 'Shared save with a complete recovery group');
        const sharedSaveBytes = sharedSave.reduce((sum, operation) => sum + operation.bytes, 0);
        assert.ok(sharedSaveBytes < 65536, 'A one-file shared save never reads or copies unrelated recovery members');
        results.push({ scenario: 'bounded shared save with a ' + legacyFileCount + '-file recovery group', operations: sharedSave.length, bytes: sharedSaveBytes });
        const command = await page.evaluate(async () => {
            const { key, identity } = window.__storageRoom, scope = window.__storageScope, filepath = 'storage/5.txt';
            const options = { key, scope: identity, filepaths: [filepath], operationIds: [], includeOutbox: 'paths',
                includeConflicts: true, command: 'remote-events' };
            const mutate = state => {
                const room = state.rooms[key]; room.seq = 9;
                room.shared[filepath] = { filepath, translations: ['Remote event text'], revision: 1, trackedForExport: true, needsReview: false };
                return state;
            };
            const project = (workspace, state) => {
                WorkspaceState.stageTranslation(workspace, state.rooms[key].shared[filepath], 'Thai', { source: window.__storageSource[5], sourceHash: scope.sourceHash });
                return workspace;
            };
            window.__normalizedProbe.operations = [];
            await OfflineStore.updateCollaborationRecords(options, mutate, { projectWorkspace: project });
            const operations = window.__normalizedProbe.operations.slice();
            window.__normalizedProbe.operations = [];
            await OfflineStore.updateCollaborationRecords(options, state => state, { projectWorkspace: workspace => workspace });
            const unchanged = window.__normalizedProbe.operations.slice();
            let failed = false;
            try { await OfflineStore.updateCollaborationRecords(options, state => {
                const room = state.rooms[key]; room.seq = 10; room.shared[filepath].translations = ['Must roll back']; return state;
            }, { projectWorkspace: () => { throw new Error('Fixture remote event projection abort'); } }); }
            catch (_) { failed = true; }
            const result = await OfflineStore.getCollaborationRecords(options), workspace = await OfflineStore.getVersionWorkspace(scope, 'Thai');
            return { operations, unchanged, failed, room: result.room, staged: workspace.staged.Thai[filepath].translations };
        });
        assert.deepEqual(aggregateOperations(command.operations), [], 'Remote event avoids workspace, source and collaboration aggregates');
        assertNoAssetReads(command.operations, 'Remote event');
        assertSelectedBaselineReads(command.operations, ['storage/5.txt'], 'Remote event with a complete recovery group');
        assert.ok(command.operations.reduce((sum, operation) => sum + operation.bytes, 0) < 65536, 'Remote event reads and writes only bounded touched-file records');
        assert.equal(command.unchanged.filter(operation => ['put', 'add', 'delete'].includes(operation.method)).length, 0,
            'Identical accepted state performs no writes');
        assertSelectedBaselineReads(command.unchanged, ['storage/5.txt'], 'Unchanged event with a complete recovery group');
        assert.equal(command.failed, true); assert.equal(command.room.seq, 9, 'Aborted projection cannot advance the replay cursor');
        assert.deepEqual(command.room.shared['storage/5.txt'].translations, ['Remote event text']);
        assert.deepEqual(command.staged, ['Remote event text'], 'Accepted text and cursor commit or abort together');
        results.push({ scenario: 'bounded remote event, no-op replay and atomic cursor projection', operations: command.operations.length,
            bytes: command.operations.reduce((sum, operation) => sum + operation.bytes, 0) });
        const ack = await page.evaluate(async () => {
            const { key, identity } = window.__storageRoom, scope = window.__storageScope, filepath = 'storage/4.txt';
            const command = { key, scope: identity, filepaths: [filepath], operationIds: ['acknowledged-operation'], includeOutbox: 'paths',
                includeConflicts: true, command: 'prepare-operation' };
            const authored = { filepath, translations: ['Authored fourth file'], revision: 0, trackedForExport: true, needsReview: false };
            await OfflineStore.updateCollaborationRecords(command, state => {
                state.rooms[key].outbox.push({ id: 'acknowledged-operation', origin: 'save', status: 'pending',
                    files: [{ base: { ...authored, translations: ['Thai 4'], trackedForExport: false }, yours: authored }],
                    wire: { mutationId: 'acknowledged-operation', files: [{ filepath, translations: authored.translations }] } });
                return state;
            }, { projectWorkspace: workspace => {
                WorkspaceState.stageTranslation(workspace, authored, 'Thai', { source: window.__storageSource[4], sourceHash: scope.sourceHash }); return workspace;
            } });
            window.__normalizedProbe.operations = [];
            const result = await OfflineStore.updateCollaborationRecords({ ...command, command: 'acknowledge-operation' }, state => {
                const room = state.rooms[key]; room.shared[filepath] = { ...authored, revision: 2 };
                room.outbox = room.outbox.filter(operation => operation.id !== 'acknowledged-operation'); return state;
            }, { projectWorkspace: (workspace, state) => {
                WorkspaceState.stageTranslation(workspace, state.rooms[key].shared[filepath], 'Thai', { source: window.__storageSource[4], sourceHash: scope.sourceHash }); return workspace;
            } });
            return { operations: window.__normalizedProbe.operations.slice(), room: result.room };
        });
        assert.deepEqual(aggregateOperations(ack.operations), [], 'Operation acknowledgment avoids aggregate reads/writes');
        assertNoAssetReads(ack.operations, 'Operation acknowledgment');
        assertSelectedBaselineReads(ack.operations, ['storage/4.txt'], 'Operation acknowledgment with a complete recovery group');
        const ackBytes = ack.operations.reduce((sum, operation) => sum + operation.bytes, 0);
        assert.ok(ackBytes < 65536, 'Acknowledgment is bounded to its touched files');
        assert.equal(ack.room.seq, 9, 'Acknowledging a local mutation leaves the replay cursor intact');
        assert.equal(ack.room.outbox.some(operation => operation.id === 'acknowledged-operation'), false);
        assert.deepEqual(ack.room.shared['storage/4.txt'].translations, ['Authored fourth file']);
        results.push({ scenario: 'bounded operation acknowledgment', operations: ack.operations.length, bytes: ackBytes });
        const preservedGroup = await page.evaluate(async () => {
            const { key, identity } = window.__storageRoom;
            const state = await OfflineStore.getCollaborationState({ key, scope: identity });
            const { localRecordId, _storageRecovery, ...group } = state.rooms[key].recovery.find(record => record.id === 'retained-many-file-recovery');
            return group;
        });
        assert.deepEqual(preservedGroup, originalRoom.recovery.find(record => record.id === 'retained-many-file-recovery'),
            'Hot shared save, events and acknowledgments preserve every unselected recovery member');
        console.log('Validated granular saves, transaction abort, receipt replay, staged deletion and submission journal.');
        if (!storageOnly) await keyboardChecks(page, { origin, apiOrigin, secret, results, onPage: page => { activePage = page; } });
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ storageOnly, results }, null, 2));
        return results;
    } catch (error) {
        if (activePage && !activePage.isClosed()) console.error(JSON.stringify(await activePage.evaluate(() => {
            const vm = window.__normalizedApp;
            return { body: document.body.innerText.slice(-2000), errors: window.__normalizedProbe?.events,
                startup: vm?.startupReady, storage: vm?.offlineStoreReady, sourceLoaded: vm?.sourceLoaded, signedIn: vm?.cloudSignedIn,
                cloudError: vm?.cloudStorageError, collaboration: vm?.collaborationNotice, connected: vm?._collaboration?.connected,
                current: vm?.editorCurrentEditingDesc?.filepath, sourceIdentity: vm?.sourceIdentity, descCount: vm?.descs?.length,
                pending: vm?.pendingLocalSaves, queue: vm?._pendingSaves?.snapshot().jobs.map(job => ({ id: job.jobId, status: job.status, error: job.error?.message })),
                versionLoading: vm?.versionStorageLoading, chooser: vm?.versionChooserVisible, game: vm?.gameVersion,
                language: vm?.lang, accountId: vm?.cloudUser?.id };
        }).catch(() => ({ diagnostic: 'Fixture page was unavailable.' })), null, 2));
        throw error;
    } finally {
        await browser?.close(); api.locals.collaborationRealtime.close();
        await Promise.all([new Promise(resolve => apiServer.close(resolve)), new Promise(resolve => frontendServer.close(resolve))]);
        database.close();
        const absolute = resolve(directory), expectedRoot = resolve(tmpdir()) + sep;
        if (!absolute.startsWith(expectedRoot) || !absolute.split(sep).pop().startsWith('sdeditor-normalized-browser-')) throw new Error('Refusing cleanup outside fixture directory.');
        rmSync(absolute, { recursive: true, force: true });
    }
}

async function sameBaselineImportChecks(page, results) {
    const repeated = await page.evaluate(async () => {
        const copy = value => JSON.parse(JSON.stringify(value));
        const readRows = async names => {
            const opening = indexedDB.open('sdeditor', 9);
            const db = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
            const tx = db.transaction(names, 'readonly'), rows = {};
            for (const name of names) {
                const request = tx.objectStore(name).getAll();
                request.onsuccess = () => { rows[name] = request.result; };
            }
            return new Promise((resolve, reject) => {
                tx.oncomplete = () => { db.close(); resolve(rows); };
                tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
            });
        };
        const seedSource = Array.from({ length: 3 }, (_, index) => ({
            filepath: 'metadata/statdescriptions/same-baseline-' + index + '.txt',
            name: index ? 'SameBaseline' + index : '', stats: ['same_baseline_stat_' + index], variables: ['#'], remarks: [''],
            translations: { English: ['Damage # ' + index], Thai: ['Thai damage ' + index], German: [''] },
        }));
        const zip = new JSZip(), entries = seedSource.map(desc => ({ filepath: desc.filepath, bytes: StatDescCodec.descEncode(desc) }));
        for (const entry of entries) zip.file(entry.filepath, entry.bytes, { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
        const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
        const parse = language => entries.map(entry => StatDescCodec.parseDesc(entry.filepath, StatDescCodec.decodeUTF16(entry.bytes), language, { strict: true }));
        const onlineSource = parse('Thai'), offlineSource = parse('German'), tree = await CollaborationProtocol.buildBaselineTree(onlineSource);
        const archive = await CollaborationProtocol.finalizeArchive({ version: 1, parserVersion: 1,
            zipHash: await CollaborationProtocol.zipHash(zipBytes), zipSize: zipBytes.byteLength,
            fileCount: entries.length, descriptionCount: entries.length, decisions: [], treeRoot: tree.root });
        const baseline = { source: copy(onlineSource), rawSource: copy(onlineSource), archive, tree };
        const onlineScope = { accountId: 'same-baseline-online', game: 'poe2', branchId: 'release', sourceHash: archive.baselineId };
        const offlineScope = { ...onlineScope, accountId: 'guest', branchId: 'default' };
        const legacyScope = { ...onlineScope, accountId: 'same-baseline-legacy', branchId: 'default' };
        const makeWorkspace = (scope, source, language) => {
            const workspace = { ...scope, descs: copy(source), status: {}, importArchive: copy(archive) };
            WorkspaceState.initializeWorkspace(workspace, { source, sourceHash: scope.sourceHash, game: scope.game, language });
            return workspace;
        };
        const filepath = onlineSource[0].filepath, onlineWorkspace = makeWorkspace(onlineScope, onlineSource, 'Thai');
        WorkspaceState.stageTranslation(onlineWorkspace, { filepath, translations: ['Online Saved Thai'] }, 'Thai', { source: onlineSource[0] });
        await OfflineStore.saveSourceWorkspaceWithRevisions(copy(onlineSource), onlineWorkspace,
            [{ filepath, lang: 'Thai', savedAt: 111, translations: ['Online Saved Thai'] }], onlineScope, baseline);
        const draft = { profile: onlineScope.accountId, game: onlineScope.game, branchId: onlineScope.branchId,
            sourceHash: onlineScope.sourceHash, language: 'Thai', filepath, id: 'same-baseline-draft', revision: 'same-baseline-revision',
            translations: ['Unfinished online text'], base: { translations: ['Online Saved Thai'] }, source: copy(onlineSource[0]), updatedAt: 222 };
        await OfflineStore.putTranslationDraft(draft);
        const checkpoint = await OfflineStore.getTranslationDraft(OfflineStore.translationDraftKey(draft));
        const preservedOnline = await OfflineStore.getVersionWorkspace(onlineScope, 'Thai');
        const preservedHistory = await OfflineStore.listRevisions(filepath, 'Thai', 100, onlineScope);
        const firstRows = await readRows(['baseline_files']), baseKey = NormalizedStore.baselineKey(onlineScope);
        const initialBaselineRows = firstRows.baseline_files.filter(row => row.scope === baseKey);
        // Different selected languages produce different parser status flags.
        // Null and empty names and language object order share the same witness.
        offlineSource[0].name = null;
        for (const desc of offlineSource) {
            desc.translations = Object.fromEntries(Object.entries(desc.translations).reverse());
            delete desc.tempTranslations;
            desc.hasChanges = true; desc.needsReview = true;
        }
        const offlineWorkspace = makeWorkspace(offlineScope, offlineSource, 'German');
        WorkspaceState.stageTranslation(offlineWorkspace, { filepath, translations: [''] }, 'German', { source: offlineSource[0] });
        window.__normalizedProbe.operations = [];
        await OfflineStore.saveSourceWorkspaceWithRevisions(copy(offlineSource), offlineWorkspace,
            [{ filepath, lang: 'German', savedAt: 333, translations: [''] }], offlineScope, { ...copy(baseline), source: copy(offlineSource), rawSource: copy(offlineSource) });
        const reimportOperations = copy(window.__normalizedProbe.operations);
        const offline = await OfflineStore.getVersionWorkspace(offlineScope, 'German');
        const afterImport = await readRows(['baseline_files']);

        const legacySource = parse('German'), legacyWorkspace = makeWorkspace(legacyScope, legacySource, 'Thai');
        WorkspaceState.stageTranslation(legacyWorkspace, { filepath, translations: ['Legacy Saved Thai'] }, 'Thai', { source: legacySource[0] });
        const suffix = NormalizedStore.scopeKey(legacyScope), legacyEvidence = {
            ['workspace_version_v1:' + suffix]: legacyWorkspace,
            ['source_version_v1:' + suffix]: legacySource,
            ['version_metadata_v1:' + suffix]: { ...legacyScope, name: 'Legacy same-baseline workspace' },
            ['import_baseline_poe2_' + archive.baselineId]: { ...copy(baseline), source: copy(legacySource), rawSource: copy(legacySource) },
        };
        const opening = indexedDB.open('sdeditor', 9);
        const db = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
        const write = db.transaction('kv', 'readwrite');
        for (const [key, value] of Object.entries(legacyEvidence)) write.objectStore('kv').put({ key, value });
        await new Promise((resolve, reject) => { write.oncomplete = resolve; write.onabort = () => reject(write.error); }); db.close();
        window.__normalizedProbe.operations = [];
        const migrated = await OfflineStore.getVersionWorkspace(legacyScope, 'Thai'), migrationOperations = copy(window.__normalizedProbe.operations);
        const afterMigration = await readRows(['baseline_files', 'kv']);
        const affectedStores = ['baseline_files', 'baseline_assets', 'translation_workspaces', 'workspace_files', 'workspace_records',
            'translation_drafts', 'storage_migrations', 'revisions_poe2', 'kv'];
        const mutations = [
            ['stats', source => { source[1].stats[0] += '_changed'; }],
            ['variables', source => { source[1].variables[0] += ' 1'; }],
            ['remarks', source => { source[1].remarks[0] = 'real changed remark'; }],
            ['name', source => { source[1].name += '_changed'; }],
            ['filepath', source => { source[1].filepath += '.changed'; }],
            ['English translation', source => { source[1].translations.English[0] += ' changed'; }],
            ['Thai translation', source => { source[1].translations.Thai[0] += ' changed'; }],
            ['German translation', source => { source[1].translations.German[0] = 'Real German change'; }],
            ['removed language', source => { delete source[1].translations.German; }],
            ['removed file', source => { source.pop(); }],
            ['duplicate filepath', source => { source[1].filepath = source[0].filepath; }],
        ];
        const rejected = [];
        for (const [fact, mutate] of mutations) {
            const changedSource = copy(offlineSource); mutate(changedSource);
            const before = await readRows(affectedStores);
            let message;
            try {
                await OfflineStore.saveSourceWorkspaceWithRevisions(changedSource, makeWorkspace(offlineScope, changedSource, 'German'),
                    [{ filepath, lang: 'German', savedAt: 444, translations: ['Must abort'] }], offlineScope,
                    { ...copy(baseline), source: copy(changedSource), rawSource: copy(changedSource) });
            } catch (error) { message = error.message; }
            const after = await readRows(affectedStores);
            rejected.push({ fact, message, unchanged: JSON.stringify(before) === JSON.stringify(after) });
        }
        const offlineMetadataListing = await OfflineStore.listLocalVersions(offlineScope, { metadataOnly: true });
        const offlineFullListing = await OfflineStore.listLocalVersions(offlineScope);
        const legacyBeforeClear = await OfflineStore.listLocalVersions(legacyScope, { metadataOnly: true });
        await OfflineStore.clearWorkspace(legacyScope);
        const legacyMetadataAfterClear = await OfflineStore.listLocalVersions(legacyScope, { metadataOnly: true });
        const legacyFullAfterClear = await OfflineStore.listLocalVersions(legacyScope);
        const afterClear = await readRows(['kv']);
        return {
            languageStatusChanged: onlineSource[0].isMissing !== parse('German')[0].isMissing,
            initialBaselineRows, importedBaselineRows: afterImport.baseline_files.filter(row => row.scope === baseKey),
            migratedBaselineRows: afterMigration.baseline_files.filter(row => row.scope === baseKey), reimportOperations, migrationOperations,
            offlineSaved: offline.staged.German[filepath].translations, migratedSaved: migrated.staged.Thai[filepath].translations,
            preservedOnline, onlineAfter: await OfflineStore.getVersionWorkspace(onlineScope, 'Thai'), preservedHistory,
            historyAfter: await OfflineStore.listRevisions(filepath, 'Thai', 100, onlineScope), checkpoint,
            checkpointAfter: await OfflineStore.getTranslationDraft(OfflineStore.translationDraftKey(draft)),
            legacyEvidence, frozen: Object.fromEntries(afterMigration.kv.filter(row => Object.hasOwn(legacyEvidence, row.key)).map(row => [row.key, row.value])), rejected,
            offlineMetadataListing, offlineFullListing, legacyBeforeClear, legacyMetadataAfterClear, legacyFullAfterClear,
            frozenAfterClear: Object.fromEntries(afterClear.kv.filter(row => Object.hasOwn(legacyEvidence, row.key)).map(row => [row.key, row.value])),
        };
    });
    assert.equal(repeated.languageStatusChanged, true, 'The real parser reproduces the selected-language decoration difference');
    assert.deepEqual(repeated.importedBaselineRows, repeated.initialBaselineRows, 'Offline same-archive reimport retains first accepted baseline bytes');
    assert.deepEqual(repeated.migratedBaselineRows, repeated.initialBaselineRows, 'Another legacy profile reuses immutable baseline bytes');
    for (const [label, operations] of [['same-baseline import', repeated.reimportOperations], ['same-baseline legacy conversion', repeated.migrationOperations]]) {
        assert.equal(operations.filter(operation => operation.store === 'baseline_files' && ['put', 'add', 'delete'].includes(operation.method)).length, 0,
            label + ' never overwrites an existing baseline row');
    }
    assert.deepEqual(repeated.offlineSaved, [''], 'Explicit blank German Saved presence survives a same-archive offline import');
    assert.deepEqual(repeated.migratedSaved, ['Legacy Saved Thai'], 'Legacy staged work survives reuse of the online baseline');
    assert.deepEqual(repeated.onlineAfter, repeated.preservedOnline, 'Other-profile imports cannot change online Saved facts');
    assert.deepEqual(repeated.historyAfter, repeated.preservedHistory, 'Other-profile imports and rejected identity changes preserve original history');
    assert.deepEqual(repeated.checkpointAfter, repeated.checkpoint, 'The first profile retains its exact checkpoint ID, revision and text');
    assert.deepEqual(repeated.frozen, repeated.legacyEvidence, 'Conversion retains frozen legacy evidence exactly');
    assert.equal(repeated.offlineMetadataListing[0].hasSource, true, 'Metadata listing recognizes a normalized-only offline source');
    assert.equal(repeated.offlineFullListing[0].hasSource, true, 'Full listing recognizes a normalized-only offline source');
    assert.equal(repeated.legacyBeforeClear[0].hasSource, true, 'Converted legacy scope remains selectable before deletion');
    assert.equal(repeated.legacyMetadataAfterClear[0].hasSource, false, 'Metadata listing honors normalized ready absence over frozen legacy source');
    assert.equal(repeated.legacyFullAfterClear[0].hasSource, false, 'Full listing honors normalized ready absence over frozen legacy source');
    assert.deepEqual(repeated.frozenAfterClear, repeated.legacyEvidence, 'Clearing normalized work retains frozen legacy recovery evidence');
    for (const rejected of repeated.rejected) {
        assert.match(rejected.message || '', /accepted baseline|baseline identity/, rejected.fact + ' changes must reject the claimed accepted identity');
        assert.equal(rejected.unchanged, true, rejected.fact + ' rejection atomically preserves active pointers, history, work, drafts and baseline');
    }
    results.push({ scenario: 'same PoE2 archive reimport and legacy conversion across profiles and selected languages preserve immutable rows',
        files: repeated.initialBaselineRows.length, rejectedChangedFacts: repeated.rejected.map(result => result.fact) });
    console.log('Validated same-archive offline import, selected-language decorations and atomic rejection of changed immutable facts.');
}

async function keyboardChecks(page, { origin, apiOrigin, secret, results, onPage }) {
    await page.goto(origin + '/?cloudApi=' + encodeURIComponent(apiOrigin));
    await page.waitForFunction(() => window.__normalizedApp?.offlineStoreReady && window.__normalizedApp?.startupReady
        && window.__normalizedApp?._cloud?.state && !window.__normalizedApp._cloudInitializing && !window.__normalizedApp._cloudApplying);
    await page.waitForFunction(() => !window.__normalizedApp?._storageMigrations?.size);
    const fastNotice = await page.evaluate(async () => {
        const vm = window.__normalizedApp, event = { id: 'fixture-fast-migration', kind: 'workspace', scope: { game: vm.gameVersion } };
        vm.storageMigrationChanged({ ...event, state: 'started' });
        vm.storageMigrationChanged({ ...event, state: 'completed', durationMs: 1 });
        await vm.$nextTick();
        return { message: vm.storageMigrationMessage, busy: vm.storageMigrationBusy, visible: !!document.querySelector('.storageMigrationNotice') };
    });
    assert.deepEqual(fastNotice, { message: '', busy: false, visible: false }, 'Quick conversion never flashes a notice');
    await page.evaluate(() => {
        const input = window.__migrationFocusInput = document.createElement('input');
        input.value = 'Preserved selection'; input.setAttribute('aria-label', 'Migration fixture focus'); document.body.append(input);
        input.focus(); input.setSelectionRange(2, 8);
        const vm = window.__normalizedApp;
        vm.storageMigrationChanged({ id: 'fixture-slow-migration', kind: 'workspace', scope: { game: vm.gameVersion }, state: 'started' });
    });
    await page.waitForFunction(() => window.__normalizedApp.storageMigrationBusy && !!document.querySelector('.storageMigrationNotice'));
    const shownNotice = await page.evaluate(() => {
        const vm = window.__normalizedApp, element = document.querySelector('.storageMigrationNotice'), input = window.__migrationFocusInput;
        const themes = ['light', 'grey', 'dark', 'modern-dark'], originalTheme = document.documentElement.getAttribute('data-theme');
        const styles = themes.map(theme => {
            document.documentElement.setAttribute('data-theme', theme);
            const style = getComputedStyle(element);
            return { theme, color: style.color, background: style.backgroundColor, pointerEvents: style.pointerEvents, display: style.display };
        });
        document.documentElement.setAttribute('data-theme', originalTheme);
        return { text: element.textContent, role: element.getAttribute('role'), busy: vm.storageMigrationBusy,
            focusRetained: document.activeElement === input, selection: [input.selectionStart, input.selectionEnd],
            browserWork: vm.browserWorkItems['migration:conversion'], styles };
    });
    assert.match(shownNotice.text, /one-time update/); assert.equal(shownNotice.role, 'status'); assert.equal(shownNotice.busy, true);
    assert.equal(shownNotice.focusRetained, true); assert.deepEqual(shownNotice.selection, [2, 8], 'Slow migration notice preserves selection');
    assert.equal(shownNotice.browserWork, 'Updating existing local work', 'Slow migration activates the established work indicator');
    for (const style of shownNotice.styles) {
        assert.equal(style.pointerEvents, 'none', style.theme + ': migration notice never intercepts pointer input');
        assert.notEqual(style.display, 'none', style.theme + ': migration notice stays visible');
        assert.notEqual(style.color, style.background, style.theme + ': migration notice text differs from its background');
        assert.notEqual(style.background, 'rgba(0, 0, 0, 0)', style.theme + ': migration notice retains its theme background');
    }
    const completedNotice = await page.evaluate(async () => {
        const vm = window.__normalizedApp;
        vm.storageMigrationChanged({ id: 'fixture-slow-migration', state: 'completed', durationMs: 1000 });
        await vm.$nextTick();
        const result = { text: document.querySelector('.storageMigrationNotice').textContent, busy: vm.storageMigrationBusy,
            focusRetained: document.activeElement === window.__migrationFocusInput, browserWork: vm.browserWorkItems['migration:conversion'] };
        clearTimeout(vm._storageMigrationHideTimer); vm._storageMigrationHideTimer = null; vm.storageMigrationMessage = '';
        window.__migrationFocusInput.remove(); delete window.__migrationFocusInput;
        return result;
    });
    assert.match(completedNotice.text, /update complete/); assert.equal(completedNotice.busy, false);
    assert.equal(completedNotice.focusRetained, true); assert.equal(completedNotice.browserWork, undefined);
    results.push({ scenario: 'real Vue slow-conversion notice preserves focus and selection in all four themes' });
    const count = Number(process.env.NORMALIZED_FILE_COUNT || 20000), dictionaryCount = Number(process.env.NORMALIZED_DICTIONARY_COUNT || 8000);
    const imported = await page.evaluate(async ({ secret, count, dictionaryCount }) => {
        const vm = window.__normalizedApp;
        const session = await fetch('/fixture/session', { method: 'POST', headers: { 'X-Fixture-Key': secret } });
        if (!session.ok) throw new Error('Fixture login refused.');
        await vm._cloud.acceptLogin(await session.json()); await vm.cloudApply(vm._cloud.snapshot());
        vm.lang = 'Thai'; vm.needsInitialSettings = false; vm.showSetting = false; vm.inlineEditor = false; vm.hideDNT = false;
        await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
        await vm.activateGameVersion('poe1', { checkMigration: false });
        const source = Array.from({ length: count }, (_, i) => ({ filepath: 'normalized/' + String(i).padStart(5, '0') + '.txt',
            filename: String(i).padStart(5, '0') + '.txt', filedir: 'normalized', stats: ['normalized_' + i], variables: ['#'], remarks: [''],
            translations: { English: ['Damage amount ' + i], Thai: ['Original damage ' + i] }, isDNT: false }));
        // Include one real duplicate-language choice so asset hydration verifies
        // decision content rather than only the presence of an empty array.
        const duplicateText = new TextDecoder('utf-16le').decode(descEncode(source[0]))
            + '\tlang "Thai"\r\n\t1\r\n\t\t# "Alternative damage 0"\r\n';
        const duplicateBytes = new Uint8Array(strEncodeUTF16(duplicateText).buffer), duplicateFile = new Uint8Array(2 + duplicateBytes.length);
        duplicateFile.set([0xff, 0xfe]); duplicateFile.set(duplicateBytes, 2);
        source[0] = parseDesc(source[0].filepath, duplicateText, 'Thai', { strict: true });
        const groups = vm.collectDuplicateLangGroups(source);
        for (const group of groups) group.selectedOptionId = group.options[0].id;
        const decisions = await vm.importDecisionRecords(groups), acceptedSource = await vm.sourceWithImportDecisions(source, decisions);
        const zip = new JSZip();
        for (const desc of source) zip.file(desc.filepath, desc.filepath === source[0].filepath ? duplicateFile : descEncode(desc),
            { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
        const file = new File([await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })], 'NormalizedFixture.zip', { type: 'application/zip' });
        const identity = await vm.readImportZipIdentity(file, zip), copy = value => JSON.parse(JSON.stringify(value));
        window.__normalizedProbe.operations = [];
        await vm.importUpdateZipFile(file, copy(acceptedSource), { identity, rawSource: copy(source), decisions });
        const importOperations = copy(window.__normalizedProbe.operations), scope = vm.managedWorkspaceScope();
        const persisted = await new Promise((resolve, reject) => {
            const opening = indexedDB.open('sdeditor', 9);
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
                const db = opening.result, tx = db.transaction(['translation_workspaces', 'baseline_assets', 'kv'], 'readonly');
                const metadata = tx.objectStore('translation_workspaces').get(NormalizedStore.scopeKey(scope));
                const assets = tx.objectStore('baseline_assets').get(NormalizedStore.baselineKey(scope));
                const keys = tx.objectStore('kv').getAllKeys();
                tx.onerror = () => { db.close(); reject(tx.error); };
                tx.oncomplete = () => { db.close(); resolve({ metadata: metadata.result, assets: assets.result, keys: keys.result }); };
            };
        });
        const cold = await OfflineStore.getWorkspace(scope), accepted = copy(vm.importBaseline.archive);
        vm.dictionary = Array.from({ length: dictionaryCount }, (_, i) => ({ _id: 'normalized_dictionary_' + i, find: 'Keyword' + i, replace: 'คำศัพท์' + i, alts: [] }));
        vm.showSetting = false; vm.needsInitialSettings = false; vm.versionChooserVisible = false; vm.loadingProgress = 100;
        vm.selectAllFileFilters(); vm.applyFileSearch(); vm.currentSort = 'filename'; vm.currentSortDir = 'asc';
        await vm.loadEditorDrafts(); await vm.$nextTick();
        const applyFiles = vm.applyCollaborationFiles;
        vm.applyCollaborationFiles = function (...args) {
            const start = performance.now(), result = applyFiles.apply(this, args), end = performance.now();
            window.__normalizedProbe.events.push({ name: 'applyFiles', at: start, duration: end - start });
            this.$nextTick().then(() => window.__normalizedProbe.events.push({ name: 'applyFiles.painted', at: performance.now() }));
            return result;
        };
        window.__normalizedProbe.operations = []; window.__normalizedProbe.events = [];
        return { ...persisted, scope, accepted, hydratedArchive: copy(cold.importArchive), importOperations };
    }, { secret, count, dictionaryCount });
    assert.equal(Object.hasOwn(imported.metadata.value.importArchive, 'decisions'), false,
        'New workspace metadata never copies accepted duplicate-decision arrays');
    assert.deepEqual(imported.assets.value.archive.decisions, imported.accepted.decisions,
        'Accepted archive decisions are retained separately with baseline assets');
    assert.equal(imported.accepted.decisions.length, 1, 'Fixture preserves a real duplicate-language import decision');
    assert.deepEqual(imported.hydratedArchive, imported.accepted, 'Cold workspace reads hydrate the complete immutable archive descriptor');
    assert.equal(imported.keys.some(key => typeof key === 'string' && /^(workspace_version_v1:|source_version_v1:)/.test(key)
        && key.includes(imported.scope.accountId) && key.includes(imported.scope.sourceHash)), false,
    'A new import creates no aggregate workspace or source payload');
    assert.deepEqual(aggregateOperations(imported.importOperations).filter(operation => ['put', 'add'].includes(operation.method)), [],
        'Source import never duplicates accepted source or workspace arrays into KV');
    results.push({ scenario: 'new import keeps archive assets separate and cold activation hydrates them', decisions: imported.accepted.decisions.length });
    await page.waitForFunction(() => window.__normalizedApp.cloudSignedIn && window.__normalizedApp._collaboration?.connected,
        null, { timeout: 60000 });
    const persistedRoom = await page.evaluate(async () => {
        const client = window.__normalizedApp._collaboration, identity = JSON.parse(JSON.stringify(client.room().identity));
        const metadata = await new Promise((resolve, reject) => {
            const opening = indexedDB.open('sdeditor', 9);
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
                const db = opening.result, tx = db.transaction('collaboration_rooms', 'readonly'), reading = tx.objectStore('collaboration_rooms').get(client.key);
                tx.onerror = () => { db.close(); reject(tx.error); };
                tx.oncomplete = () => { db.close(); resolve(reading.result?.value); };
            };
        });
        const cold = await OfflineStore.getCollaborationState({ key: client.key, scope: identity });
        return { metadata, archive: cold.rooms[client.key]?.archive };
    });
    assert.equal(Object.hasOwn(persistedRoom.metadata.archive, 'decisions'), false, 'Room metadata excludes accepted duplicate-decision arrays');
    assert.deepEqual(persistedRoom.archive, imported.accepted, 'Cold room reads hydrate the complete accepted archive with its decision');
    results.push({ scenario: 'room metadata stays compact and cold room archive hydration preserves decisions' });
    const polling = await page.evaluate(async () => {
        const client = window.__normalizedApp._collaboration;
        await client.syncDropped(client.epoch, { force: true });
        window.__normalizedProbe.operations = [];
        await client.sync({ background: true });
        await client.syncDropped(client.epoch, { force: true });
        return window.__normalizedProbe.operations;
    });
    assert.equal(polling.filter(operation => ['put', 'add', 'delete'].includes(operation.method)).length, 0,
        'Healthy polling and unchanged Dropped refreshes perform no writes');
    assertNoAssetReads(polling, 'Healthy polling');
    results.push({ scenario: 'unchanged translation and Dropped polling', writes: 0 });
    const path = i => 'normalized/' + String(i).padStart(5, '0') + '.txt';
    const field = (inline, filepath) => inline ? page.locator('tr[data-filepath="' + filepath + '"] .textHL input:not([readonly]), tr[data-filepath="'
        + filepath + '"] .textHL textarea:not([readonly])').first() : page.locator('.editor .textHL input:not([readonly]), .editor .textHL textarea:not([readonly])').first();
    for (const [i, navigation] of [
        { key: 'F2', from: 0, to: 1, inline: false }, { key: 'F1', from: 4, to: 3, inline: false },
        { key: 'Control+ArrowDown', from: 10, to: 11, inline: true }, { key: 'Control+ArrowUp', from: 14, to: 13, inline: true },
    ].entries()) {
        const outgoing = path(navigation.from), target = path(navigation.to);
        await page.evaluate(async ({ inline, outgoing }) => {
            const vm = window.__normalizedApp; vm._fileTableReturnFocus = false; await vm.editorExit(); await vm.$nextTick();
            vm.inlineEditor = inline; vm.inlineSidebarVisible = false; await vm.$nextTick();
            if (!inline) return vm.editFile(outgoing, true);
            const position = vm.filteredDescs.findIndex(row => row.filepath === outgoing);
            vm.currentPage = Math.floor(position / vm.pageSize) + 1; vm.selectFileRow(outgoing); await vm.$nextTick();
        }, { inline: navigation.inline, outgoing });
        if (navigation.inline) await page.locator('tr[data-filepath="' + outgoing + '"] .inlineSourceCell').click();
        await field(navigation.inline, outgoing).fill('Saved with ' + navigation.key);
        await page.evaluate(() => { window.__normalizedProbe.mode = 'hold'; window.__normalizedProbe.operations = [];
            window.__normalizedProbe.workerOperations = []; window.__normalizedProbe.events = []; });
        const start = Date.now(); await page.keyboard.press(navigation.key);
        await page.waitForFunction(filepath => {
            const vm = window.__normalizedApp;
            return vm.editorCurrentEditingDesc?.filepath === filepath && !vm.editorLoading && !vm.navigationBusy && !vm.inlineTransitionBusy;
        }, target);
        const readyMs = Date.now() - start;
        assert.equal(await field(navigation.inline, target).evaluate(element => element === document.activeElement), true, navigation.key + ': destination has focus');
        const typed = 'New target typing ' + i;
        await field(navigation.inline, target).fill(typed);
        await page.evaluate(() => window.__normalizedProbe.release());
        await page.waitForFunction(() => !window.__normalizedApp.pendingLocalSaves && !window.__normalizedApp._pendingSaves?.snapshot().jobs.length);
        assert.equal(await field(navigation.inline, target).inputValue(), typed, navigation.key + ': incoming typing survives outgoing acknowledgment');
        await page.waitForFunction(() => !window.__normalizedApp._collaboration?.snapshot({ includeFiles: false }).pending);
        const operations = await page.evaluate(() => window.__normalizedProbe.workerOperations);
        const acknowledgments = await page.evaluate(() => window.__normalizedProbe.operations);
        const timing = await page.evaluate(() => {
            const events = window.__normalizedProbe.events, started = events.find(event => event.name === 'worker.start'),
                saved = events.find(event => event.name === 'saved'), applied = saved && events.find(event => event.name === 'applyFiles' && event.at >= saved.at),
                painted = applied && events.find(event => event.name === 'applyFiles.painted' && event.at >= applied.at);
            return { localCommitMs: started && saved ? saved.at - started.at : null, ackProcessingMs: applied?.duration ?? null,
                ackPaintMs: saved && painted ? painted.at - saved.at : null };
        });
        assert.deepEqual(aggregateOperations(acknowledgments), [], navigation.key + ': online acknowledgment avoids aggregate KV records');
        assertNoAssetReads(acknowledgments, navigation.key + ': online acknowledgment');
        assert.equal(acknowledgments.some(operation => operation.store === 'baseline_files' && operation.method === 'getAll'), false,
            navigation.key + ': online synchronization never reads the complete source');
        assert.deepEqual(aggregateOperations(operations), [], navigation.key + ': worker avoids aggregate KV records');
        assertNoAssetReads(operations, navigation.key + ': worker');
        const bytes = operations.reduce((total, operation) => total + operation.bytes, 0);
        assert.ok(bytes < 65536, navigation.key + ': one-file commit payload is bounded with 20,000 unrelated files');
        const saved = await page.evaluate(async filepath => {
            const vm = window.__normalizedApp, workspace = await OfflineStore.getWorkspace(vm.managedWorkspaceScope());
            return workspace.staged.Thai[filepath]?.translations;
        }, outgoing);
        assert.deepEqual(saved, ['Saved with ' + navigation.key]);
        await page.evaluate(async () => {
            const vm = window.__normalizedApp;
            vm.editorBlocks[0].translation = vm.editorCurrentEditingDesc.translations.Thai[0]; await vm.flushEditorDraft();
        });
        results.push({ scenario: navigation.key, files: count, dictionaryEntries: dictionaryCount, readyMs,
            saveOperations: operations.length, saveBytes: bytes, ...timing });
    }
    // Close without beforeunload after the journal is durable but before the
    // worker receives the command. The same profile must resume that exact job.
    const crashPath = path(20), submittedText = 'Submitted before fixture crash';
    await page.evaluate(async filepath => {
        const vm = window.__normalizedApp; vm._fileTableReturnFocus = false; await vm.editorExit(); await vm.$nextTick();
        vm.inlineEditor = false; await vm.$nextTick(); await vm.editFile(filepath, true);
    }, crashPath);
    await field(false, crashPath).fill(submittedText);
    await page.evaluate(() => { window.__normalizedProbe.mode = 'hold'; window.__normalizedProbe.held = []; });
    await page.keyboard.press('F2');
    await page.waitForFunction(() => window.__normalizedProbe.held.length > 0);
    const queued = await page.evaluate(async () => OfflineStore.listSaveSubmissions(window.__normalizedApp.pendingSaveScope()));
    assert.equal(queued.length, 1, 'Submitted intent is durable before worker dispatch');
    const originalJobId = queued[0].batch.jobId, context = page.context();
    await page.close({ runBeforeUnload: false });
    const restored = await context.newPage();
    onPage?.(restored);
    await restored.goto(origin + '/?cloudApi=' + encodeURIComponent(apiOrigin));
    await restored.waitForFunction(() => window.__normalizedApp?.offlineStoreReady && window.__normalizedApp?.startupReady
        && window.__normalizedApp?.cloudSignedIn && !window.__normalizedApp._cloudInitializing && !window.__normalizedApp._cloudApplying);
    // Startup intentionally opens the game/version chooser. Return to the
    // captured workspace just as the user does before replaying its saves.
    assert.equal(await restored.evaluate(async sourceHash => {
        const vm = window.__normalizedApp; await vm.activateGameVersion('poe1', { checkMigration: false });
        return vm.managedActivateWorkspace(sourceHash, 'Thai');
    }, queued[0].batch.sourceHash), true, 'Reload activates the original submitted-save scope');
    await restored.waitForFunction(jobId => window.__normalizedApp?.offlineStoreReady && window.__normalizedApp?.sourceLoaded
        && window.__normalizedProbe.events.some(event => event.name === 'dispatch' && event.id === jobId)
        && !window.__normalizedApp.pendingLocalSaves && !window.__normalizedApp._pendingSaves?.snapshot().jobs.length,
    originalJobId, { timeout: 60000 });
    const recovery = await restored.evaluate(async ({ filepath, jobId }) => {
        const vm = window.__normalizedApp, scope = vm.managedWorkspaceScope(), workspace = await OfflineStore.getWorkspace(scope);
        return { translations: workspace.staged.Thai[filepath]?.translations,
            jobs: await OfflineStore.listSaveSubmissions(vm.pendingSaveScope()),
            history: await OfflineStore.listRevisions(filepath, 'Thai', 100, scope),
            recoveredIds: window.__normalizedProbe.events.filter(event => event.name === 'dispatch').map(event => event.id), jobId };
    }, { filepath: crashPath, jobId: originalJobId });
    assert.deepEqual(recovery.translations, [submittedText], 'Reload resumes durably submitted text');
    assert.deepEqual(recovery.jobs, [], 'Recovered submission has been consumed');
    assert.equal(recovery.history.filter(row => row.note === 'save').length, 1, 'Recovery produces exactly one saved history revision');
    assert.ok(recovery.recoveredIds.includes(originalJobId), 'Recovery reuses the original job ID');
    results.push({ scenario: 'crash before worker dispatch and same-ID reload recovery' });
    await associatedCachedWorkspaceCheck(restored, results, { filepath: crashPath });
    await restored.close();
}

async function associatedCachedWorkspaceCheck(page, results, { filepath }) {
    await page.waitForFunction(() => window.__normalizedApp._collaboration?.connected
        && !window.__normalizedApp._collaboration.snapshot({ includeFiles: false }).pending,
        null, { timeout: 60000 });
    await page.context().setOffline(true);
    await page.evaluate(async filepath => {
        const vm = window.__normalizedApp, scope = vm.managedWorkspaceScope();
        const copy = value => JSON.parse(JSON.stringify(value));
        await OfflineStore.setVersionMetadata(scope, { catalogVersionId: 'fixture-cached-published', officialName: 'Cached fixture HEAD' });
        if (!await vm.showVersionChooser()) throw new Error('Fixture could not show source chooser.');
        const probe = window.__cachedContinueProbe = { scope, requests: [], importCount: 0,
            beforeWorkspace: copy(await OfflineStore.getWorkspace(scope)), beforeHistory: copy(await OfflineStore.listRevisions(filepath, 'Thai', 100, scope)) };
        const importSource = probe.originalImportSource = OfflineStore.saveSourceWorkspaceWithRevisions;
        OfflineStore.saveSourceWorkspaceWithRevisions = (...args) => { probe.importCount++; return importSource(...args); };
        probe.originalCloudRequest = vm._cloud.request;
        vm._cloud.request = function (path, ...args) { probe.requests.push(path); return probe.originalCloudRequest.call(this, path, ...args); };
        window.__normalizedProbe.operations = [];
        await vm.$nextTick();
    }, filepath);
    const panel = page.getByRole('region', { name: 'Offline workspace' });
    assert.match(await panel.innerText(), /matches a published version/,
        'The Offline panel explains why the matching imported workspace appears under Online');
    assert.doesNotMatch(await panel.innerText(), /No offline workspace is stored/,
        'A locally cached associated workspace is not described as absent');
    const start = Date.now();
    await panel.getByRole('button', { name: 'Continue cached workspace', exact: true }).click();
    await page.waitForFunction(() => {
        const vm = window.__normalizedApp, scope = window.__cachedContinueProbe.scope;
        return !vm.versionChooserVisible && !vm.versionStorageLoading && vm.sourceLoaded && vm.sourceIdentity === scope.sourceHash;
    });
    const readyMs = Date.now() - start;
    const continuation = await page.evaluate(async filepath => {
        const vm = window.__normalizedApp, probe = window.__cachedContinueProbe, copy = value => JSON.parse(JSON.stringify(value));
        const result = { beforeWorkspace: probe.beforeWorkspace, afterWorkspace: copy(await OfflineStore.getWorkspace(probe.scope)),
            beforeHistory: probe.beforeHistory, afterHistory: copy(await OfflineStore.listRevisions(filepath, 'Thai', 100, probe.scope)),
            originalScope: probe.scope, activeScope: vm.managedWorkspaceScope(), imports: probe.importCount, requests: probe.requests,
            operations: copy(window.__normalizedProbe.operations) };
        OfflineStore.saveSourceWorkspaceWithRevisions = probe.originalImportSource;
        vm._cloud.request = probe.originalCloudRequest; delete window.__cachedContinueProbe;
        return result;
    }, filepath);
    assert.deepEqual(continuation.activeScope, continuation.originalScope, 'Continue cached workspace retains the original account/game/branch/source');
    const workspaceFacts = workspace => {
        const facts = JSON.parse(JSON.stringify(workspace));
        // Applying accepted collaboration state can refresh a staged save's
        // server timestamp. Every other committed and recovery fact is stable.
        for (const files of Object.values(facts.staged || {})) for (const file of Object.values(files)) delete file.savedAt;
        return facts;
    };
    assert.deepEqual(workspaceFacts(continuation.afterWorkspace), workspaceFacts(continuation.beforeWorkspace),
        'Offline cached continuation retains every Saved presence/text/base and recovery/provenance fact');
    assert.deepEqual(continuation.afterHistory, continuation.beforeHistory, 'Cached continuation creates no duplicate or changed history');
    assert.equal(continuation.imports, 0, 'Continue cached workspace never reimports the source');
    assert.equal(continuation.requests.some(path => /\/original(?:$|\?)/.test(path)), false, 'Continue cached workspace never downloads the original ZIP');
    assert.equal(continuation.operations.some(operation => operation.store === 'baseline_files' && ['put', 'add', 'delete'].includes(operation.method)), false,
        'Continue cached workspace never rewrites immutable baseline rows');
    results.push({ scenario: 'authenticated associated cached workspace button resumes exact Saved work and history without reimport or ZIP download', readyMs });
    await page.context().setOffline(false);
}

module.exports = { runFixture, aggregateOperations };
if (require.main === module) runFixture({ storageOnly: process.argv.includes('--storage-only') }).catch(error => { console.error(error); process.exitCode = 1; });
