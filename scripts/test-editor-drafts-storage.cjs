const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ failRevision = false } = {}) {
  const source = [{ filepath: 'stat.txt', filename: 'stat.txt', translations: { English: ['Source'], Thai: ['old'] } }];
  const kv = new Map([['source_poe1', copy(source)], ['workspace_poe1', { game: 'poe1', sourceHash: 'source',
    stagedVersion: 1, staged: {}, dropped: {}, droppedArchive: {}, status: {}, descs: copy(source) }]]);
  const revisions = [], transactions = [], versions = [];
  const db = { transaction(names) {
    const writes = []; let finished = false;
    const tx = { objectStore(name) { return {
      get(key) {
        const req = {};
        queueMicrotask(() => {
          const prior = writes.findLast(row => row.name === 'kv' && row.value.key === key);
          const value = prior ? prior.value.value : kv.get(key);
          req.result = value === undefined ? undefined : { key, value: structuredClone(value) };
          req.onsuccess?.();
        }); return req;
      },
      getAll() {
        const req = {}; queueMicrotask(() => { req.result = [...kv].map(([key, value]) => ({ key, value: structuredClone(value) })); req.onsuccess?.(); }); return req;
      },
      put(value) { writes.push({ name, value: structuredClone(value) }); },
      add(value) { if (failRevision) throw new Error('History unavailable'); writes.push({ name, value: structuredClone(value) }); },
    }; },
    abort() { finished = true; queueMicrotask(() => tx.onabort?.()); },
    complete() {
      assert.equal(finished, false); finished = true;
      for (const row of writes) if (row.name === 'kv') kv.set(row.value.key, row.value.value); else revisions.push(row.value);
      tx.oncomplete?.();
    } };
    transactions.push(tx); return tx;
  } };
  const root = {}, indexedDB = { open(name, version) { versions.push(version); const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req; } };
  const ctx = vm.createContext({ window: root, indexedDB, console: { log() {} } });
  for (const filename of ['workspaceState.js', 'offlineStore.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', filename), 'utf8'), ctx);
  return { store: root.OfflineStore, kv, revisions, transactions, versions, source };
}
async function commit(f, promise) { await tick(); f.transactions.at(-1).complete(); return promise; }
const draft = (changes = {}) => ({ profile: 'guest', game: 'poe1', sourceHash: 'source', language: 'Thai', filepath: 'stat.txt',
  id: 'draft-a', revision: 'revision-a', translations: ['new'], base: { translations: ['old'], trackedForExport: false },
  source: { translations: { English: ['Source'], Thai: ['old'] } }, updatedAt: 1, ...changes });
function batch(record, changes = {}) {
  return { jobId: 'save-1', game: 'poe1', sourceHash: 'source', language: 'Thai', accountId: '',
    files: [{ filepath: 'stat.txt', translations: ['new'] }],
    revisions: [{ filepath: 'stat.txt', lang: 'Thai', translations: ['new'], savedAt: 2 }],
    draft: { key: record.key, id: record.id, revision: record.revision, base: copy(record.base) }, ...changes };
}
async function write(f, value = draft(), expectedRevision = null, options = {}) {
  return commit(f, f.store.putTranslationDraft(value, { expectedRevision, ...options }));
}
function sharedRoom(f, changes = {}) {
  const identity = { accountId: 'account', game: 'poe1', sourceHash: 'source', language: 'Thai' };
  const key = JSON.stringify(['account', 'poe1', 'source', 'Thai']);
  const before = { filepath: 'stat.txt', translations: ['old'], revision: 4, trackedForExport: true };
  const room = { identity, roomId: 'room', manifest: { files: [{ filepath: 'stat.txt', english: ['Source'] }] },
    local: { 'stat.txt': before }, shared: { 'stat.txt': before }, outbox: [], conflicts: [], recovery: [], ...changes };
  f.kv.set('collaboration_v1', { rooms: { [key]: room } });
  return { key, identity, origin: 'save', bases: { 'stat.txt': { filepath: 'stat.txt', translations: ['old'], revision: 2 } } };
}

