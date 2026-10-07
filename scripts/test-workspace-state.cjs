const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../public/workspaceState.js');
const P = require('../public/collaborationProtocol.js');

test('source metadata survives language status projections', () => {
  const local = { translations: { English: ['One'], Thai: ['one'] } };
  const status = { needsReview: true, deleted: false, deletedAt: 0, lastSourceAt: 42 };
  W.fileStatus(status, 'Thai', local);
  W.setFileStatus(status, 'German', { needsReview: false }, local);
  assert.equal(status.lastSourceAt, 42);
  assert.equal(status.deleted, false);
  assert.equal(status.deletedAt, 0);
  assert.equal(W.fileStatus(status, 'Thai', local).needsReview, true);
  W.setFileStatus(status, 'Thai', { needsReview: false });
  assert.equal(status.lastSourceAt, 42);
});

test('a migrated workspace does not rescan the archive on each language switch or save', () => {
  const workspace = { descs: [{ filepath: 'a.txt', translations: { English: ['One'], Thai: ['one'] }, hasChanges: true }], status: {} };
  W.scopeWorkspace(workspace, 'Thai');
  Object.defineProperty(workspace, 'descs', { get() { assert.fail('The migrated archive should not be traversed again.'); } });
  W.scopeWorkspace(workspace, 'German');
  assert.equal(workspace.languageStatusVersion, 1);
});

test('legacy Thai metadata belongs to Thai when German is selected first', () => {
  const local = { filepath: 'a.txt', translations: { English: ['One'], Thai: ['one'] }, hasChanges: true, isMissing: false };
  const status = { needsReview: true, lastEditedAt: 5, reviewCandidates: { Thai: { translations: ['one'] } } };
  W.scopeWorkspace({ descs: [local], status: { 'a.txt': status } }, 'German');
  assert.deepEqual(W.descriptionStatus(local, 'German'), { hasChanges: false, isMissing: false });
  assert.deepEqual(W.fileStatus(status, 'German', local), { needsReview: false });
  assert.equal(W.descriptionStatus(local, 'Thai').hasChanges, true);
  assert.deepEqual(W.fileStatus(status, 'Thai', local), { needsReview: true, lastEditedAt: 5 });
});

test('explicit metadata owner wins over translation keys and fallback', () => {
  const local = { statusLanguage: 'Thai', hasChanges: true, isMissing: true,
    translations: { English: ['One'], Thai: [''], German: ['eins'] } };
  const status = { statusLanguage: 'German', needsReview: true, lastExportedAt: 8 };
  assert.equal(W.descriptionStatus(local, 'German', 'French').hasChanges, false);
  assert.equal(W.descriptionStatus(local, 'Thai').isMissing, true);
  assert.equal(W.fileStatus(status, 'Thai', local, 'French').needsReview, false);
  assert.equal(W.fileStatus(status, 'German', local).lastExportedAt, 8);
});

test('setting German flags and timestamps preserves independent Thai metadata', () => {
  const local = { translations: { English: ['One'], Thai: ['one'] }, hasChanges: true };
  const status = { needsReview: true, lastEditedAt: 5, reviewCandidates: { Thai: { translations: ['old Thai'] } } };
  W.scopeWorkspace({ descs: [local], status: { 'a.txt': status } }, 'Thai');
  local.translations.German = ['eins'];
  W.setDescriptionStatus(local, 'German', { hasChanges: false, isMissing: true });
  W.setFileStatus(status, 'German', { needsReview: false, lastTranslatedAt: 9,
    reviewCandidates: { Thai: { translations: ['must not overwrite'] }, German: { translations: ['old German'] } } }, local);
  assert.deepEqual(W.descriptionStatus(local, 'Thai'), { hasChanges: true, isMissing: false });
  assert.deepEqual(W.descriptionStatus(local, 'German'), { hasChanges: false, isMissing: true });
  assert.deepEqual(W.fileStatus(status, 'Thai', local), { needsReview: true, lastEditedAt: 5 });
  assert.deepEqual(W.fileStatus(status, 'German', local), { needsReview: false, lastTranslatedAt: 9 });
  assert.equal(status.lastEditedAt, undefined, 'Thai timestamps are not projected into German.');
  assert.equal(status.statusLanguage, 'German');
  assert.deepEqual(status.reviewCandidates.Thai.translations, ['old Thai']);
  assert.deepEqual(status.reviewCandidates.German.translations, ['old German']);
});

test('a captured status patch applies only the selected language entry', () => {
  const local = { translations: { English: ['One'], Thai: ['one'] } };
  const status = {};
  W.setFileStatus(status, 'Thai', { needsReview: true, lastEditedAt: 5 }, local);
  W.setFileStatus(status, 'German', { needsReview: true, lastEditedAt: 99,
    languageStatus: { Thai: { needsReview: true, lastEditedAt: 99 }, German: { needsReview: false, lastEditedAt: 7 } } }, local);
  assert.equal(W.fileStatus(status, 'Thai', local).lastEditedAt, 5);
  assert.deepEqual(W.fileStatus(status, 'German', local), { needsReview: false, lastEditedAt: 7 });
});

test('explicit status writes retain bare legacy metadata while identifiable Thai status stays scoped', () => {
  const bare = { marker: 'kept', lastExportedAt: 3 };
  W.setFileStatus(bare, 'Thai', { lastEditedAt: 7, needsReview: false });
  assert.deepEqual(W.fileStatus(bare, 'Thai'), { marker: 'kept', lastExportedAt: 3, lastEditedAt: 7, needsReview: false });
  const thai = { marker: 'Thai only', needsReview: true };
  const local = { translations: { English: ['One'], Thai: ['one'] } };
  W.setFileStatus(thai, 'German', { needsReview: false }, local);
  assert.deepEqual(W.fileStatus(thai, 'Thai', local), { marker: 'Thai only', needsReview: true });
  assert.deepEqual(W.fileStatus(thai, 'German', local), { needsReview: false });
});

test('protocol projection migrates Thai review text while German shared files change', () => {
  const workspace = { descs: [{ filepath: 'a.txt', translations: { English: ['One'], Thai: ['one'] }, hasChanges: true }],
    status: { 'a.txt': { needsReview: true, lastEditedAt: 5 } } };
  const before = structuredClone(workspace);
  const projected = P.projectWorkspace(workspace, [{ filepath: 'a.txt', translations: ['eins'], trackedForExport: false, needsReview: false }], 'German');
  const local = projected.descs[0], status = projected.status['a.txt'];
  assert.deepEqual(workspace, before, 'Public projection leaves caller-owned state unchanged.');
  assert.deepEqual(local.translations.Thai, ['one']);
  assert.deepEqual(local.translations.German, ['eins']);
  assert.equal(W.descriptionStatus(local, 'Thai').hasChanges, false);
  assert.equal(W.descriptionStatus(local, 'German').hasChanges, false);
  assert.deepEqual(W.droppedForFile(projected, 'a.txt', 'Thai').snapshot.translations, ['one']);
  assert.equal(W.fileStatus(status, 'Thai', local).needsReview, false);
  assert.equal(W.fileStatus(status, 'German', local).needsReview, false);
  assert.equal(W.fileStatus(status, 'Thai', local).lastEditedAt, 5);
});

const sourceDesc = (english = 'One', translations = { Thai: ['one'], German: ['eins'] }) => ({ filepath: 'a.txt', name: 'stat',
  stats: ['stat'], variables: ['#'], remarks: ['remark'], translations: { English: [english], ...translations } });
