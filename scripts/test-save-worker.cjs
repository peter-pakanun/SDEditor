const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../public/saveWorkerClient.js');
const queued = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));
const W = require('../public/workspaceState.js');
function assertNoStatusFlags(workspace) {
  const flags = ['hasChanges', 'isEdited', 'isRevised', 'isMissing', 'isDropped', 'needsReview', 'trackedForExport'];
  for (const value of [...(workspace.descs || []), ...Object.values(workspace.status || {})]) {
    for (const metadata of [value, ...Object.values(value.languageStatus || {})]) {
      for (const flag of flags) assert.equal(Object.hasOwn(metadata, flag), false, flag + ' is derived, not persisted');
    }
  }
}
const identity = { accountId: 'account', game: 'poe1', sourceHash: 'source', language: 'Thai' };
const key = JSON.stringify(['account', 'poe1', 'source', 'Thai']);
const file = (text = 'old') => ({ filepath: 'stat.txt', translations: [text], needsReview: false, trackedForExport: true, revision: 2 });
const batch = (options = {}) => ({ jobId: 'save-1', game: 'poe1', language: 'Thai', sourceHash: 'source', accountId: 'account',
  files: [file('new')], descriptions: [{ filepath: 'stat.txt', filename: 'stat.txt', translations: { English: ['source text'] } }],
  statuses: { 'stat.txt': { lastEditedAt: 20 } }, revisions: [{ filepath: 'stat.txt', lang: 'Thai', savedAt: 20, translations: ['new'] }],
  ...options });
function fixture({ collaboration = false, worker = false, failRevision = false } = {}) {
  const kv = new Map([['workspace_poe1', { sourceHash: 'source', collaborationAccountId: 'account', marker: true,
    descs: [{ filepath: 'stat.txt', translations: { English: ['source text'], Thai: ['old'], French: ['bonjour'] } },
      { filepath: 'other.txt', translations: { English: ['other'], Thai: ['untouched'] } }],
    status: { 'stat.txt': { lastExportedAt: 10 }, 'other.txt': { needsReview: true } } }]]);
  if (collaboration) kv.set('collaboration_v1', { version: 1, rooms: { [key]: { identity, roomId: 'room',
    manifest: { files: [{ filepath: 'stat.txt', english: ['source text'] }] },
    local: { 'stat.txt': file() }, shared: { 'stat.txt': file() }, outbox: [], conflicts: [], recovery: [] },
    unrelated: { local: { untouched: true } } } });
  const revisions = []; const transactions = []; const reads = [];
  const db = { transaction(names) {
    const pending = []; let finished = false;
    const tx = {
      objectStore(name) {
        assert.ok(names.includes(name));
        return {
          get(kvKey) {
            reads.push(kvKey);
            const req = {};
            queueMicrotask(() => {
              const written = pending.filter(item => item.store === 'kv' && item.row.key === kvKey).at(-1);
              const value = written ? written.row.value : kv.get(kvKey);
              req.result = value === undefined ? undefined : { key: kvKey, value: structuredClone(value) };
              req.onsuccess?.();
            }); return req;
          },
          put(row) { pending.push({ store: name, row: structuredClone(row) }); },
          add(row) { if (failRevision) throw new Error('Cannot store history'); pending.push({ store: name, row: structuredClone(row) }); },
        };
      },
      abort(error) { assert.equal(finished, false); finished = true; this.error = error; queueMicrotask(() => this.onabort?.()); },
      complete() {
        assert.equal(finished, false); finished = true;
        for (const item of pending) if (item.store === 'kv') kv.set(item.row.key, item.row.value); else revisions.push(item.row);
        this.oncomplete?.();
      },
    };
    transactions.push(tx); return tx;
  } };
  const indexedDB = { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req; } };
  const root = {}; const context = vm.createContext({ ...(worker ? { self: root } : { window: root }), indexedDB, console: { log() {} } });
  for (const file of ['workspaceState.js', 'offlineStore.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8'), context);
  }
  return { store: root.OfflineStore, kv, revisions, transactions, reads };
}
async function commit(f, request) { await queued(); f.transactions.at(-1).complete(); return request; }
function deletionFixture(options = {}) {
  const f = fixture(options), workspace = f.kv.get('workspace_poe1');
  const source = copy(workspace.descs);
  source[0].translations.Thai = ['ZIP translation'];
  f.kv.set('source_poe1', source);
  W.initializeWorkspace(workspace, { source, sourceHash: 'source', game: 'poe1', language: 'Thai' });
  return f;
}
const deletionBatch = (options = {}) => batch({ jobId: 'delete-1', origin: 'delete_staged', resetStaging: true,
  bases: { 'stat.txt': file() },
  files: [{ ...file('ZIP translation'), trackedForExport: false, stagingReset: true }],
  revisions: [{ filepath: 'stat.txt', lang: 'Thai', savedAt: 20, note: 'Before delete staged translation', translations: ['old'] },
    { filepath: 'stat.txt', lang: 'Thai', savedAt: 21, note: 'Delete staged translation', translations: ['ZIP translation'] }],
  ...options });

