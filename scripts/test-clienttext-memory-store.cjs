const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../public/clientTextState.js');
const CT = require('../public/clientTextStore.js');
const Memory = require('../public/clientTextMemoryStore.js');
const A = require('../public/contentAdapters.js');

const scope = { accountId: 'manager', game: 'poe2', branchId: 'default', versionId: 'local-version', groupId: 'local:test:first', language: 'Thai' };
const textId = JSON.stringify(['Text', null]);
const formId = JSON.stringify(['Display Name', 'Normal Translation']);
const classId = JSON.stringify(['Text', 'StrFour']);
function unit(recordId = 'ID') {
    return { id: JSON.stringify(['normal', 'ClientStrings', recordId]), role: 'normal', sheet: 'ClientStrings', recordId,
        fields: [{ id: textId, name: 'Text', kind: 'text', source: 'Source {0}', target: 'Original {0}', required: true, sourceCell: 'B2', targetCell: 'C2' },
            { id: formId, name: 'Display Name', kind: 'form', form: 'Normal Translation', source: 'Name', target: 'Name target', required: true },
            { id: classId, name: 'Text', kind: 'form', form: 'StrFour', source: 'Class source', target: '', required: false }],
        developerNotes: 'Notes remain original', metadata: { native: 'preserved' } };
}
const asset = { role: 'normal', name: 'Thai.xlsm', hash: 'a'.repeat(64), parserVersion: S.PARSER_VERSION,
    blob: new Blob([new Uint8Array([0, 255, 13, 10, 42])]), parsed: { version: 1, filename: 'Thai.xlsm', parserVersion: S.PARSER_VERSION,
        format: 'xlsm', artifactHash: 'a'.repeat(64), sheets: [{ name: 'ClientStrings', path: 'xl/worksheets/sheet1.xml' }] } };
async function prepared(options = {}) {
    const store = options.store || Memory.create(options.dependencies), original = options.original || unit();
    const inputs = { units: [original], assets: [{ ...asset, parsed: { ...asset.parsed, units: [original] } }], metadata: { name: 'Offline sheet' } };
    const metadata = await store.import(options.scope || scope, inputs);
    return { store, original, metadata };
}
const values = (original = unit(), target = 'Saved {0}') => ({ ...S.valuesFor(original), [textId]: target });

test('previous workbook comparisons create source-only import history, Outdated and verified audio-marker reviews', async () => {
    for (const [before, after, orange, outdated] of [
        ['Old dialogue', 'New dialogue', false, true],
        ['Dialogue', '[NOAUDIO] Dialogue', true, false],
        ['[OLD AUDIO] Dialogue', '[AUDIOTEST] Dialogue', true, false],
        ['Dialogue', '[NOAUDIO] Different dialogue', true, true],
        ['Dialogue', '[NOAUDIO]  Dialogue', true, true],
        ['[NOAUDIO]', '[NOAUDIO]', false, false]
    ]) {
        const store = Memory.create(), previousScope = { ...scope, versionId: 'old', groupId: 'local:test:old' },
            previous = unit(), current = unit();
        previous.fields[0].source = before; previous.fields[0].target = 'Previous translation';
        current.fields[0].source = after; current.fields[0].target = 'Current translation'; current.fields[0].outdated = orange;
        const oldSnapshot = S.copy(previous), newSnapshot = S.copy(current);
        await prepared({ store, original: previous, scope: previousScope });
        await prepared({ store, original: current });
        await store.seedPreviousVersion(scope, previousScope);
        const saved = (await store.getSaved(scope))[current.id], status = S.statusFor(current, saved), history = await store.listHistory(scope, current.id);
        assert.equal(status.outdated, outdated, before + ' -> ' + after); assert.equal(status.saved, false);
        assert.equal(S.valuesFor(current, saved)[textId], 'Current translation');
        if (before !== after) {
            assert.equal(history.length, 1); assert.equal(history[0].origin, 'version_import');
            assert.equal(history[0].after.saved, false); assert.equal(history[0].after.provenance.groupId, previousScope.groupId);
            if (!outdated) assert.equal(saved.reviewed[textId], S.sourceHash(after));
        } else assert.equal(history.length, 0);
        await store.seedPreviousVersion(scope, previousScope);
        assert.equal((await store.listHistory(scope, current.id)).length, history.length, 'seeding is idempotent');
        assert.deepEqual(await store.getUnit(previousScope, previous.id), oldSnapshot);
        assert.deepEqual(await store.getUnit(scope, current.id), newSnapshot);
        assert.equal((await store.listWorkspaces({ language: scope.language })).length, 2);
        assert.deepEqual(await store.listWorkspaces({ language: 'German' }), []);
        if (outdated) {
            await store.save(scope, current.id, { jobId: 'review', values: S.valuesFor(current), reviewed: { [textId]: S.sourceHash(after) } });
            assert.equal(S.statusFor(current, (await store.getSaved(scope))[current.id]).outdated, false);
            assert.equal((await store.listHistory(scope, current.id)).length, 2);
        }
    }
});

