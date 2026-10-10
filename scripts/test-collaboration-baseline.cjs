const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../public/collaborationProtocol.js');

function description(name = 'a', translations = {}) {
  return { filepath: 'source/' + name + '.txt', name: '', stats: ['stat'],
    variables: ['#'], remarks: [''], translations: {
      English: ['Original {0}'], Thai: ['เดิม {0}'], French: ['Original {0}'], ...translations,
    }, hasChanges: false, needsReview: false };
}
const clone = value => JSON.parse(JSON.stringify(value));
async function descriptor(source, overrides = {}) {
  const tree = await P.buildBaselineTree(source);
  return P.finalizeArchive({ version: 1, zipHash: 'a'.repeat(64), zipSize: 1024,
    fileCount: source.length + 1, descriptionCount: source.length, parserVersion: 1,
    decisions: [], treeRoot: tree.root, ...overrides });
}

test('raw upstream ZIP hashing matches SHA-256 for bytes and File-shaped inputs', async () => {
  const bytes = Buffer.from('original upstream archive bytes');
  const expected = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(await P.zipHash(bytes), expected);
  assert.equal(await P.zipHash({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }), expected);
  assert.notEqual(await P.zipHash(Buffer.from('repacked archive bytes')), expected);
  await assert.rejects(P.zipHash({ name: 'StatDescriptions.zip', size: bytes.length }), /bytes/);
});

test('baseline identity covers all languages and ignores local editor metadata', async () => {
  const original = [description()];
  const first = await descriptor(original);
  const local = clone(original); local[0].hasChanges = true; local[0].needsReview = true;
  local[0].isMissing = false; local[0].savedAt = 123; local[0].importRepairs = [{ line: 1 }];
  assert.deepEqual(await descriptor(local), first);
  const otherLanguage = clone(original); otherLanguage[0].translations.French = ['Modifié {0}'];
  assert.notEqual((await descriptor(otherLanguage)).baselineId, first.baselineId);
  const repacked = await descriptor(original, { zipHash: 'b'.repeat(64) });
  assert.notEqual(repacked.baselineId, first.baselineId);
  assert.equal(repacked.treeRoot, first.treeRoot);
});

test('Merkle cache uses stable filepath and language order and never mutates imported originals', async () => {
  const source = [description('c'), description('a'), description('b')];
  const before = clone(source);
  const tree = await P.buildBaselineTree(source);
  const reordered = source.slice().reverse().map(desc => ({ ...desc, translations: {
    Thai: desc.translations.Thai, French: desc.translations.French, English: desc.translations.English,
  } }));
  assert.deepEqual(await P.buildBaselineTree(reordered), tree);
  assert.deepEqual(source, before);
  assert.deepEqual(tree.paths, ['source/a.txt', 'source/b.txt', 'source/c.txt']);
  assert.deepEqual(tree.levels.map(level => level.length), [3, 2, 1]);
  for (const desc of source) {
    assert.equal(await P.verifyBaselineProof(desc, P.baselineProof(tree, desc.filepath), tree.root, source.length), true);
  }
});