test('repeat draft saves use durable staged bases without cloning the full immutable source again', async () => {
  const f = fixture({ worker: true }), workspace = f.kv.get('workspace_poe1');
  const source = copy(workspace.descs);
  f.kv.set('source_poe1', source);
  W.initializeWorkspace(workspace, { source, sourceHash: 'source', game: 'poe1', language: 'Thai' });
  const draftScope = { profile: 'account', game: 'poe1', sourceHash: 'source', language: 'Thai', filepath: 'stat.txt' };
  const draftKey = f.store.translationDraftKey(draftScope);
  function draft(revision, base, translations) {
    f.kv.set(draftKey, { ...draftScope, key: draftKey, id: 'draft', revision, state: 'active', source: copy(source[0]), translations, base: { translations: base } });
    return { key: draftKey, id: 'draft', revision, base: { translations: base } };
  }
  const first = await commit(f, f.store.saveTranslationBatch(batch({ draft: draft('first', ['old'], ['new']) })));
  assert.equal(first.draftConsumed, true);
  assert.equal(f.reads.filter(key => key === 'source_poe1').length, 1, 'An unstaged draft still checks its immutable ZIP base.');
  const request = batch({ jobId: 'save-2', files: [file('next')], draft: draft('second', ['new'], ['next']) });
  let settled = false;
  const pending = f.store.saveTranslationBatch(request).then(ack => { settled = true; return ack; });
  await queued();
  assert.equal(settled, false, 'Fast repeat saves must still await the complete durable transaction.');
  assert.deepEqual(f.kv.get('workspace_poe1').staged.Thai['stat.txt'].translations, ['new']);
  assert.equal(f.kv.get(draftKey).state, 'active');
  f.transactions.at(-1).complete();
  const second = await pending;
  assert.equal(second.draftConsumed, true);
  assert.equal(f.reads.filter(key => key === 'source_poe1').length, 1);
  assert.deepEqual(f.kv.get('workspace_poe1').staged.Thai['stat.txt'].translations, ['next']);
  assert.equal(f.kv.get(draftKey).state, 'promoted');
  assert.equal(f.revisions.length, 2);
  assert.deepEqual(f.kv.get('source_poe1'), source);
  const retry = await commit(f, f.store.saveTranslationBatch(request));
  assert.equal(retry.duplicate, true);
  assert.equal(f.revisions.length, 2);
  assert.equal(f.reads.filter(key => key === 'source_poe1').length, 1);
  const changed = batch({ jobId: 'save-3', files: [file('latest')], draft: draft('third', ['new'], ['latest']) });
  await assert.rejects(f.store.saveTranslationBatch(changed), error => error.code === 'DRAFT_BASE_CHANGED');
  assert.equal(f.kv.get(draftKey).state, 'active');
  assert.deepEqual(f.kv.get('workspace_poe1').staged.Thai['stat.txt'].translations, ['next']);
  assert.equal(f.revisions.length, 2);
});

test('modern ordinary saves skip unused source reads while migration and staged deletion retain them', async () => {
  const f = fixture({ worker: true }), workspace = f.kv.get('workspace_poe1');
  W.initializeWorkspace(workspace, { source: copy(workspace.descs), sourceHash: 'source', game: 'poe1', language: 'Thai' });
  await commit(f, f.store.saveTranslationBatch(batch()));
  assert.equal(f.reads.includes('source_poe1'), false);
  const legacy = fixture({ worker: true });
  await commit(legacy, legacy.store.saveTranslationBatch(batch()));
  assert.equal(legacy.reads.filter(key => key === 'source_poe1').length, 1);
  const deletion = deletionFixture({ worker: true });
  await commit(deletion, deletion.store.saveTranslationBatch(deletionBatch()));
  assert.equal(deletion.reads.filter(key => key === 'source_poe1').length, 1);
  assert.deepEqual(deletion.kv.get('source_poe1')[0].translations.Thai, ['ZIP translation']);
});

test('staged deletion durably restores immutable ZIP text and preserves other languages, dropped copies and drafts', async () => {
  const f = deletionFixture({ worker: true }), workspace = f.kv.get('workspace_poe1');
  const source = copy(f.kv.get('source_poe1'));
  W.stageTranslation(workspace, { filepath: 'stat.txt', translations: ['eins'] }, 'German', { source: source[0], sourceHash: 'source' });
  W.dropTranslation(workspace, source[0], 'Thai', { id: 'preserved-copy', originSourceHash: 'old-source', targetSourceHash: 'source',
    translations: ['recoverable'] });
  const dropped = copy(workspace.dropped), archive = copy(workspace.droppedArchive), outbox = copy(workspace.droppedOutbox);
  const draft = { state: 'active', translations: ['unsaved typing'], revision: 'draft-revision' };
  f.kv.set('private-draft', draft);
  let settled = false;
  const saving = f.store.saveTranslationBatch(deletionBatch()).then(value => { settled = true; return value; });
  await queued(); assert.equal(settled, false);
  assert.deepEqual(f.kv.get('workspace_poe1').staged.Thai['stat.txt'].translations, ['old']);
  f.transactions.at(-1).complete(); const ack = await saving;
  const saved = f.kv.get('workspace_poe1'), derived = W.workspaceFile(saved, source[0], 'Thai');
  assert.equal(saved.staged.Thai['stat.txt'], undefined); assert.equal(derived.hasChanges, false);
  assert.deepEqual(derived.translations, ['ZIP translation']);
  assert.deepEqual(saved.descs[0].translations.Thai, ['ZIP translation']);
  assert.deepEqual(saved.descs[0].translations.French, ['bonjour']);
  assert.deepEqual(saved.staged.German['stat.txt'].translations, ['eins']);
  assert.deepEqual(saved.descs[1].translations.Thai, ['untouched']);
  assert.deepEqual(saved.dropped, dropped); assert.deepEqual(saved.droppedArchive, archive); assert.deepEqual(saved.droppedOutbox, outbox);
  assert.ok(saved.droppedArchive['preserved-copy'].targetSourceHashes.includes('source'));
  assert.deepEqual(f.kv.get('source_poe1'), source); assert.deepEqual(f.kv.get('private-draft'), draft);
  assert.equal(ack.files[0].trackedForExport, false); assert.equal(ack.files[0].stagingReset, true);
  assert.equal(ack.draftConsumed, undefined); assert.equal(f.revisions.length, 2);
  assert.deepEqual(f.revisions.map(revision => revision.translations), [['old'], ['ZIP translation']]);
  assertNoStatusFlags(saved);
});