test('previous comparisons fence every scope and cancel atomically without publishing partial history', async () => {
    for (const dimension of ['accountId', 'game', 'branchId', 'language']) {
        const store = Memory.create(), previousScope = { ...scope, versionId: 'old', groupId: 'local:test:old', [dimension]: dimension === 'game' ? 'poe1' : 'other' };
        await prepared({ store }); await prepared({ store, scope: previousScope });
        await assert.rejects(store.seedPreviousVersion(scope, previousScope), /must match/);
        assert.deepEqual(await store.getSaved(scope), {});
    }
    let valid = true;
    const store = Memory.create({ yield: async () => { valid = false; } }), previousScope = { ...scope, versionId: 'old', groupId: 'local:test:old' },
        oldUnits = Array.from({ length: 256 }, (_, i) => unit(String(i))), nextUnits = S.copy(oldUnits);
    nextUnits.forEach(original => { original.fields[0].source = 'Changed English'; });
    await store.import(previousScope, { units: oldUnits, assets: [asset] });
    await store.import(scope, { units: nextUnits, assets: [asset] }); valid = true;
    await assert.rejects(store.seedPreviousVersion(scope, previousScope, { guard: () => valid }), error => error.stale);
    assert.deepEqual(await store.getSaved(scope), {}); assert.deepEqual(await store.listHistory(scope, nextUnits[0].id), []);
    store.dispose(); await assert.rejects(store.listWorkspaces(), { code: 'LOCAL_TEST_DISPOSED' });
});

test('browser and Node adapters never access durable storage, workers or networking', async () => {
    const sandbox = { ClientTextState: S, ClientTextStore: CT, ContentAdapters: A, setTimeout, Map, Blob, console };
    for (const name of ['indexedDB', 'OfflineStore', 'localStorage', 'sessionStorage', 'fetch', 'WebSocket', 'Worker']) {
        Object.defineProperty(sandbox, name, { get() { throw new Error('Forbidden offline side effect: ' + name); } });
    }
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/clientTextMemoryStore.js'), 'utf8'), sandbox);
    const store = sandbox.ClientTextMemoryStore.create();
    await prepared({ store });
    await store.putDraft(scope, unit().id, { values: values(), reviewed: {} });
    await store.save(scope, unit().id, { jobId: 'browser-save', values: values(), reviewed: {} });
    assert.equal((await store.listHistory(scope, unit().id)).length, 1);
    assert.equal(store.getOutbox, undefined);
    assert.equal(store.putRequest, undefined);
    assert.equal((await store.getMemory(scope)).counts.total, 2);
});