test('draft writes are separate from committed workspace and only acknowledge transaction completion', async () => {
  const f = fixture(), before = copy(f.kv.get('workspace_poe1'));
  const input = draft(); let done = false;
  const pending = f.store.putTranslationDraft(input).then(result => { done = true; return result; });
  await tick(); assert.equal(done, false); assert.equal(f.kv.size, 2);
  input.translations[0] = 'later'; input.base.translations[0] = 'mutated'; input.source.translations.English[0] = 'changed';
  f.transactions.at(-1).complete(); const result = await pending;
  assert.equal(result.status, 'saved'); assert.equal(result.record.translations[0], 'new');
  assert.equal(result.record.base.translations[0], 'old'); assert.equal(result.record.source.translations.English[0], 'Source');
  assert.deepEqual(f.kv.get('workspace_poe1'), before); assert.equal(f.revisions.length, 0);
  assert.deepEqual(f.versions, [11]);
});

test('list and key isolate profile, game, source and language without retargeting old-source drafts', async () => {
  const f = fixture();
  for (const change of [{}, { sourceHash: 'other-source' }, { profile: 'account' }, { game: 'poe2' }, { language: 'German' }]) await write(f, draft(change));
  const list = await commit(f, f.store.listTranslationDrafts({ profile: 'guest', game: 'poe1', language: 'Thai' }));
  assert.deepEqual(list.map(row => row.sourceHash).sort(), ['other-source', 'source']);
  const scoped = await commit(f, f.store.listTranslationDrafts({ profile: 'guest', game: 'poe1', language: 'Thai', sourceHash: 'source' }));
  assert.equal(scoped.length, 1);
  assert.equal((await commit(f, f.store.getTranslationDraft(scoped[0].key))).id, 'draft-a');
});

test('drafts on distinct release branches remain independent while default-branch keys and IDs remain compatible', async () => {
  const f = fixture();
  const original = await write(f, draft());
  assert.equal(original.record.key, 'translation_draft_v1:' + JSON.stringify(['guest', 'poe1', 'source', 'Thai', 'stat.txt']));
  const branch = await write(f, draft({ branchId: 'release', id: 'branch-draft', revision: 'branch-revision', translations: ['branch text'] }));
  assert.notEqual(branch.record.key, original.record.key);
  assert.equal((await commit(f, f.store.listTranslationDrafts({ profile: 'guest', game: 'poe1', language: 'Thai' }))).length, 1);
  const selected = await commit(f, f.store.listTranslationDrafts({ profile: 'guest', game: 'poe1', language: 'Thai', branchId: 'release' }));
  assert.equal(selected.length, 1); assert.equal(selected[0].id, 'branch-draft'); assert.equal(selected[0].translations[0], 'branch text');
});
test('identical ZIP sources in separate content groups retain independent drafts and exact legacy keys',async()=>{
  const f=fixture();await write(f);
  const a=await write(f,draft({versionId:'version',groupId:'first',id:'first',revision:'first'}));
  const b=await write(f,draft({versionId:'version',groupId:'second',id:'second',revision:'second'}));
  assert.notEqual(a.record.key,b.record.key);
  const legacy=await commit(f,f.store.listTranslationDrafts({profile:'guest',game:'poe1',language:'Thai'}));assert.equal(legacy.length,1);
  for(const groupId of ['first','second']){
    const selected=await commit(f,f.store.listTranslationDrafts({profile:'guest',game:'poe1',language:'Thai',versionId:'version',groupId}));
    assert.equal(selected.length,1);assert.equal(selected[0].id,groupId);
    assert.equal((await commit(f,f.store.getTranslationDraft(selected[0].key))).groupId,groupId);
  }
});

test('CAS preserves competing text, deduplicates retries, and a reviewed choice retains recovery', async () => {
  const f = fixture(), first = await write(f);
  const other = draft({ id: 'draft-b', revision: 'revision-b', translations: ['competing'] });
  const conflict = await write(f, other);
  assert.equal(conflict.status, 'conflict'); assert.equal(conflict.record.translations[0], 'new');
  assert.equal(conflict.record.conflicts[0].translations[0], 'competing');
  const duplicate = await write(f, other); assert.equal(duplicate.record.conflicts.length, 1); assert.equal(duplicate.duplicate, true);
  const resolved = await write(f, { ...other, revision: 'reviewed' }, conflict.record.revision, { resolveConflicts: true });
  assert.equal(resolved.status, 'saved'); assert.equal(resolved.record.translations[0], 'competing');
  assert.equal(resolved.record.conflicts.length, 0); assert.equal(resolved.record.recovery.length, 2);
});