test('shared staged deletion queues its captured revision and reset marker without consuming sparse carries', async () => {
  const f = deletionFixture({ collaboration: true }), room = f.kv.get('collaboration_v1').rooms[key];
  room.mode = 'sparse'; room.carries = { 'stat.txt': { filepath: 'stat.txt', translations: ['separate copy'] } };
  room.carryRevisions = { 'stat.txt': 4 };
  const saved = await commit(f, f.store.saveTranslationBatch(deletionBatch({ collaboration: { key, identity, origin: 'delete_staged',
    bases: { 'stat.txt': file() } } })));
  const committed = f.kv.get('collaboration_v1').rooms[key];
  assert.equal(saved.status, 'pending'); assert.equal(committed.outbox.length, 1);
  assert.equal(committed.outbox[0].resetStaging, true); assert.equal(committed.outbox[0].origin, 'delete_staged');
  assert.deepEqual(committed.outbox[0].files[0].base, file());
  assert.equal(committed.local['stat.txt'].trackedForExport, false); assert.equal(committed.local['stat.txt'].stagingReset, true);
  assert.deepEqual(committed.carries, room.carries); assert.deepEqual(committed.carryRevisions, room.carryRevisions);
  assert.equal(f.kv.get('workspace_poe1').staged.Thai['stat.txt'], undefined);
});

test('staged deletion restores blank and short source text with placeholders while preserving excess original entries', async () => {
  for (const original of [[], [''], ['ZIP translation', 'extra original entry']]) {
    const f = deletionFixture(); f.kv.get('source_poe1')[0].translations.Thai = original;
    const restored = original.length ? original : [''];
    const result = await commit(f, f.store.saveTranslationBatch(deletionBatch({
      files: [{ ...file(), translations: restored, trackedForExport: false, stagingReset: true }], revisions: [] })));
    assert.deepEqual(copy(result.files[0].translations), restored);
    assert.deepEqual(f.kv.get('workspace_poe1').descs[0].translations.Thai, restored);
    assert.equal(f.kv.get('workspace_poe1').staged.Thai['stat.txt'], undefined);
    assert.deepEqual(f.kv.get('source_poe1')[0].translations.Thai, original);
  }
});

test('changed or removed staged text rejects deletion transactionally and retains recovery data', async () => {
  for (const remove of [false, true]) {
    const f = deletionFixture();
    if (remove) delete f.kv.get('workspace_poe1').staged.Thai['stat.txt'];
    else f.kv.get('workspace_poe1').staged.Thai['stat.txt'].translations = ['newer save'];
    const before = copy(Object.fromEntries(f.kv));
    await assert.rejects(f.store.saveTranslationBatch(deletionBatch()), error => error.code === (remove ? 'DELETE_STAGED_NOT_FOUND' : 'DELETE_STAGED_BASE_CHANGED'));
    assert.deepEqual(Object.fromEntries(f.kv), before); assert.equal(f.revisions.length, 0);
  }
});

test('changed shared revision or an unresolved conflict rejects deletion without rewriting the outbox', async () => {
  for (const conflict of [false, true]) {
    const f = deletionFixture({ collaboration: true }), room = f.kv.get('collaboration_v1').rooms[key];
    if (conflict) room.conflicts.push({ filepath: 'stat.txt', id: 'conflict' });
    else room.local['stat.txt'].revision++;
    const before = copy(Object.fromEntries(f.kv));
    await assert.rejects(f.store.saveTranslationBatch(deletionBatch({ collaboration: { key, identity, origin: 'delete_staged',
      bases: { 'stat.txt': file() } } })), error => error.code === (conflict ? 'DELETE_STAGED_CONFLICT' : 'DELETE_STAGED_BASE_CHANGED'));
    assert.deepEqual(Object.fromEntries(f.kv), before); assert.equal(f.revisions.length, 0);
  }
});

test('deletion receipt replays once after uncertain completion and refuses reuse as an ordinary save', async () => {
  const f = deletionFixture({ collaboration: true });
  const request = deletionBatch({ collaboration: { key, identity, origin: 'delete_staged', bases: { 'stat.txt': file() } } });
  await commit(f, f.store.saveTranslationBatch(request));
  const duplicate = await commit(f, f.store.saveTranslationBatch(request));
  assert.equal(duplicate.duplicate, true); assert.equal(f.revisions.length, 2);
  assert.equal(f.kv.get('collaboration_v1').rooms[key].outbox.length, 1);
  await assert.rejects(f.store.saveTranslationBatch(batch({ jobId: 'delete-1' })), /identifier was reused/);
});