test('temporary TM seeds detached cached rows and learns only eligible saved fields within the exact workbook scope', async () => {
    const { store, original } = await prepared();
    const cached = A.clienttext.memoryUnits(original, values(original, 'Cached {0}'), scope.language, { game: scope.game });
    await store.seedMemory(scope, cached);
    cached[0].target = 'Mutated caller';
    assert.equal((await store.getMemory(scope)).units[0].target, 'Cached {0}');
    await store.putDraft(scope, original.id, { values: values(original, 'Private draft {0}') });
    assert.equal((await store.getMemory(scope)).units[0].target, 'Cached {0}', 'drafts never teach memory');
    const command = { jobId: 'learn', values: values(original, 'Saved {0}'), reviewed: {} };
    await store.save(scope, original.id, command);
    let memory = await store.getMemory(scope);
    const learned = memory.units.find(entry => entry.context.fieldId === textId);
    assert.equal(learned.target, 'Saved {0}'); assert.equal(learned.localRevision, 1);
    await store.save(scope, original.id, command);
    assert.deepEqual(await store.getMemory(scope), memory, 'receipt replay does not learn twice');
    await store.seedMemory(scope, cached);
    assert.deepEqual(await store.getMemory(scope), memory, 'late seeding never replaces learned edits');
    memory.units[0].target = 'Mutated read';
    assert.notEqual((await store.getMemory(scope)).units[0].target, 'Mutated read');
    for (const other of [{ ...scope, accountId: 'other' }, { ...scope, language: 'French' }, { ...scope, game: 'poe1' },
        { ...scope, branchId: 'other' }, { ...scope, groupId: 'local:test:new' }, { ...scope, versionId: 'new' }]) {
        assert.equal((await store.getMemory(other)).counts.total, 0);
    }
    const bad = { ...values(original), [textId]: 'Missing protected variable' };
    await store.save(scope, original.id, { jobId: 'invalid-pair', values: bad, reviewed: {} });
    assert.equal((await store.getMemory(scope)).units.find(entry => entry.context.fieldId === textId).target, 'Saved {0}');
    const fresh = await prepared();
    const changed = unit(); changed.fields[0].outdated = true;
    const unreviewed = await prepared({ original: changed });
    await unreviewed.store.save(scope, changed.id, { jobId: 'unreviewed', values: values(changed), reviewed: {} });
    assert.equal((await unreviewed.store.getMemory(scope)).units.some(entry => entry.context.fieldId === textId), false);
    assert.equal((await fresh.store.getMemory(scope)).counts.total, 0, 'new sessions retain no temporary memory');
    store.dispose(); await assert.rejects(store.seedMemory(scope, cached), { code: 'LOCAL_TEST_DISPOSED' });
});

test('local test group scopes reject managed groups and isolate every authored-work dimension', async () => {
    assert.deepEqual(Memory.normalizeScope(scope), CT.normalizeScope(scope));
    assert.equal(Memory.scopeKey(scope), CT.scopeKey(scope));
    assert.throws(() => Memory.normalizeScope({ ...scope, groupId: 'managed-group' }), /local:test:/);
    assert.throws(() => Memory.normalizeScope({ ...scope, groupId: 'local:test' }), /local:test:/);
    const { store, original } = await prepared();
    await store.save(scope, original.id, { jobId: 'save', values: values(original), reviewed: {} });
    await store.putDraft(scope, original.id, { values: values(original, 'Private draft'), reviewed: {} });
    for (const other of [{ ...scope, accountId: 'other' }, { ...scope, game: 'poe1' }, { ...scope, branchId: 'other' },
        { ...scope, versionId: 'other' }, { ...scope, groupId: 'local:test:other' }, { ...scope, language: 'French' }]) {
        assert.deepEqual(await store.getSaved(other), {});
        assert.equal(await store.getDraft(other, original.id), undefined);
        assert.deepEqual(await store.listHistory(other, original.id), []);
        await assert.rejects(store.getUnits(other), /not prepared/);
        await prepared({ store, scope: other });
        await store.save(other, original.id, { jobId: 'save', values: values(original, other.language + other.accountId), reviewed: {} });
    }
    assert.equal((await store.getSaved(scope))[original.id].values[textId], 'Saved {0}');
    await assert.rejects(store.getSaved({ ...scope, groupId: 'managed' }), /local:test:/);
});

test('immutable originals and exact macro workbook bytes survive editable value overlays', async () => {
    const { store, original, metadata } = await prepared(), snapshot = S.copy(original);
    const units = await store.getUnits(scope);
    assert.strictEqual(await store.getUnits(scope), units, 'hot reads reuse the owned immutable catalog');
    assert.equal(Object.isExtensible(units), true, 'Vue.markRaw must be able to attach its marker');
    Object.defineProperty(units, '__v_skip', { configurable: true, value: true });
    assert.equal((await store.getUnits(scope)).__v_skip, true);
    const selected = await store.getUnit(scope, original.id); selected.fields[0].target = 'Changed detached selection'; selected.metadata.native = 'changed';
    await store.save(scope, original.id, { jobId: 'overlay', values: values(original), reviewed: {} });
    assert.deepEqual(original, snapshot);
    assert.deepEqual(await store.getUnit(scope, original.id), snapshot);
    const originalAsset = await store.getAsset(scope);
    assert.equal(originalAsset.parsed.units, undefined);
    assert.equal(originalAsset.parsed.format, 'xlsm');
    assert.deepEqual([...new Uint8Array(await originalAsset.blob.arrayBuffer())], [0, 255, 13, 10, 42]);
    originalAsset.parsed.sheets[0].name = 'Detached';
    assert.equal((await store.getAsset(scope)).parsed.sheets[0].name, 'ClientStrings');
    metadata.descriptors[0].unitCount = 99;
    assert.equal((await store.getMetadata(scope)).unitCount, 1);
    await store.import(scope, { units: [unit()], assets: [asset] });
    assert.equal((await store.getSaved(scope))[original.id].values[textId], 'Saved {0}');
    await assert.rejects(store.import(scope, { units: [unit()], assets: [{ ...asset, hash: 'b'.repeat(64) }] }), /immutable/);
});

