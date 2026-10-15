const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const B = require('../public/sdBaselineFiles.js');
const P = require('../public/collaborationProtocol.js');
const codec = require('../public/statDescCodec.js');
const text = 'description test\n1 damage\n1\n# "English 😀" negate 1\nlang "Thai"\n1\n# "ไทย"';
const desc = (filepath = 'source/a.txt') => P.witness(codec.parseText(filepath, text, 'Thai', { strict: true }));
const copy = value => structuredClone(value);
const next = () => new Promise(resolve => setImmediate(resolve));
async function archive({ texts = { 'source/a.txt': text, 'source/b.txt': text }, decisions = [], marker = 'zip' } = {}) {
  const blob = new Blob([marker]), reads = [], entries = Object.fromEntries(Object.entries(texts).map(([name, content]) => [name,
    { name, dir: false, _data: { uncompressedSize: content.length * 2 + 2 }, async: async () => { reads.push(name); return codec.strEncodeUTF16(content); } }]));
  const descriptor = await P.finalizeArchive({ version: 2, zipHash: await P.zipHash(blob), zipSize: blob.size,
    fileCount: Object.keys(texts).length, descriptionCount: Object.keys(texts).length, parserVersion: 1, decisions });
  let opens = 0;
  const JSZip = { loadAsync: async (_, options) => { assert.equal(options.checkCRC32, false); opens++; return { files: entries, file: name => entries[name] }; } };
  return { blob, descriptor, reads, JSZip, opens: () => opens };
}
test('cold ZIP comparison inflates only its requested file and reuses the indexed archive', async () => {
  const f = await archive(), engine = B.createArchiveEngine({ JSZip: f.JSZip });
  assert.deepEqual(await engine.extract(f.blob, f.descriptor, 'source/a.txt'), desc());
  assert.deepEqual(f.reads, ['source/a.txt']);
  await engine.extract(f.blob, f.descriptor, 'source/b.txt');
  assert.equal(f.opens(), 1); assert.equal(engine.stats().extractions, 2);
  await assert.rejects(engine.extract(new Blob(['corrupt']), { ...f.descriptor, zipHash: 'a'.repeat(64), baselineId: undefined }, 'source/a.txt'), /corrupt|another baseline/);
  await assert.rejects(engine.extract(f.blob, f.descriptor, '../a.txt'), /filepath/);
});
test('per-file duplicate decisions validate exactly that file without parsing unrelated files', async () => {
  const duplicate = text + '\nlang "English"\n1\n8 "Alternate source" alternate';
  const raw = codec.parseText('source/a.txt', duplicate, 'Thai', { strict: true });
  const group = codec.collectDuplicateLangGroups([raw])[0], selected = group.options[1];
  const decision = { filepath: 'source/a.txt', language: 'English', occurrence: selected.occurrence, blockHash: await codec.blockHash(selected) };
  const f = await archive({ texts: { 'source/a.txt': duplicate, 'source/b.txt': text }, decisions: [decision] });
  const engine = B.createArchiveEngine({ JSZip: f.JSZip });
  assert.deepEqual((await engine.extract(f.blob, f.descriptor, 'source/a.txt')).translations.English, ['Alternate source']);
  assert.deepEqual((await engine.extract(f.blob, f.descriptor, 'source/b.txt')).translations.English, ['English 😀']);
  const bad = await P.finalizeArchive({ ...f.descriptor, baselineId: undefined, configHash: undefined, decisions: [{ ...decision, blockHash: 'f'.repeat(64) }] });
  await assert.rejects(engine.extract(f.blob, bad, 'source/a.txt'), /choice does not match/);
  assert.deepEqual(f.reads, ['source/a.txt', 'source/b.txt', 'source/a.txt']);
});
test('native cache objects detach, coalesce readers and fence only the cancelled comparison', async () => {
  let release, reads = 0, current = true;
  const file = desc(), fingerprint = await B.fingerprint(file), ref = { baselineId: 'baseline', filepath: file.filepath, fingerprint };
  const resolver = B.createResolver({ extractor: {}, store: { getBaselineFile: () => { reads++; return new Promise(resolve => { release = resolve; }); } } });
  const first = resolver.resolveBaselineFile(ref, { current: () => current });
  const second = resolver.resolveBaselineFile(ref);
  await next(); current = false; release(file);
  await assert.rejects(first, error => error.stale === true);
  const result = await second; result.translations.English[0] = 'Mutated editor';
  assert.equal((await resolver.resolveBaselineFile(ref)).translations.English[0], 'English 😀');
  assert.equal(reads, 1); assert.equal(resolver.stats().files, 1);
});
test('historical source fingerprints and legacy room/language imports never share target caches', async () => {
  let reads = 0;
  const resolver = B.createResolver({ extractor: {}, store: { getBaselineFile: ref => { reads++; return { ...desc(), translations: { English: ['English 😀'], Thai: [ref.roomId || 'target'] } }; } } });
  const ref = { baselineId: 'legacy-source', filepath: 'source/a.txt', language: 'Thai' };
  const reference = async roomId => ({ ...ref, roomId, fingerprint: await B.fingerprint({ ...desc(), translations: { English: ['English 😀'], Thai: [roomId] } }) });
  assert.equal((await resolver.resolveBaselineFile(await reference('one'))).translations.Thai[0], 'one');
  assert.equal((await resolver.resolveBaselineFile(await reference('two'))).translations.Thai[0], 'two');
  assert.equal(reads, 2);
  await assert.rejects(resolver.resolveBaselineFile({ ...ref, fingerprint: 'a'.repeat(64) }), error => error.code === 'SD_BASELINE_UNAVAILABLE');
  const before = reads;
  await assert.rejects(resolver.resolveBaselineFile({ ...ref, roomId: 'unknown-import' }), /original source is unavailable/);
  assert.equal(reads, before, 'A legacy room import without a fingerprint cannot reuse another room target.');
});
test('verified durable ZIP cache supports extraction, rejects wrong identities and bounds parsed cache', async () => {
  const f = await archive(), saved = new Map(), engine = B.createArchiveEngine({ JSZip: f.JSZip });
  const extractor = { verify: async (blob, archive) => (await engine.verifyZip(blob, archive)).descriptor, extract: engine.extract };
  const resolver = B.createResolver({ maxFiles: 1, extractor, store: {
    putStatDescriptionZip: (hash, blob, evidence) => { assert.equal(evidence.verified, true); saved.set(hash, blob); },
    getStatDescriptionZip: hash => saved.get(hash), getBaselineArchive: () => f.descriptor,
  } });
  await resolver.cacheOriginalZip(f.blob, f.descriptor);
  const ref = { game: 'poe2', baselineId: f.descriptor.baselineId, filepath: 'source/a.txt', fingerprint: await B.fingerprint(desc()) };
  await Promise.all([resolver.resolveBaselineFile(ref), resolver.resolveBaselineFile(ref)]);
  assert.deepEqual(f.reads, ['source/a.txt']);
  await resolver.resolveBaselineFile({ ...ref, filepath: 'source/b.txt', fingerprint: await B.fingerprint(desc('source/b.txt')) });
  assert.equal(resolver.stats().files, 1);
  await resolver.resolveBaselineFile(ref); assert.equal(f.reads.length, 3);
  await assert.rejects(resolver.resolveBaselineFile({ ...ref, baselineId: 'another' }), /identity differs/);
});
test('opened archives and parsed bytes stay bounded and failed reads remain retryable', async () => {
  const fixtures = await Promise.all(['one', 'two', 'three'].map(marker => archive({ marker })));
  const engine = B.createArchiveEngine({ JSZip: fixtures[0].JSZip });
  for (const f of fixtures) await engine.extract(f.blob, f.descriptor, 'source/a.txt');
  assert.equal(engine.stats().archives, 2);
  let failed = true;
  const resolver = B.createResolver({ maxBytes: 1, extractor: {}, store: { getBaselineFile: () => failed ? null : desc() } });
  const ref = { baselineId: 'baseline', filepath: 'source/a.txt' };
  await assert.rejects(resolver.resolveBaselineFile(ref), /original source is unavailable/);
  failed = false; assert.equal((await resolver.resolveBaselineFile(ref)).filepath, ref.filepath);
  assert.equal(resolver.stats().bytes, 0); assert.equal(resolver.stats().pending, 0);
});
test('authorized per-file fetch verifies its response reference and preserves metadata', async () => {
  const file = desc(), ref = { baselineId: 'old', filepath: file.filepath, fingerprint: await B.fingerprint(file) };
  const resolver = B.createResolver({ extractor: {}, store: {} });
  await assert.rejects(resolver.resolveBaselineFile(ref, { fetchFile: async () => ({ reference: { ...ref, baselineId: 'other' }, file }) }), /reference differs/);
  assert.deepEqual(await resolver.resolveBaselineFile(ref, { fetchFile: async () => ({ reference: ref, file }) }), file);
});
test('worker startup/runtime failures fall back to the same single-file extraction engine', async () => {
  const f = await archive(), engine = B.createArchiveEngine({ JSZip: f.JSZip });
  class Worker {
    constructor() { queueMicrotask(() => this.onmessage({ data: { type: 'ready' } })); }
    postMessage() { queueMicrotask(() => this.onerror()); }
    terminate() {}
  }
  const client = B.createWorkerClient({ Worker, engine });
  assert.deepEqual(await client.extract(f.blob, f.descriptor, 'source/a.txt'), desc());
  assert.deepEqual(f.reads, ['source/a.txt']);
  assert.equal((await client.hash(f.blob)).zipHash, f.descriptor.zipHash); client.dispose();
});
test('Dropped hydration ignores stale view completion and never rewrites recovery evidence', async () => {
  const root = {}, context = vm.createContext({ window: root });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sdBaselineUi.js'), 'utf8'), context);
  const mixin = root.SDBaselineUI.mixin;
  const candidate = { id: 'stable', originSourceHash: 'old', snapshot: { translations: ['Last authored translation'], sourceRef: { baselineId: 'old', filepath: 'source/a.txt' } } };
  let finish;
  const app = { ...mixin.data(), ...mixin.methods, editorVisible: true, editorDroppedCandidate: candidate, sdBaselineViewScope: 'one', gameVersion: 'poe2',
    resolveSDSource: () => new Promise(resolve => { finish = resolve; }) };
  const before = copy(candidate), pending = app.loadSDDroppedSource();
  await next(); app.sdBaselineViewScope = 'two'; finish(desc()); await pending;
  assert.equal(app.sdDroppedSource, null); assert.deepEqual(candidate, before);
  app.resolveSDSource = async () => { throw new Error('Original unavailable; reconnect to compare.'); };
  await app.loadSDDroppedSource(); assert.match(app.sdDroppedSourceError, /reconnect/);
  assert.deepEqual(candidate.snapshot.translations, ['Last authored translation']);
  app.resolveSDSource = async () => desc(); await app.loadSDDroppedSource();
  assert.equal(app.sdDroppedSource.translations.English[0], 'English 😀'); assert.equal(app.sdDroppedSourceError, '');
  assert.deepEqual(candidate, before);
});
test('fresh commands negotiate accepted baseline references while exact queued request bodies remain unchanged', async t => {
  const { Client } = require('../public/collaborationSync.js');
  const original = desc(), identity = { accountId: 'owner', game: 'poe2', sourceHash: 'a'.repeat(64), language: 'Thai' }, key = P.scopeKey(identity);
  const baselineRef = { kind: 'sd-baseline', baselineId: identity.sourceHash, filepath: original.filepath, fingerprint: await B.fingerprint(original) };
  const base = P.fileState({ filepath: original.filepath, translations: original.translations.Thai, baselineRef });
  const operation = { id: 'new', origin: 'save', resetStaging: true, status: 'pending', files: [{ base, yours: { ...base, stagingReset: true } }] };
  let state = { version: 1, rooms: { [key]: { mode: 'sparse', identity, shared: { [base.filepath]: base }, local: { [base.filepath]: base }, outbox: [operation], conflicts: [] } } };
  let policies = 0;
  const client = new Client({ WebSocket: null, contentPolicy: async () => { policies++; return { sdBaselineReferences: 1 }; },
    store: { updateCollaborationState: async update => { state = update(copy(state)); return copy(state); } }, request: async () => ({}) });
  t.after(() => client.destroy()); client.key = key; client.state = copy(state); client.baselineFiles = new Map([[original.filepath, original]]);
  await client.prepare('new', client.epoch);
  const wire = copy(client.room().outbox[0].wire);
  assert.deepEqual(wire.files[0].baselineRef, baselineRef); assert.equal(wire.files[0].baseline, undefined); assert.equal(policies, 1);
  assert.deepEqual(wire.files[0].baselineTranslations, original.translations.Thai, 'Reference bootstrapping retains raw original targets without source text.');
  state.rooms[key].outbox[0].wire = { mutationId: 'new', origin: 'save', files: [{ filepath: original.filepath, baseline: original, proof: { old: 'exact bytes' } }] };
  client.state = copy(state); client.contentPolicyLoad = null;
  const queued = JSON.stringify(client.room().outbox[0].wire);
  await client.prepare('new', client.epoch);
  assert.equal(JSON.stringify(client.room().outbox[0].wire), queued); assert.equal(policies, 1, 'Queued wire is replayed without renegotiation.');
});
test('ordinary hydrated Dropped views resolve immutable provenance and reject mismatched old English before exact candidate fetch', async () => {
  const root = {}, context = vm.createContext({ window: root });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sdBaselineUi.js'), 'utf8'), context);
  const file = desc(), wrong = { ...file, translations: { ...file.translations, English: ['Other source'] } };
  root.OfflineStore = { getBaselineFile: () => wrong };
  const resolver = root.SDBaselineFiles = B.createResolver({ store: root.OfflineStore, extractor: {} });
  const candidate = { id: 'frozen-candidate', filepath: file.filepath, originSourceHash: 'old', originSourceAvailable: true,
    snapshot: { english: copy(file.translations.English), translations: ['Last authored text'] } };
  const before = copy(candidate), paths = [], mixin = root.SDBaselineUI.mixin;
  const app = { ...mixin.data(), ...mixin.methods, editorVisible: true, editorDroppedCandidate: candidate, sdBaselineViewScope: 'scope',
    gameVersion: 'poe2', cloudSignedIn: true, collaborationState: { roomId: 'current-room' },
    _cloud: { request: async request => { paths.push(request); return { file }; } } };
  await app.loadSDDroppedSource();
  assert.equal(app.sdDroppedSource.translations.English[0], file.translations.English[0]);
  assert.match(paths[0], /candidateId=frozen-candidate/); assert.match(paths[0], /sourceHash=old/);
  assert.deepEqual(candidate, before);
  resolver.clear(); app._cloud.request = async () => ({ file: wrong });
  await app.loadSDDroppedSource();
  assert.equal(app.sdDroppedSource, null); assert.match(app.sdDroppedSourceError, /differs.*frozen recovery.*frozen source/s);
  assert.deepEqual(candidate.snapshot.english, before.snapshot.english); assert.deepEqual(candidate.snapshot.translations, before.snapshot.translations);
  app.editorDroppedCandidate = { ...candidate, originSourceAvailable: false };
  app.resolveSDSource = () => { throw new Error('Unavailable provenance must not resolve'); };
  await app.loadSDDroppedSource(); assert.equal(app.sdDroppedSource, null);
});
test('metadata-only historical differences require exact historical ZIP context even when English matches', async () => {
  const root = {}, context = vm.createContext({ window: root });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sdBaselineUi.js'), 'utf8'), context);
  const original = desc(), metadata = ['name', 'stats', 'variables', 'remarks'];
  for (const field of metadata) {
    const changed = copy(original); changed[field] = field === 'name' ? 'different' : ['different'];
    root.OfflineStore = { getBaselineFile: () => changed };
    root.SDBaselineFiles = B.createResolver({ store: root.OfflineStore, extractor: {} });
    const snapshot = { english: copy(original.translations.English), name: original.name, stats: copy(original.stats), variables: copy(original.variables), remarks: copy(original.remarks), translations: ['Frozen translation'] };
    const candidate = { id: 'metadata-' + field, filepath: original.filepath, originSourceHash: 'old', originSourceAvailable: true, snapshot };
    const mixin = root.SDBaselineUI.mixin, fetched = [];
    const app = { ...mixin.data(), ...mixin.methods, editorVisible: true, editorDroppedCandidate: candidate, sdBaselineViewScope: 'scope', gameVersion: 'poe2',
      cloudSignedIn: true, collaborationState: { roomId: 'room' }, _cloud: { request: async route => { fetched.push(route); return { file: original }; } } };
    await app.loadSDDroppedSource();
    assert.equal(fetched.length, 1, field + ' mismatch must fetch exact candidate source');
    assert.deepEqual(app.sdDroppedSource[field], original[field]); assert.deepEqual(candidate.snapshot, snapshot);
  }
});
test('coalesced viewers validate their own frozen metadata before receiving a shared source result', async () => {
  let release, reads = 0;
  const file = desc(), ref = { baselineId: 'old', filepath: file.filepath, candidateId: 'same-candidate' };
  const resolver = B.createResolver({ extractor: {}, store: { getBaselineFile: () => {
    reads++; return new Promise(resolve => { release = resolve; });
  } } });
  const first = resolver.resolveBaselineFile(ref, { validateFile: result => assert.deepEqual(result.remarks, file.remarks) });
  const second = resolver.resolveBaselineFile(ref, { validateFile: result => {
    if (JSON.stringify(result.remarks) !== JSON.stringify(['Different frozen remark'])) throw new Error('This caller has different frozen metadata.');
  } });
  const rejected = assert.rejects(second, /different frozen metadata/);
  await next(); release(file); assert.deepEqual(await first, file); await rejected;
  assert.equal(reads, 1, 'The viewers still coalesce their source read.');
});
test('same logical Dropped refresh retains its failure until relevant source succeeds', async () => {
  const root = {}, context = vm.createContext({ window: root });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sdBaselineUi.js'), 'utf8'), context);
  const file = desc(), candidate = { id: 'stable-candidate', revision: 3, originSourceHash: 'old', filepath: file.filepath,
    language: 'Thai', snapshot: { english: copy(file.translations.English), translations: ['Preserved translation'] } };
  const mixin = root.SDBaselineUI.mixin;
  const app = { ...mixin.data(), ...mixin.methods, editorVisible: true, editorDroppedCandidate: candidate, sdBaselineViewScope: 'scope', gameVersion: 'poe2',
    resolveSDSource: async () => { throw new Error('Missing original ZIP.'); } };
  await app.loadSDDroppedSource(); const failure = app.sdDroppedSourceError;
  assert.match(failure, /Missing original ZIP/);
  app.editorDroppedCandidate = copy(candidate);
  app.resolveSDSource = () => { throw new Error('A background clone refresh must not retry or clear this failure.'); };
  await app.loadSDDroppedSource({ background: true }); assert.equal(app.sdDroppedSourceError, failure);
  let release; const read = new Promise(resolve => { release = resolve; });
  app.resolveSDSource = () => read;
  app.editorDroppedCandidate = copy(candidate);
  const retry = app.loadSDDroppedSource();
  assert.equal(app.sdDroppedSourceError, failure); assert.equal(app.sdDroppedSourceLoading, true);
  // A harmless refreshed object is the same candidate even during this read.
  app.editorDroppedCandidate = copy(candidate);
  release(file); await retry;
  assert.equal(app.sdDroppedSourceError, ''); assert.equal(app.sdDroppedSourceLoading, false);
  assert.equal(app.sdDroppedSource.translations.English[0], file.translations.English[0]);
  app.resolveSDSource = () => { throw new Error('Settled background source content must remain visible.'); };
  await app.loadSDDroppedSource({ background: true }); assert.equal(app.sdDroppedSource, file); assert.equal(app.sdDroppedSourceLoading, false);
  app.resolveSDSource = async () => { throw new Error('Unavailable again.'); };
  await app.loadSDDroppedSource(); assert.match(app.sdDroppedSourceError, /Unavailable again/);
  app.editorDroppedCandidate = { ...copy(candidate), revision: 4 };
  let settle; app.resolveSDSource = () => new Promise(resolve => { settle = resolve; });
  const newRevision = app.loadSDDroppedSource(); assert.equal(app.sdDroppedSourceError, '', 'A new reviewed generation has a separate error binding.');
  settle(file); await newRevision;
  app.testMode = true;
  app.resolveSDSource = () => { throw new Error('Test mode must not access durable source storage.'); };
  await app.loadSDDroppedSource(); assert.equal(app.sdDroppedSource, null);
});
test('a cancelled first fetch adapter cannot poison a valid coalesced caller', async () => {
  let release, firstCurrent = true, firstFetches = 0, secondFetches = 0;
  const gate = new Promise(resolve => { release = resolve; }), file = desc();
  const resolver = B.createResolver({ extractor: {}, store: { getBaselineFile: async () => { await gate; return null; } } });
  const ref = { baselineId: 'old', filepath: file.filepath, candidateId: 'same' };
  const first = resolver.resolveBaselineFile(ref, { current: () => firstCurrent, fetchFile: async () => {
    firstFetches++; if (!firstCurrent) throw Object.assign(new Error('First comparison was cancelled before fetch.'), { stale: true });
    return { file };
  } });
  const rejected = assert.rejects(first, error => error.stale === true);
  const second = resolver.resolveBaselineFile(ref, { current: () => true, fetchFile: async () => { secondFetches++; return { file }; } });
  await next(); firstCurrent = false; release();
  assert.deepEqual(await second, file); await rejected;
  assert.equal(firstFetches, 1); assert.equal(secondFetches, 1);
});
test('view cancellation does not cancel captured authenticated I/O needed by another viewer', async () => {
  const root = {}, context = vm.createContext({ window: root });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sdBaselineUi.js'), 'utf8'), context);
  let release, firstCurrent = true, calls = 0;
  const gate = new Promise(resolve => { release = resolve; }), file = desc();
  root.OfflineStore = { getBaselineFile: async () => { await gate; return null; } };
  root.SDBaselineFiles = B.createResolver({ store: root.OfflineStore, extractor: {} });
  const captured = { profile: 'owner', epoch: 2, language: 'Thai', role: 'translator', assignmentVersion: 1 };
  const cloud = { context: () => captured, request: async function (path, options, requestContext) {
    calls++; assert.equal(this, cloud); assert.equal(requestContext, captured); return { file };
  } };
  const mixin = root.SDBaselineUI.mixin, app = { ...mixin.data(), ...mixin.methods, gameVersion: 'poe2', cloudSignedIn: true,
    cloudProfileId: 'owner', lang: 'Thai', collaborationState: { roomId: 'room' }, _cloud: cloud };
  const ref = { baselineId: 'old', filepath: file.filepath };
  const first = app.resolveSDSource(ref, { current: () => firstCurrent }), rejected = assert.rejects(first, error => error.stale === true);
  const second = app.resolveSDSource(ref, { current: () => true });
  await next(); firstCurrent = false;
  app._cloud = { request: () => { throw new Error('The mutable replacement client must not supply this read.'); } };
  release(); assert.deepEqual(await second, file); await rejected; assert.equal(calls, 1);
});
test('account/access-scoped pending source reads use each captured authentication context', async () => {
  const root = {}, context = vm.createContext({ window: root });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sdBaselineUi.js'), 'utf8'), context);
  let release, firstCurrent = true, reads = 0;
  const gate = new Promise(resolve => { release = resolve; }), file = desc(), calls = [];
  root.OfflineStore = { getBaselineFile: async () => { reads++; await gate; return null; } };
  root.SDBaselineFiles = B.createResolver({ store: root.OfflineStore, extractor: {} });
  const firstContext = { profile: 'alice', epoch: 1, language: 'Thai', role: 'translator', assignmentVersion: 1 };
  const secondContext = { profile: 'bob', epoch: 2, language: 'Thai', role: 'manager', assignmentVersion: 2 };
  const mixin = root.SDBaselineUI.mixin;
  const app = { ...mixin.data(), ...mixin.methods, gameVersion: 'poe2', cloudSignedIn: true, lang: 'Thai', collaborationState: { roomId: 'room' },
    _cloud: { context: () => firstContext, request: async (path, options, captured) => {
      calls.push(captured.profile); assert.equal(captured, firstContext); throw Object.assign(new Error('Old account access was revoked.'), { stale: true });
    } } };
  const ref = { baselineId: 'old', filepath: file.filepath };
  const first = app.resolveSDSource(ref, { current: () => firstCurrent }), rejected = assert.rejects(first, error => error.stale === true);
  app._cloud = { context: () => secondContext, request: async (path, options, captured) => {
    calls.push(captured.profile); assert.equal(captured, secondContext); return { file };
  } };
  const second = app.resolveSDSource(ref, { current: () => true });
  await next(); firstCurrent = false; release();
  assert.deepEqual(await second, file); await rejected;
  assert.equal(reads, 2, 'Different access scopes must not share an authenticated pending read.');
  assert.deepEqual(calls.sort(), ['alice', 'bob']);
});
test('a partial Dropped read keeps translated values visible while exact-source loading fails', async () => {
  const root = {}, context = vm.createContext({ window: root });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sdBaselineUi.js'), 'utf8'), context);
  const mixin = root.SDBaselineUI.mixin, candidate = { id: 'partial', revision: 2, originSourceHash: 'old', filepath: 'source/a.txt',
    originSourceAvailable: true, sourceUnavailable: true, sourceError: 'The retained original ZIP is missing.',
    sourceRef: { baselineId: 'old', filepath: 'source/a.txt', candidateId: 'partial' }, snapshot: { translations: ['Last authored translation'] } };
  let fetched = false;
  const app = { ...mixin.data(), ...mixin.methods, editorVisible: true, editorDroppedCandidate: candidate, sdBaselineViewScope: 'scope', gameVersion: 'poe2',
    resolveSDSource: async ref => { fetched = true; assert.equal(ref.candidateId, candidate.id); throw new Error('Import the missing original ZIP to compare this source.'); } };
  const before = structuredClone(candidate), read = app.loadSDDroppedSource();
  assert.match(app.sdDroppedSourceError, /original ZIP is missing/);
  await read; assert.equal(fetched, true); assert.equal(app.sdDroppedSource, null);
  assert.match(app.sdDroppedSourceError, /Import the missing original ZIP/);
  assert.deepEqual(candidate, before); assert.deepEqual(candidate.snapshot.translations, ['Last authored translation']);
});
