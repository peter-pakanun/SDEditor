const { test } = require('node:test');
const assert = require('node:assert/strict');
const recall = require('../public/sdRecall.js');
const archive = { baselineId: 'a'.repeat(64), zipHash: 'b'.repeat(64), zipSize: 12 };
const previous = { id: 'v1', name: 'Previous release', game: 'poe2', branchId: 'default', parentVersionId: null,
  contentGroups: [{ id: 'old-group', versionId: 'v1', logicalKey: 'stats', contentMode: 'statdescription',
    teams: [{ language: 'Thai' }], assets: [{ role: 'source', descriptor: archive }] }] };
const latest = { id: 'v2', name: 'Current release', game: 'poe2', branchId: 'default', parentVersionId: 'v1' };
const clone = value => structuredClone(value);
function fixture({ saved = null, source, candidates = [], failure = null, sourceFailure = false } = {}) {
  const desc = { filepath: 'stat_descriptions/file.txt', name: 'file', stats: ['stat'], variables: ['#'], remarks: [''],
    translations: { English: ['Current {0}'], Thai: ['Committed {0}'] } };
  let committed = { filepath: desc.filepath, translations: ['Committed {0}'], revision: 3, trackedForExport: true };
  const calls = { drafts: 0, saves: [], resolve: [], rebases: [], dialogs: 0 };
  const ctx = { account: 'account', game: 'poe2', branchId: 'default', source: 'c'.repeat(64), language: 'Thai', groupId: 'new-group', versionId: 'v2' };
  const host = { ...recall.mixin.data(), editorToolsScope: 'account/poe2/current/Thai', editorContentGroupScopeKey: 'new-group/v2',
    editorCurrentEditingDesc: desc, _editorOpenRun: 1, cloudUser: { id: 'account', role: 'translator', assignmentVersion: 1 },
    cloudCanAccessAllLanguages: false, lang: 'Thai', gameVersion: 'poe2', editorReady: true, editorSaving: false,
    editorTranslationReadOnly: false, editorOriginalTranslations: ['Committed {0}'], editorBlocks: [{ translation: 'Separate normal draft {0}' }],
    _editorCollabBase: clone(committed), cloudSignedIn: true, editorDroppedChoices: clone(candidates),
    managedVersions: clone([latest, previous]), managedActiveVersion: clone(latest),
    activeContentGroup: { id: 'new-group', versionId: 'v2', logicalKey: 'stats' },
    captureCollaborationContext: () => clone(ctx), collaborationContextCurrent: value => value.account === ctx.account && value.language === ctx.language,
    collaborationFile: () => clone(committed), workspaceSourceFile: () => desc,
    async flushEditorDraft() { calls.drafts++; return true; }, $nextTick: async () => {},
    $refs: { sdRecallDialog: { showModal() { calls.dialogs++; }, close() {} } },
    decodeEscapedNewlines: value => String(value ?? '').replaceAll('\\n', '\n'),
    encodeNewlines: value => String(value ?? '').replaceAll('\n', '\\n'),
    droppedOwnershipLabel: candidate => candidate.ownership === 'shared' ? 'Shared Dropped' : 'Local recovery',
    renderInlineDiffHtml: (a, b, options) => JSON.stringify({ a, b, options }),
    capturedDroppedPromotion: (_path, candidate) => ({ id: candidate.id, revision: candidate.revision, ownership: candidate.ownership }),
    analyzeDescDiagnostics: () => ({ warningCount: 0, errorCount: 0 }),
    async persistTranslationBatch(updates, origin, options) {
      calls.saves.push(clone({ updates, origin, options }));
      committed = { ...committed, translations: [...updates[0].lines], revision: committed.revision + 1 };
      return { status: 'committed', durable: true };
    },
    rebaseEditorAfterCommit: (...args) => calls.rebases.push(clone(args)),
    _cloud: { async request(path) {
      assert.match(path, /old-group\/teams\/Thai\/recall\?filepath=stat_descriptions%2Ffile\.txt$/);
      if (failure) throw failure;
      return { group: clone(previous.contentGroups[0]), version: clone(previous), language: 'Thai', archive: clone(archive), file: saved ? { filepath: desc.filepath, ...saved } : null };
    } },
  };
  for (const [name, fn] of Object.entries(recall.mixin.methods)) host[name] = fn.bind(host);
  for (const [name, fn] of Object.entries(recall.mixin.computed)) Object.defineProperty(host, name, { get: () => fn.call(host) });
  globalThis.OfflineStore = { getBaselineArchive: async () => clone(archive) };
  globalThis.SDBaselineFiles = { async resolveBaselineFile(reference, options) {
    calls.resolve.push({ reference: clone(reference), options });
    assert.equal(Object.hasOwn(options, 'fetchFile'), false, 'recall must not invoke server-side baseline parsing');
    if (sourceFailure) throw new Error('Original ZIP is unavailable');
    return clone(source || { ...desc, translations: { English: ['Previous {0}'], Thai: ['Original target {0}'] } });
  } };
  return { host, calls, ctx, desc };
}
test('references follow actual version ancestry and logical group key despite unique group IDs', () => {
  const other = { ...clone(previous), id: 'unrelated', name: 'Unrelated' };
  const child = { ...clone(latest), id: 'future', parentVersionId: 'v2' };
  const versions = [other, child, clone(latest), clone(previous)];
  const result = recall.referenceChoices(versions, latest, { logicalKey: 'stats' }, 'Thai');
  assert.deepEqual(result.map(choice => [choice.version.id, choice.group.id]), [['v1', 'old-group']]);
  assert.equal(recall.referenceChoices(versions, latest, { logicalKey: 'different' }, 'Thai').length, 0);
  assert.equal(recall.referenceChoices(versions, latest, { logicalKey: 'stats' }, 'French').length, 0);
});
test('viewing and editing recalled original text leave normal editor drafts and committed work untouched', async () => {
  const { host, calls } = fixture();
  await host.sdRecallOpen();
  assert.equal(calls.dialogs, 1); assert.equal(host.sdRecallReview.kind, 'Original ZIP translation');
  assert.deepEqual(host.sdRecallReview.values, ['Original target {0}']);
  assert.deepEqual(host.editorBlocks, [{ translation: 'Separate normal draft {0}' }]);
  const checkpointCount = calls.drafts;
  host.sdRecallSetValue(0, 'Reviewed target {0}'); host.sdRecallConfirm(0);
  assert.equal(calls.drafts, checkpointCount); assert.equal(calls.saves.length, 0);
  assert.deepEqual(host.editorBlocks, [{ translation: 'Separate normal draft {0}' }]);
  assert.deepEqual(host.collaborationFile().translations, ['Committed {0}']);
  host.sdRecallClose(); assert.equal(calls.saves.length, 0);
});
test('exact frozen candidate takes priority over later historical Saved text and preserves missing source evidence', async () => {
  const candidate = { id: 'copy', ownership: 'shared', revision: 4, originSourceHash: archive.baselineId,
    originSourceAvailable: false, snapshot: { translations: ['Frozen target {0}'] } };
  const { host } = fixture({ candidates: [candidate], saved: { trackedForExport: true, translations: ['Later edit {0}'] }, sourceFailure: true });
  await host.sdRecallOpen();
  assert.deepEqual(host.sdRecallReview.values, candidate.snapshot.translations);
  assert.equal(host.sdRecallReview.oldEnglish, null); assert.match(host.sdRecallNotice, /unavailable/);
});
test('ambiguous recovery generations require explicit selection rather than guessing or falling back', async () => {
  const first = { id: 'one', revision: 1, ownership: 'shared', originSourceHash: archive.baselineId, snapshot: { translations: ['One {0}'] } };
  const second = { ...clone(first), id: 'two', snapshot: { translations: ['Two {0}'] } };
  const { host } = fixture({ candidates: [first, second] }); await host.sdRecallOpen();
  assert.equal(host.sdRecallReview, null); assert.match(host.sdRecallNotice, /exact recovery/);
  await host.sdRecallSelect(host.sdRecallReferenceId, recall.candidateKey(second));
  assert.deepEqual(host.sdRecallReview.values, ['Two {0}']);
});
test('offline historical original fallback is labelled when latest accepted Saved work could not be checked', async () => {
  const { host, calls } = fixture({ failure: new Error('Network unavailable') }); await host.sdRecallOpen();
  assert.match(host.sdRecallReview.kind, /latest historical Saved work could not be checked/);
  assert.deepEqual(host.sdRecallReview.oldEnglish, ['Previous {0}']);
  assert.equal(calls.resolve.length, 1);
});
test('authentication rejection does not fall back to a cached historical translation', async () => {
  const { host, calls } = fixture({ failure: Object.assign(new Error('Access changed'), { status: 403 }) });
  await host.sdRecallOpen(); assert.equal(host.sdRecallReview, null); assert.equal(calls.resolve.length, 0);
  assert.equal(host.sdRecallError, 'Access changed');
});
test('an unavailable historical descriptor never reads an empty or current-source cache identity', async () => {
  const { host, calls } = fixture({ failure: new Error('Offline') });
  host.managedVersions[1].contentGroups[0].assets = [];
  globalThis.OfflineStore.getBaselineArchive = () => assert.fail('No exact source identity is available');
  await host.sdRecallOpen(); assert.equal(host.sdRecallReview, null); assert.equal(calls.resolve.length, 0);
});
test('invalid originals never enter recall review and changed entry counts require manual complete alignment', async () => {
  const invalid = fixture({ source: { translations: { English: ['Old'], Thai: [' '] } } }); await invalid.host.sdRecallOpen();
  assert.equal(invalid.host.sdRecallReview, null); assert.equal(invalid.host.sdRecallCanSave, false);
  const changed = fixture({ source: { translations: { English: ['Old', 'Second'], Thai: ['First target', 'Second target'] } } });
  await changed.host.sdRecallOpen(); assert.deepEqual(changed.host.sdRecallReview.retained, ['First target', 'Second target']);
  assert.deepEqual(changed.host.sdRecallReview.values, ['']); assert.match(changed.host.sdRecallNotice, /entry counts differ/);
  assert.equal(changed.host.sdRecallCanSave, false);
});
test('save requires every unchanged entry confirmed and does not resolve an unrelated dropped copy', async () => {
  const { host, calls } = fixture(); await host.sdRecallOpen();
  assert.equal(host.sdRecallCanSave, false); assert.equal(await host.sdRecallSave(), false);
  host.sdRecallConfirm(0); assert.equal(host.sdRecallCanSave, true);
  await host.sdRecallSave();
  assert.equal(calls.saves.length, 1); assert.equal(calls.saves[0].origin, 'save');
  assert.equal(calls.saves[0].options.preserveDropped, true); assert.equal(calls.saves[0].options.awaitDurable, true);
  assert.equal(calls.saves[0].options.promoteDropped, undefined);
  assert.deepEqual(host.editorBlocks, [{ translation: 'Separate normal draft {0}' }]);
  assert.deepEqual(calls.rebases[0][1].savedIndexes, []);
});
test('explicit candidate review Save binds only its exact recovery identity and revision', async () => {
  const candidate = { id: 'copy', revision: 8, ownership: 'shared', originSourceHash: archive.baselineId,
    snapshot: { translations: ['Frozen target {0}'] } };
  const { host, calls } = fixture({ candidates: [candidate] }); await host.sdRecallOpen(); host.sdRecallConfirm(0);
  await host.sdRecallSave();
  assert.deepEqual(calls.saves[0].options.promoteDropped, { id: 'copy', revision: 8, ownership: 'shared' });
  assert.equal(calls.saves[0].options.preserveDropped, false);
});
test('late loads cannot publish into another account, language, file or closed review', async () => {
  for (const change of ['account', 'language', 'file', 'close']) {
    const { host, ctx } = fixture(); let finish;
    const original = host._cloud.request;
    host._cloud.request = async path => { await new Promise(resolve => { finish = resolve; }); return original(path); };
    const opening = host.sdRecallOpen(); while (!finish) await new Promise(resolve => setImmediate(resolve));
    if (change === 'account') ctx.account = 'different';
    if (change === 'language') ctx.language = 'French';
    if (change === 'file') host.editorCurrentEditingDesc = { ...host.editorCurrentEditingDesc, filepath: 'other.txt' };
    if (change === 'close') host.sdRecallClose(true);
    finish(); await opening; assert.equal(host.sdRecallReview, null, change);
  }
});
test('failed Save retains the complete review and its confirmations for correction or retry', async () => {
  const { host } = fixture(); await host.sdRecallOpen(); host.sdRecallConfirm(0);
  host.persistTranslationBatch = async () => { throw new Error('Durable storage failed'); };
  assert.equal(await host.sdRecallSave(), false); assert.equal(host.sdRecallVisible, true);
  assert.equal(host.sdRecallError, 'Durable storage failed'); assert.equal(host.sdRecallReview.confirmed[0], true);
  assert.equal(host.sdRecallSaving, false); assert.equal(host.editorSaving, false);
});
test('English diff options are passed to the existing escaped text renderer', async () => {
  const { host } = fixture(); await host.sdRecallOpen(); host.sdRecallWhitespace = true; host.sdRecallCharacters = true;
  assert.deepEqual(JSON.parse(host.sdRecallDiff(0)), { a: 'Previous {0}', b: 'Current {0}', options: { showWhitespace: true, characters: true } });
});
test('large source entries keep current text available without invoking an unbounded inline diff', async () => {
  const { host } = fixture(); await host.sdRecallOpen(); host.sdRecallReview.oldEnglish[0] = 'a'.repeat(240001);
  host.renderInlineDiffHtml = () => { throw new Error('Large diff must not run'); };
  assert.equal(host.sdRecallDiffLimited(0), true); assert.equal(host.sdRecallDiff(0), '');
});
test('an old recall Save completion cannot clear a newer editor save state after a scope change', async () => {
  const { host, ctx } = fixture(); await host.sdRecallOpen(); host.sdRecallConfirm(0);
  let finish;
  host.persistTranslationBatch = async () => await new Promise(resolve => { finish = resolve; });
  const saving = host.sdRecallSave(); while (!finish) await new Promise(resolve => setImmediate(resolve));
  host.sdRecallClose(true); ctx.account = 'other'; host._editorSaveToken = {}; host.editorSaving = true;
  finish({ durable: true, status: 'committed' }); await saving;
  assert.equal(host.editorSaving, true); assert.equal(host.sdRecallReview, null);
});