const modern = (source = sourceDesc(), hash = 'old') => W.initializeWorkspace({ sourceHash: hash, descs: [], status: {} },
  { source: [source], sourceHash: hash, game: 'poe1', language: 'Thai' });

test('legacy migration captures staged and dropped text before pruning every modern boolean flag', () => {
  const source = sourceDesc('One', { Thai: ['one'], German: [''] });
  const local = sourceDesc('One', { Thai: ['one'] });
  Object.assign(local, { hasChanges: true, isMissing: false, isEdited: true, isRevised: true, isDropped: false, statusLanguage: 'Thai',
    languageStatus: { Thai: { hasChanges: true, isMissing: false } } });
  const workspace = { sourceHash: 'current', descs: [local], status: { 'a.txt': { statusLanguage: 'German', needsReview: true,
    deleted: false, deletedAt: 0, lastSourceAt: 42,
    languageStatus: { Thai: { needsReview: false, lastEditedAt: 11 }, German: { needsReview: true, lastTranslatedAt: 22 } },
    reviewCandidates: { German: { sourceHash: 'old', translations: ['old German'] } } } },
    history: [{ hasChanges: true, isMissing: false, needsReview: true, translations: ['historic'] }] };
  W.initializeWorkspace(workspace, { source: [source], sourceHash: 'current', game: 'poe1', language: 'German' });
  assert.deepEqual(workspace.staged.Thai['a.txt'].translations, ['one']);
  assert.deepEqual(W.droppedForFile(workspace, 'a.txt', 'German').snapshot.translations, ['old German']);
  assert.equal(workspace.statusMetadataVersion, 1);
  for (const value of [local, workspace.status['a.txt'], ...Object.values(workspace.status['a.txt'].languageStatus)]) {
    for (const field of ['hasChanges', 'isMissing', 'isEdited', 'isRevised', 'isDropped', 'needsReview', 'trackedForExport']) assert.equal(Object.hasOwn(value, field), false, field);
  }
  assert.equal(local.languageStatus, undefined);
  assert.equal(workspace.status['a.txt'].languageStatus.Thai.lastEditedAt, 11);
  assert.equal(workspace.status['a.txt'].languageStatus.German.lastTranslatedAt, 22);
  assert.equal(workspace.status['a.txt'].lastSourceAt, 42); assert.equal(workspace.status['a.txt'].deleted, false);
  assert.equal(workspace.history[0].needsReview, true, 'History retains the meaning of its old snapshot.');
});

test('legacy migration does not stage absent ZIP translations padded for ordinary or DNT editor rows', () => {
  for (const english of ['One', '[DNT] One']) for (const baseline of [{}, { Thai: [] }, { Thai: [''] }]) {
    const source = sourceDesc(english, baseline);
    const local = sourceDesc(english, { Thai: [''] });
    local.hasChanges = false;
    const workspace = { descs: [local], status: {} };
    W.initializeWorkspace(workspace, { source: [source], sourceHash: 'current', game: 'poe1', language: 'Thai' });
    assert.equal(workspace.staged.Thai?.['a.txt'], undefined, JSON.stringify([english, baseline]));
    const state = W.workspaceFile(workspace, source, 'Thai');
    assert.equal(state.hasChanges, false);
    assert.equal(state.isMissing, true);
    assert.deepEqual(state.translations, ['']);
    assert.deepEqual(source.translations, { English: [english], ...baseline }, 'Migration leaves the immutable ZIP intact.');
  }
});

test('legacy migration ignores display padding after a partial ZIP translation without truncating extra entries', () => {
  const source = sourceDesc('One', { Thai: ['one'] });
  source.translations.English.push('Two');
  const local = structuredClone(source);
  local.translations.Thai = ['one', ''];
  local.hasChanges = false;
  const workspace = { descs: [local], status: {} };
  W.initializeWorkspace(workspace, { source: [source], sourceHash: 'current', language: 'Thai' });
  assert.equal(workspace.staged.Thai?.['a.txt'], undefined);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isMissing, true);

  const extra = structuredClone(local);
  extra.translations.Thai = ['one', '', ''];
  const mismatched = { descs: [extra], status: {} };
  W.initializeWorkspace(mismatched, { source: [source], sourceHash: 'current', language: 'Thai' });
  assert.deepEqual(mismatched.staged.Thai['a.txt'].translations, ['one', '', '']);
  assert.equal(W.workspaceFile(mismatched, source, 'Thai').isMissing, true);
});

test('legacy migration preserves real translation differences and explicit blank or unchanged saves', () => {
  for (const [baseline, saved, hasChanges] of [
    [{}, ['authored'], false],
    [{ Thai: ['one'] }, ['changed'], false],
    [{ Thai: ['one'] }, [''], false],
    [{}, [''], true],
    [{ Thai: ['one'] }, ['one'], true],
  ]) {
    const source = sourceDesc('One', baseline);
    const local = sourceDesc('One', { Thai: saved });
    local.hasChanges = hasChanges;
    const workspace = { descs: [local], status: {} };
    W.initializeWorkspace(workspace, { source: [source], sourceHash: 'current', language: 'Thai' });
    assert.deepEqual(workspace.staged.Thai['a.txt'].translations, saved);
    assert.equal(W.workspaceFile(workspace, source, 'Thai').hasChanges, true);
  }
});

test('legacy padded translation comparison stays scoped to each language', () => {
  const source = sourceDesc('One', { Thai: ['one'] });
  const local = sourceDesc('One', { Thai: ['correction'], German: [''] });
  local.statusLanguage = 'German'; local.hasChanges = false;
  const workspace = { descs: [local], status: {} };
  W.initializeWorkspace(workspace, { source: [source], sourceHash: 'current', language: 'German' });
  assert.deepEqual(workspace.staged.Thai['a.txt'].translations, ['correction']);
  assert.equal(workspace.staged.German?.['a.txt'], undefined);
});

function placeholderRepairFixture({ shared = false, account = true, pending = false } = {}) {
  const source = sourceDesc('One', {}), workspace = modern(source, 'current');
  workspace.descs = [sourceDesc('One', { Thai: [''] })];
  workspace.staged.Thai = { 'a.txt': { sourceHash: 'current', translations: [''], before: [], savedAt: 7 } };
  const identity = { accountId: 'account', game: 'poe1', sourceHash: 'current', language: 'Thai' };
  const room = { mode: 'sparse', identity, local: {}, shared: {}, outbox: [], conflicts: [],
    recovery: [{ id: 'join-recovery', at: 7, reason: 'Local edited translation before joining',
      files: [{ filepath: 'a.txt', translations: [''], trackedForExport: true, needsReview: false }] }] };
  room.local['a.txt'] = { filepath: 'a.txt', translations: [''], trackedForExport: true, needsReview: false, revision: shared ? 1 : 0 };
  if (shared) room.shared['a.txt'] = structuredClone(room.local['a.txt']);
  if (pending) {
    room.outbox.push({ id: 'join-pending', origin: 'merge', kind: 'join', status: 'pending', files: [{
      base: { filepath: 'a.txt', translations: [''], trackedForExport: false, needsReview: false, revision: 0 },
      yours: structuredClone(room.local['a.txt']),
    }] });
    room.conflicts.push({ id: 'join-conflict', mutationId: 'join-pending', filepath: 'a.txt' });
  }
  if (account) workspace.collaborationAccountId = identity.accountId;
  const collaboration = { rooms: account ? { [P.scopeKey(identity)]: room } : {} };
  const options = { source: [source], collaboration, receipts: [], revisions: [], game: 'poe1', evidenceComplete: true };
  return { source, workspace, room, options };
}

