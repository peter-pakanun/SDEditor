/* Run once in the still-open SDEditor tab's browser console after editing stops.
 * Reads only the active temporary workbook's values and drafts; downloads a local
 * recovery JSON. No API, worker, storage writes, workbook switches or reloads.
 * Keep the tab open: this JSON is a recovery snapshot, not an XLSX workbook.
 */
(async () => {
    const container = document.querySelector('#app');
    const editor = container?.__vue_app__?._instance?.proxy || container?._vnode?.component?.proxy;
    if (!editor?.ctOfflineTest || !editor.ctWorkspace?.scope?.groupId?.startsWith('local:test:')) throw new Error('No active temporary ClientText workbook found. Nothing was changed.');
    if (editor.ctBusy || editor.ctScanRunning || editor._ctExportRun) throw new Error('Wait for the current operation to finish, then retry. Keep this tab open.');
    const copy = value => JSON.parse(JSON.stringify(value));
    const scope = copy(editor.ctWorkspace.scope), store = editor._ctTestStores?.get(scope.groupId);
    if (!store?.getSaved || !store.getDraftSummaries || !store.getDraft) throw new Error('The temporary workbook recovery interface is unavailable. Keep this tab open.');
    const current = () => JSON.stringify(editor.ctWorkspace?.scope) === JSON.stringify(scope) && !editor.ctBusy && !editor._ctExportRun;
    const activeDraft = copy({ unitId: editor.ctSelection, values: editor.ctValues, reviewed: editor.ctReviewed, dirty: !!editor.ctDraftDirty });
    const metadata = await store.getMetadata(scope), saved = await store.getSaved(scope), drafts = [];
    for (const summary of await store.getDraftSummaries(scope)) {
        const draft = await store.getDraft(scope, summary.unitId);
        if (!draft) throw new Error('A draft changed during recovery. Stop editing and retry; keep this tab open.');
        drafts.push(draft);
    }
    if (!current() || JSON.stringify(activeDraft) !== JSON.stringify(copy({ unitId: editor.ctSelection, values: editor.ctValues, reviewed: editor.ctReviewed, dirty: !!editor.ctDraftDirty }))) throw new Error('The editor changed during recovery. Stop editing and retry; keep this tab open.');
    const snapshot = { format: 'sdeditor-clienttext-memory-recovery-v1', createdAt: new Date().toISOString(),
        source: { game: scope.game, branchId: scope.branchId, language: scope.language, descriptors: metadata.descriptors },
        saved, drafts, activeDraft };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'SDEditor-ClientText-memory-recovery.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { downloadInitiated: true, savedRecords: Object.keys(saved).length, storedDrafts: drafts.length, activeUnsavedDraft: activeDraft.dirty, bytes: blob.size };
})();