test('same revision retries are idempotent but cannot change text or bases', async () => {
  const f = fixture(); await write(f);
  assert.equal((await write(f, draft({ updatedAt: 9 }))).duplicate, true);
  await assert.rejects(f.store.putTranslationDraft(draft({ translations: ['collision'] })), /revision cannot be reused/);
  await assert.rejects(f.store.putTranslationDraft(draft({ base: { translations: ['different base'] } })), /revision cannot be reused/);
});

test('discard is revision checked, leaves a tombstone, and stale writers cannot revive it', async () => {
  const f = fixture(), { record } = await write(f);
  const stale = await commit(f, f.store.discardTranslationDraft(record.key, 'wrong'));
  assert.equal(stale.status, 'conflict'); assert.equal(f.kv.get(record.key).state, 'active');
  const discarded = await commit(f, f.store.discardTranslationDraft(record.key, record.revision));
  assert.equal(discarded.status, 'discarded'); assert.equal(discarded.record.state, 'discarded');
  const retry = await write(f); assert.equal(retry.status, 'discarded'); assert.equal(retry.duplicate, true);
  await assert.rejects(f.store.putTranslationDraft(draft({ translations: ['same token, changed text'] })), /revision cannot be reused/);
  const late = await write(f, draft({ revision: 'late', translations: ['late typing'] }), record.revision);
  assert.equal(late.status, 'conflict'); assert.equal(late.record.state, 'discarded'); assert.equal(late.record.conflicts[0].translations[0], 'late typing');
});

test('promotion consumes the exact draft atomically with workspace/history and supports receipt retry', async () => {
  const f = fixture(), { record } = await write(f), request = batch(record);
  const pending = f.store.saveTranslationBatch(request); await tick();
  assert.equal(f.kv.get(record.key).state, 'active'); assert.equal(f.revisions.length, 0);
  f.transactions.at(-1).complete(); const result = await pending;
  assert.equal(result.draftConsumed, true); assert.equal(f.kv.get(record.key).state, 'promoted');
  assert.deepEqual(f.kv.get('workspace_poe1').staged.Thai['stat.txt'].translations, ['new']); assert.equal(f.revisions.length, 1);
  const retry = await commit(f, f.store.saveTranslationBatch(request));
  assert.equal(retry.duplicate, true); assert.equal(retry.draftConsumed, true); assert.equal(f.revisions.length, 1);
  assert.equal((await write(f)).status, 'promoted');
});

test('promotion of an older submitted revision preserves a newer revision of the same draft', async () => {
  const f = fixture(), first = await write(f);
  await write(f, draft({ revision: 'next', translations: ['typing continues'] }), first.record.revision);
  const result = await commit(f, f.store.saveTranslationBatch(batch(first.record)));
  assert.equal(result.draftConsumed, false); assert.equal(f.kv.get(first.record.key).translations[0], 'typing continues');
  assert.deepEqual(f.kv.get('workspace_poe1').staged.Thai['stat.txt'].translations, ['new']);
});

test('failed transaction preserves the draft and never partially stages or writes history', async () => {
  const f = fixture({ failRevision: true }), { record } = await write(f);
  await assert.rejects(f.store.saveTranslationBatch(batch(record)), /History unavailable/);
  assert.equal(f.kv.get(record.key).state, 'active'); assert.equal(f.revisions.length, 0);
  assert.deepEqual(f.kv.get('workspace_poe1').staged, {}); assert.equal(f.kv.has('translation_save_receipts_poe1'), false);
});

test('local durable committed drift rejects promotion and preserves both committed and draft text', async () => {
  const f = fixture(), { record } = await write(f);
  f.kv.get('workspace_poe1').staged.Thai = { 'stat.txt': { translations: ['another save'], sourceHash: 'source' } };
  await assert.rejects(f.store.saveTranslationBatch(batch(record)), error => error.code === 'DRAFT_BASE_CHANGED' && error.currentTranslations[0] === 'another save');
  assert.equal(f.kv.get(record.key).translations[0], 'new'); assert.equal(f.revisions.length, 0);
});