test('local migration placeholder repair preserves a recovery snapshot and is idempotent', () => {
  const { source, workspace, options } = placeholderRepairFixture({ account: false });
  const before = structuredClone(workspace.staged.Thai['a.txt']);
  assert.equal(W.repairLegacyPlaceholders(workspace, options), true);
  assert.equal(workspace.staged.Thai['a.txt'], undefined);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').hasChanges, false);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isMissing, true);
  const archive = Object.values(workspace.placeholderRepairArchive);
  assert.equal(archive.length, 1); assert.deepEqual(archive[0].staged, before);
  assert.equal(archive[0].sourceHash, 'current'); assert.equal(archive[0].language, 'Thai');
  assert.equal(archive[0].status, 'local');
  const repaired = structuredClone(workspace);
  assert.equal(W.repairLegacyPlaceholders(workspace, options), false);
  assert.deepEqual(workspace, repaired);
  assert.deepEqual(source.translations, { English: ['One'] });
});

test('own pending placeholder joins are canceled without removing unrelated queued work or recovery', () => {
  const { workspace, room, options } = placeholderRepairFixture({ pending: true });
  const unrelated = { id: 'actual-save', origin: 'save', files: [{ yours: { filepath: 'b.txt', translations: ['authored'] } }] };
  room.outbox.push(unrelated);
  const recovery = structuredClone(room.recovery), stage = structuredClone(workspace.staged.Thai['a.txt']);
  assert.equal(W.repairLegacyPlaceholders(workspace, options), true);
  assert.deepEqual(room.outbox, [unrelated]); assert.deepEqual(room.conflicts, []);
  assert.deepEqual(room.recovery, recovery);
  assert.equal(workspace.staged.Thai['a.txt'], undefined); assert.equal(room.local['a.txt'], undefined);
  assert.deepEqual(Object.values(workspace.placeholderRepairArchive)[0].staged, stage);
  assert.equal(room.placeholderRepairs.length, 1);
  assert.equal(room.placeholderRepairs[0].filepath, 'a.txt');
  const queued = structuredClone(room.placeholderRepairs);
  assert.equal(W.repairLegacyPlaceholders(workspace, options), false);
  assert.deepEqual(room.placeholderRepairs, queued);
});

test('already shared placeholder remains Saved until the server validates its queued repair', () => {
  const { workspace, source, room, options } = placeholderRepairFixture({ shared: true });
  const shared = structuredClone(room.shared['a.txt']), stage = structuredClone(workspace.staged.Thai['a.txt']);
  assert.equal(W.repairLegacyPlaceholders(workspace, options), true);
  assert.deepEqual(workspace.staged.Thai['a.txt'], stage);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').hasChanges, true);
  assert.deepEqual(room.shared['a.txt'], shared);
  assert.equal(room.placeholderRepairs.length, 1); assert.equal(room.placeholderRepairs[0].baseRevision, 1);
  assert.equal(Object.values(workspace.placeholderRepairArchive)[0].status, 'pending');
});

test('placeholder repair protects authored work, dropped provenance and incompatible shared scopes', () => {
  const protectors = [
    ['explicit save', f => { f.workspace.staged.Thai['a.txt'].saveOrigin = 'save'; }],
    ['explicit legacy save', f => { f.workspace.staged.Thai['a.txt'].saveOrigin = 'legacy_save'; }],
    ['previous translation', f => { f.workspace.staged.Thai['a.txt'].before = ['old text']; }],
    ['nonempty text', f => { f.workspace.staged.Thai['a.txt'].translations = ['authored']; }],
    ['extra blank entry', f => { f.workspace.staged.Thai['a.txt'].translations = ['', '']; }],
    ['different stage source', f => { f.workspace.staged.Thai['a.txt'].sourceHash = 'old'; }],
    ['ZIP already has a blank translation', f => { f.source.translations.Thai = ['']; }],
    ['authored timestamp', f => { f.workspace.status['a.txt'] = { statusLanguage: 'Thai', lastEditedAt: 9 }; }],
    ['authored language timestamp', f => { f.workspace.status['a.txt'] = { languageStatus: { Thai: { lastTranslatedAt: 9 } } }; }],
    ['translation history', f => { f.options.revisions.push({ filepath: 'a.txt', lang: 'Thai', translations: [''], savedAt: 9 }); }],
    ['save receipt', f => { f.options.receipts.push({ signature: JSON.stringify({ scope: ['poe1', 'Thai', 'current', 'account'],
      files: [{ filepath: 'a.txt', translations: [''] }] }) }); }],
    ['active Dropped', f => { W.dropTranslation(f.workspace, f.source, 'Thai', { id: 'dropped', translations: ['old'] }); }],
    ['resolved Dropped assignment', f => {
      const candidate = W.dropTranslation(f.workspace, f.source, 'Thai', { id: 'dropped', translations: ['old'] });
      W.discardDropped(f.workspace, 'a.txt', 'Thai', { id: candidate.id, revision: candidate.revision });
    }],
    ['explicit pending save', f => { f.room.outbox.push({ id: 'blank-save', origin: 'save', files: [{ yours: f.room.local['a.txt'] }] }); }],
    ['unknown join provenance', f => { f.room.recovery = []; }],
    ['another account room', f => { f.room.identity.accountId = 'other'; }],
    ['another language room', f => { f.room.identity.language = 'German'; }],
    ['another game room', f => { f.room.identity.game = 'poe2'; }],
    ['another source room', f => { f.room.identity.sourceHash = 'future'; }],
    ['later shared revision', f => { f.room.shared['a.txt'].revision = 2; }],
    ['shared nonblank text', f => { f.room.shared['a.txt'].translations = ['authored']; }],
    ['shared review text', f => { f.room.shared['a.txt'].needsReview = true; }],
    ['shared untracked text', f => { f.room.shared['a.txt'].trackedForExport = false; }],
  ];
  for (const [name, protect] of protectors) {
    const fixture = placeholderRepairFixture({ shared: true });
    protect(fixture);
    const before = structuredClone(fixture.workspace.staged), outbox = structuredClone(fixture.room.outbox);
    assert.equal(W.repairLegacyPlaceholders(fixture.workspace, fixture.options), false, name);
    assert.deepEqual(fixture.workspace.staged, before, name);
    assert.deepEqual(fixture.room.outbox, outbox, name);
    assert.equal(fixture.room.placeholderRepairs, undefined, name);
    assert.equal(fixture.workspace.placeholderRepairArchive, undefined, name);
  }
});

test('placeholder repair waits for complete evidence and preserves unrelated language text', () => {
  const fixture = placeholderRepairFixture({ shared: true });
  const stage = structuredClone(fixture.workspace.staged);
  assert.equal(W.repairLegacyPlaceholders(fixture.workspace, { ...fixture.options, evidenceComplete: false }), false);
  assert.deepEqual(fixture.workspace.staged, stage); assert.equal(fixture.workspace.placeholderRepairVersion, undefined);
  assert.equal(W.repairLegacyPlaceholders(fixture.workspace, { ...fixture.options, source: [] }), false);
  assert.equal(fixture.workspace.placeholderRepairVersion, undefined);
  fixture.workspace.staged.German = { 'a.txt': { sourceHash: 'current', translations: [''], before: [], savedAt: 8 } };
  const german = structuredClone(fixture.workspace.staged.German);
  assert.equal(W.repairLegacyPlaceholders(fixture.workspace, fixture.options), true);
  assert.deepEqual(fixture.workspace.staged.German, german, 'No German room evidence means no German repair.');
  assert.equal(Object.values(fixture.workspace.placeholderRepairArchive).length, 1);
});