test('local deletion receipt replay preserves a newer stage written by another tab', async () => {
  const f = deletionFixture(), request = deletionBatch();
  await commit(f, f.store.saveTranslationBatch(request));
  const workspace = f.kv.get('workspace_poe1'), source = f.kv.get('source_poe1')[0];
  W.stageTranslation(workspace, { filepath: 'stat.txt', translations: ['newer tab save'] }, 'Thai', { source, sourceHash: 'source' });
  workspace.descs[0].translations.Thai = ['newer tab save'];
  const duplicate = await commit(f, f.store.saveTranslationBatch(request));
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.files[0].trackedForExport, true);
  assert.equal(duplicate.files[0].stagingReset, undefined);
  assert.deepEqual(copy(duplicate.files[0].translations), ['newer tab save']);
  assert.deepEqual(f.kv.get('workspace_poe1').staged.Thai['stat.txt'].translations, ['newer tab save']);
  assert.equal(f.revisions.length, 2); assert.equal(f.kv.get('translation_save_receipts_poe1').length, 1);
});

test('history failure rolls back a staged deletion, shared outbox and receipt together', async () => {
  const f = deletionFixture({ collaboration: true, failRevision: true }), before = copy(Object.fromEntries(f.kv));
  await assert.rejects(f.store.saveTranslationBatch(deletionBatch({ collaboration: { key, identity, origin: 'delete_staged',
    bases: { 'stat.txt': file() } } })), /Cannot store history/);
  assert.deepEqual(Object.fromEntries(f.kv), before); assert.equal(f.revisions.length, 0);
});

test('deletion refuses arbitrary replacement text, missing source and draft consumption', async () => {
  const f = deletionFixture();
  await assert.rejects(f.store.saveTranslationBatch(deletionBatch({ files: [{ ...file('arbitrary replacement'), trackedForExport: false, stagingReset: true }] })), /original ZIP/);
  await assert.rejects(f.store.saveTranslationBatch(deletionBatch({ draft: {} })), /Invalid staged translation deletion/);
  f.kv.delete('source_poe1');
  await assert.rejects(f.store.saveTranslationBatch(deletionBatch()), /original ZIP translation is unavailable/);
});

test('worker-compatible store commits a touched language and history only after transaction completion', async () => {
  const f = fixture({ worker: true });
  let settled = false; const saved = f.store.saveTranslationBatch(batch()).then(value => { settled = true; return value; });
  await queued(); assert.equal(settled, false); assert.equal(f.revisions.length, 0);
  assert.equal(f.kv.get('workspace_poe1').descs[0].translations.Thai[0], 'old');
  f.transactions[0].complete(); const ack = await saved;
  const workspace = f.kv.get('workspace_poe1');
  assert.equal(workspace.marker, true); assert.deepEqual(workspace.descs[0].translations.French, ['bonjour']);
  assert.deepEqual(workspace.descs[1].translations.Thai, ['untouched']); assert.deepEqual(workspace.descs[0].translations.Thai, ['new']);
  assert.equal(workspace.status['stat.txt'].lastExportedAt, 10); assert.equal(workspace.status['stat.txt'].lastEditedAt, 20);
  assert.deepEqual(workspace.dropped.Thai['other.txt'].snapshot.translations, ['untouched']);
  assertNoStatusFlags(workspace); assert.equal(f.revisions.length, 1);
  assert.equal(ack.status, 'local'); assert.equal(ack.workspace, undefined); assert.equal(ack.files.length, 1);
});

test('durable German and Thai staged translations and dropped copies retain independent state without stored status flags', async () => {
  const f = fixture({ worker: true });
  const initial = f.kv.get('workspace_poe1');
  const original = initial.descs[0];
  delete original.translations.French;
  original.hasChanges = true; original.isMissing = false;
  initial.status['stat.txt'] = { needsReview: true, lastEditedAt: 11 };
  const source = structuredClone(original);
  await commit(f, f.store.saveTranslationBatch(batch({ jobId: 'german-save', language: 'German',
    files: [{ ...file('eins'), trackedForExport: false, needsReview: false }],
    statuses: { 'stat.txt': { needsReview: false, lastEditedAt: 22 } },
    revisions: [{ filepath: 'stat.txt', lang: 'German', translations: ['eins'] }] })));
  let workspace = f.kv.get('workspace_poe1'), local = workspace.descs[0], status = workspace.status['stat.txt'];
  assert.deepEqual(local.translations.Thai, ['old']);
  assert.deepEqual(local.translations.German, ['eins']);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').hasChanges, false);
  assert.equal(W.workspaceFile(workspace, source, 'German').hasChanges, true, 'Saving creates staged data regardless of old wire flags.');
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isDropped, true);
  assert.equal(W.workspaceFile(workspace, source, 'German').isDropped, false);
  assertNoStatusFlags(workspace);
  assert.equal(W.fileStatus(status, 'Thai', local).lastEditedAt, 11);
  assert.equal(W.fileStatus(status, 'German', local).lastEditedAt, 22);
  const candidate = workspace.dropped.Thai['stat.txt'];
  await commit(f, f.store.saveTranslationBatch(batch({ jobId: 'thai-save',
    promoteDropped: { id: candidate.id, revision: candidate.revision, targetSourceHash: 'source' },
    statuses: { 'stat.txt': { needsReview: false, lastEditedAt: 33 } } })));
  workspace = f.kv.get('workspace_poe1'); local = workspace.descs[0]; status = workspace.status['stat.txt'];
  assert.equal(W.workspaceFile(workspace, source, 'Thai').hasChanges, true);
  assert.equal(W.workspaceFile(workspace, source, 'German').hasChanges, true);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isDropped, false);
  assert.equal(W.workspaceFile(workspace, source, 'German').isDropped, false);
  assertNoStatusFlags(workspace);
  assert.equal(W.fileStatus(status, 'Thai', local).lastEditedAt, 33);
  assert.equal(W.fileStatus(status, 'German', local).lastEditedAt, 22);
  assert.deepEqual(local.translations.German, ['eins']);
  assert.equal(f.revisions.length, 2);
});

