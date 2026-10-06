const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const copy = value => JSON.parse(JSON.stringify(value));
const state = (translations, revision = 1) => ({ filepath: 'stat.txt', translations, needsReview: false, trackedForExport: true, revision });
const conflict = (fields = {}) => ({ id: 'conflict-1', filepath: 'stat.txt', kind: 'edit', base: state(['before', 'unchanged', 'old remote']), yours: state(['mine', 'my independent change', 'old remote']), shared: state(['theirs', 'unchanged', 'remote independent change'], 2), indexes: [0], ...fields });
const event = (fields = {}) => ({ id: 12, revision: 2, currentRevision: 4, actor: { id: 'alice', name: 'Alice' }, createdAt: '2026-10-01T00:00:00.000Z', origin: 'save', before: state(['before']), after: state(['after']), current: state(['latest'], 4), canRestoreBefore: true, canRestoreAfter: true, ...fields });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function editor(wrappers = {}) {
  const focus = { isConnected: true, count: 0, focus() { this.count++; } };
  const sandbox = { window: {}, document: { activeElement: focus } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/collaborationUi.js'), 'utf8'), sandbox);
  const mixin = sandbox.window.CollaborationUI.mixin;
  const dialog = () => ({ open: false, showModal() { this.open = true; }, close() { this.open = false; } });
  const instance = {
    ...mixin.data(), cloudUser: { id: 'alice' }, gameVersion: 'poe1', lang: 'Thai',
    descs: [{ filepath: 'stat.txt', translations: { English: ['English', 'Another entry', 'Last entry'] } }],
    $refs: { collaborationConflictDialog: dialog(), collaborationHistoryDialog: dialog() },
    $nextTick: async fn => fn?.(), collabResolve: async () => ({ status: 'synced' }),
    collabLoadHistory: async () => ({ items: [], nextCursor: null }), collabLoadHistoryEntry: async () => event(),
    collabRestoreHistory: async () => ({ status: 'synced' }), ...wrappers,
  };
  for (const [name, method] of Object.entries(mixin.methods)) instance[name] = method.bind(instance);
  for (const [name, getter] of Object.entries(mixin.computed)) Object.defineProperty(instance, name, { get: getter.bind(instance) });
  instance.collabReceiveState({ roomId: 'room-1', connected: true, sessionId: 'self', conflicts: [], identity: { accountId: 'alice', game: 'poe1', sourceHash: 'a'.repeat(64), language: 'Thai' } });
  return { app: instance, focus, mixin };
}

test('unchanged compact state retains reactive identity while presence updates preserve conflict state', () => {
  const { app } = editor(); const previous = app.collaborationState;
  app.collabReceiveState(copy(previous));
  assert.equal(app.collaborationState, previous);
  const conflicts = [conflict()];
  app.collabReceiveState({ ...previous, conflicts });
  const withConflicts = app.collaborationState;
  app.collabReceiveState({ ...copy(withConflicts), peers: [{ sessionId: 'other', editing: 'stat.txt' }] });
  assert.notEqual(app.collaborationState, withConflicts);
  assert.equal(app.collaborationState.conflicts, withConflicts.conflicts);
  assert.equal(app.collaborationState.identity, withConflicts.identity);
});

test('file presence excludes this browser and clears stale presence when disconnected', () => {
  const { app } = editor();
  app.collaborationState.peers = [
    { sessionId: 'self', name: 'Alice', selected: 'stat.txt', editing: 'stat.txt' },
    { sessionId: 'bob', name: 'Bob', selected: 'stat.txt', editing: null },
    { sessionId: 'carol', name: 'Carol', selected: null, editing: 'stat.txt' },
    { sessionId: 'dana', name: 'Dana', selected: 'other.txt', editing: 'other.txt' },
  ];
  assert.deepEqual(app.collaborationPeersFor('stat.txt').map(peer => peer.name), ['Bob', 'Carol']);
  assert.equal(app.collaborationEditing('stat.txt'), true);
  assert.equal(app.collaborationPeerLabel(app.collaborationState.peers[1], 'stat.txt'), 'Bob');
  assert.equal(app.collaborationPeerLabel(app.collaborationState.peers[2], 'stat.txt'), 'Carol · Editing');
  assert.equal(app.collaborationSelectionLabel('stat.txt'), 'Bob');
  assert.deepEqual(app.collaborationEditingPeersFor('stat.txt').map(peer => peer.name), ['Carol']);
  app.collaborationState.connected = false;
  assert.equal(app.collaborationPeersFor('stat.txt').length, 0);
  assert.equal(app.collaborationEditing('stat.txt'), false);
});

test('participant avatars include self, deduplicate accounts, and mark away only when every session is away', () => {
  const { app } = editor();
  const peers = [
    { sessionId: 'bob-inactive', userId: 'bob', name: 'Bob Builder', color: '#3458b3', selected: 'stat.txt', away: true },
    { sessionId: 'self', userId: 'alice', name: 'Alice Example', color: '#17743b', away: false },
    { sessionId: 'bob-active', userId: 'bob', name: 'Bob Builder', color: '#3458b3', away: false },
    { sessionId: 'carol-one', userId: 'carol', name: 'Carol', color: '#96408c', away: true },
    { sessionId: 'carol-two', userId: 'carol', name: 'Carol', color: '#96408c', away: true },
  ];
  const before = copy(peers);
  app.collaborationState.peers = peers;
  const participants = app.collaborationParticipants;
  assert.deepEqual(copy(participants).map(person => person.name), ['Alice Example', 'Bob Builder', 'Carol']);
  assert.equal(participants[0].isSelf, true);
  assert.equal(participants[1].sessionCount, 2);
  assert.equal(participants[1].away, false);
  assert.equal(participants[2].away, true);
  assert.equal(app.collaborationParticipantLabel(participants[0]), 'Alice Example · You · Active');
  assert.equal(app.collaborationParticipantLabel(participants[2]), 'Carol · Away');
  assert.equal(app.collaborationPeerColor(participants[1]), app.collaborationCellStyle('stat.txt')['--collaboration-color']);
  assert.deepEqual(peers, before, 'Avatar aggregation never mutates live session presence.');
  app.collaborationState.connected = false;
  assert.equal(app.collaborationParticipants.length, 0, 'Disconnected room participants must disappear rather than remain stale.');
});

test('healthy collaboration and brief pending work stay quiet while failures and conflicts remain visible', () => {
  const { app } = editor();
  assert.equal(app.collaborationNeedsAttention, false);
  assert.equal(app.collaborationConnectionTone, 'connected');
  for (const success of ['Translation conflict resolved.', 'Marked as reviewed (unchanged).', 'Imported 2 translated files.', 'Saved locally · Pending sync', 'Resolution saved locally · Pending sync', 'Imported 2 translated files · Pending sync']) {
    app.collaborationNotice = success; assert.equal(app.collaborationEditorNotice, ''); assert.equal(app.collaborationUserNotice, '');
  }
  app.collaborationNotice = 'No available files in this direction.';
  assert.equal(app.collaborationEditorNotice, app.collaborationNotice);
  app.collaborationState.pendingCount = 1;
  assert.equal(app.collaborationNeedsAttention, false); assert.equal(app.collaborationConnectionTone, 'connected');
  assert.equal(app.collaborationCanRetry, false); assert.equal(app.collaborationStatusLabel, '');
  app.collaborationState.pendingCount = 0; app.collaborationState.conflicts = [conflict()];
  assert.equal(app.collaborationNeedsAttention, true);
  app.collaborationState.conflicts = []; app.collaborationState.error = 'Access expired';
  app.collaborationNotice = 'Access expired';
  assert.equal(app.collaborationNeedsAttention, true); assert.equal(app.collaborationConnectionTone, 'error');
  assert.equal(app.collaborationEditorNotice, '', 'Do not repeat the same error below the warning banner.');
  app.collaborationState.error = ''; app.collaborationState.connected = false;
  assert.equal(app.collaborationNeedsAttention, false, 'An initial socket connection is silent.');
  assert.equal(app.collaborationCanRetry, false);
  app.collaborationState.disconnected = true;
  assert.equal(app.collaborationNeedsAttention, true);
  assert.equal(app.collaborationCanRetry, true);
  assert.match(app.collaborationStatusLabel, /reconnecting automatically/);
  app.collaborationState.roomId = ''; app.collaborationState.disconnected = false;
  assert.equal(app.collaborationNeedsAttention, false, 'Local editing has no healthy sync banner.');
});

test('avatars keep namesakes separate and initials preserve Unicode graphemes', () => {
  const { app } = editor();
  app.collaborationState.peers = [
    { sessionId: 'one', userId: 'one', name: 'Same Name', away: false },
    { sessionId: 'two', userId: 'two', name: 'Same Name', away: true },
  ];
  assert.equal(app.collaborationParticipants.length, 2);
  assert.equal(app.collaborationParticipantInitials({ name: 'Peter Pakanun' }), 'PP');
  assert.equal(app.collaborationParticipantInitials({ name: 'Alice' }), 'A');
  assert.equal(app.collaborationParticipantInitials({ name: '🧙‍♀️ Wizard' }), '🧙‍♀️W');
  assert.equal(app.collaborationParticipantInitials({ name: '' }), 'T');
});

test('footer avatars precede pagination and away shading preserves the collaborator color border', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const footer = html.slice(html.indexOf('<footer class="workspaceFooter">'), html.indexOf('</footer>', html.indexOf('<footer class="workspaceFooter">')));
  assert.ok(footer.indexOf('class="collaborationAvatars"') < footer.indexOf('aria-label="File pagination"'));
  assert.match(footer, /:aria-label="collaborationParticipantLabel\(participant\)"/);
  assert.match(footer, /v-tooltip="collaborationParticipantLabel\(participant\)"/);
  assert.match(footer, /collaborationPeerColor\(participant\)/);
  const css = fs.readFileSync(path.join(__dirname, '../public/interface.css'), 'utf8');
  assert.match(css, /\.collaborationAvatar\.away \.collaborationAvatarFace\s*\{[^}]*grayscale\(1\)/);
  assert.match(css, /\.collaborationAvatar\s*\{[^}]*border: 2px solid var\(--collaboration-color/);
});

test('export version uses the completed local source hash without requiring a signed-in room', () => {
  const { app } = editor({ sourceIdentity: 'b'.repeat(64) });
  app.cloudUser = null;
  app.collabReceiveState({ roomId: '', connected: false, identity: null, sourceHash: '' });
  assert.equal(app.collaborationExportHash, 'b'.repeat(64));
  assert.equal(app.collaborationShortVersion, 'b'.repeat(12));
  app.collabReceiveState({ roomId: 'old-room', identity: { sourceHash: 'a'.repeat(64) } });
  assert.equal(app.collaborationExportHash, 'b'.repeat(64), 'The current source takes precedence over an older collaboration room.');
  assert.equal(app.collaborationShortVersion, 'b'.repeat(12));
});

test('export version falls back to completed room hashes and remains empty until one is available', () => {
  const { app } = editor({ sourceIdentity: '' });
  assert.equal(app.collaborationExportHash, 'a'.repeat(64));
  assert.equal(app.collaborationShortVersion, 'a'.repeat(12));
  app.collabReceiveState({ identity: null, sourceHash: 'c'.repeat(64) });
  assert.equal(app.collaborationExportHash, 'c'.repeat(64));
  assert.equal(app.collaborationShortVersion, 'c'.repeat(12));
  app.collabReceiveState({ identity: null, sourceHash: '', hashing: true });
  assert.equal(app.collaborationExportHash, '');
  assert.equal(app.collaborationShortVersion, '');
  assert.equal(app.collaborationState.hashing, true);
  app.collabReceiveState({ identity: { sourceHash: 'd'.repeat(64) }, hashing: false });
  assert.equal(app.collaborationState.hashing, false);
  assert.equal(app.collaborationShortVersion, 'd'.repeat(12));
});

test('export version displays cached original ZIP identity while room identity remains the effective baseline', () => {
  const { app } = editor({ sourceIdentity: 'b'.repeat(64), importBaseline: { archive: { zipHash: 'c'.repeat(64), baselineId: 'b'.repeat(64) } } });
  assert.equal(app.collaborationExportHash, 'c'.repeat(64));
  assert.equal(app.collaborationShortVersion, 'c'.repeat(12));
  assert.equal(app.sourceIdentity, 'b'.repeat(64));
  app.importBaseline = null;
  assert.equal(app.collaborationExportHash, 'b'.repeat(64));
});

test('import-time original ZIP hashing drives the same footer progress without requiring a room', () => {
  const { app } = editor({ importBaselineHashing: true });
  app.collabReceiveState({ identity: null, hashing: false });
  assert.equal(app.collaborationHashing, true);
  app.importBaselineHashing = false;
  assert.equal(app.collaborationHashing, false);
  app.collabReceiveState({ hashing: true });
  assert.equal(app.collaborationHashing, true);
});

test('untrusted presence names remain text and CSS colors cannot inject external resources', () => {
  const { app } = editor();
  const malicious = { name: '<img src=x onerror=alert(1)>', color: 'url(https://example.invalid/track)', sessionId: 'bob' };
  assert.equal(app.collaborationPeerName(malicious), malicious.name);
  assert.match(app.collaborationPeerColor(malicious), /^#[0-9a-f]{6}$/i);
  assert.equal(app.collaborationPeerColor({ name: 'Alice', color: '#3458b3' }), '#3458b3');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const dialogs = html.slice(html.indexOf('<dialog ref="collaborationConflictDialog"'), html.indexOf('<app-tooltip'));
  assert.equal(dialogs.includes('v-html'), false, 'Conflict and shared history content must render through text bindings.');
  assert.match(dialogs, /@cancel\.prevent="collaborationCloseConflicts"/);
  assert.match(dialogs, /@cancel\.prevent="collaborationCloseHistory"/);
  assert.match(dialogs, /@keydown\.stop/);
});

test('presence updates do not erase a sync failure, while success or a different room clears it', () => {
  const { app } = editor();
  const snapshot = copy(app.collaborationState);
  app.collabReceiveState({ ...snapshot, error: 'Permission refresh required', status: 'Attention' });
  const presence = { ...snapshot, peers: [{ sessionId: 'bob', selected: 'stat.txt' }] };
  delete presence.error; delete presence.status;
  app.collabReceiveState(presence);
  assert.equal(app.collaborationState.error, 'Permission refresh required');
  assert.equal(app.collaborationStatusLabel, 'Collaboration needs attention');
  app.collabReceiveState({ ...presence, error: '', status: 'Shared changes saved' });
  assert.equal(app.collaborationStatusLabel, '');
  app.collabReceiveState({ ...presence, error: 'Old room failure' });
  app.collabReceiveState({ ...presence, roomId: 'new-room' });
  assert.equal(app.collaborationState.error, '');
});

test('initial join preserves a failure until confirmed recovery and clears its duplicate notice', () => {
  const { app } = editor();
  app.collabReceiveState({ ...app.collaborationState, roomId: null, connected: false, error: 'Network unavailable' });
  app.collaborationNotice = 'Network unavailable';
  const joined = { ...app.collaborationState, roomId: 'room-1' };
  delete joined.error; delete joined.status;
  app.collabReceiveState(joined);
  assert.equal(app.collaborationState.error, 'Network unavailable');
  assert.equal(app.collaborationUserNotice, '', 'The unresolved issue stays in its existing banner.');
  app.collabReceiveState({ ...joined, error: '', status: '' });
  assert.equal(app.collaborationNeedsAttention, false);
  assert.equal(app.collaborationNotice, '', 'Confirmed recovery must not leave an obsolete warning.');
});

test('an initial offline join can be retried before the server assigns a room ID', () => {
  const { app } = editor();
  app.collabReceiveState({ ...app.collaborationState, roomId: null, connected: false, error: 'Offline' });
  assert.equal(app.collaborationCanRetry, true);
  app.collabReceiveState({ ...app.collaborationState, error: '' });
  assert.equal(app.collaborationStatusLabel, '');
  assert.equal(app.collaborationCanRetry, false);
});

test('late retry failure and deferred dialog opening cannot cross account or room changes', async () => {
  const pending = deferred();
  const { app } = editor({ collabRetry: () => pending.promise });
  const retry = app.collaborationRetry();
  app.collaborationState = { ...app.collaborationState, roomId: 'new-room' };
  pending.reject(new Error('Previous room failure'));
  await retry;
  assert.equal(app.collaborationState.error, '');

  const tick = deferred();
  app.$nextTick = () => tick.promise;
  const opening = app.collaborationOpenHistory('stat.txt');
  app.collaborationResetViews();
  tick.resolve();
  await opening;
  assert.equal(app.$refs.collaborationHistoryDialog.open, false);
});

test('conflict choice preserves independent entries and serializes whole multiline/table entries', async () => {
  const calls = [];
  const { app } = editor({ collabResolve: async (...args) => { calls.push(copy(args)); return { status: 'pending' }; } });
  app.collaborationState.conflicts = [conflict({ yours: state(['first\\nsecond@column', 'my independent change', 'old remote']) })];
  await app.collaborationOpenConflicts();
  assert.equal(app.collaborationConflictReady, false);
  assert.deepEqual(copy(app.collaborationConflictDraft), ['first\nsecond@column', 'my independent change', 'remote independent change']);
  await app.collaborationSubmitConflict();
  assert.equal(calls.length, 0, 'No mutation before the conflicting entry is explicitly chosen.');
  app.collaborationChooseConflict(0, 'yours');
  await app.collaborationSubmitConflict();
  assert.deepEqual(calls, [['conflict-1', state(['first\\nsecond@column', 'my independent change', 'remote independent change'], 2), { sharedRevision: 2 }]]);
});

test('empty translation is an explicit valid resolution, including a first join without base', async () => {
  let submitted;
  const { app } = editor({ collabResolve: async (_id, result) => { submitted = copy(result.translations); } });
  app.collaborationState.conflicts = [conflict({ kind: 'join', base: null, yours: state(['']), shared: state(['shared']), indexes: [0] })];
  await app.collaborationOpenConflicts();
  assert.equal(app.collaborationConflictText(0, 'base'), 'No shared base yet');
  assert.equal(app.collaborationConflictText(0, 'yours'), '(Empty translation)');
  app.collaborationChooseConflict(0, 'yours');
  assert.equal(app.collaborationConflictReady, true);
  await app.collaborationSubmitConflict();
  assert.deepEqual(submitted, ['']);
});

test('remote revision change invalidates confirmation but preserves manually proposed text for re-review', async () => {
  const { app } = editor();
  app.collaborationState.conflicts = [conflict()];
  await app.collaborationOpenConflicts();
  app.collaborationConflictDraft[0] = 'My carefully combined result';
  app.collaborationEditConflict(0);
  app.collaborationState.conflicts = [conflict({ shared: state(['newer shared', 'unchanged', 'remote independent change'], 3) })];
  app.collaborationRefreshConflict();
  assert.equal(app.collaborationConflictReady, false);
  assert.equal(app.collaborationConflictDraft[0], 'My carefully combined result');
  assert.match(app.collaborationConflictNotice, /Review these entries again/);
});

test('custom result drafts and status choices survive closing, reopening, and file switches', async () => {
  const { app } = editor();
  app.collaborationState.conflicts = [
    conflict({ metadata: ['needsReview'], yours: { ...state(['mine', 'my independent change', 'old remote']), needsReview: true } }),
    conflict({ id: 'conflict-2', filepath: 'second.txt' }),
  ];
  await app.collaborationOpenConflicts();
  app.collaborationConflictDraft[0] = 'Combined first result\nwith another line';
  app.collaborationEditConflict(0); app.collaborationChooseMetadata('needsReview', 'yours');
  app.collaborationSelectConflict('conflict-2');
  app.collaborationConflictDraft[0] = 'Combined second result'; app.collaborationEditConflict(0);
  app.collaborationCloseConflicts();
  await app.collaborationOpenConflicts();
  assert.equal(app.collaborationConflictId, 'conflict-2');
  assert.equal(app.collaborationConflictDraft[0], 'Combined second result');
  assert.equal(app.collaborationConflictReady, true);
  app.collaborationSelectConflict('conflict-1');
  assert.equal(app.collaborationConflictDraft[0], 'Combined first result\nwith another line');
  assert.equal(app.collaborationConflictMetadataDraft.needsReview, true);
  assert.equal(app.collaborationConflictMetadataChoices.needsReview, 'yours');
  assert.equal(app.collaborationConflictReady, true);
});

test('closed-dialog drafts survive repeated shared revisions but require fresh confirmation', async () => {
  const { app } = editor();
  app.collaborationState.conflicts = [conflict()];
  await app.collaborationOpenConflicts();
  app.collaborationConflictDraft[0] = 'Custom proposal'; app.collaborationEditConflict(0);
  app.collaborationCloseConflicts();
  app.collaborationState.conflicts = [conflict({ shared: state(['mine', 'unchanged', 'remote independent change'], 3), indexes: [] })];
  app.collaborationRefreshConflict();
  await app.collaborationOpenConflicts();
  assert.equal(app.collaborationConflictDraft[0], 'Custom proposal');
  assert.deepEqual(copy(app.collaborationConflictIndexes), [0], 'A custom proposal remains reviewable when the original server conflict now merges.');
  assert.equal(app.collaborationConflictReady, false);
  app.collaborationCloseConflicts();
  app.collaborationState.conflicts = [conflict({ shared: state(['later shared', 'unchanged', 'remote independent change'], 4) })];
  await app.collaborationOpenConflicts();
  assert.equal(app.collaborationConflictDraft[0], 'Custom proposal');
  assert.equal(app.collaborationConflictReady, false);
  app.collaborationEditConflict(0); // Keep this result explicitly confirms the preserved proposal.
  assert.equal(app.collaborationConflictReady, true);
  assert.equal(app._collaborationConflictSharedRevision, 4);
});

test('account or workspace changes clear all in-memory result proposals', async () => {
  const { app } = editor();
  app.collaborationState.conflicts = [conflict()];
  await app.collaborationOpenConflicts();
  app.collaborationConflictDraft[0] = 'Private proposal'; app.collaborationEditConflict(0);
  app.collaborationCloseConflicts();
  app.collaborationState = { ...app.collaborationState, identity: { ...app.collaborationState.identity, accountId: 'bob' } };
  app.collaborationResetViews();
  await app.collaborationOpenConflicts();
  assert.equal(app.collaborationConflictDraft[0], 'mine');
  assert.equal(app.collaborationConflictReady, false);
  assert.equal(app._collaborationConflictDrafts.size, 0);
});

test('status-only conflicts require explicit review and retain independent shared status changes', async () => {
  let submitted;
  const { app } = editor({ collabResolve: async (_id, result) => { submitted = copy(result); } });
  app.collaborationState.conflicts = [conflict({ kind: 'join', base: null, yours: { ...state(['same']), needsReview: true }, shared: state(['same'], 2), indexes: [], metadata: ['needsReview'] })];
  await app.collaborationOpenConflicts();
  assert.equal(app.collaborationConflictReady, false);
  app.collaborationChooseMetadata('needsReview', 'shared');
  assert.equal(app.collaborationConflictReady, true);
  await app.collaborationSubmitConflict();
  assert.equal(submitted.needsReview, false);
  assert.equal(submitted.trackedForExport, true);

  app.collaborationState.conflicts = [conflict({ base: { ...state(['before']), needsReview: true }, yours: { ...state(['mine']), needsReview: true }, shared: state(['theirs'], 3) })];
  app.collaborationSelectConflict('conflict-1');
  app.collaborationChooseConflict(0, 'yours');
  await app.collaborationSubmitConflict();
  assert.equal(submitted.needsReview, false, 'Choosing local text must retain an independently cleared shared review flag.');
});

test('failed durable resolution keeps the dialog, choices, and proposed content recoverable', async () => {
  const { app, focus } = editor({ collabResolve: async () => { throw new Error('Storage quota exceeded'); } });
  app.collaborationState.conflicts = [conflict()];
  await app.collaborationOpenConflicts();
  app.collaborationChooseConflict(0, 'shared');
  await app.collaborationSubmitConflict();
  assert.equal(app.collaborationConflictVisible, true);
  assert.equal(app.collaborationConflictReady, true);
  assert.equal(app.collaborationConflictDraft[0], 'theirs');
  assert.equal(app.collaborationConflictError, 'Storage quota exceeded');
  app.collaborationCloseConflicts();
  assert.equal(app.$refs.collaborationConflictDialog.open, false);
  assert.equal(focus.count, 1, 'Closing restores focus to the opening control.');
});

test('late history requests cannot leak prior room results or errors after a context switch', async () => {
  for (const failure of [false, true]) {
    const pending = deferred();
    const { app } = editor({ collabLoadHistory: () => pending.promise });
    const open = app.collaborationOpenHistory('stat.txt');
    await new Promise(resolve => setImmediate(resolve));
    app.collaborationState = { ...app.collaborationState, roomId: 'room-2' };
    app.collaborationResetViews();
    if (failure) pending.reject(new Error('Old room error'));
    else pending.resolve({ items: [event()], nextCursor: 2 });
    await open;
    assert.equal(app.collaborationHistoryVisible, false);
    assert.equal(app.collaborationHistoryItems.length, 0);
    assert.equal(app.collaborationHistoryError, '');
    assert.equal(app.collaborationHistoryLoading, false);
  }
});

test('history pagination retains the file context and passes the opaque server cursor', async () => {
  const calls = [];
  const { app } = editor({ collabLoadHistory: async (...args) => {
    calls.push(copy(args));
    return calls.length === 1 ? { items: [event()], nextCursor: 'older:opaque' } : { items: [event({ id: 9 })], nextCursor: null };
  } });
  await app.collaborationOpenHistory('stat.txt');
  await app.collaborationRefreshHistory(true);
  assert.deepEqual(calls, [['stat.txt', {}], ['stat.txt', { cursor: 'older:opaque' }]]);
  assert.deepEqual(copy(app.collaborationHistoryItems).map(item => item.id), [12, 9]);
});

test('a late history detail cannot replace the more recently selected event', async () => {
  const pending = deferred();
  const { app } = editor({ collabLoadHistoryEntry: id => id === 12 ? pending.promise : Promise.resolve(event({ id })) });
  app.collaborationHistoryVisible = true;
  const old = app.collaborationSelectHistoryEvent({ id: 12 });
  await app.collaborationSelectHistoryEvent({ id: 15 });
  pending.resolve(event());
  await old;
  assert.equal(app.collaborationHistoryEvent.id, 15);
});

test('seed baseline has no restorable before while empty saved translations remain restorable', async () => {
  const calls = [];
  const { app } = editor({ collabRestoreHistory: async (...args) => { calls.push(args); return { status: 'pending' }; } });
  app.collaborationHistoryVisible = true;
  app.collaborationHistoryEvent = event({ before: null, canRestoreBefore: false, after: state(['']) });
  assert.equal(app.collaborationHistoryCanRestore('before'), false);
  assert.equal(app.collaborationHistoryCanRestore('after'), true);
  app.collaborationPrepareRestore('after');
  await app.collaborationConfirmRestore();
  assert.deepEqual(calls, [[12, 'after', 4]], 'Restore uses the currently shared revision, not the historical revision.');
  assert.match(app.collaborationHistoryNotice, /queued for sync/);
});

test('stale restore requires a fresh preview and does not show a successful restore', async () => {
  const { app } = editor({ collabRestoreHistory: async () => { const error = new Error('Shared version changed'); error.status = 409; throw error; } });
  app.collaborationHistoryVisible = true;
  app.collaborationHistoryEvent = event();
  app.collaborationPrepareRestore('before');
  await app.collaborationConfirmRestore();
  assert.equal(app.collaborationHistoryEvent, null);
  assert.equal(app.collaborationHistoryRestoreVersion, '');
  assert.equal(app.collaborationHistoryNotice, '');
  assert.equal(app.collaborationHistoryError, 'Shared version changed');
});

test('context changes during restore discard the old completion notice', async () => {
  const pending = deferred();
  const { app } = editor({ collabRestoreHistory: () => pending.promise });
  app.collaborationHistoryVisible = true; app.collaborationHistoryEvent = event();
  app.collaborationPrepareRestore('after');
  const saving = app.collaborationConfirmRestore();
  app.collaborationState = { ...app.collaborationState, roomId: 'new-room' };
  app.collaborationResetViews();
  pending.resolve({ status: 'synced' });
  await saving;
  assert.equal(app.collaborationHistoryNotice, '');
  assert.equal(app.collaborationHistoryRestoring, false);
});