test('authored staged provenance survives unchanged server acknowledgments', () => {
  const source = sourceDesc('One', {}), workspace = modern(source, 'current');
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: [''] }, 'Thai', { source, saveOrigin: 'legacy_save' });
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: [''], beforeTranslations: [] }, 'Thai', { source });
  assert.equal(workspace.staged.Thai['a.txt'].saveOrigin, 'legacy_save');
});

test('clean metadata readers and writes cannot regenerate persisted false status flags', () => {
  const local = sourceDesc(), status = { statusLanguage: 'Thai', lastEditedAt: 5, languageStatus: { Thai: { lastEditedAt: 5 } } };
  const before = structuredClone(local);
  assert.equal(W.descriptionStatus(local, 'Thai').hasChanges, false); assert.deepEqual(local, before);
  assert.equal(W.fileStatus(status, 'German', local).needsReview, false); assert.equal(status.languageStatus.German, undefined);
  W.setFileMetadata(status, 'German', { lastTranslatedAt: 8, needsReview: true, hasChanges: true, isMissing: true, deleted: true, deletedAt: 9 }, local);
  assert.deepEqual(status.languageStatus.Thai, { lastEditedAt: 5 });
  assert.deepEqual(status.languageStatus.German, { lastTranslatedAt: 8 });
  assert.equal(status.needsReview, undefined); assert.equal(status.lastEditedAt, undefined); assert.equal(status.deleted, true); assert.equal(status.deletedAt, 9);
});

test('modern flag pruning is one-time on load and works for future workspace versions', () => {
  const workspace = { stagedVersion: 2, sourceHash: 'current', sourceBaseline: { sourceHash: 'current' },
    descs: [{ filepath: 'a.txt', hasChanges: true, translations: { Thai: ['one'] } }], status: {} };
  W.initializeWorkspace(workspace, { language: 'Thai' }); assert.equal(workspace.descs[0].hasChanges, undefined);
  Object.defineProperty(workspace, 'descs', { get() { assert.fail('A clean modern workspace must not rescan descriptions on load.'); } });
  W.initializeWorkspace(workspace, { language: 'German' }); assert.equal(workspace.statusMetadataVersion, 1);
});

test('Saved and Revised derive independently from selected-language staged text and its complete ZIP baseline', () => {
  const source = sourceDesc(), workspace = modern(source);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['edited Thai'] }, 'Thai', { source });
  assert.equal(W.workspaceFile(workspace, source, 'Thai').hasChanges, true);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, true);
  assert.equal(Object.hasOwn(W.workspaceFile(workspace, source, 'Thai'), 'isEdited'), false);
  assert.equal(W.workspaceFile(workspace, source, 'German').hasChanges, false);
  assert.equal(W.workspaceFile(workspace, source, 'German').isRevised, false);
  assert.deepEqual(W.workspaceFile(workspace, source, 'German').translations, ['eins']);
});

test('Dropped derives from an unresolved candidate even when current committed translation is complete', () => {
  const source = sourceDesc('Current English'), workspace = modern(source, 'current');
  const candidate = W.dropTranslation(workspace, sourceDesc('Old English'), 'Thai',
    { id: 'candidate', game: 'poe1', originSourceHash: 'old', targetSourceHash: 'current' });
  const current = W.workspaceFile(workspace, source, 'Thai');
  assert.equal(current.isDropped, true); assert.equal(current.isMissing, false);
  assert.equal(current.needsReview, false, 'Legacy review transport remains separate from the visible dropped status.');
  assert.deepEqual(current.translations, ['one']); assert.equal(current.hasChanges, false); assert.equal(current.isRevised, false);
  assert.equal(W.workspaceFile(workspace, source, 'German').isDropped, false);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['accepted'] }, 'Thai',
    { source, sourceHash: 'current', promoteDropped: { id: candidate.id, revision: 0, targetSourceHash: 'current' } });
  const saved = W.workspaceFile(workspace, source, 'Thai');
  assert.equal(saved.isDropped, false); assert.equal(saved.hasChanges, true); assert.equal(saved.isRevised, false);
  assert.equal(saved.isMissing, false); assert.equal(workspace.droppedArchive.candidate.status, 'promoted');
});

test('persisted status flags do not control modern Saved, Revised, Missing, or Dropped values', () => {
  const source = sourceDesc(), workspace = modern(source);
  source.hasChanges = true; source.isEdited = true; source.isRevised = true; source.isMissing = true; source.isDropped = true; source.needsReview = true;
  workspace.status['a.txt'] = { hasChanges: true, isEdited: true, isRevised: true, isMissing: true, isDropped: true, needsReview: true,
    languageStatus: { Thai: { hasChanges: true, isEdited: true, isRevised: true, isMissing: true, isDropped: true, needsReview: true } } };
  const before = W.workspaceFile(workspace, source, 'Thai');
  assert.equal(before.hasChanges, false); assert.equal(before.isRevised, false); assert.equal(before.isMissing, false); assert.equal(before.isDropped, false);
  const candidate = W.dropTranslation(workspace, sourceDesc(), 'Thai', { id: 'candidate', game: 'poe1', originSourceHash: 'old' });
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: [''], trackedForExport: false, isRevised: false, isMissing: false }, 'Thai', { source });
  const after = W.workspaceFile(workspace, source, 'Thai');
  assert.equal(after.hasChanges, true); assert.equal(after.isRevised, false); assert.equal(after.isMissing, true);
  assert.equal(after.isDropped, true, 'A saved file still has Dropped status while its separate candidate is unresolved.');
  W.discardDropped(workspace, 'a.txt', 'Thai', { id: candidate.id, revision: candidate.revision });
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isDropped, false);
});

test('an initially Missing ZIP translation stays ordinary Saved after fills and later corrections', () => {
  const source = sourceDesc('One', { Thai: [''] }), workspace = modern(source);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['filled'] }, 'Thai', { source });
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, false);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['filled'] }, 'Thai', { source });
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, false);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['corrected fill'] }, 'Thai', { source });
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, false);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: [''] }, 'Thai', { source });
  assert.equal(W.workspaceFile(workspace, source, 'Thai').hasChanges, true);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isMissing, true);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, false);
});

test('repeated server acknowledgments preserve server-derived before text', () => {
  const source = sourceDesc(), workspace = modern(source);
  const file = { filepath: 'a.txt', translations: ['new'], beforeTranslations: ['one'] };
  W.stageTranslation(workspace, file, 'Thai', { source });
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['new'] }, 'Thai', { source });
  assert.deepEqual(workspace.staged.Thai['a.txt'].before, ['one']);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, true);
  assert.deepEqual(P.fileState(file).beforeTranslations, ['one']);
});

test('Revised compares every save with the immutable ZIP rather than the immediately preceding save', () => {
  const source = sourceDesc(), workspace = modern(source);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['one'] }, 'Thai', { source });
  assert.equal(W.workspaceFile(workspace, source, 'Thai').hasChanges, true);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, false);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['correction'] }, 'Thai', { source });
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['correction'], beforeTranslations: ['correction'] }, 'Thai', { source });
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, true, 'A repeated confirmation does not erase the correction from the ZIP.');
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['one'], beforeTranslations: ['correction'] }, 'Thai', { source });
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, false, 'Restoring the original ZIP text removes Revised.');
  assert.deepEqual(source.translations.Thai, ['one']);
});