test('save receipts replay the exact job atomically and reject changed commands or another unit', async () => {
    const store = Memory.create(), first = unit('first'), second = unit('second');
    await store.import(scope, { units: [first, second], assets: [asset] });
    const command = { jobId: 'exact-job', values: values(first), reviewed: {}, expectedRevision: 0 };
    const saved = await store.save(scope, first.id, command);
    assert.equal(saved.replayed, false); assert.equal(saved.saved.revision, 1); assert.equal(saved.saved.saved, true);
    saved.saved.values[textId] = 'Mutated return'; saved.receipt.saved.reviewed[textId] = 'invalid';
    command.values[textId] = 'Saved {0}';
    const replay = await store.save(scope, first.id, command);
    assert.equal(replay.replayed, true); assert.equal(replay.saved.values[textId], 'Saved {0}');
    assert.equal((await store.listHistory(scope, first.id)).length, 1);
    await assert.rejects(store.save(scope, first.id, { ...command, values: values(first, 'Different') }), error => error.code === 'SAVE_RECEIPT_MISMATCH');
    await assert.rejects(store.save(scope, second.id, command), error => error.code === 'SAVE_RECEIPT_MISMATCH');
    await assert.rejects(store.save(scope, first.id, { ...command, jobId: 'stale' }), error => error.code === 'UNIT_CHANGED');
    assert.equal((await store.getSaved(scope))[first.id].revision, 1);
    assert.equal((await store.getSaved(scope))[second.id], undefined);
});

test('draft revisions, summaries and exact save consumption preserve newer typing', async () => {
    const { store, original } = await prepared();
    const draft = await store.putDraft(scope, original.id, { values: values(original, 'Draft 1'), reviewed: {} }, { expectedRevision: null });
    draft.values[textId] = 'Mutated return';
    const newer = await store.putDraft(scope, original.id, { values: values(original, 'Draft 2'), reviewed: {} }, { expectedRevision: 1 });
    await assert.rejects(store.discardDraft(scope, original.id, { expectedRevision: 1 }), error => error.code === 'DRAFT_CHANGED');
    await assert.rejects(store.save(scope, original.id, { jobId: 'old-draft', values: values(original, 'Draft 1'), reviewed: {}, expectedDraftRevision: 1 }), error => error.code === 'DRAFT_CHANGED');
    assert.deepEqual(await store.getSaved(scope), {}); assert.deepEqual(await store.listHistory(scope, original.id), []);
    const summaries = await store.getDraftSummaries(scope);
    assert.deepEqual(Object.keys(summaries[0]).sort(), ['revision', 'unitId', 'updatedAt']);
    assert.equal(summaries[0].revision, 2);
    const saved = await store.save(scope, original.id, { jobId: 'current-draft', values: newer.values, reviewed: {}, expectedRevision: 0, expectedDraftRevision: 2 });
    assert.equal(saved.saved.values[textId], 'Draft 2'); assert.equal(await store.getDraft(scope, original.id), undefined);
    await store.putDraft(scope, original.id, { values: values(original, 'Keep draft'), reviewed: {} });
    await store.save(scope, original.id, { jobId: 'without-consumption', values: values(original), reviewed: {}, expectedRevision: 1 });
    assert.equal((await store.getDraft(scope, original.id)).values[textId], 'Keep draft');
    assert.equal(await store.discardDraft(scope, original.id, { expectedRevision: 1 }), true);
});

