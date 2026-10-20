'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const Memory = require('../public/clientTextMemoryStore.js');
const State = require('../public/clientTextState.js');
const { scope: baseScope, unit, asset, fieldId } = require('./clienttext-storage-fixture.cjs');
const source = readFileSync(join(__dirname, 'clienttext-memory-recovery-console.js'), 'utf8');

test('read-only memory rescue downloads exact authored values, every stored draft and active unsaved text; values restore into an independent session', async () => {
    const scope = { ...baseScope, versionId: 'local:test:v', groupId: 'local:test:g' }, store = Memory.create();
    const first = unit(), second = { ...unit(), id: JSON.stringify(['normal', 'ClientStrings', 'ID/2']), recordId: 'ID/2' };
    const input = { units: [first, second], assets: [asset] };
    await store.import(scope, input);
    const raw = 'Authored @ \\n literal\nactual\r\n空白  ', draftRaw = 'Other stored draft\n\\n', activeRaw = 'Still typing @\n';
    await store.save(scope, first.id, { jobId: 'authored', values: { [fieldId]: raw }, reviewed: {} });
    await store.putDraft(scope, second.id, { values: { [fieldId]: draftRaw }, reviewed: {} });
    const before = JSON.stringify([await store.getSaved(scope), await store.getDraft(scope, second.id), await store.listHistory(scope, first.id)]);
    const calls = [], downloads = [], editor = { ctOfflineTest: true, ctWorkspace: { scope }, ctSelection: first.id,
        ctValues: { [fieldId]: activeRaw }, ctReviewed: {}, ctDraftDirty: true,
        _ctTestStores: new Map([[scope.groupId, new Proxy(store, { get(target, key) {
            assert(['getMetadata', 'getSaved', 'getDraftSummaries', 'getDraft'].includes(key), 'only snapshot read APIs may run');
            return (...args) => { calls.push(key); return target[key](...args); };
        } })]]) };
    let snapshotBlob;
    const result = await runInNewContext(source, { Blob, Date, JSON, setTimeout() {},
        URL: { createObjectURL(blob) { snapshotBlob = blob; return 'blob:local-recovery'; }, revokeObjectURL() {} },
        document: { querySelector() { return { _vnode: { component: { proxy: editor } } }; }, createElement() { return { click() { downloads.push(this.download); } }; } }
    });
    assert.equal(result.savedRecords, 1); assert.equal(result.storedDrafts, 1); assert(result.activeUnsavedDraft);
    assert.deepEqual(downloads, ['SDEditor-ClientText-memory-recovery.json']);
    const snapshot = JSON.parse(await snapshotBlob.text());
    assert.equal(snapshot.saved[first.id].values[fieldId], raw); assert.equal(snapshot.drafts[0].values[fieldId], draftRaw); assert.equal(snapshot.activeDraft.values[fieldId], activeRaw);
    assert.equal(snapshot.source.accountId, undefined); assert.equal(snapshot.dictionary, undefined); assert.equal(snapshot.originals, undefined);
    assert.equal(before, JSON.stringify([await store.getSaved(scope), await store.getDraft(scope, second.id), await store.listHistory(scope, first.id)]));
    const restored = Memory.create(), nextScope = { ...scope, groupId: 'local:test:restored' };
    const nextMetadata = await restored.import(nextScope, input);
    assert.deepEqual(snapshot.source.descriptors, nextMetadata.descriptors, 'restore is bound to the exact originals and parser');
    for (const record of Object.values(snapshot.saved)) await restored.save(nextScope, record.unitId, { jobId: 'restore:' + record.unitId, values: record.values, reviewed: record.reviewed });
    for (const draft of snapshot.drafts) await restored.putDraft(nextScope, draft.unitId, draft);
    if (snapshot.activeDraft.dirty) await restored.putDraft(nextScope, snapshot.activeDraft.unitId, snapshot.activeDraft);
    assert.equal((await restored.getSaved(nextScope))[first.id].values[fieldId], raw);
    assert.equal((await restored.getDraft(nextScope, second.id)).values[fieldId], draftRaw);
    assert.equal((await restored.getDraft(nextScope, first.id)).values[fieldId], activeRaw);
});

test('memory rescue refuses a durable workspace or a busy session before reading values or initiating a download', async () => {
    for (const editor of [{ ctOfflineTest: false }, { ctOfflineTest: true, ctWorkspace: { scope: { groupId: 'local:test:g' } }, ctBusy: true }]) {
        await assert.rejects(runInNewContext(source, { document: { querySelector() { return { _vnode: { component: { proxy: editor } } }; }, createElement() { assert.fail('No download'); } } }), /Nothing was changed|Wait for the current operation/);
    }
});