test('a partially translated immutable ZIP belongs to Missing work even after every line is saved and corrected', () => {
  const source = sourceDesc('One', { Thai: ['one', ''] });
  source.translations.English.push('Two'); source.variables.push('#'); source.remarks.push('remark');
  const workspace = modern(source);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['one', 'two'] }, 'Thai', { source });
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['corrected one', 'corrected two'] }, 'Thai', { source });
  const state = W.workspaceFile(workspace, source, 'Thai');
  assert.equal(state.hasChanges, true); assert.equal(state.isMissing, false); assert.equal(state.isRevised, false);
});

for (const action of ['promote', 'discard']) test(`Dropped ${action} history keeps later saves ordinary Saved in the same source version`, () => {
  const source = sourceDesc(), workspace = modern(source, 'current');
  const candidate = W.dropTranslation(workspace, sourceDesc('Old English'), 'Thai',
    { id: 'candidate', game: 'poe1', originSourceHash: 'old', targetSourceHash: 'current' });
  if (action === 'promote') W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['accepted'] }, 'Thai',
    { source, promoteDropped: { id: candidate.id, revision: candidate.revision, targetSourceHash: 'current' } });
  else W.discardDropped(workspace, 'a.txt', 'Thai', candidate);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['later correction'] }, 'Thai', { source });
  const reloaded = structuredClone(workspace);
  W.initializeWorkspace(reloaded, { source: [source], sourceHash: 'current', game: 'poe1', language: 'Thai' });
  const state = W.workspaceFile(reloaded, source, 'Thai');
  assert.equal(state.hasChanges, true); assert.equal(state.isDropped, false); assert.equal(state.isRevised, false);
  assert.deepEqual(reloaded.droppedArchive.candidate.targetSourceHashes, ['current']);
});

test('resolved Dropped history excludes Revised only for matching source, game, language, file and recorded account', () => {
  const source = sourceDesc(), workspace = modern(source, 'current'); workspace.collaborationAccountId = 'current-user';
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['correction'] }, 'Thai', { source });
  const record = { id: 'archived', status: 'discarded', game: 'poe1', language: 'Thai', filepath: 'a.txt', targetSourceHash: 'current' };
  const unrelated = [
    { ...record, targetSourceHash: 'previous' },
    { ...record, game: 'poe2' },
    { ...record, language: 'German' },
    { ...record, filepath: 'other.txt' },
    { ...record, collaborationAccountId: 'other-user' },
  ];
  for (const history of unrelated) {
    workspace.droppedArchive = { archived: history };
    assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, true);
  }
  workspace.droppedArchive = { archived: { ...record, collaborationAccountId: 'current-user' } };
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, false, 'Legacy scalar target hashes remain valid scope evidence.');
  workspace.collaborationAccountId = 'other-user';
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, true, 'Changing the account context invalidates the derived index.');
});

test('receiving an unresolved older-target Dropped copy records its current-version assignment for cloud upload and later discard', () => {
  const source = sourceDesc(), workspace = modern(source, 'current');
  const remote = { id: 'shared', game: 'poe1', language: 'Thai', filepath: 'a.txt', originSourceHash: 'original',
    targetSourceHash: 'previous', status: 'dropped', revision: 2, snapshot: { english: ['Old English'], translations: ['old work'] } };
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['correction'] }, 'Thai', { source });
  W.acceptDropped(workspace, [remote]);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, false);
  assert.deepEqual(W.droppedForFile(workspace, 'a.txt', 'Thai').targetSourceHashes, ['previous', 'current']);
  assert.equal(workspace.droppedOutbox.length, 1);
  assert.deepEqual(workspace.droppedOutbox[0].candidate.targetSourceHashes, ['previous', 'current']);
  W.acceptDropped(workspace, [{ ...remote, targetSourceHashes: ['previous', 'current'] }],
    { acknowledge: true, acknowledgeId: 'shared', acknowledgeKind: 'put' });
  assert.equal(workspace.droppedOutbox.length, 0);
  W.discardDropped(workspace, 'a.txt', 'Thai', remote);
  const reloaded = structuredClone(workspace);
  assert.equal(W.workspaceFile(reloaded, source, 'Thai').isRevised, false);
  assert.deepEqual(reloaded.droppedArchive.shared.targetSourceHashes, ['previous', 'current']);
});

test('a fresh peer derives ordinary Saved from resolved cloud Dropped provenance for this version', () => {
  const source = sourceDesc(), workspace = modern(source, 'current');
  W.acceptDropped(workspace, [{ id: 'shared', game: 'poe1', language: 'Thai', filepath: 'a.txt', status: 'promoted', revision: 3,
    targetSourceHash: 'previous', targetSourceHashes: ['previous', 'current'], snapshot: null }]);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['peer accepted and corrected'], beforeTranslations: ['peer accepted'] }, 'Thai', { source });
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isDropped, false);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, false);
  assert.equal(workspace.droppedOutbox.length, 0, 'Resolved records do not generate new candidate uploads.');
});

test('an old resolved tombstone with unavailable scope does not fabricate a current-version assignment', () => {
  const source = sourceDesc(), workspace = modern(source, 'current');
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['correction'] }, 'Thai', { source });
  W.acceptDropped(workspace, [{ id: 'legacy-resolution', game: 'poe1', language: 'Thai', filepath: 'a.txt', status: 'discarded',
    targetSourceHash: '', targetSourceHashes: [], revision: 2, snapshot: null }]);
  assert.equal(workspace.droppedArchive['legacy-resolution'].targetSourceHash, '');
  assert.deepEqual(workspace.droppedArchive['legacy-resolution'].targetSourceHashes, []);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, true);
  assert.equal(workspace.droppedOutbox.length, 0);
});

test('a peer resolution racing an old-target upload preserves and shares the observed current-version assignment', () => {
  const source = sourceDesc(), workspace = modern(source, 'current');
  const candidate = W.dropTranslation(workspace, sourceDesc('Old English'), 'Thai', { id: 'local', game: 'poe1',
    originSourceHash: 'old', targetSourceHash: 'previous' });
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['correction'] }, 'Thai', { source });
  const receipt = { id: 'server', game: 'poe1', language: 'Thai', filepath: 'a.txt', status: 'discarded', revision: 3,
    targetSourceHash: 'previous', targetSourceHashes: ['previous'], snapshot: null };
  W.acceptDropped(workspace, [receipt], { acknowledge: true, acknowledgeId: candidate.id, acknowledgeKind: 'put' });
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai'), null);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, false);
  assert.equal(workspace.droppedOutbox.length, 1, 'Only the newly learned scope provenance needs a deduplicated upload.');
  assert.equal(workspace.droppedOutbox[0].id, 'server');
  assert.deepEqual(workspace.droppedOutbox[0].candidate.targetSourceHashes, ['previous', 'current']);
  assert.deepEqual(workspace.droppedOutbox[0].candidate.snapshot.translations, ['one']);
  W.acceptDropped(workspace, [{ ...receipt, targetSourceHashes: ['previous', 'current'] }],
    { acknowledge: true, acknowledgeId: 'server', acknowledgeKind: 'put' });
  assert.equal(workspace.droppedOutbox.length, 0);
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai'), null, 'A provenance receipt never recreates a resolved Dropped copy.');
});

