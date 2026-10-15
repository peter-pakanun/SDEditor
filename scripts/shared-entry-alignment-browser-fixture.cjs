// Real normalized IndexedDB + save worker acceptance on a disposable browser origin.
// Optional SDEDITOR_GERMAN_ZIP uses the four reported upstream entries verbatim.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { readFileSync, existsSync, mkdirSync, mkdtempSync } = require('node:fs');
const { resolve, join } = require('node:path');

const runtimeModules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [runtimeModules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!executablePath) throw new Error('No installed Edge/Chrome found. Set FIXTURE_BROWSER_PATH.');
const cases = [
    { filepath: 'advanced_mod_stat_descriptions/000010_local_unique_jewel_alternate_tree_version.txt', count: 11, overflow: 23 },
    { filepath: 'stat_descriptions/000001_local_unique_jewel_alternate_tree_version.txt', count: 11, overflow: 28 },
    { filepath: 'stat_descriptions/014850_fishing_lure_type.txt', count: 1, overflow: 7 },
    { filepath: 'stat_descriptions/map_elder_boss_variation.txt', count: 1, overflow: 4 },
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function attachSharedClient() {
    const vm = window.__sharedAlignmentApp;
    // A fixture-only account identity makes ordinary UI captures and the sparse
    // room agree; signed-in state stays false and no authentication is used.
    vm.cloudUser = { id: 'guest', language: 'German', role: 'translator', assignmentVersion: 1 };
    await vm.$nextTick();
    clearTimeout(vm._collabStartTimer);
    const client = new CollaborationSync.Client({ store: OfflineStore, WebSocket: null,
        request: async () => { throw new Error('Unexpected live cloud request in shared alignment fixture.'); },
        presenceEnabled: () => false,
        onChange: state => vm.collabReceiveState(state),
        onRemote: files => vm.receiveCollaborationFiles(files, 'German'),
        onRemoteDropped: (records, snapshot) => vm.applyRemoteDropped(records, 'German', snapshot),
    });
    vm._collaboration = client;
    const source = vm.toPlainForStorage(vm.workspaceSource());
    await client.connectSparse({ accountId: vm.managedWorkspaceScope().accountId, game: 'poe1', language: 'German',
        baselineSource: source, archive: vm.toPlainForStorage(vm.importBaseline.archive),
        workspace: vm.toPlainForStorage(vm.localDescs), files: [], deferRemote: true });
    return client.snapshot({ includeFiles: false });
}

async function run() {
    const fromApi = createRequire(resolve(__dirname, '../../SDEditor-API/package.json'));
    let fixtureZip, originalHash;
    if (process.env.SDEDITOR_GERMAN_ZIP) {
        const JSZip = fromApi('jszip'), original = readFileSync(process.env.SDEDITOR_GERMAN_ZIP);
        originalHash = digest(original);
        const zip = await JSZip.loadAsync(original), subset = new JSZip();
        for (const { filepath } of cases) {
            assert.ok(zip.file(filepath), 'Reported entry exists in supplied ZIP: ' + filepath);
            subset.file(filepath, await zip.file(filepath).async('uint8array'), { createFolders: false });
        }
        fixtureZip = await subset.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    }
    const express = require('express'), app = express(), server = createServer(app);
    const publicDir = resolve(__dirname, '../public');
    app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    app.get('/', (req, res) => res.type('html').send(readFileSync(join(publicDir, 'index.html'), 'utf8')
        .replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/fixture/jszip.min.js')));
    app.get('/fixture/jszip.min.js', (req, res) => res.type('js').send(readFileSync(fromApi.resolve('jszip/dist/jszip.min.js'))));
    app.get('/fixture/source.zip', (req, res) => fixtureZip ? res.type('application/zip').send(fixtureZip) : res.sendStatus(404));
    app.get('/index.js', (req, res) => res.type('js').send(readFileSync(join(publicDir, 'index.js'), 'utf8')
        .replace("app.mount('#app');", "window.__sharedAlignmentApp = app.mount('#app');")));
    app.use('/v1', (req, res) => res.status(503).json({ error: 'Cloud disabled in local fixture.' }));
    app.use(express.static(publicDir));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    const errors = [];
    try {
        const tempDir = resolve(__dirname, '../temp');
        mkdirSync(tempDir, { recursive: true });
        const profile = mkdtempSync(join(tempDir, 'shared-entry-alignment-'));
        const context = browser = await chromium.launchPersistentContext(profile, { executablePath, headless: true,
            args: ['--disable-gpu'], viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const ready = () => page.waitForFunction(() => {
            const vm = window.__sharedAlignmentApp;
            return vm?.offlineStoreReady && vm.startupReady && vm._cloud?.state && !vm._cloudInitializing && !vm._cloudApplying;
        }, null, { timeout: 30000 });
        await page.goto(origin + '/?cloudApi=' + encodeURIComponent(origin));
        await ready();
        await page.evaluate(async ({ cases, supplied }) => {
            const vm = window.__sharedAlignmentApp, copy = value => JSON.parse(JSON.stringify(value));
            if (vm.testMode || vm.cloudSignedIn) throw new Error('Requires signed-out normal mode.');
            vm._cloudApplying = true;
            try {
                const previous = vm.lang;
                vm.lang = 'German'; vm.inlineEditor = false;
                await vm.$nextTick(); await vm._cloud.selectLanguage('German', vm.cloudPayload(), previous);
                await vm.cloudApply(vm._cloud.snapshot());
            } finally { vm._cloudApplying = false; }
            vm.lang = 'German'; vm.inlineEditor = false; vm.hideDNT = false; vm.dictionary = []; vm.editorRegexes = [];
            await vm.saveSettings(); await OfflineStore.setMigratedFromSingleVersion(true);
            vm.showSetting = false; vm.needsInitialSettings = false;
            await vm.activateGameVersion('poe1', { checkMigration: false });
            let zip, source, bytes;
            if (supplied) {
                bytes = new Uint8Array(await (await fetch('/fixture/source.zip')).arrayBuffer());
                zip = await JSZip.loadAsync(bytes);
                source = await Promise.all(cases.map(item => parseFile(item.filepath, zip.file(item.filepath), 'German')));
            } else {
                source = cases.map(({ filepath, count, overflow }, caseIndex) => ({ filepath,
                    filedir: filepath.slice(0, filepath.lastIndexOf('/')), filename: filepath.slice(filepath.lastIndexOf('/') + 1),
                    name: '', stats: ['shared_alignment_' + caseIndex], variables: Array.from({ length: count }, () => '#'),
                    remarks: Array.from({ length: count }, () => ''), isDNT: false,
                    translations: { English: Array.from({ length: count }, (_, i) => 'Current English ' + caseIndex + ' entry ' + i),
                        German: Array.from({ length: overflow }, (_, i) => 'Deutscher Block ' + caseIndex + ' Eintrag ' + i) } }));
                zip = new JSZip();
                for (const desc of source) zip.file(desc.filepath, descEncode(desc), { createFolders: false });
                bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
            }
            for (const [index, item] of cases.entries()) {
                if (source[index]?.translations.English.length !== item.count || source[index]?.translations.German?.length !== item.overflow)
                    throw new Error('Unexpected reported ZIP entry counts: ' + item.filepath);
            }
            window.__sharedAlignmentOriginal = copy(source);
            window.__sharedAlignmentZipHash = await CollaborationProtocol.zipHash(bytes);
            const file = new File([bytes], 'SharedGermanAlignmentFixture.zip', { type: 'application/zip' });
            const identity = await vm.readImportZipIdentity(file, zip);
            await vm.importUpdateZipFile(file, copy(source), { identity, rawSource: copy(source) });
            vm.localDescs.workspaceOrigin = 'online';
            await OfflineStore.updateWorkspace(() => vm.toPlainForStorage(vm.localDescs), vm.managedWorkspaceScope(),
                { filepaths: cases.map(item => item.filepath), includeDropped: true, command: 'fixture-online-origin' });
            vm.showSetting = false; vm.needsInitialSettings = false; vm.selectAllFileFilters(); vm.applyFileSearch();
            await vm.loadEditorDrafts(); await vm.$nextTick();
        }, { cases, supplied: !!fixtureZip });
        await page.evaluate(attachSharedClient);
        await page.evaluate(async () => {
            const vm = window.__sharedAlignmentApp, copy = value => JSON.parse(JSON.stringify(value));
            const candidates = window.__sharedAlignmentOriginal.map((desc, index) => {
                const workspace = copy(vm.localDescs);
                return WorkspaceState.dropTranslation(workspace, desc, 'German', { id: 'shared-alignment-' + index,
                    ownership: 'online', revision: 5 + index, game: 'poe1', originSourceHash: 'e'.repeat(64),
                    originSourceAvailable: false, targetSourceHash: vm.sourceIdentity,
                    reason: 'Shared recovery after deleted source entries' });
            });
            await vm._collaboration.receiveDropped(candidates, vm._collaboration.epoch, { acknowledge: true });
        });
        const snapshot = () => page.evaluate(async () => {
            const vm = window.__sharedAlignmentApp;
            return { identity: vm.sourceIdentity, baseline: await OfflineStore.getSource(vm.managedWorkspaceScope()),
                source: vm.toPlainForStorage(vm.workspaceSource()), archive: vm.toPlainForStorage(vm.importBaseline.archive) };
        });
        const original = await snapshot();
        const report = [];
        for (const item of cases) {
            assert.equal(await page.evaluate(filepath => window.__sharedAlignmentApp.editFile(filepath, true), item.filepath), true);
            await page.waitForFunction(filepath => {
                const vm = window.__sharedAlignmentApp;
                return vm.editorCurrentEditingDesc?.filepath === filepath && !!vm.entryAlignment && !vm.editorLoading;
            }, item.filepath);
            const retained = await page.evaluate(async ({ filepath, count, overflow }) => {
                const vm = window.__sharedAlignmentApp;
                const raw = window.__sharedAlignmentOriginal.find(desc => desc.filepath === filepath).translations.German;
                const base = vm._collaboration.fileBase(filepath);
                if (base.translations.length !== count || raw.length !== overflow || base.trackedForExport)
                    throw new Error('Requires the unchanged count-limited unstaged shared baseline.');
                if (vm.editorDroppedCandidate?.ownership !== 'online') throw new Error('Shared recovery was not selected.');
                if (!vm.startEntryAlignment('dropped')) throw new Error('Could not align Shared recovery.');
                for (let i = 0; i < count; i++) vm.mutateEntryAlignment('assign', i, i);
                for (let i = count; i < overflow; i++) vm.mutateEntryAlignment('setObsolete', i, true);
                if (!await vm.applyEntryAlignment()) throw new Error('Could not retain aligned draft: ' + vm.entryAlignmentError);
                const draft = await OfflineStore.getTranslationDraft(vm.editorDraftKey(vm.editorDraftScope(filepath)));
                const workspace = await OfflineStore.getWorkspace(vm.managedWorkspaceScope());
                return { draft, committed: [...vm.getDescByFilepath(filepath).translations.German],
                    candidate: WorkspaceState.droppedForFile(workspace, filepath, 'German'),
                    staged: workspace.staged?.German?.[filepath] || null, sharedBase: base };
            }, item);
            const raw = original.source.find(desc => desc.filepath === item.filepath).translations.German;
            assert.deepEqual(retained.committed, raw, 'Alignment does not change committed overflow');
            assert.equal(retained.staged, null, 'Continue editing does not stage');
            assert.equal(retained.candidate.ownership, 'online');
            assert.deepEqual(retained.draft.translations, raw.slice(0, item.count));
            assert.deepEqual(retained.draft.base.translations, raw.slice(0, item.count));
            assert.ok(retained.draft.alignmentRecovery.some(row => JSON.stringify(row.translations) === JSON.stringify(raw)));
            await page.getByRole('button', { name: 'Close', exact: true }).first().click();
            assert.equal(await page.evaluate(filepath => window.__sharedAlignmentApp.editFile(filepath, true), item.filepath), true);
            await page.waitForFunction(filepath => {
                const vm = window.__sharedAlignmentApp;
                return vm.editorCurrentEditingDesc?.filepath === filepath && vm.editorReady && !vm.editorLoading;
            }, item.filepath);
            assert.deepEqual(await page.evaluate(() => window.__sharedAlignmentApp.serializeEditorTranslations()), raw.slice(0, item.count),
                'Reopening recovers the durable aligned draft');
            const saveResult = await page.evaluate(async () => {
                const vm = window.__sharedAlignmentApp, result = await vm.editorSave({ close: true, defer: false });
                return { result, notice: vm.collaborationNotice, error: vm.localSaveError,
                    readonly: vm.editorTranslationReadOnly, loadError: vm.editorLoadError,
                    alignment: !!vm.entryAlignment, findings: vm.inlineDraftFindings[vm.editorCurrentEditingDesc.filepath] };
            });
            assert.equal(saveResult.result, true,
                'Aligned retained draft saves against raw original + count-limited shared base: ' + JSON.stringify(saveResult));
            await page.waitForFunction(() => {
                const vm = window.__sharedAlignmentApp;
                return !vm.pendingLocalSaves && !vm._pendingSaves.snapshot().jobs.length;
            });
            const saved = await page.evaluate(async filepath => {
                const vm = window.__sharedAlignmentApp, client = vm._collaboration, scope = vm.managedWorkspaceScope();
                const workspace = await OfflineStore.getWorkspace(scope);
                const candidate = WorkspaceState.droppedForFile(workspace, filepath, 'German');
                const operation = client.room().outbox.find(op => op.files.some(entry => entry.yours.filepath === filepath));
                if (!operation) throw new Error('Save did not create a durable shared operation.');
                await client.prepare(operation.id, client.epoch);
                const records = await OfflineStore.getCollaborationRecords({ key: client.key, scope,
                    filepaths: [filepath], includeOutbox: true, includeDropped: true });
                const archived = workspace.droppedArchive['shared-alignment-' + window.__sharedAlignmentOriginal.findIndex(desc => desc.filepath === filepath)];
                return { stage: workspace.staged.German[filepath], candidate, archived,
                    revisions: await OfflineStore.listRevisions(filepath, 'German', 100, scope),
                    operation: records.room.outbox.find(op => op.id === operation.id),
                    worker: !!vm._saveWorker?.worker && !vm._saveWorker.fallback,
                    committed: [...vm.getDescByFilepath(filepath).translations.German],
                    draft: await OfflineStore.getTranslationDraft(vm.editorDraftKey(vm.editorDraftScope(filepath))) };
            }, item.filepath);
            assert.equal(saved.worker, true, 'Real save worker acknowledged the transaction');
            assert.deepEqual(saved.stage.translations, raw.slice(0, item.count));
            assert.deepEqual(saved.committed, raw.slice(0, item.count));
            assert.equal(saved.candidate, null, 'Explicit Save resolved the reviewed Shared recovery');
            assert.equal(saved.archived.status, 'promoted');
            assert.deepEqual(saved.archived.snapshot.translations, raw, 'Resolved archive retains every original block');
            assert.ok(saved.revisions.some(row => row.note === 'Before entry alignment' && JSON.stringify(row.translations) === JSON.stringify(raw)),
                'Complete overflow is durable in original alignment history');
            assert.deepEqual(saved.operation.files[0].base.translations, retained.sharedBase.translations,
                'Shared wire base keeps its original current-count contract');
            assert.deepEqual(saved.operation.wire.files[0].translations, raw.slice(0, item.count));
            assert.equal(saved.operation.wire.promoteDropped.id, retained.candidate.id);
            assert.equal(saved.operation.wire.promoteDropped.revision, retained.candidate.revision);
            assert.equal(saved.draft.state, 'promoted');
            assert.deepEqual(await snapshot(), original, 'ZIP descriptor, immutable baseline and English remain unchanged');
            report.push({ filepath: item.filepath, before: item.overflow, after: item.count, sharedRecovery: 'resolved' });
        }
        const exported = await page.evaluate(async () => {
            const vm = window.__sharedAlignmentApp;
            window.saveAs = blob => { window.__sharedAlignmentExport = blob; };
            await vm.exportZip(false);
            if (!window.__sharedAlignmentExport) throw new Error('Saved translation export was not produced.');
            const zip = await JSZip.loadAsync(window.__sharedAlignmentExport);
            return Promise.all(window.__sharedAlignmentOriginal.map(async original => {
                const desc = await parseFile(original.filepath, zip.file(original.filepath), 'German');
                return { filepath: desc.filepath, english: desc.translations.English, german: desc.translations.German };
            }));
        });
        for (const item of exported) {
            const source = original.source.find(desc => desc.filepath === item.filepath);
            assert.deepEqual(item.english, source.translations.English);
            assert.deepEqual(item.german, source.translations.German.slice(0, source.translations.English.length));
        }
        assert.deepEqual(errors, [], 'No uncaught browser errors');
        if (originalHash) assert.equal(digest(readFileSync(process.env.SDEDITOR_GERMAN_ZIP)), originalHash, 'Supplied ZIP bytes remain unchanged');
        console.log(JSON.stringify({ ok: true, input: fixtureZip ? 'supplied ZIP entries' : 'synthetic reported counts',
            ...(originalHash ? { originalZipSha256: originalHash } : {}), files: report,
            verified: 'Normalized IndexedDB, real save worker, retained drafts, Shared recovery promotion, full original history, immutable baseline, exact wire counts and parsed export' }, null, 2));
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
