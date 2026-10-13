const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../public/collaborationProtocol.js');
const Legacy = require('./legacy-baseline-fixtures.cjs');

function description(name = 'a', translations = {}) {
  return { filepath: 'source/' + name + '.txt', name: '', stats: ['stat'],
    variables: ['#'], remarks: [''], translations: {
      English: ['Original {0}'], Thai: ['เดิม {0}'], French: ['Original {0}'], ...translations,
    }, hasChanges: false, needsReview: false };
}
const clone = value => JSON.parse(JSON.stringify(value));
async function descriptor(source, overrides = {}) {
  P.validateBaselineSource(source);
  return P.finalizeArchive({ version: 2, zipHash: 'a'.repeat(64), zipSize: 1024,
    fileCount: source.length + 1, descriptionCount: source.length, parserVersion: 1,
    decisions: [], ...overrides });
}

test('raw upstream ZIP hashing matches SHA-256 for bytes and File-shaped inputs', async () => {
  const bytes = Buffer.from('original upstream archive bytes');
  const expected = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(await P.zipHash(bytes), expected);
  assert.equal(await P.zipHash({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }), expected);
  assert.notEqual(await P.zipHash(Buffer.from('repacked archive bytes')), expected);
  await assert.rejects(P.zipHash({ name: 'StatDescriptions.zip', size: bytes.length }), /bytes/);
});

test('trusted baseline identity binds ZIP bytes and parser choices without a tree', async () => {
  const original = [description()];
  const first = await descriptor(original);
  const local = clone(original); local[0].hasChanges = true; local[0].needsReview = true;
  local[0].isMissing = false; local[0].savedAt = 123; local[0].importRepairs = [{ line: 1 }];
  assert.deepEqual(await descriptor(local), first);
  const otherLanguage = clone(original); otherLanguage[0].translations.French = ['Modifié {0}'];
  assert.equal((await descriptor(otherLanguage)).baselineId, first.baselineId, 'Parsed facts belong to the browser; raw ZIP identity is authoritative.');
  const repacked = await descriptor(original, { zipHash: 'b'.repeat(64) });
  assert.notEqual(repacked.baselineId, first.baselineId);
  assert.equal(first.version, 2); assert.equal(first.treeRoot, undefined);
  assert.equal(P.buildBaselineTree, undefined); assert.equal(P.baselineProof, undefined); assert.equal(P.verifyBaselineProof, undefined);
  assert.equal(first.baselineId, crypto.createHash('sha256').update('sdeditor:baseline:id:v2\n' + JSON.stringify({ zipHash: first.zipHash, configHash: first.configHash })).digest('hex'));
});

test('browser source validation uses stable filepath and language order without changing originals', async () => {
  const source = [description('c'), description('a'), description('b')];
  const before = clone(source);
  const files = P.validateBaselineSource(source);
  const reordered = source.slice().reverse().map(desc => ({ ...desc, translations: {
    Thai: desc.translations.Thai, French: desc.translations.French, English: desc.translations.English,
  } }));
  assert.deepEqual(P.validateBaselineSource(reordered), files);
  assert.deepEqual(source, before);
  assert.deepEqual(files.map(file => file.filepath), ['source/a.txt', 'source/b.txt', 'source/c.txt']);
});

test('existing v1 descriptors retain their exact baseline IDs without rebuilding proof trees', async () => {
  const tree = await Legacy.buildBaselineTree([description()]);
  const old = await P.finalizeArchive({ version: 1, zipHash: 'a'.repeat(64), zipSize: 1024,
    fileCount: 2, descriptionCount: 1, parserVersion: 1, decisions: [], treeRoot: tree.root });
  assert.deepEqual(await P.finalizeArchive(old), old);
  assert.equal(old.baselineId, crypto.createHash('sha256').update('sdeditor:baseline:id:v1\n' + JSON.stringify({ zipHash: old.zipHash, configHash: old.configHash, treeRoot: old.treeRoot })).digest('hex'));
  assert.notEqual(old.baselineId, (await descriptor([description()])).baselineId);
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

test('invalid or ambiguous original source fails strict browser validation', async () => {
  const original = description();
  assert.throws(() => P.validateBaselineSource([original, clone(original)]), /Duplicate baseline filepath/);
  assert.throws(() => P.validateBaselineSource([{ ...original, filepath: '../source/a.txt' }]), /Invalid/);
  assert.throws(() => P.validateBaselineSource([{ ...original, variables: [] }]), /Invalid/);
  assert.throws(() => P.validateBaselineSource([{ ...original, translations: { ...original.translations, Thai: [1] } }]), /Invalid/);
  assert.throws(() => P.validateBaselineSource([original], { descriptionCount: 2 }), /description count/);
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
  const baseline = { archive, source, rawSource: clone(source) };
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