test('scope provenance survives a candidate alias, source retargeting and a resolved receipt without payload', () => {
  const source = sourceDesc(), workspace = modern(source, 'first');
  const candidate = W.dropTranslation(workspace, sourceDesc('Old English'), 'Thai', { id: 'local', game: 'poe1', originSourceHash: 'old' });
  W.upgradeSource(workspace, { previousSource: [source], source: [source], previousSourceHash: 'first', sourceHash: 'current', game: 'poe1' });
  W.acceptDropped(workspace, [{ ...candidate, id: 'server', revision: 2, targetSourceHash: 'first', targetSourceHashes: ['first'] }],
    { acknowledge: true, acknowledgeId: 'local', acknowledgeKind: 'put' });
  assert.deepEqual(workspace.droppedArchive.server.targetSourceHashes, ['first', 'current']);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['accepted'] }, 'Thai',
    { source, promoteDropped: { id: 'server', revision: 2, targetSourceHash: 'current' } });
  W.acceptDropped(workspace, [{ id: 'server', game: 'poe1', language: 'Thai', filepath: 'a.txt', status: 'promoted', revision: 3,
    targetSourceHash: 'first', targetSourceHashes: ['first', 'current'], snapshot: null }]);
  const reloaded = structuredClone(workspace);
  assert.deepEqual(reloaded.droppedArchive.server.targetSourceHashes, ['first', 'current']);
  assert.deepEqual(reloaded.droppedArchive.server.snapshot.translations, ['one']);
  assert.equal(W.workspaceFile(reloaded, source, 'Thai').isRevised, false);
  reloaded.sourceHash = 'future'; reloaded.staged.Thai['a.txt'].sourceHash = 'future';
  assert.equal(W.workspaceFile(reloaded, source, 'Thai').isRevised, true, 'A resolved older-only assignment does not become Dropped in a new version.');
});

test('the derived Dropped-scope index scans archived candidates once across twenty thousand file queries', () => {
  const source = sourceDesc(), workspace = modern(source, 'current');
  const archive = {};
  for (let index = 0; index < 1000; index++) archive['dropped-' + index] = { id: 'dropped-' + index, game: 'poe1',
    language: 'Thai', filepath: 'a-' + index + '.txt', status: 'discarded', targetSourceHash: 'current' };
  let archiveScans = 0;
  workspace.droppedArchive = new Proxy(archive, { ownKeys(value) { archiveScans++; return Reflect.ownKeys(value); } });
  workspace.staged.Thai = {};
  for (let index = 0; index < 20000; index++) workspace.staged.Thai['a-' + index + '.txt'] = { sourceHash: 'current', translations: ['correction'] };
  for (let index = 0; index < 20000; index++) {
    const desc = { ...source, filepath: 'a-' + index + '.txt' };
    assert.equal(W.workspaceFile(workspace, desc, 'Thai').isRevised, index >= 1000);
  }
  assert.equal(archiveScans, 1);
  W.acceptDropped(workspace, [{ id: 'new-remote', game: 'poe1', language: 'Thai', filepath: 'a-19999.txt', status: 'promoted',
    targetSourceHashes: ['current'], revision: 2, snapshot: null }]);
  const beforeQuery = archiveScans;
  assert.equal(W.workspaceFile(workspace, { ...source, filepath: 'a-19999.txt' }, 'Thai').isRevised, false);
  assert.equal(archiveScans, beforeQuery + 1, 'A domain mutation rebuilds the derived index once.');
});

test('source upgrade separates old authored translation and retains its full original context', () => {
  const previous = sourceDesc(), current = sourceDesc('Different English', { Thai: [''], German: ['neu'] });
  const workspace = modern(previous);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['authored Thai'] }, 'Thai', { source: previous });
  W.upgradeSource(workspace, { previousSource: [previous], source: [current], previousSourceHash: 'old', sourceHash: 'new', game: 'poe1' });
  const state = W.workspaceFile(workspace, current, 'Thai'), candidate = state.candidate;
  assert.deepEqual(state.translations, ['']); assert.equal(state.hasChanges, false); assert.equal(state.isMissing, true); assert.equal(state.needsReview, true);
  assert.equal(candidate.originSourceHash, 'old'); assert.equal(candidate.targetSourceHash, 'new');
  assert.deepEqual(candidate.snapshot.english, ['One']); assert.deepEqual(candidate.snapshot.translations, ['authored Thai']);
  assert.deepEqual(candidate.snapshot.variables, ['#']); assert.deepEqual(candidate.snapshot.remarks, ['remark']);
  assert.deepEqual(candidate.snapshot.stats, ['stat']); assert.equal(candidate.snapshot.name, 'stat');
  assert.deepEqual(previous.translations.Thai, ['one'], 'The immutable ZIP is unchanged.');
});

test('an untouched ZIP translation removed by a later ZIP becomes dropped even when English is unchanged', () => {
  const previous = sourceDesc(), current = sourceDesc('One', { Thai: [''], German: ['eins'] }), workspace = modern(previous);
  W.upgradeSource(workspace, { previousSource: [previous], source: [current], previousSourceHash: 'old', sourceHash: 'new', game: 'poe1' });
  const state = W.workspaceFile(workspace, current, 'Thai');
  assert.deepEqual(state.translations, ['']); assert.equal(state.needsReview, true); assert.equal(state.hasChanges, false);
  assert.deepEqual(state.candidate.snapshot.translations, ['one']);
  assert.equal(W.workspaceFile(workspace, current, 'German').candidate, null);
});

test('unresolved candidates survive repeated source versions without duplicate generations', () => {
  const previous = sourceDesc(), current = sourceDesc('Two', { Thai: [''] }), next = sourceDesc('Three', { Thai: [''] });
  const workspace = modern(previous);
  W.upgradeSource(workspace, { previousSource: [previous], source: [current], previousSourceHash: 'old', sourceHash: 'middle', game: 'poe1' });
  const id = W.droppedForFile(workspace, 'a.txt', 'Thai').id;
  W.upgradeSource(workspace, { previousSource: [current], source: [next], previousSourceHash: 'middle', sourceHash: 'latest', game: 'poe1' });
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai').id, id);
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai').originSourceHash, 'old');
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai').targetSourceHash, 'latest');
  assert.equal(Object.values(workspace.droppedArchive).filter(record => record.language === 'Thai').length, 1);
});

test('a source-compatible staged translation advances scope without creating a dropped candidate', () => {
  const previous = sourceDesc(), workspace = modern(previous), current = structuredClone(previous);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['authored'] }, 'Thai', { source: previous });
  W.upgradeSource(workspace, { previousSource: [previous], source: [current], previousSourceHash: 'old', sourceHash: 'new', game: 'poe1' });
  assert.equal(workspace.staged.Thai['a.txt'].sourceHash, 'new');
  assert.equal(W.workspaceFile(workspace, current, 'Thai').hasChanges, true);
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai'), null);
});

test('legacy private review text migrates to dropped without becoming staged or replacing current ZIP text', () => {
  const current = sourceDesc('New English', { Thai: [''] }), local = sourceDesc('Old English', { Thai: ['old translation'] });
  local.hasChanges = false;
  const workspace = { sourceHash: 'new', descs: [local], status: { 'a.txt': { needsReview: true } } };
  const original = structuredClone(local.translations);
  W.initializeWorkspace(workspace, { source: [current], sourceHash: 'new', game: 'poe1', language: 'Thai' });
  assert.deepEqual(local.translations, original);
  assert.equal(workspace.staged.Thai?.['a.txt'], undefined);
  assert.deepEqual(W.workspaceFile(workspace, current, 'Thai').translations, ['']);
  assert.deepEqual(W.droppedForFile(workspace, 'a.txt', 'Thai').snapshot.english, ['Old English']);
  const before = JSON.stringify(workspace);
  W.initializeWorkspace(workspace, { source: [sourceDesc('Different source')], language: 'German' });
  assert.equal(JSON.stringify(workspace), before, 'Migration runs once.');
});