test('modern save stages actual translations regardless of obsolete flags and leaves historical flags intact', async () => {
  const f = fixture({ worker: true, collaboration: true });
  const initial = f.kv.get('workspace_poe1');
  W.initializeWorkspace(initial, { source: initial.descs, sourceHash: 'source', game: 'poe1', language: 'Thai' });
  const oldDrop = structuredClone(initial.dropped.Thai['other.txt']);
  const ack = await commit(f, f.store.saveTranslationBatch(batch({
    files: [{ ...file('new'), needsReview: true, trackedForExport: false }],
    statuses: { 'stat.txt': { needsReview: true, trackedForExport: false, isMissing: true, lastEditedAt: 33 } },
    revisions: [{ filepath: 'stat.txt', lang: 'Thai', savedAt: 33, needsReview: true, translations: ['historical dropped copy'] }],
    collaboration: { key, identity, origin: 'save' },
  })));
  const workspace = f.kv.get('workspace_poe1');
  assert.deepEqual(workspace.staged.Thai['stat.txt'].translations, ['new']);
  assert.equal(workspace.dropped.Thai['stat.txt'], undefined);
  assert.deepEqual(workspace.dropped.Thai['other.txt'], oldDrop, 'An unrelated recoverable copy survives the save.');
  assert.equal(workspace.status['stat.txt'].lastEditedAt, 33); assertNoStatusFlags(workspace);
  assert.equal(ack.files[0].needsReview, false); assert.equal(ack.files[0].trackedForExport, true);
  assert.equal(f.kv.get('collaboration_v1').rooms[key].outbox[0].files[0].yours.needsReview, false);
  assert.equal(f.revisions[0].needsReview, true, 'Immutable history retains the meaning of old revisions.');
  assert.deepEqual(f.revisions[0].translations, ['historical dropped copy']);
});

test('outbox, touched files, history and receipt commit atomically with independent operation copies', async () => {
  const f = fixture({ collaboration: true });
  const ack = await commit(f, f.store.saveTranslationBatch(batch({ collaboration: { key, identity, origin: 'save' } })));
  const state = f.kv.get('collaboration_v1'); const room = state.rooms[key];
  assert.equal(ack.mutationId, 'save-1'); assert.equal(ack.pending, 1); assert.equal(ack.operation.id, 'save-1');
  assert.deepEqual(room.outbox[0].files[0].base.translations, ['old']);
  assert.deepEqual(room.local['stat.txt'].translations, ['new']);
  assert.notEqual(room.local['stat.txt'], room.outbox[0].files[0].yours);
  assert.deepEqual(state.rooms.unrelated, { local: { untouched: true } });
  assert.equal(f.revisions[0].collaborationAccountId, 'account');
  assert.equal(f.kv.get('translation_save_receipts_poe1').length, 1);
});

test('promotion stages reviewed text, resolves its candidate, and queues the guarded mutation in one durable commit', async () => {
  const W = require('../public/workspaceState.js'), f = fixture({ collaboration: true });
  const workspace = f.kv.get('workspace_poe1');
  W.initializeWorkspace(workspace, { source: workspace.descs, sourceHash: 'source', game: 'poe1', language: 'Thai' });
  W.dropTranslation(workspace, workspace.descs[0], 'Thai', { id: 'drop', game: 'poe1', originSourceHash: 'old-source', revision: 4 });
  const promoteDropped = { id: 'drop', revision: 4, targetSourceHash: 'source' };
  const saved = f.store.saveTranslationBatch(batch({ promoteDropped, collaboration: { key, identity, origin: 'save', promoteDropped } }));
  await queued(); assert.equal(f.kv.get('workspace_poe1').dropped.Thai['stat.txt'].id, 'drop');
  f.transactions.at(-1).complete(); await saved;
  const committed = f.kv.get('workspace_poe1');
  assert.deepEqual(copy(committed.staged.Thai['stat.txt'].translations), ['new']);
  assert.equal(committed.dropped.Thai['stat.txt'], undefined);
  assert.equal(committed.droppedArchive.drop.status, 'promoted');
  assert.deepEqual(copy(f.kv.get('collaboration_v1').rooms[key].outbox[0].promoteDropped), promoteDropped);
  assert.equal(f.revisions.length, 1);
});

