const test = require('node:test');
const assert = require('node:assert/strict');
const SDTeams = require('../public/sdTeamBranches.js');

const scope = { accountId: 'translator', game: 'poe2', branchId: 'default', language: 'Thai', logicalKey: 'statdescription' };
const archive = { baselineId: 'baseline-v7', zipHash: 'a'.repeat(64), zipSize: 1024 };

test('team advancement retains the exact predecessor identity and accepted sequence captured at import', () => {
  const checkpoint = { id: 'checkpoint-v7', baselineId: 'baseline-v7', parentBaselineId: 'baseline-v6', parentHeadId: 'entry-v6', parentSequence: 8 };
  const state = { revision: 2, head: { id: 'entry-v6', baselineId: 'baseline-v6', sequence: 8 } };
  const body = SDTeams.advanceBody(scope, checkpoint, 'room-v7', state);
  assert.deepEqual(body, { game: 'poe2', branchId: 'default', language: 'Thai', logicalKey: 'statdescription', baselineId: 'baseline-v7',
    roomId: 'room-v7', expectedHeadId: 'entry-v6', expectedOriginVersionId: null, expectedRevision: 2,
    expectedPredecessorSequence: 8, idempotencyKey: 'checkpoint-v7' });
  assert.throws(() => SDTeams.advanceBody(scope, checkpoint, 'room-v7', { ...state, head: { ...state.head, sequence: 9 } }), { code: 'SD_TEAM_PREDECESSOR_CHANGED' });
  assert.throws(() => SDTeams.advanceBody(scope, checkpoint, 'room-v7', { ...state, head: { ...state.head, id: 'entry-other' } }), { code: 'SD_TEAM_HEAD_CHANGED' });
});

test('the graph retains local advances before the team head and keeps Origin distinct', () => {
  const branch = { head: { id: 'team-v7', baselineId: 'v7' }, origin: { versionId: 'release-v9', baselineId: 'v9' },
    history: [{ id: 'team-v7', baselineId: 'v7' }, { id: 'team-v6', baselineId: 'v6' }] };
  const rows = SDTeams.graphRows(branch, [{ id: 'local-v7', baselineId: 'v7' }, { id: 'local-v8', baselineId: 'v8' }]);
  assert.deepEqual(rows.map(row => [row.id, row.type]), [['local-v8', 'pending'], ['team-v7', 'team'], ['team-v6', 'team'], ['origin:release-v9', 'origin']]);
});

test('an explicitly adopted starting source stays independent of the current Origin', () => {
  const checkpoint = { id: 'adopted', baselineId: archive.baselineId, parentBaselineId: '', adoptExisting: true };
  const state = { revision: 0, head: null, origin: { versionId: 'v5', baselineId: 'baseline-v5', roomId: 'room-v5', sequence: 18 } };
  const command = SDTeams.advanceBody(scope, checkpoint, 'room-v7', state);
  assert.equal(command.adoptExisting, true);
  assert.equal(command.expectedHeadId, null);
  assert.equal(command.expectedOriginVersionId, null);
  assert.equal(command.expectedPredecessorSequence, null);
  assert.throws(() => SDTeams.advanceBody(scope, checkpoint, 'room-v7', { ...state, head: { id: 'already-started' } }), { code: 'SD_TEAM_HEAD_CHANGED' });
});

test('a retained original from another team skips reading or uploading the local ZIP', async () => {
  const sent = [];
  const original = { archive, zipHash: archive.zipHash };
  const translator = { ...scope, language: 'German' };
  const vm = { sdTeamOriginalsLoaded: true };
  const client = { request: async (path, options) => { sent.push({ path, options }); return { status: 'ready', original }; } };
  const result = await SDTeams.mixin.methods.sdTeamEnsureOriginal.call(vm, archive, { scope: translator, client, current: () => true });
  assert.equal(result, original);
  assert.deepEqual(sent, [{ path: '/v1/sd-originals/poe2/claim', options: { method: 'POST', body: { zipHash: archive.zipHash, zipSize: archive.zipSize, archive }, signal: undefined } }]);
});

test('canonical parser differences stop branch attachment without substituting another baseline', async () => {
  const client = { request: async () => ({ status: 'ready', original: { archive: { ...archive, baselineId: 'different-parser' } } }) };
  await assert.rejects(SDTeams.mixin.methods.sdTeamEnsureOriginal.call({}, archive, { scope, client, current: () => true }), /different parser decisions/);
});

test('a teammate advancing the same source still synchronizes the retained local workspace before acknowledgment', async () => {
  const order = [], checkpoints = [{ id: 'offline-v7', baselineId: archive.baselineId, parentBaselineId: 'old-baseline', archive }];
  const state = { revision: 4, head: { id: 'team-v7', baselineId: archive.baselineId, roomId: 'room-v7' } };
  const oldStore = globalThis.OfflineStore;
  globalThis.OfflineStore = { listSDTeamBranchCheckpoints: async () => checkpoints, putSDTeamBranchView: async () => order.push('view'),
    ackSDTeamBranchCheckpoint: async (_scope, id) => order.push('ack:' + id) };
  try {
    const client = { request: async path => { assert.match(path, /^\/v1\/sd-team-branch\?/); return state; } };
    const vm = { sdTeamBranchVisible: true, _cloud: client, sdTeamPolicy: {}, sdTeamRequestContext: () => ({ scope, client, current: () => true }),
      sdTeamSyncCheckpointRoom: async item => { order.push('sync:' + item.id); return { id: 'room-v7', remoteChanged: false }; } };
    await SDTeams.mixin.methods.sdTeamDrain.call(vm);
    assert.deepEqual(order, ['sync:offline-v7', 'view', 'ack:offline-v7']);
    assert.deepEqual(vm.sdTeamCheckpoints, []);
  } finally { globalThis.OfflineStore = oldStore; }
});

test('online import hydrates the predecessor before capturing its exact sequence', async () => {
  const source = { id: 'team-v6', baselineId: 'baseline-v6', roomId: 'room-v6', sequence: 12 };
  const order = [], client = { request: async () => { order.push('read-branch'); return { head: source }; } };
  const vm = { sdTeamBranchVisible: true, sdTeamBusy: false, sdTeamScopeKey: 'scope-key', sourceLoaded: true,
    sourceIdentity: source.baselineId, sdTeamWorkingNode: source, sdTeamCheckpoints: [], sdTeamBranch: { head: source },
    sdTeamNodeActive: () => true, sdTeamRequestContext: () => ({ scope, client, current: () => true }),
    async initializeCollaboration() {
      order.push('initialize');
      this._collaboration = { startRemote: async () => order.push('hydrate'), room: () => ({ ...source, identity: { sourceHash: source.baselineId } }) };
    },
    importUpdateZipFile: async (_file, _parsed, options) => { order.push('import'); assert.equal(options.teamImport.parentSequence, 12); } };
  await SDTeams.mixin.methods.sdTeamImportNext.call(vm, { name: 'Next.zip' });
  assert.deepEqual(order, ['initialize', 'hydrate', 'read-branch', 'import']);
  client.request = async () => ({ head: { ...source, sequence: 13 } });
  await SDTeams.mixin.methods.sdTeamImportNext.call(vm, { name: 'Next.zip' });
  assert.match(vm.sdTeamActionError, /accepted team work changed/);
  assert.equal(order.filter(step => step === 'import').length, 1);
});