test('candidate promotion rejects stale revision without changing staged work and retains its recovery archive', () => {
  const source = sourceDesc('New', { Thai: [''] }), old = sourceDesc(), workspace = modern(source, 'new');
  const candidate = W.dropTranslation(workspace, old, 'Thai', { id: 'candidate', game: 'poe1', originSourceHash: 'old', revision: 3 });
  const before = structuredClone(workspace);
  assert.throws(() => W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['reviewed'] }, 'Thai',
    { source, promoteDropped: { id: candidate.id, revision: 2, targetSourceHash: 'new' } }), /changed before/);
  assert.deepEqual(workspace, before);
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['reviewed'] }, 'Thai',
    { source, promoteDropped: { id: candidate.id, revision: 3, targetSourceHash: 'new' } });
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai'), null);
  assert.equal(workspace.droppedArchive.candidate.status, 'promoted');
  assert.deepEqual(workspace.droppedArchive.candidate.snapshot.translations, ['one']);
  assert.equal(W.workspaceFile(workspace, source, 'Thai').needsReview, false);
});

test('cloud upload acknowledgment maps a local candidate without resurrecting an optimistic promotion', () => {
  const source = sourceDesc('New', { Thai: [''] }), old = sourceDesc(), workspace = modern(source, 'new');
  const candidate = W.dropTranslation(workspace, old, 'Thai', { id: 'local', game: 'poe1', originSourceHash: 'old' });
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['reviewed'] }, 'Thai',
    { source, promoteDropped: { id: candidate.id, revision: 0, targetSourceHash: 'new' } });
  W.acceptDropped(workspace, [{ ...structuredClone(candidate), id: 'server', revision: 1, status: 'dropped' }], { acknowledge: true });
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai'), null);
  assert.deepEqual(workspace.droppedAliases.local, { id: 'server', fromRevision: 0, revision: 1, targetSourceHash: 'new' });
  assert.equal(workspace.droppedOutbox.length, 0);
  W.acceptDropped(workspace, [{ ...candidate, id: 'server', revision: 2, status: 'promoted', snapshot: null }]);
  assert.deepEqual(workspace.droppedArchive.server.snapshot.translations, ['one']);
  assert.equal(workspace.droppedArchive.server.status, 'promoted');
});

test('discard is explicit and the same old translation is not resurrected by another import', () => {
  const old = sourceDesc(), source = sourceDesc('New', { Thai: [''] }), workspace = modern(source, 'new');
  const candidate = W.dropTranslation(workspace, old, 'Thai', { id: 'candidate', game: 'poe1', originSourceHash: 'old', revision: 2 });
  W.discardDropped(workspace, 'a.txt', 'Thai', { id: candidate.id, revision: 2 });
  W.dropTranslation(workspace, old, 'Thai', { game: 'poe1', originSourceHash: 'old', targetSourceHash: 'new' });
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai'), null);
  assert.equal(workspace.droppedArchive.candidate.status, 'discarded');
  assert.equal(workspace.droppedOutbox.at(-1).kind, 'discard');
});

test('modern projection of a derived Review blank never overwrites the separate original candidate snapshot', () => {
  const source = sourceDesc('New', { Thai: [''] }), old = sourceDesc(), workspace = modern(source, 'new');
  W.dropTranslation(workspace, old, 'Thai', { id: 'candidate', game: 'poe1', originSourceHash: 'old' });
  const projected = P.projectWorkspace(workspace, [{ filepath: 'a.txt', translations: [''], needsReview: true, trackedForExport: false }], 'Thai', [source]);
  assert.equal(Object.keys(projected.droppedArchive).length, 1);
  assert.deepEqual(W.droppedForFile(projected, 'a.txt', 'Thai').snapshot.english, ['One']);
  assert.deepEqual(W.droppedForFile(projected, 'a.txt', 'Thai').snapshot.translations, ['one']);
  assert.equal(W.droppedForFile(projected, 'a.txt', 'Thai').originSourceHash, 'old');
  assert.equal(W.droppedForFile(projected, 'a.txt', 'Thai').originSourceAvailable, true);
  assert.deepEqual(W.workspaceFile(projected, source, 'Thai').translations, ['']);
});

test('legacy review projection retains committed text and honestly marks unavailable historical English', () => {
  const source = sourceDesc('Current English'), workspace = modern(source, 'current');
  W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['accepted current'] }, 'Thai', { source });
  const projected = P.projectWorkspace(workspace, [{ filepath: 'a.txt', translations: ['recovered old'], needsReview: true }], 'Thai', [source]);
  const candidate = W.droppedForFile(projected, 'a.txt', 'Thai');
  assert.equal(candidate.originSourceHash, ''); assert.equal(candidate.originSourceAvailable, false);
  assert.equal(candidate.targetSourceHash, 'current'); assert.deepEqual(candidate.snapshot.translations, ['recovered old']);
  assert.deepEqual(W.workspaceFile(projected, source, 'Thai').translations, ['accepted current']);
  assert.equal(W.workspaceFile(projected, source, 'Thai').hasChanges, true);
  assert.equal(W.workspaceFile(projected, source, 'Thai').isDropped, true);
});

test('legacy migration recovers the exact historical source baseline instead of current English', () => {
  const old = sourceDesc('Old English'), source = sourceDesc('Current English', { Thai: [''] });
  const local = sourceDesc('Current English', { Thai: ['old translation'] });
  const workspace = { sourceHash: 'new', descs: [local], status: { 'a.txt': { needsReview: true,
    reviewCandidates: { Thai: { sourceHash: 'old', translations: ['old translation'] } } } } };
  W.initializeWorkspace(workspace, { source: [source], game: 'poe1', language: 'Thai', originSources: { old: [old] } });
  const candidate = W.droppedForFile(workspace, 'a.txt', 'Thai');
  assert.equal(candidate.originSourceHash, 'old'); assert.equal(candidate.originSourceAvailable, true);
  assert.deepEqual(candidate.snapshot.english, ['Old English']); assert.deepEqual(candidate.snapshot.variables, ['#']);
});

test('unknown historical source is marked unavailable and unrelated account/source revisions are ignored', () => {
  const source = sourceDesc('Current English', { Thai: [''] }), local = sourceDesc('Current English', { Thai: ['old translation'] });
  const workspace = { sourceHash: 'new', collaborationAccountId: 'user', descs: [local], status: { 'a.txt': { needsReview: true,
    reviewCandidates: { Thai: { sourceHash: 'old', translations: ['old translation'] } } } } };
  W.initializeWorkspace(workspace, { source: [source], game: 'poe1', language: 'Thai', revisions: [
    { filepath: 'a.txt', lang: 'English', sourceHash: 'other', translations: ['Wrong source'] },
    { filepath: 'a.txt', lang: 'English', sourceHash: 'old', collaborationAccountId: 'other-user', translations: ['Wrong account'] },
  ] });
  const candidate = W.droppedForFile(workspace, 'a.txt', 'Thai');
  assert.equal(candidate.originSourceAvailable, false); assert.equal(candidate.originSourceHash, 'old');
  assert.deepEqual(candidate.snapshot.translations, ['old translation']);
});

