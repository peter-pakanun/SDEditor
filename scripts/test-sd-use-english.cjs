const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/statDescCodec.js');
const W = require('../public/workspaceState.js');
const P = require('../public/collaborationProtocol.js');
const source = (thai) => ({ filepath: 'stat/english.txt', name: '', stats: ['example'], variables: ['#'], remarks: ['reminderstring Example'],
    translations: { English: ['[EssenceAnger|Anger]'], ...(thai ? { Thai: thai } : {}) } });
const workspace = file => W.initializeWorkspace({ sourceHash: 'old', game: 'poe1', accountId: 'guest', branchId: 'default', descs: [], status: {} },
    { source: [file], sourceHash: 'old', game: 'poe1', language: 'Thai' });

test('only an explicit Use English decision survives an omitted upstream block across repeated versions', async () => {
    await assert.rejects(C.englishIntentFor({ translations: { English: [] } }, 'empty'), /complete English/);
    const original = source(), unchanged = structuredClone(original), intent = await C.englishIntentFor(original, 'approve');
    for (const approved of [false, true]) {
        const saved = workspace(original);
        W.stageTranslation(saved, { filepath: original.filepath, translations: original.translations.English,
            ...(approved ? { englishIntent: intent } : {}) }, 'Thai', { source: original, sourceHash: 'old' });
        W.upgradeSource(saved, { source: [unchanged], previousSource: [original], sourceHash: 'next', previousSourceHash: 'old', game: 'poe1', language: 'Thai' });
        const state = W.workspaceFile(saved, unchanged, 'Thai');
        assert.equal(state.isDropped, !approved);
        assert.equal(state.isMissing, !approved);
        assert.equal(state.hasChanges, approved);
        if (approved) {
            assert.deepEqual(state.staged.englishIntent, intent);
            W.upgradeSource(saved, { source: [unchanged], previousSource: [unchanged], sourceHash: 'third', previousSourceHash: 'next', game: 'poe1' });
            assert.equal(W.workspaceFile(saved, unchanged, 'Thai').isDropped, false);
            assert.equal(W.repairRedundantCarriedStages(saved, { source: [source(original.translations.English)] }).changed, false);
        }
    }
    assert.equal(Object.hasOwn(original.translations, 'Thai'), false, 'The immutable original stays untouched.');
});

test('Use English suspends on source/metadata changes and conflicting upstream targets; it never infers approval', async () => {
    const original = source(), intent = await C.englishIntentFor(original, 'approve');
    for (const next of [
        { ...source(), stats: ['different'] },
        { ...source(), translations: { English: ['Changed English'] } },
        source(['ฉบับจากต้นทาง']),
    ]) assert.equal(W.classifySourceCarry(original, next, 'Thai', original.translations.English, { englishIntent: intent }).action, 'drop');
    assert.equal(W.classifySourceCarry(original, source(original.translations.English), 'Thai', original.translations.English, { englishIntent: intent }).action, 'carry');
    assert.equal(W.classifySourceCarry(original, source(original.translations.English), 'Thai', original.translations.English).action, 'baseline');
    const saved = workspace(original);
    W.stageTranslation(saved, { filepath: original.filepath, translations: original.translations.English, englishIntent: intent }, 'Thai', { source: original });
    W.stageTranslation(saved, { filepath: original.filepath, translations: original.translations.English, englishIntent: null }, 'Thai', { source: original });
    assert.equal(saved.staged.Thai[original.filepath].englishIntent, undefined);
    assert.equal(W.classifySourceCarry(original, source(), 'Thai', original.translations.English, saved.staged.Thai[original.filepath]).action, 'drop');
    assert.throws(() => W.stageTranslation(saved, { filepath: original.filepath, translations: ['Different'], englishIntent: intent }, 'Thai', { source: original }), /verified English/);
});

test('peer projection and merges preserve approvals and surface competing decisions', async () => {
    const original = source(), intent = await C.englishIntentFor(original, 'approve');
    const base = { filepath: original.filepath, translations: original.translations.English, trackedForExport: true, needsReview: false, revision: 1 };
    const yours = { ...base, englishIntent: intent }, shared = { ...base, englishIntent: { ...intent, actionId: 'peer' }, revision: 2 };
    assert.equal(P.mergeFile(base, yours, shared).conflict, true);
    const projected = P.projectWorkspace(workspace(original), [yours], 'Thai', [original]);
    assert.deepEqual(projected.staged.Thai[original.filepath].englishIntent, intent);
    assert.equal(W.workspaceFile(projected, original, 'German').hasChanges, false);
    assert.equal(W.carriedBaselineReplay(projected, source(original.translations.English), 'Thai', { ...yours, sourceCarry: { fromSourceHash: 'earlier', toSourceHash: 'old' } }), null);
});

test('count mismatch is informational only with complete preserved work and verified unchanged source metadata', () => {
    const current = source(['old generic', 'obsolete variant']);
    const candidate = { reason: 'Translation missing from new source', originSourceAvailable: true,
        snapshot: { english: current.translations.English, stats: current.stats, name: current.name, variables: current.variables, remarks: current.remarks, translations: ['saved generic'] } };
    const info = W.upstreamEntryCountInfo(candidate, current, 'Thai');
    assert.equal(info.actualCount, 2); assert.equal(info.expectedCount, 1); assert.match(info.message, /continue with other work/);
    for (const invalid of [
        { ...candidate, reason: 'English source changed' },
        { ...candidate, originSourceAvailable: false },
        { ...candidate, snapshot: { ...candidate.snapshot, english: ['Changed English'] } },
        { ...candidate, snapshot: { ...candidate.snapshot, remarks: ['different'] } },
        { ...candidate, snapshot: { ...candidate.snapshot, translations: [''] } },
    ]) assert.equal(W.upstreamEntryCountInfo(invalid, current, 'Thai'), null);
    assert.equal(W.upstreamEntryCountInfo(candidate, source(['one']), 'Thai'), null);
    assert.equal(W.upstreamEntryCountInfo({ ...candidate, snapshot: { ...candidate.snapshot, english: ['Different old source'] } }, current, 'Thai', current), null,
        'A stale loaded origin cannot hide a changed frozen source.');
    assert.equal(W.upstreamEntryCountInfo({ ...candidate, filepath: 'another.txt' }, current, 'Thai'), null);
});