test('baseline proof progress counts hash completions independently of concurrent leaf order', async () => {
  const source = [description('a'), description('b'), description('c')], reports = [], releases = [];
  let calls = 0, firstCompleted;
  const first = new Promise(resolve => { firstCompleted = resolve; });
  const provider = { subtle: { async digest(...args) {
    if (calls++ < source.length) await new Promise(resolve => releases.push(resolve));
    return crypto.webcrypto.subtle.digest(...args);
  } } };
  const pending = P.buildBaselineTree(source, provider, { onProgress: progress => {
    reports.push(progress); if (progress.completed === 1) firstCompleted();
  } });
  assert.equal(releases.length, 3);
  assert.deepEqual(reports, [{ completed: 0, total: 6, unit: 'items' }]);
  releases[2](); await first;
  assert.deepEqual(reports.at(-1), { completed: 1, total: 6, unit: 'items' });
  releases[1](); releases[0]();
  assert.deepEqual(await pending, await P.buildBaselineTree(source), 'Progress preserves custom crypto providers and canonical proof ordering.');
  assert.deepEqual(reports.map(progress => progress.completed), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(reports.every(progress => progress.total === 6 && progress.unit === 'items'));
});

test('proof checks reject changed original text, paths, indexes, sibling directions and extra nodes', async () => {
  const source = [description('a'), description('b'), description('c')];
  const tree = await P.buildBaselineTree(source);
  const original = source[2], proof = P.baselineProof(tree, original.filepath);
  const changed = clone(original); changed.translations.Thai = ['altered original'];
  assert.equal(await P.verifyBaselineProof(changed, proof, tree.root, source.length), false);
  assert.equal(await P.verifyBaselineProof({ ...original, filepath: 'source/d.txt' }, proof, tree.root, source.length), false);
  assert.equal(await P.verifyBaselineProof(original, { ...proof, index: 0 }, tree.root, source.length), false);
  assert.equal(await P.verifyBaselineProof(original, proof, tree.root, 2), false);
  const swapped = clone(proof); swapped.siblings[0].left = !swapped.siblings[0].left;
  assert.equal(await P.verifyBaselineProof(original, swapped, tree.root, source.length), false);
  const tamperedOdd = clone(proof); tamperedOdd.siblings[0].hash = 'a'.repeat(64);
  assert.equal(await P.verifyBaselineProof(original, tamperedOdd, tree.root, source.length), false);
  const extra = clone(proof); extra.siblings.push({ hash: tree.root, left: false });
  assert.equal(await P.verifyBaselineProof(original, extra, tree.root, source.length), false);
  assert.throws(() => P.baselineProof(tree, 'unknown.txt'), /absent/);
});

test('a single description produces an empty reusable proof', async () => {
  const source = [description()]; const tree = await P.buildBaselineTree(source);
  const proof = P.baselineProof(tree, source[0].filepath);
  assert.deepEqual(proof, { index: 0, siblings: [] });
  assert.equal(await P.verifyBaselineProof(source[0], proof, tree.root, 1), true);
});

test('shared duplicate decisions are order independent and fingerprint source metadata too', async () => {
  const block = { content: ['same English'], variables: ['#'], remarks: ['canonical'] };
  const hash = await P.blockHash(block);
  assert.notEqual(await P.blockHash({ ...block, variables: ['1'] }), hash);
  assert.notEqual(await P.blockHash({ ...block, remarks: ['different rule'] }), hash);
  const decisions = [
    { filepath: 'source/b.txt', language: 'Thai', occurrence: 2, blockHash: hash },
    { filepath: 'source/a.txt', language: 'English', occurrence: 1, blockHash: hash },
  ];
  const first = await descriptor([description()], { decisions });
  assert.deepEqual(await descriptor([description()], { decisions: decisions.slice().reverse() }), first);
  assert.equal(first.decisions[0].filepath, 'source/a.txt');
  const alternate = clone(decisions); alternate[0].occurrence = 1;
  assert.notEqual((await descriptor([description()], { decisions: alternate })).baselineId, first.baselineId);
  assert.throws(() => P.normalizeDecisions([decisions[0], decisions[0]]), /Duplicate/);
});

test('archive descriptors reject stale configuration identity and impossible size or counts', async () => {
  const first = await descriptor([description()]);
  await assert.rejects(P.finalizeArchive({ ...first, configHash: 'b'.repeat(64) }), /configuration hash/);
  await assert.rejects(P.finalizeArchive({ ...first, baselineId: 'b'.repeat(64) }), /identity differs/);
  await assert.rejects(P.finalizeArchive({ ...first, parserVersion: 2 }), /Invalid|Unsupported/);
  await assert.rejects(P.finalizeArchive({ ...first, zipSize: 0 }), /Invalid/);
  await assert.rejects(P.finalizeArchive({ ...first, descriptionCount: first.fileCount + 1 }), /Invalid/);
});

test('invalid or ambiguous original source cannot generate a baseline tree', async () => {
  const original = description();
  await assert.rejects(P.buildBaselineTree([original, clone(original)]), /Duplicate baseline filepath/);
  await assert.rejects(P.buildBaselineTree([{ ...original, filepath: '../source/a.txt' }]), /Invalid/);
  await assert.rejects(P.buildBaselineTree([{ ...original, variables: [] }]), /Invalid/);
  await assert.rejects(P.buildBaselineTree([{ ...original, translations: { ...original.translations, Thai: [1] } }]), /Invalid/);
});

function storageFixture({ failRevision = false } = {}) {
  const oldIdentity = 'f'.repeat(64);
  const kv = new Map([
    ['workspace_poe1', { sourceHash: oldIdentity, descs: ['old workspace'] }], ['source_poe1', ['old source']],
    ['import_baseline_poe1_' + oldIdentity, { preserved: true }],
    ['collaboration_v1', { rooms: { old: { outbox: [{ id: 'unsent-old-edit' }], recovery: ['old recovery'] } } }],
  ]);
  const revisions = [], transactions = [];
  const db = { transaction(names) {
    const pending = []; let finished = false;
    const tx = {
      objectStore(name) {
        assert.ok(names.includes(name));
        return {
          get(key) {
            const request = {};
            queueMicrotask(() => {
              const value = kv.get(key);
              request.result = value === undefined ? undefined : { key, value: structuredClone(value) };
              request.onsuccess?.();
            });
            return request;
          },
          put(row) { pending.push({ store: name, row: structuredClone(row) }); },
          add(row) { if (failRevision) throw new Error('History unavailable'); pending.push({ store: name, row: structuredClone(row) }); },
        };
      },
      abort() { assert.equal(finished, false); finished = true; queueMicrotask(() => this.onabort?.()); },
      complete() {
        assert.equal(finished, false); finished = true;
        for (const item of pending) if (item.store === 'kv') kv.set(item.row.key, item.row.value); else revisions.push(item.row);
        this.oncomplete?.();
      },
    };
    transactions.push(tx); return tx;
  } };
  const indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess(); }); return request; } };
  const context = vm.createContext({ window: {}, indexedDB, console: { log() {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/workspaceState.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/offlineStore.js'), 'utf8'), context);
  return { store: context.window.OfflineStore, kv, revisions, transactions };
}
const queued = () => new Promise(resolve => setImmediate(resolve));

test('source, cached baseline, workspace and recovery history commit together while old queues survive', async () => {
  const f = storageFixture(), source = [description()], archive = await descriptor(source);
  const baseline = { archive, source, rawSource: clone(source), tree: await P.buildBaselineTree(source) };
  const workspace = { sourceHash: archive.baselineId, importArchive: archive, descs: source, status: {} };
  const beforeQueues = clone(f.kv.get('collaboration_v1'));
  let settled = false;
  const saving = f.store.saveSourceWorkspaceWithRevisions(source, workspace, [{ translations: ['recovery'] }], 'poe1', baseline)
    .then(() => { settled = true; });
  await queued(); assert.equal(settled, false); assert.deepEqual(f.kv.get('source_poe1'), ['old source']);
  assert.equal(f.kv.has('import_baseline_poe1_' + archive.baselineId), false); assert.equal(f.revisions.length, 0);
  f.transactions.at(-1).complete(); await saving;
  assert.deepEqual(f.kv.get('source_poe1'), source); assert.deepEqual(f.kv.get('workspace_poe1'), workspace);
  assert.deepEqual(f.kv.get('import_baseline_poe1_' + archive.baselineId), baseline); assert.equal(f.revisions.length, 1);
  assert.deepEqual(f.kv.get('collaboration_v1'), beforeQueues);
  assert.deepEqual(f.kv.get('import_baseline_poe1_' + 'f'.repeat(64)), { preserved: true });
  const reading = f.store.getImportedBaseline(archive.baselineId, 'poe1'); await queued(); f.transactions.at(-1).complete();
  assert.deepEqual(await reading, baseline);
});

test('baseline caching rolls back with a failed recovery-history write', async () => {
  const f = storageFixture({ failRevision: true }), source = [description()], archive = await descriptor(source);
  const before = clone(Array.from(f.kv.entries()));
  await assert.rejects(f.store.saveSourceWorkspaceWithRevisions(source,
    { sourceHash: archive.baselineId, descs: source }, [{}], 'poe1', { archive, source }), /History unavailable/);
  assert.deepEqual(Array.from(f.kv.entries()), before); assert.equal(f.revisions.length, 0);
});

test('a mismatched workspace and cached baseline identity abort every queued write', async () => {
  const f = storageFixture(), source = [description()], archive = await descriptor(source);
  const before = clone(Array.from(f.kv.entries()));
  await assert.rejects(f.store.saveSourceWorkspaceWithRevisions(source,
    { sourceHash: 'different-id', descs: source }, [], 'poe1', { archive, source }), /identity differ/);
  assert.deepEqual(Array.from(f.kv.entries()), before);
  await assert.rejects(f.store.getImportedBaseline('bad-id', 'poe1'), /Invalid imported baseline identity/);
});