test('a trusted resolved dedup receipt aliases and removes a new local retry while preserving its old snapshot', () => {
  const source = sourceDesc('New', { Thai: [''] }), workspace = modern(source, 'new');
  const candidate = W.dropTranslation(workspace, sourceDesc(), 'Thai', { id: 'new-local', game: 'poe1', originSourceHash: 'old' });
  W.acceptDropped(workspace, [{ ...candidate, id: 'old-server', revision: 2, status: 'discarded', snapshot: null }],
    { acknowledge: true, acknowledgeId: candidate.id, acknowledgeKind: 'put' });
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai'), null); assert.equal(workspace.droppedOutbox.length, 0);
  assert.equal(workspace.droppedAliases['new-local'].id, 'old-server');
  assert.deepEqual(workspace.droppedArchive['old-server'].snapshot.translations, ['one']);
});

test('cloud source snapshots match structurally regardless property order and ISO receipt times', () => {
  const source = sourceDesc('New', { Thai: [''] }), workspace = modern(source, 'new');
  const candidate = W.dropTranslation(workspace, sourceDesc(), 'Thai', { id: 'local', game: 'poe1', originSourceHash: 'old' });
  workspace.droppedOutbox = [];
  const { name, english, variables, remarks, stats, translations } = candidate.snapshot;
  W.acceptDropped(workspace, [{ ...candidate, id: 'shared', revision: 3, createdAt: new Date().toISOString(),
    snapshot: { name, english, variables, remarks, stats, translations } }]);
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai').id, 'shared');
  assert.equal(workspace.droppedAliases.local.revision, 3);
});

test('English-only source history preserves text without falsely claiming complete old source metadata', () => {
  const source = sourceDesc('Current', { Thai: [''] });
  const workspace = { sourceHash: 'new', descs: [sourceDesc('Current', { Thai: ['old text'] })], status: { 'a.txt': {
    needsReview: true, reviewCandidates: { Thai: { sourceHash: 'old', translations: ['old text'] } } } } };
  W.initializeWorkspace(workspace, { source: [source], game: 'poe1', language: 'Thai', revisions: [
    { filepath: 'a.txt', lang: 'English', sourceHash: 'old', savedAt: 2, translations: ['Actual old English'] },
  ] });
  const candidate = W.droppedForFile(workspace, 'a.txt', 'Thai');
  assert.equal(candidate.originSourceAvailable, false); assert.deepEqual(candidate.snapshot.english, ['Actual old English']);
  assert.deepEqual(candidate.snapshot.variables, []); assert.deepEqual(candidate.snapshot.translations, ['old text']);
});

for (const resolution of ['discarded', 'promoted']) test('explicit recovery creates a fresh generation after ' + resolution, () => {
  const source = sourceDesc(), workspace = modern(source, 'current');
  const options = { game: 'poe1', id: 'first-action', recoveryId: 'first-action', translations: ['historical'] };
  const first = W.dropTranslation(workspace, source, 'Thai', options);
  if (resolution === 'discarded') W.discardDropped(workspace, 'a.txt', 'Thai', first);
  else W.stageTranslation(workspace, { filepath: 'a.txt', translations: ['historical'] }, 'Thai',
    { source, promoteDropped: { id: first.id, revision: first.revision, targetSourceHash: 'current' } });
  const stagedBefore = structuredClone(workspace.staged);
  const second = W.dropTranslation(workspace, source, 'Thai', { ...options, id: 'second-action', recoveryId: 'second-action' });
  assert.equal(second.id, 'second-action');
  assert.equal(second.status, 'dropped');
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai').id, second.id);
  assert.equal(workspace.droppedArchive[first.id].status, resolution);
  assert.deepEqual(workspace.staged, stagedBefore, 'Recovery does not change committed translations.');
  assert.equal(W.workspaceFile(workspace, source, 'Thai').isRevised, false);
  const pending = workspace.droppedOutbox.length;
  assert.equal(W.dropTranslation(workspace, source, 'Thai', options).status, resolution);
  assert.equal(workspace.droppedOutbox.length, pending, 'A retry of the resolved first action must not queue another upload.');
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai').id, second.id, 'A resolved action retry cannot replace the new generation.');
});

test('cloud generation aliases and tombstones cannot collapse separate explicit recoveries', () => {
  const source = sourceDesc(), workspace = modern(source, 'current');
  const first = W.dropTranslation(workspace, source, 'Thai', { id: 'first-action', recoveryId: 'first-action', translations: ['history'] });
  W.acceptDropped(workspace, [{ ...first, id: 'first-server', revision: 1 }],
    { acknowledge: true, acknowledgeId: first.id });
  W.discardDropped(workspace, 'a.txt', 'Thai', { id: 'first-server', revision: 1 });
  W.acceptDropped(workspace, [{ ...first, id: 'first-server', status: 'discarded', revision: 2, snapshot: null }],
    { acknowledge: true, acknowledgeKind: 'discard', acknowledgeId: 'first-server' });
  const second = W.dropTranslation(workspace, source, 'Thai', { id: 'second-action', recoveryId: 'second-action', translations: ['history'] });
  W.acceptDropped(workspace, [{ ...second, id: 'second-server', revision: 1 }],
    { acknowledge: true, acknowledgeId: second.id });
  W.acceptDropped(workspace, [{ ...first, id: 'first-server', status: 'discarded', revision: 2, snapshot: null }]);
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai').id, 'second-server');
  assert.equal(workspace.droppedArchive['first-server'].status, 'discarded');
  assert.equal(workspace.droppedArchive['second-server'].status, 'dropped');
  assert.equal(W.dropTranslation(workspace, source, 'Thai', { id: 'first-action', recoveryId: 'first-action', translations: ['history'] }).status, 'discarded');
  assert.equal(workspace.droppedOutbox.length, 0);
});

test('recovery action aliases remain idempotent when an identical active shared copy already exists', () => {
  const source = sourceDesc(), workspace = modern(source, 'current');
  const original = W.dropTranslation(workspace, source, 'Thai', { id: 'shared', recoveryId: 'other-action', translations: ['history'] });
  workspace.droppedOutbox = [];
  const requested = W.dropTranslation(workspace, source, 'Thai', { id: 'my-action', recoveryId: 'my-action', translations: ['history'] });
  W.acceptDropped(workspace, [{ ...original, revision: 1 }], { acknowledge: true, acknowledgeId: requested.id });
  W.discardDropped(workspace, 'a.txt', 'Thai', { id: 'shared', revision: 1 });
  const retry = W.dropTranslation(workspace, source, 'Thai', { id: 'my-action', recoveryId: 'my-action', translations: ['history'] });
  assert.equal(retry.id, 'shared');
  assert.equal(retry.status, 'discarded');
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai'), null);
});

test('automatic recovery keeps resolved-content deduplication and rejects reused explicit action content', () => {
  const source = sourceDesc(), workspace = modern(source, 'current');
  const first = W.dropTranslation(workspace, source, 'Thai', { id: 'automatic', translations: ['history'] });
  W.discardDropped(workspace, 'a.txt', 'Thai', first);
  assert.equal(W.dropTranslation(workspace, source, 'Thai', { translations: ['history'] }).status, 'discarded');
  W.dropTranslation(workspace, source, 'Thai', { id: 'action', recoveryId: 'action', translations: ['history'] });
  assert.throws(() => W.dropTranslation(workspace, source, 'Thai', { id: 'action', recoveryId: 'action', translations: ['different'] }), /different translation/);
  assert.equal(W.droppedForFile(workspace, 'a.txt', 'Thai').id, 'action');
});