test('stale promotion revision rolls back staged text, candidate archive, history, and shared outbox', async () => {
  const W = require('../public/workspaceState.js'), f = fixture({ collaboration: true });
  const workspace = f.kv.get('workspace_poe1');
  W.initializeWorkspace(workspace, { source: workspace.descs, sourceHash: 'source', game: 'poe1', language: 'Thai' });
  W.dropTranslation(workspace, workspace.descs[0], 'Thai', { id: 'drop', game: 'poe1', originSourceHash: 'old-source', revision: 4 });
  const before = copy(Object.fromEntries(f.kv));
  await assert.rejects(f.store.saveTranslationBatch(batch({ promoteDropped: { id: 'drop', revision: 3, targetSourceHash: 'source' },
    collaboration: { key, identity, origin: 'save' } })), /changed before/);
  assert.deepEqual(copy(Object.fromEntries(f.kv)), before); assert.equal(f.revisions.length, 0);
});

test('bulk promotion maps stage and resolve each candidate atomically with separate guarded outbox entries', async () => {
  const W = require('../public/workspaceState.js'), f = fixture({ collaboration: true });
  const workspace = f.kv.get('workspace_poe1'), room = f.kv.get('collaboration_v1').rooms[key];
  W.initializeWorkspace(workspace, { source: workspace.descs, sourceHash: 'source', game: 'poe1', language: 'Thai' });
  const promotions = {};
  for (const filepath of ['stat.txt', 'other.txt']) {
    const desc = workspace.descs.find(item => item.filepath === filepath);
    const candidate = W.dropTranslation(workspace, desc, 'Thai', { id: 'drop-' + filepath, game: 'poe1', originSourceHash: 'old', targetSourceHash: 'source' });
    promotions[filepath] = { id: candidate.id, revision: 0, targetSourceHash: 'source' };
    if (filepath !== 'stat.txt') { room.manifest.files.push({ filepath, english: ['other'] }); room.local[filepath] = { ...file('untouched'), filepath }; room.shared[filepath] = copy(room.local[filepath]); }
  }
  const command = batch({ files: ['stat.txt', 'other.txt'].map(filepath => ({ ...file('accepted ' + filepath), filepath })),
    descriptions: copy(workspace.descs), promoteDroppedByPath: promotions, collaboration: { key, identity } });
  const saved = f.store.saveTranslationBatch(command); await queued();
  assert.equal(W.droppedForFile(f.kv.get('workspace_poe1'), 'stat.txt', 'Thai').id, 'drop-stat.txt');
  f.transactions.at(-1).complete(); const ack = await saved;
  assert.equal(ack.operations.length, 2); assert.equal(ack.mutationIds.length, 2);
  assert.ok(ack.operations.every(op => op.files.length === 1 && op.promoteDropped));
  for (const filepath of ['stat.txt', 'other.txt']) {
    assert.equal(W.droppedForFile(f.kv.get('workspace_poe1'), filepath, 'Thai'), null);
    assert.deepEqual(f.kv.get('workspace_poe1').staged.Thai[filepath].translations, ['accepted ' + filepath]);
  }
  const replay = await commit(f, f.store.saveTranslationBatch(command));
  assert.equal(replay.duplicate, true); assert.equal(replay.operations.length, 2);
  assert.equal(f.kv.get('collaboration_v1').rooms[key].outbox.length, 2);
});

test('same-ID recovery acknowledges the durable receipt without duplicate revision or outbox', async () => {
  const f = fixture({ collaboration: true }); const request = batch({ collaboration: { key, identity, origin: 'save' } });
  await commit(f, f.store.saveTranslationBatch(request));
  const ack = await commit(f, f.store.saveTranslationBatch(request));
  assert.equal(ack.duplicate, true); assert.equal(f.revisions.length, 1);
  assert.equal(f.kv.get('collaboration_v1').rooms[key].outbox.length, 1);
});

test('same-ID recovery returns current touched files without resurrecting an already synced outbox operation', async () => {
  const f = fixture({ collaboration: true }); const request = batch({ collaboration: { key, identity, origin: 'save' } });
  await commit(f, f.store.saveTranslationBatch(request));
  const room = f.kv.get('collaboration_v1').rooms[key]; room.outbox = []; room.local['stat.txt'] = file('merged shared');
  const ack = await commit(f, f.store.saveTranslationBatch(request));
  assert.equal(ack.duplicate, true); assert.equal(ack.operation, null); assert.equal(ack.pending, 0); assert.equal(ack.status, 'synced');
  assert.deepEqual(copy(ack.files[0].translations), ['merged shared']); assert.equal(f.revisions.length, 1);
  assert.equal(room.outbox.length, 0);
});

test('same-ID recovery proves the old save without reattaching its operation after source changes', async () => {
  const f = fixture({ collaboration: true }); const request = batch({ collaboration: { key, identity, origin: 'save' } });
  await commit(f, f.store.saveTranslationBatch(request));
  f.kv.get('workspace_poe1').sourceHash = 'different source';
  const ack = await commit(f, f.store.saveTranslationBatch(request));
  assert.equal(ack.duplicate, true); assert.equal(ack.operation, null); assert.equal(ack.pending, 0);
  assert.deepEqual(copy(ack.files[0].translations), ['new']); assert.equal(f.revisions.length, 1);
});