test('missing, discarded, replaced and competing drafts cannot auto-promote', async () => {
  const f = fixture(), { record } = await write(f), request = batch(record);
  await write(f, draft({ id: 'other', revision: 'other' }));
  await assert.rejects(f.store.saveTranslationBatch(request), error => error.code === 'DRAFT_CONFLICT');
  await commit(f, f.store.discardTranslationDraft(record.key, f.kv.get(record.key).revision));
  await assert.rejects(f.store.saveTranslationBatch(request), error => error.code === 'DRAFT_CHANGED');
  f.kv.delete(record.key);
  await assert.rejects(f.store.saveTranslationBatch(request), error => error.code === 'DRAFT_CHANGED');
  await write(f, draft({ id: 'replacement', revision: 'replacement' }));
  await assert.rejects(f.store.saveTranslationBatch(request), error => error.code === 'DRAFT_CHANGED');
});

test('draft scope mismatch and token reuse with changed save metadata fail without mutation', async () => {
  const f = fixture(), { record } = await write(f);
  await assert.rejects(f.store.saveTranslationBatch(batch(record, { accountId: 'another' })), /scope/);
  const request = batch(record); await commit(f, f.store.saveTranslationBatch(request));
  await assert.rejects(f.store.saveTranslationBatch({ ...request, draft: { ...request.draft, revision: 'changed' } }), /identifier was reused/);
  assert.equal(f.revisions.length, 1);
});

test('a receipt retry never consumes a new draft created after the original promotion', async () => {
  const f = fixture(), first = await write(f), request = batch(first.record);
  await commit(f, f.store.saveTranslationBatch(request));
  const consumed = f.kv.get(first.record.key);
  const next = draft({ id: 'next-draft', revision: 'next-revision', translations: ['more editing'], base: { translations: ['new'] } });
  await write(f, next, consumed.revision);
  const receipt = await commit(f, f.store.saveTranslationBatch(request));
  assert.equal(receipt.duplicate, true); assert.equal(f.kv.get(first.record.key).id, next.id);
  assert.equal(f.kv.get(first.record.key).state, 'active'); assert.equal(f.revisions.length, 1);
});

test('shared save consumes drafts atomically with the outbox and retains the captured merge ancestor', async () => {
  const f = fixture(), { record } = await write(f, draft({ profile: 'account' }));
  const collaboration = sharedRoom(f);
  const result = await commit(f, f.store.saveTranslationBatch(batch(record, { accountId: 'account', collaboration })));
  assert.equal(result.draftConsumed, true); assert.equal(f.kv.get(record.key).state, 'promoted');
  const operations = f.kv.get('collaboration_v1').rooms[collaboration.key].outbox;
  assert.equal(operations.length, 1); assert.deepEqual(operations[0].files[0].base.translations, ['old']);
  assert.equal(f.revisions.length, 1);
});

test('shared drafts reject durable committed drift before consuming or adding to the outbox', async () => {
  const f = fixture(), { record } = await write(f, draft({ profile: 'account' })), collaboration = sharedRoom(f);
  f.kv.get('workspace_poe1').staged.Thai = { 'stat.txt': { translations: ['changed remotely'], sourceHash: 'source' } };
  const before = copy([...f.kv]);
  await assert.rejects(f.store.saveTranslationBatch(batch(record, { accountId: 'account', collaboration })),
    error => error.code === 'DRAFT_BASE_CHANGED' && error.currentTranslations[0] === 'changed remotely');
  assert.deepEqual(copy([...f.kv]), before); assert.equal(f.revisions.length, 0);
});

test('shared drafts require a captured committed base', async () => {
  const f = fixture(), { record } = await write(f, draft({ profile: 'account' })), collaboration = sharedRoom(f);
  const request = batch(record, { accountId: 'account', collaboration }); delete request.draft.base;
  await assert.rejects(f.store.saveTranslationBatch(request), /scope/);
  assert.equal(f.kv.get(record.key).state, 'active'); assert.equal(f.revisions.length, 0);
});