test('blank and literal NONEXISTENT fields follow production normalization, malformed commands fail without saved facts', async () => {
    const { store, original } = await prepared();
    const blanks = Object.fromEntries(original.fields.map(field => [field.id, '']));
    const blank = await store.save(scope, original.id, { jobId: 'blank', values: blanks, reviewed: {} });
    assert.deepEqual(blank.saved.values, blanks); assert.equal(blank.saved.saved, true);
    const nonexistent = Object.fromEntries(original.fields.map(field => [field.id, '  NONEXISTENT \n']));
    const literal = await store.save(scope, original.id, { jobId: 'literal', values: nonexistent, reviewed: {} });
    assert.deepEqual(literal.saved.values, S.normalizeValues(original, nonexistent));
    for (const command of [{ jobId: '', values: values(original) }, { jobId: 'missing-field', values: { [textId]: 'Partial' } },
        { jobId: 'unknown', values: { ...values(original), unknown: 'bad' } }, { jobId: 'number', values: { ...values(original), [textId]: 3 } },
        { jobId: 'review', values: values(original), reviewed: { [textId]: S.sourceHash('Wrong source') } },
        { jobId: 'origin', origin: 'import', values: values(original) }]) {
        await assert.rejects(store.save(scope, original.id, command), TypeError);
    }
    assert.equal((await store.listHistory(scope, original.id)).length, 2);
    assert.equal((await store.getSaved(scope))[original.id].revision, 2);
});

test('save/restore history retains before/after and source reviews with detached reads and bounded limits', async () => {
    const { store, original } = await prepared(), reviewed = { [textId]: S.sourceHash(original.fields[0].source) };
    await store.save(scope, original.id, { jobId: 'first', values: values(original, 'First'), reviewed });
    await store.save(scope, original.id, { jobId: 'restore', origin: 'restore', values: values(original, 'Restored'), reviewed: {} });
    const history = await store.listHistory(scope, original.id, { limit: 1 });
    assert.equal(history.length, 1); assert.equal(history[0].origin, 'restore'); assert.equal(history[0].before.values[textId], 'First');
    assert.equal(history[0].after.values[textId], 'Restored'); assert.deepEqual(history[0].after.reviewed, reviewed);
    history[0].after.values[textId] = 'Corrupted read';
    assert.equal((await store.listHistory(scope, original.id))[0].after.values[textId], 'Restored');
    assert.equal((await store.getSaved(scope))[original.id].values[textId], 'Restored');
});

test('failed guarded work leaves no authored facts and captures scope before asynchronous preparation', async () => {
    const { store, original } = await prepared();
    await assert.rejects(store.getUnits(scope, { signal: AbortSignal.abort() }), error => error.name === 'AbortError');
    await assert.rejects(store.putDraft(scope, original.id, { values: values(original) }, { guard: () => false }), error => error.stale === true);
    await assert.rejects(store.save(scope, original.id, { jobId: 'guarded', values: values(original) }, { guard: () => false }), error => error.stale === true);
    assert.deepEqual(await store.getSaved(scope), {}); assert.deepEqual(await store.getDraftSummaries(scope), []);
    let release;
    const pausingStore = Memory.create({ yield: () => new Promise(resolve => { release = resolve; }) });
    const mutableScope = { ...scope }, units = Array.from({ length: 256 }, (_, index) => unit('ID' + index));
    const pending = pausingStore.import(mutableScope, { units, assets: [asset], descriptors: [{ format: S.TRUSTED_FORMAT, role: 'normal', assetHash: asset.hash, parserVersion: S.PARSER_VERSION, unitCount: 256 }] });
    mutableScope.language = 'French'; release(); await pending;
    assert.equal((await pausingStore.getUnits(scope)).length, 256);
    assert.equal(await pausingStore.getMetadata(mutableScope), undefined);
});

test('disposing clears all in-memory work and rejects late import completion and later reads/writes', async () => {
    const { store, original } = await prepared();
    await store.putDraft(scope, original.id, { values: values(original), reviewed: {} });
    await store.save(scope, original.id, { jobId: 'save', values: values(original), reviewed: {} });
    store.dispose(); store.dispose();
    for (const work of [() => store.getMetadata(scope), () => store.getUnits(scope), () => store.getUnit(scope, original.id),
        () => store.getSaved(scope), () => store.getAsset(scope), () => store.getDraft(scope, original.id), () => store.getDraftSummaries(scope),
        () => store.discardDraft(scope, original.id), () => store.listHistory(scope, original.id), () => store.getMemory(scope),
        () => store.save(scope, original.id, { jobId: 'late', values: values(original) }), () => store.import(scope, { units: [original], assets: [asset] })]) {
        await assert.rejects(work(), error => error.code === 'LOCAL_TEST_DISPOSED' && error.stale === true);
    }
    let release;
    const pausingStore = Memory.create({ yield: () => new Promise(resolve => { release = resolve; }) });
    const pending = pausingStore.import(scope, { units: Array.from({ length: 256 }, (_, index) => unit('ID' + index)), assets: [asset] });
    pausingStore.dispose(); release();
    await assert.rejects(pending, error => error.code === 'LOCAL_TEST_DISPOSED');
});