test('a reused ID with changed translations rejects instead of falsely acknowledging the new content', async () => {
  const f = fixture(); await commit(f, f.store.saveTranslationBatch(batch()));
  await assert.rejects(f.store.saveTranslationBatch(batch({ files: [file('different')] })), /identifier was reused/);
  assert.deepEqual(f.kv.get('workspace_poe1').descs[0].translations.Thai, ['new']); assert.equal(f.revisions.length, 1);
});

test('a reused ID with a changed description template also rejects', async () => {
  const f = fixture(); await commit(f, f.store.saveTranslationBatch(batch()));
  await assert.rejects(f.store.saveTranslationBatch(batch({ descriptions: [{ filepath: 'stat.txt', name: 'changed source metadata' }] })), /identifier was reused/);
  assert.equal(f.revisions.length, 1);
});

test('quota abort leaves every durable record unchanged', async () => {
  const f = fixture({ collaboration: true }); const before = copy(Object.fromEntries(f.kv));
  const saved = f.store.saveTranslationBatch(batch({ collaboration: { key, identity } }));
  const rejection = assert.rejects(saved, /Quota exceeded/);
  await queued(); f.transactions[0].abort(new Error('Quota exceeded')); await rejection;
  assert.deepEqual(Object.fromEntries(f.kv), before); assert.equal(f.revisions.length, 0);
});

test('history failure rolls back already queued workspace and outbox writes', async () => {
  const f = fixture({ collaboration: true, failRevision: true }); const before = copy(Object.fromEntries(f.kv));
  await assert.rejects(f.store.saveTranslationBatch(batch({ collaboration: { key, identity } })), /Cannot store history/);
  assert.deepEqual(Object.fromEntries(f.kv), before); assert.equal(f.revisions.length, 0);
});

test('source and account mismatches reject with a stale scope error', async () => {
  for (const options of [{ sourceHash: 'new source' }, { accountId: 'new account' }]) {
    const f = fixture(); const before = copy(Object.fromEntries(f.kv));
    await assert.rejects(f.store.saveTranslationBatch(batch(options)), error => error.stale && error.code === 'SAVE_SCOPE_CHANGED');
    assert.deepEqual(Object.fromEntries(f.kv), before);
  }
});

test('a missing room and wrong room identity never claim a successful local save', async () => {
  for (const roomKey of ['missing', key]) {
    const f = fixture({ collaboration: true });
    if (roomKey === key) f.kv.get('collaboration_v1').rooms[key].identity = { ...identity, language: 'French' };
    await assert.rejects(f.store.saveTranslationBatch(batch({ collaboration: { key: roomKey, identity } })), error => error.stale);
    assert.deepEqual(f.kv.get('workspace_poe1').descs[0].translations.Thai, ['old']);
  }
});

test('consecutive saves capture the latest stored base while explicit draft bases are preserved', async () => {
  const f = fixture({ collaboration: true });
  await commit(f, f.store.saveTranslationBatch(batch({ collaboration: { key, identity } })));
  await commit(f, f.store.saveTranslationBatch(batch({ jobId: 'save-2', files: [file('next')], collaboration: { key, identity } })));
  await commit(f, f.store.saveTranslationBatch(batch({ jobId: 'save-3', files: [file('third')],
    collaboration: { key, identity, bases: { 'stat.txt': file('captured') } } })));
  const operations = f.kv.get('collaboration_v1').rooms[key].outbox;
  assert.deepEqual(operations[1].files[0].base.translations, ['new']);
  assert.deepEqual(operations[2].files[0].base.translations, ['captured']);
});

test('adding a previously untranslated description keeps existing files and limits the template to source language', async () => {
  const f = fixture();
  await commit(f, f.store.saveTranslationBatch(batch({ files: [{ ...file('added'), filepath: 'added.txt' }],
    descriptions: [{ filepath: 'added.txt', translations: { English: ['source'], French: ['unsubmitted'] } }] })));
  const workspace = f.kv.get('workspace_poe1'); assert.equal(workspace.descs.length, 3);
  assert.deepEqual(workspace.descs[2].translations, { English: ['source'], Thai: ['added'] });
});

test('missing workspace and malformed input produce actionable failures', async () => {
  const f = fixture(); f.kv.delete('workspace_poe1');
  await assert.rejects(f.store.saveTranslationBatch(batch()), /Keep this tab open/);
  await assert.rejects(f.store.saveTranslationBatch(batch({ files: [file(), file()] })), /duplicate/);
  await assert.rejects(f.store.saveTranslationBatch(batch({ game: 'unknown' })), /Invalid local/);
});

function workerHarness({ postFailure } = {}) {
  const workers = [];
  class Worker {
    constructor(url) { this.url = url; this.messages = []; workers.push(this); }
    postMessage(message) { if (postFailure) throw postFailure; this.messages.push(structuredClone(message)); }
    emit(message) { this.onmessage({ data: message }); }
    terminate() { this.terminated = true; }
  }
  return { Worker, workers };
}

test('no Worker support and blocked construction use the same structured storage command', async () => {
  for (const Worker of [null, class { constructor() { throw new Error('CSP'); } }]) {
    const seen = [];
    const client = create({ Worker, store: { saveTranslationBatch: async value => { seen.push(value.jobId); return { status: 'local' }; } } });
    const ack = await client.save(batch()); assert.equal(ack.status, 'local'); assert.deepEqual(seen, ['save-1']); client.dispose();
  }
});