test('shared drafts reject same-file durable conflicts while unrelated conflict files remain isolated', async () => {
  const cases = [{ conflicts: [{ filepath: 'stat.txt' }] },
    ...['conflict', 'candidate_conflict', 'needs_candidate_review'].map(status => ({ outbox: [
      { id: 'existing', status, files: [{ yours: { filepath: 'stat.txt', translations: ['earlier'] } }] },
    ] })), { outbox: [{ id: 'existing', status: 'pending', blockedByConflict: true,
      files: [{ yours: { filepath: 'stat.txt', translations: ['earlier'] } }] }] }];
  for (const changes of cases) {
    const f = fixture(), { record } = await write(f, draft({ profile: 'account' })), collaboration = sharedRoom(f, changes);
    const before = copy([...f.kv]);
    await assert.rejects(f.store.saveTranslationBatch(batch(record, { accountId: 'account', collaboration })),
      error => error.code === 'DRAFT_CONFLICT' && error.filepath === 'stat.txt');
    assert.deepEqual(copy([...f.kv]), before); assert.equal(f.revisions.length, 0);
  }
  const f = fixture(), { record } = await write(f, draft({ profile: 'account' }));
  const collaboration = sharedRoom(f, { conflicts: [{ filepath: 'other.txt' }],
    outbox: [{ id: 'unrelated', status: 'conflict', files: [{ yours: { filepath: 'other.txt' } }] }] });
  const result = await commit(f, f.store.saveTranslationBatch(batch(record, { accountId: 'account', collaboration })));
  assert.equal(result.draftConsumed, true);
  assert.equal(f.kv.get('collaboration_v1').rooms[collaboration.key].outbox.length, 2);
});

test('ordinary pre-draft save receipt signatures remain byte-compatible', async () => {
  const f = fixture(), request = batch({ key: 'unused', id: 'unused', revision: 'unused', base: {} });
  delete request.draft;
  await commit(f, f.store.saveTranslationBatch(request));
  const receipt = f.kv.get('translation_save_receipts_poe1')[0];
  const oldSignature = JSON.stringify({ scope: ['poe1', 'Thai', 'source', ''],
    files: [{ filepath: 'stat.txt', translations: ['new'], needsReview: false, trackedForExport: false, revision: 0 }],
    descriptions: [], statuses: {}, revisions: request.revisions, collaboration: null, promoteDropped: null, promoteDroppedByPath: null });
  assert.equal(receipt.signature, oldSignature);
  assert.equal((await commit(f, f.store.saveTranslationBatch(request))).duplicate, true);
});

test('declined warning fingerprint survives a durable read and changes only with a new draft revision', async () => {
  const f = fixture(), declined = JSON.stringify([['new'], 'Existing warning']);
  const { record } = await write(f, draft({ declined }));
  const restored = await commit(f, f.store.getTranslationDraft(record.key));
  assert.equal(restored.declined, declined);
  await assert.rejects(f.store.putTranslationDraft(draft({ declined: 'different warning' }), { expectedRevision: record.revision }), /revision cannot be reused/);
  const changed = await write(f, draft({ revision: 'changed-warning', declined: '' }), record.revision);
  assert.equal(changed.record.declined, undefined);
});

test('entry alignment retains exact original blocks in durable drafts and validates recovery revisions', async () => {
  const f = fixture();
  const recovery = [{ translations: ['เดิม@ช่อง\\nต่อ', 'removed', 'last'], english: ['A', null, 'C'], savedAt: 10 }];
  const incoming = draft({ alignmentRecovery: copy(recovery) });
  const { record } = await write(f, incoming);
  incoming.alignmentRecovery[0].translations[1] = 'mutated after writing';
  const restored = await commit(f, f.store.getTranslationDraft(record.key));
  assert.deepEqual(copy(restored.alignmentRecovery), recovery);
  await assert.rejects(f.store.putTranslationDraft(draft({ alignmentRecovery: [{ ...recovery[0], translations: ['different'] }] })), /Invalid entry alignment recovery/);
  await assert.rejects(f.store.putTranslationDraft(draft({ alignmentRecovery: [{ ...recovery[0], translations: ['changed', 'removed', 'last'] }] })), /revision cannot be reused/);
});

test('aligned save atomically retains before-alignment history and consumes the exact draft checkpoint', async () => {
  const f = fixture();
  const recovery = [{ translations: ['first', 'removed', 'last'], english: ['A', null, 'C'], savedAt: 10 }];
  const { record } = await write(f, draft({ alignmentRecovery: recovery }));
  const before = copy(f.kv.get('workspace_poe1'));
  const revisions = [{ filepath: 'stat.txt', lang: 'Thai', savedAt: 10, note: 'Before entry alignment', translations: recovery[0].translations },
    { filepath: 'stat.txt', lang: 'Thai', savedAt: 11, note: 'save', translations: ['new'] }];
  const request = batch(record, { revisions });
  const pending = f.store.saveTranslationBatch(request);
  await tick();
  assert.deepEqual(f.kv.get('workspace_poe1'), before);
  assert.equal(f.kv.get(record.key).state, 'active');
  assert.equal(f.revisions.length, 0);
  f.transactions.at(-1).complete();
  assert.equal((await pending).draftConsumed, true);
  assert.equal(f.kv.get(record.key).state, 'promoted');
  assert.deepEqual(f.revisions.map(item => copy(item.translations)), [['first', 'removed', 'last'], ['new']]);
  const retried = await commit(f, f.store.saveTranslationBatch(request));
  assert.equal(retried.duplicate, true);
  assert.equal(f.revisions.length, 2, 'An uncertain replay must not create additional before-alignment history.');
});

test('unresolved conflicts never replace the primary draft during ordinary retries or subsequent typing', async () => {
  const f = fixture(), primary = await write(f, draft({ translations: ['draft A'] }));
  const b = draft({ id: 'draft-b', revision: 'b1', translations: ['draft B'] });
  const conflict = await write(f, b);
  assert.equal(conflict.status, 'conflict'); assert.equal(conflict.record.translations[0], 'draft A');
  assert.notEqual(conflict.record.revision, primary.record.revision);
  const repeated = await write(f, { ...b, revision: 'b2' }, conflict.record.revision);
  assert.equal(repeated.status, 'conflict'); assert.equal(repeated.duplicate, true);
  assert.equal(repeated.preserved.revision, 'b1'); assert.equal(repeated.record.conflicts.length, 1);
  assert.equal(repeated.record.translations[0], 'draft A');
  const furtherTyping = await write(f, { ...b, revision: 'b3', translations: ['draft B continued'] }, repeated.record.revision);
  assert.equal(furtherTyping.status, 'conflict'); assert.equal(furtherTyping.record.translations[0], 'draft A');
  assert.deepEqual(copy(furtherTyping.record.conflicts.map(record => record.translations[0])), ['draft B', 'draft B continued']);
  await assert.rejects(f.store.saveTranslationBatch(batch(furtherTyping.record)), error => error.code === 'DRAFT_CONFLICT');
  const resolved = await write(f, { ...b, revision: 'reviewed-b', translations: ['draft B continued'] }, furtherTyping.record.revision, { resolveConflicts: true });
  assert.equal(resolved.status, 'saved'); assert.equal(resolved.record.translations[0], 'draft B continued');
  assert.equal(resolved.record.conflicts.length, 0);
  assert.deepEqual(copy(resolved.record.recovery.map(record => record.translations[0])).sort(), ['draft A', 'draft B', 'draft B continued'].sort());
});

test('another conflict invalidates a reviewed resolution and keeps every competing draft', async () => {
  const f = fixture(); await write(f, draft({ translations: ['draft A'] }));
  const b = draft({ id: 'draft-b', revision: 'b', translations: ['draft B'] });
  const reviewed = await write(f, b);
  const c = draft({ id: 'draft-c', revision: 'c', translations: ['draft C'] });
  const afterC = await write(f, c);
  assert.notEqual(afterC.record.revision, reviewed.record.revision);
  const staleReview = await write(f, { ...b, revision: 'reviewed-b' }, reviewed.record.revision, { resolveConflicts: true });
  assert.equal(staleReview.status, 'conflict'); assert.equal(staleReview.record.translations[0], 'draft A');
  assert.deepEqual(copy(staleReview.record.conflicts.map(record => record.translations[0])), ['draft B', 'draft C']);
});

test('retrying identical primary content does not create another competing copy', async () => {
  const f = fixture(), primary = draft({ translations: ['draft A'] }); await write(f, primary);
  const conflict = await write(f, draft({ id: 'draft-b', revision: 'b', translations: ['draft B'] }));
  const retried = await write(f, { ...primary, revision: 'retry-a' }, conflict.record.revision);
  assert.equal(retried.status, 'conflict'); assert.equal(retried.duplicate, true);
  assert.equal(retried.record.translations[0], 'draft A'); assert.equal(retried.record.conflicts.length, 1);
});