test('worker handshake and durable acknowledgment control promise completion', async () => {
  const h = workerHarness(); const client = create({ Worker: h.Worker, store: {} }); const worker = h.workers[0];
  let settled = false; const saving = client.save(batch()).then(result => { settled = true; return result; });
  await queued(); assert.equal(worker.messages.length, 0); assert.equal(settled, false);
  worker.emit({ type: 'ready', version: 1 }); await queued(); assert.equal(worker.messages.length, 1); assert.equal(settled, false);
  assert.equal(worker.messages[0].batch.workspace, undefined); assert.equal(worker.messages[0].batch.files.length, 1);
  worker.emit({ type: 'saved', id: 'other-job', result: {} }); assert.equal(settled, false);
  worker.emit({ type: 'saved', id: 'save-1', result: { status: 'local', jobId: 'save-1' } });
  assert.equal((await saving).jobId, 'save-1'); client.dispose();
});

test('worker startup import failure safely falls back before dispatch', async () => {
  const h = workerHarness(); let calls = 0;
  const client = create({ Worker: h.Worker, store: { saveTranslationBatch: async () => { calls++; return { status: 'local' }; } } });
  const saving = client.save(batch()); h.workers[0].onerror();
  assert.equal((await saving).status, 'local'); assert.equal(calls, 1); assert.equal(h.workers[0].messages.length, 0); client.dispose();
});

test('worker crash after dispatch rejects as unknown durability without an automatic duplicate write', async () => {
  const h = workerHarness(); let calls = 0;
  const client = create({ Worker: h.Worker, store: { saveTranslationBatch: async () => { calls++; return { duplicate: true }; } } });
  h.workers[0].emit({ type: 'ready', version: 1 });
  const saving = client.save(batch()); const rejection = assert.rejects(saving, error => error.durableUnknown && error.jobId === 'save-1');
  await queued(); h.workers[0].onerror(); await rejection; assert.equal(calls, 0);
  // A user-triggered same-ID retry uses the durable receipt on the fallback store.
  assert.equal((await client.save(batch())).duplicate, true); assert.equal(calls, 1); client.dispose();
});

test('serial worker messages preserve save order and continue after an acknowledged storage failure', async () => {
  const h = workerHarness(); const client = create({ Worker: h.Worker, store: {} }); const worker = h.workers[0];
  worker.emit({ type: 'ready', version: 1 });
  const first = client.save(batch()); const rejection = assert.rejects(first, /Quota/);
  const second = client.save(batch({ jobId: 'save-2' }));
  await queued(); assert.equal(worker.messages.length, 1);
  worker.emit({ type: 'error', id: 'save-1', error: { name: 'QuotaExceededError', message: 'Quota exceeded' } }); await rejection;
  await queued(); assert.equal(worker.messages.length, 2); assert.equal(worker.messages[1].id, 'save-2');
  worker.emit({ type: 'saved', id: 'save-2', result: { status: 'local' } }); await second; client.dispose();
});

test('non-plain worker payload errors are surfaced without falling back or acknowledging success', async () => {
  const h = workerHarness({ postFailure: Object.assign(new Error('not plain'), { name: 'DataCloneError' }) }); let calls = 0;
  const client = create({ Worker: h.Worker, store: { saveTranslationBatch: async () => { calls++; } } });
  h.workers[0].emit({ type: 'ready', version: 1 });
  await assert.rejects(client.save(batch()), error => error.name === 'DataCloneError'); assert.equal(calls, 0); client.dispose();
});

test('dispose rejects current requests and queued saves rather than leaving promises unresolved', async () => {
  const h = workerHarness(); const client = create({ Worker: h.Worker, store: {} }); h.workers[0].emit({ type: 'ready', version: 1 });
  const first = client.save(batch()); const second = client.save(batch({ jobId: 'save-2' }));
  const rejected = [assert.rejects(first, /closed/), assert.rejects(second, /closed/)];
  await queued(); client.dispose(); await Promise.all(rejected);
});

test('worker entrypoint queues actual save commands and sends ACK only after storage resolves', async () => {
  const messages = [], writes = []; let resolveFirst;
  const root = { postMessage: message => messages.push(message), OfflineStore: { saveTranslationBatch(value) {
    writes.push(value.jobId);
    return value.jobId === 'save-1' ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve({ jobId: value.jobId });
  } } };
  const context = vm.createContext({ self: root, importScripts: (...files) => assert.deepEqual(files,
    ['workspaceState.js', 'collaborationProtocol.js', 'regexEngine.js', 'translationDiagnostics.js', 'translationMemory.js', 'normalizedStore.js', 'normalizedRooms.js', 'offlineStore.js']) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'saveWorker.js'), 'utf8'), context);
  assert.equal(messages[0].type, 'ready');
  root.onmessage({ data: { type: 'saveTranslations', id: 'save-1', batch: batch() } });
  root.onmessage({ data: { type: 'saveTranslations', id: 'save-2', batch: batch({ jobId: 'save-2' }) } });
  await queued(); assert.deepEqual(writes, ['save-1']); assert.equal(messages.length, 1);
  resolveFirst({ jobId: 'save-1' }); await queued(); assert.deepEqual(writes, ['save-1', 'save-2']);
  assert.equal(messages[1].id, 'save-1'); assert.equal(messages[2].id, 'save-2');
});
